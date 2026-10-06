// Plano do POP: OLT (portas PON por placa), DGO (cada porta com lado do cordão e lado da fusão) e switch
// entram como cartões no mesmo editor do plano de fusão das caixas, ao lado dos cabos que saem do POP.
// Ligações: PON → DGO (cordão) → fibra do cabo (fusão). A rota e o orçamento óptico encontram a OLT
// por esse caminho, e cada PON mostra até onde chega. Depende de js/fusion.js e js/pop-equipment.js.

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('fxEditPopEquipment')?.addEventListener('click', () => {
        if (activeMarkerForFusion?.type !== 'POP') return;
        //Cadastro parte do que está no plano (inclusive cartões removidos ainda sem salvar)
        activeMarkerForFusion.popEquipment = popEquipmentFromCards();
        openPopEquipmentModal(activeMarkerForFusion);
    });
});

function equipmentKey(kind, name) {
    return `${kind}:${String(name || '').trim().toLowerCase()}`;
}

//Cartão de equipamento. config = item de popEquipment (OLT: { name, model, cards:[{slot, model, pons}] },
//DGO: { name, ports, connector }, switch: { name, model, ports, uplinks })
function buildFusionEquipmentCard(kind, config, existingId = null) {
    const card = document.createElement('div');
    const id = existingId || `eq-${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    card.id = id;
    card.className = `equipment-element fx-card fx-equipment fx-equipment--${kind}`;
    card.dataset.equipKind = kind;
    card.dataset.equipName = config.name || '';
    card.dataset.config = JSON.stringify(config);
    card.dataset.lane = 'left';
    const kindLabel = { olt: 'OLT', dgo: 'DGO', switch: 'Switch' }[kind];
    const header = document.createElement('div');
    header.className = 'fx-card__head';
    header.innerHTML = `<span class="fx-card__kind">${kindLabel}</span><span class="fx-card__title">${escapeHtml(config.name || kindLabel)}</span>`;
    const meta = document.createElement('div');
    meta.className = 'fx-card__meta';
    const info = kind === 'olt' ? `${config.model || ''} · ${(config.cards || []).length} placa(s)`
        : kind === 'dgo' ? `${config.ports || 0} portas · ${config.connector || ''}` : `${config.model || ''} · ${config.ports || 0} portas`;
    meta.innerHTML = `<span class="fx-pill">${escapeHtml(info.replace(/^ · /, ''))}</span>`;
    header.appendChild(buildCardTools('splitter'));
    header.appendChild(meta);
    card.appendChild(header);
    const ports = document.createElement('div');
    ports.className = 'fx-ports fx-equipment__ports';
    const row = (portId, label, chip, extra = {}) => {
        const r = buildPortRow({ id: portId, className: 'equip-port-row', label, chip });
        Object.entries(extra).forEach(([k, v]) => { r.dataset[k] = String(v); });
        ports.appendChild(r);
    };
    if (kind === 'olt') {
        (config.cards || []).forEach(c => {
            const group = document.createElement('div');
            group.className = 'group-header fx-tube';
            group.innerHTML = `<span>Placa ${escapeHtml(c.slot || '')}${c.model ? ` · ${escapeHtml(c.model)}` : ''}</span>`;
            ports.appendChild(group);
            for (let n = 1; n <= (c.pons || 0); n++) row(`${id}-s${String(c.slot).replace(/[^\w]/g, '')}-pon-${n}`, `PON ${n}`, n, { slot: c.slot, pon: n, side: 'pon' });
        });
    } else if (kind === 'dgo') {
        for (let n = 1; n <= (config.ports || 0); n++) {
            row(`${id}-f-${n}`, `P${n} · cordão`, n, { port: n, side: 'front' });
            row(`${id}-b-${n}`, `P${n} · fusão`, n, { port: n, side: 'back' });
        }
    } else {
        for (let n = 1; n <= (config.ports || 0); n++) row(`${id}-p-${n}`, `Porta ${n}`, n, { port: n, side: 'port' });
        for (let n = 1; n <= (config.uplinks || 0); n++) row(`${id}-u-${n}`, `Uplink ${n}`, `U${n}`, { port: n, side: 'uplink' });
    }
    card.appendChild(ports);
    return card;
}

function rebuildFusionEquipmentCard(old) {
    let config = {};
    try { config = JSON.parse(old.dataset.config || '{}'); } catch (e) { /* cartão antigo */ }
    const card = buildFusionEquipmentCard(old.dataset.equipKind, config, old.id);
    if (old.dataset.lane) card.dataset.lane = old.dataset.lane;
    return card;
}

function describeEquipmentPort(port, short) {
    const card = port.closest('.equipment-element');
    const name = card?.dataset.equipName || 'Equipamento';
    const d = port.dataset;
    if (d.side === 'pon') return short ? `${name} · S${d.slot} PON ${d.pon}` : `${name}, placa ${d.slot}, PON ${d.pon}`;
    if (d.side === 'front') return short ? `${name} · P${d.port} cordão` : `${name}, porta ${d.port} (cordão)`;
    if (d.side === 'back') return short ? `${name} · P${d.port}` : `${name}, porta ${d.port} (fusão)`;
    if (d.side === 'uplink') return `${name} · Uplink ${d.port}`;
    return `${name} · Porta ${d.port}`;
}

//Cartões dos equipamentos cadastrados no POP que ainda não estão no plano aberto
function syncPopEquipmentCards({ prune = false } = {}) {
    if (activeMarkerForFusion?.type !== 'POP') return 0;
    const stage = getFusionStage();
    const eq = normalizePopEquipment(activeMarkerForFusion.popEquipment);
    const present = new Map(Array.from(stage.querySelectorAll('.equipment-element')).map(c => [equipmentKey(c.dataset.equipKind, c.dataset.equipName), c]));
    let added = 0;
    const ensure = (kind, config) => {
        const key = equipmentKey(kind, config.name);
        const existing = present.get(key);
        if (existing) {
            //Mudou a quantidade de placas/portas: reconstrói mantendo os ids (as ligações continuam)
            if (existing.dataset.config !== JSON.stringify(config)) {
                const card = buildFusionEquipmentCard(kind, config, existing.id);
                card.dataset.lane = existing.dataset.lane || 'left';
                existing.replaceWith(card);
                wireFusionCard(card);
            }
            return;
        }
        const card = buildFusionEquipmentCard(kind, config);
        stage.appendChild(card);
        wireFusionCard(card);
        added++;
    };
    eq.olts.forEach(o => ensure('olt', o));
    eq.dgos.forEach(d => ensure('dgo', d));
    eq.switches.forEach(s => ensure('switch', s));
    if (prune) {
        const keep = new Set([...eq.olts.map(o => equipmentKey('olt', o.name)), ...eq.dgos.map(d => equipmentKey('dgo', d.name)), ...eq.switches.map(s => equipmentKey('switch', s.name))]);
        stage.querySelectorAll('.equipment-element').forEach(card => {
            if (keep.has(equipmentKey(card.dataset.equipKind, card.dataset.equipName))) return;
            const ids = new Set(Array.from(card.querySelectorAll('.connectable')).map(p => p.id));
            getFusionLines().filter(l => ids.has(l.dataset.startId) || ids.has(l.dataset.endId)).forEach(l => l.remove());
            card.remove();
        });
    }
    return added;
}

//Equipamentos do POP a partir dos cartões do plano (ao salvar o plano)
function popEquipmentFromCards(root = getFusionStage()) {
    const eq = emptyPopEquipment();
    root.querySelectorAll('.equipment-element').forEach(card => {
        let config = {};
        try { config = JSON.parse(card.dataset.config || '{}'); } catch (e) { return; }
        if (card.dataset.equipKind === 'olt') eq.olts.push(config);
        if (card.dataset.equipKind === 'dgo') eq.dgos.push(config);
        if (card.dataset.equipKind === 'switch') eq.switches.push(config);
    });
    return normalizePopEquipment(eq);
}

//Até onde cada PON chega (CTOs e clientes), mostrado na própria porta da OLT
function decoratePonReach() {
    if (activeMarkerForFusion?.type !== 'POP' || typeof buildFiberGraph !== 'function') return;
    const ports = Array.from(getFusionStage().querySelectorAll('.equip-port-row[data-side="pon"].is-connected'));
    if (!ports.length) return;
    const saved = activeMarkerForFusion.fusionPlan;
    activeMarkerForFusion.fusionPlan = serializeFusionPlan(); //Vale o que está na tela, mesmo sem salvar
    try {
        const graph = buildFiberGraph();
        const uid = ensureMarkerUid(activeMarkerForFusion);
        ports.forEach(port => {
            const trace = traceFromNode(graph, `${uid}|${port.id}`);
            const clients = trace.ctos.reduce((n, c) => n + c.clients, 0);
            const dest = port.querySelector('.fx-port__dest');
            if (!dest || !trace.ctos.length) return;
            dest.textContent += ` · ${trace.ctos.length} CTO${trace.ctos.length > 1 ? 's' : ''} · ${clients} cli.`;
            dest.title = `Esta PON atende: ${trace.ctos.map(c => `${c.box.name} (${c.clients})`).join(', ')}`;
        });
    } catch (e) {
        console.error('Plano do POP: não foi possível calcular o alcance das PONs', e);
    } finally {
        activeMarkerForFusion.fusionPlan = saved;
    }
}
