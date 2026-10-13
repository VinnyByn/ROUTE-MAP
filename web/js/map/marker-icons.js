// Ícones dos marcadores em SVG: mesmo desenho no mapa, na barra lateral e nos painéis.
// Selos modernos com símbolos do Lucide: CEO = emenda, CTO = distribuição, cordoalha = derivação,
// reserva = voltas de cabo, POP = servidor, casas = pílula com a quantidade, cliente = hexágono com pessoa/maleta/prédio.

const MARKER_ICON_OUTLINE = 'rgba(15, 23, 42, 0.55)';
const markerIconCache = new Map();

//Tamanho global dos marcadores (preferência do usuário): o tamanho de cada marcador não é mais usado
const MARKER_SCALES = { pequeno: 20, medio: 26, grande: 34 };
let markerScalePx = MARKER_SCALES.medio;

function setMarkerScale(scale) {
    const px = MARKER_SCALES[scale] || MARKER_SCALES.medio;
    if (px === markerScalePx) return false;
    markerScalePx = px;
    markerIconCache.clear();
    return true;
}

function getMarkerPixelSize() {
    return markerScalePx;
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

//Símbolos (Lucide, 24×24) desenhados em branco dentro de cada marcador
const MARKER_GLYPHS = {
    CEO: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
    CTO: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
    CORDOALHA: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
    RESERVA: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    POSTE: '<path d="M12 2v20"/><path d="M5 6h14"/><path d="M7 6l-2 4"/><path d="M17 6l2 4"/><path d="M9 22h6"/>',
    POP: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    residencial: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    b2b: '<path d="M12 12h.01"/><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M22 13a18.15 18.15 0 0 1-20 0"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
    predial: '<path d="M10 12h4"/><path d="M10 8h4"/><path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"/><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>',
};

//Símbolo centrado em (cx, cy) com lado `size`
function markerGlyph(name, cx, cy, size, color = '#ffffff') {
    const k = size / 24;
    return `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${k})" fill="none" stroke="${color}" stroke-width="${(2.4 / k * 0.85).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${MARKER_GLYPHS[name]}</g>`;
}

//Desenho de cada tipo num quadro 32×32 (os pins usam 32×40): selo colorido com símbolo branco
function getMarkerShapeSvg(type, color, options = {}) {
    const fill = color || '#f59e0b';
    const ring = `stroke="#ffffff" stroke-width="2"`;
    const shadow = `stroke="${MARKER_ICON_OUTLINE}" stroke-width="4" fill="none"`;
    const glyphColor = getContrastTextColor(fill) === '#0f172a' ? '#0f172a' : '#ffffff';
    const badge = (shape) => `<g>${shape.replace('/>', ` ${shadow}/>`)}${shape.replace('/>', ` fill="${fill}" ${ring}/>`)}</g>`;
    switch (type) {
    case 'CEO':
        return badge('<circle cx="16" cy="16" r="13"/>') + markerGlyph('CEO', 16, 16, 15, glyphColor);
    case 'CTO':
        return badge('<rect x="3" y="3" width="26" height="26" rx="7"/>') + markerGlyph('CTO', 16, 16, 16, glyphColor);
    case 'CORDOALHA':
        return badge('<rect x="5.5" y="5.5" width="21" height="21" rx="5" transform="rotate(45 16 16)"/>') + markerGlyph('CORDOALHA', 16, 16.5, 13, glyphColor);
    case 'RESERVA':
        return badge('<circle cx="16" cy="16" r="13"/>') + markerGlyph('RESERVA', 16, 16, 15, glyphColor);
    case 'POP':
        return badge('<rect x="3" y="3" width="26" height="26" rx="7"/>') + markerGlyph('POP', 16, 16, 15, glyphColor);
    case 'POSTE':
        return badge('<circle cx="16" cy="16" r="11"/>') + markerGlyph('POSTE', 16, 16, 13, glyphColor);
    case 'CLIENTE': {
        //Mesmo padrão dos outros selos: hexágono arredondado com o símbolo do tipo de cliente
        const hex = '<path d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25z" stroke-linejoin="round"/>';
        const glyph = MARKER_GLYPHS[options.variant] ? options.variant : 'residencial';
        return `<g opacity="${options.faded ? 0.6 : 1}">${badge(hex)}${markerGlyph(glyph, 16, 16, 15, glyphColor)}</g>`;
    }
    default:
        return badge('<circle cx="16" cy="16" r="11"/>');
    }
}

function svgToDataUrl(svg) {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

//Casas: pílula branca simples com a quantidade
function buildCasaPinSvg(text, color, textColor) {
    const label = escapeSvgText(String(text || '0'));
    const h = 24;
    const w = Math.max(h, 12 + label.length * 7.6);
    const fill = color || '#ffffff';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
        `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="${(h - 3) / 2}" stroke="${MARKER_ICON_OUTLINE}" stroke-width="3" fill="none"/>` +
        `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="${(h - 3) / 2}" fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>` +
        `<text x="${w / 2}" y="${h / 2 + 4.3}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="12.5" font-weight="700" fill="${textColor || getContrastTextColor(fill)}">${label}</text>` +
        `</svg>`;
    return { svg, w, h };
}

//Ícone do Google Maps para um marcador
function buildMarkerMapIcon(type, { color, size, text, labelColor, variant, faded } = {}) {
    const key = [type, color, markerScalePx, text, labelColor, variant, faded].join('|');
    if (markerIconCache.has(key)) return markerIconCache.get(key);
    let icon;
    if (type === 'CASA') {
        const { svg, w, h } = buildCasaPinSvg(text, color, labelColor);
        const scale = getMarkerPixelSize() / 26;
        const sw = Math.round(w * scale);
        const sh = Math.round(h * scale);
        icon = {
            url: svgToDataUrl(svg),
            scaledSize: new google.maps.Size(sw, sh),
            anchor: new google.maps.Point(sw / 2, sh / 2),
            labelOrigin: new google.maps.Point(sw / 2, -7),
        };
    } else {
        const px = getMarkerPixelSize();
        const h = px;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${h}" viewBox="0 0 32 32">${getMarkerShapeSvg(type, color, { variant, faded })}</svg>`;
        icon = {
            url: svgToDataUrl(svg),
            scaledSize: new google.maps.Size(px, h),
            anchor: new google.maps.Point(px / 2, h / 2),
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
    return svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${getMarkerShapeSvg(type, color, options)}</svg>`);
}

function applyMarkerIconToElement(element, type, color, options = {}) {
    if (!element) return;
    element.classList.add('ge-icon-svg');
    element.style.backgroundImage = `url("${getMarkerIconDataUrl(type, color, options)}")`;
}
