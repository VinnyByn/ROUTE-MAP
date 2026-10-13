// Acha no portal de dados abertos da ANEEL o arquivo da BDGD mais novo de cada distribuidora pedida.
// Escreve no formato do GITHUB_OUTPUT (chave=valor), para o workflow de postes:
//   itens=[{"id","titulo","data_base","url"}, ...]   (JSON numa linha)
//   data_base=<a mais nova entre as distribuidoras>  (vira a versão da base de postes)
//   titulo=<títulos separados por " + ">
// Busca com "?" na frente é opcional: se não achar, avisa e segue com as outras.
//
//   node tools/postes/bdgd-mais-nova.mjs "BDGD Cemig-D" "?BDGD DME"

import { escolherArquivo } from './bdgd.mjs';

const BUSCAS = process.argv.slice(2).length ? process.argv.slice(2) : ['BDGD Cemig-D'];
const PORTAL = 'https://dadosabertos-aneel.opendata.arcgis.com/api/search/v1/collections/all/items';

const itens = [];
for (const pedido of BUSCAS) {
    const opcional = pedido.startsWith('?');
    const busca = opcional ? pedido.slice(1) : pedido;
    let arquivo = null;
    try {
        const resposta = await fetch(`${PORTAL}?q=${encodeURIComponent(busca)}&limit=100`);
        if (!resposta.ok) throw new Error(`portal da ANEEL respondeu ${resposta.status}`);
        arquivo = escolherArquivo((await resposta.json()).features || [], busca);
        if (!arquivo) throw new Error(`nenhuma BDGD encontrada para "${busca}"`);
    } catch (e) {
        if (!opcional) { console.error(e.message); process.exit(1); }
        console.error(`Aviso: ${e.message}; seguindo sem ela.`);
        continue;
    }
    itens.push(arquivo);
}
if (!itens.length) { console.error('Nenhuma BDGD encontrada.'); process.exit(1); }
const dataBase = itens.map(i => i.data_base).sort().pop();
console.log(`itens=${JSON.stringify(itens)}`);
console.log(`data_base=${dataBase}`);
console.log(`titulo=${itens.map(i => i.titulo).join(' + ')}`);
