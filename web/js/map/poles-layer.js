// Postes da rede (BDGD/ANEEL): base estática publicada junto com o site em postes/ (gerada por tools/postes, que
// baixa a BDGD sozinho quando a ANEEL publica uma versão nova, 1x por ano). Nada de servidor nem API.
//
// - Camada do mapa "Postes da rede" (Mapa/Satélite → Postes da rede): os postes viram uma camada de blocos do próprio
//   Google Maps (overlayMapTypes), como as ruas. O Google cuida do zoom e do arrasto: os pontos ficam presos ao mapa e
//   não somem nem piscam. Cada bloco é um <canvas> de 256 px desenhado uma vez.
// - getPolesInBounds(): postes de uma área, usado pelo pré-projeto automático (js/network/auto-design.js).
//
// Formato (igual a tools/postes/tiles.mjs): tiles Web Mercator de zoom 13 em postes/<versão>/<x>/<y>.bin, pares
// Uint16 little-endian (x, y) com a posição dentro do tile em 65536 passos. postes/<versão>/indice.bin diz quais tiles
// existem: tile vazio nem é pedido.
// Depende de js/app.js (map, mapReady, showAlert, showToast).

const POLES_TILE_ZOOM = 13;
const POLES_TILE_STEPS = 65536;
const POLES_LAYER_MIN_ZOOM = 14;
const POLES_LAYER_KEY = 'routemap.polesLayer';
//Tamanho do ponto por zoom (de longe menor, para não virar um borrão)
const getPolesRadius = (zoom) => (zoom >= 18 ? 3.5 : zoom >= 17 ? 3 : zoom >= 16 ? 2.5 : zoom >= 15 ? 1.8 : 1.3);
//Cores: no mapa claro, cinza; no satélite e no tema escuro, ponto claro com borda escura (aparece sobre a foto)
function getPolesStyle() {
    const satellite = ['satellite', 'hybrid'].includes(map.getMapTypeId?.());
    if (satellite) return { fill: 'rgba(250, 204, 21, 0.95)', stroke: 'rgba(17, 24, 39, 0.9)' };
    if (document.documentElement.getAttribute('data-theme') === 'dark') return { fill: 'rgba(203, 213, 225, 0.95)', stroke: 'rgba(15, 23, 42, 0.9)' };
    return { fill: 'rgba(71, 85, 105, 0.9)', stroke: 'rgba(255, 255, 255, 0.95)' };
}
const POLES_TILE_CACHE = 400;          //Tiles decodificados guardados na memória (os mais antigos saem primeiro)
const POLES_MAX_TILES_PER_QUERY = 600; //getPolesInBounds: área maior que isso (~12.000 km²) é recusada

const polesLayer = {
    enabled: true, mapType: null, warned: new Set(),
    manifest: undefined, manifestPromise: null, index: null, tiles: new Map(), pending: new Map(),
};
polesLayer.enabled = (() => { try { return localStorage.getItem(POLES_LAYER_KEY) !== 'off'; } catch (e) { return true; } })();

// ---------- base (manifesto + tiles) ----------

//Web Mercator em "coordenada de mundo" do Google (0..256)
const polesWorldX = (lng) => ((lng + 180) / 360) * 256;
const polesWorldY = (lat) => {
    const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256;
};
const polesWorldToLng = (x) => (x / 256) * 360 - 180;
const polesWorldToLat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - y / 128))) * 180) / Math.PI;
const POLES_TILE_WORLD = 256 / 2 ** POLES_TILE_ZOOM; //Tamanho de um tile em coordenada de mundo

//manifest.json diz qual versão está publicada (null = base ainda não publicada neste site); o índice vem junto
function loadPolesManifest() {
    if (!polesLayer.manifestPromise) {
        polesLayer.manifestPromise = fetch('postes/manifest.json', { cache: 'no-cache' })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null)
            .then(async (m) => {
                if (!m || !m.versao) return (polesLayer.manifest = null);
                try {
                    const r = await fetch(`postes/${m.versao}/indice.bin`);
                    if (r.ok) {
                        const buf = await r.arrayBuffer(), head = new DataView(buf, 0, 8);
                        polesLayer.index = { x0: head.getUint16(0, true), y0: head.getUint16(2, true), w: head.getUint16(4, true), h: head.getUint16(6, true), bits: new Uint8Array(buf, 8) };
                    }
                } catch (e) { /* sem índice: pede os tiles e trata 404 como vazio */ }
                return (polesLayer.manifest = m);
            });
    }
    return polesLayer.manifestPromise;
}

function polesTileExists(tx, ty) {
    const ix = polesLayer.index;
    if (!ix) return true;
    if (tx < ix.x0 || ty < ix.y0 || tx >= ix.x0 + ix.w || ty >= ix.y0 + ix.h) return false;
    const i = (ty - ix.y0) * ix.w + (tx - ix.x0);
    return (ix.bits[i >> 3] & (1 << (i & 7))) !== 0;
}

//Tile decodificado: coordenadas de mundo (Float64, para não perder precisão no zoom máximo)
function decodePolesTile(tx, ty, buffer) {
    const raw = new DataView(buffer);
    const count = buffer.byteLength >> 2;
    const xs = new Float64Array(count), ys = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        xs[i] = (tx + (raw.getUint16(i * 4, true) + 0.5) / POLES_TILE_STEPS) * POLES_TILE_WORLD;
        ys[i] = (ty + (raw.getUint16(i * 4 + 2, true) + 0.5) / POLES_TILE_STEPS) * POLES_TILE_WORLD;
    }
    return { xs, ys, count };
}

const POLES_EMPTY_TILE = { xs: new Float64Array(0), ys: new Float64Array(0), count: 0 };

function loadPolesTile(tx, ty) {
    const key = `${tx}/${ty}`;
    const cached = polesLayer.tiles.get(key);
    if (cached) { polesLayer.tiles.delete(key); polesLayer.tiles.set(key, cached); return Promise.resolve(cached); } //LRU
    if (polesLayer.pending.has(key)) return polesLayer.pending.get(key);
    if (!polesTileExists(tx, ty)) { polesLayer.tiles.set(key, POLES_EMPTY_TILE); return Promise.resolve(POLES_EMPTY_TILE); }
    const promise = fetch(`postes/${polesLayer.manifest.versao}/${key}.bin`)
        .then(r => (r.ok ? r.arrayBuffer().then(b => decodePolesTile(tx, ty, b)) : POLES_EMPTY_TILE)) //404 = tile sem postes
        .catch(() => null) //sem rede: não guarda, tenta de novo depois
        .then(tile => {
            polesLayer.pending.delete(key);
            if (tile) {
                polesLayer.tiles.set(key, tile);
                while (polesLayer.tiles.size > POLES_TILE_CACHE) polesLayer.tiles.delete(polesLayer.tiles.keys().next().value);
            }
            return tile || POLES_EMPTY_TILE;
        });
    polesLayer.pending.set(key, promise);
    return promise;
}

//Tiles (x, y) que cobrem um retângulo em coordenada de mundo
function polesTileRange(minX, minY, maxX, maxY) {
    const last = 2 ** POLES_TILE_ZOOM - 1;
    const clamp = (v) => Math.max(0, Math.min(last, Math.floor(v / POLES_TILE_WORLD)));
    return { x0: clamp(minX), x1: clamp(maxX), y0: clamp(minY), y1: clamp(maxY) };
}

//Postes dentro de um retângulo (graus): { points: [[lat, lng], ...], manifest } — manifest null = base não publicada
async function getPolesInBounds(south, west, north, east) {
    const manifest = await loadPolesManifest();
    if (!manifest) return { points: [], manifest: null };
    const minX = polesWorldX(west), maxX = polesWorldX(east), minY = polesWorldY(north), maxY = polesWorldY(south);
    const r = polesTileRange(minX, minY, maxX, maxY);
    if ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > POLES_MAX_TILES_PER_QUERY) throw new Error('Área grande demais para buscar postes.');
    const jobs = [];
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) jobs.push(loadPolesTile(x, y));
    const points = [];
    for (const tile of await Promise.all(jobs)) {
        for (let i = 0; i < tile.count; i++) {
            const x = tile.xs[i], y = tile.ys[i];
            if (x >= minX && x <= maxX && y >= minY && y <= maxY) points.push([polesWorldToLat(y), polesWorldToLng(x)]);
        }
    }
    return { points, manifest };
}

// ---------- camada do mapa (blocos do Google Maps) ----------

function warnPolesLayer(key, message) {
    if (polesLayer.warned.has(key)) return;
    polesLayer.warned.add(key);
    showToast('Postes da rede', message, 'progress');
}

function getPolesLayerPref() {
    return polesLayer.enabled;
}

//Desenha num bloco de 256 px (zoom z, posição x/y) os postes do tile de dados que o contém
function paintPolesMapTile(canvas, x, y, zoom, data) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 256, 256);
    if (!data.count) return;
    const scale = 2 ** zoom;
    const wx0 = (x * 256) / scale, wy0 = (y * 256) / scale;
    const radius = getPolesRadius(zoom), edge = radius + 1;
    const style = getPolesStyle();
    const { xs, ys, count } = data;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
        const px = (xs[i] - wx0) * scale, py = (ys[i] - wy0) * scale;
        if (px < -edge || py < -edge || px > 256 + edge || py > 256 + edge) continue;
        ctx.moveTo(px + radius, py);
        ctx.arc(px, py, radius, 0, Math.PI * 2);
    }
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.lineWidth = zoom >= 16 ? 1 : 0.75;
    ctx.strokeStyle = style.stroke;
    ctx.stroke();
}

function createPolesMapType() {
    return {
        tileSize: new google.maps.Size(256, 256),
        maxZoom: 22,
        name: 'Postes da rede',
        alt: 'Postes da rede (BDGD/ANEEL)',
        getTile(coord, zoom, ownerDocument) {
            const canvas = ownerDocument.createElement('canvas');
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = canvas.height = Math.round(256 * dpr);
            canvas.style.cssText = 'width:256px;height:256px;pointer-events:none;';
            if (zoom < POLES_LAYER_MIN_ZOOM) return canvas;
            const n = 2 ** zoom;
            const x = ((coord.x % n) + n) % n, y = coord.y;
            if (y < 0 || y >= n) return canvas;
            const shift = zoom - POLES_TILE_ZOOM;
            const tx = x >> shift, ty = y >> shift;
            const cached = polesLayer.tiles.get(`${tx}/${ty}`);
            if (cached) paintPolesMapTile(canvas, x, y, zoom, cached);
            else loadPolesTile(tx, ty).then(data => { if (!canvas.released) paintPolesMapTile(canvas, x, y, zoom, data); });
            return canvas;
        },
        releaseTile(tile) { tile.released = true; },
    };
}

function removePolesMapType() {
    const list = map?.overlayMapTypes;
    if (!list || !polesLayer.mapType) return;
    for (let i = list.getLength() - 1; i >= 0; i--) if (list.getAt(i) === polesLayer.mapType) list.removeAt(i);
}

//Liga (ou redesenha, ao trocar Mapa/Satélite ou o tema) a camada de postes
async function showPolesMapType() {
    if (!map?.overlayMapTypes || !polesLayer.enabled) return;
    if (!(await loadPolesManifest()) || !polesLayer.enabled) return;
    removePolesMapType();
    polesLayer.mapType = createPolesMapType();
    map.overlayMapTypes.push(polesLayer.mapType);
}

async function setPolesLayerVisible(visible) {
    polesLayer.enabled = visible;
    try { localStorage.setItem(POLES_LAYER_KEY, visible ? 'on' : 'off'); } catch (e) { /* sem armazenamento */ }
    if (!visible) { removePolesMapType(); return; }
    if (!(await loadPolesManifest())) {
        showAlert('Postes da rede', 'A base de postes (BDGD/ANEEL) ainda não foi publicada neste site. Ela é gerada sozinha pelo GitHub (workflow "Postes da BDGD").');
        return;
    }
    if (map && map.getZoom() < POLES_LAYER_MIN_ZOOM) warnPolesLayer('zoom', `Aproxime o zoom (nível ${POLES_LAYER_MIN_ZOOM} ou mais) para ver os postes.`);
    showPolesMapType();
}

if (typeof mapReady !== 'undefined' && mapReady?.then) {
    mapReady.then(() => {
        showPolesMapType();
        //A cor muda com Mapa/Satélite e com o tema: refaz os blocos (os dados já estão na memória, é instantâneo)
        map.addListener('maptypeid_changed', () => { if (polesLayer.enabled) showPolesMapType(); });
        new MutationObserver(() => { if (polesLayer.enabled) showPolesMapType(); })
            .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    });
}
