// Leitura central dos planos de fusão salvos.
// O plano é gravado como HTML dos cartões (elements) + SVG das linhas (svg). Este arquivo é o único
// lugar que interpreta esse formato: o resto do sistema recebe só os dados (cabos, fibras ligadas,
// splitters, fusões). Trocar o formato gravado no futuro fica restrito a readFusionPlan.
// Depende de js/supabase-client.js (parseStoredHtml/parseStoredSvg), js/fusion.js (getFiberNumberFromId)
// e script.js (getSplitterLabelText) — usados só quando as funções são chamadas.

const fusionPlanCache = new WeakMap(); //markerInfo → { plan, data }

//Dados do plano de fusão de uma caixa (ou null se não houver plano legível). O resultado fica em cache
//enquanto o texto do plano não mudar; não altere o objeto devolvido.
//  {
//    empty,                              //plano salvo sem nenhum cartão
//    trayQuantity,                       //bandejas (CEO)
//    fromLegacyCanvas,                   //plano muito antigo (campo canvas em vez de elements)
//    lines: [{ id, startId, endId }],    //fusões
//    connectedIds: Set,                  //portas/fibras com fusão
//    cables: [{ name, fibers: [{ id, number, connected }], derivationKit }],
//    equipment: [{ id, kind: 'olt'|'dgo'|'switch', name, ports: [{ id, side, slot, pon, port, connected }] }],  //POP
//    splitters: [{ id, label, status, atendimento, outputs, inputIds, outputIds, olt: { olt, placa, pon } }],
//  }
function readFusionPlan(markerInfo) {
    const plan = markerInfo?.fusionPlan || '';
    if (!plan) return null;
    const cached = fusionPlanCache.get(markerInfo);
    if (cached && cached.plan === plan) return cached.data;
    let data = null;
    try {
        data = parseFusionPlanText(plan);
    } catch (e) {
        console.error(`Plano de fusão ilegível na caixa "${markerInfo.name}":`, e);
        data = null;
    }
    fusionPlanCache.set(markerInfo, { plan, data });
    return data;
}

function parseFusionPlanText(planText) {
    const planData = JSON.parse(planText);
    const html = planData.elements || planData.canvas || '';
    const root = parseStoredHtml(html);
    const lines = [];
    if (planData.svg) {
        parseStoredSvg(planData.svg).querySelectorAll('.fusion-line').forEach(line => {
            lines.push({ id: line.id || '', startId: line.dataset.startId || '', endId: line.dataset.endId || '' });
        });
    }
    const connectedIds = new Set();
    lines.forEach(l => { if (l.startId) connectedIds.add(l.startId); if (l.endId) connectedIds.add(l.endId); });

    const cables = Array.from(root.querySelectorAll('.cable-element')).map(card => {
        const kit = card.querySelector('.derivation-kit-checkbox');
        return {
            name: card.dataset.cableName || '',
            uid: card.dataset.cableUid || '',
            fibers: Array.from(card.querySelectorAll('.fiber-row')).map(row => ({
                id: row.id,
                number: getFiberNumberFromId(row.id),
                connected: connectedIds.has(row.id),
            })),
            derivationKit: !!kit && (kit.dataset.checked === 'true' || kit.checked),
        };
    });

    const splitters = Array.from(root.querySelectorAll('.splitter-element')).map(card => ({
        id: card.id || '',
        label: getSplitterLabelText(card),
        status: card.dataset.status || '',
        atendimento: card.classList.contains('splitter-atendimento'),
        outputs: card.querySelectorAll('.splitter-outputs .splitter-port-row').length,
        inputIds: Array.from(card.querySelectorAll('.splitter-input .splitter-port-row')).map(r => r.id).filter(Boolean),
        outputIds: Array.from(card.querySelectorAll('.splitter-outputs .splitter-port-row')).map(r => r.id).filter(Boolean),
        olt: { olt: card.dataset.oltName || '', placa: card.dataset.placaNumber || '', pon: card.dataset.ponNumber || '' },
    }));

    const equipment = Array.from(root.querySelectorAll('.equipment-element')).map(card => ({
        id: card.id,
        kind: card.dataset.equipKind,
        name: card.dataset.equipName || '',
        ports: Array.from(card.querySelectorAll('.equip-port-row')).map(r => ({
            id: r.id, side: r.dataset.side, slot: r.dataset.slot || '', pon: r.dataset.pon || '', port: r.dataset.port || '',
            connected: connectedIds.has(r.id),
        })),
    }));

    return {
        empty: !html,
        equipment,
        trayQuantity: parseInt(planData.trayQuantity, 10) || 0,
        fromLegacyCanvas: !planData.elements && !!planData.canvas,
        lines,
        connectedIds,
        cables,
        splitters,
    };
}

// ---------------------------------------------------------------
// Cabo do plano de fusão → cabo do mapa. Vale o identificador (uid) gravado no cartão; planos antigos
// (só com o nome) usam o nome, e com nomes repetidos ficam com o cabo que chega na caixa.
// ---------------------------------------------------------------
function resolvePlanCable(planCable, box = null) {
    if (!planCable) return null;
    if (planCable.uid) {
        const byUid = savedCables.find(c => c.uid === planCable.uid);
        if (byUid) return byUid;
    }
    const same = savedCables.filter(c => c.name === planCable.name);
    if (same.length <= 1) return same[0] || null;
    return (box && same.find(c => isCableConnectedToMarker(c, box))) || same[0];
}

//Chave única do cabo no plano (para juntar a mesma fibra em caixas diferentes)
function planCableKey(planCable, box = null) {
    const cable = resolvePlanCable(planCable, box);
    return cable ? ensureItemUid(cable, 'cb', savedCables) : `nome:${planCable.name}`;
}

//Mesma chave do lado do cabo do mapa
function cableKeyOf(cable) {
    return savedCables.includes(cable) ? ensureItemUid(cable, 'cb', savedCables) : `nome:${cable?.name}`;
}

function planCableMatches(planCable, cable, box = null) {
    if (!planCable || !cable) return false;
    const resolved = resolvePlanCable(planCable, box);
    if (resolved) return resolved === cable;
    return !savedCables.includes(cable) && planCable.name === cable.name;
}

//Planos antigos: grava o uid do cabo nos cartões que só têm o nome
function backfillFusionPlanCableUids(boxes = markers) {
    boxes.forEach(box => {
        if (!box.fusionPlan) return;
        try {
            const planData = JSON.parse(box.fusionPlan);
            if (!planData.elements) return;
            const root = parseStoredHtml(planData.elements);
            let changed = false;
            root.querySelectorAll('.cable-element').forEach(card => {
                if (card.dataset.cableUid && savedCables.some(c => c.uid === card.dataset.cableUid)) return;
                const cable = resolvePlanCable({ name: card.dataset.cableName || '' }, box);
                if (!cable) return;
                card.dataset.cableUid = ensureItemUid(cable, 'cb', savedCables);
                changed = true;
            });
            if (!changed) return;
            planData.elements = root.innerHTML;
            box.fusionPlan = JSON.stringify(planData);
        } catch (e) {
            console.error(`Plano de fusão ilegível na caixa "${box.name}":`, e);
        }
    });
}
