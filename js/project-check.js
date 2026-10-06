// Verificação do projeto: procura problemas no projeto ativo (pontas soltas, caixas sem plano,
// fusões duplicadas, clientes sem porta, drops longos...) e lista no painel. Clicar num item leva
// até ele no mapa. Depende de script.js, js/fusion-plan.js e js/clients.js.

function getActiveProjectScope() {
    const projectId = getActiveProjectId();
    if (!projectId) return null;
    const folderIds = new Set(getAllDescendantFolderIds(projectId));
    return {
        projectId,
        markers: markers.filter(m => folderIds.has(m.folderId)),
        cables: savedCables.filter(c => folderIds.has(c.folderId)),
    };
}

function runProjectCheck(scope) {
    const issues = [];
    const add = (level, title, detail, target) => issues.push({ level, title, detail, target });
    const boxes = scope.markers.filter(m => m.type === 'CEO' || m.type === 'CTO');
    const cableNames = new Set(savedCables.map(c => c.name));

    //Nomes repetidos: o plano de fusão liga cartão e cabo pelo nome
    const byName = new Map();
    scope.cables.forEach(c => byName.set(c.name, [...(byName.get(c.name) || []), c]));
    byName.forEach((list, name) => {
        if (list.length > 1) add('erro', `Nome de cabo repetido: ${name}`, `${list.length} cabos com o mesmo nome. Os planos de fusão não sabem qual é qual.`, { kind: 'cable', info: list[0] });
    });
    const boxNames = new Map();
    boxes.forEach(b => boxNames.set(b.name, [...(boxNames.get(b.name) || []), b]));
    boxNames.forEach((list, name) => {
        if (list.length > 1) add('aviso', `Caixa com nome repetido: ${name}`, `${list.length} caixas com o mesmo nome.`, { kind: 'marker', info: list[0] });
    });

    //Cabos: pontas nas caixas
    scope.cables.forEach(cable => {
        const loose = [];
        if (!findMarkerByUid(cable.startAnchorUid)) loose.push('A');
        if (!findMarkerByUid(cable.endAnchorUid)) loose.push('B');
        if (loose.length) {
            add(cable.fromKmlImport ? 'aviso' : 'erro', `Cabo com ponta solta: ${cable.name}`,
                `Ponta ${loose.join(' e ')} não está numa CEO, CTO, reserva ou POP.`, { kind: 'cable', info: cable });
        }
    });

    //Caixas e planos de fusão
    boxes.forEach(box => {
        const connected = scope.cables.filter(c => c.startAnchorUid === box.uid || c.endAnchorUid === box.uid);
        const plan = readFusionPlan(box);
        if (!plan || plan.empty) {
            if (connected.length) add('aviso', `${box.type} sem plano de fusão: ${box.name}`, `${connected.length} cabo(s) chegam nesta caixa e não há fusões.`, { kind: 'marker', info: box });
            return;
        }
        const cardNames = new Set(plan.cables.map(c => c.name));
        connected.forEach(cable => {
            if (!cardNames.has(cable.name)) add('aviso', `Cabo fora do plano: ${cable.name}`, `Chega em ${box.name}, mas não foi adicionado ao plano de fusão da caixa.`, { kind: 'marker', info: box });
        });
        plan.cables.forEach(card => {
            if (!cableNames.has(card.name)) add('erro', `Cabo inexistente no plano de ${box.name}`, `O plano tem o cabo "${card.name}", que não existe mais (renomeado ou excluído). Remova o cartão e adicione o cabo certo.`, { kind: 'marker', info: box });
        });
        const ports = new Set();
        plan.cables.forEach(c => c.fibers.forEach(f => ports.add(f.id)));
        plan.splitters.forEach(sp => [...sp.inputIds, ...sp.outputIds].forEach(id => ports.add(id)));
        const uses = new Map();
        let orphans = 0;
        plan.lines.forEach(l => [l.startId, l.endId].forEach(id => {
            if (!id) return;
            if (!ports.has(id)) orphans++;
            uses.set(id, (uses.get(id) || 0) + 1);
        }));
        const doubled = Array.from(uses.entries()).filter(([id, n]) => n > 1 && ports.has(id)).length;
        if (doubled) add('erro', `Fusão duplicada em ${box.name}`, `${doubled} fibra(s) ou porta(s) com mais de uma ligação.`, { kind: 'marker', info: box });
        if (orphans) add('erro', `Fusão quebrada em ${box.name}`, `${orphans} ponta(s) de fusão ligadas a uma fibra ou porta que não existe mais. Abra o plano e refaça.`, { kind: 'marker', info: box });
        plan.splitters.forEach(sp => {
            if (sp.inputIds.length && !sp.inputIds.some(id => plan.connectedIds.has(id))) add('aviso', `Splitter sem entrada em ${box.name}`, `O splitter ${sp.label || ''} não tem fibra ligada na entrada.`, { kind: 'marker', info: box });
        });
    });

    //Clientes
    const maxDrop = Number(lancamentoConfig?.dropMaxLength) || 300;
    const portsTaken = new Map();
    scope.markers.filter(m => m.type === 'CLIENTE' && m.client?.status !== 'cancelado').forEach(client => {
        const data = client.client || {};
        if (isPredialClient(client)) return;
        const cto = findMarkerByUid(data.ctoUid);
        const viaCable = data.cableName || (typeof findClientAnchoredCable === 'function' && findClientAnchoredCable(client));
        if (!cto && !viaCable) {
            add('aviso', `Cliente sem CTO: ${client.name}`, 'Não está ligado a nenhuma CTO nem cabo.', { kind: 'marker', info: client });
            return;
        }
        if (cto) {
            if (!data.ctoPort) add('aviso', `Cliente sem porta: ${client.name}`, `Ligado à ${cto.name}, sem porta definida.`, { kind: 'marker', info: client });
            else {
                const capacity = getCtoPortCapacity(cto);
                if (capacity && Number(data.ctoPort) > capacity) add('erro', `Porta inexistente: ${client.name}`, `Porta ${data.ctoPort} na ${cto.name}, que tem ${capacity} portas.`, { kind: 'marker', info: client });
                const key = `${cto.uid}#${data.ctoPort}`;
                if (portsTaken.has(key)) add('erro', `Porta usada duas vezes na ${cto.name}`, `Porta ${data.ctoPort}: ${portsTaken.get(key).name} e ${client.name}.`, { kind: 'marker', info: client });
                else portsTaken.set(key, client);
            }
        }
        const drop = getClientDropInfo(client);
        if (drop && drop.length > maxDrop) add('aviso', `Drop longo: ${client.name}`, `${drop.length} m (limite configurado: ${maxDrop} m).`, { kind: 'marker', info: client });
    });
    //Orçamento óptico
    const optical = getProjectOpticalBudget(scope);
    if (optical.ctos.length && !optical.hasSource) {
        add('aviso', 'Orçamento óptico sem OLT', 'Nenhum splitter do caminho está vinculado a uma OLT/PON. Use "Vincular" no splitter que recebe o sinal da OLT.', null);
    }
    optical.rows.forEach(row => {
        if (row.dbm == null) {
            if (optical.hasSource) add('aviso', `Sem sinal calculado: ${row.cto.name}`, 'Não há caminho de fusões até um splitter vinculado à OLT.', { kind: 'marker', info: row.cto });
            return;
        }
        if (row.status === 'erro') add('erro', `Potência abaixo do mínimo: ${row.cto.name}`, `${formatDbm(row.dbm)} na porta (mínimo da ONU: ${formatDbm(optical.cfg.onuSensitivity)}).`, { kind: 'marker', info: row.cto });
        else if (row.status === 'aviso') add('aviso', `Potência no limite: ${row.cto.name}`, `${formatDbm(row.dbm)} na porta, dentro da margem de ${optical.cfg.margin} dB.`, { kind: 'marker', info: row.cto });
        row.clients.filter(c => c.status === 'erro').forEach(c => add('erro', `Cliente sem potência suficiente: ${c.client.name}`, `${formatDbm(c.dbm)} estimado na ONU (drop incluído).`, { kind: 'marker', info: c.client }));
    });
    return issues;
}

//Potência em cada CTO do projeto (pior porta de atendimento)
function getProjectOpticalBudget(scope) {
    const cfg = lancamentoConfig?.optical || DEFAULT_OPTICAL_CONFIG;
    const ctos = scope.markers.filter(m => m.type === 'CTO' && readFusionPlan(m)?.splitters.some(sp => sp.atendimento));
    if (!ctos.length) return { cfg, ctos, rows: [], hasSource: false };
    const byCto = getOpticalBudgetByCto(ctos);
    const hasSource = computeOpticalPower(cfg).sources.length > 0;
    const rows = ctos.map(cto => {
        const e = byCto.get(cto);
        return { cto, dbm: e ? e.worstPort : null, status: e ? e.status : 'sem', clients: e ? e.clients : [] };
    }).sort((a, b) => (a.dbm ?? -999) - (b.dbm ?? -999));
    return { cfg, ctos, rows, hasSource };
}

function renderOpticalTable(scope) {
    const optical = getProjectOpticalBudget(scope);
    if (!optical.rows.length) return '';
    return `<h4 class="check-section">Potência nas CTOs <small>OLT ${formatDbm(optical.cfg.oltPower)} · ONU mín. ${formatDbm(optical.cfg.onuSensitivity)}</small></h4>
        <ul class="check-power">${optical.rows.map(row => `
            <li><button type="button" data-power-cto="${escapeHtml(row.cto.uid || '')}">
                <span>${escapeHtml(row.cto.name)}</span><b class="is-${row.status}">${row.dbm == null ? 'sem OLT' : formatDbm(row.dbm)}</b>
            </button></li>`).join('')}</ul>`;
}

function focusProjectCheckTarget(target) {
    if (!target?.info) return;
    if (target.kind === 'cable') {
        selectSidebarCable(target.info);
        focusMapToCable(target.info);
    } else {
        selectSidebarMarker(target.info);
        focusMapToMarker(target.info);
    }
}

let projectCheckIssues = [];

function renderProjectCheck() {
    const scope = getActiveProjectScope();
    const body = document.getElementById('projectCheckBody');
    const subtitle = document.getElementById('projectCheckSubtitle');
    if (!scope) {
        subtitle.textContent = '';
        body.innerHTML = '<p class="route-note">Abra ou selecione um projeto para verificar.</p>';
        return;
    }
    projectCheckIssues = runProjectCheck(scope);
    const errors = projectCheckIssues.filter(i => i.level === 'erro').length;
    const warnings = projectCheckIssues.length - errors;
    const name = document.querySelector(`.folder-title[data-folder-id="${CSS.escape(scope.projectId)}"]`)?.dataset.folderName || '';
    subtitle.textContent = name;
    const opticalHtml = renderOpticalTable(scope);
    if (!projectCheckIssues.length) {
        body.innerHTML = '<p class="check-ok">Nenhum problema encontrado.</p>' + opticalHtml;
        return;
    }
    const sorted = [...projectCheckIssues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'erro' ? -1 : 1));
    body.innerHTML = `<div class="check-summary"><span class="is-erro">${errors} erro${errors === 1 ? '' : 's'}</span><span class="is-aviso">${warnings} aviso${warnings === 1 ? '' : 's'}</span></div>
        <ul class="check-list">${sorted.map((issue) => `
            <li><button type="button" class="is-${issue.level}" data-check-index="${projectCheckIssues.indexOf(issue)}">
                <strong>${escapeHtml(issue.title)}</strong><small>${escapeHtml(issue.detail)}</small>
            </button></li>`).join('')}</ul>` + opticalHtml;
}

function openProjectCheck() {
    document.getElementById('projectCheckBox').classList.remove('hidden');
    renderProjectCheck();
}

function setupProjectCheck() {
    const box = document.getElementById('projectCheckBox');
    if (!box) return;
    document.getElementById('closeProjectCheckBox').addEventListener('click', () => box.classList.add('hidden'));
    document.getElementById('rerunProjectCheckButton').addEventListener('click', renderProjectCheck);
    document.getElementById('projectCheckButton')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('projectDropdown')?.classList.remove('show');
        openProjectCheck();
    });
    box.addEventListener('click', (e) => {
        const item = e.target.closest('[data-check-index]');
        if (item) focusProjectCheckTarget(projectCheckIssues[Number(item.dataset.checkIndex)]?.target);
        const power = e.target.closest('[data-power-cto]');
        if (power) focusProjectCheckTarget({ kind: 'marker', info: findMarkerByUid(power.dataset.powerCto) });
    });
}

document.addEventListener('DOMContentLoaded', setupProjectCheck);
