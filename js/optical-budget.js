// Orçamento óptico: estima a potência em cada porta da rede a partir da OLT, seguindo as fusões dos
// planos de fusão e somando as perdas (cabo por km, fusões, conectores, splitters). A origem é o
// splitter vinculado a uma OLT/PON. Depende de js/fusion-plan.js, js/catalog.js (lancamentoConfig)
// e js/clients.js (getCtoClients, getClientDropInfo).

function getSplitterLoss(splitter, cfg) {
    const ratio = Number(String(splitter.label || '').match(/1\s*[:x×]\s*(\d+)/i)?.[1]) || splitter.outputs || 2;
    const table = cfg.splitters || {};
    if (table[ratio] != null) return Number(table[ratio]);
    return 10 * Math.log10(ratio) + 1; //Divisão ideal + perda de excesso
}

//Potência (dBm) em cada nó alcançado. Retorna { power: Map(nó → dBm), info, sources }
function computeOpticalPower(cfg = lancamentoConfig?.optical || DEFAULT_OPTICAL_CONFIG) {
    const edges = new Map(); //nó → [{ to, loss, kind }]
    const info = new Map();
    const fiberNodes = new Map();
    const addEdge = (a, b, loss, kind) => {
        if (!edges.has(a)) edges.set(a, []);
        edges.get(a).push({ to: b, loss, kind });
    };
    const sources = [];
    markers.forEach(box => {
        if (box.type !== 'CEO' && box.type !== 'CTO' && box.type !== 'POP') return;
        const plan = readFusionPlan(box);
        if (!plan) return;
        const key = (id) => `${ensureMarkerUid(box)}|${id}`;
        (plan.equipment || []).forEach(eq => {
            const dgo = new Map();
            eq.ports.forEach(p => {
                info.set(key(p.id), { kind: p.side === 'pon' ? 'olt-port' : 'equip-port', box });
                if (p.side === 'pon' && p.connected) sources.push({ node: key(p.id), box, olt: { olt: eq.name, placa: p.slot, pon: p.pon } });
                if (eq.kind === 'dgo') dgo.set(`${p.port}:${p.side}`, key(p.id));
            });
            if (eq.kind === 'dgo') eq.ports.filter(p => p.side === 'front').forEach(p => {
                const back = dgo.get(`${p.port}:back`);
                addEdge(key(p.id), back, cfg.lossConnector, 'dgo');
                addEdge(back, key(p.id), cfg.lossConnector, 'dgo');
            });
        });
        plan.cables.forEach(c => c.fibers.forEach(f => {
            if (!f.number) return;
            const ck = planCableKey(c, box);
            info.set(key(f.id), { kind: 'fiber', box, cable: c.name, number: f.number });
            const fk = `${ck}#${f.number}`;
            if (!fiberNodes.has(fk)) fiberNodes.set(fk, []);
            fiberNodes.get(fk).push(key(f.id));
        }));
        plan.splitters.forEach(sp => {
            const loss = getSplitterLoss(sp, cfg);
            sp.inputIds.forEach(i => {
                info.set(key(i), { kind: 'split-in', box, splitter: sp });
                //Só desce: entrada → saídas
                sp.outputIds.forEach(o => addEdge(key(i), key(o), loss, 'splitter'));
                if (sp.olt?.olt) sources.push({ node: key(i), box, splitter: sp });
            });
            sp.outputIds.forEach((o, n) => info.set(key(o), { kind: 'split-out', box, splitter: sp, port: n + 1 }));
        });
        plan.lines.forEach(l => {
            addEdge(key(l.startId), key(l.endId), cfg.lossFusion, 'fusion');
            addEdge(key(l.endId), key(l.startId), cfg.lossFusion, 'fusion');
        });
    });
    fiberNodes.forEach((nodes, fk) => {
        const ck = fk.slice(0, fk.lastIndexOf('#'));
        const cable = savedCables.find(c => c.uid === ck) || savedCables.find(c => `nome:${c.name}` === ck);
        const loss = ((Number(cable?.totalLength) || 0) / 1000) * cfg.lossPerKm;
        nodes.forEach(a => nodes.forEach(b => { if (a !== b) addEdge(a, b, loss, 'cable'); }));
    });
    //Maior potência que chega em cada nó (Dijkstra com a perda como custo)
    const power = new Map();
    const queue = [];
    sources.forEach(s => {
        const p = cfg.oltPower - cfg.lossConnector; //Conector da OLT / DIO
        if (!power.has(s.node) || power.get(s.node) < p) { power.set(s.node, p); queue.push([p, s.node]); }
    });
    while (queue.length) {
        queue.sort((a, b) => b[0] - a[0]);
        const [p, node] = queue.shift();
        if (p < power.get(node)) continue;
        const here = info.get(node);
        (edges.get(node) || []).forEach(e => {
            //Não sobe da saída para a entrada do splitter (o sinal não volta)
            if (here?.kind === 'split-out' && info.get(e.to)?.kind === 'split-in' && info.get(e.to).splitter === here.splitter) return;
            const np = p - e.loss;
            if (!power.has(e.to) || np > power.get(e.to) + 1e-9) {
                power.set(e.to, np);
                queue.push([np, e.to]);
            }
        });
    }
    return { power, info, sources };
}

function classifyOpticalPower(dbm, cfg = lancamentoConfig?.optical || DEFAULT_OPTICAL_CONFIG) {
    if (dbm == null) return 'sem';
    if (dbm < cfg.onuSensitivity) return 'erro';
    if (dbm < cfg.onuSensitivity + cfg.margin) return 'aviso';
    return 'ok';
}

//Potência nas portas de atendimento de cada CTO e no cliente (drop + conector da ONU)
function getOpticalBudgetByCto(scopeMarkers) {
    const cfg = lancamentoConfig?.optical || DEFAULT_OPTICAL_CONFIG;
    const { power, info } = computeOpticalPower(cfg);
    const result = new Map();
    power.forEach((dbm, node) => {
        const i = info.get(node);
        if (i?.kind !== 'split-out' || !i.splitter.atendimento || i.box.type !== 'CTO') return;
        if (scopeMarkers && !scopeMarkers.includes(i.box)) return;
        const atPort = dbm - cfg.lossConnector; //Adaptador da porta da CTO
        const cur = result.get(i.box);
        if (!cur || atPort < cur.worstPort) result.set(i.box, { cto: i.box, worstPort: atPort, bestPort: Math.max(cur?.bestPort ?? -Infinity, atPort) });
        else cur.bestPort = Math.max(cur.bestPort, atPort);
    });
    result.forEach(entry => {
        entry.clients = (typeof getCtoClients === 'function' ? getCtoClients(entry.cto) : []).map(client => {
            const drop = typeof getClientDropInfo === 'function' ? getClientDropInfo(client) : null;
            const dbm = entry.worstPort - ((drop?.length || 0) / 1000) * cfg.lossPerKm - cfg.lossConnector;
            return { client, dbm, status: classifyOpticalPower(dbm, cfg) };
        });
        entry.status = classifyOpticalPower(entry.worstPort, cfg);
    });
    return result;
}

function formatDbm(v) {
    return v == null ? '—' : `${v.toFixed(1).replace('.', ',')} dBm`;
}
