// Equipamentos do POP: OLTs (com placas e PONs), DGOs e switches. Ficam em markerInfo.popEquipment
// e são salvos com o projeto. As OLTs aparecem como sugestão no "Vincular OLT" dos splitters.
// Depende de script.js e js/marker-panel.js.

let editingPopMarker = null;
let popEquipmentDraft = null;

function emptyPopEquipment() {
    return { olts: [], dgos: [], switches: [] };
}

function normalizePopEquipment(data) {
    const src = data || {};
    const text = (v) => String(v ?? '').trim();
    const int = (v) => Math.max(0, parseInt(v, 10) || 0);
    return {
        olts: (src.olts || []).map(o => ({
            name: text(o.name), model: text(o.model),
            cards: (o.cards || []).map(c => ({ slot: text(c.slot), model: text(c.model), pons: int(c.pons) })),
        })),
        dgos: (src.dgos || []).map(d => ({ name: text(d.name), ports: int(d.ports), connector: text(d.connector) || 'SC/APC' })),
        switches: (src.switches || []).map(s => ({ name: text(s.name), model: text(s.model), ports: int(s.ports), uplinks: int(s.uplinks) })),
    };
}

function summarizePopEquipment(eq) {
    const e = normalizePopEquipment(eq);
    const cards = e.olts.reduce((n, o) => n + o.cards.length, 0);
    const pons = e.olts.reduce((n, o) => n + o.cards.reduce((m, c) => m + c.pons, 0), 0);
    return { olts: e.olts.length, cards, pons, dgos: e.dgos.length, dgoPorts: e.dgos.reduce((n, d) => n + d.ports, 0), switches: e.switches.length };
}

function describePopEquipment(eq) {
    const s = summarizePopEquipment(eq);
    const parts = [];
    if (s.olts) parts.push(`${s.olts} OLT${s.olts > 1 ? 's' : ''} · ${s.cards} placa${s.cards === 1 ? '' : 's'} · ${s.pons} PONs`);
    if (s.dgos) parts.push(`${s.dgos} DGO${s.dgos > 1 ? 's' : ''} (${s.dgoPorts} portas)`);
    if (s.switches) parts.push(`${s.switches} switch${s.switches > 1 ? 'es' : ''}`);
    return parts.join(' · ') || 'Nenhum equipamento cadastrado';
}

//OLTs de todos os POPs do projeto (para o "Vincular OLT" do splitter)
function getProjectPopOlts(folderId) {
    const folderIds = getProjectFolderIdsForItem(folderId) || [];
    const list = [];
    markers.filter(m => m.type === 'POP' && folderIds.includes(m.folderId)).forEach(pop => {
        normalizePopEquipment(pop.popEquipment).olts.forEach(o => { if (o.name) list.push({ ...o, pop: pop.name }); });
    });
    return list;
}

// ---------------------------------------------------------------
// Janela
// ---------------------------------------------------------------

function popField(label, value, attrs) {
    return `<label class="pop-field"><span>${label}</span><input ${attrs} value="${escapeHtml(String(value ?? ''))}"></label>`;
}

function renderPopEquipmentModal() {
    const eq = popEquipmentDraft;
    const ro = !AppSession.canEdit ? 'disabled' : '';
    const del = (kind, i, j) => ro ? '' : `<button type="button" class="pop-del" data-pop-del="${kind}" data-i="${i}"${j != null ? ` data-j="${j}"` : ''} title="Remover" aria-label="Remover">&times;</button>`;
    const olts = eq.olts.map((o, i) => `
        <div class="pop-item">
            <div class="pop-row">${popField('Nome', o.name, `data-pop="olts.${i}.name" placeholder="OLT-01" ${ro}`)}${popField('Modelo', o.model, `data-pop="olts.${i}.model" placeholder="ZTE C600" ${ro}`)}${del('olts', i)}</div>
            <div class="pop-cards">
                ${o.cards.map((c, j) => `<div class="pop-row pop-row--card">${popField('Slot', c.slot, `data-pop="olts.${i}.cards.${j}.slot" placeholder="1" ${ro}`)}${popField('Modelo da placa', c.model, `data-pop="olts.${i}.cards.${j}.model" placeholder="GPON 16 portas" ${ro}`)}${popField('PONs', c.pons, `type="number" min="0" data-pop="olts.${i}.cards.${j}.pons" ${ro}`)}${del('cards', i, j)}</div>`).join('')}
                ${ro ? '' : `<button type="button" class="pop-add pop-add--small" data-pop-add="card" data-i="${i}">+ Placa</button>`}
            </div>
        </div>`).join('');
    const dgos = eq.dgos.map((d, i) => `<div class="pop-item"><div class="pop-row">${popField('Nome', d.name, `data-pop="dgos.${i}.name" placeholder="DGO-01" ${ro}`)}${popField('Portas', d.ports, `type="number" min="0" data-pop="dgos.${i}.ports" ${ro}`)}
        <label class="pop-field"><span>Conector</span><select data-pop="dgos.${i}.connector" ${ro}>${['SC/APC', 'SC/UPC', 'LC/APC', 'LC/UPC'].map(c => `<option${c === d.connector ? ' selected' : ''}>${c}</option>`).join('')}</select></label>${del('dgos', i)}</div></div>`).join('');
    const sws = eq.switches.map((s, i) => `<div class="pop-item"><div class="pop-row">${popField('Nome', s.name, `data-pop="switches.${i}.name" placeholder="SW-01" ${ro}`)}${popField('Modelo', s.model, `data-pop="switches.${i}.model" ${ro}`)}${popField('Portas', s.ports, `type="number" min="0" data-pop="switches.${i}.ports" ${ro}`)}${popField('Uplinks', s.uplinks, `type="number" min="0" data-pop="switches.${i}.uplinks" ${ro}`)}${del('switches', i)}</div></div>`).join('');
    const section = (title, kind, body, empty) => `<section class="pop-section"><header><h3>${title}</h3>${ro ? '' : `<button type="button" class="pop-add" data-pop-add="${kind}">+ Adicionar</button>`}</header>${body || `<p class="pop-empty">${empty}</p>`}</section>`;
    document.getElementById('popEquipmentBody').innerHTML =
        section('OLTs', 'olt', olts, 'Nenhuma OLT. As OLTs cadastradas aparecem no "Vincular OLT" dos splitters.')
        + section('DGOs', 'dgo', dgos, 'Nenhum DGO.')
        + section('Switches', 'switch', sws, 'Nenhum switch.');
    document.getElementById('popEquipmentSummary').textContent = describePopEquipment(eq);
}

function setPopDraftValue(path, value) {
    const keys = path.split('.');
    let target = popEquipmentDraft;
    keys.slice(0, -1).forEach(k => { target = target[k]; });
    target[keys[keys.length - 1]] = value;
}

function openPopEquipmentModal(markerInfo) {
    if (markerInfo?.type !== 'POP') return;
    editingPopMarker = markerInfo;
    popEquipmentDraft = normalizePopEquipment(markerInfo.popEquipment);
    document.getElementById('popEquipmentTitle').textContent = `Equipamentos · ${markerInfo.name}`;
    document.getElementById('savePopEquipment').hidden = !AppSession.canEdit;
    renderPopEquipmentModal();
    document.getElementById('popEquipmentModal').style.display = 'flex';
}

function closePopEquipmentModal() {
    document.getElementById('popEquipmentModal').style.display = 'none';
    editingPopMarker = null;
    popEquipmentDraft = null;
}

function savePopEquipment() {
    if (!editingPopMarker || !requireEdit('alterar os equipamentos do POP')) return;
    editingPopMarker.popEquipment = normalizePopEquipment(popEquipmentDraft);
    const pop = editingPopMarker;
    closePopEquipmentModal();
    if (typeof markProjectDirty === 'function') markProjectDirty();
    if (editingMarkerInfo === pop) updatePopEquipmentPanelSummary(pop);
    //Plano do POP aberto: os cartões acompanham o cadastro
    if (activeMarkerForFusion === pop && typeof syncPopEquipmentCards === 'function') {
        syncPopEquipmentCards({ prune: true });
        markFusionDirty();
        repackAllElements();
        renderFusionSidebar();
    }
    showToast('Equipamentos salvos', `${pop.name}: ${describePopEquipment(pop.popEquipment)}. Salve o projeto para gravar.`);
}

function updatePopEquipmentPanelSummary(markerInfo) {
    const group = document.getElementById('popEquipmentGroup');
    if (!group) return;
    group.classList.toggle('hidden', markerInfo?.type !== 'POP');
    if (markerInfo?.type === 'POP') document.getElementById('popEquipmentPanelSummary').textContent = describePopEquipment(markerInfo.popEquipment);
}

function setupPopEquipmentModal() {
    const modal = document.getElementById('popEquipmentModal');
    if (!modal) return;
    document.getElementById('closePopEquipmentModal').addEventListener('click', closePopEquipmentModal);
    document.getElementById('cancelPopEquipment').addEventListener('click', closePopEquipmentModal);
    document.getElementById('savePopEquipment').addEventListener('click', savePopEquipment);
    document.getElementById('openPopEquipmentButton')?.addEventListener('click', () => openPopEquipmentModal(editingMarkerInfo));
    modal.addEventListener('input', (e) => {
        const path = e.target.dataset?.pop;
        if (!path || !popEquipmentDraft) return;
        setPopDraftValue(path, e.target.type === 'number' ? Math.max(0, parseInt(e.target.value, 10) || 0) : e.target.value);
        document.getElementById('popEquipmentSummary').textContent = describePopEquipment(popEquipmentDraft);
    });
    modal.addEventListener('change', (e) => {
        if (e.target.tagName === 'SELECT' && e.target.dataset.pop) setPopDraftValue(e.target.dataset.pop, e.target.value);
    });
    modal.addEventListener('click', (e) => {
        const add = e.target.closest('[data-pop-add]');
        const del = e.target.closest('[data-pop-del]');
        if (!popEquipmentDraft || (!add && !del)) return;
        const eq = popEquipmentDraft;
        if (add) {
            const kind = add.dataset.popAdd;
            if (kind === 'olt') eq.olts.push({ name: `OLT-${String(eq.olts.length + 1).padStart(2, '0')}`, model: '', cards: [{ slot: '1', model: '', pons: 16 }] });
            if (kind === 'card') { const o = eq.olts[Number(add.dataset.i)]; o.cards.push({ slot: String(o.cards.length + 1), model: o.cards.at(-1)?.model || '', pons: o.cards.at(-1)?.pons || 16 }); }
            if (kind === 'dgo') eq.dgos.push({ name: `DGO-${String(eq.dgos.length + 1).padStart(2, '0')}`, ports: 24, connector: 'SC/APC' });
            if (kind === 'switch') eq.switches.push({ name: `SW-${String(eq.switches.length + 1).padStart(2, '0')}`, model: '', ports: 24, uplinks: 4 });
        } else {
            const i = Number(del.dataset.i);
            if (del.dataset.popDel === 'cards') eq.olts[i].cards.splice(Number(del.dataset.j), 1);
            else eq[del.dataset.popDel].splice(i, 1);
        }
        renderPopEquipmentModal();
    });
}

document.addEventListener('DOMContentLoaded', setupPopEquipmentModal);
