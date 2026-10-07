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
    const addEdge = (a, b, loss, kind, cuts = null) => {
        if (!edges.has(a)) edges.set(a, []);
        edges.get(a).push({ to: b, loss, kind, cuts });
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
    //Reserva técnica: a fibra passa direto de um cabo para o outro, sem perda de fusão
    getReservePassThroughs().forEach(({ box, cables }) => {
        const total = Math.min(...cables.map(getCableFiberTotalForPassThrough));
        for (let n = 1; n <= total; n++) {
            const keys = cables.map(c => {
                const ck = cableKeyOf(c);
                const k = `${box.uid}|pass|${ck}#${n}`;
                info.set(k, { kind: 'fiber', box, cable: c.name, number: n });
                const fk = `${ck}#${n}`;
                if (!fiberNodes.has(fk)) fiberNodes.set(fk, []);
                fiberNodes.get(fk).push(k);
                return k;
            });
            const cuts = cables.map(cableKeyOf);
            keys.forEach(a => keys.forEach(b => { if (a !== b) addEdge(a, b, 0, 'reserva', cuts); }));
        }
    });
    fiberNodes.forEach((nodes, fk) => {
        const ck = fk.slice(0, fk.lastIndexOf('#'));
        const cable = savedCables.find(c => c.uid === ck) || savedCables.find(c => `nome:${c.name}` === ck);
        const loss = ((Number(cable?.totalLength) || 0) / 1000) * cfg.lossPerKm;
        nodes.forEach(a => nodes.forEach(b => { if (a !== b) addEdge(a, b, loss, 'cable', [ck]); }));
    });
    //Maior potência que chega em cada nó (Dijkstra com a perda como custo). "cut" simula falhas:
    //{ cables: Set(chave do cabo), boxes: Set(uid da caixa) } — nada passa por esses cabos e caixas.
    const propagate = (seedNodes, cut = null) => {
        const power = new Map();
        const heap = [];
        const push = (item) => {
            heap.push(item);
            let i = heap.length - 1;
            while (i > 0) {
                const parent = (i - 1) >> 1;
                if (heap[parent][0] >= heap[i][0]) break;
                [heap[parent], heap[i]] = [heap[i], heap[parent]];
                i = parent;
            }
        };
        const pop = () => {
            const top = heap[0];
            const last = heap.pop();
            if (heap.length) {
                heap[0] = last;
                let i = 0;
                for (;;) {
                    const l = 2 * i + 1, r = l + 1;
                    let m = i;
                    if (l < heap.length && heap[l][0] > heap[m][0]) m = l;
                    if (r < heap.length && heap[r][0] > heap[m][0]) m = r;
                    if (m === i) break;
                    [heap[m], heap[i]] = [heap[i], heap[m]];
                    i = m;
                }
            }
            return top;
        };
        const cutBox = (node) => !!cut?.boxes?.size && cut.boxes.has(node.slice(0, node.indexOf('|')));
        const p0 = cfg.oltPower - cfg.lossConnector; //Conector da OLT / DIO
        seedNodes.forEach(node => {
            if (cutBox(node)) return;
            if (!power.has(node) || power.get(node) < p0) { power.set(node, p0); push([p0, node]); }
        });
        while (heap.length) {
            const [p, node] = pop();
            if (p < power.get(node)) continue;
            const here = info.get(node);
            (edges.get(node) || []).forEach(e => {
                if (cut) {
                    if (e.cuts && cut.cables?.size && e.cuts.some(k => cut.cables.has(k))) return;
                    if (cutBox(e.to)) return;
                }
                //Não sobe da saída para a entrada do splitter (o sinal não volta)
                if (here?.kind === 'split-out' && info.get(e.to)?.kind === 'split-in' && info.get(e.to).splitter === here.splitter) return;
                const np = p - e.loss;
                if (!power.has(e.to) || np > power.get(e.to) + 1e-9) {
                    power.set(e.to, np);
                    push([np, e.to]);
                }
            });
        }
        return power;
    };
    //1º: PONs ligadas no plano do POP. O sinal desce pelas fusões, cabos e splitters, perdendo em cada um.
    const seeds = sources.filter(s => !s.splitter).map(s => s.node);
    const firstPass = propagate(seeds);
    //2º: splitter com OLT/PON preenchida que não recebe sinal de nenhuma PON (rede sem POP desenhado).
    //Um splitter que já recebe sinal pelo caminho não vira origem (senão começaria de novo com a potência da OLT).
    //Splitter em cascata abaixo de outro que também vira origem não conta como origem.
    const fallback = sources.filter(s => s.splitter && !firstPass.has(s.node));
    const downstream = new Set();
    fallback.forEach(src => {
        const seen = new Set([src.node]);
        const stack = [src.node];
        while (stack.length) {
            const node = stack.pop();
            const here = info.get(node);
            (edges.get(node) || []).forEach(e => {
                if (seen.has(e.to)) return;
                if (here?.kind === 'split-out' && info.get(e.to)?.kind === 'split-in' && info.get(e.to).splitter === here.splitter) return;
                seen.add(e.to);
                stack.push(e.to);
            });
        }
        fallback.forEach(o => { if (o !== src && seen.has(o.node)) downstream.add(o.node); });
    });
    fallback.filter(s => !downstream.has(s.node)).forEach(s => seeds.push(s.node));
    const power = fallback.length ? propagate(seeds) : firstPass;
    //simulate(cut): mesma rede e mesmas origens, sem os cabos/caixas cortados (análise de impacto)
    const simulate = (cut) => propagate(seeds, cut);
    return { power, info, sources, simulate };
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

//Potência em cada elemento (fibra, porta de splitter, porta de equipamento) de uma caixa: Map(id do elemento → dBm)
function getBoxOpticalPower(box, computed = null) {
    const { power } = computed || computeOpticalPower();
    const prefix = `${ensureMarkerUid(box)}|`;
    const result = new Map();
    power.forEach((dbm, node) => {
        if (node.startsWith(prefix) && !node.startsWith(`${prefix}pass|`)) result.set(node.slice(prefix.length), dbm);
    });
    return result;
}

//Resumo do sinal da caixa para o cartão do mapa: entrada de cada splitter e portas de atendimento
function getBoxSignalSummary(box) {
    const plan = readFusionPlan(box);
    if (!plan || plan.empty) return null;
    const cfg = lancamentoConfig?.optical || DEFAULT_OPTICAL_CONFIG;
    const byId = getBoxOpticalPower(box);
    if (!byId.size) return { reached: false };
    const splitters = plan.splitters.map(sp => {
        const ins = sp.inputIds.map(id => byId.get(id)).filter(v => v != null);
        return { label: sp.label || 'Splitter', atendimento: sp.atendimento, input: ins.length ? Math.max(...ins) : null };
    });
    const ports = [];
    plan.splitters.filter(sp => sp.atendimento).forEach(sp => sp.outputIds.forEach(id => {
        if (byId.has(id)) ports.push(byId.get(id) - cfg.lossConnector); //Adaptador da porta da CTO
    }));
    const fibers = plan.cables.flatMap(c => c.fibers).map(f => byId.get(f.id)).filter(v => v != null);
    return {
        reached: true,
        splitters,
        worstPort: ports.length ? Math.min(...ports) : null,
        bestPort: ports.length ? Math.max(...ports) : null,
        fibers: fibers.length,
        bestFiber: fibers.length ? Math.max(...fibers) : null,
    };
}

//Plano de fusão aberto: mostra a potência ao lado de cada porta com sinal (vale o que está na tela)
function decorateFusionSignal() {
    const box = activeMarkerForFusion;
    const stage = getFusionStage?.();
    if (!box || !stage) return;
    stage.querySelectorAll('.fx-port__signal').forEach(n => n.remove());
    const saved = box.fusionPlan;
    let byId;
    try {
        box.fusionPlan = serializeFusionPlan();
        byId = getBoxOpticalPower(box);
    } catch (e) {
        console.error('Plano de fusão: não foi possível calcular o sinal', e);
        return;
    } finally {
        box.fusionPlan = saved;
    }
    const cfg = lancamentoConfig?.optical || DEFAULT_OPTICAL_CONFIG;
    byId.forEach((dbm, id) => {
        const row = document.getElementById(id);
        if (!row || !stage.contains(row)) return;
        const isFiber = row.classList.contains('fiber-row');
        if (isFiber && !row.classList.contains('is-connected')) return; //Fibra solta: não polui a lista
        const atendimento = row.closest('.splitter-atendimento') && row.closest('.splitter-outputs');
        const value = atendimento ? dbm - cfg.lossConnector : dbm;
        const badge = document.createElement('span');
        badge.className = `fx-port__signal is-${classifyOpticalPower(value, cfg)}`;
        badge.textContent = formatDbm(value).replace(' dBm', '');
        badge.title = `Sinal estimado: ${formatDbm(value)}${atendimento ? ' na porta de atendimento' : ''}`;
        const dot = row.querySelector('.fx-port__dot');
        row.insertBefore(badge, dot || null);
    });
}
