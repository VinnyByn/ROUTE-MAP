// Pré-projeto automático: a partir de um polígono, da quantidade de casas, da taxa de penetração e da
// splitagem da CTO, descobre onde há ruas (e casas) dentro da área, distribui as caixas por elas e liga
// cada CTO na caixa mais perto pela rua, com cabos traçados pelas ruas (OSRM, o mesmo da sugestão de
// rota). Mato, pasto e rio sem rua ficam sem caixa. Mostra uma prévia tracejada; nada é
// salvo até "Aceitar e criar": aí as caixas (CTOs já com o splitter), os cabos e as casas entram como
// Novo numa pasta própria, com os nomes automáticos, e a lista de materiais é refeita.
// Depende de script.js, js/persistence.js, js/marker-panel.js, js/marker-icons.js, js/fusion.js
// (buildFusionSplitterCard), js/clients.js (fetchOsrmRoute) e js/cable-route-suggest.js (simplifyPathMeters).

//Servidores OSRM públicos (gratuitos, sem chave); o primeiro usa o perfil a pé (segue as ruas sem contramão)
const AUTO_DESIGN_OSRM_SERVERS = [
    'https://routing.openstreetmap.de/routed-foot',
    'https://router.project-osrm.org',
];
const AUTO_DESIGN_SAMPLE_MAX = 400;  //Pontos da área consultados para achar as ruas
const AUTO_DESIGN_SAMPLE_CHUNK = 80; //Pontos por consulta (cabe na tabela do OSRM público)
const AUTO_DESIGN_STREET_MAX_M = 40; //Ponto a mais de 40 m de qualquer rua = sem casas (mato, pasto, rio)
const AUTO_DESIGN_EDGE_TOL_M = 25;   //Rua em cima do limite do polígono também entra
const AUTO_DESIGN_TABLE_MAX = 100;   //Caixas na tabela de distâncias pela rua (acima disso, linha reta)
const AUTO_DESIGN_GRID_M = 15;       //Casas espalhadas pela área: um ponto a cada 15 m
const AUTO_DESIGN_MAX_POINTS = 6000; //Áreas grandes usam pontos mais espaçados
const AUTO_DESIGN_COVER_M = 150;     //Alcance de uma CTO (drop) em linha reta
const AUTO_DESIGN_SNAP_MAX_M = 80;   //Só puxa a caixa para a rua se a rua estiver até 80 m
const AUTO_DESIGN_MIN_COVERAGE = 0.95;
const AUTO_DESIGN_MAX_CTOS = 300;
const AUTO_DESIGN_MAX_ROUTED = 120;  //Acima disso os cabos ficam em linha reta (não sobrecarrega o OSRM público)
const AUTO_DESIGN_FIBERS = [6, 12, 24, 36, 48, 72, 144];
const AUTO_DESIGN_SPLITTERS = [8, 16];
const AUTO_DESIGN_PARAMS_KEY = 'routeMapAutoDesignParams';

let autoDesign = null; //{ polygon, params, phase, result, overlays, token }
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

// ---------------------------------------------------------------
// OSRM: consultas com vários pontos de uma vez
// ---------------------------------------------------------------

//service = 'table' | 'nearest'; points = [{ lat, lng }]. Devolve a resposta (code Ok) ou null.
async function fetchAutoDesignOsrm(service, points, query) {
    const coords = points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    for (const server of AUTO_DESIGN_OSRM_SERVERS) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(`${server}/${service}/v1/foot/${coords}?${query}`, { signal: controller.signal });
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
        .filter(p => {
            const xy = proj.toXY(p.lat, p.lng);
            return pointInPolygonXY(xy, polyXY) || distToPolygonEdgeXY(xy, polyXY) <= AUTO_DESIGN_EDGE_TOL_M;
        });
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
// Pontos da área: em cima das ruas (ou, sem OSRM, espalhados por igual)
// ---------------------------------------------------------------

//Grade de pontos dentro do polígono; w = metros de grade em volta do ponto (peso das casas)
function buildAutoDesignGraph(polyXY, streetPoints = null, proj = null) {
    if (streetPoints?.length && proj) {
        const nodes = streetPoints.map(p => { const [x, y] = proj.toXY(p.lat, p.lng); return { x, y, w: p.w }; });
        return { nodes, streetLength: nodes.reduce((sum, n) => sum + n.w, 0), onStreets: true };
    }
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
    return { nodes, streetLength: nodes.length * step, step };
}

function nearestAutoDesignNode(graph, [x, y], candidates = null) {
    let best = -1, bestD = Infinity;
    const list = candidates || graph.nodes.map((_, i) => i);
    list.forEach(i => {
        const d = (graph.nodes[i].x - x) ** 2 + (graph.nodes[i].y - y) ** 2;
        if (d < bestD) { bestD = d; best = i; }
    });
    return best;
}

// ---------------------------------------------------------------
// CTOs: k-médias com o centro sempre num ponto da rua
// ---------------------------------------------------------------

function placeAutoDesignCtos(graph, candidates, k) {
    const { nodes } = graph;
    k = Math.max(1, Math.min(k, candidates.length));
    const d2 = (i, j) => (nodes[i].x - nodes[j].x) ** 2 + (nodes[i].y - nodes[j].y) ** 2;
    let sw = 0, sx = 0, sy = 0;
    candidates.forEach(i => { sw += nodes[i].w; sx += nodes[i].x * nodes[i].w; sy += nodes[i].y * nodes[i].w; });
    //Começo: o ponto do meio e depois sempre o mais longe dos já escolhidos
    let centers = [nearestAutoDesignNode(graph, [sx / sw, sy / sw], candidates)];
    const minD = candidates.map(i => d2(i, centers[0]));
    while (centers.length < k) {
        let far = 0;
        minD.forEach((d, j) => { if (d > minD[far]) far = j; });
        centers.push(candidates[far]);
        candidates.forEach((i, j) => { minD[j] = Math.min(minD[j], d2(i, candidates[far])); });
    }
    const assign = new Int32Array(candidates.length);
    const assignAll = () => candidates.forEach((i, j) => {
        let best = 0, bestD = Infinity;
        centers.forEach((c, ci) => { const d = d2(i, c); if (d < bestD) { bestD = d; best = ci; } });
        assign[j] = best;
    });
    for (let iter = 0; iter < 30; iter++) {
        assignAll();
        const acc = centers.map(() => ({ w: 0, x: 0, y: 0, members: [] }));
        candidates.forEach((i, j) => {
            const a = acc[assign[j]];
            a.w += nodes[i].w; a.x += nodes[i].x * nodes[i].w; a.y += nodes[i].y * nodes[i].w;
            a.members.push(i);
        });
        const next = acc.map((a, ci) => (a.w ? nearestAutoDesignNode(graph, [a.x / a.w, a.y / a.w], a.members) : centers[ci]));
        const changed = next.some((c, ci) => c !== centers[ci]);
        centers = next;
        if (!changed) break;
    }
    return evaluateAutoDesignCenters(graph, candidates, centers);
}

//Casas (metros de rua) de cada CTO pela caixa mais perto e quanto da área fica no alcance
function evaluateAutoDesignCenters(graph, candidates, centers) {
    const { nodes } = graph;
    const load = centers.map(() => 0);
    let covered = 0, total = 0;
    candidates.forEach(i => {
        let best = 0, bestD = Infinity;
        centers.forEach((c, ci) => {
            const d = (nodes[i].x - nodes[c].x) ** 2 + (nodes[i].y - nodes[c].y) ** 2;
            if (d < bestD) { bestD = d; best = ci; }
        });
        load[best] += nodes[i].w;
        total += nodes[i].w;
        if (Math.sqrt(bestD) <= AUTO_DESIGN_COVER_M) covered += nodes[i].w;
    });
    return { centers, load, coverage: total ? covered / total : 1 };
}

//Quantas CTOs: pelas portas e, se precisar, mais algumas até cobrir a área e nenhuma passar das portas
function chooseAutoDesignCtos(graph, candidates, params, housesPerMeter) {
    const clients = Math.ceil(params.houses * params.occupancy / 100);
    const byPorts = Math.max(1, Math.ceil(clients / params.ports));
    let k = byPorts;
    let placement = null;
    for (let tries = 0; tries < 40; tries++) {
        placement = placeAutoDesignCtos(graph, candidates, k);
        //A conta de clientes por caixa é estimativa: aceita poucas caixas um pouco acima das portas
        const clientsPerCto = placement.load.map(w => w * housesPerMeter * params.occupancy / 100);
        const over = clientsPerCto.filter(c => c > params.ports + 0.5).length;
        const fits = Math.max(...clientsPerCto) <= params.ports * 1.25 && over <= Math.floor(k * 0.15);
        const done = placement.coverage >= AUTO_DESIGN_MIN_COVERAGE && fits;
        if (done || k >= Math.min(candidates.length, AUTO_DESIGN_MAX_CTOS)) break;
        k = Math.min(candidates.length, AUTO_DESIGN_MAX_CTOS, k + Math.max(1, Math.ceil(k * 0.08)));
    }
    return { ...placement, byPorts, clients };
}

function getAutoDesignFiberFor(need, minimum) {
    const min = parseInt(String(minimum).replace(/\D/g, ''), 10) || 12;
    const fiber = AUTO_DESIGN_FIBERS.find(f => f >= Math.max(need, min)) || AUTO_DESIGN_FIBERS[AUTO_DESIGN_FIBERS.length - 1];
    return `FO-${String(fiber).padStart(2, '0')}`;
}

// ---------------------------------------------------------------
// Montagem do pré-projeto (sem tocar no mapa)
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

//Monta caixas e cabos pela área; startMarker = POP/CEO de onde a rede sai (ou null).
//Os cabos saem em linha reta: routeAutoDesignOnStreets puxa as caixas para a rua e traça pelas ruas.
async function buildAutoDesignPlan(polygonPath, params, startMarker, names, { streets = null, isCurrent = () => true } = {}) {
    const proj = createAutoDesignProjection(polygonPath);
    const polyXY = polygonPath.map(p => proj.toXY(p.lat, p.lng));
    const graph = buildAutoDesignGraph(polyXY, streets?.points, proj);
    if (graph.nodes.length < 4) return { error: 'A área é pequena demais para distribuir caixas. Desenhe um polígono maior.' };
    const startPos = startMarker?.marker?.getPosition?.();
    const startXY = startPos ? proj.toXY(startPos.lat(), startPos.lng()) : [0, 0];
    const rootNode = nearestAutoDesignNode(graph, startPos ? startXY : polyXY.reduce((s, p) => [s[0] + p[0] / polyXY.length, s[1] + p[1] / polyXY.length], [0, 0]));
    const rootIsNew = !startMarker || startMarker.type === 'POP';
    //CTO grudada na CEO não ajuda: as casas dali ficam com a CTO mais perto
    const rootXY = graph.nodes[rootNode];
    const candidates = graph.nodes.map((_, i) => i).filter(i => graph.nodes[i].w > 0
        && Math.hypot(graph.nodes[i].x - rootXY.x, graph.nodes[i].y - rootXY.y) > 25);
    if (!candidates.length) return { error: 'A área é pequena demais para distribuir caixas. Desenhe um polígono maior.' };
    const housesPerMeter = params.houses / graph.streetLength;
    const chosen = chooseAutoDesignCtos(graph, candidates, params, housesPerMeter);
    const placement = chosen;

    //Árvore de caixas (Prim): cada CTO liga na caixa mais perto que já está na rede, começando pela CEO.
    //"Mais perto" é pela rua (tabela de distâncias do OSRM): duas caixas de costas uma para a outra, em ruas
    //paralelas, não se ligam atravessando a quadra. Sem a tabela, vale a distância em linha reta.
    const xyOf = (node) => [graph.nodes[node].x, graph.nodes[node].y];
    const boxes = [{ key: 'root', xy: xyOf(rootNode) }, ...placement.centers.map((node, ci) => ({ key: ci, xy: xyOf(node) }))];
    let roads = null;
    if (graph.onStreets && boxes.length <= AUTO_DESIGN_TABLE_MAX) {
        roads = (await fetchAutoDesignOsrm('table', boxes.map(box => proj.toLatLng(box.xy)), 'annotations=distance'))?.distances || null;
        if (!isCurrent()) return { cancelled: true };
    }
    const edge = (i, j) => {
        const straight = Math.hypot(boxes[i].xy[0] - boxes[j].xy[0], boxes[i].xy[1] - boxes[j].xy[1]);
        if (!roads) return straight;
        const road = Math.min(roads[i]?.[j] ?? Infinity, roads[j]?.[i] ?? Infinity);
        return Number.isFinite(road) ? Math.max(road, straight) : straight * 4 + 500;
    };
    const best = boxes.map((_, i) => ({ d: edge(0, i), parent: 0 }));
    const inTree = boxes.map((_, i) => i === 0);
    const treeDist = boxes.map(() => 0);
    const links = [];
    for (let added = 1; added < boxes.length; added++) {
        let pick = -1;
        boxes.forEach((_, i) => { if (!inTree[i] && (pick < 0 || best[i].d < best[pick].d)) pick = i; });
        inTree[pick] = true;
        treeDist[pick] = treeDist[best[pick].parent] + best[pick].d;
        links.push({ ci: boxes[pick].key, parent: boxes[best[pick].parent].key, dist: treeDist[pick] });
        boxes.forEach((box, i) => {
            if (inTree[i]) return;
            const d = edge(pick, i);
            if (d < best[i].d) best[i] = { d, parent: pick };
        });
    }
    const children = new Map();
    links.forEach(link => {
        if (!children.has(link.parent)) children.set(link.parent, []);
        children.get(link.parent).push(link);
    });
    children.forEach(list => list.sort((a, b) => a.dist - b.dist));
    //Número de CTOs depois de cada uma (fibras do cabo que chega nela) e nomes na ordem do caminho
    const downstream = new Map();
    const countDown = (key) => {
        const total = (children.get(key) || []).reduce((s, l) => s + countDown(l.ci), 0) + (key === 'root' ? 0 : 1);
        downstream.set(key, total);
        return total;
    };
    countDown('root');
    const order = [];
    const walk = (key) => (children.get(key) || []).forEach(l => { order.push(l); walk(l.ci); });
    walk('root');

    const toLatLng = (node) => { const p = proj.toLatLng([graph.nodes[node].x, graph.nodes[node].y]); return new google.maps.LatLng(p.lat, p.lng); };
    const loadToClients = (w) => w * housesPerMeter * params.occupancy / 100;
    const root = rootIsNew
        ? { type: 'CEO', name: formatAutoDesignName('CEO', names.ceo), position: toLatLng(rootNode), isNew: true }
        : { type: startMarker.type, name: startMarker.name, position: startPos, isNew: false, existing: startMarker };
    const ctos = [];
    const ctoByIndex = new Map();
    order.forEach((link, k) => {
        const cto = {
            type: 'CTO',
            name: formatAutoDesignName('CTO', names.cto + k),
            position: toLatLng(placement.centers[link.ci]),
            clients: loadToClients(placement.load[link.ci]),
            isNew: true,
        };
        ctos.push(cto);
        ctoByIndex.set(link.ci, cto);
    });
    const cables = order.map(link => {
        const from = link.parent === 'root' ? root : ctoByIndex.get(link.parent);
        const to = ctoByIndex.get(link.ci);
        return {
            role: 'distribution',
            fiber: getAutoDesignFiberFor(downstream.get(link.ci), params.distributionFiber),
            from, to,
            path: [from.position, to.position],
        };
    });
    const totalWeight = candidates.reduce((s, i) => s + graph.nodes[i].w, 0);
    const center = proj.toLatLng(polyXY.reduce((acc, p) => [acc[0] + p[0] / polyXY.length, acc[1] + p[1] / polyXY.length], [0, 0]));
    return {
        root, ctos, cables,
        onStreets: !!graph.onStreets,
        byRoad: !!roads,
        houses: { count: params.houses, position: new google.maps.LatLng(center.lat, center.lng) },
        feeder: rootIsNew && startMarker ? { role: 'feeder', fiber: params.feederFiber, from: { existing: startMarker, name: startMarker.name, position: startPos }, to: root, path: [startPos, root.position] } : null,
        stats: {
            streetLength: graph.streetLength,
            byPorts: placement.byPorts,
            clients: placement.clients,
            coverage: placement.coverage,
            uncoveredHouses: Math.round((1 - placement.coverage) * params.houses),
            overloaded: placement.load.filter(w => loadToClients(w) > params.ports + 0.5).length,
            snapped: 0,
            straight: 0,
            noStreets: !streets,
            housesPerMeter,
            totalWeight,
        },
    };
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

//Puxa as caixas novas para a rua mais perto e traça os cabos pelas ruas.
//O que não achar rota fica em linha reta e entra no aviso da prévia.
async function routeAutoDesignOnStreets(plan, isCurrent) {
    const spherical = google.maps.geometry.spherical;
    const cables = getAutoDesignAllCables(plan);
    if (cables.length > AUTO_DESIGN_MAX_ROUTED) {
        plan.stats.straight = cables.length;
        plan.stats.tooMany = true;
        return;
    }
    let snapped = 0;
    //Caixas tiradas dos pontos de rua já estão na rua; só as espalhadas pela área (sem OSRM antes) são puxadas
    const loose = plan.onStreets ? [] : [plan.root, ...plan.ctos].filter(box => box.isNew);
    await runAutoDesignLimited(loose, 4, async (box) => {
        const street = await fetchAutoDesignNearestStreet(box.position);
        if (!isCurrent() || !street) return;
        if (spherical.computeDistanceBetween(street, box.position) <= AUTO_DESIGN_SNAP_MAX_M) {
            box.position = street;
            snapped++;
        }
    });
    if (!isCurrent()) return;
    const simplify = (path) => (typeof simplifyPathMeters === 'function' ? simplifyPathMeters(path, 2.5) : path);
    let straight = 0;
    await runAutoDesignLimited(cables, 3, async (cable) => {
        const from = cable.from.position, to = cable.to.position;
        let route = null;
        try { route = typeof fetchOsrmRoute === 'function' ? await fetchOsrmRoute(from, to) : null; } catch (e) { route = null; }
        if (!isCurrent()) return;
        const path = route?.length ? simplify([from, ...route, to]) : null;
        //Rota que dá uma volta enorme (rua sem saída, rio no meio) fica em linha reta para ajustar à mão
        const direct = spherical.computeDistanceBetween(from, to);
        if (path && spherical.computeLength(path) <= direct * 3 + 200) {
            cable.path = path;
        } else {
            cable.path = [from, to];
            straight++;
        }
    });
    plan.stats.snapped = snapped;
    plan.stats.straight = straight;
}

// ---------------------------------------------------------------
// Painel e prévia no mapa
// ---------------------------------------------------------------

function loadAutoDesignParams() {
    const defaults = { occupancy: 30, ports: 8, feederFiber: 'FO-48', distributionFiber: 'FO-12', span: 'AS 80' };
    try { return { ...defaults, ...(JSON.parse(localStorage.getItem(AUTO_DESIGN_PARAMS_KEY) || 'null') || {}) }; } catch (e) { return defaults; }
}

function storeAutoDesignParams(params) {
    const { occupancy, ports, feederFiber, distributionFiber, span } = params;
    try { localStorage.setItem(AUTO_DESIGN_PARAMS_KEY, JSON.stringify({ occupancy, ports, feederFiber, distributionFiber, span })); } catch (e) { /* sem armazenamento */ }
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
    autoDesign = { polygon, params, starts, phase: 'form', overlays: [], result: null, token: null };
    document.getElementById('autoDesignBox').classList.remove('hidden');
    if (typeof focusMapToPolygon === 'function') focusMapToPolygon(polygon);
    renderAutoDesign();
    setTimeout(() => document.getElementById('autoDesignHouses')?.focus(), 50);
}

function closeAutoDesign() {
    clearAutoDesignPreview();
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
    const { houses, occupancy, ports } = autoDesign.params;
    const n = parseInt(houses, 10);
    if (!n || n < 1) {
        el.innerHTML = 'Digite a quantidade de casas para calcular as caixas.';
        return;
    }
    const clients = Math.ceil(n * occupancy / 100);
    el.innerHTML = `≈ <b>${clients.toLocaleString('pt-BR')}</b> clientes → <b>${Math.ceil(clients / ports)} CTOs</b> com splitter 1:${ports}`;
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
    if (s.phase === 'preview') {
        renderAutoDesignPreviewPanel();
        return;
    }
    const p = s.params;
    const area = google.maps.geometry.spherical.computeArea(s.polygon.polygonObject.getPath());
    const fiberOptions = (selected) => AUTO_DESIGN_FIBERS.map(f => {
        const v = `FO-${String(f).padStart(2, '0')}`;
        return `<option value="${v}"${v === selected ? ' selected' : ''}>${v}</option>`;
    }).join('');
    const start = getAutoDesignStartMarker();
    title.textContent = 'Gerar pré-projeto';
    body.innerHTML = `
        <dl class="map-tool-stats"><div><dt>Área</dt><dd>${esc(s.polygon.name || 'Polígono')}</dd></div><div><dt>Tamanho</dt><dd>${esc(formatArea(area))}</dd></div></dl>
        <div class="map-tool-field-row">
            <div class="map-tool-field"><label for="autoDesignHouses">Casas na área</label><input type="number" id="autoDesignHouses" min="1" step="1" inputmode="numeric" value="${esc(p.houses)}" placeholder="Ex.: 320"></div>
            <div class="map-tool-field"><label for="autoDesignOccupancy">Taxa de penetração (%)</label><input type="number" id="autoDesignOccupancy" min="1" max="100" step="1" inputmode="numeric" value="${esc(p.occupancy)}"></div>
        </div>
        <div class="map-tool-field"><label>Splitagem da CTO</label><div class="map-tool-segmented" id="autoDesignPorts" role="radiogroup" aria-label="Splitter de atendimento da CTO"></div></div>
        <div class="auto-design__calc" id="autoDesignCalc" aria-live="polite"></div>
        <div class="map-tool-field"><label for="autoDesignStart">Partir de</label>
            <select id="autoDesignStart">
                ${s.starts.map(({ marker, distance }) => `<option value="${esc(marker.uid)}"${marker.uid === p.startUid ? ' selected' : ''}>${esc(marker.name)} · ${esc(marker.type)} · ${esc(formatDistance(distance))}</option>`).join('')}
                <option value=""${!p.startUid ? ' selected' : ''}>Nenhum — CEO nova no meio da área</option>
            </select>
        </div>
        <div class="map-tool-field-row">
            <div class="map-tool-field"><label for="autoDesignFeeder">Cabo alimentação</label><select id="autoDesignFeeder"${start?.type === 'POP' ? '' : ' disabled title="Só quando parte de um POP"'}>${fiberOptions(p.feederFiber)}</select></div>
            <div class="map-tool-field"><label for="autoDesignDistribution">Cabo distribuição</label><select id="autoDesignDistribution">${fiberOptions(p.distributionFiber)}</select></div>
        </div>
        <div class="map-tool-field"><label>Vão</label><div class="map-tool-segmented" id="autoDesignSpan" role="radiogroup" aria-label="Tipo de vão"></div></div>
        <p class="map-tool-help">As caixas vão só para as ruas da área (mato, pasto e rio ficam de fora) e os cabos seguem as ruas (OpenStreetMap). Nada é salvo até você aceitar a prévia.</p>
        ${s.error ? `<div class="auto-design__warn">${esc(s.error)}</div>` : ''}`;
    renderSegmentedOptions('autoDesignPorts', AUTO_DESIGN_SPLITTERS.map(n => ({ value: String(n), label: `1:${n}` })), String(p.ports));
    renderSegmentedOptions('autoDesignSpan', [{ value: 'AS 80', label: 'AS 80' }, { value: 'AS 200', label: 'AS 200' }], p.span);
    document.getElementById('autoDesignPorts').addEventListener('segmented-change', (e) => { p.ports = parseInt(e.detail, 10); renderAutoDesignCalc(); });
    document.getElementById('autoDesignSpan').addEventListener('segmented-change', (e) => { p.span = e.detail; });
    actions.innerHTML = `
        <button type="button" class="map-tool-btn" data-auto-design="cancel">Cancelar</button>
        <button type="button" class="map-tool-btn map-tool-btn--primary" data-auto-design="generate">Gerar prévia</button>`;
    renderAutoDesignCalc();
}

function readAutoDesignForm() {
    const p = autoDesign.params;
    const value = (id) => document.getElementById(id)?.value;
    p.houses = value('autoDesignHouses') ?? p.houses;
    p.occupancy = Math.min(100, Math.max(1, parseInt(value('autoDesignOccupancy'), 10) || 30));
    p.startUid = value('autoDesignStart') ?? p.startUid;
    p.feederFiber = value('autoDesignFeeder') || p.feederFiber;
    p.distributionFiber = value('autoDesignDistribution') || p.distributionFiber;
}

async function generateAutoDesign() {
    const s = autoDesign;
    if (!s) return;
    readAutoDesignForm();
    const houses = parseInt(s.params.houses, 10);
    if (!houses || houses < 1) {
        s.error = 'Digite quantas casas tem na área.';
        renderAutoDesign();
        document.getElementById('autoDesignHouses')?.focus();
        return;
    }
    s.params.houses = houses;
    s.error = null;
    autoDesignHousesByPolygon.set(s.polygon, houses);
    storeAutoDesignParams(s.params);
    const token = {};
    s.token = token;
    s.phase = 'loading';
    renderAutoDesign();
    const isCurrent = () => autoDesign === s && s.token === token;
    const step = (text) => { s.loadingText = text; renderAutoDesign(); };
    const polygonPath = getAutoDesignPolygonPath(s.polygon);
    const projectId = getAutoDesignProjectId(s.polygon);
    step('Lendo as ruas da área…');
    const streets = await sampleAutoDesignStreets(polygonPath, isCurrent);
    if (!isCurrent()) return;
    if (streets && !streets.points.length) {
        s.phase = 'form';
        s.error = 'Não encontrei ruas dentro do polígono. Confira se a área cobre as casas.';
        renderAutoDesign();
        return;
    }
    step('Distribuindo as caixas pelas ruas…');
    const plan = await buildAutoDesignPlan(polygonPath, s.params, getAutoDesignStartMarker(), {
        ceo: getNextAutoDesignNumber(projectId, 'CEO'),
        cto: getNextAutoDesignNumber(projectId, 'CTO'),
    }, { streets, isCurrent });
    if (!isCurrent() || plan.cancelled) return;
    if (plan.error) {
        s.phase = 'form';
        s.error = plan.error;
        renderAutoDesign();
        return;
    }
    step('Traçando os cabos pelas ruas…');
    await routeAutoDesignOnStreets(plan, isCurrent);
    if (!isCurrent()) return;
    s.result = plan;
    s.phase = 'preview';
    drawAutoDesignPreview();
    renderAutoDesign();
}

function getAutoDesignAllCables(plan) {
    return plan.feeder ? [plan.feeder, ...plan.cables] : plan.cables;
}

function drawAutoDesignPreview() {
    clearAutoDesignPreview();
    const s = autoDesign;
    const plan = s?.result;
    if (!plan) return;
    const add = (overlay) => { s.overlays.push(overlay); return overlay; };
    plan.ctos.forEach(cto => add(new google.maps.Circle({
        map, center: cto.position, radius: AUTO_DESIGN_COVER_M, clickable: false, zIndex: 40,
        strokeColor: '#16a34a', strokeOpacity: 0.35, strokeWeight: 1, fillColor: '#16a34a', fillOpacity: 0.06,
    })));
    getAutoDesignAllCables(plan).forEach(cable => add(new google.maps.Polyline({
        path: cable.path, map, clickable: false, zIndex: 60, strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: getCableColor(cable.fiber), strokeWeight: 4, scale: 3 }, offset: '0', repeat: '13px' }],
    })));
    [plan.root, ...plan.ctos].filter(box => box.isNew).forEach(box => {
        const color = getMarkerTypeMeta(box.type).color;
        add(new google.maps.Marker({
            map, position: box.position, title: `${box.name} (prévia)`, clickable: false, zIndex: 70, opacity: 0.85,
            icon: { url: getMarkerIconDataUrl(box.type, color), scaledSize: new google.maps.Size(26, 26), anchor: new google.maps.Point(13, 13) },
        }));
    });
}

function summarizeAutoDesignCables(plan) {
    const rows = new Map();
    getAutoDesignAllCables(plan).forEach(cable => {
        const key = `${cable.role}|${cable.fiber}`;
        const row = rows.get(key) || { role: cable.role, fiber: cable.fiber, length: 0, count: 0 };
        row.length += google.maps.geometry.spherical.computeLength(cable.path);
        row.count++;
        rows.set(key, row);
    });
    return [...rows.values()].sort((a, b) => (a.role === b.role ? b.fiber.localeCompare(a.fiber) : a.role === 'feeder' ? -1 : 1));
}

function renderAutoDesignPreviewPanel() {
    const s = autoDesign;
    const plan = s.result;
    const st = plan.stats;
    const esc = (v) => escapeHtml(String(v ?? ''));
    document.getElementById('autoDesignTitle').textContent = 'Prévia do pré-projeto';
    const extra = plan.ctos.length - st.byPorts;
    const rows = summarizeAutoDesignCables(plan).map(r => `
        <li><span><i style="background:${esc(getCableColor(r.fiber))}"></i>${r.role === 'feeder' ? 'Alimentação' : 'Distribuição'} ${esc(r.fiber)}${r.count > 1 ? ` <small>· ${r.count} cabos</small>` : ''}</span><b>${esc(formatAutoDesignMeters(r.length))}</b></li>`).join('');
    const warnings = [];
    if (st.uncoveredHouses > 0) warnings.push(`≈ ${st.uncoveredHouses} casa(s) ficaram a mais de ${AUTO_DESIGN_COVER_M} m de uma CTO.`);
    if (st.overloaded > 0) warnings.push(`${st.overloaded} CTO(s) podem precisar de mais de ${s.params.ports} portas.`);
    if (st.noStreets) warnings.push('Não consegui ler as ruas da área agora: as caixas foram espalhadas pela área toda. Confira as que caíram fora das casas (mato, pasto) e tente gerar de novo mais tarde.');
    if (st.tooMany) warnings.push(`Área grande: os ${st.straight} cabos ficaram em linha reta (traçar tudo pelas ruas sobrecarregaria o servidor). Ajuste no mapa ou divida a área.`);
    else if (st.straight > 0) warnings.push(`${st.straight} cabo(s) ficaram em linha reta: não achei uma rota pelas ruas. Confira no mapa.`);
    document.getElementById('autoDesignBody').innerHTML = `
        <dl class="map-tool-stats">
            <div><dt>CTOs</dt><dd>${plan.ctos.length} · splitter 1:${s.params.ports}</dd></div>
            <div><dt>${plan.root.isNew ? 'CEO nova' : 'Sai de'}</dt><dd>${esc(plan.root.name)}</dd></div>
            <div><dt>Cobertura</dt><dd>${Math.round(st.coverage * 100)}% das casas</dd></div>
            <div><dt>Clientes / portas</dt><dd>${st.clients.toLocaleString('pt-BR')} / ${(plan.ctos.length * s.params.ports).toLocaleString('pt-BR')}</dd></div>
        </dl>
        ${extra > 0 ? `<p class="map-tool-help">${st.byPorts} CTOs pela quantidade de clientes + ${extra} para alcançar toda a área sem lotar as caixas.</p>` : ''}
        <ul class="auto-design__list">${rows}</ul>
        ${warnings.map(w => `<div class="auto-design__warn">${esc(w)}</div>`).join('')}
        <p class="map-tool-help">Tracejado = ainda não salvo. Ao aceitar, as caixas (CTOs já com o splitter 1:${s.params.ports}), os cabos e as ${esc(Number(s.params.houses).toLocaleString('pt-BR'))} casas entram como <b>Novo</b> numa pasta própria; depois arraste as caixas para os postes.</p>`;
    document.getElementById('autoDesignActions').innerHTML = `
        <button type="button" class="map-tool-btn" data-auto-design="cancel">Descartar</button>
        <button type="button" class="map-tool-btn" data-auto-design="adjust">Ajustar</button>
        <button type="button" class="map-tool-btn map-tool-btn--primary" data-auto-design="accept">Aceitar e criar</button>`;
}

// ---------------------------------------------------------------
// Aceitar: cria a pasta, as caixas e os cabos de verdade
// ---------------------------------------------------------------

function createAutoDesignMarker(box, folderId) {
    const meta = getMarkerTypeMeta(box.type);
    const data = {
        type: box.type,
        name: box.name,
        color: box.type === 'CASA' ? '#ffffff' : meta.color,
        labelColor: '#000000',
        size: DEFAULT_MARKER_SIZE,
        description: 'Gerado pelo pré-projeto automático',
        ctoStatus: 'Nova', isPredial: false, needsStickers: false,
        ceoStatus: 'Nova', ceoAccessory: 'Raquete', is144F: false,
    };
    const previous = activeFolderId;
    activeFolderId = folderId;
    try {
        addCustomMarker(box.position, data);
    } finally {
        activeFolderId = previous;
    }
    const created = markers[markers.length - 1];
    if (box.type === 'CTO' && box.splitter) created.fusionPlan = buildAutoDesignSplitterPlan(box.splitter);
    return created;
}

//Plano de fusão da CTO só com o splitter de atendimento (Novo): o relatório e a lista de materiais contam as portas
function buildAutoDesignSplitterPlan(ratio) {
    if (typeof buildFusionSplitterCard !== 'function') return '';
    const label = `1:${ratio} APC`;
    const card = buildFusionSplitterCard({
        id: `splitter-1${ratio}APC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label, outputs: ratio, status: 'Novo', type: 'Atendimento', connector: 'APC',
    });
    return JSON.stringify({ version: 2, elements: card.outerHTML, svg: '' });
}

function createAutoDesignCable(cable, folderId, span, startMarker, endMarker) {
    const color = getCableColor(cable.fiber);
    const width = DEFAULT_CABLE_WIDTH_NEW;
    const path = cable.path.map(p => new google.maps.LatLng(p.lat(), p.lng()));
    const polyline = new google.maps.Polyline({ path, map, strokeColor: color, strokeWeight: width, clickable: true });
    const info = {
        folderId,
        name: `${cable.fiber}-${endMarker.name}`,
        type: `Cabo ${span} ${cable.fiber}`,
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
    if (!plan || !requireEdit('criar o pré-projeto')) return;
    const parentUl = document.getElementById(s.polygon.folderId);
    if (!parentUl) {
        showAlert('Atenção', 'Não encontrei a pasta do polígono. Abra o projeto e tente de novo.');
        return;
    }
    const folderId = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    rebuildSidebarFromJSON([{ id: folderId, name: getAutoDesignFolderName(parentUl, s.polygon.name), isProject: false, children: [] }], parentUl);
    const created = new Map();
    const boxMarker = (box) => {
        if (box.existing) return box.existing;
        if (!created.has(box)) created.set(box, createAutoDesignMarker(box, folderId));
        return created.get(box);
    };
    if (plan.root.isNew) boxMarker(plan.root);
    plan.ctos.forEach(cto => { cto.splitter = s.params.ports; boxMarker(cto); });
    //Casas da área num marcador só (Casas/HP do relatório)
    createAutoDesignMarker({ type: 'CASA', name: String(plan.houses.count), position: plan.houses.position }, folderId);
    const cables = getAutoDesignAllCables(plan).map(cable => createAutoDesignCable(cable, folderId, s.params.span, boxMarker(cable.from), boxMarker(cable.to)));
    syncProjectCableMeasurements(cables);
    setActiveFolder(folderId);
    document.getElementById(folderId)?.classList.remove('hidden');
    refreshBomAfterProjectChange();
    const ceoCount = plan.root.isNew ? 1 : 0;
    closeAutoDesign();
    showToast('Pré-projeto criado', `${ceoCount ? '1 CEO, ' : ''}${plan.ctos.length} CTOs e ${cables.length} cabos como Novo. Lista de materiais atualizada; lembre de salvar o projeto.`);
}

// ---------------------------------------------------------------
// Ligações
// ---------------------------------------------------------------

document.addEventListener('click', (e) => {
    const button = e.target.closest('#autoDesignBox [data-auto-design]');
    if (button) {
        const action = button.dataset.autoDesign;
        if (action === 'cancel') closeAutoDesign();
        else if (action === 'generate') generateAutoDesign();
        else if (action === 'accept') acceptAutoDesign();
        else if (action === 'adjust' && autoDesign) {
            clearAutoDesignPreview();
            autoDesign.phase = 'form';
            autoDesign.result = null;
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
    if (!autoDesign || !e.target.closest('#autoDesignBox')) return;
    if (e.target.id === 'autoDesignHouses') autoDesign.params.houses = e.target.value;
    if (e.target.id === 'autoDesignOccupancy') autoDesign.params.occupancy = Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 0));
    renderAutoDesignCalc();
});

document.addEventListener('change', (e) => {
    if (!autoDesign || e.target.id !== 'autoDesignStart') return;
    readAutoDesignForm();
    renderAutoDesign();
});

document.addEventListener('keydown', (e) => {
    if (!autoDesign) return;
    if (e.key === 'Escape') closeAutoDesign();
    else if (e.key === 'Enter' && autoDesign.phase === 'form' && e.target.closest?.('#autoDesignBox input')) generateAutoDesign();
});
