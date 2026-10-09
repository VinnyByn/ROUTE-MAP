// Pré-projeto automático: a partir de um polígono, da quantidade de casas, da taxa de penetração e da
// splitagem, descobre onde há ruas (e casas) dentro da área, distribui as caixas por elas e monta a rede:
// POP → CEO(s) → CTOs, com cabos traçados pelas ruas (OSRM, o mesmo da sugestão de rota) ou de poste em
// poste quando a área tem postes cadastrados. Mato, pasto e rio sem rua ficam sem caixa.
// A prévia (tracejada) mostra o custo estimado e pode ser editada: arrastar, incluir e tirar CTOs e marcar
// trechos sem casas. Nada é salvo até "Aceitar e criar": aí as caixas, as reservas técnicas, os cabos e os
// planos de fusão (splitters ligados e fibras de passagem fundidas) entram como Novo numa pasta própria,
// e a lista de materiais é refeita. Depois de criado, "Desfazer pré-projeto" tira tudo de uma vez.
// Depende de script.js, js/persistence.js, js/marker-panel.js, js/marker-icons.js, js/fusion.js
// (buildFusionCableCard, buildFusionSplitterCard), js/catalog.js, js/bom.js, js/labor.js,
// js/clients.js (fetchOsrmRoute, reserva quando o OSRM de carro falha) e js/cable-route-suggest.js (simplifyPathMeters).

//Servidores OSRM públicos (gratuitos, sem chave). Primeiro o perfil de carro: só ruas de verdade, sem
//vielas, escadarias e caminhos de pedestre que passam entre as casas (onde caixa e cabo não vão).
//O perfil a pé fica por último, só para quando os de carro não responderem.
const AUTO_DESIGN_OSRM_SERVERS = [
    { base: 'https://routing.openstreetmap.de/routed-car', profile: 'driving' },
    { base: 'https://router.project-osrm.org', profile: 'driving' },
    { base: 'https://routing.openstreetmap.de/routed-foot', profile: 'foot' },
];
const AUTO_DESIGN_SAMPLE_MAX = 400;  //Pontos da área consultados para achar as ruas
const AUTO_DESIGN_SAMPLE_CHUNK = 80; //Pontos por consulta (cabe na tabela do OSRM público)
const AUTO_DESIGN_STREET_MAX_M = 40; //Ponto a mais de 40 m de qualquer rua = sem casas (mato, pasto, rio)
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
const AUTO_DESIGN_MAX_SPLIT = 64;    //Splitagem total (CEO × CTO) acima de 1:64 não fecha o orçamento óptico
const AUTO_DESIGN_RESERVE_STEPS = [0, 300, 500, 1000];
const AUTO_DESIGN_CEO_LIMITS = [0, 8, 12, 16, 24, 32];
const AUTO_DESIGN_FUSIONS_PER_TRAY = 12;
const AUTO_DESIGN_MIN_HOUSE_MARKERS = 5;
const AUTO_DESIGN_MIN_POLES = 4;
const AUTO_DESIGN_PARAMS_KEY = 'routeMapAutoDesignParams';
const AUTO_DESIGN_GENERATED_NOTE = 'Gerado pelo pré-projeto automático';
//Mão de obra de referência (tabela padrão da terceirizada, js/labor.js)
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

//service = 'table' | 'nearest' | 'route'; points = [{ lat, lng }]. Devolve a resposta (code Ok) ou null.
async function fetchAutoDesignOsrm(service, points, query) {
    const coords = points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    for (const { base, profile } of AUTO_DESIGN_OSRM_SERVERS) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(`${base}/${service}/v1/${profile}/${coords}?${query}`, { signal: controller.signal });
            clearTimeout(timer);
            if (!response.ok) continue;
            const data = await response.json();
            if (data?.code === 'Ok') return data;
        } catch (e) {
            //Tenta o próximo servidor
        }
    }
    return null;
}

//Onde há rua dentro da área: uma grade de pontos é consultada no OSRM, que devolve o ponto de rua mais
//perto de cada um (com o nome da rua). Ponto longe de rua (mato, pasto, rio) fica de fora; o que sobra
//são pontos em cima das ruas, onde ficam as casas e onde as caixas podem ir.
//Devolve { points: [{ lat, lng, w }] } (vazio = não há ruas) ou null quando o OSRM não respondeu.
async function sampleAutoDesignStreets(polygonPath, isCurrent) {
    const proj = createAutoDesignProjection(polygonPath);
    const polyXY = polygonPath.map(p => proj.toXY(p.lat, p.lng));
    const xs = polyXY.map(p => p[0]), ys = polyXY.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const step = Math.max(20, Math.sqrt(polygonAreaXY(polyXY) / AUTO_DESIGN_SAMPLE_MAX));
    const samples = [];
    for (let x = minX + step / 2; x <= maxX; x += step) {
        for (let y = minY + step / 2; y <= maxY; y += step) {
            if (pointInPolygonXY([x, y], polyXY)) samples.push(proj.toLatLng([x, y]));
        }
    }
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
    const use = named.length >= 6 ? named : near;
    //Pontos repetidos (vários da grade caem no mesmo trecho de rua) somam o peso
    const cells = new Map();
    use.forEach(p => {
        const [x, y] = proj.toXY(p.lat, p.lng);
        const key = `${Math.round(x / 10)},${Math.round(y / 10)}`;
        const cell = cells.get(key);
        if (cell) cell.w += step;
        else cells.set(key, { lat: p.lat, lng: p.lng, w: step });
    });
    return { points: [...cells.values()] };
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
function buildAutoDesignModel(polygonPath, params, inputs = {}) {
    const { streets = null, houseMarkers = [], poleMarkers = [], exclusions = [] } = inputs;
    const proj = createAutoDesignProjection(polygonPath);
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
    let sites, siteKind;
    if (params.usePoles && poleMarkers.length >= AUTO_DESIGN_MIN_POLES) {
        sites = poleMarkers.map(m => ({ ...xyOfMarker(m), pole: true }));
        siteKind = 'poles';
    } else if (streetNodes.length) {
        sites = streetNodes.map(n => ({ x: n.x, y: n.y }));
        siteKind = 'streets';
    } else {
        sites = demand.map(n => ({ x: n.x, y: n.y }));
        siteKind = demandKind;
    }
    demand = demand.filter(keep);
    sites = sites.filter(keep);
    const totalWeight = demand.reduce((s, n) => s + n.w, 0);
    //Com as casas do mapa, a quantidade é a das casas que sobraram (fora dos trechos sem casas)
    const houses = demandKind === 'houses' ? totalWeight : Number(params.houses) || 0;
    return {
        proj, polyXY, demand, sites, demandKind, siteKind, totalWeight, houses,
        housesPerWeight: totalWeight ? houses / totalWeight : 0,
        coverRadius: getAutoDesignCoverRadius(params),
        streetsOk: !!streets,
        poleGraph: siteKind === 'poles' ? buildAutoDesignPoleGraph(sites) : null,
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
// Postes: rede de poste em poste (vizinhos até ~1,6 vão) e caminho mais curto por ela
// ---------------------------------------------------------------

function buildAutoDesignPoleGraph(sites) {
    const n = sites.length;
    const d = (i, j) => Math.hypot(sites[i].x - sites[j].x, sites[i].y - sites[j].y);
    const nearest = sites.map((_, i) => {
        let best = Infinity;
        for (let j = 0; j < n; j++) if (j !== i) best = Math.min(best, d(i, j));
        return best;
    }).filter(Number.isFinite).sort((a, b) => a - b);
    const median = nearest.length ? nearest[Math.floor(nearest.length / 2)] : 40;
    const link = Math.min(80, Math.max(45, median * 1.6));
    const adj = sites.map(() => []);
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const dij = d(i, j);
            if (dij <= link) { adj[i].push([j, dij]); adj[j].push([i, dij]); }
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

function placeAutoDesignCtos(model, candidates, k) {
    const { demand, sites } = model;
    k = Math.max(1, Math.min(k, candidates.length));
    let sw = 0, sx = 0, sy = 0;
    demand.forEach(n => { sw += n.w; sx += n.x * n.w; sy += n.y * n.w; });
    //Começo: o local do meio e depois sempre o mais longe (das casas) dos já escolhidos
    let centers = [nearestAutoDesignSite(sites, [sx / sw, sy / sw], candidates)];
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
    for (let tries = 0; tries < 40; tries++) {
        placement = placeAutoDesignCtos(model, candidates, k);
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
    const candidates = model.sites.map((_, i) => i).filter(i => Math.hypot(model.sites[i].x - root.x, model.sites[i].y - root.y) > 25);
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
        stats: { snapped: 0, straight: 0, noStreets: !model.streetsOk, tooMany: false },
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

//Distâncias pela rua entre as caixas (tabela do OSRM). Só pede as linhas que faltam: depois de mexer numa
//caixa da prévia, é uma consulta pequena.
async function ensureAutoDesignRoadDistances(plan) {
    if (!plan.model.streetsOk) return;
    const boxes = getAutoDesignNetworkBoxes(plan);
    if (boxes.length > AUTO_DESIGN_TABLE_MAX || boxes.length < 2) return;
    const keys = boxes.map(getAutoDesignPosKey);
    //Caixa sem linha na tabela = nova (ou movida); a linha dela completa as outras nos dois sentidos
    const missing = keys.map((k, i) => i).filter(i => !plan.roads.has(keys[i]));
    if (!missing.length) return;
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
    if (graph && a.pole != null && b.pole != null) {
        const d = getAutoDesignPoleTree(graph, a.pole).dist[b.pole];
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
    //Árvore das CEOs e, em cada CEO, a árvore das suas CTOs
    const ceoTree = buildAutoDesignTree(ceos, (i, j) => dist(ceos[i], ceos[j]));
    ceos.forEach((ceo, ei) => {
        ceo.ceoKids = ceoTree.children[ei].map(i => ceos[i]);
        const nodes = [ceo, ...ctos.filter(cto => owner.get(cto) === ei)];
        const tree = buildAutoDesignTree(nodes, (i, j) => dist(nodes[i], nodes[j]));
        nodes.forEach((node, i) => { node.kids = tree.children[i].map(k => nodes[k]); });
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
    });
    plan.onStreets = model.siteKind === 'streets' || model.siteKind === 'poles';
    plan.onPoles = model.siteKind === 'poles';
    plan.byRoad = plan.roads.size > 0 || !!model.poleGraph;
    plan.houses = { count: model.houses, position: (() => { const p = model.proj.toLatLng(model.polyXY.reduce((s, q) => [s[0] + q[0] / model.polyXY.length, s[1] + q[1] / model.polyXY.length], [0, 0])); return new google.maps.LatLng(p.lat, p.lng); })() };
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

function getAutoDesignPolePath(plan, from, to) {
    const graph = plan.model.poleGraph;
    if (!graph || from.pole == null || to.pole == null) return null;
    const tree = getAutoDesignPoleTree(graph, from.pole);
    if (!Number.isFinite(tree.dist[to.pole])) return null;
    const chain = [];
    for (let v = to.pole; v !== -1; v = tree.prev[v]) chain.unshift(v);
    const points = chain.slice(1, -1).map(i => { const p = plan.model.proj.toLatLng([plan.model.sites[i].x, plan.model.sites[i].y]); return new google.maps.LatLng(p.lat, p.lng); });
    return [from.position, ...points, to.position];
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
    if (route) return route;
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
    const alreadyRouted = [...plan.routes.values()].filter(r => !r.poles).length;
    if (alreadyRouted + viaStreets.length > AUTO_DESIGN_MAX_ROUTED) {
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
    let straight = 0, offPoles = 0;
    plan.cables.forEach(cable => {
        const route = getAutoDesignCachedRoute(plan, cable);
        cable.path = route?.path || [cable.from.position, cable.to.position];
        if (!route) straight++;
        if (plan.onPoles && !route?.poles && cable.role !== 'feeder') offPoles++;
    });
    plan.stats.straight = straight;
    plan.stats.offPoles = offPoles;
    plan.routed = true;
    placeAutoDesignReserves(plan);
    plan.cost = estimateAutoDesignCost(plan);
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
    if (plan.ctos.length) add("FITA DE AÇO INOX 3/4'' (FITA FUSIMEC) ROLO DE 25M", Math.ceil((3 * plan.ctos.length) / 25), 'boxes');
    newCeos.forEach(() => {
        add('CAIXA DE EMENDA ÓPTICA (CEO)', 1, 'boxes');
        getKitComponents('KIT CEO RAQUETE').forEach(c => add(c.name, c.quantity, 'boxes'));
    });
    const reserves = plan.reserves || [];
    reserves.forEach(() => getKitComponents('KIT CEO RAQUETE').forEach(c => add(c.name, c.quantity, 'boxes')));
    const raquetes = newCeos.length + reserves.length;
    if (raquetes) add('ARAME DE ESPIMAR (105 m)', Math.ceil((raquetes * 50) / 105), 'boxes');
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
    const service = (key) => Number((typeof DEFAULT_OUTSOURCED_SERVICES !== 'undefined' ? DEFAULT_OUTSOURCED_SERVICES : []).find(s => s.name === AUTO_DESIGN_LABOR_SERVICES[key])?.price) || 0;
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
    coverRadius: AUTO_DESIGN_COVER_M, fiberSpare: 20, maxFill: 100, reserveEvery: 0, ceoMax: 16, useHouses: true, usePoles: true,
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

function openAutoDesign(polygon) {
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
    autoDesign = {
        polygon, params, starts, phase: 'form', overlays: [], result: null, token: null,
        houseMarkers: houseMarkers.length >= AUTO_DESIGN_MIN_HOUSE_MARKERS ? houseMarkers : [],
        poleMarkers: poleMarkers.length >= AUTO_DESIGN_MIN_POLES ? poleMarkers : [],
        exclusions: [], cache: null, editMode: null, mapListener: null, compare: null, created: null,
    };
    if (autoDesign.houseMarkers.length && params.useHouses) params.houses = getAutoDesignMarkedHouses();
    document.getElementById('autoDesignBox').classList.remove('hidden');
    if (typeof focusMapToPolygon === 'function') focusMapToPolygon(polygon);
    renderAutoDesign();
    setTimeout(() => document.getElementById('autoDesignHouses')?.focus(), 50);
}

const getAutoDesignMarkedHouses = () => (autoDesign?.houseMarkers || []).reduce((s, m) => s + getAutoDesignHouseCount(m), 0);

function closeAutoDesign() {
    clearAutoDesignPreview();
    setAutoDesignEditMode(null);
    autoDesign?.mapListener?.remove?.();
    autoDesign = null;
    const box = document.getElementById('autoDesignBox');
    if (box) box.classList.add('hidden');
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
    const ctos = Math.ceil(clients / usable);
    const fill = usable < p.ports ? ` (até ${usable} clientes cada)` : '';
    const pon = p.levels === 2
        ? ` · CEO 1:${p.primary} → 1:${p.primary * p.ports} · <b>${Math.ceil(ctos / p.primary)}</b> PON(s)`
        : ` · <b>${ctos}</b> PON(s)`;
    el.innerHTML = `≈ <b>${clients.toLocaleString('pt-BR')}</b> clientes → <b>${ctos} CTOs</b> com splitter 1:${p.ports}${fill}${pon}`;
}

function renderAutoDesign() {
    const s = autoDesign;
    if (!s) return;
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
        <dl class="map-tool-stats"><div><dt>Área</dt><dd>${esc(s.polygon.name || 'Polígono')}</dd></div><div><dt>Tamanho</dt><dd>${esc(formatArea(area))}</dd></div></dl>
        <div class="map-tool-field-row">
            <div class="map-tool-field"><label for="autoDesignHouses">Casas na área</label><input type="number" id="autoDesignHouses" min="1" step="1" inputmode="numeric" value="${esc(p.houses)}" placeholder="Ex.: 320"${usingHouses ? ' disabled title="Usando as casas marcadas no mapa"' : ''}></div>
            <div class="map-tool-field"><label for="autoDesignOccupancy">Taxa de penetração (%)</label><input type="number" id="autoDesignOccupancy" min="1" max="100" step="1" inputmode="numeric" value="${esc(p.occupancy)}"></div>
        </div>
        ${s.houseMarkers.length ? `<label class="auto-design__check"><input type="checkbox" id="autoDesignUseHouses"${p.useHouses ? ' checked' : ''}><span>Usar as <b>${s.houseMarkers.length}</b> casas marcadas no mapa (${getAutoDesignMarkedHouses().toLocaleString('pt-BR')} casas, posição real)</span></label>` : ''}
        ${s.poleMarkers.length ? `<label class="auto-design__check"><input type="checkbox" id="autoDesignUsePoles"${p.usePoles ? ' checked' : ''}><span>Caixas nos <b>${s.poleMarkers.length}</b> postes da área e cabos de poste em poste</span></label>` : ''}
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
            <div class="map-tool-field"><label>Vão</label><div class="map-tool-segmented" id="autoDesignSpan" role="radiogroup" aria-label="Tipo de vão"></div></div>
        </div>
        <details class="auto-design__more" id="autoDesignMore"${s.moreOpen ? ' open' : ''}>
            <summary>Mais opções</summary>
            <div class="map-tool-field-row">
                <div class="map-tool-field"><label for="autoDesignSpare">Fibras de reserva (%)</label><input type="number" id="autoDesignSpare" min="0" max="200" step="5" inputmode="numeric" value="${esc(p.fiberSpare)}"></div>
                <div class="map-tool-field"><label for="autoDesignFill">Ocupação máx. da CTO (%)</label><input type="number" id="autoDesignFill" min="25" max="100" step="5" inputmode="numeric" value="${esc(p.maxFill)}"></div>
            </div>
            <div class="map-tool-field-row">
                <div class="map-tool-field"><label for="autoDesignReserve">Reserva técnica</label><select id="autoDesignReserve">${options(AUTO_DESIGN_RESERVE_STEPS, p.reserveEvery, v => (v ? `A cada ${v} m de cabo` : 'Não colocar'))}</select></div>
                <div class="map-tool-field"><label for="autoDesignCeoMax">CTOs por CEO</label><select id="autoDesignCeoMax">${options(AUTO_DESIGN_CEO_LIMITS, p.ceoMax, v => (v ? `Até ${v}` : 'Sem limite'))}</select></div>
            </div>
        </details>
        <p class="map-tool-help">As caixas vão só para as ruas da área (mato, pasto e rio ficam de fora) e os cabos seguem as ruas (OpenStreetMap). Nada é salvo até você aceitar a prévia.</p>
        ${s.error ? `<div class="auto-design__warn">${esc(s.error)}</div>` : ''}`;
    clampAutoDesignPrimary(p);
    renderSegmentedOptions('autoDesignLevels', [{ value: '1', label: '1 nível (só CTO)' }, { value: '2', label: '2 níveis (CEO + CTO)' }], String(p.levels));
    renderSegmentedOptions('autoDesignPorts', AUTO_DESIGN_SPLITTERS.map(n => ({ value: String(n), label: `1:${n}` })), String(p.ports));
    if (p.levels === 2) renderSegmentedOptions('autoDesignPrimary', clampAutoDesignPrimary(p).map(n => ({ value: String(n), label: `1:${n}` })), String(p.primary));
    renderSegmentedOptions('autoDesignSpan', [{ value: 'AS 80', label: 'AS 80' }, { value: 'AS 200', label: 'AS 200' }], p.span);
    const onSegment = (id, apply) => document.getElementById(id)?.addEventListener('segmented-change', (e) => apply(e.detail));
    onSegment('autoDesignLevels', (v) => { readAutoDesignForm(); p.levels = parseInt(v, 10); renderAutoDesign(); });
    onSegment('autoDesignPorts', (v) => { readAutoDesignForm(); p.ports = parseInt(v, 10); if (p.levels === 2) renderAutoDesign(); else renderAutoDesignCalc(); });
    onSegment('autoDesignPrimary', (v) => { p.primary = parseInt(v, 10); renderAutoDesignCalc(); });
    onSegment('autoDesignSpan', (v) => { p.span = v; });
    document.getElementById('autoDesignMore')?.addEventListener('toggle', (e) => { s.moreOpen = e.target.open; });
    actions.innerHTML = `
        <button type="button" class="map-tool-btn" data-auto-design="cancel">Cancelar</button>
        <button type="button" class="map-tool-btn map-tool-btn--primary" data-auto-design="generate">Gerar prévia</button>`;
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
    p.reserveEvery = number('autoDesignReserve', p.reserveEvery, 0, 100000);
    p.ceoMax = number('autoDesignCeoMax', p.ceoMax, 0, 1000);
    const useHouses = document.getElementById('autoDesignUseHouses');
    if (useHouses) p.useHouses = useHouses.checked;
    const usePoles = document.getElementById('autoDesignUsePoles');
    if (usePoles) p.usePoles = usePoles.checked;
    if (autoDesign.houseMarkers.length && p.useHouses) p.houses = getAutoDesignMarkedHouses();
}

//Entradas da geração: ruas (com cache por polígono), casas e postes marcados e os trechos sem casas
async function collectAutoDesignInputs(s, isCurrent) {
    const polygonPath = getAutoDesignPolygonPath(s.polygon);
    const signature = JSON.stringify(polygonPath);
    let streets = s.cache?.signature === signature ? s.cache.streets : undefined;
    if (streets === undefined) {
        streets = await sampleAutoDesignStreets(polygonPath, isCurrent);
        if (streets) s.cache = { signature, streets };
    }
    return { polygonPath, streets, houseMarkers: s.houseMarkers, poleMarkers: s.poleMarkers, exclusions: s.exclusions };
}

function getAutoDesignNames(projectId) {
    return {
        ceo: getNextAutoDesignNumber(projectId, 'CEO'),
        cto: getNextAutoDesignNumber(projectId, 'CTO'),
        reserve: getNextAutoDesignNumber(projectId, 'RESERVA'),
    };
}

async function generateAutoDesign() {
    const s = autoDesign;
    if (!s) return;
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
    step('Lendo as ruas da área…');
    const inputs = await collectAutoDesignInputs(s, isCurrent);
    if (!isCurrent()) return;
    if (inputs.streets && !inputs.streets.points.length && !(s.params.useHouses && s.houseMarkers.length) && !(s.params.usePoles && s.poleMarkers.length)) {
        s.phase = 'form';
        s.error = 'Não encontrei ruas dentro do polígono. Confira se a área cobre as casas.';
        renderAutoDesign();
        return;
    }
    step('Distribuindo as caixas pelas ruas…');
    const plan = await buildAutoDesignPlan(inputs.polygonPath, s.params, getAutoDesignStartMarker(), getAutoDesignNames(projectId), inputs, { isCurrent });
    if (!isCurrent() || plan.cancelled) return;
    if (plan.error) {
        s.phase = 'form';
        s.error = plan.error;
        renderAutoDesign();
        return;
    }
    if (!plan.onStreets) {
        await snapAutoDesignLooseBoxes(plan, isCurrent);
        if (!isCurrent()) return;
        rebuildAutoDesignNetwork(plan);
    }
    step(plan.onPoles ? 'Traçando os cabos de poste em poste…' : 'Traçando os cabos pelas ruas…');
    await routeAutoDesignCables(plan, isCurrent);
    if (!isCurrent()) return;
    s.result = plan;
    s.compare = null;
    s.phase = 'preview';
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
    return generateAutoDesign();
}

function clearAutoDesignExclusions() {
    if (!autoDesign?.exclusions.length) return null;
    autoDesign.exclusions = [];
    return generateAutoDesign();
}

const AUTO_DESIGN_EDIT_HINTS = {
    add: 'Clique no mapa onde vai a nova CTO.',
    remove: 'Clique na CTO que vai sair.',
    exclude: 'Clique em dois cantos do trecho sem casas.',
};

function setAutoDesignEditMode(mode) {
    const s = autoDesign;
    if (!s) return;
    s.editMode = s.editMode === mode ? null : mode;
    s.excludeFirst = null;
    s.excludeMarker?.setMap(null);
    s.excludeMarker = null;
    if (typeof setMapCursor === 'function') setMapCursor(s.editMode === 'add' || s.editMode === 'exclude' ? 'crosshair' : '');
}

function handleAutoDesignMapClick(latLng) {
    const s = autoDesign;
    if (!s || s.phase !== 'preview' || !latLng || s.busy) return;
    if (s.editMode === 'add') {
        setAutoDesignEditMode(null);
        addAutoDesignCto(latLng);
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
    plan.cables.forEach(cable => add(new google.maps.Polyline({
        path: cable.path, map, clickable: false, zIndex: 60, strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: getCableColor(cable.fiber), strokeWeight: 4, scale: 3 }, offset: '0', repeat: '13px' }],
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
    if (st.noStreets) warnings.push('Não consegui ler as ruas da área agora: as caixas foram espalhadas pela área toda. Confira as que caíram fora das casas (mato, pasto) e tente gerar de novo mais tarde.');
    if (st.tooMany) warnings.push(`Área grande: ${st.straight} cabo(s) ficaram em linha reta (traçar tudo pelas ruas sobrecarregaria o servidor). Ajuste no mapa ou divida a área.`);
    else if (st.straight > 0) warnings.push(`${st.straight} cabo(s) ficaram em linha reta: não achei uma rota pelas ruas. Confira no mapa.`);
    if (st.offPoles > 0) warnings.push(`${st.offPoles} cabo(s) não acharam caminho de poste em poste e seguiram a rua. Cadastre os postes que faltam ou ajuste no mapa.`);
    if (!plan.ceos[0].isNew) {
        const splitters = st.existingRootSplitters > 0 ? ` e ${st.existingRootSplitters} splitter(s) 1:${params.primary}` : '';
        warnings.push(`O plano de fusão da CEO existente ${plan.ceos[0].name} não é alterado: ligue nele as fibras dos cabos novos${splitters}.`);
    }
    return warnings;
}

function renderAutoDesignPreviewPanel() {
    const s = autoDesign;
    const plan = s.result;
    const st = plan.stats;
    const p = s.params;
    const cost = plan.cost;
    const esc = (v) => escapeHtml(String(v ?? ''));
    document.getElementById('autoDesignTitle').textContent = 'Prévia do pré-projeto';
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
        <dl class="map-tool-stats">
            <div><dt>CTOs</dt><dd>${plan.ctos.length} · ${esc(split)}</dd></div>
            <div><dt>${plan.root.isNew || st.ceos > 1 ? 'CEO' : 'Origem'}</dt><dd>${esc(ceoText)}</dd></div>
            <div><dt>Cobertura</dt><dd>${Math.round(st.coverage * 100)}% das casas</dd></div>
            <div><dt>Clientes / portas</dt><dd>${st.clients.toLocaleString('pt-BR')} / ${ports.toLocaleString('pt-BR')}</dd></div>
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
        <p class="map-tool-help">Tracejado = ainda não salvo. Ao aceitar, as caixas (CTOs com splitter 1:${p.ports}${p.levels === 2 ? `, CEO com splitter 1:${p.primary}` : ''}), ${plan.reserves?.length ? `${plan.reserves.length} reserva(s) técnica(s), ` : ''}os cabos e os planos de fusão entram como <b>Novo</b> numa pasta própria. Círculo verde = raio de ${plan.model.coverRadius} m de cada CTO.</p>`;
    document.getElementById('autoDesignActions').innerHTML = `
        <button type="button" class="map-tool-btn" data-auto-design="cancel">Descartar</button>
        <button type="button" class="map-tool-btn" data-auto-design="adjust">Ajustar</button>
        <button type="button" class="map-tool-btn" data-auto-design="compare">Comparar 1:8 × 1:16</button>
        <button type="button" class="map-tool-btn map-tool-btn--primary" data-auto-design="accept"${s.busy ? ' disabled' : ''}>Aceitar e criar</button>`;
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
        if (ports === s.params.ports) {
            rows.push({ ports, primary: s.params.primary, plan, cost: plan.cost, current: true });
            continue;
        }
        const params = { ...s.params, ports };
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
        <table class="auto-design__compare">
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
        </table>
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
    s.created = {
        folderId, folderName,
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
        <p class="map-tool-help">Tudo entrou como <b>Novo</b>, com os planos de fusão montados. Lembre de salvar o projeto. Se não ficou bom, desfaça e gere de novo.</p>`;
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
            renderAutoDesign();
        } else if (action === 'adjust' && s) {
            setAutoDesignEditMode(null);
            s.token = {};
            s.busy = false;
            clearAutoDesignPreview();
            s.phase = 'form';
            s.result = null;
            renderAutoDesign();
        }
        return;
    }
    if (e.target.closest('#closeAutoDesignButton')) closeAutoDesign();
    //Desenhar → Pré-projeto automático: desenha a área e, ao salvar o polígono, abre o painel
    if (e.target.closest('#autoDesignMenuButton')) {
        e.preventDefault();
        if (!requireEdit('gerar o pré-projeto')) return;
        if (!activeFolderId) {
            showAlert('Atenção', 'Selecione um projeto na barra lateral antes de gerar o pré-projeto.');
            return;
        }
        closeAutoDesign();
        startPolygonTool();
        if (!isDrawingPolygon) return;
        autoDesignAfterPolygon = true;
        const nameInput = document.getElementById('polygonName');
        if (nameInput) nameInput.value = 'Área do pré-projeto';
        showToast('Pré-projeto automático', 'Desenhe a área no mapa e salve o polígono. Depois é só dizer quantas casas tem.');
    }
});

document.addEventListener('input', (e) => {
    if (!autoDesign || autoDesign.phase !== 'form' || !e.target.closest('#autoDesignBox')) return;
    const p = autoDesign.params;
    if (e.target.id === 'autoDesignHouses') p.houses = e.target.value;
    if (e.target.id === 'autoDesignOccupancy') p.occupancy = Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 0));
    if (e.target.id === 'autoDesignFill') p.maxFill = Math.min(100, Math.max(25, parseInt(e.target.value, 10) || 100));
    renderAutoDesignCalc();
});

document.addEventListener('change', (e) => {
    if (!autoDesign || autoDesign.phase !== 'form' || !e.target.closest?.('#autoDesignBox')) return;
    if (['autoDesignStart', 'autoDesignUseHouses', 'autoDesignUsePoles'].includes(e.target.id)) {
        readAutoDesignForm();
        renderAutoDesign();
    }
});

document.addEventListener('keydown', (e) => {
    if (!autoDesign) return;
    if (e.key === 'Escape') {
        if (autoDesign.editMode) { setAutoDesignEditMode(null); renderAutoDesign(); } else closeAutoDesign();
    } else if (e.key === 'Enter' && autoDesign.phase === 'form' && e.target.closest?.('#autoDesignBox input')) generateAutoDesign();
});
