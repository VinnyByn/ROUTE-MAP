// Desfazer/refazer (Ctrl+Z / Ctrl+Y) por projeto. Depois de cada alteração (o sistema recalcula a lista
// de materiais em toda mudança de projeto) guarda uma "foto" do projeto; desfazer reconstrói a foto
// anterior no mesmo lugar da barra lateral. Até 30 passos por projeto. Depende de js/persistence.js.

const UNDO_LIMIT = 30;
const projectUndo = new Map(); //projectId → { past: [json], current: json, future: [json] }
let undoSnapshotTimer = null;
let undoRestoring = false;

function takeProjectSnapshot(projectId) {
    const root = document.getElementById(projectId)?.closest('.folder');
    if (!root) return null;
    try {
        return JSON.stringify(buildProjectRecord(root).data);
    } catch (e) {
        return null;
    }
}

function resetProjectUndo(projectId) {
    if (undoRestoring || !projectId) return;
    const current = takeProjectSnapshot(projectId);
    projectUndo.set(projectId, { past: [], current, future: [] });
    updateUndoButtons();
}

function recordProjectUndo(projectId) {
    if (undoRestoring || !projectId) return;
    const snapshot = takeProjectSnapshot(projectId);
    if (!snapshot) return;
    const state = projectUndo.get(projectId);
    if (!state) {
        projectUndo.set(projectId, { past: [], current: snapshot, future: [] });
        return;
    }
    if (snapshot === state.current) return;
    state.past.push(state.current);
    if (state.past.length > UNDO_LIMIT) state.past.shift();
    state.current = snapshot;
    state.future = [];
    updateUndoButtons();
}

function scheduleProjectUndoSnapshot(projectId) {
    if (undoRestoring) return;
    clearTimeout(undoSnapshotTimer);
    undoSnapshotTimer = setTimeout(() => recordProjectUndo(projectId), 350);
}

function isUndoBlocked() {
    if (isDrawingCable || isDrawingPolygon || isAddingMarker) return 'Finalize o desenho em andamento antes de desfazer.';
    if (typeof isSketchToolActive === 'function' && isSketchToolActive()) return 'Feche a régua antes de desfazer.';
    const openModal = Array.from(document.querySelectorAll('.modal')).some(m => getComputedStyle(m).display !== 'none');
    if (openModal || (typeof isMarkerPanelOpen === 'function' && isMarkerPanelOpen())) return 'Feche a janela aberta antes de desfazer.';
    return null;
}

//Reconstrói o projeto a partir da foto, no mesmo lugar da barra lateral
function restoreProjectSnapshot(projectId, json) {
    const root = document.getElementById(projectId)?.closest('.folder');
    if (!root) return false;
    const data = JSON.parse(json);
    const parent = root.parentElement;
    const next = root.nextSibling;
    const revision = getProjectRevision(root);
    const wasActive = activeFolderId && getAllDescendantFolderIds(projectId).includes(activeFolderId) ? activeFolderId : null;
    //Pastas abertas/fechadas e rolagem da barra lateral continuam como estavam
    const openState = new Map(getAllDescendantFolderIds(projectId).map(id => [id, !document.getElementById(id)?.classList.contains('hidden')]));
    const scroller = document.getElementById('sidebar');
    const scrollTop = scroller?.scrollTop || 0;
    undoRestoring = true;
    try {
        clearTimeout(undoSnapshotTimer);
        if (typeof closeCableRoute === 'function') closeCableRoute();
        removeProjectFromWorkspace(projectId, root);
        loadAndDisplayProject(projectId, { ...data, projectName: data.sidebar?.name }, { silent: true });
        const rebuilt = document.getElementById(projectId)?.closest('.folder');
        if (rebuilt && parent) parent.insertBefore(rebuilt, next && next.parentElement === parent ? next : null);
        setProjectRevision(rebuilt, revision);
        openState.forEach((open, id) => {
            const ul = document.getElementById(id);
            if (ul && ul.classList.contains('hidden') === open) toggleFolder(id);
        });
        if (wasActive && document.getElementById(wasActive)) setActiveFolder(wasActive);
        else setActiveFolder(projectId);
        refreshBomAfterProjectChange();
        if (scroller) scroller.scrollTop = scrollTop;
    } finally {
        undoRestoring = false;
    }
    return true;
}

function stepProjectHistory(direction) {
    const projectId = getActiveProjectId();
    const state = projectId && projectUndo.get(projectId);
    const stack = direction < 0 ? state?.past : state?.future;
    if (!stack?.length) {
        showToast(direction < 0 ? 'Nada para desfazer' : 'Nada para refazer', projectId ? '' : 'Selecione um projeto.', 'progress');
        return;
    }
    const blocked = isUndoBlocked();
    if (blocked) {
        showToast(direction < 0 ? 'Desfazer' : 'Refazer', blocked, 'progress');
        return;
    }
    if (!requireEdit(direction < 0 ? 'desfazer alterações' : 'refazer alterações')) return;
    const target = stack.pop();
    (direction < 0 ? state.future : state.past).push(state.current);
    state.current = target;
    restoreProjectSnapshot(projectId, target);
    updateUndoButtons();
    showToast(direction < 0 ? 'Desfeito' : 'Refeito', `${state.past.length} passo(s) para desfazer · ${state.future.length} para refazer`);
}

function updateUndoButtons() {
    const state = projectUndo.get(getActiveProjectId());
    const undo = document.getElementById('undoButton');
    const redo = document.getElementById('redoButton');
    if (undo) undo.classList.toggle('is-disabled', !state?.past.length);
    if (redo) redo.classList.toggle('is-disabled', !state?.future.length);
}

document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const isUndo = key === 'z' && !e.shiftKey;
    const isRedo = key === 'y' || (key === 'z' && e.shiftKey);
    if (!isUndo && !isRedo) return;
    const t = e.target;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return; //Desfazer do próprio campo
    if (isDrawingCable && isUndo) return; //No desenho do cabo o sistema já trata pontos
    if (typeof isSketchToolActive === 'function' && isSketchToolActive()) return; //A régua desfaz os próprios pontos
    e.preventDefault();
    stepProjectHistory(isUndo ? -1 : 1);
});

document.addEventListener('DOMContentLoaded', () => {
    //Ponto de partida: ao selecionar um projeto que ainda não tem histórico (ex.: projeto novo)
    const originalSetActiveFolder = window.setActiveFolder;
    if (typeof originalSetActiveFolder === 'function') {
        window.setActiveFolder = function (id) {
            const result = originalSetActiveFolder.apply(this, arguments);
            const projectId = getActiveProjectId();
            if (projectId && !projectUndo.has(projectId) && !undoRestoring) resetProjectUndo(projectId);
            updateUndoButtons();
            return result;
        };
    }
    document.getElementById('undoButton')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('projectDropdown')?.classList.remove('show'); stepProjectHistory(-1); });
    document.getElementById('redoButton')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('projectDropdown')?.classList.remove('show'); stepProjectHistory(1); });
});
