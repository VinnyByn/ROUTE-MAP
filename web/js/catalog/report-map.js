// Foto do projeto no relatório: mapa da área (Google Static Maps, quando a chave permite) com os cabos e
// marcadores do projeto desenhados por cima, escala, norte e legenda do que cada cor/símbolo é.
// Sem o fundo (sem internet ou API desligada) a foto sai num fundo claro, com o mesmo desenho.
// Depende de js/app.js (getProjectItems, getCableColor, getFiberType) e js/map/marker-panel.js (MARKER_TYPE_META).

const REPORT_MAP_W = 640, REPORT_MAP_H = 400, REPORT_MAP_SCALE = 2;
const REPORT_MAP_LABELS = { CTO: 'CTO', CEO: 'CEO', RESERVA: 'Reserva técnica', CORDOALHA: 'Cordoalha', POP: 'POP', POSTE: 'Poste', TORRE: 'Torre', CLIENTE: 'Cliente', CASA: 'Casas', Importado: 'Não identificado' };
const REPORT_MAP_ORDER = ['POP', 'CEO', 'CTO', 'RESERVA', 'TORRE', 'CORDOALHA', 'POSTE', 'CLIENTE', 'CASA', 'Importado'];

function reportMapMarkerColor(type) {
    if (type === 'CLIENTE') return '#0ea5e9';
    if (type === 'CASA') return '#94a3b8';
    if (type === 'Importado') return '#ff9800';
    return (typeof MARKER_TYPE_META !== 'undefined' && MARKER_TYPE_META[type]?.color) || '#64748b';
}

//Mercator do Google (pixels do mundo no zoom 0 = 256)
function reportMapWorld(lat, lng) {
    const s = Math.min(Math.max(Math.sin(lat * Math.PI / 180), -0.9999), 0.9999);
    return { x: 256 * (0.5 + lng / 360), y: 256 * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) };
}

function getReportMapApiKey() {
    const src = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]')?.src || '';
    return new URL(src || 'https://x/').searchParams.get('key') || '';
}

async function loadReportMapBackground(center, zoom) {
    const key = getReportMapApiKey();
    if (!key) return null;
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${center.lat.toFixed(6)},${center.lng.toFixed(6)}&zoom=${zoom}`
        + `&size=${REPORT_MAP_W}x${REPORT_MAP_H}&scale=${REPORT_MAP_SCALE}&maptype=roadmap&style=feature:poi|visibility:off&style=feature:transit|visibility:off&key=${encodeURIComponent(key)}`;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok || !/^image\//.test(response.headers.get('content-type') || '')) return null;
        return await createImageBitmap(await response.blob());
    } catch (e) {
        return null;
    }
}

//Monta a imagem (PNG em data URL) e a legenda. Devolve null quando o projeto não tem nada com posição.
async function buildReportMapImage(projectId) {
    if (typeof getProjectItems !== 'function') return null;
    const { markers: projectMarkers = [], cables: projectCables = [] } = getProjectItems(projectId) || {};
    const pts = [];
    const markerList = projectMarkers.map(m => {
        const p = m.marker?.getPosition?.();
        if (!p) return null;
        const pos = { lat: p.lat(), lng: p.lng() };
        pts.push(pos);
        return { type: m.type, pos, status: typeof getMarkerInfrastructureStatus === 'function' ? getMarkerInfrastructureStatus(m) : null };
    }).filter(Boolean);
    const cableList = projectCables.map(c => {
        const path = (c.polyline?.getPath?.().getArray?.() || []).map(p => ({ lat: p.lat(), lng: p.lng() }));
        if (path.length < 2) return null;
        pts.push(...path);
        const fiber = typeof getFiberType === 'function' ? getFiberType(c.type) : null;
        return { path, fiber, color: (typeof getCableColor === 'function' && fiber ? getCableColor(fiber) : null) || c.color || '#2563eb', existing: c.status === 'Existente' };
    }).filter(Boolean);
    if (!pts.length) return null;

    //Zoom que cabe tudo com margem
    const world = pts.map(p => reportMapWorld(p.lat, p.lng));
    const minX = Math.min(...world.map(w => w.x)), maxX = Math.max(...world.map(w => w.x));
    const minY = Math.min(...world.map(w => w.y)), maxY = Math.max(...world.map(w => w.y));
    const pad = 0.82;
    let zoom = 19;
    while (zoom > 2 && ((maxX - minX) * 2 ** zoom > REPORT_MAP_W * pad || (maxY - minY) * 2 ** zoom > REPORT_MAP_H * pad)) zoom--;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const centerLng = (cx / 256 - 0.5) * 360;
    const centerLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * cy / 256))) * 180 / Math.PI;
    const k = 2 ** zoom * REPORT_MAP_SCALE;
    const toPx = (p) => { const w = reportMapWorld(p.lat, p.lng); return [(w.x - cx) * k + REPORT_MAP_W * REPORT_MAP_SCALE / 2, (w.y - cy) * k + REPORT_MAP_H * REPORT_MAP_SCALE / 2]; };

    const canvas = document.createElement('canvas');
    canvas.width = REPORT_MAP_W * REPORT_MAP_SCALE;
    canvas.height = REPORT_MAP_H * REPORT_MAP_SCALE;
    const ctx = canvas.getContext('2d');
    const background = await loadReportMapBackground({ lat: centerLat, lng: centerLng }, zoom);
    if (background) {
        ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; //Clareia o fundo para a rede destacar
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        for (let x = 0; x < canvas.width; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
        for (let y = 0; y < canvas.height; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
    }

    //Cabos: contorno branco + cor do tipo de fibra; existente tracejado
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    cableList.forEach(c => {
        const line = c.path.map(toPx);
        const draw = () => { ctx.beginPath(); line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 9;
        draw();
        ctx.setLineDash(c.existing ? [14, 10] : []);
        ctx.strokeStyle = c.color;
        ctx.lineWidth = 5;
        draw();
    });
    ctx.setLineDash([]);

    //Marcadores: casas e clientes pequenos por baixo; caixas por cima, maiores
    const sorted = [...markerList].sort((a, b) => REPORT_MAP_ORDER.indexOf(b.type) - REPORT_MAP_ORDER.indexOf(a.type));
    sorted.forEach(m => {
        const [x, y] = toPx(m.pos);
        const small = m.type === 'CASA' || m.type === 'CLIENTE' || m.type === 'POSTE';
        const r = small ? 6 : 11;
        ctx.beginPath();
        if (m.type === 'POP' || m.type === 'TORRE') ctx.rect(x - r, y - r, r * 2, r * 2);
        else if (m.type === 'CEO') { ctx.moveTo(x, y - r - 2); ctx.lineTo(x + r + 2, y); ctx.lineTo(x, y + r + 2); ctx.lineTo(x - r - 2, y); ctx.closePath(); }
        else ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = reportMapMarkerColor(m.type);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = m.status === 'Existente' ? '#334155' : '#ffffff';
        ctx.stroke();
    });

    //Norte e escala
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(canvas.width - 74, 18, 56, 74);
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.moveTo(canvas.width - 46, 28); ctx.lineTo(canvas.width - 34, 64); ctx.lineTo(canvas.width - 46, 56); ctx.lineTo(canvas.width - 58, 64); ctx.closePath(); ctx.fill();
    ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', canvas.width - 46, 86);
    const metersPerPx = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / 2 ** zoom / REPORT_MAP_SCALE;
    const target = metersPerPx * 220;
    const step = [1, 2, 5].flatMap(b => [1, 10, 100, 1000, 10000].map(m => b * m)).sort((a, b) => a - b).filter(v => v <= target).pop() || 1;
    const barPx = step / metersPerPx;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(18, canvas.height - 58, barPx + 40, 40);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(34, canvas.height - 30, barPx, 6);
    ctx.font = '600 18px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(step >= 1000 ? `${step / 1000} km` : `${step} m`, 34, canvas.height - 36);

    //Legenda: só o que aparece no desenho
    const legend = [];
    const markerCounts = {};
    markerList.forEach(m => { markerCounts[m.type] = (markerCounts[m.type] || 0) + 1; });
    REPORT_MAP_ORDER.forEach(type => {
        if (!markerCounts[type]) return;
        const shape = type === 'POP' || type === 'TORRE' ? 'square' : type === 'CEO' ? 'diamond' : 'circle';
        legend.push({ kind: 'marker', shape, color: reportMapMarkerColor(type), label: REPORT_MAP_LABELS[type] || type, count: markerCounts[type] });
    });
    const cableGroups = new Map();
    cableList.forEach(c => {
        const key = c.fiber || 'Cabo';
        const g = cableGroups.get(key) || { kind: 'cable', color: c.color, label: key === 'DROP' ? 'Cabo drop' : key === 'Cabo' ? 'Cabo' : `Cabo ${key.replace('FO-', '')} fibras`, count: 0 };
        g.count++;
        cableGroups.set(key, g);
    });
    [...cableGroups.entries()].sort(([a], [b]) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0)).forEach(([, g]) => legend.push(g));
    if (cableList.some(c => c.existing)) legend.push({ kind: 'cable', dashed: true, color: '#475569', label: 'Tracejado: cabo existente' });
    if (markerList.some(m => m.status === 'Existente')) legend.push({ kind: 'marker', shape: 'circle', color: '#cbd5e1', outline: '#334155', label: 'Borda escura: caixa existente' });

    return { dataUrl: canvas.toDataURL('image/png'), legend, hasBackground: !!background, aspect: REPORT_MAP_H / REPORT_MAP_W };
}

//HTML da legenda (pré-visualização e Word)
function renderReportMapLegendHtml(legend) {
    return (legend || []).map(item => {
        const swatch = item.kind === 'cable'
            ? `<span class="rp-map-legend__line${item.dashed ? ' is-dashed' : ''}" style="--c:${item.color}"></span>`
            : `<span class="rp-map-legend__dot rp-map-legend__dot--${item.shape}" style="--c:${item.color}${item.outline ? `;--o:${item.outline}` : ''}"></span>`;
        return `<span class="rp-map-legend__item">${swatch}${escapeReportPreviewHtml(item.label)}${item.count ? ` <b>${item.count}</b>` : ''}</span>`;
    }).join('');
}
