// Filtro do mapa (modo Rede): destaca só o que interessa — CTOs lotadas, quase lotadas, com porta livre, sem splitter ou
// sem sinal, caixas com ocorrência aberta, clientes por situação — e apaga o resto, sem mexer no que está oculto.
// Depende de js/app.js, js/network/clients.js, js/network/network-docs.js, js/network/signal-trace.js e
// js/network/network-occurrences.js.

const NETWORK_FILTERS = [
    { id: 'cheia', group: 'Caixas', label: 'CTOs lotadas', test: (m, c) => m.type === 'CTO' && c.capacity(m) && c.used(m) >= c.capacity(m) },
    { id: 'quase', group: 'Caixas', label: 'Quase lotadas', test: (m, c) => m.type === 'CTO' && c.capacity(m) && c.used(m) < c.capacity(m) && c.used(m) / c.capacity(m) >= 0.75 },
    { id: 'livre', group: 'Caixas', label: 'Com porta livre', test: (m, c) => m.type === 'CTO' && c.capacity(m) && c.used(m) < c.capacity(m) },
    { id: 'semSplitter', group: 'Caixas', label: 'Sem splitter', test: (m, c) => m.type === 'CTO' && !c.capacity(m) },
    { id: 'semSinal', group: 'Caixas', label: 'Sem sinal', test: (m, c) => c.noSignal.has(m) },
    { id: 'ocorrencia', group: 'Caixas', label: 'Com ocorrência', test: (m, c) => c.openOcc.has(m.uid) },
    ...CLIENT_STATUSES.map(st => ({ id: `cli_${st.id}`, group: 'Clientes', label: st.label, color: st.color, test: (m) => m.type === 'CLIENTE' && (m.client?.status || DEFAULT_CLIENT_STATUS) === st.id })),
    { id: 'semPorta', group: 'Clientes', label: 'Sem CTO/porta', test: (m) => m.type === 'CLIENTE' && m.client?.status !== 'cancelado' && !m.client?.cableName && (!m.client?.ctoUid || !m.client?.ctoPort) },
];
const networkFilter = { active: '', matches: [], cursor: -1, dimmedMarkers: new Set(), dimmedCables: new Map(), hiddenDrops: new Set(), timer: null };

function getNetworkFilterItems() {
    const folders = new Set(getNetworkRoots().filter(r => !isPendingNetworkRoot(r)).flatMap(r => getAllDescendantFolderIds(getRootId(r))));
    return {
        markers: markers.filter(m => folders.has(m.folderId)),
        cables: savedCables.filter(c => folders.has(c.folderId)),
    };
}

function buildNetworkFilterContext(items) {
    const capacities = new Map();
    const used = new Map();
    const openOcc = new Set();
    getNetworkRoots().forEach(r => {
        if (typeof getNetworkOccurrences === 'function') getNetworkOccurrences(getRootId(r)).filter(isOccurrenceOpen).forEach(o => openOcc.add(o.uid));
    });
    //Sem sinal: CTO com splitter de atendimento que não chega a nenhuma PON pelos planos de fusão
    const noSignal = new Set();
    const ctos = items.markers.filter(m => m.type === 'CTO');
    if (ctos.some(m => m.fusionPlan) && typeof getCtoPortOutputs === 'function') {
        const computed = computeOpticalPower();
        ctos.forEach(cto => {
            const outputs = getCtoPortOutputs(cto);
            if (outputs.length && !outputs.some(o => computed.power.has(`${cto.uid}|${o.id}`))) noSignal.add(cto);
        });
    }
    return {
        capacity: (m) => { if (!capacities.has(m)) capacities.set(m, getCtoPortCapacity(m)); return capacities.get(m); },
        used: (m) => { if (!used.has(m)) used.set(m, getOccupiedPorts(m).size); return used.get(m); },
        openOcc, noSignal,
    };
}

function restoreNetworkFilter() {
    networkFilter.dimmedMarkers.forEach(m => m.marker?.setOpacity(1));
    networkFilter.dimmedCables.forEach((opacity, cable) => cable.polyline?.setOptions({ strokeOpacity: opacity }));
    networkFilter.hiddenDrops.forEach(c => syncClientDropVisibility(c));
    networkFilter.dimmedMarkers.clear();
    networkFilter.dimmedCables.clear();
    networkFilter.hiddenDrops.clear();
}

function applyNetworkFilter() {
    restoreNetworkFilter();
    networkFilter.matches = [];
    const filter = NETWORK_FILTERS.find(f => f.id === networkFilter.active);
    if (!filter) { renderNetworkFilter(); return; }
    const items = getNetworkFilterItems();
    const ctx = buildNetworkFilterContext(items);
    items.markers.forEach(m => {
        if (filter.test(m, ctx)) { networkFilter.matches.push(m); return; }
        m.marker?.setOpacity(0.15);
        networkFilter.dimmedMarkers.add(m);
        if (m.type === 'CLIENTE' && m.dropLine) { m.dropLine.setVisible(false); networkFilter.hiddenDrops.add(m); }
    });
    items.cables.forEach(c => {
        if (!c.polyline) return;
        networkFilter.dimmedCables.set(c, c.polyline.get('strokeOpacity') ?? 1);
        c.polyline.setOptions({ strokeOpacity: 0.22 });
    });
    networkFilter.cursor = -1;
    renderNetworkFilter();
}

function setNetworkFilter(id) {
    networkFilter.active = networkFilter.active === id ? '' : id;
    applyNetworkFilter();
}

function nextNetworkFilterMatch() {
    const list = networkFilter.matches;
    if (!list.length) return;
    networkFilter.cursor = (networkFilter.cursor + 1) % list.length;
    focusNetworkItem(list[networkFilter.cursor]);
    renderNetworkFilter();
}

function renderNetworkFilter() {
    const body = document.getElementById('networkFilterBody');
    if (!body || document.getElementById('networkFilterBox')?.classList.contains('hidden')) return;
    const esc = (v) => escapeHtml(String(v ?? ''));
    const items = getNetworkFilterItems();
    const ctx = buildNetworkFilterContext(items);
    const counts = new Map(NETWORK_FILTERS.map(f => [f.id, items.markers.filter(m => f.test(m, ctx)).length]));
    const groups = [...new Set(NETWORK_FILTERS.map(f => f.group))];
    const active = NETWORK_FILTERS.find(f => f.id === networkFilter.active);
    body.innerHTML = `
        ${groups.map(g => `<section class="net-filter__group"><header>${esc(g)}</header><div class="net-filter__chips">
            ${NETWORK_FILTERS.filter(f => f.group === g).map(f => `<button type="button" class="net-filter__chip${f.id === networkFilter.active ? ' is-active' : ''}" data-filter="${f.id}" aria-pressed="${f.id === networkFilter.active}"${f.color ? ` style="--chip:${f.color}"` : ''}${counts.get(f.id) ? '' : ' data-empty="true"'}>
                ${f.color ? '<i></i>' : ''}${esc(f.label)} <b>${counts.get(f.id)}</b></button>`).join('')}
        </div></section>`).join('')}
        ${active ? `<div class="net-filter__result">
            <span><b>${networkFilter.matches.length}</b> ${esc(active.label.toLowerCase())}${networkFilter.cursor >= 0 ? ` · ${networkFilter.cursor + 1} de ${networkFilter.matches.length}` : ''}</span>
            ${networkFilter.matches.length ? '<button type="button" class="map-tool-btn" data-filter-action="next">Próximo ›</button>' : ''}
            <button type="button" class="map-tool-btn" data-filter-action="clear">Limpar</button>
        </div>` : '<p class="map-tool-help">Escolha um filtro: o mapa destaca só o que se encaixa e apaga o resto.</p>'}`;
}

async function openNetworkFilter() {
    //As cidades que ainda são só o nome entram no filtro (carregam ocultas)
    for (const root of getNetworkRoots().filter(isPendingNetworkRoot)) await loadNetworkRoot(getRootId(root));
    document.getElementById('networkFilterBox').classList.remove('hidden');
    renderNetworkFilter();
}

function closeNetworkFilter() {
    document.getElementById('networkFilterBox')?.classList.add('hidden');
    networkFilter.active = '';
    restoreNetworkFilter();
    networkFilter.matches = [];
}

appReady.then(() => {
    document.getElementById('networkFilterButton')?.addEventListener('click', () => {
        const box = document.getElementById('networkFilterBox');
        if (box.classList.contains('hidden')) openNetworkFilter(); else closeNetworkFilter();
    });
    document.getElementById('closeNetworkFilterBox')?.addEventListener('click', closeNetworkFilter);
    document.getElementById('networkFilterBody')?.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-filter]');
        if (chip) { setNetworkFilter(chip.dataset.filter); return; }
        const action = e.target.closest('[data-filter-action]')?.dataset.filterAction;
        if (action === 'next') nextNetworkFilterMatch();
        if (action === 'clear') { networkFilter.active = ''; applyNetworkFilter(); }
    });
    //Cidade aberta ou itens mudaram com o filtro ligado: refaz
    const sidebar = document.getElementById('sidebar');
    if (sidebar) new MutationObserver(() => {
        if (!networkFilter.active) return;
        clearTimeout(networkFilter.timer);
        networkFilter.timer = setTimeout(applyNetworkFilter, 400);
    }).observe(sidebar, { childList: true, subtree: true });
    let wasRede = document.body.classList.contains('mode-rede');
    new MutationObserver(() => {
        const rede = document.body.classList.contains('mode-rede');
        if (rede !== wasRede) { wasRede = rede; if (!rede) closeNetworkFilter(); }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
});
