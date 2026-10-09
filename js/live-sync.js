// Edição simultânea ao vivo. Cada projeto aberto entra num canal privado do Supabase Realtime
// ("project-live:<id>", liberado só para a empresa do projeto — migração 20261008120000).
// - A cada alteração local, compara com a última versão compartilhada e envia só os itens que mudaram
//   (marcadores, cabos e polígonos pelo uid; estrutura de pastas; observações).
// - Quem recebe aplica na hora; se estiver no meio de uma edição (janela aberta, desenho), aplica ao terminar.
// - Quem entra depois pede o estado atual a quem já está no projeto.
// - Ao salvar, avisa a nova revisão (ninguém cai em "conflito ao salvar" à toa).
// - Presença: mostra quem está no projeto.
// Mensagens grandes (planos de fusão) vão comprimidas e em partes.
// Depende de js/persistence.js, js/undo.js e script.js.

const LIVE = {
    clientId: (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2),
    rooms: new Map(), //projectId → { channel, shared, joinedAt, pending: [], peers: Map, dirtySinceJoin }
    applying: false,
    timers: new Map(),
    chunks: new Map(),
    retryTimer: null,
};
const LIVE_CHUNK = 120000;

// ---------------------------------------------------------------
// Fotos e diferenças
// ---------------------------------------------------------------

function liveSnapshot(projectId) {
    const root = document.getElementById(projectId)?.closest('.folder');
    if (!root) return null;
    try {
        const data = buildProjectRecord(root).data;
        return { sidebar: data.sidebar, observations: data.observations || null, objective: data.objective || null, markers: data.markers, cables: data.cables, polygons: data.polygons };
    } catch (e) {
        return null;
    }
}

function liveIndex(list) {
    const map = new Map();
    (list || []).forEach(item => { if (item?.uid) map.set(item.uid, item); });
    return map;
}

function liveDiff(prev, next) {
    const ops = { upserts: {}, deletes: {} };
    let any = false;
    ['markers', 'cables', 'polygons'].forEach(kind => {
        const a = liveIndex(prev?.[kind]);
        const b = liveIndex(next?.[kind]);
        const up = [];
        b.forEach((item, uid) => { if (!a.has(uid) || JSON.stringify(a.get(uid)) !== JSON.stringify(item)) up.push(item); });
        const del = [...a.keys()].filter(uid => !b.has(uid));
        if (up.length) { ops.upserts[kind] = up; any = true; }
        if (del.length) { ops.deletes[kind] = del; any = true; }
    });
    if (JSON.stringify(prev?.sidebar) !== JSON.stringify(next?.sidebar)) { ops.sidebar = next.sidebar; any = true; }
    if (JSON.stringify(prev?.observations) !== JSON.stringify(next?.observations)) { ops.observations = next.observations; any = true; }
    if (JSON.stringify(prev?.objective) !== JSON.stringify(next?.objective)) { ops.objective = next.objective; any = true; }
    return any ? ops : null;
}

function liveApplyOpsToSnapshot(snapshot, ops) {
    const next = JSON.parse(JSON.stringify(snapshot || { markers: [], cables: [], polygons: [] }));
    ['markers', 'cables', 'polygons'].forEach(kind => {
        const map = liveIndex(next[kind]);
        (ops.deletes?.[kind] || []).forEach(uid => map.delete(uid));
        (ops.upserts?.[kind] || []).forEach(item => map.set(item.uid, item));
        const noUid = (next[kind] || []).filter(i => !i?.uid);
        next[kind] = [...noUid, ...map.values()];
    });
    if (ops.sidebar) next.sidebar = ops.sidebar;
    if ('observations' in ops) next.observations = ops.observations;
    if ('objective' in ops) next.objective = ops.objective;
    return next;
}

// ---------------------------------------------------------------
// Envio (comprimido e em partes quando grande)
// ---------------------------------------------------------------

async function liveCompress(text) {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

async function liveDecompress(base64) {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
}

async function liveSend(projectId, message) {
    const room = LIVE.rooms.get(projectId);
    if (!room?.channel) return;
    const payload = { ...message, from: LIVE.clientId };
    const text = JSON.stringify(payload);
    const send = (p) => room.channel.send({ type: 'broadcast', event: 'm', payload: p });
    if (text.length < 60000) return send(payload);
    const packed = await liveCompress(text);
    const body = packed || text;
    const id = `${LIVE.clientId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const n = Math.ceil(body.length / LIVE_CHUNK);
    for (let i = 0; i < n; i++) {
        await send({ t: 'chunk', from: LIVE.clientId, id, i, n, gz: !!packed, data: body.slice(i * LIVE_CHUNK, (i + 1) * LIVE_CHUNK) });
    }
}

async function liveReceive(projectId, payload) {
    if (!payload || payload.from === LIVE.clientId) return;
    if (payload.t === 'chunk') {
        const entry = LIVE.chunks.get(payload.id) || { parts: [], got: 0, n: payload.n, gz: payload.gz };
        if (!entry.parts[payload.i]) { entry.parts[payload.i] = payload.data; entry.got++; }
        LIVE.chunks.set(payload.id, entry);
        if (entry.got < entry.n) return;
        LIVE.chunks.delete(payload.id);
        const body = entry.parts.join('');
        try {
            return liveReceive(projectId, JSON.parse(entry.gz ? await liveDecompress(body) : body));
        } catch (e) {
            console.error('Edição ao vivo: mensagem ilegível', e);
            return;
        }
    }
    handleLiveMessage(projectId, payload);
}

// ---------------------------------------------------------------
// Alterações locais → outros
// ---------------------------------------------------------------

function liveSyncLocalChange(projectId) {
    if (LIVE.applying || !projectId || !LIVE.rooms.has(projectId)) return;
    clearTimeout(LIVE.timers.get(projectId));
    LIVE.timers.set(projectId, setTimeout(() => liveFlush(projectId), 300));
}

function liveFlush(projectId) {
    const room = LIVE.rooms.get(projectId);
    if (!room || LIVE.applying) return;
    const next = liveSnapshot(projectId);
    if (!next) return;
    const ops = liveDiff(room.shared, next);
    room.shared = next;
    if (!ops) return;
    room.dirtySinceJoin = true;
    liveSend(projectId, { t: 'ops', ops, name: liveMyName() });
}

function liveSyncAnnounceSaved(projectId, revision) {
    if (!LIVE.rooms.has(projectId)) liveSyncJoin(projectId);
    liveFlush(projectId);
    liveSend(projectId, { t: 'saved', revision, name: liveMyName() });
}

function liveMyName() {
    return AppSession?.profile?.full_name || AppSession?.email || 'Alguém';
}

// ---------------------------------------------------------------
// Outros → aqui
// ---------------------------------------------------------------

function isLiveApplyBlocked() {
    return typeof isUndoBlocked === 'function' ? !!isUndoBlocked() : false;
}

function handleLiveMessage(projectId, msg) {
    const room = LIVE.rooms.get(projectId);
    if (!room) return;
    if (msg.t === 'hello') {
        //Quem está há mais tempo responde com o estado atual (um só responde)
        clearTimeout(room.helloTimer);
        room.helloTimer = setTimeout(() => {
            if (room.answered?.has(msg.from)) return;
            liveFlush(projectId);
            liveSend(projectId, { t: 'state', to: msg.from, snapshot: room.shared, revision: getProjectRevision(document.getElementById(projectId)?.closest('.folder')) });
        }, 100 + Math.random() * 400);
        return;
    }
    if (msg.t === 'state') {
        (room.answered = room.answered || new Set()).add(msg.to);
        if (msg.to !== LIVE.clientId || room.gotState) return;
        room.gotState = true;
        if (room.dirtySinceJoin) return; //Já mexeu aqui: as próximas alterações sincronizam
        const ops = liveDiff(room.shared, msg.snapshot);
        if (ops) queueLiveOps(projectId, { ops, name: null, revision: msg.revision });
        return;
    }
    if (msg.t === 'saved') {
        const root = document.getElementById(projectId)?.closest('.folder');
        if (root && Number.isFinite(msg.revision)) setProjectRevision(root, msg.revision);
        return;
    }
    if (msg.t === 'ops') queueLiveOps(projectId, msg);
}

function queueLiveOps(projectId, msg) {
    const room = LIVE.rooms.get(projectId);
    room.pending.push(msg);
    drainLiveOps();
}

function drainLiveOps() {
    clearTimeout(LIVE.retryTimer);
    const busy = isLiveApplyBlocked();
    LIVE.rooms.forEach((room, projectId) => {
        if (!room.pending.length) return;
        if (busy) return;
        const batch = room.pending.splice(0);
        batch.forEach(msg => applyLiveOps(projectId, msg));
    });
    if ([...LIVE.rooms.values()].some(r => r.pending.length)) {
        LIVE.retryTimer = setTimeout(drainLiveOps, 1000);
        showLiveWaitingNote(true);
    } else {
        showLiveWaitingNote(false);
    }
}

function removeLiveItem(kind, uid) {
    if (kind === 'markers') {
        const info = markers.find(m => m.uid === uid);
        if (!info) return;
        if (typeof focusedMapMarkerInfo !== 'undefined' && focusedMapMarkerInfo === info) clearMapMarkerHighlight();
        info.marker?.setMap(null);
        info.listItem?.remove();
        markers = markers.filter(m => m !== info);
    } else if (kind === 'cables') {
        const info = savedCables.find(c => c.uid === uid);
        if (!info) return;
        info.polyline?.setMap(null);
        info.item?.remove();
        savedCables = savedCables.filter(c => c !== info);
    } else {
        const info = savedPolygons.find(p => p.uid === uid);
        if (!info) return;
        info.polygonObject?.setMap(null);
        info.listItem?.remove();
        savedPolygons = savedPolygons.filter(p => p !== info);
    }
}

//Coloca a linha na posição salva entre os irmãos da pasta
function placeLiveRow(row, order) {
    if (!row?.parentElement || !Number.isFinite(order)) return;
    const siblings = Array.from(row.parentElement.children).filter(el => el !== row && isSidebarOrderedChild(el));
    row.parentElement.insertBefore(row, siblings[order] || null);
    delete row.dataset.order;
}

function applyLiveOps(projectId, msg) {
    const root = document.getElementById(projectId)?.closest('.folder');
    if (!root) return;
    const room = LIVE.rooms.get(projectId);
    const ops = msg.ops;
    LIVE.applying = true;
    try {
        if (ops.sidebar) {
            //Mudou a estrutura de pastas: reconstrói o projeto inteiro com o estado novo
            const merged = liveApplyOpsToSnapshot(liveSnapshot(projectId), ops);
            const full = { ...buildProjectRecord(root).data, ...merged };
            restoreProjectSnapshot(projectId, JSON.stringify(full));
        } else {
            ['polygons', 'markers', 'cables'].forEach(kind => (ops.deletes?.[kind] || []).forEach(uid => removeLiveItem(kind, uid)));
            //Marcadores antes dos cabos (as pontas dos cabos ficam nas caixas)
            (ops.upserts?.markers || []).forEach(data => {
                removeLiveItem('markers', data.uid);
                rebuildMarker(data);
                placeLiveRow(markers.find(m => m.uid === data.uid)?.listItem, data.order);
            });
            (ops.upserts?.cables || []).forEach(data => {
                removeLiveItem('cables', data.uid);
                rebuildCable(data);
                placeLiveRow(savedCables.find(c => c.uid === data.uid)?.item, data.order);
            });
            (ops.upserts?.polygons || []).forEach(data => {
                removeLiveItem('polygons', data.uid);
                rebuildPolygon(data);
                placeLiveRow(savedPolygons.find(p => p.uid === data.uid)?.listItem, data.order);
            });
            if ('observations' in ops) projectObservations[projectId] = ops.observations;
            if ('objective' in ops) projectObjectives[projectId] = ops.objective;
            if (typeof refreshClientDrops === 'function') refreshClientDrops();
            updateSidebarCounts();
            refreshBomAfterProjectChange();
        }
        if (Number.isFinite(msg.revision)) setProjectRevision(document.getElementById(projectId)?.closest('.folder'), msg.revision);
        room.shared = liveSnapshot(projectId);
        if (typeof resetProjectUndo === 'function') resetProjectUndo(projectId);
    } catch (e) {
        console.error('Edição ao vivo: não foi possível aplicar a alteração', e);
    } finally {
        LIVE.applying = false;
    }
    if (msg.name) notifyLiveChange(msg.name);
}

let liveToastTimer = null;
function notifyLiveChange(name) {
    clearTimeout(liveToastTimer);
    liveToastTimer = setTimeout(() => showToast('Edição ao vivo', `${name} alterou o projeto.`, 'progress'), 600);
}

function showLiveWaitingNote(show) {
    let note = document.getElementById('liveWaitingNote');
    if (!show) { note?.remove(); return; }
    if (note) return;
    note = document.createElement('div');
    note.id = 'liveWaitingNote';
    note.className = 'live-waiting';
    note.textContent = 'Há alterações de outras pessoas esperando: termine a edição atual para receber.';
    document.body.appendChild(note);
}

// ---------------------------------------------------------------
// Canal e presença
// ---------------------------------------------------------------

function liveSyncJoin(projectId) {
    if (!projectId || LIVE.rooms.has(projectId) || !supabaseClient?.channel || !AppSession?.company?.id) return;
    const room = { channel: null, shared: liveSnapshot(projectId), joinedAt: Date.now(), pending: [], peers: new Map(), dirtySinceJoin: false };
    LIVE.rooms.set(projectId, room);
    const channel = supabaseClient.channel(`project-live:${projectId}`, {
        config: { private: true, broadcast: { self: false }, presence: { key: LIVE.clientId } },
    });
    room.channel = channel;
    channel.on('broadcast', { event: 'm' }, ({ payload }) => liveReceive(projectId, payload));
    channel.on('presence', { event: 'sync' }, () => renderLivePresence(projectId));
    channel.subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        channel.track({ name: liveMyName(), userId: AppSession.userId, at: room.joinedAt });
        liveSend(projectId, { t: 'hello' });
    });
}

function liveSyncLeave(projectId) {
    const room = LIVE.rooms.get(projectId);
    if (!room) return;
    clearTimeout(LIVE.timers.get(projectId));
    try { supabaseClient.removeChannel(room.channel); } catch (e) { /* já fechado */ }
    LIVE.rooms.delete(projectId);
}

function renderLivePresence(projectId) {
    const room = LIVE.rooms.get(projectId);
    const title = document.querySelector(`.folder-title[data-folder-id="${CSS.escape(projectId)}"]`);
    if (!room || !title) return;
    const state = room.channel.presenceState ? room.channel.presenceState() : {};
    const others = Object.entries(state).filter(([key]) => key !== LIVE.clientId).map(([, metas]) => metas[0]).filter(Boolean);
    const before = new Set(room.peers.keys());
    room.peers = new Map(others.map(p => [`${p.userId}-${p.at}`, p]));
    others.forEach(p => { if (!before.has(`${p.userId}-${p.at}`)) showToast('Edição ao vivo', `${p.name} abriu este projeto.`, 'progress'); });
    let badge = title.querySelector(':scope > .live-badge');
    if (!others.length) { badge?.remove(); return; }
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'live-badge';
        title.querySelector('.folder-name-text')?.after(badge);
    }
    const names = [...new Set(others.map(p => p.name))];
    badge.textContent = `● ${names.length}`;
    badge.title = `Editando agora: ${names.join(', ')}`;
}

window.addEventListener('beforeunload', () => {
    LIVE.rooms.forEach((_, id) => liveFlush(id));
});
