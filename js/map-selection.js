// Seleção múltipla no mapa: Shift + arrastar desenha um retângulo e seleciona marcadores e cabos que encostam nele
// e polígonos inteiros dentro dele, do projeto ativo; Shift + clique adiciona ou tira um marcador.
// Na barra lateral: Ctrl + clique e Shift + clique (intervalo). Barra de ações: situação, mover para pasta,
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

//A seleção guarda marcadores, cabos e polígonos
function selectionKind(item) {
    if (markers.includes(item)) return 'marker';
    if (savedCables.includes(item)) return 'cable';
    if (savedPolygons.includes(item)) return 'polygon';
    return null;
}

function selectionRow(item) {
    return item.listItem || item.item || null;
}

function findSelectableByRow(row) {
    return markers.find(m => m.listItem === row) || savedCables.find(c => c.item === row) || savedPolygons.find(p => p.listItem === row) || null;
}

//Destaque azul por baixo do cabo/polígono selecionado
function selectionOutlineFor(item, kind) {
    if (kind === 'marker') return item.marker?.getPosition ? selectionRingFor(item) : null;
    if (kind === 'cable' && item.polyline?.getPath && google.maps.Polyline) {
        return new google.maps.Polyline({ map, path: item.polyline.getPath(), clickable: false, zIndex: 0, strokeColor: '#2563eb', strokeOpacity: 0.5, strokeWeight: (item.polyline.get?.('strokeWeight') || item.width || 4) + 8 });
    }
    if (kind === 'polygon' && item.polygonObject?.getPaths && google.maps.Polygon) {
        return new google.maps.Polygon({ map, paths: item.polygonObject.getPaths(), clickable: false, zIndex: 0, strokeColor: '#2563eb', strokeOpacity: 0.9, strokeWeight: 4, fillOpacity: 0 });
    }
    return null;
}

function setMapSelection(list) {
    mapSelection.rings.forEach(r => r.setMap(null));
    mapSelection.rings.clear();
    mapSelection.items = new Set(list.filter(selectionKind));
    if (typeof google !== 'undefined' && google.maps?.Marker) {
        mapSelection.items.forEach(m => {
            const outline = selectionOutlineFor(m, selectionKind(m));
            if (outline) mapSelection.rings.set(m, outline);
        });
    }
    syncSidebarSelection();
    renderMapSelectionBar();
}

//Destaca na barra lateral as linhas dos marcadores selecionados
function syncSidebarSelection() {
    document.querySelectorAll('.ge-pro-item.is-multi-selected').forEach(li => li.classList.remove('is-multi-selected'));
    mapSelection.items.forEach(m => selectionRow(m)?.classList.add('is-multi-selected'));
}

//Barra lateral: Ctrl+clique adiciona/tira, Shift+clique seleciona o intervalo desde o último clicado
function setupSidebarMultiSelect() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.addEventListener('click', (e) => {
        if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
        if (e.target.closest('input, button, .sb-menu-button')) return;
        const li = e.target.closest('.ge-pro-item');
        const info = li && findSelectableByRow(li);
        if (!info) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const anchor = mapSelection.sidebarAnchor;
        if (e.shiftKey && anchor && selectionRow(anchor)?.isConnected) {
            const anchorRow = selectionRow(anchor);
            const rows = [...sidebar.querySelectorAll('.ge-pro-item')].filter(r => r.offsetParent !== null || r === li || r === anchorRow);
            const a = rows.indexOf(anchorRow), b = rows.indexOf(li);
            const range = rows.slice(Math.min(a, b), Math.max(a, b) + 1).map(findSelectableByRow).filter(Boolean);
            const base = (e.ctrlKey || e.metaKey) ? [...mapSelection.items] : [];
            setMapSelection([...new Set([...base, ...range])]);
        } else {
            toggleMapSelection(info);
            mapSelection.sidebarAnchor = info;
        }
    }, true);
}

//Shift+clique no mapa: o mesmo item pode chegar pelo clique dele e pelo clique no mapa; conta uma vez só
function toggleMapSelectionFromMap(item) {
    const now = Date.now();
    if (mapSelection.lastToggle?.item === item && now - mapSelection.lastToggle.at < 400) return;
    mapSelection.lastToggle = { item, at: now };
    toggleMapSelection(item);
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

function getSelectionScopeMarkers(list = markers) {
    const projectId = getActiveProjectId();
    if (!projectId) return list;
    const ids = new Set(getAllDescendantFolderIds(projectId));
    return list.filter(m => ids.has(m.folderId));
}

//Polígonos entram quando estão inteiros dentro do retângulo
function shapeInsideBounds(shape, bounds) {
    if (!shape || shape.getVisible?.() === false || !shape.getPath) return false;
    const points = shape.getPath().getArray?.() || [];
    return points.length > 0 && points.every(p => bounds.contains(p));
}

//Trecho a-b cruza o retângulo? (recorte de Liang-Barsky em lat/lng)
function segmentCrossesBox(a, b, box) {
    const x0 = a.lng(), y0 = a.lat(), dx = b.lng() - x0, dy = b.lat() - y0;
    let t0 = 0, t1 = 1;
    const edges = [[-dx, x0 - box.west], [dx, box.east - x0], [-dy, y0 - box.south], [dy, box.north - y0]];
    for (const [p, q] of edges) {
        if (p === 0) { if (q < 0) return false; continue; }
        const r = q / p;
        if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
        else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return true;
}

//Cabos entram quando qualquer parte do traçado encosta no retângulo
function cableTouchesBounds(cable, bounds) {
    const line = cable.polyline;
    if (line?.getVisible?.() === false) return false;
    const points = line?.getPath?.().getArray?.() || cable.path || [];
    if (!points.length) return false;
    if (points.some(p => bounds.contains(p))) return true;
    const ne = bounds.getNorthEast?.();
    const sw = bounds.getSouthWest?.();
    if (!ne || !sw) return false;
    const box = { north: ne.lat(), east: ne.lng(), south: sw.lat(), west: sw.lng() };
    for (let i = 1; i < points.length; i++) if (segmentCrossesBox(points[i - 1], points[i], box)) return true;
    return false;
}

function selectMarkersInBounds(bounds, { add = false } = {}) {
    const inside = [
        ...getSelectionScopeMarkers().filter(m => m.marker?.getVisible?.() !== false && m.marker?.getPosition && bounds.contains(m.marker.getPosition())),
        ...getSelectionScopeMarkers(savedCables).filter(c => cableTouchesBounds(c, bounds)),
        ...getSelectionScopeMarkers(savedPolygons).filter(p => shapeInsideBounds(p.polygonObject, bounds)),
    ];
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
    items.forEach(m => {
        const kind = selectionKind(m);
        const k = kind === 'cable' ? 'Cabo' : kind === 'polygon' ? 'Polígono' : m.type === 'CLIENTE' ? 'Cliente' : m.type;
        counts[k] = (counts[k] || 0) + 1;
    });
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
    document.getElementById('mapSelectionStatus').disabled = !canEdit || !items.some(m => selectionKind(m) === 'marker' && SELECTION_STATUS_TYPES.includes(m.type));
    document.getElementById('mapSelectionStyle').disabled = !canEdit || !items.some(m => selectionKind(m) === 'cable' || (selectionKind(m) === 'marker' && FOLDER_STYLE_TYPES.some(t => t.type === m.type)));
}

function applySelectionStatus(status) {
    if (!status || !requireEdit('alterar a situação')) return;
    let changed = 0;
    mapSelection.items.forEach(m => {
        if (selectionKind(m) !== 'marker' || !SELECTION_STATUS_TYPES.includes(m.type)) return;
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
        const row = selectionRow(m);
        if (row) ul.appendChild(row);
    });
    updateSidebarCounts();
    refreshBomAfterProjectChange();
    const name = document.querySelector(`.folder-title[data-folder-id="${CSS.escape(folderId)}"]`)?.dataset.folderName || '';
    showToast('Itens movidos', `${mapSelection.items.size} item(ns) em "${name}".`);
}

function setSelectionVisible(visible) {
    mapSelection.items.forEach(m => {
        const checkbox = selectionRow(m)?.querySelector(':scope > .ge-vis-checkbox');
        if (checkbox) {
            checkbox.checked = visible;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            (m.marker || m.polyline || m.polygonObject)?.setVisible?.(visible);
        }
    });
    if (!visible) clearMapSelection();
}

function deleteSelection() {
    if (!requireEdit('excluir itens')) return;
    const all = [...mapSelection.items];
    //Cabo com fusões não sai (igual à exclusão individual)
    const blocked = all.filter(c => selectionKind(c) === 'cable' && checkCableUsageInFusionPlans(c).hasFusions);
    const items = all.filter(it => !blocked.includes(it));
    const blockedNote = blocked.length ? ` ${blocked.length} cabo(s) com fusões ficam: ${blocked.map(c => c.name).join(', ')}.` : '';
    if (!items.length) {
        showAlert('Ação bloqueada', `Os cabos selecionados têm fusões. Remova as fusões no plano de fusão antes de excluir.`);
        return;
    }
    showConfirm('Excluir selecionados', `Excluir ${items.length} item(ns) do mapa? Esta ação pode ser desfeita com Ctrl+Z.${blockedNote}`, () => {
        items.forEach(it => {
            const kind = selectionKind(it);
            if (kind === 'marker') {
                if (focusedMapMarkerInfo === it) clearMapMarkerHighlight();
                it.marker?.setMap(null);
            } else if (kind === 'cable') {
                const usage = checkCableUsageInFusionPlans(it);
                if (usage.isInPlan) removeCableFromSavedFusionPlans(it, usage.boxes);
                it.polyline?.setMap(null);
            } else if (kind === 'polygon') {
                it.polygonObject?.setMap(null);
            }
            selectionRow(it)?.remove();
        });
        markers = markers.filter(m => !items.includes(m));
        savedCables = savedCables.filter(c => !items.includes(c));
        savedPolygons = savedPolygons.filter(p => !items.includes(p));
        setMapSelection(blocked);
        updateSidebarCounts();
        refreshClientDrops({ recompute: true });
        refreshBomAfterProjectChange();
        showToast('Itens excluídos', `${items.length} item(ns) removido(s).`);
    });
}

// ---------------------------------------------------------------
// Retângulo (Shift + arrastar)
// ---------------------------------------------------------------

//Item mais perto do ponto (cabo até 10 px da linha, marcador até 16 px), no projeto ativo e visível
function findNearestMapItem(latLng) {
    const mpp = typeof getMetersPerPixelAt === 'function' ? getMetersPerPixelAt(latLng) : 1;
    let best = null;
    const consider = (item, distPx, limit) => { if (distPx <= limit && (!best || distPx < best.d)) best = { item, d: distPx }; };
    getSelectionScopeMarkers().forEach(m => {
        if (m.marker?.getVisible?.() === false || !m.marker?.getPosition) return;
        const p = m.marker.getPosition();
        consider(m, projectOnCablePath([p, p], latLng).dist / mpp, 16);
    });
    if (best) return best.item; //Marcador tem prioridade sobre o cabo que chega nele
    getSelectionScopeMarkers(savedCables).forEach(c => {
        if (c.polyline?.getVisible?.() === false || !c.path || c.path.length < 2) return;
        const path = c.polyline?.getPath?.().getArray?.() || c.path;
        const q = projectOnCablePath(path, latLng);
        if (q) consider(c, q.dist / mpp, 10);
    });
    return best?.item || null;
}

function toggleNearestMapItem(latLng) {
    if (typeof projectOnCablePath !== 'function') return;
    const item = findNearestMapItem(latLng);
    if (item) toggleMapSelectionFromMap(item);
}

let mapSelectionRect = null;

//Shift + mousedown no mapa ou em cima de um cabo começa o retângulo. Sem arrastar, vira Shift+clique
//no item ("hit", quando o mousedown foi no próprio cabo) ou no mais perto.
function startMapSelectionDrag(latLng, domEvent, hit = null) {
    if (!domEvent?.shiftKey || !latLng || mapSelection.drag || isMapSelectionBusy()) return;
    mapSelection.drag = { start: latLng, add: domEvent.ctrlKey || domEvent.metaKey, hit };
    mapSelection.dragStart = latLng;
    map.setOptions({ draggable: false, gestureHandling: 'none' });
    //Cabos sem clique durante o arraste: o mapa continua recebendo o movimento em cima deles
    if (typeof setAllCablesClickable === 'function') setAllCablesClickable(false);
    mapSelectionRect = new google.maps.Rectangle({ map, clickable: false, strokeColor: '#2563eb', strokeWeight: 1.5, fillColor: '#2563eb', fillOpacity: 0.08,
        bounds: new google.maps.LatLngBounds(latLng, latLng) });
}

function setupMapSelectionDrag() {
    if (typeof map === 'undefined' || !map) return;
    map.addListener('mousedown', (e) => startMapSelectionDrag(e.latLng, e.domEvent));
    map.addListener('mousemove', (e) => {
        const rect = mapSelectionRect;
        if (!mapSelection.drag || !rect) return;
        const b = new google.maps.LatLngBounds();
        b.extend(mapSelection.drag.start);
        b.extend(e.latLng);
        rect.setBounds(b);
    });
    const finish = () => {
        if (!mapSelection.drag) return;
        const bounds = mapSelectionRect?.getBounds();
        mapSelectionRect?.setMap(null);
        mapSelectionRect = null;
        map.setOptions({ draggable: true, gestureHandling: 'auto' });
        if (typeof setAllCablesClickable === 'function') setAllCablesClickable(true);
        const { add, hit } = mapSelection.drag;
        mapSelection.drag = null;
        const start = mapSelection.dragStart;
        mapSelection.dragStart = null;
        if (bounds && !bounds.getNorthEast().equals(bounds.getSouthWest())) selectMarkersInBounds(bounds, { add });
        else if (hit) toggleMapSelectionFromMap(hit);
        else if (start) toggleNearestMapItem(start); //Shift+clique sem arrastar: o mapa travado pode engolir o clique no cabo
    };
    map.addListener('mouseup', finish);
    document.addEventListener('mouseup', finish);
}

document.addEventListener('DOMContentLoaded', () => {
    setupSidebarMultiSelect();
    const bar = document.getElementById('mapSelectionBar');
    if (!bar) return;
    document.getElementById('mapSelectionStatus').addEventListener('change', (e) => { applySelectionStatus(e.target.value); e.target.value = ''; });
    document.getElementById('mapSelectionFolder').addEventListener('change', (e) => { moveSelectionToFolder(e.target.value); e.target.value = ''; });
    document.getElementById('mapSelectionHide').addEventListener('click', () => setSelectionVisible(false));
    document.getElementById('mapSelectionStyle').addEventListener('click', () => openSelectionStyleModal([...mapSelection.items]));
    document.getElementById('mapSelectionDelete').addEventListener('click', deleteSelection);
    document.getElementById('mapSelectionClear').addEventListener('click', clearMapSelection);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mapSelection.items.size) clearMapSelection();
    });
    if (typeof mapReady !== 'undefined' && mapReady?.then) mapReady.then(setupMapSelectionDrag);
});
