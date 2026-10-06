// Lista de materiais do projeto (BOM): cálculo a partir dos marcadores, cabos, fusões e clientes,
// edição manual, tabelas por seção, totais, exportação para Excel e ferragens dos cabos.
// Depende de script.js (markers, savedCables, projectBoms, bomState, MATERIAL_PRICES, catálogo) e js/clients.js.

const BOM_GROUP_SEPARATOR = '|||';

const BOM_GROUP_LABELS = {
    'CTO': 'CTO — Terminação Óptica',
    'CTO Predial': 'CTO Predial',
    'CEO': 'CEO — Caixa de Emenda',
    'Reserva': 'Reserva Técnica',
    'Cordoalha': 'Cordoalha',
    'Instalação Raquete': 'Instalação em Raquete',
    'Fusão CEO': 'Fusão — CEO',
    'Fusão CTO': 'Fusão — CTO',
    'Fusão Geral': 'Fusão — Geral',
    'Data Center': 'Data Center',
    'Adicionado manualmente': 'Adicionado Manualmente',
    'Outros': 'Outros'
};

const BOM_GROUP_ORDER = {
    Ferragem: ['CTO', 'CTO Predial', 'CEO', 'Reserva', 'Cordoalha', 'Instalação Raquete'],
    Fusão: ['Fusão CEO', 'Fusão CTO', 'Fusão Geral'],
    'Data Center': ['Data Center', 'Adicionado manualmente']
};

function makeBomKey(materialName, group) {
    return resolveMaterialName(materialName);
}

function resolveBomKey(key) {
    if (key && bomState[key]) return key;
    const parsed = parseBomKey(key || '');
    const byName = makeBomKey(parsed.materialName);
    if (bomState[byName]) return byName;
    return key;
}

function parseBomKey(bomKey) {
    const sepIndex = bomKey.indexOf(BOM_GROUP_SEPARATOR);
    if (sepIndex === -1) return { materialName: bomKey, group: null };
    return {
        materialName: bomKey.slice(0, sepIndex),
        group: bomKey.slice(sepIndex + BOM_GROUP_SEPARATOR.length)
    };
}

function getMaterialDisplayName(bomKey, material) {
    if (material?.materialName) return material.materialName;
    return parseBomKey(bomKey).materialName;
}

function getBomGroup(bomKey, material) {
    if (material?.bomGroup) return material.bomGroup;
    const parsed = parseBomKey(bomKey);
    if (parsed.group) return parsed.group;
    return inferBomGroup(getMaterialDisplayName(bomKey, material), material?.category);
}

function inferBomGroup(materialName, category) {
    if (category === 'Lançamento' || materialName.startsWith('Cabo ') || materialName.startsWith('CFOA ') || materialName.includes('CABO ÓPTICO')) {
        return materialName;
    }
    const ceoNames = [resolveMaterialName('CAIXA DE EMENDA ÓPTICA (CEO)'), resolveMaterialName('CAIXA DE EMENDA OPTICA (CEO) 144 FUSÕES')];
    if (ceoNames.includes(materialName) || materialName.includes('(CEO)') || materialName.includes('CEO') && category === 'Fusão') return 'CEO';
    if (materialName === resolveMaterialName('CAIXA DE ATENDIMENTO') || materialName === resolveMaterialName('CAIXA DE ATENDIMENTO PREDIAL')) return 'CTO';
    if (category === 'Data Center') return 'Data Center';
    if (category === 'Fusão') return 'Fusão Geral';
    return 'Outros';
}

function formatBomGroupLabel(group) {
    if (group.startsWith('Ferragens: ')) {
        return `Ferragens de Cabo — ${group.slice('Ferragens: '.length)}`;
    }
    return BOM_GROUP_LABELS[group] || group;
}

function sortBomGroups(groupA, groupB, category) {
    const fixedOrder = BOM_GROUP_ORDER[category] || [];
    const idxA = fixedOrder.indexOf(groupA);
    const idxB = fixedOrder.indexOf(groupB);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    if (groupA.startsWith('Ferragens: ') && groupB.startsWith('Ferragens: ')) {
        return groupA.localeCompare(groupB, 'pt-BR');
    }
    if (groupA.startsWith('Ferragens: ')) return 1;
    if (groupB.startsWith('Ferragens: ')) return -1;
    if (groupA === 'Outros') return 1;
    if (groupB === 'Outros') return -1;
    return groupA.localeCompare(groupB, 'pt-BR');
}

function mergeBomItems(target, source) {
    const targetQty = target.quantity || 0;
    const sourceQty = source.quantity || 0;
    const totalQty = targetQty + sourceQty;
    if (totalQty > 0) {
        const targetValue = targetQty * (target.unitPrice || 0);
        const sourceValue = sourceQty * (source.unitPrice || 0);
        target.unitPrice = (targetValue + sourceValue) / totalQty;
    }
    target.quantity = totalQty;
    target.removed = target.removed && source.removed;
    if (!target.type && source.type) target.type = source.type;
    if (!target.category && source.category) target.category = source.category;
    mergeBomUsage(target, source);
}

function makeUsageKey(group, detail) {
    return detail ? `${group}|||${detail}` : group;
}

function addUsageEntry(item, group, quantity, detail = null) {
    if (!item || !quantity) return;
    if (!item.usage) item.usage = {};
    const key = makeUsageKey(group, detail);
    const label = detail
        ? `${formatBomGroupLabel(group)} — ${detail}`
        : formatBomGroupLabel(group);
    if (!item.usage[key]) {
        item.usage[key] = { group, detail, label, quantity: 0 };
    }
    item.usage[key].quantity += quantity;
}

function mergeBomUsage(target, source) {
    if (!source?.usage) return;
    if (!target.usage) target.usage = {};
    for (const key in source.usage) {
        const entry = source.usage[key];
        if (!target.usage[key]) {
            target.usage[key] = { ...entry };
        } else {
            target.usage[key].quantity += entry.quantity || 0;
        }
    }
}

function getMaterialUsageList(material) {
    if (!material?.usage) return [];
    return Object.values(material.usage)
        .filter((entry) => entry.quantity > 0)
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

function formatMaterialQuantity(quantity, type) {
    const unit = type === 'length' ? 'm' : (type || 'un');
    const formatted = Number.isInteger(quantity)
        ? String(quantity)
        : parseFloat(quantity).toFixed(2);
    return `${formatted} ${unit}`;
}

function syncBomUsageFromCalculation() {
    if (!activeFolderId) return;
    const savedBom = JSON.parse(JSON.stringify(bomState));
    calculateBomState();
    const calculatedBom = bomState;
    bomState = savedBom;

    const calcByName = {};
    for (const key in calculatedBom) {
        const item = calculatedBom[key];
        const name = getMaterialDisplayName(key, item);
        calcByName[name] = item;
    }
    for (const key in bomState) {
        const item = bomState[key];
        if (item.removed) continue;
        const name = getMaterialDisplayName(key, item);
        if (calcByName[name]?.usage) {
            item.usage = JSON.parse(JSON.stringify(calcByName[name].usage));
        }
    }
}

function openMaterialUsageModal(bomKey) {
    const material = bomState[bomKey];
    if (!material || material.removed) return;

    if (!material.usage || Object.keys(material.usage).length === 0) {
        syncBomUsageFromCalculation();
    }

    const materialName = getMaterialDisplayName(bomKey, material);
    const usageList = getMaterialUsageList(bomState[bomKey]);
    const modal = document.getElementById('materialUsageModal');
    const titleEl = document.getElementById('materialUsageModalTitle');
    const bodyEl = document.getElementById('materialUsageModalBody');
    const totalEl = document.getElementById('materialUsageModalTotal');

    titleEl.textContent = materialName;
    bodyEl.innerHTML = '';

    if (usageList.length === 0) {
        bodyEl.innerHTML = '<p class="material-usage-empty">Nenhum detalhe de utilização disponível. Clique em <strong>Recalcular</strong> para atualizar a lista a partir do mapa.</p>';
    } else {
        const table = document.createElement('table');
        table.className = 'material-usage-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Local / Origem</th>
                    <th>Quantidade</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');
        usageList.forEach((entry) => {
            const row = document.createElement('tr');
            const labelCell = document.createElement('td');
            const qtyCell = document.createElement('td');
            labelCell.textContent = entry.label;
            qtyCell.className = 'material-usage-qty';
            qtyCell.textContent = formatMaterialQuantity(entry.quantity, material.type);
            row.appendChild(labelCell);
            row.appendChild(qtyCell);
            tbody.appendChild(row);
        });
        bodyEl.appendChild(table);
    }

    totalEl.textContent = `Total: ${formatMaterialQuantity(material.quantity, material.type)}`;
    modal.style.display = 'flex';
}

function normalizeBomState(state) {
    const normalized = {};
    for (const key in state || {}) {
        const item = { ...state[key] };
        const materialName = resolveMaterialName(item.materialName || parseBomKey(key).materialName);
        const consolidatedKey = makeBomKey(materialName);
        item.materialName = materialName;
        if (!item.bomGroup) item.bomGroup = getBomGroup(key, item);
        if (!normalized[consolidatedKey]) {
            normalized[consolidatedKey] = item;
        } else {
            mergeBomItems(normalized[consolidatedKey], item);
        }
    }
    return normalized;
}

function applyPersistedBomEdits(calculated, saved) {
    const normalizedSaved = normalizeBomState(saved);
    for (const key in normalizedSaved) {
        const savedItem = normalizedSaved[key];
        if (savedItem.removed) {
            if (calculated[key]) calculated[key].removed = true;
            continue;
        }
        if (savedItem.bomGroup === 'Adicionado manualmente') {
            calculated[key] = JSON.parse(JSON.stringify(savedItem));
            continue;
        }
        if (!calculated[key]) continue;
        if (savedItem.category === 'Lançamento') {
            if (calculated[key]) {
                if (savedItem.surchargePercent != null) {
                    calculated[key].surchargePercent = savedItem.surchargePercent;
                    if (!savedItem.manualQuantity && calculated[key].baseMeasurement != null) {
                        calculated[key].quantity = roundLengthUpToTen(
                            calculated[key].baseMeasurement * (1 + savedItem.surchargePercent / 100)
                        );
                    }
                }
                if (savedItem.manualQuantity && savedItem.quantity != null) {
                    calculated[key].quantity = roundLengthUpToTen(savedItem.quantity);
                    calculated[key].manualQuantity = true;
                }
                //Preço sempre vem do catálogo; só mantém o salvo se o item não existir no catálogo
                if (savedItem.unitPrice != null && savedItem.unitPrice !== calculated[key].unitPrice
                    && !MATERIAL_PRICES[calculated[key].materialName]) {
                    calculated[key].unitPrice = savedItem.unitPrice;
                }
            }
            continue;
        }
        if (savedItem.quantity !== calculated[key].quantity) {
            calculated[key].quantity = savedItem.quantity;
        }
        //Preço sempre do catálogo (fonte de verdade); preserva o salvo só p/ itens fora do catálogo
        //(um preço zerado salvo não apaga o valor informado no equipamento do cliente)
        if (savedItem.unitPrice !== calculated[key].unitPrice
            && !MATERIAL_PRICES[calculated[key].materialName]
            && (Number(savedItem.unitPrice) > 0 || !(calculated[key].unitPrice > 0))) {
            calculated[key].unitPrice = savedItem.unitPrice;
        }
    }
}

function createMaterialRow(bomKey, material) {
    const materialName = getMaterialDisplayName(bomKey, material);
    let displayName = materialName;
    if (material.category === 'Fusão') {
        displayName = materialName.toUpperCase();
    }
    const unit = material.type === 'length' ? 'm' : (material.type || 'un');
    const formattedQuantity = Number.isInteger(material.quantity)
        ? String(material.quantity)
        : parseFloat(material.quantity).toFixed(2);
    const formattedUnitPrice = `R$ ${material.unitPrice.toFixed(2).replace('.', ',')}`;
    const formattedTotalPrice = `R$ ${(material.quantity * material.unitPrice).toFixed(2).replace('.', ',')}`;
    const row = document.createElement('tr');
    row.dataset.bomKey = bomKey;
    row.dataset.bomGroup = getBomGroup(bomKey, material);
    row.innerHTML = `
      <td class="material-item-name material-item-clickable" data-bom-key="${escapeHtml(bomKey)}" title="Ver onde está sendo utilizado">${escapeHtml(displayName)}</td>
      <td><span class="material-category-badge">${escapeHtml(material.category)}</span></td>
      <td class="material-qty">${formattedQuantity}</td>
      <td class="material-unit">${escapeHtml(unit)}</td>
      <td>
        <div class="material-actions">
          <button type="button" class="edit-qty-btn" data-bom-key="${escapeHtml(bomKey)}" title="Editar quantidade" aria-label="Editar">${uiIcon('edit')}</button>
          <button type="button" class="remove-item-btn" data-bom-key="${escapeHtml(bomKey)}" title="Remover item" aria-label="Remover">${uiIcon('x')}</button>
        </div>
      </td>
      <td class="material-price">${formattedUnitPrice}</td>
      <td class="material-price material-price-total">${formattedTotalPrice}</td>
    `;
    return row;
}

function appendGroupedMaterialRows(tbody, entries, category) {
    entries
        .sort((a, b) => getMaterialDisplayName(a.bomKey, a.material).localeCompare(getMaterialDisplayName(b.bomKey, b.material), 'pt-BR'))
        .forEach((entry) => tbody.appendChild(createMaterialRow(entry.bomKey, entry.material)));
}

function formatMaterialLengthValue(value) {
    return String(roundLengthUpToTen(value));
}

function renderCabosTable(tbody, projectId) {
    tbody.innerHTML = '';
    if (!projectId) return;

    const projectCables = getBillableProjectCables(projectId);
    syncProjectCableMeasurements(projectCables);
    const cableGroups = groupCablesByType(projectCables);

    Object.keys(cableGroups).sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach((cableType) => {
        const bomKey = makeBomKey(cableType);
        if (bomState[bomKey]?.removed) return;

        const cables = cableGroups[cableType];
        const baseSum = getCableTypeBaseLength(cables);
        const surcharge = getCableTypeSurcharge(cableType);
        const billableLength = getCableDisplayQuantity(cableType, cables);
        const unitPrice = getCableUnitPrice(cableType);
        const safeBomKey = escapeHtml(bomKey);
        const safeType = escapeHtml(cableType);
        const row = document.createElement('tr');
        row.className = 'cable-material-row';
        row.dataset.cableType = cableType;
        row.dataset.bomKey = bomKey;
        row.innerHTML = `
      <td class="material-item-name material-item-clickable cable-type-usage-trigger" data-cable-type="${safeType}" title="Ver trechos deste cabo">${escapeHtml(resolveMaterialName(cableType))}</td>
      <td><span class="material-category-badge">Lançamento</span></td>
      <td class="material-qty">${formatMaterialLengthValue(baseSum)}</td>
      <td class="material-surcharge-cell">
        <input type="number" class="cable-surcharge-input" min="0" step="0.1" value="${surcharge}" data-cable-type="${safeType}" aria-label="Acréscimo percentual" />
      </td>
      <td class="material-qty cable-final-qty">${formatMaterialLengthValue(billableLength)}</td>
      <td class="material-unit">m</td>
      <td>
        <div class="material-actions">
          <button type="button" class="edit-qty-btn" data-bom-key="${safeBomKey}" title="Editar item" aria-label="Editar">${uiIcon('edit')}</button>
          <button type="button" class="remove-item-btn" data-bom-key="${safeBomKey}" title="Remover item" aria-label="Remover">${uiIcon('x')}</button>
        </div>
      </td>
      <td class="material-price">R$ ${unitPrice.toFixed(2).replace('.', ',')}</td>
      <td class="material-price material-price-total">R$ ${(billableLength * unitPrice).toFixed(2).replace('.', ',')}</td>
    `;
        tbody.appendChild(row);
    });
}

function handleCableSurchargeChange(input) {
    const cableType = input.dataset.cableType;
    if (!cableType) return;
    const surcharge = Math.max(0, parseFloat(input.value) || 0);
    const projectId = getActiveProjectId();
    const bomKey = makeBomKey(cableType);
    if (bomState[bomKey]) {
        bomState[bomKey].surchargePercent = surcharge;
        delete bomState[bomKey].manualQuantity;
    }
    if (projectId) {
        if (!projectBoms[projectId]) projectBoms[projectId] = {};
        if (!projectBoms[projectId][bomKey]) {
            projectBoms[projectId][bomKey] = { category: 'Lançamento', materialName: resolveMaterialName(cableType) };
        }
        projectBoms[projectId][bomKey].surchargePercent = surcharge;
        delete projectBoms[projectId][bomKey].manualQuantity;
        if (bomState[bomKey]?.unitPrice != null) {
            projectBoms[projectId][bomKey].unitPrice = bomState[bomKey].unitPrice;
        }
    }
    calculateBomState();
    syncBomStateToActiveProject();
    renderBomTable();
}

function openCableTypeUsageModal(cableType) {
    const projectId = getActiveProjectId();
    if (!projectId) return;
    const cables = getBillableProjectCables(projectId).filter((c) => c.type === cableType);
    syncProjectCableMeasurements(cables);
    const baseSum = getCableTypeBaseLength(cables);
    const surcharge = getCableTypeSurcharge(cableType);
    const billableLength = getCableDisplayQuantity(cableType, cables);
    const modal = document.getElementById('materialUsageModal');
    const titleEl = document.getElementById('materialUsageModalTitle');
    const bodyEl = document.getElementById('materialUsageModalBody');
    const totalEl = document.getElementById('materialUsageModalTotal');

    titleEl.textContent = resolveMaterialName(cableType);
    bodyEl.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'material-usage-table';
    table.innerHTML = `
        <thead>
            <tr><th>Trecho</th><th>Medição</th></tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    cables.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR')).forEach((cable) => {
        const measurement = calculateCableMeasurement(cable);
        const row = document.createElement('tr');
        const labelCell = document.createElement('td');
        const qtyCell = document.createElement('td');
        labelCell.textContent = `${cable.name} (${measurement.lancamento} m + ${measurement.reserva} m)`;
        qtyCell.className = 'material-usage-qty';
        qtyCell.textContent = `${measurement.total} m`;
        row.appendChild(labelCell);
        row.appendChild(qtyCell);
        tbody.appendChild(row);
    });
    bodyEl.appendChild(table);

    if (surcharge > 0) {
        const extra = document.createElement('p');
        extra.className = 'material-usage-hint';
        extra.textContent = `Acréscimo de ${surcharge}% aplicado sobre o total de ${formatMaterialLengthValue(baseSum)} m.`;
        bodyEl.appendChild(extra);
    }

    totalEl.textContent = `Total faturado: ${formatMaterialLengthValue(billableLength)} m`;
    modal.style.display = 'flex';
}

//Renderização das tabelas de materiais
function renderBomTable() {
    const ferragemBody = document.getElementById('ferragem-list-body');
    const cabosBody = document.getElementById('cabos-list-body');
    const fusaoBody = document.getElementById('fusao-list-body');
    const datacenterBody = document.getElementById('datacenter-list-body');
    ferragemBody.innerHTML = '';
    cabosBody.innerHTML = '';
    fusaoBody.innerHTML = '';
    datacenterBody.innerHTML = '';

    const buckets = {
        Ferragem: [],
        'Lançamento': [],
        Fusão: [],
        'Data Center': []
    };

    for (const bomKey in bomState) {
        const material = bomState[bomKey];
        const bucketKey = getBomCostSection(material);
        if (!bucketKey) continue;
        buckets[bucketKey].push({ bomKey, material });
    }

    appendGroupedMaterialRows(ferragemBody, buckets.Ferragem, 'Ferragem');
    renderCabosTable(cabosBody, getActiveProjectId());
    appendGroupedMaterialRows(fusaoBody, buckets.Fusão, 'Fusão');
    appendGroupedMaterialRows(datacenterBody, buckets['Data Center'], 'Data Center');

    document.querySelectorAll('.edit-qty-btn').forEach((btn) => {
        btn.addEventListener('click', () => openMaterialEditor(btn.dataset.bomKey));
    });
    document.querySelectorAll('.remove-item-btn').forEach((btn) => btn.addEventListener('click', () => handleRemoveItem(btn)));
    document.querySelectorAll('.material-item-clickable:not(.cable-type-usage-trigger)').forEach((cell) => {
        cell.addEventListener('click', () => openMaterialUsageModal(cell.dataset.bomKey));
    });
    document.querySelectorAll('.cable-type-usage-trigger').forEach((cell) => {
        cell.addEventListener('click', () => openCableTypeUsageModal(cell.dataset.cableType));
    });
    document.querySelectorAll('.cable-surcharge-input').forEach((input) => {
        input.addEventListener('click', (event) => event.stopPropagation());
        input.addEventListener('change', () => handleCableSurchargeChange(input));
    });
    updateMaterialTableEmptyStates();
    recalculateGrandTotal();
}

function updateMaterialTableEmptyStates() {
    const tableConfigs = [
        { bodyId: 'ferragem-list-body', colspan: 7 },
        { bodyId: 'cabos-list-body', colspan: 9 },
        { bodyId: 'fusao-list-body', colspan: 7 },
        { bodyId: 'datacenter-list-body', colspan: 7 }
    ];
    tableConfigs.forEach(({ bodyId, colspan }) => {
        const tbody = document.getElementById(bodyId);
        if (!tbody) return;
        tbody.querySelectorAll('.material-empty-row').forEach((row) => row.remove());
        const dataRows = Array.from(tbody.children).filter((row) =>
            !row.classList.contains('material-empty-row') && !row.classList.contains('material-group-header')
        );
        if (dataRows.length === 0) {
            const tr = document.createElement('tr');
            tr.className = 'material-empty-row';
            tr.innerHTML = `<td colspan="${colspan}">Nenhum item nesta categoria</td>`;
            tbody.appendChild(tr);
        }
    });
}

//Exporta a lista para Excel
function exportTablesToExcel() {
    const projectTitle = document.getElementById('materialModalTitle').textContent.replace('Lista de Materiais: ', '').trim();
    const fileName = `Lista_de_Materiais_${projectTitle.replace(/[^a-z0-9]/gi, '_')}.xlsx`;
    const wb = XLSX.utils.book_new();
    const headers = ["Grupo", "Item", "Tipo", "Quantidade", "Unidade", "Preço Unitário (R$)", "Preço Total (R$)"];
    const tablesToExport = [
        { id: 'ferragem-table', name: 'Ferragens' },
        { id: 'cabos-table', name: 'Cabos' },
        { id: 'fusao-table', name: 'Fusao' },
        { id: 'datacenter-table', name: 'Data Center' }
    ];
    tablesToExport.forEach(tableInfo => {
        const table = document.getElementById(tableInfo.id);
        if (table) {
            let data;
            if (tableInfo.id === 'cabos-table') {
                data = [["Item", "Tipo", "Medição (m)", "Acr.%", "Qtd. (m)", "Un.", "Ações", "Preço Unitário (R$)", "Preço Total (R$)"]];
            } else {
                data = [headers];
            }

            const rows = table.querySelectorAll('tbody tr:not(.material-empty-row):not(.material-group-header)');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (tableInfo.id === 'cabos-table') {
                    const surchargeInput = row.querySelector('.cable-surcharge-input');
                    data.push([
                        cells[0].textContent,
                        cells[1].textContent,
                        cells[2].textContent,
                        surchargeInput ? surchargeInput.value : '',
                        cells[4].textContent,
                        cells[5].textContent,
                        '',
                        cells[7].textContent,
                        cells[8].textContent
                    ]);
                } else {
                    data.push([
                        row.dataset.bomGroup || '',
                        cells[0].textContent,
                        cells[1].textContent,
                        cells[2].textContent,
                        cells[3].textContent,
                        cells[5].textContent,
                        cells[6].textContent
                    ]);
                }
            });

            const footer = table.querySelector('tfoot tr');
            if (footer) {
                const footerCells = footer.querySelectorAll('td');
                const subtotalLabel = footerCells[0].textContent;
                const subtotalValue = footerCells[footerCells.length - 1].textContent;
                if (tableInfo.id === 'cabos-table') {
                    data.push(['', '', '', '', '', '', '', subtotalLabel, subtotalValue]);
                } else {
                    data.push(['', '', '', '', '', subtotalLabel, subtotalValue]);
                }
            }

            //Converte o array de dados para uma planilha
            const ws = XLSX.utils.aoa_to_sheet(data);
            
            //Adiciona a planilha (ws) à pasta de trabalho (wb) com o nome desejado
            XLSX.utils.book_append_sheet(wb, ws, tableInfo.name);
        }
    });

    // Gera o arquivo Excel e inicia o download
    XLSX.writeFile(wb, fileName);
}

//Calculo dos postes através dos cabos
function calculateHardwareForCable(cableLength, alcaPreformadaName) {
    const hardware = {};
    //Calcula total de postes a partir do vão configurável (padrão 35m)
    const totalPostes = Math.ceil(cableLength / getPoleSpanDistance());
    if (totalPostes <= 0) return hardware;
    //Quantidades por poste configuráveis (aba Configurações do cadastro de materiais)
    const qtdPlaqueta = totalPostes * (Number(lancamentoConfig.plaquetaPerPole) || 0);
    const qtdBap = totalPostes * (Number(lancamentoConfig.bapPerPole) || 0);
    const qtdSupa = totalPostes * (Number(lancamentoConfig.supaPerPole) || 0);
    const qtdAlcaPreformada = qtdSupa * (Number(lancamentoConfig.alcaPerSupa) || 0);
    if (qtdPlaqueta > 0) hardware["PLAQUETA DE IDENTIFICAÇÃO"] = qtdPlaqueta;
    if (qtdBap > 0) hardware["ABRAÇADEIRA BAP 3"] = qtdBap;
    if (qtdSupa > 0) hardware["SUPORTE ANCORAGEM PARA CABOS OPTICOS (SUPAS)"] = qtdSupa;
    // Adiciona a Alça Específica do Cabo
    if (alcaPreformadaName && qtdAlcaPreformada > 0) {
        hardware[alcaPreformadaName] = qtdAlcaPreformada;
    }
    return hardware;
}

const CABLE_HARDWARE_MAP = {
    "Cabo AS 80 FO-06": "ALÇA PREFORMADA OPDE 1008 - 6,8mm a 7,4mm",
    "Cabo AS 80 FO-12": "ALÇA PREFORMADA OPDE 1008 - 6,8mm a 7,4mm",
    "Cabo AS 80 FO-24": "ALÇA PREFORMADA OPDE 1020 - 9,0mm a 9,8mm",
    "Cabo AS 80 FO-36": "ALÇA PREFORMADA OPDE 1020 - 9,0mm a 9,8mm",
    "Cabo AS 80 FO-48": "ALÇA PREFORMADA OPDE 1020 - 9,0mm a 9,8mm",
    "Cabo AS 80 FO-72": "ALÇA PREFORMADA OPDE 1021 - 9,6mm a 10,4mm",
    "Cabo AS 80 FO-144": "ALÇA PREFORMADA OPDE 1007 - 12,8MM A 14,2MM",
    "CABO ÓPTICO AS 80 S 144 FIBRAS NR KP": "ALÇA PREFORMADA OPDE 1007 - 12,8MM A 14,2MM",
    "Cabo AS 200 FO-06": "ALÇA PREFORMADA OPDE 1008 - 6,8mm a 7,4mm",
    "Cabo AS 200 FO-12": "ALÇA PREFORMADA OPDE 1020 - 9,0mm a 9,8mm",
    "Cabo AS 200 FO-24": "ALÇA PREFORMADA OPDE 1021 - 9,6mm a 10,4mm",
    "Cabo AS 200 FO-36": "ALÇA PREFORMADA OPDE 1021 - 9,6mm a 10,4mm",
    "Cabo AS 200 FO-48": "ALÇA PREFORMADA OPDE 1021 - 9,6mm a 10,4mm",
    "Cabo AS 200 FO-72": "ALÇA PREFORMADA OPDE 1021 - 9,6mm a 10,4mm",
    "Cabo AS 200 FO-144": "ALÇA PREFORMADA OPDE 1007 - 12,8MM A 14,2MM"
};

function getAggregatedCableLengthsForFerragens(projectId) {
    const aggregated = {};
    if (!projectId) return aggregated;

    const projectCables = getBillableProjectCables(projectId);
    syncProjectCableMeasurements(projectCables);
    Object.entries(groupCablesByType(projectCables)).forEach(([cableType, cables]) => {
        const bomKey = makeBomKey(cableType);
        if (bomState[bomKey]?.removed) return;
        const length = getCableDisplayQuantity(cableType, cables);
        if (length > 0) {
            aggregated[cableType] = (aggregated[cableType] || 0) + length;
        }
    });
    return aggregated;
}

function applyCableFerragensToBom(projectId, addOrUpdateMaterialFn) {
    const aggregatedCableLengths = getAggregatedCableLengthsForFerragens(projectId);
    Object.keys(aggregatedCableLengths).forEach((cableName) => {
        const totalLength = aggregatedCableLengths[cableName];
        const alcaName = getCableAlca(cableName);
        if (totalLength <= 0 || !alcaName) return;
        const hardwareItems = calculateHardwareForCable(totalLength, alcaName);
        const hardwareGroup = `Ferragens: ${resolveMaterialName(cableName)}`;
        for (const itemName in hardwareItems) {
            addOrUpdateMaterialFn(itemName, hardwareItems[itemName], 'unit', hardwareGroup);
        }
    });
}

function refreshBomAfterProjectChange() {
    if (!activeFolderId) return;
    const projectRootElement = document.getElementById(activeFolderId)?.closest('.folder');
    if (!projectRootElement) return;
    const projectId = projectRootElement.querySelector('.folder-title')?.dataset.folderId;
    if (!projectId) return;
    calculateBomState();
    projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
    if (typeof scheduleProjectUndoSnapshot === 'function') scheduleProjectUndoSnapshot(projectId);
    if (typeof liveSyncLocalChange === 'function') liveSyncLocalChange(projectId);
    const materialModal = document.getElementById('materialModal');
    if (materialModal && materialModal.style.display === 'flex') {
        renderBomTable();
    }
}

//Cáculo geral da lista de material
function calculateBomState() {
    //Validação e preservação
    if (!activeFolderId) {
        console.error("calculateBomState foi chamada sem um projeto ativo.");
        bomState = {};
        return;
    }
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) {
        bomState = {};
        return;
    }
    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    //Preserva itens do data center
    const preservedDatacenterItems = {};
    const preservedCableSurcharges = {};
    const currentProjectBom = normalizeBomState(JSON.parse(JSON.stringify(projectBoms[projectId] || {})));
    for (const materialName in currentProjectBom) {
        if (currentProjectBom[materialName].category === 'Data Center') {
            //Guarda só a parte manual/kits; os equipamentos dos clientes são recalculados abaixo
            const item = currentProjectBom[materialName];
            const manualQty = (Number(item.quantity) || 0) - (Number(item.clientQuantity) || 0);
            if (manualQty > 0) preservedDatacenterItems[materialName] = { ...item, quantity: manualQty, clientQuantity: 0 };
        }
        if (currentProjectBom[materialName].category === 'Lançamento' && currentProjectBom[materialName].surchargePercent != null) {
            preservedCableSurcharges[materialName] = currentProjectBom[materialName].surchargePercent;
        }
    }
    bomState = {};
    const folderIdsToInclude = getAllDescendantFolderIds(projectId);
    const projectMarkers = markers.filter(m => folderIdsToInclude.includes(m.folderId));
    const projectCables = savedCables.filter(c => folderIdsToInclude.includes(c.folderId));
    syncProjectCableMeasurements(projectCables);
    //variáveis auxiliares
    let ctoCount = 0;
    let raqueteInstallCount = 0;
    const addOrUpdateMaterial = (name, quantity, type = 'unit', group = 'Outros', detail = null, unitPrice = undefined) => {
        if (!name || quantity <= 0) return;
        name = resolveMaterialName(name);
        if (isDroppedMaterial(name)) return;
        const priceInfo = MATERIAL_PRICES[name] || { price: 0, category: 'Outros' };
        const bomKey = makeBomKey(name, group);
        if (!bomState[bomKey]) {
            bomState[bomKey] = {
                materialName: name,
                bomGroup: group,
                quantity: 0,
                type: priceInfo.unit === 'm' || type === 'length' ? (priceInfo.unit || 'm') : (priceInfo.unit || type),
                unitPrice: priceInfo.price,
                category: priceInfo.category,
                removed: false,
                usage: {}
            };
        }
        //Preço informado fora do catálogo (ex.: equipamento digitado no cliente)
        if (unitPrice > 0 && !(bomState[bomKey].unitPrice > 0)) bomState[bomKey].unitPrice = unitPrice;
        bomState[bomKey].quantity += quantity;
        addUsageEntry(bomState[bomKey], group, quantity, detail);
    };
    //Processamento de marcadores
    projectMarkers.forEach(markerInfo => {
        if (markerInfo.type === 'Importado') return;
        const type = markerInfo.type;
        if (type === 'CLIENTE') return; //Tratado em addClientMaterialsToBom
        if (type === 'CASA' || type === 'POP' || isMarkerStatusExistente(markerInfo)) return;
        if (type === 'CTO') {
            if (markerInfo.isPredial) {
                addOrUpdateMaterial("CAIXA DE ATENDIMENTO PREDIAL", 1, 'unit', 'CTO Predial', markerInfo.name);
                addOrUpdateMaterial("ABRAÇADEIRA DE NYLON", 4, 'unit', 'CTO Predial', markerInfo.name);
            } else {
                ctoCount++;
                const priceInfo = MATERIAL_PRICES['CTO'];
                if (priceInfo && priceInfo.components) {
                    priceInfo.components.forEach(c => addOrUpdateMaterial(c.name, c.quantity, 'unit', 'CTO', markerInfo.name));
                }
            }
            return; 
        }
        //Lógica CEO
        if (type === 'CEO') {
            if (markerInfo.is144F) {
                addOrUpdateMaterial("CAIXA DE EMENDA OPTICA (CEO) 144 FUSÕES", 1, 'unit', 'CEO', markerInfo.name);
            } else {
                addOrUpdateMaterial("CAIXA DE EMENDA ÓPTICA (CEO)", 1, 'unit', 'CEO', markerInfo.name);
            }
            if (markerInfo.ceoAccessory === "Raquete") {
                raqueteInstallCount++;
                getKitComponents("KIT CEO RAQUETE").forEach(c => addOrUpdateMaterial(c.name, c.quantity, 'unit', 'CEO', markerInfo.name));
            } else if (markerInfo.ceoAccessory === "Suporte") {
                getKitComponents("KIT CEO SUPORTE").forEach(c => addOrUpdateMaterial(c.name, c.quantity, 'unit', 'CEO', markerInfo.name));
            }
            return; 
        }
        //Lógica reserva
        if (type === 'RESERVA') {
            if (markerInfo.reservaAccessory === "Raquete") {
                raqueteInstallCount++;
                getKitComponents("KIT CEO RAQUETE").forEach(c => addOrUpdateMaterial(c.name, c.quantity, 'unit', 'Reserva', markerInfo.name));
            } else if (markerInfo.reservaAccessory === "Suporte") {
                getKitComponents("KIT CEO SUPORTE").forEach(c => addOrUpdateMaterial(c.name, c.quantity, 'unit', 'Reserva', markerInfo.name));
            }
            return;
        }
        //Lógica cordoalha
        if (type === 'CORDOALHA') {
            getKitComponents("KIT CORDOALHA").forEach(c => addOrUpdateMaterial(c.name, c.quantity, 'unit', 'Cordoalha', markerInfo.name));
            if (markerInfo.derivationTCount && markerInfo.derivationTCount > 0) {
                addOrUpdateMaterial("DERIVAÇÃO EM T", markerInfo.derivationTCount, 'unit', 'Cordoalha', markerInfo.name);
            }
            return;
        }
        const priceInfo = MATERIAL_PRICES[type];
        if (priceInfo && priceInfo.components) {
        priceInfo.components.forEach(c => addOrUpdateMaterial(c.name, c.quantity, 'unit', type, markerInfo.name));
        } else if (type) {
        addOrUpdateMaterial(type, 1, 'unit', 'Outros', markerInfo.name);
        }
    });
    //Cálculos de ferragens
    if (raqueteInstallCount > 0) {
        const totalArameNeeded = raqueteInstallCount * 50;
        const arameRolls = Math.ceil(totalArameNeeded / 105);
        addOrUpdateMaterial("ARAME DE ESPIMAR (105 m)", arameRolls, 'unit', 'Instalação Raquete', `${raqueteInstallCount} instalação(ões)`);
    }

    if (ctoCount > 0) {
        const fitaName = "FITA DE AÇO INOX 3/4'' (FITA FUSIMEC) ROLO DE 25M";
        addOrUpdateMaterial(fitaName, Math.ceil((3 * ctoCount) / 25), 'unit', 'CTO', `${ctoCount} CTO(s)`);
    }
    //Drops e kits de instalação dos clientes
    addClientMaterialsToBom(projectMarkers, addOrUpdateMaterial);
    //Plano de fusão
    projectMarkers.forEach(markerInfo => {
        if ((markerInfo.type === 'CTO' || markerInfo.type === 'CEO') && markerInfo.fusionPlan) {
            const fusionGroup = `Fusão ${markerInfo.type}`;
            const plan = readFusionPlan(markerInfo);
            if (plan) {
                if (!plan.empty && !plan.fromLegacyCanvas) {
                    plan.splitters.forEach(splitter => {
                        if (splitter.status === 'Novo') {
                            const label = splitter.label;
                            if (label) {
                                const splitterMaterialName = `Splitter ${label.replace(':', '/')}`;
                                addOrUpdateMaterial(splitterMaterialName, 1, 'unit', fusionGroup, markerInfo.name);
                                if (splitter.atendimento) {
                                    const isPredial = markerInfo.isPredial || false;
                                    const connector = label.includes('APC') ? 'APC' : 'UPC';
                                    const ratioMatch = label.match(/1:(\d+)/);
                                    const outputCount = ratioMatch ? parseInt(ratioMatch[1], 10) : 0;

                                    if (outputCount > 0) {
                                        let adapterMaterialName = isPredial
                                            ? `ADAPTADOR SC/${connector} SEM ABAS (PASSANTE)`
                                            : `ADAPTADOR SC/${connector} COM ABAS (PASSANTE)`;
                                        addOrUpdateMaterial(adapterMaterialName, outputCount, 'unit', fusionGroup, markerInfo.name);
                                    }
                                }
                            }
                        }
                    });
                    if (markerInfo.type === 'CEO') {
                        plan.cables.forEach(cable => {
                            if (cable.derivationKit) {
                                addOrUpdateMaterial("KIT DERIVAÇÃO PARA CAIXA DE EMENDA OPTICA", 1, 'unit', fusionGroup, markerInfo.name);
                            }
                        });
                    }
                }
                if (markerInfo.type === 'CEO' && plan.trayQuantity > 0) {
                    addOrUpdateMaterial("KIT DE BANDEJA PARA CAIXA DE EMENDA", plan.trayQuantity, 'unit', fusionGroup, markerInfo.name);
                }
                if (plan.lines.length > 0) {
                    addOrUpdateMaterial("TUBETE PROTETOR DE EMENDA OPTICA", plan.lines.length, 'unit', fusionGroup, markerInfo.name);
                }
            }
        }
    });
    //Processamento de cabos (agrupados por tipo)
    const activeBillableCables = projectCables.filter(
        (cable) => cable.status !== 'Existente' && cable.type !== 'Cabo Importado'
    );
    const cableGroups = groupCablesByType(activeBillableCables);
    Object.keys(cableGroups).sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach((cableType) => {
        const cables = cableGroups[cableType];
        const baseSum = getCableTypeBaseLength(cables);
        const surcharge = Math.max(0, parseFloat(preservedCableSurcharges[resolveMaterialName(cableType)] ?? preservedCableSurcharges[cableType]) || 0);
        const billableLength = getCableTypeBillableLength(cables, surcharge);
        const priceInfo = MATERIAL_PRICES[cableType] || { price: 0, category: 'Lançamento' };
        const bomKey = makeBomKey(cableType);
        const savedCableItem = currentProjectBom[cableType] || currentProjectBom[bomKey];
        const manualQuantity = !!savedCableItem?.manualQuantity;
        bomState[bomKey] = {
            materialName: resolveMaterialName(cableType),
            bomGroup: 'Lançamento',
            quantity: manualQuantity
                ? roundLengthUpToTen(savedCableItem.quantity)
                : billableLength,
            baseMeasurement: baseSum,
            surchargePercent: surcharge,
            manualQuantity,
            type: 'm',
            unitPrice: savedCableItem?.unitPrice ?? priceInfo.price,
            category: 'Lançamento',
            removed: !!savedCableItem?.removed,
            usage: {}
        };
        cables.forEach((cable) => {
            addUsageEntry(bomState[bomKey], 'Lançamento', getCableBaseLength(cable), cable.name || cable.type);
        });
    });
    const tapeName = "FITA ISOLANTE";
    const hasFusionConsumables = Object.entries(bomState).some(([key, item]) => {
        const name = getMaterialDisplayName(key, item);
        return name === resolveMaterialName("TUBETE PROTETOR DE EMENDA OPTICA") || name === resolveMaterialName("KIT DERIVAÇÃO PARA CAIXA DE EMENDA OPTICA");
    });
    if (hasFusionConsumables && !bomState[tapeName]) {
        addOrUpdateMaterial(tapeName, 1, 'unit', 'Fusão Geral');
    }
    //Ferragens dos cabos (baseadas na Qtd. faturada de cada cabo)
    applyCableFerragensToBom(projectId, addOrUpdateMaterial);
    for (const materialName in preservedDatacenterItems) {
        const preserved = preservedDatacenterItems[materialName];
        const preservedKey = makeBomKey(materialName);
        if (bomState[preservedKey]) {
            //Mesmo item nos kits/manual e nos equipamentos dos clientes: soma as quantidades
            bomState[preservedKey].quantity += preserved.quantity || 0;
            addUsageEntry(bomState[preservedKey], 'Data Center', preserved.quantity || 0, 'Data Center');
        } else {
            bomState[preservedKey] = {
                ...preserved,
                materialName,
                bomGroup: preserved.bomGroup || 'Data Center'
            };
            if (!bomState[preservedKey].usage) {
                bomState[preservedKey].usage = {};
            }
            addUsageEntry(
                bomState[preservedKey],
                preserved.bomGroup || 'Data Center',
                preserved.quantity || 0,
                'Data Center'
            );
        }
    }
    bomState = normalizeBomState(bomState);
}

//Remoção lógica de item
function handleRemoveItem(button) {
    const bomKey = resolveBomKey(button.dataset.bomKey);
    const materialName = getMaterialDisplayName(bomKey, bomState[bomKey]);
    showConfirm('Remover Item', `Tem certeza que deseja remover "${materialName}" da lista?`, () => {
        bomState[bomKey].removed = true;
        renderBomTable();
    });
}

//Adição manual de novo material
function handleAddNewMaterial() {
    const name = document.getElementById('materialNameInput').value.trim();
    const quantity = parseFloat(document.getElementById('materialQtyInput').value);
    const category = document.getElementById('materialCategoryInput').value;
    const unitPrice = parseFloat(document.getElementById('materialPriceInput').value);
    if (!name || isNaN(quantity) || isNaN(unitPrice)) {
        showAlert("Erro", "Por favor, preencha todos os campos corretamente.");
        return;
    }
    const bomKey = makeBomKey(name);
    if (bomState[bomKey]) {
        mergeBomItems(bomState[bomKey], {
            quantity,
            unitPrice,
            removed: false
        });
        bomState[bomKey].category = category;
        addUsageEntry(bomState[bomKey], 'Adicionado manualmente', quantity, null);
    } else {
        bomState[bomKey] = {
            materialName: name,
            bomGroup: 'Adicionado manualmente',
            quantity,
            type: 'un',
            unitPrice,
            category,
            removed: false,
            usage: {}
        };
        addUsageEntry(bomState[bomKey], 'Adicionado manualmente', quantity, null);
    }
    renderBomTable();
    document.getElementById('addMaterialModal').style.display = 'none';
}

function syncBomStateToActiveProject() {
    if (!activeFolderId) return;
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) return;
    const projectId = projectRootElement.querySelector('.folder-title')?.dataset.folderId;
    if (!projectId) return;
    projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
}

//Abertura do editor dos materiais
function openMaterialEditor(bomKey) {
    const resolvedKey = resolveBomKey(bomKey);
    const materialData = bomState[resolvedKey];
    if (!materialData) {
        showAlert('Erro', 'Não foi possível encontrar o material para edição.');
        return;
    }
    document.getElementById('originalMaterialName').value = resolvedKey;
    document.getElementById('editMaterialName').value = getMaterialDisplayName(resolvedKey, materialData);
    if (materialData.category === 'Lançamento') {
        const projectId = getActiveProjectId();
        const cableType = getMaterialDisplayName(resolvedKey, materialData);
        const cables = projectId
            ? (groupCablesByType(getBillableProjectCables(projectId))[cableType] || [])
            : [];
        document.getElementById('editMaterialQty').value = getCableDisplayQuantity(cableType, cables);
    } else {
        document.getElementById('editMaterialQty').value = materialData.quantity;
    }
    document.getElementById('editMaterialUnit').value = materialData.type;
    document.getElementById('editMaterialPrice').value = materialData.unitPrice;
    document.getElementById('editMaterialModal').style.display = 'flex';
}

//Processamento da edição e atualização
function handleUpdateMaterial() {
    const originalKey = document.getElementById('originalMaterialName').value;
    const newName = document.getElementById('editMaterialName').value.trim();
    const newQty = parseFloat(document.getElementById('editMaterialQty').value);
    const newUnit = document.getElementById('editMaterialUnit').value.trim();
    const newPrice = parseFloat(document.getElementById('editMaterialPrice').value);
    if (!newName) {
        showAlert('Erro', 'O nome do material não pode ser vazio.');
        return;
    }
    if (isNaN(newQty) || newQty < 0 || isNaN(newPrice) || newPrice < 0) {
        showAlert('Erro', 'Quantidade e Preço devem ser números válidos e não-negativos.');
        return;
    }
    const resolvedOriginalKey = resolveBomKey(originalKey);
    const originalMaterial = bomState[resolvedOriginalKey];
    if (!originalMaterial) {
        showAlert('Erro', 'Material original não encontrado.');
        return;
    }
    const originalCategory = originalMaterial.category || 'Outros';
    const bomGroup = originalMaterial.bomGroup || getBomGroup(resolvedOriginalKey, originalMaterial);
    const newKey = makeBomKey(newName, bomGroup);
    if (newKey !== resolvedOriginalKey && bomState[newKey]) {
        showAlert('Erro', 'Já existe um material com este nome. Por favor, escolha outro nome.');
        return;
    }
    if (newKey !== resolvedOriginalKey) {
        delete bomState[resolvedOriginalKey];
    }
    const isCableItem = originalCategory === 'Lançamento';
    bomState[newKey] = {
        ...originalMaterial,
        materialName: newName,
        bomGroup,
        unitPrice: newPrice,
        category: originalCategory,
        removed: false,
        quantity: isCableItem ? roundLengthUpToTen(newQty) : newQty,
        type: isCableItem ? (originalMaterial.type || 'm') : newUnit,
        manualQuantity: isCableItem ? true : undefined
    };
    if (!isCableItem) {
        delete bomState[newKey].manualQuantity;
    }
    syncBomStateToActiveProject();
    if (isCableItem) {
        calculateBomState();
        syncBomStateToActiveProject();
    }
    document.getElementById('editMaterialModal').style.display = 'none';
    renderBomTable();
}

//Recalcula os totais exibidos na lista de materiais
function recalculateGrandTotal() {
    const t = summarizeBomCosts(bomState);
    const money = (v) => `R$ ${v.toFixed(2).replace('.', ',')}`;
    document.getElementById('ferragem-total-price').textContent = money(t.ferragemTotal);
    document.getElementById('cabos-total-price').textContent = money(t.cabosTotal);
    document.getElementById('fusao-total-price').textContent = money(t.fusaoTotal);
    document.getElementById('datacenter-total-price').textContent = money(t.datacenterTotal);
    document.getElementById('grand-total-price').textContent = money(t.grandTotal);
}

//Seção de cada item na lista de materiais (mesma regra da tela, do relatório e do PDF).
//Retorna null para itens fora da soma (removidos e mão de obra).
const BOM_COST_SECTIONS = { Ferragem: 'ferragemTotal', 'Lançamento': 'cabosTotal', 'Fusão': 'fusaoTotal', 'Data Center': 'datacenterTotal' };

function getBomCostSection(item) {
    if (!item || item.removed || item.category === 'Mão de Obra') return null;
    return BOM_COST_SECTIONS[item.category] ? item.category : 'Ferragem'; //Outros entram em Ferragens
}

//Totais de materiais por seção: usado na tela e no relatório
function summarizeBomCosts(projectBom) {
    const totals = { ferragemTotal: 0, cabosTotal: 0, fusaoTotal: 0, datacenterTotal: 0 };
    for (const key in projectBom || {}) {
        const item = projectBom[key];
        const section = getBomCostSection(item);
        if (!section) continue;
        totals[BOM_COST_SECTIONS[section]] += (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
    }
    totals.grandTotal = totals.ferragemTotal + totals.cabosTotal + totals.fusaoTotal + totals.datacenterTotal;
    return totals;
}
