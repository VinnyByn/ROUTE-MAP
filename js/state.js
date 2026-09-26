// js/state.js

// ===================================================================
// == DADOS PRINCIPAIS (Arrays de Dados)
// ===================================================================
// Estas são as variáveis privadas do módulo.
let markers = [];
let savedCables = [];
let savedPolygons = [];
let projectBoms = {};
let projectObservations = {};

// --- Funções "Getters" (para LER os dados) ---
export const getMarkers = () => markers;
export const getSavedCables = () => savedCables;
export const getSavedPolygons = () => savedPolygons;
export const getBomForProject = (id) => projectBoms[id];
export const getObservationForProject = (id) => projectObservations[id];

// --- Funções "Setters" (para MODIFICAR os dados) ---
export function addMarker(markerInfo) {
    markers.push(markerInfo);
}
export function deleteMarker(markerInfo) {
    markers = markers.filter(m => m !== markerInfo);
}
export function addCable(cableInfo) {
    savedCables.push(cableInfo);
}
export function deleteCable(cableInfo) {
    const index = savedCables.indexOf(cableInfo);
    if (index > -1) {
        savedCables.splice(index, 1);
    }
}
export function addPolygon(polygonInfo) {
    savedPolygons.push(polygonInfo);
}
export function deletePolygon(polygonInfo) {
    const index = savedPolygons.indexOf(polygonInfo);
    if (index > -1) {
        savedPolygons.splice(index, 1);
    }
}
export function saveBomForProject(id, bomData) {
    projectBoms[id] = bomData;
}
export function saveObservationForProject(id, obsData) {
    projectObservations[id] = obsData;
}
export function clearDataForProject(projectId) {
    // Filtra os arrays para remover itens do projeto excluído
    markers = markers.filter(m => !m.folderId.startsWith(projectId));
    savedCables = savedCables.filter(c => !c.folderId.startsWith(projectId));
    savedPolygons = savedPolygons.filter(p => !p.folderId.startsWith(projectId));
    
    // Deleta os dados de BOM e Observações
    delete projectBoms[projectId];
    delete projectObservations[projectId];
}

// ===================================================================
// == ESTADO DA INTERFACE (Itens Ativos)
// ===================================================================
let activeFolderId = null;
let editingMarkerInfo = null;
let editingCableIndex = null;
let editingPolygonIndex = null;
let activeMarkerForFusion = null;
let editingFolderElement = null;
let bomState = {}; // Estado temporário do modal da BOM
let activeLineForAction = null; // Linha de fusão clicada
let adjustingKmlMarkerInfo = null; // Marcador KML sendo ajustado

export const getActiveFolderId = () => activeFolderId;
export function setActiveFolder(id) {
    activeFolderId = id;
    bomState = {}; // Reseta o estado da BOM ao trocar de pasta
}

export const getEditingMarker = () => editingMarkerInfo;
export function setEditingMarker(markerInfo) {
    editingMarkerInfo = markerInfo;
}

export const getEditingCableIndex = () => editingCableIndex;
export function setEditingCableIndex(index) {
    editingCableIndex = index;
}

export const getEditingPolygonIndex = () => editingPolygonIndex;
export function setEditingPolygonIndex(index) {
    editingPolygonIndex = index;
}

export const getActiveMarkerForFusion = () => activeMarkerForFusion;
export function setActiveMarkerForFusion(markerInfo) {
    activeMarkerForFusion = markerInfo;
}

export const getEditingFolderElement = () => editingFolderElement;
export function setEditingFolderElement(element) {
    editingFolderElement = element;
}

export const getBomState = () => bomState;
export function setBomState(newState) {
    bomState = newState;
}

export const getActiveLineForAction = () => activeLineForAction;
export function setActiveLineForAction(lineElement) {
    activeLineForAction = lineElement;
}

export const getAdjustingKmlMarker = () => adjustingKmlMarkerInfo;
export function setAdjustingKmlMarker(markerInfo) {
    adjustingKmlMarkerInfo = markerInfo;
}

// ===================================================================
// == ESTADO DAS FERRAMENTAS (Flags Booleanas)
// ===================================================================
let isAddingMarker = false;
let isDrawingCable = false;
let isDrawingPolygon = false;
let isMeasuring = false;
let isEditingLine = false; // Flag para edição de linha de fusão

export const getIsAddingMarker = () => isAddingMarker;
export function setIsAddingMarker(value) {
    isAddingMarker = value;
}

export const getIsDrawingCable = () => isDrawingCable;
export function setIsDrawingCable(value) {
    isDrawingCable = value;
}

export const getIsDrawingPolygon = () => isDrawingPolygon;
export function setIsDrawingPolygon(value) {
    isDrawingPolygon = value;
}

export const getIsMeasuring = () => isMeasuring;
export function setIsMeasuring(value) {
    isMeasuring = value;
}

export const getIsEditingLine = () => isEditingLine;
export function setIsEditingLine(value) {
    isEditingLine = value;
}

// ===================================================================
// == DADOS TEMPORÁRIOS (Usados durante uma ação)
// ===================================================================
let cablePath = [];
let cableMarkers = [];
let cableDistance = { lancamento: 0, reserva: 0, total: 0 };
let currentCableStatus = "Novo";
let selectedMarkerData = {
  type: "", name: "", color: "#ff0000", labelColor: "#000000", size: 8,
  description: "", ctoStatus: "Nova", ceoStatus: "Nova", ceoAccessory: "Raquete",
  cordoalhaStatus: "Nova", reservaStatus: "Nova", reservaAccessory: "Raquete",
  derivationTCount: 0, isPredial: false, needsStickers: false, is144F: false
};
let pendingSplitterInfo = null;
let fusionDrawingState = {
    isActive: false, startElement: null, points: [], tempLine: null, tempHandles: []
};

// --- Funções para dados temporários ---

export const getCablePath = () => cablePath;
export function setCablePath(path) { cablePath = path; }
export function addCablePathPoint(point) { cablePath.push(point); }
export function clearCablePath() { cablePath = []; }

export const getCableMarkers = () => cableMarkers;
export function setCableMarkers(markers) { cableMarkers = markers; }
export function addCableMarker(marker) { cableMarkers.push(marker); }
export function clearCableMarkers() {
    cableMarkers.forEach(m => m.setMap(null));
    cableMarkers = [];
}
export function removeCableMarker(marker) {
    const index = cableMarkers.indexOf(marker);
    if (index > -1) {
        cableMarkers.splice(index, 1)[0].setMap(null);
    }
}

export const getCableDistance = () => cableDistance;
export function setCableDistance(dist) { cableDistance = dist; }

export const getCurrentCableStatus = () => currentCableStatus;
export function setCurrentCableStatus(status) { currentCableStatus = status; }

export const getSelectedMarkerData = () => selectedMarkerData;
export function setSelectedMarkerData(data) { selectedMarkerData = data; }
export function resetSelectedMarkerData() {
    selectedMarkerData = {
      type: "", name: "", color: "#ff0000", labelColor: "#000000", size: 8,
      description: "", ctoStatus: "Nova", ceoStatus: "Nova", ceoAccessory: "Raquete",
      cordoalhaStatus: "Nova", reservaStatus: "Nova", reservaAccessory: "Raquete",
      derivationTCount: 0, isPredial: false, needsStickers: false, is144F: false
    };
}

export const getPendingSplitterInfo = () => pendingSplitterInfo;
export function setPendingSplitterInfo(info) { pendingSplitterInfo = info; }

export const getFusionDrawingState = () => fusionDrawingState;
export function resetFusionDrawingState() {
    if (fusionDrawingState.tempLine) {
        fusionDrawingState.tempLine.remove();
    }
    fusionDrawingState.tempHandles.forEach(h => h.remove());
    fusionDrawingState = {
        isActive: false, startElement: null, points: [], tempLine: null, tempHandles: []
    };
}