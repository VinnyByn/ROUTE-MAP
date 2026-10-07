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
    body += buildSignalHoverSection(markerInfo, row);
    return head + `<div class="mh-card__body">${body}</div>`;
}

//Sinal estimado (orçamento óptico): portas de atendimento na CTO, entrada dos splitters e fibras na CEO
function buildSignalHoverSection(markerInfo, row) {
    if (typeof getBoxSignalSummary !== 'function') return '';
    let sig;
    try { sig = getBoxSignalSummary(markerInfo); } catch (e) { return ''; }
    if (!sig) return '';
    if (!sig.reached) return `<section><h5>Sinal</h5><p class="mh-card__note">Sem sinal: a caixa não está ligada a uma PON pelas fusões</p></section>`;
    const val = (dbm) => `<span class="mh-signal is-${classifyOpticalPower(dbm)}">${formatDbm(dbm)}</span>`;
    let html = '';
    if (sig.worstPort != null) {
        html += sig.worstPort === sig.bestPort
            ? row('Nas portas', val(sig.worstPort))
            : row('Pior porta', val(sig.worstPort)) + row('Melhor porta', val(sig.bestPort));
    }
    sig.splitters.filter(sp => sp.input != null).forEach(sp => { html += row(`Entrada ${escapeHtml(sp.label)}`, val(sp.input)); });
    if (!html && sig.bestFiber != null) html += row(`Fibras com sinal (${sig.fibers})`, val(sig.bestFiber));
    return html ? `<section><h5>Sinal estimado</h5>${html}</section>` : '';
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

function buildPopHoverHtml(markerInfo) {
    const icon = getMarkerIconDataUrl(markerInfo.type, markerInfo.color || '#7c3aed');
    const head = `<header class="mh-card__head"><img src="${icon}" alt=""><div><strong>${escapeHtml(markerInfo.name || '')}</strong><span>POP</span></div></header>`;
    const eq = normalizePopEquipment(markerInfo.popEquipment);
    const s = summarizePopEquipment(eq);
    if (!s.olts && !s.dgos && !s.switches) return `${head}<p class="mh-card__empty">Sem equipamentos cadastrados</p>`;
    const row = (label, value, cls = '') => `<div class="mh-row ${cls}"><span>${label}</span><b>${value}</b></div>`;
    let body = '';
    //PONs ligadas no plano do POP
    const planEq = (readFusionPlan(markerInfo)?.equipment || []);
    const ponsInUse = (name) => planEq.filter(e => e.kind === 'olt' && e.name === name).reduce((n, e) => n + e.ports.filter(p => p.side === 'pon' && p.connected).length, 0);
    if (s.olts) body += `<section><h5>OLTs</h5>${eq.olts.map(o => {
        const total = o.cards.reduce((n, c) => n + c.pons, 0);
        return row(escapeHtml(o.name || 'OLT'), `${ponsInUse(o.name)}/${total} PONs em uso`);
    }).join('')}</section>`;
    if (s.dgos) body += `<section><h5>DGOs</h5>${eq.dgos.map(d => row(escapeHtml(d.name || 'DGO'), `${d.ports} portas`)).join('')}</section>`;
    if (s.switches) body += `<section><h5>Switches</h5>${eq.switches.map(w => row(escapeHtml(w.name || 'Switch'), `${w.ports} portas`)).join('')}</section>`;
    return head + `<div class="mh-card__body">${body}</div>`;
}

function showMarkerHoverCard(markerInfo, domEvent) {
    if (!markerInfo || (markerInfo.type !== 'CTO' && markerInfo.type !== 'CEO' && markerInfo.type !== 'POP')) return;
    clearTimeout(markerHoverHideTimer);
    if (!markerHoverCard) {
        markerHoverCard = document.createElement('div');
        markerHoverCard.className = 'mh-card';
        markerHoverCard.setAttribute('role', 'tooltip');
        document.body.appendChild(markerHoverCard);
    }
    markerHoverCard.innerHTML = markerInfo.type === 'POP' ? buildPopHoverHtml(markerInfo) : buildMarkerHoverHtml(markerInfo);
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
    if (cached && cached.plan === plan && cached.cableCount === savedCables.length) return cached.cables;
    const cables = new Map();
    if (plan && !plan.empty) {
        plan.cables.forEach(cable => {
            if (!cable.name) return;
            const key = planCableKey(cable, markerInfo);
            const used = cables.get(key) || new Set();
            cable.fibers.forEach(f => { if (f.number && f.connected) used.add(f.number); });
            cables.set(key, used);
        });
    }
    cableFusionCache.set(markerInfo, { plan, cables, cableCount: savedCables.length });
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

function getDirectCableFiberUse(cable, used) {
    markers.forEach(m => {
        if (m.fusionPlan) getPlanCableFiberUsage(m).get(cableKeyOf(cable))?.forEach(n => used.add(n));
    });
    getOccupiedCableFibers(cable).forEach((_, n) => used.add(n));
}

function getCableFiberUsage(cable) {
    const total = getCableFiberCount(cable);
    const used = new Set();
    getDirectCableFiberUse(cable, used);
    //Reserva técnica no caminho: a fibra em uso de um lado também está em uso no cabo do outro lado
    if (typeof getReservePassThroughs === 'function' && savedCables.includes(cable)) {
        const passes = getReservePassThroughs();
        const seen = new Set([cable]);
        const queue = [cable];
        while (queue.length) {
            const current = queue.shift();
            passes.filter(p => p.cables.includes(current)).forEach(p => p.cables.forEach(other => {
                if (seen.has(other)) return;
                seen.add(other);
                queue.push(other);
                getDirectCableFiberUse(other, used);
            }));
        }
    }
    const usedList = Array.from(used).filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
    const freeList = [];
    for (let n = 1; n <= total; n++) if (!used.has(n)) freeList.push(n);
    return { total, used: usedList, free: freeList };
}

function buildCableHoverHtml(cable) {
    const u = getCableFiberUsage(cable);
    const row = (label, value, cls = '') => `<div class="mh-row ${cls}"><span>${label}</span><b>${value}</b></div>`;
    const color = /^#[0-9a-f]{3,8}$/i.test(cable.color || '') ? cable.color : '#3b82f6';
    const head = `<header class="mh-card__head"><span class="mh-card__cable" style="--cable-color:${color}" aria-hidden="true"></span>`
        + `<div><strong>${escapeHtml(cable.name || '')}</strong><span>${escapeHtml(cable.type || 'Cabo')}</span></div></header>`;
    let body = `<section><h5>Metragem</h5>${row('Lançamento', `${cable.lancamento ?? cable.totalLength} m`)}`
        + `${cable.reserva ? row('Reserva', `${cable.reserva} m`) : ''}${row('Total', `${cable.totalLength} m`, 'is-total')}</section>`;
    body += `<section><h5>Fibras</h5>${row('Em uso', `${u.used.length} / ${u.total}`, 'is-busy')}`
        + `${u.used.length ? `<p class="mh-card__note">${formatFiberRanges(u.used)}</p>` : ''}`
        + `${row('Livres', u.free.length, 'is-free')}${u.free.length ? `<p class="mh-card__note">${formatFiberRanges(u.free)}</p>` : ''}</section>`;
    return head + `<div class="mh-card__body">${body}</div>`;
}

//Cabo: mesmo cartão dos marcadores
function showCableHoverCard(cable, domEvent) {
    clearTimeout(markerHoverHideTimer);
    if (!markerHoverCard) {
        markerHoverCard = document.createElement('div');
        markerHoverCard.className = 'mh-card';
        markerHoverCard.setAttribute('role', 'tooltip');
        document.body.appendChild(markerHoverCard);
    }
    markerHoverCard.innerHTML = buildCableHoverHtml(cable);
    markerHoverCard.classList.add('is-visible');
    positionMarkerHoverCard(domEvent?.clientX ?? markerHoverPointer.x, domEvent?.clientY ?? markerHoverPointer.y);
}
