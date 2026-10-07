// Dividir cabo num marcador: quando uma caixa (CEO, CTO, POP) ou uma reserva técnica fica no meio de um cabo, o cabo vira dois.
// Trecho A: ponta A original → marcador (nome novo "tipo-marcador"); trecho B: marcador → ponta B original
// (fica com o nome antigo). Os planos de fusão das caixas do trecho A passam a usar o nome novo.
// Depende de script.js, js/persistence.js (serializeCable/rebuildCable) e js/fusion-plan.js.

const CABLE_SPLIT_MAX_DISTANCE_M = 25; //Distância máxima do marcador até a linha do cabo
const CABLE_SPLIT_TYPES = ['CEO', 'CTO', 'POP', 'RESERVA'];

//Distância em metros (aproximação plana, suficiente para poucos metros)
function splitMetersXY(lat0) {
    const k = Math.PI / 180 * 6371000;
    return { kx: k * Math.cos(lat0 * Math.PI / 180), ky: k };
}

//Ponto da linha mais perto de "pos": segmento, posição no segmento (0..1) e distância
function projectOnCablePath(path, pos) {
    const lat0 = pos.lat();
    const { kx, ky } = splitMetersXY(lat0);
    const px = pos.lng() * kx, py = pos.lat() * ky;
    let best = null;
    for (let i = 0; i < path.length - 1; i++) {
        const ax = path[i].lng() * kx, ay = path[i].lat() * ky;
        const bx = path[i + 1].lng() * kx, by = path[i + 1].lat() * ky;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
        const dist = Math.hypot(ax + t * dx - px, ay + t * dy - py);
        if (!best || dist < best.dist) best = { index: i, t, dist, segLen: Math.sqrt(len2) };
    }
    return best;
}

function isCableEndAt(cable, markerInfo) {
    const uid = markerInfo.uid;
    if (uid && (cable.startAnchorUid === uid || cable.endAnchorUid === uid)) return true;
    const pos = markerInfo.marker.getPosition();
    const ends = [cable.path[0], cable.path[cable.path.length - 1]];
    return ends.some(e => projectOnCablePath([e, e], pos).dist < 1);
}

//Cabos que passam pelo marcador (sem ser ponta deles)
function getCablesPassingThroughMarker(markerInfo) {
    if (!markerInfo?.marker?.getPosition || !CABLE_SPLIT_TYPES.includes(markerInfo.type)) return [];
    const pos = markerInfo.marker.getPosition();
    return savedCables.filter(cable => {
        if (!cable.path || cable.path.length < 2 || cable.folderId === undefined) return false;
        if (isCableEndAt(cable, markerInfo)) return false;
        const p = projectOnCablePath(cable.path, pos);
        if (!p || p.dist > CABLE_SPLIT_MAX_DISTANCE_M) return false;
        //Bem em cima de uma das pontas não é "meio do cabo"
        const along = p.index + p.t;
        const tol = p.segLen ? 1 / p.segLen : 0; //~1 m
        return along > tol && along < cable.path.length - 1 - tol;
    });
}

function uniqueCableName(base) {
    let name = base;
    for (let i = 2; savedCables.some(c => c.name === name); i++) name = `${base} (${i})`;
    return name;
}

function getCableSplitNames(cable, markerInfo) {
    return { first: uniqueCableName(`${cable.type || 'FO'}-${markerInfo.name}`), second: cable.name };
}

//Renomeia o cabo só no plano de fusão desta caixa (as outras continuam com o nome antigo)
function renameCableInBoxPlan(box, oldName, newName, cable = null, newUid = null) {
    if (!box.fusionPlan) return false;
    try {
        const planData = JSON.parse(box.fusionPlan);
        if (!planData.elements) return false;
        const tempDiv = parseStoredHtml(planData.elements);
        const tempSvg = planData.svg ? parseStoredSvg(planData.svg) : null;
        if (!renameCableInPlanDom(tempDiv, tempSvg, oldName, newName, cable, box, newUid)) return false;
        planData.elements = tempDiv.innerHTML;
        if (tempSvg) planData.svg = tempSvg.innerHTML;
        box.fusionPlan = JSON.stringify(planData);
        if (typeof activeMarkerForFusion !== 'undefined' && activeMarkerForFusion === box) {
            renameCableInPlanDom(getFusionStage(), getFusionSvg(), oldName, newName, cable, box, newUid);
        }
        return true;
    } catch (e) {
        console.error(`Erro ao renomear o cabo no plano de fusão da ${box.name}:`, e);
        return false;
    }
}

//Caixas cujo plano de fusão tem o cabo e que ficam no trecho A (antes do marcador)
function getBoxesOnFirstPart(cable, splitAlong, splitMarker) {
    return markers.filter(box => {
        if (box === splitMarker || !box.fusionPlan) return false;
        const plan = readFusionPlan(box);
        if (!plan?.cables?.some(c => planCableMatches(c, cable, box))) return false;
        if (box.uid && box.uid === cable.startAnchorUid) return true;
        if (box.uid && box.uid === cable.endAnchorUid) return false;
        if (!box.marker?.getPosition) return false;
        const p = projectOnCablePath(cable.path, box.marker.getPosition());
        return p && p.index + p.t < splitAlong;
    });
}

function splitCableAtMarker(cable, markerInfo) {
    if (!requireEdit('dividir o cabo')) return null;
    const pos = markerInfo.marker.getPosition();
    const p = projectOnCablePath(cable.path, pos);
    if (!p) return null;
    const splitAlong = p.index + p.t;
    const names = getCableSplitNames(cable, markerInfo);
    const firstBoxes = getBoxesOnFirstPart(cable, splitAlong, markerInfo);
    const near = (a, b) => projectOnCablePath([a, a], b).dist < 0.5;

    //Trecho A: do começo até o marcador; trecho B: do marcador até o fim
    const firstPath = cable.path.slice(0, p.index + 1);
    if (near(firstPath[firstPath.length - 1], pos)) firstPath.pop();
    firstPath.push(pos);
    const rest = cable.path.slice(p.index + 1);
    if (rest.length && near(rest[0], pos)) rest.shift();
    const secondPath = [pos, ...rest];
    if (firstPath.length < 2 || secondPath.length < 2) return null;

    const markerUid = ensureMarkerUid(markerInfo);
    const base = serializeCable(cable);
    //Cada pedaço leva só a parte tubulada que cai nele
    const conduitParts = cable.conduit?.length && typeof splitCableConduit === 'function'
        ? splitCableConduit(cable, getMetersAlongPath(cable.path, pos).meters) : null;
    const toPlain = (path) => path.map(ll => ({ lat: ll.lat(), lng: ll.lng() }));
    const firstData = {
        ...base, uid: undefined, name: names.first, path: toPlain(firstPath),
        endAnchorUid: markerUid, endAnchorMarkerName: markerInfo.name, endAnchorMarkerFolderId: markerInfo.folderId,
        ...(conduitParts ? { conduit: conduitParts.first } : {}),
    };
    const secondData = {
        ...base, name: names.second, path: toPlain(secondPath),
        startAnchorUid: markerUid, startAnchorMarkerName: markerInfo.name, startAnchorMarkerFolderId: markerInfo.folderId,
        ...(conduitParts ? { conduit: conduitParts.second } : {}),
    };

    //Sai o cabo antigo, entram os dois trechos no mesmo lugar da barra lateral
    if (typeof isCableRouteOpen === 'function' && isCableRouteOpen()) closeCableRoute();
    const anchorRow = cable.item;
    cable.polyline?.setMap(null);
    savedCables = savedCables.filter(c => c !== cable);
    rebuildCable(firstData);
    const first = savedCables[savedCables.length - 1];
    rebuildCable(secondData);
    const second = savedCables[savedCables.length - 1];
    if (anchorRow?.parentNode) {
        anchorRow.parentNode.insertBefore(first.item, anchorRow);
        anchorRow.parentNode.insertBefore(second.item, anchorRow);
        anchorRow.remove();
    }
    ensureItemUid(first, 'cb', savedCables);
    ensureItemUid(second, 'cb', savedCables);

    //Planos de fusão das caixas do trecho A passam a usar o nome novo
    firstBoxes.forEach(box => renameCableInBoxPlan(box, names.second, names.first, second, first.uid));
    //Clientes B2B ligados no cabo: ficam no trecho mais perto deles
    markers.forEach(m => {
        if (m.type !== 'CLIENTE' || m.client?.cableName !== names.second || !m.marker?.getPosition) return;
        if (m.client.cableUid && m.client.cableUid !== second.uid) return; //Outro cabo com o mesmo nome
        const q = projectOnCablePath(cable.path, m.marker.getPosition());
        if (q && q.index + q.t < splitAlong) {
            m.client.cableName = names.first;
            m.client.cableUid = first.uid;
            if (m.client.linkedCable === names.second) m.client.linkedCable = names.first;
        }
    });

    updateSidebarCounts();
    refreshClientDrops({ recompute: true });
    refreshBomAfterProjectChange();
    return { first, second, renamedBoxes: firstBoxes.map(b => b.name) };
}

function confirmSplitCableAtMarker(cable, markerInfo) {
    if (!requireEdit('dividir o cabo')) return;
    const names = getCableSplitNames(cable, markerInfo);
    const p = projectOnCablePath(cable.path, markerInfo.marker.getPosition());
    const firstBoxes = getBoxesOnFirstPart(cable, p.index + p.t, markerInfo);
    const plans = firstBoxes.length ? ` O plano de fusão de ${firstBoxes.map(b => b.name).join(', ')} passa a usar "${names.first}".` : '';
    showConfirm('Dividir cabo', `O cabo "${cable.name}" vira dois em ${markerInfo.name}: "${names.first}" (ponta A até ${markerInfo.name}) e "${names.second}" (${markerInfo.name} até a ponta B).${plans} Depois é só abrir o plano de fusão de ${markerInfo.name} e ligar os dois cabos. Ctrl+Z desfaz.`, () => {
        const result = splitCableAtMarker(cable, markerInfo);
        if (!result) {
            showAlert('Não foi possível dividir', 'O marcador precisa estar sobre a linha do cabo, longe das pontas.');
            return;
        }
        showToast('Cabo dividido', `"${result.first.name}" e "${result.second.name}" agora chegam em ${markerInfo.name}.`);
    });
}
