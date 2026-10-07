// Redundância e análise de impacto: encontra cabos e caixas sem rota alternativa (pontos únicos de falha),
// separa o que está em anel do que é só ponta a ponta, e simula "o que cai se este cabo ou caixa parar".
// A simulação refaz o cálculo de sinal (js/optical-budget.js) sem o cabo ou a caixa cortados.
// Depende de script.js, js/fusion-plan.js, js/clients.js e js/optical-budget.js.

const IMPACT_BOX_TYPES = ['CEO', 'CTO', 'POP', 'RESERVA'];
const IMPACT_DEGRADE_DB = 0.3; //Queda menor que isso não conta como sinal pior

// ---------------------------------------------------------------
// Topologia: caixas ligadas por cabos
// ---------------------------------------------------------------
function buildNetworkTopology(scope) {
    const nodes = new Map(); //uid → caixa
    scope.markers.filter(m => IMPACT_BOX_TYPES.includes(m.type)).forEach(box => nodes.set(ensureMarkerUid(box), box));
    const edges = [];
    scope.cables.forEach(cable => {
        const a = cable.startAnchorUid;
        const b = cable.endAnchorUid;
        if (!a || !b || a === b || !nodes.has(a) || !nodes.has(b)) return;
        edges.push({ id: edges.length, cable, a, b });
    });
    return { nodes, edges };
}

//Pontes (cabos cuja falta desliga a rede em duas partes), caixas de articulação e componentes conexos.
//Busca em profundidade sem recursão, para redes grandes.
function analyzeNetworkTopology(topo) {
    const adj = new Map();
    topo.nodes.forEach((_, uid) => adj.set(uid, []));
    topo.edges.forEach(e => { adj.get(e.a).push({ to: e.b, id: e.id }); adj.get(e.b).push({ to: e.a, id: e.id }); });
    const disc = new Map();
    const low = new Map();
    const component = new Map();
    const bridges = new Set();
    const articulation = new Set();
    let clock = 0;
    let componentCount = 0;
    adj.forEach((_, root) => {
        if (disc.has(root)) return;
        const comp = componentCount++;
        disc.set(root, clock); low.set(root, clock); clock++;
        component.set(root, comp);
        let rootChildren = 0;
        const stack = [{ v: root, via: -1, i: 0 }];
        while (stack.length) {
            const frame = stack[stack.length - 1];
            const list = adj.get(frame.v);
            if (frame.i < list.length) {
                const { to, id } = list[frame.i++];
                if (id === frame.via) continue;
                if (disc.has(to)) {
                    low.set(frame.v, Math.min(low.get(frame.v), disc.get(to)));
                } else {
                    disc.set(to, clock); low.set(to, clock); clock++;
                    component.set(to, comp);
                    stack.push({ v: to, via: id, i: 0 });
                }
                continue;
            }
            stack.pop();
            if (!stack.length) break;
            const parent = stack[stack.length - 1].v;
            low.set(parent, Math.min(low.get(parent), low.get(frame.v)));
            if (low.get(frame.v) > disc.get(parent)) bridges.add(frame.via);
            if (parent === root) rootChildren++;
            else if (low.get(frame.v) >= disc.get(parent)) articulation.add(parent);
        }
        if (rootChildren > 1) articulation.add(root);
    });
    //Anéis: partes ligadas sem usar as pontes (cada uma com 2 ou mais caixas e um ciclo)
    const ringOf = new Map();
    const rings = [];
    adj.forEach((_, start) => {
        if (ringOf.has(start)) return;
        const members = [start];
        ringOf.set(start, rings.length);
        for (let k = 0; k < members.length; k++) {
            adj.get(members[k]).forEach(({ to, id }) => {
                if (bridges.has(id) || ringOf.has(to)) return;
                ringOf.set(to, rings.length);
                members.push(to);
            });
        }
        rings.push(members);
    });
    const ringEdges = topo.edges.filter(e => !bridges.has(e.id));
    const realRings = rings.map((members, index) => ({
        index,
        boxes: members.map(uid => topo.nodes.get(uid)),
        cables: ringEdges.filter(e => ringOf.get(e.a) === index).map(e => e.cable),
    })).filter(r => r.cables.length >= 2);
    return { bridges, articulation, component, componentCount, rings: realRings };
}

//Duas partes da rede que ficam separadas quando o cabo "bridgeEdge" cai: { sideA:Set(uid), sideB:Set(uid) }
function getBridgeSides(topo, bridgeEdge) {
    const adj = new Map();
    topo.edges.forEach(e => {
        if (e.id === bridgeEdge.id) return;
        if (!adj.has(e.a)) adj.set(e.a, []);
        if (!adj.has(e.b)) adj.set(e.b, []);
        adj.get(e.a).push(e.b);
        adj.get(e.b).push(e.a);
    });
    const walk = (start) => {
        const seen = new Set([start]);
        const stack = [start];
        while (stack.length) (adj.get(stack.pop()) || []).forEach(n => { if (!seen.has(n)) { seen.add(n); stack.push(n); } });
        return seen;
    };
    return { sideA: walk(bridgeEdge.a), sideB: walk(bridgeEdge.b) };
}

//Sugere o cabo novo mais curto que fecha um anel em volta do cabo "bridgeEdge"
function suggestRingClosure(topo, bridgeEdge) {
    const { sideA, sideB } = getBridgeSides(topo, bridgeEdge);
    const spherical = google.maps.geometry.spherical;
    let best = null;
    sideA.forEach(a => sideB.forEach(b => {
        if (a === bridgeEdge.a && b === bridgeEdge.b) return; //Seria o mesmo trecho do cabo atual
        const pa = topo.nodes.get(a)?.marker?.getPosition?.();
        const pb = topo.nodes.get(b)?.marker?.getPosition?.();
        if (!pa || !pb) return;
        const meters = spherical.computeDistanceBetween(pa, pb);
        if (!best || meters < best.meters) best = { from: topo.nodes.get(a), to: topo.nodes.get(b), meters };
    }));
    return best;
}

// ---------------------------------------------------------------
// Impacto: o que perde sinal quando um cabo ou uma caixa cai
// ---------------------------------------------------------------
function buildImpactModel(scope) {
    const cfg = lancamentoConfig?.optical || DEFAULT_OPTICAL_CONFIG;
    const graph = computeOpticalPower(cfg);
    const inScope = new Set(scope.markers);
    const ctoNodes = new Map(); //CTO → nós das portas de atendimento
    graph.info.forEach((i, node) => {
        if (i.kind !== 'split-out' || !i.splitter.atendimento || i.box.type !== 'CTO' || !inScope.has(i.box)) return;
        if (!ctoNodes.has(i.box)) ctoNodes.set(i.box, []);
        ctoNodes.get(i.box).push(node);
    });
    const worstPort = (power, nodes) => {
        let worst = null;
        nodes.forEach(node => {
            const dbm = power.get(node);
            if (dbm == null) return;
            const atPort = dbm - cfg.lossConnector;
            if (worst == null || atPort < worst) worst = atPort;
        });
        return worst;
    };
    const base = new Map(); //CTO com sinal hoje → pior porta
    ctoNodes.forEach((nodes, cto) => {
        const dbm = worstPort(graph.power, nodes);
        if (dbm != null) base.set(cto, dbm);
    });
    return { cfg, graph, ctoNodes, base, worstPort };
}

//Resultado de um corte: CTOs que ficam sem sinal, CTOs com sinal pior e clientes afetados
function analyzeNetworkCut(model, cut, ignoreBox = null) {
    const power = model.graph.simulate(cut);
    const lost = [];
    const degraded = [];
    model.base.forEach((before, cto) => {
        if (cto === ignoreBox) return;
        const after = model.worstPort(power, model.ctoNodes.get(cto));
        const clients = typeof getCtoClients === 'function' ? getCtoClients(cto).length : 0;
        if (after == null) lost.push({ cto, clients, before });
        else if (after < before - IMPACT_DEGRADE_DB) {
            degraded.push({ cto, clients, before, after, status: classifyOpticalPower(after, model.cfg) });
        }
    });
    const clientsLost = lost.reduce((n, l) => n + l.clients, 0);
    const clientsBelowMin = degraded.filter(d => d.status === 'erro').reduce((n, d) => n + d.clients, 0);
    return { lost, degraded, clientsLost, clientsBelowMin };
}

function networkCutFor(target) {
    return target.kind === 'cable'
        ? { cables: new Set([cableKeyOf(target.cable)]) }
        : { boxes: new Set([ensureMarkerUid(target.box)]) };
}

function impactScore(result) {
    return result.clientsLost * 1000 + result.lost.length * 10 + result.clientsBelowMin * 5 + result.degraded.length;
}

//Roda todos os cortes possíveis do projeto (um cabo ou uma caixa de cada vez), devolvendo em partes
//para a tela não travar. Retorna as linhas com impacto, da pior para a menor.
async function runNetworkImpact(scope, onProgress, isCancelled = () => false) {
    const topo = buildNetworkTopology(scope);
    const structure = analyzeNetworkTopology(topo);
    const model = buildImpactModel(scope);
    const edgeByCable = new Map(topo.edges.map(e => [e.cable, e]));
    const targets = [
        ...scope.cables.map(cable => ({ kind: 'cable', cable, name: cable.name })),
        ...scope.markers.filter(m => IMPACT_BOX_TYPES.includes(m.type)).map(box => ({ kind: 'box', box, name: box.name })),
    ];
    const rows = [];
    for (let i = 0; i < targets.length; i++) {
        if (isCancelled()) return null;
        const target = targets[i];
        const result = analyzeNetworkCut(model, networkCutFor(target), target.kind === 'box' ? target.box : null);
        if (impactScore(result) > 0) {
            const edge = target.kind === 'cable' ? edgeByCable.get(target.cable) : null;
            rows.push({
                ...target,
                result,
                edge,
                //Cabo sem alternativa física, ou caixa que separa a rede em partes
                single: target.kind === 'cable' ? (!edge || structure.bridges.has(edge.id)) : structure.articulation.has(ensureMarkerUid(target.box)),
            });
        }
        if (i % 6 === 5) {
            onProgress?.(i + 1, targets.length);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    rows.sort((a, b) => impactScore(b.result) - impactScore(a.result));
    return { topo, structure, model, rows, total: targets.length, baseCtos: model.base.size };
}

// ---------------------------------------------------------------
// Tela
// ---------------------------------------------------------------
let networkImpactState = null;
let networkImpactRun = 0;
let impactOverlays = [];

function clearImpactOverlays() {
    impactOverlays.forEach(o => o.setMap?.(null));
    impactOverlays = [];
}

function addImpactCircle(markerInfo, color) {
    const position = markerInfo?.marker?.getPosition?.();
    if (!position || typeof map === 'undefined' || !map) return;
    impactOverlays.push(new google.maps.Marker({
        position, map, clickable: false, optimized: false, zIndex: google.maps.Marker.MAX_ZINDEX - 2,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 15, fillColor: color, fillOpacity: 0.22, strokeColor: color, strokeOpacity: 1, strokeWeight: 3 },
    }));
}

//Mostra no mapa: o que caiu (vermelho), o que fica com sinal pior (âmbar) e o próprio corte
function showImpactOnMap(row) {
    clearImpactOverlays();
    if (typeof map === 'undefined' || !map) return;
    const bounds = new google.maps.LatLngBounds();
    const extend = (markerInfo) => { const p = markerInfo?.marker?.getPosition?.(); if (p) bounds.extend(p); };
    if (row.kind === 'cable') {
        const cable = row.cable;
        impactOverlays.push(new google.maps.Polyline({
            path: cable.path, map, clickable: false, zIndex: google.maps.Marker.MAX_ZINDEX - 3,
            strokeColor: '#ef4444', strokeOpacity: 0.85, strokeWeight: (cable.width || 4) + 6,
        }));
        (cable.path || []).forEach(p => bounds.extend(p));
    } else {
        addImpactCircle(row.box, '#ef4444');
        extend(row.box);
    }
    row.result.lost.forEach(l => { addImpactCircle(l.cto, '#ef4444'); extend(l.cto); });
    row.result.degraded.forEach(d => { addImpactCircle(d.cto, '#f59e0b'); extend(d.cto); });
    if (!bounds.isEmpty?.()) map.fitBounds(bounds);
}

function showRingClosureOnMap(suggestion) {
    clearImpactOverlays();
    if (!suggestion || typeof map === 'undefined' || !map) return;
    const a = suggestion.from.marker.getPosition();
    const b = suggestion.to.marker.getPosition();
    impactOverlays.push(new google.maps.Polyline({
        path: [a, b], map, clickable: false, zIndex: google.maps.Marker.MAX_ZINDEX - 3,
        strokeOpacity: 0, icons: [{ icon: { path: 'M 0,-1 0,1', strokeColor: '#16a34a', strokeOpacity: 1, scale: 4 }, offset: '0', repeat: '14px' }],
    }));
    addImpactCircle(suggestion.from, '#16a34a');
    addImpactCircle(suggestion.to, '#16a34a');
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(a);
    bounds.extend(b);
    map.fitBounds(bounds);
}

function describeImpactResult(result) {
    const parts = [];
    if (result.lost.length) parts.push(`${result.lost.length} CTO${result.lost.length === 1 ? '' : 's'} sem sinal`);
    if (result.clientsLost) parts.push(`${result.clientsLost} cliente${result.clientsLost === 1 ? '' : 's'} fora do ar`);
    if (result.degraded.length) parts.push(`${result.degraded.length} CTO${result.degraded.length === 1 ? '' : 's'} com sinal pior${result.clientsBelowMin ? ` (${result.clientsBelowMin} abaixo do mínimo)` : ''}`);
    return parts.join(' · ') || 'Sem impacto';
}

function renderImpactDetail(row) {
    const names = (list) => list.slice(0, 12).map(l => escapeHtml(l.cto.name)).join(', ') + (list.length > 12 ? ` e mais ${list.length - 12}` : '');
    const lines = [];
    if (row.result.lost.length) lines.push(`<p><b class="is-erro">Sem sinal:</b> ${names(row.result.lost)}</p>`);
    if (row.result.degraded.length) lines.push(`<p><b class="is-aviso">Sinal pior:</b> ${row.result.degraded.slice(0, 12).map(d => `${escapeHtml(d.cto.name)} (${formatDbm(d.before)} → ${formatDbm(d.after)})`).join(', ')}</p>`);
    return lines.join('');
}

function renderNetworkImpact() {
    const body = document.getElementById('networkImpactBody');
    const subtitle = document.getElementById('networkImpactSubtitle');
    const state = networkImpactState;
    if (!state) return;
    subtitle.textContent = state.projectName || '';
    if (state.error) {
        body.innerHTML = `<p class="route-note">${escapeHtml(state.error)}</p>`;
        return;
    }
    if (state.progress) {
        body.innerHTML = `<p class="route-note">Simulando falhas… ${state.progress.done} de ${state.progress.total}</p>`;
        return;
    }
    const { structure, rows, topo, baseCtos } = state.data;
    const bridgeCount = structure.bridges.size;
    const inRing = topo.edges.length - bridgeCount;
    const singles = rows.filter(r => r.single);
    const summary = `<div class="check-summary">
        <span class="${singles.length ? 'is-erro' : 'is-ok'}">${singles.length} ponto${singles.length === 1 ? '' : 's'} único${singles.length === 1 ? '' : 's'} de falha</span>
        <span class="is-ok">${inRing} cabo${inRing === 1 ? '' : 's'} em anel</span>
        <span class="${bridgeCount ? 'is-aviso' : 'is-ok'}">${bridgeCount} sem rota alternativa</span>
    </div>`;
    if (!baseCtos) {
        body.innerHTML = summary + '<p class="route-note">Nenhuma CTO recebe sinal hoje, então não há o que simular. No plano do POP, ligue a OLT à fibra do cabo (ou vincule o splitter) e verifique de novo. Os números acima mostram só a proteção física dos cabos.</p>' + renderRingsSection(structure);
        return;
    }
    const list = rows.length ? `<ul class="impact-list">${rows.map((row, index) => `
        <li class="impact-item" data-impact-index="${index}">
            <button type="button" class="impact-item__head">
                <span class="impact-item__kind">${row.kind === 'cable' ? 'Cabo' : escapeHtml(row.box.type)}</span>
                <strong>${escapeHtml(row.name)}</strong>
                <small>${escapeHtml(describeImpactResult(row.result))}</small>
                ${row.single ? '<span class="impact-tag is-erro">sem alternativa</span>' : '<span class="impact-tag is-ok">tem alternativa parcial</span>'}
            </button>
            <div class="impact-item__detail" hidden>
                ${renderImpactDetail(row)}
                <div class="impact-item__actions">
                    <button type="button" class="route-clear" data-impact-focus="${index}">Ver no mapa</button>
                    ${row.kind === 'cable' && row.edge && structure.bridges.has(row.edge.id) ? `<button type="button" class="route-clear" data-impact-ring="${index}">Sugerir anel</button>` : ''}
                </div>
                <p class="route-note" data-impact-note="${index}"></p>
            </div>
        </li>`).join('')}</ul>` : '<p class="check-ok">Nenhum cabo ou caixa derruba sozinho a rede.</p>';
    body.innerHTML = summary + `<h4 class="check-section">O que cai se parar <small>${baseCtos} CTO${baseCtos === 1 ? '' : 's'} com sinal hoje</small></h4>` + list + renderSimulatePicker(state) + renderRingsSection(structure);
}

function renderSimulatePicker(state) {
    const { topo } = state.data;
    const cables = state.scope.cables.map((c, i) => `<option value="c${i}">${escapeHtml(c.name)}</option>`).join('');
    const boxes = state.scope.markers.filter(m => IMPACT_BOX_TYPES.includes(m.type)).map((m, i) => `<option value="b${i}">${escapeHtml(m.type)} ${escapeHtml(m.name)}</option>`).join('');
    if (!cables && !boxes) return '';
    return `<h4 class="check-section">Simular um elemento</h4>
        <div class="impact-picker">
            <select id="impactPicker"><option value="">Escolha um cabo ou caixa…</option>
                ${cables ? `<optgroup label="Cabos">${cables}</optgroup>` : ''}${boxes ? `<optgroup label="Caixas">${boxes}</optgroup>` : ''}
            </select>
            <p class="route-note" id="impactPickerResult"></p>
        </div>`;
}

function renderRingsSection(structure) {
    if (!structure.rings.length) return '<h4 class="check-section">Anéis</h4><p class="route-note">Nenhum anel fechado: todos os trechos são ponta a ponta.</p>';
    return `<h4 class="check-section">Anéis <small>${structure.rings.length}</small></h4><ul class="impact-rings">${structure.rings.map((ring, i) =>
        `<li><button type="button" data-impact-ring-focus="${i}">Anel ${i + 1}: ${ring.boxes.length} caixas · ${ring.cables.length} cabos</button></li>`).join('')}</ul>`;
}

async function refreshNetworkImpact() {
    const body = document.getElementById('networkImpactBody');
    const scope = getActiveProjectScope();
    clearImpactOverlays();
    if (!scope) {
        networkImpactState = { error: 'Abra ou selecione um projeto para analisar.' };
        renderNetworkImpact();
        return;
    }
    const run = ++networkImpactRun;
    const projectName = document.querySelector(`.folder-title[data-folder-id="${CSS.escape(scope.projectId)}"]`)?.dataset.folderName || '';
    networkImpactState = { scope, projectName, progress: { done: 0, total: scope.cables.length + scope.markers.length } };
    renderNetworkImpact();
    try {
        const data = await runNetworkImpact(scope, (done, total) => {
            if (run !== networkImpactRun) return;
            networkImpactState.progress = { done, total };
            body.querySelector('.route-note') && (body.querySelector('.route-note').textContent = `Simulando falhas… ${done} de ${total}`);
        }, () => run !== networkImpactRun);
        if (!data || run !== networkImpactRun) return;
        networkImpactState = { scope, projectName, data };
    } catch (error) {
        console.error('Análise de impacto', error);
        networkImpactState = { scope, projectName, error: 'Não foi possível analisar a rede. Tente de novo.' };
    }
    renderNetworkImpact();
}

function openNetworkImpact() {
    document.getElementById('networkImpactBox').classList.remove('hidden');
    refreshNetworkImpact();
}

function closeNetworkImpact() {
    networkImpactRun++;
    document.getElementById('networkImpactBox').classList.add('hidden');
    clearImpactOverlays();
}

function setupNetworkImpact() {
    const box = document.getElementById('networkImpactBox');
    if (!box) return;
    document.getElementById('closeNetworkImpactBox').addEventListener('click', closeNetworkImpact);
    document.getElementById('rerunNetworkImpactButton').addEventListener('click', refreshNetworkImpact);
    document.getElementById('networkImpactButton')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('projectDropdown')?.classList.remove('show');
        openNetworkImpact();
    });
    box.addEventListener('click', (e) => {
        const state = networkImpactState?.data;
        if (!state) return;
        const head = e.target.closest('.impact-item__head');
        if (head) {
            const item = head.closest('.impact-item');
            const detail = item.querySelector('.impact-item__detail');
            const open = detail.hidden;
            box.querySelectorAll('.impact-item__detail').forEach(d => { d.hidden = true; });
            detail.hidden = !open;
            if (open) showImpactOnMap(state.rows[Number(item.dataset.impactIndex)]);
            else clearImpactOverlays();
            return;
        }
        const focus = e.target.closest('[data-impact-focus]');
        if (focus) return showImpactOnMap(state.rows[Number(focus.dataset.impactFocus)]);
        const ring = e.target.closest('[data-impact-ring]');
        if (ring) {
            const index = Number(ring.dataset.impactRing);
            const suggestion = suggestRingClosure(state.topo, state.rows[index].edge);
            const note = box.querySelector(`[data-impact-note="${index}"]`);
            if (!suggestion) {
                note.textContent = 'Não há outra caixa do outro lado para fechar o anel.';
                return;
            }
            note.textContent = `Ligue ${suggestion.from.name} a ${suggestion.to.name} (cerca de ${Math.round(suggestion.meters)} m em linha reta) para criar uma rota de proteção.`;
            showRingClosureOnMap(suggestion);
            return;
        }
        const ringFocus = e.target.closest('[data-impact-ring-focus]');
        if (ringFocus) {
            clearImpactOverlays();
            const ringInfo = state.structure.rings[Number(ringFocus.dataset.impactRingFocus)];
            const bounds = new google.maps.LatLngBounds();
            ringInfo.boxes.forEach(b => { addImpactCircle(b, '#16a34a'); const p = b.marker?.getPosition?.(); if (p) bounds.extend(p); });
            if (typeof map !== 'undefined' && map && !bounds.isEmpty?.()) map.fitBounds(bounds);
        }
    });
    box.addEventListener('change', (e) => {
        if (e.target.id !== 'impactPicker') return;
        const state = networkImpactState;
        const out = document.getElementById('impactPickerResult');
        const value = e.target.value;
        if (!value || !state?.data) { out.textContent = ''; clearImpactOverlays(); return; }
        const scope = state.scope;
        const boxesList = scope.markers.filter(m => IMPACT_BOX_TYPES.includes(m.type));
        const target = value[0] === 'c'
            ? { kind: 'cable', cable: scope.cables[Number(value.slice(1))], name: scope.cables[Number(value.slice(1))].name }
            : { kind: 'box', box: boxesList[Number(value.slice(1))], name: boxesList[Number(value.slice(1))].name };
        const result = analyzeNetworkCut(state.data.model, networkCutFor(target), target.kind === 'box' ? target.box : null);
        const row = { ...target, result };
        out.innerHTML = `<b>${escapeHtml(target.name)}:</b> ${escapeHtml(describeImpactResult(result))}${renderImpactDetail(row) ? '<br>' + renderImpactDetail(row) : ''}`;
        showImpactOnMap(row);
    });
}

document.addEventListener('DOMContentLoaded', setupNetworkImpact);
