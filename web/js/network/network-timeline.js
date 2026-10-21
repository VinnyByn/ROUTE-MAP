// A rede numa data (modo Rede): mostra no mapa como a rede da cidade estava numa versão salva (as 20 últimas do
// histórico de versões), sem restaurar nada. A rede de hoje some enquanto isso e volta ao sair; o resumo diz o que
// entrou e saiu desde então. Depende de js/app.js, js/projects/network-mode.js e js/network/network-docs.js.

const networkTimeline = { versions: [], rootId: '', viewing: null, overlays: [], hidden: [] };

async function loadNetworkVersions(rootId) {
    const { data, error } = await supabaseClient.rpc('list_project_versions', { p_project: rootId });
    if (error) throw error;
    networkTimeline.rootId = rootId;
    networkTimeline.versions = data || [];
    return networkTimeline.versions;
}

//Parte da aba Histórico do painel da rede
function renderNetworkVersionsHtml() {
    const esc = (v) => escapeHtml(String(v ?? ''));
    const list = networkTimeline.rootId === networkDocs.panelRootId ? networkTimeline.versions : null;
    if (!list) return '<button type="button" class="map-tool-btn" data-net-panel="tl-load">Ver a rede numa data…</button>';
    if (!list.length) return '<p class="map-tool-help">Ainda não há versões anteriores desta cidade: elas aparecem a partir do próximo salvamento.</p>';
    return `<section class="net-timeline"><header>A rede numa data <small>(versões salvas, sem restaurar)</small></header>
        <ul>${list.map((v, i) => `<li><button type="button" class="net-timeline__item" data-net-panel="tl-view" data-i="${i}">
            <span><b>${esc(formatDocDate(v.saved_at))}</b><small>${esc(v.saved_by_name || 'Sem autor')} · ${v.markers} marcador${v.markers === 1 ? '' : 'es'} · ${v.cables} cabo${v.cables === 1 ? '' : 's'}</small></span>
            <em>Ver no mapa</em></button></li>`).join('')}</ul></section>`;
}

async function handleTimelinePanelClick(el) {
    const kind = el.dataset.netPanel;
    if (kind === 'tl-load') {
        try { await loadNetworkVersions(networkDocs.panelRootId); } catch (e) { showAlert('Histórico de versões', 'Não foi possível carregar as versões desta cidade.'); return; }
        renderNetworkPanel();
        return;
    }
    if (kind === 'tl-view') viewNetworkVersion(networkTimeline.versions[Number(el.dataset.i)]);
}

function summarizeNetworkChangesSince(oldData, root) {
    const scope = getNetworkScope(root);
    const now = { m: new Map(scope.markers.map(m => [m.uid, m])), c: new Set(scope.cables.map(c => c.uid)) };
    const then = { m: new Map((oldData.markers || []).map(m => [m.uid, m])), c: new Set((oldData.cables || []).map(c => c.uid)) };
    const count = (a, b, pick) => [...a.keys ? a.keys() : a].filter(k => !(b.has(k)) && pick(k)).length;
    const isBox = (map) => (uid) => map.get(uid)?.type !== 'CLIENTE';
    const isClient = (map) => (uid) => map.get(uid)?.type === 'CLIENTE';
    return {
        boxesAdded: count(now.m, then.m, isBox(now.m)), boxesRemoved: count(then.m, now.m, isBox(then.m)),
        clientsAdded: count(now.m, then.m, isClient(now.m)), clientsRemoved: count(then.m, now.m, isClient(then.m)),
        cablesAdded: count(now.c, then.c, () => true), cablesRemoved: count(then.c, now.c, () => true),
    };
}

async function viewNetworkVersion(version) {
    const root = document.getElementById(networkTimeline.rootId)?.closest('.folder');
    if (!version || !root || typeof map === 'undefined' || !map) return;
    const { data, error } = await supabaseClient.from('project_versions').select('data, saved_at, revision').eq('id', version.id).maybeSingle();
    if (error || !data?.data) { showAlert('A rede numa data', 'Não foi possível abrir essa versão.'); return; }
    exitNetworkVersion();
    const old = data.data;
    //Esconde a rede de hoje desta cidade (volta como estava ao sair)
    const scope = getNetworkScope(root);
    [...scope.markers, ...scope.cables].forEach(item => {
        const shape = item.marker || item.polyline;
        if (!shape || shape.getVisible?.() === false) return;
        shape.setVisible(false);
        networkTimeline.hidden.push(item);
        if (item.dropLine) item.dropLine.setVisible(false);
    });
    const bounds = new google.maps.LatLngBounds();
    (old.cables || []).forEach(c => {
        if (!(c.path || []).length) return;
        const path = c.path.map(p => new google.maps.LatLng(p.lat, p.lng));
        networkTimeline.overlays.push(new google.maps.Polyline({ map, path, clickable: false, zIndex: 6, strokeColor: c.color || '#64748b', strokeOpacity: 0.9, strokeWeight: c.width || 3 }));
        path.forEach(p => bounds.extend(p));
    });
    (old.markers || []).forEach(m => {
        if (!m.position) return;
        const pos = new google.maps.LatLng(m.position.lat, m.position.lng);
        const color = m.type === 'CLIENTE' ? (getClientStatus(m.client?.status).color) : (m.color || '#f59e0b');
        networkTimeline.overlays.push(new google.maps.Marker({
            map, position: pos, clickable: false, zIndex: m.type === 'CLIENTE' ? 7 : 8, title: `${m.name} · em ${formatDocDate(data.saved_at)}`,
            icon: buildMarkerMapIcon(m.type, { color, variant: m.type === 'CLIENTE' && m.client?.kind && m.client.kind !== 'residencial' ? m.client.kind : '' }),
        }));
        bounds.extend(pos);
    });
    //O painel cobriria o mapa: fecha enquanto se olha a versão antiga
    document.getElementById('networkPanelBox')?.classList.add('hidden');
    networkTimeline.viewing = { version, savedAt: data.saved_at, changes: summarizeNetworkChangesSince(old, root), name: root.querySelector(':scope > .folder-title')?.dataset.folderName || 'Rede' };
    renderNetworkTimelineBanner();
    if (!bounds.isEmpty?.()) map.fitBounds(bounds);
}

function exitNetworkVersion() {
    networkTimeline.overlays.forEach(o => o.setMap(null));
    networkTimeline.overlays = [];
    networkTimeline.hidden.forEach(item => {
        (item.marker || item.polyline)?.setVisible(true);
        if (item.dropLine && typeof syncClientDropVisibility === 'function') syncClientDropVisibility(item);
    });
    networkTimeline.hidden = [];
    networkTimeline.viewing = null;
    document.getElementById('networkTimelineBanner')?.remove();
}

function renderNetworkTimelineBanner() {
    const v = networkTimeline.viewing;
    if (!v) return;
    const esc = (s) => escapeHtml(String(s ?? ''));
    const c = v.changes;
    const parts = [
        c.boxesAdded || c.boxesRemoved ? `caixas ${c.boxesAdded ? `+${c.boxesAdded}` : ''}${c.boxesAdded && c.boxesRemoved ? ' ' : ''}${c.boxesRemoved ? `−${c.boxesRemoved}` : ''}` : '',
        c.cablesAdded || c.cablesRemoved ? `cabos ${c.cablesAdded ? `+${c.cablesAdded}` : ''}${c.cablesAdded && c.cablesRemoved ? ' ' : ''}${c.cablesRemoved ? `−${c.cablesRemoved}` : ''}` : '',
        c.clientsAdded || c.clientsRemoved ? `clientes ${c.clientsAdded ? `+${c.clientsAdded}` : ''}${c.clientsAdded && c.clientsRemoved ? ' ' : ''}${c.clientsRemoved ? `−${c.clientsRemoved}` : ''}` : '',
    ].filter(Boolean);
    let banner = document.getElementById('networkTimelineBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'networkTimelineBanner';
        banner.className = 'net-timeline-banner';
        banner.setAttribute('role', 'status');
        document.body.appendChild(banner);
        banner.addEventListener('click', (e) => { if (e.target.closest('[data-tl="exit"]')) exitNetworkVersion(); });
    }
    banner.innerHTML = `<span><b>${esc(v.name)} em ${esc(formatDocDate(v.savedAt))}</b><small>${parts.length ? `De lá para hoje: ${esc(parts.join(' · '))}.` : 'Igual à rede de hoje.'} Só para ver: nada foi restaurado.</small></span>
        <button type="button" class="btn btn-success" data-tl="exit">Voltar para hoje</button>`;
}

appReady.then(() => {
    let wasRede = document.body.classList.contains('mode-rede');
    new MutationObserver(() => {
        const rede = document.body.classList.contains('mode-rede');
        if (rede !== wasRede) { wasRede = rede; if (!rede) exitNetworkVersion(); }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && networkTimeline.viewing) exitNetworkVersion(); });
});
