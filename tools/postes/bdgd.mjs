// Escolha do arquivo da BDGD mais novo entre os itens do portal de dados abertos da ANEEL.

export function escolherArquivo(itens, busca) {
    const palavras = busca.toLowerCase().split(/\s+/).filter(w => w && w !== 'bdgd');
    const candidatos = [];
    for (const item of itens) {
        const p = item.properties || item;
        if (p.type !== 'File Geodatabase') continue;
        const texto = `${p.title || ''} ${(p.tags || []).join(' ')}`.toLowerCase();
        if (!palavras.every(w => texto.includes(w))) continue;
        const data = (p.title || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
        candidatos.push({ data, modified: p.modified || 0, p });
    }
    if (!candidatos.length) return null;
    candidatos.sort((a, b) => (a.data === b.data ? a.modified - b.modified : a.data < b.data ? -1 : 1));
    const { data, p } = candidatos[candidatos.length - 1];
    return { id: p.id, titulo: p.title, data_base: data, url: `https://www.arcgis.com/sharing/rest/content/items/${p.id}/data` };
}
