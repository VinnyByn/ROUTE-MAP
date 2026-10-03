// Mão de obra do projeto: quantitativos, mão de obra regional e terceirizada e custo total para o relatório.
// Depende de script.js (bomState, projectBoms, activeFolderId) e js/bom.js.

//Levantamento de Quantitativos do Projeto
function getProjectQuantities() {
    //Verifica se há um projeto ativo. Sem isso, a função pegava todos os cabos.
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione um projeto para calcular a mão de obra.");
        return { cableLength: 0, cordoalhaLength: 0, cordoalhaCount: 0, ctoCount: 0, ceoCount: 0, reservaCount: 0 };
    }
    //Encontra o ID do projeto raiz a partir do item ativo na barra lateral.
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) {
        console.error("Não foi possível encontrar o projeto raiz para o cálculo da mão de obra.");
        return { cableLength: 0, cordoalhaLength: 0, cordoalhaCount: 0, ctoCount: 0, ceoCount: 0, reservaCount: 0 };
    }
    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    //Pega APENAS os marcadores e cabos que pertencem ao projeto ativo.
    const { markers: projectMarkers, cables: projectCables } = getProjectItems(projectId);
    let totalLength = 0;
    let cordoalhaLength = 0;
    let cordoalhaCount = 0;
    let ctoCount = 0;
    let ceoCount = 0;
    let reservaCount = 0;
    //Itera sobre a lista FILTRADA de cabos e usa o comprimento total correto.
    syncProjectCableMeasurements(projectCables);
    const cableGroups = groupCablesByType(
        projectCables.filter((c) => c.status !== 'Existente' && c.type !== 'Cabo Importado')
    );
    Object.entries(cableGroups).forEach(([cableType, cables]) => {
        const surcharge = Math.max(0, parseFloat(projectBoms[projectId]?.[cableType]?.surchargePercent) || 0);
        totalLength += getCableTypeBillableLength(cables, surcharge);
    });
    projectCables.forEach((cable) => {
        if (cable.status !== 'Existente' && cable.type === 'Cabo Importado') {
            totalLength += getCableBaseLength(cable);
        }
    });
    //Itera sobre a lista FILTRADA de marcadores.
    projectMarkers.forEach(marker => {
        if (marker.type === 'CTO' && marker.ctoStatus !== 'Existente') ctoCount++;
        if (marker.type === 'CEO' && marker.ceoStatus !== 'Existente') ceoCount++;
        if (marker.type === 'RESERVA' && marker.reservaStatus !== 'Existente') reservaCount++;
        if (marker.type === 'CORDOALHA' && marker.cordoalhaStatus !== 'Existente') {
            cordoalhaCount++;
            cordoalhaLength += 50;
        }
    });
    return {
        cableLength: Math.round(totalLength),
        cordoalhaLength: Math.round(cordoalhaLength),
        cordoalhaCount,
        ctoCount,
        ceoCount,
        reservaCount
    };
}

//Gerenciamento de mão de obra
function openLaborModal() {
    //Identificar o projeto ativo ANTES de ler o bomState
    if (!activeFolderId) {
        showAlert("Atenção", "Por favor, selecione um projeto na barra lateral para ver a mão de obra.");
        return;
    }
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) {
        showAlert("Erro", "Item selecionado não pertence a um projeto. Selecione o projeto ou um item dentro dele.");
        return;
    }
    //Carregamento do estado BOM
    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    const projectName = projectRootElement.querySelector('.folder-title').dataset.folderName;
    if (projectBoms[projectId]) {
        bomState = normalizeBomState(JSON.parse(JSON.stringify(projectBoms[projectId])));
    } else {
        calculateBomState();
        projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
    }
    //Renderização da tabela
    const tableBody = document.getElementById('labor-items-body');
    tableBody.innerHTML = '';
    let totalLaborCost = 0;
    //Flags pra controlar exibição dos bot~eos de adicionar
    let hasRegional = false;
    let hasOutsourced = false;
    for (const name in bomState) {
        const item = bomState[name];
        if (item.category === 'Mão de Obra' && !item.removed) {
            const itemTotal = item.details ? item.details.totalCost : item.unitPrice;
            totalLaborCost += itemTotal;
            const row = tableBody.insertRow();
            let type = '';
            let detailsHtml = '';
            let actionsHtml = `
                <button data-name="${name}" class="edit-labor-btn" style="background-color: #ffc107; color: #333; border: none; cursor: pointer; border-radius: 4px; padding: 4px 10px; margin-right: 5px;">Editar</button>
                <button data-name="${name}" class="remove-labor-btn" style="background-color: #f44336; color: white; border: none; cursor: pointer; border-radius: 4px; padding: 4px 10px;">Remover</button>
            `;
            //Lógica mão de obra regional com detalhe nas despesas
            if (name === 'Mão de Obra Regional') {
                type = 'Regional';
                hasRegional = true;
                const details = item.details || {};
                const totalFuel = (details.fuelQty || 0) * (details.fuelPrice || 0);
                const totalFood = (details.foodQty || 0) * (details.foodPrice || 0);
                const totalLodging = (details.lodgingQty || 0) * (details.lodgingPrice || 0);
                const totalToll = (details.tollQty || 0) * (details.tollPrice || 0);
                const expenses = totalFuel + totalFood + totalLodging + totalToll;
                const informedDays = getRegionalLaborInformedDays(details);
                const daysDisplay = informedDays !== null ? informedDays : (details.days ?? 'N/A');
                detailsHtml = `
                    <ul class="details-list">
                        <li><strong>Técnicos:</strong> ${details.techs || 'N/A'}</li>
                        <li><strong>Dias Informados:</strong> ${daysDisplay}</li>
                        <li><strong>Despesas Adic.:</strong> R$ ${expenses.toFixed(2).replace('.', ',')}</li>
                    </ul>`;
            }
            //Lógica mão de obra terceirizada
            else if (name.startsWith('Mão de Obra - ')) {
                type = 'Terceirizada';
                hasOutsourced = true;
                const details = item.details || {};
                const companyName = details.companyName || name.replace('Mão de Obra - ', '');
                detailsHtml = companyName;
                actionsHtml = `<button data-name="${name}" class="view-labor-details-btn" style="background-color: #17a2b8; color: white; border: none; cursor: pointer; border-radius: 4px; padding: 4px 10px; margin-right: 5px;">Ver Detalhes</button>` + actionsHtml;
            }
            //Preenchimento da linha da tabela
            row.innerHTML = `
                <td>${type}</td>
                <td>${detailsHtml}</td>
                <td>R$ ${itemTotal.toFixed(2).replace('.', ',')}</td>
                <td style="text-align: center;">${actionsHtml}</td>
            `;
        }
    }
    //Atualização de interface e listeneres
    document.getElementById('labor-grand-total-price').textContent = `R$ ${totalLaborCost.toFixed(2).replace('.', ',')}`;
    //Altera visibilidade dos botões de adição
    const regionalBtnElement = document.getElementById('addNewRegionalLaborButton');
    const outsourcedBtnElement = document.getElementById('addNewOutsourcedLaborButton');
    regionalBtnElement.style.display = hasRegional ? 'none' : 'inline-block';
    outsourcedBtnElement.style.display = hasOutsourced ? 'none' : 'inline-block';
    //Clona botões para remover listeners antigos e evitar acumulação de eventos
    const newRegionalBtn = regionalBtnElement.cloneNode(true);
    regionalBtnElement.parentNode.replaceChild(newRegionalBtn, regionalBtnElement);
    newRegionalBtn.addEventListener('click', () => openRegionalLaborModal()); 
    const newOutsourcedBtn = outsourcedBtnElement.cloneNode(true);
    outsourcedBtnElement.parentNode.replaceChild(newOutsourcedBtn, outsourcedBtnElement);
    newOutsourcedBtn.addEventListener('click', () => openOutsourcedLaborModal());
    //Listener de Remoção
    document.querySelectorAll('.remove-labor-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const itemName = e.target.dataset.name;
            showConfirm('Remover Mão de Obra', `Tem certeza que deseja remover "${itemName}"?`, () => {
                delete bomState[itemName]; 
                if (activeFolderId) {
                const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
                if (projectRootElement) {
                    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
                    if (projectBoms[projectId] && projectBoms[projectId][itemName]) {
                        delete projectBoms[projectId][itemName];
                    }
                }
            }
            openLaborModal();
            });
        });
    });
    //Listeners de Detalhes e Edição
    document.querySelectorAll('.view-labor-details-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const itemName = e.target.dataset.name;
            showOutsourcedDetails(itemName); 
        });
    });
    document.querySelectorAll('.edit-labor-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const itemName = e.target.dataset.name;
            if (itemName === 'Mão de Obra Regional') {
                openRegionalLaborModal(itemName); 
            } else if (itemName.startsWith('Mão de Obra - ')) {
                openOutsourcedLaborModal(itemName);
            }
        });
    });
    document.getElementById('laborModal').style.display = 'flex';
}

//Exibir detalhes de mão de obra
function showOutsourcedDetails(itemName) {
    //Recuperação e validação de dados
    const laborItem = bomState[itemName];
    if (!laborItem || !laborItem.details || !laborItem.details.services) {
        showAlert('Erro', 'Detalhes não encontrados para este item.');
        return;
    }
    //Preparação da interface
    const details = laborItem.details;
    const modal = document.getElementById('outsourcedDetailsModal');
    const title = document.getElementById('outsourcedDetailsTitle');
    const tableBody = document.getElementById('outsourcedDetailsBody');
    title.textContent = `Detalhes - ${details.companyName}`;
    tableBody.innerHTML = '';
    //Listas de serviços
    details.services.forEach(service => {
        if (service.qty > 0) {
            const row = tableBody.insertRow();
            const total = service.qty * service.price;
            row.innerHTML = `
                <td>${service.name}</td>
                <td>${service.qty}</td>
                <td>${service.unit}</td>
                <td>R$ ${service.price.toFixed(2).replace('.', ',')}</td>
                <td>R$ ${total.toFixed(2).replace('.', ',')}</td>
            `;
        }
    });
    //Exibição no modal
    modal.style.display = 'flex';
}

//Mão de obra regional
function openRegionalLaborModal(itemNameForEdit = null) {
    try {
        const modal = document.getElementById('regionalLaborModal');
        const titleElement = modal.querySelector('h2');
        const confirmButton = document.getElementById('confirmRegionalLabor');
        if (!itemNameForEdit && bomState['Mão de Obra Regional']) {
            showAlert('Atenção', 'A Mão de Obra Regional já foi adicionada.');
            return;
        }
        //Calcula os dias (Estimativa)
        const quantities = getProjectQuantities();
        const calculatedDays = estimateLaborDays(quantities);
        //Exibe a estimativa
        document.getElementById('regionalDaysDisplay').textContent = calculatedDays;
        //Pega o campo de input de dias manuais
        const manualDaysInput = document.getElementById('regionalDaysInput');
        //Lista de todos os IDs de input para facilitar
        const inputIds = [
            'regionalTechs', 'regionalDaysInput',
            'regionalFuelQty', 'regionalFuelPrice',
            'regionalFoodQty', 'regionalFoodPrice',
            'regionalLodgingQty', 'regionalLodgingPrice',
            'regionalTollQty', 'regionalTollPrice'
        ];
        //Configura o modal para o modo edição
        if (itemNameForEdit && bomState[itemNameForEdit]) {
            titleElement.textContent = 'Editar Mão de Obra Regional';
            confirmButton.textContent = 'Salvar Alterações';
            modal.dataset.editingItemName = itemNameForEdit;
            const details = bomState[itemNameForEdit].details || {};
            document.getElementById('regionalTechs').value = details.techs || 1;
            manualDaysInput.value = details.manualDays !== undefined ? details.manualDays : calculatedDays;
            document.getElementById('regionalFuelQty').value = details.fuelQty || 0;
            document.getElementById('regionalFuelPrice').value = details.fuelPrice || 0;
            document.getElementById('regionalFoodQty').value = details.foodQty || 0;
            document.getElementById('regionalFoodPrice').value = details.foodPrice || 0;
            document.getElementById('regionalLodgingQty').value = details.lodgingQty || 0;
            document.getElementById('regionalLodgingPrice').value = details.lodgingPrice || 0;
            document.getElementById('regionalTollQty').value = details.tollQty || 0;
            document.getElementById('regionalTollPrice').value = details.tollPrice || 0;
        }
        else {
            titleElement.textContent = 'Adicionar Mão de Obra Regional';
            confirmButton.textContent = 'Confirmar';
            modal.dataset.editingItemName = '';
            //Limpa/reseta os campos para os valores padrão
            document.getElementById('regionalTechs').value = 1;
            manualDaysInput.value = calculatedDays;
            //Reseta todos os campos de despesa
            inputIds.slice(2).forEach(id => {
                document.getElementById(id).value = 0;
            });
        }
        //Adiciona os listeners de 'oninput' a TODOS os campos
        inputIds.forEach(id => {
            const inputElement = document.getElementById(id);
            if (!inputElement) {
                throw new Error(`Elemento de input não encontrado: #${id}. Verifique seu index.html.`);
            }
            inputElement.oninput = null;
            inputElement.oninput = updateRegionalCost;
        });
        updateRegionalCost();
        modal.style.display = 'flex';
        
    } catch (error) {
        console.error("Erro ao abrir o modal de M.O. Regional:", error);
        showAlert(
            "Erro de Sincronização",
            "Não foi possível abrir o modal. Verifique se o seu 'index.html' (passo 1) e o seu 'script.js' (passo 2) estão ambos atualizados. Detalhe do erro: " + error.message
        );
    }
}

//Atualização dos custos mão de obra regional
function updateRegionalCost() {
    //Captura dos inputs
    const modal = document.getElementById('regionalLaborModal');
    const techs = parseInt(document.getElementById('regionalTechs').value, 10) || 0
    const days = parseInt(document.getElementById('regionalDaysInput').value, 10) || 0;
    const fuelQty = parseFloat(document.getElementById('regionalFuelQty').value) || 0;
    const fuelPrice = parseFloat(document.getElementById('regionalFuelPrice').value) || 0;
    const foodQty = parseFloat(document.getElementById('regionalFoodQty').value) || 0;
    const foodPrice = parseFloat(document.getElementById('regionalFoodPrice').value) || 0;
    const lodgingQty = parseFloat(document.getElementById('regionalLodgingQty').value) || 0;
    const lodgingPrice = parseFloat(document.getElementById('regionalLodgingPrice').value) || 0;
    const tollQty = parseFloat(document.getElementById('regionalTollQty').value) || 0;
    const tollPrice = parseFloat(document.getElementById('regionalTollPrice').value) || 0;
    //Calculo base
    const baseCost = techs * days * laborConfig.hoursPerDay * laborConfig.hourlyRate;
    const totalFuel = fuelQty * fuelPrice;
    const totalFood = foodQty * foodPrice;
    const totalLodging = lodgingQty * lodgingPrice;
    const totalToll = tollQty * tollPrice;
    const totalCost = baseCost + totalFuel + totalFood + totalLodging + totalToll;
    document.getElementById('regionalBaseCostDisplay').innerHTML = `Custo Base: <strong>R$ ${baseCost.toFixed(2).replace('.', ',')}</strong>`;
    document.getElementById('regionalTotalCostDisplay').innerHTML = `Custo Total: <strong>R$ ${totalCost.toFixed(2).replace('.', ',')}</strong>`;
}

//Confirmação e persistência mão de obra regional
function handleRegionalLaborConfirm() {
    const techs = parseInt(document.getElementById('regionalTechs').value, 10);
    //Validação da quantidade de técnicos
    if (isNaN(techs) || techs < 1) {
        showAlert('Erro', 'A quantidade de técnicos deve ser um número maior que zero.');
        return;
    }
    const modal = document.getElementById('regionalLaborModal');
    //Pega o nome do item que estava sendo editado (se houver)
    const editingItemName = modal.dataset.editingItemName;
    //Pega os outros valores do formulário
    const calculatedDays = parseInt(document.getElementById('regionalDaysDisplay').textContent, 10) || 0;
    const manualDays = parseInt(document.getElementById('regionalDaysInput').value, 10) || 0;
    //Pega os valores de Qtd e Preço das despesas
    const fuelQty = parseFloat(document.getElementById('regionalFuelQty').value) || 0;
    const fuelPrice = parseFloat(document.getElementById('regionalFuelPrice').value) || 0;
    const foodQty = parseFloat(document.getElementById('regionalFoodQty').value) || 0;
    const foodPrice = parseFloat(document.getElementById('regionalFoodPrice').value) || 0;
    const lodgingQty = parseFloat(document.getElementById('regionalLodgingQty').value) || 0;
    const lodgingPrice = parseFloat(document.getElementById('regionalLodgingPrice').value) || 0;
    const tollQty = parseFloat(document.getElementById('regionalTollQty').value) || 0;
    const tollPrice = parseFloat(document.getElementById('regionalTollPrice').value) || 0;
    //Calcula os custos
    const baseCost = techs * manualDays * laborConfig.hoursPerDay * laborConfig.hourlyRate;
    const totalFuel = fuelQty * fuelPrice;
    const totalFood = foodQty * foodPrice;
    const totalLodging = lodgingQty * lodgingPrice;
    const totalToll = tollQty * tollPrice;
    const totalCost = baseCost + totalFuel + totalFood + totalLodging + totalToll;
    //Define o nome do item
    const itemName = 'Mão de Obra Regional';
    //Cria ou atualiza a entrada no bomState
    bomState[itemName] = {
        quantity: 1,
        type: 'Regional',
        unitPrice: totalCost, 
        category: 'Mão de Obra',
        removed: false,
        details: {
            techs, 
            days: calculatedDays,
            manualDays: manualDays,
            fuelQty, fuelPrice,
            foodQty, foodPrice,
            lodgingQty, lodgingPrice,
            tollQty, tollPrice,
            baseCost, 
            totalCost
        }
    };
    if (activeFolderId) {
        const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
        if (projectRootElement) {
            const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
            if (!projectBoms[projectId]) {
                projectBoms[projectId] = {};
            }
            projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
        }
    }
    modal.dataset.editingItemName = '';
    document.getElementById('regionalLaborModal').style.display = 'none';
    openLaborModal();
}

//Modal de mão de obra terceirizada para criação e edição
const DEFAULT_OUTSOURCED_SERVICES = [
    { name: 'LANÇAMENTO DE CABO AÉREA URBANA', price: 1.80, unit: 'm', defaultQtyKey: 'cableLength' },
    { name: 'LANÇAMENTO DE CABO AÉREA RURAL', price: 2.59, unit: 'm', defaultQtyKey: null },
    { name: 'LANÇAMENTO DE CABO EM DUTO OCUPADO', price: 3.00, unit: 'm', defaultQtyKey: null },
    { name: 'INSTALAÇÃO DE RESERVA TÉCNICA', price: 80.00, unit: 'un', defaultQtyKey: 'reservaCount' },
    { name: 'LANÇAMENTO DE CORDOALHA', price: 1.50, unit: 'm', defaultQtyKey: 'cordoalhaLength' },
    { name: 'REMOÇÃO DE CABO EM REDE AÉREA', price: 1.00, unit: 'm', defaultQtyKey: null },
    { name: 'INSTALAÇÃO DE CAIXA DE EMENDA (CEO)', price: 110.00, unit: 'un', defaultQtyKey: 'ceoCount' },
    { name: 'INSTALAÇÃO DE CAIXA DE ATENDIMENTO (CTO)', price: 80.00, unit: 'un', defaultQtyKey: 'ctoCount' },
    { name: 'FUSÃO DE FIBRA ÓPTICA', price: 20.00, unit: 'un', defaultQtyKey: null },
    { name: 'INSTALAÇÃO DE POSTE', price: 270.00, unit: 'un', defaultQtyKey: null },
    { name: 'VALOR DO POSTE', price: 120.00, unit: 'un', defaultQtyKey: null },
];

function wireOutsourcedServiceRow(row) {
    row.querySelectorAll('.outsourced-price-input, .outsourced-qty-input, .outsourced-name-input, .outsourced-unit-input').forEach((el) => {
        el.oninput = updateOutsourcedCost;
        el.onchange = updateOutsourcedCost;
    });
    const removeBtn = row.querySelector('.outsourced-remove-row-btn');
    if (removeBtn) {
        removeBtn.onclick = () => {
            row.remove();
            updateOutsourcedCost();
        };
    }
}

function buildOutsourcedServiceRow({ name, price, unit, qty, isCustom = false }) {
    const row = document.createElement('tr');
    row.dataset.custom = isCustom ? 'true' : 'false';
    const priceValue = Number.isFinite(price) ? price : 0;
    const qtyValue = Number.isFinite(qty) ? qty : 0;
    const unitLabel = unit === 'un' ? '/ un' : '/ m';

    if (isCustom) {
        row.innerHTML = `
            <td><input type="text" class="outsourced-name-input" value="${name || ''}" placeholder="Nome do serviço"></td>
            <td>
                <div class="outsourced-price-cell">
                    <span>R$</span>
                    <input type="number" class="outsourced-price-input" value="${priceValue.toFixed(2)}" min="0" step="0.01">
                    <select class="outsourced-unit-input">
                        <option value="m" ${unit === 'm' ? 'selected' : ''}>/ m</option>
                        <option value="un" ${unit === 'un' ? 'selected' : ''}>/ un</option>
                    </select>
                </div>
            </td>
            <td><input type="number" class="outsourced-qty-input" value="${qtyValue}" min="0" step="any"></td>
            <td class="outsourced-subtotal">R$ 0,00</td>
            <td><button type="button" class="outsourced-remove-row-btn" title="Remover serviço">&times;</button></td>
        `;
    } else {
        row.innerHTML = `
            <td class="outsourced-service-name">${name}</td>
            <td>
                <div class="outsourced-price-cell">
                    <span>R$</span>
                    <input type="number" class="outsourced-price-input" value="${priceValue.toFixed(2)}" min="0" step="0.01">
                    <span class="outsourced-unit-label">${unitLabel}</span>
                </div>
            </td>
            <td><input type="number" class="outsourced-qty-input" value="${qtyValue}" min="0" step="any"></td>
            <td class="outsourced-subtotal">R$ 0,00</td>
            <td></td>
        `;
        row.dataset.unit = unit;
    }
    wireOutsourcedServiceRow(row);
    return row;
}

function addOutsourcedCustomServiceRow(service = {}) {
    const tableBody = document.getElementById('outsourcedServicesBody');
    if (!tableBody) return;
    const row = buildOutsourcedServiceRow({
        name: service.name || '',
        price: service.price ?? 0,
        unit: service.unit || 'un',
        qty: service.qty ?? 0,
        isCustom: true,
    });
    tableBody.appendChild(row);
    row.querySelector('.outsourced-name-input')?.focus();
}

function collectOutsourcedServicesFromTable() {
    const services = [];
    document.querySelectorAll('#outsourcedServicesBody tr').forEach((row) => {
        const isCustom = row.dataset.custom === 'true';
        const name = isCustom
            ? row.querySelector('.outsourced-name-input')?.value.trim()
            : row.querySelector('.outsourced-service-name')?.textContent.trim();
        if (!name) return;
        const price = parseFloat(row.querySelector('.outsourced-price-input')?.value) || 0;
        const qty = parseFloat(row.querySelector('.outsourced-qty-input')?.value) || 0;
        const unit = isCustom
            ? (row.querySelector('.outsourced-unit-input')?.value || 'un')
            : (row.dataset.unit || 'un');
        services.push({ name, price, unit, qty });
    });
    return services;
}

function openOutsourcedLaborModal(itemNameForEdit = null) {
    const modal = document.getElementById('outsourcedLaborModal');
    const titleElement = modal.querySelector('h2');
    const confirmButton = document.getElementById('confirmOutsourcedLabor');
    const companyNameInput = document.getElementById('outsourcedCompanyName');
    const tableBody = document.getElementById('outsourcedServicesBody');
    // Verifica se já existe M.O. Terceirizada e não está editando
    const existingOutsourced = Object.keys(bomState).find(key => key.startsWith('Mão de Obra - '));
    if (!itemNameForEdit && existingOutsourced) {
        showAlert('Atenção', 'A Mão de Obra Terceirizada já foi adicionada.');
        return;
    }
    // Calcula as quantidades atuais do projeto (para preencher no modo ADIÇÃO)
    const quantities = getProjectQuantities();
    const defaultServices = DEFAULT_OUTSOURCED_SERVICES;
    tableBody.innerHTML = '';
    let savedServicesMap = {};
    if (itemNameForEdit && bomState[itemNameForEdit]) {
        titleElement.textContent = 'Editar Mão de Obra Terceirizada';
        confirmButton.textContent = 'Salvar Alterações';
        modal.dataset.editingItemName = itemNameForEdit;
        const details = bomState[itemNameForEdit].details || {};
        companyNameInput.value = details.companyName || itemNameForEdit.replace('Mão de Obra - ', '');
        savedServicesMap = (details.services || []).reduce((acc, service) => {
            acc[service.name] = service;
            return acc;
        }, {});
    } else {
        titleElement.textContent = 'Adicionar Mão de Obra Terceirizada';
        confirmButton.textContent = 'Confirmar';
        modal.dataset.editingItemName = '';
        companyNameInput.value = '';
    }

    defaultServices.forEach((service) => {
        const saved = savedServicesMap[service.name];
        let quantity = 0;
        if (itemNameForEdit) {
            quantity = saved?.qty || 0;
        } else if (service.defaultQtyKey) {
            quantity = quantities[service.defaultQtyKey] || 0;
        }
        const price = saved?.price ?? service.price;
        tableBody.appendChild(buildOutsourcedServiceRow({
            name: service.name,
            price,
            unit: service.unit,
            qty: quantity,
            isCustom: false,
        }));
    });

    const defaultNames = new Set(defaultServices.map((s) => s.name));
    (itemNameForEdit ? (bomState[itemNameForEdit]?.details?.services || []) : []).forEach((service) => {
        if (!defaultNames.has(service.name)) {
            addOutsourcedCustomServiceRow(service);
        }
    });

    updateOutsourcedCost();
    modal.style.display = 'flex';
}

//Atualização em tempo real do custo terceirizado
function updateOutsourcedCost() {
    let total = 0;
    document.querySelectorAll('#outsourcedServicesBody tr').forEach((row) => {
        const price = parseFloat(row.querySelector('.outsourced-price-input')?.value) || 0;
        const qty = parseFloat(row.querySelector('.outsourced-qty-input')?.value) || 0;
        const subtotal = price * qty;
        const subtotalCell = row.querySelector('.outsourced-subtotal');
        if (subtotalCell) {
            subtotalCell.textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
        }
        total += subtotal;
    });
    document.getElementById('outsourcedTotalCostDisplay').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
}

//Confirmação e persistência de dados de mão de obra terceirizada
function handleOutsourcedLaborConfirm() {
    const modal = document.getElementById('outsourcedLaborModal');
    const editingItemName = modal.dataset.editingItemName;
    const companyName = document.getElementById('outsourcedCompanyName').value.trim() || 'Terceirizada';
    const services = collectOutsourcedServicesFromTable();
    const totalCost = services.reduce((sum, service) => sum + (service.price * service.qty), 0);
    // Se está editando, usa o nome original. Se está adicionando, cria um novo.
    const itemName = editingItemName || `Mão de Obra - ${companyName}`;
    // Verifica se o custo é válido antes de salvar/atualizar
    if (totalCost >= 0) {
        // Cria ou atualiza a entrada no bomState
        bomState[itemName] = {
            quantity: 1,
            type: 'Outsourced', 
            unitPrice: totalCost, 
            category: 'Mão de Obra',
            removed: false,
            details: { 
                companyName: companyName, 
                services: services, 
                totalCost: totalCost 
            }
        };
        if (activeFolderId) {
            const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
            if (projectRootElement) {
                const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
                // Garante que o objeto do projeto existe antes de salvar
                if (!projectBoms[projectId]) {
                    projectBoms[projectId] = {};
                }
                // Sincroniza o bomState atual (que agora inclui a M.O.) com o bom salvo
                projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
            }
        }
    } else {
        showAlert('Erro', 'Custo total inválido. Não foi possível salvar.');
        return; // Impede o fechamento do modal se o custo for inválido
    }
    // Limpa o estado de edição e fecha o modal
    modal.dataset.editingItemName = '';
    document.getElementById('outsourcedLaborModal').style.display = 'none';
    openLaborModal();
}

//Cálculo final de custos maõ de obra
function calculateProjectLaborCost(projectItems, projectBomForReport) {
    let regionalCost = 0;
    let outsourcedCost = 0;
    //Garante que exista um objeto BOM
    const bomToUse = projectBomForReport || {};
    //Identificação de mão de obra
    const regionalLabor = bomToUse['Mão de Obra Regional'];
    const outsourcedLabor = Object.values(bomToUse).find(item => item.type === 'Outsourced');
    //Processamento mão de obra regional
    if (regionalLabor && !regionalLabor.removed) {
        if (regionalLabor.details && typeof regionalLabor.details.totalCost === 'number') {
            regionalCost = regionalLabor.details.totalCost;
        } else {
            regionalCost = regionalLabor.unitPrice || 0;
        }
    }
    //Processamento mão de obra terceirizada
    if (outsourcedLabor && !outsourcedLabor.removed) {
        if (outsourcedLabor.details && typeof outsourcedLabor.details.totalCost === 'number') {
            outsourcedCost = outsourcedLabor.details.totalCost;
        } else {
            outsourcedCost = outsourcedLabor.unitPrice || 0;
        }
    }
    const totalLaborCost = regionalCost + outsourcedCost;
    return { regionalCost, outsourcedCost, totalLaborCost };
}
