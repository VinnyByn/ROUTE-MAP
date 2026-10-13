// Formato dos tiles de postes (compartilhado entre o gerador e os testes; o site tem a mesma conta em js/map/poles-layer.js).
// Web Mercator, zoom 13 (~4,6 km de lado em MG). Cada tile é um arquivo .bin com pares Uint16 little-endian (x, y):
// a posição do poste dentro do tile em 65536 passos (~7 cm). 4 bytes por poste, sem cabeçalho.

export const TILE_ZOOM = 13;
export const TILE_STEPS = 65536;
const N = 2 ** TILE_ZOOM;

//Longitude/latitude → coordenada do tile em fração (ex.: 5823.41)
export function lngToTileX(lng) {
    return ((lng + 180) / 360) * N;
}

export function latToTileY(lat) {
    const rad = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * N;
}

export function tileXToLng(x) {
    return (x / N) * 360 - 180;
}

export function tileYToLat(y) {
    return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / N))) * 180) / Math.PI;
}

//Ponto → { tx, ty, qx, qy }
export function quantize(lng, lat) {
    const fx = lngToTileX(lng), fy = latToTileY(lat);
    const tx = Math.floor(fx), ty = Math.floor(fy);
    return {
        tx, ty,
        qx: Math.min(TILE_STEPS - 1, Math.floor((fx - tx) * TILE_STEPS)),
        qy: Math.min(TILE_STEPS - 1, Math.floor((fy - ty) * TILE_STEPS)),
    };
}

//Índice dos tiles que existem: cabeçalho Uint16 LE (x0, y0, largura, altura) + 1 bit por tile, linha a linha.
//Para a Cemig (MG inteira) são ~8 KB.
export function encodeIndex(keys) {
    const xs = keys.map(k => k[0]), ys = keys.map(k => k[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
    const buf = Buffer.alloc(8 + Math.ceil((w * h) / 8));
    buf.writeUInt16LE(x0, 0); buf.writeUInt16LE(y0, 2); buf.writeUInt16LE(w, 4); buf.writeUInt16LE(h, 6);
    for (const [x, y] of keys) { const i = (y - y0) * w + (x - x0); buf[8 + (i >> 3)] |= 1 << (i & 7); }
    return buf;
}

export function indexHas(buf, x, y) {
    const x0 = buf.readUInt16LE(0), y0 = buf.readUInt16LE(2), w = buf.readUInt16LE(4), h = buf.readUInt16LE(6);
    if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false;
    const i = (y - y0) * w + (x - x0);
    return (buf[8 + (i >> 3)] & (1 << (i & 7))) !== 0;
}

//Bytes de um tile → [[lat, lng], ...]
export function decodeTile(tx, ty, bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const points = [];
    for (let i = 0; i + 3 < bytes.byteLength; i += 4) {
        const x = tx + (view.getUint16(i, true) + 0.5) / TILE_STEPS;
        const y = ty + (view.getUint16(i + 2, true) + 0.5) / TILE_STEPS;
        points.push([tileYToLat(y), tileXToLng(x)]);
    }
    return points;
}
