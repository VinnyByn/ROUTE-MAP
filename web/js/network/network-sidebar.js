// Barra lateral da rede (modo Rede). A rede é a documentação da empresa:
// - "Por tipo": dentro de cada cidade, uma pasta automática para cada tipo (POPs, CEOs, CTOs, reservas, cabos, clientes)
//   com a quantidade e um resumo (portas livres, km, clientes instalados); mostra/oculta o tipo inteiro e lista os itens.
// - Um item em várias pastas sem duplicar no mapa: o item mora numa pasta (folderId) e aparece como atalho nas outras
//   (alsoIn). Pelo menu do item ("Também em outras pastas…") ou arrastando com Ctrl/Alt para a pasta.
// - Salva sozinha: cada alteração na rede é gravada alguns segundos depois, com a situação ao lado do nome da cidade.
// - Exclusão só com confirmação: a cidade pede o nome digitado (vai para a lixeira); a pasta pergunta o que fazer com o
//   que está dentro.
// Depende de js/app.js, js/projects/sidebar.js, js/projects/network-mode.js e js/network/network-docs.js.

const NETWORK_AUTOSAVE_MS = 2500;
const NETWORK_AUTOSAVE_RETRY_MS = 30000;
const NET_TYPE_STORAGE = 'routeMapNetTypes';
const NET_TYPE_GROUPS = [
    { key: 'POP', label: 'POPs' },
    { key: 'CEO', label: 'CEOs' },
    { key: 'CTO', label: 'CTOs' },
    { key: 'RESERVA', label: 'Reservas técnicas' },
    { key: 'CABO', label: 'Cabos' },
    { key: 'CLIENTE', label: 'Clientes' },
    { key: 'OUTROS', label: 'Outros marcadores' },
];
const NET_TYPE_ITEMS_MAX = 300;
const netSidebar = { open: {}, timers: new Map(), baseline: new Map(), saving: new Set(), retry: new Map() };

try { netSidebar.open = JSON.parse(localStorage.getItem(NET_TYPE_STORAGE) || '{}') || {}; } catch (e) { netSidebar.open = {}; }

function getNetTypeState(cityId) {
    const s = netSidebar.open[cityId] || (netSidebar.open[cityId] = { open: true, groups: [] });
    return s;
}

function storeNetTypeState() {
    try { localStorage.setItem(NET_TYPE_STORAGE, JSON.stringify(netSidebar.open)); } catch (e) { /* ignora */ }
}

const getFolderNameById = (folderId) => document.getElementById(folderId)?.previousElementSibling?.dataset.folderName || '';
//Pastas das redes abertas: calculadas uma vez por rodada de trabalho (antes era por item, pesado em redes grandes)
let networkFolderCache = null;
function getNetworkFolderSet() {
    if (!networkFolderCache) {
        networkFolderCache = new Set(typeof getNetworkRoots === 'function' ? getNetworkRoots().flatMap(r => getAllDescendantFolderIds(getRootId(r))) : []);
        setTimeout(() => { networkFolderCache = null; }, 0);
    }
    return networkFolderCache;
}
const isNetworkItem = (info) => !!info?.folderId && getNetworkFolderSet().has(info.folderId);
const getItemRow = (info) => info?.listItem || info?.item || null;
const getItemShape = (info) => info?.marker || info?.polyline || null;
//Clientes no modo Rede: sem drop no mapa e ocultos (pesa e polui); aparecem pela caixa ("Mostrar clientes no mapa"),
//pela pasta por tipo "Clientes" ou ao clicar no cliente na barra lateral. Na CTO, o splitter mostra o nome em cada porta.
const networkClientsShown = { all: false, ctos: new Set(), uids: new Set() };
function isNetworkClientHidden(info) {
    if (info?.type !== 'CLIENTE' || typeof appMode === 'undefined' || appMode !== 'rede' || !isNetworkItem(info)) return false;
    return !networkClientsShown.all && !networkClientsShown.ctos.has(info.client?.ctoUid) && !networkClientsShown.uids.has(info.uid);
}
function applyNetworkClientVisibility() {
    markers.forEach(m => { if (m.type === 'CLIENTE' && m.marker?.getVisible() !== false && isNetworkClientHidden(m)) m.marker.setVisible(false); });
}
function setCtoClientsShown(cto, shown) {
    if (!cto?.uid) return;
    if (shown) networkClientsShown.ctos.add(cto.uid); else networkClientsShown.ctos.delete(cto.uid);
    const root = typeof getNetworkRootOf === 'function' ? getNetworkRootOf(cto) : null;
    const cityBox = root?.querySelector(':scope > .folder-title .visibility-toggle-btn');
    if (shown && cityBox && !cityBox.checked) { cityBox.checked = true; cityBox.dataset.visible = 'true'; }
    getCtoClients(cto).forEach(c => c.marker?.setVisible(!isNetworkClientHidden(c)));
}
const findItemByUid = (uid) => markers.find(m => m.uid === uid) || savedCables.find(c => c.uid === uid) || null;

function getItemIconClass(info) {
    return savedCables.includes(info) ? 'ge-icon-path' : getMarkerSidebarIconClass(info.type);
}

// ---------------------------------------------------------------
// Pastas por tipo
// ---------------------------------------------------------------

function getNetworkTypeGroups(root) {
    const scope = getNetworkScope(root);
    const known = new Set(NET_TYPE_GROUPS.map(g => g.key));
    const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', { numeric: true });
    return NET_TYPE_GROUPS.map(g => {
        const items = g.key === 'CABO' ? scope.cables
            : g.key === 'OUTROS' ? scope.markers.filter(m => !known.has(m.type) && m.type !== 'CASA')
            : scope.markers.filter(m => m.type === g.key);
        return { ...g, items: [...items].sort(byName) };
    }).filter(g => g.items.length);
}

//Portas em uso de cada CTO numa passada só (a barra lateral redesenha a cada mudança: em redes grandes, getOccupiedPorts
//por CTO percorreria todos os marcadores de novo para cada uma)
function buildCtoOccupancyIndex() {
    const index = new Map();
    markers.forEach(m => {
        if (m.type !== 'CLIENTE' || !m.client?.ctoUid || !m.client.ctoPort || m.client.status === 'cancelado') return;
        if (!index.has(m.client.ctoUid)) index.set(m.client.ctoUid, new Set());
        index.get(m.client.ctoUid).add(Number(m.client.ctoPort));
    });
    return index;
}

function describeNetworkTypeGroup(g, occupancy) {
    const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
    if (g.key === 'CTO') {
        let ports = 0, used = 0, full = 0;
        g.items.forEach(cto => {
            const capacity = getCtoPortCapacity(cto);
            if (!capacity) return;
            const n = occupancy.get(cto.uid)?.size || 0;
            ports += capacity;
            used += Math.min(n, capacity);
            if (n >= capacity) full++;
        });
        return ports ? `${fmt(ports - used)} portas livres${full ? ` · ${full} lotada${full === 1 ? '' : 's'}` : ''}` : 'sem splitter';
    }
    if (g.key === 'CABO') {
        const km = g.items.reduce((s, c) => s + (Number(c.totalLength) || 0), 0) / 1000;
        return `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
    }
    if (g.key === 'CLIENTE') {
        const inst = g.items.filter(c => c.client?.status === 'instalado').length;
        const todo = g.items.filter(c => c.client?.status === 'a_instalar' || c.client?.status === 'viabilidade').length;
        return [inst ? `${fmt(inst)} instalado${inst === 1 ? '' : 's'}` : '', todo ? `${fmt(todo)} a instalar` : ''].filter(Boolean).join(' · ');
    }
    return '';
}

function describeNetworkTypeItem(info, key, occupancy) {
    const parts = [getFolderNameById(info.folderId)];
    if (key === 'CTO') {
        const capacity = getCtoPortCapacity(info);
        if (capacity) parts.unshift(`${occupancy.get(info.uid)?.size || 0}/${capacity}`);
    }
    if (key === 'CABO' && info.totalLength) parts.unshift(`${Math.round(info.totalLength).toLocaleString('pt-BR')} m`);
    if (key === 'CLIENTE') parts.unshift(getClientStatus(info.client?.status).label);
    return parts.filter(Boolean).join(' · ');
}

const getGroupVisibility = (items) => {
    const shown = items.filter(i => getItemShape(i)?.getVisible?.() !== false).length;
    return shown === items.length ? 'all' : shown ? 'some' : 'none';
};

function renderNetworkTypeGroups(root) {
    const id = getRootId(root);
    const ul = document.getElementById(id);
    if (!ul) return;
    let box = ul.querySelector(':scope > .net-types');
    const groups = getNetworkTypeGroups(root);
    if (!groups.length) { box?.remove(); return; }
    const state = getNetTypeState(id);
    const openGroups = new Set(state.groups);
    const occupancy = buildCtoOccupancyIndex();
    const view = groups.map(g => ({
        key: g.key, label: g.label, count: g.items.length, meta: describeNetworkTypeGroup(g, occupancy), vis: getGroupVisibility(g.items),
        color: g.items[0]?.color || '', open: openGroups.has(g.key),
        items: openGroups.has(g.key) ? g.items.slice(0, NET_TYPE_ITEMS_MAX).map(i => [i.uid, i.name, describeNetworkTypeItem(i, g.key, occupancy), i.color || '', getItemIconClass(i)]) : null,
        more: Math.max(0, g.items.length - NET_TYPE_ITEMS_MAX),
    }));
    const sig = JSON.stringify([state.open, view]);
    if (!box) {
        box = document.createElement('li');
        box.className = 'net-types';
        box.dataset.cityId = id;
    }
    if (ul.firstElementChild !== box) ul.prepend(box);
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    const esc = (v) => escapeHtml(String(v ?? ''));
    const total = view.reduce((s, g) => s + g.count, 0);
    box.innerHTML = `
        <button type="button" class="net-types__head" data-net-types="toggle" aria-expanded="${state.open}">
            <span class="net-types__chev" aria-hidden="true"></span><span>Por tipo</span><small>${total.toLocaleString('pt-BR')} ${total === 1 ? 'item' : 'itens'} · automático</small>
        </button>
        <ul class="net-types__list"${state.open ? '' : ' hidden'}>${view.map(g => `
            <li class="net-type${g.open ? ' is-open' : ''}" data-type="${esc(g.key)}">
                <div class="net-type__row" data-net-types="group">
                    <span class="net-type__chev" aria-hidden="true"></span>
                    <input type="checkbox" class="net-type__vis" data-net-types="vis" title="Mostrar ou ocultar ${esc(g.label.toLowerCase())} no mapa" ${g.vis === 'none' ? '' : 'checked'} data-mixed="${g.vis === 'some'}">
                    <span class="ge-item-icon ${g.key === 'CABO' ? 'ge-icon-path' : getMarkerSidebarIconClass(g.key === 'OUTROS' ? 'Importado' : g.key)}" style="${g.color ? `--ge-item-color:${esc(g.color)}` : ''}" aria-hidden="true"></span>
                    <span class="net-type__name">${esc(g.label)}</span>
                    ${g.meta ? `<span class="net-type__meta">${esc(g.meta)}</span>` : ''}
                    <b class="net-type__count">${g.count.toLocaleString('pt-BR')}</b>
                </div>
                ${g.items ? `<ul class="net-type__items">${g.items.map(([uid, name, meta, color, icon]) => `
                    <li class="net-type__item" data-uid="${esc(uid)}" title="Clique: mostra no mapa · Duplo clique: abre">
                        <span class="ge-item-icon ${esc(icon)}" style="${color ? `--ge-item-color:${esc(color)}` : ''}" aria-hidden="true"></span>
                        <span class="net-type__item-name">${esc(name)}</span>
                        <small>${esc(meta)}</small>
                    </li>`).join('')}${g.more ? `<li class="net-type__more">e mais ${g.more.toLocaleString('pt-BR')}…</li>` : ''}</ul>` : ''}
            </li>`).join('')}
        </ul>`;
    box.querySelectorAll('.net-type__vis[data-mixed="true"]').forEach(cb => { cb.indeterminate = true; });
}

function setNetworkTypeVisible(root, key, visible) {
    if (key === 'CLIENTE') networkClientsShown.all = visible;
    const group = getNetworkTypeGroups(root).find(g => g.key === key);
    group?.items.forEach(info => {
        const cb = getItemRow(info)?.querySelector(':scope > .ge-vis-checkbox');
        if (cb && cb.checked !== visible) {
            cb.checked = visible;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (!cb) getItemShape(info)?.setVisible(visible);
    });
    //A cidade oculta no mapa: mostrar um tipo também mostra a cidade (só o que estava marcado aparece)
    if (visible) {
        const cityBox = root.querySelector(':scope > .folder-title .visibility-toggle-btn');
        if (cityBox && !cityBox.checked) { cityBox.checked = true; cityBox.dataset.visible = 'true'; }
    }
    renderNetworkTypeGroups(root);
}

function handleNetworkTypesClick(e) {
    const box = e.target.closest('.net-types');
    if (!box) return false;
    const root = document.getElementById(box.dataset.cityId)?.closest('.folder');
    if (!root) return true;
    const state = getNetTypeState(box.dataset.cityId);
    const item = e.target.closest('.net-type__item');
    if (item) {
        const info = findItemByUid(item.dataset.uid);
        if (!info) return true;
        box.querySelectorAll('.net-type__item.is-active').forEach(el => el.classList.remove('is-active'));
        item.classList.add('is-active');
        if (e.type === 'dblclick') {
            if (savedCables.includes(info)) openCableEditor(info);
            else openMarkerFromUserAction(info);
        } else focusNetworkItem(info);
        return true;
    }
    if (e.type !== 'click') return true;
    const action = e.target.closest('[data-net-types]')?.dataset.netTypes;
    if (action === 'vis') {
        const type = e.target.closest('.net-type').dataset.type;
        setNetworkTypeVisible(root, type, e.target.checked);
        return true;
    }
    if (action === 'toggle') {
        state.open = !state.open;
    } else if (action === 'group') {
        const type = e.target.closest('.net-type').dataset.type;
        const groups = new Set(state.groups);
        if (groups.has(type)) groups.delete(type); else groups.add(type);
        state.groups = [...groups];
    } else return true;
    storeNetTypeState();
    renderNetworkTypeGroups(root);
    return true;
}

// ---------------------------------------------------------------
// Um item em várias pastas (atalhos), sem duplicar no mapa
// ---------------------------------------------------------------

function getItemLinks(info) {
    return (info.alsoIn || []).filter(f => f && f !== info.folderId && document.getElementById(f));
}

function renderNetworkLinks(root) {
    const id = getRootId(root);
    const folders = new Set(getAllDescendantFolderIds(id));
    const want = new Map();
    [...markers, ...savedCables].forEach(info => {
        if (!info.alsoIn?.length || !folders.has(info.folderId)) return;
        getItemLinks(info).forEach(f => { if (folders.has(f)) want.set(`${f}|${info.uid}`, { info, folderId: f }); });
    });
    root.querySelectorAll('.net-link-item').forEach(li => {
        const key = `${li.dataset.linkFolder}|${li.dataset.linkUid}`;
        const entry = want.get(key);
        if (!entry || li.parentElement?.id !== li.dataset.linkFolder) { li.remove(); return; }
        want.delete(key);
        fillNetworkLinkRow(li, entry.info);
    });
    want.forEach(({ info, folderId }) => {
        const li = document.createElement('li');
        li.className = 'net-link-item sidebar-tree-item';
        li.dataset.linkUid = info.uid;
        li.dataset.linkFolder = folderId;
        li.innerHTML = `<span class="ge-expand-spacer" aria-hidden="true"></span><span class="net-link-item__arrow" aria-hidden="true">↗</span>
            <span class="ge-item-icon" aria-hidden="true"></span><span class="item-name"></span><span class="item-meta"></span>
            <div class="ge-pro-actions"><button type="button" class="item-actions-toggle-btn" title="Ações" aria-label="Ações" aria-haspopup="menu">&#8942;</button></div>`;
        fillNetworkLinkRow(li, info);
        document.getElementById(folderId)?.appendChild(li);
    });
}

function fillNetworkLinkRow(li, info) {
    const icon = li.querySelector('.ge-item-icon');
    const cls = `ge-item-icon ${getItemIconClass(info)}`;
    if (icon.className !== cls) icon.className = cls;
    if (info.color && icon.style.getPropertyValue('--ge-item-color') !== info.color) icon.style.setProperty('--ge-item-color', info.color);
    const name = li.querySelector('.item-name');
    if (name.textContent !== (info.name || '')) name.textContent = info.name || '';
    const meta = `atalho · fica em ${getFolderNameById(info.folderId) || 'outra pasta'}`;
    const metaEl = li.querySelector('.item-meta');
    if (metaEl.textContent !== meta) metaEl.textContent = meta;
    const title = `${info.name}: aparece aqui também, sem duplicar no mapa. Fica na pasta "${getFolderNameById(info.folderId)}".`;
    if (li.title !== title) li.title = title;
}

function setItemLinks(info, folderIds) {
    const next = [...new Set(folderIds)].filter(f => f && f !== info.folderId && document.getElementById(f));
    if (next.length) info.alsoIn = next; else delete info.alsoIn;
    const root = getNetworkRootOf(info);
    if (root) {
        renderNetworkLinks(root);
        scheduleSidebarCounts();
        scheduleNetworkAutosave(getRootId(root));
    }
}

function addNetworkLink(info, folderId) {
    if (!requireEdit('organizar a rede em pastas')) return false;
    if (!folderId || folderId === info.folderId || getItemLinks(info).includes(folderId)) return false;
    setItemLinks(info, [...getItemLinks(info), folderId]);
    showToast(`${info.name} também em "${getFolderNameById(folderId)}"`, 'Aparece nas duas pastas, sem duplicar no mapa.');
    return true;
}

function removeNetworkLink(info, folderId) {
    if (!requireEdit('organizar a rede em pastas')) return;
    setItemLinks(info, getItemLinks(info).filter(f => f !== folderId));
    showToast('Atalho tirado', `${info.name} continua na pasta "${getFolderNameById(info.folderId)}" e no mapa.`);
}

//Arrastar com Ctrl ou Alt para outra pasta da mesma cidade: cria o atalho em vez de mover (js/projects/sidebar.js)
function addNetworkLinkFromDrop(dragged, target) {
    const info = markers.find(m => m.listItem === dragged) || savedCables.find(c => c.item === dragged);
    if (!info || !target) return false;
    const root = getNetworkRootOf(info);
    if (!root) return false;
    const ul = target.mode === 'into' ? target.ul : target.parent;
    if (!ul?.id || !getAllDescendantFolderIds(getRootId(root)).includes(ul.id)) return false;
    if (ul.id === info.folderId) return true;
    addNetworkLink(info, ul.id);
    return true;
}

//Janela "Também em outras pastas…": marca as pastas da cidade onde o item aparece
function openNetworkLinkFolders(info) {
    if (!requireEdit('organizar a rede em pastas')) return;
    const root = getNetworkRootOf(info);
    if (!root) return;
    const folders = [];
    const walk = (ul, depth) => {
        const title = ul.previousElementSibling;
        folders.push({ id: ul.id, name: title?.dataset.folderName || '', depth });
        ul.querySelectorAll(':scope > .folder-wrapper > ul.subfolders').forEach(sub => walk(sub, depth + 1));
    };
    walk(document.getElementById(getRootId(root)), 0);
    const current = new Set(getItemLinks(info));
    let modal = document.getElementById('netLinkModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'netLinkModal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    const esc = (v) => escapeHtml(String(v ?? ''));
    modal.innerHTML = `
        <div class="modal-content net-link-modal" role="dialog" aria-labelledby="netLinkTitle">
            <div class="modal-header-v2 rm-head rm-head--rede">
                <span class="rm-head__icon"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-folder-plus"></use></svg></span>
                <div class="rm-head__text">
                    <h2 id="netLinkTitle">${esc(info.name)} em outras pastas</h2>
                    <p class="rm-head__sub">No mapa continua um só; ao editar em qualquer pasta, muda em todas</p>
                </div>
            </div>
            <div class="modal-body-content">
                <p class="net-link-modal__hint">Marque as pastas onde ele também deve aparecer. Dica: arraste o item com <kbd>Ctrl</kbd> para uma pasta.</p>
                <ul class="net-link-modal__list">${folders.map(f => {
                    const home = f.id === info.folderId;
                    return `<li style="--depth:${f.depth}"><label class="${home ? 'is-home' : ''}">
                        <input type="checkbox" value="${esc(f.id)}" ${home || current.has(f.id) ? 'checked' : ''} ${home ? 'disabled' : ''}>
                        <span class="ge-folder-icon" aria-hidden="true"></span><span>${esc(f.name)}</span>${home ? '<small>pasta dele</small>' : ''}</label></li>`;
                }).join('')}</ul>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-net-link="cancel">Cancelar</button>
                <button type="button" class="btn btn-success" data-net-link="ok">Salvar</button>
            </div>
        </div>`;
    modal.style.display = 'flex';
    modal.onclick = (e) => {
        const action = e.target.closest('[data-net-link]')?.dataset.netLink;
        if (e.target === modal || action === 'cancel') { modal.style.display = 'none'; return; }
        if (action !== 'ok') return;
        const chosen = [...modal.querySelectorAll('input:checked:not(:disabled)')].map(i => i.value);
        modal.style.display = 'none';
        setItemLinks(info, chosen);
        showToast('Pastas atualizadas', chosen.length ? `${info.name} aparece em ${chosen.length + 1} pastas, sem duplicar no mapa.` : `${info.name} fica só na pasta dele.`);
    };
}

// ---------------------------------------------------------------
// Salva sozinha
// ---------------------------------------------------------------

function canAutosaveNetwork() {
    return AppSession.canEdit || AppSession.isTecnico;
}

function getNetworkSaveJson(root) {
    try {
        const { changeLog, ...data } = buildProjectRecord(root).data;
        return JSON.stringify(data);
    } catch (e) {
        return null;
    }
}

function setNetworkSaveState(id, state, detail = '') {
    const title = document.getElementById(id)?.previousElementSibling;
    if (!title) return;
    let chip = title.querySelector(':scope > .net-save-state');
    if (!chip) {
        chip = document.createElement('span');
        chip.className = 'net-save-state';
        chip.setAttribute('role', 'status');
        (title.querySelector(':scope > .project-type-tag') || title.querySelector(':scope > .folder-name-text'))?.after(chip);
    }
    const text = { salva: 'Salva', pendente: 'Alterada', salvando: 'Salvando…', erro: 'Não salvou' }[state] || '';
    if (chip.dataset.state !== state) chip.dataset.state = state;
    if (chip.textContent !== text) chip.textContent = text;
    const tip = detail || { salva: 'Tudo salvo: a rede se salva sozinha a cada alteração.', pendente: 'Salvando em instantes…', salvando: 'Salvando a rede…', erro: 'Não foi possível salvar.' }[state] || '';
    if (chip.title !== tip) chip.title = tip;
}

//Ponto de partida depois de abrir ou salvar: só o que mudar daqui em diante é salvo
function markNetworkBaseline(id) {
    const root = document.getElementById(id)?.closest('.folder');
    if (!root || isPendingNetworkRoot(root)) return;
    const json = getNetworkSaveJson(root);
    if (json !== null) netSidebar.baseline.set(id, json);
    if (canAutosaveNetwork()) setNetworkSaveState(id, 'salva');
}

//Rede gravada (js/network/network-docs.js → commitNetworkSave)
function rememberNetworkSaved(record) {
    const { changeLog, ...data } = record.data || {};
    netSidebar.baseline.set(record.id, JSON.stringify(data));
    clearTimeout(netSidebar.retry.get(record.id));
    if (canAutosaveNetwork()) setNetworkSaveState(record.id, 'salva', `Salva às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`);
}

function scheduleNetworkAutosave(id, delay = NETWORK_AUTOSAVE_MS) {
    if (!id || !isNetworkProjectId(id) || !canAutosaveNetwork()) return;
    //Alteração que chegou de outra pessoa (edição ao vivo): quem fez é quem salva
    if (typeof LIVE !== 'undefined' && LIVE.applying) return;
    const root = document.getElementById(id)?.closest('.folder');
    if (!root || isPendingNetworkRoot(root)) return;
    clearTimeout(netSidebar.timers.get(id));
    netSidebar.timers.set(id, setTimeout(() => runNetworkAutosave(id), delay));
    if (!netSidebar.saving.has(id)) setNetworkSaveState(id, 'pendente');
}

function hasNetworkChanges(id) {
    const root = document.getElementById(id)?.closest('.folder');
    if (!root || isPendingNetworkRoot(root)) return false;
    if (!netSidebar.baseline.has(id)) return false;
    return getNetworkSaveJson(root) !== netSidebar.baseline.get(id);
}

async function runNetworkAutosave(id) {
    netSidebar.timers.delete(id);
    const root = document.getElementById(id)?.closest('.folder');
    if (!root || isPendingNetworkRoot(root) || !canAutosaveNetwork()) return true;
    if (netSidebar.saving.has(id)) { scheduleNetworkAutosave(id); return true; }
    if (!netSidebar.baseline.has(id)) { markNetworkBaseline(id); return true; }
    if (!hasNetworkChanges(id)) { setNetworkSaveState(id, 'salva'); return true; }
    netSidebar.saving.add(id);
    setNetworkSaveState(id, 'salvando');
    try {
        await persistProject(root);
        return true;
    } catch (error) {
        if (error instanceof ProjectConflictError) {
            setNetworkSaveState(id, 'erro', 'Outra pessoa salvou esta rede antes.');
            const name = root.querySelector(':scope > .folder-title')?.dataset.folderName || 'Rede';
            return !!(await resolveProjectConflict(root, name, error.info));
        }
        console.error('Erro ao salvar a rede:', error);
        setNetworkSaveState(id, 'erro', `Não salvou (${error.message || 'sem conexão'}). Tenta de novo em 30 s.`);
        clearTimeout(netSidebar.retry.get(id));
        netSidebar.retry.set(id, setTimeout(() => scheduleNetworkAutosave(id, 0), NETWORK_AUTOSAVE_RETRY_MS));
        return false;
    } finally {
        netSidebar.saving.delete(id);
    }
}

//Outra pessoa salvou esta cidade (edição ao vivo): sem alteração nossa esperando, o salvo vira o ponto de partida
function onNetworkSavedElsewhere(id) {
    if (!isNetworkProjectId(id) || netSidebar.timers.has(id) || netSidebar.saving.has(id)) return;
    markNetworkBaseline(id);
}

//Antes de trocar de modo: grava o que faltou, sem perguntar
async function flushNetworkAutosave(root) {
    const id = getRootId(root);
    clearTimeout(netSidebar.timers.get(id));
    netSidebar.timers.delete(id);
    while (netSidebar.saving.has(id)) await new Promise(r => setTimeout(r, 100));
    if (!netSidebar.baseline.has(id) || hasNetworkChanges(id)) return runNetworkAutosave(id).then(ok => ok !== false);
    return true;
}

const hasPendingNetworkSaves = () => netSidebar.timers.size > 0 || netSidebar.saving.size > 0
    || getNetworkRoots().some(r => !isPendingNetworkRoot(r) && hasNetworkChanges(getRootId(r)));

// ---------------------------------------------------------------
// Excluir só com confirmação
// ---------------------------------------------------------------

const foldTypedText = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

//Confirmação digitando uma palavra (o nome da cidade ou EXCLUIR); resolve true se confirmou
function confirmByTyping({ title, message, word, confirmLabel = 'Excluir' }) {
    let modal = document.getElementById('typedConfirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'typedConfirmModal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    const esc = (v) => escapeHtml(String(v ?? ''));
    modal.innerHTML = `
        <div class="modal-content typed-confirm" role="alertdialog" aria-labelledby="typedConfirmTitle">
            <div class="modal-header-v2 rm-head rm-head--occ">
                <span class="rm-head__icon"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-trash"></use></svg></span>
                <div class="rm-head__text"><h2 id="typedConfirmTitle">${esc(title)}</h2><p class="rm-head__sub">Esta exclusão pede confirmação</p></div>
            </div>
            <div class="modal-body-content">
                <p class="typed-confirm__msg">${esc(message)}</p>
                <label for="typedConfirmInput">Para confirmar, digite <b>${esc(word)}</b></label>
                <input type="text" id="typedConfirmInput" autocomplete="off" spellcheck="false" />
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-typed="cancel">Cancelar</button>
                <button type="button" class="btn btn-danger" data-typed="ok" disabled>${esc(confirmLabel)}</button>
            </div>
        </div>`;
    const input = modal.querySelector('input');
    const ok = modal.querySelector('[data-typed="ok"]');
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 50);
    return new Promise(resolve => {
        const finish = (value) => { modal.style.display = 'none'; document.removeEventListener('keydown', onKey, true); resolve(value); };
        const matches = () => foldTypedText(input.value) === foldTypedText(word);
        input.addEventListener('input', () => { ok.disabled = !matches(); });
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
            if (e.key === 'Enter' && e.target === input && matches()) { e.preventDefault(); finish(true); }
        };
        document.addEventListener('keydown', onKey, true);
        modal.onclick = (e) => {
            const action = e.target.closest('[data-typed]')?.dataset.typed;
            if (e.target === modal || action === 'cancel') finish(false);
            if (action === 'ok' && matches()) finish(true);
        };
    });
}

function describeNetworkScopeCounts(markersIn, cablesIn) {
    const boxes = markersIn.filter(m => FIELD_BOX_TYPES.includes(m.type)).length;
    const clients = markersIn.filter(m => m.type === 'CLIENTE').length;
    return [
        boxes ? `${boxes} caixa${boxes === 1 ? '' : 's'}` : '',
        cablesIn.length ? `${cablesIn.length} cabo${cablesIn.length === 1 ? '' : 's'}` : '',
        clients ? `${clients} cliente${clients === 1 ? '' : 's'}` : '',
        markersIn.length - boxes - clients > 0 ? `${markersIn.length - boxes - clients} outro${markersIn.length - boxes - clients === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(', ');
}

async function confirmDeleteNetworkCity(entity) {
    if (!requireEdit('excluir cidades da rede')) return;
    const id = entity.folderId;
    const city = (entity.title.dataset.folderCity && entity.title.dataset.folderCity !== 'null' ? entity.title.dataset.folderCity : entity.name.replace(/^Rede · /, '')).trim();
    if (isPendingNetworkRoot(entity.container)) await loadNetworkRoot(id);
    const root = document.getElementById(id)?.closest('.folder');
    if (!root) return;
    const scope = getNetworkScope(root);
    const what = describeNetworkScopeCounts(scope.markers, scope.cables) || 'nada cadastrado ainda';
    const ok = await confirmByTyping({
        title: 'Excluir a rede da cidade',
        message: `A rede de ${city} (${what}) sai da documentação da empresa para toda a equipe. Ela fica na lixeira por 30 dias (Projeto → Abrir projeto → Lixeira) e pode ser restaurada.`,
        word: city,
        confirmLabel: 'Excluir a cidade',
    });
    if (!ok) return;
    clearTimeout(netSidebar.timers.get(id));
    netSidebar.timers.delete(id);
    await trashProject(id, root, entity.name);
}

//Pasta da rede: pergunta o que fazer com o que está dentro
async function confirmDeleteNetworkFolder(entity) {
    if (!requireEdit('excluir pastas')) return;
    const folderId = entity.folderId;
    const ids = getAllDescendantFolderIds(folderId);
    const inside = { markers: markers.filter(m => ids.includes(m.folderId)), cables: savedCables.filter(c => ids.includes(c.folderId)), polygons: savedPolygons.filter(p => ids.includes(p.folderId)) };
    const subfolders = ids.length - 1;
    const parentUl = entity.container.parentElement;
    const parentName = parentUl?.previousElementSibling?.dataset.folderName || 'pasta de cima';
    const total = inside.markers.length + inside.cables.length + inside.polygons.length;
    if (!total && !subfolders) {
        showConfirm('Excluir pasta', `Excluir a pasta vazia "${entity.name}"?`, () => removeNetworkFolderKeepingItems(entity));
        return;
    }
    const what = [describeNetworkScopeCounts(inside.markers, inside.cables), subfolders ? `${subfolders} subpasta${subfolders === 1 ? '' : 's'}` : ''].filter(Boolean).join(' e ');
    const choice = await showChoice({
        title: `Excluir a pasta "${entity.name}"`,
        message: `Ela tem ${what}.\n\n"Só a pasta" leva tudo o que está dentro para "${parentName}" — nada sai da rede nem do mapa.`,
        choices: [
            { label: 'Cancelar', kind: 'secondary', value: 'cancel' },
            { label: 'Excluir tudo', kind: 'danger', value: 'all' },
            { label: 'Só a pasta', kind: 'primary', value: 'folder' },
        ],
    });
    if (choice === 'folder') { removeNetworkFolderKeepingItems(entity); return; }
    if (choice !== 'all') return;
    const ok = await confirmByTyping({
        title: 'Excluir a pasta e tudo dentro',
        message: `${what} saem da rede e do mapa. Dá para voltar pelo Histórico de versões da cidade.`,
        word: 'EXCLUIR',
        confirmLabel: 'Excluir tudo',
    });
    if (!ok) return;
    removeFolderAndContents(folderId, entity.container);
    showToast('Pasta excluída', `"${entity.name}" e o que estava dentro saíram da rede.`);
    if (typeof refreshClientDrops === 'function') refreshClientDrops();
}

function removeNetworkFolderKeepingItems(entity) {
    const wrapper = entity.container;
    const ul = document.getElementById(entity.folderId);
    const parentUl = wrapper.parentElement;
    if (!ul || !parentUl?.id) return;
    [...ul.children].forEach(child => {
        if (child.classList.contains('net-link-item')) return;
        wrapper.before(child);
    });
    [...markers, ...savedCables, ...savedPolygons].forEach(info => { if (info.folderId === entity.folderId) info.folderId = parentUl.id; });
    [...markers, ...savedCables].forEach(info => { if (info.alsoIn?.includes(entity.folderId)) setItemLinks(info, info.alsoIn.filter(f => f !== entity.folderId)); });
    wrapper.remove();
    if (activeFolderId === entity.folderId) setActiveFolder(parentUl.id);
    scheduleSidebarCounts();
    showToast('Pasta excluída', `O que estava em "${entity.name}" foi para "${parentUl.previousElementSibling?.dataset.folderName || 'a pasta de cima'}".`);
}

// ---------------------------------------------------------------
// Ligações
// ---------------------------------------------------------------

function renderNetworkSidebarExtras() {
    if (typeof getNetworkRoots !== 'function') return;
    getNetworkRoots().forEach(root => {
        if (isPendingNetworkRoot(root)) return;
        renderNetworkTypeGroups(root);
        renderNetworkLinks(root);
    });
}

//Mudanças na estrutura de uma cidade (itens e pastas entrando, saindo ou mudando de nome) disparam o salvamento
function watchNetworkStructure() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const structural = (node) => node.nodeType === 1 && (node.classList.contains('ge-pro-item') || node.classList.contains('folder-wrapper'));
    new MutationObserver((list) => {
        if (typeof LIVE !== 'undefined' && LIVE.applying) return;
        const roots = new Set();
        list.forEach(m => {
            const changed = m.type === 'attributes' || [...m.addedNodes, ...m.removedNodes].some(structural);
            if (!changed) return;
            const root = (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest('#sidebar > .folder');
            const id = root ? getRootId(root) : '';
            if (id && isNetworkProjectId(id) && !isPendingNetworkRoot(root)) roots.add(id);
        });
        roots.forEach(id => scheduleNetworkAutosave(id));
    }).observe(sidebar, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-folder-name'] });
}

appReady.then(() => {
    const sidebar = document.getElementById('sidebar');
    ['click', 'dblclick'].forEach(type => sidebar?.addEventListener(type, (e) => {
        if (handleNetworkTypesClick(e)) e.stopPropagation();
        const link = e.target.closest('.net-link-item');
        if (!link || e.target.closest('.item-actions-toggle-btn')) return;
        const info = findItemByUid(link.dataset.linkUid);
        if (!info) return;
        sidebar.querySelectorAll('.net-link-item.is-active').forEach(el => el.classList.remove('is-active'));
        link.classList.add('is-active');
        if (type === 'dblclick') {
            if (savedCables.includes(info)) openCableEditor(info); else openMarkerFromUserAction(info);
        } else focusNetworkItem(info);
    }));
    watchNetworkStructure();
    window.addEventListener('beforeunload', (e) => {
        if (!canAutosaveNetwork() || !hasPendingNetworkSaves()) return;
        netSidebar.timers.forEach((t, id) => runNetworkAutosave(id));
        e.preventDefault();
        e.returnValue = '';
    });
});
