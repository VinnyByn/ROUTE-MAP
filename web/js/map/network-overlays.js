// Leitura rápida do mapa e da barra lateral:
// - legenda (canto de baixo do mapa): os cabos que estão no mapa (cor, fibra e situação) e as caixas.
// - resumo de cada projeto na barra lateral: CTOs, km de cabo e portas em uso.
// As vagas de cada CTO ficam no cartão que aparece ao passar o mouse na caixa (js/map/marker-hover.js).
// Atualiza a cada mudança de projeto (refreshBomAfterProjectChange chama scheduleNetworkOverlaysRefresh) e quando o
// mapa para de mexer. Depende de js/app.js (map, mapReady, markers, savedCables, uiIcon, getFiberType),
// js/network/clients.js (getCtoClients, getCtoPortCapacity, getOccupiedPorts) e js/map/marker-icons.js.

const LEGEND_BOX_TYPES = ['POP', 'CEO', 'CTO', 'RESERVA', 'CLIENTE', 'CASA', 'POSTE'];

const networkOverlays = { timer: null, legend: null };

//Selo em forma de pílula (imagem SVG); âncora negativa = desenhado abaixo do ponto (embaixo do ícone da caixa).
//Usado pelo pré-projeto (js/network/auto-design.js) nas CTOs propostas.
function getMapBadgeIcon(text, color) {
    const w = Math.max(30, text.length * 7 + 12), h = 18;
    const safe = String(text).replace(/[<>&]/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="9" fill="${color}" stroke="#ffffff" stroke-width="1"/><text x="${w / 2}" y="13" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#ffffff">${safe}</text></svg>`;
    return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize: new google.maps.Size(w, h), anchor: new google.maps.Point(w / 2, -16) };
}

//Ocupação da CTO: portas em uso / portas de atendimento do plano de fusão. Sem splitter: só a quantidade de clientes.
function getCtoOccupancy(cto) {
    const capacity = typeof getCtoPortCapacity === 'function' ? getCtoPortCapacity(cto) : null;
    const used = capacity ? getOccupiedPorts(cto).size : (typeof getCtoClients === 'function' ? getCtoClients(cto).length : 0);
    const level = !capacity ? 'none' : used >= capacity ? 'full' : used / capacity >= 0.75 ? 'high' : 'ok';
    return { used, capacity, level, text: capacity ? `${used}/${capacity}` : `${used} cl.` };
}

const isMapItemShown = (overlay) => !!overlay?.getMap?.() && overlay.getVisible?.() !== false;

// ---------- legenda ----------

const formatLegendKm = (meters) => (meters >= 1000 ? `${(meters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km` : `${Math.round(meters).toLocaleString('pt-BR')} m`);
const getCableMeters = (cable) => Number(cable.totalLength) || (cable.path?.length > 1 && google.maps.geometry ? google.maps.geometry.spherical.computeLength(cable.path) : 0);

function renderMapLegend() {
    const body = networkOverlays.legend?.querySelector('.map-legend__body');
    if (!body || body.hidden) return;
    const esc = (v) => escapeHtml(String(v ?? ''));
    //Cabos que estão no mapa, agrupados por cor + fibra + situação (a cor é a que foi escolhida para o cabo)
    const groups = new Map();
    (typeof savedCables === 'undefined' ? [] : savedCables).forEach(cable => {
        if (!isMapItemShown(cable.polyline)) return;
        const fiber = (typeof getFiberType === 'function' && getFiberType(cable.type)) || cable.type || 'Cabo';
        const status = cable.status === 'Existente' ? 'Existente' : 'Novo';
        const color = cable.color || cable.polyline.get?.('strokeColor') || '#16a34a';
        const key = `${color}|${fiber}|${status}`;
        const row = groups.get(key) || { color, fiber, status, meters: 0, count: 0, width: Number(cable.width) || (status === 'Existente' ? 2 : 4) };
        row.meters += getCableMeters(cable);
        row.count++;
        groups.set(key, row);
    });
    const fiberNumber = (f) => parseInt(String(f).replace(/\D/g, ''), 10) || 0;
    const cableRows = [...groups.values()].sort((a, b) => fiberNumber(b.fiber) - fiberNumber(a.fiber) || a.status.localeCompare(b.status))
        .map(r => `<li><i class="map-legend__line${r.status === 'Existente' ? ' is-existing' : ''}" style="--line-color:${esc(r.color)};--line-width:${Math.min(6, Math.max(2, r.width))}px"></i><span>${esc(r.fiber)} · ${esc(r.status)}</span><small>${esc(formatLegendKm(r.meters))}</small></li>`).join('');
    //Caixas que estão no mapa
    //Caixas que estão no mapa (ícone com a cor da primeira delas: a cor pode ter sido trocada no projeto)
    const counts = new Map(), colors = new Map();
    markers.forEach(m => {
        if (!LEGEND_BOX_TYPES.includes(m.type) || !isMapItemShown(m.marker)) return;
        counts.set(m.type, (counts.get(m.type) || 0) + 1);
        if (!colors.has(m.type) && m.color) colors.set(m.type, m.color);
    });
    const boxRows = LEGEND_BOX_TYPES.filter(t => counts.has(t)).map(t => {
        const meta = typeof getMarkerTypeMeta === 'function' ? getMarkerTypeMeta(t) : { name: t, color: '#64748b' };
        const icon = typeof getMarkerIconDataUrl === 'function' ? getMarkerIconDataUrl(t, colors.get(t) || meta.color) : '';
        const name = t === 'CLIENTE' ? 'Cliente' : t === 'CASA' ? 'Casas' : meta.name;
        return `<li>${icon ? `<img src="${esc(icon)}" alt="" width="18" height="18">` : ''}<span>${esc(name)}</span><small>${counts.get(t).toLocaleString('pt-BR')}</small></li>`;
    }).join('');
    body.innerHTML = `
        <div class="map-legend__section"><b>Cabos no mapa</b>${cableRows ? `<ul>${cableRows}</ul>` : '<p>Nenhum cabo visível.</p>'}</div>
        ${boxRows ? `<div class="map-legend__section"><b>Caixas</b><ul>${boxRows}</ul></div>` : ''}
        <p class="map-legend__hint">Vagas de cada CTO: passe o mouse na caixa.</p>`;
}

function setupMapLegend() {
    if (networkOverlays.legend || typeof map === 'undefined' || !map) return;
    const box = document.createElement('div');
    box.className = 'map-legend';
    box.innerHTML = `<button type="button" class="map-legend__toggle" aria-expanded="false">${uiIcon('list')}<span>Legenda</span></button><div class="map-legend__body" hidden></div>`;
    const toggle = box.querySelector('.map-legend__toggle'), body = box.querySelector('.map-legend__body');
    toggle.addEventListener('click', () => {
        body.hidden = !body.hidden;
        toggle.setAttribute('aria-expanded', String(!body.hidden));
        box.classList.toggle('is-open', !body.hidden);
        renderMapLegend();
    });
    networkOverlays.legend = box;
    const slot = map.controls?.[google.maps.ControlPosition.LEFT_BOTTOM];
    if (slot?.push) slot.push(box);
    else document.getElementById('map')?.appendChild(box);
}

// ---------- resumo dos projetos na barra lateral ----------

//"8 CTOs · 2,4 km de cabo · 5/64 portas" no título do projeto (atributo: a barra lateral não guarda isso no projeto)
function refreshProjectSummaries() {
    document.querySelectorAll('#sidebar .folder-title[data-is-project="true"]').forEach(title => {
        const ids = typeof getProjectFolderIdsForItem === 'function' ? getProjectFolderIdsForItem(title.dataset.folderId) || [] : [];
        const inProject = (item) => ids.includes(item.folderId);
        const ctos = markers.filter(m => m.type === 'CTO' && inProject(m));
        const meters = (typeof savedCables === 'undefined' ? [] : savedCables).filter(inProject).reduce((sum, c) => sum + getCableMeters(c), 0);
        let used = 0, ports = 0;
        ctos.forEach(cto => { const occ = getCtoOccupancy(cto); if (occ.capacity) { used += occ.used; ports += occ.capacity; } });
        const parts = [
            ctos.length ? `${ctos.length} ${ctos.length === 1 ? 'CTO' : 'CTOs'}` : '',
            meters > 0 ? `${formatLegendKm(meters)} de cabo` : '',
            ports ? `${used}/${ports} portas` : '',
        ].filter(Boolean);
        const text = parts.join(' · ');
        if (text) { if (title.dataset.summary !== text) title.dataset.summary = text; } else if ('summary' in title.dataset) delete title.dataset.summary;
    });
}

//O resumo dos projetos só muda quando os itens mudam: o zoom e o arrastar do mapa não refazem a conta
//(com muitas CTOs, refazer a cada parada do mapa deixava o zoom travado)
let projectSummariesDirty = true;
function refreshNetworkOverlays() {
    networkOverlays.timer = null;
    renderMapLegend();
    if (projectSummariesDirty) {
        projectSummariesDirty = false;
        refreshProjectSummaries();
    }
}
document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) new MutationObserver(() => { projectSummariesDirty = true; }).observe(sidebar, { childList: true, subtree: true });
});

function scheduleNetworkOverlaysRefresh() {
    clearTimeout(networkOverlays.timer);
    networkOverlays.timer = setTimeout(refreshNetworkOverlays, 250);
}

if (typeof mapReady !== 'undefined' && mapReady?.then) {
    mapReady.then(() => {
        setupMapLegend();
        map.addListener('idle', scheduleNetworkOverlaysRefresh);
        scheduleNetworkOverlaysRefresh();
    });
}
//Mostrar/esconder pasta ou item na barra lateral não muda a lista de materiais: atualiza aqui
document.addEventListener('change', (e) => { if (e.target.closest?.('#sidebar .ge-vis-checkbox')) scheduleNetworkOverlaysRefresh(); });
