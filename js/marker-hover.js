// Cartão ao passar o mouse numa CTO ou CEO: fibras, splitters e vagas de atendimento, lidos do plano de fusão.
// Depende de script.js (getSplitterLabelText, escapeHtml) e js/clients.js (getCtoClients).

const markerHoverCache = new WeakMap(); //markerInfo → { plan, summary }
let markerHoverCard = null;
let markerHoverHideTimer = null;
let markerHoverPointer = { x: 0, y: 0 };

document.addEventListener('mousemove', (e) => { markerHoverPointer = { x: e.clientX, y: e.clientY }; }, { passive: true });

function summarizeFusionPlan(markerInfo) {
    const plan = markerInfo.fusionPlan || '';
    const cached = markerHoverCache.get(markerInfo);
    if (cached && cached.plan === plan) return cached.summary;
    let summary = null;
    try {
        const data = plan ? JSON.parse(plan) : null;
        const html = data && (data.elements || data.canvas);
        if (html) {
            const root = document.createElement('div');
            root.innerHTML = html;
            const connected = new Set();
            if (data.svg) {
                const svg = document.createElement('div');
                svg.innerHTML = data.svg;
                svg.querySelectorAll('.fusion-line').forEach(line => {
                    if (line.dataset.startId) connected.add(line.dataset.startId);
                    if (line.dataset.endId) connected.add(line.dataset.endId);
                });
            }
            const fibers = Array.from(root.querySelectorAll('.cable-element .fiber-row'));
            const splitters = Array.from(root.querySelectorAll('.splitter-element'));
            const atendimento = root.querySelectorAll('.splitter-element.splitter-atendimento .splitter-outputs .splitter-port-row');
            const ratios = {};
            splitters.forEach(s => {
                const label = getSplitterLabelText(s) || 'Splitter';
                ratios[label] = (ratios[label] || 0) + 1;
            });
            summary = {
                cables: root.querySelectorAll('.cable-element').length,
                fibers: fibers.length,
                usedFibers: fibers.filter(f => connected.has(f.id)).length,
                splitters: splitters.length,
                ratios: Object.entries(ratios).map(([label, n]) => (n > 1 ? `${n}× ${label}` : label)).join(', '),
                ports: atendimento.length,
            };
        }
    } catch (e) {
        summary = null;
    }
    markerHoverCache.set(markerInfo, { plan, summary });
    return summary;
}

function buildMarkerHoverHtml(markerInfo) {
    const s = summarizeFusionPlan(markerInfo);
    const icon = getMarkerIconDataUrl(markerInfo.type, markerInfo.color || '#f59e0b');
    const head = `<header class="mh-card__head"><img src="${icon}" alt=""><div><strong>${escapeHtml(markerInfo.name || '')}</strong><span>${markerInfo.type}</span></div></header>`;
    if (!s) return `${head}<p class="mh-card__empty">Sem plano de fusão</p>`;
    const row = (label, value, cls = '') => `<div class="mh-row ${cls}"><span>${label}</span><b>${value}</b></div>`;
    let body = `<section><h5>Fibras</h5>${row('Em uso', `${s.usedFibers} / ${s.fibers}`)}${row('Livres', s.fibers - s.usedFibers, 'is-free')}${row('Cabos', s.cables)}</section>`;
    body += `<section><h5>Splitters</h5>${row('Quantidade', s.splitters)}${s.ratios ? `<p class="mh-card__note">${escapeHtml(s.ratios)}</p>` : ''}</section>`;
    if (s.ports) {
        const clients = markerInfo.type === 'CTO' && typeof getCtoClients === 'function' ? getCtoClients(markerInfo).length : 0;
        const occupied = Math.min(s.ports, clients);
        body += `<section><h5>Vagas de atendimento</h5>${row('Livres', s.ports - occupied, 'is-free')}${row('Ocupadas', occupied, 'is-busy')}${row('Total', s.ports, 'is-total')}</section>`;
    }
    return head + `<div class="mh-card__body">${body}</div>`;
}

function positionMarkerHoverCard(x, y) {
    const card = markerHoverCard;
    const margin = 14;
    const { width, height } = card.getBoundingClientRect();
    let left = x + margin;
    let top = y + margin;
    if (left + width > window.innerWidth - 8) left = x - width - margin;
    if (top + height > window.innerHeight - 8) top = y - height - margin;
    card.style.left = `${Math.max(8, left)}px`;
    card.style.top = `${Math.max(8, top)}px`;
}

function showMarkerHoverCard(markerInfo, domEvent) {
    if (!markerInfo || (markerInfo.type !== 'CTO' && markerInfo.type !== 'CEO')) return;
    clearTimeout(markerHoverHideTimer);
    if (!markerHoverCard) {
        markerHoverCard = document.createElement('div');
        markerHoverCard.className = 'mh-card';
        markerHoverCard.setAttribute('role', 'tooltip');
        document.body.appendChild(markerHoverCard);
    }
    markerHoverCard.innerHTML = buildMarkerHoverHtml(markerInfo);
    markerHoverCard.classList.add('is-visible');
    const x = domEvent?.clientX ?? markerHoverPointer.x;
    const y = domEvent?.clientY ?? markerHoverPointer.y;
    positionMarkerHoverCard(x, y);
}

function hideMarkerHoverCard(immediate = false) {
    if (!markerHoverCard) return;
    clearTimeout(markerHoverHideTimer);
    const hide = () => markerHoverCard.classList.remove('is-visible');
    if (immediate) hide();
    else markerHoverHideTimer = setTimeout(hide, 120);
}
