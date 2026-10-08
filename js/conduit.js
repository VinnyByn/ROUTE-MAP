// Trecho tubulado: parte de um cabo que passa dentro de duto/subduto em vez de ir pelos postes.
// Esse trecho não entra na conta de postes, então não gera plaqueta, abraçadeira BAP, SUPA nem alça preformada.
// Na lista de materiais o tipo de cabo ganha uma linha "— TUBULADO" com acréscimo próprio (ver script.js);
// as ferragens de poste saem só da linha aérea.
// No mapa o cabo não muda de aparência: o trecho aparece no cartão ao passar o mouse e no editor do cabo,
// e fica destacado em roxo só enquanto a ferramenta de marcar o trecho está aberta.
// A ferramenta tem duas abas: "Marcar trecho" (clicar início e fim no cabo) e "Aéreo × duto"
// (os cabos da rota do cabo, com os trechos aéreos em azul e os em duto em roxo).
// Guardado no cabo como cable.conduit = [{ all: true }] (cabo todo) ou [{ a: {lat,lng}, b: {lat,lng} }] (trecho).
// Os extremos são pontos no mapa, não metros: se o traçado do cabo mudar, o trecho acompanha.
// Depende de script.js, js/cable-split.js (projectOnCablePath) e js/sidebar-actions.js.

const CONDUIT_COLOR = '#7c3aed';
const AERIAL_COLOR = '#0284c7';

// ---------------------------------------------------------------
// Medidas ao longo do traçado
// ---------------------------------------------------------------
function getPathCumulativeMeters(path) {
    const cumulative = [0];
    for (let i = 1; i < path.length; i++) {
        cumulative.push(cumulative[i - 1] + google.maps.geometry.spherical.computeDistanceBetween(path[i - 1], path[i]));
    }
    return cumulative;
}

//Distância (m) desde o começo do cabo até o ponto do traçado mais perto de "latLng"
//Pedaço do traçado entre duas distâncias (em metros desde o início)
function getPathSlice(path, from, to, cumulative = getPathCumulativeMeters(path)) {
    const slice = [getPointAtMeters(path, from, cumulative)];
    for (let i = 1; i < path.length - 1; i++) {
        if (cumulative[i] > from && cumulative[i] < to) slice.push(path[i]);
    }
    slice.push(getPointAtMeters(path, to, cumulative));
    return slice;
}

function getMetersAlongPath(path, latLng, cumulative = getPathCumulativeMeters(path)) {
    const p = projectOnCablePath(path, latLng);
    if (!p) return { meters: 0, offset: Infinity };
    const segment = cumulative[p.index + 1] - cumulative[p.index];
    return { meters: cumulative[p.index] + p.t * segment, offset: p.dist };
}

//Ponto do traçado a "meters" metros do começo
function getPointAtMeters(path, meters, cumulative = getPathCumulativeMeters(path)) {
    const total = cumulative[cumulative.length - 1];
    const m = Math.max(0, Math.min(total, meters));
    let i = 0;
    while (i < path.length - 2 && cumulative[i + 1] < m) i++;
    const segment = cumulative[i + 1] - cumulative[i];
    const t = segment > 0 ? (m - cumulative[i]) / segment : 0;
    const a = path[i];
    const b = path[i + 1];
    return new google.maps.LatLng(a.lat() + (b.lat() - a.lat()) * t, a.lng() + (b.lng() - a.lng()) * t);
}

function mergeConduitRanges(ranges) {
    const sorted = ranges.filter(r => r.to - r.from >= 0.5).sort((x, y) => x.from - y.from);
    const merged = [];
    sorted.forEach(r => {
        const last = merged[merged.length - 1];
        if (last && r.from <= last.to + 0.5) last.to = Math.max(last.to, r.to);
        else merged.push({ from: r.from, to: r.to });
    });
    return merged;
}

//Trechos tubulados do cabo, em metros desde a ponta A: [{ from, to }]
function getCableConduitRanges(cable) {
    const list = cable?.conduit;
    if (!list?.length || !cable.path || cable.path.length < 2) return [];
    const cumulative = getPathCumulativeMeters(cable.path);
    const total = cumulative[cumulative.length - 1];
    const ranges = list.map(entry => {
        if (entry.all) return { from: 0, to: total };
        const a = getMetersAlongPath(cable.path, new google.maps.LatLng(entry.a.lat, entry.a.lng), cumulative).meters;
        const b = getMetersAlongPath(cable.path, new google.maps.LatLng(entry.b.lat, entry.b.lng), cumulative).meters;
        return { from: Math.min(a, b), to: Math.max(a, b) };
    });
    return mergeConduitRanges(ranges);
}

function getCableConduitMeters(cable) {
    return getCableConduitRanges(cable).reduce((sum, r) => sum + (r.to - r.from), 0);
}

//Guarda os trechos (em metros) no cabo, como pontos do mapa. Cobrir o cabo inteiro vira { all: true }.
function setCableConduitRanges(cable, ranges) {
    const cumulative = getPathCumulativeMeters(cable.path);
    const total = cumulative[cumulative.length - 1];
    const merged = mergeConduitRanges(ranges.map(r => ({ from: Math.max(0, r.from), to: Math.min(total, r.to) })));
    if (merged.length === 1 && merged[0].from <= 0.5 && merged[0].to >= total - 0.5) {
        cable.conduit = [{ all: true }];
    } else {
        cable.conduit = merged.map(r => {
            const a = getPointAtMeters(cable.path, r.from, cumulative);
            const b = getPointAtMeters(cable.path, r.to, cumulative);
            return { a: { lat: a.lat(), lng: a.lng() }, b: { lat: b.lat(), lng: b.lng() } };
        });
    }
    onCableConduitChanged(cable);
}

//Divisão do cabo: cada pedaço leva só a parte tubulada que cai nele
function splitCableConduit(cable, splitMeters) {
    const ranges = getCableConduitRanges(cable);
    const toPoints = (list) => list.map(r => {
        const a = getPointAtMeters(cable.path, r.from);
        const b = getPointAtMeters(cable.path, r.to);
        return { a: { lat: a.lat(), lng: a.lng() }, b: { lat: b.lat(), lng: b.lng() } };
    });
    return {
        first: toPoints(mergeConduitRanges(ranges.filter(r => r.from < splitMeters).map(r => ({ from: r.from, to: Math.min(r.to, splitMeters) })))),
        second: toPoints(mergeConduitRanges(ranges.filter(r => r.to > splitMeters).map(r => ({ from: Math.max(r.from, splitMeters), to: r.to })))),
    };
}

//Metros tubulados de todos os cabos cobrados do projeto (para as ferragens)
function getProjectConduitMeters(projectId) {
    return getBillableProjectCables(projectId).reduce((sum, cable) => sum + getCableConduitMeters(cable), 0);
}

function onCableConduitChanged(cable) {
    if (typeof updateCableSidebarLabel === 'function') updateCableSidebarLabel(cable);
    if (typeof refreshBomAfterProjectChange === 'function') refreshBomAfterProjectChange();
    if (conduitTool?.cable === cable) renderConduitTool();
}

// ---------------------------------------------------------------
// Aéreo × duto: cabos da rota com os trechos aéreos e tubulados
// ---------------------------------------------------------------

//Cabos por onde passam as fibras em uso deste cabo (ele primeiro, depois na ordem da rota)
function getRouteCables(cable, graph = buildFiberGraph()) {
    const found = new Set([cable]);
    getCableFiberUsage(cable).used.forEach(number => {
        traceFiberRoute(graph, cable, number).segments.forEach(seg => {
            const c = savedCables.find(x => x.uid === seg.cableKey) || savedCables.find(x => x.name === seg.cable);
            if (c) found.add(c);
        });
    });
    return [...found].filter(c => c.path?.length >= 2);
}

//Trechos (em metros do traçado) aéreos e tubulados de um cabo
function getCableLaunchRanges(cable) {
    const cumulative = getPathCumulativeMeters(cable.path);
    const total = cumulative[cumulative.length - 1];
    const tubed = cable.conduit?.length ? getCableConduitRanges(cable) : [];
    const aerial = [];
    let cursor = 0;
    tubed.forEach(r => { if (r.from - cursor > 0.5) aerial.push({ from: cursor, to: r.from }); cursor = Math.max(cursor, r.to); });
    if (total - cursor > 0.5) aerial.push({ from: cursor, to: total });
    const sum = list => list.reduce((acc, r) => acc + (r.to - r.from), 0);
    return { cumulative, total, aerial, tubed, aerialMeters: sum(aerial), tubedMeters: sum(tubed) };
}

function clearLaunchHighlight() {
    const store = conduitTool?.launch;
    if (!store) return;
    store.overlays.forEach(o => o.setMap(null));
    store.overlays = [];
    store.dimmed.forEach((opacity, cable) => cable.polyline?.setOptions({ strokeOpacity: opacity }));
    store.dimmed.clear();
}

function drawCableLaunchHighlight(cables) {
    clearLaunchHighlight();
    const store = conduitTool.launch;
    const bounds = new google.maps.LatLngBounds();
    savedCables.forEach(cable => {
        if (!cable.polyline) return;
        store.dimmed.set(cable, cable.polyline.get('strokeOpacity') ?? 1);
        cable.polyline.setOptions({ strokeOpacity: 0.25 });
    });
    cables.forEach(cable => {
        if (!cable.polyline?.getVisible()) return;
        const parts = getCableLaunchRanges(cable);
        const draw = (ranges, color) => ranges.forEach(r => store.overlays.push(new google.maps.Polyline({
            path: getPathSlice(cable.path, r.from, r.to, parts.cumulative),
            map, clickable: false, strokeColor: color, strokeOpacity: 1, strokeWeight: (cable.width || 4) + 4, zIndex: 300,
        })));
        draw(parts.aerial, AERIAL_COLOR);
        draw(parts.tubed, CONDUIT_COLOR);
        cable.path.forEach(p => bounds.extend(p));
    });
    if (!bounds.isEmpty()) map.fitBounds(bounds, { top: 56, right: 340, bottom: 56, left: getMapFocusPadding() });
}

//Todos os cabos do projeto do cabo (os com duto primeiro)
function getProjectLaunchCables(cable) {
    const projectId = typeof getItemProjectId === 'function' ? getItemProjectId(cable) : null;
    const list = projectId ? getProjectItems(projectId).cables : [cable];
    return list.filter(c => c.path?.length >= 2)
        .sort((a, b) => (b.conduit?.length ? 1 : 0) - (a.conduit?.length ? 1 : 0) || (a.name || '').localeCompare(b.name || '', 'pt-BR', { numeric: true }));
}

function renderCableLaunchView(cable) {
    const scope = conduitTool.launch.scope === 'project' ? 'project' : 'route';
    const cables = scope === 'project' ? getProjectLaunchCables(cable) : getRouteCables(cable);
    conduitTool.launch.cables = cables;
    drawCableLaunchHighlight(cables);
    const rows = cables.map(c => ({ cable: c, ...getCableLaunchRanges(c) }));
    const aerial = rows.reduce((sum, r) => sum + r.aerialMeters, 0);
    const tubed = rows.reduce((sum, r) => sum + r.tubedMeters, 0);
    const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
    const meters = value => `${Math.round(value).toLocaleString('pt-BR')} m`;
    const bar = (a, t) => `<span class="route-launch-bar" aria-hidden="true"><b style="width:${pct(a, a + t)}%"></b><em style="width:${pct(t, a + t)}%"></em></span>`;
    const scopeButton = (value, label) => `<button type="button" data-conduit-scope="${value}"${scope === value ? ' class="is-active"' : ''}>${label}</button>`;
    const withDuct = rows.filter(r => r.tubedMeters > 0).length;
    return `
        <div class="route-modes route-launch-scope" role="group" aria-label="Quais cabos">
            ${scopeButton('route', 'Rota deste cabo')}${scopeButton('project', 'Projeto todo')}
        </div>
        <div class="route-launch-total">
            <span><i style="--fiber:${AERIAL_COLOR}"></i>Aéreo <b>${meters(aerial)}</b></span>
            <span><i style="--fiber:${CONDUIT_COLOR}"></i>Em duto <b>${meters(tubed)}</b></span>
        </div>
        ${bar(aerial, tubed)}
        <ul class="route-legend route-launch">${rows.map((r, i) => `
            <li><button type="button" data-conduit-launch="${i}">
                <span class="route-launch__name" title="${escapeHtml(r.cable.name)}"><b>${escapeHtml(r.cable.name)}</b>${r.cable === cable ? ' <small>(este cabo)</small>' : ''}</span>
                <span class="route-launch__meters">${meters(r.aerialMeters)} aéreo${r.tubedMeters ? ` · ${meters(r.tubedMeters)} duto` : ''}</span>
                ${bar(r.aerialMeters, r.tubedMeters)}
            </button></li>`).join('')}</ul>
        <p class="route-note">${scope === 'project'
            ? `${cables.length} cabo${cables.length === 1 ? '' : 's'} no projeto, ${withDuct} com trecho em duto. `
            : (cables.length > 1 ? 'Cabos por onde passam as fibras em uso deste cabo. ' : '')}Medidas do traçado, sem reserva técnica. Clique num cabo para vê-lo no mapa; para marcar o duto dele, abra "Trecho tubulado" naquele cabo.</p>`;
}

// ---------------------------------------------------------------
// Ferramenta: clicar o início e o fim do trecho no cabo
// ---------------------------------------------------------------
let conduitTool = null; //{ cable, tab: 'mark' | 'launch', pendingMeters, listener, pendingMarker, highlights, launch }

function isConduitToolOpen() {
    return !!conduitTool;
}

function openConduitTool(cable) {
    if (!requireEdit('marcar trecho tubulado')) return;
    if (!cable?.path || cable.path.length < 2) return;
    if (isDrawingCable || isAddingMarker || isDrawingPolygon || (typeof isSketchToolActive === 'function' && isSketchToolActive())) {
        showToast('Ferramenta em uso', 'Conclua o que está fazendo no mapa antes de marcar o trecho tubulado.', 'progress');
        return;
    }
    if (conduitTool) closeConduitTool();
    if (typeof isCableRouteOpen === 'function' && isCableRouteOpen()) closeCableRoute();
    conduitTool = { cable, tab: 'mark', pendingMeters: null, listener: null, pendingMarker: null, highlights: [], launch: { overlays: [], dimmed: new Map(), cables: [], scope: 'route' } };
    setAllCablesClickable(false);
    setMapCursor('crosshair');
    conduitTool.listener = map.addListener('click', (event) => handleConduitMapClick(event?.latLng));
    document.getElementById('cableConduitBox').classList.remove('hidden');
    focusMapToCable(cable);
    renderConduitTool();
}

function closeConduitTool() {
    if (!conduitTool) return;
    conduitTool.listener?.remove?.();
    conduitTool.pendingMarker?.setMap(null);
    clearConduitHighlights();
    clearLaunchHighlight();
    conduitTool = null;
    setAllCablesClickable(true);
    setMapCursor('');
    document.getElementById('cableConduitBox')?.classList.add('hidden');
}

function handleConduitMapClick(latLng) {
    if (!conduitTool || !latLng || conduitTool.tab !== 'mark') return;
    const { cable } = conduitTool;
    const found = getMetersAlongPath(cable.path, latLng);
    const reach = Math.max(12, getMetersPerPixelAt(latLng) * 24); //Perto do cabo, em qualquer zoom
    if (found.offset > reach) {
        showToast('Longe do cabo', 'Clique em cima do cabo que está sendo marcado.', 'progress');
        return;
    }
    if (conduitTool.pendingMeters == null) {
        conduitTool.pendingMeters = found.meters;
        const point = getPointAtMeters(cable.path, found.meters);
        conduitTool.pendingMarker?.setMap(null);
        conduitTool.pendingMarker = new google.maps.Marker({
            position: point, map, clickable: false, zIndex: google.maps.Marker.MAX_ZINDEX - 2,
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: CONDUIT_COLOR, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
        });
        renderConduitTool();
        return;
    }
    const from = Math.min(conduitTool.pendingMeters, found.meters);
    const to = Math.max(conduitTool.pendingMeters, found.meters);
    conduitTool.pendingMeters = null;
    conduitTool.pendingMarker?.setMap(null);
    conduitTool.pendingMarker = null;
    if (to - from < 1) {
        renderConduitTool();
        return;
    }
    setCableConduitRanges(cable, [...getCableConduitRanges(cable), { from, to }]);
}

//Destaque roxo dos trechos tubulados, só enquanto a ferramenta está aberta
function clearConduitHighlights() {
    conduitTool?.highlights.forEach(line => line.setMap(null));
    if (conduitTool) conduitTool.highlights = [];
}

function drawConduitHighlights(ranges) {
    clearConduitHighlights();
    const { cable } = conduitTool;
    const cumulative = getPathCumulativeMeters(cable.path);
    const weight = (Number(cable.polyline?.get?.('strokeWeight')) || 4) + 4;
    conduitTool.highlights = ranges.map(r => new google.maps.Polyline({
        path: getPathSlice(cable.path, r.from, r.to, cumulative),
        map, clickable: false, strokeColor: CONDUIT_COLOR, strokeOpacity: 0.9, strokeWeight: weight, zIndex: 1000,
    }));
}

function setConduitTab(tab) {
    if (!conduitTool) return;
    conduitTool.tab = tab === 'launch' ? 'launch' : 'mark';
    conduitTool.pendingMeters = null;
    conduitTool.pendingMarker?.setMap(null);
    conduitTool.pendingMarker = null;
    if (conduitTool.tab === 'mark') clearLaunchHighlight();
    else clearConduitHighlights();
    renderConduitTool();
}

function renderConduitTool() {
    if (!conduitTool) return;
    const box = document.getElementById('cableConduitBox');
    box.querySelectorAll('[data-conduit-tab]').forEach(b => b.classList.toggle('is-active', b.dataset.conduitTab === conduitTool.tab));
    ['conduitMarkPane', 'conduitAllButton', 'conduitClearButton'].forEach(id => document.getElementById(id).classList.toggle('hidden', conduitTool.tab !== 'mark'));
    document.getElementById('conduitLaunchPane').classList.toggle('hidden', conduitTool.tab !== 'launch');
    setMapCursor(conduitTool.tab === 'mark' ? 'crosshair' : '');
    document.getElementById('cableConduitSubtitle').textContent = conduitTool.cable.name;
    if (conduitTool.tab === 'launch') {
        document.getElementById('conduitLaunchPane').innerHTML = renderCableLaunchView(conduitTool.cable);
        return;
    }
    renderConduitMarkPane();
}

function renderConduitMarkPane() {
    const { cable } = conduitTool;
    const ranges = getCableConduitRanges(cable);
    drawConduitHighlights(ranges);
    const drawn = google.maps.geometry.spherical.computeLength(cable.path);
    const conduit = ranges.reduce((sum, r) => sum + (r.to - r.from), 0);
    const aerial = Math.max(0, drawn - conduit);
    const span = getPoleSpanDistance();
    document.getElementById('conduitTotal').textContent = `${Math.round(drawn)} m`;
    document.getElementById('conduitTubed').textContent = `${Math.round(conduit)} m`;
    document.getElementById('conduitAerial').textContent = `${Math.round(aerial)} m`;
    document.getElementById('conduitPoles').textContent = String(aerial > 0 ? Math.ceil(aerial / span) : 0);
    document.getElementById('conduitHelp').textContent = conduitTool.pendingMeters == null
        ? 'Clique no cabo, no mapa, onde o trecho tubulado começa.'
        : 'Agora clique no cabo onde o trecho tubulado termina.';
    const list = document.getElementById('conduitList');
    list.innerHTML = ranges.length
        ? ranges.map((r, i) => `<li><span>Trecho ${i + 1}: ${Math.round(r.from)} m a ${Math.round(r.to)} m <small>(${Math.round(r.to - r.from)} m)</small></span><button type="button" data-conduit-remove="${i}" title="Remover trecho" aria-label="Remover trecho ${i + 1}">&times;</button></li>`).join('')
        : '<li class="conduit-empty">Nenhum trecho tubulado: o cabo vai todo pelos postes.</li>';
    document.getElementById('conduitAllButton').disabled = ranges.length === 1 && ranges[0].to - ranges[0].from >= drawn - 0.5;
    document.getElementById('conduitClearButton').disabled = !ranges.length;
}

function setupConduitTool() {
    const box = document.getElementById('cableConduitBox');
    if (!box) return;
    document.getElementById('closeCableConduitBox').addEventListener('click', closeConduitTool);
    document.getElementById('conduitDoneButton').addEventListener('click', closeConduitTool);
    document.getElementById('conduitAllButton').addEventListener('click', () => {
        if (!conduitTool) return;
        setCableConduitRanges(conduitTool.cable, [{ from: 0, to: google.maps.geometry.spherical.computeLength(conduitTool.cable.path) }]);
    });
    document.getElementById('conduitClearButton').addEventListener('click', () => {
        if (!conduitTool) return;
        conduitTool.pendingMeters = null;
        conduitTool.pendingMarker?.setMap(null);
        setCableConduitRanges(conduitTool.cable, []);
    });
    box.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-conduit-tab]');
        if (tab && conduitTool) {
            setConduitTab(tab.dataset.conduitTab);
            return;
        }
        const scopeButton = e.target.closest('[data-conduit-scope]');
        if (scopeButton && conduitTool) {
            conduitTool.launch.scope = scopeButton.dataset.conduitScope;
            renderConduitTool();
            return;
        }
        const launchRow = e.target.closest('[data-conduit-launch]');
        if (launchRow && conduitTool) {
            const target = conduitTool.launch.cables[Number(launchRow.dataset.conduitLaunch)];
            if (target) focusMapToCable(target);
            return;
        }
        const remove = e.target.closest('[data-conduit-remove]');
        if (!remove || !conduitTool) return;
        const ranges = getCableConduitRanges(conduitTool.cable);
        ranges.splice(Number(remove.dataset.conduitRemove), 1);
        setCableConduitRanges(conduitTool.cable, ranges);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && conduitTool) closeConduitTool(); });
}

document.addEventListener('DOMContentLoaded', setupConduitTool);
