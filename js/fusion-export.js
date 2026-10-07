// Exportar plano de fusão do projeto (PDF): todas as caixas (CEO, CTO e POP) com os cabos, as fusões
// fibra a fibra, os splitters e as portas de atendimento. Desenhado com jsPDF + jspdf-autotable.
// Depende de js/fusion-plan.js (readFusionPlan, resolvePlanCable), js/fusion.js (getFiberColor),
// js/clients.js (getCtoClients), js/project-check.js (getActiveProjectScope) e js/report-pdf.js (pdfText).

const FUSION_EXPORT_TYPES = ['POP', 'CEO', 'CTO'];
const FIBER_COLOR_NAMES = ['Verde', 'Amarelo', 'Branco', 'Azul', 'Vermelho', 'Violeta', 'Marrom', 'Rosa', 'Preto', 'Cinza', 'Laranja', 'Água'];

function fiberColorLabel(n, total) {
    const name = FIBER_COLOR_NAMES[(n - 1) % 12];
    return total > 12 ? `Tubo ${Math.floor((n - 1) / 12) + 1} · ${name}` : name;
}

function getBoxStatus(box) {
    return box.ctoStatus || box.ceoStatus || box.popStatus || box.status || '';
}

//Descrição de cada porta do plano (fibra, splitter ou equipamento) pelo id
function buildPlanPortIndex(plan, box) {
    const index = new Map();
    plan.cables.forEach(card => {
        const cable = resolvePlanCable(card, box);
        const name = cable?.name || card.name;
        const total = card.fibers.length;
        card.fibers.forEach(f => {
            if (!f.number) return;
            index.set(f.id, { kind: 'fiber', text: `${name} F${f.number}`, color: getFiberColor(f.number), colorName: fiberColorLabel(f.number, total), order: `0|${name}|${String(f.number).padStart(4, '0')}` });
        });
    });
    plan.splitters.forEach(sp => {
        sp.inputIds.forEach(id => index.set(id, { kind: 'splitter', text: `Splitter ${sp.label} · entrada`, order: `1|${sp.label}|0` }));
        sp.outputIds.forEach((id, i) => index.set(id, { kind: 'splitter', text: `Splitter ${sp.label} · saída ${i + 1}`, order: `1|${sp.label}|${String(i + 1).padStart(4, '0')}` }));
    });
    (plan.equipment || []).forEach(eq => eq.ports.forEach(p => {
        const text = p.side === 'pon' ? `${eq.name} · placa ${p.slot} PON ${p.pon}`
            : p.side === 'front' ? `${eq.name} · porta ${p.port} (cordão)` : `${eq.name} · porta ${p.port}`;
        index.set(p.id, { kind: 'equipment', text, order: `2|${eq.name}|${p.slot}|${p.pon}|${p.port}` });
    }));
    return index;
}

function buildBoxFusionExport(box) {
    const plan = readFusionPlan(box);
    const base = { box, name: box.name || '', type: box.type, status: getBoxStatus(box), folder: getItemFolderName(box), latLng: getItemLatLng(box) };
    if (!plan || plan.empty) return { ...base, empty: true, cables: [], fusions: [], splitters: [], ports: [] };
    const index = buildPlanPortIndex(plan, box);
    const unknown = (id) => ({ text: `(porta removida: ${id})`, order: `9|${id}` });

    const cables = plan.cables.map(card => {
        const cable = resolvePlanCable(card, box);
        const role = cable ? getCableRoleAtMarker(cable, box.marker?.getPosition?.(), box) : '';
        return {
            name: cable?.name || card.name,
            role: role === 'saida' ? 'Saída' : role === 'entrada' ? 'Entrada' : '',
            type: cable?.type || '',
            fibers: card.fibers.length,
            used: card.fibers.filter(f => f.connected).length,
            otherEnd: cable && typeof getCableOtherEndName === 'function' ? getCableOtherEndName(cable, role) : '',
            missing: !cable,
        };
    });

    //Cada fusão uma linha, com a ponta "de cabo" primeiro e em ordem de cabo/fibra
    const fusions = plan.lines.map(l => {
        let a = index.get(l.startId) || unknown(l.startId);
        let b = index.get(l.endId) || unknown(l.endId);
        if (a.order > b.order) [a, b] = [b, a];
        return { a, b };
    }).sort((x, y) => x.a.order.localeCompare(y.a.order, 'pt-BR', { numeric: true }));

    const splitters = plan.splitters.map(sp => ({
        label: sp.label,
        kind: sp.atendimento ? 'Atendimento' : 'Fusão',
        status: sp.status || '',
        outputs: sp.outputs,
        used: sp.outputIds.filter(id => plan.connectedIds.has(id)).length,
        olt: sp.olt?.olt ? formatSplitterOltSummary(sp.olt.olt, sp.olt.placa, sp.olt.pon) : '',
    }));

    const ports = box.type === 'CTO' && typeof getCtoClients === 'function'
        ? getCtoClients(box).filter(c => c.client?.ctoPort).sort((x, y) => x.client.ctoPort - y.client.ctoPort)
            .map(c => ({ port: c.client.ctoPort, client: c.name || '', code: c.client.code || '' }))
        : [];

    return { ...base, empty: false, cables, fusions, splitters, ports };
}

function buildProjectFusionExport(scope) {
    const order = (t) => FUSION_EXPORT_TYPES.indexOf(t);
    return scope.markers
        .filter(m => FUSION_EXPORT_TYPES.includes(m.type))
        .sort((a, b) => order(a.type) - order(b.type) || String(a.name).localeCompare(String(b.name), 'pt-BR', { numeric: true }))
        .map(buildBoxFusionExport);
}

// ---------------------------------------------------------------
// PDF
// ---------------------------------------------------------------

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [148, 163, 184];
}

function drawFusionExportPdf(projectName, boxes) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, MX = 14;
    const ink = [22, 50, 63], muted = [91, 116, 131], brand = [47, 122, 148];
    const t = (v) => pdfText(v);
    const table = (opts) => doc.autoTable({
        margin: { left: MX, right: MX, top: 16, bottom: 18 },
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, textColor: ink, lineColor: [219, 229, 235], lineWidth: 0.15 },
        headStyles: { fillColor: [23, 63, 78], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 248, 250] },
        ...opts,
    });
    const heading = (text, y, size = 11) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(size); doc.setTextColor(...ink);
        doc.text(t(text), MX, y);
    };

    //Capa: resumo de todas as caixas
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...brand);
    doc.text('Plano de fusão do projeto', MX, 22);
    doc.setFontSize(12); doc.setTextColor(...ink);
    doc.text(t(projectName), MX, 30);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...muted);
    const totalFusions = boxes.reduce((n, b) => n + b.fusions.length, 0);
    doc.text(t(`${boxes.length} caixa(s) · ${totalFusions} fusão(ões) · gerado em ${new Date().toLocaleString('pt-BR')}`), MX, 36);
    table({
        startY: 42,
        head: [['Caixa', 'Tipo', 'Situação', 'Pasta', 'Cabos', 'Fusões', 'Splitters']],
        body: boxes.map(b => [t(b.name), b.type, t(b.status), t(b.folder), b.empty ? '-' : b.cables.length, b.empty ? 'sem plano' : b.fusions.length, b.empty ? '-' : b.splitters.length]),
    });

    boxes.forEach(b => {
        doc.addPage();
        heading(`${b.type} · ${b.name}`, 20, 14);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...muted);
        const info = [b.status && `Situação: ${b.status}`, b.folder && `Pasta: ${b.folder}`, b.latLng[0] !== '' && `Coordenadas: ${b.latLng.join(', ')}`].filter(Boolean).join('   ·   ');
        doc.text(t(info), MX, 26);
        let y = 32;
        if (b.empty) {
            doc.setFontSize(10); doc.setTextColor(...ink);
            doc.text('Esta caixa ainda não tem plano de fusão.', MX, y + 4);
            return;
        }
        if (b.cables.length) {
            heading('Cabos', y);
            table({
                startY: y + 2,
                head: [['Cabo', 'Lado', 'Tipo', 'Fibras', 'Em uso', 'Outra ponta']],
                body: b.cables.map(c => [t(c.name + (c.missing ? ' (não existe mais no mapa)' : '')), c.role, t(c.type), c.fibers, c.used, t(c.otherEnd)]),
            });
            y = doc.lastAutoTable.finalY + 8;
        }
        heading(`Fusões (${b.fusions.length})`, y);
        if (b.fusions.length) {
            const rows = b.fusions.map(f => [t(f.a.text), '', t(f.a.colorName || ''), t(f.b.text), '', t(f.b.colorName || '')]);
            table({
                startY: y + 2,
                head: [['De', '', 'Cor', 'Para', '', 'Cor']],
                body: rows,
                columnStyles: { 1: { cellWidth: 4 }, 4: { cellWidth: 4 }, 2: { cellWidth: 26 }, 5: { cellWidth: 26 } },
                didParseCell: (data) => {
                    if (data.section !== 'body' || (data.column.index !== 1 && data.column.index !== 4)) return;
                    const end = data.column.index === 1 ? b.fusions[data.row.index].a : b.fusions[data.row.index].b;
                    if (end.color) data.cell.styles.fillColor = hexToRgb(end.color);
                },
            });
            y = doc.lastAutoTable.finalY + 8;
        } else {
            doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...muted);
            doc.text('Nenhuma fusão feita nesta caixa.', MX, y + 6);
            y += 14;
        }
        if (b.splitters.length) {
            heading('Splitters', y);
            table({
                startY: y + 2,
                head: [['Splitter', 'Uso', 'Situação', 'Saídas', 'Ligadas', 'OLT']],
                body: b.splitters.map(s => [t(s.label), s.kind, t(s.status), s.outputs, s.used, t(s.olt)]),
            });
            y = doc.lastAutoTable.finalY + 8;
        }
        if (b.ports.length) {
            heading('Portas de atendimento', y);
            table({ startY: y + 2, head: [['Porta', 'Cliente', 'Código']], body: b.ports.map(p => [p.port, t(p.client), t(p.code)]) });
        }
    });

    const total = doc.internal.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
        doc.setPage(p);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...muted);
        doc.setDrawColor(219, 229, 235); doc.setLineWidth(0.2);
        doc.line(MX, 284.5, W - MX, 284.5);
        doc.text(t(`ROUTE MAP · Plano de fusão · ${projectName}`), MX, 288.5);
        doc.text(`Página ${p} de ${total}`, W - MX, 288.5, { align: 'right' });
    }
    doc.setProperties({ title: `Plano de fusão - ${projectName}`, creator: 'ROUTE MAP' });
    return doc;
}

function exportProjectFusionPlans() {
    const scope = getActiveProjectScope();
    if (!scope) {
        showToast('Nenhum projeto', 'Abra ou selecione um projeto para exportar.', 'progress');
        return null;
    }
    if (!window.jspdf?.jsPDF || !window.jspdf.jsPDF.API?.autoTable) {
        showAlert('Exportar plano de fusão', 'A biblioteca de PDF não carregou. Recarregue a página e tente de novo.');
        return null;
    }
    const boxes = buildProjectFusionExport(scope);
    if (!boxes.length) {
        showToast('Sem caixas', 'O projeto não tem CEO, CTO nem POP.', 'progress');
        return null;
    }
    const projectName = document.querySelector(`.folder-title[data-folder-id="${CSS.escape(scope.projectId)}"]`)?.dataset.folderName || 'Projeto';
    const doc = drawFusionExportPdf(projectName, boxes);
    doc.save(`Plano de fusão - ${projectName.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`);
    showToast('Plano de fusão exportado', `${boxes.length} caixa(s) · ${doc.internal.getNumberOfPages()} página(s)`);
    return doc;
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('exportFusionPlansButton')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('projectDropdown')?.classList.remove('show');
        exportProjectFusionPlans();
    });
});
