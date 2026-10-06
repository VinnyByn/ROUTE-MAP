// Painel lateral de marcadores (CEO, CTO, cordoalha, reserva, casas, POP e importados).
// Mesmo estilo dos painéis de polígono e régua: o mapa continua visível e clicável.
// Criação: escolhe o tipo → preenche o painel → "Posicionar no mapa" → clique no mapa.

const MARKER_TYPE_META = {
    CEO: { name: 'CEO', article: 'Nova', noun: 'caixa de emenda (CEO)', prefix: 'CEO', statuses: ['Nova', 'Existente', 'Troca'], accessory: true, color: '#f59e0b' },
    CTO: { name: 'CTO', article: 'Nova', noun: 'CTO', prefix: 'CTO', statuses: ['Nova', 'Existente', 'Troca'], color: '#16a34a' },
    CORDOALHA: { name: 'Cordoalha', article: 'Nova', noun: 'cordoalha', prefix: 'CD', statuses: ['Nova', 'Existente'], color: '#0ea5e9' },
    RESERVA: { name: 'Reserva técnica', article: 'Nova', noun: 'reserva técnica', prefix: 'RT', statuses: ['Nova', 'Existente'], accessory: true, color: '#ef4444' },
    CASA: { name: 'Casas', article: 'Novas', noun: 'casas', prefix: '', statuses: null, color: '#ffffff', labelColor: '#0f172a' },
    POP: { name: 'POP', article: 'Novo', noun: 'POP', prefix: 'POP', statuses: null, color: '#7c3aed' },
    POSTE: { name: 'Poste', article: 'Novo', noun: 'poste', prefix: 'P', statuses: null, color: '#64748b' },
    Importado: { name: 'Marcador importado', article: 'Novo', noun: 'marcador', prefix: 'MK', statuses: ['Nova', 'Existente'], color: '#ff9800' },
};
const MARKER_STYLE_STORAGE_PREFIX = 'routeMapMarkerStyle_';

let markerPanelMode = 'create'; //'create' | 'edit'

function getMarkerTypeMeta(type) {
    return MARKER_TYPE_META[type] || { name: 'Marcador', article: 'Novo', noun: 'marcador', prefix: 'MK', statuses: null, color: '#f59e0b' };
}

function readStoredMarkerStyle(type) {
    try { return JSON.parse(localStorage.getItem(MARKER_STYLE_STORAGE_PREFIX + type) || 'null') || {}; } catch (e) { return {}; }
}

function storeMarkerStyle(type, style) {
    try { localStorage.setItem(MARKER_STYLE_STORAGE_PREFIX + type, JSON.stringify(style)); } catch (e) { /* sem armazenamento */ }
}

//Sugere o próximo nome livre do tipo no projeto (ex.: CTO-03)
function suggestMarkerName(type) {
    const prefix = getMarkerTypeMeta(type).prefix;
    if (!prefix) return '';
    const folderIds = getProjectFolderIdsForItem(activeFolderId) || [];
    const used = new Set(markers.filter(m => folderIds.includes(m.folderId)).map(m => String(m.name || '').toUpperCase()));
    for (let n = 1; n < 1000; n++) {
        const candidate = `${prefix}-${String(n).padStart(2, '0')}`;
        if (!used.has(candidate)) return candidate;
    }
    return prefix;
}

function isMarkerPanelOpen() {
    return !document.getElementById('markerModal')?.classList.contains('hidden');
}

function showMarkerPanel() {
    document.getElementById('markerModal')?.classList.remove('hidden');
}

function hideMarkerPanel() {
    document.getElementById('markerModal')?.classList.add('hidden');
}

// ---------------------------------------------------------------
// Botões segmentados (situação e instalação)
// ---------------------------------------------------------------

function renderSegmentedOptions(containerId, options, value) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    container.style.gridTemplateColumns = `repeat(${options.length}, 1fr)`;
    options.forEach(({ value: optionValue, label }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.value = optionValue;
        button.textContent = label;
        button.setAttribute('role', 'radio');
        button.addEventListener('click', () => {
            setSegmentedValue(containerId, optionValue);
            container.dispatchEvent(new CustomEvent('segmented-change', { detail: optionValue }));
        });
        container.appendChild(button);
    });
    setSegmentedValue(containerId, value);
}

function setSegmentedValue(containerId, value) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('button').forEach(button => {
        const active = button.dataset.value === value;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    container.dataset.value = value;
}

function getSegmentedValue(containerId) {
    return document.getElementById(containerId)?.dataset.value || '';
}

// ---------------------------------------------------------------
// Montagem do painel conforme o tipo
// ---------------------------------------------------------------

function toggleMarkerPanelGroup(id, visible) {
    document.getElementById(id)?.classList.toggle('hidden', !visible);
}

function configureMarkerPanel(type, mode) {
    markerPanelMode = mode;
    const meta = getMarkerTypeMeta(type);
    const isCasa = type === 'CASA';
    const isEdit = mode === 'edit';
    const isKmlAdjust = !isEdit && !!adjustingKmlMarkerInfo;

    document.getElementById('markerModalTitle').textContent = isEdit ? meta.name : `${meta.article} ${meta.noun}`;
    document.getElementById('markerPanelSubtitle').textContent = isEdit
        ? (isCasa ? 'Contagem de casas (HP)' : 'Editar marcador')
        : (isKmlAdjust ? `Converter "${adjustingKmlMarkerInfo.name}"` : 'Preencha e posicione no mapa');

    if (meta.statuses) {
        const statusOptions = meta.statuses.map(value => ({ value, label: value === 'Nova' ? 'Nova' : value }));
        renderSegmentedOptions('markerStatusSegmented', statusOptions, getSegmentedValue('markerStatusSegmented') || 'Nova');
    }
    toggleMarkerPanelGroup('markerInfraStatusGroup', !!meta.statuses);
    toggleMarkerPanelGroup('ceoAccessoryEditGroup', !!meta.accessory);
    toggleMarkerPanelGroup('nameGroup', !isCasa);
    toggleMarkerPanelGroup('houseNumberGroup', isCasa);
    toggleMarkerPanelGroup('descGroup', !isCasa);
    toggleMarkerPanelGroup('ctoOptionsPanel', type === 'CTO');
    toggleMarkerPanelGroup('ceo144Group', type === 'CEO');
    toggleMarkerPanelGroup('derivationTGroup', type === 'CORDOALHA');
    toggleMarkerPanelGroup('poleGroup', type === 'POSTE');
    toggleMarkerPanelGroup('markerPositionRow', isEdit);
    toggleMarkerPanelGroup('deleteMarkerButton', isEdit);
    toggleMarkerPanelGroup('editPositionButton', isEdit);
    document.querySelector('#labelColorGroup label').textContent = isCasa ? 'Cor do número' : 'Cor do nome';
    document.querySelector('#colorGroup label').textContent = isCasa ? 'Cor do balão' : 'Cor';

    const confirmButton = document.getElementById('confirmMarker');
    confirmButton.textContent = isEdit ? 'Salvar' : (isKmlAdjust ? 'Converter' : 'Posicionar no mapa');

    if (type === 'CEO' || type === 'CTO') {
        setFusionPlanButtonState({
            visible: true,
            enabled: isEdit,
            title: isEdit ? 'Abrir o plano de fusão desta caixa' : 'Posicione a caixa no mapa para montar o plano de fusão',
            onClick: isEdit ? () => {
                const markerInfo = editingMarkerInfo;
                populateFusionPlan(markerInfo);
                document.getElementById('fusionModal').style.display = 'flex';
                resetMarkerModal({ discardPositionChanges: false });
            } : null,
        });
    } else {
        setFusionPlanButtonState({ visible: false });
    }

    document.getElementById('markerPanelHelp').innerHTML = isEdit
        ? 'Use <strong>Mover</strong> para arrastar o marcador no mapa. <kbd>Enter</kbd> salva e <kbd>Esc</kbd> fecha.'
        : (isKmlAdjust
            ? 'O marcador importado será trocado por este tipo, na mesma posição.'
            : 'Clique em <strong>Posicionar no mapa</strong> e depois no local do marcador. <kbd>Esc</kbd> cancela.');
    updateMarkerPanelPreview();
}

function getMarkerPanelType() {
    return editingMarkerInfo?.type || selectedMarkerData.type;
}

// ---------------------------------------------------------------
// Controle de tamanho (painel do marcador e "Padronizar estilo")
// ---------------------------------------------------------------

const MARKER_SIZE_PRESETS = [
    { value: 2, label: 'P', title: 'Pequeno' },
    { value: 4, label: 'M', title: 'Médio (padrão)' },
    { value: 7, label: 'G', title: 'Grande' },
    { value: 11, label: 'GG', title: 'Muito grande' },
];

//Monta: prévia no tamanho real, tamanhos prontos e ajuste fino (−, barra, +)
function buildMarkerSizeControl(mount, { id, type = 'CTO', onInput = null }) {
    if (!mount) return;
    mount.innerHTML = `
        <div class="ms-size" data-size-control="${id}" data-type="${type}">
            <div class="ms-size__stage" aria-hidden="true">
                <span class="ms-size__icon"></span>
                <span class="ms-size__label"></span>
            </div>
            <div class="ms-size__controls">
                <div class="ms-size__head"><span>Tamanho</span><output class="ms-size__value" id="${id}Value"></output></div>
                <div class="ms-size__presets" role="radiogroup" aria-label="Tamanhos prontos">
                    ${MARKER_SIZE_PRESETS.map(p => `<button type="button" class="ms-size__preset" data-value="${p.value}" role="radio" title="${p.title} · ${getMarkerPixelSize(p.value)} px"><span class="ms-size__glyph" style="--glyph:${Math.round(getMarkerPixelSize(p.value) * 0.55)}px"></span><b>${p.label}</b></button>`).join('')}
                </div>
                <div class="ms-size__fine">
                    <button type="button" class="ms-size__step" data-step="-1" aria-label="Diminuir" title="Diminuir">−</button>
                    <input type="range" id="${id}" min="1" max="20" step="1" value="${DEFAULT_MARKER_SIZE}" aria-label="Tamanho do marcador" />
                    <button type="button" class="ms-size__step" data-step="1" aria-label="Aumentar" title="Aumentar">+</button>
                </div>
            </div>
        </div>`;
    const root = mount.querySelector('.ms-size');
    const range = root.querySelector('input[type="range"]');
    const emit = () => {
        root.dispatchEvent(new CustomEvent('size-change', { detail: Number(range.value) }));
        onInput?.(Number(range.value));
    };
    range.addEventListener('input', () => { syncMarkerSizeControl(root); emit(); });
    root.querySelectorAll('.ms-size__preset').forEach(button => button.addEventListener('click', () => {
        if (range.disabled) return;
        range.value = button.dataset.value;
        syncMarkerSizeControl(root);
        emit();
    }));
    root.querySelectorAll('.ms-size__step').forEach(button => button.addEventListener('click', () => {
        if (range.disabled) return;
        range.value = Math.max(1, Math.min(20, Number(range.value) + Number(button.dataset.step)));
        syncMarkerSizeControl(root);
        emit();
    }));
    syncMarkerSizeControl(root);
}

function getMarkerSizeControl(id) {
    return document.querySelector(`[data-size-control="${id}"]`);
}

function getMarkerSizeControlValue(id) {
    return parseInt(document.getElementById(id)?.value, 10) || DEFAULT_MARKER_SIZE;
}

function setMarkerSizeControlValue(id, value) {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = Math.max(1, Math.min(20, Number(value) || DEFAULT_MARKER_SIZE));
    const root = getMarkerSizeControl(id);
    if (root) syncMarkerSizeControl(root);
}

function syncMarkerSizeControl(root) {
    const range = root.querySelector('input[type="range"]');
    const value = Number(range.value);
    const px = getMarkerPixelSize(value);
    root.querySelector('.ms-size__value').textContent = `${px} px`;
    root.querySelectorAll('.ms-size__preset').forEach(button => {
        const active = Number(button.dataset.value) === value;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    const icon = root.querySelector('.ms-size__icon');
    const isCasa = root.dataset.type === 'CASA';
    icon.style.width = `${isCasa ? Math.round(px * 1.35) : px}px`;
    icon.style.height = `${isCasa ? Math.round(px * 1.4) : px}px`;
    range.style.setProperty('--fill', `${((value - 1) / 19) * 100}%`);
}

//Cor, tipo e nome da prévia
function updateMarkerSizeControlPreview(id, color, type, { label = '', labelColor = '#0f172a', text = '' } = {}) {
    const root = getMarkerSizeControl(id);
    if (!root) return;
    root.dataset.type = type || 'CTO';
    const url = `url("${getMarkerIconDataUrl(type || 'CTO', color, { text, labelColor })}")`;
    root.querySelector('.ms-size__icon').style.backgroundImage = url;
    root.querySelectorAll('.ms-size__glyph').forEach(glyph => { glyph.style.backgroundImage = url; });
    const labelEl = root.querySelector('.ms-size__label');
    labelEl.textContent = type === 'CASA' ? '' : label;
    labelEl.style.color = labelColor;
    labelEl.className = `ms-size__label ${getContrastTextColor(labelColor) === '#0f172a' ? 'marker-label--light-halo' : 'marker-label--dark-halo'}`;
    syncMarkerSizeControl(root);
}

//Ícone do cabeçalho e prévia acompanham cor, tipo e tamanho escolhidos
function updateMarkerPanelPreview() {
    const type = getMarkerPanelType();
    const icon = document.getElementById('markerPanelIcon');
    if (!icon || !type) return;
    const color = document.getElementById('markerColor').value;
    const labelColor = document.getElementById('markerLabelColor').value;
    icon.style.backgroundImage = `url("${getMarkerIconDataUrl(type, color, { labelColor })}")`;
    updateMarkerSizeControlPreview('markerSize', color, type, {
        label: document.getElementById('markerName').value.trim() || getMarkerTypeMeta(type).prefix || type,
        labelColor,
        text: document.getElementById('markerNumber').value || '12',
    });
    if (type === 'CTO') {
        const stickers = document.getElementById('ctoStickerCheckbox');
        const status = getSegmentedValue('markerStatusSegmented');
        if (stickers && !stickers.dataset.userChanged && markerPanelMode === 'create') stickers.checked = shouldDefaultCtoStickers(status);
    }
}

//Na edição, o marcador no mapa já mostra cor, nome e tamanho enquanto se ajusta
let markerStylePreviewActive = false;

function previewEditingMarkerStyle() {
    const info = editingMarkerInfo;
    if (!info?.marker || info.type === 'CLIENTE' || !AppSession.canEdit) return;
    const form = readMarkerPanelForm();
    const isCasa = info.type === 'CASA';
    info.marker.setIcon(buildMarkerMapIcon(info.type, {
        color: form.color,
        size: form.size,
        text: isCasa ? (form.houses || info.name) : '',
        labelColor: form.labelColor,
    }));
    if (!isCasa) info.marker.setLabel(buildMarkerMapLabel(form.name || info.name, form.labelColor));
    if (focusedMapMarkerInfo === info && focusedMapMarkerRing) {
        focusedMapMarkerRing.setIcon(getMarkerHighlightRingIcon({ ...info, size: form.size }, true));
    }
    markerStylePreviewActive = true;
}

function handleMarkerStyleInput() {
    updateMarkerPanelPreview();
    previewEditingMarkerStyle();
}

function fillMarkerPanelStyle(values) {
    document.getElementById('markerColor').value = values.color;
    document.getElementById('markerLabelColor').value = values.labelColor;
    setMarkerSizeControlValue('markerSize', values.size);
}

// ---------------------------------------------------------------
// Abrir para criar / editar
// ---------------------------------------------------------------

function openMarkerCreatePanel(type) {
    const kmlSource = adjustingKmlMarkerInfo;
    resetMarkerModal();
    adjustingKmlMarkerInfo = kmlSource;
    selectedMarkerData.type = type;
    const meta = getMarkerTypeMeta(type);
    const stored = readStoredMarkerStyle(type);
    fillMarkerPanelStyle({
        color: stored.color || meta.color,
        labelColor: stored.labelColor || meta.labelColor || '#0f172a',
        size: stored.size || DEFAULT_MARKER_SIZE,
    });
    setSegmentedValue('markerStatusSegmented', kmlSource?.pendingImportStatus === 'Existente' ? 'Existente' : 'Nova');
    renderSegmentedOptions('markerAccessorySegmented', [
        { value: 'Raquete', label: 'Raquete' },
        { value: 'Suporte', label: 'Suporte' },
    ], 'Raquete');
    document.getElementById('markerName').value = kmlSource ? kmlSource.name : suggestMarkerName(type);
    document.getElementById('markerDescription').value = kmlSource?.description || '';
    document.getElementById('markerNumber').value = kmlSource && type === 'CASA' ? (parseInt(kmlSource.name, 10) || '') : '';
    configureMarkerPanel(type, 'create');
    showMarkerPanel();
    setTimeout(() => {
        const input = document.getElementById(type === 'CASA' ? 'markerNumber' : 'markerName');
        input?.focus();
        input?.select?.();
    }, 30);
}

function openMarkerEditor(markerInfo) {
    resetMarkerModal();
    editingMarkerInfo = markerInfo;
    markerEditOriginPosition = cloneMapLatLng(markerInfo.marker?.getPosition());
    markerPositionEditSession = null;
    const meta = getMarkerTypeMeta(markerInfo.type);
    fillMarkerPanelStyle({
        color: markerInfo.color || meta.color,
        labelColor: markerInfo.labelColor || '#0f172a',
        size: markerInfo.size || DEFAULT_MARKER_SIZE,
    });
    document.getElementById('markerName').value = markerInfo.name || '';
    document.getElementById('markerNumber').value = markerInfo.type === 'CASA' ? markerInfo.name : '';
    document.getElementById('markerDescription').value = markerInfo.description || '';
    setSegmentedValue('markerStatusSegmented', getMarkerInfrastructureStatus(markerInfo) || 'Nova');
    const accessory = markerInfo.type === 'RESERVA' ? markerInfo.reservaAccessory : markerInfo.ceoAccessory;
    renderSegmentedOptions('markerAccessorySegmented', [
        { value: 'Raquete', label: 'Raquete' },
        { value: 'Suporte', label: 'Suporte' },
    ], accessory === 'Suporte' ? 'Suporte' : 'Raquete');
    document.getElementById('ctoPredialCheckbox').checked = !!markerInfo.isPredial;
    document.getElementById('ctoStickerCheckbox').checked = markerInfo.needsStickers ?? shouldDefaultCtoStickers(markerInfo.ctoStatus);
    document.getElementById('ceo144Checkbox').checked = !!markerInfo.is144F;
    document.getElementById('markerDerivationT').value = markerInfo.derivationTCount || 0;
    fillPoleForm(markerInfo.pole || {});
    const position = markerInfo.marker.getPosition();
    setMarkerEditorCoordinatesText(markerInfo.type, position.lat().toFixed(6), position.lng().toFixed(6));
    configureMarkerPanel(markerInfo.type, 'edit');
    if (markerInfo.type === 'CTO') renderCtoClientsPanel(markerInfo);
    if (typeof updatePopEquipmentPanelSummary === 'function') updatePopEquipmentPanelSummary(markerInfo);
    highlightMapMarker(markerInfo, { persistent: true });
    if (AppSession.isViewer) {
        document.getElementById('markerPanelSubtitle').textContent = 'Somente visualização';
        document.getElementById('markerPanelHelp').textContent = 'Seu cargo permite apenas consultar os dados do marcador.';
    }
    lockFormsForViewer('markerModal');
    showMarkerPanel();
}

// ---------------------------------------------------------------
// Salvar
// ---------------------------------------------------------------

function readMarkerPanelForm() {
    return {
        name: document.getElementById('markerName').value.trim(),
        houses: document.getElementById('markerNumber').value.trim(),
        color: document.getElementById('markerColor').value,
        labelColor: document.getElementById('markerLabelColor').value,
        size: parseInt(document.getElementById('markerSize').value, 10) || DEFAULT_MARKER_SIZE,
        description: document.getElementById('markerDescription').value,
        status: getSegmentedValue('markerStatusSegmented') || 'Nova',
        accessory: getSegmentedValue('markerAccessorySegmented') || 'Raquete',
        isPredial: document.getElementById('ctoPredialCheckbox').checked,
        needsStickers: document.getElementById('ctoStickerCheckbox').checked,
        is144F: document.getElementById('ceo144Checkbox').checked,
        derivationTCount: parseInt(document.getElementById('markerDerivationT').value, 10) || 0,
        pole: readPoleForm(),
    };
}

function applyMarkerFormToData(target, type, form) {
    target.name = type === 'CASA' ? (form.houses || '0') : (form.name || 'Marcador');
    target.color = form.color;
    target.labelColor = form.labelColor;
    target.size = form.size;
    if (type !== 'CASA') target.description = form.description;
    if (type === 'CTO') {
        target.isPredial = form.isPredial;
        target.needsStickers = form.needsStickers;
    }
    if (type === 'CEO') {
        target.is144F = form.is144F;
        target.ceoAccessory = form.accessory;
    }
    if (type === 'RESERVA') target.reservaAccessory = form.accessory;
    if (type === 'CORDOALHA') target.derivationTCount = form.derivationTCount;
    if (type === 'POSTE') target.pole = form.pole;
}

// ---------------------------------------------------------------
// Poste: número/plaqueta, altura, esforço, material, concessionária, ocupantes, situação
// ---------------------------------------------------------------

const POLE_SITUATIONS = ['Existente', 'Novo', 'Substituir', 'Remover'];

function readPoleForm() {
    const v = (id) => document.getElementById(id)?.value.trim() || '';
    const n = (id) => { const x = parseFloat(v(id).replace(',', '.')); return Number.isFinite(x) && x >= 0 ? x : null; };
    return {
        number: v('poleNumber'), height: n('poleHeight'), effort: n('poleEffort'), material: v('poleMaterial'),
        utility: v('poleUtility'), occupants: n('poleOccupants'), situation: v('poleSituation') || 'Existente', notes: v('poleNotes'),
    };
}

function fillPoleForm(pole = {}) {
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value ?? ''; };
    set('poleNumber', pole.number); set('poleHeight', pole.height); set('poleEffort', pole.effort);
    set('poleMaterial', pole.material || 'Concreto'); set('poleUtility', pole.utility); set('poleOccupants', pole.occupants);
    set('poleSituation', pole.situation || 'Existente'); set('poleNotes', pole.notes);
}

function describePole(pole = {}) {
    return [pole.number && `nº ${pole.number}`, pole.height && `${pole.height} m`, pole.effort && `${pole.effort} daN`, pole.material, pole.situation].filter(Boolean).join(' · ');
}

function handleMarkerPanelConfirm() {
    const type = getMarkerPanelType();
    if (!type) return;
    const form = readMarkerPanelForm();
    if (type === 'CASA' && !(Number(form.houses) >= 0 && form.houses !== '')) {
        showToast('Informe a quantidade', 'Digite quantas casas este marcador representa.', 'progress');
        document.getElementById('markerNumber').focus();
        return;
    }
    storeMarkerStyle(type, { color: form.color, labelColor: form.labelColor, size: form.size });
    if (editingMarkerInfo) {
        const markerInfo = editingMarkerInfo;
        const oldName = markerInfo.name;
        applyMarkerFormToData(markerInfo, type, form);
        if (getMarkerTypeMeta(type).statuses) applyMarkerInfrastructureStatus(markerInfo, form.status);
        if (type === 'CTO') markerInfo.needsStickers = form.needsStickers;
        if (oldName !== markerInfo.name) syncCableAnchorNamesForMarker(markerInfo);
        updateMarkerAppearance(markerInfo);
        refreshBomAfterProjectChange();
        resetMarkerModal({ discardPositionChanges: false });
        return;
    }
    applyMarkerFormToData(selectedMarkerData, type, form);
    if (type === 'CTO') selectedMarkerData.ctoStatus = form.status;
    if (type === 'CEO') selectedMarkerData.ceoStatus = form.status;
    if (type === 'CORDOALHA') selectedMarkerData.cordoalhaStatus = form.status;
    if (type === 'RESERVA') selectedMarkerData.reservaStatus = form.status;
    startPlacingMarker();
}

// ---------------------------------------------------------------
// Posicionamento no mapa
// ---------------------------------------------------------------

function startPlacingMarker() {
    isAddingMarker = true;
    setAllPolygonsClickable(false);
    setAllCablesClickable(false);
    hideMarkerPanel();
    document.getElementById('markerTypeModal').style.display = 'none';
    //Conversão de marcador importado: troca na mesma posição
    if (adjustingKmlMarkerInfo) {
        const original = adjustingKmlMarkerInfo;
        const originalPosition = original.marker.getPosition();
        original.marker.setMap(null);
        original.listItem.remove();
        markers = markers.filter(m => m !== original);
        selectedMarkerData.isImported = false;
        selectedMarkerData.fromKmlImport = original.fromKmlImport || false;
        selectedMarkerData.uid = original.uid || null;
        delete selectedMarkerData.pendingImportStatus;
        const previousFolder = activeFolderId;
        activeFolderId = original.folderId || activeFolderId;
        addCustomMarker(originalPosition);
        activeFolderId = previousFolder;
        const projectFolderIds = getProjectFolderIdsForItem(original.folderId);
        if (projectFolderIds) syncProjectCableMeasurements(savedCables.filter(c => projectFolderIds.includes(c.folderId)));
        adjustingKmlMarkerInfo = null;
        resetMarkerModal();
        showToast('Marcador convertido', `"${original.name}" agora é ${getMarkerTypeMeta(markers[markers.length - 1]?.type).noun}.`);
        return;
    }
    setMapCursor('crosshair');
    showToast('Posicione no mapa', 'Clique no local do marcador. Esc cancela.', 'progress');
    placeMarkerListener = map.addListener('click', (event) => {
        if (!isAddingMarker) return;
        try {
            addCustomMarker(event.latLng);
        } catch (error) {
            console.error('Erro ao posicionar o marcador:', error);
            showToast('Erro', 'Não foi possível posicionar o marcador. Tente de novo.');
        } finally {
            resetMarkerModal();
        }
    });
}

// ---------------------------------------------------------------
// Reset e mover posição
// ---------------------------------------------------------------

function resetMarkerModal({ discardPositionChanges = true } = {}) {
    hideMarkerPanel();
    document.getElementById('ctoClientsPanel')?.classList.add('hidden');
    document.getElementById('popEquipmentGroup')?.classList.add('hidden');
    if (placeMarkerListener) {
        google.maps.event.removeListener(placeMarkerListener);
        placeMarkerListener = null;
    }
    if (isAddingMarker) {
        isAddingMarker = false;
        setMapCursor('');
    }
    if (editingMarkerInfo) {
        if (editingMarkerInfo.marker?.getDraggable?.()) {
            finishMarkerPositionEditSession({ reopenModal: false });
        } else if (discardPositionChanges) {
            restoreMarkerEditOriginPosition();
        }
        editingMarkerInfo.marker.setDraggable(false);
        //Desfaz a prévia de cor/tamanho que não foi salva (depois de salvar, reaplica o mesmo estilo)
        if (markerStylePreviewActive) updateMarkerAppearance(editingMarkerInfo);
        editingMarkerInfo = null;
    }
    markerStylePreviewActive = false;
    markerEditOriginPosition = null;
    markerPositionEditSession = null;
    clearMapMarkerHighlight();
    document.getElementById('markerName').value = '';
    document.getElementById('markerNumber').value = '';
    document.getElementById('markerDescription').value = '';
    document.getElementById('markerDerivationT').value = '0';
    document.getElementById('infraMarkerCoordinatesText').textContent = '';
    document.getElementById('ctoPredialCheckbox').checked = false;
    const stickers = document.getElementById('ctoStickerCheckbox');
    stickers.checked = false;
    delete stickers.dataset.userChanged;
    document.getElementById('ceo144Checkbox').checked = false;
    setSegmentedValue('markerStatusSegmented', 'Nova');
    setFusionPlanButtonState({ visible: false });
    selectedMarkerData = {
        type: '',
        name: '',
        color: '#ff0000',
        labelColor: '#000000',
        size: DEFAULT_MARKER_SIZE,
        description: '',
        ctoStatus: 'Nova',
        isPredial: false,
        needsStickers: false,
        ceoStatus: 'Nova',
        ceoAccessory: 'Raquete',
        is144F: false,
        cordoalhaStatus: 'Nova',
        reservaStatus: 'Nova',
        reservaAccessory: 'Raquete',
        derivationTCount: 0,
    };
    setAllPolygonsClickable(true);
    if (!isDrawingCable && !isSketchToolActive()) setAllCablesClickable(true);
}

function getMarkerEditorUiContext() {
    return {
        coordinatesText: document.getElementById('infraMarkerCoordinatesText'),
        positionRow: document.getElementById('markerPositionRow'),
        editPositionButton: document.getElementById('editPositionButton'),
    };
}

function setMarkerEditorCoordinatesText(markerType, lat, lng) {
    const { coordinatesText } = getMarkerEditorUiContext();
    if (coordinatesText) coordinatesText.textContent = `${lat}, ${lng}`;
}

function startMarkerPositionEditSession() {
    if (!editingMarkerInfo) return;
    const markerInfo = editingMarkerInfo;
    const marker = markerInfo.marker;
    const oldPosition = cloneMapLatLng(marker.getPosition());
    highlightMapMarker(markerInfo, { persistent: true, emphasized: true });
    hideMarkerPanel();
    marker.setDraggable(true);
    showToast('Mover marcador', 'Arraste o marcador até a nova posição. Esc cancela.', 'progress');
    markerPositionEditSession = { originalPosition: oldPosition, dragListener: null, dragendListener: null };
    markerPositionEditSession.dragListener = marker.addListener('drag', () => {
        const pos = marker.getPosition();
        if (focusedMapMarkerInfo === markerInfo && focusedMapMarkerRing && pos) focusedMapMarkerRing.setPosition(pos);
        if (markerInfo.type === 'CTO' && typeof refreshClientDrops === 'function') refreshClientDrops({ onlyCto: markerInfo, live: true });
    });
    markerPositionEditSession.dragendListener = google.maps.event.addListenerOnce(marker, 'dragend', () => {
        if (markerPositionEditSession?.dragListener) google.maps.event.removeListener(markerPositionEditSession.dragListener);
        markerPositionEditSession = null;
        marker.setDraggable(false);
        const newPosition = marker.getPosition();
        if (focusedMapMarkerInfo === markerInfo && focusedMapMarkerRing && newPosition) focusedMapMarkerRing.setPosition(newPosition);
        if (oldPosition && newPosition) updateCablesForMovedMarker(oldPosition, newPosition, markerInfo);
        if (typeof refreshClientDrops === 'function') refreshClientDrops({ onlyCto: markerInfo });
        setMarkerEditorCoordinatesText(markerInfo.type, newPosition.lat().toFixed(6), newPosition.lng().toFixed(6));
        showMarkerPanel();
    });
}

function restoreMarkerEditOriginPosition() {
    if (!editingMarkerInfo || !markerEditOriginPosition) return;
    const marker = editingMarkerInfo.marker;
    const currentPosition = marker.getPosition();
    if (!currentPosition) return;
    const samePosition = Math.abs(currentPosition.lat() - markerEditOriginPosition.lat()) < 1e-9
        && Math.abs(currentPosition.lng() - markerEditOriginPosition.lng()) < 1e-9;
    if (samePosition) return;
    updateCablesForMovedMarker(currentPosition, markerEditOriginPosition, editingMarkerInfo);
    marker.setPosition(markerEditOriginPosition);
    if (typeof refreshClientDrops === 'function') refreshClientDrops({ onlyCto: editingMarkerInfo });
    if (focusedMapMarkerInfo === editingMarkerInfo && focusedMapMarkerRing) focusedMapMarkerRing.setPosition(markerEditOriginPosition);
}

function finishMarkerPositionEditSession({ reopenModal = true } = {}) {
    if (!editingMarkerInfo?.marker?.getDraggable?.()) return false;
    const marker = editingMarkerInfo.marker;
    const session = markerPositionEditSession;
    if (session?.dragListener) google.maps.event.removeListener(session.dragListener);
    if (session?.dragendListener) google.maps.event.removeListener(session.dragendListener);
    const restorePosition = session?.originalPosition;
    if (restorePosition) {
        marker.setPosition(restorePosition);
        if (focusedMapMarkerInfo === editingMarkerInfo && focusedMapMarkerRing) focusedMapMarkerRing.setPosition(restorePosition);
        setMarkerEditorCoordinatesText(editingMarkerInfo.type, restorePosition.lat().toFixed(6), restorePosition.lng().toFixed(6));
        if (typeof refreshClientDrops === 'function') refreshClientDrops({ onlyCto: editingMarkerInfo });
    }
    marker.setDraggable(false);
    markerPositionEditSession = null;
    if (reopenModal) showMarkerPanel();
    return true;
}

function cancelMarkerPositionEdit() {
    return finishMarkerPositionEditSession({ reopenModal: true });
}

// ---------------------------------------------------------------
// Ligações do painel
// ---------------------------------------------------------------

function setupMarkerPanel() {
    buildMarkerSizeControl(document.getElementById('markerSizeMount'), { id: 'markerSize', onInput: handleMarkerStyleInput });
    document.querySelectorAll('#markerTypeModal .marker-option').forEach(option => {
        const type = option.getAttribute('data-type');
        const icon = option.querySelector('.marker-type-glyph');
        const kind = option.getAttribute('data-kind');
        if (icon) icon.style.backgroundImage = `url("${getMarkerIconDataUrl(type, getMarkerTypeMeta(type).color, { text: type === 'CASA' ? '12' : '', variant: kind === 'residencial' ? '' : kind })}")`;
        option.addEventListener('click', () => {
            document.getElementById('markerTypeModal').style.display = 'none';
            if (type === 'CLIENTE') {
                resetMarkerModal();
                openClientModal(null, kind || 'residencial');
                return;
            }
            openMarkerCreatePanel(type);
        });
    });
    document.getElementById('closeModal').addEventListener('click', () => {
        const wasAdjusting = !!adjustingKmlMarkerInfo && !editingMarkerInfo;
        resetMarkerModal();
        if (wasAdjusting) adjustingKmlMarkerInfo = null;
    });
    document.getElementById('confirmMarker').addEventListener('click', handleMarkerPanelConfirm);
    document.getElementById('deleteMarkerButton').addEventListener('click', deleteEditingMarker);
    document.getElementById('editPositionButton').addEventListener('click', startMarkerPositionEditSession);
    document.getElementById('copyMarkerCoordsButton').addEventListener('click', () => {
        const text = document.getElementById('infraMarkerCoordinatesText').textContent;
        navigator.clipboard?.writeText(text).then(() => showToast('Copiado', 'Coordenadas copiadas.'));
    });
    ['markerColor', 'markerLabelColor', 'markerName', 'markerNumber'].forEach(id => {
        document.getElementById(id).addEventListener('input', handleMarkerStyleInput);
    });
    document.getElementById('markerStatusSegmented').addEventListener('segmented-change', updateMarkerPanelPreview);
    document.getElementById('ctoStickerCheckbox').addEventListener('change', (e) => { e.target.dataset.userChanged = '1'; });
    document.querySelectorAll('#markerModal .stepper').forEach(stepper => {
        const input = stepper.querySelector('input');
        stepper.querySelectorAll('button[data-step]').forEach(button => {
            button.addEventListener('click', () => {
                const next = Math.max(Number(input.min) || 0, (parseInt(input.value, 10) || 0) + Number(button.dataset.step));
                input.value = next;
            });
        });
    });
}

setupMarkerPanel();
