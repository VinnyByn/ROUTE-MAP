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
        const role = (cable && box.marker?.getPosition ? getCableRoleAtMarker(cable, box.marker.getPosition(), box) : null) || card.role || '';
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

    return { ...base, empty: false, cables, fusions, splitters, ports, diagram: buildBoxDiagram(box, plan, cables) };
}

// ---------------------------------------------------------------
// Diagrama: entradas à esquerda, saídas à direita, splitters e equipamentos no meio
// ---------------------------------------------------------------

function freeRangesLabel(numbers) {
    return numbers.length ? `F${formatFiberRanges(numbers).replace(/, /g, ', F').replace(/-/g, '–F')} livre${numbers.length === 1 ? '' : 's'}` : '';
}

function buildBoxDiagram(box, plan, cableRows) {
    const left = [], right = [], middle = [];
    plan.cables.forEach((card, i) => {
        const info = cableRows[i];
        const rows = [];
        const free = [];
        card.fibers.forEach(f => {
            if (!f.number) return;
            if (f.connected) rows.push({ id: f.id, label: `F${f.number}`, color: getFiberColor(f.number) });
            else free.push(f.number);
        });
        if (free.length) rows.push({ label: freeRangesLabel(free), free: true });
        const block = { title: info.name, sub: [info.role, info.type].filter(Boolean).join(' · '), rows };
        (info.role === 'Saída' ? right : left).push(block);
    });
    //Portas da CTO: numeradas em sequência pelas saídas dos splitters de atendimento
    const clientsByPort = new Map();
    if (box.type === 'CTO' && typeof getCtoClients === 'function') {
        getCtoClients(box).forEach(c => { if (c.client?.ctoPort) clientsByPort.set(Number(c.client.ctoPort), c.name || ''); });
    }
    let portNumber = 0;
    plan.splitters.forEach(sp => {
        const rows = sp.inputIds.map(id => ({ id, label: 'Entrada', side: 'in' }));
        sp.outputIds.forEach((id, i) => {
            const row = { id, label: `S${i + 1}`, side: 'out' };
            if (sp.atendimento) {
                portNumber++;
                const client = clientsByPort.get(portNumber);
                row.note = `Porta ${portNumber}${client ? ` · ${client}` : ''}`;
            }
            rows.push(row);
        });
        const olt = sp.olt?.olt ? formatSplitterOltSummary(sp.olt.olt, sp.olt.placa, sp.olt.pon, { compact: true }) : '';
        middle.push({ title: `Splitter ${sp.label}`, sub: [sp.atendimento ? 'Atendimento' : 'Fusão', olt].filter(Boolean).join(' · '), rows, splitter: true });
    });
    (plan.equipment || []).forEach(eq => {
        const rows = eq.ports.filter(p => p.connected).map(p => ({
            id: p.id, side: p.side === 'front' ? 'out' : 'in',
            label: p.side === 'pon' ? `Placa ${p.slot} PON ${p.pon}` : `Porta ${p.port}${p.side === 'front' ? ' (cordão)' : ''}`,
        }));
        if (rows.length) middle.push({ title: eq.name, sub: eq.kind === 'olt' ? 'OLT' : eq.kind === 'dgo' ? 'DGO' : 'Equipamento', rows });
    });
    //Cor de cada fusão: a da fibra (de qualquer uma das pontas)
    const fiberColor = new Map();
    plan.cables.forEach(card => card.fibers.forEach(f => { if (f.number) fiberColor.set(f.id, getFiberColor(f.number)); }));
    const links = plan.lines.map(l => ({ a: l.startId, b: l.endId, color: fiberColor.get(l.startId) || fiberColor.get(l.endId) || '#64748b' }));
    return { left, right, middle, links };
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

//Posições (sem desenhar): coluna esquerda e direita no topo; o meio começa abaixo das fusões diretas
//entre cabos, para essas linhas não passarem por cima dos splitters
const FD = { ROW: 4.4, HEAD: 8, GAP: 4 };

function layoutFusionDiagram(d) {
    const rowY = new Map(); //id → y relativo
    const stack = (blocks, start) => {
        let y = start;
        const placed = blocks.map(b => {
            const top = y;
            b.rows.forEach((r, i) => { if (r.id) rowY.set(r.id, top + FD.HEAD + i * FD.ROW + FD.ROW / 2); });
            y += FD.HEAD + b.rows.length * FD.ROW + FD.GAP;
            return top;
        });
        return { tops: placed, bottom: y };
    };
    const left = stack(d.left, 0), right = stack(d.right, 0);
    const sideIds = new Set([...d.left, ...d.right].flatMap(b => b.rows.map(r => r.id).filter(Boolean)));
    let middleStart = 0;
    d.links.forEach(l => {
        if (sideIds.has(l.a) && sideIds.has(l.b)) middleStart = Math.max(middleStart, rowY.get(l.a) + FD.ROW, rowY.get(l.b) + FD.ROW);
    });
    const middle = stack(d.middle, middleStart);
    return { left: left.tops, right: right.tops, middle: middle.tops, height: Math.max(left.bottom, right.bottom, middle.bottom, 10) };
}

function measureFusionDiagram(d) {
    return layoutFusionDiagram(d).height;
}

function drawFusionDiagram(doc, d, x0, y0, w, scale) {
    const ROW = FD.ROW * scale, HEAD = FD.HEAD * scale;
    const colW = Math.min(52, w * 0.27), midW = Math.min(46, w * 0.26);
    const xL = x0, xR = x0 + w - colW, xM = x0 + (w - midW) / 2;
    const layout = layoutFusionDiagram(d);
    const pos = new Map(); //id da porta → { x, y, side }
    const fs = (n) => doc.setFontSize(Math.max(4, n * scale));
    const ink = [22, 50, 63], muted = [91, 116, 131];

    const drawColumn = (blocks, tops, x, width, side) => {
        blocks.forEach((b, bi) => {
            const y = y0 + tops[bi] * scale;
            const h = HEAD + b.rows.length * ROW;
            doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.25);
            doc.setFillColor(b.splitter ? 255 : 248, b.splitter ? 251 : 250, b.splitter ? 235 : 252);
            doc.roundedRect(x, y, width, h, 1.2, 1.2, 'FD');
            doc.setFillColor(23, 63, 78); doc.rect(x, y, width, HEAD * 0.62, 'F');
            doc.setFont('helvetica', 'bold'); fs(7); doc.setTextColor(255, 255, 255);
            doc.text(pdfText(b.title), x + 1.5, y + HEAD * 0.45, { maxWidth: width - 3 });
            doc.setFont('helvetica', 'normal'); fs(5.6); doc.setTextColor(...muted);
            doc.text(pdfText(b.sub || ''), x + 1.5, y + HEAD * 0.9, { maxWidth: width - 3 });
            b.rows.forEach((r, i) => {
                const ry = y + HEAD + i * ROW + ROW / 2;
                if (r.free) {
                    doc.setFont('helvetica', 'italic'); fs(5.8); doc.setTextColor(...muted);
                    doc.text(pdfText(r.label), x + 1.5, ry + 1, { maxWidth: width - 3 });
                    return;
                }
                const portSide = side === 'left' ? 'right' : side === 'right' ? 'left' : (r.side === 'out' ? 'right' : 'left');
                const px = portSide === 'right' ? x + width : x;
                if (r.color) {
                    const [cr, cg, cb] = hexToRgb(r.color);
                    doc.setFillColor(cr, cg, cb); doc.setDrawColor(148, 163, 184); doc.setLineWidth(0.15);
                    const sx = portSide === 'right' ? x + width - 7 * scale : x + 1.2;
                    doc.rect(sx, ry - ROW * 0.32, 5.8 * scale, ROW * 0.64, 'FD');
                }
                doc.setFont('helvetica', 'normal'); fs(6.4); doc.setTextColor(...ink);
                const label = pdfText(r.label);
                if (portSide === 'right') doc.text(label, r.color ? x + width - 8.2 * scale : x + width - 1.5, ry + 1, { align: 'right' });
                else doc.text(label, r.color ? x + 8.2 * scale : x + 1.5, ry + 1);
                if (r.note) {
                    fs(5.4); doc.setTextColor(...muted);
                    doc.text(pdfText(r.note), x + width + 1.5, ry + 1, { maxWidth: Math.max(10, xR - (x + width) - 3) });
                }
                doc.setFillColor(71, 85, 105); doc.circle(px, ry, 0.55 * Math.max(scale, 0.6), 'F');
                if (r.id) pos.set(r.id, { x: px, y: ry, side: portSide });
            });
        });
    };
    drawColumn(d.left, layout.left, xL, colW, 'left');
    drawColumn(d.right, layout.right, xR, colW, 'right');
    drawColumn(d.middle, layout.middle, xM, midW, 'middle');

    //Fusões: curvas na cor da fibra (branco vira cinza claro para aparecer)
    d.links.forEach(l => {
        const a = pos.get(l.a), b = pos.get(l.b);
        if (!a || !b) return;
        let [r, g, bl] = hexToRgb(l.color);
        if (r > 235 && g > 235 && bl > 235) [r, g, bl] = [180, 190, 200];
        doc.setDrawColor(r, g, bl); doc.setLineWidth(0.55 * Math.max(scale, 0.7));
        const dir = (p) => (p.side === 'right' ? 1 : -1);
        const k = Math.max(8, Math.abs(b.x - a.x) * 0.4);
        const c1 = [a.x + dir(a) * k, a.y], c2 = [b.x + dir(b) * k, b.y];
        doc.lines([[c1[0] - a.x, c1[1] - a.y, c2[0] - a.x, c2[1] - a.y, b.x - a.x, b.y - a.y]], a.x, a.y, [1, 1], 'S');
    });
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
        //Diagrama que não cabe numa A4 (nem reduzido a 60%): a página da caixa já nasce comprida
        const natural = b.empty ? 0 : measureFusionDiagram(b.diagram);
        const tall = !b.empty && natural * 0.6 > 297 - 18 - 32;
        if (tall) doc.addPage([210, natural + 52], 'portrait');
        else doc.addPage('a4', 'portrait');
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
        //Diagrama: cabe na página (reduz até 60%); maior que isso, desenha inteiro na página comprida
        if (tall) {
            drawFusionDiagram(doc, b.diagram, MX, y, W - 2 * MX, 1);
            doc.addPage('a4', 'portrait');
            y = 20;
        } else {
            const scale = Math.min(1, (297 - 18 - y) / natural);
            drawFusionDiagram(doc, b.diagram, MX, y, W - 2 * MX, scale);
            y += natural * scale + 6;
            if (y > 297 - 60) { doc.addPage('a4', 'portrait'); y = 20; }
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
        const H = doc.internal.pageSize.getHeight();
        doc.line(MX, H - 12.5, W - MX, H - 12.5);
        doc.text(t(`ROUTE MAP · Plano de fusão · ${projectName}`), MX, H - 8.5);
        doc.text(`Página ${p} de ${total}`, W - MX, H - 8.5, { align: 'right' });
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
