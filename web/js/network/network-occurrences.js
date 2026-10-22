// Ocorrências de manutenção na rede (modo Rede): rompimento, sinal baixo, caixa danificada… em uma caixa ou num cabo, com
// situação (aberta, em andamento, resolvida), anotações de quem atendeu e o histórico. Ficam no JSON da rede (data.occurrences),
// aparecem como anel no mapa, no painel da caixa e na aba "Ocorrências" do painel da rede.
// Depende de js/app.js, js/projects/network-mode.js e js/network/network-docs.js.

const OCCURRENCE_KINDS = [
    { id: 'rompimento', label: 'Rompimento de fibra', color: '#dc2626', hint: 'Fibra ou cabo partido' },
    { id: 'sinal', label: 'Sinal baixo / atenuação', color: '#d97706', hint: 'Potência fora do esperado' },
    { id: 'danificada', label: 'Caixa ou cabo danificado', color: '#dc2626', hint: 'Quebrada, aberta, molhada' },
    { id: 'poste', label: 'Poste ou fixação', color: '#d97706', hint: 'Poste caído, cabo solto' },
    { id: 'vandalismo', label: 'Vandalismo ou furto', color: '#dc2626', hint: 'Corte ou furto de cabo' },
    { id: 'preventiva', label: 'Manutenção preventiva', color: '#2563eb', hint: 'Limpeza, revisão, troca' },
    { id: 'outro', label: 'Outro', color: '#64748b', hint: 'Qualquer outro problema' },
];
const OCCURRENCE_STATUSES = [
    { id: 'aberta', label: 'Aberta', color: '#dc2626' },
    { id: 'andamento', label: 'Em andamento', color: '#d97706' },
    { id: 'resolvida', label: 'Resolvida', color: '#16a34a' },
];
//Prazo para resolver (a partir de quando foi aberta); o padrão depende do tipo
const OCCURRENCE_DUE = [
    { id: '4h', label: '4 h', hours: 4 },
    { id: '24h', label: '24 h', hours: 24 },
    { id: '3d', label: '3 dias', hours: 72 },
    { id: '7d', label: '7 dias', hours: 168 },
    { id: '', label: 'Sem prazo', hours: 0 },
];
const OCCURRENCE_DEFAULT_DUE = { rompimento: '4h', vandalismo: '4h', danificada: '24h', sinal: '24h', poste: '24h', preventiva: '7d', outro: '3d' };
const OCCURRENCE_ASSIGNABLE = ['admin', 'projetista', 'tecnico'];
const occurrences = { overlays: [], editing: null, rootId: '', filter: 'abertas', timer: null, team: null, due: '' };

const getOccurrenceKind = (id) => OCCURRENCE_KINDS.find(k => k.id === id) || OCCURRENCE_KINDS[OCCURRENCE_KINDS.length - 1];
const getOccurrenceStatus = (id) => OCCURRENCE_STATUSES.find(s => s.id === id) || OCCURRENCE_STATUSES[0];
const isOccurrenceOpen = (o) => o.status !== 'resolvida';
const getNetworkOccurrences = (projectId) => networkDocs.occurrences.get(projectId) || [];
const isOccurrenceLate = (o, now = Date.now()) => isOccurrenceOpen(o) && !!o.dueAt && Date.parse(o.dueAt) < now;
const isMyOccurrence = (o) => !!o.assignee?.id && o.assignee.id === AppSession.userId;

//Tempo em texto curto: "45 min", "3 h", "2 dias"
function formatOccurrenceSpan(ms) {
    const min = Math.max(1, Math.round(Math.abs(ms) / 60000));
    if (min < 60) return `${min} min`;
    const h = Math.round(min / 60);
    if (h < 48) return `${h} h`;
    return `${Math.round(h / 24)} dias`;
}

//Situação no tempo: aberta há quanto, vence em quanto (ou atrasada), resolvida em quanto tempo
function describeOccurrenceTiming(o, now = Date.now()) {
    const opened = Date.parse(o.openedAt) || now;
    if (!isOccurrenceOpen(o)) {
        const done = Date.parse(o.resolvedAt) || now;
        return { text: `resolvida em ${formatOccurrenceSpan(done - opened)}`, late: false };
    }
    const parts = [`aberta há ${formatOccurrenceSpan(now - opened)}`];
    const due = Date.parse(o.dueAt);
    if (due) parts.push(due < now ? `atrasada ${formatOccurrenceSpan(now - due)}` : `vence em ${formatOccurrenceSpan(due - now)}`);
    return { text: parts.join(' · '), late: !!due && due < now };
}

//Quem pode ser responsável: administrador, projetista e técnico de campo da empresa (lista guardada até recarregar)
async function loadOccurrenceTeam() {
    if (occurrences.team) return occurrences.team;
    try {
        const { data, error } = await supabaseClient.rpc('list_company_members');
        if (error) throw error;
        occurrences.team = (data || []).filter(m => OCCURRENCE_ASSIGNABLE.includes(m.role))
            .map(m => ({ id: m.user_id, name: m.full_name || m.email || 'Sem nome', role: m.role }))
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    } catch (e) {
        occurrences.team = [];
    }
    if (!occurrences.team.some(m => m.id === AppSession.userId) && OCCURRENCE_ASSIGNABLE.includes(AppSession.role)) {
        occurrences.team.unshift({ id: AppSession.userId, name: networkWho(), role: AppSession.role });
    }
    return occurrences.team;
}

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
    const icon = (id) => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"></use></svg>`;
    modal = document.createElement('div');
    modal.id = 'occurrenceModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content occurrence-modal" role="dialog" aria-labelledby="occurrenceTitle">
            <div class="modal-header-v2 rm-head rm-head--occ">
                <span class="rm-head__icon">${icon('i-clipboard-check')}</span>
                <div class="rm-head__text">
                    <h2 id="occurrenceTitle">Nova ocorrência</h2>
                    <p class="rm-head__sub" id="occurrenceSubtitle">Registre o problema na caixa ou no cabo; a equipe acompanha até resolver</p>
                </div>
            </div>
            <div class="modal-body-content rm-steps">
                <div class="occurrence-summary" id="occurrenceSummary" hidden></div>
                <section class="rm-step" id="occurrenceStepItem">
                    <header class="rm-step__head"><span class="rm-step__n"></span><label for="occurrenceItem">Onde</label></header>
                    <select id="occurrenceItem"></select>
                    <div class="occurrence-target" id="occurrenceTarget" aria-live="polite"></div>
                </section>
                <section class="rm-step" id="occurrenceStepKind">
                    <header class="rm-step__head"><span class="rm-step__n"></span><span>O que aconteceu</span></header>
                    <input type="hidden" id="occurrenceKind" value="rompimento" />
                    <div class="occurrence-kinds" id="occurrenceKinds" role="radiogroup" aria-label="Tipo">${OCCURRENCE_KINDS.map(k => `
                        <button type="button" class="btn-card occurrence-kind" role="radio" data-kind="${k.id}" style="--occ:${k.color}">
                            <i aria-hidden="true"></i><span><b>${k.label}</b><small>${k.hint}</small></span>
                        </button>`).join('')}
                    </div>
                </section>
                <section class="rm-step">
                    <header class="rm-step__head"><span class="rm-step__n"></span><span>Situação</span></header>
                    <div class="occurrence-status" id="occurrenceStatus" role="radiogroup">${OCCURRENCE_STATUSES.map(st => `<button type="button" class="btn-seg" role="radio" data-status="${st.id}" style="--occ:${st.color}"><i aria-hidden="true"></i>${st.label}</button>`).join('')}</div>
                </section>
                <section class="rm-step">
                    <header class="rm-step__head"><span class="rm-step__n"></span><label for="occurrenceAssignee">Responsável e prazo</label></header>
                    <div class="occurrence-team">
                        <select id="occurrenceAssignee"><option value="">Sem responsável</option></select>
                        <div class="occurrence-due" id="occurrenceDue" role="radiogroup" aria-label="Prazo">${OCCURRENCE_DUE.map(d => `<button type="button" class="btn-seg" role="radio" data-due="${d.id}">${d.label}</button>`).join('')}</div>
                    </div>
                    <small class="occurrence-due__when" id="occurrenceDueWhen"></small>
                </section>
                <section class="rm-step">
                    <header class="rm-step__head"><span class="rm-step__n"></span><label for="occurrenceText" id="occurrenceTextLabel">Detalhes</label><small>opcional</small></header>
                    <textarea id="occurrenceText" rows="3" placeholder="Ex.: cabo rompido no poste em frente ao nº 120, 3 clientes sem sinal"></textarea>
                    <div id="occurrenceExtra"></div>
                </section>
                <section class="rm-step rm-step--plain" id="occurrenceHistoryStep" hidden>
                    <header class="rm-step__head">${icon('i-clock')}<span>Histórico</span></header>
                    <ol class="occurrence-history" id="occurrenceHistory"></ol>
                </section>
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
        const kind = e.target.closest('[data-kind]');
        if (kind) {
            setOccurrenceKindUi(kind.dataset.kind);
            if (!occurrences.dueTouched) setOccurrenceDueUi(OCCURRENCE_DEFAULT_DUE[kind.dataset.kind] ?? '');
            return;
        }
        const due = e.target.closest('[data-due]');
        if (due) { occurrences.dueTouched = true; setOccurrenceDueUi(due.dataset.due); return; }
        const action = e.target.closest('[data-occ]')?.dataset.occ;
        if (e.target === modal || action === 'cancel') closeOccurrenceModal();
        if (action === 'save') saveOccurrenceFromModal();
    });
    modal.addEventListener('change', (e) => { if (e.target.id === 'occurrenceItem') renderOccurrenceTarget(); });
    return modal;
}

function setOccurrenceStatusUi(statusId) {
    document.querySelectorAll('#occurrenceStatus [data-status]').forEach(b => {
        const on = b.dataset.status === statusId;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
}

//Prazo escolhido: conta de quando a ocorrência foi aberta (agora, se for nova)
function setOccurrenceDueUi(dueId) {
    occurrences.due = dueId;
    document.querySelectorAll('#occurrenceDue [data-due]').forEach(b => {
        const on = b.dataset.due === dueId;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    const when = document.getElementById('occurrenceDueWhen');
    const at = getOccurrenceDueAt(occurrences.editing?.openedAt);
    if (when) when.textContent = at ? `Resolver até ${formatDocDate(at)}` : 'Sem prazo definido';
}

function getOccurrenceDueAt(openedAt) {
    const hours = OCCURRENCE_DUE.find(d => d.id === occurrences.due)?.hours || 0;
    if (!hours) return null;
    const start = Date.parse(openedAt) || Date.now();
    return new Date(start + hours * 3600000).toISOString();
}

//Lista de responsáveis na janela; "selected": id já escolhido (ocorrência existente)
function fillOccurrenceAssignees(team, selected, fallbackName = '') {
    const select = document.getElementById('occurrenceAssignee');
    if (!select) return;
    const esc = (v) => escapeHtml(String(v ?? ''));
    const roleLabel = (r) => ROLE_LABELS[r] || '';
    const list = [...team];
    if (selected && !list.some(m => m.id === selected)) list.push({ id: selected, name: fallbackName || 'Responsável anterior', role: '' });
    select.innerHTML = '<option value="">Sem responsável</option>' + list.map(m => `<option value="${esc(m.id)}">${m.id === AppSession.userId ? `Eu (${esc(m.name)})` : esc(m.name)}${m.role ? ` · ${esc(roleLabel(m.role))}` : ''}</option>`).join('');
    select.value = selected || '';
}

function getOccurrenceAssigneeUi() {
    const select = document.getElementById('occurrenceAssignee');
    if (!select?.value) return null;
    const name = (occurrences.team || []).find(m => m.id === select.value)?.name
        || (occurrences.editing?.assignee?.id === select.value ? occurrences.editing.assignee.name : select.selectedOptions[0]?.textContent || '');
    return { id: select.value, name };
}

const getOccurrenceStatusUi = () => document.querySelector('#occurrenceStatus [data-status].is-active')?.dataset.status || 'aberta';

function setOccurrenceKindUi(kindId) {
    const input = document.getElementById('occurrenceKind');
    if (input) input.value = kindId;
    document.querySelectorAll('#occurrenceKinds [data-kind]').forEach(b => {
        const on = b.dataset.kind === kindId;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
}

//Item escolhido: o que é, quantos clientes estão nele e o que cai se ele parar (mesmo cálculo de "Rompimento e impacto")
function renderOccurrenceTarget() {
    const box = document.getElementById('occurrenceTarget');
    if (!box || occurrences.editing) return;
    const [kind, uid] = (document.getElementById('occurrenceItem')?.value || '').split(':');
    const item = !uid ? null : kind === 'c' ? savedCables.find(c => c.uid === uid) : markers.find(m => m.uid === uid);
    if (!item) { box.innerHTML = ''; return; }
    const esc = (v) => escapeHtml(String(v ?? ''));
    const facts = [];
    if (kind === 'c') {
        const ends = [findMarkerByUid(item.startAnchorUid), findMarkerByUid(item.endAnchorUid)].filter(Boolean).map(m => m.name);
        if (ends.length) facts.push(`liga ${ends.map(esc).join(' → ')}`);
        if (item.totalLength) facts.push(`${Math.round(item.totalLength)} m`);
    } else if (item.type === 'CTO' && typeof getCtoClients === 'function') {
        const n = getCtoClients(item).length;
        facts.push(`${n} cliente${n === 1 ? '' : 's'} nesta caixa`);
    }
    let impact = '';
    try {
        const root = document.getElementById(occurrences.rootId)?.closest('.folder');
        if (root && typeof buildImpactModel === 'function') {
            occurrences.impactModel = occurrences.impactModel || buildImpactModel(getNetworkScope(root));
            if (occurrences.impactModel.base.size) {
                const target = kind === 'c' ? { kind: 'cable', cable: item } : { kind: 'box', box: item };
                const result = analyzeNetworkCut(occurrences.impactModel, networkCutFor(target), kind === 'c' ? null : item);
                impact = result.lost.length || result.degraded.length
                    ? `<span class="occurrence-target__impact is-bad">Se estiver parado: ${esc(describeImpactResult(result))}</span>`
                    : '<span class="occurrence-target__impact">Se estiver parado: nenhuma CTO perde sinal</span>';
            }
        }
    } catch (e) { /* sem cálculo de sinal: mostra só o item */ }
    box.innerHTML = `<span class="occurrence-target__type">${kind === 'c' ? 'Cabo' : esc(item.type)}</span>
        <span class="occurrence-target__text"><b>${esc(item.name)}</b>${facts.length ? `<small>${facts.join(' · ')}</small>` : ''}${impact}</span>`;
}

//item: caixa/cabo já escolhido (painel da caixa); occurrence: ocorrência existente (atualizar)
async function openOccurrenceModal({ item = null, occurrence = null, root = null } = {}) {
    if (!requireDocument('registrar ocorrências')) return;
    root = root || (item ? getNetworkRootOf(item) : null) || (occurrence ? null : await ensureActiveNetworkCity('registrar a ocorrência'));
    if (occurrence && !root) root = getNetworkRoots().find(r => getNetworkOccurrences(getRootId(r)).includes(occurrence)) || null;
    if (!root) return;
    occurrences.rootId = getRootId(root);
    occurrences.editing = occurrence;
    occurrences.impactModel = null;
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
    setOccurrenceKindUi(occurrence?.kind || 'rompimento');
    setOccurrenceStatusUi(occurrence?.status || 'aberta');
    occurrences.dueTouched = !!occurrence;
    setOccurrenceDueUi(occurrence ? (occurrence.dueId ?? '') : OCCURRENCE_DEFAULT_DUE.rompimento);
    const team = await loadOccurrenceTeam();
    fillOccurrenceAssignees(team, occurrence ? occurrence.assignee?.id || '' : (AppSession.isTecnico ? AppSession.userId : ''), occurrence?.assignee?.name);
    modal.querySelector('#occurrenceStepItem').hidden = !!occurrence;
    modal.querySelector('#occurrenceStepKind').hidden = !!occurrence;
    modal.querySelector('#occurrenceText').value = '';
    modal.querySelector('#occurrenceText').placeholder = occurrence ? 'Ex.: emenda refeita, sinal normalizado' : 'Ex.: cabo rompido no poste em frente ao nº 120, 3 clientes sem sinal';
    modal.querySelector('#occurrenceTextLabel').textContent = occurrence ? 'Anotação (o que foi feito)' : 'Detalhes';
    modal.querySelector('#occurrenceTitle').textContent = occurrence ? 'Acompanhar ocorrência' : 'Nova ocorrência';
    modal.querySelector('#occurrenceSubtitle').textContent = occurrence ? 'Mude a situação e anote o que foi feito' : 'Registre o problema na caixa ou no cabo; a equipe acompanha até resolver';
    modal.querySelector('[data-occ="save"]').textContent = occurrence ? 'Salvar' : 'Registrar';
    const summary = modal.querySelector('#occurrenceSummary');
    summary.hidden = !occurrence;
    if (occurrence) {
        const k = getOccurrenceKind(occurrence.kind);
        const st = getOccurrenceStatus(occurrence.status);
        summary.style.setProperty('--occ', k.color);
        const timing = describeOccurrenceTiming(occurrence);
        summary.innerHTML = `<i aria-hidden="true"></i><span><b>${esc(k.label)}</b><small>${occurrence.itemKind === 'c' ? 'Cabo' : esc(occurrence.itemType)} ${esc(occurrence.itemName)} · aberta por ${esc(occurrence.openedBy || '')}</small>
            <small class="occurrence-timing${timing.late ? ' is-late' : ''}">${esc(timing.text)}</small></span>
            <em class="is-${esc(occurrence.status)}">${esc(st.label)}</em>`;
    }
    const history = occurrence ? [
        { at: occurrence.openedAt, by: occurrence.openedBy, status: 'aberta', text: occurrence.text, first: true },
        ...(occurrence.updates || []),
    ].reverse() : [];
    modal.querySelector('#occurrenceHistoryStep').hidden = !history.length;
    const extra = (u) => [u.assignee !== undefined ? `responsável: ${u.assignee || 'ninguém'}` : '', u.dueAt !== undefined ? (u.dueAt ? `prazo até ${formatDocDate(u.dueAt)}` : 'sem prazo') : ''].filter(Boolean).join(' · ');
    modal.querySelector('#occurrenceHistory').innerHTML = history.map(u => `<li class="is-${esc(u.first ? 'aberta' : u.status || 'nota')}"><small>${esc(formatDocDate(u.at))} · ${esc(u.by || '')}${u.first ? ' · abriu' : u.status ? ` · ${esc(getOccurrenceStatus(u.status).label)}` : ''}${extra(u) ? ` · ${esc(extra(u))}` : ''}</small>${u.text ? `<span>${esc(u.text)}</span>` : ''}</li>`).join('');
    renderOccurrenceTarget();
    if (typeof renderOccurrencePhotos === 'function') renderOccurrencePhotos(modal.querySelector('#occurrenceExtra'), occurrence, root);
    modal.style.display = 'flex';
    setTimeout(() => modal.querySelector(occurrence ? '#occurrenceText' : (selectedUid ? '#occurrenceKinds .is-active' : '#occurrenceItem'))?.focus(), 50);
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
    const assignee = getOccurrenceAssigneeUi();
    if (occurrences.editing) {
        const o = occurrences.editing;
        const dueAt = getOccurrenceDueAt(o.openedAt);
        const assigneeChanged = (assignee?.id || '') !== (o.assignee?.id || '');
        const dueChanged = (occurrences.due || '') !== (o.dueId || '') && (dueAt || null) !== (o.dueAt || null);
        if (!text && status === o.status && !assigneeChanged && !dueChanged) { closeOccurrenceModal(); return; }
        const change = { at, by, status: status !== o.status ? status : null, text };
        if (assigneeChanged) change.assignee = assignee?.name || '';
        if (dueChanged) change.dueAt = dueAt;
        const updated = { ...o, status, assignee, dueId: occurrences.due || '', dueAt, updatedAt: at, updates: [...(o.updates || []), change] };
        if (status === 'resolvida' && o.status !== 'resolvida') { updated.resolvedAt = at; updated.resolvedBy = by; }
        if (status !== 'resolvida') { delete updated.resolvedAt; delete updated.resolvedBy; }
        list[list.indexOf(o)] = updated;
        const verb = status !== o.status ? (status === 'resolvida' ? 'resolveu' : status === 'andamento' ? 'começou a atender' : 'reabriu')
            : assigneeChanged && !text ? `passou para ${assignee?.name || 'ninguém'} a` : dueChanged && !text ? 'mudou o prazo da' : 'anotou na';
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
            assignee, dueId: occurrences.due || '', dueAt: getOccurrenceDueAt(at),
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
    const timing = describeOccurrenceTiming(o);
    return `<button type="button" class="occurrence-row is-${esc(o.status)}${timing.late ? ' is-late' : ''}" ${dataAttr}="${i}" style="--occ:${kind.color}">
        <span><b>${esc(kind.label)}</b><small>${esc(o.itemName)}${o.text ? ` · ${esc(o.text)}` : ''}</small>
            <small class="occurrence-timing${timing.late ? ' is-late' : ''}">${esc(timing.text)}${o.assignee?.name ? ` · ${isMyOccurrence(o) ? 'com você' : esc(o.assignee.name)}` : isOccurrenceOpen(o) ? ' · sem responsável' : ''}</small></span>
        <em>${timing.late ? 'Atrasada' : esc(status.label)}</em>
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

//Ordem das abertas: atrasadas primeiro, depois o prazo mais perto, depois as mais antigas
function sortOpenOccurrences(list, now = Date.now()) {
    const due = (o) => Date.parse(o.dueAt) || Infinity;
    return list.slice().sort((a, b) => (isOccurrenceLate(b, now) - isOccurrenceLate(a, now)) || (due(a) - due(b)) || String(a.openedAt).localeCompare(String(b.openedAt)));
}

const OCCURRENCE_FILTERS = [
    { id: 'abertas', label: 'Abertas', test: isOccurrenceOpen },
    { id: 'minhas', label: 'Minhas', test: (o) => isOccurrenceOpen(o) && isMyOccurrence(o) },
    { id: 'atrasadas', label: 'Atrasadas', test: (o) => isOccurrenceLate(o) },
    { id: 'resolvidas', label: 'Resolvidas', test: (o) => !isOccurrenceOpen(o) },
];

//Aba "Ocorrências" do painel da rede
function renderOccurrencesTabHtml(root) {
    const all = getNetworkOccurrences(getRootId(root));
    const filter = OCCURRENCE_FILTERS.find(f => f.id === occurrences.filter) || OCCURRENCE_FILTERS[0];
    const matching = all.filter(filter.test);
    const list = filter.id === 'resolvidas' ? matching.slice().reverse() : sortOpenOccurrences(matching);
    occurrences.tabList = list;
    const empty = { abertas: 'Nenhuma ocorrência aberta nesta cidade.', minhas: 'Nenhuma ocorrência aberta com você.', atrasadas: 'Nenhuma ocorrência atrasada.', resolvidas: 'Nenhuma ocorrência resolvida ainda.' };
    return `<div class="map-tool-segmented occurrence-filter">
            ${OCCURRENCE_FILTERS.map(f => `<button type="button" data-net-panel="occ-filter" data-filter="${f.id}" class="${f.id === filter.id ? 'is-active' : ''}">${f.label} (${all.filter(f.test).length})</button>`).join('')}
        </div>
        ${list.length ? `<div class="occurrence-list">${list.slice(0, 100).map((o, i) => renderOccurrenceRow(o, i, 'data-net-panel="occ" data-i')).join('')}</div>`
            : `<p class="map-tool-help">${empty[filter.id]}</p>`}
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
                title: `Ocorrência: ${getOccurrenceKind(o.kind).label}${isOccurrenceLate(o) ? ' (atrasada)' : ''}${o.assignee?.name ? ` · ${o.assignee.name}` : ''}`,
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: isOccurrenceLate(o) ? 20 : 17, fillColor: color, fillOpacity: 0.14, strokeColor: color, strokeOpacity: 0.95, strokeWeight: isOccurrenceLate(o) ? 5 : 3 },
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
