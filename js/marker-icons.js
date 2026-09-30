// Ícones dos marcadores em SVG: mesmo desenho no mapa, na barra lateral e nos painéis.
// CEO = círculo, CTO = quadrado, cordoalha = +, reserva = espiral, casas = pin com a
// quantidade, POP = casinha, cliente = pin com pessoa (B2C) ou prédio (B2B).

const MARKER_ICON_OUTLINE = 'rgba(15, 23, 42, 0.55)';
const markerIconCache = new Map();

//Tamanho em pixels a partir do "Tamanho" do marcador (1–20, padrão 4)
function getMarkerPixelSize(size) {
    const value = Math.max(1, Math.min(20, Number(size) || DEFAULT_MARKER_SIZE));
    return Math.round(12 + value * 3);
}

function escapeSvgText(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

//Cor de texto legível sobre um fundo (preto ou branco)
function getContrastTextColor(hex) {
    const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return '#0f172a';
    const [r, g, b] = m.slice(1).map(v => parseInt(v, 16) / 255);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.6 ? '#0f172a' : '#ffffff';
}

function buildSpiralPath(cx, cy, turns, maxRadius) {
    const points = [];
    const steps = Math.round(turns * 28);
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const angle = t * turns * Math.PI * 2;
        const radius = 1.2 + t * (maxRadius - 1.2);
        points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`);
    }
    return `M ${points.join(' L ')}`;
}

//Desenho de cada tipo num quadro 32×32 (os pins usam 32×40)
function getMarkerShapeSvg(type, color, options = {}) {
    const fill = color || '#f59e0b';
    const halo = `stroke="#ffffff" stroke-width="2.4" stroke-linejoin="round"`;
    const outline = `stroke="${MARKER_ICON_OUTLINE}" stroke-width="4.6" stroke-linejoin="round" fill="none"`;
    switch (type) {
    case 'CEO':
        return `<circle cx="16" cy="16" r="11.5" ${outline}/><circle cx="16" cy="16" r="11.5" fill="${fill}" ${halo}/>`;
    case 'CTO':
        return `<rect x="4.5" y="4.5" width="23" height="23" rx="4" ${outline}/><rect x="4.5" y="4.5" width="23" height="23" rx="4" fill="${fill}" ${halo}/>`;
    case 'CORDOALHA': {
        const plus = 'M12.5 3.5h7v9h9v7h-9v9h-7v-9h-9v-7h9z';
        return `<path d="${plus}" ${outline}/><path d="${plus}" fill="${fill}" ${halo}/>`;
    }
    case 'RESERVA': {
        const spiral = buildSpiralPath(16, 16, 2.6, 12);
        return `<circle cx="16" cy="16" r="14" fill="#ffffff" fill-opacity="0.92" stroke="${MARKER_ICON_OUTLINE}" stroke-width="1.2"/>` +
            `<path d="${spiral}" fill="none" stroke="${fill}" stroke-width="3" stroke-linecap="round"/>`;
    }
    case 'POP': {
        const house = 'M16 3.5 29 14.5h-3.6V28.5H6.6V14.5H3z';
        return `<path d="${house}" ${outline}/><path d="${house}" fill="${fill}" ${halo}/>` +
            `<rect x="13.2" y="19.5" width="5.6" height="9" rx="1" fill="#ffffff" fill-opacity="0.9"/>`;
    }
    case 'CLIENTE': {
        const pin = 'M16 38.5s12-10.6 12-21A12 12 0 0 0 4 17.5c0 10.4 12 21 12 21z';
        const glyph = options.variant === 'b2b'
            ? '<path d="M11 24.5v-12h6v12M17 15.5h4v9M10 24.5h12M13 15h2M13 18h2M13 21h2" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'
            : '<circle cx="16" cy="14" r="3.6" fill="#ffffff"/><path d="M10.5 23.2c1-2.9 3-4.4 5.5-4.4s4.5 1.5 5.5 4.4" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round"/>';
        return `<path d="${pin}" ${outline}/><path d="${pin}" fill="${fill}" ${halo} opacity="${options.faded ? 0.6 : 1}"/>${glyph}`;
    }
    default:
        return `<circle cx="16" cy="16" r="10" ${outline}/><circle cx="16" cy="16" r="10" fill="${fill}" ${halo}/>`;
    }
}

function svgToDataUrl(svg) {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

//Pin das casas: balão com a quantidade dentro
function buildCasaPinSvg(text, color, textColor) {
    const label = escapeSvgText(String(text || '0'));
    const headW = Math.max(26, 12 + label.length * 8.4);
    const w = headW + 6;
    const h = 40;
    const cx = w / 2;
    const left = 3;
    const pin = `M${left + 8} 3h${headW - 16}a8 8 0 0 1 8 8v10a8 8 0 0 1-8 8h-${(headW - 16) / 2 - 5}L${cx} 37l-5-8h-${(headW - 16) / 2 - 5}a8 8 0 0 1-8-8V11a8 8 0 0 1 8-8z`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
        `<path d="${pin}" stroke="${MARKER_ICON_OUTLINE}" stroke-width="3.6" fill="none" stroke-linejoin="round"/>` +
        `<path d="${pin}" fill="${color || '#ffffff'}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>` +
        `<text x="${cx}" y="21" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="13.5" font-weight="700" fill="${textColor || getContrastTextColor(color || '#ffffff')}">${label}</text>` +
        `</svg>`;
    return { svg, w, h };
}

//Ícone do Google Maps para um marcador
function buildMarkerMapIcon(type, { color, size, text, labelColor, variant, faded } = {}) {
    const key = [type, color, size, text, labelColor, variant, faded].join('|');
    if (markerIconCache.has(key)) return markerIconCache.get(key);
    let icon;
    if (type === 'CASA') {
        const { svg, w, h } = buildCasaPinSvg(text, color, labelColor);
        const scale = Math.max(0.8, Math.min(1.8, getMarkerPixelSize(size) / 24));
        const sw = Math.round(w * scale);
        const sh = Math.round(h * scale);
        icon = {
            url: svgToDataUrl(svg),
            scaledSize: new google.maps.Size(sw, sh),
            anchor: new google.maps.Point(sw / 2, sh - 2 * scale),
        };
    } else {
        const isPin = type === 'CLIENTE';
        const px = type === 'CLIENTE' ? 30 : getMarkerPixelSize(size);
        const vbH = isPin ? 40 : 32;
        const h = Math.round(px * vbH / 32);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${h}" viewBox="0 0 32 ${vbH}">${getMarkerShapeSvg(type, color, { variant, faded })}</svg>`;
        icon = {
            url: svgToDataUrl(svg),
            scaledSize: new google.maps.Size(px, h),
            anchor: isPin ? new google.maps.Point(px / 2, h - 1) : new google.maps.Point(px / 2, h / 2),
            labelOrigin: new google.maps.Point(px / 2, -7),
        };
    }
    markerIconCache.set(key, icon);
    return icon;
}

//Rótulo do nome com contorno que contrasta com a cor do texto
function buildMarkerMapLabel(text, labelColor) {
    const color = labelColor || '#0f172a';
    //Texto claro ganha contorno escuro (--light-halo); texto escuro ganha contorno branco (--dark-halo)
    const lightText = getContrastTextColor(color) === '#0f172a';
    return {
        text: String(text ?? ''),
        color,
        fontSize: '12px',
        fontWeight: '700',
        className: lightText ? 'marker-label marker-label--light-halo' : 'marker-label marker-label--dark-halo',
    };
}

//Mesmo desenho, pequeno, para a barra lateral e cabeçalhos dos painéis
function getMarkerIconDataUrl(type, color, options = {}) {
    if (type === 'CASA') return svgToDataUrl(buildCasaPinSvg(options.text || '', color, options.labelColor).svg);
    const vbH = type === 'CLIENTE' ? 40 : 32;
    return svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 ${vbH}">${getMarkerShapeSvg(type, color, options)}</svg>`);
}

function applyMarkerIconToElement(element, type, color, options = {}) {
    if (!element) return;
    element.classList.add('ge-icon-svg');
    element.style.backgroundImage = `url("${getMarkerIconDataUrl(type, color, options)}")`;
}
