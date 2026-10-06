// Busca global (Ctrl+K ou botão Localizar): caixas, clientes (nome, código, endereço), cabos,
// polígonos, coordenadas "lat, lng" e endereços (OpenStreetMap). Enter vai até o item.
// Depende de script.js, js/sidebar-actions.js e js/clients.js.

let globalSearchResults = [];
let globalSearchIndex = 0;
let globalSearchAddressTimer = null;
let globalSearchAddressSeq = 0;

function normalizeSearchText(value) {
    return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const SEARCH_KIND_LABELS = { CEO: 'CEO', CTO: 'CTO', POP: 'POP', POSTE: 'Poste', RESERVA: 'Reserva', CORDOALHA: 'Cordoalha', CASA: 'Casas', CLIENTE: 'Cliente', Importado: 'Importado' };

function searchMapItems(query, limit = 30) {
    const words = normalizeSearchText(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const results = [];
    const consider = (kind, info, title, subtitle, haystack) => {
        const text = normalizeSearchText(haystack);
        if (!words.every(w => text.includes(w))) return;
        const name = normalizeSearchText(title);
        const score = (name === words.join(' ') ? 0 : name.startsWith(words[0]) ? 1 : 2);
        results.push({ kind, info, title, subtitle, score });
    };
    markers.forEach(m => {
        const c = m.client || {};
        const label = SEARCH_KIND_LABELS[m.type] || m.type;
        const extra = m.type === 'CLIENTE' ? [c.code, c.address, c.b2b?.company, findMarkerByUid(c.ctoUid)?.name].filter(Boolean)
            : m.type === 'POSTE' ? [m.pole?.number, m.pole?.utility, m.pole?.situation] : [m.description];
        consider('marker', m, m.name || label, [label, ...extra.filter(Boolean).slice(0, 2)].join(' · '), [m.name, label, ...extra].join(' '));
    });
    savedCables.forEach(c => consider('cable', c, c.name, ['Cabo', c.type, c.totalLength ? `${c.totalLength} m` : ''].filter(Boolean).join(' · '), [c.name, 'cabo', c.type].join(' ')));
    savedPolygons.forEach(p => consider('polygon', p, p.name, 'Polígono', [p.name, 'poligono'].join(' ')));
    return results.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title, 'pt-BR', { numeric: true })).slice(0, limit);
}

function parseSearchCoordinates(query) {
    const m = String(query).trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
    if (!m) return null;
    const lat = parseFloat(m[1].replace(',', '.'));
    const lng = parseFloat(m[2].replace(',', '.'));
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

function renderGlobalSearchResults() {
    const list = document.getElementById('globalSearchResults');
    if (!globalSearchResults.length) {
        const q = document.getElementById('globalSearchInput').value.trim();
        list.innerHTML = q ? '<li class="gs-empty">Nada encontrado nos projetos abertos.</li>' : '<li class="gs-empty">Digite o nome de uma caixa, cliente, cabo, código, endereço ou coordenada.</li>';
        return;
    }
    globalSearchIndex = Math.min(globalSearchIndex, globalSearchResults.length - 1);
    list.innerHTML = globalSearchResults.map((r, i) => `
        <li><button type="button" class="gs-item${i === globalSearchIndex ? ' is-active' : ''}" data-gs-index="${i}">
            <span class="gs-kind gs-kind--${r.kind}">${escapeHtml(r.badge || (r.kind === 'cable' ? 'Cabo' : r.kind === 'polygon' ? 'Área' : SEARCH_KIND_LABELS[r.info?.type] || ''))}</span>
            <span class="gs-text"><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.subtitle || '')}</small></span>
        </button></li>`).join('');
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
}

function updateGlobalSearch() {
    const query = document.getElementById('globalSearchInput').value;
    const coords = parseSearchCoordinates(query);
    globalSearchResults = coords
        ? [{ kind: 'coords', coords, title: `${coords.lat}, ${coords.lng}`, subtitle: 'Ir para a coordenada', badge: 'Coord.' }]
        : searchMapItems(query);
    globalSearchIndex = 0;
    renderGlobalSearchResults();
    clearTimeout(globalSearchAddressTimer);
    if (coords || normalizeSearchText(query).trim().length < 4) return;
    //Endereço: depois que o usuário para de digitar
    const seq = ++globalSearchAddressSeq;
    globalSearchAddressTimer = setTimeout(async () => {
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=4&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(query)}`;
            const response = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!response.ok || seq !== globalSearchAddressSeq) return;
            const places = await response.json();
            if (seq !== globalSearchAddressSeq) return;
            globalSearchResults = globalSearchResults.filter(r => r.kind !== 'address').concat((places || []).map(p => ({
                kind: 'address', coords: { lat: Number(p.lat), lng: Number(p.lon) }, title: p.display_name.split(',').slice(0, 2).join(','), subtitle: p.display_name, badge: 'Endereço',
            })));
            renderGlobalSearchResults();
        } catch (e) { /* sem internet ou bloqueado: fica só com os itens do mapa */ }
    }, 600);
}

function goToGlobalSearchResult(result) {
    if (!result) return;
    closeGlobalSearch();
    if (result.coords) {
        //panToLocation monta o balão com HTML: o texto vem de fora (endereço), então vai escapado
        panToLocation(new google.maps.LatLng(result.coords.lat, result.coords.lng), escapeHtml(result.subtitle && result.kind === 'address' ? result.subtitle : result.title));
        return;
    }
    if (result.kind === 'marker') {
        selectSidebarMarker(result.info);
        focusMapToMarker(result.info);
    } else if (result.kind === 'cable') {
        selectSidebarCable(result.info);
        focusMapToCable(result.info);
    } else if (result.kind === 'polygon') {
        focusMapToPolygon(result.info);
    }
    const row = result.info?.listItem || result.info?.item;
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function openGlobalSearch() {
    const box = document.getElementById('globalSearch');
    box.classList.remove('hidden');
    const input = document.getElementById('globalSearchInput');
    input.select();
    input.focus();
    updateGlobalSearch();
}

function closeGlobalSearch() {
    document.getElementById('globalSearch')?.classList.add('hidden');
    clearTimeout(globalSearchAddressTimer);
}

function setupGlobalSearch() {
    const box = document.getElementById('globalSearch');
    if (!box) return;
    const input = document.getElementById('globalSearchInput');
    input.addEventListener('input', updateGlobalSearch);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!globalSearchResults.length) return;
            globalSearchIndex = (globalSearchIndex + (e.key === 'ArrowDown' ? 1 : -1) + globalSearchResults.length) % globalSearchResults.length;
            renderGlobalSearchResults();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            goToGlobalSearchResult(globalSearchResults[globalSearchIndex]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeGlobalSearch();
        }
    });
    box.addEventListener('mousedown', (e) => { if (e.target === box) closeGlobalSearch(); });
    document.getElementById('globalSearchResults').addEventListener('click', (e) => {
        const item = e.target.closest('[data-gs-index]');
        if (item) goToGlobalSearchResult(globalSearchResults[Number(item.dataset.gsIndex)]);
    });
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            openGlobalSearch();
        }
    });
}

document.addEventListener('DOMContentLoaded', setupGlobalSearch);
