// Exportar planilha (Excel) do projeto ativo: caixas, cabos, clientes, portas das CTOs e fibras.
// Usa a SheetJS (XLSX) já carregada no index.html. Depende de js/project-check.js
// (getActiveProjectScope, getProjectOpticalBudget), js/clients.js e js/marker-hover.js.

function getItemLatLng(item) {
    const p = item.marker?.getPosition?.() || item.position;
    if (!p) return ['', ''];
    const lat = typeof p.lat === 'function' ? p.lat() : p.lat;
    const lng = typeof p.lng === 'function' ? p.lng() : p.lng;
    return [Number(lat?.toFixed?.(6) ?? lat), Number(lng?.toFixed?.(6) ?? lng)];
}

function getItemFolderName(item) {
    return document.querySelector(`.folder-title[data-folder-id="${CSS.escape(item.folderId || '')}"]`)?.dataset.folderName || '';
}

function round1(v) {
    return v == null || !Number.isFinite(v) ? '' : Math.round(v * 10) / 10;
}

function buildProjectSheets(scope) {
    const optical = getProjectOpticalBudget(scope);
    const powerByCto = new Map(optical.rows.map(r => [r.cto, r]));
    const powerByClient = new Map();
    optical.rows.forEach(r => r.clients.forEach(c => powerByClient.set(c.client, c.dbm)));
    const boxes = scope.markers.filter(m => m.type !== 'CLIENTE');
    const clients = scope.markers.filter(m => m.type === 'CLIENTE');

    const caixas = [['Nome', 'Tipo', 'Status', 'Pasta', 'Latitude', 'Longitude', 'Cabos ligados', 'Splitters', 'Portas de atendimento', 'Ocupadas', 'Livres', 'Potência na porta (dBm)']];
    boxes.forEach(box => {
        const plan = (box.type === 'CEO' || box.type === 'CTO') ? readFusionPlan(box) : null;
        const cables = scope.cables.filter(c => c.startAnchorUid === box.uid || c.endAnchorUid === box.uid).length;
        const ports = box.type === 'CTO' ? (getCtoPortCapacity(box) || 0) : '';
        const busy = box.type === 'CTO' ? getCtoClients(box).length : '';
        caixas.push([box.name, box.type, getMarkerInfrastructureStatus(box) || '', getItemFolderName(box), ...getItemLatLng(box), cables,
            plan ? plan.splitters.map(s => s.label).filter(Boolean).join(', ') : '', ports, busy, ports === '' ? '' : Math.max(0, ports - busy),
            round1(powerByCto.get(box)?.dbm)]);
    });

    const cabos = [['Nome', 'Tipo', 'Status', 'Ponta A', 'Ponta B', 'Lançamento (m)', 'Reserva (m)', 'Total (m)', 'Fibras', 'Em uso', 'Livres', 'Fibras em uso', 'Fibras livres']];
    scope.cables.forEach(c => {
        const u = getCableFiberUsage(c);
        cabos.push([c.name, c.type || '', c.status || '', findMarkerByUid(c.startAnchorUid)?.name || '', findMarkerByUid(c.endAnchorUid)?.name || '',
            c.lancamento ?? '', c.reserva ?? '', c.totalLength ?? '', u.total, u.used.length, u.free.length, formatFiberRanges(u.used), formatFiberRanges(u.free)]);
    });

    const clientes = [['Nome', 'Código', 'Tipo', 'Status', 'CTO / cabo', 'Porta / fibra', 'Drop (m)', 'Endereço', 'Latitude', 'Longitude', 'Potência estimada (dBm)']];
    clients.forEach(m => {
        const d = m.client || {};
        const cto = findMarkerByUid(d.ctoUid);
        const drop = getClientDropInfo(m);
        clientes.push([m.name, d.code || '', CLIENT_KINDS[d.kind]?.label || '', getClientStatus(d.status).label, cto?.name || d.cableName || '',
            d.ctoPort || d.cableFiber || '', drop?.length ?? '', d.address || '', ...getItemLatLng(m), round1(powerByClient.get(m))]);
    });

    const portas = [['CTO', 'Porta', 'Situação', 'Cliente', 'Código do cliente']];
    boxes.filter(b => b.type === 'CTO').forEach(cto => {
        const capacity = getCtoPortCapacity(cto) || 0;
        const taken = getOccupiedPorts(cto);
        for (let p = 1; p <= capacity; p++) {
            const c = taken.get(p);
            portas.push([cto.name, p, c ? 'Ocupada' : 'Livre', c?.name || '', c?.client?.code || '']);
        }
    });

    const fibras = [['Cabo', 'Fibra', 'Cor', 'Situação']];
    const colorNames = ['Verde', 'Amarelo', 'Branco', 'Azul', 'Vermelho', 'Violeta', 'Marrom', 'Rosa', 'Preto', 'Cinza', 'Laranja', 'Aqua'];
    scope.cables.forEach(c => {
        const used = new Set(getCableFiberUsage(c).used);
        for (let n = 1; n <= getCableFiberCount(c); n++) fibras.push([c.name, n, colorNames[(n - 1) % 12], used.has(n) ? 'Em uso' : 'Livre']);
    });

    return { Caixas: caixas, Cabos: cabos, Clientes: clientes, 'Portas das CTOs': portas, Fibras: fibras };
}

function exportProjectSpreadsheet() {
    const scope = getActiveProjectScope();
    if (!scope) {
        showToast('Nenhum projeto', 'Abra ou selecione um projeto para exportar.', 'progress');
        return;
    }
    if (typeof XLSX === 'undefined') {
        showAlert('Exportar planilha', 'A biblioteca de planilhas não carregou. Recarregue a página e tente de novo.');
        return;
    }
    const sheets = buildProjectSheets(scope);
    const book = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([name, rows]) => {
        const sheet = XLSX.utils.aoa_to_sheet(rows);
        sheet['!cols'] = rows[0].map((_, i) => ({ wch: Math.min(40, Math.max(8, ...rows.map(r => String(r[i] ?? '').length + 2))) }));
        sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: rows[0].length - 1 } }) };
        XLSX.utils.book_append_sheet(book, sheet, name);
    });
    const name = document.querySelector(`.folder-title[data-folder-id="${CSS.escape(scope.projectId)}"]`)?.dataset.folderName || 'projeto';
    XLSX.writeFile(book, `${name.replace(/[\\/:*?"<>|]+/g, '-')}.xlsx`);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('exportSpreadsheetButton')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('projectDropdown')?.classList.remove('show');
        exportProjectSpreadsheet();
    });
});
