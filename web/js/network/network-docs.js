// Documentação da rede (modo Rede), no estilo dos sistemas de documentação FTTH:
// - Painel da rede: caixas, cabos, portas (ocupação), clientes por situação e o que precisa de atenção, por cidade
// - Viabilidade: clique no endereço do cliente → CTOs por perto com porta livre, e cadastrar o cliente numa delas
// - Histórico de alterações: ao salvar a rede, o que foi incluído, alterado ou excluído (quem e quando) fica gravado
//   na própria rede (data.changeLog); cada caixa mostra de qual projeto veio e as últimas mudanças dela
// Depende de js/app.js, js/projects/network-mode.js, js/network/clients.js e js/network/project-check.js.

const NETWORK_LOG_MAX = 500;
const VIABILITY_RADII = [100, 150, 200, 300, 500];
const VIABILITY_STREET_FACTOR = 1.3; //Drop pela rua ≈ 1,3 × a distância em linha reta
const networkDocs = { snapshots: new Map(), logs: new Map(), panelRootId: '', panelTab: 'resumo', cursor: new Map() };
const viability = { active: false, radius: 200, point: null, listener: null, overlays: [], results: [] };

const getNetworkRoots = () => getOpenProjectRoots().filter(isNetworkRoot);
const networkWho = () => AppSession.profile?.full_name || AppSession.email || 'Alguém';
const formatDocDate = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

function getActiveNetworkRoot() {
    const id = typeof getActiveProjectId === 'function' ? getActiveProjectId() : null;
    const root = id ? document.getElementById(id)?.closest('.folder') : null;
    return isNetworkRoot(root) ? root : null;
}

//Cidade em que a ação vale: a selecionada ou, com uma só aberta, ela. Carrega se ainda for só o nome.
async function ensureActiveNetworkCity(actionLabel) {
    let root = getActiveNetworkRoot();
    if (!root) {
        const roots = getNetworkRoots();
        if (roots.length === 1) root = roots[0];
    }
    if (!root) {
        showToast('Escolha a cidade', `Clique numa cidade na barra lateral para ${actionLabel}.`, 'progress');
        return null;
    }
    if (isPendingNetworkRoot(root)) root = await loadNetworkRoot(getRootId(root));
    if (!root) return null;
    const id = getRootId(root);
    if (!getAllDescendantFolderIds(id).includes(activeFolderId)) setActiveFolder(id);
    return root;
}

function getNetworkScope(root) {
    const projectId = getRootId(root);
    const folderIds = new Set(getAllDescendantFolderIds(projectId));
    return {
        projectId,
        markers: markers.filter(m => folderIds.has(m.folderId)),
        cables: savedCables.filter(c => folderIds.has(c.folderId)),
    };
}

//Mostra a cidade no mapa (estava oculta) e vai até a caixa
function focusNetworkItem(info) {
    const root = getNetworkRoots().find(r => getAllDescendantFolderIds(getRootId(r)).includes(info.folderId));
    const box = root?.querySelector(':scope > .folder-title .visibility-toggle-btn');
    if (box && !box.checked) handleVisibilityToggle(box, true);
    if (info.marker) {
        if (info.marker.getVisible?.() === false) info.marker.setVisible(true);
        focusMapToMarker(info);
    } else if (info.polyline && typeof focusMapToCable === 'function') {
        focusMapToCable(info);
    }
}

// ---------------------------------------------------------------
// Histórico de alterações
// ---------------------------------------------------------------

const textHash = (text) => {
    let h = 5381;
    const str = String(text || '');
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return str ? `${str.length}:${h.toString(36)}` : '';
};
const roundCoord = (p) => (p ? `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}` : '');

//O que se compara em cada item salvo (o rótulo é o que aparece no histórico: "alterou posição, plano de fusão")
function getNetworkItemFields(kind, item) {
    if (kind === 'm') {
        return {
            nome: item.name || '',
            posição: roundCoord(item.position),
            situação: [item.ctoStatus, item.ceoStatus, item.reservaStatus, item.cordoalhaStatus].filter(Boolean).join('|'),
            'plano de fusão': textHash(item.fusionPlan),
            cliente: item.type === 'CLIENTE' ? [item.client?.status, item.client?.ctoUid, item.client?.ctoPort, item.client?.code].join('|') : '',
            observação: item.description || '',
        };
    }
    return {
        nome: item.name || '',
        tipo: item.type || '',
        situação: item.status || '',
        traçado: textHash((item.path || []).map(roundCoord).join(';')),
        pontas: `${item.startAnchorUid || ''}|${item.endAnchorUid || ''}`,
    };
}

function snapshotNetworkData(data) {
    const snap = new Map();
    (data?.markers || []).forEach(m => { if (m.uid) snap.set(`m:${m.uid}`, { kind: 'm', type: m.type, name: m.name, uid: m.uid, fields: getNetworkItemFields('m', m) }); });
    (data?.cables || []).forEach(c => { if (c.uid) snap.set(`c:${c.uid}`, { kind: 'c', type: 'CABO', name: c.name, uid: c.uid, fields: getNetworkItemFields('c', c) }); });
    return snap;
}

//Diferença entre a rede como foi aberta/salva e como está agora: [{ at, by, action, type, name, uid, detail }]
function diffNetworkData(before, data) {
    const now = snapshotNetworkData(data);
    const at = new Date().toISOString();
    const by = networkWho();
    const out = [];
    now.forEach((item, key) => {
        const old = before.get(key);
        if (!old) { out.push({ at, by, action: 'incluiu', type: item.type, name: item.name, uid: item.uid }); return; }
        const changed = Object.keys(item.fields).filter(f => item.fields[f] !== old.fields[f]);
        if (changed.length) out.push({ at, by, action: 'alterou', type: item.type, name: item.name, uid: item.uid, detail: changed.join(', ') });
    });
    before.forEach((item, key) => { if (!now.has(key)) out.push({ at, by, action: 'excluiu', type: item.type, name: item.name, uid: item.uid }); });
    return out;
}

//Chamado por buildProjectRecord (js/core/persistence.js) para a rede: o histórico com o que mudou desde a última vez
function withNetworkChangeLog(projectId, data) {
    const before = networkDocs.snapshots.get(projectId);
    const log = networkDocs.logs.get(projectId) || [];
    const changes = before ? diffNetworkData(before, data) : [];
    return { ...data, changeLog: [...log, ...changes].slice(-NETWORK_LOG_MAX) };
}

//Rede salva: o salvo passa a ser a base da próxima comparação
function commitNetworkSave(record) {
    if (record?.project_type !== NETWORK_PROJECT_TYPE) return;
    networkDocs.logs.set(record.id, record.data.changeLog || []);
    networkDocs.snapshots.set(record.id, snapshotNetworkData(record.data));
    if (networkDocs.panelRootId === record.id) renderNetworkPanel();
}

//Rede aberta (js/core/persistence.js → loadAndDisplayProject)
function rememberNetworkLoaded(projectId, data) {
    if (data?.sidebar?.type !== NETWORK_PROJECT_TYPE) return;
    networkDocs.logs.set(projectId, data.changeLog || []);
    networkDocs.snapshots.set(projectId, snapshotNetworkData(data));
}

function describeNetworkLogEntry(e) {
    const noun = e.type === 'CABO' ? 'o cabo' : e.type === 'CLIENTE' ? 'o cliente' : `a ${e.type || 'caixa'}`;
    if (e.action === 'projeto') return `concluiu o projeto "${e.name}"${e.detail ? `: ${e.detail}` : ''}`;
    return `${e.action} ${noun} ${e.name || ''}${e.detail ? ` (${e.detail})` : ''}`.trim();
}

// ---------------------------------------------------------------
// Documentação da caixa (painel do marcador)
// ---------------------------------------------------------------

function renderMarkerDocPanel(markerInfo) {
    const panel = document.getElementById('markerDocPanel');
    if (!panel) return;
    const root = markerInfo ? getNetworkRoots().find(r => getAllDescendantFolderIds(getRootId(r)).includes(markerInfo.folderId)) : null;
    if (!root) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
    const esc = (v) => escapeHtml(String(v ?? ''));
    const origin = markerInfo.asBuilt;
    const log = (networkDocs.logs.get(getRootId(root)) || []).filter(e => e.uid && e.uid === markerInfo.uid).slice(-4).reverse();
    panel.innerHTML = `
        <p class="marker-doc__origin">${origin
            ? `Construído pelo projeto <b>${esc(origin.projectName)}</b>${origin.at ? ` em ${esc(new Date(origin.at).toLocaleDateString('pt-BR'))}` : ''}${origin.by ? ` · ${esc(origin.by)}` : ''}`
            : 'Incluído direto na rede'}</p>
        ${log.length ? `<ul class="marker-doc__log">${log.map(e => `<li><small>${esc(formatDocDate(e.at))}</small> ${esc(e.by)} ${esc(e.action)}${e.detail ? ` ${esc(e.detail)}` : ''}</li>`).join('')}</ul>` : ''}`;
    panel.classList.remove('hidden');
}

// ---------------------------------------------------------------
// Painel da rede
// ---------------------------------------------------------------

function getNetworkStats(root) {
    const scope = getNetworkScope(root);
    const of = (type) => scope.markers.filter(m => m.type === type);
    const ctos = of('CTO').map(cto => {
        const capacity = getCtoPortCapacity(cto);
        const used = getOccupiedPorts(cto).size;
        return { cto, capacity, used, share: capacity ? used / capacity : 0 };
    });
    const clients = of('CLIENTE');
    const byStatus = CLIENT_STATUSES.map(st => ({ ...st, count: clients.filter(c => (c.client?.status || DEFAULT_CLIENT_STATUS) === st.id).length }));
    const ports = ctos.reduce((sum, c) => sum + (c.capacity || 0), 0);
    const used = ctos.reduce((sum, c) => sum + (c.capacity ? c.used : 0), 0);
    const issues = typeof runProjectCheck === 'function' ? runProjectCheck(scope) : [];
    return {
        scope, ctos, byStatus,
        ceos: of('CEO').length, pops: of('POP').length, reserves: of('RESERVA').length,
        km: scope.cables.reduce((sum, c) => sum + (Number(c.totalLength) || 0), 0) / 1000,
        cables: scope.cables.length, ports, used,
        full: ctos.filter(c => c.capacity && c.used >= c.capacity),
        high: ctos.filter(c => c.capacity && c.used < c.capacity && c.share >= 0.75),
        noSplitter: ctos.filter(c => !c.capacity),
        unlinked: clients.filter(c => c.client?.status !== 'cancelado' && !c.client?.cableName && (!c.client?.ctoUid || !c.client?.ctoPort)),
        errors: issues.filter(i => i.level === 'erro').length,
        warnings: issues.filter(i => i.level !== 'erro').length,
    };
}

async function openNetworkPanel(tab = 'resumo') {
    const root = await ensureActiveNetworkCity('ver o painel');
    if (!root) return;
    networkDocs.panelRootId = getRootId(root);
    networkDocs.panelTab = tab;
    document.getElementById('networkPanelBox').classList.remove('hidden');
    renderNetworkPanel();
}

function renderNetworkPanel() {
    const box = document.getElementById('networkPanelBox');
    if (!box || box.classList.contains('hidden')) return;
    const root = document.getElementById(networkDocs.panelRootId)?.closest('.folder');
    const body = document.getElementById('networkPanelBody');
    if (!root || isPendingNetworkRoot(root)) { box.classList.add('hidden'); return; }
    const esc = (v) => escapeHtml(String(v ?? ''));
    const fmt = (v, d = 0) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: d });
    const title = root.querySelector(':scope > .folder-title');
    document.getElementById('networkPanelSubtitle').textContent = title.dataset.folderName || '';
    const cities = getNetworkRoots();
    const picker = cities.length > 1
        ? `<select class="network-panel__city" data-net-panel="city" aria-label="Cidade">${cities.map(r => `<option value="${esc(getRootId(r))}"${getRootId(r) === networkDocs.panelRootId ? ' selected' : ''}>${esc(r.querySelector(':scope > .folder-title').dataset.folderName)}</option>`).join('')}</select>` : '';
    const tabs = `<div class="map-tool-segmented network-panel__tabs" role="tablist">
        <button type="button" role="tab" data-net-panel="tab" data-tab="resumo" class="${networkDocs.panelTab === 'resumo' ? 'is-active' : ''}" aria-selected="${networkDocs.panelTab === 'resumo'}">Resumo</button>
        <button type="button" role="tab" data-net-panel="tab" data-tab="historico" class="${networkDocs.panelTab === 'historico' ? 'is-active' : ''}" aria-selected="${networkDocs.panelTab === 'historico'}">Histórico</button>
    </div>`;
    if (networkDocs.panelTab === 'historico') {
        const log = (networkDocs.logs.get(networkDocs.panelRootId) || []).slice(-150).reverse();
        body.innerHTML = `${picker}${tabs}
            ${log.length ? `<ul class="network-log">${log.map((e, i) => `<li><button type="button" class="network-log__item" data-net-panel="log" data-i="${i}"${e.uid ? '' : ' disabled'}>
                <small>${esc(formatDocDate(e.at))} · ${esc(e.by || '')}</small><span>${esc(describeNetworkLogEntry(e))}</span></button></li>`).join('')}</ul>`
                : '<p class="map-tool-help">Ainda não há alterações registradas. A partir de agora, cada vez que a rede é salva, o que foi incluído, alterado ou excluído aparece aqui, com quem e quando.</p>'}`;
        networkDocs.renderedLog = log;
        return;
    }
    const st = getNetworkStats(root);
    const share = st.ports ? st.used / st.ports : 0;
    const level = share >= 0.9 ? 'full' : share >= 0.75 ? 'high' : 'ok';
    const attention = [
        ['full', st.full.length, `${st.full.length === 1 ? 'CTO lotada' : 'CTOs lotadas'}`, 'Sem porta livre para cliente novo', 'erro'],
        ['high', st.high.length, `${st.high.length === 1 ? 'CTO quase lotada' : 'CTOs quase lotadas'}`, '75% ou mais das portas em uso', 'aviso'],
        ['noSplitter', st.noSplitter.length, `${st.noSplitter.length === 1 ? 'CTO sem splitter' : 'CTOs sem splitter'} de atendimento`, 'Sem portas definidas no plano de fusão', 'aviso'],
        ['unlinked', st.unlinked.length, `${st.unlinked.length === 1 ? 'cliente sem CTO' : 'clientes sem CTO'} ou porta`, 'Ligue cada um numa porta', 'aviso'],
        ['check', st.errors, `${st.errors === 1 ? 'erro' : 'erros'} na verificação`, 'Pontas soltas, fusões, potência', 'erro'],
    ].filter(([, n]) => n > 0);
    const top = [...st.ctos].filter(c => c.capacity).sort((a, b) => b.share - a.share || b.used - a.used).slice(0, 5);
    body.innerHTML = `${picker}${tabs}
        <div class="network-kpis">
            <div><b>${fmt(st.ctos.length)}</b><span>CTOs</span></div>
            <div><b>${fmt(st.ceos)}</b><span>CEOs</span></div>
            <div><b>${fmt(st.pops)}</b><span>POPs</span></div>
            <div><b>${fmt(st.km, 1)}</b><span>km de cabo</span></div>
        </div>
        <section class="network-occ">
            <header><span>Portas de atendimento</span><b>${st.ports ? `${fmt(share * 100)}%` : '—'}</b></header>
            <div class="network-occ__bar" data-level="${level}"><span style="width:${(share * 100).toFixed(1)}%"></span></div>
            <p>${st.ports ? `${fmt(st.used)} em uso · <b>${fmt(st.ports - st.used)} livres</b> de ${fmt(st.ports)}` : 'Nenhuma CTO com splitter de atendimento ainda.'}</p>
        </section>
        <section class="network-clients">
            <header>Clientes</header>
            <div class="network-clients__chips">${st.byStatus.map(s => `<span style="--st:${s.color}"><i></i>${esc(s.label)} <b>${fmt(s.count)}</b></span>`).join('')}</div>
        </section>
        ${attention.length ? `<section class="network-attn"><header>Precisa de atenção</header>${attention.map(([key, n, label, hint, lvl]) => `
            <button type="button" class="network-attn__row is-${lvl}" data-net-panel="attn" data-key="${key}"><b>${fmt(n)}</b><span>${esc(label)}<small>${esc(hint)}</small></span><em>Ver ›</em></button>`).join('')}</section>`
            : '<p class="network-ok">✓ Nada precisando de atenção nesta cidade.</p>'}
        ${top.length ? `<section class="network-top"><header>CTOs mais cheias</header>${top.map((c, i) => `
            <button type="button" class="network-top__row" data-net-panel="cto" data-i="${i}"><span>${esc(c.cto.name)}</span><i data-level="${c.used >= c.capacity ? 'full' : c.share >= 0.75 ? 'high' : 'ok'}"><s style="width:${(c.share * 100).toFixed(0)}%"></s></i><b>${c.used}/${c.capacity}</b></button>`).join('')}</section>` : ''}
        <div class="network-panel__actions">
            <button type="button" class="map-tool-btn" data-net-panel="xlsx">Exportar planilha</button>
            <button type="button" class="map-tool-btn" data-net-panel="impact">Rompimento</button>
        </div>`;
    networkDocs.renderedStats = { ...st, top };
}

//Vai passando pelas caixas de um grupo (cada clique na linha vai para a próxima)
function cycleNetworkAttention(key, list) {
    if (!list.length) return;
    const n = ((networkDocs.cursor.get(key) ?? -1) + 1) % list.length;
    networkDocs.cursor.set(key, n);
    focusNetworkItem(list[n]);
    showToast(list[n].name || 'Item', `${n + 1} de ${list.length}`, 'progress');
}

function handleNetworkPanelClick(e) {
    const el = e.target.closest('[data-net-panel]');
    if (!el) return;
    const kind = el.dataset.netPanel;
    const st = networkDocs.renderedStats;
    if (kind === 'tab') { networkDocs.panelTab = el.dataset.tab; renderNetworkPanel(); return; }
    if (kind === 'xlsx') { exportProjectSpreadsheet(); return; }
    if (kind === 'impact') { openNetworkImpact(); return; }
    if (kind === 'log') {
        const entry = networkDocs.renderedLog?.[Number(el.dataset.i)];
        const item = entry && (entry.type === 'CABO' ? savedCables.find(c => c.uid === entry.uid) : markers.find(m => m.uid === entry.uid));
        if (item) focusNetworkItem(item);
        else showToast('Não está mais na rede', 'Esse item foi excluído depois.', 'progress');
        return;
    }
    if (kind === 'cto' && st) { focusNetworkItem(st.top[Number(el.dataset.i)].cto); return; }
    if (kind === 'attn' && st) {
        const key = el.dataset.key;
        if (key === 'check') { openProjectCheck(); return; }
        const list = key === 'unlinked' ? st.unlinked : st[key].map(c => c.cto);
        cycleNetworkAttention(key, list);
    }
}

// ---------------------------------------------------------------
// Viabilidade
// ---------------------------------------------------------------

async function startViability() {
    if (typeof map === 'undefined' || !map) return;
    stopViability();
    //As cidades que ainda são só o nome entram na consulta (carregam ocultas)
    const pending = getNetworkRoots().filter(isPendingNetworkRoot);
    for (const root of pending) await loadNetworkRoot(getRootId(root));
    viability.active = true;
    viability.point = null;
    viability.results = [];
    document.getElementById('viabilityBox').classList.remove('hidden');
    setMapCursor('crosshair');
    viability.listener = map.addListener('click', (e) => {
        if (!viability.active || isAddingMarker || isDrawingCable || isDrawingPolygon) return;
        runViability(e.latLng);
    });
    renderViability();
}

function stopViability() {
    viability.active = false;
    viability.listener?.remove?.();
    viability.listener = null;
    clearViabilityOverlays();
    if (typeof setMapCursor === 'function') setMapCursor('');
}

function clearViabilityOverlays() {
    viability.overlays.forEach(o => o.setMap(null));
    viability.overlays = [];
}

//CTOs das cidades abertas perto do ponto: distância em linha reta e estimada pela rua, portas livres
function findViableCtos(point, radius) {
    const roots = getNetworkRoots().filter(r => !isPendingNetworkRoot(r));
    const out = [];
    roots.forEach(root => {
        getNetworkScope(root).markers.filter(m => m.type === 'CTO').forEach(cto => {
            const pos = cto.marker?.getPosition?.();
            if (!pos) return;
            const straight = google.maps.geometry.spherical.computeDistanceBetween(point, pos);
            if (straight > radius * 1.5) return;
            const capacity = getCtoPortCapacity(cto);
            const used = getOccupiedPorts(cto).size;
            const free = capacity ? capacity - used : null;
            const street = straight * VIABILITY_STREET_FACTOR;
            const status = street > radius ? 'longe' : free === 0 ? 'cheia' : 'ok';
            out.push({ cto, root, straight, street, capacity, used, free, status });
        });
    });
    const rank = { ok: 0, cheia: 1, longe: 2 };
    return out.sort((a, b) => rank[a.status] - rank[b.status] || a.street - b.street).slice(0, 6);
}

function runViability(point) {
    viability.point = point;
    viability.results = findViableCtos(point, viability.radius);
    clearViabilityOverlays();
    viability.overlays.push(new google.maps.Marker({
        map, position: point, zIndex: 90, clickable: false,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 },
    }));
    viability.overlays.push(new google.maps.Circle({
        map, center: point, radius: viability.radius / VIABILITY_STREET_FACTOR, clickable: false, zIndex: 30,
        strokeColor: '#2563eb', strokeOpacity: 0.5, strokeWeight: 1, fillColor: '#2563eb', fillOpacity: 0.06,
    }));
    const colors = { ok: '#16a34a', cheia: '#dc2626', longe: '#94a3b8' };
    viability.results.slice(0, 3).forEach(r => {
        const box = r.root.querySelector(':scope > .folder-title .visibility-toggle-btn');
        if (box && !box.checked) handleVisibilityToggle(box, true);
        viability.overlays.push(new google.maps.Polyline({
            map, path: [point, r.cto.marker.getPosition()], clickable: false, zIndex: 88, strokeOpacity: 0,
            icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: colors[r.status], strokeWeight: 3, scale: 3 }, offset: '0', repeat: '10px' }],
        }));
    });
    renderViability();
}

function renderViability() {
    const body = document.getElementById('viabilityBody');
    if (!body) return;
    const esc = (v) => escapeHtml(String(v ?? ''));
    const fmt = (v) => Math.round(v).toLocaleString('pt-BR');
    const radius = `<div class="map-tool-field"><label>Drop até</label><div class="map-tool-segmented viability-radius" role="radiogroup">${VIABILITY_RADII.map(r => `<button type="button" data-viab="radius" data-r="${r}" class="${r === viability.radius ? 'is-active' : ''}" aria-pressed="${r === viability.radius}">${r} m</button>`).join('')}</div></div>`;
    if (!viability.point) {
        body.innerHTML = `${radius}<p class="viability-hint">Clique no mapa onde fica o cliente (use <b>Localizar</b> para achar o endereço). Aparecem as CTOs por perto, com as portas livres.</p>`;
        return;
    }
    const best = viability.results.find(r => r.status === 'ok');
    const verdict = best
        ? `<div class="viability-verdict is-ok"><b>Viável</b><span>${esc(best.cto.name)} a ≈ ${fmt(best.street)} m${best.free != null ? `, ${best.free} ${best.free === 1 ? 'porta livre' : 'portas livres'}` : ''}</span></div>`
        : `<div class="viability-verdict is-no"><b>Sem viabilidade</b><span>Nenhuma CTO com porta livre num drop de até ${viability.radius} m.</span></div>`;
    const label = { ok: 'Atende', cheia: 'Sem porta', longe: 'Longe' };
    const rows = viability.results.map((r, i) => `
        <li class="viability-row is-${r.status}">
            <button type="button" class="viability-row__main" data-viab="focus" data-i="${i}">
                <b>${esc(r.cto.name)}</b>
                <small>≈ ${fmt(r.street)} m pela rua · ${r.capacity ? `${r.free} de ${r.capacity} livres` : `${r.used} cliente(s), sem splitter`}</small>
            </button>
            <span class="viability-row__tag">${label[r.status]}</span>
            ${AppSession.canEdit && r.status === 'ok' ? `<button type="button" class="map-tool-btn viability-row__add" data-viab="client" data-i="${i}">+ Cliente</button>` : ''}
        </li>`).join('');
    body.innerHTML = `${radius}${verdict}
        ${rows ? `<ul class="viability-list">${rows}</ul>` : '<p class="viability-hint">Nenhuma CTO da rede perto daqui.</p>'}
        <p class="viability-hint">Clique em outro ponto do mapa para consultar de novo. A distância pela rua é estimada (1,3 × a linha reta).</p>`;
}

function handleViabilityClick(e) {
    const el = e.target.closest('[data-viab]');
    if (!el) return;
    const kind = el.dataset.viab;
    if (kind === 'radius') {
        viability.radius = Number(el.dataset.r);
        if (viability.point) runViability(viability.point);
        else renderViability();
        return;
    }
    const r = viability.results[Number(el.dataset.i)];
    if (!r) return;
    if (kind === 'focus') { focusNetworkItem(r.cto); return; }
    if (kind === 'client') startViabilityClient(r);
}

//"+ Cliente": abre o cadastro já ligado nessa CTO; ao confirmar, o cliente fica no ponto consultado
function startViabilityClient(result) {
    if (!requireEdit('cadastrar clientes')) return;
    setActiveFolder(result.cto.folderId);
    pendingMarkerPosition = viability.point;
    openClientModal(null);
    const select = document.getElementById('clientCto');
    select.value = ensureMarkerUid(result.cto);
    populateClientPortSelect();
    updateClientDropSummary();
}

// ---------------------------------------------------------------
// Ligações
// ---------------------------------------------------------------

appReady.then(() => {
    const on = (id, fn) => document.getElementById(id)?.addEventListener('click', (e) => { e.preventDefault(); fn(); });
    on('networkPanelButton', () => openNetworkPanel('resumo'));
    on('networkHistoryButton', () => openNetworkPanel('historico'));
    on('networkViabilityButton', startViability);
    on('networkCheckButton', async () => { if (await ensureActiveNetworkCity('verificar a rede')) openProjectCheck(); });
    on('networkImpactMenuButton', async () => { if (await ensureActiveNetworkCity('ver o impacto de um rompimento')) openNetworkImpact(); });
    on('networkExportXlsxButton', async () => { if (await ensureActiveNetworkCity('exportar a planilha')) exportProjectSpreadsheet(); });
    on('networkExportFusionButton', async () => { if (await ensureActiveNetworkCity('exportar os planos de fusão')) exportProjectFusionPlans(); });
    on('networkAddClientButton', async () => {
        if (!requireEdit('cadastrar clientes')) return;
        if (await ensureActiveNetworkCity('cadastrar o cliente')) openClientModal(null);
    });
    on('closeNetworkPanelBox', () => document.getElementById('networkPanelBox').classList.add('hidden'));
    on('closeViabilityBox', () => document.getElementById('viabilityBox').classList.add('hidden'));
    document.getElementById('networkPanelBody')?.addEventListener('click', handleNetworkPanelClick);
    document.getElementById('networkPanelBody')?.addEventListener('change', (e) => {
        if (e.target.dataset.netPanel !== 'city') return;
        const root = document.getElementById(e.target.value)?.closest('.folder');
        if (!root) return;
        loadNetworkRoot(e.target.value).then(() => {
            networkDocs.panelRootId = e.target.value;
            setActiveFolder(e.target.value);
            renderNetworkPanel();
        });
    });
    document.getElementById('viabilityBody')?.addEventListener('click', handleViabilityClick);
    //Fechou a caixa da viabilidade (X, Esc ou trocou de modo): para de ouvir o mapa e limpa o desenho
    const viabilityBox = document.getElementById('viabilityBox');
    if (viabilityBox) new MutationObserver(() => { if (viabilityBox.classList.contains('hidden') && viability.active) stopViability(); })
        .observe(viabilityBox, { attributes: true, attributeFilter: ['class'] });
    //Saiu do modo Rede: fecha o painel e a viabilidade
    new MutationObserver(() => {
        if (document.body.classList.contains('mode-rede')) return;
        document.getElementById('networkPanelBox')?.classList.add('hidden');
        viabilityBox?.classList.add('hidden');
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    //O painel acompanha as mudanças da rede (marcadores, clientes, portas)
    let panelTimer = null;
    new MutationObserver(() => { clearTimeout(panelTimer); panelTimer = setTimeout(renderNetworkPanel, 400); })
        .observe(document.getElementById('sidebar'), { childList: true, subtree: true });
});
