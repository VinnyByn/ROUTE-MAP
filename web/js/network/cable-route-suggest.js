// Sugestão de rota ao desenhar cabo: clicando na caixa A e logo depois na caixa B (sem pontos no meio),
// o sistema busca caminhos pelas ruas (OSRM, o mesmo dos drops) e mostra até 3 opções tracejadas, cada uma
// numa cor. Escolhe a opção no painel; "Usar rota escolhida" troca a reta pelos pontos dela (dá para arrastar
// depois); "Desenhar eu mesmo" descarta e o desenho segue normal. Depende de js/app.js e js/network/clients.js.

let cableRouteSuggestion = null; //{ token, a, b, options: [{ path, length, overlay }], selected, straight }
const CABLE_SUGGEST_COLORS = ['#f59e0b', '#8b5cf6', '#0ea5e9'];
const CABLE_SUGGEST_MAX = 3;
const CABLE_SUGGEST_MIN = 2; //Só uma rota pelas ruas: busca outra passando por um dos lados

function clearCableRouteSuggestion() {
    cableRouteSuggestion?.options?.forEach(o => o.overlay?.setMap(null));
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

//Metros num plano local (para comparar rotas)
function toLocalXY(p, lat0) {
    return [p.lng() * 111320 * Math.cos(lat0), p.lat() * 110540];
}

function distanceToPathXY(point, xy) {
    let best = Infinity;
    for (let i = 1; i < xy.length; i++) {
        const [ax, ay] = xy[i - 1], [bx, by] = xy[i];
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / len2)) : 0;
        best = Math.min(best, Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy)));
    }
    return best;
}

//Rota quase igual a outra (80% do caminho a menos de 15 m dela) não vira opção nova
function isSameCableRoute(path, other) {
    const lat0 = path[0].lat() * Math.PI / 180;
    const otherXY = other.map(p => toLocalXY(p, lat0));
    const spherical = google.maps.geometry.spherical;
    const samples = [];
    for (let i = 1; i < path.length; i++) {
        const steps = Math.max(1, Math.ceil(spherical.computeDistanceBetween(path[i - 1], path[i]) / 10));
        for (let k = 0; k < steps; k++) {
            const f = k / steps;
            samples.push([path[i - 1].lat() + (path[i].lat() - path[i - 1].lat()) * f, path[i - 1].lng() + (path[i].lng() - path[i - 1].lng()) * f]);
        }
    }
    if (!samples.length) return true;
    const near = samples.filter(([lat, lng]) => distanceToPathXY([lng * 111320 * Math.cos(lat0), lat * 110540], otherXY) <= 15).length;
    return near / samples.length >= 0.8;
}

//Ponto ao lado do meio do caminho A-B (para forçar uma rota por outra rua)
function getCableRouteDetourPoint(a, b, side) {
    const spherical = google.maps.geometry.spherical;
    const straight = spherical.computeDistanceBetween(a, b);
    const middle = spherical.interpolate ? spherical.interpolate(a, b, 0.5) : new google.maps.LatLng((a.lat() + b.lat()) / 2, (a.lng() + b.lng()) / 2);
    const offset = Math.min(400, Math.max(60, straight * 0.35));
    const heading = spherical.computeHeading ? spherical.computeHeading(a, b) : 0;
    if (spherical.computeOffset) return spherical.computeOffset(middle, offset, heading + 90 * side);
    //Sem a biblioteca de geometria completa: deslocamento aproximado em graus
    const rad = (heading + 90 * side) * Math.PI / 180;
    return new google.maps.LatLng(middle.lat() + (offset * Math.cos(rad)) / 110540, middle.lng() + (offset * Math.sin(rad)) / (111320 * Math.cos(middle.lat() * Math.PI / 180)));
}

//Até 3 rotas diferentes: as alternativas do OSRM e, faltando, desvios por um lado e pelo outro do meio
async function findCableRouteOptions(a, b) {
    const spherical = google.maps.geometry.spherical;
    const options = [];
    const add = (route) => {
        if (!route?.length || options.length >= CABLE_SUGGEST_MAX) return;
        const path = simplifyPathMeters([a, ...route, b]);
        if (path.length <= 2) return; //A rota é a própria reta
        const length = spherical.computeLength(path);
        if (options.length && length > options[0].length * 2.5) return; //Volta grande demais
        if (options.some(o => isSameCableRoute(path, o.path))) return;
        options.push({ path, length });
    };
    const safe = (promise) => Promise.resolve(promise).catch(() => []);
    (await safe(fetchOsrmRoutes([a, b], { alternatives: CABLE_SUGGEST_MAX }))).forEach(r => add(r.path));
    if (options.length && options.length < CABLE_SUGGEST_MAX) {
        const detours = await Promise.all([1, -1].map(side => safe(fetchOsrmRoutes([a, getCableRouteDetourPoint(a, b, side), b]))));
        detours.forEach(routes => add(routes[0]?.path));
    }
    return options.sort((x, y) => x.length - y.length);
}

function renderCableRouteSuggestion(state) {
    const box = document.getElementById('cableRouteSuggestion');
    if (!box) return;
    box.classList.remove('hidden');
    if (state === 'loading') {
        box.innerHTML = '<p class="route-suggest__text"><span class="route-suggest__spinner" aria-hidden="true"></span>Buscando rotas pelas ruas…</p>';
        return;
    }
    if (state === 'failed') {
        box.innerHTML = '<p class="route-suggest__text">Não deu para sugerir uma rota agora. Continue desenhando normalmente.</p>';
        setTimeout(() => { if (!cableRouteSuggestion?.options) clearCableRouteSuggestion(); }, 4000);
        return;
    }
    const s = cableRouteSuggestion;
    const m = (v) => `${Math.round(v).toLocaleString('pt-BR')} m`;
    const shortest = s.options[0].length;
    const many = s.options.length > 1;
    box.innerHTML = `
        <div class="route-suggest__head"><i aria-hidden="true"></i><strong>${many ? `${s.options.length} rotas sugeridas pelas ruas` : 'Rota sugerida pelas ruas'}</strong></div>
        <p class="route-suggest__text">Em linha reta: ${m(s.straight)}.${many ? ' Escolha a opção e confira no mapa.' : ' Confira no mapa a linha tracejada.'}</p>
        ${many ? `<div class="route-suggest__options" role="radiogroup" aria-label="Rotas sugeridas">${s.options.map((o, i) => `
            <button type="button" class="route-suggest__option${i === s.selected ? ' is-active' : ''}" role="radio" aria-checked="${i === s.selected}" data-route-option="${i}" style="--route:${CABLE_SUGGEST_COLORS[i]}">
                <i aria-hidden="true"></i><b>Opção ${i + 1}</b><span>${m(o.length)}${i === 0 ? ' · mais curta' : ` · +${m(o.length - shortest)}`}</span>
            </button>`).join('')}</div>` : `<p class="route-suggest__text">${m(s.options[0].length)} de traçado.</p>`}
        <div class="route-suggest__actions">
            <button type="button" class="map-tool-btn map-tool-btn--primary" id="acceptCableRouteSuggestion">${many ? 'Usar rota escolhida' : 'Usar rota sugerida'}</button>
            <button type="button" class="map-tool-btn" id="dismissCableRouteSuggestion">Desenhar eu mesmo</button>
        </div>`;
}

//Tracejado de cada opção: a escolhida forte e por cima, as outras apagadas
function styleCableRouteOptions() {
    const s = cableRouteSuggestion;
    s?.options?.forEach((o, i) => {
        const on = i === s.selected;
        const icon = { path: 'M 0,-1 0,1', strokeOpacity: on ? 1 : 0.45, strokeColor: CABLE_SUGGEST_COLORS[i], strokeWeight: on ? 5 : 3, scale: 3 };
        o.overlay?.setOptions({ zIndex: on ? 56 : 55, icons: [{ icon, offset: '0', repeat: '12px' }] });
    });
}

function selectCableRouteOption(index) {
    const s = cableRouteSuggestion;
    if (!s?.options?.[index]) return;
    s.selected = index;
    styleCableRouteOptions();
    document.querySelectorAll('#cableRouteSuggestion [data-route-option]').forEach(b => {
        const on = Number(b.dataset.routeOption) === index;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
}

async function suggestCableDrawRoute() {
    clearCableRouteSuggestion();
    if (!isDrawingCable || editingCableIndex !== null || cableMarkers.length !== 2) return;
    if (!cableDrawAnchors.start || !cableDrawAnchors.end || typeof fetchOsrmRoutes !== 'function') return;
    const a = cableMarkers[0].getPosition();
    const b = cableMarkers[1].getPosition();
    const token = {};
    cableRouteSuggestion = { token, a, b };
    renderCableRouteSuggestion('loading');
    let options = [];
    try { options = await findCableRouteOptions(a, b); } catch (e) { options = []; }
    if (cableRouteSuggestion?.token !== token) return; //Desenho mudou enquanto buscava
    if (!options.length) { renderCableRouteSuggestion('failed'); return; }
    options.forEach(o => {
        o.overlay = new google.maps.Polyline({ path: o.path, map, clickable: false, zIndex: 55, strokeOpacity: 0 });
    });
    cableRouteSuggestion.options = options;
    cableRouteSuggestion.selected = 0;
    cableRouteSuggestion.straight = google.maps.geometry.spherical.computeDistanceBetween(a, b);
    styleCableRouteOptions();
    renderCableRouteSuggestion('ready');
}

function acceptCableRouteSuggestion() {
    const s = cableRouteSuggestion;
    const path = s?.options?.[s.selected]?.path;
    if (!path || !isDrawingCable) return;
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
    const option = e.target.closest('#cableRouteSuggestion [data-route-option]');
    if (option) { selectCableRouteOption(Number(option.dataset.routeOption)); return; }
    if (e.target.closest('#acceptCableRouteSuggestion')) acceptCableRouteSuggestion();
    else if (e.target.closest('#dismissCableRouteSuggestion')) clearCableRouteSuggestion();
});
