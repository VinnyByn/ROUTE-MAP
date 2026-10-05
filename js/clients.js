// Marcador Cliente: residencial, empresarial (B2B) ou predial (prédio/condomínio, sem drop), status, vínculo CTO + porta, drop pela rua,
// serviço/IP (B2B) e equipamentos. Clientes vivem no array global `markers` (type 'CLIENTE'), então
// salvar, pastas, visibilidade e KML funcionam como nos demais marcadores. Depende de script.js.

const CLIENT_STATUSES = [
    { id: 'viabilidade', label: 'Viabilidade', color: '#d97706', billable: true },
    { id: 'a_instalar', label: 'A instalar', color: '#2563eb', billable: true },
    { id: 'instalado', label: 'Instalado', color: '#16a34a', billable: false },
    { id: 'cancelado', label: 'Cancelado', color: '#94a3b8', billable: false }
];
const DEFAULT_CLIENT_STATUS = 'a_instalar';
const DEFAULT_CTO_PORTS = 16; //Usado quando a CTO não tem splitter de atendimento no plano de fusão
const CLIENT_DROP_MATERIAL = 'CABO DROP FLAT LOW FRICTION 1F';
const CLIENT_KIT_NAME = 'KIT ATENDIMENTO CLIENTE';
const CLIENT_EQUIPMENT_TYPES = ['ONU/ONT', 'EDD', 'SFP', 'Switch', 'Roteador', 'Conversor de mídia', 'Rádio', 'Outro'];
const B2B_SERVICES = ['Link dedicado', 'Banda larga empresarial', 'Lan-to-Lan (L2L)', 'Trânsito IP', 'Fibra apagada (ponto a ponto)', 'Outro'];
const DROP_NETWORK_MAX_OFFSET_M = 120; //Distância máxima do cliente até a rede para seguir o traçado dos cabos
const DROP_CTO_ATTACH_M = 30;          //CTO que não é ponta de cabo: liga no cabo mais próximo até esta distância
const DROP_ROUTE_LABELS = {
    rede: 'pela rede (postes)',
    rua: 'pelas ruas',
    osrm: 'pelas ruas (OpenStreetMap)',
    manual: 'desenhado à mão',
    reta: 'em linha reta (sem rede próxima)',
    cabo: 'do cabo FO até o cliente',
};

let editingClient = null; //Cliente aberto na janela (null = criação)
let dropEditSession = null; //Edição do traçado do drop no mapa
let streetRoutingAvailable = null; //Routes API do Google: null = ainda não testada
let osrmRoutingAvailable = null;   //OSRM público (gratuito, sem chave): null = ainda não testado
//Servidores OSRM públicos e gratuitos (dados do OpenStreetMap). O perfil a pé segue calçadas e ruas.
const OSRM_ROUTE_SERVERS = [
    'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
    'https://router.project-osrm.org/route/v1/foot',
];
const osrmRouteCache = new Map();
const CLIENT_KINDS = {
    residencial: { label: 'Cliente', short: '' },
    b2b: { label: 'Cliente B2B', short: 'B2B' },
    predial: { label: 'Predial', short: 'Predial' },
};
let clientDropsSuspended = false; //true enquanto um projeto é carregado (cabos ainda não existem)

//IP e bloco ficam separados; dados antigos guardavam "200.160.10.8/29" num campo só
function splitIpBlock(ip, block) {
    const text = String(ip || '').trim();
    const match = text.match(/^(.*?)\/(\d{1,3})$/);
    if (match && !block) return { ip: match[1], block: `/${match[2]}` };
    return { ip: text, block: block || '' };
}

function normalizeIpBlock(value) {
    const text = String(value || '').trim();
    return /^\d{1,3}$/.test(text) ? `/${text}` : text;
}

function getClientStatus(statusId) {
    return CLIENT_STATUSES.find(s => s.id === statusId) || CLIENT_STATUSES.find(s => s.id === DEFAULT_CLIENT_STATUS);
}

function isB2BClient(clientInfo) {
    return clientInfo?.client?.kind === 'b2b';
}

//Predial: os clientes estão no próprio prédio, então não há drop até o marcador
function isPredialClient(clientInfo) {
    return clientInfo?.client?.kind === 'predial';
}

function findMarkerByUid(uid) {
    return uid ? markers.find(m => m.uid === uid) : null;
}

// ---------------------------------------------------------------
// B2B ligado direto num cabo FO (fibra dedicada, sem CTO)
// ---------------------------------------------------------------

const CLIENT_CABLE_PREFIX = 'cabo:';

function getProjectCables(folderId) {
    const folderIds = getProjectFolderIdsForItem(folderId) || [];
    return savedCables.filter(c => folderIds.includes(c.folderId) && c.path?.length > 1);
}

function findClientCable(clientInfo) {
    const name = clientInfo?.client?.cableName;
    return name ? getProjectCables(clientInfo.folderId ?? getClientFolderId()).find(c => c.name === name) || null : null;
}

function getCableFiberCount(cable) {
    const fiberType = typeof getFiberType === 'function' ? getFiberType(cable?.type) : null;
    return fiberType ? parseInt(fiberType.split('-')[1], 10) || 12 : 12;
}

//Fibras do cabo já usadas por outros clientes B2B
function getOccupiedCableFibers(cable, ignoreClient) {
    const occupied = new Map();
    markers.forEach(m => {
        if (m === ignoreClient || m.type !== 'CLIENTE' || m.client?.status === 'cancelado') return;
        if (m.client?.cableName === cable.name && m.client.cableFiber) occupied.set(Number(m.client.cableFiber), m);
    });
    return occupied;
}

//Cabo desenhado com uma das pontas no cliente B2B (vínculo feito no desenho do cabo)
function findClientAnchoredCable(clientInfo) {
    const uid = clientInfo?.uid;
    if (!uid || !isB2BClient(clientInfo)) return null;
    return savedCables.find(c => c.startAnchorUid === uid || c.endAnchorUid === uid) || null;
}

//Ponto do cabo mais próximo do cliente (a derivação sai daí)
function nearestPointOnCable(cable, position) {
    let best = null;
    for (let i = 0; i < cable.path.length - 1; i++) {
        const proj = projectPointOnSegment(position, toLatLng(cable.path[i]), toLatLng(cable.path[i + 1]));
        if (!best || proj.dist < best.dist) best = proj;
    }
    return best?.point || null;
}

function getProjectCtos(folderId) {
    const folderIds = getProjectFolderIdsForItem(folderId) || [];
    return markers.filter(m => m.type === 'CTO' && folderIds.includes(m.folderId));
}

//Portas de atendimento da CTO, contadas nos splitters de atendimento do plano de fusão
function getCtoPortCapacity(cto) {
    if (!cto?.fusionPlan) return null;
    const plan = readFusionPlan(cto);
    if (!plan || plan.empty) return null;
    const ports = plan.splitters.filter(s => s.atendimento).reduce((sum, s) => sum + s.outputs, 0);
    return ports || null;
}

function getCtoClients(cto) {
    if (!cto?.uid) return [];
    return markers.filter(m => m.type === 'CLIENTE' && m.client?.ctoUid === cto.uid && m.client?.status !== 'cancelado');
}

function getOccupiedPorts(cto, ignoreClient) {
    const occupied = new Map();
    getCtoClients(cto).forEach(client => {
        if (client === ignoreClient || !client.client.ctoPort) return;
        occupied.set(Number(client.client.ctoPort), client);
    });
    return occupied;
}

function findFreePort(cto, ignoreClient) {
    const capacity = getCtoPortCapacity(cto) || DEFAULT_CTO_PORTS;
    const occupied = getOccupiedPorts(cto, ignoreClient);
    for (let port = 1; port <= capacity; port++) {
        if (!occupied.has(port)) return port;
    }
    return null;
}

//"Automática": liga o cliente à CTO mais próxima do projeto que tenha porta livre
function resolveAutomaticClientCto(clientInfo) {
    if (clientInfo.client?.ctoUid !== 'auto') return;
    const position = clientInfo.marker.getPosition();
    const candidates = getProjectCtos(clientInfo.folderId)
        .map(cto => ({ cto, distance: google.maps.geometry.spherical.computeDistanceBetween(position, cto.marker.getPosition()) }))
        .sort((a, b) => a.distance - b.distance);
    for (const { cto } of candidates) {
        const port = findFreePort(cto, clientInfo);
        if (port) {
            clientInfo.client.ctoUid = ensureMarkerUid(cto);
            clientInfo.client.ctoPort = port;
            return;
        }
    }
    clientInfo.client.ctoUid = null;
    clientInfo.client.ctoPort = null;
}

// ---------------------------------------------------------------
// Traçado do drop: segue os cabos do projeto (postes) até perto da casa
// ---------------------------------------------------------------

function latLngKey(p) {
    return `${p.lat().toFixed(6)},${p.lng().toFixed(6)}`;
}

function toLatLng(p) {
    return p instanceof google.maps.LatLng ? p : new google.maps.LatLng(p.lat, p.lng);
}

//Projeção de P no segmento AB (plano local em metros)
function projectPointOnSegment(p, a, b) {
    const k = Math.cos(a.lat() * Math.PI / 180);
    const bx = (b.lng() - a.lng()) * 111320 * k;
    const by = (b.lat() - a.lat()) * 110540;
    const px = (p.lng() - a.lng()) * 111320 * k;
    const py = (p.lat() - a.lat()) * 110540;
    const len2 = bx * bx + by * by;
    const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const point = google.maps.geometry.spherical.interpolate(a, b, t);
    return { t, point, dist: google.maps.geometry.spherical.computeDistanceBetween(p, point) };
}

//Grafo com os vértices de todos os cabos do projeto (pontas ancoradas coincidem nas caixas)
function buildDropNetwork(folderId) {
    const folderIds = getProjectFolderIdsForItem(folderId) || [];
    const nodes = new Map();
    const segments = [];
    const addNode = (p) => {
        const key = latLngKey(p);
        if (!nodes.has(key)) nodes.set(key, { pos: p, edges: new Map() });
        return key;
    };
    const link = (a, b, w) => {
        const na = nodes.get(a);
        const nb = nodes.get(b);
        if (!na.edges.has(b) || na.edges.get(b) > w) na.edges.set(b, w);
        if (!nb.edges.has(a) || nb.edges.get(a) > w) nb.edges.set(a, w);
    };
    savedCables.filter(c => folderIds.includes(c.folderId) && c.path?.length > 1).forEach(cable => {
        for (let i = 0; i < cable.path.length - 1; i++) {
            const pa = cable.path[i];
            const pb = cable.path[i + 1];
            const a = addNode(pa);
            const b = addNode(pb);
            if (a === b) continue;
            link(a, b, google.maps.geometry.spherical.computeDistanceBetween(pa, pb));
            segments.push({ a, b, pa, pb });
        }
    });
    return { nodes, segments, addNode, link };
}

function nearestNetworkPoint(net, p, maxDistance) {
    let best = null;
    net.segments.forEach(seg => {
        const proj = projectPointOnSegment(p, seg.pa, seg.pb);
        if (proj.dist <= maxDistance && (!best || proj.dist < best.dist)) best = { ...proj, seg };
    });
    return best;
}

//Dijkstra com fila de prioridade simples (heap binário)
function shortestNetworkPath(net, startKey, targetKey) {
    const dist = new Map([[startKey, 0]]);
    const prev = new Map();
    const heap = [[0, startKey]];
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
                const l = i * 2 + 1;
                const r = l + 1;
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
        const [d, key] = pop();
        if (key === targetKey) break;
        if (d > (dist.get(key) ?? Infinity)) continue;
        net.nodes.get(key)?.edges.forEach((w, next) => {
            const nd = d + w;
            if (nd < (dist.get(next) ?? Infinity)) {
                dist.set(next, nd);
                prev.set(next, key);
                push([nd, next]);
            }
        });
    }
    if (!dist.has(targetKey)) return null;
    const keys = [targetKey];
    while (keys[0] !== startKey) keys.unshift(prev.get(keys[0]));
    return keys;
}

//Rota CTO → rede → ponto da rede mais perto da casa → casa
function routeDropAlongNetwork(net, ctoPos, clientPos) {
    if (!net.segments.length) return null;
    const target = nearestNetworkPoint(net, clientPos, DROP_NETWORK_MAX_OFFSET_M);
    if (!target) return null;
    const virtual = [];
    const attach = (id, proj) => {
        net.nodes.set(id, { pos: proj.point, edges: new Map() });
        net.link(id, proj.seg.a, google.maps.geometry.spherical.computeDistanceBetween(proj.point, proj.seg.pa));
        net.link(id, proj.seg.b, google.maps.geometry.spherical.computeDistanceBetween(proj.point, proj.seg.pb));
        virtual.push(id);
    };
    let startKey = latLngKey(ctoPos);
    let startProj = null;
    if (!net.nodes.has(startKey)) {
        startProj = nearestNetworkPoint(net, ctoPos, DROP_CTO_ATTACH_M);
        if (!startProj) return null;
        startKey = '__cto__';
        attach(startKey, startProj);
    }
    attach('__client__', target);
    if (startProj && startProj.seg === target.seg) {
        net.link(startKey, '__client__', google.maps.geometry.spherical.computeDistanceBetween(startProj.point, target.point));
    }
    const keys = shortestNetworkPath(net, startKey, '__client__');
    const path = keys ? [ctoPos, ...keys.map(k => net.nodes.get(k).pos), clientPos] : null;
    //Remove os nós temporários para o grafo servir aos próximos clientes
    virtual.forEach(id => {
        net.nodes.get(id)?.edges.forEach((w, other) => net.nodes.get(other)?.edges.delete(id));
        net.nodes.delete(id);
    });
    if (!path) return null;
    return path.filter((p, i) => i === 0 || google.maps.geometry.spherical.computeDistanceBetween(p, path[i - 1]) > 0.3);
}

function getDropKey(cto, clientInfo) {
    return `${cto.uid}|${latLngKey(cto.marker.getPosition())}|${latLngKey(clientInfo.marker.getPosition())}`;
}

//Aplica uma rota pelas ruas se o cliente ainda estiver onde estava quando a rota foi pedida
function applyStreetDropRoute(clientInfo, cto, key, path, route) {
    if (!path?.length || clientInfo.client.dropKey !== key || clientInfo.client.dropRoute !== 'reta') return false;
    //Termina exatamente no marcador do cliente (segue o marcador mesmo fora da rua)
    const full = [cto.marker.getPosition(), ...path, clientInfo.marker.getPosition()];
    clientInfo.client.dropPath = full.map(p => ({ lat: p.lat(), lng: p.lng() }));
    clientInfo.client.dropRoute = route;
    drawClientDropLine(clientInfo);
    refreshBomAfterProjectChange();
    if (editingClient === clientInfo) updateClientDropSummary();
    return true;
}

//Rota pelas ruas com o OSRM público (API gratuita do OpenStreetMap, sem chave)
async function fetchOsrmRoute(from, to) {
    const coords = `${from.lng().toFixed(6)},${from.lat().toFixed(6)};${to.lng().toFixed(6)},${to.lat().toFixed(6)}`;
    if (osrmRouteCache.has(coords)) return osrmRouteCache.get(coords);
    for (const server of OSRM_ROUTE_SERVERS) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            const response = await fetch(`${server}/${coords}?overview=full&geometries=geojson`, { signal: controller.signal });
            clearTimeout(timer);
            if (!response.ok) continue;
            const data = await response.json();
            const line = data?.code === 'Ok' ? data.routes?.[0]?.geometry?.coordinates : null;
            if (!line?.length) continue;
            const path = line.map(([lng, lat]) => new google.maps.LatLng(lat, lng));
            osrmRouteCache.set(coords, path);
            return path;
        } catch (e) {
            //Tenta o próximo servidor
        }
    }
    return null;
}

async function requestOsrmDropRoute(clientInfo, cto, key) {
    if (osrmRoutingAvailable === false) return false;
    const path = await fetchOsrmRoute(cto.marker.getPosition(), clientInfo.marker.getPosition());
    if (!path) {
        if (osrmRoutingAvailable === null) osrmRoutingAvailable = false;
        return false;
    }
    osrmRoutingAvailable = true;
    return applyStreetDropRoute(clientInfo, cto, key, path, 'osrm');
}

//Rota pelas ruas: OSRM gratuito primeiro; Routes API do Google só se o OSRM falhar e estiver liberada na chave
async function requestStreetDropRoute(clientInfo, cto, key) {
    if (await requestOsrmDropRoute(clientInfo, cto, key)) return;
    if (clientInfo.client.dropKey !== key || clientInfo.client.dropRoute !== 'reta') return;
    if (streetRoutingAvailable === false || !google.maps.importLibrary) return;
    try {
        const { Route } = await google.maps.importLibrary('routes');
        const { routes } = await Route.computeRoutes({
            origin: cto.marker.getPosition(),
            destination: clientInfo.marker.getPosition(),
            travelMode: 'WALKING',
            fields: ['path'],
        });
        streetRoutingAvailable = true;
        applyStreetDropRoute(clientInfo, cto, key, routes?.[0]?.path?.map(toLatLng), 'rua');
    } catch (e) {
        streetRoutingAvailable = false; //Routes API não habilitada: fica na linha reta
    }
}

function ensureClientDropPath(clientInfo, cto, { force = false, getNetwork }) {
    const data = clientInfo.client;
    const key = getDropKey(cto, clientInfo);
    const ctoPos = cto.marker.getPosition();
    const clientPos = clientInfo.marker.getPosition();
    const hasPath = Array.isArray(data.dropPath) && data.dropPath.length >= 2;
    if (data.dropRoute === 'manual' && hasPath) {
        if (data.dropKey !== key) {
            data.dropPath[0] = { lat: ctoPos.lat(), lng: ctoPos.lng() };
            data.dropPath[data.dropPath.length - 1] = { lat: clientPos.lat(), lng: clientPos.lng() };
            data.dropKey = key;
        }
        return;
    }
    //Traçado já feito fica como está (abrir o projeto ou mexer em cabos não refaz a rota).
    //force só melhora a linha reta provisória; CTO ou cliente movidos e "Recalcular" refazem.
    if (hasPath && data.dropKey === key && !(force && data.dropRoute === 'reta')) return;
    const routed = routeDropAlongNetwork(getNetwork(clientInfo.folderId), ctoPos, clientPos);
    if (routed) {
        data.dropPath = routed.map(p => ({ lat: p.lat(), lng: p.lng() }));
        data.dropRoute = 'rede';
    } else if ((data.dropRoute === 'rua' || data.dropRoute === 'osrm') && hasPath && data.dropKey === key) {
        return;
    } else {
        data.dropPath = [{ lat: ctoPos.lat(), lng: ctoPos.lng() }, { lat: clientPos.lat(), lng: clientPos.lng() }];
        data.dropRoute = 'reta';
        data.dropKey = key;
        requestStreetDropRoute(clientInfo, cto, key);
        return;
    }
    data.dropKey = key;
}

//Metragem do drop: traçado + sobra da empresa, ou o valor informado
function getClientDropInfo(clientInfo) {
    if (isPredialClient(clientInfo)) return null;
    if (findClientAnchoredCable(clientInfo)) return null; //O próprio cabo FO chega ao cliente: sem drop
    if (clientInfo.client?.cableName) {
        const cable = findClientCable(clientInfo);
        if (!cable || !clientInfo.marker) return null;
        const start = nearestPointOnCable(cable, clientInfo.marker.getPosition());
        if (!start) return null;
        const routed = google.maps.geometry.spherical.computeDistanceBetween(start, clientInfo.marker.getPosition());
        const slack = Number(lancamentoConfig.dropSlack) || 0;
        const automatic = Math.ceil(routed + slack);
        const override = Number(clientInfo.client?.dropOverride) > 0 ? Math.ceil(Number(clientInfo.client.dropOverride)) : null;
        return { cto: null, cable, straight: routed, routed, route: 'cabo', slack, automatic, length: override || automatic, isManual: !!override };
    }
    const cto = findMarkerByUid(clientInfo.client?.ctoUid);
    if (!cto?.marker || !clientInfo.marker) return null;
    const straight = google.maps.geometry.spherical.computeDistanceBetween(cto.marker.getPosition(), clientInfo.marker.getPosition());
    const path = Array.isArray(clientInfo.client?.dropPath) && clientInfo.client.dropPath.length >= 2 && clientInfo.client.dropKey === getDropKey(cto, clientInfo)
        ? clientInfo.client.dropPath.map(toLatLng)
        : null;
    const routed = path ? google.maps.geometry.spherical.computeLength(path) : straight;
    const slack = Number(lancamentoConfig.dropSlack) || 0;
    const automatic = Math.ceil(routed + slack);
    const override = Number(clientInfo.client?.dropOverride) > 0 ? Math.ceil(Number(clientInfo.client.dropOverride)) : null;
    return {
        cto,
        straight,
        routed,
        route: path ? (clientInfo.client.dropRoute || 'reta') : 'reta',
        slack,
        automatic,
        length: override || automatic,
        isManual: !!override,
    };
}

function drawClientDropLine(clientInfo) {
    const path = clientInfo.client?.dropPath;
    if (!clientInfo.dropLine || !Array.isArray(path)) return;
    const color = getClientStatus(clientInfo.client?.status).color;
    const straight = clientInfo.client.dropRoute === 'reta';
    clientInfo.dropLine.setOptions({
        strokeOpacity: 0,
        editable: false,
        icons: [{
            icon: { path: 'M 0,-1 0,1', strokeOpacity: straight ? 0.55 : 0.95, strokeWeight: straight ? 2 : 2.5, scale: 2, strokeColor: color },
            offset: '0',
            repeat: straight ? '10px' : '8px',
        }],
    });
    clientInfo.dropLine.setPath(path.map(toLatLng));
    refreshClientDropSidebarRow(clientInfo);
}

//Desenha (ou atualiza) o drop de cada cliente.
//onlyCto: só os clientes dessa CTO · live: CTO sendo arrastada (move só a ponta) · recompute: tenta trocar linhas retas pela rede
function refreshClientDrops(options = {}) {
    if (typeof google === 'undefined' || !google.maps?.geometry || clientDropsSuspended) return;
    const { onlyCto = null, live = false, recompute = false } = options;
    const networks = new Map();
    const getNetwork = (folderId) => {
        const rootIds = getProjectFolderIdsForItem(folderId) || [folderId];
        const rootKey = rootIds[0];
        if (!networks.has(rootKey)) networks.set(rootKey, buildDropNetwork(folderId));
        return networks.get(rootKey);
    };
    markers.forEach(clientInfo => {
        if (clientInfo.type !== 'CLIENTE' || clientInfo === dropEditSession?.clientInfo) return;
        const anchored = findClientAnchoredCable(clientInfo);
        if (anchored) {
            if (onlyCto) return;
            clientInfo.dropLine?.setPath([]);
            if (clientInfo.client.linkedCable !== anchored.name) {
                clientInfo.client.linkedCable = anchored.name;
                applyClientAppearance(clientInfo);
            }
            return;
        }
        if (clientInfo.client?.linkedCable) {
            delete clientInfo.client.linkedCable;
            applyClientAppearance(clientInfo);
        }
        if (clientInfo.client?.cableName && !isPredialClient(clientInfo)) {
            if (onlyCto) return;
            const cable = findClientCable(clientInfo);
            const start = cable && nearestPointOnCable(cable, clientInfo.marker.getPosition());
            if (!start) {
                clientInfo.dropLine?.setPath([]);
                return;
            }
            ensureClientDropLine(clientInfo);
            const end = clientInfo.marker.getPosition();
            clientInfo.client.dropPath = [{ lat: start.lat(), lng: start.lng() }, { lat: end.lat(), lng: end.lng() }];
            clientInfo.client.dropRoute = 'cabo';
            drawClientDropLine(clientInfo);
            return;
        }
        const cto = findMarkerByUid(clientInfo.client?.ctoUid);
        if (onlyCto && cto !== onlyCto) return;
        if (!cto?.marker || isPredialClient(clientInfo)) {
            clientInfo.dropLine?.setPath([]);
            return;
        }
        ensureClientDropLine(clientInfo);
        if (live && Array.isArray(clientInfo.client.dropPath)) {
            const path = clientInfo.dropLine.getPath();
            if (path.getLength()) path.setAt(0, cto.marker.getPosition());
            return;
        }
        ensureClientDropPath(clientInfo, cto, { force: recompute, getNetwork });
        drawClientDropLine(clientInfo);
    });
    markers.forEach(m => { if (m.type === 'CLIENTE') refreshClientDropSidebarRow(m); });
}

//Linha do drop: some junto com o marcador (exclusão, pasta oculta) e pode ser ocultada sozinha
function ensureClientDropLine(clientInfo) {
    if (clientInfo.dropLine) return;
    clientInfo.dropLine = new google.maps.Polyline({ clickable: false, strokeOpacity: 0, zIndex: 5 });
    clientInfo.dropLine.bindTo('map', clientInfo.marker);
    clientInfo.marker.addListener('visible_changed', () => syncClientDropVisibility(clientInfo));
    syncClientDropVisibility(clientInfo);
}

function syncClientDropVisibility(clientInfo) {
    clientInfo.dropLine?.setVisible(clientInfo.marker.getVisible() !== false && !clientInfo.client?.dropHidden);
}

// ---------------------------------------------------------------
// Drop na barra lateral: linha embaixo do cliente (ocultar, centralizar, editar traçado)
// ---------------------------------------------------------------

function hasClientDrop(clientInfo) {
    return !!clientInfo.dropLine && clientInfo.dropLine.getPath().getLength() >= 2 && !!getClientDropInfo(clientInfo);
}

function refreshClientDropSidebarRow(clientInfo) {
    const li = clientInfo.listItem;
    if (!li) return;
    let row = li.querySelector(':scope > .ge-drop-row');
    if (!hasClientDrop(clientInfo)) {
        row?.remove();
        li.classList.remove('has-drop-row');
        return;
    }
    if (!row) {
        row = document.createElement('div');
        row.className = 'ge-pro-row ge-drop-row';
        row.innerHTML = `<input type="checkbox" class="ge-vis-checkbox ge-drop-vis">
            <span class="ge-item-icon ge-icon-path" aria-hidden="true"></span>
            <span class="item-name">Drop</span><span class="item-meta"></span>
            <div class="ge-pro-actions"><button type="button" class="item-actions-toggle-btn" title="Ações" aria-label="Ações do drop" aria-haspopup="menu">&#8942;</button></div>`;
        const checkbox = row.querySelector('.ge-drop-vis');
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            setClientDropHidden(clientInfo, !checkbox.checked);
        });
        row.addEventListener('click', (e) => {
            if (e.target.closest('input, button')) return;
            e.stopPropagation();
            selectSidebarMarker(clientInfo);
            focusMapToClientDrop(clientInfo);
        });
        row.addEventListener('dblclick', (e) => {
            if (e.target.closest('input, button')) return;
            e.stopPropagation();
            if (AppSession.canEdit) editClientDropFromSidebar(clientInfo);
            else focusMapToClientDrop(clientInfo);
        });
        li.appendChild(row);
        li.classList.add('has-drop-row');
    }
    const info = getClientDropInfo(clientInfo);
    const visible = !clientInfo.client.dropHidden;
    const checkbox = row.querySelector('.ge-drop-vis');
    checkbox.checked = visible;
    checkbox.title = visible ? 'Ocultar drop no mapa' : 'Exibir drop no mapa';
    row.querySelector('.ge-item-icon').style.setProperty('--ge-item-color', getClientStatus(clientInfo.client.status).color);
    const route = info.cable ? 'no cabo' : (DROP_ROUTE_LABELS[info.route] || '');
    const meta = [`${info.length} m`, route, info.isManual ? 'metragem informada' : ''].filter(Boolean).join(' · ');
    const metaEl = row.querySelector('.item-meta');
    if (metaEl.textContent !== meta) metaEl.textContent = meta;
}

function setClientDropHidden(clientInfo, hidden) {
    if (hidden) clientInfo.client.dropHidden = true;
    else delete clientInfo.client.dropHidden;
    syncClientDropVisibility(clientInfo);
    refreshClientDropSidebarRow(clientInfo);
}

function focusMapToClientDrop(clientInfo) {
    const bounds = new google.maps.LatLngBounds();
    clientInfo.dropLine?.getPath().forEach(p => bounds.extend(p));
    if (bounds.isEmpty()) focusMapToMarker(clientInfo);
    else map.fitBounds(bounds, { top: 56, right: 48, bottom: 56, left: getMapFocusPadding() });
}

//Edição do traçado pela barra lateral (mesma edição do botão na janela do cliente)
function editClientDropFromSidebar(clientInfo) {
    if (!requireEdit('editar o drop')) return;
    if (clientInfo.client.cableName || !findMarkerByUid(clientInfo.client.ctoUid)) {
        showToast('Drop no cabo', 'A derivação direto no cabo é reta e não tem traçado para ajustar.', 'progress');
        return;
    }
    if (clientInfo.client.dropHidden) setClientDropHidden(clientInfo, false);
    editingClient = clientInfo;
    startClientDropEdit();
}

function recalculateClientDropFromSidebar(clientInfo) {
    if (!requireEdit('recalcular o drop')) return;
    clientInfo.client.dropRoute = null;
    clientInfo.client.dropKey = null;
    refreshClientDrops({ onlyCto: findMarkerByUid(clientInfo.client.ctoUid) });
    refreshBomAfterProjectChange();
    showToast('Drop recalculado', DROP_ROUTE_LABELS[clientInfo.client.dropRoute] ? `Traçado ${DROP_ROUTE_LABELS[clientInfo.client.dropRoute]}.` : 'Traçado atualizado.');
}

// ---------------------------------------------------------------
// Endereço automático (Nominatim/OpenStreetMap, gratuito; Google Geocoder como reserva)
// ---------------------------------------------------------------

function formatNominatimAddress(data) {
    const a = data?.address || {};
    const street = a.road || a.pedestrian || a.footway || a.residential || '';
    const number = a.house_number || '';
    const district = a.suburb || a.neighbourhood || a.quarter || a.city_district || '';
    const city = a.city || a.town || a.village || a.municipality || '';
    const parts = [[street, number].filter(Boolean).join(', '), district, city].filter(Boolean);
    return parts.join(' - ') || data?.display_name || '';
}

async function reverseGeocode(position) {
    const lat = position.lat();
    const lng = position.lng();
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=pt-BR`;
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (response.ok) {
            const text = formatNominatimAddress(await response.json());
            if (text) return text;
        }
    } catch (e) {
        //Tenta o Google
    }
    try {
        const { results } = await new google.maps.Geocoder().geocode({ location: { lat, lng } });
        return results?.[0]?.formatted_address || '';
    } catch (e) {
        return '';
    }
}

//Preenche o endereço do cliente pelo ponto no mapa (não sobrescreve o que foi digitado)
async function fillClientAddressFromMap(clientInfo, { force = false } = {}) {
    if (!clientInfo?.marker || !clientInfo.client) return;
    if (clientInfo.client.address && !force && !clientInfo.client.addressAuto) return;
    const position = clientInfo.marker.getPosition();
    const address = await reverseGeocode(position);
    if (!address || !markers.includes(clientInfo)) return;
    if (!clientInfo.marker.getPosition().equals(position)) return; //Foi movido de novo: a próxima busca atualiza
    clientInfo.client.address = address;
    clientInfo.client.addressAuto = true;
    applyClientAppearance(clientInfo);
    if (editingClient === clientInfo) document.getElementById('clientAddress').value = address;
}

// ---------------------------------------------------------------
// Aparência e materiais
// ---------------------------------------------------------------

//Nome no mapa: vale para qualquer tipo de cliente (antes só B2B, guardado em client.b2b)
function getClientMapLabel(client) {
    const show = client?.showLabel ?? client?.b2b?.showLabel;
    return { show: !!show, color: client?.labelColor || client?.b2b?.labelColor || '#0f172a' };
}

function applyClientAppearance(clientInfo) {
    clientInfo.client = normalizeClientData(clientInfo.client);
    const status = getClientStatus(clientInfo.client.status);
    clientInfo.client.status = status.id;
    clientInfo.color = status.color;
    const kind = CLIENT_KINDS[clientInfo.client.kind];
    const variant = clientInfo.client.kind === 'residencial' ? '' : clientInfo.client.kind;
    //Qualquer cliente pode exibir o nome no mapa, como as caixas
    const label = getClientMapLabel(clientInfo.client);
    clientInfo.marker.setLabel(label.show ? buildMarkerMapLabel(clientInfo.name, label.color) : null);
    clientInfo.marker.setIcon(buildMarkerMapIcon('CLIENTE', { color: status.color, variant, faded: status.id === 'cancelado' }));
    const cto = findMarkerByUid(clientInfo.client.ctoUid);
    const cable = clientInfo.client.cableName ? findClientCable(clientInfo) : null;
    const anchoredCable = findClientAnchoredCable(clientInfo);
    const link = anchoredCable
        ? ` · cabo ${anchoredCable.name}`
        : cable
        ? ` · ${cable.name}${clientInfo.client.cableFiber ? ` fibra ${clientInfo.client.cableFiber}` : ''}`
        : cto ? ` · ${cto.name}${clientInfo.client.ctoPort ? ` porta ${clientInfo.client.ctoPort}` : ''}` : ' · sem CTO';
    const units = isPredialClient(clientInfo) && clientInfo.client.predial?.units ? ` · ${clientInfo.client.predial.units} unidades` : '';
    clientInfo.marker.setTitle(null); //Sem dica nativa do navegador no mapa
    setSidebarItemLabel(clientInfo.listItem, clientInfo.name, `${kind.label}${units} · ${status.label}${link.replace(' · sem CTO', '')}`);
    if (clientInfo.listItem) clientInfo.listItem.title = clientInfo.client.address || '';
    applyMarkerSidebarColorStyles(clientInfo);
}

//Completa dados de clientes antigos (equipamento único → lista)
function normalizeClientData(data = {}) {
    const client = { ...data };
    client.kind = CLIENT_KINDS[client.kind] ? client.kind : 'residencial';
    client.predial = client.predial || {};
    if (!Array.isArray(client.equipments)) {
        const legacy = client.equipment;
        client.equipments = legacy && (legacy.model || legacy.serial || legacy.mac)
            ? [{ type: 'ONU/ONT', model: legacy.model || '', serial: legacy.serial || '', mac: legacy.mac || '' }]
            : [];
    }
    delete client.equipment;
    client.b2b = client.b2b || {};
    return client;
}

//Drop e kit de instalação de clientes em viabilidade ou a instalar
function addClientMaterialsToBom(projectMarkers, addMaterial) {
    const kit = getKitComponents(CLIENT_KIT_NAME);
    projectMarkers.forEach(clientInfo => {
        if (clientInfo.type !== 'CLIENTE') return;
        if (!getClientStatus(clientInfo.client?.status).billable) return;
        const drop = getClientDropInfo(clientInfo);
        if (drop) addMaterial(CLIENT_DROP_MATERIAL, drop.length, 'length', 'Clientes', clientInfo.name);
        kit.forEach(c => addMaterial(c.name, c.quantity, 'unit', 'Clientes', clientInfo.name));
        //Equipamentos do cliente: o escolhido no catálogo entra com o preço dele; o digitado procura
        //um material de mesmo nome no catálogo e, se não achar, entra pelo tipo e modelo (sem preço)
        //Ficam na parte de Data Center da lista de materiais
        (clientInfo.client?.equipments || []).forEach(e => {
            const name = getClientEquipmentMaterialName(e);
            //Sem preço no catálogo: usa o valor informado no equipamento do cliente
            const catalogPrice = Number(MATERIAL_PRICES[resolveMaterialName(name)]?.price) || 0;
            const price = catalogPrice > 0 ? undefined : Number(e.price) || undefined;
            addMaterial(name, 1, 'un', 'Data Center', `${clientInfo.name} (equipamento)`, price);
            const item = typeof bomState !== 'undefined' ? bomState[makeBomKey(name)] : null;
            if (item) {
                item.category = 'Data Center';
                item.clientQuantity = (Number(item.clientQuantity) || 0) + 1;
            }
        });
    });
}

// ---------------------------------------------------------------
// Painel "Clientes atendidos" no editor da CTO
// ---------------------------------------------------------------

function renderCtoClientsPanel(cto) {
    const panel = document.getElementById('ctoClientsPanel');
    if (!panel) return;
    ensureMarkerUid(cto);
    const clients = getCtoClients(cto);
    const capacity = getCtoPortCapacity(cto);
    const occupied = getOccupiedPorts(cto);
    document.getElementById('ctoClientsOccupancy').textContent = capacity
        ? `${occupied.size} de ${capacity} portas em uso`
        : `${clients.length} cliente(s) · adicione um splitter de atendimento no plano de fusão para definir as portas`;
    const grid = document.getElementById('ctoPortGrid');
    grid.innerHTML = '';
    for (let port = 1; port <= (capacity || 0); port++) {
        const client = occupied.get(port);
        const cell = document.createElement('span');
        cell.className = `cto-port${client ? ' cto-port--used' : ''}`;
        cell.textContent = port;
        if (client) {
            cell.style.setProperty('--port-color', getClientStatus(client.client.status).color);
            cell.title = `Porta ${port}: ${client.name}`;
        } else {
            cell.title = `Porta ${port}: livre`;
        }
        grid.appendChild(cell);
    }
    const list = document.getElementById('ctoClientsList');
    list.innerHTML = '';
    clients
        .sort((a, b) => (Number(a.client.ctoPort) || 999) - (Number(b.client.ctoPort) || 999))
        .forEach(client => {
            const status = getClientStatus(client.client.status);
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="cto-clients-list__port">${client.client.ctoPort ? `P${client.client.ctoPort}` : '—'}</span>
                <button type="button" class="cto-clients-list__name btn-link">${escapeHtml(client.name)}${CLIENT_KINDS[client.client?.kind]?.short ? ` <small>${CLIENT_KINDS[client.client.kind].short}</small>` : ''}</button>
                <span class="cto-clients-list__status" style="--status-color:${status.color}">${status.label}</span>`;
            li.querySelector('button').addEventListener('click', () => {
                resetMarkerModal({ discardPositionChanges: false });
                openClientModal(client);
            });
            list.appendChild(li);
        });
    panel.classList.remove('hidden');
}

// ---------------------------------------------------------------
// Janela do cliente
// ---------------------------------------------------------------

function getClientFolderId() {
    return editingClient ? editingClient.folderId : activeFolderId;
}

function renderClientStatusButtons(selectedId) {
    const group = document.getElementById('clientStatusGroup');
    group.innerHTML = '';
    CLIENT_STATUSES.forEach(status => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `client-status-chip${status.id === selectedId ? ' is-active' : ''}`;
        button.dataset.status = status.id;
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', status.id === selectedId ? 'true' : 'false');
        button.style.setProperty('--status-color', status.color);
        button.innerHTML = `<span class="client-status-chip__dot"></span>${status.label}`;
        button.addEventListener('click', () => {
            group.querySelectorAll('.client-status-chip').forEach(b => {
                const active = b === button;
                b.classList.toggle('is-active', active);
                b.setAttribute('aria-checked', active ? 'true' : 'false');
            });
        });
        group.appendChild(button);
    });
}

function getSelectedClientStatus() {
    return document.querySelector('#clientStatusGroup .client-status-chip.is-active')?.dataset.status || DEFAULT_CLIENT_STATUS;
}

function setClientKind(kind) {
    kind = CLIENT_KINDS[kind] ? kind : 'residencial';
    const b2b = kind === 'b2b';
    const predial = kind === 'predial';
    document.querySelectorAll('#clientKindGroup button').forEach(b => {
        const active = b.dataset.kind === kind;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    document.getElementById('clientB2BSection').hidden = !b2b;
    document.getElementById('clientPredialSection').hidden = !predial;
    document.getElementById('clientDropOverrideGroup').hidden = predial;
    document.getElementById('clientModal').classList.toggle('is-b2b', b2b);
    document.getElementById('clientModal').classList.toggle('is-predial', predial);
    document.getElementById('clientNameLabel').textContent = b2b ? 'Razão social *' : predial ? 'Nome do prédio / condomínio *' : 'Nome *';
    document.getElementById('clientDocumentLabel').textContent = b2b || predial ? 'CNPJ' : 'CPF / CNPJ';
    if (document.getElementById('clientModal').style.display === 'flex') {
        //Troca de tipo: a lista de ligação muda (cabos FO só para B2B)
        const current = document.getElementById('clientCto').value;
        populateClientCtoSelect(current);
        populateClientPortSelect(document.getElementById('clientPort').value);
        updateClientDropSummary();
    }
}

function getSelectedClientKind() {
    const kind = document.querySelector('#clientKindGroup button.is-active')?.dataset.kind;
    return CLIENT_KINDS[kind] ? kind : 'residencial';
}

function populateClientCtoSelect(selectedUid) {
    const select = document.getElementById('clientCto');
    select.innerHTML = '';
    const addOption = (value, text) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
    };
    const b2b = getSelectedClientKind() === 'b2b';
    if (!editingClient && !b2b) addOption('auto', 'Automática (mais próxima com porta livre)');
    addOption('', 'Sem CTO');
    getProjectCtos(getClientFolderId())
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', { numeric: true }))
        .forEach(cto => {
            const uid = ensureMarkerUid(cto);
            const capacity = getCtoPortCapacity(cto);
            const used = getOccupiedPorts(cto, editingClient).size;
            const occupancy = capacity ? `${used} de ${capacity} portas` : `${used} cliente${used === 1 ? '' : 's'}`;
            addOption(uid, `${cto.name} — ${occupancy}`);
        });
    //B2B: o vínculo com o cabo FO é feito desenhando o cabo até o cliente; aqui só aparece o vínculo antigo
    const legacyCable = editingClient?.client?.cableName;
    if (legacyCable && getSelectedClientKind() === 'b2b') {
        const cables = getProjectCables(getClientFolderId())
            .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', { numeric: true }));
        if (cables.length) {
            const group = document.createElement('optgroup');
            group.label = 'Cabo FO (fibra dedicada)';
            cables.filter(cable => cable.name === legacyCable).forEach(cable => {
                const option = document.createElement('option');
                option.value = CLIENT_CABLE_PREFIX + cable.name;
                const used = getOccupiedCableFibers(cable, editingClient).size;
                option.textContent = `${cable.name} — ${used} de ${getCableFiberCount(cable)} fibras`;
                group.appendChild(option);
            });
            select.appendChild(group);
        }
    }
    const fallback = editingClient || b2b ? '' : 'auto';
    const wanted = selectedUid ?? fallback;
    select.value = wanted;
    if (select.value !== wanted) select.value = fallback;
}

function populateClientPortSelect(preferredPort) {
    const ctoUid = document.getElementById('clientCto').value;
    const select = document.getElementById('clientPort');
    select.innerHTML = '';
    document.getElementById('clientPortLabel').textContent = ctoUid.startsWith(CLIENT_CABLE_PREFIX) ? 'Fibra' : 'Porta';
    if (ctoUid.startsWith(CLIENT_CABLE_PREFIX)) {
        const cable = getProjectCables(getClientFolderId()).find(c => c.name === ctoUid.slice(CLIENT_CABLE_PREFIX.length));
        select.disabled = !cable;
        if (!cable) return;
        const occupied = getOccupiedCableFibers(cable, editingClient);
        const total = getCableFiberCount(cable);
        let first = null;
        for (let fiber = 1; fiber <= total; fiber++) {
            const option = document.createElement('option');
            option.value = String(fiber);
            const taken = occupied.get(fiber);
            option.textContent = taken ? `Fibra ${fiber} — ${taken.name}` : `Fibra ${fiber}`;
            option.disabled = !!taken;
            if (!taken && first === null) first = fiber;
            select.appendChild(option);
        }
        const preferred = Number(preferredPort);
        select.value = String(preferred && !occupied.has(preferred) && preferred <= total ? preferred : (first || ''));
        return;
    }
    const cto = findMarkerByUid(ctoUid);
    if (!cto) {
        select.disabled = true;
        const option = document.createElement('option');
        option.value = '';
        option.textContent = ctoUid === 'auto' ? 'Definida ao posicionar' : '—';
        select.appendChild(option);
        return;
    }
    select.disabled = false;
    const capacity = getCtoPortCapacity(cto) || DEFAULT_CTO_PORTS;
    const occupied = getOccupiedPorts(cto, editingClient);
    for (let port = 1; port <= capacity; port++) {
        const option = document.createElement('option');
        option.value = String(port);
        const taken = occupied.get(port);
        option.textContent = taken ? `Porta ${port} — ${taken.name}` : `Porta ${port}`;
        option.disabled = !!taken;
        select.appendChild(option);
    }
    const preferred = Number(preferredPort);
    const initial = preferred && !occupied.has(preferred) && preferred <= capacity ? preferred : findFreePort(cto, editingClient);
    select.value = initial ? String(initial) : '';
}

function updateClientDropSummary() {
    const summary = document.getElementById('clientDropSummary');
    const actions = document.getElementById('clientDropActions');
    const ctoUid = document.getElementById('clientCto').value;
    const override = Number(document.getElementById('clientDropOverride').value) || null;
    actions.hidden = true;
    const anchored = editingClient && findClientAnchoredCable(editingClient);
    if (anchored) {
        summary.innerHTML = `Ligado pelo cabo <strong>${escapeHtml(anchored.name)}</strong> desenhado até o cliente (sem drop).`;
        return;
    }
    if (getSelectedClientKind() === 'b2b' && ctoUid === '') {
        summary.textContent = 'Para ligar por fibra dedicada, desenhe um cabo da CEO/CTO até este cliente. Ou escolha uma CTO para usar drop.';
        return;
    }
    if (getSelectedClientKind() === 'predial') {
        summary.textContent = 'Predial: os clientes estão no próprio prédio, então não há drop até o marcador.';
        return;
    }
    if (!editingClient) {
        summary.textContent = ctoUid === ''
            ? 'Sem CTO: o drop não será calculado.'
            : 'O drop é traçado pela rede do projeto quando você posicionar o cliente no mapa.';
        return;
    }
    const cableName = ctoUid.startsWith(CLIENT_CABLE_PREFIX) ? ctoUid.slice(CLIENT_CABLE_PREFIX.length) : null;
    const sameCto = cableName ? cableName === editingClient.client?.cableName : (ctoUid === editingClient.client?.ctoUid && !editingClient.client?.cableName);
    const info = getClientDropInfo({ marker: editingClient.marker, folderId: editingClient.folderId, client: { ...editingClient.client, ctoUid: cableName ? null : ctoUid, cableName, dropOverride: override } });
    if (!info) {
        summary.textContent = 'Sem CTO: o drop não será calculado.';
        return;
    }
    if (!sameCto) {
        summary.innerHTML = `Nova ligação: o traçado é refeito ao salvar (linha reta hoje: ${formatDistance(info.straight)}).`;
        return;
    }
    const detail = `${formatDistance(info.routed)} ${DROP_ROUTE_LABELS[info.route] || ''} + ${info.slack} m de sobra = ${info.automatic} m`;
    summary.innerHTML = info.isManual
        ? `Drop: <strong>${info.length} m</strong> (informado). Traçado: ${detail}.`
        : `Drop: <strong>${info.length} m</strong> · ${detail}.`;
    actions.hidden = false;
    document.getElementById('editClientDropButton').hidden = !!info.cable; //Ligação no cabo: derivação reta, sem ajuste
}

// Lista de equipamentos
function addClientEquipmentRow(equipment = {}) {
    const list = document.getElementById('clientEquipmentList');
    const row = document.createElement('div');
    row.className = 'client-equipment-row';
    row.innerHTML = `
        <select class="client-equipment-type" aria-label="Tipo">${CLIENT_EQUIPMENT_TYPES.map(t => `<option${t === (equipment.type || 'ONU/ONT') ? ' selected' : ''}>${t}</option>`).join('')}</select>
        <input type="text" class="client-equipment-model" maxlength="160" placeholder="Modelo" aria-label="Modelo" value="${escapeHtml(equipment.model || '')}"${equipment.material ? ` data-material="${escapeHtml(equipment.material)}" title="Material do catálogo: ${escapeHtml(equipment.material)}"` : ''} />
        <input type="text" class="client-equipment-serial" maxlength="40" placeholder="Nº de série" aria-label="Número de série" value="${escapeHtml(equipment.serial || '')}" />
        <input type="text" class="client-equipment-mac" maxlength="17" placeholder="MAC" aria-label="MAC" value="${escapeHtml(equipment.mac || '')}" />
        <input type="number" class="client-equipment-price" min="0" step="0.01" placeholder="${escapeHtml(getClientEquipmentCatalogPriceHint(equipment))}" aria-label="Valor unitário (R$)" title="Valor unitário usado na lista de materiais quando o equipamento não tem preço no catálogo" value="${Number(equipment.price) > 0 ? Number(equipment.price) : ''}" />
        <button type="button" class="btn-icon client-equipment-remove" title="Remover equipamento" aria-label="Remover equipamento">
            <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-trash"></use></svg>
        </button>`;
    row.querySelector('.client-equipment-remove').addEventListener('click', () => {
        row.remove();
        updateClientEquipmentEmptyState();
    });
    list.appendChild(row);
    updateClientEquipmentEmptyState();
    return row;
}

//Preço do catálogo do equipamento (mostrado como dica no campo de valor)
function getClientEquipmentCatalogPriceHint(equipment) {
    const name = equipment.model || equipment.material ? getClientEquipmentMaterialName(equipment) : null;
    const price = name ? Number(MATERIAL_PRICES[name]?.price) || 0 : 0;
    return price > 0 ? formatCatalogPrice(price) : '0,00';
}

function getClientEquipmentMaterialName(equipment) {
    if (equipment.material) return equipment.material;
    const model = String(equipment.model || '').trim();
    if (model) {
        const norm = normalizeMaterialName(model);
        const match = materialCatalog.materials.find(m => normalizeMaterialName(m.name) === norm || (m.code && String(m.code).trim() === model));
        if (match) return match.name;
        //Modelo digitado que é parte do nome de um único material do catálogo
        const partial = norm.length >= 4
            ? materialCatalog.materials.filter(m => normalizeMaterialName(m.name).includes(norm))
            : [];
        if (partial.length === 1) return partial[0].name;
    }
    return [equipment.type, model].filter(Boolean).join(' - ') || 'Equipamento do cliente';
}

//Seletor de materiais Data Center (equipamentos do cliente B2B)
function openClientDcPicker() {
    const picker = document.getElementById('clientDcPicker');
    picker.hidden = false;
    document.getElementById('clientDcSearch').value = '';
    document.getElementById('clientDcShowAll').checked = false;
    renderClientDcList();
    document.getElementById('clientDcSearch').focus();
}

function closeClientDcPicker() {
    document.getElementById('clientDcPicker').hidden = true;
}

function renderClientDcList() {
    const term = normalizeMaterialName(document.getElementById('clientDcSearch').value);
    const showAll = document.getElementById('clientDcShowAll').checked;
    const items = materialCatalog.materials
        .filter(m => !CATALOG_FIXED_CATEGORY_NAMES.has(normalizeMaterialName(m.name)))
        .filter(m => showAll || m.category === 'Data Center')
        .filter(m => !term || normalizeMaterialName(`${m.name} ${m.code || ''}`).includes(term))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    const list = document.getElementById('clientDcList');
    list.innerHTML = items.length
        ? items.map(m => `<li><button type="button" data-dc-material="${escapeHtml(m.name)}"><span>${escapeHtml(m.name)}</span><small>${m.code ? `Cód. ${escapeHtml(m.code)} · ` : ''}R$ ${formatCatalogPrice(Number(m.price) || 0)}</small></button></li>`).join('')
        : `<li class="client-dc-picker__empty">${showAll ? 'Nenhum material encontrado.' : 'Nenhum material Data Center encontrado. Marque "Todos os materiais" ou digite manualmente.'}</li>`;
}

function guessEquipmentType(name) {
    const n = normalizeMaterialName(name);
    if (/\bEDD\b/.test(n)) return 'EDD';
    if (/\b(SFP|XFP|GBIC)\b/.test(n)) return 'SFP';
    if (/\bSWITCH\b/.test(n)) return 'Switch';
    if (/\b(ROUTER|RB\d+|ROTEADOR|MIKROTIK|GATEWAY)\b/.test(n)) return 'Roteador';
    if (/\b(ONU|ONT)\b/.test(n)) return 'ONU/ONT';
    if (/\bCONVERSOR\b/.test(n)) return 'Conversor de mídia';
    return 'Outro';
}

function updateClientEquipmentEmptyState() {
    const empty = !document.querySelector('#clientEquipmentList .client-equipment-row');
    document.getElementById('clientEquipmentEmpty').hidden = !empty;
}

function collectClientEquipments() {
    return Array.from(document.querySelectorAll('#clientEquipmentList .client-equipment-row')).map(row => ({
        type: row.querySelector('.client-equipment-type').value,
        model: row.querySelector('.client-equipment-model').value.trim(),
        //Material do catálogo escolhido na lista (entra na lista de materiais do projeto)
        material: row.querySelector('.client-equipment-model').value.trim() === row.querySelector('.client-equipment-model').dataset.material
            ? row.querySelector('.client-equipment-model').dataset.material : undefined,
        serial: row.querySelector('.client-equipment-serial').value.trim(),
        mac: row.querySelector('.client-equipment-mac').value.trim(),
        price: Math.max(0, parseFloat(row.querySelector('.client-equipment-price').value) || 0) || undefined,
    })).filter(e => e.model || e.serial || e.mac);
}

function openClientModal(clientInfo, presetKind) {
    editingClient = clientInfo || null;
    closeClientDcPicker();
    const data = normalizeClientData(clientInfo?.client || (presetKind ? { kind: presetKind } : {}));
    const b2b = data.b2b || {};
    const noun = data.kind === 'predial' ? 'predial' : 'cliente';
    document.getElementById('clientModalTitle').textContent = clientInfo ? `Editar ${noun}` : `Novo ${noun}`;
    document.getElementById('clientFormError').hidden = true;
    renderClientStatusButtons(data.status || DEFAULT_CLIENT_STATUS);
    setClientKind(data.kind);
    const fields = {
        clientName: clientInfo?.name || '',
        clientCode: data.code || '',
        clientDocument: data.document || '',
        clientPhone: data.phone || '',
        clientPlan: data.plan || '',
        clientAddress: data.address || '',
        clientDropOverride: data.dropOverride || '',
        clientNotes: data.notes || '',
        clientB2BService: b2b.service || B2B_SERVICES[0],
        clientB2BBandwidth: b2b.bandwidth || '',
        clientB2BSla: b2b.sla || '',
        clientB2BVlan: b2b.vlan || '',
        clientB2BIp: splitIpBlock(b2b.ip, b2b.block).ip,
        clientB2BBlock: splitIpBlock(b2b.ip, b2b.block).block,
        clientB2BGateway: b2b.gateway || '',
        clientB2BIpv6: b2b.ipv6 || '',
        clientB2BContactName: b2b.contactName || '',
        clientB2BContactPhone: b2b.contactPhone || '',
        clientPredialUnits: data.predial.units || '',
        clientPredialFloors: data.predial.floors || '',
        clientPredialManager: data.predial.manager || '',
        clientPredialManagerPhone: data.predial.managerPhone || '',
    };
    Object.entries(fields).forEach(([id, value]) => { document.getElementById(id).value = value; });
    const mapLabel = getClientMapLabel(data);
    document.getElementById('clientShowLabel').checked = mapLabel.show;
    document.getElementById('clientLabelColor').value = mapLabel.color;
    document.getElementById('clientLabelColor').disabled = !mapLabel.show;
    document.getElementById('clientEquipmentList').innerHTML = '';
    //Cliente novo: residencial/predial começa com uma ONU; B2B escolhe na lista Data Center
    const equipments = data.equipments.length ? data.equipments : (clientInfo || data.kind === 'b2b' ? [] : [{ type: 'ONU/ONT' }]);
    equipments.forEach(addClientEquipmentRow);
    updateClientEquipmentEmptyState();
    populateClientCtoSelect(clientInfo ? (data.cableName ? CLIENT_CABLE_PREFIX + data.cableName : (data.ctoUid || '')) : 'auto');
    populateClientPortSelect(data.cableName ? data.cableFiber : data.ctoPort);
    updateClientDropSummary();
    document.getElementById('deleteClientButton').hidden = !clientInfo;
    document.getElementById('moveClientButton').hidden = !clientInfo;
    document.getElementById('saveClientButton').textContent = clientInfo ? 'Salvar' : 'Posicionar no mapa';
    if (AppSession.isViewer) document.getElementById('clientModalTitle').textContent = 'Cliente';
    lockFormsForViewer('clientModal');
    document.getElementById('clientModal').style.display = 'flex';
    if (!AppSession.isViewer) setTimeout(() => document.getElementById('clientName').focus(), 40);
}

function closeClientModal() {
    closeClientDcPicker();
    document.getElementById('clientModal').style.display = 'none';
    editingClient = null;
}

function collectClientForm() {
    const value = (id) => document.getElementById(id).value.trim();
    const ctoUid = value('clientCto');
    const kind = getSelectedClientKind();
    return {
        name: value('clientName'),
        client: {
            kind,
            status: getSelectedClientStatus(),
            code: value('clientCode'),
            document: value('clientDocument'),
            phone: value('clientPhone'),
            plan: value('clientPlan'),
            address: value('clientAddress'),
            addressAuto: !!editingClient?.client?.addressAuto && value('clientAddress') === editingClient.client.address,
            ctoUid: ctoUid && !ctoUid.startsWith(CLIENT_CABLE_PREFIX) ? ctoUid : null,
            ctoPort: ctoUid && ctoUid !== 'auto' && !ctoUid.startsWith(CLIENT_CABLE_PREFIX) ? Number(value('clientPort')) || null : null,
            cableName: kind === 'b2b' && ctoUid.startsWith(CLIENT_CABLE_PREFIX) ? ctoUid.slice(CLIENT_CABLE_PREFIX.length) : null,
            cableFiber: kind === 'b2b' && ctoUid.startsWith(CLIENT_CABLE_PREFIX) ? Number(value('clientPort')) || null : null,
            dropOverride: Number(value('clientDropOverride')) > 0 ? Number(value('clientDropOverride')) : null,
            equipments: collectClientEquipments(),
            predial: kind === 'predial' ? {
                units: Number(value('clientPredialUnits')) > 0 ? Number(value('clientPredialUnits')) : null,
                floors: Number(value('clientPredialFloors')) > 0 ? Number(value('clientPredialFloors')) : null,
                manager: value('clientPredialManager'),
                managerPhone: value('clientPredialManagerPhone'),
            } : null,
            b2b: kind === 'b2b' ? {
                service: value('clientB2BService'),
                bandwidth: value('clientB2BBandwidth'),
                sla: value('clientB2BSla'),
                vlan: value('clientB2BVlan'),
                ip: value('clientB2BIp'),
                block: normalizeIpBlock(value('clientB2BBlock')),
                gateway: value('clientB2BGateway'),
                ipv6: value('clientB2BIpv6'),
                contactName: value('clientB2BContactName'),
                contactPhone: value('clientB2BContactPhone'),
            } : {},
            showLabel: document.getElementById('clientShowLabel').checked,
            labelColor: document.getElementById('clientLabelColor').value,
            notes: value('clientNotes')
        }
    };
}

function showClientFormError(message) {
    const el = document.getElementById('clientFormError');
    el.textContent = message;
    el.hidden = false;
    //A mensagem fica no fim da janela: rola até ela e avisa também com um toast
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Não foi possível continuar', message);
}

function saveClient(event) {
    event.preventDefault();
    let { name, client } = collectClientForm();
    //Sem nome: gera um automático (ex.: "Cliente 12") para não travar o posicionamento
    if (!name) {
        const base = client.kind === 'predial' ? 'Predial' : client.kind === 'b2b' ? 'Cliente B2B' : 'Cliente';
        name = `${base} ${markers.filter(m => m.type === 'CLIENTE').length + 1}`;
    }
    if (client.kind === 'predial') client.dropOverride = null;
    if (client.cableName && !client.cableFiber) {
        return showClientFormError('Esse cabo não tem fibra livre. Escolha outro cabo ou uma CTO.');
    }
    if (client.ctoUid && client.ctoUid !== 'auto' && !client.ctoPort) {
        return showClientFormError('Essa CTO não tem porta livre. Escolha outra CTO ou "Sem CTO".');
    }
    if (client.b2b?.ip && !/^[0-9a-f.:]+$/i.test(client.b2b.ip)) {
        return showClientFormError('IP inválido. Use o formato 200.160.10.8.');
    }
    if (client.b2b?.block && !/^(\/\d{1,3}|\d{1,3}(\.\d{1,3}){3})$/.test(client.b2b.block)) {
        return showClientFormError('Bloco inválido. Use /29 ou a máscara 255.255.255.248.');
    }
    if (editingClient) {
        const previous = editingClient.client || {};
        editingClient.name = name;
        editingClient.description = client.notes;
        //Mantém o traçado do drop se a CTO não mudou
        const keepRoute = previous.ctoUid === client.ctoUid && previous.cableName === client.cableName;
        editingClient.client = {
            ...client,
            dropPath: keepRoute ? previous.dropPath : null,
            dropRoute: keepRoute ? previous.dropRoute : null,
            dropKey: keepRoute ? previous.dropKey : null,
            dropHidden: previous.dropHidden,
        };
        updateMarkerAppearance(editingClient);
        refreshBomAfterProjectChange();
        closeClientModal();
        return;
    }
    //Criação: o cliente é posicionado com um clique no mapa
    selectedMarkerData = {
        ...selectedMarkerData,
        type: 'CLIENTE',
        name,
        color: getClientStatus(client.status).color,
        labelColor: '#000000',
        size: DEFAULT_MARKER_SIZE,
        description: client.notes,
        client
    };
    closeClientModal();
    startPlacingMarker();
}

function deleteClient() {
    const clientInfo = editingClient;
    if (!clientInfo) return;
    showConfirm('Excluir cliente', `Excluir o cliente "${clientInfo.name}"?`, () => {
        if (focusedMapMarkerInfo === clientInfo) clearMapMarkerHighlight();
        clientInfo.marker.setMap(null);
        clientInfo.listItem.remove();
        markers = markers.filter(m => m !== clientInfo);
        closeClientModal();
        refreshBomAfterProjectChange();
    });
}

//Arrasta o cliente no mapa; ao soltar, o drop é refeito e a janela reabre
function moveClient() {
    const clientInfo = editingClient;
    if (!clientInfo) return;
    closeClientModal();
    clientInfo.marker.setDraggable(true);
    const dragListener = clientInfo.marker.addListener('drag', () => {
        const path = clientInfo.dropLine?.getPath();
        if (path?.getLength()) path.setAt(path.getLength() - 1, clientInfo.marker.getPosition());
    });
    google.maps.event.addListenerOnce(clientInfo.marker, 'dragend', () => {
        google.maps.event.removeListener(dragListener);
        clientInfo.marker.setDraggable(false);
        clientInfo.position = clientInfo.marker.getPosition();
        fillClientAddressFromMap(clientInfo); //Atualiza só se o endereço foi preenchido automaticamente
        refreshClientDrops();
        refreshBomAfterProjectChange();
        openClientModal(clientInfo);
    });
    showToast('Mover cliente', 'Arraste o marcador do cliente até a nova posição.', 'progress');
}

// ---------------------------------------------------------------
// Edição do traçado do drop no mapa
// ---------------------------------------------------------------

function startClientDropEdit() {
    const clientInfo = editingClient;
    const cto = findMarkerByUid(clientInfo?.client?.ctoUid);
    if (!clientInfo?.dropLine || !cto) return;
    closeClientModal();
    const line = clientInfo.dropLine;
    dropEditSession = { clientInfo, cto, original: line.getPath().getArray().slice() };
    line.setOptions({
        editable: true,
        clickable: true,
        strokeOpacity: 0.95,
        strokeWeight: 3,
        strokeColor: getClientStatus(clientInfo.client.status).color,
        icons: [],
        zIndex: 60,
    });
    document.getElementById('dropEditBox').classList.remove('hidden');
    updateDropEditReadout();
    dropEditSession.listeners = ['set_at', 'insert_at', 'remove_at'].map(evt => google.maps.event.addListener(line.getPath(), evt, updateDropEditReadout));
    focusMapToMarker(clientInfo);
}

function updateDropEditReadout() {
    if (!dropEditSession) return;
    const length = google.maps.geometry.spherical.computeLength(dropEditSession.clientInfo.dropLine.getPath());
    document.getElementById('dropEditLength').textContent = `${Math.ceil(length)} m`;
}

function endClientDropEdit(mode) {
    if (!dropEditSession) return false;
    const { clientInfo, cto, original, listeners } = dropEditSession;
    listeners?.forEach(l => google.maps.event.removeListener(l));
    const line = clientInfo.dropLine;
    const data = clientInfo.client;
    if (mode === 'save') {
        const path = line.getPath().getArray().slice();
        path[0] = cto.marker.getPosition();
        path[path.length - 1] = clientInfo.marker.getPosition();
        data.dropPath = path.map(p => ({ lat: p.lat(), lng: p.lng() }));
        data.dropRoute = 'manual';
        data.dropKey = getDropKey(cto, clientInfo);
    } else if (mode === 'auto') {
        data.dropRoute = null;
        data.dropKey = null;
    } else {
        line.setPath(original);
    }
    line.setOptions({ editable: false, clickable: false, zIndex: 5 });
    dropEditSession = null;
    document.getElementById('dropEditBox').classList.add('hidden');
    refreshClientDrops({ onlyCto: cto });
    refreshBomAfterProjectChange();
    openClientModal(clientInfo);
    return true;
}

function cancelClientDropEdit() {
    return endClientDropEdit('cancel');
}

function recalculateClientDrop() {
    const clientInfo = editingClient;
    if (!clientInfo) return;
    clientInfo.client.dropRoute = null;
    clientInfo.client.dropKey = null;
    refreshClientDrops({ onlyCto: findMarkerByUid(clientInfo.client.ctoUid) });
    refreshBomAfterProjectChange();
    updateClientDropSummary();
    showToast('Drop recalculado', DROP_ROUTE_LABELS[clientInfo.client.dropRoute] ? `Traçado ${DROP_ROUTE_LABELS[clientInfo.client.dropRoute]}.` : 'Traçado atualizado.');
}

function setupClientModal() {
    document.getElementById('clientForm').addEventListener('submit', saveClient);
    document.getElementById('closeClientModal').addEventListener('click', closeClientModal);
    document.getElementById('deleteClientButton').addEventListener('click', deleteClient);
    document.getElementById('moveClientButton').addEventListener('click', moveClient);
    document.getElementById('clientCto').addEventListener('change', () => {
        populateClientPortSelect(editingClient?.client?.ctoPort);
        updateClientDropSummary();
    });
    document.getElementById('clientDropOverride').addEventListener('input', updateClientDropSummary);
    document.querySelectorAll('#clientKindGroup button').forEach(button => {
        button.addEventListener('click', () => setClientKind(button.dataset.kind));
    });
    document.getElementById('clientShowLabel').addEventListener('change', (e) => {
        document.getElementById('clientLabelColor').disabled = !e.target.checked;
    });
    document.getElementById('clientB2BService').innerHTML = B2B_SERVICES.map(s => `<option>${s}</option>`).join('');
    document.getElementById('addClientEquipmentButton').addEventListener('click', () => {
        //B2B: escolhe o equipamento na lista de materiais Data Center do catálogo
        if (getSelectedClientKind() === 'b2b') {
            openClientDcPicker();
            return;
        }
        const row = addClientEquipmentRow({ type: 'ONU/ONT' });
        row.querySelector('.client-equipment-model').focus();
    });
    document.getElementById('clientDcSearch').addEventListener('input', renderClientDcList);
    document.getElementById('clientDcShowAll').addEventListener('change', renderClientDcList);
    document.getElementById('clientDcManual').addEventListener('click', () => {
        closeClientDcPicker();
        addClientEquipmentRow({ type: 'EDD' }).querySelector('.client-equipment-model').focus();
    });
    document.getElementById('clientDcList').addEventListener('click', (e) => {
        const item = e.target.closest('[data-dc-material]');
        if (!item) return;
        const name = item.dataset.dcMaterial;
        addClientEquipmentRow({ type: guessEquipmentType(name), model: name, material: name });
        closeClientDcPicker();
    });
    document.getElementById('editClientDropButton').addEventListener('click', startClientDropEdit);
    document.getElementById('recalculateClientDropButton').addEventListener('click', recalculateClientDrop);
    document.getElementById('dropEditSaveButton').addEventListener('click', () => endClientDropEdit('save'));
    document.getElementById('dropEditCancelButton').addEventListener('click', () => endClientDropEdit('cancel'));
    document.getElementById('dropEditAutoButton').addEventListener('click', () => endClientDropEdit('auto'));
    document.getElementById('closeDropEditBox').addEventListener('click', () => endClientDropEdit('cancel'));
}

setupClientModal();
