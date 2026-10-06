// Modelos de caixa: salva os splitters do plano de fusão aberto, as ligações entre eles e as fusões
// cabo → splitter (pela posição do cabo: 1º cabo de entrada, fibra N) e aplica em outra caixa.
// Ficam na tabela box_templates (migração 20261007120000). Depende de js/fusion.js.

let boxTemplatesCache = [];
let boxTemplatesAvailable = true;

function describePortForTemplate(portId, splitterIndex, cableIndex) {
    const port = document.getElementById(portId);
    const card = port ? getPortCard(port) : null;
    if (!card) return null;
    if (card.classList.contains('splitter-element')) {
        const s = splitterIndex.get(card);
        if (portId === `${card.id}-input-port`) return { s, port: 'in' };
        const n = Number(portId.match(/-output-(\d+)$/)?.[1]);
        return n ? { s, port: n } : null;
    }
    const ref = cableIndex.get(card);
    const fiber = getFiberNumberFromId(portId);
    return ref && fiber ? { role: ref.role, index: ref.index, fiber } : null;
}

function captureFusionTemplate() {
    const cards = getFusionCards();
    const splitters = cards.filter(c => c.classList.contains('splitter-element'));
    const splitterIndex = new Map(splitters.map((c, i) => [c, i]));
    const cableIndex = new Map();
    ['entrada', 'saida'].forEach(role => {
        cards.filter(c => c.classList.contains('cable-element') && c.dataset.cableRole === role).forEach((c, index) => cableIndex.set(c, { role, index }));
    });
    const links = [];
    getFusionLines().forEach(line => {
        const a = describePortForTemplate(line.dataset.startId, splitterIndex, cableIndex);
        const b = describePortForTemplate(line.dataset.endId, splitterIndex, cableIndex);
        if (a && b && (a.s != null || b.s != null)) links.push([a, b]); //Só o que envolve splitter
    });
    return {
        version: 1,
        splitters: splitters.map(card => ({
            label: getSplitterLabelText(card),
            outputs: card.querySelectorAll('.splitter-outputs .splitter-port-row').length,
            type: card.classList.contains('splitter-atendimento') ? 'Atendimento' : 'Fusão',
            connector: card.classList.contains('splitter-upc') ? 'UPC' : 'APC',
            status: card.dataset.status || 'Novo',
            lane: card.dataset.lane || 'right',
        })),
        links,
    };
}

//Aplica no plano aberto. Retorna { splitters, links, skipped }
function applyFusionTemplate(template) {
    if (!activeMarkerForFusion || !template?.splitters) return null;
    const stamp = Date.now().toString(36);
    const created = template.splitters.map((s, i) => {
        const card = buildFusionSplitterCard({
            id: `splitter-m${stamp}${i}`, label: s.label, outputs: s.outputs, status: s.status,
            type: s.type, connector: s.connector, lane: s.lane,
        });
        getFusionStage().appendChild(card);
        wireFusionCard(card);
        return card;
    });
    const cables = { entrada: [], saida: [] };
    getFusionCards().filter(c => c.classList.contains('cable-element')).forEach(c => cables[c.dataset.cableRole === 'saida' ? 'saida' : 'entrada'].push(c));
    const resolve = (ref) => {
        if (ref.s != null) {
            const card = created[ref.s];
            return card ? document.getElementById(ref.port === 'in' ? `${card.id}-input-port` : `${card.id}-output-${ref.port}`) : null;
        }
        const card = cables[ref.role]?.[ref.index];
        return card ? [...card.querySelectorAll('.fiber-row')].find(r => getFiberNumberFromId(r.id) === ref.fiber) || null : null;
    };
    let links = 0;
    let skipped = 0;
    (template.links || []).forEach(([a, b]) => {
        const pa = resolve(a);
        const pb = resolve(b);
        if (!pa || !pb || findLineForPort(pa.id) || findLineForPort(pb.id)) {
            skipped++;
            return;
        }
        createFusionLine(pa, pb);
        links++;
    });
    markFusionDirty();
    repackAllElements();
    renderFusionConnections();
    renderFusionSidebar();
    return { splitters: created.length, links, skipped };
}

// ---------------------------------------------------------------
// Banco e barra lateral do plano de fusão
// ---------------------------------------------------------------

async function loadBoxTemplates() {
    if (!AppSession?.company?.id) return [];
    const { data, error } = await supabaseClient
        .from('box_templates')
        .select('id, name, box_type, template, created_by')
        .eq('company_id', AppSession.company.id)
        .order('name');
    if (error) {
        boxTemplatesAvailable = false; //Migração ainda não rodada
        return [];
    }
    boxTemplatesAvailable = true;
    boxTemplatesCache = data || [];
    return boxTemplatesCache;
}

function renderBoxTemplatesSection() {
    const section = document.getElementById('fusionTemplatesSection');
    if (!section || !activeMarkerForFusion) return;
    const type = activeMarkerForFusion.type;
    const list = boxTemplatesCache.filter(t => t.box_type === type);
    const select = document.getElementById('fxTemplateSelect');
    select.innerHTML = list.length
        ? list.map(t => `<option value="${t.id}">${escapeHtml(t.name)} · ${t.template?.splitters?.length || 0} splitter(s)</option>`).join('')
        : `<option value="">Nenhum modelo de ${type} ainda</option>`;
    select.disabled = !list.length;
    const canEdit = AppSession.canEdit;
    document.getElementById('fxTemplateApply').disabled = !list.length || !canEdit;
    document.getElementById('fxTemplateSave').hidden = !canEdit;
    document.getElementById('fxTemplateDelete').hidden = !canEdit || !list.length;
    document.getElementById('fxTemplateNote').textContent = boxTemplatesAvailable
        ? 'Splitters, ligações entre eles e fusões cabo → splitter (pela posição do cabo).'
        : 'Modelos indisponíveis: rode a migração 20261007120000_modelos_de_caixa.sql no Supabase.';
}

async function refreshBoxTemplatesSection() {
    await loadBoxTemplates();
    renderBoxTemplatesSection();
}

async function saveCurrentPlanAsTemplate() {
    if (!requireEdit('criar modelos de caixa') || !activeMarkerForFusion) return;
    const template = captureFusionTemplate();
    if (!template.splitters.length) {
        showToast('Sem splitters', 'O modelo guarda os splitters do plano. Adicione pelo menos um.', 'progress');
        return;
    }
    const name = (window.prompt(`Nome do modelo de ${activeMarkerForFusion.type}:`, `${activeMarkerForFusion.type} padrão ${template.splitters.map(s => s.label).join(' + ')}`) || '').trim();
    if (!name) return;
    const { error } = await supabaseClient.from('box_templates').insert({
        company_id: AppSession.company.id, name: name.slice(0, 80), box_type: activeMarkerForFusion.type, template, created_by: AppSession.userId,
    });
    if (error) {
        showAlert('Modelo não salvo', boxTemplatesAvailable ? `Não foi possível salvar: ${error.message}` : 'Rode a migração dos modelos de caixa no Supabase primeiro.');
        return;
    }
    showToast('Modelo salvo', `"${name}" disponível para todas as ${activeMarkerForFusion.type}s da empresa.`);
    refreshBoxTemplatesSection();
}

function applySelectedTemplate() {
    const t = boxTemplatesCache.find(x => x.id === document.getElementById('fxTemplateSelect').value);
    if (!t || !requireEdit('aplicar modelos')) return;
    const result = applyFusionTemplate(t.template);
    if (!result) return;
    showToast('Modelo aplicado', `${result.splitters} splitter(s) e ${result.links} fusão(ões)${result.skipped ? ` · ${result.skipped} ignorada(s): cabo ausente ou porta já ligada` : ''}. Confira e salve o plano.`, result.skipped ? 'progress' : 'success');
}

async function deleteSelectedTemplate() {
    const t = boxTemplatesCache.find(x => x.id === document.getElementById('fxTemplateSelect').value);
    if (!t) return;
    showConfirm('Excluir modelo', `Excluir o modelo "${t.name}"? As caixas que já usaram o modelo não mudam.`, async () => {
        const { error, count } = await supabaseClient.from('box_templates').delete({ count: 'exact' }).eq('id', t.id);
        if (error || count === 0) showAlert('Modelo não excluído', 'Só quem criou o modelo ou o administrador pode excluí-lo.');
        refreshBoxTemplatesSection();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('fxTemplateApply')?.addEventListener('click', applySelectedTemplate);
    document.getElementById('fxTemplateSave')?.addEventListener('click', saveCurrentPlanAsTemplate);
    document.getElementById('fxTemplateDelete')?.addEventListener('click', deleteSelectedTemplate);
});
