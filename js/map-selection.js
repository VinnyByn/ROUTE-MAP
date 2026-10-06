// Seleção múltipla no mapa: Shift + arrastar desenha um retângulo e seleciona os marcadores do projeto
// ativo; Shift + clique adiciona ou tira um marcador. Barra de ações: situação, mover para pasta,
// ocultar/mostrar, excluir. Depende de script.js e js/sidebar.js.

const mapSelection = { items: new Set(), rings: new Map(), drag: null };

function isMapSelectionBusy() {
    return isDrawingCable || isDrawingPolygon || isAddingMarker || (typeof isSketchToolActive === 'function' && isSketchToolActive());
}

function selectionRingFor(markerInfo) {
    return new google.maps.Marker({
        position: markerInfo.marker.getPosition(), map, clickable: false, zIndex: 999,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: (typeof getMarkerPixelSize === 'function' ? getMarkerPixelSize() : 24) / 2 + 6,
            fillColor: '#2563eb', fillOpacity: 0.12, strokeColor: '#2563eb', strokeWeight: 2.5 },
    });
}

function setMapSelection(list) {
    mapSelection.rings.forEach(r => r.setMap(null));
    mapSelection.rings.clear();
    mapSelection.items = new Set(list.filter(m => markers.includes(m)));
    if (typeof google !== 'undefined' && google.maps?.Marker) {
        mapSelection.items.forEach(m => { if (m.marker?.getPosition) mapSelection.rings.set(m, selectionRingFor(m)); });
    }
    renderMapSelectionBar();
}

function toggleMapSelection(markerInfo) {
    const list = [...mapSelection.items];
    const i = list.indexOf(markerInfo);
    if (i >= 0) list.splice(i, 1); else list.push(markerInfo);
    setMapSelection(list);
}

function clearMapSelection() {
    setMapSelection([]);
}

function getSelectionScopeMarkers() {
    const projectId = getActiveProjectId();
    if (!projectId) return markers;
    const ids = new Set(getAllDescendantFolderIds(projectId));
    return markers.filter(m => ids.has(m.folderId));
}

function selectMarkersInBounds(bounds, { add = false } = {}) {
    const inside = getSelectionScopeMarkers().filter(m => m.marker?.getVisible?.() !== false && m.marker?.getPosition && bounds.contains(m.marker.getPosition()));
    setMapSelection(add ? [...new Set([...mapSelection.items, ...inside])] : inside);
}

// ---------------------------------------------------------------
// Barra de ações
// ---------------------------------------------------------------

const SELECTION_STATUS_TYPES = ['CTO', 'CEO', 'RESERVA', 'CORDOALHA', 'Importado'];

function renderMapSelectionBar() {
    const bar = document.getElementById('mapSelectionBar');
    if (!bar) return;
    const items = [...mapSelection.items];
    bar.classList.toggle('hidden', !items.length);
    if (!items.length) return;
    const counts = {};
    items.forEach(m => { const k = m.type === 'CLIENTE' ? 'Cliente' : m.type; counts[k] = (counts[k] || 0) + 1; });
    document.getElementById('mapSelectionCount').textContent = `${items.length} selecionado${items.length === 1 ? '' : 's'}`;
    document.getElementById('mapSelectionKinds').textContent = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(' · ');
    const projectId = getActiveProjectId();
    const folderSelect = document.getElementById('mapSelectionFolder');
    const folders = projectId ? getAllDescendantFolderIds(projectId) : [];
    folderSelect.innerHTML = '<option value="">Mover para pasta…</option>' + folders.map(id => {
        const name = document.querySelector(`.folder-title[data-folder-id="${CSS.escape(id)}"]`)?.dataset.folderName || id;
        return `<option value="${escapeHtml(id)}">${escapeHtml(id === projectId ? `${name} (raiz)` : name)}</option>`;
    }).join('');
    const canEdit = AppSession.canEdit;
    bar.querySelectorAll('[data-sel-edit]').forEach(el => { el.disabled = !canEdit; });
    document.getElementById('mapSelectionStatus').disabled = !canEdit || !items.some(m => SELECTION_STATUS_TYPES.includes(m.type));
}

function applySelectionStatus(status) {
    if (!status || !requireEdit('alterar a situação')) return;
    let changed = 0;
    mapSelection.items.forEach(m => {
        if (!SELECTION_STATUS_TYPES.includes(m.type)) return;
        if (status === 'Troca' && !['CTO', 'CEO'].includes(m.type)) return; //Troca só existe para caixas
        applyMarkerInfrastructureStatus(m, status);
        updateMarkerAppearance(m);
        changed++;
    });
    refreshBomAfterProjectChange();
    showToast('Situação alterada', `${changed} marcador(es) agora "${status}".`);
}

function moveSelectionToFolder(folderId) {
    const ul = folderId && document.getElementById(folderId);
    if (!ul || !requireEdit('mover itens')) return;
    mapSelection.items.forEach(m => {
        m.folderId = folderId;
        if (m.listItem) ul.appendChild(m.listItem);
    });
    updateSidebarCounts();
    refreshBomAfterProjectChange();
    const name = document.querySelector(`.folder-title[data-folder-id="${CSS.escape(folderId)}"]`)?.dataset.folderName || '';
    showToast('Itens movidos', `${mapSelection.items.size} item(ns) em "${name}".`);
}

function setSelectionVisible(visible) {
    mapSelection.items.forEach(m => {
        const checkbox = m.listItem?.querySelector(':scope > .ge-vis-checkbox');
        if (checkbox) {
            checkbox.checked = visible;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            m.marker?.setVisible(visible);
        }
    });
    if (!visible) clearMapSelection();
}

function deleteSelection() {
    if (!requireEdit('excluir itens')) return;
    const items = [...mapSelection.items];
    showConfirm('Excluir selecionados', `Excluir ${items.length} item(ns) do mapa? Esta ação pode ser desfeita com Ctrl+Z.`, () => {
        items.forEach(m => {
            if (focusedMapMarkerInfo === m) clearMapMarkerHighlight();
            m.marker?.setMap(null);
            m.listItem?.remove();
        });
        markers = markers.filter(m => !items.includes(m));
        clearMapSelection();
        updateSidebarCounts();
        refreshClientDrops();
        refreshBomAfterProjectChange();
        showToast('Itens excluídos', `${items.length} item(ns) removido(s).`);
    });
}

// ---------------------------------------------------------------
// Retângulo (Shift + arrastar)
// ---------------------------------------------------------------

function setupMapSelectionDrag() {
    if (typeof map === 'undefined' || !map) return;
    let rect = null;
    map.addListener('mousedown', (e) => {
        if (!e.domEvent?.shiftKey || isMapSelectionBusy()) return;
        mapSelection.drag = { start: e.latLng, add: e.domEvent.ctrlKey || e.domEvent.metaKey };
        map.setOptions({ draggable: false, gestureHandling: 'none' });
        rect = new google.maps.Rectangle({ map, clickable: false, strokeColor: '#2563eb', strokeWeight: 1.5, fillColor: '#2563eb', fillOpacity: 0.08,
            bounds: new google.maps.LatLngBounds(e.latLng, e.latLng) });
    });
    map.addListener('mousemove', (e) => {
        if (!mapSelection.drag || !rect) return;
        const b = new google.maps.LatLngBounds();
        b.extend(mapSelection.drag.start);
        b.extend(e.latLng);
        rect.setBounds(b);
    });
    const finish = () => {
        if (!mapSelection.drag) return;
        const bounds = rect?.getBounds();
        rect?.setMap(null);
        rect = null;
        map.setOptions({ draggable: true, gestureHandling: 'auto' });
        const add = mapSelection.drag.add;
        mapSelection.drag = null;
        if (bounds && !bounds.getNorthEast().equals(bounds.getSouthWest())) selectMarkersInBounds(bounds, { add });
    };
    map.addListener('mouseup', finish);
    document.addEventListener('mouseup', finish);
}

document.addEventListener('DOMContentLoaded', () => {
    const bar = document.getElementById('mapSelectionBar');
    if (!bar) return;
    document.getElementById('mapSelectionStatus').addEventListener('change', (e) => { applySelectionStatus(e.target.value); e.target.value = ''; });
    document.getElementById('mapSelectionFolder').addEventListener('change', (e) => { moveSelectionToFolder(e.target.value); e.target.value = ''; });
    document.getElementById('mapSelectionHide').addEventListener('click', () => setSelectionVisible(false));
    document.getElementById('mapSelectionDelete').addEventListener('click', deleteSelection);
    document.getElementById('mapSelectionClear').addEventListener('click', clearMapSelection);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mapSelection.items.size) clearMapSelection();
    });
    if (typeof mapReady !== 'undefined' && mapReady?.then) mapReady.then(setupMapSelectionDrag);
});
