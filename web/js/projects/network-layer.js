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
    item.querySelector('small').textContent = on ? 'Ligado: a rede existente aparece apagada e tracejada' : 'Desligado';
}

function clearNetworkLayer() {
    networkLayer.overlays.forEach(o => o.setMap(null));
    networkLayer.overlays = [];
    if (typeof hideNetworkAreaShape === 'function') [...networkAreaShapes.keys()].filter(k => String(k).startsWith('layer')).forEach(hideNetworkAreaShape);
    renderNetworkLayerChip(null);
}

//Aviso no mapa: deixa claro que o apagado por baixo é a rede EXISTENTE, de qual cidade, e se é a cidade toda ou um trecho
function renderNetworkLayerChip(info) {
    let chip = document.getElementById('networkLayerChip');
    if (!info) { chip?.classList.add('hidden'); return; }
    if (!chip) {
        chip = document.createElement('div');
        chip.id = 'networkLayerChip';
        chip.className = 'network-layer-chip';
        document.getElementById('map')?.parentElement?.appendChild(chip);
        chip.addEventListener('click', (e) => {
            const action = e.target.closest('[data-layer]')?.dataset.layer;
            if (action === 'area') chooseNetworkLayerArea({ keep: true });
            if (action === 'whole') setNetworkLayerArea(null);
            if (action === 'last') setNetworkLayerAreas(getNetworkLayerAreas().slice(0, -1));
            if (action === 'off') setNetworkLayerEnabled(false);
        });
    }
    const esc = (v) => escapeHtml(String(v ?? ''));
    chip.innerHTML = `<span class="network-layer-chip__swatch" aria-hidden="true"></span>
        <span title="${esc(info.cities.join(', '))}"><b>Rede existente</b> · ${esc(info.cities.join(', '))} · ${info.area ? (info.areas > 1 ? `${info.areas} trechos` : 'trecho') : 'cidade inteira'} · ${info.boxes} caixas · ${info.cables} cabos</span>
        <button type="button" class="btn-chip" data-layer="area" title="${info.area ? 'Desenha mais um trecho; os já carregados continuam no mapa' : 'Mostra só a rede dentro da área desenhada'}">${info.area ? '+ Trecho' : 'Só um trecho'}</button>
        ${info.areas > 1 ? '<button type="button" class="btn-chip" data-layer="last" title="Tira o último trecho desenhado">Tirar último</button>' : ''}
        ${info.area ? '<button type="button" class="btn-chip" data-layer="whole">Cidade inteira</button>' : ''}
        <button type="button" class="btn-chip" data-layer="off" title="Desligar (Projeto → Rede da cidade por baixo)">Ocultar</button>`;
    chip.classList.remove('hidden');
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
    //Trecho escolhido (js/network/network-area.js): só a rede dentro dele
    const areas = typeof getNetworkLayerAreas === 'function' ? getNetworkLayerAreas() : [];
    const area = areas.length ? areas : null;
    let cablesCount = 0, boxesCount = 0;
    let count = 0;
    loaded.forEach(([city, data]) => {
        if (!data) return;
        (data.cables || []).forEach(cable => {
            if (inWorkspace.has(cable.uid) || !(cable.path || []).length) return;
            if (area && !isCableDataInAreas(cable, area)) return;
            count++; cablesCount++;
            //Existente: tracejado na cor do cabo sobre uma faixa clara, bem diferente dos cabos do projeto (linha cheia)
            const pathLL = cable.path.map(p => new google.maps.LatLng(p.lat, p.lng));
            const color = cable.color || (typeof getCableColor === 'function' ? getCableColor(getFiberType(cable.type)) : null) || '#475569';
            networkLayer.overlays.push(new google.maps.Polyline({
                map, path: pathLL, clickable: false, zIndex: 1, strokeColor: '#ffffff', strokeOpacity: 0.55, strokeWeight: 6,
            }));
            networkLayer.overlays.push(new google.maps.Polyline({
                map, path: pathLL, clickable: false, zIndex: 2, strokeOpacity: 0,
                icons: [{ icon: { path: 'M 0,-1 0,1', strokeColor: color, strokeOpacity: 0.95, strokeWeight: 3.5, scale: 3 }, offset: '0', repeat: '11px' }],
            }));
        });
        (data.markers || []).filter(goesToNetwork).forEach(item => {
            if (inWorkspace.has(item.uid) || !item.position) return;
            if (area && !isMarkerDataInAreas(item, area)) return;
            count++; boxesCount++;
            const marker = new google.maps.Marker({
                map, position: new google.maps.LatLng(item.position.lat, item.position.lng), zIndex: 2, opacity: 0.8,
                title: `${item.name} · EXISTENTE (rede de ${city}) · clique para usar no projeto`,
                icon: buildMarkerMapIcon(item.type, { color: item.color || '#f59e0b', faded: true }),
            });
            marker.addListener('click', () => handleNetworkLayerClick(item, city));
            networkLayer.overlays.push(marker);
        });
    });
    if (area && typeof showNetworkAreaShape === 'function') areas.forEach((a, i) => showNetworkAreaShape(`layer${i}`, a, '#475569'));
    renderNetworkLayerChip(loaded.some(([, data]) => data) ? { cities: loaded.filter(([, d]) => d).map(([c]) => c), area: !!area, areas: areas.length, count, cables: cablesCount, boxes: boxesCount } : null);
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
    const root = getProjectRootForCity(city);
    if (!root) {
        showToast('Nenhum projeto desta cidade', 'Abra (ou selecione) um projeto em andamento desta cidade.', 'progress');
        return null;
    }
    const projectId = getRootId(root);
    //Já está neste projeto? (outro projeto aberto pode ter a mesma caixa: cada um usa a sua cópia)
    const existing = markers.find(m => m.uid === item.uid && getItemProjectId(m) === projectId);
    if (existing) return existing;
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
    document.getElementById('networkLayerAreaButton')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('projectDropdown')?.classList.remove('show');
        chooseNetworkLayerArea();
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
