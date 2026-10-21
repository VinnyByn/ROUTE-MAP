// Ferramentas de esboço no mapa: régua (distância e área) e polígonos (desenho, cor, edição).
// Depende de js/app.js (map, savedPolygons, barra lateral) e do Google Maps (geometry).

//Ferramentas de esboço no mapa (polígono e régua).
//Substituem a Drawing Library do Google, que foi descontinuada e removida da API.
const RULER_COLOR = '#e11d48';
const DEFAULT_POLYGON_COLOR = '#2dd4bf';
const DEFAULT_POLYGON_OPACITY = 0.35;
const SKETCH_CLOSE_PX = 14;      //Clique a até 14 px do primeiro ponto fecha a área
const SKETCH_SNAP_PX = 10;       //Ponto a até 10 px do canto (8 px da borda) de outro polígono encosta nele
const SKETCH_FREE_STEP_PX = 4;   //Mão livre: um ponto a cada 4 px de arrasto…
const SKETCH_FREE_TOL_PX = 2.5;  //…e depois ficam só os que mudam a forma (diferença de até 2,5 px some)
const POLYGON_DRAW_MODE_KEY = 'routeMapPolygonDrawMode';
let sketchSession = null; //Sessão de desenho ativa: { shape, color, vertices, line, fill, rubber, labels, listeners }
let rulerMode = 'distance'; //'distance' ou 'area'
let polygonDrawMode = 'click'; //Polígono: 'click' (clicar os cantos) ou 'free' (mão livre)
let polygonEdit = null; //Forma fechada em ajuste: { polygon, path, onChange, history, last, quiet, listeners }
let sketchProjectionOverlay = null; //Converte pixel da tela em coordenada (mão livre)
let autoDesignPickingPolygon = false; //Pré-projeto: o próximo clique num polígono usa ele como área
let autoDesignAfterPolygon = false; //Desenhar → Pré-projeto automático: abre o painel ao fechar a área (js/network/auto-design.js)

try { polygonDrawMode = localStorage.getItem(POLYGON_DRAW_MODE_KEY) === 'free' ? 'free' : 'click'; } catch (e) { /* sem armazenamento: começa clicando */ }

function formatDistance(meters) {
    const m = Number(meters) || 0;
    if (m >= 1000) {
        return `${(m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
    }
    return `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m`;
}

//Área sempre em metros quadrados (ex.: 12.480 m²)
function formatArea(squareMeters) {
    const m2 = Number(squareMeters) || 0;
    return `${Math.round(m2).toLocaleString('pt-BR')} m²`;
}

//Rótulo de texto HTML preso a uma coordenada do mapa
function createMapTextLabel(position, text, className) {
    const overlay = new google.maps.OverlayView();
    const div = document.createElement('div');
    div.className = `map-text-label ${className || ''}`.trim();
    div.textContent = text;
    overlay.onAdd = function () { this.getPanes().floatPane.appendChild(div); };
    overlay.draw = function () {
        const point = this.getProjection()?.fromLatLngToDivPixel(position);
        if (!point) return;
        div.style.left = `${point.x}px`;
        div.style.top = `${point.y}px`;
    };
    overlay.onRemove = function () { div.remove(); };
    overlay.setMap(map);
    return overlay;
}

function setAllCablesClickable(isClickable) {
    savedCables.forEach(cableInfo => {
        if (cableInfo.polyline) cableInfo.polyline.setOptions({ clickable: isClickable });
    });
}

function isSketchToolActive() {
    return !!sketchSession;
}

function getSketchVertexIcon(color, isFirstClosable) {
    return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: isFirstClosable ? 7 : 5,
        fillColor: isFirstClosable ? color : '#ffffff',
        fillOpacity: 1,
        strokeColor: isFirstClosable ? '#ffffff' : color,
        strokeWeight: 2
    };
}

//Metros por pixel no zoom atual do mapa (Web Mercator)
function getSketchMetersPerPixel(lat) {
    const zoom = Number(map?.getZoom?.());
    return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, Number.isFinite(zoom) ? zoom : 15);
}

//Plano local em metros em volta de uma latitude (suficiente para um bairro)
function createSketchPlane(lat0) {
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    return { toXY: (p) => [p.lng() * kx, p.lat() * ky], toLatLng: ([x, y]) => new google.maps.LatLng(y / ky, x / kx) };
}

//Ponto onde os segmentos ab e cd se cruzam (pontas encostadas não contam), ou null
function crossSketchSegments(a, b, c, d) {
    const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    const qx = c[0] - a[0], qy = c[1] - a[1];
    const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
    const eps = 1e-9;
    return t > eps && t < 1 - eps && u > eps && u < 1 - eps ? [a[0] + t * rx, a[1] + t * ry] : null;
}

//Primeiro cruzamento entre bordas não vizinhas do contorno fechado: { i, j, at } (borda i = xy[i] → xy[i + 1])
function findSketchRingCrossing(xy) {
    const n = xy.length;
    for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue;
            const at = crossSketchSegments(xy[i], xy[i + 1], xy[j], xy[(j + 1) % n]);
            if (at) return { i, j, at };
        }
    }
    return null;
}

const getSketchRingArea = (xy) => Math.abs(xy.reduce((s, [x, y], i) => { const [nx, ny] = xy[(i + 1) % xy.length]; return s + x * ny - nx * y; }, 0)) / 2;

//Bordas que se cruzam (forma em "8"): a área fica com um pedaço "do avesso"
function hasSketchCrossing(path) {
    const points = path?.getArray ? path.getArray() : (path || []);
    if (points.length < 4) return false;
    const plane = createSketchPlane(points[0].lat());
    return !!findSketchRingCrossing(points.map(plane.toXY));
}

//Mão livre que passou do ponto de partida (ou deu um "8"): fica só o laço maior, sem bordas cruzadas
function untangleSketchRing(path) {
    if (path.length < 4) return path;
    const plane = createSketchPlane(path[0].lat());
    let ring = path.map(latLng => ({ latLng, xy: plane.toXY(latLng) }));
    for (let guard = 0; guard < 20 && ring.length > 3; guard++) {
        const hit = findSketchRingCrossing(ring.map(r => r.xy));
        if (!hit) break;
        const at = { latLng: plane.toLatLng(hit.at), xy: hit.at };
        const inner = [at, ...ring.slice(hit.i + 1, hit.j + 1)];
        const outer = [at, ...ring.slice(hit.j + 1), ...ring.slice(0, hit.i + 1)];
        ring = getSketchRingArea(inner.map(r => r.xy)) >= getSketchRingArea(outer.map(r => r.xy)) ? inner : outer;
    }
    return ring.map(r => r.latLng);
}

//Canto ou borda de outro polígono perto do ponto: o ponto encosta nele (áreas vizinhas sem fresta nem sobreposição).
//skip = polígono em ajuste. Retorna { latLng, kind: 'vertex' | 'edge' } ou null.
function getSketchSnap(latLng, skip = null) {
    if (!latLng || typeof savedPolygons === 'undefined') return null;
    const mpp = getSketchMetersPerPixel(latLng.lat());
    const plane = createSketchPlane(latLng.lat());
    const [px, py] = plane.toXY(latLng);
    const maxVertex = SKETCH_SNAP_PX * mpp, maxEdge = SKETCH_SNAP_PX * 0.8 * mpp;
    let vertex = null, edge = null;
    savedPolygons.forEach(info => {
        const polygon = info.polygonObject;
        if (!polygon || polygon === skip || !polygon.getMap?.() || polygon.getVisible?.() === false) return;
        const points = polygon.getPath().getArray();
        const xy = points.map(plane.toXY);
        xy.forEach(([x, y], k) => {
            const d = Math.hypot(x - px, y - py);
            if (d <= maxVertex && (!vertex || d < vertex.d)) vertex = { d, latLng: points[k] };
            const [bx, by] = xy[(k + 1) % xy.length];
            const dx = bx - x, dy = by - y, len2 = dx * dx + dy * dy;
            if (!len2) return;
            const t = Math.max(0, Math.min(1, ((px - x) * dx + (py - y) * dy) / len2));
            const q = [x + t * dx, y + t * dy];
            const e = Math.hypot(q[0] - px, q[1] - py);
            if (e <= maxEdge && (!edge || e < edge.d)) edge = { d: e, latLng: plane.toLatLng(q) };
        });
    });
    if (vertex) return { latLng: vertex.latLng, kind: 'vertex' };
    return edge ? { latLng: edge.latLng, kind: 'edge' } : null;
}

//Projeção do mapa (pixel da tela → coordenada). Fica pronta logo depois de o mapa desenhar a camada.
function getSketchProjection() {
    if (!sketchProjectionOverlay && map && typeof google.maps.OverlayView === 'function') {
        sketchProjectionOverlay = new google.maps.OverlayView();
        sketchProjectionOverlay.onAdd = () => {};
        sketchProjectionOverlay.draw = () => {};
        sketchProjectionOverlay.onRemove = () => {};
        sketchProjectionOverlay.setMap(map);
    }
    const projection = sketchProjectionOverlay?.getProjection?.();
    return typeof projection?.fromContainerPixelToLatLng === 'function' ? projection : null;
}

//Inicia uma sessão de desenho por cliques. shape: 'line' ou 'area'. snap: encosta em outros polígonos.
function startSketch(options) {
    stopSketch();
    const color = options.color;
    const session = {
        shape: options.shape,
        color,
        snap: !!options.snap,
        showSegmentLabels: !!options.showSegmentLabels,
        onChange: options.onChange || null,
        onClose: options.onClose || null,
        vertices: [],
        labels: [],
        listeners: [],
        lastCursor: null,
        freehand: null,
        stroke: null,
        ignoreClicksUntil: 0
    };
    session.line = new google.maps.Polyline({
        map, path: [], clickable: false, strokeColor: color, strokeWeight: 3, strokeOpacity: 0.95, zIndex: 2000
    });
    session.fill = new google.maps.Polygon({
        map: null, paths: [], clickable: false, strokeWeight: 0,
        fillColor: color, fillOpacity: options.fillOpacity ?? 0.22, zIndex: 1999
    });
    session.rubber = new google.maps.Polyline({
        map, path: [], clickable: false, strokeColor: color, strokeOpacity: 0, zIndex: 2000,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, scale: 2 }, offset: '0', repeat: '9px' }]
    });
    //Traço da mão livre enquanto o botão está apertado
    session.strokeLine = new google.maps.Polyline({
        map, path: [], clickable: false, strokeColor: color, strokeWeight: 3, strokeOpacity: 0.95, zIndex: 2001
    });
    //Argola onde o ponto vai encostar (canto ou borda de outro polígono)
    session.snapDot = new google.maps.Marker({
        map: null, clickable: false, zIndex: 3001,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillOpacity: 0, strokeColor: color, strokeWeight: 2.5 }
    });
    session.listeners.push(map.addListener('click', (e) => handleSketchMapClick(e.latLng)));
    session.listeners.push(map.addListener('dblclick', () => {
        if (session.shape === 'area' && session.onClose && session.vertices.length >= 3) session.onClose();
    }));
    session.listeners.push(map.addListener('mousemove', (e) => updateSketchRubber(e.latLng)));
    session.listeners.push(map.addListener('mouseout', () => updateSketchRubber(null)));
    sketchSession = session;
    //Área que fecha com dois cliques: o duplo clique não dá zoom
    if (session.onClose) map.setOptions({ disableDoubleClickZoom: true });
    getSketchProjection();
    setAllPolygonsClickable(false);
    setAllCablesClickable(false);
    setMapCursor('crosshair');
    refreshSketch(true);
    return session;
}

const isSketchClosingByDoubleClick = () => !!(sketchSession?.onClose && sketchSession.shape === 'area');

function getSketchPath() {
    return sketchSession ? sketchSession.vertices.map(v => v.getPosition()) : [];
}

//Clique perto do primeiro ponto (com 3 ou mais) fecha a área
function isNearSketchStart(latLng) {
    const session = sketchSession;
    if (!session || !latLng || session.shape !== 'area' || !session.onClose || session.vertices.length < 3) return false;
    const first = session.vertices[0].getPosition();
    return google.maps.geometry.spherical.computeDistanceBetween(first, latLng) <= SKETCH_CLOSE_PX * getSketchMetersPerPixel(first.lat());
}

//O que um clique neste ponto faz: fecha a área, encosta em outro polígono ou marca o ponto ali mesmo
function getSketchClickTarget(latLng) {
    if (isNearSketchStart(latLng)) return { latLng: sketchSession.vertices[0].getPosition(), kind: 'close' };
    const snap = sketchSession?.snap ? getSketchSnap(latLng) : null;
    return snap || { latLng, kind: null };
}

function handleSketchMapClick(latLng) {
    const session = sketchSession;
    //O traço da mão livre também gera um clique ao soltar: esse não conta
    if (!session || !latLng || Date.now() < session.ignoreClicksUntil) return;
    const target = getSketchClickTarget(latLng);
    if (target.kind === 'close') session.onClose();
    else addSketchPoint(target.latLng);
}

//Vértice novo, sem redesenhar (quem chama redesenha uma vez no fim)
function addSketchVertex(latLng) {
    const session = sketchSession;
    const vertex = new google.maps.Marker({
        position: latLng,
        map,
        draggable: true,
        zIndex: 3000,
        icon: getSketchVertexIcon(session.color, false)
    });
    vertex.addListener('drag', () => refreshSketch(false));
    vertex.addListener('dragend', () => {
        const snap = session.snap ? getSketchSnap(vertex.getPosition()) : null;
        if (snap) vertex.setPosition(snap.latLng);
        refreshSketch(true);
    });
    vertex.addListener('rightclick', (e) => {
        if (e?.domEvent) e.domEvent.preventDefault();
        removeSketchVertex(vertex);
    });
    vertex.addListener('click', () => {
        //Clicar no primeiro ponto fecha a área
        if (session.shape === 'area' && session.vertices[0] === vertex && session.vertices.length >= 3 && session.onClose) {
            session.onClose();
        }
    });
    session.vertices.push(vertex);
    return vertex;
}

function addSketchPoint(latLng) {
    const session = sketchSession;
    if (!session || !latLng) return;
    const last = session.vertices[session.vertices.length - 1];
    if (last && google.maps.geometry.spherical.computeDistanceBetween(last.getPosition(), latLng) < 0.5) return;
    addSketchVertex(latLng);
    refreshSketch(true);
}

// ---------- Mão livre: com o botão apertado, o arrasto desenha em vez de mover o mapa ----------

//Liga/desliga a mão livre na sessão atual. A rodinha do mouse continua dando zoom.
function setSketchFreehand(on) {
    const session = sketchSession;
    const div = map?.getDiv?.();
    if (!session || !div || !!session.freehand === !!on) return;
    if (on) {
        const handlers = {
            pointerdown: startSketchStroke,
            pointermove: moveSketchStroke,
            pointerup: (e) => endSketchStroke(e, false),
            pointercancel: (e) => endSketchStroke(e, true),
            //O Google Maps não pode começar a arrastar o mapa
            mousedown: (e) => { if (e.button === 0) e.stopPropagation(); },
            touchstart: (e) => { if (e.touches.length === 1) e.stopPropagation(); },
        };
        Object.entries(handlers).forEach(([type, fn]) => div.addEventListener(type, fn, true));
        session.freehand = { div, handlers };
        div.classList.add('is-sketch-freehand');
        map.setOptions({ draggable: false });
    } else {
        Object.entries(session.freehand.handlers).forEach(([type, fn]) => session.freehand.div.removeEventListener(type, fn, true));
        session.freehand.div.classList.remove('is-sketch-freehand');
        session.freehand = null;
        session.stroke = null;
        session.strokeLine.setPath([]);
        map.setOptions({ draggable: true });
    }
    updateSketchRubber(session.lastCursor);
}

function startSketchStroke(e) {
    const session = sketchSession;
    if (!session?.freehand || session.stroke || !e.isPrimary || e.button !== 0) return;
    if (!getSketchProjection()) return; //Mapa ainda sem projeção: o clique segue normal
    e.preventDefault();
    e.stopPropagation();
    try { session.freehand.div.setPointerCapture(e.pointerId); } catch (err) { /* sem captura: o traço para na borda do mapa */ }
    session.stroke = { pointerId: e.pointerId, pixels: [], points: [] };
    addSketchStrokePoint(e);
}

function addSketchStrokePoint(e) {
    const session = sketchSession;
    const stroke = session.stroke;
    const rect = session.freehand.div.getBoundingClientRect();
    const px = [e.clientX - rect.left, e.clientY - rect.top];
    const last = stroke.pixels[stroke.pixels.length - 1];
    if (last && Math.hypot(px[0] - last[0], px[1] - last[1]) < SKETCH_FREE_STEP_PX) return;
    const latLng = getSketchProjection()?.fromContainerPixelToLatLng(new google.maps.Point(px[0], px[1]));
    if (!latLng) return;
    stroke.pixels.push(px);
    stroke.points.push(latLng);
    const path = getSketchPath();
    session.strokeLine.setPath([...path.slice(-1), ...stroke.points]);
}

function moveSketchStroke(e) {
    const session = sketchSession;
    if (!session?.stroke || e.pointerId !== session.stroke.pointerId) return;
    e.stopPropagation();
    addSketchStrokePoint(e);
}

function endSketchStroke(e, cancelled) {
    const session = sketchSession;
    const stroke = session?.stroke;
    if (!stroke || e.pointerId !== stroke.pointerId) return;
    e.stopPropagation();
    if (!cancelled) addSketchStrokePoint(e);
    session.stroke = null;
    session.strokeLine.setPath([]);
    session.ignoreClicksUntil = Date.now() + 400;
    if (cancelled || !stroke.points.length) return;
    //Só um toque (sem arrastar): marca o ponto, como no modo de clicar
    if (stroke.points.length < 3) {
        const target = getSketchClickTarget(stroke.points[0]);
        if (target.kind === 'close') session.onClose();
        else addSketchPoint(target.latLng);
        return;
    }
    addSketchStroke(stroke.points);
}

//Traço solto: vira poucos cantos (os que mudam a forma). Área vazia contornada de uma vez fecha sozinha (laço);
//senão o traço continua do último ponto e fecha se terminar perto do primeiro.
function addSketchStroke(points) {
    const session = sketchSession;
    const mpp = getSketchMetersPerPixel(points[0].lat());
    const near = (a, b) => google.maps.geometry.spherical.computeDistanceBetween(a, b) <= SKETCH_CLOSE_PX * mpp;
    let path = typeof simplifyPathMeters === 'function' ? simplifyPathMeters(points, SKETCH_FREE_TOL_PX * mpp) : points.slice();
    const lasso = session.shape === 'area' && !session.vertices.length;
    const end = path[path.length - 1];
    const endsAtStart = session.vertices.length ? near(end, session.vertices[0].getPosition()) : near(end, path[0]);
    if (endsAtStart && path.length > 3) path.pop();
    if (lasso) path = untangleSketchRing(path);
    const last = session.vertices[session.vertices.length - 1]?.getPosition();
    if (last && near(path[0], last)) path.shift();
    path.forEach(p => addSketchVertex(p));
    refreshSketch(true);
    if (session.shape === 'area' && session.onClose && session.vertices.length >= 3 && (lasso || endsAtStart)) session.onClose();
}

function removeSketchVertex(vertex) {
    const session = sketchSession;
    if (!session) return;
    const index = session.vertices.indexOf(vertex);
    if (index === -1) return;
    session.vertices.splice(index, 1)[0].setMap(null);
    refreshSketch(true);
}

function undoSketchPoint() {
    const session = sketchSession;
    if (!session || !session.vertices.length) return false;
    session.vertices.pop().setMap(null);
    refreshSketch(true);
    return true;
}

function clearSketchPoints() {
    const session = sketchSession;
    if (!session) return;
    session.vertices.forEach(v => v.setMap(null));
    session.vertices = [];
    refreshSketch(true);
}

function setSketchShape(shape) {
    if (!sketchSession) return;
    sketchSession.shape = shape;
    refreshSketch(true);
}

//Redesenha linha, área, rótulos e linha-guia a partir dos vértices
function refreshSketch(updateIcons) {
    const session = sketchSession;
    if (!session) return;
    const path = getSketchPath();
    const isClosedArea = session.shape === 'area' && path.length >= 3;
    session.line.setPath(isClosedArea ? [...path, path[0]] : path);
    session.fill.setPaths(path);
    session.fill.setMap(isClosedArea ? map : null);
    if (updateIcons) {
        session.vertices.forEach((v, i) => {
            v.setIcon(getSketchVertexIcon(session.color, isClosedArea && i === 0 && !!session.onClose));
            v.setTitle(isClosedArea && i === 0 && session.onClose ? 'Clique para fechar a forma' : 'Arraste para ajustar · clique direito remove');
        });
    }
    renderSketchSegmentLabels(path, isClosedArea);
    updateSketchRubber(session.lastCursor);
    if (session.onChange) session.onChange(path);
}

function renderSketchSegmentLabels(path, isClosedArea) {
    const session = sketchSession;
    session.labels.forEach(label => label.setMap(null));
    session.labels = [];
    if (!session.showSegmentLabels || path.length < 2) return;
    const segments = [];
    for (let i = 1; i < path.length; i++) segments.push([path[i - 1], path[i]]);
    if (isClosedArea) segments.push([path[path.length - 1], path[0]]);
    segments.forEach(([a, b]) => {
        const length = google.maps.geometry.spherical.computeDistanceBetween(a, b);
        const midpoint = google.maps.geometry.spherical.interpolate(a, b, 0.5);
        session.labels.push(createMapTextLabel(midpoint, formatDistance(length), 'map-text-label--segment'));
    });
}

//Linha tracejada do último ponto até o cursor (ou até onde o ponto vai encostar)
function updateSketchRubber(cursorLatLng) {
    const session = sketchSession;
    if (!session) return;
    session.lastCursor = cursorLatLng;
    const path = getSketchPath();
    const target = cursorLatLng && !session.freehand ? getSketchClickTarget(cursorLatLng) : null;
    const snapped = target && (target.kind === 'vertex' || target.kind === 'edge');
    if (snapped) session.snapDot.setPosition(target.latLng);
    session.snapDot.setMap(snapped ? map : null);
    if (!cursorLatLng || !path.length || session.freehand) {
        session.rubber.setPath([]);
        if (session.onCursor) session.onCursor(session.freehand ? null : cursorLatLng);
        return;
    }
    const rubberPath = [path[path.length - 1], target.latLng];
    if (session.shape === 'area' && path.length >= 2 && target.kind !== 'close') rubberPath.push(path[0]);
    session.rubber.setPath(rubberPath);
    if (session.onCursor) session.onCursor(cursorLatLng);
}

function stopSketch() {
    const session = sketchSession;
    if (!session) return;
    if (session.freehand) setSketchFreehand(false);
    session.listeners.forEach(listener => google.maps.event.removeListener(listener));
    session.vertices.forEach(v => v.setMap(null));
    session.labels.forEach(label => label.setMap(null));
    session.line.setMap(null);
    session.fill.setMap(null);
    session.rubber.setMap(null);
    session.strokeLine.setMap(null);
    session.snapDot.setMap(null);
    sketchSession = null;
    //O duplo clique que fechou a área ainda pode chegar ao mapa: o zoom volta logo depois
    if (session.onClose) setTimeout(() => { if (!isSketchClosingByDoubleClick()) map.setOptions({ disableDoubleClickZoom: false }); }, 400);
    setAllPolygonsClickable(true);
    setAllCablesClickable(true);
    setMapCursor('');
}

//Clique em marcador durante o esboço: usa a posição exata do marcador como ponto
function handleSketchMarkerClick(markerInfo) {
    if (!sketchSession || !markerInfo?.marker) return false;
    addSketchPoint(markerInfo.marker.getPosition());
    return true;
}

//Desenhando: Ctrl+Z, Backspace e Delete tiram o último ponto. Forma fechada em ajuste: Ctrl+Z desfaz o último ajuste.
function handleSketchKeyboard(event) {
    if ((!sketchSession && !polygonEdit) || isEditableKeyboardTarget(event.target)) return false;
    const key = event.key.toLowerCase();
    const ctrlZ = (event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey;
    if (sketchSession) {
        if (!ctrlZ && key !== 'backspace' && key !== 'delete') return false;
        event.preventDefault();
        undoSketchPoint();
        return true;
    }
    if (!ctrlZ) return false;
    event.preventDefault();
    undoPolygonEdit();
    return true;
}

// ---------------------------------------------------------------
// Forma fechada em ajuste (polígono novo, polígono salvo ou área do pré-projeto): o canto arrastado encosta em
// polígono vizinho, clique direito num canto tira o ponto e Ctrl+Z desfaz o último ajuste
// ---------------------------------------------------------------

function watchPolygonPath(polygon, onChange = updatePolygonStats) {
    clearPolygonEditListeners();
    const path = polygon.getPath();
    const edit = { polygon, path, onChange, history: [], last: path.getArray().slice(), quiet: false, listeners: [] };
    const changed = (index) => {
        if (edit.quiet) return;
        const moved = Number.isInteger(index) && index < path.getLength() ? path.getAt(index) : null;
        const snap = moved ? getSketchSnap(moved, polygon) : null;
        if (snap && !snap.latLng.equals(moved)) {
            edit.quiet = true;
            path.setAt(index, snap.latLng);
            edit.quiet = false;
        }
        edit.history.push(edit.last);
        if (edit.history.length > 50) edit.history.shift();
        edit.last = path.getArray().slice();
        edit.onChange(path);
    };
    edit.listeners.push(
        path.addListener('set_at', changed),
        path.addListener('insert_at', changed),
        path.addListener('remove_at', () => changed(null)),
        polygon.addListener('rightclick', (e) => {
            if (e?.vertex == null || path.getLength() <= 3) return;
            path.removeAt(e.vertex);
        })
    );
    polygonEdit = edit;
    onChange(path);
}

function clearPolygonEditListeners() {
    polygonEdit?.listeners.forEach(listener => google.maps.event.removeListener(listener));
    polygonEdit = null;
}

const isPolygonEditActive = () => !!polygonEdit;

//Troca os cantos da forma em ajuste (sem passar pelo "encostar")
function setPolygonEditPath(points) {
    const edit = polygonEdit;
    if (!edit) return false;
    edit.quiet = true;
    edit.path.clear();
    points.forEach(p => edit.path.push(p));
    edit.quiet = false;
    edit.last = edit.path.getArray().slice();
    edit.onChange(edit.path);
    return true;
}

function undoPolygonEdit() {
    const previous = polygonEdit?.history.pop();
    return previous ? setPolygonEditPath(previous) : false;
}

//Volta a forma para um caminho dado (Ctrl+Z desfaz a volta)
function resetPolygonEdit(points) {
    if (!polygonEdit) return false;
    polygonEdit.history.push(polygonEdit.last);
    return setPolygonEditPath(points);
}

// ---------------------------------------------------------------
// Polígono
// ---------------------------------------------------------------

function getPolygonFormValues() {
    const opacityInput = document.getElementById('polygonOpacity');
    return {
        name: document.getElementById('polygonName').value.trim(),
        color: document.getElementById('polygonColor').value,
        opacity: Math.min(1, Math.max(0, Number(opacityInput.value) / 100))
    };
}

function setPolygonBoxPhase(phase) {
    //phase: 'drawing' (marcando pontos) ou 'editing' (forma fechada, ajustando vértices)
    const box = document.getElementById('polygonDrawingBox');
    box.dataset.phase = phase;
    document.getElementById('polygonDrawMode').classList.toggle('hidden', phase !== 'drawing');
    //Área do pré-projeto: fechar a forma já segue para o pré-projeto ("Continuar")
    document.getElementById('polygonFinishButton').classList.toggle('hidden', phase !== 'drawing' || autoDesignAfterPolygon);
    renderPolygonHelp();
}

function renderPolygonHelp() {
    const phase = document.getElementById('polygonDrawingBox').dataset.phase;
    const free = polygonDrawMode === 'free';
    document.querySelectorAll('#polygonDrawMode [data-polygon-mode]').forEach(button => {
        const active = button.dataset.polygonMode === polygonDrawMode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const close = autoDesignAfterPolygon ? 'Ao fechar, abre o pré-projeto (lá dá para ajustar a área).' : '';
    document.getElementById('polygonHelp').textContent = phase !== 'drawing'
        ? 'Arraste os cantos para ajustar e as bolinhas do meio para criar cantos novos. Clique direito tira um canto; Ctrl+Z desfaz. Perto de outro polígono, o canto encosta nele.'
        : free
            ? `Segure o botão do mouse e contorne a área: ao soltar, a forma fecha sozinha. A rodinha do mouse dá zoom; para arrastar o mapa, volte para "Clicar os cantos". ${close}`
            : `Clique no mapa para marcar os cantos. Para fechar: clique no primeiro ponto, dê dois cliques ou aperte Enter. Perto de outro polígono, o ponto encosta nele. Clique direito tira um ponto; Ctrl+Z desfaz. ${close}`;
}

//Clicar os cantos ou mão livre (fica guardado para a próxima vez)
function setPolygonDrawMode(mode) {
    polygonDrawMode = mode === 'free' ? 'free' : 'click';
    try { localStorage.setItem(POLYGON_DRAW_MODE_KEY, polygonDrawMode); } catch (e) { /* sem armazenamento: vale só agora */ }
    if (sketchSession && isDrawingPolygon) setSketchFreehand(polygonDrawMode === 'free');
    renderPolygonHelp();
}

//Área do pré-projeto: sem nome, cor e opacidade (o polígono sai do projeto ao criar a rede); o botão vira "Continuar"
function setPolygonBoxPurpose(forAutoDesign) {
    //Para o pré-projeto: nome e cor ficam para depois, a opacidade continua (dá para ver o mapa por baixo da área)
    const fields = document.getElementById('polygonStyleFields');
    fields.querySelectorAll('.map-tool-field:not(.pg-opacity-field)').forEach(field => field.classList.toggle('hidden', forAutoDesign));
    document.getElementById('savePolygonButton').textContent = forAutoDesign ? 'Continuar' : 'Salvar';
}

function updatePolygonStats(path) {
    const statsEl = document.getElementById('polygonStats');
    if (!statsEl) return;
    const points = path ? (Array.isArray(path) ? path : path.getArray()) : [];
    const warn = document.getElementById('polygonWarn');
    const crossed = hasSketchCrossing(points);
    if (warn) {
        warn.textContent = crossed ? 'As bordas se cruzam (forma em "8"): arraste um canto para desfazer o cruzamento.' : '';
        warn.classList.toggle('hidden', !crossed);
    }
    if (points.length < 3) {
        statsEl.innerHTML = `<div><dt>Vértices</dt><dd>${points.length}</dd></div><div><dt>Área</dt><dd>—</dd></div><div><dt>Perímetro</dt><dd>—</dd></div>`;
        document.getElementById('polygonFinishButton').disabled = true;
        return;
    }
    const area = google.maps.geometry.spherical.computeArea(points);
    const perimeter = google.maps.geometry.spherical.computeLength([...points, points[0]]);
    statsEl.innerHTML = `<div><dt>Vértices</dt><dd>${points.length}</dd></div><div><dt>Área</dt><dd>${formatArea(area)}</dd></div><div><dt>Perímetro</dt><dd>${formatDistance(perimeter)}</dd></div>`;
    document.getElementById('polygonFinishButton').disabled = false;
}

const POLYGON_SWATCHES = ['#2dd4bf', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#64748b'];

function renderPolygonSwatches() {
    const wrap = document.getElementById('polygonSwatches');
    if (!wrap) return;
    wrap.innerHTML = POLYGON_SWATCHES.map(color => `<button type="button" class="pg-swatch" data-color="${color}" role="radio" style="--swatch:${color}" title="${color}" aria-label="Cor ${color}"></button>`).join('');
    wrap.querySelectorAll('.pg-swatch').forEach(button => button.addEventListener('click', () => {
        document.getElementById('polygonColor').value = button.dataset.color;
        applyPolygonFormStyle();
    }));
}

function syncPolygonStyleControls(color, opacity) {
    document.querySelectorAll('#polygonSwatches .pg-swatch').forEach(button => {
        const active = button.dataset.color.toLowerCase() === String(color).toLowerCase();
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    document.getElementById('polygonOpacityValue').textContent = `${Math.round(opacity * 100)}%`;
    const preview = document.getElementById('polygonFillPreview');
    if (preview) {
        preview.style.setProperty('--fill-color', color);
        preview.style.setProperty('--fill-opacity', String(opacity));
    }
    const range = document.getElementById('polygonOpacity');
    range?.style.setProperty('--fill', `${Math.round(opacity * 100)}%`);
    range?.style.setProperty('--track-color', color);
}

//Aplica cor e opacidade do formulário no polígono em edição (mapa e ícone da barra lateral, ao vivo)
function applyPolygonFormStyle() {
    const { color, opacity } = getPolygonFormValues();
    syncPolygonStyleControls(color, opacity);
    const editingInfo = editingPolygonIndex !== null ? savedPolygons[editingPolygonIndex] : null;
    const target = tempPolygon || editingInfo?.polygonObject || null;
    if (target) target.setOptions({ fillColor: color, strokeColor: color, fillOpacity: opacity });
    editingInfo?.listItem?.querySelector('.ge-icon-polygon')?.style.setProperty('--ge-item-color', color);
    if (sketchSession && isDrawingPolygon) {
        sketchSession.color = color;
        sketchSession.line.setOptions({ strokeColor: color });
        sketchSession.fill.setOptions({ fillColor: color, fillOpacity: opacity });
        sketchSession.rubber.setOptions({ strokeColor: color });
        refreshSketch(true);
    }
}

function openPolygonBox(title, values) {
    const box = document.getElementById('polygonDrawingBox');
    document.getElementById('polygonBoxTitle').textContent = title;
    document.getElementById('polygonName').value = values.name;
    document.getElementById('polygonColor').value = values.color;
    document.getElementById('polygonOpacity').value = Math.round(values.opacity * 100);
    syncPolygonStyleControls(values.color, values.opacity);
    box.classList.remove('hidden');
    document.getElementById('toolsDropdown').classList.remove('show');
}

//Inicia a ferramenta de desenho de polígono. forAutoDesign: área do pré-projeto (ao fechar, abre o pré-projeto)
function startPolygonTool(initialPath, { forAutoDesign = false } = {}) {
    if (!requireEdit('desenhar polígonos')) return;
    if (isDrawingCable || isAddingMarker) {
        showAlert("Atenção", "Finalize a ação atual antes de desenhar um polígono.");
        return;
    }
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione uma pasta de projeto para salvar o polígono.");
        return;
    }
    if (isMeasuring) stopRuler();
    if (typeof isAutoDesignOpen === 'function' && isAutoDesignOpen()) closeAutoDesign();
    cancelPolygonDrawing();
    isDrawingPolygon = true;
    editingPolygonIndex = null;
    autoDesignAfterPolygon = forAutoDesign;
    openPolygonBox(forAutoDesign ? 'Área do pré-projeto' : 'Novo polígono', {
        name: forAutoDesign ? 'Área do pré-projeto' : `Polígono ${savedPolygons.length + 1}`,
        color: DEFAULT_POLYGON_COLOR,
        opacity: DEFAULT_POLYGON_OPACITY
    });
    setPolygonBoxPurpose(forAutoDesign);
    document.getElementById('deletePolygonButton').classList.add('hidden');
    setPolygonBoxPhase('drawing');
    startSketch({
        shape: 'area',
        color: DEFAULT_POLYGON_COLOR,
        fillOpacity: DEFAULT_POLYGON_OPACITY,
        showSegmentLabels: false,
        snap: true,
        onChange: updatePolygonStats,
        onClose: finishPolygonSketch
    });
    setSketchFreehand(polygonDrawMode === 'free');
    if (Array.isArray(initialPath)) {
        initialPath.forEach(point => addSketchPoint(point));
        if (initialPath.length >= 3) finishPolygonSketch();
    }
}

//Fecha a forma desenhada e passa para o ajuste dos vértices. Área do pré-projeto: segue direto para o pré-projeto
//(a área continua ajustável lá). fromSave: chamado pelo próprio "Salvar"/"Continuar".
function finishPolygonSketch(options) {
    const fromSave = options?.fromSave === true;
    const path = getSketchPath();
    if (path.length < 3) {
        showAlert("Atenção", "Marque pelo menos 3 pontos para formar um polígono.");
        return false;
    }
    const { color, opacity } = getPolygonFormValues();
    stopSketch();
    if (tempPolygon) tempPolygon.setMap(null);
    tempPolygon = new google.maps.Polygon({
        paths: path,
        map,
        fillColor: color,
        strokeColor: color,
        fillOpacity: opacity,
        strokeWeight: 2,
        editable: true,
        zIndex: 1
    });
    setAllPolygonsClickable(false);
    watchPolygonPath(tempPolygon);
    setPolygonBoxPhase('editing');
    if (autoDesignAfterPolygon && !fromSave) savePolygon();
    return true;
}

function wirePolygonInteractions(polygonInfo) {
    polygonInfo.polygonObject.addListener('click', (e) => (e?.domEvent?.shiftKey && typeof toggleMapSelection === 'function') ? toggleMapSelection(polygonInfo) : openPolygonEditor(polygonInfo));
    //Em ajuste, o clique direito num canto tira o ponto (watchPolygonPath): sem menu
    polygonInfo.polygonObject.addListener('rightclick', (e) => { if (!polygonInfo.polygonObject.getEditable?.()) openMapItemMenu('polygon', polygonInfo, e?.domEvent); });
    const nameEl = polygonInfo.listItem.querySelector('.item-name');
    if (nameEl) nameEl.addEventListener('click', () => openPolygonEditor(polygonInfo));
    //Clique na linha da barra lateral: fica selecionado para Ctrl+C
    polygonInfo.listItem.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest('input, button')) return;
        if (typeof selectSidebarItem === 'function') selectSidebarItem(polygonInfo.listItem, { type: 'polygon', polygonInfo });
    });
    const visCb = polygonInfo.listItem.querySelector('.ge-vis-checkbox');
    if (visCb) wireItemVisibilityCheckbox(visCb, polygonInfo.polygonObject);
}

//Salva um polígono novo ou atualiza um existente
function savePolygon() {
    const { name, color, opacity } = getPolygonFormValues();
    if (!name) {
        showAlert("Erro", "Por favor, dê um nome ao polígono.");
        return;
    }
    //Se ainda está marcando pontos, fecha a forma automaticamente
    if (sketchSession && isDrawingPolygon && !finishPolygonSketch({ fromSave: true })) return;

    const openAutoDesignAfter = autoDesignAfterPolygon;
    const isNewPolygon = editingPolygonIndex === null;
    let savedPolygonInfo = null;
    if (editingPolygonIndex !== null) {
        const polygonInfo = savedPolygons[editingPolygonIndex];
        savedPolygonInfo = polygonInfo;
        const polygon = polygonInfo.polygonObject;
        polygonInfo.name = name;
        polygonInfo.color = color;
        polygonInfo.opacity = opacity;
        polygonInfo.path = polygon.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() }));
        polygon.setOptions({ fillColor: color, strokeColor: color, fillOpacity: opacity, editable: false });
        refreshPolygonSidebarLabel(polygonInfo);
        editingPolygonIndex = null; //Evita que o cancelamento reverta o que foi salvo
    } else {
        if (!tempPolygon) {
            showAlert("Erro", "Desenhe um polígono no mapa antes de salvar.");
            return;
        }
        const polygon = tempPolygon;
        tempPolygon = null;
        polygon.setOptions({ clickable: true, editable: false, fillColor: color, strokeColor: color, fillOpacity: opacity });
        const template = document.getElementById('polygon-template');
        const li = template.content.cloneNode(true).querySelector('li');
        enableDragAndDropForItem(li);
        document.getElementById(activeFolderId).appendChild(li);
        const polygonInfo = {
            folderId: activeFolderId,
            name,
            color,
            opacity,
            path: polygon.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() })),
            polygonObject: polygon,
            listItem: li
        };
        savedPolygons.push(polygonInfo);
        refreshPolygonSidebarLabel(polygonInfo);
        wirePolygonInteractions(polygonInfo);
        savedPolygonInfo = polygonInfo;
    }
    cancelPolygonDrawing();
    if (openAutoDesignAfter && savedPolygonInfo && typeof openAutoDesign === 'function') openAutoDesign(savedPolygonInfo, { drawn: isNewPolygon });
}

//Abre o editor do polígono (aceita o objeto ou o índice)
function openPolygonEditor(polygonRef) {
    const polygonInfo = typeof polygonRef === 'number' ? savedPolygons[polygonRef] : polygonRef;
    if (!polygonInfo) return;
    if (autoDesignPickingPolygon && typeof openAutoDesign === 'function') {
        autoDesignPickingPolygon = false;
        setMapCursor('');
        openAutoDesign(polygonInfo);
        return;
    }
    //Pré-projeto aberto: a área dele se ajusta no próprio mapa; outro polígono, só depois de fechar o pré-projeto
    if (typeof isAutoDesignOpen === 'function' && isAutoDesignOpen()) {
        if (autoDesign?.polygon !== polygonInfo) showToast('Pré-projeto aberto', 'Feche o pré-projeto para editar outro polígono.', 'progress');
        return;
    }
    if (!AppSession.canEdit) {
        const area = google.maps.geometry.spherical.computeArea(polygonInfo.polygonObject.getPath());
        showToast(polygonInfo.name || 'Polígono', `Área ${formatArea(area)}`, 'progress');
        return;
    }
    const index = savedPolygons.indexOf(polygonInfo);
    if (index === -1) {
        showAlert("Erro", "Não foi possível encontrar o polígono para edição.");
        return;
    }
    if (isMeasuring) stopRuler();
    cancelPolygonDrawing();
    cancelCableButton.click();
    editingPolygonIndex = index;
    isDrawingPolygon = true;
    //Guarda o estado original para poder cancelar
    polygonInfo._originalStyle = { color: polygonInfo.color, opacity: polygonInfo.opacity ?? 0.5 };
    openPolygonBox('Editar polígono', {
        name: polygonInfo.name,
        color: polygonInfo.color,
        opacity: polygonInfo.opacity ?? 0.5
    });
    document.getElementById('deletePolygonButton').classList.remove('hidden');
    setPolygonBoxPhase('editing');
    setAllPolygonsClickable(false);
    polygonInfo.polygonObject.setEditable(true);
    watchPolygonPath(polygonInfo.polygonObject);
}

//Cancela o desenho ou a edição de polígono
function cancelPolygonDrawing() {
    if (sketchSession && isDrawingPolygon) stopSketch();
    if (isDrawingPolygon) clearPolygonEditListeners(); //A área do pré-projeto em ajuste não é desta ferramenta
    if (tempPolygon) {
        tempPolygon.setMap(null);
        tempPolygon = null;
    }
    //Reverte a edição não salva
    if (editingPolygonIndex !== null) {
        const polygonInfo = savedPolygons[editingPolygonIndex];
        if (polygonInfo) {
            const original = polygonInfo._originalStyle || { color: polygonInfo.color, opacity: polygonInfo.opacity ?? 0.5 };
            polygonInfo.polygonObject.setPath(polygonInfo.path);
            polygonInfo.polygonObject.setEditable(false);
            polygonInfo.polygonObject.setOptions({ fillColor: original.color, strokeColor: original.color, fillOpacity: original.opacity });
            polygonInfo.listItem?.querySelector('.ge-icon-polygon')?.style.setProperty('--ge-item-color', original.color);
        }
    }
    document.getElementById('polygonDrawingBox').classList.add('hidden');
    setAllPolygonsClickable(true);
    setMapCursor("");
    isDrawingPolygon = false;
    editingPolygonIndex = null;
    autoDesignAfterPolygon = false;
    setPolygonBoxPurpose(false);
}

//Controle de cliques em polígonos, desenhos sobre o polígono
function setAllPolygonsClickable(isClickable) {
    savedPolygons.forEach(polygonInfo => {
        if (polygonInfo.polygonObject) {
            polygonInfo.polygonObject.setOptions({ clickable: isClickable });
        }
    });
}

//Exclui o polígono que está sendo editado
function deletePolygon() {
    if (editingPolygonIndex === null) return;
    const polygonInfo = savedPolygons[editingPolygonIndex];
    showConfirm('Excluir Polígono', `Tem certeza que deseja excluir "${polygonInfo.name}"?`, () => {
        clearPolygonEditListeners();
        polygonInfo.polygonObject.setMap(null);
        polygonInfo.listItem.remove();
        savedPolygons.splice(savedPolygons.indexOf(polygonInfo), 1);
        editingPolygonIndex = null;
        cancelPolygonDrawing();
    });
}

// ---------------------------------------------------------------
// Régua de medição
// ---------------------------------------------------------------

function getRulerMeasurements(path) {
    const points = path || getSketchPath();
    const spherical = google.maps.geometry.spherical;
    const length = points.length >= 2 ? spherical.computeLength(points) : 0;
    const lastSegment = points.length >= 2 ? spherical.computeDistanceBetween(points[points.length - 2], points[points.length - 1]) : 0;
    const area = points.length >= 3 ? spherical.computeArea(points) : 0;
    const perimeter = points.length >= 3 ? spherical.computeLength([...points, points[0]]) : 0;
    const poleSpan = getPoleSpanDistance();
    const estimatedPoles = length > 0 ? Math.ceil(length / poleSpan) + 1 : 0;
    return { points: points.length, length, lastSegment, area, perimeter, poleSpan, estimatedPoles };
}

function renderRulerStats(path) {
    const m = getRulerMeasurements(path);
    const statsEl = document.getElementById('rulerStats');
    const valueEl = document.getElementById('rulerDistance');
    const labelEl = document.getElementById('rulerPrimaryLabel');
    const toPolygonBtn = document.getElementById('rulerToPolygonButton');
    const stat = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
    if (rulerMode === 'area') {
        labelEl.textContent = 'Área';
        valueEl.textContent = m.points >= 3 ? formatArea(m.area) : '—';
        statsEl.innerHTML = stat('Perímetro', m.points >= 3 ? formatDistance(m.perimeter) : '—') + stat('Pontos', m.points);
        toPolygonBtn.classList.toggle('hidden', m.points < 3);
    } else {
        labelEl.textContent = 'Distância total';
        valueEl.textContent = formatDistance(m.length);
        statsEl.innerHTML = stat('Último trecho', formatDistance(m.lastSegment))
            + stat('Pontos', m.points)
            + stat(`Postes (${m.poleSpan} m)`, m.estimatedPoles ? `≈ ${m.estimatedPoles}` : '—');
        toPolygonBtn.classList.add('hidden');
    }
    document.getElementById('rulerUndoButton').disabled = m.points === 0;
    document.getElementById('rulerClearButton').disabled = m.points === 0;
    document.getElementById('rulerCopyButton').disabled = rulerMode === 'area' ? m.points < 3 : m.points < 2;
}

//Mostra a distância até o cursor enquanto o usuário mira o próximo ponto
function renderRulerCursorHint(cursorLatLng) {
    const hintEl = document.getElementById('rulerCursorHint');
    if (!hintEl) return;
    const path = getSketchPath();
    if (!cursorLatLng || !path.length || rulerMode !== 'distance') {
        hintEl.textContent = '';
        return;
    }
    const spherical = google.maps.geometry.spherical;
    const toCursor = spherical.computeDistanceBetween(path[path.length - 1], cursorLatLng);
    const total = (path.length >= 2 ? spherical.computeLength(path) : 0) + toCursor;
    hintEl.textContent = `Com o próximo ponto: ${formatDistance(total)} (+${formatDistance(toCursor)})`;
}

function setRulerMode(mode) {
    rulerMode = mode === 'area' ? 'area' : 'distance';
    document.querySelectorAll('#rulerBox [data-ruler-mode]').forEach(btn => {
        const active = btn.dataset.rulerMode === rulerMode;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    setSketchShape(rulerMode === 'area' ? 'area' : 'line');
    renderRulerStats();
    renderRulerCursorHint(sketchSession?.lastCursor || null);
}

//Inicia a ferramenta de régua de medição
function startRuler() {
    if (isDrawingCable || isAddingMarker) {
        showAlert("Atenção", "Finalize a ação atual antes de usar a régua.");
        return;
    }
    if (isDrawingPolygon) cancelPolygonDrawing();
    document.getElementById('toolsDropdown').classList.remove('show');
    document.getElementById('rulerBox').classList.remove('hidden');
    isMeasuring = true;
    const session = startSketch({
        shape: rulerMode === 'area' ? 'area' : 'line',
        color: RULER_COLOR,
        fillOpacity: 0.15,
        showSegmentLabels: true,
        onChange: renderRulerStats
    });
    session.onCursor = renderRulerCursorHint;
    setRulerMode(rulerMode);
}

function copyRulerMeasurement() {
    const m = getRulerMeasurements();
    const text = rulerMode === 'area'
        ? `Área: ${formatArea(m.area)} | Perímetro: ${formatDistance(m.perimeter)} | Pontos: ${m.points}`
        : `Distância: ${formatDistance(m.length)} | Pontos: ${m.points} | Postes estimados (vão ${m.poleSpan} m): ${m.estimatedPoles}`;
    const button = document.getElementById('rulerCopyButton');
    const done = () => {
        const original = button.dataset.label || button.textContent;
        button.dataset.label = original;
        button.textContent = 'Copiado!';
        setTimeout(() => { button.textContent = original; }, 1400);
    };
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => showAlert('Medição', text));
    } else {
        showAlert('Medição', text);
    }
}

//Transforma a área medida em um polígono do projeto
function convertRulerToPolygon() {
    const path = getSketchPath();
    if (path.length < 3) return;
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione uma pasta de projeto para salvar o polígono.");
        return;
    }
    stopRuler();
    startPolygonTool(path);
}

//Para a ferramenta de régua e limpa os elementos do mapa
function stopRuler() {
    if (sketchSession && isMeasuring) stopSketch();
    isMeasuring = false;
    document.getElementById('rulerBox').classList.add('hidden');
    const hintEl = document.getElementById('rulerCursorHint');
    if (hintEl) hintEl.textContent = '';
}

function setupMapSketchTools() {
    document.getElementById('drawPolygonButton').addEventListener('click', (e) => {
        e.preventDefault();
        startPolygonTool();
    });
    document.getElementById('savePolygonButton').addEventListener('click', savePolygon);
    document.getElementById('cancelPolygonButton').addEventListener('click', cancelPolygonDrawing);
    document.getElementById('closePolygonBoxButton').addEventListener('click', cancelPolygonDrawing);
    document.getElementById('deletePolygonButton').addEventListener('click', deletePolygon);
    document.getElementById('polygonUndoButton').addEventListener('click', () => (sketchSession ? undoSketchPoint() : undoPolygonEdit()));
    document.getElementById('polygonFinishButton').addEventListener('click', finishPolygonSketch);
    document.querySelectorAll('#polygonDrawMode [data-polygon-mode]').forEach(button => {
        button.addEventListener('click', () => setPolygonDrawMode(button.dataset.polygonMode));
    });
    renderPolygonSwatches();
    document.getElementById('polygonColor').addEventListener('input', applyPolygonFormStyle);
    document.getElementById('polygonOpacity').addEventListener('input', applyPolygonFormStyle);

    document.getElementById('rulerButton').addEventListener('click', (e) => {
        e.preventDefault();
        startRuler();
    });
    document.getElementById('cancelRulerButton').addEventListener('click', stopRuler);
    document.getElementById('closeRulerBoxButton').addEventListener('click', stopRuler);
    document.getElementById('rulerUndoButton').addEventListener('click', undoSketchPoint);
    document.getElementById('rulerClearButton').addEventListener('click', clearSketchPoints);
    document.getElementById('rulerCopyButton').addEventListener('click', copyRulerMeasurement);
    document.getElementById('rulerToPolygonButton').addEventListener('click', convertRulerToPolygon);
    document.querySelectorAll('#rulerBox [data-ruler-mode]').forEach(btn => {
        btn.addEventListener('click', () => setRulerMode(btn.dataset.rulerMode));
    });
}
