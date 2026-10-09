// Pré-projeto automático: a partir de um polígono e da quantidade de casas, busca as ruas da área no
// OpenStreetMap (Overpass), distribui as CTOs ao longo das ruas, liga tudo com cabos que seguem as ruas
// e mostra uma prévia tracejada. Nada é salvo até "Aceitar e criar": aí as caixas e os cabos entram como
// Novo numa pasta própria, com os nomes automáticos, e a lista de materiais é refeita.
// Depende de script.js, js/persistence.js, js/marker-panel.js, js/marker-icons.js, js/clients.js
// (fetchOsrmRoute) e js/cable-route-suggest.js (simplifyPathMeters).

//Servidores públicos do Overpass que aceitam pedido direto do navegador (os mesmos do overpass turbo).
//Todos são consultados juntos e vale a primeira resposta: algum sempre costuma estar de pé.
const AUTO_DESIGN_OVERPASS_SERVERS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
];
//Ruas onde há casas (sem rodovias, acessos de estacionamento e trilhas)
const AUTO_DESIGN_HIGHWAYS = 'residential|living_street|unclassified|road|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link';
const AUTO_DESIGN_STEP_M = 15;       //Um ponto a cada 15 m de rua
const AUTO_DESIGN_COVER_M = 150;     //Alcance de uma CTO (drop) em linha reta
const AUTO_DESIGN_EDGE_TOL_M = 20;   //Rua desenhada em cima do limite do polígono também entra
const AUTO_DESIGN_MIN_COVERAGE = 0.95;
const AUTO_DESIGN_BRANCH_SNAP_M = 80; //CTO até 80 m depois de uma esquina onde a rede se divide vai para a esquina
const AUTO_DESIGN_MAX_CTOS = 300;
const AUTO_DESIGN_FIBERS = [6, 12, 24, 36, 48, 72, 144];
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

// ---------------------------------------------------------------
// Ruas (Overpass) e grafo das ruas
// ---------------------------------------------------------------

//Devolve { ways } ou { failures: ['servidor: motivo'] }
async function fetchAutoDesignStreets(polygonPath) {
    const coords = polygonPath.map(p => `${p.lat.toFixed(6)} ${p.lng.toFixed(6)}`).join(' ');
    const query = `[out:json][timeout:25];way["highway"~"^(${AUTO_DESIGN_HIGHWAYS})$"](poly:"${coords}");out geom;`;
    const controllers = [];
    const failures = [];
    const ask = async (server) => {
        const host = new URL(server).hostname;
        const controller = new AbortController();
        controllers.push(controller);
        const timer = setTimeout(() => controller.abort(), 40000);
        try {
            const response = await fetch(server, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `data=${encodeURIComponent(query)}`,
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`resposta ${response.status}`);
            const data = await response.json();
            if (!Array.isArray(data?.elements)) throw new Error(data?.remark || 'resposta sem ruas');
            return data.elements.filter(e => e.type === 'way' && e.geometry?.length >= 2);
        } catch (e) {
            const reason = e.name === 'AbortError' ? 'demorou demais' : /fetch|network|cors/i.test(e.message) ? 'bloqueado ou fora do ar' : e.message;
            failures.push(`${host}: ${reason}`);
            throw e;
        } finally {
            clearTimeout(timer);
        }
    };
    try {
        const ways = await Promise.any(AUTO_DESIGN_OVERPASS_SERVERS.map(ask));
        controllers.forEach(c => c.abort()); //Os outros não precisam mais responder
        return { ways };
    } catch (e) {
        return { failures };
    }
}

//Nós a cada ~15 m; w = metros de rua em volta do nó (onde ficam as casas)
function buildAutoDesignGraph(ways, polyXY, proj) {
    const nodes = [];
    const adj = [];
    const index = new Map();
    const addNode = (key, x, y) => {
        if (key !== null && index.has(key)) return index.get(key);
        nodes.push({ x, y, w: 0 });
        adj.push([]);
        if (key !== null) index.set(key, nodes.length - 1);
        return nodes.length - 1;
    };
    let streetLength = 0;
    ways.forEach(way => {
        const pts = way.geometry.map(g => proj.toXY(g.lat, g.lon));
        const keyOf = (i) => (way.nodes?.[i] != null ? `n${way.nodes[i]}` : `w${way.id}:${i}`);
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            if (!pointInPolygonXY(mid, polyXY) && distToPolygonEdgeXY(mid, polyXY) > AUTO_DESIGN_EDGE_TOL_M) continue;
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (len < 0.05) continue;
            const pieces = Math.max(1, Math.ceil(len / AUTO_DESIGN_STEP_M));
            let prev = addNode(keyOf(i - 1), a[0], a[1]);
            for (let k = 1; k <= pieces; k++) {
                const t = k / pieces;
                const cur = k === pieces
                    ? addNode(keyOf(i), b[0], b[1])
                    : addNode(null, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
                const piece = len / pieces;
                adj[prev].push({ to: cur, len: piece });
                adj[cur].push({ to: prev, len: piece });
                nodes[prev].w += piece / 2;
                nodes[cur].w += piece / 2;
                prev = cur;
            }
            streetLength += len;
        }
    });
    return { nodes, adj, streetLength, links: 0 };
}

//Pedaços de rua soltos (o OSM nem sempre liga tudo) entram no maior por uma reta até o ponto mais perto
function connectAutoDesignComponents(graph) {
    const { nodes, adj } = graph;
    const comp = new Int32Array(nodes.length).fill(-1);
    const groups = [];
    for (let s = 0; s < nodes.length; s++) {
        if (comp[s] !== -1) continue;
        const list = [s];
        comp[s] = groups.length;
        for (let q = 0; q < list.length; q++) {
            adj[list[q]].forEach(e => {
                if (comp[e.to] === -1) { comp[e.to] = groups.length; list.push(e.to); }
            });
        }
        groups.push(list);
    }
    groups.sort((a, b) => b.length - a.length);
    const main = groups.length ? [...groups[0]] : [];
    groups.slice(1).forEach(group => {
        let best = null;
        group.forEach(i => main.forEach(j => {
            const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
            if (!best || d < best.d) best = { i, j, d };
        }));
        if (best) {
            adj[best.i].push({ to: best.j, len: best.d, virtual: true });
            adj[best.j].push({ to: best.i, len: best.d, virtual: true });
            graph.links++;
        }
        main.push(...group);
    });
    return graph;
}

function autoDesignShortestPaths(graph, source) {
    const n = graph.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    dist[source] = 0;
    //Heap binário de [distância, nó]
    const heap = [[0, source]];
    const push = (item) => {
        heap.push(item);
        let i = heap.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (heap[parent][0] <= heap[i][0]) break;
            [heap[parent], heap[i]] = [heap[i], heap[parent]];
            i = parent;
        }
    };
    const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                [heap[m], heap[i]] = [heap[i], heap[m]];
                i = m;
            }
        }
        return top;
    };
    while (heap.length) {
        const [d, u] = pop();
        if (d > dist[u]) continue;
        graph.adj[u].forEach(({ to, len }) => {
            if (d + len < dist[to]) {
                dist[to] = d + len;
                prev[to] = u;
                push([dist[to], to]);
            }
        });
    }
    return { dist, prev };
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

//Onde a rede se divide numa esquina sem caixa, os cabos iriam lado a lado até a caixa anterior.
//Puxa a CTO mais perto (no mesmo caminho, até 80 m) para a esquina: a divisão passa a ser na caixa.
function snapAutoDesignCtosToBranches(centers, rootNode, prev, dist) {
    centers = [...centers];
    for (let pass = 0; pass < centers.length * 2; pass++) {
        const boxes = new Set([rootNode, ...centers]);
        const childrenOf = new Map();
        centers.forEach(c => {
            let cur = c;
            while (cur !== rootNode && prev[cur] !== -1) {
                const parent = prev[cur];
                if (!childrenOf.has(parent)) childrenOf.set(parent, new Set());
                const set = childrenOf.get(parent);
                const seen = set.has(cur);
                set.add(cur);
                if (seen) break;
                cur = parent;
            }
        });
        const branches = [...childrenOf].filter(([node, set]) => set.size >= 2 && !boxes.has(node))
            .map(([node]) => node).sort((a, b) => dist[a] - dist[b]);
        let moved = false;
        for (const branch of branches) {
            let best = -1, bestD = Infinity;
            centers.forEach((c, ci) => {
                let cur = c;
                while (cur !== -1 && dist[cur] > dist[branch]) cur = prev[cur];
                if (cur === branch && dist[c] - dist[branch] < bestD) { bestD = dist[c] - dist[branch]; best = ci; }
            });
            if (best >= 0 && bestD <= AUTO_DESIGN_BRANCH_SNAP_M) {
                centers[best] = branch;
                moved = true;
                break;
            }
        }
        if (!moved) break;
    }
    return centers;
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

//Monta caixas e cabos a partir das ruas; startMarker = POP/CEO de onde a rede sai (ou null)
function buildAutoDesignPlan(ways, polygonPath, params, startMarker, names) {
    const proj = createAutoDesignProjection(polygonPath);
    const polyXY = polygonPath.map(p => proj.toXY(p.lat, p.lng));
    const graph = connectAutoDesignComponents(buildAutoDesignGraph(ways, polyXY, proj));
    if (!graph.nodes.length || graph.streetLength < 10) return { error: 'Não encontrei ruas dentro do polígono no OpenStreetMap.' };
    const startPos = startMarker?.marker?.getPosition?.();
    const startXY = startPos ? proj.toXY(startPos.lat(), startPos.lng()) : [0, 0];
    const rootNode = nearestAutoDesignNode(graph, startPos ? startXY : polyXY.reduce((s, p) => [s[0] + p[0] / polyXY.length, s[1] + p[1] / polyXY.length], [0, 0]));
    const rootIsNew = !startMarker || startMarker.type === 'POP';
    //CTO grudada na CEO não ajuda: as casas dali ficam com a CTO mais perto
    const rootXY = graph.nodes[rootNode];
    const candidates = graph.nodes.map((_, i) => i).filter(i => graph.nodes[i].w > 0
        && Math.hypot(graph.nodes[i].x - rootXY.x, graph.nodes[i].y - rootXY.y) > 25);
    if (!candidates.length) return { error: 'As ruas da área são curtas demais para distribuir caixas.' };
    const housesPerMeter = params.houses / graph.streetLength;
    const chosen = chooseAutoDesignCtos(graph, candidates, params, housesPerMeter);
    const { prev, dist } = autoDesignShortestPaths(graph, rootNode);
    const snapped = snapAutoDesignCtosToBranches(chosen.centers, rootNode, prev, dist);
    const placement = { ...chosen, ...evaluateAutoDesignCenters(graph, candidates, snapped) };

    //Árvore de caixas: cada CTO liga na caixa anterior no caminho até a raiz (CEO)
    const boxAtNode = new Map([[rootNode, 'root']]);
    placement.centers.forEach((node, ci) => boxAtNode.set(node, ci));
    const links = placement.centers.map((node, ci) => {
        const nodesPath = [node];
        let cur = prev[node];
        while (cur !== -1 && !boxAtNode.has(cur)) { nodesPath.push(cur); cur = prev[cur]; }
        nodesPath.push(cur === -1 ? rootNode : cur);
        return { ci, parent: cur === -1 ? 'root' : boxAtNode.get(cur), nodesPath: nodesPath.reverse() };
    });
    const children = new Map();
    links.forEach(link => {
        if (!children.has(link.parent)) children.set(link.parent, []);
        children.get(link.parent).push(link);
    });
    children.forEach(list => list.sort((a, b) => dist[placement.centers[a.ci]] - dist[placement.centers[b.ci]]));
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
    const simplify = (path) => (typeof simplifyPathMeters === 'function' ? simplifyPathMeters(path, 2.5) : path);
    const cables = order.map(link => {
        let path = link.nodesPath.map(toLatLng);
        const from = link.parent === 'root' ? root : ctoByIndex.get(link.parent);
        const to = ctoByIndex.get(link.ci);
        //Caixa que já existe fica fora da rua: o cabo sai dela até o ponto da rua mais perto
        if (from.existing) path.unshift(from.position);
        else path[0] = from.position;
        path[path.length - 1] = to.position;
        path = simplify(path);
        return {
            role: 'distribution',
            fiber: getAutoDesignFiberFor(downstream.get(link.ci), params.distributionFiber),
            from, to, path,
        };
    });
    const totalWeight = candidates.reduce((s, i) => s + graph.nodes[i].w, 0);
    return {
        root, ctos, cables,
        feeder: rootIsNew && startMarker ? { role: 'feeder', fiber: params.feederFiber, from: { existing: startMarker, name: startMarker.name, position: startPos }, to: root, path: [startPos, root.position] } : null,
        stats: {
            streetLength: graph.streetLength,
            byPorts: placement.byPorts,
            clients: placement.clients,
            coverage: placement.coverage,
            uncoveredHouses: Math.round((1 - placement.coverage) * params.houses),
            overloaded: placement.load.filter(w => loadToClients(w) > params.ports + 0.5).length,
            links: graph.links,
            housesPerMeter,
            totalWeight,
        },
    };
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
    el.innerHTML = `≈ <b>${clients.toLocaleString('pt-BR')}</b> clientes → <b>${Math.ceil(clients / ports)} CTOs</b> de ${ports} portas`;
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
        body.innerHTML = '<p class="auto-design__loading"><span class="route-suggest__spinner" aria-hidden="true"></span>Buscando as ruas da área e distribuindo as caixas…</p>';
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
            <div class="map-tool-field"><label for="autoDesignOccupancy">Ocupação (%)</label><input type="number" id="autoDesignOccupancy" min="1" max="100" step="1" inputmode="numeric" value="${esc(p.occupancy)}"></div>
        </div>
        <div class="map-tool-field"><label>Caixa de atendimento (CTO)</label><div class="map-tool-segmented" id="autoDesignPorts" role="radiogroup" aria-label="Portas da CTO"></div></div>
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
        <p class="map-tool-help">As caixas são colocadas ao longo das ruas do polígono (OpenStreetMap) e os cabos seguem o traçado das ruas. Nada é salvo até você aceitar a prévia.</p>
        ${s.error ? `<div class="auto-design__warn">${esc(s.error)}${s.errorDetails?.length ? `<small>${s.errorDetails.map(esc).join('<br>')}</small>` : ''}</div>` : ''}`;
    renderSegmentedOptions('autoDesignPorts', [{ value: '8', label: '8 portas' }, { value: '16', label: '16 portas' }], String(p.ports));
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
    s.errorDetails = null;
    autoDesignHousesByPolygon.set(s.polygon, houses);
    storeAutoDesignParams(s.params);
    const token = {};
    s.token = token;
    s.phase = 'loading';
    renderAutoDesign();
    const polygonPath = getAutoDesignPolygonPath(s.polygon);
    const { ways, failures } = await fetchAutoDesignStreets(polygonPath);
    if (autoDesign !== s || s.token !== token) return;
    if (!ways) {
        s.phase = 'form';
        s.error = 'Não consegui buscar as ruas no OpenStreetMap agora. Tente de novo em alguns segundos.';
        s.errorDetails = failures;
        renderAutoDesign();
        return;
    }
    const projectId = getAutoDesignProjectId(s.polygon);
    const start = getAutoDesignStartMarker();
    const plan = buildAutoDesignPlan(ways, polygonPath, s.params, start, {
        ceo: getNextAutoDesignNumber(projectId, 'CEO'),
        cto: getNextAutoDesignNumber(projectId, 'CTO'),
    });
    if (plan.error) {
        s.phase = 'form';
        s.error = plan.error;
        renderAutoDesign();
        return;
    }
    //Alimentação pelas ruas (OSRM, o mesmo dos drops); sem rota, fica em linha reta
    if (plan.feeder && typeof fetchOsrmRoute === 'function') {
        let route = null;
        try { route = await fetchOsrmRoute(plan.feeder.from.position, plan.root.position); } catch (e) { route = null; }
        if (autoDesign !== s || s.token !== token) return;
        if (route?.length) {
            const path = [plan.feeder.from.position, ...route, plan.root.position];
            plan.feeder.path = typeof simplifyPathMeters === 'function' ? simplifyPathMeters(path, 2.5) : path;
        }
    }
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
    if (st.links > 0) warnings.push(`${st.links} trecho(s) de rua soltos no mapa foram ligados em linha reta. Confira no mapa.`);
    document.getElementById('autoDesignBody').innerHTML = `
        <dl class="map-tool-stats">
            <div><dt>CTOs</dt><dd>${plan.ctos.length} · ${plan.ctos.length * s.params.ports} portas</dd></div>
            <div><dt>${plan.root.isNew ? 'CEO nova' : 'Sai de'}</dt><dd>${esc(plan.root.name)}</dd></div>
            <div><dt>Cobertura</dt><dd>${Math.round(st.coverage * 100)}% das casas</dd></div>
            <div><dt>Clientes previstos</dt><dd>${st.clients.toLocaleString('pt-BR')}</dd></div>
        </dl>
        ${extra > 0 ? `<p class="map-tool-help">${st.byPorts} CTOs pela quantidade de clientes + ${extra} para alcançar toda a área sem lotar as caixas.</p>` : ''}
        <ul class="auto-design__list">${rows}</ul>
        ${warnings.map(w => `<div class="auto-design__warn">${esc(w)}</div>`).join('')}
        <p class="map-tool-help">Tracejado = ainda não salvo. Ao aceitar, tudo entra como <b>Novo</b> numa pasta própria; depois arraste as caixas para os postes.</p>`;
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
        color: meta.color,
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
    return markers[markers.length - 1];
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
    plan.ctos.forEach(boxMarker);
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
