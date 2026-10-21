// Ocorrências de manutenção na rede (modo Rede): rompimento, sinal baixo, caixa danificada… em uma caixa ou num cabo, com
// situação (aberta, em andamento, resolvida), anotações de quem atendeu e o histórico. Ficam no JSON da rede (data.occurrences),
// aparecem como anel no mapa, no painel da caixa e na aba "Ocorrências" do painel da rede.
// Depende de js/app.js, js/projects/network-mode.js e js/network/network-docs.js.

const OCCURRENCE_KINDS = [
    { id: 'rompimento', label: 'Rompimento de fibra', color: '#dc2626' },
    { id: 'sinal', label: 'Sinal baixo / atenuação', color: '#d97706' },
    { id: 'danificada', label: 'Caixa ou cabo danificado', color: '#dc2626' },
    { id: 'poste', label: 'Poste ou fixação', color: '#d97706' },
    { id: 'vandalismo', label: 'Vandalismo ou furto', color: '#dc2626' },
    { id: 'preventiva', label: 'Manutenção preventiva', color: '#2563eb' },
    { id: 'outro', label: 'Outro', color: '#64748b' },
];
const OCCURRENCE_STATUSES = [
    { id: 'aberta', label: 'Aberta' },
    { id: 'andamento', label: 'Em andamento' },
    { id: 'resolvida', label: 'Resolvida' },
];
const occurrences = { overlays: [], editing: null, rootId: '', filter: 'abertas', timer: null };

const getOccurrenceKind = (id) => OCCURRENCE_KINDS.find(k => k.id === id) || OCCURRENCE_KINDS[OCCURRENCE_KINDS.length - 1];
const getOccurrenceStatus = (id) => OCCURRENCE_STATUSES.find(s => s.id === id) || OCCURRENCE_STATUSES[0];
const isOccurrenceOpen = (o) => o.status !== 'resolvida';
const getNetworkOccurrences = (projectId) => networkDocs.occurrences.get(projectId) || [];

function findOccurrenceItem(o) {
    return o.itemKind === 'c' ? savedCables.find(c => c.uid === o.uid) || null : markers.find(m => m.uid === o.uid) || null;
}

function getItemOccurrences(item) {
    const root = getNetworkRootOf(item);
    if (!root || !item?.uid) return [];
    return getNetworkOccurrences(getRootId(root)).filter(o => o.uid === item.uid);
}

//Itens da cidade em que se registra ocorrência: caixas e cabos
function getOccurrenceTargets(root) {
    const scope = getNetworkScope(root);
    const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', { numeric: true });
    return [
        ...scope.markers.filter(m => FIELD_BOX_TYPES.includes(m.type)).sort(byName).map(m => ({ item: m, kind: 'm', type: m.type })),
        ...scope.cables.sort(byName).map(c => ({ item: c, kind: 'c', type: 'CABO' })),
    ];
}

//Outra pessoa pode ter registrado ocorrências depois que a rede foi aberta aqui: junta pelo id (vale a mais recente)
function mergeNetworkOccurrences(projectId, saved) {
    const byId = new Map(getNetworkOccurrences(projectId).map(o => [o.id, o]));
    (saved || []).forEach(o => {
        const mine = byId.get(o.id);
        if (!mine || String(o.updatedAt || '') > String(mine.updatedAt || '')) byId.set(o.id, o);
    });
    networkDocs.occurrences.set(projectId, [...byId.values()].sort((a, b) => String(a.openedAt).localeCompare(String(b.openedAt))));
}

async function saveOccurrenceChange(root) {
    const projectId = getRootId(root);
    try {
        const { data } = await supabaseClient.from('projects').select('data').eq('id', projectId).maybeSingle();
        if (data?.data?.occurrences) mergeNetworkOccurrences(projectId, data.data.occurrences);
    } catch (e) { /* sem rede agora: salva o que tem */ }
    const saved = await saveNetworkRoot(root);
    refreshOccurrenceOverlays();
    if (networkDocs.panelRootId === projectId) renderNetworkPanel();
    return saved;
}

// ---------------------------------------------------------------
// Janela da ocorrência
// ---------------------------------------------------------------

function ensureOccurrenceModal() {
    let modal = document.getElementById('occurrenceModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'occurrenceModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content occurrence-modal" role="dialog" aria-labelledby="occurrenceTitle">
            <h2 id="occurrenceTitle">Nova ocorrência</h2>
            <div class="modal-body-content">
                <label class="occurrence-modal__label" for="occurrenceItem">Onde</label>
                <select id="occurrenceItem"></select>
                <label class="occurrence-modal__label" for="occurrenceKind">Tipo</label>
                <select id="occurrenceKind">${OCCURRENCE_KINDS.map(k => `<option value="${k.id}">${k.label}</option>`).join('')}</select>
                <span class="occurrence-modal__label">Situação</span>
                <div class="occurrence-status" id="occurrenceStatus" role="radiogroup">${OCCURRENCE_STATUSES.map(s => `<button type="button" role="radio" data-status="${s.id}">${s.label}</button>`).join('')}</div>
                <label class="occurrence-modal__label" for="occurrenceText" id="occurrenceTextLabel">O que aconteceu</label>
                <textarea id="occurrenceText" rows="3" placeholder="Ex.: cabo rompido no poste em frente ao nº 120, 3 clientes sem sinal"></textarea>
                <div id="occurrenceExtra"></div>
                <ol class="occurrence-history" id="occurrenceHistory"></ol>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-occ="cancel">Cancelar</button>
                <button type="button" class="btn btn-success" data-occ="save">Registrar</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        const status = e.target.closest('[data-status]');
        if (status) { setOccurrenceStatusUi(status.dataset.status); return; }
        const action = e.target.closest('[data-occ]')?.dataset.occ;
        if (e.target === modal || action === 'cancel') closeOccurrenceModal();
        if (action === 'save') saveOccurrenceFromModal();
    });
    return modal;
}

function setOccurrenceStatusUi(statusId) {
    document.querySelectorAll('#occurrenceStatus [data-status]').forEach(b => {
        const on = b.dataset.status === statusId;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
}

const getOccurrenceStatusUi = () => document.querySelector('#occurrenceStatus [data-status].is-active')?.dataset.status || 'aberta';

//item: caixa/cabo já escolhido (painel da caixa); occurrence: ocorrência existente (atualizar)
async function openOccurrenceModal({ item = null, occurrence = null, root = null } = {}) {
    if (!requireDocument('registrar ocorrências')) return;
    root = root || (item ? getNetworkRootOf(item) : null) || (occurrence ? null : await ensureActiveNetworkCity('registrar a ocorrência'));
    if (occurrence && !root) root = getNetworkRoots().find(r => getNetworkOccurrences(getRootId(r)).includes(occurrence)) || null;
    if (!root) return;
    occurrences.rootId = getRootId(root);
    occurrences.editing = occurrence;
    const modal = ensureOccurrenceModal();
    const esc = (v) => escapeHtml(String(v ?? ''));
    const targets = getOccurrenceTargets(root);
    const select = modal.querySelector('#occurrenceItem');
    const selectedUid = occurrence?.uid || item?.uid || '';
    const group = (kind, label) => {
        const list = targets.filter(t => t.kind === kind);
        return list.length ? `<optgroup label="${label}">${list.map(t => `<option value="${esc(t.kind)}:${esc(t.item.uid)}"${t.item.uid === selectedUid ? ' selected' : ''}>${esc(t.item.name)}${t.kind === 'm' ? ` (${esc(t.type)})` : ''}</option>`).join('')}</optgroup>` : '';
    };
    select.innerHTML = `${selectedUid ? '' : '<option value="">Escolha a caixa ou o cabo…</option>'}${group('m', 'Caixas')}${group('c', 'Cabos')}`;
    select.disabled = !!occurrence;
    modal.querySelector('#occurrenceKind').value = occurrence?.kind || 'rompimento';
    modal.querySelector('#occurrenceKind').disabled = !!occurrence;
    setOccurrenceStatusUi(occurrence?.status || 'aberta');
    modal.querySelector('#occurrenceText').value = '';
    modal.querySelector('#occurrenceTextLabel').textContent = occurrence ? 'Anotação (o que foi feito)' : 'O que aconteceu';
    modal.querySelector('#occurrenceTitle').textContent = occurrence ? `${getOccurrenceKind(occurrence.kind).label} · ${occurrence.itemName}` : 'Nova ocorrência';
    modal.querySelector('[data-occ="save"]').textContent = occurrence ? 'Salvar' : 'Registrar';
    modal.querySelector('#occurrenceHistory').innerHTML = occurrence ? [
        { at: occurrence.openedAt, by: occurrence.openedBy, status: 'aberta', text: occurrence.text, first: true },
        ...(occurrence.updates || []),
    ].reverse().map(u => `<li><small>${esc(formatDocDate(u.at))} · ${esc(u.by || '')}${u.first ? ' · abriu' : u.status ? ` · ${esc(getOccurrenceStatus(u.status).label)}` : ''}</small>${u.text ? `<span>${esc(u.text)}</span>` : ''}</li>`).join('') : '';
    if (typeof renderOccurrencePhotos === 'function') renderOccurrencePhotos(modal.querySelector('#occurrenceExtra'), occurrence, root);
    modal.style.display = 'flex';
    setTimeout(() => modal.querySelector(occurrence ? '#occurrenceText' : (selectedUid ? '#occurrenceKind' : '#occurrenceItem'))?.focus(), 50);
}

function closeOccurrenceModal() {
    const modal = document.getElementById('occurrenceModal');
    if (modal) modal.style.display = 'none';
    occurrences.editing = null;
}

function describeOccurrenceTarget(kind, item) {
    return kind === 'c' ? `no cabo ${item.name}` : `na ${item.type} ${item.name}`;
}

async function saveOccurrenceFromModal() {
    const root = document.getElementById(occurrences.rootId)?.closest('.folder');
    if (!root) { closeOccurrenceModal(); return; }
    const modal = ensureOccurrenceModal();
    const text = modal.querySelector('#occurrenceText').value.trim();
    const status = getOccurrenceStatusUi();
    const at = new Date().toISOString();
    const by = networkWho();
    const projectId = occurrences.rootId;
    const list = [...getNetworkOccurrences(projectId)];
    let entry;
    if (occurrences.editing) {
        const o = occurrences.editing;
        if (!text && status === o.status) { closeOccurrenceModal(); return; }
        const updated = { ...o, status, updatedAt: at, updates: [...(o.updates || []), { at, by, status: status !== o.status ? status : null, text }] };
        if (status === 'resolvida' && o.status !== 'resolvida') { updated.resolvedAt = at; updated.resolvedBy = by; }
        if (status !== 'resolvida') { delete updated.resolvedAt; delete updated.resolvedBy; }
        list[list.indexOf(o)] = updated;
        const verb = status !== o.status ? (status === 'resolvida' ? 'resolveu' : status === 'andamento' ? 'começou a atender' : 'reabriu') : 'anotou na';
        entry = { uid: o.uid, type: o.itemType, name: o.itemName, detail: `${verb} ocorrência "${getOccurrenceKind(o.kind).label}" ${o.itemKind === 'c' ? `no cabo ${o.itemName}` : `na ${o.itemType} ${o.itemName}`}` };
        occurrences.lastSaved = updated;
    } else {
        const [kind, uid] = modal.querySelector('#occurrenceItem').value.split(':');
        const item = kind === 'c' ? savedCables.find(c => c.uid === uid) : markers.find(m => m.uid === uid);
        if (!item) { showToast('Escolha onde', 'Escolha a caixa ou o cabo da ocorrência.', 'progress'); return; }
        const kindId = modal.querySelector('#occurrenceKind').value;
        const o = {
            id: `oc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            uid, itemKind: kind, itemType: kind === 'c' ? 'CABO' : item.type, itemName: item.name,
            kind: kindId, status, text, openedAt: at, openedBy: by, updatedAt: at, updates: [],
        };
        if (status === 'resolvida') { o.resolvedAt = at; o.resolvedBy = by; }
        list.push(o);
        entry = { uid, type: o.itemType, name: item.name, detail: `abriu ocorrência "${getOccurrenceKind(kindId).label}" ${describeOccurrenceTarget(kind, item)}` };
        occurrences.lastSaved = o;
    }
    networkDocs.occurrences.set(projectId, list);
    markNetworkBulkChange(projectId, { action: 'ocorrencia', ...entry }, []);
    closeOccurrenceModal();
    const saved = await saveOccurrenceChange(root);
    if (saved) showToast('Ocorrência salva', entry.detail.charAt(0).toUpperCase() + entry.detail.slice(1));
    if (saved && typeof flushOccurrencePhotos === 'function') await flushOccurrencePhotos(occurrences.lastSaved);
    if (typeof editingMarkerInfo !== 'undefined' && editingMarkerInfo && typeof renderMarkerDocPanel === 'function') renderMarkerDocPanel(editingMarkerInfo);
}

// ---------------------------------------------------------------
// Painel da caixa, painel da rede e mapa
// ---------------------------------------------------------------

function formatOccurrenceAge(iso) {
    return typeof formatRelativeDate === 'function' ? formatRelativeDate(iso) : formatDocDate(iso);
}

function renderOccurrenceRow(o, i, dataAttr) {
    const esc = (v) => escapeHtml(String(v ?? ''));
    const kind = getOccurrenceKind(o.kind);
    const status = getOccurrenceStatus(o.status);
    return `<button type="button" class="occurrence-row is-${esc(o.status)}" ${dataAttr}="${i}" style="--occ:${kind.color}">
        <span><b>${esc(kind.label)}</b><small>${esc(o.itemName)} · ${esc(formatOccurrenceAge(o.openedAt))}${o.text ? ` · ${esc(o.text)}` : ''}</small></span>
        <em>${esc(status.label)}</em>
    </button>`;
}

//Parte do painel da caixa (js/network/network-docs.js → renderMarkerDocPanel)
function renderItemOccurrencesHtml(item) {
    const list = getItemOccurrences(item);
    const open = list.filter(isOccurrenceOpen).reverse();
    const closed = list.length - open.length;
    occurrences.docList = open;
    return `<div class="marker-doc__occ">
        <header><span>Ocorrências</span>${AppSession.canDocument ? '<button type="button" class="btn-link" data-occ-doc="new">+ Nova</button>' : ''}</header>
        ${open.length ? open.slice(0, 3).map((o, i) => renderOccurrenceRow(o, i, 'data-occ-doc-i')).join('') : '<small class="marker-doc__occ-empty">Nenhuma aberta.</small>'}
        ${closed ? `<small class="marker-doc__occ-empty">${closed} resolvida${closed === 1 ? '' : 's'} (veja no painel da rede)</small>` : ''}
    </div>`;
}

function handleDocOccurrenceClick(e) {
    const box = typeof editingMarkerInfo !== 'undefined' ? editingMarkerInfo : null;
    if (!box) return;
    if (e.target.closest('[data-occ-doc="new"]')) { openOccurrenceModal({ item: box }); return; }
    const row = e.target.closest('[data-occ-doc-i]');
    if (row) openOccurrenceModal({ occurrence: occurrences.docList?.[Number(row.dataset.occDocI)] });
}

//Aba "Ocorrências" do painel da rede
function renderOccurrencesTabHtml(root) {
    const all = getNetworkOccurrences(getRootId(root));
    const open = all.filter(isOccurrenceOpen);
    const list = (occurrences.filter === 'abertas' ? open : all.filter(o => !isOccurrenceOpen(o))).slice().reverse();
    occurrences.tabList = list;
    return `<div class="map-tool-segmented occurrence-filter">
            <button type="button" data-net-panel="occ-filter" data-filter="abertas" class="${occurrences.filter === 'abertas' ? 'is-active' : ''}">Abertas (${open.length})</button>
            <button type="button" data-net-panel="occ-filter" data-filter="resolvidas" class="${occurrences.filter !== 'abertas' ? 'is-active' : ''}">Resolvidas (${all.length - open.length})</button>
        </div>
        ${list.length ? `<div class="occurrence-list">${list.slice(0, 100).map((o, i) => renderOccurrenceRow(o, i, 'data-net-panel="occ" data-i')).join('')}</div>`
            : `<p class="map-tool-help">${occurrences.filter === 'abertas' ? 'Nenhuma ocorrência aberta nesta cidade.' : 'Nenhuma ocorrência resolvida ainda.'}</p>`}
        ${AppSession.canDocument ? '<button type="button" class="map-tool-btn" data-net-panel="occ-new">+ Nova ocorrência</button>' : ''}`;
}

function handleOccurrencePanelClick(el) {
    const kind = el.dataset.netPanel;
    if (kind === 'occ-filter') { occurrences.filter = el.dataset.filter; renderNetworkPanel(); return; }
    if (kind === 'occ-new') { openOccurrenceModal({ root: document.getElementById(networkDocs.panelRootId)?.closest('.folder') }); return; }
    if (kind === 'occ') {
        const o = occurrences.tabList?.[Number(el.dataset.i)];
        if (!o) return;
        const item = findOccurrenceItem(o);
        if (item) focusNetworkItem(item);
        if (AppSession.canDocument) openOccurrenceModal({ occurrence: o, root: document.getElementById(networkDocs.panelRootId)?.closest('.folder') });
    }
}

function clearOccurrenceOverlays() {
    occurrences.overlays.forEach(o => o.setMap(null));
    occurrences.overlays = [];
}

//Anel nas caixas e traço por cima dos cabos com ocorrência aberta (só no modo Rede e com o item visível)
function refreshOccurrenceOverlays() {
    clearOccurrenceOverlays();
    if (typeof map === 'undefined' || !map || appMode !== 'rede') return;
    getNetworkRoots().forEach(root => {
        getNetworkOccurrences(getRootId(root)).filter(isOccurrenceOpen).forEach(o => {
            const item = findOccurrenceItem(o);
            const color = getOccurrenceKind(o.kind).color;
            if (o.itemKind === 'c') {
                if (!item?.polyline || item.polyline.getVisible?.() === false || !item.path?.length) return;
                occurrences.overlays.push(new google.maps.Polyline({
                    map, path: item.path, clickable: false, zIndex: 40, strokeOpacity: 0,
                    icons: [{ icon: { path: 'M 0,-1 0,1', strokeColor: color, strokeOpacity: 0.9, scale: 4 }, offset: '0', repeat: '12px' }],
                }));
                return;
            }
            const pos = item?.marker?.getPosition?.();
            if (!pos || item.marker.getVisible?.() === false) return;
            occurrences.overlays.push(new google.maps.Marker({
                map, position: pos, clickable: false, optimized: false, zIndex: 3,
                title: `Ocorrência: ${getOccurrenceKind(o.kind).label}`,
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 17, fillColor: color, fillOpacity: 0.14, strokeColor: color, strokeOpacity: 0.95, strokeWeight: 3 },
            }));
        });
    });
}

function scheduleOccurrenceOverlays(delay = 120) {
    clearTimeout(occurrences.timer);
    occurrences.timer = setTimeout(refreshOccurrenceOverlays, delay);
}

appReady.then(() => {
    document.getElementById('networkOccurrenceButton')?.addEventListener('click', (e) => { e.preventDefault(); openOccurrenceModal(); });
    document.getElementById('markerDocPanel')?.addEventListener('click', handleDocOccurrenceClick);
    //Cidade aberta, item mostrado/ocultado ou troca de modo: refaz os anéis
    const sidebar = document.getElementById('sidebar');
    sidebar?.addEventListener('change', () => scheduleOccurrenceOverlays());
    sidebar?.addEventListener('click', (e) => { if (e.target.closest('.visibility-toggle-btn')) scheduleOccurrenceOverlays(); });
    if (sidebar) new MutationObserver(() => scheduleOccurrenceOverlays(300)).observe(sidebar, { childList: true });
    let wasRede = document.body.classList.contains('mode-rede');
    new MutationObserver(() => {
        const rede = document.body.classList.contains('mode-rede');
        if (rede !== wasRede) { wasRede = rede; scheduleOccurrenceOverlays(0); }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
});
