// Gera a base estática de postes do site (web/postes) a partir de um CSV com as colunas X (longitude) e Y (latitude),
// como sai do ogr2ogr (-lco GEOMETRY=AS_XY). Sem dependências: só Node.
//
//   ogr2ogr -f CSV /vsistdout/ BDGD.gdb PONNOT -where "TIP_PN = 'POS'" -select TIP_PN -lco GEOMETRY=AS_XY \
//     | node tools/postes/gerar-tiles.mjs --entrada - --saida web/postes --data-base 2025-12-31 --arquivo NOME
//
// Saída: web/postes/manifest.json, web/postes/<versão>/<x>/<y>.bin (formato em tiles.mjs; tiles vazios não existem) e
// web/postes/<versão>/indice.bin, que diz quais tiles existem (o site não pede tile vazio e não gera 404).

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { TILE_ZOOM, quantize, encodeIndex } from './tiles.mjs';

function args() {
    const out = {};
    const list = process.argv.slice(2);
    for (let i = 0; i < list.length; i += 2) out[list[i].replace(/^--/, '')] = list[i + 1];
    if (!out.saida) throw new Error('Use --saida <pasta> (e --entrada <csv> ou - para ler do stdin).');
    return out;
}

function splitCsv(line) {
    //Só X e Y importam e são números: basta separar por vírgula fora de aspas
    const cells = [];
    let cur = '', quoted = false;
    for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; }
        else cur += ch;
    }
    cells.push(cur);
    return cells;
}

async function main() {
    const opt = args();
    const input = !opt.entrada || opt.entrada === '-' ? process.stdin : fs.createReadStream(opt.entrada);
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    const tiles = new Map();
    let ix = -1, iy = -1, total = 0, skipped = 0, header = true;
    for await (const line of lines) {
        if (!line) continue;
        const cells = splitCsv(line);
        if (header) {
            header = false;
            const names = cells.map(c => c.trim().toUpperCase());
            ix = names.indexOf('X'); iy = names.indexOf('Y');
            if (ix < 0 || iy < 0) throw new Error(`CSV sem colunas X e Y (cabeçalho: ${line})`);
            continue;
        }
        const lng = Number(cells[ix]), lat = Number(cells[iy]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 85 || Math.abs(lng) > 180) { skipped++; continue; }
        const { tx, ty, qx, qy } = quantize(lng, lat);
        const key = `${tx}/${ty}`;
        let list = tiles.get(key);
        if (!list) tiles.set(key, list = []);
        list.push(qx, qy);
        total++;
    }
    if (!total) throw new Error('Nenhum poste no CSV.');

    const version = `v-${(opt['data-base'] || new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, '')}`;
    fs.rmSync(opt.saida, { recursive: true, force: true });
    let bytes = 0, biggest = 0;
    for (const [key, list] of tiles) {
        const file = path.join(opt.saida, version, `${key}.bin`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const buf = Buffer.alloc(list.length * 2);
        for (let i = 0; i < list.length; i++) buf.writeUInt16LE(list[i], i * 2);
        fs.writeFileSync(file, buf);
        bytes += buf.length;
        biggest = Math.max(biggest, list.length / 2);
    }
    fs.writeFileSync(path.join(opt.saida, version, 'indice.bin'), encodeIndex([...tiles.keys()].map(k => k.split('/').map(Number))));
    const manifest = {
        fonte: 'BDGD/ANEEL', arquivo: opt.arquivo || '', data_base: opt['data-base'] || '', versao: version,
        gerado_em: new Date().toISOString(), total, tiles: tiles.size, zoom: TILE_ZOOM,
    };
    fs.writeFileSync(path.join(opt.saida, 'manifest.json'), JSON.stringify(manifest, null, 1));
    console.log(`${total.toLocaleString('pt-BR')} postes em ${tiles.size.toLocaleString('pt-BR')} tiles (${(bytes / 2 ** 20).toFixed(1)} MB; maior tile: ${biggest} postes; ${skipped} linhas inválidas)`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
