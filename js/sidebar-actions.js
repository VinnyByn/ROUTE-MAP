// Itens da barra lateral: seleção, copiar/colar (marcadores, cabos e pastas), arrastar e soltar,
// criar projeto e pasta, abrir/fechar pastas e pasta ativa para inserção.
// Depende de script.js (map, markers, savedCables, criação de itens) e js/persistence.js.

function generateFolderId() {
    return `folder-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
}

function clearSidebarItemSelection() {
    document.querySelectorAll('.folder-title.active').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('.ge-pro-item.active').forEach((el) => el.classList.remove('active'));
}

function selectSidebarItem(listItem, copyTarget = null) {
    if (!listItem) return;
    clearSidebarItemSelection();
    listItem.classList.add('active');
    if (copyTarget !== null) {
        selectedSidebarCopyTarget = copyTarget;
    }
}

function selectSidebarMarker(markerInfo) {
    if (!markerInfo?.listItem) return;
    selectSidebarItem(markerInfo.listItem, { type: 'marker', markerInfo });
}

function selectSidebarCable(cableInfo) {
    if (!cableInfo?.item) return;
    selectSidebarItem(cableInfo.item, { type: 'cable', cableInfo });
}

function wireCableSidebarSelection(cableInfo) {
    const li = cableInfo?.item;
    if (!li || li.dataset.copySelectBound === '1') return;
    li.dataset.copySelectBound = '1';
    li.style.cursor = 'pointer';
    li.addEventListener('click', (e) => {
        if (isSidebarDragBlockedTarget(e.target)) return;
        e.stopPropagation();
        selectSidebarCable(cableInfo);
        focusMapToCable(cableInfo);
    });
}

function wireMarkerSidebarSelection(markerInfo) {
    const li = markerInfo?.listItem;
    if (!li || li.dataset.copySelectBound === '1') return;
    li.dataset.copySelectBound = '1';
    li.style.cursor = 'pointer';
    li.addEventListener('click', (e) => {
        if (isSidebarDragBlockedTarget(e.target)) return;
        if (e.target.closest('.adjust-kml-btn')) return;
        e.stopPropagation();
        selectSidebarMarker(markerInfo);
        focusMapToMarker(markerInfo);
    });
}

//Pasta (ou projeto) com subpastas, marcadores, cabos e polígonos
function serializeFolderForClipboard(folderId) {
    const ul = document.getElementById(folderId);
    if (!ul) return null;
    const titleDiv = ul.previousElementSibling;
    if (!titleDiv) return null;
    const ids = new Set(getAllDescendantFolderIds(folderId));
    return {
        type: 'folder',
        sourceFolderId: folderId,
        name: titleDiv.dataset.folderName,
        structure: getSidebarStructureAsJSON(ul).map(n => ({ ...n, isProject: false, type: 'folder' })),
        markers: markers.filter((m) => ids.has(m.folderId)).map(serializeMarker),
        cables: savedCables.filter((c) => ids.has(c.folderId)).map(serializeCable),
        polygons: savedPolygons.filter((p) => ids.has(p.folderId)).map(serializePolygon),
    };
}

//Vários itens soltos (seleção múltipla, ou um só)
function serializeItemsForClipboard(items) {
    const bundle = { type: 'items', markers: [], cables: [], polygons: [] };
    items.forEach(item => {
        if (markers.includes(item)) bundle.markers.push(serializeMarker(item));
        else if (savedCables.includes(item)) bundle.cables.push(serializeCable(item));
        else if (savedPolygons.includes(item)) bundle.polygons.push(serializePolygon(item));
    });
    return bundle.markers.length + bundle.cables.length + bundle.polygons.length ? bundle : null;
}

function buildFolderIdMap(sourceFolderId, structure) {
    const idMap = { [sourceFolderId]: generateFolderId() };
    function walk(nodes) {
        (nodes || []).forEach((node) => {
            idMap[node.id] = generateFolderId();
            if (node.children?.length) walk(node.children);
        });
    }
    walk(structure);
    return idMap;
}

function remapSidebarStructureIds(structure, idMap) {
    return structure.map((node) => ({
        ...node,
        id: idMap[node.id] || node.id,
        children: node.children?.length ? remapSidebarStructureIds(node.children, idMap) : []
    }));
}

function appendFolderToParent(parentUl, folderName, folderId) {
    const template = document.getElementById('folder-template');
    const clone = template.content.cloneNode(true);
    const wrapperLi = clone.querySelector('.folder-wrapper');
    const titleDiv = clone.querySelector('.folder-title');
    const nameSpan = clone.querySelector('.folder-name-text');
    const subList = clone.querySelector('.subfolders');
    const visibilityBtn = clone.querySelector('.visibility-toggle-btn');

    enableDragAndDropForItem(wrapperLi);
    nameSpan.textContent = folderName;
    subList.id = folderId;
    titleDiv.dataset.folderId = folderId;
    titleDiv.dataset.folderName = folderName;
    titleDiv.dataset.isProject = 'false';
    visibilityBtn.dataset.folderId = folderId;

    const toggleIcon = titleDiv.querySelector('.toggle-icon');
    toggleIcon.onclick = (e) => { e.stopPropagation(); toggleFolder(folderId); };
    enableDropOnFolder(subList);
    parentUl.appendChild(wrapperLi);
    return folderId;
}

function copySidebarSelection() {
    //Seleção múltipla (Ctrl/Shift + clique ou retângulo no mapa) tem prioridade
    const multi = typeof mapSelection !== 'undefined' ? [...mapSelection.items] : [];
    let payload = null;
    if (multi.length > 1) payload = serializeItemsForClipboard(multi);
    else if (selectedSidebarCopyTarget?.type === 'marker') payload = serializeItemsForClipboard([selectedSidebarCopyTarget.markerInfo]);
    else if (selectedSidebarCopyTarget?.type === 'cable') payload = serializeItemsForClipboard([selectedSidebarCopyTarget.cableInfo]);
    else if (selectedSidebarCopyTarget?.type === 'polygon') payload = serializeItemsForClipboard([selectedSidebarCopyTarget.polygonInfo]);
    else if (selectedSidebarCopyTarget?.type === 'folder') payload = serializeFolderForClipboard(selectedSidebarCopyTarget.folderId);
    else if (multi.length === 1) payload = serializeItemsForClipboard(multi);
    if (!payload) return false;
    sidebarClipboard = payload;
    return true;
}

function describeClipboard(clip = sidebarClipboard) {
    if (!clip) return '';
    if (clip.type === 'folder') return `pasta "${clip.name}"`;
    const n = clip.markers.length + clip.cables.length + clip.polygons.length;
    if (n === 1) return `"${(clip.markers[0] || clip.cables[0] || clip.polygons[0]).name}"`;
    return `${n} itens`;
}

function newCopyUid(prefix) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

//Cola o conteúdo copiado na pasta: ids novos para tudo (pastas, marcadores, cabos, polígonos) e os vínculos
//entre itens copiados juntos (cabo ↔ caixa, cliente ↔ CTO/cabo, plano de fusão ↔ cabo) passam para as cópias
function pasteClipboardInto(targetFolderId) {
    const clip = sidebarClipboard;
    const parentUl = document.getElementById(targetFolderId);
    if (!clip || !parentUl) return false;
    const idMap = new Map();
    let rootId = null;
    if (clip.type === 'folder') {
        const folderMap = buildFolderIdMap(clip.sourceFolderId, clip.structure);
        Object.entries(folderMap).forEach(([a, b]) => idMap.set(a, b));
        rootId = folderMap[clip.sourceFolderId];
    }
    [...clip.markers, ...clip.cables, ...clip.polygons].forEach(item => {
        if (!item.uid) return;
        idMap.set(item.uid, newCopyUid(item.uid.startsWith('mk_') ? 'mk' : (item.uid.startsWith('pg_') ? 'pg' : 'cb')));
    });
    //Troca todos os ids antigos pelos novos (são aleatórios e únicos, então a troca no texto é segura)
    let text = JSON.stringify({ structure: clip.structure || [], markers: clip.markers, cables: clip.cables, polygons: clip.polygons });
    idMap.forEach((to, from) => { text = text.split(from).join(to); });
    const data = JSON.parse(text);
    const known = new Set(idMap.values());
    const intoFolder = (d) => ({ ...d, folderId: known.has(d.folderId) ? d.folderId : targetFolderId });
    //Itens soltos ganham "(cópia)" no nome; dentro de uma pasta copiada ficam com o nome original
    const rename = clip.type !== 'folder';
    const copyName = (name) => (rename ? `${name} (cópia)` : name);

    if (rootId) {
        appendFolderToParent(parentUl, `${clip.name} (cópia)`, rootId);
        if (data.structure.length) rebuildSidebarFromJSON(data.structure, document.getElementById(rootId));
    }
    const newMarkers = [];
    data.markers.forEach(d => {
        const m = intoFolder({ ...d, name: copyName(d.name) });
        delete m.order;
        if (m.type === 'CLIENTE' && m.client) {
            m.client = { ...m.client };
            //Cliente copiado sem a CTO: não ocupa a mesma porta do original
            if (m.client.ctoUid && !known.has(m.client.ctoUid)) { m.client.ctoPort = null; m.client.ctoUid = null; }
            if (m.client.cableUid && !known.has(m.client.cableUid)) { m.client.cableUid = null; m.client.cableName = null; m.client.cableFiber = null; }
        }
        rebuildMarker(m);
        newMarkers.push(markers[markers.length - 1]);
    });
    const renamedCables = [];
    data.cables.forEach(d => {
        const c = intoFolder({ ...d, name: copyName(d.name), path: d.path.map(p => ({ ...p })) });
        delete c.order;
        ['start', 'end'].forEach(side => {
            const uid = c[`${side}AnchorUid`];
            const anchor = uid && known.has(uid) ? newMarkers.find(m => m.uid === uid) : null;
            if (anchor) {
                c[`${side}AnchorMarkerName`] = anchor.name;
                c[`${side}AnchorMarkerFolderId`] = anchor.folderId;
            }
        });
        rebuildCable(c);
        const cable = savedCables[savedCables.length - 1];
        if (rename) renamedCables.push({ cable, oldName: d.name });
    });
    data.polygons.forEach(d => {
        const p = intoFolder({ ...d, name: copyName(d.name) });
        delete p.order;
        rebuildPolygon(p);
    });
    //Cabo renomeado: planos de fusão e clientes copiados junto passam a mostrar o nome novo
    renamedCables.forEach(({ cable, oldName }) => {
        newMarkers.forEach(box => {
            if (box.fusionPlan && typeof renameCableInBoxPlan === 'function') renameCableInBoxPlan(box, oldName, cable.name, cable, cable.uid);
            if (box.client?.cableUid === cable.uid) box.client.cableName = cable.name;
        });
    });
    if (rootId) setActiveFolder(rootId);
    if (typeof updateSidebarCounts === 'function') updateSidebarCounts();
    if (typeof refreshClientDrops === 'function') refreshClientDrops({ recompute: true });
    if (typeof refreshBomAfterProjectChange === 'function') refreshBomAfterProjectChange();
    return true;
}

function pasteSidebarClipboard() {
    if (!AppSession.canEdit) return false;
    if (!sidebarClipboard || !activeFolderId) return false;
    return pasteClipboardInto(activeFolderId);
}

function wireCableSidebarClick(cableInfo) {
    if (!cableInfo) return;
    wireCableSidebarSelection(cableInfo);
    const openEditor = (e) => {
        if (e) e.stopPropagation();
        selectSidebarCable(cableInfo);
        focusMapToCable(cableInfo);
        openCableEditor(cableInfo);
    };
    const nameSpan = cableInfo.item?.querySelector('.item-name');
    if (nameSpan && nameSpan.dataset.editorClickBound !== '1') {
        nameSpan.dataset.editorClickBound = '1';
        nameSpan.style.cursor = 'pointer';
        nameSpan.addEventListener('click', openEditor);
    }
    if (cableInfo.polyline && !cableInfo._mapClickEditorBound) {
        cableInfo._mapClickEditorBound = true;
        //Shift + mousedown em cima do cabo: começa o retângulo; sem arrastar, marca o próprio cabo
        cableInfo.polyline.addListener('mousedown', (e) => {
            if (!e?.domEvent?.shiftKey || isDrawingCable) return;
            if (typeof startMapSelectionDrag === 'function' && typeof map !== 'undefined' && map) startMapSelectionDrag(e.latLng, e.domEvent, cableInfo);
            else if (typeof toggleMapSelectionFromMap === 'function') toggleMapSelectionFromMap(cableInfo);
        });
        cableInfo.polyline.addListener('click', (e) => (e?.domEvent?.shiftKey && typeof toggleMapSelectionFromMap === 'function') ? toggleMapSelectionFromMap(cableInfo) : (typeof isCableRouteOpen === 'function' && isCableRouteOpen() ? showCableRoute(cableInfo) : openCableEditor(cableInfo)));
    }
}

//Arrastar e soltar na barra lateral: o arraste começa no item (abaixo); o destino
//(antes, depois ou dentro de uma pasta) é calculado por delegação em js/sidebar.js
window.sidebarDropTarget = null;

function isDraggedSidebarFolder(element) {
    return !!element && (element.classList.contains('folder-wrapper') || element.classList.contains('folder'));
}

function isSidebarDragBlockedTarget(target) {
    return !!target.closest(
        '.ge-vis-checkbox, .visibility-toggle-btn, .item-actions-dropdown, .item-actions-menu, .item-actions-toggle-btn, .toggle-icon, .ge-expand, button, a, input, select, textarea'
    );
}

function beginSidebarDrag(containerElement, e) {
    if (!AppSession.canEdit) {
        e.preventDefault();
        return;
    }
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', containerElement.id || 'sidebar-item');
    e.dataTransfer.effectAllowed = 'move';
    window.draggedItem = containerElement;
    window.draggedItemSourceProject = containerElement.closest('.folder');
    window.dropWasSuccessful = false;
    document.body.classList.add('is-dragging-globally');
    containerElement.classList.add('is-being-dragged');
    if (typeof setSidebarDragGhost === 'function') setSidebarDragGhost(e, containerElement);
}

function enableDragAndDropForItem(itemElement) {
    if (!itemElement || itemElement.dataset.sidebarDndBound === '1') {
        return;
    }
    itemElement.dataset.sidebarDndBound = '1';
    itemElement.classList.add('sidebar-draggable');
    itemElement.querySelectorAll('.sidebar-drag-handle').forEach((h) => h.remove());
    itemElement.draggable = true;

    const onDragEnd = () => {
        if (window.dropWasSuccessful) {
            const row = itemElement.querySelector(':scope > .folder-title') || itemElement;
            row.classList.add('sidebar-drop-flash');
            setTimeout(() => row.classList.remove('sidebar-drop-flash'), 700);
        }
        document.body.classList.remove('is-dragging-globally');
        itemElement.classList.remove('is-being-dragged');
        clearSidebarDropState();
        window.draggedItem = null;
        window.draggedItemSourceProject = null;
        window.dropWasSuccessful = false;
    };

    itemElement.addEventListener('dragstart', (e) => {
        if (isSidebarDragBlockedTarget(e.target)) {
            e.preventDefault();
            return;
        }
        beginSidebarDrag(itemElement, e);
    });
    itemElement.addEventListener('dragend', onDragEnd);
}

//Mantida para compatibilidade: as listas só recebem a marca de "aceita soltar"
function enableDropOnFolder(ul) {
    if (!ul || ul.classList.contains('drop-enabled')) return;
    ul.classList.add('drop-enabled');
    ul.querySelectorAll(':scope > .drop-placeholder').forEach((el) => el.remove());
}

//Criação e edição de projetos
function createProject() {
    if (!requireEdit('criar projetos')) return;
    //Captura do formulário
    const projectNameInput = document.getElementById("projectName");
    const projectCityInput = document.getElementById("projectCity");
    const projectNeighborhoodInput = document.getElementById("projectNeighborhood");
    const projectTypeInput = document.getElementById("projectType");
    const projectName = projectNameInput.value.trim();
    const projectCity = projectCityInput.value.trim();
    const projectNeighborhood = projectNeighborhoodInput.value.trim();
    const projectType = projectTypeInput.value;
    //Modo edição
    if (editingFolderElement) {
        if (!projectName) {
        showAlert("Erro", "O nome do projeto não pode ficar vazio.");
        return;
        }
        editingFolderElement.dataset.folderName = projectName;
        editingFolderElement.dataset.folderCity = projectCity;
        editingFolderElement.dataset.folderNeighborhood = projectNeighborhood;
        editingFolderElement.dataset.folderType = projectType;
        editingFolderElement.querySelector('.folder-name-text').textContent = projectName;
        const editedProjectRoot = editingFolderElement.closest('.folder');
        editingFolderElement = null;
        document.getElementById("projectModal").style.display = "none";
        saveProjectElement(editedProjectRoot);
        return;
    }
    //Modo criação
    if (!projectName) {
        showAlert("Erro", "Por favor, digite o nome do projeto.");
        return;
    }
    //ID do projeto (também usado como id da lista na sidebar)
    const projectId = `proj_${crypto.randomUUID().replace(/-/g, '')}`;
    //Cria elemento visual na sidebar
    const template = document.getElementById('project-template');
    const clone = template.content.cloneNode(true);
    const titleDiv = clone.querySelector('.folder-title');
    const nameSpan = clone.querySelector('.folder-name-text');
    const subList = clone.querySelector('.subfolders');
    const visibilityBtn = clone.querySelector('.visibility-toggle-btn');
    const projectElement = clone.querySelector('.folder');
    //Configura o drag & drop do proprio projeto
    enableDragAndDropForItem(projectElement);
    //Define metadados no DOM
    nameSpan.textContent = projectName;
    subList.id = projectId;
    titleDiv.dataset.folderId = projectId;
    titleDiv.dataset.folderName = projectName;
    titleDiv.dataset.folderCity = projectCity;
    titleDiv.dataset.folderNeighborhood = projectNeighborhood;
    titleDiv.dataset.folderType = projectType;
    titleDiv.dataset.isProject = "true";
    visibilityBtn.dataset.folderId = projectId;
    //Configura eventso de clique na pasta projeto
    const toggleIcon = titleDiv.querySelector('.toggle-icon');
    toggleIcon.onclick = (e) => { e.stopPropagation(); toggleFolder(projectId); };
    enableDropOnFolder(subList);
    //Adiciona ao DOM
    document.getElementById("sidebar").appendChild(clone);
    updateSidebarEmptyState();
    //Persistência inicial no banco
    const projectRoot = document.getElementById(projectId).closest('.folder');
    persistProject(projectRoot).then(() => {
        setActiveFolder(projectId);
        document.getElementById("projectModal").style.display = "none";
        if (typeof rememberLastProject === 'function') rememberLastProject(projectId);
    }).catch(error => {
        console.error("Erro ao criar o projeto no banco:", error);
        showAlert("Erro de Banco de Dados", "Não foi possível criar o projeto. Tente novamente.");
        projectRoot?.remove();
        updateSidebarEmptyState();
    });
}

//Criação e edição de pastas
function createFolder() {
    if (!requireEdit('criar pastas')) return;
    const folderNameInput = document.getElementById("folderNameInput");
    const folderName = folderNameInput.value.trim();
    //Modo edição
    if (editingFolderElement) {
        if (!folderName) {
        showAlert("Erro", "O nome da pasta não pode ficar vazio.");
        return;
        }
        editingFolderElement.querySelector('.folder-name-text').textContent = folderName;
        editingFolderElement.dataset.folderName = folderName;
        const editedProjectRoot = editingFolderElement.closest('.folder');
        editingFolderElement = null;
        document.getElementById("folderModal").style.display = "none";
        saveProjectElement(editedProjectRoot);
        return;
    }
    //Modo criação
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione uma pasta ou projeto para adicionar.");
        return;
    }
    if (!folderName) {
        showAlert("Erro", "Por favor, digite o nome da pasta.");
        return;
    }
    //Gera ID único
    const folderId = `folder-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const template = document.getElementById('folder-template');
    const clone = template.content.cloneNode(true);
    //Referências aos elementos
    const wrapperLi = clone.querySelector('.folder-wrapper');
    const titleDiv = clone.querySelector('.folder-title');
    const nameSpan = clone.querySelector('.folder-name-text');
    const subList = clone.querySelector('.subfolders');
    const visibilityBtn = clone.querySelector('.visibility-toggle-btn');
    //Configura a própria pasta para ser arrastável
    enableDragAndDropForItem(wrapperLi);
    //Define metadados dos IDs
    nameSpan.textContent = folderName;
    subList.id = folderId;
    titleDiv.dataset.folderId = folderId;
    titleDiv.dataset.folderName = folderName;
    titleDiv.dataset.isProject = "false";
    visibilityBtn.dataset.folderId = folderId;
    //Eventos de interação
    const toggleIcon = titleDiv.querySelector('.toggle-icon');
    //Remove destaque visual ao sair da área do drop
    toggleIcon.onclick = (e) => { e.stopPropagation(); toggleFolder(folderId); };
    enableDropOnFolder(subList);
    //Inserção no DOM
    const parentUl = document.getElementById(activeFolderId);
    parentUl.appendChild(wrapperLi);
    setActiveFolder(folderId);
    document.getElementById("folderModal").style.display = "none";
}

//Altenar visibilidade da pasta - expandir e recolher
function toggleFolder(id) {
    const folderUl = document.getElementById(id);
    if (!folderUl) return;
    const titleDiv = folderUl.previousElementSibling;
    if (!titleDiv || !titleDiv.classList.contains("folder-title")) return;
    const iconSpan = titleDiv.querySelector(".toggle-icon");
    const isHidden = folderUl.classList.contains("hidden");
    folderUl.classList.toggle("hidden");
    if (iconSpan) {
        iconSpan.textContent = isHidden ? '▼' : '►';
    }
}

//Definir a pasta ativa para a inserção
function shouldIgnoreFolderTitleInteraction(event) {
    return !!event.target.closest(
        '.folder-buttons, .toggle-icon, .ge-vis-checkbox, .item-actions-dropdown, .sidebar-drag-handle, .item-actions-toggle-btn'
    );
}

function initSidebarFolderClickBehavior() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    sidebar.addEventListener('click', (e) => {
        const titleElement = e.target.closest('.folder-title');
        if (!titleElement || shouldIgnoreFolderTitleInteraction(e)) return;
        const folderId = titleElement.dataset.folderId;
        if (!folderId) return;
        e.stopPropagation();
        setActiveFolder(folderId);
    });

    sidebar.addEventListener('dblclick', (e) => {
        const titleElement = e.target.closest('.folder-title');
        if (!titleElement || shouldIgnoreFolderTitleInteraction(e)) return;
        const folderId = titleElement.dataset.folderId;
        if (!folderId) return;
        e.preventDefault();
        e.stopPropagation();
        setActiveFolder(folderId);
        focusMapToFolderScope(folderId);
    });
}

function setActiveFolder(id) {
    clearSidebarItemSelection();
    const ul = document.getElementById(id);
    if (ul) {
        activeFolderId = id;
        const title = ul.previousElementSibling;
        if (title) {
            title.classList.add("active");
            selectedSidebarCopyTarget = { type: 'folder', folderId: id }; //Projeto ou pasta: Ctrl+C copia tudo dentro
        }
    } else {
        selectedSidebarCopyTarget = null;
    }
    bomState = {};
}
