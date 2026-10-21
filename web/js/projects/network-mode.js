// Modo Projeto × Modo Rede. No modo Projeto se planeja (como sempre); no modo Rede fica a documentação da rede
// construída, uma por cidade, com os clientes ligados nas caixas. A rede de cada cidade é guardada como um projeto do
// tipo "Rede" (tabela projects: mesmas permissões, revisão, histórico de versões, lixeira e edição ao vivo).
// "Concluir e enviar para a rede" copia o projeto para a rede da cidade dele (tudo vira Existente, com a origem
// anotada em asBuilt) e deixa o projeto só para consulta.
// Depende de js/app.js, js/core/persistence.js, js/projects/sidebar.js e js/network/project-check.js.

const NETWORK_PROJECT_TYPE = 'Rede';
const NETWORK_COLOR = '#15803d';
let appMode = 'projeto';
let networkCity = '';
let projectConclusions = {}; //Id do projeto → { at, by, byName, networkId, networkName }

const appModeStorageKey = () => `routeMapMode:${AppSession.userId}`;
const projectWorkspaceStorageKey = () => `routeMapProjectWorkspace:${AppSession.userId}`;

function slugNetworkCity(city) {
    return String(city || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sem-cidade';
}

//Id da rede da cidade: o mesmo para toda a equipe da empresa (o id dos projetos vale para o banco todo)
function getNetworkId(city) {
    return `rede_${String(AppSession.company?.id || '').replace(/-/g, '').slice(0, 12)}_${slugNetworkCity(city)}`;
}

const isNetworkProjectId = (id) => /^rede_/.test(id || '');
const isNetworkRoot = (root) => root?.querySelector(':scope > .folder-title')?.dataset.folderType === NETWORK_PROJECT_TYPE;
const getOpenProjectRoots = () => [...document.querySelectorAll('#sidebar > .folder')];
const getRootId = (root) => root?.querySelector(':scope > .folder-title')?.dataset.folderId || '';

function emptyNetworkData(city) {
    return {
        sidebar: { id: getNetworkId(city), name: `Rede · ${city}`, city, neighborhood: null, type: NETWORK_PROJECT_TYPE, isProject: true, children: [] },
        markers: [], cables: [], polygons: [],
    };
}

// ---------------------------------------------------------------
// Projeto concluído: só para consulta
// ---------------------------------------------------------------

function isProjectConcluded(projectId) {
    return !!projectConclusions[projectId];
}

//Motivo para não deixar editar (requireEdit, em js/core/supabase-client.js): o projeto ativo já foi concluído
function getEditBlockReason() {
    const projectId = typeof getActiveProjectId === 'function' ? getActiveProjectId() : null;
    const done = projectId && projectConclusions[projectId];
    if (!done) return '';
    return `Este projeto foi concluído e enviado para a ${done.networkName || 'rede'}: está só para consulta. As mudanças agora são feitas no modo Rede.`;
}

function applyProjectConclusionUi(projectId) {
    const title = document.getElementById(projectId)?.closest('.folder')?.querySelector(':scope > .folder-title');
    if (!title) return;
    const done = projectConclusions[projectId];
    if (done) title.dataset.concluded = 'true';
    else delete title.dataset.concluded;
    title.title = done ? `Concluído em ${new Date(done.at).toLocaleDateString('pt-BR')} e enviado para a ${done.networkName || 'rede'} (só consulta)` : '';
    if (typeof scheduleSidebarCounts === 'function') scheduleSidebarCounts();
}

// ---------------------------------------------------------------
// Troca de modo
// ---------------------------------------------------------------

function applyAppModeUi() {
    document.body.classList.toggle('mode-rede', appMode === 'rede');
    document.querySelectorAll('[data-app-mode]').forEach(button => {
        const on = button.dataset.appMode === appMode;
        button.classList.toggle('is-active', on);
        button.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    const chip = document.getElementById('networkCityButton');
    if (chip) {
        chip.hidden = appMode !== 'rede';
        const label = chip.querySelector('.top-bar-button__label');
        if (label) label.textContent = networkCity || 'Cidade';
    }
}

//Salva (quem pode editar) e tira da tela tudo o que está aberto. false = a pessoa desistiu ou deu erro ao salvar
async function leaveCurrentWorkspace() {
    const roots = getOpenProjectRoots();
    if (!roots.length) return true;
    const editable = roots.filter(root => AppSession.canEdit && !isProjectConcluded(getRootId(root)));
    if (editable.length) {
        const names = editable.map(root => `"${root.querySelector(':scope > .folder-title')?.dataset.folderName || 'Projeto'}"`).join(', ');
        const choice = await showChoice({
            title: appMode === 'rede' ? 'Ir para o modo Projeto' : 'Ir para o modo Rede',
            message: `Para trocar de modo, ${names} ${editable.length === 1 ? 'é salvo e fecha' : 'são salvos e fecham'} nesta tela. ${appMode === 'rede' ? 'A rede' : 'Os projetos'} ${appMode === 'rede' ? 'volta' : 'voltam'} quando você voltar para este modo.`,
            choices: [{ label: 'Cancelar', kind: 'secondary', value: 'cancel' }, { label: 'Salvar e trocar', kind: 'primary', value: 'save' }],
        });
        if (choice !== 'save') return false;
        for (const root of editable) {
            try {
                await persistProject(root);
            } catch (error) {
                const name = root.querySelector(':scope > .folder-title')?.dataset.folderName || 'Projeto';
                if (error instanceof ProjectConflictError) {
                    if (!(await resolveProjectConflict(root, name, error.info))) return false;
                } else {
                    showAlert('Erro', `Não foi possível salvar "${name}". ${error.message || ''}`);
                    return false;
                }
            }
        }
    }
    roots.forEach(root => {
        const id = getRootId(root);
        if (typeof liveSyncLeave === 'function') liveSyncLeave(id);
        removeProjectFromWorkspace(id, root);
    });
    return true;
}

function rememberProjectWorkspace(ids) {
    try { localStorage.setItem(projectWorkspaceStorageKey(), JSON.stringify(ids)); } catch (e) { /* ignora */ }
}

function readProjectWorkspace() {
    try { return JSON.parse(localStorage.getItem(projectWorkspaceStorageKey()) || '[]').filter(id => typeof id === 'string'); } catch (e) { return []; }
}

function getSavedAppMode() {
    try { return JSON.parse(localStorage.getItem(appModeStorageKey()) || 'null')?.mode || 'projeto'; } catch (e) { return 'projeto'; }
}

function storeAppMode() {
    try { localStorage.setItem(appModeStorageKey(), JSON.stringify({ mode: appMode, city: networkCity })); } catch (e) { /* ignora */ }
}

async function setAppMode(mode, { city = '', startup = false } = {}) {
    await appReady;
    if (mode === 'rede') {
        const target = city || await pickNetworkCity();
        if (!target) { applyAppModeUi(); return false; }
        if (appMode === 'rede' && target === networkCity && document.getElementById(getNetworkId(target))) return true;
        const leaving = appMode === 'projeto' ? getOpenProjectRoots().map(getRootId).filter(id => !isNetworkProjectId(id)) : null;
        if (!(await leaveCurrentWorkspace())) { applyAppModeUi(); return false; }
        if (leaving && !startup) rememberProjectWorkspace(leaving);
        appMode = 'rede';
        networkCity = target;
        applyAppModeUi();
        storeAppMode();
        await openNetwork(target);
        return true;
    }
    if (appMode === 'projeto') return true;
    if (!(await leaveCurrentWorkspace())) { applyAppModeUi(); return false; }
    appMode = 'projeto';
    applyAppModeUi();
    storeAppMode();
    for (const id of readProjectWorkspace()) {
        if (!document.getElementById(id)) await openProjectFromDatabase(id, null, { silent: true });
    }
    return true;
}

//Abre a rede da cidade (cria vazia na primeira vez)
async function openNetwork(city) {
    const id = getNetworkId(city);
    if (document.getElementById(id)) { setActiveFolder(id); return; }
    const { data } = await supabaseClient.from('projects').select('id').eq('id', id).maybeSingle();
    if (data) {
        await openProjectFromDatabase(id, null, { silent: true });
    } else {
        rebuildSidebarFromJSON([emptyNetworkData(city).sidebar], document.getElementById('sidebar'));
        updateSidebarEmptyState();
        if (AppSession.canEdit) {
            try { await persistProject(document.getElementById(id).closest('.folder')); } catch (error) { console.error('Erro ao criar a rede:', error); }
        }
        if (typeof liveSyncJoin === 'function') liveSyncJoin(id);
    }
    if (!document.getElementById(id)) return;
    setActiveFolder(id);
    const hasItems = markers.some(m => getAllDescendantFolderIds(id).includes(m.folderId));
    if (hasItems && typeof focusMapToFolderScope === 'function') focusMapToFolderScope(id);
    showToast(`Rede · ${city}`, hasItems ? 'Rede documentada da cidade. Clique numa CTO para ligar clientes nas portas.' : 'Ainda não há nada construído aqui. Conclua um projeto desta cidade para ele entrar na rede.', 'progress');
}

//Escolha da cidade: as cidades dos projetos e das redes da empresa, ou outra digitada
async function listNetworkCities() {
    const { data, error } = await supabaseClient.rpc('project_facets');
    if (!error && data?.cities) return data.cities.map(c => c.value).filter(Boolean);
    const rows = await supabaseClient.from('projects').select('city');
    return [...new Set((rows.data || []).map(r => r.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function ensureNetworkCityModal() {
    let modal = document.getElementById('networkCityModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'networkCityModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content net-city-modal" role="dialog" aria-labelledby="networkCityTitle">
            <h2 id="networkCityTitle">Rede de qual cidade?</h2>
            <div class="modal-body-content">
                <p class="net-city-modal__hint">Cada cidade tem a sua rede documentada: tudo o que já foi construído e os clientes de cada caixa.</p>
                <div class="net-city-list" id="networkCityList" role="listbox" aria-label="Cidades"></div>
                <label class="net-city-modal__other" for="networkCityInput">Outra cidade</label>
                <input type="text" id="networkCityInput" placeholder="Nome da cidade" autocomplete="off" />
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-net-city="cancel">Cancelar</button>
                <button type="button" class="btn btn-success" data-net-city="ok">Abrir a rede</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    return modal;
}

async function pickNetworkCity() {
    const modal = ensureNetworkCityModal();
    const list = modal.querySelector('#networkCityList');
    const input = modal.querySelector('#networkCityInput');
    input.value = '';
    list.innerHTML = '<p class="net-city-modal__hint">Carregando as cidades…</p>';
    modal.style.display = 'flex';
    listNetworkCities().then(cities => {
        list.innerHTML = cities.length
            ? cities.map(c => `<button type="button" class="net-city" data-city="${escapeHtml(c)}"${c === networkCity ? ' aria-current="true"' : ''}>${escapeHtml(c)}</button>`).join('')
            : '<p class="net-city-modal__hint">Nenhuma cidade nos projetos ainda: digite abaixo.</p>';
    }).catch(() => { list.innerHTML = ''; });
    setTimeout(() => input.focus(), 50);
    return new Promise(resolve => {
        const finish = (city) => {
            modal.style.display = 'none';
            modal.removeEventListener('click', onClick);
            document.removeEventListener('keydown', onKey, true);
            resolve(city ? city.trim() : '');
        };
        const onClick = (e) => {
            const pick = e.target.closest('.net-city');
            if (pick) return finish(pick.dataset.city);
            const action = e.target.closest('[data-net-city]')?.dataset.netCity;
            if (action === 'cancel' || e.target === modal) finish('');
            else if (action === 'ok' && input.value.trim()) finish(input.value);
            else if (action === 'ok') input.focus();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(''); }
            else if (e.key === 'Enter' && e.target === input && input.value.trim()) { e.preventDefault(); finish(input.value); }
        };
        modal.addEventListener('click', onClick);
        document.addEventListener('keydown', onKey, true);
    });
}

// ---------------------------------------------------------------
// Concluir o projeto e enviar para a rede da cidade
// ---------------------------------------------------------------

const ASBUILT_STATUS_KEYS = ['ctoStatus', 'ceoStatus', 'cordoalhaStatus', 'reservaStatus'];

//Itens que entram na rede: construídos, com a origem (o projeto e a data); o que já veio da rede guarda a origem dela
function toAsBuiltMarker(marker, stamp) {
    const out = { ...marker, asBuilt: marker.asBuilt || stamp };
    ASBUILT_STATUS_KEYS.forEach(key => { if (out[key]) out[key] = 'Existente'; });
    if (out.pole) out.pole = { ...out.pole, situation: 'Existente' };
    return out;
}

function toAsBuiltCable(cable, stamp) {
    const out = { ...cable, status: 'Existente', asBuilt: cable.asBuilt || stamp };
    if (out.width === DEFAULT_CABLE_WIDTH_NEW) out.width = DEFAULT_CABLE_WIDTH_EXISTING;
    return out;
}

//Junta o projeto (o JSON salvo) na rede: vira uma pasta da rede com a mesma árvore; concluir de novo substitui a pasta.
//Item com o mesmo identificador de um que já está na rede é atualizado no lugar (não duplica); poste "Remover" sai.
function mergeProjectIntoNetwork(network, project, meta) {
    const net = JSON.parse(JSON.stringify(network));
    net.markers = net.markers || [];
    net.cables = net.cables || [];
    net.polygons = net.polygons || [];
    net.sidebar.children = net.sidebar.children || [];
    const stamp = { projectId: meta.projectId, projectName: meta.projectName, at: meta.at, by: meta.byName || '' };
    const toFolder = (node) => ({ ...node, isProject: false, type: 'folder', city: null, neighborhood: null, children: (node.children || []).map(toFolder) });
    const folder = { ...toFolder(project.sidebar), id: project.sidebar.id, name: meta.folderName };
    const ids = new Set();
    const collect = (node) => { ids.add(node.id); (node.children || []).forEach(collect); };
    collect(folder);
    net.sidebar.children = net.sidebar.children.filter(child => child.id !== folder.id);
    folder.order = net.sidebar.children.length;
    net.sidebar.children.push(folder);
    ['markers', 'cables', 'polygons'].forEach(key => { net[key] = net[key].filter(item => !ids.has(item.folderId)); });
    const upsert = (list, item) => {
        const at = item.uid ? list.findIndex(other => other.uid === item.uid) : -1;
        if (at >= 0) list[at] = { ...item, folderId: list[at].folderId };
        else list.push(item);
    };
    (project.markers || []).forEach(marker => {
        if (marker.type === 'POSTE' && marker.pole?.situation === 'Remover') {
            net.markers = net.markers.filter(other => !marker.uid || other.uid !== marker.uid);
            return;
        }
        upsert(net.markers, toAsBuiltMarker(marker, stamp));
    });
    (project.cables || []).forEach(cable => upsert(net.cables, toAsBuiltCable(cable, stamp)));
    (project.polygons || []).filter(p => !p.preProjeto).forEach(p => upsert(net.polygons, { ...p, asBuilt: p.asBuilt || stamp }));
    return net;
}

function getProjectSummaryForNetwork(projectId) {
    const folderIds = new Set(getAllDescendantFolderIds(projectId));
    const own = markers.filter(m => folderIds.has(m.folderId));
    const cables = savedCables.filter(c => folderIds.has(c.folderId));
    const meters = cables.reduce((sum, c) => sum + (Number(c.totalLength) || 0), 0);
    return {
        ctos: own.filter(m => m.type === 'CTO').length,
        ceos: own.filter(m => m.type === 'CEO').length,
        clients: own.filter(m => m.type === 'CLIENTE').length,
        cables: cables.length,
        meters,
        issues: typeof runProjectCheck === 'function' ? runProjectCheck({ projectId, markers: own, cables }).filter(i => i.level === 'erro').length : 0,
    };
}

async function openConcludeProject(projectId) {
    await appReady;
    const root = document.getElementById(projectId)?.closest('.folder');
    const title = root?.querySelector(':scope > .folder-title');
    if (!title || isNetworkRoot(root)) return;
    if (!AppSession.canEdit) { requireEdit('concluir projetos'); return; }
    if (isProjectConcluded(projectId)) {
        showToast('Já concluído', `"${title.dataset.folderName}" já está na ${projectConclusions[projectId].networkName || 'rede'}.`, 'progress');
        return;
    }
    const city = (title.dataset.folderCity || '').trim();
    if (!city || city === 'null' || city === 'undefined') {
        showAlert('Falta a cidade', 'Informe a cidade do projeto (menu do projeto → Editar projeto) antes de concluir: é ela que diz para qual rede o projeto vai.');
        return;
    }
    const name = title.dataset.folderName || 'Projeto';
    const sum = getProjectSummaryForNetwork(projectId);
    const fmt = (v) => Math.round(v).toLocaleString('pt-BR');
    const lines = [
        `"${name}" vai para a Rede · ${city}:`,
        `• ${fmt(sum.ctos)} CTO(s), ${fmt(sum.ceos)} CEO(s) e ${fmt(sum.cables)} cabo(s), ${fmt(sum.meters)} m${sum.clients ? `, ${fmt(sum.clients)} cliente(s)` : ''}.`,
        '• Tudo entra como Existente, anotado como construído por este projeto.',
        '• O projeto fica concluído: só para consulta (relatórios, PDF e planilha continuam).',
    ];
    if (sum.issues) lines.push('', `⚠ A verificação achou ${sum.issues} erro(s) no projeto. Vale corrigir antes, para a rede não ficar com pontas soltas.`);
    const choice = await showChoice({
        title: 'Concluir e enviar para a rede',
        message: lines.join('\n'),
        choices: [
            { label: 'Cancelar', kind: 'secondary', value: 'cancel' },
            ...(sum.issues ? [{ label: 'Ver os erros', kind: 'secondary', value: 'check' }] : []),
            { label: 'Concluir e enviar', kind: 'primary', value: 'go' },
        ],
    });
    if (choice === 'check') { setActiveFolder(projectId); openProjectCheck(); return; }
    if (choice !== 'go') return;
    try {
        const done = await concludeProject(projectId);
        const next = await showChoice({
            title: 'Projeto na rede',
            message: `"${name}" foi concluído e entrou na ${done.networkName}.`,
            choices: [{ label: 'Continuar aqui', kind: 'secondary', value: 'stay' }, { label: 'Abrir a rede', kind: 'primary', value: 'open' }],
        });
        if (next === 'open') setAppMode('rede', { city });
    } catch (error) {
        console.error('Erro ao concluir o projeto:', error);
        showAlert('Erro', `Não foi possível enviar o projeto para a rede. ${error.message || ''}`);
    }
}

//Grava a rede da cidade com o projeto dentro e marca o projeto como concluído. Se outra pessoa salvou a rede no meio
//do caminho, lê de novo e junta outra vez (até 3 tentativas).
async function concludeProject(projectId) {
    const root = document.getElementById(projectId).closest('.folder');
    const title = root.querySelector(':scope > .folder-title');
    const city = title.dataset.folderCity.trim();
    const networkId = getNetworkId(city);
    const networkName = `Rede · ${city}`;
    const record = buildProjectRecord(root);
    const at = new Date().toISOString();
    const byName = AppSession.profile?.full_name || '';
    const meta = {
        projectId, projectName: record.name, at, byName,
        folderName: `${record.name} · concluído em ${new Date(at).toLocaleDateString('pt-BR')}`,
    };
    for (let attempt = 0; attempt < 3; attempt++) {
        const { data: row, error } = await supabaseClient.from('projects').select('id, data, revision').eq('id', networkId).maybeSingle();
        if (error) throw error;
        const base = row?.data?.sidebar ? row.data : emptyNetworkData(city);
        const merged = mergeProjectIntoNetwork(base, record.data, meta);
        if (row) {
            let query = supabaseClient.from('projects').update({ data: merged, name: networkName, city, project_type: NETWORK_PROJECT_TYPE }).eq('id', networkId);
            if (row.revision != null) query = query.eq('revision', row.revision);
            const { data: saved, error: saveError } = await query.select('revision');
            if (saveError) throw saveError;
            if (!saved?.length) continue;
        } else {
            const { error: saveError } = await supabaseClient.from('projects').upsert({
                id: networkId, company_id: AppSession.company.id, created_by: AppSession.userId,
                name: networkName, city, neighborhood: null, project_type: NETWORK_PROJECT_TYPE, data: merged,
            }, { onConflict: 'id' });
            if (saveError) throw saveError;
        }
        projectConclusions[projectId] = { at, by: AppSession.userId, byName, networkId, networkName };
        try {
            await persistProject(root, { allowConcluded: true });
        } catch (saveError) {
            if (!(saveError instanceof ProjectConflictError)) throw saveError;
            await persistProject(root, { allowConcluded: true, force: true });
        }
        applyProjectConclusionUi(projectId);
        return projectConclusions[projectId];
    }
    throw new Error('A rede foi alterada por outra pessoa várias vezes seguidas. Tente de novo.');
}

// ---------------------------------------------------------------
// Ligações
// ---------------------------------------------------------------

//Novo projeto / Abrir projeto no modo Rede: primeiro volta para o modo Projeto
function guardProjectOnlyButton(id) {
    document.getElementById(id)?.addEventListener('click', async (e) => {
        if (appMode !== 'rede') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (await setAppMode('projeto')) document.getElementById(id).click();
    }, true);
}

appReady.then(() => {
    document.querySelectorAll('[data-app-mode]').forEach(button => button.addEventListener('click', () => setAppMode(button.dataset.appMode)));
    document.getElementById('networkCityButton')?.addEventListener('click', () => setAppMode('rede'));
    ['createProjectButton', 'loadProjectButton'].forEach(guardProjectOnlyButton);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(appModeStorageKey()) || 'null'); } catch (e) { saved = null; }
    applyAppModeUi();
    //Voltou no modo Rede: abre a rede da cidade de antes, quando o mapa estiver pronto
    if (saved?.mode === 'rede' && saved.city) mapReady.then(() => setAppMode('rede', { city: saved.city, startup: true }));
});
