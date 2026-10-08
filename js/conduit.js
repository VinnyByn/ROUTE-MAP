// Trecho tubulado: parte de um cabo que passa dentro de duto/subduto em vez de ir pelos postes.
// Esse trecho não entra na conta de postes, então não gera plaqueta, abraçadeira BAP, SUPA nem alça preformada.
// O cabo continua inteiro na lista de materiais (a fibra é a mesma); só as ferragens de poste diminuem.
// No mapa o cabo não muda de aparência: o trecho aparece só no cartão ao passar o mouse e no editor do cabo.
// Guardado no cabo como cable.conduit = [{ all: true }] (cabo todo) ou [{ a: {lat,lng}, b: {lat,lng} }] (trecho).
// Os extremos são pontos no mapa, não metros: se o traçado do cabo mudar, o trecho acompanha.
// Depende de script.js, js/cable-split.js (projectOnCablePath) e js/sidebar-actions.js.

const CONDUIT_COLOR = '#7c3aed';

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

//Parte (0 a 1) do traçado dos cabos que vai em duto. Aplicada à metragem cobrada, para o cabo
//todo tubulado zerar as ferragens mesmo com a metragem arredondada para cima.
function getCablesConduitShare(cables) {
    let drawn = 0;
    let tubed = 0;
    cables.forEach(cable => {
        if (!cable.path || cable.path.length < 2) return;
        drawn += google.maps.geometry.spherical.computeLength(cable.path);
        tubed += cable.conduit?.length ? getCableConduitMeters(cable) : 0;
    });
    if (drawn <= 0 || tubed <= 0) return 0;
    return tubed >= drawn - 0.5 ? 1 : tubed / drawn;
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
// Ferramenta: clicar o início e o fim do trecho no cabo
// ---------------------------------------------------------------
let conduitTool = null; //{ cable, pendingMeters, listener, pendingMarker }

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
    conduitTool = { cable, pendingMeters: null, listener: null, pendingMarker: null };
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
    conduitTool = null;
    setAllCablesClickable(true);
    setMapCursor('');
    document.getElementById('cableConduitBox')?.classList.add('hidden');
}

function handleConduitMapClick(latLng) {
    if (!conduitTool || !latLng) return;
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

function renderConduitTool() {
    if (!conduitTool) return;
    const { cable } = conduitTool;
    const ranges = getCableConduitRanges(cable);
    const drawn = google.maps.geometry.spherical.computeLength(cable.path);
    const conduit = ranges.reduce((sum, r) => sum + (r.to - r.from), 0);
    const aerial = Math.max(0, drawn - conduit);
    const span = getPoleSpanDistance();
    document.getElementById('cableConduitSubtitle').textContent = cable.name;
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
        const remove = e.target.closest('[data-conduit-remove]');
        if (!remove || !conduitTool) return;
        const ranges = getCableConduitRanges(conduitTool.cable);
        ranges.splice(Number(remove.dataset.conduitRemove), 1);
        setCableConduitRanges(conduitTool.cable, ranges);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && conduitTool) closeConduitTool(); });
}

document.addEventListener('DOMContentLoaded', setupConduitTool);
