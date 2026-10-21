// Rede existente por baixo do projeto (modo Projeto): as caixas e os cabos já construídos na cidade do projeto aparecem
// apagados no mapa, só para consulta. Clicar numa caixa da rede (ou nela, desenhando um cabo) traz a caixa para o
// projeto como Existente, com o mesmo identificador: ao concluir, ela é atualizada na rede em vez de duplicar.
// Depende de js/app.js, js/projects/network-mode.js e js/map/marker-icons.js.

const NETWORK_LAYER_KEY = 'routeMapNetworkLayer';
const NETWORK_LAYER_CACHE_MS = 120000;
const networkLayer = { cache: new Map(), overlays: [], timer: null, seq: 0 };

function isNetworkLayerEnabled() {
    try { return localStorage.getItem(NETWORK_LAYER_KEY) !== 'off'; } catch (e) { return true; }
}

function setNetworkLayerEnabled(on) {
    try { localStorage.setItem(NETWORK_LAYER_KEY, on ? 'on' : 'off'); } catch (e) { /* ignora */ }
    updateNetworkLayerToggle();
    refreshNetworkLayer();
}

function updateNetworkLayerToggle() {
    const item = document.getElementById('networkLayerToggle');
    if (!item) return;
    const on = isNetworkLayerEnabled();
    item.setAttribute('aria-checked', on ? 'true' : 'false');
    item.querySelector('small').textContent = on ? 'Ligado: caixas e cabos já construídos aparecem apagados' : 'Desligado';
}

function clearNetworkLayer() {
    networkLayer.overlays.forEach(o => o.setMap(null));
    networkLayer.overlays = [];
}

//Cidades dos projetos abertos (cada uma com a rede dela)
function getOpenProjectCities() {
    const cities = new Set();
    getOpenProjectRoots().filter(root => !isNetworkRoot(root)).forEach(root => {
        const city = (root.querySelector(':scope > .folder-title')?.dataset.folderCity || '').trim();
        if (city && city !== 'null' && city !== 'undefined') cities.add(city);
    });
    return [...cities];
}

async function fetchNetworkLayerData(city) {
    const cached = networkLayer.cache.get(city);
    if (cached && Date.now() - cached.at < NETWORK_LAYER_CACHE_MS) return cached.data;
    const { data } = await supabaseClient.from('projects').select('data').eq('id', getNetworkId(city)).maybeSingle();
    const content = data?.data || null;
    networkLayer.cache.set(city, { at: Date.now(), data: content });
    return content;
}

function scheduleNetworkLayerRefresh(delay = 500) {
    clearTimeout(networkLayer.timer);
    networkLayer.timer = setTimeout(refreshNetworkLayer, delay);
}

async function refreshNetworkLayer() {
    const seq = ++networkLayer.seq;
    if (typeof map === 'undefined' || !map || appMode !== 'projeto' || !isNetworkLayerEnabled()) { clearNetworkLayer(); return; }
    const cities = getOpenProjectCities();
    const loaded = [];
    for (const city of cities) loaded.push([city, await fetchNetworkLayerData(city)]);
    if (seq !== networkLayer.seq) return;
    clearNetworkLayer();
    //O que já está no projeto (trazido da rede ou concluído) não aparece duas vezes
    const inWorkspace = new Set([...markers.map(m => m.uid), ...savedCables.map(c => c.uid)].filter(Boolean));
    loaded.forEach(([city, data]) => {
        if (!data) return;
        (data.cables || []).forEach(cable => {
            if (inWorkspace.has(cable.uid) || !(cable.path || []).length) return;
            networkLayer.overlays.push(new google.maps.Polyline({
                map, path: cable.path.map(p => new google.maps.LatLng(p.lat, p.lng)), clickable: false, zIndex: 1,
                strokeColor: cable.color || '#64748b', strokeOpacity: 0.32, strokeWeight: 2,
            }));
        });
        (data.markers || []).filter(goesToNetwork).forEach(item => {
            if (inWorkspace.has(item.uid) || !item.position) return;
            const marker = new google.maps.Marker({
                map, position: new google.maps.LatLng(item.position.lat, item.position.lng), zIndex: 2, opacity: 0.8,
                title: `${item.name} · já existe na Rede · ${city}`,
                icon: buildMarkerMapIcon(item.type, { color: item.color || '#f59e0b', faded: true }),
            });
            marker.addListener('click', () => handleNetworkLayerClick(item, city));
            networkLayer.overlays.push(marker);
        });
    });
}

//Projeto que recebe a caixa: o ativo (se é da mesma cidade) ou o primeiro aberto dessa cidade
function getProjectRootForCity(city) {
    const roots = getOpenProjectRoots().filter(root => !isNetworkRoot(root) && !isProjectConcluded(getRootId(root))
        && (root.querySelector(':scope > .folder-title')?.dataset.folderCity || '').trim() === city);
    const activeId = typeof getActiveProjectId === 'function' ? getActiveProjectId() : null;
    return roots.find(root => getRootId(root) === activeId) || roots[0] || null;
}

//Traz a caixa da rede para o projeto (Existente, mesmo identificador, com o plano de fusão)
function useNetworkBoxInProject(item, city, { quiet = false } = {}) {
    if (!requireEdit('usar caixas da rede no projeto')) return null;
    const existing = markers.find(m => m.uid === item.uid);
    if (existing) return existing;
    const root = getProjectRootForCity(city);
    if (!root) {
        showToast('Nenhum projeto desta cidade', 'Abra (ou selecione) um projeto em andamento desta cidade.', 'progress');
        return null;
    }
    const projectId = getRootId(root);
    const folderId = getAllDescendantFolderIds(projectId).includes(activeFolderId) ? activeFolderId : projectId;
    const { order, ...data } = item;
    rebuildMarker({ ...data, folderId });
    const info = markers[markers.length - 1];
    if (info.uid !== item.uid) info.uid = item.uid;
    if (typeof refreshBomAfterProjectChange === 'function') refreshBomAfterProjectChange();
    if (typeof updateSidebarCounts === 'function') updateSidebarCounts();
    scheduleNetworkLayerRefresh(0);
    if (!quiet) showToast(`${item.name} no projeto`, 'Entrou como Existente. Ao concluir o projeto, ela é atualizada na rede (não duplica).');
    return info;
}

function handleNetworkLayerClick(item, city) {
    //Desenhando um cabo: a caixa da rede vira ponta do cabo
    if (typeof isDrawingCable !== 'undefined' && isDrawingCable) {
        const info = useNetworkBoxInProject(item, city, { quiet: true });
        if (info) handleAnchorMarkerClickDuringCableDraw(info);
        return;
    }
    const noun = getMarkerTypeMeta(item.type)?.noun || item.type;
    const origin = item.asBuilt?.projectName ? ` Construída pelo projeto "${item.asBuilt.projectName}".` : '';
    if (!AppSession.canEdit) {
        showToast(`${item.name} · Rede · ${city}`, `${noun} que já existe na rede.${origin}`, 'progress');
        return;
    }
    showChoice({
        title: `${item.name} · Rede · ${city}`,
        message: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} que já existe na rede.${origin}\n\nPara ligar cabos nela ou mexer no plano de fusão, traga para o projeto: ela entra como Existente e, ao concluir, é atualizada na rede (não duplica). Desenhando um cabo, é só clicar nela.`,
        choices: [{ label: 'Fechar', kind: 'secondary', value: 'close' }, { label: 'Usar no projeto', kind: 'primary', value: 'use' }],
    }).then(choice => { if (choice === 'use') useNetworkBoxInProject(item, city); });
}

appReady.then(() => {
    document.getElementById('networkLayerToggle')?.addEventListener('click', (e) => {
        e.preventDefault();
        setNetworkLayerEnabled(!isNetworkLayerEnabled());
    });
    updateNetworkLayerToggle();
    //Projeto aberto ou fechado, troca de modo: refaz a camada
    const sidebar = document.getElementById('sidebar');
    if (sidebar) new MutationObserver((list) => { if (list.some(m => m.target === sidebar)) scheduleNetworkLayerRefresh(); }).observe(sidebar, { childList: true });
    let wasRede = document.body.classList.contains('mode-rede');
    new MutationObserver(() => {
        const rede = document.body.classList.contains('mode-rede');
        if (rede !== wasRede) { wasRede = rede; scheduleNetworkLayerRefresh(0); }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    mapReady.then(() => scheduleNetworkLayerRefresh(0));
});
