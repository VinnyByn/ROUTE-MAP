// Testes do gerador de postes e da leitura no site (roda no CI: node tools/postes/testar.mjs). Sem dependências.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { escolherArquivo } from './bdgd.mjs';
import { quantize, decodeTile, TILE_ZOOM, indexHas } from './tiles.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const distance = ([lat1, lng1], [lat2, lng2]) => Math.hypot((lat1 - lat2) * 111320, (lng1 - lng2) * 111320 * Math.cos((lat1 * Math.PI) / 180));
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`✓ ${name}`); };

const postes = [[-20.1394, -44.8872], [-20.1395, -44.8873], [-20.2001, -44.9002], [-19.9167, -43.9345], [-21.5, -46.1]];

await test('posição volta com erro de centímetros', () => {
    for (const [lat, lng] of postes) {
        const { tx, ty, qx, qy } = quantize(lng, lat);
        const buf = Buffer.alloc(4);
        buf.writeUInt16LE(qx, 0); buf.writeUInt16LE(qy, 2);
        const [back] = decodeTile(tx, ty, buf);
        assert.ok(distance(back, [lat, lng]) < 0.1, `erro de ${distance(back, [lat, lng])} m`);
    }
});

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'postes-'));
const csv = path.join(out, 'postes.csv');
fs.writeFileSync(csv, 'X,Y,TIP_PN\n' + postes.map(([lat, lng]) => `${lng},${lat},POS`).join('\n') + '\nlixo,,POS\n');
execFileSync(process.execPath, [path.join(here, 'gerar-tiles.mjs'), '--entrada', csv, '--saida', path.join(out, 'postes'), '--data-base', '2025-12-31', '--arquivo', 'Teste'], { stdio: 'pipe' });
const manifest = JSON.parse(fs.readFileSync(path.join(out, 'postes', 'manifest.json'), 'utf8'));

await test('gerador: manifesto e tiles', () => {
    assert.equal(manifest.total, 5);
    assert.equal(manifest.versao, 'v-2025-12-31');
    assert.equal(manifest.zoom, TILE_ZOOM);
    const { tx, ty } = quantize(-44.8872, -20.1394);
    assert.equal(fs.statSync(path.join(out, 'postes', manifest.versao, String(tx), `${ty}.bin`)).size, 8); //os 2 postes de Divinópolis
    const indice = fs.readFileSync(path.join(out, 'postes', manifest.versao, 'indice.bin'));
    assert.ok(indexHas(indice, tx, ty));
    assert.ok(!indexHas(indice, tx + 1, ty));
});

await test('site: getPolesInBounds lê os tiles gerados', async () => {
    const files = path.join(out, 'postes');
    const requested = [];
    const fakeFetch = async (url) => {
        requested.push(url);
        const file = path.join(files, url.replace(/^postes\//, ''));
        if (!fs.existsSync(file)) return { ok: false, status: 404 };
        const data = fs.readFileSync(file);
        return { ok: true, json: async () => JSON.parse(data), arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.length) };
    };
    const ctx = { fetch: fakeFetch, localStorage: { getItem: () => null, setItem() {} }, console, Promise, Math, Map, Set, Float64Array, Uint8Array, DataView, Error };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'web', 'js', 'map', 'poles-layer.js'), 'utf8') + '\n;globalThis.getPolesInBounds = getPolesInBounds;', ctx);
    const { points, manifest: m } = await ctx.getPolesInBounds(-20.25, -44.95, -20.1, -44.85);
    assert.equal(m.data_base, '2025-12-31');
    assert.equal(points.length, 3);
    for (const p of postes.slice(0, 3)) assert.ok(points.some(q => distance(q, p) < 0.1));
    const none = await ctx.getPolesInBounds(-10.1, -40.1, -10, -40);
    assert.equal(none.points.length, 0);
    assert.ok(requested.every(u => !u.endsWith('.bin') || u.endsWith('indice.bin') || fs.existsSync(path.join(files, u.replace(/^postes\//, '')))), 'pediu tile que não existe');
});

await test('escolhe a BDGD mais nova da distribuidora', () => {
    const itens = [
        { properties: { id: 'a', title: 'Cemig-D_4950_2024-12-31_V11', type: 'File Geodatabase', tags: ['CEMIG-D'], modified: 5 } },
        { properties: { id: 'b', title: 'Cemig-D_4950_2025-12-31_V11_20260821-0106', type: 'File Geodatabase', tags: ['CEMIG-D'], modified: 9 } },
        { properties: { id: 'c', title: 'Cpfl_2026-06-30', type: 'File Geodatabase', tags: ['CPFL'], modified: 99 } },
        { properties: { id: 'd', title: 'Cemig-D_2026-01-01', type: 'Feature Service', tags: ['CEMIG-D'], modified: 99 } },
    ];
    const escolhido = escolherArquivo(itens, 'BDGD Cemig-D');
    assert.equal(escolhido.id, 'b');
    assert.equal(escolhido.data_base, '2025-12-31');
    assert.equal(escolherArquivo(itens, 'BDGD Enel'), null);
    //DME (Poços de Caldas): o título pode vir como "DMED"; a busca por "DME" acha
    const dme = escolherArquivo([...itens, { properties: { id: 'e', title: 'DMED_0000_2025-12-31_V11', type: 'File Geodatabase', tags: [], modified: 3 } }], 'BDGD DME');
    assert.equal(dme.id, 'e');
});

await test('site: leitor de ruas (MVT do OpenFreeMap) lê ruas e rios, ignora ferrovia e galeria', async () => {
    //Monta um bloco MVT mínimo à mão: camada "transportation" com uma rua (class=minor) e uma ferrovia (class=rail)
    const varint = (n) => { const out = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return out; };
    const field = (num, type, payload) => [...varint(num * 8 + type), ...(type === 2 ? [...varint(payload.length), ...payload] : varint(payload))];
    const str = (t) => [...Buffer.from(t)];
    const zig = (n) => (n << 1) ^ (n >> 31);
    const line = (pts) => { const g = [...varint((1 & 7) | (1 << 3)), ...varint(zig(pts[0][0])), ...varint(zig(pts[0][1])), ...varint((2 & 7) | ((pts.length - 1) << 3))];
        for (let i = 1; i < pts.length; i++) g.push(...varint(zig(pts[i][0] - pts[i - 1][0])), ...varint(zig(pts[i][1] - pts[i - 1][1])));
        return g; };
    const feature = (valueIndex, pts) => [...field(2, 2, [...varint(0), ...varint(valueIndex)]), ...field(3, 0, 2), ...field(4, 2, line(pts))];
    const layer = [...field(15, 0, 2), ...field(1, 2, str('transportation')),
        ...field(2, 2, feature(0, [[0, 2048], [4096, 2048]])), ...field(2, 2, feature(1, [[2048, 0], [2048, 4096]])),
        ...field(3, 2, str('class')), ...field(4, 2, field(1, 2, str('minor'))), ...field(4, 2, field(1, 2, str('rail'))), ...field(5, 0, 4096)];
    //Camada "waterway": um rio (entra) e um córrego em galeria (brunnel=tunnel, fica de fora)
    const tagged = (tags, pts) => [...field(2, 2, tags.flatMap(varint)), ...field(3, 0, 2), ...field(4, 2, line(pts))];
    const waterLayer = [...field(15, 0, 2), ...field(1, 2, str('waterway')),
        ...field(2, 2, tagged([0, 0], [[0, 1000], [4096, 1000]])), ...field(2, 2, tagged([0, 1, 1, 2], [[0, 3000], [4096, 3000]])),
        ...field(3, 2, str('class')), ...field(3, 2, str('brunnel')),
        ...field(4, 2, field(1, 2, str('river'))), ...field(4, 2, field(1, 2, str('stream'))), ...field(4, 2, field(1, 2, str('tunnel'))), ...field(5, 0, 4096)];
    const tile = Uint8Array.from([...field(3, 2, layer), ...field(3, 2, waterLayer)]);
    const ctx = { TextDecoder, Math, Map, Set, Promise, Error, Uint8Array, ArrayBuffer, console, fetch: async () => { throw new Error('sem rede'); } };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'web', 'js', 'map', 'street-lines.js'), 'utf8') + '\n;globalThis.decode = decodeStreetTile;', ctx);
    const lines = ctx.decode(tile, 14, 6149, 9128);
    assert.equal(lines.length, 1, 'a ferrovia fica de fora');
    assert.equal(lines[0].length, 2);
    assert.equal(lines[0].cls, 'minor', 'a linha leva a classe da via');
    assert.equal(lines.water.length, 1, 'o rio entra; o córrego em galeria não');
    assert.equal(lines.water[0].cls, 'river');
    const [[lat1, lng1], [lat2, lng2]] = lines[0];
    assert.ok(Math.abs(lat1 - lat2) < 1e-9 && lng2 > lng1, 'rua horizontal no meio do bloco');
    assert.ok(lat1 < -20 && lat1 > -20.2 && lng1 > -44.9 && lng1 < -44.8, `posição em Divinópolis (${lat1}, ${lng1})`);
});

fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${passed} testes ok`);
