// PDF do relatório desenhado direto com jsPDF + jspdf-autotable: texto de verdade (selecionável,
// pesquisável e nítido em qualquer zoom), tabelas com cabeçalho repetido e quebra de página
// controlada. Usa o mesmo "snapshot" da pré-visualização, então as edições feitas nas folhas
// entram no arquivo. Cabeçalho e rodapé: decorateReportPdf (script.js).

const RPDF = {
    w: 210,
    h: 297,
    mx: 16,
    top: 16,
    topNext: 19,
    bottom: 20,
    ink: [22, 50, 63],
    head: [23, 63, 78],
    muted: [91, 116, 131],
    line: [219, 229, 235],
    brand: [47, 122, 148],
    green: [31, 157, 74],
    soft: [245, 248, 250],
    soft2: [227, 241, 246],
    mat: [47, 122, 148],
    lab: [124, 58, 237],
    coef: [217, 119, 6],
};

let reportLogoDataUrl = null;

async function loadReportLogo() {
    if (reportLogoDataUrl) return reportLogoDataUrl;
    try {
        const blob = await (await fetch('img/logo.png')).blob();
        reportLogoDataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        reportLogoDataUrl = null;
    }
    return reportLogoDataUrl;
}

//As fontes padrão do PDF usam WinAnsi: troca o que não existe nela
function pdfText(value) {
    return String(value ?? '')
        .replace(/[   ]/g, ' ')
        .replace(/→/g, '->')
        .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff–—‘’‚“”„†‡•…‰‹›€™]/g, '');
}

class ReportPdfWriter {
    constructor(doc) {
        this.doc = doc;
        this.y = RPDF.top;
        this.width = RPDF.w - RPDF.mx * 2;
    }

    get limit() { return RPDF.h - RPDF.bottom; }

    addPage() {
        this.doc.addPage();
        this.y = RPDF.topNext;
    }

    ensure(height) {
        if (this.y + height > this.limit) this.addPage();
    }

    font(size, style = 'normal', color = RPDF.ink) {
        this.doc.setFont('helvetica', style);
        this.doc.setFontSize(size);
        this.doc.setTextColor(...color);
    }

    text(value, x, y, options) {
        this.doc.text(pdfText(value), x, y, options);
    }

    //Diminui a fonte até o texto caber na largura
    fitText(value, x, y, maxWidth, size, style, color, options) {
        let s = size;
        this.font(s, style, color);
        while (s > 7 && this.doc.getTextWidth(pdfText(value)) > maxWidth) {
            s -= 0.5;
            this.font(s, style, color);
        }
        this.text(value, x, y, options);
    }

    sectionTitle(title, { keepWith = 24 } = {}) {
        this.ensure(10 + keepWith);
        if (this.y > RPDF.topNext + 1) this.y += 3;
        this.doc.setFillColor(...RPDF.brand);
        this.doc.rect(RPDF.mx, this.y, 1.1, 5, 'F');
        this.font(10, 'bold', RPDF.head);
        this.text(String(title).toUpperCase(), RPDF.mx + 3.5, this.y + 4);
        this.y += 9;
    }

    //Tabela que cabe numa página não é partida: se não couber no resto desta, vai inteira (com o título) para a próxima
    keepTable(rowCount) {
        const height = (rowCount + 2) * 6.3 + 12;
        const pageRoom = this.limit - RPDF.topNext;
        if (height <= pageRoom && this.y + height > this.limit) this.addPage();
    }

    subTitle(title) {
        this.ensure(46);
        this.font(9.5, 'bold', RPDF.brand);
        this.text(title, RPDF.mx, this.y + 3.5);
        this.y += 6;
    }

    note(text) {
        this.font(8.5, 'normal', RPDF.muted);
        const lines = this.doc.splitTextToSize(pdfText(text), this.width);
        this.ensure(lines.length * 4 + 2);
        this.doc.text(lines, RPDF.mx, this.y + 3);
        this.y += lines.length * 4 + 2;
    }

    //Grade de pares rótulo/valor em duas colunas, com linha fina entre as linhas
    detailGrid(rows, { highlightLast = false } = {}) {
        const list = highlightLast ? rows.slice(0, -1) : rows.slice();
        const gap = 8;
        const colW = (this.width - gap) / 2;
        const rowH = 7;
        for (let i = 0; i < list.length; i += 2) {
            this.ensure(rowH);
            [list[i], list[i + 1]].forEach((row, col) => {
                if (!row) return;
                const x = RPDF.mx + col * (colW + gap);
                this.font(8.5, 'normal', RPDF.muted);
                const label = this.doc.splitTextToSize(pdfText(row.label), colW * 0.62)[0];
                this.doc.text(label, x + 0.5, this.y + 4.6);
                this.fitText(row.value, x + colW - 0.5, this.y + 4.6, colW * 0.42, 8.8, 'bold', RPDF.ink, { align: 'right' });
                this.doc.setDrawColor(...RPDF.line);
                this.doc.setLineWidth(0.2);
                this.doc.line(x, this.y + rowH, x + colW, this.y + rowH);
            });
            this.y += rowH;
        }
        this.y += 2;
        if (highlightLast && rows.length) this.totalBar(rows[rows.length - 1].label, rows[rows.length - 1].value);
    }

    //Faixa escura com o valor final (custo total, total geral)
    totalBar(label, value, { height = 12 } = {}) {
        this.ensure(height + 2);
        this.doc.setFillColor(...RPDF.head);
        this.doc.roundedRect(RPDF.mx, this.y, this.width, height, 2, 2, 'F');
        this.font(9.5, 'bold', [255, 255, 255]);
        this.text(label, RPDF.mx + 5, this.y + height / 2 + 1.3);
        this.fitText(value, RPDF.mx + this.width - 5, this.y + height / 2 + 1.8, this.width * 0.5, 14, 'bold', [255, 255, 255], { align: 'right' });
        this.y += height + 4;
    }

    kpis(items) {
        const gap = 4;
        const count = items.length || 1;
        const w = (this.width - gap * (count - 1)) / count;
        const h = 21;
        this.ensure(h + 4);
        items.forEach((kpi, i) => {
            const x = RPDF.mx + i * (w + gap);
            const primary = i === 0;
            if (primary) {
                this.doc.setFillColor(...RPDF.head);
                this.doc.roundedRect(x, this.y, w, h, 2.2, 2.2, 'F');
            } else {
                this.doc.setFillColor(...RPDF.soft);
                this.doc.setDrawColor(...RPDF.line);
                this.doc.setLineWidth(0.25);
                this.doc.roundedRect(x, this.y, w, h, 2.2, 2.2, 'FD');
            }
            this.font(6.8, 'bold', primary ? [190, 214, 223] : RPDF.muted);
            this.text(this.doc.splitTextToSize(pdfText(kpi.label).toUpperCase(), w - 7)[0], x + 3.5, this.y + 6.5);
            this.fitText(kpi.value, x + 3.5, this.y + 15.5, w - 7, 13.5, 'bold', primary ? [255, 255, 255] : RPDF.ink);
        });
        this.y += h + 5;
    }

    costBar(share) {
        if (!share) return;
        this.ensure(14);
        const h = 3.6;
        let x = RPDF.mx;
        const parts = [
            { value: share.mat, color: RPDF.mat, label: `Materiais ${share.matText}` },
            { value: share.lab, color: RPDF.lab, label: `Mão de obra ${share.labText}` },
            { value: share.coef, color: RPDF.coef, label: `Coef. de segurança ${share.coefText}` },
        ];
        this.doc.setFillColor(...RPDF.soft2);
        this.doc.roundedRect(RPDF.mx, this.y, this.width, h, 1.5, 1.5, 'F');
        parts.forEach(part => {
            const w = Math.max(0, (part.value / 100) * this.width);
            if (w < 0.2) return;
            this.doc.setFillColor(...part.color);
            this.doc.rect(x, this.y, w, h, 'F');
            x += w;
        });
        this.y += h + 4.5;
        let lx = RPDF.mx;
        parts.forEach(part => {
            this.doc.setFillColor(...part.color);
            this.doc.roundedRect(lx, this.y - 2.4, 2.6, 2.6, 0.5, 0.5, 'F');
            this.font(8, 'normal', RPDF.muted);
            this.text(part.label, lx + 4, this.y);
            lx += 4 + this.doc.getTextWidth(pdfText(part.label)) + 7;
        });
        this.y += 5;
    }

    table({ head, body, columnStyles }) {
        this.doc.autoTable({
            startY: this.y,
            head: head ? [head] : undefined,
            body,
            theme: 'grid',
            showHead: 'everyPage',
            rowPageBreak: 'avoid',
            margin: { left: RPDF.mx, right: RPDF.mx, top: RPDF.topNext, bottom: RPDF.bottom },
            styles: {
                font: 'helvetica',
                fontSize: 8.2,
                textColor: RPDF.ink,
                lineColor: RPDF.line,
                lineWidth: 0.15,
                cellPadding: { top: 1.7, bottom: 1.7, left: 2.2, right: 2.2 },
                overflow: 'linebreak',
                valign: 'middle',
            },
            headStyles: { fillColor: RPDF.head, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
            alternateRowStyles: { fillColor: RPDF.soft },
            columnStyles,
        });
        this.y = this.doc.lastAutoTable.finalY + 5;
    }

    moneyTable(rows, subtotalLabel, subtotalText, firstHeader) {
        //Não começa a tabela no pé da página com poucas linhas
        this.ensure(Math.min(rows.length + 1, 6) * 6.2 + 8);
        const body = rows.map(row => [pdfText(row.name), pdfText(row.qty ?? row.qtyText), pdfText(row.unit || 'un'), pdfText(row.unitPriceText), pdfText(row.totalText)]);
        if (subtotalText) {
            body.push([
                { content: pdfText(subtotalLabel), colSpan: 4, styles: { halign: 'right', fontStyle: 'bold', fillColor: RPDF.soft2 } },
                { content: pdfText(subtotalText), styles: { halign: 'right', fontStyle: 'bold', fillColor: RPDF.soft2 } },
            ]);
        }
        this.table({
            head: [firstHeader, 'Qtd.', 'Un.', 'Valor unit.', 'Total'],
            body,
            columnStyles: {
                1: { halign: 'right', cellWidth: 17 },
                2: { halign: 'center', cellWidth: 12 },
                3: { halign: 'right', cellWidth: 27 },
                4: { halign: 'right', cellWidth: 29 },
            },
        });
    }

    //Texto livre em caixa (quebra entre páginas quando for longo)
    notesBox(text) {
        const padding = 4;
        const lineH = 4.4;
        this.font(9, 'normal', RPDF.ink);
        const lines = pdfText(text).split(/\r?\n/).flatMap(l => this.doc.splitTextToSize(l || ' ', this.width - padding * 2 - 2));
        let index = 0;
        while (index < lines.length) {
            this.ensure(lineH * 2 + padding * 2);
            const room = Math.floor((this.limit - this.y - padding * 2) / lineH);
            const chunk = lines.slice(index, index + Math.max(1, room));
            const h = chunk.length * lineH + padding * 2;
            this.doc.setFillColor(...RPDF.soft);
            this.doc.setDrawColor(...RPDF.line);
            this.doc.setLineWidth(0.25);
            this.doc.roundedRect(RPDF.mx, this.y, this.width, h, 2, 2, 'FD');
            this.doc.setFillColor(...RPDF.brand);
            this.doc.rect(RPDF.mx, this.y, 1.1, h, 'F');
            this.font(9, 'normal', RPDF.ink);
            this.doc.text(chunk, RPDF.mx + padding + 1.5, this.y + padding + 3);
            this.y += h + 4;
            index += chunk.length;
        }
    }

    //Sem observações: linhas para anotar à mão
    blankNotes(lines = 7) {
        const spacing = 8;
        this.ensure(lines * spacing + 6);
        this.font(7.5, 'italic', RPDF.muted);
        this.text('Espaço para anotações', RPDF.mx, this.y + 3);
        this.doc.setDrawColor(...RPDF.line);
        this.doc.setLineWidth(0.25);
        for (let i = 1; i <= lines; i++) {
            const y = this.y + 3 + i * spacing;
            this.doc.line(RPDF.mx, y, RPDF.mx + this.width, y);
        }
        this.y += lines * spacing + 8;
    }
}

async function exportReportPdfNative(snapshot, filename) {
    const JsPDF = window.jspdf?.jsPDF;
    if (!JsPDF) throw new Error('Biblioteca de PDF não carregada. Recarregue a página e tente novamente.');
    const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    if (typeof doc.autoTable !== 'function') throw new Error('Complemento de tabelas do PDF não carregado. Recarregue a página.');
    const pdf = new ReportPdfWriter(doc);
    const options = snapshot.options || { bom: true, labor: true, notes: true };
    const logo = await loadReportLogo();

    //Capa: marca, empresa, data, título e local
    if (logo) doc.addImage(logo, 'PNG', RPDF.mx, 14, 12, 12);
    const brandX = RPDF.mx + (logo ? 15 : 0);
    pdf.font(13, 'bold', RPDF.head);
    pdf.text('ROUTE MAP', brandX, 19.5);
    pdf.font(8.8, 'normal', RPDF.muted);
    pdf.text(snapshot.company || 'Redes de fibra óptica', brandX, 24.5);
    pdf.font(7, 'bold', RPDF.muted);
    pdf.text('RELATÓRIO DO PROJETO', RPDF.w - RPDF.mx, 19, { align: 'right' });
    pdf.font(8.5, 'normal', RPDF.ink);
    pdf.text(snapshot.generatedAt || '', RPDF.w - RPDF.mx, 24.5, { align: 'right' });
    doc.setDrawColor(...RPDF.brand);
    doc.setLineWidth(0.6);
    doc.line(RPDF.mx, 30, RPDF.w - RPDF.mx, 30);
    pdf.y = 40;
    pdf.font(21, 'bold', RPDF.head);
    const titleLines = doc.splitTextToSize(pdfText(snapshot.title || 'Projeto'), pdf.width);
    doc.text(titleLines, RPDF.mx, pdf.y);
    pdf.y += titleLines.length * 8.2;
    const chips = [snapshot.locationLine, snapshot.author ? `Elaborado por ${snapshot.author}` : ''].filter(Boolean);
    let cx = RPDF.mx;
    chips.forEach((chip, i) => {
        pdf.font(8.3, i === 0 ? 'bold' : 'normal', i === 0 ? RPDF.brand : RPDF.muted);
        const w = doc.getTextWidth(pdfText(chip)) + 7;
        doc.setFillColor(...(i === 0 ? RPDF.soft2 : RPDF.soft));
        doc.roundedRect(cx, pdf.y - 1, w, 6.4, 3.2, 3.2, 'F');
        pdf.text(chip, cx + 3.5, pdf.y + 3.3);
        cx += w + 3;
    });
    pdf.y += chips.length ? 12 : 4;

    pdf.sectionTitle('Indicadores', { keepWith: 26 });
    pdf.kpis(snapshot.kpis || []);

    pdf.sectionTitle('Rede e cobertura');
    pdf.detailGrid(snapshot.networkRows || []);

    if (snapshot.clientRows?.length) {
        pdf.sectionTitle('Clientes');
        pdf.detailGrid(snapshot.clientRows);
    }

    pdf.sectionTitle('Materiais — resumo de custos');
    pdf.detailGrid(snapshot.materialRows || []);

    if (options.bom && snapshot.bomCategories?.length) {
        pdf.sectionTitle('Lista de materiais', { keepWith: 34 });
        pdf.note('Quantitativos por categoria, com valor unitário e subtotais.');
        snapshot.bomCategories.forEach(category => {
            pdf.keepTable(category.rows.length);
            pdf.subTitle(category.title);
            pdf.moneyTable(category.rows, 'Subtotal', category.subtotalText, 'Material');
        });
        if (snapshot.bomGrandTotalText) pdf.totalBar('Total geral da lista de materiais', snapshot.bomGrandTotalText, { height: 10 });
    }

    pdf.sectionTitle('Mão de obra');
    pdf.detailGrid(snapshot.laborRows || []);
    if (options.labor) {
        if (snapshot.regionalLabor) {
            pdf.subTitle(snapshot.regionalLabor.title);
            pdf.detailGrid(snapshot.regionalLabor.rows);
        }
        if (snapshot.outsourcedLabor) {
            pdf.keepTable(snapshot.outsourcedLabor.rows.length);
            pdf.subTitle(snapshot.outsourcedLabor.title);
            pdf.moneyTable(snapshot.outsourcedLabor.rows, 'Total terceirizada', snapshot.outsourcedLabor.totalText, 'Serviço');
        }
    }

    pdf.sectionTitle('Resumo financeiro', { keepWith: 40 });
    pdf.costBar(snapshot.costShare);
    pdf.detailGrid(snapshot.financialRows || [], { highlightLast: true });

    if (options.notes) {
        pdf.sectionTitle('Observações', { keepWith: 20 });
        if (snapshot.observations && snapshot.observations.trim()) pdf.notesBox(snapshot.observations.trim());
        else pdf.blankNotes();
    }

    decorateReportPdf(doc, snapshot);
    doc.save(filename);
    return doc.internal.getNumberOfPages();
}
