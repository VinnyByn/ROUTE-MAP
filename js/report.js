// Relatório do projeto: janela de escolha dos projetos, quantitativos, custos, prazo, prévia paginada
// e exportação (PDF e Word). O desenho do PDF fica em js/report-pdf.js.
// Depende de script.js (markers, savedCables, projectBoms), js/bom.js e js/labor.js.

//Abertura do modal de relatórios
function getReportProjectTypeClass(type) {
    if (!type) return '';
    const normalized = String(type).toLowerCase();
    if (normalized === 'tct') return 'type-tct';
    if (normalized === 'mdu') return 'type-mdu';
    return '';
}

function buildReportProjectListItem(projEl) {
    const li = document.createElement("li");
    li.dataset.projectId = projEl.dataset.folderId;
    li.className = 'report-pick';
    li.setAttribute("role", "option");
    li.setAttribute("tabindex", "0");

    const projectName = projEl.dataset.folderName || 'Projeto sem nome';
    const projectCity = projEl.dataset.folderCity || 'Cidade não informada';
    const projectNeighborhood = projEl.dataset.folderNeighborhood || 'Bairro não informado';
    const projectType = projEl.dataset.folderType || 'TCR';
    li.dataset.searchText = `${projectName} ${projectCity} ${projectNeighborhood} ${projectType}`.toLowerCase();

    //Resumo rápido (custo e portas) para escolher o projeto certo
    let quickStats = '';
    try {
        const data = computeProjectReportData(projEl.dataset.folderId);
        if (data) {
            quickStats = `<span class="report-pick__stat"><b>${formatPdfCurrency(data.finalCost)}</b> custo total</span>`
                + `<span class="report-pick__stat"><b>${data.novasPortas}</b> novas portas</span>`
                + `<span class="report-pick__stat"><b>${data.quantities.cableLength} m</b> lançamento</span>`;
        }
    } catch (e) { /* projeto ainda incompleto: sem resumo */ }

    li.innerHTML = `
        <span class="report-pick__icon" aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24"><use href="#i-report"></use></svg></span>
        <div class="report-pick__body">
            <div class="report-pick__head">
                <strong>${escapeHtml(projectName)}</strong>
                <span class="report-type-pill">${escapeHtml(projectType)}</span>
            </div>
            <span class="report-pick__place">${escapeHtml(projectCity)} · ${escapeHtml(projectNeighborhood)}</span>
            ${quickStats ? `<div class="report-pick__stats">${quickStats}</div>` : ''}
        </div>
        <svg class="ui-icon report-pick__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
    `;

    const openReport = () => showProjectReportDetails(li.dataset.projectId, projectName);
    li.addEventListener("click", openReport);
    li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openReport();
        }
    });
    return li;
}

function filterReportProjectList() {
    const query = (document.getElementById("reportProjectSearch")?.value || "").trim().toLowerCase();
    const items = document.querySelectorAll("#report-projects-ul li[data-search-text]");
    let visibleCount = 0;

    items.forEach((item) => {
        const matches = !query || item.dataset.searchText.includes(query);
        item.classList.toggle("hidden", !matches);
        if (matches) visibleCount++;
    });

    const noResultsEl = document.getElementById("report-no-results");
    if (noResultsEl) {
        noResultsEl.classList.toggle("hidden", visibleCount > 0 || items.length === 0);
    }
}

function openReportModal() {
    const projectListUl = document.getElementById("report-projects-ul");
    const searchInput = document.getElementById("reportProjectSearch");
    const searchWrap = document.getElementById("reportProjectSearchWrap");
    projectListUl.innerHTML = "";
    document.getElementById('reportModalTitle').textContent = 'Relatório do projeto';

    const projectElements = document.querySelectorAll('.folder-title[data-is-project="true"]');

    if (projectElements.length === 0) {
        searchWrap?.classList.add("hidden");
        if (searchInput) searchInput.value = "";
        projectListUl.innerHTML = `
            <li class="report-list-empty">
                <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-folder-plus"></use></svg>
                <p>Nenhum projeto aberto</p>
                <span>Abra ou crie um projeto para gerar o relatório.</span>
            </li>
        `;
    } else {
        projectElements.forEach((projEl) => {
            projectListUl.appendChild(buildReportProjectListItem(projEl));
        });

        const noResults = document.createElement("li");
        noResults.id = "report-no-results";
        noResults.className = "report-list-no-results hidden";
        noResults.textContent = "Nenhum projeto corresponde à sua busca.";
        projectListUl.appendChild(noResults);

        searchWrap?.classList.toggle("hidden", projectElements.length <= 3);
        if (searchInput) searchInput.value = "";
    }

    document.getElementById("report-project-details").classList.add("hidden");
    document.getElementById("report-project-list").classList.remove("hidden");
    document.querySelector('#reportModal .report-modal').classList.remove('is-details');
    document.getElementById("reportModal").style.display = "flex";
}

//Geração e exibição de detalhes do relatório de projeto
function countProjectPorts(projectMarkers) {
    let portasExistentes = 0;
    let novasPortas = 0;
    projectMarkers.forEach(marker => {
        if ((marker.type === 'CTO' || marker.type === 'CEO') && marker.fusionPlan) {
            try {
                const plan = readFusionPlan(marker);
                if (!plan || plan.empty || plan.fromLegacyCanvas) return;
                plan.splitters.filter(s => s.atendimento).forEach(splitter => {
                    const status = splitter.status;
                    const label = splitter.label || null;
                    if (!label || !status) return;
                    const ratioMatch = label.match(/1:(\d+)/);
                    const portsInThisSplitter = ratioMatch ? parseInt(ratioMatch[1], 10) : 0;
                    if (status === 'Existente') {
                        portasExistentes += portsInThisSplitter;
                    } else {
                        novasPortas += portsInThisSplitter;
                    }
                });
            } catch (e) {
                console.error(`Erro ao analisar portas no plano de fusão da caixa "${marker.name}":`, e);
            }
        }
    });
    return { portasExistentes, novasPortas, totalPortas: portasExistentes + novasPortas };
}

function computeProjectReportData(projectId) {
    const projectElement = document.querySelector(`.folder-title[data-folder-id="${projectId}"]`);
    if (!projectElement) return null;

    const projectName = projectElement.dataset.folderName || 'Projeto sem nome';
    const { markers: projectMarkers, cables: projectCables } = getProjectItems(projectId);
    const projectItems = { markers: projectMarkers, cables: projectCables };
    const quantities = getProjectQuantitiesFromItems(projectItems, projectId);
    const { portasExistentes, novasPortas, totalPortas } = countProjectPorts(projectMarkers);
    const totalCasas = projectMarkers.filter(m => m.type === 'CASA').reduce((sum, m) => sum + parseInt(m.name || 0, 10), 0);

    const clientMarkers = projectMarkers.filter(m => m.type === 'CLIENTE');
    const clients = {
        total: clientMarkers.length,
        b2b: clientMarkers.filter(c => c.client?.kind === 'b2b').length,
        predial: clientMarkers.filter(c => c.client?.kind === 'predial').length,
        viabilidade: clientMarkers.filter(c => c.client?.status === 'viabilidade').length,
        aInstalar: clientMarkers.filter(c => c.client?.status === 'a_instalar').length,
        instalado: clientMarkers.filter(c => c.client?.status === 'instalado').length,
    };

    const projectBomForReport = normalizeBomState(projectBoms[projectId] || {});
    const materialCosts = summarizeBomCosts(projectBomForReport);
    const laborCosts = calculateProjectLaborCost(projectItems, projectBomForReport);
    const materialCost = materialCosts.grandTotal;
    const laborCost = laborCosts.totalLaborCost;
    const totalCost = materialCost + laborCost;
    const safetyCoef = totalCost * 0.05;
    const finalCost = totalCost + safetyCoef;
    const costPerPort = novasPortas > 0 ? (finalCost / novasPortas) : 0;
    const prazoEstimado = getProjectEstimatedDurationDays(projectBomForReport, quantities);
    const penetrationRate = totalCasas > 0 ? (totalPortas / totalCasas) * 100 : 0;
    const coverageRate = totalCasas > 0 ? Math.min(100, (totalPortas / totalCasas) * 100) : 0;

    const materialClasseL = materialCosts.ferragemTotal + materialCosts.cabosTotal;
    const materialClasseF = materialCosts.fusaoTotal;
    const materialDataCenter = materialCosts.datacenterTotal;

    const outsourcedLaborDetails = getOutsourcedLaborDetails(projectBomForReport);
    const regionalLaborDetails = getRegionalLaborDetails(projectBomForReport);
    const bomItemsByCategory = groupBomItemsForPdf(projectBomForReport);

    return {
        projectId,
        projectName,
        projectCode: projectName,
        city: projectElement.dataset.folderCity || '',
        neighborhood: projectElement.dataset.folderNeighborhood || '',
        projectType: projectElement.dataset.folderType || 'TCR',
        quantities,
        clients,
        portasExistentes,
        novasPortas,
        totalPortas,
        totalCasas,
        penetrationRate,
        coverageRate,
        materialCosts,
        laborCosts,
        materialCost,
        laborCost,
        totalCost,
        safetyCoef,
        finalCost,
        costPerPort,
        prazoEstimado,
        materialClasseL,
        materialClasseF,
        materialDataCenter,
        observations: projectObservations[projectId] || '',
        outsourcedLaborDetails,
        regionalLaborDetails,
        bomItemsByCategory,
        postCount: Math.ceil(quantities.cableLength / getPoleSpanDistance()),
    };
}

function getOutsourcedLaborDetails(projectBom) {
    for (const name in projectBom) {
        const item = projectBom[name];
        if (item.removed || item.type !== 'Outsourced') continue;
        const details = item.details || {};
        const services = (details.services || []).map(service => ({
            ...service,
            total: (service.qty || 0) * (service.price || 0),
            laborClass: classifyOutsourcedLaborService(service.name),
        }));
        const launchTotal = services.filter(s => s.laborClass === 'L').reduce((sum, s) => sum + s.total, 0);
        const fusionTotal = services.filter(s => s.laborClass === 'F').reduce((sum, s) => sum + s.total, 0);
        return {
            companyName: details.companyName || name.replace('Mão de Obra - ', ''),
            services,
            launchTotal,
            fusionTotal,
            totalCost: details.totalCost || (launchTotal + fusionTotal),
        };
    }
    return null;
}

function classifyOutsourcedLaborService(serviceName) {
    const upper = String(serviceName || '').toUpperCase();
    const launchKeywords = ['LANÇAMENTO', 'CORDOALHA', 'REMOÇÃO', 'POSTE', 'RESERVA'];
    return launchKeywords.some(keyword => upper.includes(keyword)) ? 'L' : 'F';
}

function getRegionalLaborInformedDays(details) {
    if (!details) return null;
    if (details.manualDays !== undefined && details.manualDays !== null) {
        return parseInt(details.manualDays, 10) || 0;
    }
    return null;
}

function calculateProjectDurationDays(quantities) {
    return estimateLaborDays(quantities);
}

function getProjectEstimatedDurationDays(projectBom, quantities) {
    const regionalItem = projectBom['Mão de Obra Regional'];
    if (regionalItem && !regionalItem.removed && regionalItem.details) {
        const informedDays = getRegionalLaborInformedDays(regionalItem.details);
        if (informedDays !== null) {
            return informedDays;
        }
    }
    return calculateProjectDurationDays(quantities);
}

function getRegionalLaborDetails(projectBom) {
    const item = projectBom['Mão de Obra Regional'];
    if (!item || item.removed) return null;
    const details = item.details || {};
    const informedDays = getRegionalLaborInformedDays(details);
    const days = informedDays !== null ? informedDays : (parseInt(details.days, 10) || 0);
    const techs = details.techs || 0;
    const hourlyRate = (techs > 0 && days > 0 && details.baseCost)
        ? details.baseCost / (techs * days * 8)
        : 40;
    return {
        techs,
        hourlyRate,
        days,
        totalCost: details.totalCost || item.unitPrice || 0,
    };
}

function groupBomItemsForPdf(projectBom) {
    const groups = {
        ferragens: [],
        cabos: [],
        fusao: [],
        datacenterPassive: [],
        datacenterActive: [],
    };

    for (const bomKey in projectBom) {
        const item = projectBom[bomKey];
        const section = getBomCostSection(item);
        if (!section) continue;
        const materialName = getMaterialDisplayName(bomKey, item);
        const unit = item.type === 'length' ? 'm' : (item.type || 'un');
        const qty = item.quantity || 0;
        const unitPrice = item.unitPrice || 0;
        const total = qty * unitPrice;
        const row = { name: materialName, unit, qty, unitPrice, total };

        if (section === 'Ferragem') {
            groups.ferragens.push(row);
        } else if (section === 'Lançamento') {
            groups.cabos.push(row);
        } else if (section === 'Fusão') {
            groups.fusao.push(row);
        } else if (section === 'Data Center') {
            if (isActiveDatacenterItem(materialName)) {
                groups.datacenterActive.push(row);
            } else {
                groups.datacenterPassive.push(row);
            }
        }
    }

    const sortByName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
    Object.values(groups).forEach(list => list.sort(sortByName));
    return groups;
}

function isActiveDatacenterItem(materialName) {
    const upper = String(materialName || '').toUpperCase();
    return /PLACA|LICENÇ|OLT|CHASSI|SFP|XFP|MÓDULO|SWITCHING|CONTROLADORA/.test(upper);
}

function formatPdfCurrency(value) {
    const safeValue = Number.isFinite(value) ? value : 0;
    const [intPart, decPart] = safeValue.toFixed(2).split('.');
    const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `R$ ${withDots},${decPart}`;
}

function formatPdfNumber(value) {
    const safeValue = Number.isFinite(value) ? value : 0;
    const [intPart, decPart] = safeValue.toFixed(2).split('.');
    const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return decPart === '00' ? withDots : `${withDots},${decPart}`;
}

let reportPreviewOriginalSnapshot = null;
let reportPreviewResizeTimer = null;

function escapeReportPreviewHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function createReportPreviewSnapshot(data) {
    const bom = data.bomItemsByCategory || {};
    const q = data.quantities || {};
    const locationLine = [data.city, data.neighborhood, data.projectType].filter(Boolean).join(' · ');

    const bomCategoryDefs = [
        { key: 'ferragens', title: 'Ferragens' },
        { key: 'cabos', title: 'Cabos / Lançamento' },
        { key: 'fusao', title: 'Fusão' },
        { key: 'datacenterPassive', title: 'Data Center — Passivo' },
        { key: 'datacenterActive', title: 'Data Center — Ativo' },
    ];

    const bomCategories = bomCategoryDefs.map(({ key, title }) => {
        const sourceRows = bom[key] || [];
        const rows = sourceRows.map((row) => ({
            name: row.name,
            qty: formatPdfNumber(row.qty),
            unit: row.unit === 'm' ? 'm' : 'un',
            unitPriceText: formatPdfCurrency(row.unitPrice),
            totalText: formatPdfCurrency(row.total),
        }));
        const subtotalNum = sourceRows.reduce((sum, row) => sum + (row.total || 0), 0);
        return { title, rows, subtotalText: formatPdfCurrency(subtotalNum) };
    }).filter((category) => category.rows.length > 0);

    const bomGrandTotalNum = bomCategoryDefs
        .flatMap(({ key }) => bom[key] || [])
        .reduce((sum, row) => sum + (row.total || 0), 0);

    const clients = data.clients || { total: 0 };
    const shareBase = (data.materialCost + data.laborCost + data.safetyCoef) || 1;

    const snapshot = {
        projectId: data.projectId,
        projectCode: data.projectCode || data.projectName,
        projectType: data.projectType,
        company: AppSession.company?.name || '',
        author: AppSession.displayName || '',
        title: data.projectName,
        locationLine,
        generatedAt: `Gerado em ${new Date().toLocaleString('pt-BR')}`,
        //Observações entram marcadas quando existem; sem texto, a opção imprime um espaço para anotações
        options: { bom: true, labor: true, notes: !!(data.observations && data.observations.trim()) },
        costShare: {
            mat: (data.materialCost / shareBase) * 100,
            lab: (data.laborCost / shareBase) * 100,
            coef: (data.safetyCoef / shareBase) * 100,
            matText: formatPdfCurrency(data.materialCost),
            labText: formatPdfCurrency(data.laborCost),
            coefText: formatPdfCurrency(data.safetyCoef),
        },
        kpis: [
            { label: 'Custo total (com coef.)', value: formatPdfCurrency(data.finalCost) },
            { label: 'Novas portas', value: String(data.novasPortas) },
            { label: 'Lançamento', value: `${q.cableLength || 0} m` },
            { label: 'Prazo estimado', value: `${data.prazoEstimado} dias` },
        ],
        networkRows: [
            { label: 'Bairro', value: data.neighborhood || 'N/A' },
            { label: 'Casas (HP)', value: String(data.totalCasas) },
            { label: 'Portas existentes (HC)', value: String(data.portasExistentes) },
            { label: 'Novas portas', value: String(data.novasPortas) },
            { label: 'Total de portas', value: String(data.totalPortas) },
            { label: 'Taxa de penetração', value: `${data.penetrationRate.toFixed(2).replace('.', ',')}%` },
            { label: 'Lançamento estimado', value: `${q.cableLength || 0} m` },
            { label: 'Postes (estimativa)', value: String(data.postCount || 0) },
            { label: 'CTOs novas', value: String(q.ctoCount || 0) },
            { label: 'CEOs novas', value: String(q.ceoCount || 0) },
            { label: 'Reservas novas', value: String(q.reservaCount || 0) },
            { label: 'Cordoalhas novas', value: String(q.cordoalhaCount || 0) },
        ],
        clientRows: clients.total ? [
            { label: 'Clientes cadastrados', value: String(clients.total) },
            { label: 'Empresariais (B2B)', value: String(clients.b2b) },
            { label: 'Prediais', value: String(clients.predial) },
            { label: 'Em viabilidade', value: String(clients.viabilidade) },
            { label: 'A instalar', value: String(clients.aInstalar) },
            { label: 'Instalados', value: String(clients.instalado) },
        ] : [],
        materialRows: [
            { label: 'Ferragens', value: formatPdfCurrency(data.materialCosts.ferragemTotal) },
            { label: 'Cabos', value: formatPdfCurrency(data.materialCosts.cabosTotal) },
            { label: 'Fusão', value: formatPdfCurrency(data.materialCosts.fusaoTotal) },
            { label: 'Data Center', value: formatPdfCurrency(data.materialCosts.datacenterTotal) },
            { label: 'Total de materiais', value: formatPdfCurrency(data.materialCost) },
        ],
        bomCategories,
        bomGrandTotalText: bomGrandTotalNum > 0 ? formatPdfCurrency(bomGrandTotalNum) : null,
        laborRows: [
            { label: 'M.O. regional', value: formatPdfCurrency(data.laborCosts.regionalCost) },
            { label: 'M.O. terceirizada', value: formatPdfCurrency(data.laborCosts.outsourcedCost) },
            { label: 'Total de mão de obra', value: formatPdfCurrency(data.laborCost) },
        ],
        regionalLabor: null,
        outsourcedLabor: null,
        financialRows: [
            { label: 'Subtotal (materiais + mão de obra)', value: formatPdfCurrency(data.totalCost) },
            { label: 'Coef. de segurança (5%)', value: formatPdfCurrency(data.safetyCoef) },
            { label: 'Custo por nova porta', value: formatPdfCurrency(data.costPerPort) },
            { label: 'Prazo da obra', value: `${data.prazoEstimado} dias` },
            { label: 'Custo total final', value: formatPdfCurrency(data.finalCost) },
        ],
        observations: (data.observations || '').trim(),
    };

    if (data.regionalLaborDetails) {
        const rd = data.regionalLaborDetails;
        snapshot.regionalLabor = {
            title: 'Detalhe — M.O. regional',
            rows: [
                { label: 'Técnicos', value: String(rd.techs) },
                { label: 'Dias', value: String(rd.days) },
                { label: 'Valor hora', value: formatPdfCurrency(rd.hourlyRate) },
                { label: 'Total', value: formatPdfCurrency(rd.totalCost) },
            ],
        };
    }

    if (data.outsourcedLaborDetails?.services?.length) {
        const od = data.outsourcedLaborDetails;
        snapshot.outsourcedLabor = {
            title: `Detalhe — M.O. terceirizada (${od.companyName})`,
            rows: od.services.map((service) => ({
                name: service.name || '—',
                qty: String(service.qty ?? 0),
                unit: 'un',
                unitPriceText: formatPdfCurrency(service.price),
                totalText: formatPdfCurrency(service.total),
            })),
            totalText: formatPdfCurrency(od.totalCost),
        };
    }

    return snapshot;
}

const REPORT_PREVIEW_PAGE_WIDTH_MM = 210;
const REPORT_PREVIEW_PAGE_HEIGHT_MM = 297;
const REPORT_PREVIEW_PAGE_PADDING_TOP_MM = 14;
const REPORT_PREVIEW_PAGE_PADDING_BOTTOM_MM = 10;
const REPORT_PREVIEW_PAGE_PADDING_X_MM = 16;
const REPORT_PREVIEW_PAGE_FOOTER_RESERVE_MM = 7;

let reportPreviewMmToPxRatio = null;

function getReportPreviewPagesRoot() {
    return document.getElementById('reportPreviewPages');
}

function getReportPreviewMmToPx() {
    if (reportPreviewMmToPxRatio) return reportPreviewMmToPxRatio;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:-9999px;top:0;height:100mm;width:1mm;visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
    reportPreviewMmToPxRatio = probe.getBoundingClientRect().height / 100;
    probe.remove();
    return reportPreviewMmToPxRatio;
}

function reportPreviewMmToPx(mm) {
    return Math.round(getReportPreviewMmToPx() * mm);
}

function createReportPreviewMeasurePage() {
    const pageBundle = createReportPreviewPageElement();
    pageBundle.page.style.position = 'fixed';
    pageBundle.page.style.left = '-10000px';
    pageBundle.page.style.top = '0';
    pageBundle.page.style.visibility = 'hidden';
    pageBundle.page.style.pointerEvents = 'none';
    document.body.appendChild(pageBundle.page);
    return pageBundle;
}

function removeReportPreviewMeasurePage(pageBundle) {
    pageBundle?.page?.remove();
}

function createReportPreviewFlowBlock(html, extraClass = '') {
    const block = document.createElement('div');
    block.className = `rp-flow-block${extraClass ? ` ${extraClass}` : ''}`;
    block.innerHTML = html;
    return block;
}

function createReportPreviewPageElement() {
    const page = document.createElement('div');
    page.className = 'report-preview-page';

    const content = document.createElement('div');
    content.className = 'report-preview-page-content';
    page.appendChild(content);

    const footer = document.createElement('div');
    footer.className = 'report-preview-page-footer';
    page.appendChild(footer);

    return { page, content, footer };
}

function measureReportPreviewBlock(block) {
    if (!block) return 0;

    const pageBundle = createReportPreviewMeasurePage();
    const clone = block.cloneNode(true);
    pageBundle.content.appendChild(clone);

    const height = Math.ceil(Math.max(
        clone.getBoundingClientRect().height,
        clone.offsetHeight,
        clone.scrollHeight
    ));

    removeReportPreviewMeasurePage(pageBundle);
    return height;
}

function getReportPreviewContentCapacityPx() {
    const pageBundle = createReportPreviewMeasurePage();
    const footerHeight = Math.ceil(pageBundle.footer.getBoundingClientRect().height);
    const contentHeight = Math.floor(pageBundle.content.clientHeight);
    removeReportPreviewMeasurePage(pageBundle);

    if (contentHeight > 0) {
        return Math.max(0, contentHeight - 2);
    }

    const usableMm = REPORT_PREVIEW_PAGE_HEIGHT_MM
        - REPORT_PREVIEW_PAGE_PADDING_TOP_MM
        - REPORT_PREVIEW_PAGE_PADDING_BOTTOM_MM
        - REPORT_PREVIEW_PAGE_FOOTER_RESERVE_MM;
    return reportPreviewMmToPx(usableMm);
}

function updateReportPreviewPageFooters() {
    const pages = document.querySelectorAll('#reportPreviewPages .report-preview-page');
    const total = pages.length;
    const label = reportPreviewCurrentSnapshot ? getReportFooterLabel(reportPreviewCurrentSnapshot) : '';
    pages.forEach((page, index) => {
        const footer = page.querySelector('.report-preview-page-footer');
        if (footer) {
            footer.innerHTML = `<span>${escapeReportPreviewHtml(label)}</span><span>Página ${index + 1} de ${total}</span>`;
        }
    });
}

//Texto do rodapé (esquerda) de cada folha
function getReportFooterLabel(snapshot) {
    return ['ROUTE MAP', snapshot.company, snapshot.title].filter(Boolean).join(' · ');
}

function buildReportPreviewTableChunk({
    blockClassName,
    titleElement,
    showTitle,
    showContinuationTitle,
    tableHead,
    rows,
    includeSubtotalRow,
}) {
    const chunk = document.createElement('div');
    chunk.className = blockClassName || 'rp-flow-block rp-avoid-break';

    if (showTitle && titleElement) {
        chunk.appendChild(titleElement.cloneNode(true));
    } else if (showContinuationTitle && titleElement) {
        const continuedTitle = document.createElement('div');
        continuedTitle.className = 'rp-subsection-title rp-subsection-title--continued';
        continuedTitle.textContent = `${titleElement.textContent.trim()} (continuação)`;
        chunk.appendChild(continuedTitle);
    }

    const table = document.createElement('table');
    table.className = 'rp-table';
    if (tableHead) {
        table.appendChild(tableHead.cloneNode(true));
    }

    const tbody = document.createElement('tbody');
    rows.forEach((row) => tbody.appendChild(row.cloneNode(true)));
    if (includeSubtotalRow) {
        tbody.appendChild(includeSubtotalRow.cloneNode(true));
    }
    table.appendChild(tbody);
    chunk.appendChild(table);

    return chunk;
}

function splitOversizedTableBlock(block, capacity) {
    const table = block.querySelector('.rp-table');
    if (!table || !capacity) return [block];

    const blockHeight = measureReportPreviewBlock(block);
    if (blockHeight <= capacity) return [block];

    const tbody = table.querySelector('tbody');
    if (!tbody) return [block];

    const allRows = [...tbody.querySelectorAll('tr')];
    const subtotalRow = allRows.find((row) => row.classList.contains('subtotal')) || null;
    const dataRows = allRows.filter((row) => !row.classList.contains('subtotal') && !row.classList.contains('grand-total'));
    if (!dataRows.length) return [block];

    const titleElement = block.querySelector('.rp-subsection-title');
    const tableHead = table.querySelector('thead');
    const chunks = [];
    let batch = [];

    const flushBatch = (includeSubtotal) => {
        if (!batch.length) return;
        chunks.push(buildReportPreviewTableChunk({
            blockClassName: block.className,
            titleElement,
            showTitle: chunks.length === 0,
            showContinuationTitle: chunks.length > 0,
            tableHead,
            rows: batch,
            includeSubtotalRow: includeSubtotal ? subtotalRow : null,
        }));
        batch = [];
    };

    dataRows.forEach((row, index) => {
        const candidateRows = [...batch, row];
        const isLastRow = index === dataRows.length - 1;
        const candidateChunk = buildReportPreviewTableChunk({
            blockClassName: block.className,
            titleElement,
            showTitle: chunks.length === 0 && batch.length === 0,
            showContinuationTitle: chunks.length > 0,
            tableHead,
            rows: candidateRows,
            includeSubtotalRow: isLastRow ? subtotalRow : null,
        });
        const candidateHeight = measureReportPreviewBlock(candidateChunk);

        if (candidateHeight > capacity && batch.length > 0) {
            flushBatch(false);
            batch = [row];
        } else if (candidateHeight > capacity && batch.length === 0) {
            chunks.push(candidateChunk);
            batch = [];
        } else {
            batch = candidateRows;
        }
    });

    if (batch.length) {
        flushBatch(true);
    }

    return chunks.length ? chunks : [block];
}

function expandReportPreviewBlocksForLayout(blockElements, capacity) {
    const expanded = blockElements.flatMap((block) => splitOversizedTableBlock(block, capacity));
    //Títulos marcados com rp-keep-next ficam na mesma página da primeira tabela que os segue
    const result = [];
    for (let i = 0; i < expanded.length; i++) {
        const block = expanded[i];
        const next = expanded[i + 1];
        if (next && block.classList.contains('rp-keep-next')) {
            const wrapper = document.createElement('div');
            wrapper.className = 'rp-flow-block rp-avoid-break';
            wrapper.appendChild(block.cloneNode(true));
            wrapper.appendChild(next.cloneNode(true));
            wrapper.firstChild.classList.remove('rp-keep-next');
            if (!capacity || measureReportPreviewBlock(wrapper) <= capacity) {
                result.push(wrapper);
                i++;
                continue;
            }
        }
        result.push(block);
    }
    return result;
}

function layoutReportPreviewPages(blockElements) {
    const pagesRoot = getReportPreviewPagesRoot();
    if (!pagesRoot) return;

    pagesRoot.innerHTML = '';
    if (!blockElements.length) return;

    const capacity = getReportPreviewContentCapacityPx();
    const expandedBlocks = expandReportPreviewBlocksForLayout(blockElements, capacity);
    let pageBundle = createReportPreviewPageElement();
    pagesRoot.appendChild(pageBundle.page);
    let usedHeight = 0;

    expandedBlocks.forEach((block) => {
        const blockHeight = measureReportPreviewBlock(block);
        const shouldBreak = usedHeight > 0 && usedHeight + blockHeight > capacity;

        if (shouldBreak) {
            pageBundle = createReportPreviewPageElement();
            pagesRoot.appendChild(pageBundle.page);
            usedHeight = 0;
        }

        pageBundle.content.appendChild(block);
        usedHeight += blockHeight || 0;
    });

    updateReportPreviewPageFooters();
}

function finalizeReportPreviewLayout() {
    relayoutReportPreviewPages();
}

function relayoutReportPreviewPages() {
    const blocks = [...document.querySelectorAll('#reportPreviewPages .rp-flow-block')];
    if (!blocks.length) return;
    layoutReportPreviewPages(blocks);
}

function scheduleReportPreviewRelayout() {
    clearTimeout(reportPreviewResizeTimer);
    reportPreviewResizeTimer = setTimeout(() => {
        const modal = document.getElementById('reportPreviewModal');
        if (!modal || modal.style.display !== 'flex') return;
        reportPreviewMmToPxRatio = null;
        relayoutReportPreviewPages();
    }, 160);
}

function buildReportPreviewFlowBlocks(snapshot) {
    const blocks = [];
    const options = snapshot.options || { bom: true, labor: true, notes: true };

    const renderDetailRows = (rows, sectionKey, { highlightLast = false } = {}) => rows.map((row, index) => `
        <div class="rp-detail-row${highlightLast && index === rows.length - 1 ? ' rp-detail-row--final' : ''}">
            <strong>${escapeReportPreviewHtml(row.label)}</strong>
            <span contenteditable="true" data-rp-section="${sectionKey}" data-rp-row="${index}">${escapeReportPreviewHtml(row.value)}</span>
        </div>
    `).join('');

    const kpiHtml = snapshot.kpis.map((kpi, index) => `
        <div class="rp-kpi-card${index === 0 ? ' rp-kpi-primary' : ''}">
            <span class="rp-kpi-label">${escapeReportPreviewHtml(kpi.label)}</span>
            <span class="rp-kpi-value" contenteditable="true" data-rp-kpi="${index}">${escapeReportPreviewHtml(kpi.value)}</span>
        </div>
    `).join('');

    const bomCategoryBlocks = snapshot.bomCategories.map((category, catIndex) => {
        const rowsHtml = category.rows.map((row, rowIndex) => `
            <tr>
                <td contenteditable="true" data-rp-bom-cat="${catIndex}" data-rp-bom-row="${rowIndex}" data-rp-bom-col="name">${escapeReportPreviewHtml(row.name)}</td>
                <td class="num" contenteditable="true" data-rp-bom-cat="${catIndex}" data-rp-bom-row="${rowIndex}" data-rp-bom-col="qty">${escapeReportPreviewHtml(row.qty ?? row.qtyText)}</td>
                <td class="num" contenteditable="true" data-rp-bom-cat="${catIndex}" data-rp-bom-row="${rowIndex}" data-rp-bom-col="unit">${escapeReportPreviewHtml(row.unit || 'un')}</td>
                <td class="num" contenteditable="true" data-rp-bom-cat="${catIndex}" data-rp-bom-row="${rowIndex}" data-rp-bom-col="unitPrice">${escapeReportPreviewHtml(row.unitPriceText)}</td>
                <td class="num" contenteditable="true" data-rp-bom-cat="${catIndex}" data-rp-bom-row="${rowIndex}" data-rp-bom-col="total">${escapeReportPreviewHtml(row.totalText)}</td>
            </tr>
        `).join('');
        return `
            <div class="rp-subsection-title">${escapeReportPreviewHtml(category.title)}</div>
            <table class="rp-table">
                <thead>
                    <tr>
                        <th>Material</th>
                        <th class="num">Qtd.</th>
                        <th class="num">Un.</th>
                        <th class="num">Valor unit.</th>
                        <th class="num">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                    <tr class="subtotal">
                        <td colspan="4" style="text-align:right;">Subtotal</td>
                        <td class="num" contenteditable="true" data-rp-bom-subtotal="${catIndex}">${escapeReportPreviewHtml(category.subtotalText)}</td>
                    </tr>
                </tbody>
            </table>
        `;
    });

    const regionalHtml = snapshot.regionalLabor ? `
        <div class="rp-subsection-title">${escapeReportPreviewHtml(snapshot.regionalLabor.title)}</div>
        <div class="rp-detail-grid">${renderDetailRows(snapshot.regionalLabor.rows, 'regional')}</div>
    ` : '';

    const outsourcedHtml = snapshot.outsourcedLabor ? `
        <div class="rp-subsection-title" contenteditable="true" data-rp-outsourced-title="1">${escapeReportPreviewHtml(snapshot.outsourcedLabor.title)}</div>
        <table class="rp-table">
            <thead>
                <tr>
                    <th>Serviço</th>
                    <th class="num">Qtd.</th>
                    <th class="num">Un.</th>
                    <th class="num">Valor unit.</th>
                    <th class="num">Total</th>
                </tr>
            </thead>
            <tbody>
                ${snapshot.outsourcedLabor.rows.map((row, rowIndex) => `
                    <tr>
                        <td contenteditable="true" data-rp-outsourced-row="${rowIndex}" data-rp-outsourced-col="name">${escapeReportPreviewHtml(row.name)}</td>
                        <td class="num" contenteditable="true" data-rp-outsourced-row="${rowIndex}" data-rp-outsourced-col="qty">${escapeReportPreviewHtml(row.qty ?? row.qtyText)}</td>
                        <td class="num" contenteditable="true" data-rp-outsourced-row="${rowIndex}" data-rp-outsourced-col="unit">${escapeReportPreviewHtml(row.unit || 'un')}</td>
                        <td class="num" contenteditable="true" data-rp-outsourced-row="${rowIndex}" data-rp-outsourced-col="unitPrice">${escapeReportPreviewHtml(row.unitPriceText)}</td>
                        <td class="num" contenteditable="true" data-rp-outsourced-row="${rowIndex}" data-rp-outsourced-col="total">${escapeReportPreviewHtml(row.totalText)}</td>
                    </tr>
                `).join('')}
                <tr class="subtotal">
                    <td colspan="4" style="text-align:right;">Total terceirizada</td>
                    <td class="num" contenteditable="true" data-rp-outsourced-total="1">${escapeReportPreviewHtml(snapshot.outsourcedLabor.totalText)}</td>
                </tr>
            </tbody>
        </table>
    ` : '';

    //Capa: marca, empresa, projeto e local
    blocks.push(createReportPreviewFlowBlock(`
        <div class="rp-brand">
            <img class="rp-brand__logo" src="img/logo.png" alt="" width="34" height="34" />
            <div class="rp-brand__text">
                <strong>ROUTE MAP</strong>
                <span>${escapeReportPreviewHtml(snapshot.company || 'Redes de fibra óptica')}</span>
            </div>
            <div class="rp-brand__doc">
                <small>Relatório do projeto</small>
                <span contenteditable="true" data-rp-field="generatedAt">${escapeReportPreviewHtml(snapshot.generatedAt)}</span>
            </div>
        </div>
        <div class="rp-title" contenteditable="true" data-rp-field="title">${escapeReportPreviewHtml(snapshot.title)}</div>
        <div class="rp-meta">
            ${snapshot.locationLine ? `<span class="rp-chip" contenteditable="true" data-rp-field="location">${escapeReportPreviewHtml(snapshot.locationLine)}</span>` : ''}
            ${snapshot.author ? `<span class="rp-chip rp-chip--muted">Elaborado por <span contenteditable="true" data-rp-field="author">${escapeReportPreviewHtml(snapshot.author)}</span></span>` : ''}
        </div>
    `));

    blocks.push(createReportPreviewFlowBlock(`
        <div class="rp-section-title">Indicadores</div>
        <div class="rp-kpi-grid">${kpiHtml}</div>
    `, 'rp-avoid-break'));

    blocks.push(createReportPreviewFlowBlock(`
        <div class="rp-section-title">Rede e cobertura</div>
        <div class="rp-detail-grid">${renderDetailRows(snapshot.networkRows, 'network')}</div>
    `, 'rp-avoid-break'));

    if (snapshot.clientRows?.length) {
        blocks.push(createReportPreviewFlowBlock(`
            <div class="rp-section-title">Clientes</div>
            <div class="rp-detail-grid">${renderDetailRows(snapshot.clientRows, 'clients')}</div>
        `, 'rp-avoid-break'));
    }

    blocks.push(createReportPreviewFlowBlock(`
        <div class="rp-section-title">Materiais — resumo de custos</div>
        <div class="rp-detail-grid">${renderDetailRows(snapshot.materialRows, 'material')}</div>
    `, 'rp-avoid-break'));

    if (options.bom && snapshot.bomCategories.length) {
        blocks.push(createReportPreviewFlowBlock(`
            <div class="rp-section-title">Lista de materiais</div>
            <p class="rp-bom-hint">Quantitativos por categoria, com valor unitário e subtotais.</p>
        `, 'rp-avoid-break rp-keep-next'));

        bomCategoryBlocks.forEach((categoryHtml) => {
            blocks.push(createReportPreviewFlowBlock(categoryHtml, 'rp-avoid-break'));
        });

        if (snapshot.bomGrandTotalText) {
            blocks.push(createReportPreviewFlowBlock(`
                <table class="rp-table">
                    <tbody>
                        <tr class="grand-total">
                            <td colspan="4" style="text-align:right;">Total geral da lista de materiais</td>
                            <td class="num" contenteditable="true" data-rp-bom-grand-total="1">${escapeReportPreviewHtml(snapshot.bomGrandTotalText)}</td>
                        </tr>
                    </tbody>
                </table>
            `, 'rp-avoid-break'));
        }
    }

    blocks.push(createReportPreviewFlowBlock(`
        <div class="rp-section-title">Mão de obra</div>
        <div class="rp-detail-grid">${renderDetailRows(snapshot.laborRows, 'labor')}</div>
    `, 'rp-avoid-break'));

    if (options.labor) {
        if (regionalHtml) blocks.push(createReportPreviewFlowBlock(regionalHtml, 'rp-avoid-break'));
        if (outsourcedHtml) blocks.push(createReportPreviewFlowBlock(outsourcedHtml, 'rp-avoid-break'));
    }

    const share = snapshot.costShare;
    const stackHtml = share ? `
        <div class="rp-stack" aria-hidden="true">
            <span class="rp-stack__seg rp-stack__seg--mat" style="width:${Math.max(0, share.mat).toFixed(2)}%"></span>
            <span class="rp-stack__seg rp-stack__seg--lab" style="width:${Math.max(0, share.lab).toFixed(2)}%"></span>
            <span class="rp-stack__seg rp-stack__seg--coef" style="width:${Math.max(0, share.coef).toFixed(2)}%"></span>
        </div>
        <div class="rp-legend">
            <span><i class="rp-dot rp-dot--mat"></i>Materiais ${escapeReportPreviewHtml(share.matText)}</span>
            <span><i class="rp-dot rp-dot--lab"></i>Mão de obra ${escapeReportPreviewHtml(share.labText)}</span>
            <span><i class="rp-dot rp-dot--coef"></i>Coef. de segurança ${escapeReportPreviewHtml(share.coefText)}</span>
        </div>` : '';
    blocks.push(createReportPreviewFlowBlock(`
        <div class="rp-section-title">Resumo financeiro</div>
        ${stackHtml}
        <div class="rp-detail-grid">${renderDetailRows(snapshot.financialRows, 'financial', { highlightLast: true })}</div>
    `, 'rp-avoid-break'));

    if (options.notes) {
        const hasNotes = !!(snapshot.observations && snapshot.observations.trim());
        blocks.push(createReportPreviewFlowBlock(`
            <div class="rp-section-title">Observações</div>
            <div class="rp-observations${hasNotes ? '' : ' rp-observations--blank'}" contenteditable="plaintext-only" data-rp-field="observations" data-placeholder="Espaço para anotações — clique para escrever">${escapeReportPreviewHtml(snapshot.observations || '')}</div>
        `, 'rp-avoid-break'));
    }

    return blocks;
}

function renderReportPreviewHtml(snapshot) {
    const pagesRoot = getReportPreviewPagesRoot();
    if (!pagesRoot || !snapshot) return;

    const blocks = buildReportPreviewFlowBlocks(snapshot);

    layoutReportPreviewPages(blocks);
    requestAnimationFrame(() => {
        requestAnimationFrame(finalizeReportPreviewLayout);
    });
}

function readEditableText(selector) {
    return document.querySelector(selector)?.textContent.trim() || '';
}

function readReportPreviewSnapshotFromDom(baseSnapshot) {
    const snapshot = JSON.parse(JSON.stringify(baseSnapshot));

    snapshot.title = readEditableText('[data-rp-field="title"]') || snapshot.title;
    snapshot.locationLine = readEditableText('[data-rp-field="location"]') || snapshot.locationLine;
    snapshot.generatedAt = readEditableText('[data-rp-field="generatedAt"]') || snapshot.generatedAt;
    snapshot.author = readEditableText('[data-rp-field="author"]') || snapshot.author;
    //Observações: mantém as quebras de linha e aceita ficar vazia
    const notesEl = document.querySelector('[data-rp-field="observations"]');
    if (notesEl) snapshot.observations = (notesEl.innerText || '').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    snapshot.kpis.forEach((kpi, index) => {
        kpi.value = readEditableText(`[data-rp-kpi="${index}"]`) || kpi.value;
    });

    const readSectionRows = (sectionKey, rows) => {
        rows.forEach((row, index) => {
            row.value = readEditableText(`[data-rp-section="${sectionKey}"][data-rp-row="${index}"]`) || row.value;
        });
    };
    readSectionRows('network', snapshot.networkRows);
    if (snapshot.clientRows?.length) readSectionRows('clients', snapshot.clientRows);
    readSectionRows('material', snapshot.materialRows);
    readSectionRows('labor', snapshot.laborRows);
    readSectionRows('financial', snapshot.financialRows);
    if (snapshot.regionalLabor) {
        readSectionRows('regional', snapshot.regionalLabor.rows);
    }

    snapshot.bomCategories.forEach((category, catIndex) => {
        category.rows.forEach((row, rowIndex) => {
            const cell = (col) => document.querySelector(`[data-rp-bom-cat="${catIndex}"][data-rp-bom-row="${rowIndex}"][data-rp-bom-col="${col}"]`)?.textContent.trim();
            row.name = cell('name') || row.name;
            row.qty = cell('qty') || row.qty || row.qtyText;
            row.unit = cell('unit') || row.unit || 'un';
            row.unitPriceText = cell('unitPrice') || row.unitPriceText;
            row.totalText = cell('total') || row.totalText;
            delete row.qtyText;
        });
        category.subtotalText = readEditableText(`[data-rp-bom-subtotal="${catIndex}"]`) || category.subtotalText;
    });
    if (snapshot.bomGrandTotalText) {
        snapshot.bomGrandTotalText = readEditableText('[data-rp-bom-grand-total="1"]') || snapshot.bomGrandTotalText;
    }

    if (snapshot.outsourcedLabor) {
        snapshot.outsourcedLabor.title = readEditableText('[data-rp-outsourced-title="1"]') || snapshot.outsourcedLabor.title;
        snapshot.outsourcedLabor.rows.forEach((row, rowIndex) => {
            const cell = (col) => document.querySelector(`[data-rp-outsourced-row="${rowIndex}"][data-rp-outsourced-col="${col}"]`)?.textContent.trim();
            row.name = cell('name') || row.name;
            row.qty = cell('qty') || row.qty || row.qtyText;
            row.unit = cell('unit') || row.unit || 'un';
            row.unitPriceText = cell('unitPrice') || row.unitPriceText;
            row.totalText = cell('total') || row.totalText;
            delete row.qtyText;
        });
        snapshot.outsourcedLabor.totalText = readEditableText('[data-rp-outsourced-total="1"]') || snapshot.outsourcedLabor.totalText;
    }

    return snapshot;
}

let reportPreviewCurrentSnapshot = null;

function openReportPreviewModal() {
    const projectId = document.getElementById('report-project-details')?.dataset.currentProjectId;
    if (!projectId) {
        showAlert('Atenção', 'Selecione um projeto no relatório antes de exportar.');
        return;
    }

    const data = computeProjectReportData(projectId);
    if (!data) {
        showAlert('Erro', 'Não foi possível gerar os dados do relatório.');
        return;
    }

    reportPreviewOriginalSnapshot = createReportPreviewSnapshot(data);
    reportPreviewCurrentSnapshot = JSON.parse(JSON.stringify(reportPreviewOriginalSnapshot));
    syncReportOptionCheckboxes();
    document.getElementById('reportPreviewModal').style.display = 'flex';
    renderReportPreviewHtml(reportPreviewCurrentSnapshot);
}

function closeReportPreviewModal() {
    document.getElementById('reportPreviewModal').style.display = 'none';
}

function resetReportPreview() {
    if (!reportPreviewOriginalSnapshot) return;
    reportPreviewCurrentSnapshot = JSON.parse(JSON.stringify(reportPreviewOriginalSnapshot));
    syncReportOptionCheckboxes();
    renderReportPreviewHtml(reportPreviewCurrentSnapshot);
}

function syncReportOptionCheckboxes() {
    const options = reportPreviewCurrentSnapshot?.options || { bom: true, labor: true, notes: true };
    document.getElementById('rpOptBom').checked = !!options.bom;
    document.getElementById('rpOptLabor').checked = !!options.labor;
    document.getElementById('rpOptNotes').checked = !!options.notes;
}

//Liga/desliga seções do documento mantendo o que já foi editado
function handleReportOptionChange() {
    if (!reportPreviewCurrentSnapshot) return;
    const edited = readReportPreviewSnapshotFromDom(reportPreviewCurrentSnapshot);
    edited.options = {
        bom: document.getElementById('rpOptBom').checked,
        labor: document.getElementById('rpOptLabor').checked,
        notes: document.getElementById('rpOptNotes').checked,
    };
    reportPreviewCurrentSnapshot = edited;
    renderReportPreviewHtml(edited);
}

function setupReportOptions() {
    ['rpOptBom', 'rpOptLabor', 'rpOptNotes'].forEach((id) => {
        document.getElementById(id)?.addEventListener('change', handleReportOptionChange);
    });
    //Caixa de observações vazia mostra linhas para anotar; some ao digitar
    document.getElementById('reportPreviewPages')?.addEventListener('input', (event) => {
        const notes = event.target.closest?.('[data-rp-field="observations"]');
        if (notes) notes.classList.toggle('rp-observations--blank', !notes.innerText.trim());
    });
}

//Altura útil (em px) de uma página A4 no PDF, descontando as margens de exportação.
const REPORT_EXPORT_PAGE_MARGIN_TOP_MM = 14;
const REPORT_EXPORT_PAGE_MARGIN_BOTTOM_MM = 17;

function getReportExportContentCapacityPx() {
    const usableMm = REPORT_PREVIEW_PAGE_HEIGHT_MM
        - REPORT_EXPORT_PAGE_MARGIN_TOP_MM
        - REPORT_EXPORT_PAGE_MARGIN_BOTTOM_MM;
    //Pequena folga para evitar estouro por arredondamento de renderização.
    return Math.max(0, reportPreviewMmToPx(usableMm) - 8);
}

function buildReportPreviewExportFlow(snapshot, { forPdf = false } = {}) {
    const flow = document.createElement('div');
    flow.className = 'report-preview-page report-preview-export-flow';

    let blocks = buildReportPreviewFlowBlocks(snapshot);

    //Para o PDF, quebramos tabelas maiores que uma página em pedaços que caibam,
    //mantendo o título (ou "continuação") junto das linhas em cada pedaço.
    //Cada pedaço conserva a classe rp-avoid-break, então o html2pdf não separa
    //o título da sua tabela.
    if (forPdf) {
        const capacity = getReportExportContentCapacityPx();
        blocks = expandReportPreviewBlocksForLayout(blocks, capacity);
    }

    blocks.forEach((block) => {
        block.querySelectorAll('[contenteditable="true"]').forEach((el) => {
            el.removeAttribute('contenteditable');
        });
        flow.appendChild(block);
    });

    return flow;
}

//Cabeçalho (páginas 2+), rodapé com número de página e propriedades do arquivo
function decorateReportPdf(pdf, snapshot) {
    const total = pdf.internal.getNumberOfPages();
    const width = pdf.internal.pageSize.getWidth();
    const height = pdf.internal.pageSize.getHeight();
    const marginX = 16;
    const footerLabel = getReportFooterLabel(snapshot);
    for (let page = 1; page <= total; page++) {
        pdf.setPage(page);
        pdf.setLineWidth(0.2);
        pdf.setDrawColor(219, 229, 235);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(91, 116, 131);
        pdf.line(marginX, height - 12.5, width - marginX, height - 12.5);
        pdf.text(pdfText(footerLabel), marginX, height - 8.5);
        pdf.text(`Página ${page} de ${total}`, width - marginX, height - 8.5, { align: 'right' });
        if (page > 1) {
            pdf.text('ROUTE MAP · Relatório do projeto', marginX, 8);
            pdf.text(pdfText(snapshot.title || ''), width - marginX, 8, { align: 'right' });
            pdf.line(marginX, 10.2, width - marginX, 10.2);
        }
    }
    pdf.setProperties({
        title: `Relatório do projeto - ${snapshot.title || ''}`,
        subject: snapshot.locationLine || 'Relatório de projeto de rede',
        author: snapshot.author || 'ROUTE MAP',
        creator: 'ROUTE MAP',
    });
}

//O PDF é desenhado direto com jsPDF (texto de verdade): js/report-pdf.js

const REPORT_PREVIEW_WORD_STYLES = `
body { font-family: Segoe UI, Arial, sans-serif; font-size: 11pt; color: #16323f; line-height: 1.45; }
.rp-brand { margin: 0 0 10pt; }
.rp-brand__text strong { font-size: 13pt; color: #173f4e; }
.rp-brand__text span, .rp-brand__doc { font-size: 9pt; color: #5b7483; }
.rp-brand__doc small { display: block; font-size: 8pt; text-transform: uppercase; }
.rp-title { font-size: 20pt; font-weight: bold; color: #173f4e; margin: 6pt 0 4pt; }
.rp-chip { font-size: 9pt; color: #24586c; }
.rp-meta { margin: 0 0 8pt; }
.rp-subtitle { font-size: 10pt; color: #5b7483; margin: 0 0 2pt; }
.rp-section-title { font-size: 11pt; font-weight: bold; color: #173f4e; text-transform: uppercase; letter-spacing: 0.06em; margin: 14pt 0 8pt; border-bottom: 2px solid #2f7a94; padding-bottom: 4pt; }
.rp-subsection-title { font-size: 10pt; font-weight: bold; color: #24586c; margin: 8pt 0 4pt; }
.rp-bom-hint { font-size: 9pt; color: #5b7483; margin: 0 0 8pt; }
.rp-legend { font-size: 9pt; color: #5b7483; margin: 0 0 6pt; }
.rp-legend span { margin-right: 12pt; }
.rp-kpi-label { display: block; font-size: 8pt; color: #5b7483; font-weight: bold; text-transform: uppercase; margin-bottom: 4pt; }
.rp-kpi-value { display: block; font-size: 12pt; font-weight: bold; color: #16323f; }
.rp-kpi-primary .rp-kpi-value { color: #1f9d4a; }
.rp-observations { min-height: 48pt; padding: 8pt; border: 1px dashed #b8ccd6; border-radius: 6pt; font-size: 9pt; white-space: pre-wrap; background: #f5f8fa; }
.rp-table { width: 100%; border-collapse: collapse; margin-bottom: 10pt; font-size: 9pt; }
.rp-table th, .rp-table td { border: 1px solid #dbe5eb; padding: 4pt 5pt; }
.rp-table th { background: #173f4e; font-weight: bold; color: #ffffff; text-align: left; }
.rp-table td.num, .rp-table th.num { text-align: right; }
.rp-table tr.subtotal td { background: #e3f1f6; font-weight: bold; }
.rp-table tr.grand-total td { background: #173f4e; color: #ffffff; font-weight: bold; }
.rp-export-table { width: 100%; border-collapse: collapse; margin-bottom: 8pt; font-size: 10pt; }
.rp-export-table td { border: 1px solid #dbe5eb; padding: 6pt 8pt; vertical-align: top; }
.rp-export-detail td:last-child { text-align: right; color: #173f4e; font-weight: bold; }
`;

function convertReportPreviewGridsForWord(clone) {
    //Logo por caminho relativo e barras de proporção não entram no Word
    clone.querySelectorAll('.rp-brand__logo, .rp-stack').forEach((el) => el.remove());

    clone.querySelectorAll('.rp-kpi-grid').forEach((grid) => {
        const cards = [...grid.querySelectorAll('.rp-kpi-card')];
        if (!cards.length) return;
        const table = document.createElement('table');
        table.className = 'rp-export-table';
        const row = document.createElement('tr');
        cards.forEach((card) => {
            const cell = document.createElement('td');
            cell.innerHTML = card.innerHTML;
            row.appendChild(cell);
        });
        table.appendChild(row);
        grid.replaceWith(table);
    });

    clone.querySelectorAll('.rp-detail-grid').forEach((grid) => {
        const detailRows = [...grid.querySelectorAll('.rp-detail-row')];
        if (!detailRows.length) return;
        const table = document.createElement('table');
        table.className = 'rp-export-table rp-export-detail';
        detailRows.forEach((detailRow) => {
            const tr = document.createElement('tr');
            const labelCell = document.createElement('td');
            const valueCell = document.createElement('td');
            labelCell.innerHTML = detailRow.querySelector('strong')?.innerHTML || '';
            valueCell.innerHTML = detailRow.querySelector('span')?.innerHTML || '';
            tr.appendChild(labelCell);
            tr.appendChild(valueCell);
            table.appendChild(tr);
        });
        grid.replaceWith(table);
    });
}

function buildReportPreviewWordHtml(clone) {
    return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="utf-8">
<title>Relatório</title>
<style>${REPORT_PREVIEW_WORD_STYLES}</style>
</head>
<body>${clone.outerHTML}</body>
</html>`;
}

function downloadReportBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function getReportExportContext() {
    if (!reportPreviewCurrentSnapshot) return null;
    const pagesRoot = getReportPreviewPagesRoot();
    if (!pagesRoot || !pagesRoot.querySelector('.report-preview-page')) return null;
    const snapshot = readReportPreviewSnapshotFromDom(reportPreviewCurrentSnapshot);
    const slug = String(snapshot.projectCode || 'projeto')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'projeto';
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return { pagesRoot, snapshot, baseName: `Relatorio_${slug}_${stamp}` };
}

function setReportPreviewExportButtonsBusy(isBusy, activeButton, busyLabel) {
    ['confirmReportPdfExportButton', 'confirmReportWordExportButton'].forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (!btn.dataset.defaultLabel) {
            btn.dataset.defaultLabel = btn.textContent;
        }
        btn.disabled = isBusy;
        if (isBusy && btn === activeButton) {
            btn.textContent = busyLabel;
        } else if (!isBusy) {
            btn.textContent = btn.dataset.defaultLabel;
        }
    });
}

async function confirmReportPdfExport() {
    const context = getReportExportContext();
    if (!context) return;
    if (!window.jspdf?.jsPDF) {
        showAlert('Erro', 'Biblioteca de PDF não carregada. Recarregue a página e tente novamente.');
        return;
    }

    const exportBtn = document.getElementById('confirmReportPdfExportButton');
    const filename = `${context.baseName}.pdf`;
    setReportPreviewExportButtonsBusy(true, exportBtn, 'Gerando PDF...');
    showToast('Gerando PDF', 'Montando as páginas do relatório…', 'progress');

    try {
        const pages = await exportReportPdfNative(context.snapshot, filename);
        closeReportPreviewModal();
        showToast('PDF gerado', `${filename} · ${pages} ${pages === 1 ? 'página' : 'páginas'}`);
    } catch (err) {
        console.error('Erro ao exportar relatório PDF:', err);
        const detail = err?.message ? `\n\nDetalhe: ${err.message}` : '';
        showAlert('Erro', `Não foi possível gerar o PDF.${detail}`);
    } finally {
        setReportPreviewExportButtonsBusy(false);
    }
}

function confirmReportWordExport() {
    const context = getReportExportContext();
    if (!context) return;

    const exportBtn = document.getElementById('confirmReportWordExportButton');
    setReportPreviewExportButtonsBusy(true, exportBtn, 'Gerando Word...');

    try {
        const clone = buildReportPreviewExportFlow(context.snapshot);
        convertReportPreviewGridsForWord(clone);
        const html = buildReportPreviewWordHtml(clone);
        const filename = `${context.baseName}.docx`;

        if (typeof htmlDocx !== 'undefined' && typeof htmlDocx.asBlob === 'function') {
            const blob = htmlDocx.asBlob(html);
            downloadReportBlob(blob, filename);
        } else {
            const fallbackBlob = new Blob(['\ufeff', html], { type: 'application/msword' });
            downloadReportBlob(fallbackBlob, `${context.baseName}.doc`);
            showAlert('Aviso', 'O arquivo foi gerado como .doc (Word). Se preferir .docx, recarregue a página e tente novamente.');
        }
        closeReportPreviewModal();
    } catch (err) {
        console.error('Erro ao exportar relatório Word:', err);
        showAlert('Erro', 'Não foi possível gerar o Word. Verifique o console (F12) para mais detalhes.');
    } finally {
        setReportPreviewExportButtonsBusy(false);
    }
}

function showProjectReportDetails(projectId, projectName) {
    document.getElementById('report-project-details').dataset.currentProjectId = projectId;

    const data = computeProjectReportData(projectId);
    if (!data) {
        showAlert('Erro', 'Não foi possível gerar o relatório deste projeto.');
        return;
    }

    const root = document.getElementById('report-project-details');
    const money = formatPdfCurrency;
    const setById = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const setRv = (key, text) => root.querySelectorAll(`[data-rv="${key}"]`).forEach((el) => { el.textContent = text; });
    const q = data.quantities;

    document.getElementById('reportModalTitle').textContent = 'Relatório do projeto';
    setById('report-title', projectName);
    const subtitleParts = [data.city, data.neighborhood].filter(Boolean);
    setById('report-subtitle', subtitleParts.join(' · ') || 'Sem informações de localização');
    setById('report-type', data.projectType || 'TCR');

    setById('report-kpi-final-cost', money(data.finalCost));
    setById('report-kpi-new-ports', String(data.novasPortas));
    setById('report-kpi-cable', `${q.cableLength} m`);
    setById('report-kpi-duration', `${data.prazoEstimado} dias`);

    setRv('neighborhood', data.neighborhood || 'N/A');
    setRv('houses', String(data.totalCasas));
    setRv('existingPorts', String(data.portasExistentes));
    setRv('newPorts', String(data.novasPortas));
    setRv('totalPorts', String(data.totalPortas));
    setRv('penetration', `${data.penetrationRate.toFixed(2).replace('.', ',')}%`);
    document.getElementById('rv-penetration-bar').style.width = `${Math.min(100, data.penetrationRate)}%`;

    setRv('cableLength', `${q.cableLength} m`);
    setRv('posts', String(data.postCount || 0));
    setRv('ctos', String(q.ctoCount || 0));
    setRv('ceos', String(q.ceoCount || 0));
    setRv('reservas', String(q.reservaCount || 0));
    setRv('cordoalhas', String(q.cordoalhaCount || 0));

    //Materiais: barra proporcional ao peso de cada categoria
    const mc = data.materialCosts;
    const categories = [
        { label: 'Ferragens', value: mc.ferragemTotal, color: '#b45309' },
        { label: 'Cabos', value: mc.cabosTotal, color: '#2563eb' },
        { label: 'Fusão', value: mc.fusaoTotal, color: '#7c3aed' },
        { label: 'Data Center', value: mc.datacenterTotal, color: '#0f766e' },
    ];
    const materialsTotal = categories.reduce((sum, c) => sum + c.value, 0) || 1;
    document.getElementById('rv-material-bars').innerHTML = categories.map((c) => `
        <li style="--bar:${c.color}">
            <div class="rv-bars__head"><span>${c.label}</span><strong>${money(c.value)}</strong></div>
            <div class="rv-bars__track"><span style="width:${((c.value / materialsTotal) * 100).toFixed(1)}%"></span></div>
        </li>`).join('');
    setRv('materialCost', money(data.materialCost));

    setRv('regionalLabor', money(data.laborCosts.regionalCost));
    setRv('outsourcedLabor', money(data.laborCosts.outsourcedCost));
    setRv('laborCost', money(data.laborCost));
    const laborDetail = document.getElementById('rv-labor-detail');
    if (data.regionalLaborDetails) {
        const rd = data.regionalLaborDetails;
        setRv('laborDetail', `${rd.techs} técnico(s) · ${rd.days} dia(s)`);
        laborDetail.hidden = false;
    } else {
        laborDetail.hidden = true;
    }

    const clientsCard = document.getElementById('rv-clients-card');
    clientsCard.hidden = !data.clients.total;
    setRv('clientsTotal', String(data.clients.total));
    setRv('clientsB2b', String(data.clients.b2b));
    setRv('clientsPredial', String(data.clients.predial ?? 0));
    setRv('clientsViab', String(data.clients.viabilidade));
    setRv('clientsInstall', String(data.clients.aInstalar));
    setRv('clientsDone', String(data.clients.instalado));

    //Composição do custo final
    const base = (data.materialCost + data.laborCost + data.safetyCoef) || 1;
    document.getElementById('rv-stack-mat').style.width = `${(data.materialCost / base) * 100}%`;
    document.getElementById('rv-stack-lab').style.width = `${(data.laborCost / base) * 100}%`;
    document.getElementById('rv-stack-coef').style.width = `${(data.safetyCoef / base) * 100}%`;
    setRv('safetyCoef', money(data.safetyCoef));
    setRv('totalCost', money(data.totalCost));
    setRv('costPerPort', money(data.costPerPort));
    setRv('duration', `${data.prazoEstimado} dias`);
    setRv('finalCost', money(data.finalCost));

    renderReportObservations(data.observations);

    document.getElementById("report-project-list").classList.add("hidden");
    document.getElementById("report-project-details").classList.remove("hidden");
    document.querySelector('#reportModal .report-modal').classList.add('is-details');
    root.querySelector('.report-details-body').scrollTop = 0;
}
