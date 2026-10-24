// Trecho da rede: em vez da cidade inteira, desenha uma área no mapa e só o que está dentro dela carrega.
// - Modo Rede: "Abrir só um trecho" na cidade. O que fica fora da área continua guardado (root.__networkStash) e volta
//   junto ao salvar (js/core/persistence.js → buildProjectRecord), então nada se perde. "Abrir a cidade inteira" recarrega.
// - Modo Projeto: a rede existente por baixo (js/projects/network-layer.js) pode mostrar só o trecho.
// Depende de js/app.js, js/projects/network-mode.js e js/network/network-sidebar.js.

const networkAreaDraw = { active: false, points: [], shape: null, listeners: [], resolve: null };
const networkAreaShapes = new Map(); //id da rede (ou 'layer') → polígono tracejado do trecho no mapa

//Ponto dentro do polígono (lat/lng; raio cruzando as arestas)
function isInsideNetworkArea(point, area) {
    if (!point || !area?.length) return true;
    const x = point.lng, y = point.lat;
    let inside = false;
    for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
        const xi = area[i].lng, yi = area[i].lat, xj = area[j].lng, yj = area[j].lat;
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

const isMarkerDataInArea = (m, area) => !!m.position && isInsideNetworkArea(m.position, area);
const isCableDataInArea = (c, area) => (c.path || []).some(p => isInsideNetworkArea(p, area));

//Separa o conteúdo da rede: o que está no trecho (carrega) e o resto (fica guardado para salvar junto)
function splitNetworkDataByArea(data, area) {
    const markersIn = [], markersOut = [], cablesIn = [], cablesOut = [];
    (data.markers || []).forEach(m => (isMarkerDataInArea(m, area) ? markersIn : markersOut).push(m));
    (data.cables || []).forEach(c => (isCableDataInArea(c, area) ? cablesIn : cablesOut).push(c));
    return { content: { ...data, markers: markersIn, cables: cablesIn }, stash: { markers: markersOut, cables: cablesOut } };
}

function showNetworkAreaShape(key, area, color = '#7c3aed') {
    hideNetworkAreaShape(key);
    if (typeof map === 'undefined' || !map || !area?.length) return;
    networkAreaShapes.set(key, new google.maps.Polygon({
        map, paths: area, clickable: false, zIndex: 0,
        strokeColor: color, strokeOpacity: 0.9, strokeWeight: 2, fillColor: color, fillOpacity: 0.04,
    }));
}

function hideNetworkAreaShape(key) {
    networkAreaShapes.get(key)?.setMap(null);
    networkAreaShapes.delete(key);
}

// ---------------------------------------------------------------
// Desenhar a área
// ---------------------------------------------------------------

function ensureNetworkAreaBox() {
    let box = document.getElementById('networkAreaBox');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'networkAreaBox';
    box.className = 'floating-box map-tool-box hidden';
    box.setAttribute('role', 'dialog');
    box.innerHTML = `
        <div class="map-tool-box__header">
            <span class="map-tool-box__icon"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-polygon"></use></svg></span>
            <div class="map-tool-box__heading">
                <h3 id="networkAreaTitle">Trecho da rede</h3>
                <span class="map-tool-box__subtitle" id="networkAreaSubtitle">Só o que estiver dentro carrega</span>
            </div>
            <button type="button" class="map-tool-box__close" id="closeNetworkAreaBox" title="Cancelar" aria-label="Cancelar">
                <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-x"></use></svg>
            </button>
        </div>
        <div class="map-tool-box__body">
            <p class="map-tool-help">Clique no mapa para marcar os cantos do trecho (pelo menos 3). Duplo clique ou <b>Concluir</b> para terminar.</p>
            <p class="network-area__count" id="networkAreaCount">0 pontos</p>
        </div>
        <div class="map-tool-box__actions">
            <button type="button" class="map-tool-btn" data-area="undo">Desfazer ponto</button>
            <button type="button" class="map-tool-btn map-tool-btn--primary" data-area="done" disabled>Concluir</button>
        </div>`;
    document.body.appendChild(box);
    box.addEventListener('click', (e) => {
        const action = e.target.closest('[data-area]')?.dataset.area;
        if (action === 'undo') { networkAreaDraw.points.pop(); updateNetworkAreaDraw(); }
        if (action === 'done') finishNetworkAreaDraw(true);
    });
    box.querySelector('#closeNetworkAreaBox').addEventListener('click', () => finishNetworkAreaDraw(false));
    return box;
}

function updateNetworkAreaDraw() {
    const pts = networkAreaDraw.points;
    networkAreaDraw.shape?.setPath?.(pts);
    const count = document.getElementById('networkAreaCount');
    if (count) count.textContent = pts.length < 3 ? `${pts.length} ${pts.length === 1 ? 'ponto' : 'pontos'} · faltam ${3 - pts.length}` : `${pts.length} pontos`;
    const done = document.querySelector('#networkAreaBox [data-area="done"]');
    if (done) done.disabled = pts.length < 3;
}

//Abre a caixa e devolve a área desenhada ([{lat,lng}]) ou null se cancelar
function drawNetworkArea({ title = 'Trecho da rede', subtitle = 'Só o que estiver dentro carrega' } = {}) {
    finishNetworkAreaDraw(false);
    if (typeof map === 'undefined' || !map) return Promise.resolve(null);
    const box = ensureNetworkAreaBox();
    box.querySelector('#networkAreaTitle').textContent = title;
    box.querySelector('#networkAreaSubtitle').textContent = subtitle;
    networkAreaDraw.active = true;
    networkAreaDraw.points = [];
    networkAreaDraw.shape = new google.maps.Polygon({
        map, paths: [], clickable: false, zIndex: 95, strokeColor: '#7c3aed', strokeOpacity: 1, strokeWeight: 2.5, fillColor: '#7c3aed', fillOpacity: 0.1,
    });
    networkAreaDraw.listeners = [
        map.addListener('click', (e) => { if (e?.latLng) { networkAreaDraw.points.push({ lat: e.latLng.lat(), lng: e.latLng.lng() }); updateNetworkAreaDraw(); } }),
        map.addListener('dblclick', (e) => { e?.stop?.(); if (networkAreaDraw.points.length >= 3) finishNetworkAreaDraw(true); }),
    ];
    if (typeof setMapCursor === 'function') setMapCursor('crosshair');
    box.classList.remove('hidden');
    updateNetworkAreaDraw();
    return new Promise(resolve => { networkAreaDraw.resolve = resolve; });
}

function finishNetworkAreaDraw(ok) {
    if (!networkAreaDraw.active) return;
    const points = networkAreaDraw.points.slice();
    networkAreaDraw.active = false;
    networkAreaDraw.listeners.forEach(l => l?.remove?.());
    networkAreaDraw.listeners = [];
    networkAreaDraw.shape?.setMap(null);
    networkAreaDraw.shape = null;
    if (typeof setMapCursor === 'function') setMapCursor('');
    document.getElementById('networkAreaBox')?.classList.add('hidden');
    const resolve = networkAreaDraw.resolve;
    networkAreaDraw.resolve = null;
    resolve?.(ok && points.length >= 3 ? points : null);
}

// ---------------------------------------------------------------
// Modo Rede: abrir a cidade só no trecho / inteira de novo
// ---------------------------------------------------------------

//Descarrega a cidade (salvando antes o que faltava) e volta a ser só o nome na barra lateral
async function unloadNetworkRoot(id) {
    const root = document.getElementById(id)?.closest('.folder');
    if (!root || isPendingNetworkRoot(root)) return true;
    if (typeof flushNetworkAutosave === 'function' && !(await flushNetworkAutosave(root))) return false;
    const title = root.querySelector(':scope > .folder-title');
    const row = { id, name: title.dataset.folderName, city: title.dataset.folderCity };
    const next = root.nextElementSibling;
    if (typeof liveSyncLeave === 'function') liveSyncLeave(id);
    removeProjectFromWorkspace(id, root);
    hideNetworkAreaShape(id);
    addPendingNetworkRoot(row);
    const placeholder = document.getElementById(id)?.closest('.folder');
    if (placeholder && next?.parentElement) next.parentElement.insertBefore(placeholder, next);
    return true;
}

async function openNetworkCityArea(id) {
    if (!document.getElementById(id)) return;
    const area = await drawNetworkArea({ title: 'Abrir só um trecho', subtitle: 'Desenhe a área: só o que estiver dentro carrega' });
    if (!area) return;
    if (!(await unloadNetworkRoot(id))) { showAlert('Trecho da rede', 'Não foi possível salvar a cidade antes de trocar para o trecho. Tente de novo.'); return; }
    const root = await loadNetworkRoot(id, { visible: true, area });
    if (!root) return;
    handleVisibilityToggle(root.querySelector(':scope > .folder-title .visibility-toggle-btn'), true);
    setActiveFolder(id);
    const stash = root.__networkStash;
    const loaded = markers.filter(m => getAllDescendantFolderIds(id).includes(m.folderId)).length;
    showToast('Trecho aberto', `${loaded} ${loaded === 1 ? 'item carregado' : 'itens carregados'}; ${stash.markers.length + stash.cables.length} fora do trecho ficam guardados e são salvos junto.`);
}

async function openNetworkCityWhole(id) {
    if (!(await unloadNetworkRoot(id))) return;
    const root = await loadNetworkRoot(id, { visible: true });
    if (root) handleVisibilityToggle(root.querySelector(':scope > .folder-title .visibility-toggle-btn'), true);
}

//Itens fora do trecho entram de volta no registro salvo (pasta que sumiu → raiz da cidade)
function mergeNetworkStash(root, record) {
    const stash = root?.__networkStash;
    if (!stash) return record;
    const rootId = getRootId(root);
    const fixFolder = (item) => (document.getElementById(item.folderId) ? item : { ...item, folderId: rootId });
    const ids = new Set([...record.data.markers.map(m => m.uid), ...record.data.cables.map(c => c.uid)].filter(Boolean));
    record.data.markers = [...record.data.markers, ...stash.markers.filter(m => !m.uid || !ids.has(m.uid)).map(fixFolder)];
    record.data.cables = [...record.data.cables, ...stash.cables.filter(c => !c.uid || !ids.has(c.uid)).map(fixFolder)];
    return record;
}

// ---------------------------------------------------------------
// Modo Projeto: rede por baixo só no trecho
// ---------------------------------------------------------------

const NETWORK_LAYER_AREA_KEY = 'routeMapNetworkLayerArea';
function getNetworkLayerArea() {
    try { const v = JSON.parse(localStorage.getItem(NETWORK_LAYER_AREA_KEY) || 'null'); return Array.isArray(v) && v.length >= 3 ? v : null; } catch (e) { return null; }
}
function setNetworkLayerArea(area) {
    try { if (area) localStorage.setItem(NETWORK_LAYER_AREA_KEY, JSON.stringify(area)); else localStorage.removeItem(NETWORK_LAYER_AREA_KEY); } catch (e) { /* ignora */ }
    if (typeof refreshNetworkLayer === 'function') refreshNetworkLayer();
}

async function chooseNetworkLayerArea() {
    const area = await drawNetworkArea({ title: 'Trecho da rede por baixo', subtitle: 'Só a rede existente dentro da área aparece no projeto' });
    if (area) {
        if (typeof setNetworkLayerEnabled === 'function' && !isNetworkLayerEnabled()) setNetworkLayerEnabled(true);
        setNetworkLayerArea(area);
    }
}

//Menu Rede → "Abrir só um trecho": a cidade selecionada (ou a única); com várias, pergunta qual
async function pickNetworkCityForArea() {
    const roots = getNetworkRoots();
    const activeId = typeof getActiveProjectId === 'function' ? getActiveProjectId() : null;
    let root = roots.find(r => getRootId(r) === activeId) || (roots.length === 1 ? roots[0] : null);
    if (!root && roots.length) {
        const value = await showChoice({
            title: 'Abrir só um trecho',
            message: 'De qual cidade?',
            choices: [{ label: 'Cancelar', kind: 'secondary', value: '' },
                ...roots.slice(0, 8).map(r => ({ label: r.querySelector(':scope > .folder-title').dataset.folderName.replace(/^Rede · /, ''), kind: 'primary', value: getRootId(r) }))],
        });
        root = roots.find(r => getRootId(r) === value) || null;
    }
    if (!root) { if (!roots.length) showToast('Nenhuma cidade', 'Cadastre uma cidade na rede primeiro.', 'progress'); return; }
    openNetworkCityArea(getRootId(root));
}

appReady.then(() => {
    document.getElementById('networkAreaButton')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('networkDropdown')?.classList.remove('show'); pickNetworkCityForArea(); });
    document.addEventListener('keydown', (e) => {
        if (!networkAreaDraw.active) return;
        if (e.key === 'Escape') { e.preventDefault(); finishNetworkAreaDraw(false); }
        if (e.key === 'Enter' && networkAreaDraw.points.length >= 3) { e.preventDefault(); finishNetworkAreaDraw(true); }
    }, true);
});
