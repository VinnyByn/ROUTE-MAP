// Rota do cabo: segue as fusões dos planos de fusão de caixa em caixa e destaca no mapa por onde
// cada fibra passa. Duas visões, à escolha do usuário: todas as fibras em uso do cabo de uma vez, ou
// uma fibra com o caminho passo a passo. Depende de script.js, js/fusion-plan.js, js/fusion.js
// (getFiberColor) e js/clients.js (getCtoClients).

let cableRouteState = null; //{ cable, mode: 'all' | 'one', fiber, overlays: [], dimmed: Map }

// ---------------------------------------------------------------
// Grafo das fibras: nós são portas (fibras e portas de splitter) de cada caixa
// ---------------------------------------------------------------

function buildFiberGraph() {
    const adj = new Map();
    const info = new Map();
    const fiberNodes = new Map(); //"cabo#fibra" → nós dessa fibra nas caixas
    const link = (a, b) => {
        if (!a || !b || a === b) return;
        if (!adj.has(a)) adj.set(a, new Set());
        if (!adj.has(b)) adj.set(b, new Set());
        adj.get(a).add(b);
        adj.get(b).add(a);
    };
    markers.forEach(box => {
        if (box.type !== 'CEO' && box.type !== 'CTO' && box.type !== 'POP') return;
        const plan = readFusionPlan(box);
        if (!plan) return;
        const key = (id) => `${ensureMarkerUid(box)}|${id}`;
        //POP: porta PON da OLT é a origem; no DGO, o lado do cordão e o da fusão são a mesma porta
        (plan.equipment || []).forEach(eq => {
            const dgo = new Map();
            eq.ports.forEach(p => {
                if (p.side === 'pon') info.set(key(p.id), { kind: 'olt-port', box, olt: { olt: eq.name, placa: p.slot, pon: p.pon } });
                else info.set(key(p.id), { kind: 'equip-port', box, equipment: eq, port: p });
                if (eq.kind === 'dgo') dgo.set(`${p.port}:${p.side}`, key(p.id));
            });
            if (eq.kind === 'dgo') eq.ports.filter(p => p.side === 'front').forEach(p => link(key(p.id), dgo.get(`${p.port}:back`)));
        });
        plan.cables.forEach(cable => cable.fibers.forEach(f => {
            if (!f.number) return;
            const k = key(f.id);
            info.set(k, { kind: 'fiber', box, cable: cable.name, number: f.number });
            const fk = `${cable.name}#${f.number}`;
            if (!fiberNodes.has(fk)) fiberNodes.set(fk, []);
            fiberNodes.get(fk).push(k);
        }));
        plan.splitters.forEach(sp => {
            const ins = sp.inputIds.map(key);
            const outs = sp.outputIds.map(key);
            ins.forEach(k => info.set(k, { kind: 'split-in', box, splitter: sp }));
            outs.forEach((k, i) => info.set(k, { kind: 'split-out', box, splitter: sp, port: i + 1 }));
            ins.forEach(i => outs.forEach(o => link(i, o)));
        });
        plan.lines.forEach(l => link(key(l.startId), key(l.endId)));
    });
    //A mesma fibra do cabo nas duas pontas (caixas diferentes) é um caminho só
    fiberNodes.forEach(nodes => nodes.slice(1).forEach(k => link(nodes[0], k)));
    return { adj, info, fiberNodes };
}

//Percorre a partir de uma fibra do cabo. Entrando num splitter por uma saída, segue só para a entrada
//(não espalha para os outros clientes do mesmo splitter)
function traceFiberRoute(graph, cableName, fiberNumber) {
    return traceRouteFromNodes(graph, graph.fiberNodes.get(`${cableName}#${fiberNumber}`) || [], { cable: cableName, number: fiberNumber });
}

//A partir de uma porta qualquer (ex.: PON da OLT no plano do POP)
function traceFromNode(graph, nodeKey) {
    return traceRouteFromNodes(graph, graph.info.has(nodeKey) ? [nodeKey] : [], null);
}

function traceRouteFromNodes(graph, start, first) {
    const segments = new Map(first ? [[`${first.cable}#${first.number}`, first]] : []);
    const steps = [];
    const visited = new Set();
    const queue = start.map(k => [k, null]);
    start.forEach(k => visited.add(k));
    while (queue.length) {
        const [node, from] = queue.shift();
        const here = graph.info.get(node);
        const prev = from ? graph.info.get(from) : null;
        if (here?.kind === 'fiber') segments.set(`${here.cable}#${here.number}`, { cable: here.cable, number: here.number });
        //Passos = fusões dentro da caixa (não a ligação interna do splitter)
        const internal = prev?.splitter && here?.splitter && prev.splitter === here.splitter;
        if (prev && here && prev.box === here.box && !internal) steps.push({ box: here.box, from: prev, to: here });
        (graph.adj.get(node) || []).forEach(next => {
            if (visited.has(next)) return;
            const n = graph.info.get(next);
            //Subindo por uma saída do MESMO splitter até a entrada: não desce pelas outras saídas dele.
            //(Splitter em cascata — saída de um ligada na entrada de outro — segue normalmente)
            if (here?.kind === 'split-in' && prev?.kind === 'split-out' && prev.splitter === here.splitter && n?.kind === 'split-out' && n.splitter === here.splitter) return;
            visited.add(next);
            queue.push([next, node]);
        });
    }
    //Splitters alcançados: OLT (origem) e atendimento (clientes da CTO)
    const splitters = new Map();
    visited.forEach(k => {
        const i = graph.info.get(k);
        if (i?.splitter) splitters.set(`${ensureMarkerUid(i.box)}|${i.splitter.id}`, { box: i.box, splitter: i.splitter });
    });
    const splitterList = Array.from(splitters.values());
    const olts = splitterList.filter(s => s.splitter.olt?.olt);
    //OLT encontrada pelo caminho (porta PON ligada no plano do POP)
    visited.forEach(k => {
        const i = graph.info.get(k);
        if (i?.kind === 'olt-port') olts.push({ box: i.box, splitter: { label: '', olt: i.olt } });
    });
    const ctos = new Map();
    splitterList.filter(s => s.splitter.atendimento && s.box.type === 'CTO').forEach(s => {
        if (!ctos.has(s.box)) ctos.set(s.box, { box: s.box, splitters: [], clients: getCtoClients(s.box).length });
        ctos.get(s.box).splitters.push(s.splitter.label);
    });
    //Cliente B2B ligado direto numa fibra do caminho
    const b2b = markers.filter(m => m.type === 'CLIENTE' && m.client?.cableName && segments.has(`${m.client.cableName}#${Number(m.client.cableFiber)}`));
    return { segments: Array.from(segments.values()), steps, olts, ctos: Array.from(ctos.values()), b2b };
}

function getCableFiberTotal(cable) {
    const type = getFiberType(cable?.type);
    return type ? parseInt(type.split('-')[1], 10) : 12;
}

// ---------------------------------------------------------------
// Destaque no mapa
// ---------------------------------------------------------------

function clearCableRouteHighlight() {
    if (!cableRouteState) return;
    cableRouteState.overlays.forEach(o => o.setMap(null));
    cableRouteState.overlays = [];
    cableRouteState.dimmed.forEach((opacity, cable) => cable.polyline?.setOptions({ strokeOpacity: opacity }));
    cableRouteState.dimmed.clear();
}

function drawCableRouteHighlight(traces) {
    clearCableRouteHighlight();
    const bounds = new google.maps.LatLngBounds();
    savedCables.forEach(cable => {
        if (!cable.polyline) return;
        cableRouteState.dimmed.set(cable, cable.polyline.get('strokeOpacity') ?? 1);
        cable.polyline.setOptions({ strokeOpacity: 0.25 });
    });
    traces.forEach(({ trace, number }) => {
        trace.segments.forEach(seg => {
            const cable = savedCables.find(c => c.name === seg.cable);
            if (!cable?.path?.length || !cable.polyline?.getVisible()) return;
            const line = new google.maps.Polyline({
                path: cable.path,
                map,
                clickable: false,
                strokeColor: getFiberColor(number),
                strokeOpacity: 1,
                strokeWeight: (cable.width || 4) + 4,
                zIndex: 300,
            });
            cableRouteState.overlays.push(line);
            cable.path.forEach(p => bounds.extend(p));
        });
    });
    if (!bounds.isEmpty()) map.fitBounds(bounds, { top: 56, right: 340, bottom: 56, left: getMapFocusPadding() });
}

// ---------------------------------------------------------------
// Painel
// ---------------------------------------------------------------

function describeRoutePort(p) {
    if (p.kind === 'fiber') return `${escapeHtml(p.cable)} F${p.number}`;
    if (p.kind === 'olt-port') return `${escapeHtml(p.olt.olt)} placa ${escapeHtml(p.olt.placa)} PON ${escapeHtml(p.olt.pon)}`;
    if (p.kind === 'equip-port') return `${escapeHtml(p.equipment.name)} porta ${escapeHtml(p.port.port)}${p.port.side === 'front' ? ' (cordão)' : ''}`;
    if (p.kind === 'split-in') return `splitter ${escapeHtml(p.splitter.label)} (entrada)`;
    return `splitter ${escapeHtml(p.splitter.label)} porta ${p.port}`;
}

function describeRouteEnds(trace) {
    const parts = trace.ctos.map(c => `${escapeHtml(c.box.name)} · ${c.clients} cliente${c.clients === 1 ? '' : 's'}`);
    trace.b2b.forEach(m => parts.push(`${escapeHtml(m.name)} (B2B)`));
    return parts.join(' · ');
}

function renderCableRouteBox() {
    const { cable, mode, fiber } = cableRouteState;
    const box = document.getElementById('cableRouteBox');
    const total = getCableFiberTotal(cable);
    const usage = getCableFiberUsage(cable);
    const used = new Set(usage.used);
    const graph = buildFiberGraph();
    document.getElementById('cableRouteTitle').textContent = `Rota · ${cable.name}`;
    document.getElementById('cableRouteSubtitle').textContent = `${usage.used.length} de ${total} fibras em uso`;
    box.querySelectorAll('[data-route-mode]').forEach(b => b.classList.toggle('is-active', b.dataset.routeMode === mode));
    const body = document.getElementById('cableRouteBody');

    if (mode === 'all') {
        const traces = usage.used.map(number => ({ number, trace: traceFiberRoute(graph, cable.name, number) }));
        drawCableRouteHighlight(traces);
        body.innerHTML = traces.length
            ? `<ul class="route-legend">${traces.map(({ number, trace }) => `
                <li><button type="button" data-route-fiber="${number}">
                    <i style="--fiber:${getFiberColor(number)}"></i><b>F${number}</b>
                    <span>${describeRouteEnds(trace) || (trace.segments.length > 1 ? `chega até ${escapeHtml(trace.segments[trace.segments.length - 1].cable)} (sem splitter de atendimento)` : 'sem fusão nas caixas')}</span>
                </button></li>`).join('')}</ul>
                ${usage.free.length ? `<p class="route-note">Livres: ${formatFiberRanges(usage.free)}</p>` : ''}
                <p class="route-note">Clique numa fibra para ver o caminho dela passo a passo.</p>`
            : '<p class="route-note">Nenhuma fibra deste cabo tem fusão nos planos de fusão.</p>';
        return;
    }

    const chips = [];
    for (let n = 1; n <= total; n++) {
        chips.push(`<button type="button" class="route-chip${n === fiber ? ' is-active' : ''}${used.has(n) ? '' : ' is-free'}" data-route-fiber="${n}" style="--fiber:${getFiberColor(n)}" title="Fibra ${n}${used.has(n) ? '' : ' (livre)'}">${n}</button>`);
    }
    let html = `<div class="route-chips">${chips.join('')}</div>`;
    if (!fiber) {
        clearCableRouteHighlight();
        body.innerHTML = html + '<p class="route-note">Escolha uma fibra.</p>';
        return;
    }
    const trace = traceFiberRoute(graph, cable.name, fiber);
    drawCableRouteHighlight([{ number: fiber, trace }]);
    const items = [];
    trace.olts.forEach(o => items.push(`<li><i style="--fiber:#64748b"></i><span><b>${escapeHtml(formatSplitterOltSummary(o.splitter.olt.olt, o.splitter.olt.placa, o.splitter.olt.pon))}</b> · em ${escapeHtml(o.box.name)}</span></li>`));
    trace.segments.forEach(seg => {
        const c = savedCables.find(x => x.name === seg.cable);
        items.push(`<li><i style="--fiber:${getFiberColor(seg.number)}"></i><span><b>${escapeHtml(seg.cable)}</b> F${seg.number}${c?.totalLength ? ` · ${c.totalLength} m` : ''}</span></li>`);
    });
    trace.steps.forEach(st => items.push(`<li><i class="is-box"></i><span><b>${escapeHtml(st.box.name)}</b> · ${describeRoutePort(st.from)} → ${describeRoutePort(st.to)}</span></li>`));
    trace.ctos.forEach(c => items.push(`<li><i style="--fiber:#22c55e"></i><span><b>${escapeHtml(c.box.name)}</b> · splitter ${escapeHtml(c.splitters.join(', '))} · ${c.clients} cliente${c.clients === 1 ? '' : 's'}</span></li>`));
    trace.b2b.forEach(m => items.push(`<li><i style="--fiber:#22c55e"></i><span><b>${escapeHtml(m.name)}</b> · cliente B2B</span></li>`));
    html += `<ul class="route-steps">${items.join('')}</ul>`;
    if (!trace.steps.length) html += '<p class="route-note">Esta fibra não tem fusão nos planos das caixas: a rota fica só neste cabo.</p>';
    body.innerHTML = html;
}

function showCableRoute(cable, { mode, fiber } = {}) {
    if (!cable) return;
    if (!cableRouteState) cableRouteState = { overlays: [], dimmed: new Map(), mode: 'all', fiber: null };
    if (cableRouteState.cable !== cable) cableRouteState.fiber = null;
    cableRouteState.cable = cable;
    if (mode) cableRouteState.mode = mode;
    if (fiber !== undefined) cableRouteState.fiber = fiber;
    document.getElementById('cableRouteBox').classList.remove('hidden');
    renderCableRouteBox();
}

function isCableRouteOpen() {
    return !!cableRouteState && !document.getElementById('cableRouteBox').classList.contains('hidden');
}

function closeCableRoute() {
    clearCableRouteHighlight();
    cableRouteState = null;
    document.getElementById('cableRouteBox').classList.add('hidden');
}

function setupCableRouteBox() {
    const box = document.getElementById('cableRouteBox');
    if (!box) return;
    document.getElementById('closeCableRouteBox').addEventListener('click', closeCableRoute);
    document.getElementById('clearCableRouteButton').addEventListener('click', closeCableRoute);
    box.addEventListener('click', (e) => {
        const modeButton = e.target.closest('[data-route-mode]');
        if (modeButton && cableRouteState) {
            showCableRoute(cableRouteState.cable, { mode: modeButton.dataset.routeMode });
            return;
        }
        const fiberButton = e.target.closest('[data-route-fiber]');
        if (fiberButton && cableRouteState) {
            showCableRoute(cableRouteState.cable, { mode: 'one', fiber: Number(fiberButton.dataset.routeFiber) });
        }
    });
}

document.addEventListener('DOMContentLoaded', setupCableRouteBox);
