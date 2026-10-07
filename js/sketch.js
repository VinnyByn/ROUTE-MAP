// Ferramentas de esboço no mapa: régua (distância e área) e polígonos (desenho, cor, edição).
// Depende de script.js (map, savedPolygons, barra lateral) e do Google Maps (geometry).

//Ferramentas de esboço no mapa (polígono e régua).
//Substituem a Drawing Library do Google, que foi descontinuada e removida da API.
const RULER_COLOR = '#e11d48';
const DEFAULT_POLYGON_COLOR = '#2dd4bf';
const DEFAULT_POLYGON_OPACITY = 0.35;
let sketchSession = null; //Sessão de desenho ativa: { shape, color, vertices, line, fill, rubber, labels, listeners }
let rulerMode = 'distance'; //'distance' ou 'area'
let polygonEditListeners = []; //Listeners do path do polígono em edição

function formatDistance(meters) {
    const m = Number(meters) || 0;
    if (m >= 1000) {
        return `${(m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
    }
    return `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m`;
}

//Área sempre em metros quadrados (ex.: 12.480 m²)
function formatArea(squareMeters) {
    const m2 = Number(squareMeters) || 0;
    return `${Math.round(m2).toLocaleString('pt-BR')} m²`;
}

//Rótulo de texto HTML preso a uma coordenada do mapa
function createMapTextLabel(position, text, className) {
    const overlay = new google.maps.OverlayView();
    const div = document.createElement('div');
    div.className = `map-text-label ${className || ''}`.trim();
    div.textContent = text;
    overlay.onAdd = function () { this.getPanes().floatPane.appendChild(div); };
    overlay.draw = function () {
        const point = this.getProjection()?.fromLatLngToDivPixel(position);
        if (!point) return;
        div.style.left = `${point.x}px`;
        div.style.top = `${point.y}px`;
    };
    overlay.onRemove = function () { div.remove(); };
    overlay.setMap(map);
    return overlay;
}

function setAllCablesClickable(isClickable) {
    savedCables.forEach(cableInfo => {
        if (cableInfo.polyline) cableInfo.polyline.setOptions({ clickable: isClickable });
    });
}

function isSketchToolActive() {
    return !!sketchSession;
}

function getSketchVertexIcon(color, isFirstClosable) {
    return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: isFirstClosable ? 7 : 5,
        fillColor: isFirstClosable ? color : '#ffffff',
        fillOpacity: 1,
        strokeColor: isFirstClosable ? '#ffffff' : color,
        strokeWeight: 2
    };
}

//Inicia uma sessão de desenho por cliques. shape: 'line' ou 'area'.
function startSketch(options) {
    stopSketch();
    const color = options.color;
    const session = {
        shape: options.shape,
        color,
        showSegmentLabels: !!options.showSegmentLabels,
        onChange: options.onChange || null,
        onClose: options.onClose || null,
        vertices: [],
        labels: [],
        listeners: [],
        lastCursor: null
    };
    session.line = new google.maps.Polyline({
        map, path: [], clickable: false, strokeColor: color, strokeWeight: 3, strokeOpacity: 0.95, zIndex: 2000
    });
    session.fill = new google.maps.Polygon({
        map: null, paths: [], clickable: false, strokeWeight: 0,
        fillColor: color, fillOpacity: options.fillOpacity ?? 0.22, zIndex: 1999
    });
    session.rubber = new google.maps.Polyline({
        map, path: [], clickable: false, strokeColor: color, strokeOpacity: 0, zIndex: 2000,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, scale: 2 }, offset: '0', repeat: '9px' }]
    });
    session.listeners.push(map.addListener('click', (e) => addSketchPoint(e.latLng)));
    session.listeners.push(map.addListener('mousemove', (e) => updateSketchRubber(e.latLng)));
    session.listeners.push(map.addListener('mouseout', () => updateSketchRubber(null)));
    sketchSession = session;
    setAllPolygonsClickable(false);
    setAllCablesClickable(false);
    setMapCursor('crosshair');
    refreshSketch(true);
    return session;
}

function getSketchPath() {
    return sketchSession ? sketchSession.vertices.map(v => v.getPosition()) : [];
}

function addSketchPoint(latLng) {
    const session = sketchSession;
    if (!session || !latLng) return;
    const last = session.vertices[session.vertices.length - 1];
    if (last && google.maps.geometry.spherical.computeDistanceBetween(last.getPosition(), latLng) < 0.5) return;
    const vertex = new google.maps.Marker({
        position: latLng,
        map,
        draggable: true,
        zIndex: 3000,
        icon: getSketchVertexIcon(session.color, false)
    });
    vertex.addListener('drag', () => refreshSketch(false));
    vertex.addListener('dragend', () => refreshSketch(true));
    vertex.addListener('rightclick', (e) => {
        if (e?.domEvent) e.domEvent.preventDefault();
        removeSketchVertex(vertex);
    });
    vertex.addListener('click', () => {
        //Clicar no primeiro ponto fecha a área
        if (session.shape === 'area' && session.vertices[0] === vertex && session.vertices.length >= 3 && session.onClose) {
            session.onClose();
        }
    });
    session.vertices.push(vertex);
    refreshSketch(true);
}

function removeSketchVertex(vertex) {
    const session = sketchSession;
    if (!session) return;
    const index = session.vertices.indexOf(vertex);
    if (index === -1) return;
    session.vertices.splice(index, 1)[0].setMap(null);
    refreshSketch(true);
}

function undoSketchPoint() {
    const session = sketchSession;
    if (!session || !session.vertices.length) return false;
    session.vertices.pop().setMap(null);
    refreshSketch(true);
    return true;
}

function clearSketchPoints() {
    const session = sketchSession;
    if (!session) return;
    session.vertices.forEach(v => v.setMap(null));
    session.vertices = [];
    refreshSketch(true);
}

function setSketchShape(shape) {
    if (!sketchSession) return;
    sketchSession.shape = shape;
    refreshSketch(true);
}

//Redesenha linha, área, rótulos e linha-guia a partir dos vértices
function refreshSketch(updateIcons) {
    const session = sketchSession;
    if (!session) return;
    const path = getSketchPath();
    const isClosedArea = session.shape === 'area' && path.length >= 3;
    session.line.setPath(isClosedArea ? [...path, path[0]] : path);
    session.fill.setPaths(path);
    session.fill.setMap(isClosedArea ? map : null);
    if (updateIcons) {
        session.vertices.forEach((v, i) => {
            v.setIcon(getSketchVertexIcon(session.color, isClosedArea && i === 0 && !!session.onClose));
            v.setTitle(isClosedArea && i === 0 && session.onClose ? 'Clique para fechar a forma' : 'Arraste para ajustar · clique direito remove');
        });
    }
    renderSketchSegmentLabels(path, isClosedArea);
    updateSketchRubber(session.lastCursor);
    if (session.onChange) session.onChange(path);
}

function renderSketchSegmentLabels(path, isClosedArea) {
    const session = sketchSession;
    session.labels.forEach(label => label.setMap(null));
    session.labels = [];
    if (!session.showSegmentLabels || path.length < 2) return;
    const segments = [];
    for (let i = 1; i < path.length; i++) segments.push([path[i - 1], path[i]]);
    if (isClosedArea) segments.push([path[path.length - 1], path[0]]);
    segments.forEach(([a, b]) => {
        const length = google.maps.geometry.spherical.computeDistanceBetween(a, b);
        const midpoint = google.maps.geometry.spherical.interpolate(a, b, 0.5);
        session.labels.push(createMapTextLabel(midpoint, formatDistance(length), 'map-text-label--segment'));
    });
}

//Linha tracejada do último ponto até o cursor
function updateSketchRubber(cursorLatLng) {
    const session = sketchSession;
    if (!session) return;
    session.lastCursor = cursorLatLng;
    const path = getSketchPath();
    if (!cursorLatLng || !path.length) {
        session.rubber.setPath([]);
        if (session.onCursor) session.onCursor(null);
        return;
    }
    const rubberPath = [path[path.length - 1], cursorLatLng];
    if (session.shape === 'area' && path.length >= 2) rubberPath.push(path[0]);
    session.rubber.setPath(rubberPath);
    if (session.onCursor) session.onCursor(cursorLatLng);
}

function stopSketch() {
    const session = sketchSession;
    if (!session) return;
    session.listeners.forEach(listener => google.maps.event.removeListener(listener));
    session.vertices.forEach(v => v.setMap(null));
    session.labels.forEach(label => label.setMap(null));
    session.line.setMap(null);
    session.fill.setMap(null);
    session.rubber.setMap(null);
    sketchSession = null;
    setAllPolygonsClickable(true);
    setAllCablesClickable(true);
    setMapCursor('');
}

//Clique em marcador durante o esboço: usa a posição exata do marcador como ponto
function handleSketchMarkerClick(markerInfo) {
    if (!sketchSession || !markerInfo?.marker) return false;
    addSketchPoint(markerInfo.marker.getPosition());
    return true;
}

function handleSketchKeyboard(event) {
    if (!sketchSession || isEditableKeyboardTarget(event.target)) return false;
    const key = event.key.toLowerCase();
    const isUndo = ((event.ctrlKey || event.metaKey) && key === 'z') || key === 'backspace' || key === 'delete';
    if (!isUndo) return false;
    event.preventDefault();
    undoSketchPoint();
    return true;
}

// ---------------------------------------------------------------
// Polígono
// ---------------------------------------------------------------

function getPolygonFormValues() {
    const opacityInput = document.getElementById('polygonOpacity');
    return {
        name: document.getElementById('polygonName').value.trim(),
        color: document.getElementById('polygonColor').value,
        opacity: Math.min(1, Math.max(0, Number(opacityInput.value) / 100))
    };
}

function setPolygonBoxPhase(phase) {
    //phase: 'drawing' (marcando pontos) ou 'editing' (forma fechada, ajustando vértices)
    const box = document.getElementById('polygonDrawingBox');
    box.dataset.phase = phase;
    document.getElementById('polygonUndoButton').classList.toggle('hidden', phase !== 'drawing');
    document.getElementById('polygonFinishButton').classList.toggle('hidden', phase !== 'drawing');
    document.getElementById('polygonHelp').textContent = phase === 'drawing'
        ? 'Clique no mapa para marcar os vértices. Clique no primeiro ponto ou em "Fechar forma" para concluir. Clique direito remove um ponto.'
        : 'Arraste os vértices para ajustar. Arraste os pontos intermediários para criar novos vértices.';
}

function updatePolygonStats(path) {
    const statsEl = document.getElementById('polygonStats');
    if (!statsEl) return;
    const points = path ? (Array.isArray(path) ? path : path.getArray()) : [];
    if (points.length < 3) {
        statsEl.innerHTML = `<div><dt>Vértices</dt><dd>${points.length}</dd></div><div><dt>Área</dt><dd>—</dd></div><div><dt>Perímetro</dt><dd>—</dd></div>`;
        document.getElementById('polygonFinishButton').disabled = true;
        return;
    }
    const area = google.maps.geometry.spherical.computeArea(points);
    const perimeter = google.maps.geometry.spherical.computeLength([...points, points[0]]);
    statsEl.innerHTML = `<div><dt>Vértices</dt><dd>${points.length}</dd></div><div><dt>Área</dt><dd>${formatArea(area)}</dd></div><div><dt>Perímetro</dt><dd>${formatDistance(perimeter)}</dd></div>`;
    document.getElementById('polygonFinishButton').disabled = false;
}

function clearPolygonEditListeners() {
    polygonEditListeners.forEach(listener => google.maps.event.removeListener(listener));
    polygonEditListeners = [];
}

//Mantém a área e o perímetro atualizados enquanto os vértices são arrastados
function watchPolygonPath(polygon) {
    clearPolygonEditListeners();
    const path = polygon.getPath();
    const update = () => updatePolygonStats(path);
    ['insert_at', 'set_at', 'remove_at'].forEach(evt => polygonEditListeners.push(path.addListener(evt, update)));
    update();
}

const POLYGON_SWATCHES = ['#2dd4bf', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#64748b'];

function renderPolygonSwatches() {
    const wrap = document.getElementById('polygonSwatches');
    if (!wrap) return;
    wrap.innerHTML = POLYGON_SWATCHES.map(color => `<button type="button" class="pg-swatch" data-color="${color}" role="radio" style="--swatch:${color}" title="${color}" aria-label="Cor ${color}"></button>`).join('');
    wrap.querySelectorAll('.pg-swatch').forEach(button => button.addEventListener('click', () => {
        document.getElementById('polygonColor').value = button.dataset.color;
        applyPolygonFormStyle();
    }));
}

function syncPolygonStyleControls(color, opacity) {
    document.querySelectorAll('#polygonSwatches .pg-swatch').forEach(button => {
        const active = button.dataset.color.toLowerCase() === String(color).toLowerCase();
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    document.getElementById('polygonOpacityValue').textContent = `${Math.round(opacity * 100)}%`;
    const preview = document.getElementById('polygonFillPreview');
    if (preview) {
        preview.style.setProperty('--fill-color', color);
        preview.style.setProperty('--fill-opacity', String(opacity));
    }
    const range = document.getElementById('polygonOpacity');
    range?.style.setProperty('--fill', `${Math.round(opacity * 100)}%`);
    range?.style.setProperty('--track-color', color);
}

//Aplica cor e opacidade do formulário no polígono em edição (mapa e ícone da barra lateral, ao vivo)
function applyPolygonFormStyle() {
    const { color, opacity } = getPolygonFormValues();
    syncPolygonStyleControls(color, opacity);
    const editingInfo = editingPolygonIndex !== null ? savedPolygons[editingPolygonIndex] : null;
    const target = tempPolygon || editingInfo?.polygonObject || null;
    if (target) target.setOptions({ fillColor: color, strokeColor: color, fillOpacity: opacity });
    editingInfo?.listItem?.querySelector('.ge-icon-polygon')?.style.setProperty('--ge-item-color', color);
    if (sketchSession && isDrawingPolygon) {
        sketchSession.color = color;
        sketchSession.line.setOptions({ strokeColor: color });
        sketchSession.fill.setOptions({ fillColor: color, fillOpacity: opacity });
        sketchSession.rubber.setOptions({ strokeColor: color });
        refreshSketch(true);
    }
}

function openPolygonBox(title, values) {
    const box = document.getElementById('polygonDrawingBox');
    document.getElementById('polygonBoxTitle').textContent = title;
    document.getElementById('polygonName').value = values.name;
    document.getElementById('polygonColor').value = values.color;
    document.getElementById('polygonOpacity').value = Math.round(values.opacity * 100);
    syncPolygonStyleControls(values.color, values.opacity);
    box.classList.remove('hidden');
    document.getElementById('toolsDropdown').classList.remove('show');
}

//Inicia a ferramenta de desenho de polígono
function startPolygonTool(initialPath) {
    if (!requireEdit('desenhar polígonos')) return;
    if (isDrawingCable || isAddingMarker) {
        showAlert("Atenção", "Finalize a ação atual antes de desenhar um polígono.");
        return;
    }
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione uma pasta de projeto para salvar o polígono.");
        return;
    }
    if (isMeasuring) stopRuler();
    cancelPolygonDrawing();
    isDrawingPolygon = true;
    editingPolygonIndex = null;
    openPolygonBox('Novo polígono', {
        name: `Polígono ${savedPolygons.length + 1}`,
        color: DEFAULT_POLYGON_COLOR,
        opacity: DEFAULT_POLYGON_OPACITY
    });
    document.getElementById('deletePolygonButton').classList.add('hidden');
    setPolygonBoxPhase('drawing');
    startSketch({
        shape: 'area',
        color: DEFAULT_POLYGON_COLOR,
        fillOpacity: DEFAULT_POLYGON_OPACITY,
        showSegmentLabels: false,
        onChange: updatePolygonStats,
        onClose: finishPolygonSketch
    });
    if (Array.isArray(initialPath)) {
        initialPath.forEach(point => addSketchPoint(point));
        if (initialPath.length >= 3) finishPolygonSketch();
    }
}

//Fecha a forma desenhada e passa para o ajuste dos vértices
function finishPolygonSketch() {
    const path = getSketchPath();
    if (path.length < 3) {
        showAlert("Atenção", "Marque pelo menos 3 pontos para formar um polígono.");
        return false;
    }
    const { color, opacity } = getPolygonFormValues();
    stopSketch();
    if (tempPolygon) tempPolygon.setMap(null);
    tempPolygon = new google.maps.Polygon({
        paths: path,
        map,
        fillColor: color,
        strokeColor: color,
        fillOpacity: opacity,
        strokeWeight: 2,
        editable: true,
        zIndex: 1
    });
    setAllPolygonsClickable(false);
    watchPolygonPath(tempPolygon);
    setPolygonBoxPhase('editing');
    return true;
}

function wirePolygonInteractions(polygonInfo) {
    polygonInfo.polygonObject.addListener('click', (e) => (e?.domEvent?.shiftKey && typeof toggleMapSelection === 'function') ? toggleMapSelection(polygonInfo) : openPolygonEditor(polygonInfo));
    polygonInfo.polygonObject.addListener('rightclick', (e) => openMapItemMenu('polygon', polygonInfo, e?.domEvent));
    const nameEl = polygonInfo.listItem.querySelector('.item-name');
    if (nameEl) nameEl.addEventListener('click', () => openPolygonEditor(polygonInfo));
    //Clique na linha da barra lateral: fica selecionado para Ctrl+C
    polygonInfo.listItem.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest('input, button')) return;
        if (typeof selectSidebarItem === 'function') selectSidebarItem(polygonInfo.listItem, { type: 'polygon', polygonInfo });
    });
    const visCb = polygonInfo.listItem.querySelector('.ge-vis-checkbox');
    if (visCb) wireItemVisibilityCheckbox(visCb, polygonInfo.polygonObject);
}

//Salva um polígono novo ou atualiza um existente
function savePolygon() {
    const { name, color, opacity } = getPolygonFormValues();
    if (!name) {
        showAlert("Erro", "Por favor, dê um nome ao polígono.");
        return;
    }
    //Se ainda está marcando pontos, fecha a forma automaticamente
    if (sketchSession && isDrawingPolygon && !finishPolygonSketch()) return;

    if (editingPolygonIndex !== null) {
        const polygonInfo = savedPolygons[editingPolygonIndex];
        const polygon = polygonInfo.polygonObject;
        polygonInfo.name = name;
        polygonInfo.color = color;
        polygonInfo.opacity = opacity;
        polygonInfo.path = polygon.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() }));
        polygon.setOptions({ fillColor: color, strokeColor: color, fillOpacity: opacity, editable: false });
        refreshPolygonSidebarLabel(polygonInfo);
        editingPolygonIndex = null; //Evita que o cancelamento reverta o que foi salvo
    } else {
        if (!tempPolygon) {
            showAlert("Erro", "Desenhe um polígono no mapa antes de salvar.");
            return;
        }
        const polygon = tempPolygon;
        tempPolygon = null;
        polygon.setOptions({ clickable: true, editable: false, fillColor: color, strokeColor: color, fillOpacity: opacity });
        const template = document.getElementById('polygon-template');
        const li = template.content.cloneNode(true).querySelector('li');
        enableDragAndDropForItem(li);
        document.getElementById(activeFolderId).appendChild(li);
        const polygonInfo = {
            folderId: activeFolderId,
            name,
            color,
            opacity,
            path: polygon.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() })),
            polygonObject: polygon,
            listItem: li
        };
        savedPolygons.push(polygonInfo);
        refreshPolygonSidebarLabel(polygonInfo);
        wirePolygonInteractions(polygonInfo);
    }
    cancelPolygonDrawing();
}

//Abre o editor do polígono (aceita o objeto ou o índice)
function openPolygonEditor(polygonRef) {
    const polygonInfo = typeof polygonRef === 'number' ? savedPolygons[polygonRef] : polygonRef;
    if (!polygonInfo) return;
    if (!AppSession.canEdit) {
        const area = google.maps.geometry.spherical.computeArea(polygonInfo.polygonObject.getPath());
        showToast(polygonInfo.name || 'Polígono', `Área ${formatArea(area)}`, 'progress');
        return;
    }
    const index = savedPolygons.indexOf(polygonInfo);
    if (index === -1) {
        showAlert("Erro", "Não foi possível encontrar o polígono para edição.");
        return;
    }
    if (isMeasuring) stopRuler();
    cancelPolygonDrawing();
    cancelCableButton.click();
    editingPolygonIndex = index;
    isDrawingPolygon = true;
    //Guarda o estado original para poder cancelar
    polygonInfo._originalStyle = { color: polygonInfo.color, opacity: polygonInfo.opacity ?? 0.5 };
    openPolygonBox('Editar polígono', {
        name: polygonInfo.name,
        color: polygonInfo.color,
        opacity: polygonInfo.opacity ?? 0.5
    });
    document.getElementById('deletePolygonButton').classList.remove('hidden');
    setPolygonBoxPhase('editing');
    setAllPolygonsClickable(false);
    polygonInfo.polygonObject.setEditable(true);
    watchPolygonPath(polygonInfo.polygonObject);
}

//Cancela o desenho ou a edição de polígono
function cancelPolygonDrawing() {
    if (sketchSession && isDrawingPolygon) stopSketch();
    clearPolygonEditListeners();
    if (tempPolygon) {
        tempPolygon.setMap(null);
        tempPolygon = null;
    }
    //Reverte a edição não salva
    if (editingPolygonIndex !== null) {
        const polygonInfo = savedPolygons[editingPolygonIndex];
        if (polygonInfo) {
            const original = polygonInfo._originalStyle || { color: polygonInfo.color, opacity: polygonInfo.opacity ?? 0.5 };
            polygonInfo.polygonObject.setPath(polygonInfo.path);
            polygonInfo.polygonObject.setEditable(false);
            polygonInfo.polygonObject.setOptions({ fillColor: original.color, strokeColor: original.color, fillOpacity: original.opacity });
            polygonInfo.listItem?.querySelector('.ge-icon-polygon')?.style.setProperty('--ge-item-color', original.color);
        }
    }
    document.getElementById('polygonDrawingBox').classList.add('hidden');
    setAllPolygonsClickable(true);
    setMapCursor("");
    isDrawingPolygon = false;
    editingPolygonIndex = null;
}

//Controle de cliques em polígonos, desenhos sobre o polígono
function setAllPolygonsClickable(isClickable) {
    savedPolygons.forEach(polygonInfo => {
        if (polygonInfo.polygonObject) {
            polygonInfo.polygonObject.setOptions({ clickable: isClickable });
        }
    });
}

//Exclui o polígono que está sendo editado
function deletePolygon() {
    if (editingPolygonIndex === null) return;
    const polygonInfo = savedPolygons[editingPolygonIndex];
    showConfirm('Excluir Polígono', `Tem certeza que deseja excluir "${polygonInfo.name}"?`, () => {
        clearPolygonEditListeners();
        polygonInfo.polygonObject.setMap(null);
        polygonInfo.listItem.remove();
        savedPolygons.splice(savedPolygons.indexOf(polygonInfo), 1);
        editingPolygonIndex = null;
        cancelPolygonDrawing();
    });
}

// ---------------------------------------------------------------
// Régua de medição
// ---------------------------------------------------------------

function getRulerMeasurements(path) {
    const points = path || getSketchPath();
    const spherical = google.maps.geometry.spherical;
    const length = points.length >= 2 ? spherical.computeLength(points) : 0;
    const lastSegment = points.length >= 2 ? spherical.computeDistanceBetween(points[points.length - 2], points[points.length - 1]) : 0;
    const area = points.length >= 3 ? spherical.computeArea(points) : 0;
    const perimeter = points.length >= 3 ? spherical.computeLength([...points, points[0]]) : 0;
    const poleSpan = getPoleSpanDistance();
    const estimatedPoles = length > 0 ? Math.ceil(length / poleSpan) + 1 : 0;
    return { points: points.length, length, lastSegment, area, perimeter, poleSpan, estimatedPoles };
}

function renderRulerStats(path) {
    const m = getRulerMeasurements(path);
    const statsEl = document.getElementById('rulerStats');
    const valueEl = document.getElementById('rulerDistance');
    const labelEl = document.getElementById('rulerPrimaryLabel');
    const toPolygonBtn = document.getElementById('rulerToPolygonButton');
    const stat = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
    if (rulerMode === 'area') {
        labelEl.textContent = 'Área';
        valueEl.textContent = m.points >= 3 ? formatArea(m.area) : '—';
        statsEl.innerHTML = stat('Perímetro', m.points >= 3 ? formatDistance(m.perimeter) : '—') + stat('Pontos', m.points);
        toPolygonBtn.classList.toggle('hidden', m.points < 3);
    } else {
        labelEl.textContent = 'Distância total';
        valueEl.textContent = formatDistance(m.length);
        statsEl.innerHTML = stat('Último trecho', formatDistance(m.lastSegment))
            + stat('Pontos', m.points)
            + stat(`Postes (${m.poleSpan} m)`, m.estimatedPoles ? `≈ ${m.estimatedPoles}` : '—');
        toPolygonBtn.classList.add('hidden');
    }
    document.getElementById('rulerUndoButton').disabled = m.points === 0;
    document.getElementById('rulerClearButton').disabled = m.points === 0;
    document.getElementById('rulerCopyButton').disabled = rulerMode === 'area' ? m.points < 3 : m.points < 2;
}

//Mostra a distância até o cursor enquanto o usuário mira o próximo ponto
function renderRulerCursorHint(cursorLatLng) {
    const hintEl = document.getElementById('rulerCursorHint');
    if (!hintEl) return;
    const path = getSketchPath();
    if (!cursorLatLng || !path.length || rulerMode !== 'distance') {
        hintEl.textContent = '';
        return;
    }
    const spherical = google.maps.geometry.spherical;
    const toCursor = spherical.computeDistanceBetween(path[path.length - 1], cursorLatLng);
    const total = (path.length >= 2 ? spherical.computeLength(path) : 0) + toCursor;
    hintEl.textContent = `Com o próximo ponto: ${formatDistance(total)} (+${formatDistance(toCursor)})`;
}

function setRulerMode(mode) {
    rulerMode = mode === 'area' ? 'area' : 'distance';
    document.querySelectorAll('#rulerBox [data-ruler-mode]').forEach(btn => {
        const active = btn.dataset.rulerMode === rulerMode;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    setSketchShape(rulerMode === 'area' ? 'area' : 'line');
    renderRulerStats();
    renderRulerCursorHint(sketchSession?.lastCursor || null);
}

//Inicia a ferramenta de régua de medição
function startRuler() {
    if (isDrawingCable || isAddingMarker) {
        showAlert("Atenção", "Finalize a ação atual antes de usar a régua.");
        return;
    }
    if (isDrawingPolygon) cancelPolygonDrawing();
    document.getElementById('toolsDropdown').classList.remove('show');
    document.getElementById('rulerBox').classList.remove('hidden');
    isMeasuring = true;
    const session = startSketch({
        shape: rulerMode === 'area' ? 'area' : 'line',
        color: RULER_COLOR,
        fillOpacity: 0.15,
        showSegmentLabels: true,
        onChange: renderRulerStats
    });
    session.onCursor = renderRulerCursorHint;
    setRulerMode(rulerMode);
}

function copyRulerMeasurement() {
    const m = getRulerMeasurements();
    const text = rulerMode === 'area'
        ? `Área: ${formatArea(m.area)} | Perímetro: ${formatDistance(m.perimeter)} | Pontos: ${m.points}`
        : `Distância: ${formatDistance(m.length)} | Pontos: ${m.points} | Postes estimados (vão ${m.poleSpan} m): ${m.estimatedPoles}`;
    const button = document.getElementById('rulerCopyButton');
    const done = () => {
        const original = button.dataset.label || button.textContent;
        button.dataset.label = original;
        button.textContent = 'Copiado!';
        setTimeout(() => { button.textContent = original; }, 1400);
    };
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => showAlert('Medição', text));
    } else {
        showAlert('Medição', text);
    }
}

//Transforma a área medida em um polígono do projeto
function convertRulerToPolygon() {
    const path = getSketchPath();
    if (path.length < 3) return;
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione uma pasta de projeto para salvar o polígono.");
        return;
    }
    stopRuler();
    startPolygonTool(path);
}

//Para a ferramenta de régua e limpa os elementos do mapa
function stopRuler() {
    if (sketchSession && isMeasuring) stopSketch();
    isMeasuring = false;
    document.getElementById('rulerBox').classList.add('hidden');
    const hintEl = document.getElementById('rulerCursorHint');
    if (hintEl) hintEl.textContent = '';
}

function setupMapSketchTools() {
    document.getElementById('drawPolygonButton').addEventListener('click', (e) => {
        e.preventDefault();
        startPolygonTool();
    });
    document.getElementById('savePolygonButton').addEventListener('click', savePolygon);
    document.getElementById('cancelPolygonButton').addEventListener('click', cancelPolygonDrawing);
    document.getElementById('closePolygonBoxButton').addEventListener('click', cancelPolygonDrawing);
    document.getElementById('deletePolygonButton').addEventListener('click', deletePolygon);
    document.getElementById('polygonUndoButton').addEventListener('click', undoSketchPoint);
    document.getElementById('polygonFinishButton').addEventListener('click', finishPolygonSketch);
    renderPolygonSwatches();
    document.getElementById('polygonColor').addEventListener('input', applyPolygonFormStyle);
    document.getElementById('polygonOpacity').addEventListener('input', applyPolygonFormStyle);

    document.getElementById('rulerButton').addEventListener('click', (e) => {
        e.preventDefault();
        startRuler();
    });
    document.getElementById('cancelRulerButton').addEventListener('click', stopRuler);
    document.getElementById('closeRulerBoxButton').addEventListener('click', stopRuler);
    document.getElementById('rulerUndoButton').addEventListener('click', undoSketchPoint);
    document.getElementById('rulerClearButton').addEventListener('click', clearSketchPoints);
    document.getElementById('rulerCopyButton').addEventListener('click', copyRulerMeasurement);
    document.getElementById('rulerToPolygonButton').addEventListener('click', convertRulerToPolygon);
    document.querySelectorAll('#rulerBox [data-ruler-mode]').forEach(btn => {
        btn.addEventListener('click', () => setRulerMode(btn.dataset.rulerMode));
    });
}
