// Pré-projeto automático: a partir de um polígono, da quantidade de casas, da taxa de penetração e da
// splitagem, descobre onde há ruas (e casas) dentro da área, distribui as caixas por elas e monta a rede:
// POP → CEO(s) → CTOs, com cabos traçados pelas ruas (OSRM, o mesmo da sugestão de rota) ou de poste em
// poste quando a área tem postes cadastrados. Mato, pasto e rio sem rua ficam sem caixa.
// A prévia (tracejada) mostra o custo estimado e pode ser editada: arrastar, incluir e tirar CTOs e marcar
// trechos sem casas. Nada é salvo até "Aceitar e criar": aí as caixas, as reservas técnicas, os cabos e os
// planos de fusão (splitters ligados e fibras de passagem fundidas) entram como Novo numa pasta própria,
// e a lista de materiais é refeita. Depois de criado, "Desfazer pré-projeto" tira tudo de uma vez.
// Depende de js/app.js, js/core/persistence.js, js/map/marker-panel.js, js/map/marker-icons.js, js/network/fusion.js
// (buildFusionCableCard, buildFusionSplitterCard), js/catalog/catalog.js, js/catalog/bom.js, js/catalog/labor.js,
// js/network/clients.js (fetchOsrmRoute, reserva quando o OSRM de carro falha) e js/network/cable-route-suggest.js (simplifyPathMeters).

//Servidores OSRM públicos (gratuitos, sem chave). Primeiro o perfil de carro: só ruas de verdade, sem
//vielas, escadarias e caminhos de pedestre que passam entre as casas (onde caixa e cabo não vão).
//O perfil a pé fica por último, só para quando os de carro não responderem.
const AUTO_DESIGN_OSRM_SERVERS = [
    { base: 'https://routing.openstreetmap.de/routed-car', profile: 'driving' },
    { base: 'https://router.project-osrm.org', profile: 'driving' },
    { base: 'https://routing.openstreetmap.de/routed-foot', profile: 'foot' },
];
//Traçado das ruas (OpenStreetMap, js/map/street-lines.js): o cabo só pode passar por cima de rua/calçada, nunca de casa
const AUTO_DESIGN_STREET_TOL_M = 15;    //Poste a até 15 m do eixo da rua está na calçada (avenida larga); mais longe, está no lote
const AUTO_DESIGN_STREET_EDGE_M = 9;    //Entre dois postes o cabo fica a até ~9 m do eixo (rua comum): não corta quina de lote
//Rua que não está no mapa (loteamento novo, estrada rural nova ou desenhada fora do lugar): fileira de 3 ou mais postes
//fora das ruas conhecidas, com vãos de até 130 m (vão rural), é uma rua de verdade. Esses postes valem e os cabos ali
//vão de poste em poste, sem cruzar rio. Poste solto (ou dupla) fora da rua continua de fora: é poste dentro de lote.
const AUTO_DESIGN_UNMAPPED_SPAN_M = 130;
const AUTO_DESIGN_UNMAPPED_LINE = 3;
const AUTO_DESIGN_STREET_MARGIN_M = 400; //Ruas lidas além do polígono (para o cabo contornar pela quadra vizinha)
const AUTO_DESIGN_START_REACH_M = 5000;   //POP/CEO de partida até 5 km da área: as ruas até ele também são lidas
const AUTO_DESIGN_WATER_PENALTY_M = 400; //Atravessar rio/córrego/lago "custa" +400 m: só cruza (por ponte) sem outro caminho
const AUTO_DESIGN_ROUTE_OPTIONS = 3;     //Rotas diferentes para o cabo que sai da caixa existente
const AUTO_DESIGN_ROUTE_OVERLAP = 0.5;
const AUTO_DESIGN_POLE_PICK_M = 25;
const AUTO_DESIGN_PREVIEW_COLOR = '#f97316'; //Cabos da prévia em laranja: não se confundem com os cabos do projeto      //Clique a até 25 m de um poste escolhe esse poste para a rota   //Rota que repete mais da metade de outra não conta como diferente
const AUTO_DESIGN_SAMPLE_MAX = 400;  //Pontos da área consultados para achar as ruas
const AUTO_DESIGN_SAMPLE_CHUNK = 80; //Pontos por consulta (cabe na tabela do OSRM público)
const AUTO_DESIGN_STREET_MAX_M = 40; //Ponto a mais de 40 m de qualquer rua = sem casas (mato, pasto, rio)
const AUTO_DESIGN_EXISTING_GAP_M = 30; //CTO nova não vai a menos disso de uma CTO que já existe
const AUTO_DESIGN_EDGE_TOL_M = 25;   //Rua (ou poste, ou casa) em cima do limite do polígono também entra
const AUTO_DESIGN_TABLE_MAX = 100;   //Caixas na tabela de distâncias pela rua (acima disso, linha reta)
const AUTO_DESIGN_GRID_M = 15;       //Casas espalhadas pela área: um ponto a cada 15 m
const AUTO_DESIGN_MAX_POINTS = 6000; //Áreas grandes usam pontos mais espaçados
const AUTO_DESIGN_COVER_M = 150;     //Raio da CTO (alcance do drop, em linha reta) quando não informado
const AUTO_DESIGN_COVER_MIN = 30, AUTO_DESIGN_COVER_MAX = 1000;
const AUTO_DESIGN_SNAP_MAX_M = 80;   //Só puxa a caixa para a rua se a rua estiver até 80 m
const AUTO_DESIGN_EDIT_SNAP_M = 60;  //Caixa arrastada na prévia vai para o poste/rua mais perto até 60 m
const AUTO_DESIGN_MIN_COVERAGE = 0.95;
const AUTO_DESIGN_MAX_CTOS = 300;
const AUTO_DESIGN_MAX_ROUTED = 120;  //Acima disso os cabos ficam em linha reta (não sobrecarrega o OSRM público)
const AUTO_DESIGN_FIBERS = [6, 12, 24, 36, 48, 72, 144];
const AUTO_DESIGN_SPLITTERS = [8, 16];
const AUTO_DESIGN_PRIMARY_SPLITTERS = [2, 4, 8];
const AUTO_DESIGN_MAX_SPLIT = 128;   //Splitagem total (CEO × CTO) até 1:128 (CEO 1:8 + CTO 1:16, OLT classe C+)
const AUTO_DESIGN_TIGHT_SPLIT = 64;  //Acima de 1:64 o orçamento óptico fica apertado: a prévia avisa
const AUTO_DESIGN_RESERVE_STEPS = [0, 300, 500, 1000];
const AUTO_DESIGN_CEO_LIMITS = [0, 8, 12, 16, 24, 32];
const AUTO_DESIGN_FUSIONS_PER_TRAY = 12;
const AUTO_DESIGN_MIN_HOUSE_MARKERS = 5;
const AUTO_DESIGN_MIN_POLES = 4;
const AUTO_DESIGN_PARAMS_KEY = 'routeMapAutoDesignParams';
const AUTO_DESIGN_POLE_DEDUP_M = 3;  //Poste da BDGD a menos de 3 m de um poste marcado no mapa é o mesmo poste
const AUTO_DESIGN_GENERATED_NOTE = 'Gerado pelo pré-projeto automático';
//Opções do pré-projeto: cada estratégia é tentada com as CTOs começando de pontos diferentes da área; das
//distribuições diferentes, ficam 3 (a do painel, a de menor custo e a com mais portas livres)
const AUTO_DESIGN_STRATEGIES = [
    { id: 'panel', params: () => ({}) },
    { id: 'wide', params: (p) => ({ maxFill: 100, coverRadius: getAutoDesignCoverRadius(p) * 1.3 }) },
    { id: 'spare', params: (p) => ({ maxFill: Math.max(25, Math.min(100, Number(p.maxFill) || 100) - 25), coverRadius: getAutoDesignCoverRadius(p) * 0.8 }) },
];
const AUTO_DESIGN_LAYOUT_SEEDS = 3;  //Pontos de partida por estratégia (com o traçado das ruas; sem ele, 1)
const AUTO_DESIGN_OPTION_COUNT = 3;
const AUTO_DESIGN_PANEL_OPTION = 'panel-0';
//Mão de obra de referência (tabela padrão da terceirizada, js/catalog/labor.js)
const AUTO_DESIGN_LABOR_SERVICES = {
    cable: 'LANÇAMENTO DE CABO AÉREA URBANA',
    ceo: 'INSTALAÇÃO DE CAIXA DE EMENDA (CEO)',
    cto: 'INSTALAÇÃO DE CAIXA DE ATENDIMENTO (CTO)',
    reserve: 'INSTALAÇÃO DE RESERVA TÉCNICA',
    fusion: 'FUSÃO DE FIBRA ÓPTICA',
};

let autoDesign = null; //{ polygon, params, phase, result, overlays, token, cache, exclusions, editMode, … }
const autoDesignHousesByPolygon = new Map(); //Casas digitadas por polígono (durante a sessão)

// ---------------------------------------------------------------
// Geometria em metros (plano local em volta da área)
// ---------------------------------------------------------------

function createAutoDesignProjection(points) {
    const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const lng0 = points.reduce((s, p) => s + p.lng, 0) / points.length;
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180);
    const ky = 110540;
    return {
        toXY: (lat, lng) => [(lng - lng0) * kx, (lat - lat0) * ky],
        toLatLng: ([x, y]) => ({ lat: y / ky + lat0, lng: x / kx + lng0 }),
    };
}

function pointInPolygonXY([x, y], poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function distToSegmentXY([px, py], [ax, ay], [bx, by]) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function distToPolygonEdgeXY(p, poly) {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) best = Math.min(best, distToSegmentXY(p, poly[i], poly[(i + 1) % poly.length]));
    return best;
}

function polygonAreaXY(poly) {
    let sum = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) sum += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
    return Math.abs(sum / 2);
}

const isInAutoDesignArea = (xy, polyXY) => pointInPolygonXY(xy, polyXY) || distToPolygonEdgeXY(xy, polyXY) <= AUTO_DESIGN_EDGE_TOL_M;

// ---------------------------------------------------------------
// OSRM: consultas com vários pontos de uma vez
// ---------------------------------------------------------------

const autoDesignOsrmDown = new Map(); //servidor → até quando pular (fora do ar: não espera 15 s de novo a cada consulta)

//Todos os servidores sem resposta agora
const isAutoDesignOsrmDown = () => AUTO_DESIGN_OSRM_SERVERS.every(({ base }) => (autoDesignOsrmDown.get(base) || 0) > Date.now());

//service = 'table' | 'nearest' | 'route'; points = [{ lat, lng }]. Devolve a resposta (code Ok) ou null.
async function fetchAutoDesignOsrm(service, points, query) {
    const coords = points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    for (const { base, profile } of AUTO_DESIGN_OSRM_SERVERS) {
        if ((autoDesignOsrmDown.get(base) || 0) > Date.now()) continue;
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            const response = await fetch(`${base}/${service}/v1/${profile}/${coords}?${query}`, { signal: controller.signal });
            clearTimeout(timer);
            if (!response.ok) continue;
            const data = await response.json();
            if (data?.code === 'Ok') return data;
        } catch (e) {
            //Sem resposta (fora do ar, sem rede): pula este servidor por 1 minuto e tenta o próximo
            autoDesignOsrmDown.set(base, Date.now() + 60000);
        }
    }
    return null;
}

//Onde há rua dentro da área: uma grade de pontos é consultada no OSRM, que devolve o ponto de rua mais
//perto de cada um (com o nome da rua). Ponto longe de rua (mato, pasto, rio) fica de fora; o que sobra
//são pontos em cima das ruas, onde ficam as casas e onde as caixas podem ir.
//Devolve { points: [{ lat, lng, w }] } (vazio = não há ruas) ou null quando o OSRM não respondeu.
function getAutoDesignSampleGrid(polygonPath) {
    const proj = createAutoDesignProjection(polygonPath);
    const polyXY = polygonPath.map(p => proj.toXY(p.lat, p.lng));
    const xs = polyXY.map(p => p[0]), ys = polyXY.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const step = Math.max(20, Math.sqrt(polygonAreaXY(polyXY) / AUTO_DESIGN_SAMPLE_MAX));
    const samples = [];
    for (let x = minX + step / 2; x <= maxX; x += step) {
        for (let y = minY + step / 2; y <= maxY; y += step) {
            if (pointInPolygonXY([x, y], polyXY)) samples.push([x, y]);
        }
    }
    return { proj, polyXY, step, samples };
}

//Pontos repetidos (vários da grade caem no mesmo trecho de rua) somam o peso
function groupAutoDesignStreetPoints(points, proj, step) {
    const cells = new Map();
    points.forEach(p => {
        const [x, y] = proj.toXY(p.lat, p.lng);
        const key = `${Math.round(x / 10)},${Math.round(y / 10)}`;
        const cell = cells.get(key);
        if (cell) cell.w += step;
        else cells.set(key, { lat: p.lat, lng: p.lng, w: step });
    });
    return { points: [...cells.values()] };
}

//Vias com casas (ruas de carro); serviço, trilha e caminho de pedestre só entram se a área não tiver outra
const AUTO_DESIGN_HOUSE_STREET_CLASSES = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'minor']);

//A mesma leitura, sem servidor: com o traçado das ruas já baixado, cada ponto da grade vai para a rua mais perto
function sampleAutoDesignStreetsLocal(polygonPath, lines) {
    const { proj, polyXY, step, samples } = getAutoDesignSampleGrid(polygonPath);
    if (!samples.length) return { points: [] };
    const snapTo = (subset) => {
        if (!subset.length) return [];
        const index = buildAutoDesignStreetIndex(subset, proj);
        return samples.map(([x, y]) => index.nearestPoint(x, y, AUTO_DESIGN_STREET_MAX_M))
            .filter(p => p && isInAutoDesignArea(p, polyXY))
            .map(p => proj.toLatLng(p));
    };
    const houses = snapTo(lines.filter(l => !l.cls || AUTO_DESIGN_HOUSE_STREET_CLASSES.has(l.cls)));
    return groupAutoDesignStreetPoints(houses.length >= 6 ? houses : snapTo(lines), proj, step);
}

async function sampleAutoDesignStreets(polygonPath, isCurrent) {
    const grid = getAutoDesignSampleGrid(polygonPath);
    const { proj, polyXY, step } = grid;
    const samples = grid.samples.map(p => proj.toLatLng(p));
    if (!samples.length) return { points: [] };
    const chunks = [];
    for (let i = 0; i < samples.length; i += AUTO_DESIGN_SAMPLE_CHUNK) chunks.push(samples.slice(i, i + AUTO_DESIGN_SAMPLE_CHUNK));
    const found = [];
    let answered = 0;
    await runAutoDesignLimited(chunks, 2, async (chunk) => {
        if (!isCurrent()) return;
        //Tabela 1 × N: barata, e a resposta traz cada ponto já colocado na rua mais perto
        const data = await fetchAutoDesignOsrm('table', chunk, 'sources=0');
        if (!data?.destinations) return;
        answered++;
        found.push(...data.destinations);
    });
    if (!answered) return null;
    const near = found.filter(w => Array.isArray(w.location) && Number(w.distance) <= AUTO_DESIGN_STREET_MAX_M)
        .map(w => ({ lat: w.location[1], lng: w.location[0], named: !!(w.name || '').trim() }))
        .filter(p => isInAutoDesignArea(proj.toXY(p.lat, p.lng), polyXY));
    //Ruas com nome = ruas com casas (trilha e estrada de terra no mato costumam não ter nome)
    const named = near.filter(p => p.named);
    return groupAutoDesignStreetPoints(named.length >= 6 ? named : near, proj, step);
}

// ---------------------------------------------------------------
// Traçado das ruas (OpenStreetMap): garante que nenhum cabo passe por cima de casas
// ---------------------------------------------------------------

//Linhas das ruas em volta da área (e da caixa de onde a rede sai): [[lat, lng], ...] por trecho; null se nenhuma
//fonte responder
async function fetchAutoDesignStreetLines(polygonPath, extraPoints = []) {
    if (typeof getStreetLinesInBounds !== 'function') return null;
    const margin = AUTO_DESIGN_STREET_MARGIN_M / 111320;
    const points = [...polygonPath, ...extraPoints];
    const lats = points.map(p => p.lat), lngs = points.map(p => p.lng);
    return getStreetLinesInBounds(Math.min(...lats) - margin, Math.min(...lngs) - margin, Math.max(...lats) + margin, Math.max(...lngs) + margin);
}

//Índice das ruas no plano local (metros): distância até a rua mais perto, teste de trecho e rota pelas ruas
function buildAutoDesignStreetIndex(lines, proj) {
    const CELL = 30;
    const segs = [];
    const nodes = new Map(); //"x,y" (arredondado a 10 cm) → índice; cruzamentos de ruas viram o mesmo nó
    const nodeXY = [];
    const adj = [];
    const nodeOf = ([x, y]) => {
        const key = `${Math.round(x * 10)},${Math.round(y * 10)}`;
        let id = nodes.get(key);
        if (id === undefined) { id = nodeXY.length; nodes.set(key, id); nodeXY.push([x, y]); adj.push([]); }
        return id;
    };
    lines.forEach(line => {
        const pts = line.map(([lat, lng]) => proj.toXY(lat, lng));
        for (let i = 1; i < pts.length; i++) {
            const a = nodeOf(pts[i - 1]), b = nodeOf(pts[i]);
            if (a === b) continue;
            const w = Math.hypot(nodeXY[a][0] - nodeXY[b][0], nodeXY[a][1] - nodeXY[b][1]);
            adj[a].push([b, w]); adj[b].push([a, w]);
            segs.push([a, b]);
        }
    });
    const grid = new Map();
    const cellKey = (cx, cy) => `${cx},${cy}`;
    const indexSeg = (si) => {
        const [a, b] = segs[si];
        const [ax, ay] = nodeXY[a], [bx, by] = nodeXY[b];
        for (let cx = Math.floor(Math.min(ax, bx) / CELL); cx <= Math.floor(Math.max(ax, bx) / CELL); cx++) {
            for (let cy = Math.floor(Math.min(ay, by) / CELL); cy <= Math.floor(Math.max(ay, by) / CELL); cy++) {
                const k = cellKey(cx, cy);
                let list = grid.get(k);
                if (!list) grid.set(k, list = []);
                list.push(si);
            }
        }
    };
    segs.forEach((_, si) => indexSeg(si));
    //Ruas cortadas na borda dos blocos (ou mal emendadas no mapa): ponta solta a até 2 m de outra rua é ligada a ela
    nodeXY.forEach(([x, y], u) => {
        if (adj[u].length !== 1) return;
        let best = null;
        const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
            for (let gy = cy - 1; gy <= cy + 1; gy++) {
                for (const si of grid.get(cellKey(gx, gy)) || []) {
                    const [a, b] = segs[si];
                    if (a === u || b === u) continue;
                    const dist = distToSegmentXY([x, y], nodeXY[a], nodeXY[b]);
                    if (dist <= 2 && (!best || dist < best.dist)) best = { dist, a, b };
                }
            }
        }
        if (!best) return;
        for (const v of [best.a, best.b]) {
            const w = Math.hypot(x - nodeXY[v][0], y - nodeXY[v][1]);
            adj[u].push([v, w]); adj[v].push([u, w]);
        }
    });
    //Rios, córregos e lagos (contornos): trecho que cruza água fica caro na rota
    const N = nodeXY.length;
    const edgeKey = (u, v) => (u < v ? u * N + v : v * N + u);
    const WCELL = 60;
    const waterSegs = [], waterGrid = new Map();
    (lines.water || []).forEach(line => {
        const pts = line.map(([lat, lng]) => proj.toXY(lat, lng));
        for (let i = 1; i < pts.length; i++) {
            const [a, b] = [pts[i - 1], pts[i]];
            const si = waterSegs.push([a, b]) - 1;
            for (let cx = Math.floor(Math.min(a[0], b[0]) / WCELL); cx <= Math.floor(Math.max(a[0], b[0]) / WCELL); cx++) {
                for (let cy = Math.floor(Math.min(a[1], b[1]) / WCELL); cy <= Math.floor(Math.max(a[1], b[1]) / WCELL); cy++) {
                    const k = cellKey(cx, cy);
                    let list = waterGrid.get(k);
                    if (!list) waterGrid.set(k, list = []);
                    list.push(si);
                }
            }
        }
    });
    const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const crosses = (p1, p2, p3, p4) => (side(p3, p4, p1) > 0) !== (side(p3, p4, p2) > 0) && (side(p1, p2, p3) > 0) !== (side(p1, p2, p4) > 0);
    //Trecho reto de a até b atravessa água?
    const crossesWater = (a, b) => {
        if (!waterSegs.length) return false;
        const seen = new Set();
        for (let cx = Math.floor(Math.min(a[0], b[0]) / WCELL); cx <= Math.floor(Math.max(a[0], b[0]) / WCELL); cx++) {
            for (let cy = Math.floor(Math.min(a[1], b[1]) / WCELL); cy <= Math.floor(Math.max(a[1], b[1]) / WCELL); cy++) {
                for (const si of waterGrid.get(cellKey(cx, cy)) || []) {
                    if (seen.has(si)) continue;
                    seen.add(si);
                    if (crosses(a, b, waterSegs[si][0], waterSegs[si][1])) return true;
                }
            }
        }
        return false;
    };
    const wet = new Set(); //trechos de rua que cruzam água (pontes)
    if (waterSegs.length) adj.forEach((list, u) => list.forEach(([v]) => { if (u < v && crossesWater(nodeXY[u], nodeXY[v])) wet.add(edgeKey(u, v)); }));
    //Segmento de rua mais perto de (x, y) até maxDist: { dist, seg, t } (t = posição no segmento, 0..1).
    //accept(px, py) pode recusar pontos (ex.: o caminho até ele cruza um rio)
    const nearest = (x, y, maxDist, accept = null) => {
        let best = { dist: Infinity, seg: -1, t: 0 };
        const r = Math.ceil(maxDist / CELL), cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
        for (let gx = cx - r; gx <= cx + r; gx++) {
            for (let gy = cy - r; gy <= cy + r; gy++) {
                const list = grid.get(cellKey(gx, gy));
                if (!list) continue;
                for (const si of list) {
                    const [ax, ay] = nodeXY[segs[si][0]], [bx, by] = nodeXY[segs[si][1]];
                    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
                    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
                    const dist = Math.hypot(x - ax - t * dx, y - ay - t * dy);
                    if (dist < best.dist && (!accept || accept(ax + t * dx, ay + t * dy))) best = { dist, seg: si, t };
                }
            }
        }
        return best.dist <= maxDist ? best : null;
    };
    const distToStreet = (x, y) => nearest(x, y, AUTO_DESIGN_STREET_TOL_M)?.dist ?? Infinity;
    //Ponto da rua mais perto de (x, y) até maxDist: [x, y] ou null
    const nearestPoint = (x, y, maxDist) => {
        const snap = nearest(x, y, maxDist);
        if (!snap) return null;
        const [a, b] = segs[snap.seg], [ax, ay] = nodeXY[a], [bx, by] = nodeXY[b];
        return [ax + (bx - ax) * snap.t, ay + (by - ay) * snap.t];
    };
    //Trecho reto de a até b fica todo sobre rua/calçada? Confere a cada 2 m: o cabo pode se afastar do eixo no máximo
    //o que a rua comum permite (9 m) ou, perto de um poste de avenida larga, o afastamento do próprio poste.
    const segmentOnStreets = ([ax, ay], [bx, by]) => {
        const da = distToStreet(ax, ay), db = distToStreet(bx, by);
        if (da > AUTO_DESIGN_STREET_TOL_M || db > AUTO_DESIGN_STREET_TOL_M) return false;
        const len = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(1, Math.ceil(len / 2));
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const allowed = Math.max(AUTO_DESIGN_STREET_EDGE_M, da + (db - da) * t) + 1;
            if (distToStreet(ax + (bx - ax) * t, ay + (by - ay) * t) > allowed) return false;
        }
        return true;
    };
    const makeHeap = () => {
        const heap = [];
        return {
            size: () => heap.length,
            push(d, v) {
                heap.push([d, v]);
                for (let i = heap.length - 1; i > 0;) { const q = (i - 1) >> 1; if (heap[q][0] <= heap[i][0]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; }
            },
            pop() {
                const top = heap[0], last = heap.pop();
                if (heap.length) {
                    heap[0] = last;
                    for (let i = 0; ;) {
                        const l = 2 * i + 1, r = l + 1; let m = i;
                        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                        if (m === i) break;
                        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
                    }
                }
                return top;
            },
        };
    };
    //Ponto encostado na rua: nós do trecho, distância até cada um e quanto o ponto está fora do eixo
    const snapAt = (snap) => {
        const [u, v] = segs[snap.seg];
        const len = Math.hypot(nodeXY[u][0] - nodeXY[v][0], nodeXY[u][1] - nodeXY[v][1]);
        return { u, v, du: snap.t * len, dv: (1 - snap.t) * len, off: snap.dist };
    };
    //Distância pela rua de a até cada ponto de targets (um Dijkstra só): substitui a tabela do OSRM, sem servidor.
    //Infinity = sem caminho pela rua (ou ponto longe de qualquer rua).
    const distancesFrom = (a, targets) => {
        const out = targets.map(() => Infinity);
        const sa = nearest(a[0], a[1], AUTO_DESIGN_SNAP_MAX_M);
        if (!sa) return out;
        const A = snapAt(sa);
        const dist = new Float64Array(nodeXY.length).fill(Infinity);
        const heap = makeHeap();
        dist[A.u] = A.du; heap.push(A.du, A.u);
        if (A.dv < dist[A.v]) { dist[A.v] = A.dv; heap.push(A.dv, A.v); }
        while (heap.size()) {
            const [d, u] = heap.pop();
            if (d > dist[u]) continue;
            for (const [v, w] of adj[u]) if (d + w < dist[v]) { dist[v] = d + w; heap.push(dist[v], v); }
        }
        targets.forEach((b, i) => {
            const sb = nearest(b[0], b[1], AUTO_DESIGN_SNAP_MAX_M);
            if (!sb) return;
            const B = snapAt(sb);
            let d = Math.min(dist[B.u] + B.du, dist[B.v] + B.dv);
            if (sb.seg === sa.seg) d = Math.min(d, Math.abs(B.du - A.du));
            out[i] = d + A.off + B.off;
        });
        return out;
    };
    //Rota pelas ruas (Dijkstra no traçado do OpenStreetMap) de a até b: { points: [[x, y], ...], edges: [[chave, m]],
    //length, wet } ou null. snapA/snapB = até quantos metros da rua cada ponta pode estar (caixa nova fica na rua;
    //POP/CEO que já existe pode estar no lote). A ponta encosta na rua sem cruzar água, se der. extra: chave do trecho →
    //multiplicador (usado para achar rotas diferentes).
    const pathLength = (pts) => pts.reduce((sum, p, i) => sum + (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
    const routeCore = (a, b, snapA, snapB, extra = null) => {
        const dry = (p) => (px, py) => !crossesWater(p, [px, py]);
        const sa = nearest(a[0], a[1], snapA, dry(a)) || nearest(a[0], a[1], snapA);
        const sb = nearest(b[0], b[1], snapB, dry(b)) || nearest(b[0], b[1], snapB);
        if (!sa || !sb) return null;
        const at = (snap) => {
            const [u, v] = segs[snap.seg], [ux, uy] = nodeXY[u], [vx, vy] = nodeXY[v];
            return { u, v, p: [ux + (vx - ux) * snap.t, uy + (vy - uy) * snap.t], du: snap.t, dv: 1 - snap.t };
        };
        const A = at(sa), B = at(sb);
        const legsWet = (crossesWater(a, A.p) ? 1 : 0) + (crossesWater(B.p, b) ? 1 : 0);
        if (sa.seg === sb.seg) {
            const points = [a, A.p, B.p, b];
            return { points, edges: [], length: pathLength(points), wet: legsWet + (crossesWater(A.p, B.p) ? 1 : 0) };
        }
        const segLen = (snap) => { const [u, v] = segs[snap.seg]; return Math.hypot(nodeXY[u][0] - nodeXY[v][0], nodeXY[u][1] - nodeXY[v][1]); };
        const cost = (u, v, w) => {
            const k = edgeKey(u, v);
            return w * (extra?.get(k) || 1) + (wet.has(k) ? AUTO_DESIGN_WATER_PENALTY_M : 0);
        };
        const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
        const heap = makeHeap();
        const lenA = segLen(sa), lenB = segLen(sb);
        dist[A.u] = A.du * lenA; heap.push(dist[A.u], A.u);
        if (A.dv * lenA < dist[A.v]) { dist[A.v] = A.dv * lenA; heap.push(dist[A.v], A.v); }
        const targets = new Map([[B.u, B.du * lenB], [B.v, B.dv * lenB]]);
        let best = Infinity, bestNode = -1;
        while (heap.size()) {
            const [d, u] = heap.pop();
            if (d > dist[u] || d >= best) continue;
            if (targets.has(u) && d + targets.get(u) < best) { best = d + targets.get(u); bestNode = u; }
            for (const [v, w] of adj[u]) {
                const nd = d + cost(u, v, w);
                if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd, v); }
            }
        }
        if (bestNode < 0) return null;
        const ids = [];
        for (let v = bestNode; v !== -1; v = prev[v]) ids.unshift(v);
        const edges = [];
        let wetEdges = 0;
        for (let i = 1; i < ids.length; i++) {
            const k = edgeKey(ids[i - 1], ids[i]);
            edges.push([k, Math.hypot(nodeXY[ids[i]][0] - nodeXY[ids[i - 1]][0], nodeXY[ids[i]][1] - nodeXY[ids[i - 1]][1])]);
            if (wet.has(k)) wetEdges++;
        }
        const points = [a, A.p, ...ids.map(v => nodeXY[v]), B.p, b];
        return { points, edges, length: pathLength(points), wet: wetEdges + legsWet };
    };
    const route = (a, b, snapA = AUTO_DESIGN_STREET_TOL_M * 2, snapB = AUTO_DESIGN_STREET_TOL_M * 2) => routeCore(a, b, snapA, snapB)?.points || null;
    //Até count rotas diferentes de a até b (cada nova repete no máximo metade de outra): a melhor e, encarecendo os
    //trechos já usados, as próximas. Rota bem mais longa, ou que cruza mais água que a melhor, fica de fora.
    const alternatives = (a, b, snapA, snapB, count = AUTO_DESIGN_ROUTE_OPTIONS) => {
        const found = [];
        const extra = new Map();
        for (let i = 0; i < count * 4 && found.length < count; i++) {
            const r = routeCore(a, b, snapA, snapB, extra);
            if (!r) break;
            const first = found[0];
            if (first && r.length > first.length * 1.6 + 300) break;
            const mine = new Map(r.edges);
            const distinct = found.every(f => {
                const shared = f.edges.reduce((sum, [k, len]) => sum + (mine.has(k) ? len : 0), 0);
                return shared < AUTO_DESIGN_ROUTE_OVERLAP * Math.min(f.length, r.length);
            });
            if (!first || (distinct && r.wet <= first.wet)) found.push(r);
            if (!r.edges.length) break;
            r.edges.forEach(([k]) => extra.set(k, (extra.get(k) || 1) * 3));
        }
        return found;
    };
    return { distToStreet, nearestPoint, segmentOnStreets, distancesFrom, route, alternatives, crossesWater, size: segs.length };
}

// ---------------------------------------------------------------
// O que já existe no projeto: casas (CASA, inclusive importadas do KML) e postes dentro da área
// ---------------------------------------------------------------

function findAutoDesignMarkersInArea(polygonPath, projectId, type) {
    const proj = createAutoDesignProjection(polygonPath);
    const polyXY = polygonPath.map(p => proj.toXY(p.lat, p.lng));
    return markers.filter(m => {
        if (m.type !== type || !m.marker?.getPosition || m.description === AUTO_DESIGN_GENERATED_NOTE) return false;
        if (projectId && getItemProjectId(m) !== projectId) return false;
        const pos = m.marker.getPosition();
        return isInAutoDesignArea(proj.toXY(pos.lat(), pos.lng()), polyXY);
    });
}

//CTOs que já estão no projeto, dentro da área ou até 1 km dela (o raio da CTO decide quais valem): elas atendem as
//casas por perto antes de o pré-projeto pôr CTO nova. distance = 0 dentro da área.
function findAutoDesignExistingCtos(polygonPath, projectId) {
    const proj = createAutoDesignProjection(polygonPath);
    const polyXY = polygonPath.map(p => proj.toXY(p.lat, p.lng));
    return markers
        .filter(m => m.type === 'CTO' && m.marker?.getPosition && (!projectId || getItemProjectId(m) === projectId))
        .map(m => {
            const pos = m.marker.getPosition();
            const xy = proj.toXY(pos.lat(), pos.lng());
            return { marker: m, distance: pointInPolygonXY(xy, polyXY) ? 0 : distToPolygonEdgeXY(xy, polyXY) };
        })
        .filter(e => e.distance <= AUTO_DESIGN_COVER_MAX);
}

//CTOs existentes que valem com estes parâmetros (opção marcada e dentro do raio da CTO a partir da área)
const getAutoDesignActiveExisting = (list, params) => (params.useExisting === false ? [] : (list || []).filter(e => e.distance <= getAutoDesignCoverRadius(params)));

//Quantos clientes a CTO existente pode ter: portas do splitter de atendimento do plano de fusão (sem plano, as do
//painel) com a ocupação máxima. Os clientes que ela já tem fazem parte da penetração da área.
function getAutoDesignExistingCapacity(markerInfo, params) {
    let ports = null;
    try { ports = typeof getCtoPortCapacity === 'function' ? getCtoPortCapacity(markerInfo) : null; } catch (e) { ports = null; }
    ports = ports || params.ports;
    const clients = typeof getCtoClients === 'function' ? getCtoClients(markerInfo).length : 0;
    return { ports, usable: Math.max(1, Math.floor(ports * (Number(params.maxFill) || 100) / 100), clients) };
}

//CTO existente com cabo chegando (ponta de algum cabo do projeto)
const isAutoDesignCtoWired = (m) => !!m.uid && (typeof savedCables === 'undefined' ? [] : savedCables).some(c => c.startAnchorUid === m.uid || c.endAnchorUid === m.uid);

//Postes da BDGD/ANEEL (base estática do site, js/map/poles-layer.js): cada poste vira um "marcador virtual" (só posição)
async function fetchAutoDesignBdgdPoles(polygonPath) {
    const proj = createAutoDesignProjection(polygonPath);
    const polyXY = polygonPath.map(p => proj.toXY(p.lat, p.lng));
    const margin = AUTO_DESIGN_EDGE_TOL_M / 111320;
    const lats = polygonPath.map(p => p.lat), lngs = polygonPath.map(p => p.lng);
    const { points, manifest } = await getPolesInBounds(Math.min(...lats) - margin, Math.min(...lngs) - margin, Math.max(...lats) + margin, Math.max(...lngs) + margin);
    const poles = points
        .filter(([lat, lng]) => isInAutoDesignArea(proj.toXY(lat, lng), polyXY))
        .map(([lat, lng]) => {
            const position = new google.maps.LatLng(lat, lng);
            return { type: 'POSTE', fromBdgd: true, marker: { getPosition: () => position } };
        });
    return { poles, manifest };
}

//Postes usados na geração = marcados no mapa + da BDGD (sem repetir o mesmo poste); menos de 4 = não usa postes
function refreshAutoDesignPoles(s) {
    const marked = s.markedPoles || [];
    const proj = createAutoDesignProjection(getAutoDesignPolygonPath(s.polygon));
    const xyOf = (m) => { const pos = m.marker.getPosition(); return proj.toXY(pos.lat(), pos.lng()); };
    const markedXY = marked.map(xyOf);
    const fromBdgd = (s.bdgdPoles?.list || []).filter(m => {
        const [x, y] = xyOf(m);
        return !markedXY.some(([mx, my]) => Math.hypot(mx - x, my - y) < AUTO_DESIGN_POLE_DEDUP_M);
    });
    const all = [...marked, ...fromBdgd];
    s.bdgdPoles.used = fromBdgd.length;
    s.poleMarkers = all.length >= AUTO_DESIGN_MIN_POLES ? all : [];
}

async function loadAutoDesignBdgdPoles(s) {
    s.bdgdPoles = { status: 'loading', list: [], used: 0, manifest: null, error: '' };
    refreshAutoDesignPoles(s);
    try {
        const { poles, manifest } = await fetchAutoDesignBdgdPoles(getAutoDesignPolygonPath(s.polygon));
        if (autoDesign !== s) return;
        Object.assign(s.bdgdPoles, { status: manifest ? 'ok' : 'off', list: poles, manifest });
    } catch (e) {
        if (autoDesign !== s) return;
        Object.assign(s.bdgdPoles, { status: 'error', error: e?.message || 'sem resposta' });
    }
    refreshAutoDesignPoles(s);
    if (s.phase === 'form') { readAutoDesignForm(); renderAutoDesign(); }
}

const getAutoDesignHouseCount = (casa) => Math.max(1, parseInt(casa.name, 10) || 1);

// ---------------------------------------------------------------
// Pontos da área: onde estão as casas (demanda) e onde as caixas podem ir (locais)
// ---------------------------------------------------------------

//Grade de pontos dentro do polígono; w = metros de grade em volta do ponto (peso das casas)
function buildAutoDesignGrid(polyXY) {
    const xs = polyXY.map(p => p[0]), ys = polyXY.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const box = (maxX - minX) * (maxY - minY);
    const step = Math.max(AUTO_DESIGN_GRID_M, Math.sqrt(box / AUTO_DESIGN_MAX_POINTS));
    const nodes = [];
    for (let gx = 0; minX + gx * step <= maxX; gx++) {
        for (let gy = 0; minY + gy * step <= maxY; gy++) {
            const x = minX + gx * step + step / 2, y = minY + gy * step + step / 2;
            if (pointInPolygonXY([x, y], polyXY)) nodes.push({ x, y, w: step });
        }
    }
    return nodes;
}

//Demanda: casas marcadas no mapa > pontos de rua (OSRM) > grade. Locais: postes > ruas > casas > grade.
//exclusions = trechos marcados como "sem casas" na prévia ({ south, north, west, east }).
//Postes que valem: na rua do mapa (até 15 m) ou numa fileira de 3+ postes fora do mapa (vãos até 130 m, estrada que
//falta no mapa; esses ganham .unmapped). Poste solto ou em dupla fora da rua fica de fora (dentro do lote).
function classifyAutoDesignPoles(poleSites, streetIndex) {
    const C = AUTO_DESIGN_UNMAPPED_SPAN_M;
    const off = poleSites.filter(p => streetIndex.distToStreet(p.x, p.y) > AUTO_DESIGN_STREET_TOL_M);
    const cells = new Map();
    off.forEach((p, i) => { const k = `${Math.floor(p.x / C)},${Math.floor(p.y / C)}`; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(i); });
    const parent = off.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    off.forEach((p, i) => {
        const cx = Math.floor(p.x / C), cy = Math.floor(p.y / C);
        for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
            for (const j of cells.get(`${gx},${gy}`) || []) if (j > i && Math.hypot(off[j].x - p.x, off[j].y - p.y) <= C) parent[find(i)] = find(j);
        }
    });
    const size = new Map();
    off.forEach((_, i) => size.set(find(i), (size.get(find(i)) || 0) + 1));
    const keep = new Set(off.filter((_, i) => size.get(find(i)) >= AUTO_DESIGN_UNMAPPED_LINE));
    keep.forEach(p => { p.unmapped = true; });
    const offSet = new Set(off);
    const kept = poleSites.filter(p => !offSet.has(p) || keep.has(p));
    return { kept, dropped: poleSites.length - kept.length, unmapped: keep.size };
}

//Cada CTO existente fica com as casas no raio dela, das mais perto para as mais longe, até lotar. Casa (ou ponto de
//rua) atendida em parte fica com o resto para as CTOs novas. Sobra de menos de 1 cliente na área toda = tudo atendido.
function serveAutoDesignDemandByExisting(demand, existing, radius, clientsPerWeight) {
    if (!existing.length || !(clientsPerWeight > 0)) return { demand, existing };
    const left = demand.map(n => n.w * clientsPerWeight);
    const room = existing.map(e => e.usable);
    const pairs = [];
    demand.forEach((n, i) => existing.forEach((e, j) => {
        const d = Math.hypot(n.x - e.x, n.y - e.y);
        if (d <= radius) pairs.push([d, i, j]);
    }));
    pairs.sort((a, b) => a[0] - b[0]);
    pairs.forEach(([, i, j]) => {
        const take = Math.min(left[i], room[j]);
        if (!(take > 0)) return;
        left[i] -= take;
        room[j] -= take;
        existing[j].served += take;
    });
    const rest = left.reduce((s, c) => s + c, 0);
    const residual = rest < 1 ? [] : demand.map((n, i) => ({ ...n, w: left[i] / clientsPerWeight })).filter((n, i) => left[i] > 0.01);
    return { demand: residual, existing };
}

function buildAutoDesignModel(polygonPath, params, inputs = {}) {
    const { streets = null, streetLines = null, houseMarkers = [], poleMarkers = [], exclusions = [] } = inputs;
    const proj = createAutoDesignProjection(polygonPath);
    const streetIndex = inputs.cachedStreetIndex !== undefined ? inputs.cachedStreetIndex : (streetLines?.length ? buildAutoDesignStreetIndex(streetLines, proj) : null);
    const polyXY = polygonPath.map(p => proj.toXY(p.lat, p.lng));
    const xyOf = (lat, lng) => { const [x, y] = proj.toXY(lat, lng); return { x, y }; };
    const xyOfMarker = (m) => { const pos = m.marker.getPosition(); return xyOf(pos.lat(), pos.lng()); };
    const rects = exclusions.map(r => {
        const a = proj.toXY(r.south, r.west), b = proj.toXY(r.north, r.east);
        return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    });
    const keep = (p) => !rects.some(([x0, y0, x1, y1]) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
    const streetNodes = (streets?.points || []).map(p => ({ ...xyOf(p.lat, p.lng), w: p.w }));
    let demand, demandKind;
    if (params.useHouses && houseMarkers.length >= AUTO_DESIGN_MIN_HOUSE_MARKERS) {
        demand = houseMarkers.map(m => ({ ...xyOfMarker(m), w: getAutoDesignHouseCount(m) }));
        demandKind = 'houses';
    } else if (streetNodes.length) {
        demand = streetNodes;
        demandKind = 'streets';
    } else {
        demand = buildAutoDesignGrid(polyXY);
        demandKind = 'grid';
    }
    let sites, siteKind, polesOffStreet = 0, polesUnmapped = 0;
    //Poste a 15–40 m de uma rua conhecida está dentro do lote (ou o cadastro errou) e poste sozinho longe de tudo também:
    //não recebem caixa nem cabo, o cabo passaria sobre casas. Já uma fileira de postes longe das ruas do mapa é uma rua
    //que falta no mapa: vale.
    let poleSites = poleMarkers.map(m => ({ ...xyOfMarker(m), pole: true }));
    if (streetIndex) {
        const sorted = classifyAutoDesignPoles(poleSites, streetIndex);
        poleSites = sorted.kept;
        polesOffStreet = sorted.dropped;
        polesUnmapped = sorted.unmapped;
    }
    if (params.usePoles && poleSites.length >= AUTO_DESIGN_MIN_POLES) {
        sites = poleSites;
        siteKind = 'poles';
    } else if (streetNodes.length) {
        sites = streetNodes.map(n => ({ x: n.x, y: n.y }));
        siteKind = 'streets';
    } else {
        sites = demand.map(n => ({ x: n.x, y: n.y }));
        siteKind = demandKind;
    }
    //Casas também nas ruas que faltam no mapa: cada poste dali pesa o mesmo que um poste das ruas conhecidas
    if (siteKind === 'poles' && demandKind === 'streets' && polesUnmapped) {
        const mapped = sites.filter(p => !p.unmapped).length;
        const w = mapped ? demand.reduce((sum, n) => sum + n.w, 0) / mapped : AUTO_DESIGN_GRID_M;
        demand = demand.concat(sites.filter(p => p.unmapped).map(p => ({ x: p.x, y: p.y, w })));
    }
    demand = demand.filter(keep);
    sites = sites.filter(keep);
    //Trecho entre dois postes, um deles em rua que falta no mapa: não dá para conferir pela rua, vale o vão do poste
    const poleKey = (x, y) => `${Math.round(x)},${Math.round(y)}`;
    const poleAt = (set, [x, y]) => {
        const rx = Math.round(x), ry = Math.round(y);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (set.has(`${rx + dx},${ry + dy}`)) return true;
        return false;
    };
    const allPoles = new Set(siteKind === 'poles' ? sites.map(p => poleKey(p.x, p.y)) : []);
    const offMapPoles = new Set(siteKind === 'poles' ? sites.filter(p => p.unmapped).map(p => poleKey(p.x, p.y)) : []);
    const onPolesOffMap = (a, b) => offMapPoles.size > 0 && poleAt(allPoles, a) && poleAt(allPoles, b) && (poleAt(offMapPoles, a) || poleAt(offMapPoles, b));
    const totalWeight = demand.reduce((s, n) => s + n.w, 0);
    //Com as casas do mapa, a quantidade é a das casas que sobraram (fora dos trechos sem casas)
    const allHouses = demandKind === 'houses' ? totalWeight : Number(params.houses) || 0;
    const housesPerWeight = totalWeight ? allHouses / totalWeight : 0;
    //CTOs que já existem atendem primeiro: o que sobra é a demanda das CTOs novas
    const served = serveAutoDesignDemandByExisting(demand, getAutoDesignActiveExisting(inputs.existingCtos, params).map(e => ({
        ...xyOfMarker(e.marker), markerInfo: e.marker, distance: e.distance, wired: isAutoDesignCtoWired(e.marker), served: 0,
        ...getAutoDesignExistingCapacity(e.marker, params),
    })), getAutoDesignCoverRadius(params), housesPerWeight * params.occupancy / 100);
    demand = served.demand;
    const houses = demand.reduce((s, n) => s + n.w, 0) * housesPerWeight;
    return {
        proj, polyXY, demand, sites, demandKind, siteKind, totalWeight, houses, allHouses, housesPerWeight,
        existing: served.existing, existingClients: served.existing.reduce((s, e) => s + e.served, 0),
        coverRadius: getAutoDesignCoverRadius(params),
        ctoSpacing: getAutoDesignCtoSpacing(params),
        streetsOk: !!streets,
        streetIndex, polesOffStreet, polesUnmapped: siteKind === 'poles' ? sites.filter(p => p.unmapped).length : 0, onPolesOffMap,
        poleGraph: siteKind === 'poles' && !(inputs.cachedPoleGraph?.sites === sites.length) ? buildAutoDesignPoleGraph(sites, streetIndex) : null,
    };
}

function nearestAutoDesignSite(sites, [x, y], candidates = null) {
    let best = -1, bestD = Infinity;
    const visit = (i) => {
        const d = (sites[i].x - x) ** 2 + (sites[i].y - y) ** 2;
        if (d < bestD) { bestD = d; best = i; }
    };
    if (candidates) candidates.forEach(visit);
    else for (let i = 0; i < sites.length; i++) visit(i);
    return best;
}

// ---------------------------------------------------------------
// Postes: rede de poste em poste que segue a fiação (e caminho mais curto por ela)
// ---------------------------------------------------------------

const AUTO_DESIGN_POLE_BRIDGE_M = 150; //Trecho sem poste até 150 m (rural, praça) ainda liga dois grupos de postes

//Liga só postes vizinhos de verdade: até ~1,6 vão e sem outro poste "no meio" (grafo de vizinhança relativa).
//Com o traçado das ruas (streets), um trecho só vale se ficar todo sobre a rua/calçada: o cabo nunca corta casas.
//Grupos que ficaram separados são unidos pelo menor trecho válido até 150 m. Usa grade espacial: milhares de postes da
//BDGD numa área continuam rápidos.
function buildAutoDesignPoleGraph(sites, streets = null) {
    const n = sites.length;
    const d = (i, j) => Math.hypot(sites[i].x - sites[j].x, sites[i].y - sites[j].y);
    const makeGrid = (cell) => {
        const cells = new Map();
        const key = (cx, cy) => `${cx},${cy}`;
        sites.forEach((p, i) => {
            const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell));
            let list = cells.get(k);
            if (!list) cells.set(k, list = []);
            list.push(i);
        });
        //Postes a até "radius" do poste i (inclui i)
        return (i, radius) => {
            const p = sites[i], r = Math.ceil(radius / cell);
            const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
            const out = [];
            for (let gx = cx - r; gx <= cx + r; gx++) {
                for (let gy = cy - r; gy <= cy + r; gy++) {
                    const list = cells.get(key(gx, gy));
                    if (list) for (const j of list) if (d(i, j) <= radius) out.push(j);
                }
            }
            return out;
        };
    };
    //Vão máximo: o maior vão real da rede (até 130 m); a regra de "nenhum poste no meio" corta os atalhos
    const link = AUTO_DESIGN_UNMAPPED_SPAN_M;
    const near = makeGrid(link);
    const validCache = new Map();
    const valid = (i, j) => {
        if (!streets) return true;
        const key = i < j ? i * n + j : j * n + i;
        let ok = validCache.get(key);
        if (ok === undefined) {
            const a = [sites[i].x, sites[i].y], b = [sites[j].x, sites[j].y];
            //Poste em rua que falta no mapa: vão curto de poste em poste, sem atravessar rio
            //Nas ruas do mapa o cabo segue a rua (o vão entre os postes tem de ficar sobre ela); em estrada que falta no
            //mapa (zona rural, loteamento novo) os postes são a referência: vão de poste em poste, sem atravessar água
            ok = sites[i].unmapped || sites[j].unmapped
                ? d(i, j) <= AUTO_DESIGN_UNMAPPED_SPAN_M && !streets.crossesWater(a, b)
                : streets.segmentOnStreets(a, b);
            validCache.set(key, ok);
        }
        return ok;
    };
    const adj = sites.map(() => []);
    const parent = Int32Array.from({ length: n }, (_, i) => i);
    const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    const join = (i, j, w) => { adj[i].push([j, w]); adj[j].push([i, w]); parent[find(i)] = find(j); };
    for (let i = 0; i < n; i++) {
        const around = near(i, link);
        for (const j of around) {
            if (j <= i) continue;
            const dij = d(i, j);
            if (!valid(i, j)) continue;
            //Outro poste mais perto dos dois (e ligado a eles pela rua) = este trecho pula um poste: fica de fora
            if (around.some(k => k !== i && k !== j && d(i, k) < dij && d(j, k) < dij && valid(i, k) && valid(j, k))) continue;
            join(i, j, dij);
        }
    }
    //Grupos soltos: liga pelo trecho mais curto entre eles (até 150 m), do menor para o maior
    const bridges = [];
    const far = makeGrid(AUTO_DESIGN_POLE_BRIDGE_M);
    for (let i = 0; i < n; i++) {
        for (const j of far(i, AUTO_DESIGN_POLE_BRIDGE_M)) if (j > i && find(i) !== find(j)) bridges.push([d(i, j), i, j]);
    }
    bridges.sort((a, b) => a[0] - b[0]);
    //Poste de rua que falta no mapa: o grupo dele se emenda no resto (vão até 150 m) se não atravessar rio
    const offMapBridge = (i, j) => !!streets && (sites[i].unmapped || sites[j].unmapped)
        && !streets.crossesWater([sites[i].x, sites[i].y], [sites[j].x, sites[j].y]);
    for (const [w, i, j] of bridges) if (find(i) !== find(j) && (valid(i, j) || offMapBridge(i, j))) join(i, j, w);
    //Ainda separados por rio/lago: emenda pelo vão mais curto entre postes (até 150 m), como a rede elétrica atravessa.
    //Custa caro na rota (só é usado sem outro caminho) e a prévia avisa.
    if (streets) {
        for (const [w, i, j] of bridges) {
            if (find(i) !== find(j) && streets.crossesWater([sites[i].x, sites[i].y], [sites[j].x, sites[j].y])) join(i, j, w + AUTO_DESIGN_WATER_PENALTY_M);
        }
    }
    return { adj, link, cache: new Map() };
}

//Dijkstra a partir de um poste (com cache): { dist, prev }
function getAutoDesignPoleTree(graph, source) {
    let tree = graph.cache.get(source);
    if (tree) return tree;
    const n = graph.adj.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    dist[source] = 0;
    const heap = [[0, source]];
    const swap = (i, j) => { const t = heap[i]; heap[i] = heap[j]; heap[j] = t; };
    const push = (item) => {
        heap.push(item);
        for (let i = heap.length - 1; i > 0;) {
            const p = (i - 1) >> 1;
            if (heap[p][0] <= heap[i][0]) break;
            swap(p, i);
            i = p;
        }
    };
    const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length) {
            heap[0] = last;
            for (let i = 0; ;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                swap(m, i);
                i = m;
            }
        }
        return top;
    };
    while (heap.length) {
        const [du, u] = pop();
        if (du > dist[u]) continue;
        graph.adj[u].forEach(([v, w]) => {
            if (du + w < dist[v]) {
                dist[v] = du + w;
                prev[v] = u;
                push([dist[v], v]);
            }
        });
    }
    tree = { dist, prev };
    graph.cache.set(source, tree);
    return tree;
}

// ---------------------------------------------------------------
// CTOs: k-médias com o centro sempre num local permitido (poste, rua)
// ---------------------------------------------------------------

function placeAutoDesignCtos(model, candidates, k, seed = 0) {
    const { demand, sites } = model;
    k = Math.max(1, Math.min(k, candidates.length));
    let sw = 0, sx = 0, sy = 0;
    demand.forEach(n => { sw += n.w; sx += n.x * n.w; sy += n.y * n.w; });
    //Começo: o local do meio (ou, com seed, a casa mais na ponta de uma direção) e depois sempre o mais longe
    //(das casas) dos já escolhidos
    let start = [sx / sw, sy / sw];
    if (seed > 0) {
        const angle = seed * 2.4, ux = Math.cos(angle), uy = Math.sin(angle);
        const edge = demand.reduce((best, n) => (n.x * ux + n.y * uy > best.x * ux + best.y * uy ? n : best), demand[0]);
        start = [edge.x, edge.y];
    }
    let centers = [nearestAutoDesignSite(sites, start, candidates)];
    const d2 = (n, c) => (n.x - sites[c].x) ** 2 + (n.y - sites[c].y) ** 2;
    const minD = demand.map(n => d2(n, centers[0]));
    while (centers.length < k) {
        let far = 0;
        minD.forEach((d, j) => { if (d > minD[far]) far = j; });
        if (!(minD[far] > 0)) break;
        const site = nearestAutoDesignSite(sites, [demand[far].x, demand[far].y], candidates);
        if (centers.includes(site)) { minD[far] = 0; continue; }
        centers.push(site);
        demand.forEach((n, j) => { minD[j] = Math.min(minD[j], d2(n, site)); });
    }
    const assign = new Int32Array(demand.length);
    for (let iter = 0; iter < 30; iter++) {
        demand.forEach((n, j) => {
            let best = 0, bestD = Infinity;
            centers.forEach((c, ci) => { const d = d2(n, c); if (d < bestD) { bestD = d; best = ci; } });
            assign[j] = best;
        });
        const acc = centers.map(() => ({ w: 0, x: 0, y: 0 }));
        demand.forEach((n, j) => {
            const a = acc[assign[j]];
            a.w += n.w; a.x += n.x * n.w; a.y += n.y * n.w;
        });
        const taken = new Set();
        const next = acc.map((a, ci) => {
            let site = a.w ? nearestAutoDesignSite(sites, [a.x / a.w, a.y / a.w], candidates) : centers[ci];
            if (taken.has(site)) site = centers[ci];
            taken.add(site);
            return site;
        });
        const changed = next.some((c, ci) => c !== centers[ci]);
        centers = next;
        if (!changed) break;
    }
    centers = enforceAutoDesignCtoSpacing(model, centers, candidates);
    return evaluateAutoDesignCenters(model, centers.map(c => sites[c]), centers);
}

//Casas (peso) de cada CTO pela caixa mais perto e quanto da área fica no alcance
function evaluateAutoDesignCenters(model, points, centers = null) {
    const load = points.map(() => 0);
    let covered = 0, total = 0;
    model.demand.forEach(n => {
        let best = 0, bestD = Infinity;
        points.forEach((c, ci) => {
            const d = (n.x - c.x) ** 2 + (n.y - c.y) ** 2;
            if (d < bestD) { bestD = d; best = ci; }
        });
        if (!points.length) return;
        load[best] += n.w;
        total += n.w;
        if (Math.sqrt(bestD) <= (model.coverRadius || AUTO_DESIGN_COVER_M)) covered += n.w;
    });
    return { centers, load, coverage: total ? covered / total : 1 };
}

//Raio da CTO: até onde o drop chega (linha reta); define quantas caixas são precisas para cobrir a área
const getAutoDesignCoverRadius = (params) => Math.min(AUTO_DESIGN_COVER_MAX, Math.max(AUTO_DESIGN_COVER_MIN, parseInt(params?.coverRadius, 10) || AUTO_DESIGN_COVER_M));

//Distância mínima entre duas CTOs na mesma rua, em linha reta (0 = sem regra: vale só o raio)
const getAutoDesignCtoSpacing = (params) => {
    const value = parseInt(params?.ctoSpacing, 10);
    return Number.isFinite(value) && value > 0 ? Math.min(AUTO_DESIGN_COVER_MAX * 2, Math.max(10, value)) : 0;
};

//Duas caixas "na mesma rua" e perto demais: a reta entre elas segue a rua (sem o traçado das ruas, qualquer par)
function areAutoDesignBoxesTooClose(model, a, b, spacing = model.ctoSpacing) {
    if (!(spacing > 0)) return false;
    if (Math.hypot(a.x - b.x, a.y - b.y) >= spacing) return false;
    return !model.streetIndex || model.streetIndex.segmentOnStreets([a.x, a.y], [b.x, b.y]);
}

//Distância entre CTOs: as que atendem mais casas ficam; uma CTO perto demais de outra na mesma rua vai para o
//local permitido mais próximo que respeita a distância (até o raio dela) ou sai
function enforceAutoDesignCtoSpacing(model, centers, candidates) {
    const spacing = model.ctoSpacing;
    if (!(spacing > 0) || centers.length < 2) return centers;
    const { sites } = model;
    const load = evaluateAutoDesignCenters(model, centers.map(c => sites[c])).load;
    const order = centers.map((c, i) => [c, load[i]]).sort((a, b) => b[1] - a[1]).map(([c]) => c);
    const kept = [];
    const fits = (site) => kept.every(k => !areAutoDesignBoxesTooClose(model, sites[site], sites[k]))
        && model.existing.every(e => !areAutoDesignBoxesTooClose(model, sites[site], e));
    order.forEach(c => {
        if (fits(c)) { kept.push(c); return; }
        const reach = Math.max(spacing, model.coverRadius);
        let best = -1, bestD = Infinity;
        candidates.forEach(i => {
            if (kept.includes(i)) return;
            const d = Math.hypot(sites[i].x - sites[c].x, sites[i].y - sites[c].y);
            if (d < bestD && d <= reach && fits(i)) { best = i; bestD = d; }
        });
        if (best >= 0) kept.push(best);
    });
    return kept;
}

//CTOs novas perto demais de outra (nova ou que já existe) na mesma rua: acontece quando a caixa é movida no mapa
function countAutoDesignTooCloseCtos(model, ctos) {
    if (!(model.ctoSpacing > 0)) return 0;
    return ctos.filter((c, i) => ctos.some((o, j) => j !== i && areAutoDesignBoxesTooClose(model, c, o))
        || model.existing.some(e => areAutoDesignBoxesTooClose(model, c, e))).length;
}

//Portas usadas por CTO: a ocupação máxima deixa portas livres para crescer
const getAutoDesignUsablePorts = (params) => Math.max(1, Math.floor(params.ports * (Number(params.maxFill) || 100) / 100));

//Quantas CTOs: pelas portas e, se precisar, mais algumas até cobrir a área e nenhuma passar das portas
function chooseAutoDesignCtos(model, candidates, params) {
    const clients = Math.ceil(model.houses * params.occupancy / 100);
    const usable = getAutoDesignUsablePorts(params);
    const byPorts = Math.max(1, Math.ceil(clients / usable));
    const toClients = (w) => w * model.housesPerWeight * params.occupancy / 100;
    let k = byPorts;
    let placement = null;
    let limitedTries = 0;
    for (let tries = 0; tries < 40; tries++) {
        const previous = placement;
        placement = placeAutoDesignCtos(model, candidates, k, params.layoutSeed || 0);
        //Distância entre CTOs não deixa caber mais caixas: pedir mais não adianta
        if (placement.centers.length < k) {
            limitedTries++;
            placement.spacingLimited = true;
            if (previous && placement.coverage <= previous.coverage + 0.001) { placement = previous.coverage >= placement.coverage ? { ...previous, spacingLimited: true } : placement; break; }
            if (limitedTries >= 3) break;
        }
        //A conta de clientes por caixa é estimativa: aceita poucas caixas um pouco acima das portas
        const clientsPerCto = placement.load.map(toClients);
        const over = clientsPerCto.filter(c => c > usable + 0.5).length;
        const fits = Math.max(...clientsPerCto) <= usable * 1.25 && over <= Math.floor(k * 0.15);
        const done = placement.coverage >= AUTO_DESIGN_MIN_COVERAGE && fits;
        if (done || k >= Math.min(candidates.length, AUTO_DESIGN_MAX_CTOS)) break;
        k = Math.min(candidates.length, AUTO_DESIGN_MAX_CTOS, k + Math.max(1, Math.ceil(k * 0.08)));
    }
    return { ...placement, byPorts, clients };
}

//k-médias simples em pontos [x, y] (grupos de CTOs, uma CEO por grupo)
function clusterAutoDesignPoints(points, k) {
    if (k <= 1 || points.length <= k) return points.map((_, i) => Math.min(i, k - 1));
    const centers = [points[0]];
    while (centers.length < k) {
        let far = 0, farD = -1;
        points.forEach((p, i) => {
            const d = Math.min(...centers.map(c => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2));
            if (d > farD) { farD = d; far = i; }
        });
        centers.push(points[far]);
    }
    let assign = points.map(() => 0);
    for (let iter = 0; iter < 25; iter++) {
        assign = points.map(p => {
            let best = 0, bestD = Infinity;
            centers.forEach((c, ci) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2; if (d < bestD) { bestD = d; best = ci; } });
            return best;
        });
        centers.forEach((_, ci) => {
            const members = points.filter((__, i) => assign[i] === ci);
            if (members.length) centers[ci] = [members.reduce((s, p) => s + p[0], 0) / members.length, members.reduce((s, p) => s + p[1], 0) / members.length];
        });
    }
    return assign;
}

function getAutoDesignFiberFor(need, minimum) {
    const min = parseInt(String(minimum).replace(/\D/g, ''), 10) || 12;
    const fiber = AUTO_DESIGN_FIBERS.find(f => f >= Math.max(need, min)) || AUTO_DESIGN_FIBERS[AUTO_DESIGN_FIBERS.length - 1];
    return `FO-${String(fiber).padStart(2, '0')}`;
}

const getAutoDesignFiberCount = (fiber) => parseInt(String(fiber).replace(/\D/g, ''), 10) || 12;

// ---------------------------------------------------------------
// Caixas da prévia
// ---------------------------------------------------------------

function getAutoDesignProjectId(polygon) {
    return document.getElementById(polygon.folderId)?.closest('.folder')?.querySelector('.folder-title')?.dataset.folderId || null;
}

function getNextAutoDesignNumber(projectId, type) {
    let max = 0;
    markers.forEach(m => {
        if (m.type !== type || (projectId && getItemProjectId(m) !== projectId)) return;
        const match = /(\d+)\s*$/.exec(m.name || '');
        if (match) max = Math.max(max, parseInt(match[1], 10));
    });
    return max + 1;
}

const formatAutoDesignName = (type, n) => `${type}-${String(n).padStart(2, '0')}`;

function getAutoDesignStartOptions(polygon) {
    const projectId = getAutoDesignProjectId(polygon);
    const center = getAutoDesignPolygonCenter(polygon);
    const spherical = google.maps.geometry.spherical;
    return markers
        .filter(m => (m.type === 'POP' || m.type === 'CEO') && m.marker?.getPosition && (!projectId || getItemProjectId(m) === projectId))
        .map(m => ({ marker: m, distance: spherical.computeDistanceBetween(center, m.marker.getPosition()) }))
        .sort((a, b) => (a.marker.type === b.marker.type ? a.distance - b.distance : a.marker.type === 'POP' ? -1 : 1));
}

function getAutoDesignPolygonPath(polygon) {
    return polygon.polygonObject.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() }));
}

function getAutoDesignPolygonCenter(polygon) {
    const path = getAutoDesignPolygonPath(polygon);
    return new google.maps.LatLng(
        path.reduce((s, p) => s + p.lat, 0) / path.length,
        path.reduce((s, p) => s + p.lng, 0) / path.length,
    );
}

//Caixa da prévia: posição no mapa e no plano local; pole = índice do poste onde ela está (ou null)
function makeAutoDesignBox(model, type, xy, extra = {}) {
    const p = model.proj.toLatLng([xy.x, xy.y]);
    const box = { type, name: '', position: new google.maps.LatLng(p.lat, p.lng), x: xy.x, y: xy.y, isNew: true, pole: null, ...extra };
    if (model.poleGraph) {
        const site = nearestAutoDesignSite(model.sites, [xy.x, xy.y]);
        if (site >= 0 && Math.hypot(model.sites[site].x - xy.x, model.sites[site].y - xy.y) < 0.5) box.pole = site;
    }
    return box;
}

function makeAutoDesignExistingBox(model, markerInfo) {
    const pos = markerInfo.marker.getPosition();
    const [x, y] = model.proj.toXY(pos.lat(), pos.lng());
    return { type: markerInfo.type, name: markerInfo.name, position: pos, x, y, isNew: false, existing: markerInfo, pole: null };
}

//Ponto clicado/arrastado na prévia → poste ou ponto de rua mais perto (até 60 m); senão fica onde está
function snapAutoDesignPoint(model, latLng) {
    const [x, y] = model.proj.toXY(latLng.lat(), latLng.lng());
    if (model.siteKind === 'poles' || model.siteKind === 'streets') {
        const site = nearestAutoDesignSite(model.sites, [x, y]);
        if (site >= 0 && Math.hypot(model.sites[site].x - x, model.sites[site].y - y) <= AUTO_DESIGN_EDIT_SNAP_M) return { x: model.sites[site].x, y: model.sites[site].y };
    }
    return { x, y };
}

const getAutoDesignPosKey = (box) => `${box.position.lat().toFixed(6)},${box.position.lng().toFixed(6)}`;

// ---------------------------------------------------------------
// Montagem do pré-projeto (sem tocar no mapa)
// ---------------------------------------------------------------

//Monta caixas e rede pela área; startMarker = POP/CEO de onde a rede sai (ou null).
//inputs: { streets, houseMarkers, poleMarkers, exclusions }. Os cabos saem em linha reta: routeAutoDesignCables
//traça pelas ruas (ou de poste em poste).
async function buildAutoDesignPlan(polygonPath, params, startMarker, names, inputs = {}, { isCurrent = () => true, roads = null } = {}) {
    const model = buildAutoDesignModel(polygonPath, params, inputs);
    if (model.siteKind === 'poles' && inputs.cachedPoleGraph?.sites === model.sites.length) model.poleGraph = inputs.cachedPoleGraph.graph;
    if (model.existing.length && !model.demand.length) {
        const clients = Math.ceil(model.allHouses * params.occupancy / 100);
        return { error: `As ${model.existing.length} CTO(s) que já estão na área dão conta dos ≈ ${clients.toLocaleString('pt-BR')} clientes previstos: não precisa de CTO nova. Aumente a penetração ou desmarque "Considerar as CTOs que já estão no mapa".` };
    }
    if (model.sites.length < 4 || !model.demand.length) return { error: 'A área é pequena demais (ou ficou sem casas) para distribuir caixas. Desenhe um polígono maior.' };
    const startPos = startMarker?.marker?.getPosition?.();
    const centroid = model.polyXY.reduce((s, p) => [s[0] + p[0] / model.polyXY.length, s[1] + p[1] / model.polyXY.length], [0, 0]);
    const rootIsNew = !startMarker || startMarker.type === 'POP';
    let root;
    if (rootIsNew) {
        const rootSite = nearestAutoDesignSite(model.sites, startPos ? model.proj.toXY(startPos.lat(), startPos.lng()) : centroid);
        root = makeAutoDesignBox(model, 'CEO', model.sites[rootSite]);
    } else {
        root = makeAutoDesignExistingBox(model, startMarker);
    }
    //CTO grudada na CEO não ajuda: as casas dali ficam com a CTO mais perto
    //Nem em cima de uma CTO que já existe
    const candidates = model.sites.map((_, i) => i).filter(i => Math.hypot(model.sites[i].x - root.x, model.sites[i].y - root.y) > 25
        && model.existing.every(e => Math.hypot(model.sites[i].x - e.x, model.sites[i].y - e.y) > AUTO_DESIGN_EXISTING_GAP_M
            && !areAutoDesignBoxesTooClose(model, model.sites[i], e)));
    if (!candidates.length) return { error: 'A área é pequena demais para distribuir caixas. Desenhe um polígono maior.' };
    const chosen = chooseAutoDesignCtos(model, candidates, params);
    const ctos = chosen.centers.map(site => makeAutoDesignBox(model, 'CTO', model.sites[site]));
    const plan = {
        model,
        params: { ...params },
        names,
        start: startMarker && startMarker.type === 'POP' ? makeAutoDesignExistingBox(model, startMarker) : null,
        ceos: placeAutoDesignCeos(model, root, ctos, params),
        ctos,
        cables: [],
        roads: roads || new Map(),
        routes: new Map(),
        byPorts: chosen.byPorts,
        clients: chosen.clients,
        stats: { snapped: 0, straight: 0, noStreets: !model.streetsOk, tooMany: false, spacingLimited: !!chosen.spacingLimited },
    };
    plan.root = plan.ceos[0];
    await ensureAutoDesignRoadDistances(plan);
    if (!isCurrent()) return { cancelled: true };
    rebuildAutoDesignNetwork(plan);
    return plan;
}

//Uma CEO a cada "CTOs por CEO": a primeira (raiz) perto de onde a rede chega; as outras no meio do seu grupo
function placeAutoDesignCeos(model, root, ctos, params) {
    const cap = params.ceoMax > 0 ? params.ceoMax : Infinity;
    const groups = Math.max(1, Math.ceil(ctos.length / cap));
    if (groups === 1) return [root];
    const assign = clusterAutoDesignPoints(ctos.map(c => [c.x, c.y]), groups);
    const centers = Array.from({ length: groups }, (_, g) => {
        const members = ctos.filter((__, i) => assign[i] === g);
        return members.length ? { x: members.reduce((s, c) => s + c.x, 0) / members.length, y: members.reduce((s, c) => s + c.y, 0) / members.length } : null;
    }).filter(Boolean);
    let rootGroup = 0;
    centers.forEach((c, g) => { if (Math.hypot(c.x - root.x, c.y - root.y) < Math.hypot(centers[rootGroup].x - root.x, centers[rootGroup].y - root.y)) rootGroup = g; });
    const others = centers.filter((_, g) => g !== rootGroup).map(c => {
        //Local mais perto do meio do grupo, sem cair em cima de uma CTO
        const order = model.sites.map((s, i) => [i, (s.x - c.x) ** 2 + (s.y - c.y) ** 2]).sort((a, b) => a[1] - b[1]);
        const free = order.find(([i]) => ctos.every(cto => Math.hypot(cto.x - model.sites[i].x, cto.y - model.sites[i].y) >= 10)) || order[0];
        return makeAutoDesignBox(model, 'CEO', model.sites[free[0]]);
    });
    return [root, ...others];
}

const getAutoDesignNetworkBoxes = (plan) => [...plan.ceos, ...plan.ctos];

//Distâncias pela rua entre as caixas: no traçado do OpenStreetMap (aqui mesmo, sem servidor) ou, sem ele, na
//tabela do OSRM. Só calcula as linhas que faltam: depois de mexer numa caixa da prévia, é uma conta pequena.
async function ensureAutoDesignRoadDistances(plan) {
    const boxes = getAutoDesignNetworkBoxes(plan);
    if (boxes.length < 2) return;
    const keys = boxes.map(getAutoDesignPosKey);
    //Caixa sem linha na tabela = nova (ou movida); a linha dela completa as outras nos dois sentidos
    const missing = keys.map((k, i) => i).filter(i => !plan.roads.has(keys[i]));
    if (!missing.length) return;
    const streets = plan.model.streetIndex;
    if (streets) {
        const row = (a, b, d) => {
            if (!plan.roads.has(a)) plan.roads.set(a, new Map());
            plan.roads.get(a).set(b, d);
        };
        missing.forEach(i => {
            const d = streets.distancesFrom([boxes[i].x, boxes[i].y], boxes.map(b => [b.x, b.y]));
            keys.forEach((key, j) => { row(keys[i], key, d[j]); row(key, keys[i], d[j]); });
        });
        return;
    }
    if (!plan.model.streetsOk || boxes.length > AUTO_DESIGN_TABLE_MAX) return;
    const all = missing.length > boxes.length / 2;
    const query = all ? 'annotations=distance' : `sources=${missing.join(';')}&annotations=distance`;
    const data = await fetchAutoDesignOsrm('table', boxes.map(b => ({ lat: b.position.lat(), lng: b.position.lng() })), query);
    if (!data?.distances) return;
    const set = (a, b, value) => {
        const d = Number.isFinite(value) ? value : Infinity;
        if (!plan.roads.has(a)) plan.roads.set(a, new Map());
        const prev = plan.roads.get(a).get(b);
        plan.roads.get(a).set(b, prev === undefined ? d : Math.min(prev, d));
    };
    (all ? keys.map((_, i) => i) : missing).forEach((si, row) => {
        keys.forEach((key, j) => {
            const value = data.distances[row]?.[j];
            set(keys[si], key, value);
            set(key, keys[si], value);
        });
    });
}

//Distância para ligar duas caixas: de poste em poste > pela rua > linha reta.
//Sem rota entre as duas (rio, rua sem saída) fica bem cara, para a árvore preferir outro caminho.
function getAutoDesignBoxDistance(plan, a, b) {
    const straight = Math.hypot(a.x - b.x, a.y - b.y);
    const graph = plan.model.poleGraph;
    const pa = getAutoDesignBoxPole(plan, a), pb = getAutoDesignBoxPole(plan, b);
    if (graph && pa != null && pb != null) {
        const d = getAutoDesignPoleTree(graph, pa).dist[pb];
        if (Number.isFinite(d)) return Math.max(d, straight);
    }
    const road = plan.roads.get(getAutoDesignPosKey(a))?.get(getAutoDesignPosKey(b));
    if (road === undefined) return straight;
    return Number.isFinite(road) ? Math.max(road, straight) : straight * 4 + 500;
}

//Árvore de Prim a partir de nodes[0]: cada caixa liga na mais perto que já está na rede.
//Devolve children (índice → filhos em ordem de distância) e treeDist.
function buildAutoDesignTree(nodes, dist) {
    const n = nodes.length;
    const best = nodes.map((_, i) => ({ d: i ? dist(0, i) : 0, parent: 0 }));
    const inTree = nodes.map((_, i) => i === 0);
    const treeDist = nodes.map(() => 0);
    const children = nodes.map(() => []);
    for (let added = 1; added < n; added++) {
        let pick = -1;
        for (let i = 0; i < n; i++) if (!inTree[i] && (pick < 0 || best[i].d < best[pick].d)) pick = i;
        inTree[pick] = true;
        treeDist[pick] = treeDist[best[pick].parent] + best[pick].d;
        children[best[pick].parent].push(pick);
        for (let i = 0; i < n; i++) {
            if (inTree[i]) continue;
            const d = dist(pick, i);
            if (d < best[i].d) best[i] = { d, parent: pick };
        }
    }
    children.forEach(list => list.sort((a, b) => treeDist[a] - treeDist[b]));
    return { children, treeDist };
}

//Refaz a rede a partir das posições das caixas: casas de cada CTO, CTO → CEO, árvores, nomes, fibras,
//cabos e fusões. Chamada ao gerar e a cada edição da prévia.
function rebuildAutoDesignNetwork(plan) {
    const { model, params, ceos, ctos, names } = plan;
    const dist = (a, b) => getAutoDesignBoxDistance(plan, a, b);
    const levels = params.levels === 2 ? 2 : 1;
    const usable = getAutoDesignUsablePorts(params);
    //Casas de cada CTO (a mais perto) e cobertura
    const evaluation = evaluateAutoDesignCenters(model, ctos);
    ctos.forEach((cto, i) => { cto.clients = evaluation.load[i] * model.housesPerWeight * params.occupancy / 100; });
    //CTO → CEO: a mais perto que ainda tem vaga
    const cap = params.ceoMax > 0 ? params.ceoMax : Infinity;
    const count = ceos.map(() => 0);
    const owner = new Map();
    const pairs = [];
    ctos.forEach(cto => ceos.forEach((ceo, ei) => pairs.push([dist(ceo, cto), cto, ei])));
    pairs.sort((a, b) => a[0] - b[0]);
    pairs.forEach(([, cto, ei]) => {
        if (owner.has(cto) || count[ei] >= cap) return;
        owner.set(cto, ei);
        count[ei]++;
    });
    ctos.forEach(cto => {
        if (owner.has(cto)) return;
        let best = 0;
        ceos.forEach((ceo, ei) => { if (dist(ceo, cto) < dist(ceos[best], cto)) best = ei; });
        owner.set(cto, best);
        count[best]++;
    });
    [plan.start, ...ceos, ...ctos].forEach(box => { if (box) { box.in = null; box.out = []; box.kids = []; } });
    //Caixa que já existe tem uma saída só (o cabo da rota de chegada): com CEOs novas, as CTOs dela passam para a CEO
    //nova mais perto e só a primeira CEO nova liga nela; sem CEO nova, só a CTO mais perto liga nela e o resto segue dali
    const singleExit = !ceos[0].isNew;
    if (singleExit && ceos.length > 1) {
        ctos.forEach(cto => {
            if (owner.get(cto) !== 0) return;
            let best = 1;
            for (let ei = 2; ei < ceos.length; ei++) if (dist(ceos[ei], cto) < dist(ceos[best], cto)) best = ei;
            owner.set(cto, best);
        });
    }
    //Árvore a partir de uma ponta: com saída única, a raiz liga só no nó mais perto e os outros se penduram nele
    const treeFrom = (root, others) => {
        if (!singleExit || root !== ceos[0] || others.length < 2) {
            const nodes = [root, ...others];
            const tree = buildAutoDesignTree(nodes, (i, j) => dist(nodes[i], nodes[j]));
            return nodes.map((node, i) => [node, tree.children[i].map(k => nodes[k])]);
        }
        const rest = [...others].sort((a, b) => dist(root, a) - dist(root, b));
        const tree = buildAutoDesignTree(rest, (i, j) => dist(rest[i], rest[j]));
        return [[root, [rest[0]]], ...rest.map((node, i) => [node, tree.children[i].map(k => rest[k])])];
    };
    //Árvore das CEOs e, em cada CEO, a árvore das suas CTOs
    treeFrom(ceos[0], ceos.slice(1)).forEach(([ceo, kids]) => { ceo.ceoKids = kids; });
    ceos.forEach((ceo, ei) => {
        treeFrom(ceo, ctos.filter(cto => owner.get(cto) === ei)).forEach(([node, kids]) => { node.kids = kids; });
        const nodes = [ceo, ...ctos.filter(cto => owner.get(cto) === ei)];
        ceo.own = nodes.length - 1;
        ceo.primaries = levels === 2 ? Math.ceil(ceo.own / params.primary) : 0;
    });
    //Nomes na ordem do caminho: CEO, as CTOs dela, depois as CEOs seguintes
    let ceoN = names.ceo, ctoN = names.cto;
    const order = [];
    const nameCtos = (box) => box.kids.forEach(cto => { cto.name = formatAutoDesignName('CTO', ctoN++); order.push(cto); nameCtos(cto); });
    const visitCeo = (ceo) => {
        if (ceo.isNew) ceo.name = formatAutoDesignName('CEO', ceoN++);
        nameCtos(ceo);
        ceo.ceoKids.forEach(visitCeo);
    };
    visitCeo(ceos[0]);
    plan.ctos = order.concat(ctos.filter(c => !order.includes(c)));
    //Fibras: uma por CTO que vem depois (1 nível) ou uma por splitter da CEO (2 níveis), mais a reserva
    const ctoDown = (cto) => 1 + cto.kids.reduce((s, k) => s + ctoDown(k), 0);
    const ceoDown = (ceo) => (levels === 2 ? ceo.primaries : ceo.own) + ceo.ceoKids.reduce((s, k) => s + ceoDown(k), 0);
    const spare = Math.max(0, Number(params.fiberSpare) || 0);
    const cables = [];
    const addCable = (role, from, to, need, minimum) => {
        const cable = {
            role, from, to, need,
            fiber: getAutoDesignFiberFor(Math.ceil(need * (1 + spare / 100)), minimum),
            estLength: dist(from, to),
        };
        cable.path = getAutoDesignCachedRoute(plan, cable)?.path || [from.position, to.position];
        from.out.push(cable);
        to.in = cable;
        cables.push(cable);
        return cable;
    };
    if (plan.start) addCable('feeder', plan.start, ceos[0], ceoDown(ceos[0]), params.feederFiber);
    const wireCtos = (box) => box.kids.forEach(cto => { addCable('distribution', box, cto, ctoDown(cto), params.distributionFiber); wireCtos(cto); });
    const wireCeo = (ceo) => {
        wireCtos(ceo);
        ceo.ceoKids.forEach(child => { addCable('trunk', ceo, child, ceoDown(child), params.distributionFiber); wireCeo(child); });
    };
    wireCeo(ceos[0]);
    plan.cables = cables;
    computeAutoDesignFusions(plan);
    const pons = levels === 2 ? ceos.reduce((s, c) => s + c.primaries, 0) : ctos.length;
    Object.assign(plan.stats, {
        coverage: evaluation.coverage,
        uncoveredHouses: Math.round((1 - evaluation.coverage) * model.houses),
        overloaded: ctos.filter(c => c.clients > usable + 0.5).length,
        usablePorts: usable,
        byPorts: plan.byPorts,
        pons,
        ceos: ceos.filter(c => c.isNew).length,
        clients: Math.ceil(model.houses * params.occupancy / 100),
        existingRootSplitters: levels === 2 && !ceos[0].isNew ? ceos[0].primaries : 0,
        existingCtos: model.existing.length,
        existingClients: Math.round(model.existingClients),
        tooCloseCtos: countAutoDesignTooCloseCtos(model, ctos),
    });
    plan.onStreets = model.siteKind === 'streets' || model.siteKind === 'poles';
    plan.onPoles = model.siteKind === 'poles';
    plan.byRoad = plan.roads.size > 0 || !!model.poleGraph;
    plan.houses = { count: model.allHouses, position: (() => { const p = model.proj.toLatLng(model.polyXY.reduce((s, q) => [s[0] + q[0] / model.polyXY.length, s[1] + q[1] / model.polyXY.length], [0, 0])); return new google.maps.LatLng(p.lat, p.lng); })() };
    plan.feeder = cables.find(c => c.role === 'feeder') || null;
}

//Fusões de cada caixa nova (abstratas: cabo/fibra ou splitter/porta), usadas no custo e no plano de fusão.
//CTO: fibra 1 do cabo que chega → splitter de atendimento; as outras passam, em ordem, para os cabos que saem.
//CEO: 1 nível → fibras do cabo que chega direto para as fibras de distribuição; 2 níveis → cada fibra num
//splitter da CEO e as saídas dele nas fibras de distribuição. Depois, as fibras das CEOs seguintes passam.
function computeAutoDesignFusions(plan) {
    const { params } = plan;
    plan.ctos.forEach(cto => {
        const lines = [];
        if (cto.in) {
            lines.push({ a: { cable: cto.in, fiber: 1 }, b: { splitter: 0, port: 'in' } });
            let f = 2;
            cto.out.forEach(out => { for (let j = 1; j <= out.need; j++) lines.push({ a: { cable: cto.in, fiber: f++ }, b: { cable: out, fiber: j } }); });
        }
        cto.fusion = { splitters: [{ kind: 'service', ratio: params.ports }], lines };
    });
    plan.ceos.forEach(ceo => {
        if (!ceo.isNew) { ceo.fusion = null; return; }
        const lines = [], splitters = [];
        const distribution = ceo.out.filter(c => c.role === 'distribution');
        const trunks = ceo.out.filter(c => c.role === 'trunk');
        let f = 1;
        if (params.levels === 2) {
            for (let i = 0; i < ceo.primaries; i++, f++) {
                splitters.push({ kind: 'primary', ratio: params.primary });
                if (ceo.in) lines.push({ a: { cable: ceo.in, fiber: f }, b: { splitter: i, port: 'in' } });
            }
            let o = 0;
            distribution.forEach(cable => {
                for (let j = 1; j <= cable.need; j++, o++) lines.push({ a: { splitter: Math.floor(o / params.primary), port: (o % params.primary) + 1 }, b: { cable, fiber: j } });
            });
        } else {
            distribution.forEach(cable => { for (let j = 1; j <= cable.need; j++, f++) if (ceo.in) lines.push({ a: { cable: ceo.in, fiber: f }, b: { cable, fiber: j } }); });
        }
        trunks.forEach(cable => { for (let j = 1; j <= cable.need; j++, f++) if (ceo.in) lines.push({ a: { cable: ceo.in, fiber: f }, b: { cable, fiber: j } }); });
        ceo.fusion = { splitters, lines };
    });
}

// ---------------------------------------------------------------
// Traçado dos cabos: de poste em poste, pelas ruas (OSRM) ou em linha reta
// ---------------------------------------------------------------

const getAutoDesignRouteKey = (from, to) => `${getAutoDesignPosKey(from)}>${getAutoDesignPosKey(to)}`;

//Rota já calculada para este par de caixas (nos dois sentidos)
function getAutoDesignCachedRoute(plan, cable) {
    const direct = plan.routes.get(getAutoDesignRouteKey(cable.from, cable.to));
    if (direct) return direct;
    const reverse = plan.routes.get(getAutoDesignRouteKey(cable.to, cable.from));
    return reverse ? { ...reverse, path: [...reverse.path].reverse() } : null;
}

//Caminho de poste em poste sem zigue-zague: poste alternado de um lado e outro da rua (ou um pouco fora da fileira)
//vira reta; ponta em "V" (vai e volta) é cortada. Nunca corta onde o atalho atravessa água. As pontas ficam.
const AUTO_DESIGN_SMOOTH_M = 10;
function smoothAutoDesignPolePath(plan, path, keep = null) {
    if (path.length < 3) return path;
    const { proj, streetIndex } = plan.model;
    const xy = path.map(p => proj.toXY(p.lat(), p.lng()));
    const fixed = new Set([0, path.length - 1, ...(keep || [])]);
    const alive = path.map(() => true);
    const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    for (let changed = true; changed;) {
        changed = false;
        const idx = alive.map((on, i) => (on ? i : -1)).filter(i => i >= 0);
        for (let k = 1; k < idx.length - 1; k++) {
            const [a, b, c] = [idx[k - 1], idx[k], idx[k + 1]];
            if (fixed.has(b) || !alive[a] || !alive[c]) continue;
            const off = distToSegmentXY(xy[b], xy[a], xy[c]);
            //Ponta aguda (menos de 60°: vai e volta); esquina normal (~90°) fica
            const ba = [xy[a][0] - xy[b][0], xy[a][1] - xy[b][1]], bc = [xy[c][0] - xy[b][0], xy[c][1] - xy[b][1]];
            const cos = (ba[0] * bc[0] + ba[1] * bc[1]) / ((hyp(xy[a], xy[b]) * hyp(xy[c], xy[b])) || 1);
            const spike = cos > 0.5;
            //O atalho só vale sobre a rua (ou entre postes de estrada que não está no mapa) e sem atravessar água
            const offMap = (q) => streetIndex.distToStreet(q[0], q[1]) > AUTO_DESIGN_STREET_TOL_M;
            const allowed = !streetIndex || (!streetIndex.crossesWater(xy[a], xy[c])
                && (streetIndex.segmentOnStreets(xy[a], xy[c]) || (offMap(xy[a]) && offMap(xy[c]))));
            if ((off <= AUTO_DESIGN_SMOOTH_M || spike) && allowed) {
                alive[b] = false;
                changed = true;
            }
        }
    }
    return path.filter((_, i) => alive[i]);
}

//Poste da rede onde a caixa está ou, se ela não está num poste (POP/CEO que já existe), o mais perto até 80 m
function getAutoDesignBoxPole(plan, box) {
    if (box.pole != null) return box.pole;
    const { sites, poleGraph, streetIndex } = plan.model;
    if (!poleGraph) return null;
    if (box.poleSnapKey !== getAutoDesignPosKey(box)) {
        let best = null, bestD = Infinity;
        sites.forEach((q, i) => {
            const d = Math.hypot(q.x - box.x, q.y - box.y);
            if (d < bestD && d <= AUTO_DESIGN_SNAP_MAX_M && !streetIndex?.crossesWater([box.x, box.y], [q.x, q.y])) { bestD = d; best = i; }
        });
        box.poleSnap = best;
        box.poleSnapKey = getAutoDesignPosKey(box);
    }
    return box.poleSnap;
}

function getAutoDesignPolePath(plan, from, to) {
    const graph = plan.model.poleGraph;
    const a = getAutoDesignBoxPole(plan, from), b = getAutoDesignBoxPole(plan, to);
    if (!graph || a == null || b == null) return null;
    const tree = getAutoDesignPoleTree(graph, a);
    if (!Number.isFinite(tree.dist[b])) return null;
    const chain = [];
    for (let v = b; v !== -1; v = tree.prev[v]) chain.unshift(v);
    //Caixa fora do poste: o poste de entrada também entra no caminho
    const points = chain.slice(from.pole == null ? 0 : 1, to.pole == null ? chain.length : -1).map(i => { const p = plan.model.proj.toLatLng([plan.model.sites[i].x, plan.model.sites[i].y]); return new google.maps.LatLng(p.lat, p.lng); });
    return smoothAutoDesignPolePath(plan, [from.position, ...points, to.position]);
}

//Rota pelas ruas entre duas caixas (perfil de carro: não corta por vielas entre as casas). Rua de mão única
//pode dar uma volta: aí vale a rota no sentido contrário, se for mais curta (o cabo não tem sentido).
async function fetchAutoDesignRoute(from, to) {
    const spherical = google.maps.geometry.spherical;
    const get = async (a, b) => {
        const data = await fetchAutoDesignOsrm('route', [{ lat: a.lat(), lng: a.lng() }, { lat: b.lat(), lng: b.lng() }], 'overview=full&geometries=geojson');
        const line = data?.routes?.[0]?.geometry?.coordinates;
        return line?.length ? line.map(([lng, lat]) => new google.maps.LatLng(lat, lng)) : null;
    };
    let route = await get(from, to);
    const direct = spherical.computeDistanceBetween(from, to);
    if (!route || spherical.computeLength(route) > Math.max(direct * 1.5, direct + 150)) {
        const back = await get(to, from);
        if (back && (!route || spherical.computeLength(back) < spherical.computeLength(route))) route = back.reverse();
    }
    if (route || isAutoDesignOsrmDown()) return route;
    return typeof fetchOsrmRoute === 'function' ? fetchOsrmRoute(from, to) : null;
}

//Ponto de rua mais perto (OSRM nearest, gratuito); null se nenhum servidor responder
async function fetchAutoDesignNearestStreet(position) {
    const data = await fetchAutoDesignOsrm('nearest', [{ lat: position.lat(), lng: position.lng() }], 'number=1');
    const location = data?.waypoints?.[0]?.location;
    return location ? new google.maps.LatLng(location[1], location[0]) : null;
}

//Roda as tarefas com no máximo `limit` ao mesmo tempo (não sobrecarrega os servidores públicos)
async function runAutoDesignLimited(items, limit, task) {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            await task(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

//Sem as ruas da área (OSRM não respondeu na leitura), as caixas espalhadas são puxadas para a rua mais perto
async function snapAutoDesignLooseBoxes(plan, isCurrent) {
    if (plan.onStreets) return;
    const spherical = google.maps.geometry.spherical;
    let snapped = 0;
    const loose = getAutoDesignNetworkBoxes(plan).filter(box => box.isNew);
    await runAutoDesignLimited(loose, 4, async (box) => {
        const street = await fetchAutoDesignNearestStreet(box.position);
        if (!isCurrent() || !street) return;
        if (spherical.computeDistanceBetween(street, box.position) <= AUTO_DESIGN_SNAP_MAX_M) {
            box.position = street;
            [box.x, box.y] = plan.model.proj.toXY(street.lat(), street.lng());
            snapped++;
        }
    });
    plan.stats.snapped = snapped;
}

//Traça os cabos que ainda não têm rota. O que não achar caminho fica em linha reta e entra no aviso.
async function routeAutoDesignCables(plan, isCurrent) {
    const spherical = google.maps.geometry.spherical;
    const simplify = (path) => (typeof simplifyPathMeters === 'function' ? simplifyPathMeters(path, 2.5) : path);
    const pending = plan.cables.filter(c => !getAutoDesignCachedRoute(plan, c));
    const viaStreets = [];
    pending.forEach(cable => {
        const polePath = getAutoDesignPolePath(plan, cable.from, cable.to);
        if (polePath) plan.routes.set(getAutoDesignRouteKey(cable.from, cable.to), { path: polePath, straight: false, poles: true });
        else viaStreets.push(cable);
    });
    //Pelas ruas do OpenStreetMap, calculado aqui mesmo (sem servidor e sem limite de quantidade)
    const streetIndex = plan.model.streetIndex;
    if (streetIndex) {
        const toLatLng = ([x, y]) => { const q = plan.model.proj.toLatLng([x, y]); return new google.maps.LatLng(q.lat, q.lng); };
        for (let i = viaStreets.length - 1; i >= 0; i--) {
            const cable = viaStreets[i];
            const snap = (box) => (box.isNew ? AUTO_DESIGN_STREET_TOL_M * 2 : AUTO_DESIGN_SNAP_MAX_M);
            const local = streetIndex.route([cable.from.x, cable.from.y], [cable.to.x, cable.to.y], snap(cable.from), snap(cable.to));
            if (!local) continue;
            const path = simplify([cable.from.position, ...local.slice(1, -1).map(toLatLng), cable.to.position]);
            const direct = spherical.computeDistanceBetween(cable.from.position, cable.to.position);
            if (spherical.computeLength(path) > direct * 3 + 200) continue;
            plan.routes.set(getAutoDesignRouteKey(cable.from, cable.to), { path, straight: false });
            viaStreets.splice(i, 1);
        }
        //Caixa num grupo de postes de rua que falta no mapa (ou do outro lado do rio): sai pelos postes até a rua conhecida
        for (let i = viaStreets.length - 1; i >= 0; i--) {
            const cable = viaStreets[i];
            const path = routeAutoDesignViaPoleGateways(plan, cable);
            if (!path) continue;
            const direct = spherical.computeDistanceBetween(cable.from.position, cable.to.position);
            if (spherical.computeLength(path) > direct * 3 + 200) continue;
            plan.routes.set(getAutoDesignRouteKey(cable.from, cable.to), { path, straight: false });
            viaStreets.splice(i, 1);
        }
    }
    const alreadyRouted = [...plan.routes.values()].filter(r => !r.poles).length;
    //Com o traçado das ruas, o que ele não achou o OSRM também não acha sem passar onde não dá para conferir: fica reto e avisa
    if (streetIndex || !viaStreets.length) {
        //Nada a pedir ao servidor
    } else if (alreadyRouted + viaStreets.length > AUTO_DESIGN_MAX_ROUTED) {
        plan.stats.tooMany = true;
    } else {
        await runAutoDesignLimited(viaStreets, 3, async (cable) => {
            const from = cable.from.position, to = cable.to.position;
            let route = null;
            try { route = await fetchAutoDesignRoute(from, to); } catch (e) { route = null; }
            if (!isCurrent()) return;
            const path = route?.length ? simplify([from, ...route, to]) : null;
            //Rota que dá uma volta enorme (rua sem saída, rio no meio) fica em linha reta para ajustar à mão
            const direct = spherical.computeDistanceBetween(from, to);
            if (path && spherical.computeLength(path) <= direct * 3 + 200) {
                plan.routes.set(getAutoDesignRouteKey(cable.from, cable.to), { path, straight: false });
            }
        });
    }
    if (!isCurrent()) return;
    prepareAutoDesignAccessRoutes(plan);
    let straight = 0, offPoles = 0;
    plan.cables.forEach(cable => {
        const route = getAutoDesignCachedRoute(plan, cable);
        cable.path = route?.path || [cable.from.position, cable.to.position];
        if (!route) straight++;
        if (plan.onPoles && !route?.poles && cable.role !== 'feeder') offPoles++;
    });
    plan.stats.straight = straight;
    plan.stats.offPoles = offPoles;
    plan.stats.offStreet = countAutoDesignCablesOffStreet(plan);
    plan.stats.noStreetLines = !streetIndex;
    plan.stats.polesOffStreet = plan.model.polesOffStreet || 0;
    plan.stats.polesUnmapped = plan.model.polesUnmapped || 0;
    plan.stats.wetCables = countAutoDesignCablesOverWater(plan);
    plan.routed = true;
    placeAutoDesignReserves(plan);
    plan.cost = estimateAutoDesignCost(plan);
}

//Rota com "portões": de cada ponta, de poste em poste até o poste do grupo mais perto de uma rua do mapa (até 150 m,
//sem cruzar rio), e entre os dois portões pelas ruas. Para caixas em ruas que faltam no mapa. [LatLng] ou null.
function routeAutoDesignViaPoleGateways(plan, cable) {
    const { poleGraph: graph, sites, streetIndex: streets, proj } = plan.model;
    if (!graph || !streets) return null;
    const toLatLng = ([x, y]) => { const q = proj.toLatLng([x, y]); return new google.maps.LatLng(q.lat, q.lng); };
    const streetGap = plan.model.siteStreetGap || (plan.model.siteStreetGap = new Map());
    const gapOf = (j) => {
        if (!streetGap.has(j)) {
            const p = streets.nearestPoint(sites[j].x, sites[j].y, AUTO_DESIGN_POLE_BRIDGE_M);
            streetGap.set(j, p && !streets.crossesWater([sites[j].x, sites[j].y], p) ? Math.hypot(p[0] - sites[j].x, p[1] - sites[j].y) : Infinity);
        }
        return streetGap.get(j);
    };
    //Portão de uma caixa: ela mesma (se já está perto de rua) ou o poste do grupo dela mais perto de rua
    const gateway = (box) => {
        if (box.pole == null) return { pole: null, xy: [box.x, box.y], chain: [] };
        if (gapOf(box.pole) <= AUTO_DESIGN_SNAP_MAX_M) return { pole: box.pole, xy: [box.x, box.y], chain: [] };
        const tree = getAutoDesignPoleTree(graph, box.pole);
        let best = -1;
        for (let j = 0; j < sites.length; j++) {
            if (!Number.isFinite(tree.dist[j]) || !Number.isFinite(gapOf(j))) continue;
            if (best < 0 || gapOf(j) + tree.dist[j] * 0.2 < gapOf(best) + tree.dist[best] * 0.2) best = j;
        }
        if (best < 0) return null;
        const chain = [];
        for (let v = best; v !== -1; v = tree.prev[v]) chain.unshift(v);
        return { pole: best, xy: [sites[best].x, sites[best].y], chain: chain.slice(1) };
    };
    const a = gateway(cable.from), b = gateway(cable.to);
    if (!a || !b || (!a.chain.length && !b.chain.length)) return null;
    const middle = streets.route(a.xy, b.xy, AUTO_DESIGN_POLE_BRIDGE_M, AUTO_DESIGN_POLE_BRIDGE_M);
    if (!middle) return null;
    const poleXY = (j) => [sites[j].x, sites[j].y];
    //Na ponta de destino a corrente vai ao contrário: do portão até a caixa
    const pts = [...a.chain.map(poleXY), ...middle.slice(1, -1), ...b.chain.slice().reverse().map(poleXY)];
    return [cable.from.position, ...pts.map(toLatLng), cable.to.position];
}

//Rede de postes do caminho de chegada (montada uma vez, vale para as 3 opções): { sites, graph } ou null
function getAutoDesignCorridor(plan) {
    const { corridorPoles, corridorCache: cache, streetIndex, proj } = plan.model;
    if (!corridorPoles?.length || !streetIndex || !cache) return null;
    if (cache.corridor === undefined) {
        const all = corridorPoles.map(([lat, lng]) => { const [x, y] = proj.toXY(lat, lng); return { x, y, pole: true }; });
        const { kept } = classifyAutoDesignPoles(all, streetIndex);
        cache.corridor = kept.length >= 2 ? { sites: kept, graph: buildAutoDesignPoleGraph(kept, streetIndex) } : null;
    }
    return cache.corridor;
}

//Caminho pela rede de postes entre dois pontos: cada ponta entra no poste mais perto (até 80 m, sem cruzar rio).
//[[x, y], ...] sem as pontas, ou null.
function routeAutoDesignCorridor(plan, a, b) {
    const corridor = getAutoDesignCorridor(plan);
    const streets = plan.model.streetIndex;
    if (!corridor) return null;
    const { sites, graph } = corridor;
    const enter = (pt) => {
        let best = -1, bestD = Infinity;
        sites.forEach((q, i) => {
            const d = Math.hypot(q.x - pt[0], q.y - pt[1]);
            if (d < bestD && d <= AUTO_DESIGN_SNAP_MAX_M && !streets.crossesWater(pt, [q.x, q.y])) { bestD = d; best = i; }
        });
        return best;
    };
    const i = enter(a), j = enter(b);
    if (i < 0 || j < 0) return null;
    const tree = getAutoDesignPoleTree(graph, i);
    if (!Number.isFinite(tree.dist[j])) return null;
    const chain = [];
    for (let v = j; v !== -1; v = tree.prev[v]) chain.unshift(v);
    return chain.map(v => [sites[v].x, sites[v].y]);
}

//Até 3 caminhos diferentes pela rede de postes (cada um repete no máximo metade de outro): { points, wet }[]
function routeAutoDesignCorridorAlternatives(plan, a, b) {
    const corridor = getAutoDesignCorridor(plan);
    const streets = plan.model.streetIndex;
    if (!corridor) return [];
    const { sites, graph } = corridor;
    const n = sites.length;
    const enter = (pt) => {
        let best = -1, bestD = Infinity;
        sites.forEach((q, i) => {
            const d = Math.hypot(q.x - pt[0], q.y - pt[1]);
            if (d < bestD && d <= AUTO_DESIGN_SNAP_MAX_M && !streets.crossesWater(pt, [q.x, q.y])) { bestD = d; best = i; }
        });
        return best;
    };
    const src = enter(a), dst = enter(b);
    if (src < 0 || dst < 0) return [];
    const key = (u, v) => (u < v ? u * n + v : v * n + u);
    const extra = new Map();
    const found = [];
    for (let attempt = 0; attempt < AUTO_DESIGN_ROUTE_OPTIONS * 4 && found.length < AUTO_DESIGN_ROUTE_OPTIONS; attempt++) {
        const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
        dist[src] = 0;
        const heap = [[0, src]];
        while (heap.length) {
            let m = 0;
            for (let k = 1; k < heap.length; k++) if (heap[k][0] < heap[m][0]) m = k;
            const [d, u] = heap[m];
            heap[m] = heap[heap.length - 1]; heap.pop();
            if (d > dist[u]) continue;
            if (u === dst) break;
            for (const [v, w] of graph.adj[u]) {
                const nd = d + w * (extra.get(key(u, v)) || 1);
                if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push([nd, v]); }
            }
        }
        if (!Number.isFinite(dist[dst])) break;
        const chain = [];
        for (let v = dst; v !== -1; v = prev[v]) chain.unshift(v);
        const edges = new Map();
        let length = 0, wet = 0;
        for (let k = 1; k < chain.length; k++) {
            const len = Math.hypot(sites[chain[k]].x - sites[chain[k - 1]].x, sites[chain[k]].y - sites[chain[k - 1]].y);
            edges.set(key(chain[k - 1], chain[k]), len);
            length += len;
            if (streets.crossesWater([sites[chain[k - 1]].x, sites[chain[k - 1]].y], [sites[chain[k]].x, sites[chain[k]].y])) wet++;
        }
        const first = found[0];
        if (first && length > first.length * 1.6 + 300) break;
        const distinct = found.every(f => {
            let shared = 0;
            f.edges.forEach((len, k) => { if (edges.has(k)) shared += len; });
            return shared < AUTO_DESIGN_ROUTE_OVERLAP * Math.min(f.length, length);
        });
        if (!first || (distinct && wet <= first.wet)) found.push({ points: chain.map(v => [sites[v].x, sites[v].y]), edges, length, wet });
        if (chain.length < 2) break;
        edges.forEach((_, k) => extra.set(k, (extra.get(k) || 1) * 3));
    }
    return found;
}

//Cabo que sai da caixa existente: a alimentação (POP) ou, partindo de uma CEO que já existe, o mais longo que sai dela
function getAutoDesignAccessCable(plan) {
    if (plan.feeder) return plan.feeder;
    const root = plan.ceos[0];
    if (!root || root.isNew) return null;
    return [...(root.out || [])].sort((a, b) => b.estLength - a.estLength)[0] || null;
}

//Rotas de chegada: até 3 caminhos diferentes pelas ruas (evitando rio e sem passar sobre casas) para o cabo que
//sai da caixa existente. Mantém a escolhida enquanto o cabo for o mesmo.
function prepareAutoDesignAccessRoutes(plan) {
    const cable = getAutoDesignAccessCable(plan);
    const streets = plan.model.streetIndex;
    if (!cable || !streets) { plan.access = null; return; }
    const key = getAutoDesignRouteKey(cable.from, cable.to);
    const waypoints = plan.accessWaypoints || [];
    if (plan.access?.key !== key || (!plan.access.routes.some(r => !r.custom) && !waypoints.length)) {
        const spherical = google.maps.geometry.spherical;
        const simplify = (path) => (typeof simplifyPathMeters === 'function' ? simplifyPathMeters(path, 2.5) : path);
        const toLatLng = ([x, y]) => { const q = plan.model.proj.toLatLng([x, y]); return new google.maps.LatLng(q.lat, q.lng); };
        const snap = (box) => (box.isNew ? AUTO_DESIGN_STREET_TOL_M * 2 : AUTO_DESIGN_SNAP_MAX_M);
        const direct = spherical.computeDistanceBetween(cable.from.position, cable.to.position);
        const finish = (list) => list.map(r => ({ ...r, length: spherical.computeLength(r.path) })).filter(r => r.length <= direct * 3 + 200);
        //Pelas ruas primeiro (até 3 caminhos); a rede de postes completa onde não há rua no mapa (zona rural)
        let routes = finish(streets.alternatives([cable.from.x, cable.from.y], [cable.to.x, cable.to.y], snap(cable.from), snap(cable.to))
            .map(r => ({ path: simplify([cable.from.position, ...r.points.slice(1, -1).map(toLatLng), cable.to.position]), wet: r.wet })));
        if (routes.length < AUTO_DESIGN_ROUTE_OPTIONS) {
            const keyOf = (q) => `${q.lat().toFixed(5)},${q.lng().toFixed(5)}`;
            finish(routeAutoDesignCorridorAlternatives(plan, [cable.from.x, cable.from.y], [cable.to.x, cable.to.y])
                .map(r => ({ path: smoothAutoDesignPolePath(plan, [cable.from.position, ...r.points.map(toLatLng), cable.to.position]), wet: r.wet, poles: true })))
                .forEach(r => {
                    const mine = new Set(r.path.map(keyOf));
                    const repeats = routes.some(o => o.path.filter(q => mine.has(keyOf(q))).length > o.path.length * AUTO_DESIGN_ROUTE_OVERLAP);
                    if (!repeats && routes.length < AUTO_DESIGN_ROUTE_OPTIONS) routes.push(r);
                });
            routes.sort((x, y) => x.length - y.length);
        }
        //Sem rua nem poste no caminho: a rota que o cabo já tem é a rota 1
        if (!routes.length) {
            const current = getAutoDesignCachedRoute(plan, cable)?.path || [cable.from.position, cable.to.position];
            routes.push({ path: current, length: spherical.computeLength(current), wet: 0 });
        }
        plan.access = { key, from: cable.from, routes, index: 0 };
    }
    if (!plan.access) return;
    //Rota pelos postes escolhidos no mapa: entra como mais uma opção (e fica escolhida enquanto houver postes)
    const access = plan.access;
    access.routes = access.routes.filter(r => !r.custom);
    if (waypoints.length) {
        access.routes.push(buildAutoDesignWaypointRoute(plan, cable, waypoints));
        if (plan.accessPreferCustom) access.index = access.routes.length - 1;
    }
    if (!access.routes[access.index]) access.index = 0;
    plan.routes.set(key, { path: access.routes[access.index].path, straight: false, poles: !!access.routes[access.index].poles });
}

//Rota pelos postes escolhidos: sai da caixa, passa pelos postes (na ordem do caminho, do mais perto da saída ao mais
//longe) e chega no destino. Vão curto entre dois pontos vai direto (é o cabo no poste); trecho maior segue as ruas.
function buildAutoDesignWaypointRoute(plan, cable, waypoints) {
    const { proj, streetIndex: streets } = plan.model;
    const spherical = google.maps.geometry.spherical;
    const toLatLng = ([x, y]) => { const q = proj.toLatLng([x, y]); return new google.maps.LatLng(q.lat, q.lng); };
    const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const left = waypoints.map(w => ({ w, xy: proj.toXY(w.lat, w.lng) }));
    const ordered = [];
    let current = [cable.from.x, cable.from.y];
    while (left.length) {
        let best = 0;
        left.forEach((item, i) => { if (hyp(item.xy, current) < hyp(left[best].xy, current)) best = i; });
        current = left[best].xy;
        ordered.push(left.splice(best, 1)[0]);
    }
    //Postes da rede no caminho entre dois pontos que estão em postes (até 3 m): [[x, y], ...] sem as pontas, ou null
    const graph = plan.model.poleGraph, sites = plan.model.sites || [];
    const siteAt = (xy) => {
        if (!graph) return -1;
        const i = nearestAutoDesignSite(sites, xy);
        return i >= 0 && hyp([sites[i].x, sites[i].y], xy) <= 3 ? i : -1;
    };
    const polePathBetween = (a, b) => {
        const corridor = routeAutoDesignCorridor(plan, a, b);
        if (corridor && pathLengthXY([a, ...corridor, b]) <= hyp(a, b) * 3 + 200) return corridor;
        const i = siteAt(a), j = siteAt(b);
        if (i < 0 || j < 0) return null;
        const tree = getAutoDesignPoleTree(graph, i);
        if (!Number.isFinite(tree.dist[j]) || tree.dist[j] > hyp(a, b) * 3 + 200) return null;
        const chain = [];
        for (let v = j; v !== -1; v = tree.prev[v]) chain.unshift(v);
        return chain.slice(1, -1).map(v => [sites[v].x, sites[v].y]);
    };
    const stops = [
        { xy: [cable.from.x, cable.from.y], pos: cable.from.position, snap: cable.from.isNew ? AUTO_DESIGN_STREET_TOL_M * 2 : AUTO_DESIGN_SNAP_MAX_M },
        ...ordered.map(({ w, xy }) => ({ xy, pos: new google.maps.LatLng(w.lat, w.lng), snap: AUTO_DESIGN_SNAP_MAX_M })),
        { xy: [cable.to.x, cable.to.y], pos: cable.to.position, snap: cable.to.isNew ? AUTO_DESIGN_STREET_TOL_M * 2 : AUTO_DESIGN_SNAP_MAX_M },
    ];
    const path = [stops[0].pos];
    let wet = 0, loose = 0;
    const legs = [];
    for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1], b = stops[i];
        let middle = [];
        const span = hyp(a.xy, b.xy);
        //Vão direto só sobre a rua ou entre postes de estrada que não está no mapa, sem atravessar água
        const offMap = (pt) => !streets || streets.distToStreet(pt[0], pt[1]) > AUTO_DESIGN_STREET_TOL_M;
        const direct = span <= AUTO_DESIGN_UNMAPPED_SPAN_M && !streets?.crossesWater(a.xy, b.xy)
            && (!streets || streets.segmentOnStreets(a.xy, b.xy) || (offMap(a.xy) && offMap(b.xy)));
        if (!direct) {
            //Pelas ruas; onde não há rua (zona rural), de poste em poste pela rede
            const street = streets?.route(a.xy, b.xy, a.snap, b.snap);
            const streetOk = street && pathLengthXY(street) <= span * 3 + 200;
            const poles = streetOk ? null : polePathBetween(a.xy, b.xy);
            if (streetOk) { middle = street.slice(1, -1); legs.push('rua'); }
            else if (poles) { middle = poles; legs.push('postes'); }
            else { loose++; legs.push('reto'); }
        } else legs.push('vão');
        const pts = [a.xy, ...middle, b.xy];
        for (let k = 1; k < pts.length; k++) if (streets?.crossesWater(pts[k - 1], pts[k])) wet++;
        path.push(...middle.map(toLatLng), b.pos);
    }
    return { path, length: spherical.computeLength(path), wet, custom: true, poles: ordered.length, loose, legs };
}

const pathLengthXY = (pts) => pts.reduce((sum, p, i) => sum + (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

//Poste mais perto do clique (BDGD ou marcado no projeto), até 25 m: { lat, lng } ou null
async function findAutoDesignPoleNear(latLng) {
    const spherical = google.maps.geometry.spherical;
    const candidates = [];
    markers.forEach(m => {
        if (m.type !== 'POSTE' || !m.marker?.getPosition) return;
        const pos = m.marker.getPosition();
        candidates.push({ lat: pos.lat(), lng: pos.lng() });
    });
    if (typeof getPolesInBounds === 'function') {
        const d = 0.0005;
        try {
            const { points } = await getPolesInBounds(latLng.lat() - d, latLng.lng() - d, latLng.lat() + d, latLng.lng() + d);
            points.forEach(([lat, lng]) => candidates.push({ lat, lng }));
        } catch (e) {
            //Sem a base de postes: só os marcados no projeto
        }
    }
    let best = null, bestD = Infinity;
    candidates.forEach(c => {
        const d = spherical.computeDistanceBetween(latLng, new google.maps.LatLng(c.lat, c.lng));
        if (d < bestD) { bestD = d; best = c; }
    });
    return bestD <= AUTO_DESIGN_POLE_PICK_M ? best : null;
}

//Clique no modo "Passar por postes": escolhe o poste (ou tira, se já estava escolhido) e refaz a rota pelos postes
async function toggleAutoDesignAccessPole(latLng) {
    const s = autoDesign;
    const plan = s?.result;
    if (!plan?.access || !latLng || s.busy) return;
    const spherical = google.maps.geometry.spherical;
    const list = plan.accessWaypoints || (plan.accessWaypoints = []);
    const chosen = list.findIndex(w => spherical.computeDistanceBetween(new google.maps.LatLng(w.lat, w.lng), latLng) <= AUTO_DESIGN_POLE_PICK_M);
    if (chosen >= 0) list.splice(chosen, 1);
    else {
        const pole = await findAutoDesignPoleNear(latLng);
        if (autoDesign !== s || s.result !== plan) return;
        if (!pole) {
            showToast('Rota pelos postes', 'Nenhum poste a até 25 m do clique. Aproxime o mapa e clique em cima do poste.', 'progress');
            return;
        }
        list.push(pole);
    }
    plan.accessPreferCustom = list.length > 0;
    await rerouteAutoDesignAccess(plan);
}

function clearAutoDesignAccessPoles() {
    const plan = autoDesign?.result;
    if (!plan?.accessWaypoints?.length) return null;
    plan.accessWaypoints = [];
    plan.accessPreferCustom = false;
    return rerouteAutoDesignAccess(plan);
}

async function rerouteAutoDesignAccess(plan) {
    const s = autoDesign;
    s.busy = true;
    renderAutoDesign();
    await routeAutoDesignCables(plan, () => true);
    if (autoDesign !== s) return;
    s.busy = false;
    drawAutoDesignPreview();
    renderAutoDesign();
}

//Troca a rota de chegada: refaz o caminho do cabo, as reservas e o custo
async function selectAutoDesignAccessRoute(index) {
    const s = autoDesign;
    const plan = s?.result;
    if (!plan?.access || s.busy || !plan.access.routes[index] || plan.access.index === index) return;
    plan.access.index = index;
    plan.accessPreferCustom = !!plan.access.routes[index].custom;
    await routeAutoDesignCables(plan, () => true);
    drawAutoDesignPreview();
    renderAutoDesign();
}

//Cabos que atravessam rio ou lago (por ponte ou de poste em poste)
function countAutoDesignCablesOverWater(plan) {
    const streets = plan.model.streetIndex;
    if (!streets) return 0;
    const proj = plan.model.proj;
    return plan.cables.filter(cable => {
        const pts = (cable.path || []).map(p => proj.toXY(p.lat(), p.lng()));
        return pts.some((p, i) => i && streets.crossesWater(pts[i - 1], p));
    }).length;
}

//Conferência final: cabo da área com algum trecho fora da rua/calçada (só a alimentação, que vem de fora, não entra)
function countAutoDesignCablesOffStreet(plan) {
    const streets = plan.model.streetIndex;
    if (!streets) return 0;
    const proj = plan.model.proj;
    return plan.cables.filter(cable => {
        if (cable.role === 'feeder' || !cable.path?.length) return false;
        const pts = cable.path.map(p => proj.toXY(p.lat(), p.lng()));
        //A ligação de uma caixa que já existe (dentro de um lote) até a rua não tem como evitar: não conta
        const first = cable.from.isNew === false ? 2 : 1, last = cable.to.isNew === false ? pts.length - 2 : pts.length - 1;
        for (let i = first; i <= last; i++) if (!streets.segmentOnStreets(pts[i - 1], pts[i]) && !plan.model.onPolesOffMap?.(pts[i - 1], pts[i])) return true;
        return false;
    }).length;
}

// ---------------------------------------------------------------
// Reservas técnicas: a cada X metros de cabo (o cabo é dividido nelas ao criar)
// ---------------------------------------------------------------

function interpolateAutoDesignPath(path, distance) {
    const spherical = google.maps.geometry.spherical;
    let walked = 0;
    for (let i = 1; i < path.length; i++) {
        const seg = spherical.computeDistanceBetween(path[i - 1], path[i]);
        if (walked + seg >= distance && seg > 0) return { index: i, point: spherical.interpolate(path[i - 1], path[i], (distance - walked) / seg) };
        walked += seg;
    }
    return { index: path.length - 1, point: path[path.length - 1] };
}

function placeAutoDesignReserves(plan) {
    const every = Number(plan.params.reserveEvery) || 0;
    let n = plan.names.reserve || 1;
    plan.reserves = [];
    plan.cables.forEach(cable => {
        cable.reserves = [];
        if (!every) return;
        const length = google.maps.geometry.spherical.computeLength(cable.path);
        for (let d = every; d < length - 60; d += every) {
            const reserve = { type: 'RESERVA', name: formatAutoDesignName('RT', n++), position: interpolateAutoDesignPath(cable.path, d).point, isNew: true, at: d };
            cable.reserves.push(reserve);
            plan.reserves.push(reserve);
        }
    });
}

//Trechos do cabo entre as reservas: [{ path, from, to }]
function getAutoDesignCableSegments(cable) {
    const reserves = cable.reserves || [];
    if (!reserves.length) return [{ path: cable.path, from: cable.from, to: cable.to }];
    const segments = [];
    let rest = cable.path, from = cable.from, offset = 0;
    reserves.forEach(reserve => {
        const { index, point } = interpolateAutoDesignPath(rest, reserve.at - offset);
        segments.push({ path: [...rest.slice(0, index), point], from, to: reserve });
        rest = [point, ...rest.slice(index)];
        from = reserve;
        offset = reserve.at;
    });
    segments.push({ path: rest, from, to: cable.to });
    return segments;
}

// ---------------------------------------------------------------
// Custo estimado (mesma regra da lista de materiais) + mão de obra de referência
// ---------------------------------------------------------------

//Preço como na lista de materiais: pelo nome da planilha (cabos: pelo tipo do cabo)
function getAutoDesignMaterialPrice(name, raw = false) {
    const resolved = resolveMaterialName(name);
    const info = raw ? (MATERIAL_PRICES[name] || MATERIAL_PRICES[resolved]) : (MATERIAL_PRICES[resolved] || MATERIAL_PRICES[name]);
    return Number(info?.price) || 0;
}

function estimateAutoDesignCost(plan) {
    const { params } = plan;
    const items = new Map();
    const add = (name, qty, section, price = null) => {
        if (!name || !(qty > 0)) return;
        const resolved = resolveMaterialName(name);
        if (typeof isDroppedMaterial === 'function' && isDroppedMaterial(resolved)) return;
        const row = items.get(resolved) || { name: resolved, qty: 0, price: price ?? getAutoDesignMaterialPrice(name), section };
        row.qty += qty;
        items.set(resolved, row);
    };
    const projectId = autoDesign?.polygon ? getAutoDesignProjectId(autoDesign.polygon) : null;
    const reserveOf = (box) => getReserveForMarkerType(box.type);
    //Cabos: lançamento de 10 em 10 m + reservas das pontas, somados por tipo (como na lista de materiais)
    const byType = new Map();
    plan.cables.forEach(cable => {
        const type = `Cabo ${params.span} ${cable.fiber}`;
        getAutoDesignCableSegments(cable).forEach((seg, i, all) => {
            //Sem traçar (comparação), vale a distância pela rua entre as caixas
            const drawn = plan.routed || all.length > 1 ? google.maps.geometry.spherical.computeLength(seg.path) : cable.estLength;
            const reserve = (seg.from.type === 'RESERVA' ? 0 : reserveOf(seg.from)) + reserveOf(seg.to);
            byType.set(type, (byType.get(type) || 0) + roundLengthUpToTen(Math.ceil(drawn / 10) * 10 + reserve));
        });
    });
    let cableMeters = 0, poles = 0;
    byType.forEach((length, type) => {
        const base = roundLengthUpToTen(length);
        const saved = projectBoms?.[projectId]?.[makeBomKey(type)];
        const surcharge = Math.max(0, parseFloat(saved?.surchargePercent) || 0);
        const billable = roundLengthUpToTen(base * (1 + surcharge / 100));
        add(type, billable, 'cables', saved?.unitPrice ?? getAutoDesignMaterialPrice(type, true));
        cableMeters += billable;
        const alca = getCableAlca(type);
        if (alca) {
            Object.entries(calculateHardwareForCable(billable, alca)).forEach(([name, qty]) => add(name, qty, 'hardware'));
            poles += Math.ceil(billable / getPoleSpanDistance());
        }
    });
    //Caixas
    const newCeos = plan.ceos.filter(c => c.isNew);
    const ctoKit = MATERIAL_PRICES.CTO?.components || [];
    plan.ctos.forEach(() => ctoKit.forEach(c => add(c.name, c.quantity, 'boxes')));
    if (plan.ctos.length) add("FITA DE AÇO INOX 3/4'' (FITA FUSIMEC) ROLO DE 25M", getFitaRolls(plan.ctos.length), 'boxes');
    newCeos.forEach(() => {
        add('CAIXA DE EMENDA ÓPTICA (CEO)', 1, 'boxes');
        getKitComponents('KIT CEO RAQUETE').forEach(c => add(c.name, c.quantity, 'boxes'));
    });
    const reserves = plan.reserves || [];
    reserves.forEach(() => getKitComponents('KIT CEO RAQUETE').forEach(c => add(c.name, c.quantity, 'boxes')));
    const raquetes = newCeos.length + reserves.length;
    if (raquetes) add('ARAME DE ESPIMAR (105 m)', getArameRolls(raquetes), 'boxes');
    //Fusão: splitters, adaptadores, tubetes (um por fusão) e bandejas da CEO
    plan.ctos.forEach(() => {
        add(resolveSplitterMaterialName(params.ports, true, 'APC'), 1, 'fusion');
        add('ADAPTADOR SC/APC COM ABAS (PASSANTE)', params.ports, 'fusion');
    });
    let fusions = 0, trays = 0;
    getAutoDesignNetworkBoxes(plan).forEach(box => {
        if (!box.fusion) return;
        if (box.type === 'CEO') {
            box.fusion.splitters.forEach(s => add(resolveSplitterMaterialName(s.ratio, false, 'UPC'), 1, 'fusion'));
            trays += Math.ceil(box.fusion.lines.length / AUTO_DESIGN_FUSIONS_PER_TRAY);
        }
        fusions += box.fusion.lines.length;
    });
    add('KIT DE BANDEJA PARA CAIXA DE EMENDA', trays, 'fusion');
    add('TUBETE PROTETOR DE EMENDA OPTICA', fusions, 'fusion');
    if (fusions) add('FITA ISOLANTE', 1, 'fusion');
    const sections = { cables: 0, hardware: 0, boxes: 0, fusion: 0 };
    items.forEach(row => { sections[row.section] += row.qty * row.price; });
    const materials = sections.cables + sections.hardware + sections.boxes + sections.fusion;
    const service = (key) => Number((typeof getOutsourcedServices === 'function' ? getOutsourcedServices() : []).find(s => s.name === AUTO_DESIGN_LABOR_SERVICES[key])?.price) || 0;
    const labor = cableMeters * service('cable') + newCeos.length * service('ceo') + plan.ctos.length * service('cto')
        + reserves.length * service('reserve') + fusions * service('fusion');
    const total = materials + labor;
    const ports = plan.ctos.length * params.ports;
    const clients = plan.stats.clients || 0;
    return {
        sections, materials, labor, total, cableMeters, poles, fusions, trays,
        perPort: ports ? total / ports : 0,
        perClient: clients ? total / clients : 0,
        items: [...items.values()],
    };
}

const formatAutoDesignMoney = (value) => `R$ ${(Number(value) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatAutoDesignMoneyShort = (value) => `R$ ${Math.round(Number(value) || 0).toLocaleString('pt-BR')}`;

// ---------------------------------------------------------------
// Painel e prévia no mapa
// ---------------------------------------------------------------

const AUTO_DESIGN_DEFAULTS = {
    occupancy: 30, ports: 8, levels: 1, primary: 8, feederFiber: 'FO-48', distributionFiber: 'FO-12', span: 'AS 80',
    coverRadius: AUTO_DESIGN_COVER_M, fiberSpare: 20, maxFill: 100, reserveEvery: 0, ceoMax: 16, useHouses: true, usePoles: true, useExisting: true, ctoSpacing: '',
};
const AUTO_DESIGN_STORED_KEYS = Object.keys(AUTO_DESIGN_DEFAULTS);

function loadAutoDesignParams() {
    try { return { ...AUTO_DESIGN_DEFAULTS, ...(JSON.parse(localStorage.getItem(AUTO_DESIGN_PARAMS_KEY) || 'null') || {}) }; } catch (e) { return { ...AUTO_DESIGN_DEFAULTS }; }
}

function storeAutoDesignParams(params) {
    const stored = Object.fromEntries(AUTO_DESIGN_STORED_KEYS.map(k => [k, params[k]]));
    try { localStorage.setItem(AUTO_DESIGN_PARAMS_KEY, JSON.stringify(stored)); } catch (e) { /* sem armazenamento */ }
}

//Splitter da CEO que cabe com o da CTO (no máximo 1:64 no total)
function clampAutoDesignPrimary(params) {
    const allowed = AUTO_DESIGN_PRIMARY_SPLITTERS.filter(r => r * params.ports <= AUTO_DESIGN_MAX_SPLIT);
    if (!allowed.includes(params.primary)) params.primary = allowed[allowed.length - 1] || 2;
    return allowed;
}

function isAutoDesignOpen() {
    return !!autoDesign;
}

function openAutoDesign(polygon, { drawn = false } = {}) {
    if (!polygon?.polygonObject || !requireEdit('gerar o pré-projeto')) return;
    if (typeof closeOpenMapEditors === 'function') closeOpenMapEditors();
    closeAutoDesign();
    const params = loadAutoDesignParams();
    params.houses = autoDesignHousesByPolygon.get(polygon) || '';
    const starts = getAutoDesignStartOptions(polygon);
    params.startUid = starts[0]?.marker.uid || '';
    const path = getAutoDesignPolygonPath(polygon);
    const projectId = getAutoDesignProjectId(polygon);
    const houseMarkers = findAutoDesignMarkersInArea(path, projectId, 'CASA');
    const poleMarkers = findAutoDesignMarkersInArea(path, projectId, 'POSTE');
    const existingCtos = findAutoDesignExistingCtos(path, projectId);
    autoDesign = {
        existingCtos,
        polygon, params, starts, phase: 'form', overlays: [], result: null, token: null,
        houseMarkers: houseMarkers.length >= AUTO_DESIGN_MIN_HOUSE_MARKERS ? houseMarkers : [],
        markedPoles: poleMarkers, poleMarkers: [], bdgdPoles: null,
        exclusions: [], cache: null, editMode: null, mapListener: null, compare: null, created: null,
        options: [], optionKey: AUTO_DESIGN_PANEL_OPTION,
        polygonDrawn: drawn, polygonWasVisible: polygon.polygonObject.getVisible?.() !== false,
    };
    if (autoDesign.houseMarkers.length && params.useHouses) params.houses = getAutoDesignMarkedHouses();
    autoDesign.polesPromise = loadAutoDesignBdgdPoles(autoDesign);
    document.getElementById('autoDesignBox').classList.remove('hidden');
    if (typeof focusMapToPolygon === 'function') focusMapToPolygon(polygon);
    renderAutoDesign();
    setTimeout(() => document.getElementById('autoDesignHouses')?.focus(), 50);
}

const getAutoDesignMarkedHouses = () => (autoDesign?.houseMarkers || []).reduce((s, m) => s + getAutoDesignHouseCount(m), 0);

function closeAutoDesign() {
    //Fechou sem criar: o polígono da área volta para o mapa
    if (autoDesign && autoDesign.phase !== 'done') showAutoDesignPolygon(autoDesign, true);
    clearAutoDesignPreview();
    setAutoDesignEditMode(null);
    autoDesign?.mapListener?.remove?.();
    autoDesign = null;
    const box = document.getElementById('autoDesignBox');
    if (box) box.classList.add('hidden');
}

//O polígono só marca a área: some do mapa a partir da prévia e volta se a prévia for descartada
function showAutoDesignPolygon(s, shown) {
    const polygon = s?.polygon;
    if (!polygon?.polygonObject) return;
    const visible = shown ? s.polygonWasVisible !== false : false;
    polygon.polygonObject.setVisible(visible);
    const checkbox = polygon.listItem?.querySelector('.ge-vis-checkbox');
    if (checkbox) {
        checkbox.checked = visible;
        checkbox.dataset.visible = String(visible);
        checkbox.title = visible ? 'Ocultar no mapa' : 'Exibir no mapa';
    }
}

//Polígono desenhado só para o pré-projeto: sai do projeto ao criar (o desfazer devolve)
function removeAutoDesignPolygon(polygon) {
    const parentId = polygon.listItem?.parentElement?.id || polygon.folderId;
    polygon.polygonObject.setMap(null);
    polygon.listItem?.remove();
    savedPolygons = savedPolygons.filter(p => p !== polygon);
    return { polygon, parentId };
}

function restoreAutoDesignPolygon({ polygon, parentId }) {
    polygon.polygonObject.setMap(map);
    polygon.polygonObject.setVisible(true);
    const parent = document.getElementById(parentId) || document.getElementById(polygon.folderId);
    if (parent && polygon.listItem) parent.appendChild(polygon.listItem);
    const checkbox = polygon.listItem?.querySelector('.ge-vis-checkbox');
    if (checkbox) { checkbox.checked = true; checkbox.dataset.visible = 'true'; checkbox.title = 'Ocultar no mapa'; }
    if (!savedPolygons.includes(polygon)) savedPolygons.push(polygon);
}

function clearAutoDesignPreview() {
    autoDesign?.overlays.forEach(o => o.setMap(null));
    if (autoDesign) autoDesign.overlays = [];
}

function getAutoDesignStartMarker() {
    return autoDesign?.starts.find(s => s.marker.uid === autoDesign.params.startUid)?.marker || null;
}

const formatAutoDesignMeters = (m) => `${Math.round(m).toLocaleString('pt-BR')} m`;

function renderAutoDesignCalc() {
    const el = document.getElementById('autoDesignCalc');
    if (!el) return;
    const p = autoDesign.params;
    const n = parseInt(p.houses, 10);
    if (!n || n < 1) {
        el.innerHTML = 'Digite a quantidade de casas para calcular as caixas.';
        return;
    }
    const clients = Math.ceil(n * p.occupancy / 100);
    const usable = getAutoDesignUsablePorts(p);
    //CTOs que já existem: entram antes (a conta exata, pela distância de cada casa, sai ao gerar)
    const existing = getAutoDesignActiveExisting(autoDesign.existingCtos, p);
    const existingRoom = existing.reduce((s, e) => s + getAutoDesignExistingCapacity(e.marker, p).usable, 0);
    const fromExisting = Math.min(clients, existingRoom);
    const ctos = Math.ceil((clients - fromExisting) / usable);
    renderAutoDesignExistingText(existingRoom);
    const fill = usable < p.ports ? ` (até ${usable} clientes cada)` : '';
    if (existing.length && !ctos) {
        el.innerHTML = `≈ <b>${clients.toLocaleString('pt-BR')}</b> clientes: as <b>${existing.length}</b> CTO(s) que já existem têm até ${existingRoom.toLocaleString('pt-BR')} vagas. Pode não precisar de CTO nova (casas fora do raio delas ainda pedem uma).`;
        return;
    }
    const before = existing.length ? ` − até ${fromExisting.toLocaleString('pt-BR')} nas <b>${existing.length}</b> CTO(s) existente(s)` : '';
    const label = existing.length ? `${ctos} CTOs novas` : `${ctos} CTOs`;
    const pon = p.levels === 2
        ? ` · CEO 1:${p.primary} → 1:${p.primary * p.ports} · <b>${Math.ceil(ctos / p.primary)}</b> PON(s)`
        : ` · <b>${ctos}</b> PON(s)`;
    const tight = p.levels === 2 && p.primary * p.ports > AUTO_DESIGN_TIGHT_SPLIT
        ? `<small>Splitagem total 1:${p.primary * p.ports}: precisa de OLT/SFP classe C+ (orçamento óptico mais apertado).</small>` : '';
    el.innerHTML = `≈ <b>${clients.toLocaleString('pt-BR')}</b> clientes${before} → <b>${label}</b> com splitter 1:${p.ports}${fill}${pon}${tight}`;
}

//Texto da opção "Considerar as CTOs que já estão no mapa" (muda com o raio da CTO)
function renderAutoDesignExistingText(room) {
    const el = document.getElementById('autoDesignExistingText');
    if (!el) return;
    const s = autoDesign;
    const p = s.params;
    const inRadius = s.existingCtos.filter(e => e.distance <= getAutoDesignCoverRadius(p));
    const inside = inRadius.filter(e => !e.distance).length;
    const near = inRadius.length - inside;
    const where = [inside ? `${inside} na área` : '', near ? `${near} a até ${getAutoDesignCoverRadius(p)} m dela` : ''].filter(Boolean).join(' e ');
    const capacity = p.useExisting !== false ? room : inRadius.reduce((sum, e) => sum + getAutoDesignExistingCapacity(e.marker, p).usable, 0);
    el.innerHTML = inRadius.length
        ? `Considerar as CTOs que já estão no mapa (<b>${where}</b>, até ${capacity.toLocaleString('pt-BR')} clientes)`
        : `Considerar as CTOs que já estão no mapa (nenhuma no raio de ${getAutoDesignCoverRadius(p)} m da área)`;
}



function renderAutoDesign() {
    const s = autoDesign;
    if (!s) return;
    document.getElementById('autoDesignBox').dataset.phase = s.phase;
    if (s.phase === 'form') showAutoDesignPolygon(s, true);
    const title = document.getElementById('autoDesignTitle');
    const body = document.getElementById('autoDesignBody');
    const actions = document.getElementById('autoDesignActions');
    const esc = (v) => escapeHtml(String(v ?? ''));
    if (s.phase === 'loading') {
        title.textContent = 'Gerar pré-projeto';
        body.innerHTML = `<p class="auto-design__loading"><span class="route-suggest__spinner" aria-hidden="true"></span>${esc(s.loadingText || 'Distribuindo as caixas…')}</p>`;
        actions.innerHTML = '<button type="button" class="map-tool-btn" data-auto-design="cancel">Cancelar</button>';
        return;
    }
    if (s.phase === 'preview') { renderAutoDesignPreviewPanel(); return; }
    if (s.phase === 'compare') { renderAutoDesignComparePanel(); return; }
    if (s.phase === 'done') { renderAutoDesignDonePanel(); return; }
    const p = s.params;
    const area = google.maps.geometry.spherical.computeArea(s.polygon.polygonObject.getPath());
    const fiberOptions = (selected) => AUTO_DESIGN_FIBERS.map(f => {
        const v = `FO-${String(f).padStart(2, '0')}`;
        return `<option value="${v}"${v === selected ? ' selected' : ''}>${v}</option>`;
    }).join('');
    const options = (list, selected, label) => list.map(v => `<option value="${v}"${String(v) === String(selected) ? ' selected' : ''}>${esc(label(v))}</option>`).join('');
    const start = getAutoDesignStartMarker();
    const usingHouses = s.houseMarkers.length && p.useHouses;
    title.textContent = 'Gerar pré-projeto';
    body.innerHTML = `
        <dl class="map-tool-stats"><div><dt>Área</dt><dd title="${esc(s.polygon.name || 'Polígono')}">${esc(s.polygon.name || 'Polígono')}</dd></div><div><dt>Tamanho</dt><dd>${esc(formatArea(area))}</dd></div></dl>
        <div class="map-tool-field-row">
            <div class="map-tool-field"><label for="autoDesignHouses">Casas na área</label><input type="number" id="autoDesignHouses" min="1" step="1" inputmode="numeric" value="${esc(p.houses)}" placeholder="Ex.: 320"${usingHouses ? ' disabled title="Usando as casas marcadas no mapa"' : ''}></div>
            <div class="map-tool-field"><label for="autoDesignOccupancy" title="Taxa de penetração">Penetração (%)</label><input type="number" id="autoDesignOccupancy" min="1" max="100" step="1" inputmode="numeric" value="${esc(p.occupancy)}"></div>
        </div>
        ${s.houseMarkers.length ? `<label class="auto-design__check"><input type="checkbox" id="autoDesignUseHouses"${p.useHouses ? ' checked' : ''}><span>Usar as <b>${s.houseMarkers.length}</b> casas marcadas no mapa (${getAutoDesignMarkedHouses().toLocaleString('pt-BR')} casas, posição real)</span></label>` : ''}
        ${s.existingCtos.length ? `<label class="auto-design__check"><input type="checkbox" id="autoDesignUseExisting"${p.useExisting !== false ? ' checked' : ''}><span id="autoDesignExistingText"></span></label>` : ''}
        ${s.poleMarkers.length ? `<label class="auto-design__check"><input type="checkbox" id="autoDesignUsePoles"${p.usePoles ? ' checked' : ''}><span>Caixas nos <b>${s.poleMarkers.length}</b> postes da área${s.bdgdPoles?.used && s.markedPoles.length ? ` (${s.markedPoles.length} marcados + ${s.bdgdPoles.used} da BDGD)` : ''} e cabos de poste em poste</span></label>` : ''}
        <div class="map-tool-field"><label>Níveis de splitagem</label><div class="map-tool-segmented" id="autoDesignLevels" role="radiogroup" aria-label="Níveis de splitagem"></div></div>
        <div class="map-tool-field-row">
            ${p.levels === 2 ? '<div class="map-tool-field"><label>Splitagem da CEO</label><div class="map-tool-segmented" id="autoDesignPrimary" role="radiogroup" aria-label="Splitter da CEO (1º nível)"></div></div>' : ''}
            <div class="map-tool-field"><label>Splitagem da CTO</label><div class="map-tool-segmented" id="autoDesignPorts" role="radiogroup" aria-label="Splitter de atendimento da CTO"></div></div>
        </div>
        <div class="auto-design__calc" id="autoDesignCalc" aria-live="polite"></div>
        <div class="map-tool-field"><label for="autoDesignStart">Partir de</label>
            <select id="autoDesignStart">
                ${s.starts.map(({ marker, distance }) => `<option value="${esc(marker.uid)}"${marker.uid === p.startUid ? ' selected' : ''}>${esc(marker.name)} · ${esc(marker.type)} · ${esc(formatDistance(distance))}</option>`).join('')}
                <option value=""${!p.startUid ? ' selected' : ''}>Nenhum — CEO nova no meio da área</option>
            </select>
        </div>
        <div class="map-tool-field-row">
            <div class="map-tool-field"><label for="autoDesignFeeder">Alimentação (mín.)</label><select id="autoDesignFeeder"${start?.type === 'POP' ? '' : ' disabled title="Só quando parte de um POP"'}>${fiberOptions(p.feederFiber)}</select></div>
            <div class="map-tool-field"><label for="autoDesignDistribution">Distribuição (mín.)</label><select id="autoDesignDistribution">${fiberOptions(p.distributionFiber)}</select></div>
        </div>
        <div class="map-tool-field-row">
            <div class="map-tool-field"><label for="autoDesignRadius">Raio da CTO (m)</label><input type="number" id="autoDesignRadius" min="${AUTO_DESIGN_COVER_MIN}" max="${AUTO_DESIGN_COVER_MAX}" step="10" inputmode="numeric" value="${esc(p.coverRadius)}" title="Até onde o drop chega a partir da CTO (em linha reta)"></div>
            <div class="map-tool-field"><label for="autoDesignSpacing">Distância entre CTOs (m)</label><input type="number" id="autoDesignSpacing" min="10" max="${AUTO_DESIGN_COVER_MAX * 2}" step="10" inputmode="numeric" placeholder="Pelo raio" value="${esc(getAutoDesignCtoSpacing(p) || '')}" title="Mínimo entre duas CTOs na mesma rua, em linha reta. Em branco: vale só o raio"></div>
        </div>
        <div class="map-tool-field-row">
            <div class="map-tool-field"><label>Vão</label><div class="map-tool-segmented" id="autoDesignSpan" role="radiogroup" aria-label="Tipo de vão"></div></div>
        </div>
        <details class="auto-design__more" id="autoDesignMore"${s.moreOpen ? ' open' : ''}>
            <summary>Mais opções</summary>
            <div class="map-tool-field-row">
                <div class="map-tool-field"><label for="autoDesignSpare">Fibras de reserva (%)</label><input type="number" id="autoDesignSpare" min="0" max="200" step="5" inputmode="numeric" value="${esc(p.fiberSpare)}"></div>
                <div class="map-tool-field"><label for="autoDesignFill" title="Ocupação máxima da CTO">Ocupação máx. (%)</label><input type="number" id="autoDesignFill" min="25" max="100" step="5" inputmode="numeric" value="${esc(p.maxFill)}"></div>
            </div>
            <div class="map-tool-field-row">
                <div class="map-tool-field"><label for="autoDesignReserve">Reserva técnica</label><select id="autoDesignReserve">${options(AUTO_DESIGN_RESERVE_STEPS, p.reserveEvery, v => (v ? `A cada ${v} m de cabo` : 'Não colocar'))}</select></div>
                <div class="map-tool-field"><label for="autoDesignCeoMax">CTOs por CEO</label><select id="autoDesignCeoMax">${options(AUTO_DESIGN_CEO_LIMITS, p.ceoMax, v => (v ? `Até ${v}` : 'Sem limite'))}</select></div>
            </div>
        </details>
        <p class="map-tool-help">Saem até 3 opções (a do painel, a de menor custo e a com mais folga) para você escolher. As caixas vão só para as ruas da área (mato, pasto e rio ficam de fora) e os cabos seguem as ruas (OpenStreetMap). Nada é salvo até você aceitar.</p>
        ${s.error ? `<div class="auto-design__warn">${esc(s.error)}</div>` : ''}`;
    clampAutoDesignPrimary(p);
    renderSegmentedOptions('autoDesignLevels', [{ value: '1', label: '1 nível (só CTO)' }, { value: '2', label: '2 níveis (CEO + CTO)' }], String(p.levels));
    renderSegmentedOptions('autoDesignPorts', AUTO_DESIGN_SPLITTERS.map(n => ({ value: String(n), label: `1:${n}` })), String(p.ports));
    if (p.levels === 2) renderSegmentedOptions('autoDesignPrimary', clampAutoDesignPrimary(p).map(n => ({ value: String(n), label: `1:${n}` })), String(p.primary));
    renderSegmentedOptions('autoDesignSpan', [{ value: 'AS 80', label: 'AS 80' }, { value: 'AS 200', label: 'AS 200' }], p.span);
    const onSegment = (id, apply) => document.getElementById(id)?.addEventListener('segmented-change', (e) => apply(e.detail));
    onSegment('autoDesignLevels', (v) => { readAutoDesignForm(); p.levels = parseInt(v, 10); renderAutoDesign(); });
    onSegment('autoDesignPorts', (v) => { readAutoDesignForm(); p.ports = parseInt(v, 10); renderAutoDesignCalc(); });
    onSegment('autoDesignPrimary', (v) => { p.primary = parseInt(v, 10); renderAutoDesignCalc(); });
    onSegment('autoDesignSpan', (v) => { p.span = v; });
    document.getElementById('autoDesignMore')?.addEventListener('toggle', (e) => { s.moreOpen = e.target.open; });
    actions.innerHTML = `
        <button type="button" class="map-tool-btn" data-auto-design="cancel">Cancelar</button>
        <button type="button" class="map-tool-btn map-tool-btn--primary" data-auto-design="generate">Gerar opções</button>`;
    renderAutoDesignCalc();
}

function readAutoDesignForm() {
    const p = autoDesign.params;
    const value = (id) => document.getElementById(id)?.value;
    const number = (id, fallback, min, max) => {
        const raw = value(id);
        if (raw === undefined) return fallback;
        const n = parseInt(raw, 10);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    p.houses = value('autoDesignHouses') ?? p.houses;
    p.occupancy = number('autoDesignOccupancy', 30, 1, 100);
    p.startUid = value('autoDesignStart') ?? p.startUid;
    p.feederFiber = value('autoDesignFeeder') || p.feederFiber;
    p.distributionFiber = value('autoDesignDistribution') || p.distributionFiber;
    p.fiberSpare = number('autoDesignSpare', p.fiberSpare, 0, 200);
    p.maxFill = number('autoDesignFill', p.maxFill, 25, 100);
    p.coverRadius = number('autoDesignRadius', getAutoDesignCoverRadius(p), AUTO_DESIGN_COVER_MIN, AUTO_DESIGN_COVER_MAX);
    const spacing = value('autoDesignSpacing');
    if (spacing !== undefined) p.ctoSpacing = getAutoDesignCtoSpacing({ ctoSpacing: spacing }) || '';
    p.reserveEvery = number('autoDesignReserve', p.reserveEvery, 0, 100000);
    p.ceoMax = number('autoDesignCeoMax', p.ceoMax, 0, 1000);
    const useHouses = document.getElementById('autoDesignUseHouses');
    if (useHouses) p.useHouses = useHouses.checked;
    const usePoles = document.getElementById('autoDesignUsePoles');
    if (usePoles) p.usePoles = usePoles.checked;
    const useExisting = document.getElementById('autoDesignUseExisting');
    if (useExisting) p.useExisting = useExisting.checked;
    if (autoDesign.houseMarkers.length && p.useHouses) p.houses = getAutoDesignMarkedHouses();
}

//Entradas da geração: ruas (com cache por polígono), casas e postes marcados e os trechos sem casas
async function collectAutoDesignInputs(s, isCurrent) {
    const polygonPath = getAutoDesignPolygonPath(s.polygon);
    //A caixa de onde a rede sai entra no traçado das ruas (rotas de chegada), se estiver até 5 km da área
    const startPos = getAutoDesignStartMarker()?.marker?.getPosition?.();
    const center = getAutoDesignPolygonCenter(s.polygon);
    const start = startPos && google.maps.geometry.spherical.computeDistanceBetween(center, startPos) <= AUTO_DESIGN_START_REACH_M
        ? [{ lat: startPos.lat(), lng: startPos.lng() }] : [];
    const signature = JSON.stringify([polygonPath, start]);
    if (s.cache?.signature !== signature) s.cache = { signature };
    const cache = s.cache;
    //O traçado das ruas (rápido, em CDN) também diz onde há rua dentro da área; o OSRM só entra se ele faltar
    const streetLines = cache.streetLines !== undefined ? cache.streetLines : await fetchAutoDesignStreetLines(polygonPath, start);
    if (streetLines) cache.streetLines = streetLines;
    let streets = cache.streets;
    if (streets === undefined) {
        streets = streetLines?.length ? sampleAutoDesignStreetsLocal(polygonPath, streetLines) : await sampleAutoDesignStreets(polygonPath, isCurrent);
        if (streets) cache.streets = streets;
    }
    //Postes no caminho de chegada (da caixa de partida até a área), para a rota seguir a rede elétrica fora do polígono
    if (cache.corridorPoles === undefined && start.length && typeof getPolesInBounds === 'function') {
        const pts = [...polygonPath, ...start];
        const m = 0.002;
        try {
            const { points } = await getPolesInBounds(Math.min(...pts.map(q => q.lat)) - m, Math.min(...pts.map(q => q.lng)) - m, Math.max(...pts.map(q => q.lat)) + m, Math.max(...pts.map(q => q.lng)) + m);
            cache.corridorPoles = points;
        } catch (e) {
            cache.corridorPoles = null;
        }
    }
    return { polygonPath, streets, streetLines, corridorPoles: start.length ? cache.corridorPoles || null : null, houseMarkers: s.houseMarkers, poleMarkers: s.poleMarkers, exclusions: s.exclusions, existingCtos: s.existingCtos };
}

function getAutoDesignNames(projectId) {
    return {
        ceo: getNextAutoDesignNumber(projectId, 'CEO'),
        cto: getNextAutoDesignNumber(projectId, 'CTO'),
        reserve: getNextAutoDesignNumber(projectId, 'RESERVA'),
    };
}

async function generateAutoDesign({ keepOption = false } = {}) {
    const s = autoDesign;
    if (!s) return;
    if (!keepOption) s.optionKey = AUTO_DESIGN_PANEL_OPTION;
    if (s.phase === 'form') readAutoDesignForm();
    const houses = parseInt(s.params.houses, 10);
    if (!houses || houses < 1) {
        s.phase = 'form';
        s.error = 'Digite quantas casas tem na área.';
        renderAutoDesign();
        document.getElementById('autoDesignHouses')?.focus();
        return;
    }
    s.params.houses = houses;
    s.params.levels = s.params.levels === 2 ? 2 : 1;
    clampAutoDesignPrimary(s.params);
    s.error = null;
    if (!(s.houseMarkers.length && s.params.useHouses)) autoDesignHousesByPolygon.set(s.polygon, houses);
    storeAutoDesignParams(s.params);
    setAutoDesignEditMode(null);
    s.busy = false;
    const token = {};
    s.token = token;
    s.phase = 'loading';
    clearAutoDesignPreview();
    renderAutoDesign();
    const isCurrent = () => autoDesign === s && s.token === token;
    const step = (text) => { s.loadingText = text; renderAutoDesign(); };
    const projectId = getAutoDesignProjectId(s.polygon);
    if (s.bdgdPoles?.status === 'loading') { step('Buscando os postes da área…'); await s.polesPromise; if (!isCurrent()) return; }
    step('Lendo as ruas da área…');
    const inputs = await collectAutoDesignInputs(s, isCurrent);
    if (!isCurrent()) return;
    if (inputs.streets && !inputs.streets.points.length && !(s.params.useHouses && s.houseMarkers.length) && !(s.params.usePoles && s.poleMarkers.length)) {
        s.phase = 'form';
        s.error = 'Não encontrei ruas dentro do polígono. Confira se a área cobre as casas.';
        renderAutoDesign();
        return;
    }
    step('Comparando distribuições das caixas…');
    const candidates = await buildAutoDesignCandidates(s, inputs, getAutoDesignNames(projectId), isCurrent);
    if (!isCurrent() || candidates.cancelled) return;
    if (candidates.error) {
        s.phase = 'form';
        s.error = candidates.error;
        renderAutoDesign();
        return;
    }
    const options = pickAutoDesignOptions(candidates);
    for (let i = 0; i < options.length; i++) {
        const plan = options[i];
        step(`${plan.onPoles ? 'Traçando os cabos de poste em poste' : 'Traçando os cabos pelas ruas'} (opção ${i + 1} de ${options.length})…`);
        if (!plan.onStreets) {
            await snapAutoDesignLooseBoxes(plan, isCurrent);
            if (!isCurrent()) return;
            rebuildAutoDesignNetwork(plan);
        }
        await routeAutoDesignCables(plan, isCurrent);
        if (!isCurrent()) return;
    }
    labelAutoDesignOptions(options);
    s.options = options;
    s.result = options.find(plan => plan.option.key === s.optionKey) || options.find(plan => plan.option.panel) || options[0];
    s.optionKey = s.result.option.key;
    s.compare = null;
    s.phase = 'preview';
    showAutoDesignPolygon(s, false);
    drawAutoDesignPreview();
    renderAutoDesign();
}

const getAutoDesignPlanSignature = (plan) => getAutoDesignNetworkBoxes(plan).map(getAutoDesignPosKey).sort().join('|');
const getAutoDesignFreePorts = (plan) => Math.max(0, plan.ctos.length * plan.params.ports - plan.stats.clients);

//Distribuições candidatas (sem traçar os cabos: o custo usa a distância pela rua). A do painel vem primeiro: se
//ela não fecha, nenhuma fecha. Distribuição repetida (mesmas caixas nos mesmos lugares) fica de fora.
async function buildAutoDesignCandidates(s, inputs, names, isCurrent) {
    const roads = new Map();
    const seeds = inputs.streetLines?.length ? AUTO_DESIGN_LAYOUT_SEEDS : 1;
    const candidates = [];
    for (const strategy of AUTO_DESIGN_STRATEGIES) {
        const extra = strategy.params(s.params);
        if (extra.coverRadius) extra.coverRadius = getAutoDesignCoverRadius({ coverRadius: Math.round(extra.coverRadius / 10) * 10 });
        //Sem o traçado das ruas, cada estratégia tenta outro ponto de partida só se sair repetida
        for (let seed = 0, fresh = 0; seed < seeds + 3 && fresh < seeds; seed++) {
            const params = { ...s.params, ...extra, layoutSeed: seed };
            const plan = await buildAutoDesignPlan(inputs.polygonPath, params, getAutoDesignStartMarker(), names, inputs, { isCurrent, roads });
            if (!isCurrent() || plan.cancelled) return { cancelled: true };
            if (plan.error) {
                if (!candidates.length) return plan;
                break;
            }
            //O traçado das ruas e o grafo dos postes servem para as outras distribuições
            if (inputs.cachedStreetIndex === undefined) {
                inputs.cachedStreetIndex = plan.model.streetIndex;
                if (plan.model.poleGraph) inputs.cachedPoleGraph = { sites: plan.model.sites.length, graph: plan.model.poleGraph };
            }
            plan.model.corridorPoles = inputs.corridorPoles;
            plan.model.corridorCache = inputs.corridorCache || (inputs.corridorCache = {});
            plan.signature = getAutoDesignPlanSignature(plan);
            if (candidates.some(other => other.signature === plan.signature)) continue;
            fresh++;
            plan.option = { key: `${strategy.id}-${seed}`, panel: strategy.id === 'panel' && seed === 0 };
            placeAutoDesignReserves(plan);
            plan.cost = estimateAutoDesignCost(plan);
            candidates.push(plan);
        }
    }
    return candidates;
}

//As 3 opções: a do painel, a de menor custo, a com mais portas livres; o que faltar, as mais baratas
function pickAutoDesignOptions(candidates) {
    const total = (plan) => plan.cost?.total ?? Infinity;
    const byCost = [...candidates].sort((a, b) => total(a) - total(b));
    const bySpare = [...candidates].sort((a, b) => getAutoDesignFreePorts(b) - getAutoDesignFreePorts(a) || total(a) - total(b));
    const picked = [];
    const add = (plan) => { if (plan && !picked.includes(plan) && picked.length < AUTO_DESIGN_OPTION_COUNT) picked.push(plan); };
    add(candidates.find(plan => plan.option.panel));
    add(byCost[0]);
    add(bySpare[0]);
    byCost.forEach(add);
    return picked;
}

//Depois de traçar: numera pelo custo (Opção 1 = mais barata) e marca o que cada uma tem de melhor
function labelAutoDesignOptions(options) {
    options.sort((a, b) => (a.cost?.total ?? Infinity) - (b.cost?.total ?? Infinity));
    const best = (score) => options.reduce((a, o) => (score(o) < score(a) ? o : a), options[0]);
    const cheapest = best(o => o.cost?.total ?? Infinity);
    const freest = best(o => -getAutoDesignFreePorts(o));
    const shortest = best(o => o.cost?.cableMeters ?? Infinity);
    options.forEach((plan, i) => {
        plan.option.label = `Opção ${i + 1}`;
        plan.option.tags = [
            options.length > 1 && plan === cheapest ? 'menor custo' : '',
            plan.option.panel ? 'como no painel' : '',
            options.length > 1 && plan === freest && getAutoDesignFreePorts(plan) > getAutoDesignFreePorts(cheapest) ? 'mais folga' : '',
            options.length > 1 && plan === shortest && plan !== cheapest ? 'menos cabo' : '',
        ].filter(Boolean);
    });
}

//Troca a opção mostrada no mapa (as edições de cada uma ficam guardadas nela)
async function selectAutoDesignOption(key) {
    const s = autoDesign;
    const plan = s?.options?.find(o => o.option.key === key);
    if (!plan || s.busy || plan === s.result) return;
    setAutoDesignEditMode(null);
    //Os postes escolhidos para a rota de chegada valem também na outra opção
    const previous = s.result;
    if (previous?.accessWaypoints?.length && !plan.accessWaypoints?.length) {
        plan.accessWaypoints = [...previous.accessWaypoints];
        plan.accessPreferCustom = previous.accessPreferCustom;
        await routeAutoDesignCables(plan, () => true);
        if (autoDesign !== s) return;
    }
    s.result = plan;
    s.optionKey = key;
    s.compare = null;
    drawAutoDesignPreview();
    renderAutoDesign();
}

function getAutoDesignAllCables(plan) {
    return plan.cables;
}

// ---------------------------------------------------------------
// Edição da prévia: arrastar caixas, incluir/tirar CTOs e trechos sem casas
// ---------------------------------------------------------------

//Depois de mexer: refaz a rede (nomes, fibras, CEO de cada CTO) e traça só os cabos novos
async function refreshAutoDesignAfterEdit() {
    const s = autoDesign;
    const plan = s?.result;
    if (!plan) return;
    const token = {};
    s.token = token;
    const isCurrent = () => autoDesign === s && s.token === token;
    s.busy = true;
    renderAutoDesign();
    await ensureAutoDesignRoadDistances(plan);
    if (!isCurrent()) return;
    rebuildAutoDesignNetwork(plan);
    await routeAutoDesignCables(plan, isCurrent);
    if (!isCurrent()) return;
    s.busy = false;
    s.compare = null;
    drawAutoDesignPreview();
    renderAutoDesign();
}

function moveAutoDesignBox(box, latLng) {
    const plan = autoDesign?.result;
    if (!plan || !box?.isNew || !latLng) return null;
    const xy = snapAutoDesignPoint(plan.model, latLng);
    Object.assign(box, makeAutoDesignBox(plan.model, box.type, xy, { name: box.name }));
    return refreshAutoDesignAfterEdit();
}

function addAutoDesignCto(latLng) {
    const plan = autoDesign?.result;
    if (!plan || !latLng) return null;
    if (plan.ctos.length >= AUTO_DESIGN_MAX_CTOS) {
        showToast('Limite de caixas', `O pré-projeto aceita até ${AUTO_DESIGN_MAX_CTOS} CTOs.`, 'progress');
        return null;
    }
    plan.ctos.push(makeAutoDesignBox(plan.model, 'CTO', snapAutoDesignPoint(plan.model, latLng)));
    return refreshAutoDesignAfterEdit();
}

function removeAutoDesignCto(cto) {
    const plan = autoDesign?.result;
    if (!plan || !plan.ctos.includes(cto)) return null;
    if (plan.ctos.length <= 1) {
        showToast('Pré-projeto', 'O pré-projeto precisa de pelo menos uma CTO.', 'progress');
        return null;
    }
    plan.ctos.splice(plan.ctos.indexOf(cto), 1);
    return refreshAutoDesignAfterEdit();
}

//Trecho sem casas (lote vazio, praça): sai da conta e as caixas são redistribuídas
function addAutoDesignExclusion(a, b) {
    const s = autoDesign;
    if (!s || !a || !b) return null;
    s.exclusions.push({
        south: Math.min(a.lat(), b.lat()), north: Math.max(a.lat(), b.lat()),
        west: Math.min(a.lng(), b.lng()), east: Math.max(a.lng(), b.lng()),
    });
    return generateAutoDesign({ keepOption: true });
}

function clearAutoDesignExclusions() {
    if (!autoDesign?.exclusions.length) return null;
    autoDesign.exclusions = [];
    return generateAutoDesign({ keepOption: true });
}

const AUTO_DESIGN_EDIT_HINTS = {
    add: 'Clique no mapa onde vai a nova CTO.',
    remove: 'Clique na CTO que vai sair.',
    exclude: 'Clique em dois cantos do trecho sem casas.',
    poles: 'Clique nos postes por onde o cabo deve passar (clique de novo para tirar). Esc termina.',
};

function setAutoDesignEditMode(mode) {
    const s = autoDesign;
    if (!s) return;
    s.editMode = s.editMode === mode ? null : mode;
    s.excludeFirst = null;
    s.excludeMarker?.setMap(null);
    s.excludeMarker = null;
    if (typeof setMapCursor === 'function') setMapCursor(['add', 'exclude', 'poles'].includes(s.editMode) ? 'crosshair' : '');
}

function handleAutoDesignMapClick(latLng) {
    const s = autoDesign;
    if (!s || s.phase !== 'preview' || !latLng || s.busy) return;
    if (s.editMode === 'add') {
        setAutoDesignEditMode(null);
        addAutoDesignCto(latLng);
    } else if (s.editMode === 'poles') {
        toggleAutoDesignAccessPole(latLng);
    } else if (s.editMode === 'exclude') {
        if (!s.excludeFirst) {
            s.excludeFirst = latLng;
            s.excludeMarker = new google.maps.Marker({ map, position: latLng, clickable: false, zIndex: 80, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 5, fillColor: '#64748b', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 } });
            return;
        }
        const first = s.excludeFirst;
        setAutoDesignEditMode(null);
        addAutoDesignExclusion(first, latLng);
    }
}

function handleAutoDesignBoxClick(box) {
    const s = autoDesign;
    if (!s || s.phase !== 'preview' || s.busy) return;
    if (s.editMode === 'remove' && box.type === 'CTO') {
        setAutoDesignEditMode(null);
        removeAutoDesignCto(box);
    }
}

function drawAutoDesignPreview() {
    clearAutoDesignPreview();
    const s = autoDesign;
    const plan = s?.result;
    if (!plan) return;
    const editable = !AppSession?.isViewer;
    const add = (overlay) => { s.overlays.push(overlay); return overlay; };
    if (!s.mapListener && map?.addListener) s.mapListener = map.addListener('click', (e) => handleAutoDesignMapClick(e?.latLng));
    s.exclusions.forEach(r => add(new google.maps.Rectangle({
        map, bounds: { south: r.south, north: r.north, west: r.west, east: r.east }, clickable: false, zIndex: 35,
        strokeColor: '#64748b', strokeOpacity: 0.8, strokeWeight: 1, fillColor: '#64748b', fillOpacity: 0.18,
    })));
    plan.ctos.forEach(cto => add(new google.maps.Circle({
        map, center: cto.position, radius: plan.model.coverRadius, clickable: false, zIndex: 40,
        strokeColor: '#16a34a', strokeOpacity: 0.35, strokeWeight: 1, fillColor: '#16a34a', fillOpacity: 0.06,
    })));
    //CTOs que já existem e entraram na conta: círculo azul
    plan.model.existing.forEach(e => add(new google.maps.Circle({
        map, center: e.markerInfo.marker.getPosition(), radius: plan.model.coverRadius, clickable: false, zIndex: 39,
        strokeColor: '#2563eb', strokeOpacity: 0.5, strokeWeight: 1, fillColor: '#2563eb', fillOpacity: 0.06,
    })));
    //Postes escolhidos para a rota (clique para tirar)
    (plan.accessWaypoints || []).forEach(w => {
        const marker = add(new google.maps.Marker({
            map, position: new google.maps.LatLng(w.lat, w.lng), zIndex: 85, clickable: editable, title: 'Poste da rota (clique para tirar)',
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#f97316', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 },
        }));
        if (editable) marker.addListener('click', () => toggleAutoDesignAccessPole(marker.getPosition()));
    });
    plan.cables.forEach(cable => add(new google.maps.Polyline({
        path: cable.path, map, clickable: false, zIndex: 60, strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: AUTO_DESIGN_PREVIEW_COLOR, strokeWeight: 4, scale: 3 }, offset: '0', repeat: '13px' }],
    })));
    const icon = (type, size) => ({ url: getMarkerIconDataUrl(type, getMarkerTypeMeta(type).color), scaledSize: new google.maps.Size(size, size), anchor: new google.maps.Point(size / 2, size / 2) });
    (plan.reserves || []).forEach(reserve => add(new google.maps.Marker({
        map, position: reserve.position, title: `${reserve.name} (prévia)`, clickable: false, zIndex: 65, opacity: 0.85, icon: icon('RESERVA', 20),
    })));
    getAutoDesignNetworkBoxes(plan).filter(box => box.isNew).forEach(box => {
        const marker = add(new google.maps.Marker({
            map, position: box.position, title: `${box.name} (prévia)${editable ? ' — arraste para mover' : ''}`,
            clickable: editable, draggable: editable, zIndex: 70, opacity: 0.9, icon: icon(box.type, 26),
        }));
        if (!editable) return;
        marker.addListener('dragend', (e) => moveAutoDesignBox(box, e?.latLng || marker.getPosition()));
        marker.addListener('click', () => handleAutoDesignBoxClick(box));
    });
}

function summarizeAutoDesignCables(plan) {
    const rows = new Map();
    const rank = { feeder: 0, trunk: 1, distribution: 2 };
    plan.cables.forEach(cable => {
        const key = `${cable.role}|${cable.fiber}`;
        const row = rows.get(key) || { role: cable.role, fiber: cable.fiber, length: 0, count: 0 };
        row.length += google.maps.geometry.spherical.computeLength(cable.path);
        row.count++;
        rows.set(key, row);
    });
    return [...rows.values()].sort((a, b) => (a.role === b.role ? b.fiber.localeCompare(a.fiber) : rank[a.role] - rank[b.role]));
}

const AUTO_DESIGN_ROLE_LABELS = { feeder: 'Alimentação', trunk: 'Entre CEOs', distribution: 'Distribuição' };

function getAutoDesignWarnings(plan, params) {
    const st = plan.stats;
    const warnings = [];
    if (st.uncoveredHouses > 0) warnings.push(`≈ ${st.uncoveredHouses} casa(s) ficaram a mais de ${plan.model.coverRadius} m de uma CTO (raio da CTO).`);
    if (st.overloaded > 0) warnings.push(`${st.overloaded} CTO(s) podem precisar de mais de ${st.usablePorts} portas${st.usablePorts < params.ports ? ' (ocupação máxima)' : ''}.`);
    if (st.spacingLimited && (st.uncoveredHouses > 0 || st.overloaded > 0)) {
        warnings.push(`A distância mínima entre CTOs (${plan.model.ctoSpacing} m na mesma rua) não deixou colocar mais caixas. Diminua a distância ou deixe em branco para valer só o raio.`);
    }
    if (st.tooCloseCtos > 0) warnings.push(`${st.tooCloseCtos} CTO(s) estão a menos de ${plan.model.ctoSpacing} m de outra na mesma rua (distância entre CTOs).`);
    if (st.noStreets) warnings.push('Não consegui ler as ruas da área agora: as caixas foram espalhadas pela área toda. Confira as que caíram fora das casas (mato, pasto) e tente gerar de novo mais tarde.');
    if (st.tooMany) warnings.push(`Área grande: ${st.straight} cabo(s) ficaram em linha reta (traçar tudo pelas ruas sobrecarregaria o servidor). Ajuste no mapa ou divida a área.`);
    else if (st.straight > 0) warnings.push(`${st.straight} cabo(s) ficaram em linha reta: não achei uma rota pelas ruas. Confira no mapa.`);
    if (st.offStreet > 0) warnings.push(`${st.offStreet} cabo(s) têm trecho fora da rua (passam sobre lotes). Ajuste no mapa antes de aceitar.`);
    if (st.noStreetLines) warnings.push('Não consegui ler o traçado das ruas (OpenStreetMap) agora: confira no mapa se algum cabo passa por cima de casas, ou gere de novo mais tarde.');
    if (st.wetCables > 0) warnings.push(`${st.wetCables} cabo(s) atravessam rio ou lago (pela ponte ou de poste em poste, onde não há outro caminho). Confira no satélite.`);
    if (st.polesUnmapped > 0) warnings.push(`${st.polesUnmapped} poste(s) estão em ruas que não aparecem no mapa (OpenStreetMap): as caixas e os cabos ali seguem os postes. Confira no satélite.`);
    if (st.polesOffStreet > 0) warnings.push(`${st.polesOffStreet} poste(s) da área parecem estar dentro de lotes ou soltos, longe das ruas (cadastro impreciso), e não foram usados.`);
    if (st.offPoles > 0) warnings.push(`${st.offPoles} cabo(s) não acharam caminho de poste em poste e seguiram a rua. Cadastre os postes que faltam ou ajuste no mapa.`);
    if (params.levels === 2 && params.primary * params.ports > AUTO_DESIGN_TIGHT_SPLIT) {
        warnings.push(`Splitagem total 1:${params.primary * params.ports} (CEO 1:${params.primary} × CTO 1:${params.ports}): use OLT/SFP classe C+ e confira o orçamento óptico até a última CTO.`);
    }
    const loose = plan.model.existing.filter(e => !e.wired);
    if (loose.length) {
        const names = loose.slice(0, 3).map(e => e.markerInfo.name).join(', ') + (loose.length > 3 ? ` e mais ${loose.length - 3}` : '');
        warnings.push(`${names} já ${loose.length > 1 ? 'estão' : 'está'} no mapa sem cabo chegando: ${loose.length > 1 ? 'entram' : 'entra'} na conta das casas atendidas, mas ${loose.length > 1 ? 'precisam' : 'precisa'} ser ligada${loose.length > 1 ? 's' : ''} à rede.`);
    }
    if (!plan.ceos[0].isNew) {
        const splitters = st.existingRootSplitters > 0 ? ` e ${st.existingRootSplitters} splitter(s) 1:${params.primary}` : '';
        warnings.push(`O plano de fusão da CEO existente ${plan.ceos[0].name} não é alterado: ligue nele as fibras dos cabos novos${splitters}.`);
    }
    return warnings;
}

function renderAutoDesignOptions(s) {
    if (!(s.options?.length > 1)) return '';
    const esc = (v) => escapeHtml(String(v ?? ''));
    const cards = s.options.map(o => {
        const active = o === s.result;
        return `<button type="button" class="auto-design__option${active ? ' is-active' : ''}" role="radio" aria-checked="${active}" data-auto-design="option" data-option="${esc(o.option.key)}"${s.busy ? ' disabled' : ''}>
            <span class="auto-design__option-name">${esc(o.option.label)}</span>
            <span class="auto-design__option-value">${o.ctos.length} CTOs</span>
            <span class="auto-design__option-cost">${o.cost ? esc(formatAutoDesignMoneyShort(o.cost.total)) : '—'}</span>
            <small>${o.option.tags.length ? esc(o.option.tags.join(' · ')) : '&nbsp;'}</small>
        </button>`;
    }).join('');
    const plan = s.result;
    const km = (plan.cost?.cableMeters || 0) / 1000;
    const detail = [
        `raio de ${plan.model.coverRadius} m`, plan.model.ctoSpacing ? `CTOs a ${plan.model.ctoSpacing} m ou mais na mesma rua` : '', `CTOs com até ${getAutoDesignUsablePorts(plan.params)} clientes`,
        km ? `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km de cabo` : '', `${getAutoDesignFreePorts(plan)} portas livres`,
    ].filter(Boolean).join(' · ');
    return `<div class="auto-design__options" role="radiogroup" aria-label="Opções de projeto">${cards}</div>
        <p class="map-tool-help"><b>${esc(plan.option.label)}:</b> ${esc(detail)}.</p>`;
}

function renderAutoDesignAccessRoutes(s) {
    const access = s.result.access;
    if (!access) return '';
    const esc = (v) => escapeHtml(String(v ?? ''));
    const base = access.routes[0].length;
    const km = (m) => (m >= 1000 ? `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km` : formatAutoDesignMeters(m));
    const buttons = access.routes.map((r, i) => {
        const active = i === access.index;
        const diff = r.length - base;
        const note = [
            r.custom ? `${r.poles} poste(s)` : i === 0 ? 'mais curta' : '',
            i > 0 ? (Math.abs(diff) < 5 ? 'mesma distância' : `${diff > 0 ? '+' : '−'}${formatAutoDesignMeters(Math.abs(diff))}`) : '',
            r.wet ? 'cruza rio' : '', r.loose ? 'trecho reto' : '',
        ].filter(Boolean).join(' · ');
        return `<button type="button" class="auto-design__route${active ? ' is-active' : ''}${r.custom ? ' is-custom' : ''}" role="radio" aria-checked="${active}" data-auto-design="access-route" data-route="${i}"${s.busy ? ' disabled' : ''}>
            <span>${r.custom ? 'Pelos postes' : `Rota ${i + 1}`}</span><b>${esc(km(r.length))}</b><small>${esc(note)}</small></button>`;
    }).join('');
    const picked = s.result.accessWaypoints?.length || 0;
    const picking = s.editMode === 'poles';
    const tools = `<div class="auto-design__route-tools">
            <button type="button" class="map-tool-btn auto-design__tool${picking ? ' is-active' : ''}" data-auto-design="mode-poles" aria-pressed="${picking}"${s.busy ? ' disabled' : ''}>${picking ? 'Terminar' : 'Passar por postes'}</button>
            ${picked ? `<span>${picked} poste(s) escolhido(s)</span><button type="button" class="auto-design__link" data-auto-design="clear-poles">Limpar</button>` : ''}
        </div>`;
    const custom = access.routes.find(r => r.custom);
    const help = picking ? AUTO_DESIGN_EDIT_HINTS.poles
        : custom?.loose ? 'Algum trecho entre os postes escolhidos não achou rua e ficou reto: confira no mapa.'
        : access.routes.length > 1
        ? 'Caminhos diferentes pelas ruas (nenhum passa sobre casas; rio só por ponte e quando não há outro). O mapa mostra só a rota escolhida.'
        : 'Só há um caminho pelas ruas, sem passar sobre casas, saindo daí.';
    return `<div class="auto-design__routes">
            <div class="auto-design__routes-title">Saindo de ${esc(access.from.name || 'caixa existente')}</div>
            <div class="auto-design__route-list" role="radiogroup" aria-label="Rotas de chegada">${buttons}</div>
            ${tools}
            <p class="map-tool-help">${esc(help)}</p>
        </div>`;
}

function renderAutoDesignPreviewPanel() {
    const s = autoDesign;
    const plan = s.result;
    const st = plan.stats;
    const p = plan.params;
    const cost = plan.cost;
    const esc = (v) => escapeHtml(String(v ?? ''));
    document.getElementById('autoDesignTitle').textContent = s.options?.length > 1 ? 'Escolha a opção' : 'Prévia do pré-projeto';
    const extra = plan.ctos.length - plan.byPorts;
    const rows = summarizeAutoDesignCables(plan).map(r => `
        <li><span><i style="background:${esc(getCableColor(r.fiber))}"></i>${AUTO_DESIGN_ROLE_LABELS[r.role]} ${esc(r.fiber)}${r.count > 1 ? ` <small>· ${r.count} cabos</small>` : ''}</span><b>${esc(formatAutoDesignMeters(r.length))}</b></li>`).join('');
    const warnings = getAutoDesignWarnings(plan, p);
    const ports = plan.ctos.length * p.ports;
    const ceoText = st.ceos > 1 ? `${st.ceos} CEOs novas` : plan.root.isNew ? plan.root.name : `Sai de ${plan.root.name}`;
    const split = p.levels === 2 ? `1:${p.primary} × 1:${p.ports}` : `1:${p.ports}`;
    const mode = s.editMode;
    const tool = (action, label, active) => `<button type="button" class="map-tool-btn auto-design__tool${active ? ' is-active' : ''}" data-auto-design="${action}" aria-pressed="${active ? 'true' : 'false'}">${label}</button>`;
    const costRows = cost ? [
        ['Cabos', cost.sections.cables], ['Ferragens (≈ ' + cost.poles.toLocaleString('pt-BR') + ' postes)', cost.sections.hardware],
        ['Caixas e reservas', cost.sections.boxes], [`Fusão (${cost.fusions} fusões)`, cost.sections.fusion], ['Mão de obra (ref. terceirizada)', cost.labor],
    ].map(([label, value]) => `<li><span>${esc(label)}</span><b>${esc(formatAutoDesignMoney(value))}</b></li>`).join('') : '';
    document.getElementById('autoDesignBody').innerHTML = `
        ${renderAutoDesignOptions(s)}
        ${renderAutoDesignAccessRoutes(s)}
        <dl class="map-tool-stats">
            <div><dt>CTOs</dt><dd>${plan.ctos.length} · ${esc(split)}</dd></div>
            <div><dt>${plan.root.isNew || st.ceos > 1 ? 'CEO' : 'Origem'}</dt><dd>${esc(ceoText)}</dd></div>
            <div><dt>Cobertura</dt><dd>${Math.round(st.coverage * 100)}% das casas</dd></div>
            <div><dt>Clientes / portas</dt><dd>${st.clients.toLocaleString('pt-BR')} / ${ports.toLocaleString('pt-BR')}</dd></div>
            ${st.existingCtos ? `<div><dt>CTOs existentes</dt><dd title="Já estão no mapa e entraram na conta">${st.existingCtos} · ≈ ${st.existingClients.toLocaleString('pt-BR')} clientes</dd></div>` : ''}
            <div><dt>PONs</dt><dd>${st.pons.toLocaleString('pt-BR')}</dd></div>
            ${cost ? `<div><dt>Custo estimado</dt><dd title="${esc(formatAutoDesignMoney(cost.total))}">${esc(formatAutoDesignMoneyShort(cost.total))}</dd></div>` : ''}
        </dl>
        ${cost ? `<p class="auto-design__cost">${esc(formatAutoDesignMoney(cost.perPort))} por porta · ${esc(formatAutoDesignMoney(cost.perClient))} por cliente</p>` : ''}
        ${extra > 0 ? `<p class="map-tool-help">${plan.byPorts} CTOs pela quantidade de clientes + ${extra} para alcançar toda a área sem lotar as caixas.</p>` : ''}
        <ul class="auto-design__list">${rows}</ul>
        ${cost ? `<details class="auto-design__more"><summary>Custo estimado: ${esc(formatAutoDesignMoney(cost.total))}</summary><ul class="auto-design__list">${costRows}</ul><p class="map-tool-help">Materiais pela lista de materiais (preços do catálogo); mão de obra pela tabela padrão da terceirizada.</p></details>` : ''}
        <div class="auto-design__tools" role="group" aria-label="Editar a prévia">
            ${tool('mode-add', '+ CTO', mode === 'add')}${tool('mode-remove', '− CTO', mode === 'remove')}${tool('mode-exclude', 'Sem casas', mode === 'exclude')}
        </div>
        <p class="map-tool-help auto-design__hint">${s.busy ? '<span class="route-suggest__spinner" aria-hidden="true"></span> Atualizando a rede…' : esc(AUTO_DESIGN_EDIT_HINTS[mode] || 'Arraste as caixas no mapa para mover; a rede, as fibras e o custo se refazem sozinhos.')}</p>
        ${s.exclusions.length ? `<p class="map-tool-help">${s.exclusions.length} trecho(s) sem casas. <button type="button" class="auto-design__link" data-auto-design="clear-exclusions">Limpar</button></p>` : ''}
        ${warnings.map(w => `<div class="auto-design__warn">${esc(w)}</div>`).join('')}
        <p class="map-tool-help">Tracejado laranja = cabo do pré-projeto, ainda não salvo. Ao aceitar, as caixas (CTOs com splitter 1:${p.ports}${p.levels === 2 ? `, CEO com splitter 1:${p.primary}` : ''}), ${plan.reserves?.length ? `${plan.reserves.length} reserva(s) técnica(s), ` : ''}os cabos e os planos de fusão entram como <b>Novo</b> numa pasta própria. Círculo verde = raio de ${plan.model.coverRadius} m de cada CTO${st.existingCtos ? `; azul = CTO que já existe (atende ≈ ${st.existingClients.toLocaleString('pt-BR')} dos clientes previstos, as novas ficam com o resto)` : ''}.</p>`;
    document.getElementById('autoDesignActions').innerHTML = `
        <button type="button" class="map-tool-btn" data-auto-design="cancel">Descartar</button>
        <button type="button" class="map-tool-btn" data-auto-design="adjust">Ajustar</button>
        <button type="button" class="map-tool-btn" data-auto-design="compare" title="Comparar CTO 1:8 × 1:16 (custo, portas, cobertura)">Comparar</button>
        <button type="button" class="map-tool-btn map-tool-btn--primary" data-auto-design="accept"${s.busy ? ' disabled' : ''}>${s.options?.length > 1 ? `Criar ${esc(plan.option.label.toLowerCase())}` : 'Aceitar e criar'}</button>`;
}

// ---------------------------------------------------------------
// Comparar 1:8 × 1:16 (mesma área, mesmas opções)
// ---------------------------------------------------------------

async function compareAutoDesign() {
    const s = autoDesign;
    const plan = s?.result;
    if (!plan) return;
    const token = {};
    s.token = token;
    const isCurrent = () => autoDesign === s && s.token === token;
    s.phase = 'compare';
    s.compare = { loading: true, rows: [] };
    renderAutoDesign();
    const inputs = await collectAutoDesignInputs(s, isCurrent);
    if (!isCurrent()) return;
    const rows = [];
    for (const ports of AUTO_DESIGN_SPLITTERS) {
        if (ports === plan.params.ports) {
            rows.push({ ports, primary: plan.params.primary, plan, cost: plan.cost, current: true });
            continue;
        }
        const params = { ...plan.params, ports };
        clampAutoDesignPrimary(params);
        const other = await buildAutoDesignPlan(inputs.polygonPath, params, getAutoDesignStartMarker(), plan.names, inputs, { isCurrent, roads: plan.roads });
        if (!isCurrent()) return;
        if (other.error || other.cancelled) continue;
        //Sem traçar: o comprimento dos cabos é a distância pela rua (ou de poste em poste)
        placeAutoDesignReserves(other);
        other.cost = estimateAutoDesignCost(other);
        rows.push({ ports, primary: params.primary, plan: other, cost: other.cost, current: false });
    }
    s.compare = { loading: false, rows };
    renderAutoDesign();
}

function renderAutoDesignComparePanel() {
    const s = autoDesign;
    const esc = (v) => escapeHtml(String(v ?? ''));
    document.getElementById('autoDesignTitle').textContent = 'Comparar splitagem';
    const body = document.getElementById('autoDesignBody');
    const actions = document.getElementById('autoDesignActions');
    if (s.compare?.loading) {
        body.innerHTML = '<p class="auto-design__loading"><span class="route-suggest__spinner" aria-hidden="true"></span>Montando os dois cenários…</p>';
        actions.innerHTML = '<button type="button" class="map-tool-btn" data-auto-design="back">Voltar</button>';
        return;
    }
    const rows = s.compare?.rows || [];
    const best = rows.reduce((a, r) => (!a || r.cost.total < a.cost.total ? r : a), null);
    const head = rows.map(r => `<th scope="col">1:${r.ports}${r.current ? ' <small>(atual)</small>' : ''}</th>`).join('');
    const line = (label, get) => `<tr><th scope="row">${esc(label)}</th>${rows.map(r => `<td${r === best && /Total/.test(label) ? ' class="is-best"' : ''}>${esc(get(r))}</td>`).join('')}</tr>`;
    body.innerHTML = `
        <div class="auto-design__table"><table class="auto-design__compare">
            <thead><tr><th></th>${head}</tr></thead>
            <tbody>
                ${line('CTOs', r => r.plan.ctos.length)}
                ${line('PONs', r => r.plan.stats.pons)}
                ${line('Portas', r => (r.plan.ctos.length * r.ports).toLocaleString('pt-BR'))}
                ${line('Cobertura', r => `${Math.round(r.plan.stats.coverage * 100)}%`)}
                ${line('Cabo', r => formatAutoDesignMeters(r.cost.cableMeters))}
                ${line('Materiais', r => formatAutoDesignMoneyShort(r.cost.materials))}
                ${line('Mão de obra', r => formatAutoDesignMoneyShort(r.cost.labor))}
                ${line('Total', r => formatAutoDesignMoneyShort(r.cost.total))}
                ${line('Por porta', r => formatAutoDesignMoney(r.cost.perPort))}
                ${line('Por cliente', r => formatAutoDesignMoney(r.cost.perClient))}
            </tbody>
        </table></div>
        <p class="map-tool-help">O cenário que não está na tela usa a distância pela rua para os cabos (sem traçar). ${best ? `Mais barato: <b>1:${best.ports}</b>.` : ''}</p>`;
    const other = rows.find(r => !r.current);
    actions.innerHTML = `
        <button type="button" class="map-tool-btn" data-auto-design="back">Voltar</button>
        ${other ? `<button type="button" class="map-tool-btn map-tool-btn--primary" data-auto-design="use-ports" data-ports="${other.ports}">Usar 1:${other.ports}</button>` : ''}`;
}

// ---------------------------------------------------------------
// Aceitar: cria a pasta, as caixas, as reservas, os cabos e os planos de fusão de verdade
// ---------------------------------------------------------------

function createAutoDesignMarker(box, folderId) {
    const meta = getMarkerTypeMeta(box.type);
    const data = {
        type: box.type,
        name: box.name,
        color: box.type === 'CASA' ? '#ffffff' : meta.color,
        labelColor: '#000000',
        size: DEFAULT_MARKER_SIZE,
        description: AUTO_DESIGN_GENERATED_NOTE,
        ctoStatus: 'Nova', isPredial: false, needsStickers: false,
        ceoStatus: 'Nova', ceoAccessory: 'Raquete', is144F: false,
        reservaStatus: 'Nova', reservaAccessory: 'Raquete',
    };
    const previous = activeFolderId;
    activeFolderId = folderId;
    try {
        addCustomMarker(box.position, data);
    } finally {
        activeFolderId = previous;
    }
    return markers[markers.length - 1];
}

//Plano de fusão da CTO só com o splitter de atendimento (Novo): o relatório e a lista de materiais contam as portas
function buildAutoDesignSplitterPlan(ratio) {
    if (typeof buildFusionSplitterCard !== 'function') return '';
    const card = buildAutoDesignSplitterCard({ kind: 'service', ratio });
    return JSON.stringify({ version: 2, elements: card.outerHTML, svg: '' });
}

function buildAutoDesignSplitterCard({ kind, ratio }) {
    const service = kind === 'service';
    const label = service ? `1:${ratio} APC` : `1:${ratio}`;
    return buildFusionSplitterCard({
        id: `splitter-${label.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label, outputs: ratio, status: 'Novo', type: service ? 'Atendimento' : 'Fusão', connector: service ? 'APC' : '',
    });
}

//Plano de fusão completo da caixa: cabos que chegam/saem, splitters e as fusões (linhas)
function buildAutoDesignFusionPlan(box, markerInfo) {
    const fusion = box.fusion;
    if (!fusion || typeof buildFusionCableCard !== 'function') return '';
    const container = document.createElement('div');
    const svg = document.createElementNS(SVG_NS, 'svg');
    const previous = activeMarkerForFusion;
    activeMarkerForFusion = markerInfo;
    try {
        const cards = new Map();
        const cardFor = (cable) => {
            if (cards.has(cable)) return cards.get(cable);
            const incoming = cable === box.in;
            const info = incoming ? cable.created.last : cable.created.first;
            const role = incoming ? 'entrada' : 'saida';
            const card = buildFusionCableCard({
                name: info.name, uid: info.uid, type: info.type, status: 'Novo', role,
                fiberCount: getAutoDesignFiberCount(cable.fiber),
                otherEnd: typeof getCableOtherEndName === 'function' ? getCableOtherEndName(info, role) : '',
            });
            cards.set(cable, card);
            return card;
        };
        if (box.in) container.appendChild(cardFor(box.in));
        const splitters = fusion.splitters.map(spec => {
            const card = buildAutoDesignSplitterCard(spec);
            container.appendChild(card);
            return card;
        });
        box.out.forEach(cable => container.appendChild(cardFor(cable)));
        const portId = (end) => {
            if (end.cable) return cardFor(end.cable).querySelectorAll('.fiber-row')[end.fiber - 1]?.id;
            const card = splitters[end.splitter];
            return end.port === 'in' ? `${card.id}-input-port` : `${card.id}-output-${end.port}`;
        };
        fusion.lines.forEach(line => {
            const start = portId(line.a), end = portId(line.b);
            if (!start || !end) return;
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('class', 'fusion-line');
            path.id = `line-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            path.dataset.startId = start;
            path.dataset.endId = end;
            path.dataset.points = '[]';
            svg.appendChild(path);
        });
    } finally {
        activeMarkerForFusion = previous;
    }
    const planData = { version: 2, elements: container.innerHTML, svg: svg.innerHTML };
    if (box.type === 'CEO') planData.trayQuantity = Math.ceil(fusion.lines.length / AUTO_DESIGN_FUSIONS_PER_TRAY);
    return JSON.stringify(planData);
}

function createAutoDesignCable(segment, fiber, folderId, span, startMarker, endMarker) {
    const color = getCableColor(fiber);
    const width = DEFAULT_CABLE_WIDTH_NEW;
    const path = segment.path.map(p => new google.maps.LatLng(p.lat(), p.lng()));
    const polyline = new google.maps.Polyline({ path, map, strokeColor: color, strokeWeight: width, clickable: true });
    const info = {
        folderId,
        name: `${fiber}-${endMarker.name}`,
        type: `Cabo ${span} ${fiber}`,
        width, color, path, polyline,
        item: null,
        status: 'Novo',
        lancamento: 0, reserva: 0, totalLength: 0,
        surchargePercent: 0,
        conduit: [],
        description: '',
    };
    assignCableAnchorMarkers(info, startMarker, endMarker);
    const measurement = calculateCableMeasurement(info);
    info.lancamento = measurement.lancamento;
    info.reserva = measurement.reserva;
    info.totalLength = measurement.total;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'item-name';
    nameSpan.style.cursor = 'pointer';
    const item = buildGeProMapItemRow(nameSpan, polyline, 'ge-icon-path', color);
    document.getElementById(folderId).appendChild(item);
    info.item = item;
    ensureItemUid(info, 'cb', savedCables);
    updateCableSidebarLabel(info);
    wireCableSidebarClick(info);
    applyCableSidebarColorStyles(info);
    savedCables.push(info);
    addCableEventListeners(polyline);
    return info;
}

function getAutoDesignFolderName(parentUl, polygonName) {
    const base = `Pré-projeto ${polygonName || 'da área'}`.trim();
    const taken = new Set([...parentUl.querySelectorAll(':scope > .folder-wrapper > .folder-title')].map(t => t.dataset.folderName));
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base} (${i})`;
    return name;
}

function acceptAutoDesign() {
    const s = autoDesign;
    const plan = s?.result;
    if (!plan || s.busy || !requireEdit('criar o pré-projeto')) return;
    const parentUl = document.getElementById(s.polygon.folderId);
    if (!parentUl) {
        showAlert('Atenção', 'Não encontrei a pasta do polígono. Abra o projeto e tente de novo.');
        return;
    }
    setAutoDesignEditMode(null);
    const folderId = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const folderName = getAutoDesignFolderName(parentUl, s.polygon.name);
    rebuildSidebarFromJSON([{ id: folderId, name: folderName, isProject: false, children: [] }], parentUl);
    const created = new Map();
    const boxMarker = (box) => {
        if (box.existing) return box.existing;
        if (!created.has(box)) created.set(box, createAutoDesignMarker(box, folderId));
        return created.get(box);
    };
    plan.ceos.filter(c => c.isNew).forEach(boxMarker);
    plan.ctos.forEach(boxMarker);
    //Casas da área num marcador só (Casas/HP do relatório); com as casas do mapa, elas já estão lá
    if (plan.model.demandKind !== 'houses') createAutoDesignMarker({ type: 'CASA', name: String(plan.houses.count), position: plan.houses.position }, folderId);
    const cables = [];
    plan.cables.forEach(cable => {
        const segments = getAutoDesignCableSegments(cable).map(segment => {
            const info = createAutoDesignCable(segment, cable.fiber, folderId, s.params.span, boxMarker(segment.from), boxMarker(segment.to));
            cables.push(info);
            return info;
        });
        cable.created = { first: segments[0], last: segments[segments.length - 1] };
    });
    syncProjectCableMeasurements(cables);
    //Planos de fusão: com os cabos já criados (o cartão guarda o uid do cabo)
    getAutoDesignNetworkBoxes(plan).forEach(box => {
        if (!box.isNew || !box.fusion) return;
        const markerInfo = created.get(box);
        markerInfo.fusionPlan = buildAutoDesignFusionPlan(box, markerInfo) || (box.type === 'CTO' ? buildAutoDesignSplitterPlan(s.params.ports) : '');
    });
    if (typeof autoLinkSplitterOlts === 'function') {
        try { autoLinkSplitterOlts(); } catch (e) { /* vínculo com a OLT é opcional */ }
    }
    setActiveFolder(folderId);
    document.getElementById(folderId)?.classList.remove('hidden');
    refreshBomAfterProjectChange();
    clearAutoDesignPreview();
    s.mapListener?.remove?.();
    s.mapListener = null;
    //Polígono desenhado só para isso sai do projeto; um que já existia fica, marcado como usado no pré-projeto
    const removedPolygon = s.polygonDrawn ? removeAutoDesignPolygon(s.polygon) : null;
    let previousMark;
    if (!removedPolygon) {
        previousMark = s.polygon.preProjeto;
        s.polygon.preProjeto = folderName;
        showAutoDesignPolygon(s, true);
        if (typeof refreshPolygonSidebarLabel === 'function') refreshPolygonSidebarLabel(s.polygon);
    }
    s.created = {
        folderId, folderName, removedPolygon, polygon: s.polygon, previousMark,
        option: s.options?.length > 1 ? [plan.option.label, ...plan.option.tags].join(' · ') : null,
        projectId: getAutoDesignProjectId(s.polygon),
        ceos: plan.ceos.filter(c => c.isNew).length,
        ctos: plan.ctos.length,
        reserves: (plan.reserves || []).length,
        cables: cables.length,
        fusions: plan.cost?.fusions || 0,
        total: plan.cost?.total || 0,
    };
    s.phase = 'done';
    renderAutoDesign();
    showToast('Pré-projeto criado', `${s.created.ceos ? `${s.created.ceos} CEO(s), ` : ''}${plan.ctos.length} CTOs e ${cables.length} cabos como Novo. Lista de materiais atualizada; lembre de salvar o projeto.`);
}

function renderAutoDesignDonePanel() {
    const s = autoDesign;
    const c = s.created;
    const esc = (v) => escapeHtml(String(v ?? ''));
    document.getElementById('autoDesignTitle').textContent = 'Pré-projeto criado';
    document.getElementById('autoDesignBody').innerHTML = `
        <dl class="map-tool-stats">
            <div><dt>Pasta</dt><dd>${esc(c.folderName)}</dd></div>
            <div><dt>Caixas</dt><dd>${c.ceos ? `${c.ceos} CEO · ` : ''}${c.ctos} CTO</dd></div>
            <div><dt>Cabos</dt><dd>${c.cables}${c.reserves ? ` · ${c.reserves} RT` : ''}</dd></div>
            <div><dt>Fusões</dt><dd>${c.fusions}</dd></div>
        </dl>
        <p class="map-tool-help">${c.option ? `<b>${esc(c.option)}</b>. ` : ''}Tudo entrou como <b>Novo</b>, com os planos de fusão montados, ${c.removedPolygon ? ' e o polígono da área saiu do mapa' : ' e o polígono continua no projeto, marcado como usado no pré-projeto'}. Lembre de salvar o projeto. Se não ficou bom, desfaça e gere de novo.</p>`;
    document.getElementById('autoDesignActions').innerHTML = `
        <button type="button" class="map-tool-btn" data-auto-design="undo">Desfazer pré-projeto</button>
        <button type="button" class="map-tool-btn map-tool-btn--primary" data-auto-design="cancel">Fechar</button>`;
}

//Tira tudo o que o pré-projeto criou (a pasta inteira) de uma vez
function undoAutoDesign(record = autoDesign?.created) {
    if (!record || !requireEdit('desfazer o pré-projeto')) return false;
    const folderIds = getAllDescendantFolderIds(record.folderId);
    if (!folderIds.length) return false;
    markers.filter(m => folderIds.includes(m.folderId)).forEach(m => m.marker?.setMap(null));
    markers = markers.filter(m => !folderIds.includes(m.folderId));
    savedCables.filter(c => folderIds.includes(c.folderId)).forEach(c => c.polyline?.setMap(null));
    savedCables = savedCables.filter(c => !folderIds.includes(c.folderId));
    document.getElementById(record.folderId)?.closest('.folder-wrapper')?.remove();
    if (record.removedPolygon) restoreAutoDesignPolygon(record.removedPolygon);
    else if (record.polygon) {
        record.polygon.preProjeto = record.previousMark;
        if (typeof refreshPolygonSidebarLabel === 'function') refreshPolygonSidebarLabel(record.polygon);
    }
    const polygonFolder = autoDesign?.polygon?.folderId;
    if (!activeFolderId || folderIds.includes(activeFolderId)) {
        if (polygonFolder && document.getElementById(polygonFolder)) setActiveFolder(polygonFolder);
        else if (record.projectId) setActiveFolder(record.projectId);
    }
    refreshBomAfterProjectChange();
    showToast('Pré-projeto desfeito', `A pasta "${record.folderName}" e tudo o que foi criado nela saíram do projeto.`);
    if (autoDesign?.created === record) {
        autoDesign.created = null;
        autoDesign.result = null;
        autoDesign.options = [];
        autoDesign.phase = 'form';
        renderAutoDesign();
    }
    return true;
}

// ---------------------------------------------------------------
// Ligações
// ---------------------------------------------------------------

document.addEventListener('click', (e) => {
    const button = e.target.closest('#autoDesignBox [data-auto-design]');
    if (button) {
        const action = button.dataset.autoDesign;
        const s = autoDesign;
        if (action === 'cancel') closeAutoDesign();
        else if (action === 'generate') generateAutoDesign();
        else if (action === 'accept') acceptAutoDesign();
        else if (action === 'compare') compareAutoDesign();
        else if (action === 'undo') undoAutoDesign();
        else if (action === 'clear-exclusions') clearAutoDesignExclusions();
        else if (action === 'option') selectAutoDesignOption(button.dataset.option);
        else if (action === 'access-route') selectAutoDesignAccessRoute(parseInt(button.dataset.route, 10));
        else if (action === 'clear-poles') clearAutoDesignAccessPoles();
        else if (action === 'back' && s) {
            s.token = {};
            s.phase = s.result ? 'preview' : 'form';
            renderAutoDesign();
        } else if (action === 'use-ports' && s) {
            s.params.ports = parseInt(button.dataset.ports, 10) || s.params.ports;
            clampAutoDesignPrimary(s.params);
            generateAutoDesign();
        } else if (action.startsWith('mode-') && s) {
            setAutoDesignEditMode(action.slice(5));
            if (s.result) drawAutoDesignPreview();
            renderAutoDesign();
        } else if (action === 'adjust' && s) {
            setAutoDesignEditMode(null);
            s.token = {};
            s.busy = false;
            clearAutoDesignPreview();
            showAutoDesignPolygon(s, true);
            s.phase = 'form';
            s.result = null;
            s.options = [];
            renderAutoDesign();
        }
        return;
    }
    if (e.target.closest('#closeAutoDesignButton')) closeAutoDesign();
    //Desenhar → Pré-projeto automático: desenha a área e, ao salvar o polígono, abre o painel
    if (e.target.closest('#autoDesignMenuButton')) handleAutoDesignMenu(e);
});

async function handleAutoDesignMenu(e) {
    {
        e.preventDefault();
        if (!requireEdit('gerar o pré-projeto')) return;
        if (!activeFolderId) {
            showAlert('Atenção', 'Selecione um projeto na barra lateral antes de gerar o pré-projeto.');
            return;
        }
        closeAutoDesign();
        //Já tem polígono no projeto: pode usar um deles como área
        const existing = savedPolygons.filter(p => p.polygonObject?.getMap?.() && getAutoDesignProjectId(p) === getAutoDesignProjectId({ folderId: activeFolderId }));
        if (existing.length) {
            const choice = await showChoice({ title: 'Pré-projeto automático', message: `Este projeto já tem ${existing.length} polígono(s). Quer usar um deles como área do pré-projeto ou desenhar uma área nova?`,
                choices: [{ label: 'Cancelar', value: null }, { label: 'Desenhar nova', value: 'draw' }, { label: 'Usar existente', kind: 'primary', value: 'pick' }] });
            if (!choice) return;
            if (choice === 'pick') {
                autoDesignPickingPolygon = true;
                setMapCursor('pointer');
                showToast('Pré-projeto automático', 'Clique no polígono que será a área do pré-projeto (Esc cancela).');
                return;
            }
        }
        startPolygonTool();
        if (!isDrawingPolygon) return;
        autoDesignAfterPolygon = true;
        const nameInput = document.getElementById('polygonName');
        if (nameInput) nameInput.value = 'Área do pré-projeto';
        showToast('Pré-projeto automático', 'Desenhe a área no mapa e salve o polígono. Depois é só dizer quantas casas tem.');
    }
}

//Esc cancela a escolha do polígono
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && typeof autoDesignPickingPolygon !== 'undefined' && autoDesignPickingPolygon) {
        autoDesignPickingPolygon = false;
        setMapCursor('');
    }
});

document.addEventListener('input', (e) => {
    if (!autoDesign || autoDesign.phase !== 'form' || !e.target.closest('#autoDesignBox')) return;
    const p = autoDesign.params;
    if (e.target.id === 'autoDesignHouses') p.houses = e.target.value;
    if (e.target.id === 'autoDesignOccupancy') p.occupancy = Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 0));
    if (e.target.id === 'autoDesignFill') p.maxFill = Math.min(100, Math.max(25, parseInt(e.target.value, 10) || 100));
    if (e.target.id === 'autoDesignRadius' && parseInt(e.target.value, 10) > 0) p.coverRadius = getAutoDesignCoverRadius({ coverRadius: e.target.value });
    renderAutoDesignCalc();
});

document.addEventListener('change', (e) => {
    if (!autoDesign || autoDesign.phase !== 'form' || !e.target.closest?.('#autoDesignBox')) return;
    if (['autoDesignStart', 'autoDesignUseHouses', 'autoDesignUsePoles', 'autoDesignUseExisting'].includes(e.target.id)) {
        readAutoDesignForm();
        renderAutoDesign();
    }
});

document.addEventListener('keydown', (e) => {
    if (!autoDesign) return;
    if (e.key === 'Escape') {
        if (autoDesign.editMode) { setAutoDesignEditMode(null); if (autoDesign.result) drawAutoDesignPreview(); renderAutoDesign(); } else closeAutoDesign();
    } else if (e.key === 'Enter' && autoDesign.phase === 'form' && e.target.closest?.('#autoDesignBox input')) generateAutoDesign();
});
