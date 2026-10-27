// Editar selecionados: com vários marcadores e cabos selecionados no mapa, escolhe o tipo (CTO, CEO, cabo…)
// e muda de uma vez a situação e as configurações daquele tipo. Campo em "Manter" não mexe nos itens.
// Depende de js/map/map-selection.js (mapSelection), js/app.js e js/map/marker-panel.js.

const BULK_CABLE_TYPE = 'CABO';
const BULK_YES_NO = [['sim', 'Sim'], ['nao', 'Não']];
const BULK_FIBERS = ['FO-06', 'FO-12', 'FO-24', 'FO-36', 'FO-48', 'FO-72', 'FO-144', 'DROP'];
const isRedeModeNow = () => typeof appMode !== 'undefined' && appMode === 'rede';

//Campos de cada tipo. options = botões ("Manter" vem antes); input = cor ou número (com "Alterar")
const BULK_FIELDS = {
    boxStatus: { label: 'Situação', options: [['Nova', 'Nova'], ['Existente', 'Existente'], ['Troca', 'Troca']], status: true,
        apply: (m, v) => applyMarkerInfrastructureStatus(m, v) },
    status: { label: 'Situação', options: [['Nova', 'Nova'], ['Existente', 'Existente']], status: true,
        apply: (m, v) => applyMarkerInfrastructureStatus(m, v) },
    predial: { label: 'CTO predial', options: BULK_YES_NO, apply: (m, v) => { m.isPredial = v === 'sim'; } },
    stickers: { label: 'Adesivos', options: BULK_YES_NO, apply: (m, v) => { m.needsStickers = v === 'sim'; } },
    is144F: { label: 'CEO de 144 fusões', options: BULK_YES_NO, apply: (m, v) => { m.is144F = v === 'sim'; } },
    ceoAccessory: { label: 'Acessório', options: [['Raquete', 'Raquete'], ['Suporte', 'Suporte']], apply: (m, v) => { m.ceoAccessory = v; } },
    reservaAccessory: { label: 'Acessório', options: [['Raquete', 'Raquete'], ['Suporte', 'Suporte']], apply: (m, v) => { m.reservaAccessory = v; } },
    derivationT: { label: 'Derivações em T', input: 'number', min: 0, max: 20, apply: (m, v) => { m.derivationTCount = Math.max(0, parseInt(v, 10) || 0); } },
    poleSituation: { label: 'Situação do poste', options: ['Existente', 'Novo', 'Substituir', 'Remover'].map(s => [s, s]), status: true,
        apply: (m, v) => { m.pole = { ...(m.pole || {}), situation: v }; } },
    poleMaterial: { label: 'Material', options: ['Concreto', 'Madeira', 'Metálico', 'Fibra'].map(s => [s, s]),
        apply: (m, v) => { m.pole = { ...(m.pole || {}), material: v }; } },
    color: { label: 'Cor do marcador', input: 'color', apply: (m, v) => { m.color = v; } },
    labelColor: { label: 'Cor do nome', input: 'color', apply: (m, v) => { m.labelColor = v; } },
    //Cabos
    cableStatus: { label: 'Situação', options: [['Novo', 'Novo'], ['Existente', 'Existente']], status: true,
        apply: (c, v) => { c.status = v; c.width = getDefaultCableWidthForStatus(v); } },
    fiber: { label: 'Tipo de fibra', options: BULK_FIBERS.map(f => [f, f === 'DROP' ? 'Drop' : f.replace('FO-', '')]), apply: (c, v, report) => setBulkCableFiber(c, v, report) },
    span: { label: 'Vão', options: [['AS 80', 'AS 80'], ['AS 200', 'AS 200']], apply: (c, v) => {
        const fiber = getFiberType(c.type);
        if (fiber && fiber !== 'DROP') c.type = buildCableTypeString(v, fiber);
    } },
    width: { label: 'Espessura (px)', input: 'number', min: 1, max: 12, apply: (c, v) => { c.width = Math.min(12, Math.max(1, parseInt(v, 10) || 4)); } },
    cableColor: { label: 'Cor da linha', input: 'color', apply: (c, v) => { c.color = v; } },
};

const BULK_TYPES = [
    { key: 'CTO', label: 'CTO', fields: ['boxStatus', 'predial', 'stickers', 'color', 'labelColor'] },
    { key: 'CEO', label: 'CEO', fields: ['boxStatus', 'is144F', 'ceoAccessory', 'color', 'labelColor'] },
    { key: 'RESERVA', label: 'Reserva técnica', fields: ['status', 'reservaAccessory', 'color', 'labelColor'] },
    { key: 'CORDOALHA', label: 'Cordoalha', fields: ['status', 'derivationT', 'color', 'labelColor'] },
    { key: 'POP', label: 'POP', fields: ['color', 'labelColor'] },
    { key: 'TORRE', label: 'Torre', fields: ['color', 'labelColor'] },
    { key: 'POSTE', label: 'Poste', fields: ['poleSituation', 'poleMaterial', 'color', 'labelColor'] },
    { key: 'Importado', label: 'Marcador importado', fields: ['status', 'color', 'labelColor'] },
    { key: BULK_CABLE_TYPE, label: 'Cabos', fields: ['cableStatus', 'fiber', 'span', 'width', 'cableColor'] },
];

const bulkEdit = { type: null, items: [] };

function getBulkItemsOfType(type, items = [...mapSelection.items]) {
    if (type === BULK_CABLE_TYPE) return items.filter(i => selectionKind(i) === 'cable');
    return items.filter(i => selectionKind(i) === 'marker' && i.type === type);
}

function getBulkTypesPresent(items = [...mapSelection.items]) {
    return BULK_TYPES.map(t => ({ ...t, count: getBulkItemsOfType(t.key, items).length })).filter(t => t.count);
}

//Troca o tipo de fibra; cabo com fusões fica como está (igual ao editor do cabo). Nome automático acompanha.
function setBulkCableFiber(cable, fiber, report) {
    const old = getFiberType(cable.type);
    if (!old || old === fiber) return;
    if (checkCableUsageInFusionPlans(cable).hasFusions) { report.blocked.push(cable.name); return; }
    const span = (cable.type.match(/AS\s*\d+/i)?.[0] || 'AS 80').replace(/AS\s*/i, 'AS ');
    cable.type = buildCableTypeString(span, fiber);
    cable.color = getCableColor(fiber);
    const match = AUTO_CABLE_NAME_RE.exec(cable.name || '');
    if (match && match[1].endsWith(old)) {
        const oldName = cable.name;
        cable.name = `${match[1].slice(0, -old.length)}${fiber}${cable.name.slice(match[1].length)}`;
        updateCableNameInAllFusionPlans(oldName, cable.name, cable);
    }
}

function ensureBulkEditModal() {
    let modal = document.getElementById('bulkEditModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'bulkEditModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content bulk-edit-modal" role="dialog" aria-labelledby="bulkEditTitle">
            <div class="modal-header-v2 rm-head rm-head--proj">
                <span class="rm-head__icon"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-edit"></use></svg></span>
                <div class="rm-head__text">
                    <h2 id="bulkEditTitle">Editar selecionados</h2>
                    <p class="rm-head__sub">Escolha o tipo e o que mudar; o que ficar em "Manter" não muda</p>
                </div>
            </div>
            <div class="modal-body-content rm-steps">
                <section class="rm-step">
                    <header class="rm-step__head"><span class="rm-step__n"></span><span>Tipo</span></header>
                    <div class="bulk-edit-types" id="bulkEditTypes" role="radiogroup" aria-label="Tipo"></div>
                </section>
                <section class="rm-step">
                    <header class="rm-step__head"><span class="rm-step__n"></span><span>O que mudar</span></header>
                    <div class="bulk-edit-fields" id="bulkEditFields"></div>
                </section>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bulk="cancel">Cancelar</button>
                <button type="button" class="btn btn-success" data-bulk="apply" id="bulkEditApply">Aplicar</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        const typeButton = e.target.closest('[data-bulk-type]');
        if (typeButton) { renderBulkEditFields(typeButton.dataset.bulkType); return; }
        const option = e.target.closest('[data-bulk-value]');
        if (option) {
            option.parentElement.querySelectorAll('[data-bulk-value]').forEach(b => {
                b.classList.toggle('is-active', b === option);
                b.setAttribute('aria-checked', b === option ? 'true' : 'false');
            });
            syncBulkEditApply();
            return;
        }
        const action = e.target.closest('[data-bulk]')?.dataset.bulk;
        if (e.target === modal || action === 'cancel') closeBulkEditModal();
        if (action === 'apply') applyBulkEdit();
    });
    modal.addEventListener('change', (e) => {
        const row = e.target.closest('[data-bulk-field]');
        if (!row) return;
        if (e.target.matches('.bulk-edit-input')) row.querySelector('.bulk-edit-toggle').checked = true;
        syncBulkEditApply();
    });
    modal.addEventListener('input', (e) => {
        const row = e.target.closest('[data-bulk-field]');
        if (row && e.target.matches('.bulk-edit-input')) { row.querySelector('.bulk-edit-toggle').checked = true; syncBulkEditApply(); }
    });
    return modal;
}

function openBulkEditModal() {
    if (!requireEdit('editar os selecionados')) return;
    const types = getBulkTypesPresent();
    if (!types.length) {
        showToast('Nada para editar', 'Selecione caixas, postes ou cabos (Shift + arrastar no mapa).', 'progress');
        return;
    }
    const modal = ensureBulkEditModal();
    bulkEdit.items = [...mapSelection.items];
    document.getElementById('bulkEditTypes').innerHTML = types.map(t =>
        `<button type="button" class="btn-seg" role="radio" data-bulk-type="${t.key}">${escapeHtml(t.label)} <small>${t.count}</small></button>`).join('');
    renderBulkEditFields(types.some(t => t.key === bulkEdit.type) ? bulkEdit.type : types[0].key);
    modal.style.display = 'flex';
}

function closeBulkEditModal() {
    const modal = document.getElementById('bulkEditModal');
    if (modal) modal.style.display = 'none';
}

//Valor atual comum a todos os itens (para mostrar ao lado do campo) ou "vários"
function describeBulkCurrent(items, fieldKey) {
    const read = {
        boxStatus: getMarkerInfrastructureStatus, status: getMarkerInfrastructureStatus,
        predial: m => (m.isPredial ? 'Sim' : 'Não'), stickers: m => (m.needsStickers ? 'Sim' : 'Não'), is144F: m => (m.is144F ? 'Sim' : 'Não'),
        ceoAccessory: m => m.ceoAccessory, reservaAccessory: m => m.reservaAccessory, derivationT: m => String(m.derivationTCount || 0),
        poleSituation: m => m.pole?.situation, poleMaterial: m => m.pole?.material,
        cableStatus: c => c.status || 'Novo', fiber: c => getFiberType(c.type), span: c => c.type?.match(/AS\s*\d+/i)?.[0], width: c => String(c.width || ''),
    }[fieldKey];
    if (!read) return '';
    const values = [...new Set(items.map(i => read(i) || '—'))];
    return values.length === 1 ? `hoje: ${values[0] === 'DROP' ? 'Drop' : values[0]}` : 'hoje: vários';
}

function renderBulkEditFields(typeKey) {
    const type = BULK_TYPES.find(t => t.key === typeKey);
    if (!type) return;
    bulkEdit.type = typeKey;
    document.querySelectorAll('#bulkEditTypes [data-bulk-type]').forEach(b => {
        const on = b.dataset.bulkType === typeKey;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    const items = getBulkItemsOfType(typeKey, bulkEdit.items);
    //Modo Rede: tudo é Existente, a situação não aparece
    const fields = type.fields.filter(k => !(isRedeModeNow() && BULK_FIELDS[k].status));
    const sample = items[0] || {};
    document.getElementById('bulkEditFields').innerHTML = fields.map(key => {
        const f = BULK_FIELDS[key];
        const current = describeBulkCurrent(items, key);
        const head = `<span class="bulk-edit-field__label">${escapeHtml(f.label)}${current ? ` <small>${escapeHtml(current)}</small>` : ''}</span>`;
        if (f.input) {
            const value = f.input === 'color'
                ? (/^#[0-9a-f]{6}$/i.test(sample[key === 'cableColor' ? 'color' : key] || '') ? sample[key === 'cableColor' ? 'color' : key] : '#16a34a')
                : (key === 'width' ? sample.width || 4 : sample.derivationTCount || 0);
            return `<div class="bulk-edit-field" data-bulk-field="${key}">${head}
                <label class="bulk-edit-alter"><input type="checkbox" class="bulk-edit-toggle" /> Alterar</label>
                <input class="bulk-edit-input" type="${f.input}" value="${escapeHtml(String(value))}"${f.input === 'number' ? ` min="${f.min}" max="${f.max}" step="1"` : ''} /></div>`;
        }
        const buttons = [['', 'Manter'], ...f.options].map(([v, label]) =>
            `<button type="button" class="btn-seg${v === '' ? ' is-active' : ''}" role="radio" aria-checked="${v === '' ? 'true' : 'false'}" data-bulk-value="${escapeHtml(v)}">${escapeHtml(label)}</button>`).join('');
        return `<div class="bulk-edit-field" data-bulk-field="${key}">${head}<div class="bulk-edit-seg" role="radiogroup" aria-label="${escapeHtml(f.label)}">${buttons}</div></div>`;
    }).join('') || '<p class="bulk-edit-empty">Nada para mudar neste tipo.</p>';
    syncBulkEditApply();
}

function readBulkEditChanges() {
    const changes = [];
    document.querySelectorAll('#bulkEditFields [data-bulk-field]').forEach(row => {
        const key = row.dataset.bulkField;
        const toggle = row.querySelector('.bulk-edit-toggle');
        if (toggle) { if (toggle.checked) changes.push([key, row.querySelector('.bulk-edit-input').value]); return; }
        const value = row.querySelector('[data-bulk-value].is-active')?.dataset.bulkValue;
        if (value) changes.push([key, value]);
    });
    return changes;
}

function syncBulkEditApply() {
    const button = document.getElementById('bulkEditApply');
    if (!button) return;
    const count = getBulkItemsOfType(bulkEdit.type, bulkEdit.items).length;
    const label = BULK_TYPES.find(t => t.key === bulkEdit.type)?.label || '';
    button.disabled = !readBulkEditChanges().length;
    button.textContent = `Aplicar em ${count} ${bulkEdit.type === BULK_CABLE_TYPE ? (count === 1 ? 'cabo' : 'cabos') : label}`;
}

//Aplica as mudanças nos itens do tipo escolhido. Situação vem primeiro (CTO nova liga os adesivos; depois o campo Adesivos manda)
function applyBulkEdit(changes = readBulkEditChanges(), typeKey = bulkEdit.type, items = getBulkItemsOfType(typeKey, bulkEdit.items.length ? bulkEdit.items : [...mapSelection.items])) {
    if (!changes.length || !items.length || !requireEdit('editar os selecionados')) return null;
    const report = { blocked: [] };
    const ordered = [...changes].sort(([a], [b]) => (BULK_FIELDS[b].status ? 1 : 0) - (BULK_FIELDS[a].status ? 1 : 0));
    const isCable = typeKey === BULK_CABLE_TYPE;
    items.forEach(item => {
        ordered.forEach(([key, value]) => BULK_FIELDS[key].apply(item, value, report));
        if (isCable) {
            item.polyline?.setOptions({ strokeColor: item.color || getCableColor(getFiberType(item.type)), strokeWeight: item.width });
            updateCableSidebarLabel(item);
            if (typeof applyCableSidebarColorStyles === 'function') applyCableSidebarColorStyles(item);
        } else {
            updateMarkerAppearance(item);
        }
    });
    refreshBomAfterProjectChange();
    if (isCable) refreshClientDrops({ recompute: true });
    setMapSelection([...mapSelection.items]); //Refaz o destaque (espessura nova)
    closeBulkEditModal();
    const label = isCable ? `${items.length} cabo(s)` : `${items.length} ${BULK_TYPES.find(t => t.key === typeKey)?.label || 'marcador(es)'}`;
    const what = changes.map(([key, value]) => {
        const f = BULK_FIELDS[key];
        const option = f.options?.find(([v]) => v === value);
        return f.input === 'color' ? f.label.toLowerCase() : `${f.label.toLowerCase()}: ${option ? option[1] : value}`;
    }).join(', ');
    const blocked = report.blocked.length ? ` Tipo de fibra mantido (têm fusões): ${report.blocked.join(', ')}.` : '';
    showToast('Selecionados alterados', `${label} · ${what}.${blocked}`);
    return report;
}
