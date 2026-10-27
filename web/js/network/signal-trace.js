// Rastreio do sinal: do cliente (porta da CTO) até a OLT, placa e PON, passando pelas caixas, splitters, fusões e cabos,
// com a potência estimada em cada ponto; e quantos clientes e CTOs cada PON atende. Usa o caminho calculado pelo
// orçamento óptico (js/network/optical-budget.js → computeOpticalPower().prev).
// Depende de js/app.js, js/network/clients.js, js/network/fusion-plan.js, js/network/optical-budget.js e js/network/network-docs.js.

const signalTrace = { overlays: [], last: null, openPon: '' };

const getOpticalCfg = () => lancamentoConfig?.optical || DEFAULT_OPTICAL_CONFIG;

//Saídas dos splitters de atendimento na ordem das portas da CTO (a mesma numeração do plano de fusão)
function getCtoPortOutputs(cto) {
    const plan = readFusionPlan(cto);
    if (!plan || plan.empty) return [];
    const suffix = (sp) => parseInt(String(sp.id).split('-').pop(), 10) || 0;
    return plan.splitters.filter(sp => sp.atendimento).sort((a, b) => suffix(a) - suffix(b))
        .flatMap(sp => sp.outputIds.map(id => ({ id, splitter: sp })));
}

//Nós do caminho, da origem (PON) até o nó pedido; edge = ligação por onde o sinal chegou em cada nó
function getSignalChain(computed, node) {
    const chain = [];
    const seen = new Set();
    let cur = node;
    while (cur && !seen.has(cur)) {
        seen.add(cur);
        const step = computed.prev.get(cur);
        chain.push({ node: cur, edge: step?.edge || null });
        cur = step?.from;
    }
    return chain.reverse();
}

function describeSignalSource(computed, node) {
    const src = computed.sources.find(s => s.node === node);
    if (!src) return null;
    const olt = src.olt || src.splitter?.olt || {};
    return { box: src.box, olt: olt.olt || '', placa: olt.placa || '', pon: olt.pon || '', fromSplitter: !!src.splitter };
}

const getPonKey = (src) => (src ? `${src.box?.uid || ''}|${src.olt}|${src.placa}|${src.pon}` : '');
const getPonLabel = (src) => (src ? [src.olt || 'OLT', src.placa ? `placa ${src.placa}` : '', src.pon ? `PON ${src.pon}` : ''].filter(Boolean).join(' · ') : '');

function findCableByKey(key) {
    return savedCables.find(c => c.uid === key) || savedCables.find(c => `nome:${c.name}` === key) || null;
}

//Caminho do sinal até a porta da CTO: { source, steps: [{ kind: 'box' | 'cable', ... }], portDbm } ou { error }
function traceCtoPort(cto, port, computed = computeOpticalPower()) {
    const cfg = getOpticalCfg();
    const outputs = getCtoPortOutputs(cto);
    const out = outputs[Number(port) - 1];
    if (!out) {
        return { cto, port, error: outputs.length ? `A ${cto.name} não tem a porta ${port} (tem ${outputs.length}).` : `A ${cto.name} não tem splitter de atendimento no plano de fusão.` };
    }
    const node = `${ensureMarkerUid(cto)}|${out.id}`;
    if (!computed.power.has(node)) {
        return { cto, port, splitter: out.splitter, error: 'Sem sinal: pelos planos de fusão, esta porta não chega a nenhuma OLT/PON. Confira as fusões e o splitter ligado na PON.' };
    }
    const chain = getSignalChain(computed, node);
    const source = describeSignalSource(computed, chain[0].node);
    const steps = [];
    let visit = null;
    chain.forEach(({ node: n, edge }) => {
        const info = computed.info.get(n);
        const dbm = computed.power.get(n);
        if (edge?.kind === 'cable') {
            const cable = findCableByKey(edge.cuts?.[0]);
            steps.push({ kind: 'cable', cable, name: cable?.name || info?.cable || 'Cabo', fiber: info?.number || null, meters: Number(cable?.totalLength) || 0, loss: edge.loss, dbm });
            visit = null;
        }
        if (!visit || visit.box !== info?.box) {
            visit = { kind: 'box', box: info?.box, splitters: [], fusions: 0, dgo: false, passThrough: false, inDbm: dbm, outDbm: dbm };
            steps.push(visit);
        }
        if (edge?.kind === 'splitter') visit.splitters.push(info?.splitter?.label || 'Splitter');
        if (edge?.kind === 'fusion') visit.fusions++;
        if (edge?.kind === 'dgo') visit.dgo = true;
        if (edge?.kind === 'reserva') visit.passThrough = true;
        visit.outDbm = dbm;
    });
    const portDbm = computed.power.get(node) - cfg.lossConnector; //Adaptador da porta da CTO
    return { cto, port: Number(port), splitter: out.splitter, source, steps, portDbm, status: classifyOpticalPower(portDbm, cfg) };
}

function traceClientSignal(clientInfo, computed = computeOpticalPower()) {
    const cfg = getOpticalCfg();
    const cto = findMarkerByUid(clientInfo.client?.ctoUid, clientInfo);
    if (!cto) return { client: clientInfo, error: clientInfo.client?.cableName ? 'Cliente ligado direto num cabo: veja a rota da fibra no cabo.' : 'Cliente sem CTO: ligue-o numa porta para rastrear o sinal.' };
    if (!clientInfo.client.ctoPort) return { client: clientInfo, cto, error: `Cliente sem porta na ${cto.name}.` };
    const result = traceCtoPort(cto, clientInfo.client.ctoPort, computed);
    result.client = clientInfo;
    if (result.error) return result;
    const drop = typeof getClientDropInfo === 'function' ? getClientDropInfo(clientInfo) : null;
    result.dropMeters = drop?.length || 0;
    result.clientDbm = result.portDbm - (result.dropMeters / 1000) * cfg.lossPerKm - cfg.lossConnector;
    result.status = classifyOpticalPower(result.clientDbm, cfg);
    return result;
}

// ---------------------------------------------------------------
// Clientes por PON
// ---------------------------------------------------------------

function getPonSummary(root, computed = computeOpticalPower()) {
    const scope = getNetworkScope(root);
    const memo = new Map();
    const sourceOf = (node) => {
        const path = [];
        const seen = new Set();
        let cur = node;
        while (cur && !memo.has(cur) && !seen.has(cur)) {
            seen.add(cur);
            path.push(cur);
            const step = computed.prev.get(cur);
            if (!step) break;
            cur = step.from;
        }
        const src = memo.has(cur) ? memo.get(cur) : describeSignalSource(computed, cur);
        path.forEach(n => memo.set(n, src));
        return src;
    };
    const cfg = getOpticalCfg();
    const pons = new Map();
    const noSignal = [];
    scope.markers.filter(m => m.type === 'CTO').forEach(cto => {
        const outputs = getCtoPortOutputs(cto);
        if (!outputs.length) return;
        const occupied = getOccupiedPorts(cto);
        let reachedAny = false;
        outputs.forEach((o, i) => {
            const node = `${ensureMarkerUid(cto)}|${o.id}`;
            if (!computed.power.has(node)) return;
            reachedAny = true;
            const src = sourceOf(node);
            const key = getPonKey(src);
            if (!pons.has(key)) pons.set(key, { key, source: src, label: getPonLabel(src), ctos: new Map(), ports: 0, clients: 0, worst: Infinity });
            const pon = pons.get(key);
            const entry = pon.ctos.get(cto) || { cto, ports: 0, clients: 0 };
            pon.ctos.set(cto, entry);
            entry.ports++;
            pon.ports++;
            if (occupied.has(i + 1)) { entry.clients++; pon.clients++; }
            pon.worst = Math.min(pon.worst, computed.power.get(node) - cfg.lossConnector);
        });
        if (!reachedAny) noSignal.push(cto);
    });
    const list = [...pons.values()].map(p => ({ ...p, ctos: [...p.ctos.values()].sort((a, b) => a.cto.name.localeCompare(b.cto.name, 'pt-BR', { numeric: true })) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true }));
    return { pons: list, noSignal };
}

//Aba "PONs" do painel da rede (js/network/network-docs.js)
function renderPonTabHtml(root) {
    const esc = (v) => escapeHtml(String(v ?? ''));
    const { pons, noSignal } = getPonSummary(root);
    signalTrace.renderedPons = { pons, noSignal };
    if (!pons.length) {
        return `<p class="map-tool-help">Nenhuma CTO desta cidade recebe sinal pelos planos de fusão ainda. Ligue a PON da OLT (no plano do POP) ou informe OLT/placa/PON no splitter de entrada para ver os clientes de cada PON.</p>
            ${noSignal.length ? `<p class="map-tool-help">${noSignal.length} CTO${noSignal.length === 1 ? '' : 's'} com splitter de atendimento sem sinal.</p>` : ''}`;
    }
    return `<ul class="pon-list">${pons.map((p, i) => {
        const share = p.ports ? p.clients / p.ports : 0;
        const level = share >= 0.9 ? 'full' : share >= 0.75 ? 'high' : 'ok';
        const open = signalTrace.openPon === p.key;
        return `<li class="pon-row${open ? ' is-open' : ''}">
            <button type="button" class="pon-row__head" data-net-panel="pon" data-i="${i}" aria-expanded="${open}">
                <span><b>${esc(p.label)}</b><small>${p.source?.box ? `${esc(p.source.box.name)} · ` : ''}${p.ctos.length} CTO${p.ctos.length === 1 ? '' : 's'} · pior porta ${esc(formatDbm(p.worst))}</small></span>
                <i data-level="${level}"><s style="width:${(share * 100).toFixed(0)}%"></s></i>
                <em>${p.clients}<small>/${p.ports}</small></em>
            </button>
            ${open ? `<ul class="pon-row__ctos">${p.ctos.map((c, j) => `<li><button type="button" data-net-panel="pon-cto" data-i="${i}" data-j="${j}"><span>${esc(c.cto.name)}</span><b>${c.clients}/${c.ports}</b></button></li>`).join('')}</ul>` : ''}
        </li>`;
    }).join('')}</ul>
    ${noSignal.length ? `<button type="button" class="network-attn__row" data-net-panel="pon-nosignal"><b>${noSignal.length}</b><span>${noSignal.length === 1 ? 'CTO sem sinal' : 'CTOs sem sinal'}<small>Têm splitter, mas não chegam a nenhuma PON</small></span><em>Ver ›</em></button>` : ''}`;
}

function handlePonPanelClick(el) {
    const data = signalTrace.renderedPons;
    if (!data) return;
    const kind = el.dataset.netPanel;
    if (kind === 'pon') {
        const pon = data.pons[Number(el.dataset.i)];
        signalTrace.openPon = signalTrace.openPon === pon?.key ? '' : pon?.key || '';
        renderNetworkPanel();
        if (signalTrace.openPon && pon) highlightPon(pon);
        else clearSignalTraceOverlays();
        return;
    }
    if (kind === 'pon-cto') {
        const entry = data.pons[Number(el.dataset.i)]?.ctos[Number(el.dataset.j)];
        if (entry) focusNetworkItem(entry.cto);
        return;
    }
    if (kind === 'pon-nosignal') cycleNetworkAttention('pon-nosignal', data.noSignal);
}

// ---------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------

function clearSignalTraceOverlays() {
    signalTrace.overlays.forEach(o => o.setMap(null));
    signalTrace.overlays = [];
}

function addTraceCable(cable, bounds, color = '#7c3aed') {
    if (!cable?.path?.length) return;
    signalTrace.overlays.push(new google.maps.Polyline({
        path: cable.path, map, clickable: false, zIndex: google.maps.Marker.MAX_ZINDEX - 3,
        strokeColor: color, strokeOpacity: 0.85, strokeWeight: (cable.width || 3) + 5,
    }));
    cable.path.forEach(p => bounds.extend(p));
}

function addTraceRing(box, bounds, color = '#7c3aed') {
    const pos = box?.marker?.getPosition?.();
    if (!pos) return;
    signalTrace.overlays.push(new google.maps.Marker({
        position: pos, map, clickable: false, optimized: false, zIndex: google.maps.Marker.MAX_ZINDEX - 2,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: color, fillOpacity: 0.18, strokeColor: color, strokeOpacity: 1, strokeWeight: 3 },
    }));
    bounds.extend(pos);
}

function fitTraceBounds(bounds) {
    if (bounds.isEmpty?.()) return;
    map.fitBounds(bounds, { top: 56, right: 400, bottom: 56, left: typeof getMapFocusPadding === 'function' ? getMapFocusPadding() : 48 });
}

function showTraceOnMap(result) {
    clearSignalTraceOverlays();
    if (typeof map === 'undefined' || !map || !result?.steps) return;
    //A cidade pode estar oculta no mapa: mostra o caminho todo
    const bounds = new google.maps.LatLngBounds();
    result.steps.forEach(step => {
        if (step.kind === 'cable') {
            if (step.cable?.polyline?.getVisible?.() === false) step.cable.polyline.setVisible(true);
            addTraceCable(step.cable, bounds);
        } else if (step.box) {
            if (step.box.marker?.getVisible?.() === false) step.box.marker.setVisible(true);
            addTraceRing(step.box, bounds);
        }
    });
    if (result.client?.marker) {
        if (result.client.marker.getVisible() === false) result.client.marker.setVisible(true);
        addTraceRing(result.client, bounds, '#16a34a');
    }
    fitTraceBounds(bounds);
}

//PON aberta no painel: destaca as CTOs que ela atende e os cabos por onde o sinal passa
function highlightPon(pon) {
    clearSignalTraceOverlays();
    if (typeof map === 'undefined' || !map) return;
    const computed = computeOpticalPower();
    const bounds = new google.maps.LatLngBounds();
    const cables = new Set();
    pon.ctos.forEach(({ cto }) => {
        addTraceRing(cto, bounds);
        const first = getCtoPortOutputs(cto).find(o => computed.power.has(`${cto.uid}|${o.id}`));
        if (!first) return;
        getSignalChain(computed, `${cto.uid}|${first.id}`).forEach(({ edge }) => {
            if (edge?.kind === 'cable') { const cable = findCableByKey(edge.cuts?.[0]); if (cable) cables.add(cable); }
        });
    });
    cables.forEach(c => addTraceCable(c, bounds));
    if (pon.source?.box) addTraceRing(pon.source.box, bounds, '#0f766e');
    fitTraceBounds(bounds);
}

// ---------------------------------------------------------------
// Janela do rastreio
// ---------------------------------------------------------------

function openSignalTrace(clientInfo) {
    if (!clientInfo) return;
    const result = traceClientSignal(clientInfo);
    signalTrace.last = result;
    document.getElementById('signalTraceBox').classList.remove('hidden');
    document.getElementById('signalTraceSubtitle').textContent = clientInfo.name || 'Cliente';
    renderSignalTrace(result);
    showTraceOnMap(result);
}

function closeSignalTrace() {
    document.getElementById('signalTraceBox')?.classList.add('hidden');
    clearSignalTraceOverlays();
    signalTrace.last = null;
}

function renderSignalTrace(r) {
    const body = document.getElementById('signalTraceBody');
    const esc = (v) => escapeHtml(String(v ?? ''));
    const fmtM = (m) => `${Math.round(m).toLocaleString('pt-BR')} m`;
    if (r.error) {
        body.innerHTML = `<div class="viability-verdict is-no"><b>Não deu para rastrear</b><span>${esc(r.error)}</span></div>
            ${r.cto ? `<button type="button" class="map-tool-btn" data-trace="fusion">Abrir o plano de fusão da ${esc(r.cto.name)}</button>` : ''}`;
        return;
    }
    const cfg = getOpticalCfg();
    const verdict = { ok: ['is-ok', 'Sinal bom'], aviso: ['is-warn', 'Sinal no limite'], erro: ['is-no', 'Sinal abaixo da sensibilidade'] }[r.status] || ['is-no', 'Sem sinal'];
    const items = [];
    const sourceBox = r.steps[0]?.box;
    items.push(`<li class="trace-step is-olt"><i></i><div><b>${esc(getPonLabel(r.source) || 'OLT')}</b><small>${sourceBox ? esc(sourceBox.name) : ''}${r.source?.fromSplitter ? ' · informada no splitter' : ''}</small></div><em>${esc(formatDbm(cfg.oltPower))}</em></li>`);
    r.steps.forEach((step, i) => {
        if (step.kind === 'cable') {
            items.push(`<li class="trace-step is-cable"><i></i><div><b>${esc(step.name)}${step.fiber ? ` · fibra ${step.fiber}` : ''}</b><small>${step.meters ? fmtM(step.meters) : 'sem metragem'} · −${step.loss.toFixed(2).replace('.', ',')} dB</small></div><em></em></li>`);
            return;
        }
        if (!step.box || (i === 0 && !step.splitters.length && !step.fusions && step.box === sourceBox)) return;
        const isLast = i === r.steps.length - 1;
        const what = [
            step.splitters.length ? step.splitters.join(' + ') : '',
            step.fusions ? `${step.fusions} fus${step.fusions === 1 ? 'ão' : 'ões'}` : '',
            step.dgo ? 'DGO' : '',
            step.passThrough ? 'passa direto' : '',
        ].filter(Boolean).join(' · ');
        items.push(`<li class="trace-step is-box"><i></i><div><button type="button" class="btn-link" data-trace="box" data-i="${i}">${esc(step.box.name)}${isLast ? ` · porta ${r.port}` : ''}</button><small>${esc(what || step.box.type)}</small></div><em>${esc(formatDbm(isLast ? r.portDbm : step.outDbm))}</em></li>`);
    });
    items.push(`<li class="trace-step is-client"><i></i><div><b>${esc(r.client.name)}</b><small>drop ${fmtM(r.dropMeters)}</small></div><em>${esc(formatDbm(r.clientDbm))}</em></li>`);
    body.innerHTML = `
        <div class="viability-verdict ${verdict[0]}"><b>${esc(formatDbm(r.clientDbm))} no cliente</b><span>${verdict[1]} · ONU mínimo ${esc(formatDbm(cfg.onuSensitivity))}</span></div>
        <ol class="trace-list">${items.join('')}</ol>
        <div class="network-panel__actions">
            <button type="button" class="map-tool-btn" data-trace="map">Ver no mapa</button>
            ${appMode === 'rede' ? '<button type="button" class="map-tool-btn" data-trace="pon">Clientes desta PON</button>' : ''}
        </div>`;
}

function handleSignalTraceClick(e) {
    const el = e.target.closest('[data-trace]');
    const r = signalTrace.last;
    if (!el || !r) return;
    const kind = el.dataset.trace;
    if (kind === 'map') showTraceOnMap(r);
    if (kind === 'box') { const box = r.steps[Number(el.dataset.i)]?.box; if (box) focusNetworkItem(box); }
    if (kind === 'fusion' && r.cto) openFusionPlanFor(r.cto);
    if (kind === 'pon') {
        signalTrace.openPon = getPonKey(r.source);
        const root = getNetworkRoots().find(rt => getAllDescendantFolderIds(getRootId(rt)).includes(r.cto.folderId));
        if (root) setActiveFolder(getRootId(root));
        openNetworkPanel('pons');
        const pon = signalTrace.renderedPons?.pons.find(p => p.key === signalTrace.openPon);
        if (pon) highlightPon(pon);
    }
}

function openFusionPlanFor(box) {
    focusMapToMarker(box);
    populateFusionPlan(box);
    document.getElementById('fusionModal').style.display = 'flex';
}

appReady.then(() => {
    document.getElementById('signalTraceBody')?.addEventListener('click', handleSignalTraceClick);
    document.getElementById('closeSignalTraceBox')?.addEventListener('click', closeSignalTrace);
    document.getElementById('traceClientButton')?.addEventListener('click', () => {
        const client = editingClient;
        closeClientModal();
        openSignalTrace(client);
    });
    //Trocou de modo: fecha o rastreio
    let wasRede = document.body.classList.contains('mode-rede');
    new MutationObserver(() => {
        const rede = document.body.classList.contains('mode-rede');
        if (rede === wasRede) return;
        wasRede = rede;
        if (signalTrace.last) closeSignalTrace();
        signalTrace.openPon = '';
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
});
