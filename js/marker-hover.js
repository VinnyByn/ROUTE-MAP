// Cartão ao passar o mouse numa CTO ou CEO: fibras, splitters e vagas de atendimento, lidos do plano de fusão.
// Depende de js/fusion-plan.js (readFusionPlan), script.js (escapeHtml) e js/clients.js (getCtoClients).

const markerHoverCache = new WeakMap(); //markerInfo → { plan (dados de readFusionPlan), summary }
let markerHoverCard = null;
let markerHoverHideTimer = null;
let markerHoverPointer = { x: 0, y: 0 };

document.addEventListener('mousemove', (e) => { markerHoverPointer = { x: e.clientX, y: e.clientY }; }, { passive: true });

function summarizeFusionPlan(markerInfo) {
    const plan = readFusionPlan(markerInfo);
    const cached = markerHoverCache.get(markerInfo);
    if (cached && cached.plan === plan) return cached.summary;
    let summary = null;
    if (plan && !plan.empty) {
        const fibers = plan.cables.flatMap(c => c.fibers);
        const ratios = {};
        plan.splitters.forEach(s => {
            const label = s.label || 'Splitter';
            ratios[label] = (ratios[label] || 0) + 1;
        });
        summary = {
            cables: plan.cables.length,
            fibers: fibers.length,
            usedFibers: fibers.filter(f => f.connected).length,
            splitters: plan.splitters.length,
            ratios: Object.entries(ratios).map(([label, n]) => (n > 1 ? `${n}× ${label}` : label)).join(', '),
            ports: plan.splitters.filter(s => s.atendimento).reduce((sum, s) => sum + s.outputs, 0),
        };
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

// ---------------------------------------------------------------
// Fibras de um cabo em uso: ligadas em algum plano de fusão (CTO/CEO) ou em cliente B2B
// ---------------------------------------------------------------
const cableFusionCache = new WeakMap(); //markerInfo → { plan (dados de readFusionPlan), cables: Map(nome → Set(fibras ligadas)) }

function getPlanCableFiberUsage(markerInfo) {
    const plan = readFusionPlan(markerInfo);
    const cached = cableFusionCache.get(markerInfo);
    if (cached && cached.plan === plan) return cached.cables;
    const cables = new Map();
    if (plan && !plan.empty) {
        plan.cables.forEach(cable => {
            if (!cable.name) return;
            const used = cables.get(cable.name) || new Set();
            cable.fibers.forEach(f => { if (f.number && f.connected) used.add(f.number); });
            cables.set(cable.name, used);
        });
    }
    cableFusionCache.set(markerInfo, { plan, cables });
    return cables;
}

//Compacta [1,2,3,5,7,8] em "1-3, 5, 7-8"
function formatFiberRanges(numbers) {
    const parts = [];
    for (let i = 0; i < numbers.length; i++) {
        let j = i;
        while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++;
        parts.push(j > i ? `${numbers[i]}-${numbers[j]}` : String(numbers[i]));
        i = j;
    }
    return parts.join(', ');
}

function getCableFiberUsage(cable) {
    const total = getCableFiberCount(cable);
    const used = new Set();
    markers.forEach(m => {
        if (m.fusionPlan) getPlanCableFiberUsage(m).get(cable.name)?.forEach(n => used.add(n));
    });
    getOccupiedCableFibers(cable).forEach((_, n) => used.add(n));
    const usedList = Array.from(used).filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
    const freeList = [];
    for (let n = 1; n <= total; n++) if (!used.has(n)) freeList.push(n);
    return { total, used: usedList, free: freeList };
}

function buildCableHoverHtml(cable) {
    const u = getCableFiberUsage(cable);
    return `<strong>${escapeHtml(cable.name || '')}</strong><br>Total: ${cable.totalLength} m`
        + `<br>Fibras em uso: ${u.used.length}/${u.total}${u.used.length ? ` (${formatFiberRanges(u.used)})` : ''}`
        + `<br>Vagas: ${u.free.length}${u.free.length ? ` (${formatFiberRanges(u.free)})` : ''}`;
}
