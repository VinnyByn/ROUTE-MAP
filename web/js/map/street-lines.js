// Traçado das ruas (OpenStreetMap) de uma área, para o pré-projeto automático nunca passar cabo por cima de casas.
// Fonte: blocos vetoriais públicos do OpenFreeMap (formato MVT, camada "transportation", zoom 14, sem chave, em CDN).
// Se o OpenFreeMap falhar, tenta o Overpass (mesmos dados do OpenStreetMap, servidores públicos mais instáveis).
// getStreetLinesInBounds(sul, oeste, norte, leste) → [[[lat, lng], ...], ...] (uma lista por trecho de rua) ou null.
// Cada linha leva a classe da via em .cls (OpenMapTiles: primary, secondary, tertiary, minor, service, track, path…).
// A lista também traz .water: rios, córregos, canais e contornos de lagos (para o cabo evitar atravessar água).

const STREET_TILES_ZOOM = 14;
const STREET_TILEJSON = 'https://tiles.openfreemap.org/planet';
const STREET_OVERPASS_SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
//Classes de via do OpenMapTiles que viram rede aérea: todas, menos as que não existem ou não são de chão
const STREET_SKIP_CLASSES = new Set(['ferry', 'rail', 'transit', 'aerialway', 'busway', 'bus_guideway', 'raceway', 'pier']);
const STREET_MAX_TILES = 400; //~ 30 × 30 km: área maior é recusada
const STREET_WATERWAY_CLASSES = new Set(['river', 'stream', 'canal']); //valas e drenos pequenos ficam de fora

const streetTiles = { template: null, cache: new Map() };

// ---------- leitor de MVT (protobuf) mínimo: só o que precisamos ----------

function readStreetVarint(buf, pos) {
    let result = 0, shift = 0, b;
    do {
        b = buf[pos.i++];
        result += (b & 0x7f) * 2 ** shift;
        shift += 7;
    } while (b & 0x80);
    return result;
}

//Percorre os campos de uma mensagem protobuf: fn(campo, tipo, valor ou {start, end})
function eachStreetField(buf, start, end, fn) {
    const pos = { i: start };
    while (pos.i < end) {
        const key = readStreetVarint(buf, pos);
        const field = Math.floor(key / 8), type = key & 7;
        if (type === 0) fn(field, type, readStreetVarint(buf, pos));
        else if (type === 2) {
            const len = readStreetVarint(buf, pos);
            fn(field, type, { start: pos.i, end: pos.i + len });
            pos.i += len;
        } else if (type === 1) pos.i += 8;
        else if (type === 5) pos.i += 4;
        else throw new Error('MVT inválido');
    }
}

function decodeStreetString(buf, { start, end }) {
    return new TextDecoder().decode(buf.subarray(start, end));
}

//Ruas (camada "transportation") de um bloco z/x/y → [[[lat, lng], ...], ...], com .water = rios ("waterway") e
//contornos de lagos/rios largos ("water"); trecho em túnel/galeria não conta como água no caminho
function decodeStreetTile(buf, z, x, y) {
    const lines = [];
    const water = [];
    lines.water = water;
    eachStreetField(buf, 0, buf.length, (field, type, layer) => {
        if (field !== 3 || type !== 2) return;
        let name = '', extent = 4096;
        const keys = [], values = [], features = [];
        eachStreetField(buf, layer.start, layer.end, (f, t, v) => {
            if (f === 1) name = decodeStreetString(buf, v);
            else if (f === 2) features.push(v);
            else if (f === 3) keys.push(decodeStreetString(buf, v));
            else if (f === 4) {
                let value = null;
                eachStreetField(buf, v.start, v.end, (vf, vt, vv) => { if (vf === 1) value = decodeStreetString(buf, vv); });
                values.push(value);
            } else if (f === 5) extent = v;
        });
        const kind = name === 'transportation' ? 'street' : name === 'waterway' ? 'waterway' : name === 'water' ? 'water' : null;
        if (!kind) return;
        const classKey = keys.indexOf('class'), brunnelKey = keys.indexOf('brunnel');
        const n = 2 ** z;
        const toLatLng = (px, py) => {
            const wx = (x + px / extent) / n, wy = (y + py / extent) / n;
            return [Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180 / Math.PI, wx * 360 - 180];
        };
        for (const feature of features) {
            let geomType = 0, tags = null, geometry = null;
            eachStreetField(buf, feature.start, feature.end, (f, t, v) => {
                if (f === 2) tags = v;
                else if (f === 3) geomType = v;
                else if (f === 4) geometry = v;
            });
            if (!geometry || geomType !== (kind === 'water' ? 3 : 2)) continue; //linhas (ruas, rios) ou polígonos (lagos)
            let cls = null, brunnel = null;
            if (tags) {
                const pos = { i: tags.start };
                while (pos.i < tags.end) {
                    const k = readStreetVarint(buf, pos), v = readStreetVarint(buf, pos);
                    if (k === classKey) cls = values[v];
                    else if (k === brunnelKey) brunnel = values[v];
                }
            }
            if (kind === 'street' && cls && STREET_SKIP_CLASSES.has(cls)) continue;
            if (kind === 'waterway' && (!STREET_WATERWAY_CLASSES.has(cls) || brunnel === 'tunnel')) continue;
            if (kind === 'water' && cls === 'swimming_pool') continue;
            const target = kind === 'street' ? lines : water;
            const push = (line) => { if (line?.length >= 2) { line.cls = cls; target.push(line); } };
            //Comandos: MoveTo(1) / LineTo(2), coordenadas em zigzag relativas
            const pos = { i: geometry.start };
            let cx = 0, cy = 0, current = null;
            while (pos.i < geometry.end) {
                const cmd = readStreetVarint(buf, pos);
                const id = cmd & 7, count = Math.floor(cmd / 8);
                if (id === 7) { if (current?.length) current.push(current[0]); continue; } //fecha o contorno do lago
                for (let k = 0; k < count; k++) {
                    const dx = readStreetVarint(buf, pos), dy = readStreetVarint(buf, pos);
                    cx += (dx >>> 1) ^ -(dx & 1);
                    cy += (dy >>> 1) ^ -(dy & 1);
                    if (id === 1) { push(current); current = [toLatLng(cx, cy)]; }
                    else current.push(toLatLng(cx, cy));
                }
            }
            push(current);
        }
    });
    return lines;
}

// ---------- busca ----------

async function getStreetTileTemplate() {
    if (!streetTiles.template) {
        streetTiles.template = fetch(STREET_TILEJSON).then(r => (r.ok ? r.json() : null)).then(j => j?.tiles?.[0] || null).catch(() => null);
    }
    const template = await streetTiles.template;
    if (!template) streetTiles.template = null; //tenta de novo na próxima vez
    return template;
}

async function fetchStreetTile(template, x, y) {
    const key = `${x}/${y}`;
    if (!streetTiles.cache.has(key)) {
        const url = template.replace('{z}', STREET_TILES_ZOOM).replace('{x}', x).replace('{y}', y);
        streetTiles.cache.set(key, fetch(url)
            .then(r => (r.ok ? r.arrayBuffer() : r.status === 404 ? new ArrayBuffer(0) : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then(b => decodeStreetTile(new Uint8Array(b), STREET_TILES_ZOOM, x, y))
            .catch(e => { streetTiles.cache.delete(key); throw e; }));
    }
    return streetTiles.cache.get(key);
}

async function fetchStreetLinesFromTiles(south, west, north, east) {
    const template = await getStreetTileTemplate();
    if (!template) return null;
    const n = 2 ** STREET_TILES_ZOOM;
    const tx = (lng) => Math.floor(((lng + 180) / 360) * n);
    const ty = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
    const x0 = tx(west), x1 = tx(east), y0 = ty(north), y1 = ty(south);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > STREET_MAX_TILES) return null;
    const jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(fetchStreetTile(template, x, y));
    try {
        const tiles = await Promise.all(jobs);
        const lines = tiles.flat();
        lines.water = tiles.flatMap(t => t.water || []);
        return lines;
    } catch (e) {
        return null;
    }
}

//Tag highway do OpenStreetMap → classe do OpenMapTiles (a mesma dos blocos)
function getStreetClassFromHighway(highway) {
    const h = String(highway || '').replace(/_link$/, '');
    if (['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'service', 'track'].includes(h)) return h;
    if (['residential', 'unclassified', 'living_street', 'road'].includes(h)) return 'minor';
    return 'path';
}

async function fetchStreetLinesFromOverpass(south, west, north, east) {
    const bbox = [south, west, north, east].map(v => v.toFixed(6)).join(',');
    const query = `[out:json][timeout:25];(way["highway"]["highway"!~"^(proposed|construction|abandoned|razed|platform|raceway|elevator)$"]["area"!="yes"](${bbox});`
        + `way["waterway"~"^(river|stream|canal)$"]["tunnel"!~"."](${bbox});way["natural"="water"](${bbox}););out geom;`;
    for (const url of STREET_OVERPASS_SERVERS) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 25000);
            const response = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: controller.signal });
            clearTimeout(timer);
            if (!response.ok) continue;
            const data = await response.json();
            const lines = [];
            lines.water = [];
            (data.elements || []).filter(w => w.geometry?.length >= 2).forEach(w => {
                const line = w.geometry.map(g => [g.lat, g.lon]);
                if (w.tags?.highway) {
                    line.cls = getStreetClassFromHighway(w.tags.highway);
                    lines.push(line);
                } else {
                    line.cls = w.tags?.waterway || 'water';
                    lines.water.push(line);
                }
            });
            return lines;
        } catch (e) {
            //Tenta o próximo servidor
        }
    }
    return null;
}

//Ruas da área: OpenFreeMap (rápido, em CDN) e, se falhar, Overpass. null = nenhuma fonte respondeu.
async function getStreetLinesInBounds(south, west, north, east) {
    return (await fetchStreetLinesFromTiles(south, west, north, east)) || fetchStreetLinesFromOverpass(south, west, north, east);
}
