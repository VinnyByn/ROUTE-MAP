// Foto do projeto no relatório, como está desenhado no mapa: mesmo tipo de fundo (Google Static Maps, quando a
// chave permite), os mesmos ícones, cores, espessuras e nomes, escala, norte e legenda do que cada símbolo/cor é.
// Sem o fundo (sem internet ou API desligada) a foto sai num fundo claro, com o mesmo desenho.
// Depende de js/app.js (getProjectItems, getCableColor, getFiberType) e js/map/marker-panel.js (MARKER_TYPE_META).

const REPORT_MAP_W = 640, REPORT_MAP_H = 400, REPORT_MAP_SCALE = 2;
const REPORT_MAP_LABELS = { CTO: 'CTO', CEO: 'CEO', RESERVA: 'Reserva técnica', CORDOALHA: 'Cordoalha', POP: 'POP', POSTE: 'Poste', TORRE: 'Torre', PREDIO: 'Prédio', CLIENTE: 'Cliente', CASA: 'Casas', Importado: 'Não identificado' };
const REPORT_MAP_ORDER = ['PREDIO', 'POP', 'CEO', 'CTO', 'RESERVA', 'TORRE', 'CORDOALHA', 'POSTE', 'CLIENTE', 'CASA', 'Importado'];

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

async function loadReportMapBackground(center, zoom, mapType) {
    const key = getReportMapApiKey();
    if (!key) return null;
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${center.lat.toFixed(6)},${center.lng.toFixed(6)}&zoom=${zoom}`
        + `&size=${REPORT_MAP_W}x${REPORT_MAP_H}&scale=${REPORT_MAP_SCALE}&maptype=${mapType}&style=feature:poi|visibility:off&style=feature:transit|visibility:off&key=${encodeURIComponent(key)}`;
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

//Ícone do marcador como está no mapa (SVG em data URL) carregado para desenhar no canvas
const reportMapIconCache = new Map();
function loadReportMapIcon(url) {
    if (!url) return Promise.resolve(null);
    if (!reportMapIconCache.has(url)) {
        reportMapIconCache.set(url, new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = url;
        }));
    }
    return reportMapIconCache.get(url);
}

function reportMapIconOf(markerInfo) {
    const icon = markerInfo.marker?.getIcon?.();
    if (icon && typeof icon === 'object' && icon.url) {
        return { url: icon.url, w: icon.scaledSize?.width || 28, h: icon.scaledSize?.height || 28 };
    }
    if (typeof buildMarkerMapIcon === 'function') {
        try {
            const built = buildMarkerMapIcon(markerInfo.type, { color: markerInfo.color, text: markerInfo.type === 'CASA' ? markerInfo.name : undefined, labelColor: markerInfo.labelColor });
            return { url: built.url, w: built.scaledSize?.width || 28, h: built.scaledSize?.height || 28 };
        } catch (e) { /* sem ícone: bolinha na cor do tipo */ }
    }
    return null;
}

//Ícone em PNG pequeno (para a legenda no PDF, que não lê SVG)
function reportMapIconPng(img, size = 48) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ratio = Math.min(size / (img.naturalWidth || size), size / (img.naturalHeight || size));
    const w = (img.naturalWidth || size) * ratio, h = (img.naturalHeight || size) * ratio;
    c.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return c.toDataURL('image/png');
}

//Foto do projeto como está desenhado: mesmo fundo (satélite/ruas), ícones, cores, espessuras e nomes do mapa.
//Devolve null quando o projeto não tem nada com posição.
async function buildReportMapImage(projectId) {
    if (typeof getProjectItems !== 'function') return null;
    const { markers: projectMarkers = [], cables: projectCables = [], polygons: projectPolygons = [] } = getProjectItems(projectId) || {};
    const pts = [];
    //Caixa dentro de prédio aparece pelo prédio (mesmo ponto)
    const markerList = projectMarkers.filter(m => m.marker?.getVisible?.() !== false && !(typeof isBoxInsideBuilding === 'function' && isBoxInsideBuilding(m))).map(m => {
        const p = m.marker?.getPosition?.();
        if (!p) return null;
        const pos = { lat: p.lat(), lng: p.lng() };
        pts.push(pos);
        return { type: m.type, pos, name: m.name, labelColor: m.labelColor || '#0f172a', icon: reportMapIconOf(m) };
    }).filter(Boolean);
    const cableList = projectCables.filter(c => c.polyline?.getVisible?.() !== false).map(c => {
        const path = (c.polyline?.getPath?.().getArray?.() || []).map(p => ({ lat: p.lat(), lng: p.lng() }));
        if (path.length < 2) return null;
        pts.push(...path);
        const fiber = typeof getFiberType === 'function' ? getFiberType(c.type) : null;
        const color = c.polyline?.get?.('strokeColor') || c.color || '#2563eb';
        const width = c.polyline?.get?.('strokeWeight') || c.width || 4;
        return { path, fiber, color, width, existing: c.status === 'Existente' };
    }).filter(Boolean);
    const polygonList = projectPolygons.map(pg => {
        const path = (pg.path || []).map(p => ({ lat: +p.lat, lng: +p.lng })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        return path.length >= 3 ? { path, color: pg.color || '#C70039', opacity: pg.opacity ?? 0.2 } : null;
    }).filter(Boolean);
    polygonList.forEach(pg => pts.push(...pg.path));
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
    //Mesmo tipo de mapa da tela (satélite, híbrido, ruas, terreno)
    const mapTypeId = (typeof map !== 'undefined' && map?.getMapTypeId?.()) || 'roadmap';
    const mapType = ['satellite', 'hybrid', 'terrain', 'roadmap'].includes(mapTypeId) ? mapTypeId : 'roadmap';
    const background = await loadReportMapBackground({ lat: centerLat, lng: centerLng }, zoom, mapType);
    if (background) {
        ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        for (let x = 0; x < canvas.width; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
        for (let y = 0; y < canvas.height; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
    }

    //Polígonos (áreas) como no mapa
    polygonList.forEach(pg => {
        ctx.beginPath();
        pg.path.map(toPx).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.globalAlpha = Math.min(0.5, pg.opacity);
        ctx.fillStyle = pg.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = pg.color;
        ctx.lineWidth = 3;
        ctx.stroke();
    });

    //Cabos com a cor e a espessura da tela
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    cableList.forEach(c => {
        ctx.beginPath();
        c.path.map(toPx).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = c.color;
        ctx.lineWidth = Math.max(2, c.width) * REPORT_MAP_SCALE * 0.8;
        ctx.stroke();
    });

    //Marcadores com o ícone do mapa; casas e clientes por baixo, caixas por cima
    const sorted = [...markerList].sort((a, b) => REPORT_MAP_ORDER.indexOf(b.type) - REPORT_MAP_ORDER.indexOf(a.type));
    const icons = await Promise.all(sorted.map(m => loadReportMapIcon(m.icon?.url)));
    sorted.forEach((m, i) => {
        const [x, y] = toPx(m.pos);
        const img = icons[i];
        if (img) {
            const w = m.icon.w * REPORT_MAP_SCALE * 0.85, h = m.icon.h * REPORT_MAP_SCALE * 0.85;
            ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
        } else {
            ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fillStyle = reportMapMarkerColor(m.type); ctx.fill();
            ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
        }
    });
    //Nomes das caixas (como no mapa), sem poluir quando são muitas
    const named = sorted.filter(m => !['CASA', 'CLIENTE', 'POSTE'].includes(m.type) && m.name);
    if (named.length <= 120) {
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        named.forEach(m => {
            const [x, y] = toPx(m.pos);
            const ty = y - ((m.icon?.h || 28) * REPORT_MAP_SCALE * 0.85) / 2 - 8;
            const light = typeof getContrastTextColor === 'function' && getContrastTextColor(m.labelColor) === '#0f172a';
            ctx.lineWidth = 5;
            ctx.strokeStyle = light ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.95)';
            ctx.strokeText(m.name, x, ty);
            ctx.fillStyle = m.labelColor;
            ctx.fillText(m.name, x, ty);
        });
    }

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

    //Legenda: o ícone de verdade de cada tipo e a cor de cada tipo de cabo, só o que aparece no desenho
    const legend = [];
    const byType = new Map();
    sorted.forEach((m, i) => {
        const g = byType.get(m.type) || { count: 0, img: icons[i] };
        g.count++;
        byType.set(m.type, g);
    });
    REPORT_MAP_ORDER.forEach(type => {
        const g = byType.get(type);
        if (!g) return;
        legend.push({ kind: 'marker', shape: 'circle', color: reportMapMarkerColor(type), icon: g.img ? reportMapIconPng(g.img) : null, label: REPORT_MAP_LABELS[type] || type, count: g.count });
    });
    const cableGroups = new Map();
    cableList.forEach(c => {
        const fiberLabel = !c.fiber ? 'Cabo' : c.fiber === 'DROP' ? 'Cabo drop' : `Cabo ${c.fiber.replace('FO-', '')} fibras`;
        const key = `${fiberLabel}|${c.existing ? 'E' : 'N'}|${c.color}`;
        const g = cableGroups.get(key) || { kind: 'cable', color: c.color, label: `${fiberLabel}${c.existing ? ' (existente)' : ''}`, count: 0, sort: (parseInt(c.fiber?.replace(/\D/g, ''), 10) || 0) * 2 + (c.existing ? 1 : 0) };
        g.count++;
        cableGroups.set(key, g);
    });
    [...cableGroups.values()].sort((a, b) => a.sort - b.sort).forEach(g => { delete g.sort; legend.push(g); });
    if (polygonList.length) legend.push({ kind: 'area', color: polygonList[0].color, label: 'Área do projeto', count: polygonList.length });

    return { dataUrl: canvas.toDataURL('image/png'), legend, hasBackground: !!background, aspect: REPORT_MAP_H / REPORT_MAP_W };
}

//HTML da legenda (pré-visualização e Word)
function renderReportMapLegendHtml(legend) {
    return (legend || []).map(item => {
        const swatch = item.icon ? `<img class="rp-map-legend__icon" src="${item.icon}" alt="" />`
            : item.kind === 'area' ? `<span class="rp-map-legend__area" style="--c:${item.color}"></span>`
            : item.kind === 'cable'
            ? `<span class="rp-map-legend__line${item.dashed ? ' is-dashed' : ''}" style="--c:${item.color}"></span>`
            : `<span class="rp-map-legend__dot rp-map-legend__dot--${item.shape}" style="--c:${item.color}${item.outline ? `;--o:${item.outline}` : ''}"></span>`;
        return `<span class="rp-map-legend__item">${swatch}${escapeReportPreviewHtml(item.label)}${item.count ? ` <b>${item.count}</b>` : ''}</span>`;
    }).join('');
}
