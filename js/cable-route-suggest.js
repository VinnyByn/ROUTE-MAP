// Sugestão de rota ao desenhar cabo: clicando na caixa A e logo depois na caixa B (sem pontos no meio),
// o sistema busca um caminho pelas ruas (OSRM, o mesmo dos drops) e mostra tracejado em laranja.
// "Usar rota sugerida" troca a reta pelos pontos da rota (dá para arrastar depois); "Desenhar eu mesmo"
// descarta a sugestão e o desenho segue normal. Depende de script.js e js/clients.js (fetchOsrmRoute).

let cableRouteSuggestion = null; //{ token, a, b, path, overlay, length, straight }
const CABLE_SUGGEST_COLOR = '#f59e0b';

function clearCableRouteSuggestion() {
    cableRouteSuggestion?.overlay?.setMap(null);
    cableRouteSuggestion = null;
    const box = document.getElementById('cableRouteSuggestion');
    if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
}

//Some a sugestão quando o desenho muda (ponto novo, ponta arrastada, cabo fechado)
function syncCableRouteSuggestion() {
    const s = cableRouteSuggestion;
    if (!s) return;
    const same = isDrawingCable && cableMarkers.length === 2
        && cableMarkers[0].getPosition()?.equals(s.a) && cableMarkers[1].getPosition()?.equals(s.b);
    if (!same) clearCableRouteSuggestion();
}

//Douglas-Peucker em metros: menos pontos para arrastar, mesmo desenho
function simplifyPathMeters(path, tolerance = 2.5) {
    if (path.length <= 2) return path.slice();
    const lat0 = path[0].lat() * Math.PI / 180;
    const xy = path.map(p => [p.lng() * 111320 * Math.cos(lat0), p.lat() * 110540]);
    const keep = new Array(path.length).fill(false);
    keep[0] = keep[path.length - 1] = true;
    const stack = [[0, path.length - 1]];
    while (stack.length) {
        const [i, j] = stack.pop();
        const [ax, ay] = xy[i], [bx, by] = xy[j];
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
        let worst = -1, index = -1;
        for (let k = i + 1; k < j; k++) {
            const d = Math.abs(dy * xy[k][0] - dx * xy[k][1] + bx * ay - by * ax) / len;
            if (d > worst) { worst = d; index = k; }
        }
        if (worst > tolerance) { keep[index] = true; stack.push([i, index], [index, j]); }
    }
    return path.filter((p, i) => keep[i]);
}

function renderCableRouteSuggestion(state) {
    const box = document.getElementById('cableRouteSuggestion');
    if (!box) return;
    box.classList.remove('hidden');
    if (state === 'loading') {
        box.innerHTML = '<p class="route-suggest__text"><span class="route-suggest__spinner" aria-hidden="true"></span>Buscando uma rota pelas ruas…</p>';
        return;
    }
    if (state === 'failed') {
        box.innerHTML = '<p class="route-suggest__text">Não deu para sugerir uma rota agora. Continue desenhando normalmente.</p>';
        setTimeout(() => { if (!cableRouteSuggestion?.path) clearCableRouteSuggestion(); }, 4000);
        return;
    }
    const s = cableRouteSuggestion;
    const m = (v) => `${Math.round(v).toLocaleString('pt-BR')} m`;
    box.innerHTML = `
        <div class="route-suggest__head"><i aria-hidden="true"></i><strong>Rota sugerida pelas ruas</strong></div>
        <p class="route-suggest__text">${m(s.length)} de traçado (em linha reta: ${m(s.straight)}). Confira no mapa a linha tracejada.</p>
        <div class="route-suggest__actions">
            <button type="button" class="map-tool-btn map-tool-btn--primary" id="acceptCableRouteSuggestion">Usar rota sugerida</button>
            <button type="button" class="map-tool-btn" id="dismissCableRouteSuggestion">Desenhar eu mesmo</button>
        </div>`;
}

async function suggestCableDrawRoute() {
    clearCableRouteSuggestion();
    if (!isDrawingCable || editingCableIndex !== null || cableMarkers.length !== 2) return;
    if (!cableDrawAnchors.start || !cableDrawAnchors.end || typeof fetchOsrmRoute !== 'function') return;
    const a = cableMarkers[0].getPosition();
    const b = cableMarkers[1].getPosition();
    const token = {};
    cableRouteSuggestion = { token, a, b };
    renderCableRouteSuggestion('loading');
    let route = null;
    try { route = await fetchOsrmRoute(a, b); } catch (e) { route = null; }
    if (cableRouteSuggestion?.token !== token) return; //Desenho mudou enquanto buscava
    if (!route?.length) { renderCableRouteSuggestion('failed'); return; }
    const path = simplifyPathMeters([a, ...route, b]);
    const spherical = google.maps.geometry.spherical;
    if (path.length <= 2) { clearCableRouteSuggestion(); return; } //A rota é a própria reta
    cableRouteSuggestion.path = path;
    cableRouteSuggestion.length = spherical.computeLength(path);
    cableRouteSuggestion.straight = spherical.computeDistanceBetween(a, b);
    cableRouteSuggestion.overlay = new google.maps.Polyline({
        path, map, clickable: false, zIndex: 55, strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: CABLE_SUGGEST_COLOR, strokeWeight: 4, scale: 3 }, offset: '0', repeat: '12px' }],
    });
    renderCableRouteSuggestion('ready');
}

function acceptCableRouteSuggestion() {
    const s = cableRouteSuggestion;
    if (!s?.path || !isDrawingCable) return;
    const path = s.path;
    clearCableRouteSuggestion();
    cableMarkers.forEach(m => m.setMap(null));
    cableMarkers = path.map(position => {
        const vertex = createCableDrawVertexMarker(position);
        wireCableVertexMarker(vertex);
        return vertex;
    });
    updatePolylineFromMarkers();
    showToast('Rota aplicada', 'Arraste os pontos para ajustar o traçado, se precisar, e salve o cabo.');
}

document.addEventListener('click', (e) => {
    if (e.target.closest('#acceptCableRouteSuggestion')) acceptCableRouteSuggestion();
    else if (e.target.closest('#dismissCableRouteSuggestion')) clearCableRouteSuggestion();
});
