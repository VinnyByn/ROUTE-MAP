// Barra lateral: rótulos (nome + detalhes), contadores por pasta, menu de ações único
// (três pontinhos e clique direito) para projetos, pastas, marcadores, cabos e polígonos,
// arrastar e soltar com zonas (antes, depois e dentro), rolagem automática, ordem salva
// no projeto e "Padronizar estilo" com prévia ao vivo no mapa. Depende de script.js.

// ---------------------------------------------------------------
// Rótulos e ordem
// ---------------------------------------------------------------

function setSidebarItemLabel(li, name, meta) {
    const nameEl = li?.querySelector(':scope > .item-name');
    if (!nameEl) return;
    nameEl.textContent = name ?? '';
    let metaEl = li.querySelector(':scope > .item-meta');
    if (!metaEl) {
        metaEl = document.createElement('span');
        metaEl.className = 'item-meta';
        nameEl.after(metaEl);
    }
    metaEl.textContent = meta || '';
    metaEl.hidden = !meta;
}

function refreshPolygonSidebarLabel(polygonInfo) {
    if (!polygonInfo?.listItem) return;
    let meta = 'Polígono';
    try {
        const area = google.maps.geometry.spherical.computeArea(polygonInfo.polygonObject.getPath());
        meta = `Polígono · ${formatArea(area)}`;
    } catch (e) { /* mapa ainda carregando */ }
    setSidebarItemLabel(polygonInfo.listItem, polygonInfo.name, meta);
    polygonInfo.listItem.querySelector('.ge-icon-polygon')?.style.setProperty('--ge-item-color', polygonInfo.color);
}

function isSidebarOrderedChild(el) {
    return !!el && (el.classList.contains('folder') || el.classList.contains('folder-wrapper') || el.classList.contains('ge-pro-item'));
}

//Posição do item entre os irmãos (pastas e itens) — salva com o projeto
function getSidebarOrderIndex(el) {
    const parent = el?.parentElement;
    if (!parent) return null;
    return Array.from(parent.children).filter(isSidebarOrderedChild).indexOf(el);
}

//Depois de abrir um projeto, recoloca pastas e itens na ordem salva
function applySidebarOrder(root) {
    if (!root) return;
    const lists = [root, ...root.querySelectorAll('ul.subfolders')].filter(el => el.tagName === 'UL');
    lists.forEach(ul => {
        const children = Array.from(ul.children).filter(isSidebarOrderedChild);
        if (!children.some(c => c.dataset.order !== undefined)) return;
        const sorted = children
            .map((el, index) => ({ el, index, order: el.dataset.order !== undefined ? Number(el.dataset.order) : Infinity }))
            .sort((a, b) => (a.order - b.order) || (a.index - b.index));
        sorted.forEach(({ el }) => ul.appendChild(el));
    });
    root.querySelectorAll('[data-order]').forEach(el => el.removeAttribute('data-order'));
    updateSidebarCounts();
}

// ---------------------------------------------------------------
// Contadores e etiqueta de tipo do projeto
// ---------------------------------------------------------------

let sidebarCountsTimer = null;

function scheduleSidebarCounts() {
    clearTimeout(sidebarCountsTimer);
    sidebarCountsTimer = setTimeout(updateSidebarCounts, 60);
}

function updateSidebarCounts() {
    document.querySelectorAll('#sidebar .folder-title').forEach(title => {
        const ul = title.nextElementSibling;
        const count = ul ? ul.querySelectorAll('.ge-pro-item').length : 0;
        const badge = title.querySelector(':scope > .folder-count');
        //Só mexe no texto quando muda (o observador da sidebar reage a qualquer troca de texto)
        const text = count ? String(count) : '';
        if (badge && badge.textContent !== text) {
            badge.textContent = text;
            badge.title = `${count} ${count === 1 ? 'item' : 'itens'} no mapa`;
        }
        title.classList.toggle('is-empty-folder', !ul || !ul.querySelector('.folder-wrapper, .ge-pro-item'));
        if (title.dataset.isProject === 'true') {
            const tag = title.querySelector(':scope > .project-type-tag');
            const meta = typeof getProjectTypeMeta === 'function' ? getProjectTypeMeta(title.dataset.folderType || 'TCR') : { label: title.dataset.folderType, color: '#64748b' };
            if (tag && tag.textContent !== (meta.label || '')) tag.textContent = meta.label || '';
            if (title.style.getPropertyValue('--project-color') !== meta.color) title.style.setProperty('--project-color', meta.color);
        }
    });
}

// ---------------------------------------------------------------
// Alvo de uma linha (projeto, pasta, marcador, cabo, polígono)
// ---------------------------------------------------------------

function getSidebarEntity(element) {
    if (!element) return null;
    const title = element.closest('.folder-title');
    if (title) {
        const isProject = title.dataset.isProject === 'true';
        return {
            kind: isProject ? 'project' : 'folder',
            title,
            folderId: title.dataset.folderId,
            name: title.dataset.folderName || '',
            container: isProject ? title.closest('.folder') : title.closest('.folder-wrapper'),
            row: title,
        };
    }
    const dropRow = element.closest('.ge-drop-row');
    if (dropRow) {
        const client = markers.find(m => m.listItem === dropRow.parentElement);
        return client ? { kind: 'drop', info: client, name: `Drop · ${client.name}`, row: dropRow } : null;
    }
    const li = element.closest('.ge-pro-item');
    if (!li) return null;
    const marker = markers.find(m => m.listItem === li);
    if (marker) return { kind: 'marker', info: marker, name: marker.name, row: li };
    const cable = savedCables.find(c => c.item === li);
    if (cable) return { kind: 'cable', info: cable, name: cable.name, row: li };
    const polygon = savedPolygons.find(p => p.listItem === li);
    if (polygon) return { kind: 'polygon', info: polygon, name: polygon.name, row: li };
    return null;
}

function getEntityVisibilityCheckbox(entity) {
    return entity.row.querySelector(':scope > .ge-vis-checkbox');
}

// ---------------------------------------------------------------
// Menu de ações
// ---------------------------------------------------------------

let sidebarMenuEntity = null;

const SB_ICONS = {
    edit: 'edit', rename: 'edit', open: 'edit', view: 'eye', 'new-folder': 'folder-plus', style: 'palette',
    focus: 'target', hide: 'eye-off', show: 'eye', collapse: 'collapse', expand: 'expand', save: 'save',
    close: 'folder-x', history: 'clock', delete: 'trash', fusion: 'branch', copy: 'copy', paste: 'copy',
    'drop-edit': 'edit', route: 'branch', check: 'list', 'export-xlsx': 'download', 'export-fusion': 'branch', 'pop-equipment': 'pop', 'drop-recalc': 'refresh', 'open-client': 'client', cable: 'cable',
};

function buildSidebarMenuItems(entity) {
    const canEdit = AppSession.canEdit;
    const visible = getEntityVisibilityCheckbox(entity)?.checked !== false;
    const visibility = { action: visible ? 'hide' : 'show', label: visible ? 'Ocultar no mapa' : 'Mostrar no mapa' };
    const items = [];
    if (entity.kind === 'drop') {
        const onCable = !!entity.info.client?.cableName;
        if (canEdit && !onCable) items.push({ action: 'drop-edit', label: 'Editar traçado', hint: 'Arraste os pontos da linha no mapa' });
        if (canEdit && !onCable) items.push({ action: 'drop-recalc', label: 'Recalcular traçado', hint: 'Segue a rede do projeto de novo' });
        items.push({ action: 'focus', label: 'Centralizar no mapa' });
        items.push({ action: visible ? 'hide' : 'show', label: visible ? 'Ocultar drop no mapa' : 'Mostrar drop no mapa' });
        items.push({ divider: true });
        items.push({ action: 'open-client', label: canEdit ? 'Editar cliente' : 'Ver cliente' });
        return items;
    }
    if (entity.kind === 'project' || entity.kind === 'folder') {
        const isProject = entity.kind === 'project';
        const ul = document.getElementById(entity.folderId);
        const hasSubfolders = !!ul?.querySelector('.folder-wrapper');
        const expanded = ul && !ul.classList.contains('hidden');
        if (canEdit) items.push({ action: 'edit', label: isProject ? 'Editar projeto' : 'Renomear pasta', hint: isProject ? 'Nome, cidade, bairro e tipo' : '' });
        if (canEdit) items.push({ action: 'new-folder', label: isProject ? 'Nova pasta' : 'Nova subpasta' });
        if (canEdit) items.push({ action: 'copy', label: isProject ? 'Copiar projeto' : 'Copiar pasta', hint: 'Com subpastas, marcadores, cabos e polígonos', kbd: 'Ctrl+C' });
        if (canEdit && sidebarClipboard) items.push({ action: 'paste', label: 'Colar aqui', kbd: 'Ctrl+V' });
        if (canEdit) items.push({ action: 'style', label: 'Padronizar estilo', hint: 'Cores e tamanho dos marcadores, espessura dos cabos' });
        items.push({ divider: true });
        items.push({ action: 'focus', label: 'Centralizar no mapa' });
        items.push(visibility);
        if (hasSubfolders || !expanded) items.push({ action: expanded ? 'collapse' : 'expand', label: expanded ? 'Recolher tudo' : 'Expandir tudo' });
        items.push({ divider: true });
        if (isProject) {
            if (canEdit) items.push({ action: 'save', label: 'Salvar projeto', kbd: 'Ctrl+S' });
            items.push({ action: 'history', label: 'Histórico de versões', hint: 'Ver e restaurar versões salvas' });
            items.push({ action: 'check', label: 'Verificar projeto', hint: 'Pontas soltas, fusões, portas, drops e potência' });
            items.push({ action: 'export-xlsx', label: 'Exportar planilha (Excel)', hint: 'Caixas, cabos, clientes, portas e fibras' });
            items.push({ action: 'export-fusion', label: 'Exportar plano de fusão (PDF)', hint: 'Todas as caixas com as fusões' });
            items.push({ action: 'close', label: 'Fechar projeto', hint: 'Continua salvo no banco' });
            if (canEdit) items.push({ action: 'delete', label: 'Excluir projeto', hint: 'Vai para a lixeira por 30 dias', danger: true });
        } else if (canEdit) {
            items.push({ action: 'delete', label: 'Excluir pasta', danger: true });
        }
    } else {
        const labels = { marker: 'marcador', cable: 'cabo', polygon: 'polígono' };
        const isClient = entity.kind === 'marker' && entity.info.type === 'CLIENTE';
        const noun = isClient ? 'cliente' : labels[entity.kind];
        items.push({ action: 'open', label: canEdit ? `Editar ${noun}` : `Ver ${noun}` });
        if (canEdit && entity.kind === 'marker' && !isClient && entity.info.marker) {
            items.push({ action: 'move', icon: 'marker', label: 'Mover', hint: 'Arraste até a nova posição' });
        }
        if (entity.kind === 'marker' && (entity.info.type === 'CEO' || entity.info.type === 'CTO' || entity.info.type === 'POP')) {
            items.push({ action: 'fusion', label: 'Plano de fusão' });
        }
        if (canEdit && entity.kind === 'marker' && typeof getCablesPassingThroughMarker === 'function') {
            getCablesPassingThroughMarker(entity.info).forEach(cable => items.push({
                action: `split-cable:${ensureItemUid(cable, 'cb', savedCables)}`, icon: 'cable',
                label: `Dividir cabo ${cable.name} aqui`, hint: 'Vira dois cabos com ponta nesta caixa',
            }));
        }
        if (entity.kind === 'marker' && entity.info.type === 'POP') items.push({ action: 'pop-equipment', label: 'Cadastro de equipamentos', hint: 'OLTs, placas, DGOs e switches' });
        if (entity.kind === 'cable') items.push({ action: 'route', label: 'Ver rota', hint: 'Por onde as fibras seguem, pelas fusões' });
        if (canEdit && entity.kind === 'cable') items.push({ action: 'conduit', icon: 'cable', label: 'Trecho tubulado', hint: 'Marca o que vai em duto, sem ferragens de poste' });
        items.push({ action: 'focus', label: 'Centralizar no mapa' });
        items.push(visibility);
        if (canEdit) items.push({ action: 'copy', label: 'Copiar', kbd: 'Ctrl+C' });
        if (canEdit) {
            items.push({ divider: true });
            items.push({ action: 'delete', label: `Excluir ${noun}`, danger: true, kbd: 'Del' });
        }
    }
    //Sem divisórias sobrando no começo, no fim ou em sequência
    return items.filter((item, i, all) => !item.divider || (i > 0 && i < all.length - 1 && !all[i - 1].divider));
}

function renderSidebarMenu(entity) {
    const menu = document.getElementById('sidebarFolderContextMenu');
    const kindLabels = { project: 'Projeto', folder: 'Pasta', marker: entity.info?.type === 'CLIENTE' ? 'Cliente' : 'Marcador', cable: 'Cabo', polygon: 'Polígono', drop: 'Drop do cliente' };
    const items = buildSidebarMenuItems(entity);
    menu.innerHTML = `<div class="sb-menu__head"><small>${escapeHtml(kindLabels[entity.kind] || '')}</small><strong>${escapeHtml(entity.name || '')}</strong></div>`
        + items.map(item => item.divider
            ? '<div class="sb-menu__divider" role="separator"></div>'
            : `<button type="button" role="menuitem" data-action="${item.action}" class="sb-menu__item${item.danger ? ' is-danger' : ''}">
                   <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${SB_ICONS[item.icon || item.action] || 'edit'}"></use></svg>
                   <span class="sb-menu__text"><span>${escapeHtml(item.label)}</span>${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ''}</span>
                   ${item.kbd ? `<kbd>${escapeHtml(item.kbd)}</kbd>` : ''}
               </button>`).join('');
}

function openSidebarMenu(entity, x, y, anchorButton = null) {
    if (!entity) return;
    const menu = document.getElementById('sidebarFolderContextMenu');
    sidebarMenuEntity = entity;
    renderSidebarMenu(entity);
    document.querySelectorAll('.sb-row-menu-open').forEach(el => el.classList.remove('sb-row-menu-open'));
    entity.row.classList.add('sb-row-menu-open');
    menu.classList.remove('hidden');
    menu.setAttribute('aria-hidden', 'false');
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        let left = x;
        let top = y;
        if (anchorButton) {
            const b = anchorButton.getBoundingClientRect();
            left = b.right - rect.width;
            top = b.bottom + 4;
            if (top + rect.height > window.innerHeight - 8) top = b.top - rect.height - 4;
        }
        left = Math.min(Math.max(8, left), window.innerWidth - rect.width - 8);
        top = Math.min(Math.max(8, top), window.innerHeight - rect.height - 8);
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.querySelector('.sb-menu__item')?.focus({ preventScroll: true });
    });
}

//Botão direito no marcador, cabo ou polígono do mapa: o mesmo menu da barra lateral, onde o clique foi
function openMapItemMenu(kind, info, domEvent) {
    if (domEvent) {
        domEvent.preventDefault?.();
        domEvent.stopPropagation?.();
    }
    if (!info || isDrawingCable || isDrawingPolygon || isAddingMarker) return;
    if (typeof isSketchToolActive === 'function' && isSketchToolActive()) return;
    const row = info.listItem || info.item || document.createElement('div');
    if (kind === 'marker') selectSidebarMarker(info);
    else if (kind === 'cable') selectSidebarCable(info);
    if (typeof hideMarkerHoverCard === 'function') hideMarkerHoverCard(true);
    const x = domEvent?.clientX ?? window.innerWidth / 2;
    const y = domEvent?.clientY ?? window.innerHeight / 2;
    openSidebarMenu({ kind, info, name: info.name, row }, x, y);
}

function openSidebarMenuFromButton(button) {
    const menu = document.getElementById('sidebarFolderContextMenu');
    const entity = getSidebarEntity(button);
    if (!menu.classList.contains('hidden') && sidebarMenuEntity?.row === entity?.row) {
        hideSidebarFolderContextMenu();
        return;
    }
    const rect = button.getBoundingClientRect();
    openSidebarMenu(entity, rect.right, rect.bottom, button);
}

function hideSidebarFolderContextMenu() {
    const menu = document.getElementById('sidebarFolderContextMenu');
    if (!menu || menu.classList.contains('hidden')) return;
    menu.classList.add('hidden');
    menu.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('.sb-row-menu-open').forEach(el => el.classList.remove('sb-row-menu-open'));
}

function setEntityVisibility(entity, visible) {
    const checkbox = getEntityVisibilityCheckbox(entity);
    if (!checkbox) return;
    if (entity.kind === 'project' || entity.kind === 'folder') {
        handleVisibilityToggle(checkbox, visible);
    } else {
        checkbox.checked = visible;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

function setFolderTreeExpanded(folderId, expanded) {
    getAllDescendantFolderIds(folderId).forEach(id => {
        const ul = document.getElementById(id);
        if (!ul) return;
        const isHidden = ul.classList.contains('hidden');
        if (expanded === isHidden) toggleFolder(id);
    });
}

function focusMapToPolygon(polygonInfo) {
    const bounds = new google.maps.LatLngBounds();
    polygonInfo.polygonObject.getPath().forEach(p => bounds.extend(p));
    if (!bounds.isEmpty()) map.fitBounds(bounds, { top: 56, right: 48, bottom: 56, left: getMapFocusPadding() });
}

function handleSidebarMenuAction(action) {
    const entity = sidebarMenuEntity;
    hideSidebarFolderContextMenu();
    if (!entity) return;
    const { kind, info } = entity;
    if (action.startsWith('split-cable:')) {
        const cable = savedCables.find(c => c.uid === action.slice('split-cable:'.length));
        if (cable) confirmSplitCableAtMarker(cable, info);
        return;
    }
    switch (action) {
    case 'edit':
        openFolderEditor(entity.title);
        break;
    case 'new-folder':
        setActiveFolder(entity.folderId);
        document.getElementById('createFolderButton')?.click();
        break;
    case 'paste':
        setActiveFolder(entity.folderId);
        if (pasteSidebarClipboard()) showToast('Colado', `Colado em "${entity.name}".`);
        break;
    case 'style':
        openFolderMarkerStyleModal(entity.title);
        break;
    case 'focus':
        if (kind === 'project' || kind === 'folder') focusMapToFolderScope(entity.folderId);
        else if (kind === 'marker') focusMapToMarker(info);
        else if (kind === 'cable') focusMapToCable(info);
        else if (kind === 'polygon') focusMapToPolygon(info);
        else if (kind === 'drop') focusMapToClientDrop(info);
        break;
    case 'pop-equipment':
        selectSidebarMarker(info);
        openPopEquipmentModal(info);
        break;
    case 'export-fusion':
        setActiveFolder(entity.folderId);
        exportProjectFusionPlans();
        break;
    case 'export-xlsx':
        setActiveFolder(entity.folderId);
        exportProjectSpreadsheet();
        break;
    case 'check':
        setActiveFolder(entity.folderId);
        openProjectCheck();
        break;
    case 'route':
        selectSidebarCable(info);
        showCableRoute(info);
        break;
    case 'conduit':
        selectSidebarCable(info);
        openConduitTool(info);
        break;
    case 'move':
        //Abre o marcador e já entra no modo de arrastar; ao soltar, o painel volta para salvar
        selectSidebarMarker(info);
        openMarkerFromUserAction(info);
        if (editingMarkerInfo === info && typeof startMarkerPositionEditSession === 'function') startMarkerPositionEditSession();
        break;
    case 'drop-edit':
        editClientDropFromSidebar(info);
        break;
    case 'drop-recalc':
        recalculateClientDropFromSidebar(info);
        break;
    case 'open-client':
        selectSidebarMarker(info);
        focusMapToMarker(info);
        openMarkerFromUserAction(info);
        break;
    case 'hide':
    case 'show':
        setEntityVisibility(entity, action === 'show');
        break;
    case 'collapse':
    case 'expand':
        setFolderTreeExpanded(entity.folderId, action === 'expand');
        break;
    case 'save':
        setActiveFolder(entity.folderId);
        saveActiveProject();
        break;
    case 'close':
        closeProject(entity.folderId, entity.container, entity.name);
        break;
    case 'history':
        openProjectHistory(entity.folderId, entity.container, entity.name);
        break;
    case 'delete':
        if (kind === 'project') deleteProject(entity.folderId, entity.container, entity.name);
        else if (kind === 'folder') deleteFolder(entity.folderId, entity.container, entity.name);
        else deleteSidebarMapItem(entity);
        break;
    case 'open':
        if (kind === 'marker') {
            selectSidebarMarker(info);
            focusMapToMarker(info);
            openMarkerFromUserAction(info);
        } else if (kind === 'cable') {
            selectSidebarCable(info);
            openCableEditor(info);
        } else if (kind === 'polygon') {
            focusMapToPolygon(info);
            openPolygonEditor(info);
        }
        break;
    case 'fusion':
        focusMapToMarker(info);
        populateFusionPlan(info);
        document.getElementById('fusionModal').style.display = 'flex';
        break;
    case 'copy': {
        //Item que faz parte da seleção múltipla: copia a seleção inteira
        const inMulti = typeof mapSelection !== 'undefined' && mapSelection.items.size > 1 && mapSelection.items.has(info);
        if (kind === 'project' || kind === 'folder') selectedSidebarCopyTarget = { type: 'folder', folderId: entity.folderId };
        else if (inMulti) selectedSidebarCopyTarget = null;
        else {
            if (typeof clearMapSelection === 'function' && mapSelection.items.size) clearMapSelection();
            if (kind === 'cable') selectSidebarCable(info);
            else if (kind === 'polygon') selectedSidebarCopyTarget = { type: 'polygon', polygonInfo: info };
            else selectSidebarMarker(info);
        }
        if (copySidebarSelection()) showToast('Copiado', `${describeClipboard()} copiado. Escolha uma pasta e use Ctrl+V ou "Colar aqui".`);
        break;
    }
    default:
        break;
    }
}

//Exclusão pelo menu (mesmas regras dos painéis de edição)
function deleteSidebarMapItem(entity) {
    if (!requireEdit('excluir itens')) return;
    const { kind, info } = entity;
    if (isDrawingCable || isDrawingPolygon || isAddingMarker) {
        showToast('Finalize a ação atual', 'Salve ou cancele o desenho em andamento antes de excluir.', 'progress');
        return;
    }
    if (kind === 'marker') {
        const isClient = info.type === 'CLIENTE';
        showConfirm(isClient ? 'Excluir cliente' : 'Excluir marcador', `Excluir "${info.name}"? Esta ação não pode ser desfeita.`, () => {
            if (focusedMapMarkerInfo === info) clearMapMarkerHighlight();
            info.marker.setMap(null);
            info.listItem.remove();
            markers = markers.filter(m => m !== info);
            refreshClientDrops();
            refreshBomAfterProjectChange();
            showToast(isClient ? 'Cliente excluído' : 'Marcador excluído', `"${info.name}" foi removido.`);
        });
        return;
    }
    if (kind === 'cable') {
        const usage = checkCableUsageInFusionPlans(info);
        if (usage.hasFusions) {
            showAlert('Ação bloqueada', `O cabo "${info.name}" tem fusões nas caixas: ${usage.locations.join(', ')}. Remova as fusões no plano de fusão destas caixas antes de excluir o cabo.`);
            return;
        }
        const extra = usage.isInPlan ? ` Ele também sai do plano de fusão de: ${usage.locations.join(', ')}.` : '';
        showConfirm('Excluir cabo', `Excluir o cabo "${info.name}"?${extra}`, () => {
            if (usage.isInPlan) removeCableFromSavedFusionPlans(info, usage.boxes);
            info.polyline?.setMap(null);
            info.item?.remove();
            savedCables = savedCables.filter(c => c !== info);
            refreshBomAfterProjectChange();
            refreshClientDrops({ recompute: true });
            showToast('Cabo excluído', `"${info.name}" foi removido.`);
        });
        return;
    }
    if (kind === 'polygon') {
        showConfirm('Excluir polígono', `Excluir "${info.name}"?`, () => {
            info.polygonObject.setMap(null);
            info.listItem.remove();
            savedPolygons = savedPolygons.filter(p => p !== info);
            showToast('Polígono excluído', `"${info.name}" foi removido.`);
        });
    }
}

function handleSidebarMenuKeys(event) {
    const menu = document.getElementById('sidebarFolderContextMenu');
    if (menu.classList.contains('hidden')) return;
    const items = Array.from(menu.querySelectorAll('.sb-menu__item'));
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
        event.preventDefault();
        const row = sidebarMenuEntity?.row;
        hideSidebarFolderContextMenu();
        row?.querySelector('.item-actions-toggle-btn')?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
        items[next]?.focus();
    }
}

function initSidebarFolderContextMenu() {
    const sidebar = document.getElementById('sidebar');
    const menu = document.getElementById('sidebarFolderContextMenu');
    if (!sidebar || !menu) return;
    sidebar.addEventListener('contextmenu', (e) => {
        const entity = getSidebarEntity(e.target);
        if (!entity || e.target.closest('input, textarea')) return;
        e.preventDefault();
        if (entity.kind === 'marker') selectSidebarMarker(entity.info);
        else if (entity.kind === 'cable') selectSidebarCable(entity.info);
        openSidebarMenu(entity, e.clientX, e.clientY);
    });
    menu.addEventListener('click', (e) => {
        const button = e.target.closest('.sb-menu__item');
        if (!button) return;
        e.preventDefault();
        handleSidebarMenuAction(button.dataset.action);
    });
    menu.addEventListener('keydown', handleSidebarMenuKeys);
    document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('#sidebarFolderContextMenu, .item-actions-toggle-btn')) hideSidebarFolderContextMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideSidebarFolderContextMenu();
    });
    sidebar.addEventListener('scroll', hideSidebarFolderContextMenu);
    window.addEventListener('resize', hideSidebarFolderContextMenu);
    setupFolderStyleModal();
}

// ---------------------------------------------------------------
// Arrastar e soltar
// ---------------------------------------------------------------

const sidebarDnd = { target: null, expandTimer: null, expandId: null, scrollRaf: null, scrollSpeed: 0 };

function setSidebarDragGhost(event, element) {
    if (!event.dataTransfer?.setDragImage) return;
    const entity = getSidebarEntity(element.querySelector(':scope > .folder-title') || element);
    const ghost = document.createElement('div');
    ghost.className = 'sb-drag-ghost';
    const icon = (element.querySelector(':scope > .folder-title .ge-folder-icon') || element.querySelector(':scope > .ge-item-icon'))?.cloneNode(true);
    if (icon) ghost.appendChild(icon);
    const label = document.createElement('span');
    label.textContent = entity?.name || 'Item';
    ghost.appendChild(label);
    const count = element.querySelectorAll('.ge-pro-item').length;
    if (element.classList.contains('folder-wrapper') || element.classList.contains('folder')) {
        const small = document.createElement('small');
        small.textContent = `${count} ${count === 1 ? 'item' : 'itens'}`;
        ghost.appendChild(small);
    }
    document.body.appendChild(ghost);
    try { event.dataTransfer.setDragImage(ghost, 14, 16); } catch (e) { /* navegador pode bloquear */ }
    setTimeout(() => ghost.remove(), 0);
}

function getSidebarDropLine() {
    let line = document.getElementById('sidebarDropLine');
    if (!line) {
        line = document.createElement('div');
        line.id = 'sidebarDropLine';
        line.className = 'sb-drop-line';
        line.setAttribute('aria-hidden', 'true');
        document.getElementById('sidebar').appendChild(line);
    }
    return line;
}

function clearSidebarDropState() {
    document.querySelectorAll('#sidebar .sb-drop-into').forEach(el => el.classList.remove('sb-drop-into'));
    document.getElementById('sidebarDropLine')?.classList.remove('is-visible');
    document.querySelectorAll('#sidebar .sidebar-drop-indicator').forEach(el => el.remove());
    clearTimeout(sidebarDnd.expandTimer);
    sidebarDnd.expandTimer = null;
    sidebarDnd.expandId = null;
    sidebarDnd.target = null;
    sidebarDnd.scrollSpeed = 0;
    window.sidebarDropTarget = null;
}

//Linha que representa o ponto de inserção
function getRowOfContainer(el) {
    return el.querySelector(':scope > .folder-title') || el;
}

function computeSidebarDropTarget(event) {
    const dragged = window.draggedItem;
    const sidebar = document.getElementById('sidebar');
    if (!dragged || !sidebar) return null;
    const y = event.clientY;
    const isProjectDragged = dragged.classList.contains('folder');

    //Projetos só trocam de ordem entre si
    if (isProjectDragged) {
        const projects = Array.from(sidebar.querySelectorAll(':scope > .folder')).filter(p => p !== dragged);
        if (!projects.length) return null;
        for (const project of projects) {
            const r = project.querySelector(':scope > .folder-title').getBoundingClientRect();
            if (y < r.top + r.height / 2) return { mode: 'before', ref: project, parent: sidebar };
        }
        return { mode: 'after', ref: projects[projects.length - 1], parent: sidebar };
    }

    const over = event.target instanceof Element ? event.target : null;
    const title = over?.closest('.folder-title');
    const invalid = (el) => !el || el === dragged || dragged.contains(el);

    if (title) {
        const container = title.parentElement;
        const subUl = title.nextElementSibling;
        if (invalid(container)) return null;
        const r = title.getBoundingClientRect();
        const ratio = (y - r.top) / r.height;
        const isProject = title.dataset.isProject === 'true';
        const expanded = subUl && !subUl.classList.contains('hidden');
        if (!isProject && ratio < 0.28) return { mode: 'before', ref: container, parent: container.parentElement };
        if (!isProject && ratio > 0.72 && !expanded) return { mode: 'after', ref: container, parent: container.parentElement };
        if (!subUl) return null;
        return { mode: 'into', ul: subUl, title, atStart: !!expanded };
    }

    //Sobre um item ou sobre a área livre de uma pasta aberta
    const ul = over?.closest('ul.subfolders');
    if (!ul || invalid(ul)) return null;
    const children = Array.from(ul.children).filter(c => isSidebarOrderedChild(c) && c !== dragged);
    for (const child of children) {
        const r = getRowOfContainer(child).getBoundingClientRect();
        if (y < r.top + r.height / 2) return { mode: 'before', ref: child, parent: ul };
        if (!child.classList.contains('folder-wrapper') && y <= r.bottom) return { mode: 'after', ref: child, parent: ul };
    }
    const last = children[children.length - 1];
    return last ? { mode: 'after', ref: last, parent: ul } : { mode: 'into', ul, title: ul.previousElementSibling, atStart: false };
}

function showSidebarDropFeedback(target) {
    const sidebar = document.getElementById('sidebar');
    const line = getSidebarDropLine();
    document.querySelectorAll('#sidebar .sb-drop-into').forEach(el => el.classList.remove('sb-drop-into'));
    if (!target) {
        line.classList.remove('is-visible');
        return;
    }
    if (target.mode === 'into') {
        target.title?.classList.add('sb-drop-into');
        line.classList.remove('is-visible');
        const folderId = target.title?.dataset.folderId;
        if (folderId && target.ul.classList.contains('hidden') && sidebarDnd.expandId !== folderId) {
            clearTimeout(sidebarDnd.expandTimer);
            sidebarDnd.expandId = folderId;
            sidebarDnd.expandTimer = setTimeout(() => {
                if (sidebarDnd.expandId === folderId && target.ul.classList.contains('hidden')) toggleFolder(folderId);
            }, 650);
        }
        return;
    }
    clearTimeout(sidebarDnd.expandTimer);
    sidebarDnd.expandId = null;
    const row = getRowOfContainer(target.ref);
    const sr = sidebar.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    //Depois de uma pasta aberta, a linha vai para o fim do conteúdo dela
    const bottom = target.mode === 'after' ? target.ref.getBoundingClientRect().bottom : rr.top;
    const iconLeft = (row.querySelector('.ge-folder-icon, .ge-item-icon')?.getBoundingClientRect().left ?? rr.left) - sr.left;
    line.style.top = `${bottom - sr.top + sidebar.scrollTop - 1}px`;
    line.style.left = `${Math.max(4, iconLeft - 4)}px`;
    line.classList.add('is-visible');
}

function autoScrollSidebar(event) {
    const sidebar = document.getElementById('sidebar');
    const r = sidebar.getBoundingClientRect();
    const edge = 44;
    let speed = 0;
    if (event.clientY < r.top + edge) speed = -Math.ceil((r.top + edge - event.clientY) / 4);
    else if (event.clientY > r.bottom - edge) speed = Math.ceil((event.clientY - (r.bottom - edge)) / 4);
    sidebarDnd.scrollSpeed = speed;
    if (speed && !sidebarDnd.scrollRaf) {
        const step = () => {
            if (!sidebarDnd.scrollSpeed || !window.draggedItem) {
                sidebarDnd.scrollRaf = null;
                return;
            }
            sidebar.scrollTop += sidebarDnd.scrollSpeed;
            sidebarDnd.scrollRaf = requestAnimationFrame(step);
        };
        sidebarDnd.scrollRaf = requestAnimationFrame(step);
    }
}

function handleSidebarDragOver(event) {
    if (!window.draggedItem) return;
    event.preventDefault();
    autoScrollSidebar(event);
    const target = computeSidebarDropTarget(event);
    sidebarDnd.target = target;
    event.dataTransfer.dropEffect = target ? 'move' : 'none';
    showSidebarDropFeedback(target);
}

function handleSidebarDrop(event) {
    const dragged = window.draggedItem;
    if (!dragged) return;
    event.preventDefault();
    const target = sidebarDnd.target || computeSidebarDropTarget(event);
    clearSidebarDropState();
    if (!target || !AppSession.canEdit) return;
    const sourceProject = window.draggedItemSourceProject;
    if (target.mode === 'before') target.ref.before(dragged);
    else if (target.mode === 'after') target.ref.after(dragged);
    else if (target.atStart) target.ul.prepend(dragged);
    else target.ul.appendChild(dragged);
    const itemData = markers.find(m => m.listItem === dragged) || savedCables.find(c => c.item === dragged) || savedPolygons.find(p => p.listItem === dragged);
    if (itemData) itemData.folderId = dragged.parentElement.id;
    window.dropWasSuccessful = true;
    if (target.mode === 'into' && target.ul.classList.contains('hidden')) {
        target.title?.classList.add('sidebar-drop-flash');
        setTimeout(() => target.title?.classList.remove('sidebar-drop-flash'), 700);
    }
    if (!dragged.classList.contains('folder')) {
        const destinationProject = dragged.closest('.folder');
        saveProjectElement(destinationProject);
        if (sourceProject && sourceProject !== destinationProject) saveProjectElement(sourceProject);
        if (itemData && sourceProject !== destinationProject) refreshBomAfterProjectChange();
    }
    scheduleSidebarCounts();
}

function initSidebarDragAndDrop() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.addEventListener('dragover', handleSidebarDragOver);
    sidebar.addEventListener('drop', handleSidebarDrop);
    sidebar.addEventListener('dragleave', (event) => {
        if (!sidebar.contains(event.relatedTarget)) {
            showSidebarDropFeedback(null);
            sidebarDnd.target = null;
            sidebarDnd.scrollSpeed = 0;
        }
    });
}

// ---------------------------------------------------------------
// Padronizar estilo da pasta (prévia ao vivo no mapa)
// ---------------------------------------------------------------

const FOLDER_STYLE_TYPES = [
    { type: 'CTO', label: 'CTO' },
    { type: 'CEO', label: 'CEO' },
    { type: 'RESERVA', label: 'Reserva' },
    { type: 'CORDOALHA', label: 'Cordoalha' },
    { type: 'POP', label: 'POP' },
    { type: 'POSTE', label: 'Poste' },
];

let folderStyleSession = null;

function getFolderScope(folderId) {
    const ids = getAllDescendantFolderIds(folderId);
    return {
        markers: markers.filter(m => ids.includes(m.folderId) && FOLDER_STYLE_TYPES.some(t => t.type === m.type)),
        cables: savedCables.filter(c => ids.includes(c.folderId)),
    };
}

function openFolderMarkerStyleModal(titleElement) {
    if (!requireEdit('padronizar estilos')) return;
    if (!titleElement?.dataset.folderId) return;
    const folderId = titleElement.dataset.folderId;
    const scope = getFolderScope(folderId);
    openStyleSession({
        title: `Padronizar estilo · ${titleElement.dataset.folderName || 'Pasta'}`,
        applyLabel: 'Aplicar na pasta',
        scope,
        projectRoot: () => document.getElementById(folderId)?.closest('.folder'),
    });
}

//Seleção do mapa: só os tipos marcados mudam (ex.: cor das CTOs sem mexer nos cabos)
function openSelectionStyleModal(items) {
    if (!requireEdit('alterar o estilo')) return;
    const scope = {
        markers: items.filter(m => markers.includes(m) && FOLDER_STYLE_TYPES.some(t => t.type === m.type)),
        cables: items.filter(c => savedCables.includes(c)),
    };
    if (!scope.markers.length && !scope.cables.length) return;
    openStyleSession({
        title: `Estilo dos selecionados · ${scope.markers.length + scope.cables.length} itens`,
        applyLabel: 'Aplicar nos selecionados',
        scope,
        projectRoot: () => getActiveProjectRoot?.(),
        onApplied: () => { if (typeof setMapSelection === 'function') setMapSelection([...mapSelection.items]); },
    });
}

const STYLE_CABLE_TYPE = '__cabos';

function openStyleSession({ title, applyLabel, scope, projectRoot, onApplied }) {
    const presentTypes = FOLDER_STYLE_TYPES.filter(t => scope.markers.some(m => m.type === t.type));
    const sample = scope.markers[0];
    folderStyleSession = {
        scope,
        projectRoot,
        onApplied,
        types: new Set([...presentTypes.map(t => t.type), ...(scope.cables.length ? [STYLE_CABLE_TYPE] : [])]),
        original: {
            markers: scope.markers.map(m => ({ m, color: m.color, labelColor: m.labelColor, size: m.size })),
            cables: scope.cables.map(c => ({ c, width: c.width, color: c.color })),
        },
    };
    document.getElementById('folderMarkerStyleModalTitle').textContent = title;
    document.getElementById('confirmFolderMarkerStyle').textContent = applyLabel;
    const chips = document.getElementById('folderStyleTypes');
    const chip = (value, label, count) => `<label class="map-tool-chip fs-type"><input type="checkbox" value="${value}" checked /><span>${label} <small>${count}</small></span></label>`;
    chips.innerHTML = (presentTypes.length || scope.cables.length)
        ? presentTypes.map(t => chip(t.type, t.label, scope.markers.filter(m => m.type === t.type).length)).join('')
            + (scope.cables.length ? chip(STYLE_CABLE_TYPE, 'Cabos', scope.cables.length) : '')
        : '<span class="fs-empty">Nenhum CEO, CTO, reserva, cordoalha ou POP nesta pasta.</span>';
    chips.querySelectorAll('input').forEach(input => input.addEventListener('change', () => {
        if (input.checked) folderStyleSession.types.add(input.value); else folderStyleSession.types.delete(input.value);
        previewFolderStyle();
    }));
    document.getElementById('folderMarkerColor').value = sample?.color || '#16a34a';
    document.getElementById('folderMarkerLabelColor').value = sample?.labelColor || '#0f172a';
    ['fsApplyColor', 'fsApplyLabel'].forEach(id => { document.getElementById(id).checked = !!presentTypes.length; });
    document.getElementById('fsApplySize').checked = false; //Tamanho agora é uma preferência do usuário
    document.getElementById('fsApplyWidth').checked = false;
    document.getElementById('fsApplyCableColor').checked = false;
    setMarkerSizeControlValue('folderStyleSize', sample?.size || DEFAULT_MARKER_SIZE);
    const cableWidth = scope.cables[0]?.width || 4;
    document.getElementById('folderCableWidth').value = cableWidth;
    document.getElementById('folderCableWidthValue').textContent = `${cableWidth} px`;
    document.getElementById('folderCableColor').value = /^#[0-9a-f]{6}$/i.test(scope.cables[0]?.color || '') ? scope.cables[0].color : '#008000';
    document.getElementById('folderStyleCableSection').classList.toggle('hidden', !scope.cables.length);
    document.getElementById('folderStyleCableCount').textContent = `${scope.cables.length} ${scope.cables.length === 1 ? 'cabo' : 'cabos'}`;
    document.getElementById('folderStyleMarkerSection').classList.toggle('is-disabled', !presentTypes.length);
    syncFolderStyleFieldStates();
    previewFolderStyle();
    document.getElementById('folderMarkerStyleModal').style.display = 'flex';
}

function syncFolderStyleFieldStates() {
    [['fsApplyColor', 'fsColorField'], ['fsApplyLabel', 'fsLabelField'], ['fsApplySize', 'fsSizeField'], ['fsApplyWidth', 'fsWidthField'], ['fsApplyCableColor', 'fsCableColorField']].forEach(([check, field]) => {
        document.getElementById(field)?.classList.toggle('is-off', !document.getElementById(check).checked);
    });
}

function readFolderStyleForm() {
    return {
        color: document.getElementById('fsApplyColor').checked ? document.getElementById('folderMarkerColor').value : null,
        labelColor: document.getElementById('fsApplyLabel').checked ? document.getElementById('folderMarkerLabelColor').value : null,
        size: document.getElementById('fsApplySize').checked ? getMarkerSizeControlValue('folderStyleSize') : null,
        width: document.getElementById('fsApplyWidth').checked ? parseInt(document.getElementById('folderCableWidth').value, 10) : null,
        cableColor: document.getElementById('fsApplyCableColor').checked ? document.getElementById('folderCableColor').value : null,
    };
}

//Aplica no mapa sem gravar: cancelar volta ao estado original
function previewFolderStyle() {
    const session = folderStyleSession;
    if (!session) return;
    const form = readFolderStyleForm();
    const cablesOn = session.types.has(STYLE_CABLE_TYPE);
    session.original.markers.forEach(({ m, color, labelColor, size }) => {
        const inScope = session.types.has(m.type);
        const next = {
            color: inScope && form.color ? form.color : color,
            labelColor: inScope && form.labelColor ? form.labelColor : labelColor,
            size: inScope && form.size ? form.size : size,
        };
        m.marker.setIcon(buildMarkerMapIcon(m.type, { color: next.color, size: next.size, labelColor: next.labelColor }));
        m.marker.setLabel(buildMarkerMapLabel(m.name, next.labelColor));
    });
    session.original.cables.forEach(({ c, width, color }) => {
        c.polyline?.setOptions({
            strokeWeight: cablesOn && form.width ? form.width : width,
            strokeColor: cablesOn && form.cableColor ? form.cableColor : color,
        });
    });
    const affected = session.original.markers.filter(({ m }) => session.types.has(m.type)).length;
    const cableCount = cablesOn && (form.width || form.cableColor) ? session.original.cables.length : 0;
    const parts = [];
    if (affected && (form.color || form.labelColor || form.size)) parts.push(`${affected} ${affected === 1 ? 'marcador' : 'marcadores'}`);
    if (cableCount) parts.push(`${cableCount} ${cableCount === 1 ? 'cabo' : 'cabos'}`);
    document.getElementById('folderMarkerStyleHint').textContent = parts.length
        ? `Prévia no mapa: ${parts.join(' e ')} com o novo estilo. Cancelar desfaz.`
        : 'Marque o que deseja padronizar.';
    document.getElementById('confirmFolderMarkerStyle').disabled = !parts.length;
    updateMarkerSizeControlPreview('folderStyleSize', form.color || '#16a34a', 'CTO');
}

function revertFolderStylePreview() {
    const session = folderStyleSession;
    if (!session) return;
    session.original.markers.forEach(({ m }) => updateMarkerAppearance(m));
    session.original.cables.forEach(({ c, width, color }) => c.polyline?.setOptions({ strokeWeight: width, strokeColor: color }));
}

function closeFolderStyleModal({ revert = true } = {}) {
    if (revert) revertFolderStylePreview();
    folderStyleSession = null;
    document.getElementById('folderMarkerStyleModal').style.display = 'none';
}

function applyFolderMarkerStyle() {
    const session = folderStyleSession;
    if (!session) return;
    const form = readFolderStyleForm();
    let markerCount = 0;
    if (form.color || form.labelColor || form.size) {
        session.original.markers.forEach(({ m }) => {
            if (!session.types.has(m.type)) return;
            if (form.color) m.color = form.color;
            if (form.labelColor) m.labelColor = form.labelColor;
            if (form.size) m.size = form.size;
            updateMarkerAppearance(m);
            markerCount++;
        });
    }
    let cableCount = 0;
    if (session.types.has(STYLE_CABLE_TYPE) && (form.width || form.cableColor)) {
        session.original.cables.forEach(({ c }) => {
            if (form.width) c.width = form.width;
            if (form.cableColor) c.color = form.cableColor;
            c.polyline?.setOptions({ strokeWeight: c.width, strokeColor: c.color });
            if (typeof applyCableSidebarColorStyles === 'function') applyCableSidebarColorStyles(c);
            cableCount++;
        });
    }
    closeFolderStyleModal({ revert: false });
    const projectRoot = session.projectRoot?.();
    if (projectRoot) saveProjectElement(projectRoot);
    session.onApplied?.();
    const parts = [];
    if (markerCount) parts.push(`${markerCount} ${markerCount === 1 ? 'marcador' : 'marcadores'}`);
    if (cableCount) parts.push(`${cableCount} ${cableCount === 1 ? 'cabo' : 'cabos'}`);
    showToast('Estilo aplicado', `${parts.join(' e ')} padronizado(s).`);
}

function setupFolderStyleModal() {
    const modal = document.getElementById('folderMarkerStyleModal');
    if (!modal) return;
    buildMarkerSizeControl(document.getElementById('folderStyleSizeMount'), { id: 'folderStyleSize', type: 'CTO', onInput: previewFolderStyle });
    ['folderMarkerColor', 'folderMarkerLabelColor'].forEach(id => document.getElementById(id).addEventListener('input', previewFolderStyle));
    ['fsApplyColor', 'fsApplyLabel', 'fsApplySize', 'fsApplyWidth', 'fsApplyCableColor'].forEach(id => document.getElementById(id).addEventListener('change', () => {
        syncFolderStyleFieldStates();
        previewFolderStyle();
    }));
    const width = document.getElementById('folderCableWidth');
    width.addEventListener('input', () => {
        document.getElementById('folderCableWidthValue').textContent = `${width.value} px`;
        if (!document.getElementById('fsApplyWidth').checked) {
            document.getElementById('fsApplyWidth').checked = true;
            syncFolderStyleFieldStates();
        }
        previewFolderStyle();
    });
    document.getElementById('folderCableColor').addEventListener('input', () => {
        if (!document.getElementById('fsApplyCableColor').checked) {
            document.getElementById('fsApplyCableColor').checked = true;
            syncFolderStyleFieldStates();
        }
        previewFolderStyle();
    });
    document.getElementById('closeFolderMarkerStyleModal')?.addEventListener('click', () => closeFolderStyleModal());
    document.getElementById('cancelFolderMarkerStyle')?.addEventListener('click', () => closeFolderStyleModal());
    document.getElementById('confirmFolderMarkerStyle')?.addEventListener('click', applyFolderMarkerStyle);
}

// ---------------------------------------------------------------
// Início
// ---------------------------------------------------------------

function initSidebarEnhancements() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    initSidebarDragAndDrop();
    //Ctrl+S salva o projeto selecionado (o plano de fusão aberto trata o atalho antes)
    document.addEventListener('keydown', (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
        event.preventDefault();
        if (!AppSession.canEdit) return;
        if (!getActiveProjectRoot()) {
            showToast('Nenhum projeto selecionado', 'Clique em um projeto na barra lateral para salvar.', 'progress');
            return;
        }
        saveActiveProject();
    });
    new MutationObserver(scheduleSidebarCounts).observe(sidebar, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-folder-type'],
    });
    updateSidebarCounts();
}

initSidebarEnhancements();
