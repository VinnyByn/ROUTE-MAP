// Plano de fusão: duas colunas (esquerda e direita) com cabos e splitters; as portas ficam voltadas
// para o corredor central, onde passam as linhas. Ligações entre cartões da mesma coluna seguem por
// trilhas no corredor (sem atravessar outros cartões). Linhas na cor da fibra, ligação com dois
// cliques, fusão em sequência e reordenação arrastando os cartões.
// O formato salvo é o mesmo de antes (HTML dos cartões + SVG das linhas), então planos antigos abrem
// normalmente e ganham o visual novo ao serem abertos. Depende de script.js.

const SVG_NS = 'http://www.w3.org/2000/svg';
const FX = { lane: 18, gap: 16, top: 16, cardWidth: 252, channelMin: 240, trackBase: 20, trackMax: 11 };
const FX_TUBE_COLOR_NAMES = ['Verde', 'Amarelo', 'Branco', 'Azul', 'Vermelho', 'Violeta', 'Marrom', 'Rosa', 'Preto', 'Cinza', 'Laranja', 'Água'];

let fusionArmed = null;       //{ port, editingLine } — origem escolhida, aguardando o destino
let fusionTempPath = null;    //Linha que acompanha o mouse
let fusionDirty = false;      //Há alterações não salvas no plano aberto
let fusionDrag = null;        //Cartão sendo arrastado
let fusionSplitterDraft = { type: 'Atendimento', ratio: 8, connector: 'APC', status: 'Novo' };

function getFusionStage() { return document.getElementById('fusionStage'); }
function getFusionSvg() { return document.getElementById('fusion-svg-layer'); }
function markFusionDirty() {
    fusionDirty = true;
    updateFusionSaveState();
}

//Situação do plano no rodapé (alterações não salvas / sem alterações)
function updateFusionSaveState() {
    const state = document.getElementById('fusionSaveState');
    if (!state) return;
    const viewer = AppSession.isViewer;
    state.classList.toggle('is-dirty', fusionDirty && !viewer);
    state.querySelector('.fx-status__text').textContent = viewer
        ? 'Somente visualização'
        : (fusionDirty ? 'Alterações não salvas' : 'Nenhuma alteração pendente');
    document.getElementById('saveFusionPlan')?.classList.toggle('is-dirty', fusionDirty);
}

// ---------------------------------------------------------------
// Utilidades de portas e cores
// ---------------------------------------------------------------

function getFiberNumberFromId(id) {
    const match = String(id || '').match(/-fiber-(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
}

function getFiberColor(fiberNumber) {
    return ABNT_FIBER_COLORS[(fiberNumber - 1) % 12] || '#64748b';
}

function getPortColor(port) {
    if (!port?.classList.contains('fiber-row')) return null;
    return getFiberColor(getFiberNumberFromId(port.id));
}

function isLightColor(hex) {
    return getContrastTextColor(hex) === '#0f172a';
}

function getPortCard(port) {
    return port?.closest('.cable-element, .splitter-element') || null;
}

//Só existem as colunas da esquerda e da direita. Planos antigos com splitter no meio vão para a direita
//(a entrada fica voltada para os cabos que chegam).
function getCardLane(card) {
    if (!card) return 'left';
    const lane = card.dataset.lane;
    if (lane === 'left' || lane === 'right') return lane;
    if (card.classList.contains('cable-element')) {
        const legacyRight = card.style.right && card.style.right !== 'auto';
        return legacyRight || card.dataset.cableRole === 'saida' ? 'right' : 'left';
    }
    return 'right';
}

//Todas as portas saem pela face interna do cartão (voltada para o corredor central)
function getPortExitSide(port) {
    return getCardLane(getPortCard(port)) === 'right' ? 'left' : 'right';
}

//Coluna mais curta: onde entra um splitter novo
function getShorterFusionLane() {
    const heights = { left: 0, right: 0 };
    getFusionCards().forEach(card => { heights[getCardLane(card)] += card.offsetHeight + FX.gap; });
    return heights.left < heights.right ? 'left' : 'right';
}

function getFusionLines() {
    return Array.from(getFusionSvg()?.querySelectorAll('.fusion-line') || []);
}

function findLineForPort(portId, ignoreLine = null) {
    return getFusionLines().find(line => line !== ignoreLine && (line.dataset.startId === portId || line.dataset.endId === portId)) || null;
}

function getOtherPortId(line, portId) {
    return line.dataset.startId === portId ? line.dataset.endId : line.dataset.startId;
}

//Descrição curta de uma porta (ex.: "FO-12-CTO-01 · F3", "SPL 1:8 · P2")
function describeFusionPort(port, { short = false } = {}) {
    if (!port) return 'Desconhecido';
    const card = getPortCard(port);
    if (card?.classList.contains('cable-element')) {
        const n = getFiberNumberFromId(port.id);
        return short ? `${card.dataset.cableName} · F${n}` : `${card.dataset.cableName}, fibra ${n}`;
    }
    if (card?.classList.contains('splitter-element')) {
        const label = getSplitterLabelText(card) || 'Splitter';
        const portLabel = port.querySelector('.splitter-port-number')?.textContent || 'Porta';
        const compactPort = portLabel.replace(/^Porta\s*/i, 'P');
        return short ? `SPL ${label} · ${compactPort}` : `Splitter ${label}, ${portLabel}`;
    }
    return 'Desconhecido';
}

//Portas de atendimento da caixa na ordem em que foram criadas (define "Porta 1, 2…" dos clientes)
function getAtendimentoOutputPorts(root = getFusionStage()) {
    if (!root) return [];
    const splitters = Array.from(root.querySelectorAll('.splitter-element.splitter-atendimento'));
    splitters.sort((a, b) => (parseInt(a.id.split('-').pop(), 10) || 0) - (parseInt(b.id.split('-').pop(), 10) || 0));
    return splitters.flatMap(s => Array.from(s.querySelectorAll('.splitter-outputs .splitter-port-row')));
}

// ---------------------------------------------------------------
// Construção dos cartões
// ---------------------------------------------------------------

function fxButton(className, title, html) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = html;
    return button;
}

function fxIcon(name) {
    return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function buildCardTools(kind) {
    const tools = document.createElement('div');
    tools.className = 'fx-card__tools';
    const up = fxButton(kind === 'cable' ? 'cable-move-up fx-tool' : 'splitter-move-up fx-tool', 'Mover para cima', '▲');
    const down = fxButton(kind === 'cable' ? 'cable-move-down fx-tool' : 'splitter-move-down fx-tool', 'Mover para baixo', '▼');
    const remove = fxButton('delete-component-btn fx-tool fx-tool--danger', kind === 'cable' ? 'Tirar cabo do plano' : 'Excluir splitter', fxIcon('trash'));
    tools.append(up, down, remove);
    return tools;
}

function buildStatusPill(status) {
    const value = String(status || 'Novo');
    const pill = document.createElement('span');
    const modifier = value === 'Existente' ? 'existente' : (value === 'Troca' ? 'troca' : 'novo');
    pill.className = `fx-pill fx-pill--${modifier} cable-status-pill`;
    pill.textContent = value === 'Nova' ? 'Novo' : value;
    return pill;
}

function buildPortRow({ id, className, label, chip, color }) {
    const row = document.createElement('div');
    row.className = `${className} connectable fx-port`;
    row.id = id;
    if (color) row.style.setProperty('--fiber', color);
    row.innerHTML = `<span class="fx-port__chip">${chip ?? ''}</span>`
        + `<span class="${className === 'fiber-row' ? 'fx-port__label' : 'splitter-port-number fx-port__label'}">${label}</span>`
        + '<span class="fx-port__dest fusion-dynamic"></span><span class="fx-port__dot" aria-hidden="true"></span>';
    return row;
}

//Cartão de cabo. fiberIds preserva os ids antigos (as linhas salvas apontam para eles)
function buildFusionCableCard({ name, type, status, role, fiberCount, fiberIds = new Map(), kitChecked = false, otherEnd = '' }) {
    const card = document.createElement('div');
    card.className = `cable-element fx-card fx-cable ${role === 'saida' ? 'cable-saida' : 'cable-entrada'}`;
    card.dataset.cableName = name;
    card.dataset.cableRole = role === 'saida' ? 'saida' : 'entrada';
    card.dataset.cableStatus = status || 'Novo';
    card.dataset.cableType = type || '';
    card.dataset.fiberCount = String(fiberCount);
    card.dataset.lane = role === 'saida' ? 'right' : 'left';
    const cable = savedCables.find(c => c.name === name);
    card.style.setProperty('--cable-color', cable?.color || getCableColor(getFiberType(type)) || '#475569');

    const header = document.createElement('div');
    header.className = 'cable-header fx-card__head';
    const title = document.createElement('span');
    title.className = 'cable-header-name fx-card__title';
    title.textContent = name;
    header.appendChild(title);
    header.appendChild(buildCardTools('cable'));
    const meta = document.createElement('div');
    meta.className = 'fx-card__meta';
    const rolePill = document.createElement('span');
    rolePill.className = `fx-pill fx-pill--role-${card.dataset.cableRole}`;
    rolePill.textContent = card.dataset.cableRole === 'saida' ? 'Saída' : 'Entrada';
    meta.appendChild(rolePill);
    meta.appendChild(buildStatusPill(status));
    const fibersPill = document.createElement('span');
    fibersPill.className = 'fx-pill';
    fibersPill.textContent = `${fiberCount} fibras`;
    meta.appendChild(fibersPill);
    header.appendChild(meta);
    if (otherEnd) {
        const route = document.createElement('span');
        route.className = 'fx-card__route';
        route.textContent = card.dataset.cableRole === 'saida' ? `para ${otherEnd}` : `vem de ${otherEnd}`;
        header.appendChild(route);
    }
    if (activeMarkerForFusion?.type === 'CEO') {
        const kit = document.createElement('label');
        kit.className = 'derivation-kit-container fx-kit';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'derivation-kit-checkbox';
        checkbox.checked = !!kitChecked;
        checkbox.dataset.checked = String(!!kitChecked);
        if (kitChecked) checkbox.setAttribute('checked', '');
        const text = document.createElement('span');
        text.textContent = 'Kit derivação';
        kit.append(checkbox, text);
        header.appendChild(kit);
    }
    card.appendChild(header);

    const fibers = document.createElement('div');
    fibers.className = 'cable-fibers-container fx-fibers';
    const safeName = name.replace(/\s+/g, '-');
    const tubes = Math.ceil(fiberCount / 12);
    for (let t = 0; t < tubes; t++) {
        const tube = document.createElement('div');
        tube.className = 'group-header fx-tube';
        const tubeColor = ABNT_FIBER_COLORS[t % 12];
        tube.style.setProperty('--tube', tubeColor);
        tube.innerHTML = `<span class="fx-tube__dot"></span><span>Tubo ${t + 1} · ${FX_TUBE_COLOR_NAMES[t % 12]}</span><span class="fx-tube__count fusion-dynamic"></span>`;
        fibers.appendChild(tube);
        for (let f = 0; f < 12; f++) {
            const n = t * 12 + f + 1;
            if (n > fiberCount) break;
            fibers.appendChild(buildPortRow({
                id: fiberIds.get(n) || `cable-${safeName}-fiber-${n}`,
                className: 'fiber-row',
                label: `F${n}`,
                color: getFiberColor(n),
            }));
        }
    }
    card.appendChild(fibers);
    return card;
}

function buildFusionSplitterCard({ id, label, outputs, status, type, connector, olt = {}, lane = 'right' }) {
    const card = document.createElement('div');
    const isAtendimento = type === 'Atendimento';
    card.className = `splitter-element fx-card fx-splitter ${isAtendimento ? 'splitter-atendimento' : 'splitter-fusao'}${isAtendimento && connector === 'UPC' ? ' splitter-upc' : ''}`;
    card.id = id;
    card.dataset.status = status || 'Novo';
    card.dataset.lane = lane === 'left' ? 'left' : 'right';
    if (olt.olt) card.dataset.oltName = olt.olt;
    if (olt.placa) card.dataset.placaNumber = olt.placa;
    if (olt.pon) card.dataset.ponNumber = olt.pon;

    const header = document.createElement('div');
    header.className = 'splitter-body fx-card__head';
    const labelRow = document.createElement('div');
    labelRow.className = 'splitter-label-row';
    labelRow.innerHTML = `<span class="fx-card__kind">Splitter</span><span class="splitter-label-text fx-card__title">${escapeHtml(label)}</span>`;
    header.appendChild(labelRow);
    const tools = buildCardTools('splitter');
    tools.insertBefore(fxButton('splitter-move-side fx-tool', 'Trocar de lado', '⇄'), tools.lastChild);
    header.appendChild(tools);
    const meta = document.createElement('div');
    meta.className = 'fx-card__meta';
    const typePill = document.createElement('span');
    typePill.className = `fx-pill fx-pill--${isAtendimento ? 'atendimento' : 'fusao'}`;
    typePill.textContent = isAtendimento ? 'Atendimento' : 'Fusão';
    meta.appendChild(typePill);
    meta.appendChild(buildStatusPill(status));
    header.appendChild(meta);
    //Faixa da OLT: origem do sinal (OLT › placa › PON)
    const oltStrip = document.createElement('div');
    oltStrip.className = 'fx-olt-strip';
    oltStrip.innerHTML = `${fxIcon('olt')}<span class="splitter-olt-info"></span>`;
    oltStrip.appendChild(fxButton('splitter-olt-config-btn fx-olt', 'Vincular OLT, placa e PON', 'Vincular'));
    header.appendChild(oltStrip);
    card.appendChild(header);

    const input = document.createElement('div');
    input.className = 'splitter-input fx-ports';
    input.appendChild(buildPortRow({ id: `${id}-input-port`, className: 'splitter-port-row', label: 'Entrada', chip: 'IN' }));
    card.appendChild(input);
    const outs = document.createElement('div');
    outs.className = 'splitter-outputs fx-ports';
    for (let i = 1; i <= outputs; i++) {
        outs.appendChild(buildPortRow({ id: `${id}-output-${i}`, className: 'splitter-port-row', label: `Porta ${i}`, chip: i }));
    }
    card.appendChild(outs);
    updateSplitterOltDisplay(card);
    return card;
}

//Converte cartões salvos (de qualquer versão) para o formato atual, preservando ids e dados
function upgradeFusionCard(card) {
    if (card.classList.contains('cable-element')) {
        const name = card.dataset.cableName || card.querySelector('.cable-header-name, .cable-header span')?.textContent || 'Cabo';
        const fiberIds = new Map();
        card.querySelectorAll('.fiber-row').forEach(row => {
            const n = getFiberNumberFromId(row.id);
            if (n) fiberIds.set(n, row.id);
        });
        const saved = savedCables.find(c => c.name === name);
        const fiberCount = fiberIds.size || parseInt(card.dataset.fiberCount, 10) || parseInt((getFiberType(saved?.type) || 'FO-12').split('-')[1], 10);
        const role = card.dataset.cableRole || (card.classList.contains('cable-saida') ? 'saida' : 'entrada');
        const kitBox = card.querySelector('.derivation-kit-checkbox');
        const upgraded = buildFusionCableCard({
            name,
            type: saved?.type || card.dataset.cableType || '',
            status: saved?.status || card.dataset.cableStatus || 'Novo',
            role,
            fiberCount,
            fiberIds,
            kitChecked: kitBox ? (kitBox.dataset.checked === 'true' || kitBox.hasAttribute('checked')) : false,
            otherEnd: saved ? getCableOtherEndName(saved, role) : '',
        });
        if (card.dataset.lane) upgraded.dataset.lane = card.dataset.lane;
        else if (card.style.right && card.style.right !== 'auto') upgraded.dataset.lane = 'right';
        else if (card.style.left) upgraded.dataset.lane = 'left';
        return upgraded;
    }
    const label = getSplitterLabelText(card) || '1:8';
    const outputs = card.querySelectorAll('.splitter-outputs .splitter-port-row').length || parseInt((label.match(/1:(\d+)/) || [])[1], 10) || 8;
    const upgraded = buildFusionSplitterCard({
        id: card.id || `splitter-${Date.now()}`,
        label,
        outputs,
        status: card.dataset.status || 'Novo',
        type: card.classList.contains('splitter-atendimento') ? 'Atendimento' : 'Fusão',
        connector: /UPC/.test(label) ? 'UPC' : 'APC',
        olt: { olt: card.dataset.oltName, placa: card.dataset.placaNumber, pon: card.dataset.ponNumber },
        lane: card.dataset.lane === 'left' ? 'left' : 'right',
    });
    return upgraded;
}

function getCableOtherEndName(cable, role) {
    const other = resolveCableEndAnchor(cable, role === 'entrada');
    return other?.name || '';
}

// ---------------------------------------------------------------
// Layout (três colunas) e linhas
// ---------------------------------------------------------------

function getFusionCards() {
    return Array.from(getFusionStage()?.querySelectorAll('.cable-element, .splitter-element') || []);
}

//Duas colunas encostadas nas bordas; o meio é o corredor das linhas
function repackAllElements({ animate = true } = {}) {
    const stage = getFusionStage();
    const canvas = document.getElementById('fusionCanvas');
    if (!stage || !canvas) return;
    const cards = getFusionCards();
    const width = Math.max(canvas.clientWidth, FX.lane * 2 + FX.cardWidth * 2 + FX.channelMin);
    stage.style.width = `${width}px`;
    const laneX = { left: FX.lane, right: width - FX.lane - FX.cardWidth };
    const tops = { left: FX.top, right: FX.top };
    cards.forEach(card => {
        const lane = getCardLane(card);
        card.dataset.lane = lane;
        card.style.transition = animate ? 'top .2s ease, left .2s ease' : '';
        card.style.left = `${laneX[lane]}px`;
        card.style.right = 'auto';
        card.style.top = `${tops[lane]}px`;
        card.classList.toggle('fx-lane-left', lane === 'left');
        card.classList.toggle('fx-lane-right', lane === 'right');
        card.classList.remove('fx-lane-center');
        tops[lane] += card.offsetHeight + FX.gap;
    });
    stage.style.height = `${Math.max(canvas.clientHeight - 2, tops.left, tops.right) + 30}px`;
    stage.style.setProperty('--fx-channel-left', `${laneX.left + FX.cardWidth}px`);
    stage.style.setProperty('--fx-channel-right', `${width - laneX.right}px`);
    updateFusionCanvasInteractionState();
    renderFusionConnections();
    if (animate) setTimeout(renderFusionConnections, 230);
}

function getFusionChannel() {
    const width = getFusionStage().offsetWidth;
    return { left: FX.lane + FX.cardWidth, right: width - FX.lane - FX.cardWidth };
}

//Trajeto em "colchete" pelo corredor: sai da porta, desce/sobe na trilha e volta, com cantos arredondados
function buildFusionTrackPath(start, end, trackX) {
    const dir = trackX >= start.x ? 1 : -1;
    const dy = end.y - start.y;
    const vdir = dy >= 0 ? 1 : -1;
    const r = Math.max(0, Math.min(9, Math.abs(dy) / 2, Math.abs(trackX - start.x) - 1, Math.abs(trackX - end.x) - 1));
    const f = (n) => n.toFixed(1);
    return `M ${f(start.x)} ${f(start.y)} H ${f(trackX - dir * r)} Q ${f(trackX)} ${f(start.y)} ${f(trackX)} ${f(start.y + vdir * r)}`
        + ` V ${f(end.y - vdir * r)} Q ${f(trackX)} ${f(end.y)} ${f(trackX - dir * r)} ${f(end.y)} H ${f(end.x)}`;
}

//Distribui as ligações de uma mesma coluna em trilhas: as mais curtas ficam mais perto dos cartões,
//e duas ligações só dividem a trilha se não se sobrepõem na vertical
function assignFusionTracks(routes) {
    const tracks = [];
    routes
        .slice()
        .sort((a, b) => (a.bottom - a.top) - (b.bottom - b.top) || a.top - b.top)
        .forEach(route => {
            let k = 0;
            while (tracks[k] && tracks[k].some(o => route.top < o.bottom + 6 && o.top < route.bottom + 6)) k++;
            (tracks[k] = tracks[k] || []).push(route);
            route.track = k;
        });
    return tracks.length;
}

//Calcula o "d" de cada linha: entre colunas, curva suave; na mesma coluna, trilha pelo corredor
function computeFusionRoutes(lines) {
    const channel = getFusionChannel();
    const half = Math.max(40, (channel.right - channel.left) / 2);
    const groups = { right: [], left: [] };
    const routes = new Map();
    lines.forEach(({ line, start, end }) => {
        if (start.side !== end.side) {
            routes.set(line, buildFusionCurve(start, end));
            return;
        }
        groups[start.side].push({ line, start, end, top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y) });
    });
    Object.entries(groups).forEach(([side, items]) => {
        if (!items.length) return;
        const count = assignFusionTracks(items);
        const spacing = Math.max(3, Math.min(FX.trackMax, (half - FX.trackBase - 14) / Math.max(1, count - 1)));
        items.forEach(item => {
            const offset = FX.trackBase + item.track * spacing;
            const trackX = side === 'right' ? channel.left + offset : channel.right - offset;
            routes.set(item.line, buildFusionTrackPath(item.start, item.end, trackX));
        });
    });
    return routes;
}

function getElementCenter(port) {
    const stage = getFusionStage();
    const rect = port.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const side = getPortExitSide(port);
    const dot = port.querySelector('.fx-port__dot');
    const dotRect = dot ? dot.getBoundingClientRect() : null;
    const x = dotRect && dotRect.width ? dotRect.left + dotRect.width / 2 : (side === 'left' ? rect.left : rect.right);
    //Medidas da tela vêm com a escala da animação de abertura da janela: converte para o tamanho real
    const scaleX = stage.offsetWidth ? stageRect.width / stage.offsetWidth : 1;
    const scaleY = stage.offsetHeight ? stageRect.height / stage.offsetHeight : 1;
    return { x: (x - stageRect.left) / (scaleX || 1), y: (rect.top + rect.height / 2 - stageRect.top) / (scaleY || 1), side };
}

function buildFusionCurve(start, end) {
    const dirStart = start.side === 'left' ? -1 : 1;
    const dirEnd = end.side === 'left' ? -1 : 1;
    const sameSide = dirStart === dirEnd;
    const span = Math.abs(end.x - start.x);
    const bend = sameSide ? 46 + Math.min(120, Math.abs(end.y - start.y) * 0.18) : Math.max(40, span * 0.42);
    const c1x = start.x + dirStart * bend;
    const c2x = end.x + dirEnd * bend;
    return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1x.toFixed(1)} ${start.y.toFixed(1)}, ${c2x.toFixed(1)} ${end.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

function ensureFusionSvgDefs() {
    const svg = getFusionSvg();
    if (!svg) return;
    svg.querySelectorAll('defs').forEach(d => d.remove());
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = '<filter id="fx-outline" filterUnits="userSpaceOnUse" x="-10000" y="-10000" width="40000" height="40000">'
        + '<feMorphology in="SourceAlpha" operator="dilate" radius="1.1" result="grow"/>'
        + '<feFlood flood-color="#0f172a" flood-opacity="0.55"/>'
        + '<feComposite in2="grow" operator="in" result="edge"/>'
        + '<feMerge><feMergeNode in="edge"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
    svg.insertBefore(defs, svg.firstChild);
}

//Redesenha as linhas, as áreas de clique e as etiquetas "→ destino" das portas
function renderFusionConnections() {
    const svg = getFusionSvg();
    const stage = getFusionStage();
    if (!svg || !stage) return;
    svg.setAttribute('width', stage.offsetWidth);
    svg.setAttribute('height', stage.offsetHeight);
    svg.querySelectorAll('.fx-line-hit').forEach(h => h.remove());
    stage.querySelectorAll('.fx-port__dest').forEach(d => { d.textContent = ''; d.title = ''; });
    //Marca as portas ligadas antes de medir (no modo "só fibras em uso" as livres ficam escondidas)
    const visible = [];
    const connected = new Set();
    getFusionLines().forEach(line => {
        const startEl = document.getElementById(line.dataset.startId);
        const endEl = document.getElementById(line.dataset.endId);
        if (!startEl || !endEl || !stage.contains(startEl) || !stage.contains(endEl)) {
            line.style.display = 'none';
            return;
        }
        connected.add(startEl);
        connected.add(endEl);
        visible.push({ line, startEl, endEl });
    });
    stage.querySelectorAll('.fx-port').forEach(p => p.classList.toggle('is-connected', connected.has(p)));
    //Com "só fibras em uso", ligar/desligar muda a altura dos cartões: reorganiza as colunas
    if (stage.classList.contains('fx-hide-free')) {
        const signature = Array.from(connected).map(p => p.id).sort().join('|');
        if (signature !== renderFusionConnections.hideFreeSignature) {
            renderFusionConnections.hideFreeSignature = signature;
            requestAnimationFrame(() => repackAllElements({ animate: false }));
        }
    }
    visible.forEach(item => {
        item.start = getElementCenter(item.startEl);
        item.end = getElementCenter(item.endEl);
    });
    const routes = computeFusionRoutes(visible);
    visible.forEach(({ line, startEl, endEl }) => {
        line.style.display = '';
        line.classList.remove('fusion-line-editing');
        const color = getPortColor(startEl) || getPortColor(endEl) || '#64748b';
        line.style.setProperty('--line-color', color);
        line.classList.toggle('fx-line--light', isLightColor(color));
        line.setAttribute('d', routes.get(line));
        line.dataset.points = '[]';
        const hit = document.createElementNS(SVG_NS, 'path');
        hit.setAttribute('class', 'fx-line-hit');
        hit.setAttribute('d', line.getAttribute('d'));
        hit.dataset.lineId = line.id;
        line.after(hit);
        [startEl, endEl].forEach((port, i) => {
            const other = i === 0 ? endEl : startEl;
            const dest = port.querySelector('.fx-port__dest');
            if (dest) {
                dest.textContent = `→ ${describeFusionPort(other, { short: true })}`;
                dest.title = describeFusionPort(other);
            }
        });
    });
    decorateAtendimentoPorts();
    updateTubeCounters();
    updateFusionSummary();
}

//Número de porta da CTO e cliente ligado em cada saída dos splitters de atendimento
function decorateAtendimentoPorts() {
    const ports = getAtendimentoOutputPorts();
    const occupied = (activeMarkerForFusion?.type === 'CTO' && typeof getOccupiedPorts === 'function')
        ? getOccupiedPorts(activeMarkerForFusion) : new Map();
    ports.forEach((port, index) => {
        const number = index + 1;
        port.dataset.ctoPort = String(number);
        const chip = port.querySelector('.fx-port__chip');
        if (chip) chip.textContent = number;
        const client = occupied.get(number);
        port.classList.toggle('has-client', !!client);
        if (client && !port.classList.contains('is-connected')) {
            const dest = port.querySelector('.fx-port__dest');
            if (dest) {
                dest.textContent = client.name;
                dest.title = `Cliente na porta ${number}: ${client.name}`;
            }
        }
    });
}

function updateTubeCounters() {
    getFusionStage()?.querySelectorAll('.fx-tube').forEach(tube => {
        let used = 0;
        let total = 0;
        let row = tube.nextElementSibling;
        while (row && row.classList.contains('fiber-row')) {
            total++;
            if (row.classList.contains('is-connected')) used++;
            row = row.nextElementSibling;
        }
        const counter = tube.querySelector('.fx-tube__count');
        if (counter) counter.textContent = used ? `${used}/${total}` : '';
        tube.classList.toggle('has-used', used > 0);
    });
}

function updateAllConnections() { renderFusionConnections(); }
function updateSvgLayerSize() { renderFusionConnections(); }

function fusionCanvasHasComponents() {
    return getFusionCards().length > 0;
}

function updateFusionCanvasInteractionState() {
    const canvas = document.getElementById('fusionCanvas');
    if (!canvas) return;
    const empty = !fusionCanvasHasComponents();
    canvas.classList.toggle('fusion-canvas-empty', empty);
    document.getElementById('fusionEmptyState')?.classList.toggle('hidden', !empty);
    if (empty) cancelFusionArm();
}

// ---------------------------------------------------------------
// Ligações (clique na origem → clique no destino)
// ---------------------------------------------------------------

function setFusionHint(html) {
    const hint = document.getElementById('fusionFooterHint');
    if (hint) hint.innerHTML = html;
}

function resetFusionHint() {
    setFusionHint(AppSession.canEdit
        ? 'Clique em uma fibra ou porta para começar uma fusão. Clique numa linha para refazer ou desfazer.'
        : 'Somente visualização: clique em uma porta ligada para ver o destino da fusão.');
}

function armFusionPort(port, editingLine = null) {
    cancelFusionArm();
    fusionArmed = { port, editingLine };
    port.classList.add('connection-source');
    const stage = getFusionStage();
    stage.classList.add('is-armed');
    stage.querySelectorAll('.fx-port').forEach(p => {
        const busy = !!findLineForPort(p.id, editingLine);
        p.classList.toggle('fx-target', p !== port && !busy);
        p.classList.toggle('fx-busy', p !== port && busy);
    });
    if (editingLine) editingLine.classList.add('fusion-line-editing');
    fusionTempPath = document.createElementNS(SVG_NS, 'path');
    fusionTempPath.setAttribute('class', 'connecting-line');
    const color = getPortColor(port) || '#0f766e';
    fusionTempPath.style.setProperty('--line-color', color);
    getFusionSvg().appendChild(fusionTempPath);
    setFusionHint(`<strong>${escapeHtml(describeFusionPort(port))}</strong> → clique no destino. <kbd>Esc</kbd> ou clique direito cancela.`);
}

function cancelFusionArm() {
    if (!fusionArmed) return false;
    fusionArmed.port?.classList.remove('connection-source');
    fusionArmed.editingLine?.classList.remove('fusion-line-editing');
    const stage = getFusionStage();
    stage?.classList.remove('is-armed');
    stage?.querySelectorAll('.fx-target, .fx-busy').forEach(p => p.classList.remove('fx-target', 'fx-busy'));
    fusionTempPath?.remove();
    fusionTempPath = null;
    fusionArmed = null;
    resetFusionHint();
    return true;
}

function resetFusionDrawingState() { cancelFusionArm(); }

function createFusionLine(startPort, endPort) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'fusion-line');
    path.id = `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    path.dataset.startId = startPort.id;
    path.dataset.endId = endPort.id;
    path.dataset.points = '[]';
    getFusionSvg().appendChild(path);
    markFusionDirty();
    return path;
}

function removeFusionLine(line) {
    if (!line) return;
    line.remove();
    markFusionDirty();
    renderFusionConnections();
}

function completeFusionConnection(target) {
    const { port: source, editingLine } = fusionArmed;
    if (target === source) {
        cancelFusionArm();
        return;
    }
    if (findLineForPort(target.id, editingLine)) {
        showToast('Porta ocupada', `${describeFusionPort(target)} já tem uma fusão.`, 'progress');
        return;
    }
    if (editingLine) editingLine.remove();
    cancelFusionArm();
    const line = createFusionLine(source, target);
    renderFusionConnections();
    line.classList.add('fusion-line-new');
    setTimeout(() => line.classList.remove('fusion-line-new'), 700);
}

function handleConnectionClick(event) {
    if (fusionDrag?.moved) return;
    if (!AppSession.canEdit) {
        //Visualização: só mostra para onde a porta está ligada
        const port = event.target.closest('.connectable');
        const line = port && findLineForPort(port.id);
        if (line) showToast('Fusão', `${describeFusionPort(document.getElementById(line.dataset.startId))} → ${describeFusionPort(document.getElementById(line.dataset.endId))}`, 'progress');
        return;
    }
    const target = event.target;
    if (target.closest('button, input, label, select')) return;
    const hit = target.closest('.fx-line-hit, .fusion-line');
    if (hit && !fusionArmed) {
        const line = hit.classList.contains('fusion-line') ? hit : document.getElementById(hit.dataset.lineId);
        if (line) openFusionLineActionModal(line);
        return;
    }
    const port = target.closest('.connectable');
    if (!port) {
        cancelFusionArm();
        return;
    }
    if (fusionArmed) {
        completeFusionConnection(port);
        return;
    }
    const existing = findLineForPort(port.id);
    if (existing) {
        openFusionLineActionModal(existing);
        return;
    }
    armFusionPort(port);
}

function handleFusionCanvasMouseMove(event) {
    if (fusionArmed && fusionTempPath) {
        const stageRect = getFusionStage().getBoundingClientRect();
        const start = getElementCenter(fusionArmed.port);
        const mouse = { x: event.clientX - stageRect.left, y: event.clientY - stageRect.top };
        mouse.side = mouse.x < start.x ? 'right' : 'left';
        fusionTempPath.setAttribute('d', buildFusionCurve(start, mouse));
    }
    //Destaca as duas pontas da linha sob o mouse
    const hit = event.target.closest?.('.fx-line-hit');
    const lineId = hit?.dataset.lineId || null;
    if (lineId !== (handleFusionCanvasMouseMove.lastLineId || null)) {
        getFusionStage().querySelectorAll('.port-highlighted').forEach(p => p.classList.remove('port-highlighted'));
        getFusionSvg().querySelectorAll('.fx-line-hover').forEach(l => l.classList.remove('fx-line-hover'));
        handleFusionCanvasMouseMove.lastLineId = lineId;
        const line = lineId ? document.getElementById(lineId) : null;
        if (line) {
            line.classList.add('fx-line-hover');
            document.getElementById(line.dataset.startId)?.classList.add('port-highlighted');
            document.getElementById(line.dataset.endId)?.classList.add('port-highlighted');
        }
    }
}

function handleFusionCanvasRightClick(event) {
    event.preventDefault();
    cancelFusionArm();
}

function startLineEdit(lineElement) {
    const startPort = document.getElementById(lineElement?.dataset.startId);
    if (!startPort) return;
    armFusionPort(startPort, lineElement);
}

function openFusionLineActionModal(line) {
    if (!line) return;
    const info = document.getElementById('lineConnectionInfo');
    if (info) {
        const end = (port, label) => {
            const card = getPortCard(port);
            let title = 'Desconhecido', detail = '';
            if (card?.classList.contains('cable-element')) {
                title = card.dataset.cableName || 'Cabo';
                detail = `Fibra ${getFiberNumberFromId(port.id)}`;
            } else if (card?.classList.contains('splitter-element')) {
                title = `Splitter ${getSplitterLabelText(card) || ''}`.trim();
                detail = port.querySelector('.splitter-port-number')?.textContent || 'Porta';
            }
            const color = getPortColor(port) || '#64748b';
            return `<div class="fx-line-end"><span class="fx-line-end__label">${label}</span>`
                + `<div class="fx-line-end__body"><span class="fx-line-end__dot" style="background:${color}"></span>`
                + `<div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div></div></div>`;
        };
        info.innerHTML = end(document.getElementById(line.dataset.startId), 'Origem')
            + `<div class="fx-line-arrow" aria-hidden="true">↓</div>`
            + end(document.getElementById(line.dataset.endId), 'Destino');
    }
    activeLineForAction = line;
    document.getElementById('lineActionModal').style.display = 'flex';
}

function getConnectionDescription(portId) {
    return describeFusionPort(document.getElementById(portId));
}

// ---------------------------------------------------------------
// Fusão em sequência
// ---------------------------------------------------------------

//Grupos de portas para a fusão em sequência: fibras de cada cabo, saídas de cada splitter e entradas dos splitters
function getFusionPortGroups() {
    const groups = [];
    getFusionCards().forEach(card => {
        if (card.classList.contains('cable-element')) {
            groups.push({ key: `cable:${card.dataset.cableName}`, label: `${card.dataset.cableName} (fibras)`, ports: Array.from(card.querySelectorAll('.fiber-row')) });
        } else {
            groups.push({ key: `spl:${card.id}`, label: `Splitter ${getSplitterLabelText(card)} (saídas)`, ports: Array.from(card.querySelectorAll('.splitter-outputs .splitter-port-row')) });
        }
    });
    const inputs = Array.from(getFusionStage()?.querySelectorAll('.splitter-input .splitter-port-row') || []);
    if (inputs.length > 1) groups.push({ key: 'inputs', label: 'Entradas dos splitters', ports: inputs });
    return groups;
}

function populateFusionSequenceSelects() {
    const groups = getFusionPortGroups();
    ['fxSeqFrom', 'fxSeqTo'].forEach((id, index) => {
        const select = document.getElementById(id);
        if (!select) return;
        const previous = select.value;
        select.innerHTML = groups.map(g => `<option value="${escapeHtml(g.key)}">${escapeHtml(g.label)}</option>`).join('');
        if (groups.some(g => g.key === previous)) select.value = previous;
        else if (groups[index]) select.value = groups[index].key;
    });
    const section = document.getElementById('fusionSequenceSection');
    section?.classList.toggle('is-disabled', groups.length < 1);
}

function runFusionSequence() {
    const groups = getFusionPortGroups();
    const from = groups.find(g => g.key === document.getElementById('fxSeqFrom').value);
    const to = groups.find(g => g.key === document.getElementById('fxSeqTo').value);
    if (!from || !to) {
        showToast('Escolha origem e destino', 'Adicione cabos ou splitters ao plano primeiro.', 'progress');
        return;
    }
    const fromStart = Math.max(1, parseInt(document.getElementById('fxSeqFromStart').value, 10) || 1);
    const toStart = Math.max(1, parseInt(document.getElementById('fxSeqToStart').value, 10) || 1);
    const count = Math.max(1, parseInt(document.getElementById('fxSeqCount').value, 10) || 1);
    let created = 0;
    let skipped = 0;
    for (let i = 0; i < count; i++) {
        const a = from.ports[fromStart - 1 + i];
        const b = to.ports[toStart - 1 + i];
        if (!a || !b) break;
        if (a === b || findLineForPort(a.id) || findLineForPort(b.id)) {
            skipped++;
            continue;
        }
        createFusionLine(a, b);
        created++;
    }
    renderFusionConnections();
    showToast(created ? 'Fusões criadas' : 'Nenhuma fusão criada',
        `${created} fusão(ões) em sequência${skipped ? ` · ${skipped} ignorada(s) por porta ocupada` : ''}.`, created ? 'success' : 'progress');
}

// ---------------------------------------------------------------
// Barra lateral: cabos, splitters e resumo
// ---------------------------------------------------------------

function getCablesConnectedToFusionMarker() {
    if (!activeMarkerForFusion) return [];
    return savedCables.filter(cable => cable.name && cable.path?.length && isCableConnectedToMarker(cable, activeMarkerForFusion));
}

function isCableInFusionPlan(cableName) {
    return getFusionCards().some(card => card.classList.contains('cable-element') && card.dataset.cableName === cableName);
}

function addCableToFusionPlan(cable, { render = true } = {}) {
    if (!cable || isCableInFusionPlan(cable.name)) return null;
    const role = getCableRoleAtMarker(cable, activeMarkerForFusion.marker.getPosition(), activeMarkerForFusion);
    const fiberType = getFiberType(cable.type);
    const card = buildFusionCableCard({
        name: cable.name,
        type: cable.type,
        status: cable.status,
        role,
        fiberCount: fiberType ? parseInt(fiberType.split('-')[1], 10) : 12,
        otherEnd: getCableOtherEndName(cable, role),
    });
    getFusionStage().appendChild(card);
    wireFusionCard(card);
    markFusionDirty();
    if (render) {
        repackAllElements();
        renderFusionSidebar();
    }
    return card;
}

function addAllCablesToFusionPlan() {
    const available = getCablesConnectedToFusionMarker().filter(c => !isCableInFusionPlan(c.name));
    if (!available.length) {
        showToast('Nada a adicionar', 'Todos os cabos desta caixa já estão no plano.', 'progress');
        return 0;
    }
    available.forEach(cable => addCableToFusionPlan(cable, { render: false }));
    repackAllElements();
    renderFusionSidebar();
    return available.length;
}

function renderFusionCableList() {
    const list = document.getElementById('fusionCableList');
    if (!list) return;
    const cables = getCablesConnectedToFusionMarker();
    list.innerHTML = '';
    if (!cables.length) {
        list.innerHTML = '<li class="fx-empty-note">Nenhum cabo chega nesta caixa. Desenhe um cabo ancorado nela para adicioná-lo aqui.</li>';
    }
    cables.forEach(cable => {
        const inPlan = isCableInFusionPlan(cable.name);
        const role = getCableRoleAtMarker(cable, activeMarkerForFusion.marker.getPosition(), activeMarkerForFusion);
        const other = getCableOtherEndName(cable, role);
        const li = document.createElement('li');
        li.className = `fx-cable-item${inPlan ? ' is-in-plan' : ''}`;
        li.style.setProperty('--cable-color', cable.color || getCableColor(getFiberType(cable.type)));
        li.innerHTML = `
            <span class="fx-cable-item__bar"></span>
            <span class="fx-cable-item__text">
                <strong>${escapeHtml(cable.name)}</strong>
                <small>${role === 'saida' ? 'Saída' : 'Entrada'} · ${escapeHtml(getFiberType(cable.type) || '')}${other ? ` · ${role === 'saida' ? 'para' : 'de'} ${escapeHtml(other)}` : ''}</small>
            </span>`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = inPlan ? 'fx-cable-item__action is-done' : 'fx-cable-item__action';
        button.textContent = inPlan ? 'Ver' : 'Adicionar';
        button.addEventListener('click', () => {
            if (isCableInFusionPlan(cable.name)) {
                const card = getFusionCards().find(c => c.dataset.cableName === cable.name);
                card?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                card?.classList.add('fx-flash');
                setTimeout(() => card?.classList.remove('fx-flash'), 1200);
                return;
            }
            addCableToFusionPlan(cable);
        });
        li.appendChild(button);
        list.appendChild(li);
    });
    const addAll = document.getElementById('addAllCablesButton');
    if (addAll) addAll.disabled = !cables.some(c => !isCableInFusionPlan(c.name));
}

function renderSplitterDraft() {
    const { type, ratio, connector, status } = fusionSplitterDraft;
    document.querySelectorAll('#fxSplitterType button').forEach(b => b.classList.toggle('is-active', b.dataset.value === type));
    document.querySelectorAll('#fxSplitterRatio button').forEach(b => b.classList.toggle('is-active', Number(b.dataset.value) === ratio));
    document.querySelectorAll('#fxSplitterConnector button').forEach(b => b.classList.toggle('is-active', b.dataset.value === connector));
    document.querySelectorAll('#fxSplitterStatus button').forEach(b => b.classList.toggle('is-active', b.dataset.value === status));
    document.getElementById('fxSplitterConnectorField')?.classList.toggle('hidden', type !== 'Atendimento');
    const button = document.getElementById('addSplitterToFusion');
    if (button) button.textContent = `Adicionar splitter 1:${ratio}${type === 'Atendimento' ? ` ${connector}` : ''}`;
}

function addSplitterFromDraft() {
    if (!activeMarkerForFusion) return;
    const { type, ratio, connector, status } = fusionSplitterDraft;
    const label = `1:${ratio}${type === 'Atendimento' ? ` ${connector}` : ''}`;
    const id = `splitter-${label.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now()}`;
    const card = buildFusionSplitterCard({ id, label, outputs: ratio, status, type, connector, lane: getShorterFusionLane() });
    getFusionStage().appendChild(card);
    wireFusionCard(card);
    markFusionDirty();
    repackAllElements();
    renderFusionSidebar();
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    card.classList.add('fx-flash');
    setTimeout(() => card.classList.remove('fx-flash'), 1200);
}

function updateFusionSummary() {
    const box = document.getElementById('fusionSummary');
    if (!box || !activeMarkerForFusion) return;
    const lines = getFusionLines().filter(l => l.style.display !== 'none');
    const cards = getFusionCards();
    const cables = cards.filter(c => c.classList.contains('cable-element'));
    const splitters = cards.filter(c => c.classList.contains('splitter-element'));
    const fibers = cables.reduce((sum, c) => sum + c.querySelectorAll('.fiber-row').length, 0);
    const usedFibers = cables.reduce((sum, c) => sum + c.querySelectorAll('.fiber-row.is-connected').length, 0);
    const atendimento = getAtendimentoOutputPorts();
    const rows = [
        ['Fusões', lines.length, `${lines.length} tubete${lines.length === 1 ? '' : 's'}`],
        ['Fibras em uso', `${usedFibers}/${fibers}`, `${cables.length} cabo${cables.length === 1 ? '' : 's'}`],
        ['Splitters', splitters.length, splitters.map(s => getSplitterLabelText(s)).join(', ') || '—'],
    ];
    if (atendimento.length) {
        const withClient = atendimento.filter(p => p.classList.contains('has-client')).length;
        rows.push(['Portas de atendimento', `${withClient}/${atendimento.length}`, 'com cliente']);
    }
    box.innerHTML = rows.map(([label, value, hint]) => `<div><dt>${label}</dt><dd>${value}</dd><small>${escapeHtml(String(hint))}</small></div>`).join('');
}

function renderFusionSidebar() {
    renderFusionCableList();
    populateFusionSequenceSelects();
    updateFusionSummary();
}

// ---------------------------------------------------------------
// Ações dos cartões (mover, remover, arrastar, kit, OLT)
// ---------------------------------------------------------------

function moveFusionElementVertical(card, direction) {
    const lane = getCardLane(card);
    const column = getFusionCards().filter(c => getCardLane(c) === lane);
    const index = column.indexOf(card);
    const neighbor = column[direction === 'up' ? index - 1 : index + 1];
    if (!neighbor) return;
    if (direction === 'up') neighbor.before(card); else neighbor.after(card);
    markFusionDirty();
    repackAllElements();
}

function cycleSplitterLane(card) {
    card.dataset.lane = getCardLane(card) === 'left' ? 'right' : 'left';
    markFusionDirty();
    repackAllElements();
}

function removeFusionCard(card) {
    const portIds = Array.from(card.querySelectorAll('.connectable')).map(p => p.id);
    const lines = getFusionLines().filter(l => portIds.includes(l.dataset.startId) || portIds.includes(l.dataset.endId));
    const isCable = card.classList.contains('cable-element');
    const name = isCable ? card.dataset.cableName : `splitter ${getSplitterLabelText(card)}`;
    const doRemove = () => {
        lines.forEach(l => l.remove());
        card.remove();
        markFusionDirty();
        repackAllElements();
        renderFusionSidebar();
    };
    if (!lines.length) {
        doRemove();
        return;
    }
    showConfirm(isCable ? 'Tirar cabo do plano' : 'Excluir splitter',
        `"${name}" tem ${lines.length} fusão(ões). Elas também serão desfeitas. Continuar?`, doRemove);
}

function handleDeleteSplitter(button) { removeFusionCard(button.closest('.splitter-element')); }
function handleDeleteCableFromFusion(button) { removeFusionCard(button.closest('.cable-element')); }

function wireFusionCard(card) {
    card.querySelector('.cable-move-up, .splitter-move-up')?.addEventListener('click', (e) => { e.stopPropagation(); moveFusionElementVertical(card, 'up'); });
    card.querySelector('.cable-move-down, .splitter-move-down')?.addEventListener('click', (e) => { e.stopPropagation(); moveFusionElementVertical(card, 'down'); });
    card.querySelector('.splitter-move-side')?.addEventListener('click', (e) => { e.stopPropagation(); cycleSplitterLane(card); });
    card.querySelector('.delete-component-btn')?.addEventListener('click', (e) => { e.stopPropagation(); removeFusionCard(card); });
    const kit = card.querySelector('.derivation-kit-checkbox');
    kit?.addEventListener('change', () => {
        kit.dataset.checked = String(kit.checked);
        if (kit.checked) kit.setAttribute('checked', ''); else kit.removeAttribute('checked');
        markFusionDirty();
    });
    wireSplitterOltConfigButton(card);
    card.querySelector('.fx-card__head')?.addEventListener('pointerdown', (e) => startFusionCardDrag(e, card));
}

function startFusionCardDrag(event, card) {
    if (!AppSession.canEdit || event.button !== 0 || event.target.closest('button, input, label, select')) return;
    const stageRect = getFusionStage().getBoundingClientRect();
    fusionDrag = { card, startX: event.clientX, startY: event.clientY, stageRect, moved: false, pointerId: event.pointerId };
    card.setPointerCapture?.(event.pointerId);
    const onMove = (e) => {
        const dx = e.clientX - fusionDrag.startX;
        const dy = e.clientY - fusionDrag.startY;
        if (!fusionDrag.moved && Math.hypot(dx, dy) < 5) return;
        if (!fusionDrag.moved) {
            fusionDrag.moved = true;
            cancelFusionArm();
            card.classList.add('is-dragging');
            card.style.transition = 'none';
        }
        card.style.transform = `translate(${dx}px, ${dy}px)`;
        renderFusionConnections();
    };
    const onUp = (e) => {
        card.removeEventListener('pointermove', onMove);
        card.removeEventListener('pointerup', onUp);
        card.removeEventListener('pointercancel', onUp);
        const state = fusionDrag;
        if (state?.moved) {
            const rect = card.getBoundingClientRect();
            const stage = getFusionStage();
            const stageRect = stage.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2 - stageRect.left;
            const centerY = rect.top + rect.height / 2;
            const lane = centerX < stage.offsetWidth / 2 ? 'left' : 'right';
            card.dataset.lane = lane;
            card.style.transform = '';
            card.classList.remove('is-dragging');
            const column = getFusionCards().filter(c => c !== card && getCardLane(c) === lane);
            const before = column.find(c => {
                const r = c.getBoundingClientRect();
                return centerY < r.top + r.height / 2;
            });
            if (before) before.before(card);
            else if (column.length) column[column.length - 1].after(card);
            markFusionDirty();
            repackAllElements();
        }
        setTimeout(() => { fusionDrag = null; }, 0);
    };
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerup', onUp);
    card.addEventListener('pointercancel', onUp);
}

function formatOltPath({ olt, placa, pon }) {
    return [olt, placa ? `Placa ${placa}` : '', pon ? `PON ${pon}` : ''].filter(Boolean).join(' › ');
}

function updateSplitterOltDisplay(splitterElement) {
    if (!splitterElement) return;
    const info = splitterElement.querySelector('.splitter-olt-info');
    const button = splitterElement.querySelector('.splitter-olt-config-btn');
    const values = getSplitterOltValues(splitterElement);
    const hasConfig = !!(values.olt || values.placa || values.pon);
    if (info) {
        info.textContent = hasConfig ? formatOltPath(values) : 'Sem OLT vinculada';
        info.title = hasConfig ? formatSplitterOltSummary(values.olt, values.placa, values.pon) : '';
        info.classList.remove('hidden');
    }
    if (button) {
        button.textContent = hasConfig ? 'Editar' : 'Vincular';
        button.classList.toggle('is-configured', hasConfig);
        button.title = hasConfig ? `Editar origem: ${formatOltPath(values)}` : 'Vincular OLT, placa e PON';
    }
    splitterElement.querySelector('.fx-olt-strip')?.classList.toggle('is-configured', hasConfig);
    splitterElement.classList.toggle('splitter-has-olt-config', hasConfig);
}

function wireSplitterOltConfigButton(splitterElement) {
    const button = splitterElement?.querySelector('.splitter-olt-config-btn');
    if (!button) return;
    button.onclick = (event) => {
        event.stopPropagation();
        openSplitterOltConfigModal(splitterElement);
    };
    updateSplitterOltDisplay(splitterElement);
}

//Splitters com OLT em todas as caixas do projeto (plano aberto + planos salvos)
function collectProjectOltUsage() {
    const usage = [];
    const push = (card, boxName) => {
        const values = { olt: card.dataset.oltName || '', placa: card.dataset.placaNumber || '', pon: card.dataset.ponNumber || '' };
        if (values.olt || values.pon) usage.push({ ...values, box: boxName, label: getSplitterLabelText(card), id: card.id });
    };
    const folderIds = activeMarkerForFusion ? (getProjectFolderIdsForItem(activeMarkerForFusion.folderId) || []) : [];
    markers.forEach(markerInfo => {
        if (markerInfo === activeMarkerForFusion || !markerInfo.fusionPlan || !folderIds.includes(markerInfo.folderId)) return;
        try {
            const temp = document.createElement('div');
            temp.innerHTML = JSON.parse(markerInfo.fusionPlan).elements || '';
            temp.querySelectorAll('.splitter-element').forEach(card => push(card, markerInfo.name));
        } catch (e) { /* plano ilegível: ignora */ }
    });
    getFusionCards().filter(c => c.classList.contains('splitter-element')).forEach(card => push(card, activeMarkerForFusion?.name || 'esta caixa'));
    return usage;
}

function openSplitterOltConfigModal(splitterElement) {
    if (!splitterElement || !AppSession.canEdit) return;
    activeSplitterForOltConfig = splitterElement;
    const pop = document.getElementById('fusionOltPopover');
    const values = getSplitterOltValues(splitterElement);
    document.getElementById('oltPopSubtitle').textContent = `Splitter ${getSplitterLabelText(splitterElement)} · ${activeMarkerForFusion?.name || ''}`;
    document.getElementById('splitterConfigOlt').value = values.olt;
    document.getElementById('splitterConfigPlaca').value = values.placa;
    document.getElementById('splitterConfigPon').value = values.pon;
    const names = [...new Set(collectProjectOltUsage().map(u => u.olt).filter(Boolean))].sort();
    document.getElementById('oltNameOptions').innerHTML = names.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
    document.getElementById('removeSplitterOlt').classList.toggle('hidden', !(values.olt || values.placa || values.pon));
    updateOltPopoverPreview();
    pop.classList.remove('hidden');
    //Ao lado do cartão, dentro da janela do plano
    const anchor = splitterElement.querySelector('.fx-olt-strip') || splitterElement;
    const a = anchor.getBoundingClientRect();
    const box = pop.getBoundingClientRect();
    const lane = getCardLane(splitterElement);
    let left = lane === 'left' ? a.right + 12 : a.left - box.width - 12;
    left = Math.min(Math.max(12, left), window.innerWidth - box.width - 12);
    const top = Math.min(Math.max(12, a.top - 20), window.innerHeight - box.height - 12);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    splitterElement.classList.add('is-editing-olt');
    setTimeout(() => document.getElementById('splitterConfigOlt').focus(), 30);
}

function closeOltPopover() {
    document.getElementById('fusionOltPopover')?.classList.add('hidden');
    activeSplitterForOltConfig?.classList.remove('is-editing-olt');
    activeSplitterForOltConfig = null;
}

function readOltPopoverValues() {
    return {
        olt: document.getElementById('splitterConfigOlt').value.trim(),
        placa: document.getElementById('splitterConfigPlaca').value.trim(),
        pon: document.getElementById('splitterConfigPon').value.trim(),
    };
}

function updateOltPopoverPreview() {
    const values = readOltPopoverValues();
    const preview = document.getElementById('oltPopPreview');
    const has = !!(values.olt || values.placa || values.pon);
    preview.textContent = has ? formatOltPath(values) : 'Preencha a OLT, a placa e a porta PON';
    preview.classList.toggle('is-empty', !has);
    //Mesma OLT/placa/PON em outro splitter do projeto
    const warning = document.getElementById('oltPopWarning');
    const clash = values.olt && values.pon ? collectProjectOltUsage().find(u =>
        u.id !== activeSplitterForOltConfig?.id
        && u.olt.toLowerCase() === values.olt.toLowerCase()
        && String(u.placa) === String(values.placa)
        && String(u.pon) === String(values.pon)) : null;
    warning.hidden = !clash;
    if (clash) warning.textContent = `Esta PON já atende o splitter ${clash.label} em ${clash.box}.`;
}

function applySplitterOltConfig() {
    if (!activeSplitterForOltConfig) return;
    const card = activeSplitterForOltConfig;
    const values = readOltPopoverValues();
    const map = { oltName: values.olt, placaNumber: values.placa, ponNumber: values.pon };
    Object.entries(map).forEach(([key, value]) => {
        if (value) card.dataset[key] = value; else delete card.dataset[key];
    });
    updateSplitterOltDisplay(card);
    closeOltPopover();
    markFusionDirty();
    repackAllElements();
}

function removeSplitterOltConfig() {
    ['splitterConfigOlt', 'splitterConfigPlaca', 'splitterConfigPon'].forEach(id => { document.getElementById(id).value = ''; });
    applySplitterOltConfig();
}

function initSplitterOltConfigModal() {
    const pop = document.getElementById('fusionOltPopover');
    if (!pop) return;
    document.getElementById('closeSplitterOltConfigModal').addEventListener('click', closeOltPopover);
    document.getElementById('cancelSplitterOltConfig').addEventListener('click', closeOltPopover);
    document.getElementById('confirmSplitterOltConfig').addEventListener('click', applySplitterOltConfig);
    document.getElementById('removeSplitterOlt').addEventListener('click', removeSplitterOltConfig);
    ['splitterConfigOlt', 'splitterConfigPlaca', 'splitterConfigPon'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateOltPopoverPreview);
    });
    pop.querySelectorAll('.olt-pop__num button[data-step]').forEach(button => button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.target);
        const next = Math.max(Number(input.min) || 0, (parseInt(input.value, 10) || 0) + Number(button.dataset.step));
        input.value = Math.min(Number(input.max) || 999, next);
        updateOltPopoverPreview();
    }));
    pop.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            applySplitterOltConfig();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeOltPopover();
        }
    });
    document.addEventListener('mousedown', (event) => {
        if (pop.classList.contains('hidden')) return;
        if (!event.target.closest('#fusionOltPopover, .splitter-olt-config-btn')) closeOltPopover();
    });
}

function handleDerivationKitToggle(checkbox) {
    checkbox.dataset.checked = String(checkbox.checked);
    markFusionDirty();
}

function handleTrayQuantityChange(input) {
    input.dataset.oldValue = input.value;
    markFusionDirty();
}

// ---------------------------------------------------------------
// Abrir, salvar e fechar
// ---------------------------------------------------------------

function updateFusionModalTitle(markerInfo) {
    const title = document.getElementById('fusionModalTitle');
    if (!title) return;
    if (!markerInfo) {
        title.textContent = 'Plano de fusão';
        return;
    }
    const kind = markerInfo.type === 'CEO' ? 'CEO' : 'CTO';
    title.textContent = `Plano de fusão · ${kind} ${(markerInfo.name || '').trim() || 'sem nome'}`;
}

function populateFusionPlan(markerInfo) {
    activeMarkerForFusion = markerInfo;
    cancelFusionArm();
    activeLineForAction = null;
    updateFusionModalTitle(markerInfo);
    const stage = getFusionStage();
    const svg = getFusionSvg();
    stage.querySelectorAll('.cable-element, .splitter-element').forEach(el => el.remove());
    svg.innerHTML = '';
    const trayField = document.getElementById('trayKitContainer');
    const trayInput = document.getElementById('trayKitQuantity');
    trayField.classList.toggle('hidden', markerInfo.type !== 'CEO');
    trayInput.value = 0;
    if (markerInfo.fusionPlan) {
        try {
            const planData = JSON.parse(markerInfo.fusionPlan);
            const temp = document.createElement('div');
            temp.innerHTML = planData.elements || planData.canvas || '';
            temp.querySelectorAll('.cable-element, .splitter-element').forEach(old => {
                const card = upgradeFusionCard(old);
                stage.appendChild(card);
                wireFusionCard(card);
            });
            if (planData.svg) {
                const tempSvg = document.createElementNS(SVG_NS, 'svg');
                tempSvg.innerHTML = planData.svg;
                tempSvg.querySelectorAll('.fusion-line').forEach(line => {
                    line.removeAttribute('style');
                    line.setAttribute('class', 'fusion-line');
                    svg.appendChild(line);
                });
            }
            if (markerInfo.type === 'CEO') trayInput.value = parseInt(planData.trayQuantity, 10) || 0;
        } catch (e) {
            console.error('Erro ao carregar plano de fusão:', e);
            showAlert('Erro', 'Não foi possível ler o plano de fusão salvo desta caixa.');
        }
    }
    trayInput.dataset.oldValue = trayInput.value;
    ensureFusionSvgDefs();
    fusionDirty = false;
    renderFusionConnections.hideFreeSignature = null;
    closeOltPopover();
    updateFusionSaveState();
    document.getElementById('fusionModal').classList.toggle('is-readonly', AppSession.isViewer);
    document.getElementById('cancelFusionPlan').textContent = AppSession.isViewer ? 'Fechar' : 'Cancelar';
    const emptyHint = document.querySelector('#fusionEmptyState span');
    if (emptyHint) emptyHint.textContent = AppSession.isViewer ? 'Esta caixa ainda não tem um plano de fusão montado.' : 'Adicione os cabos da caixa e os splitters pela coluna ao lado.';
    renderSplitterDraft();
    resetFusionHint();
    requestAnimationFrame(() => {
        repackAllElements({ animate: false });
        renderFusionSidebar();
    });
}

function serializeFusionPlan() {
    const container = document.createElement('div');
    getFusionCards().forEach(card => {
        const clone = card.cloneNode(true);
        clone.style.transition = '';
        clone.style.transform = '';
        clone.classList.remove('is-dragging', 'fx-flash');
        clone.querySelectorAll('.fusion-dynamic').forEach(n => { n.textContent = ''; n.removeAttribute('title'); });
        clone.querySelectorAll('.connection-source, .fx-target, .fx-busy, .port-highlighted, .is-connected, .has-client').forEach(n => {
            n.classList.remove('connection-source', 'fx-target', 'fx-busy', 'port-highlighted', 'is-connected', 'has-client');
        });
        container.appendChild(clone);
    });
    const svgClone = getFusionSvg().cloneNode(true);
    svgClone.querySelectorAll('.fx-line-hit, .connecting-line, defs').forEach(n => n.remove());
    svgClone.querySelectorAll('.fusion-line').forEach(line => {
        line.classList.remove('fx-line-hover', 'fusion-line-new', 'fusion-line-editing');
    });
    const planData = { version: 2, elements: container.innerHTML, svg: svgClone.innerHTML };
    if (activeMarkerForFusion?.type === 'CEO') planData.trayQuantity = document.getElementById('trayKitQuantity').value || 0;
    return JSON.stringify(planData);
}

function saveFusionPlan() {
    const markerInfo = activeMarkerForFusion;
    if (!markerInfo || !requireEdit('salvar planos de fusão')) return;
    markerInfo.fusionPlan = serializeFusionPlan();
    fusionDirty = false;
    closeFusionModal({ force: true });
    refreshBomAfterProjectChange();
    if (markerInfo.type === 'CTO') refreshClientDrops();
    const lines = (JSON.parse(markerInfo.fusionPlan).svg.match(/class="fusion-line/g) || []).length;
    showToast('Plano de fusão salvo', `${markerInfo.name}: ${lines} fusão(ões).`);
}

function closeFusionModal({ force = false } = {}) {
    const close = () => {
        cancelFusionArm();
        closeOltPopover();
        document.getElementById('fusionModal').style.display = 'none';
        activeMarkerForFusion = null;
        fusionDirty = false;
        updateFusionModalTitle(null);
    };
    if (!force && fusionDirty) {
        showConfirm('Descartar alterações', 'O plano de fusão tem alterações não salvas. Fechar sem salvar?', close);
        return;
    }
    close();
}

function cancelFusionArmFromEscape() {
    const modal = document.getElementById('fusionModal');
    if (!modal || modal.style.display === 'none') return false;
    return cancelFusionArm();
}

function setupFusionModal() {
    const canvas = document.getElementById('fusionCanvas');
    canvas.addEventListener('click', handleConnectionClick);
    canvas.addEventListener('contextmenu', handleFusionCanvasRightClick);
    canvas.addEventListener('mousemove', handleFusionCanvasMouseMove);
    canvas.addEventListener('dragstart', (e) => e.preventDefault());
    window.addEventListener('resize', () => {
        if (document.getElementById('fusionModal').style.display === 'flex') repackAllElements({ animate: false });
    });
    document.getElementById('closeFusionModal').addEventListener('click', () => closeFusionModal());
    document.getElementById('cancelFusionPlan').addEventListener('click', () => closeFusionModal());
    document.getElementById('saveFusionPlan').addEventListener('click', saveFusionPlan);
    //Ctrl+S com o plano aberto salva o plano (e não o projeto)
    document.addEventListener('keydown', (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
        if (document.getElementById('fusionModal').style.display !== 'flex') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (AppSession.canEdit) saveFusionPlan();
    }, true);
    document.getElementById('addAllCablesButton').addEventListener('click', addAllCablesToFusionPlan);
    document.getElementById('addSplitterToFusion').addEventListener('click', addSplitterFromDraft);
    document.getElementById('fxSeqButton').addEventListener('click', runFusionSequence);
    document.getElementById('fusionToolsForm').addEventListener('submit', (e) => {
        e.preventDefault();
        if (e.target.contains(document.activeElement) && document.activeElement.closest('#fusionSequenceSection')) runFusionSequence();
    });
    document.getElementById('fxHideFree').addEventListener('change', (e) => {
        getFusionStage().classList.toggle('fx-hide-free', e.target.checked);
        repackAllElements({ animate: false });
    });
    const bindDraft = (groupId, key, cast = (v) => v) => {
        document.querySelectorAll(`#${groupId} button`).forEach(button => {
            button.addEventListener('click', () => {
                fusionSplitterDraft[key] = cast(button.dataset.value);
                renderSplitterDraft();
            });
        });
    };
    bindDraft('fxSplitterType', 'type');
    bindDraft('fxSplitterRatio', 'ratio', Number);
    bindDraft('fxSplitterConnector', 'connector');
    bindDraft('fxSplitterStatus', 'status');
    const trayInput = document.getElementById('trayKitQuantity');
    trayInput.addEventListener('change', () => handleTrayQuantityChange(trayInput));
    document.querySelectorAll('#trayKitContainer .stepper button[data-step]').forEach(button => {
        button.addEventListener('click', () => {
            trayInput.value = Math.max(0, (parseInt(trayInput.value, 10) || 0) + Number(button.dataset.step));
            handleTrayQuantityChange(trayInput);
        });
    });
    //Janela de ação da linha
    const lineActionModal = document.getElementById('lineActionModal');
    const closeLineAction = () => {
        lineActionModal.style.display = 'none';
        activeLineForAction = null;
    };
    document.getElementById('closeLineActionModal').addEventListener('click', closeLineAction);
    document.getElementById('cancelLineActionButton').addEventListener('click', closeLineAction);
    document.getElementById('deleteLineConfirmButton').addEventListener('click', () => {
        const line = activeLineForAction;
        closeLineAction();
        removeFusionLine(line);
    });
    document.getElementById('editLineButton').addEventListener('click', () => {
        const line = activeLineForAction;
        closeLineAction();
        startLineEdit(line);
    });
}
