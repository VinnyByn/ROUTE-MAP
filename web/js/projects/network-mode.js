// Modo Projeto × Modo Rede. No modo Projeto se planeja (como sempre); no modo Rede fica a documentação da rede
// construída, uma por cidade, com os clientes ligados nas caixas. A rede de cada cidade é guardada como um projeto do
// tipo "Rede" (tabela projects: mesmas permissões, revisão, histórico de versões, lixeira e edição ao vivo).
// "Migrar para o modo Rede" copia o projeto para a rede da cidade dele (tudo vira Existente, com a origem
// anotada em asBuilt) e deixa o projeto só para consulta.
// Depende de js/app.js, js/core/persistence.js, js/projects/sidebar.js e js/network/project-check.js.

const NETWORK_PROJECT_TYPE = 'Rede';
const NETWORK_COLOR = '#15803d';
let appMode = 'projeto';
let appModeStartup = Promise.resolve(); //Entrada no modo Rede ao abrir o sistema (js/network/field-docs.js espera)
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
    const tools = document.getElementById('networkTools');
    if (tools) tools.hidden = appMode !== 'rede';
    const sidebarTitle = document.querySelector('.sidebar-header h3');
    if (sidebarTitle) sidebarTitle.textContent = appMode === 'rede' ? 'Rede' : 'Projetos';
}

//Rede da cidade ainda não carregada: só o nome na barra lateral (carrega ao abrir, mostrar ou mexer nela)
const isPendingNetworkRoot = (root) => root?.querySelector(':scope > .folder-title')?.dataset.networkPending === 'true';

//Salva (quem pode editar) e tira da tela tudo o que está aberto. false = a pessoa desistiu ou deu erro ao salvar
async function leaveCurrentWorkspace() {
    const roots = getOpenProjectRoots();
    if (!roots.length) return true;
    const editable = roots.filter(root => AppSession.canEdit && !isPendingNetworkRoot(root) && !isProjectConcluded(getRootId(root)));
    //A rede salva sozinha: grava o que faltou, sem perguntar (js/network/network-sidebar.js)
    if (appMode === 'rede' && typeof flushNetworkAutosave === 'function') {
        for (const root of roots.filter(r => isNetworkRoot(r) && !isPendingNetworkRoot(r))) {
            if (!(await flushNetworkAutosave(root))) return false;
        }
    } else if (editable.length) {
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
        if (typeof liveSyncLeave === 'function' && !isPendingNetworkRoot(root)) liveSyncLeave(id);
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

//Link do QR code de uma caixa (?rede=…&caixa=…); guardado durante o login (js/app.js) para abrir depois de entrar
function getPendingFieldLink() {
    let query = location.search;
    try { if (!/[?&]caixa=/.test(query)) query = sessionStorage.getItem('routeMapDeepLink') || ''; } catch (e) { query = ''; }
    const params = new URLSearchParams(query);
    const rede = params.get('rede');
    const caixa = params.get('caixa');
    return rede && caixa && isNetworkProjectId(rede) ? { rede, caixa } : null;
}

//Modo ao entrar: o das preferências (Projeto ou Rede) ou, em "Último usado", o da última vez. Link de caixa: Rede.
//Viabilidade sempre na Rede; técnico de campo começa na Rede, a não ser que prefira o Projeto.
function getStartupAppMode() {
    if (getPendingFieldLink() || AppSession.isViabilidade) return 'rede';
    const pref = AppSession.profile?.preferences?.startMode;
    if (AppSession.isTecnico && pref !== 'projeto') return 'rede';
    return pref === 'projeto' || pref === 'rede' ? pref : getSavedAppMode();
}

function storeAppMode() {
    try { localStorage.setItem(appModeStorageKey(), JSON.stringify({ mode: appMode })); } catch (e) { /* ignora */ }
}

//city: abre (e mostra no mapa) a rede dessa cidade ao entrar no modo Rede
async function setAppMode(mode, { city = '', startup = false } = {}) {
    await appReady;
    if (mode === 'rede') {
        if (appMode === 'rede') {
            if (city) await showNetworkCity(city);
            return true;
        }
        //Projeto arquivado (ou já migrado para a rede) não volta aberto
        const leaving = getOpenProjectRoots().map(getRootId).filter(id => !isNetworkProjectId(id) && !isProjectConcluded(id)
            && !(typeof isProjectArchived === 'function' && isProjectArchived(id)));
        if (!(await leaveCurrentWorkspace())) { applyAppModeUi(); return false; }
        if (!startup) rememberProjectWorkspace(leaving);
        appMode = 'rede';
        applyAppModeUi();
        storeAppMode();
        await listNetworksInSidebar();
        if (city) await showNetworkCity(city);
        return true;
    }
    if (appMode === 'projeto') return true;
    if (!AppSession.canSeeProjects) {
        showToast('Somente a rede', 'O cargo Viabilidade consulta só a rede das cidades.', 'progress');
        applyAppModeUi();
        return false;
    }
    if (!(await leaveCurrentWorkspace())) { applyAppModeUi(); return false; }
    appMode = 'projeto';
    applyAppModeUi();
    storeAppMode();
    for (const id of readProjectWorkspace()) {
        if (!document.getElementById(id)) await openProjectFromDatabase(id, null, { silent: true });
    }
    return true;
}

//Todas as cidades da empresa na barra lateral, só pelo nome (o conteúdo carrega quando a pessoa abre a cidade)
async function listNetworksInSidebar() {
    const { data, error } = await supabaseClient.from('projects').select('id, name, city').eq('project_type', NETWORK_PROJECT_TYPE).is('deleted_at', null);
    if (error) { showAlert('Erro', 'Não foi possível carregar as cidades da rede.'); return; }
    const rows = (data || []).filter(row => !document.getElementById(row.id)).sort((a, b) => (a.city || a.name).localeCompare(b.city || b.name, 'pt-BR'));
    rows.forEach(row => addPendingNetworkRoot(row));
    updateSidebarEmptyState();
    if (!getOpenProjectRoots().length) {
        showToast('Modo Rede', AppSession.canEdit ? 'Nenhuma cidade ainda. Use "+ Cidade" para cadastrar a primeira.' : 'Nenhuma cidade cadastrada na rede ainda.', 'progress');
    }
}

function addPendingNetworkRoot(row) {
    const city = row.city || row.name.replace(/^Rede · /, '');
    rebuildSidebarFromJSON([{ id: row.id, name: row.name || `Rede · ${city}`, city, neighborhood: null, type: NETWORK_PROJECT_TYPE, isProject: true, children: [] }], document.getElementById('sidebar'));
    const title = document.getElementById(row.id).closest('.folder').querySelector(':scope > .folder-title');
    title.dataset.networkPending = 'true';
    const box = title.querySelector('.visibility-toggle-btn');
    if (box) { box.checked = false; box.dataset.visible = 'false'; box.title = 'Exibir no mapa'; }
}

//Carrega a rede de uma cidade no lugar do nome dela; visible: já mostra no mapa (senão fica tudo oculto)
const networkLoads = new Map();
function loadNetworkRoot(id, { visible = false, area = null } = {}) {
    if (networkLoads.has(id)) return networkLoads.get(id);
    const job = (async () => {
        const placeholder = document.getElementById(id)?.closest('.folder');
        if (!placeholder || !isPendingNetworkRoot(placeholder)) return placeholder;
        placeholder.classList.add('is-loading');
        const { data, error } = await supabaseClient.from('projects').select('id, name, data, revision').eq('id', id).maybeSingle();
        if (error || !data) {
            placeholder.classList.remove('is-loading');
            showAlert('Erro', 'Não foi possível abrir a rede desta cidade.');
            return null;
        }
        const next = placeholder.nextElementSibling;
        placeholder.remove();
        const { content: cleaned, removed } = cleanNetworkData(data.data || {});
        //Trecho (js/network/network-area.js): só o que está dentro da área carrega; o resto fica guardado para salvar junto
        const part = area && typeof splitNetworkDataByArea === 'function' ? splitNetworkDataByArea(cleaned, area) : null;
        const content = part ? part.content : cleaned;
        loadAndDisplayProject(id, { ...content, projectName: data.name }, { silent: true });
        const root = document.getElementById(id)?.closest('.folder');
        if (!root) return null;
        if (part) {
            root.__networkStash = part.stash;
            root.querySelector(':scope > .folder-title').dataset.networkArea = 'true';
            showNetworkAreaShape(id, area);
        }
        if (next && next.parentElement) next.parentElement.insertBefore(root, next);
        if (data.revision != null) setProjectRevision(root, data.revision);
        if (!visible) handleVisibilityToggle(root.querySelector(':scope > .folder-title .visibility-toggle-btn'), false);
        if (typeof applyNetworkClientVisibility === 'function') applyNetworkClientVisibility();
        if (typeof liveSyncJoin === 'function') liveSyncJoin(id);
        //Sobras de projetos concluídos antes (casas, postes, polígonos): saem e a rede é salva limpa
        if (removed && AppSession.canEdit) {
            try {
                await persistProject(root);
                showToast(data.name, `${removed} ${removed === 1 ? 'item que não é da rede saiu' : 'itens que não são da rede saíram'} (casas, postes ou polígonos vindos de projetos).`, 'progress');
            } catch (error) { console.error('Erro ao limpar a rede:', error); }
        }
        return root;
    })().finally(() => networkLoads.delete(id));
    networkLoads.set(id, job);
    return job;
}

//Mostra no mapa a rede da cidade (carrega se preciso) e centraliza nela
async function showNetworkCity(city) {
    const id = getNetworkId(city);
    if (!document.getElementById(id)) await listNetworksInSidebar();
    if (!document.getElementById(id)) return;
    const root = await loadNetworkRoot(id, { visible: true });
    if (!root) return;
    handleVisibilityToggle(root.querySelector(':scope > .folder-title .visibility-toggle-btn'), true);
    setActiveFolder(id);
    if (typeof focusMapToFolderScope === 'function' && markers.some(m => getAllDescendantFolderIds(id).includes(m.folderId))) focusMapToFolderScope(id);
}

//Clique (expandir, mostrar, menu ou selecionar) no nome de uma cidade ainda não carregada: carrega e repete o clique
function wirePendingNetworkClicks() {
    const sidebar = document.getElementById('sidebar');
    const intercept = async (e) => {
        const title = e.target.closest?.('.folder-title[data-network-pending="true"]');
        if (!title) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const id = title.dataset.folderId;
        const part = e.target.closest('.visibility-toggle-btn') ? 'show' : e.target.closest('.toggle-icon') ? 'expand'
            : e.target.closest('.item-actions-toggle-btn') ? 'menu' : e.type === 'contextmenu' ? 'context' : 'select';
        const root = await loadNetworkRoot(id, { visible: part === 'show' });
        if (!root) return;
        const fresh = root.querySelector(':scope > .folder-title');
        if (part === 'show') handleVisibilityToggle(fresh.querySelector('.visibility-toggle-btn'), true);
        else if (part === 'expand') toggleFolder(id);
        else if (part === 'menu') fresh.querySelector('.item-actions-toggle-btn')?.click();
        else if (part === 'context') fresh.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
        else setActiveFolder(id);
    };
    ['click', 'contextmenu', 'dblclick'].forEach(type => sidebar?.addEventListener(type, intercept, true));
}

//Cidades para escolher: as dos projetos da empresa, ou outra digitada
async function listNetworkCities() {
    const { data, error } = await supabaseClient.rpc('project_facets');
    if (!error && data?.cities) return data.cities.map(c => c.value).filter(Boolean);
    const rows = await supabaseClient.from('projects').select('city');
    return [...new Set((rows.data || []).map(r => r.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

//Nome da cidade arrumado: espaços e maiúsculas ("são joão del rei" → "São João del Rei")
function formatNetworkCityName(value) {
    const small = new Set(['de', 'da', 'do', 'das', 'dos', 'del', 'e']);
    return String(value || '').trim().replace(/\s+/g, ' ').split(' ')
        .map((w, i) => (i && small.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1)))
        .join(' ');
}

const BR_STATES = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const networkStateKey = () => `routeMapNetworkUF:${AppSession.company?.id || ''}`;
//Estado padrão: o último usado nesta empresa; senão a sigla no endereço da empresa ("… - MG")
function getDefaultNetworkState() {
    try { const v = localStorage.getItem(networkStateKey()); if (BR_STATES.includes(v)) return v; } catch (e) { /* ignora */ }
    const m = String(AppSession.company?.address || '').toUpperCase().match(/(?:^|[\s,/-])([A-Z]{2})\s*(?:,|$|\d|-)/g) || [];
    const uf = m.map(x => x.replace(/[^A-Z]/g, '')).reverse().find(x => BR_STATES.includes(x));
    return uf || '';
}
//Nome que aparece na barra lateral: "Rede · Lavras - MG" (o id da rede continua só pela cidade)
const networkDisplayName = (city, state) => `Rede · ${city}${state ? ` - ${state}` : ''}`;

const NETWORK_CITY_FOLDER_SUGGESTIONS = ['Backbone', 'Distribuição', 'Atendimento', 'POPs', 'Clientes empresariais'];
const NETWORK_CITY_FOLDER_HINTS = {
    Backbone: 'Cabos troncais e CEOs de passagem',
    'Distribuição': 'Das CEOs até as CTOs',
    Atendimento: 'CTOs e drops dos clientes',
    POPs: 'OLT, DGO e equipamentos',
    'Clientes empresariais': 'B2B, prediais e links dedicados',
};

const uiSvgIcon = (id) => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"></use></svg>`;

function ensureNetworkCityModal() {
    let modal = document.getElementById('networkCityModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'networkCityModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content net-city-modal" role="dialog" aria-labelledby="networkCityTitle">
            <div class="modal-header-v2 rm-head rm-head--rede">
                <span class="rm-head__icon">${uiSvgIcon('i-building')}</span>
                <div class="rm-head__text">
                    <h2 id="networkCityTitle">Nova cidade na rede</h2>
                    <p class="rm-head__sub">A documentação da rede construída: caixas, cabos, fusões e os clientes de cada porta</p>
                </div>
            </div>
            <div class="modal-body-content rm-steps">
                <ul class="net-city-perks">
                    <li>${uiSvgIcon('i-save')}<span><b>Salva sozinha</b>a cada mudança</span></li>
                    <li>${uiSvgIcon('i-lock')}<span><b>Só sai com confirmação</b>digitando o nome</span></li>
                    <li>${uiSvgIcon('i-list')}<span><b>Pastas por tipo</b>com a quantidade</span></li>
                </ul>
                <section class="rm-step">
                    <header class="rm-step__head"><span class="rm-step__n"></span><label for="networkCityInput">Qual cidade?</label></header>
                    <div class="net-city-input">
                        ${uiSvgIcon('i-marker')}
                        <input type="text" id="networkCityInput" placeholder="Digite o nome da cidade (ex.: Lavras)" autocomplete="off" />
                        <select id="networkCityState" aria-label="Estado"><option value="">UF</option>${BR_STATES.map(uf => `<option value="${uf}">${uf}</option>`).join('')}</select>
                    </div>
                    <p class="net-city-modal__status" id="networkCityStatus" aria-live="polite"></p>
                    <div class="net-city-list" id="networkCityList" role="listbox" aria-label="Cidades dos projetos"></div>
                </section>
                <section class="rm-step">
                    <header class="rm-step__head"><span class="rm-step__n"></span><span>Pastas para organizar</span><small>opcional · dá para criar depois</small></header>
                    <div class="net-city-folders" id="networkCityFolders"></div>
                    <div class="net-city-folder-add">
                        <input type="text" id="networkCityFolderInput" placeholder="Outra pasta (ex.: Bairro Centro)" autocomplete="off" />
                        <button type="button" class="btn btn-secondary" data-net-city="add-folder">${uiSvgIcon('i-folder-plus')} Adicionar</button>
                    </div>
                </section>
                <section class="rm-step">
                    <header class="rm-step__head"><span class="rm-step__n"></span><span>Como fica na barra lateral</span></header>
                    <div class="net-city-preview" id="networkCityPreview"></div>
                </section>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-net-city="cancel">Cancelar</button>
                <button type="button" class="btn btn-success" data-net-city="ok">Cadastrar cidade</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    return modal;
}

//Escolhe a cidade nova e as pastas iniciais: { city, folders, open } (open: a cidade já existe, só abrir)
async function pickNetworkCity() {
    const modal = ensureNetworkCityModal();
    const list = modal.querySelector('#networkCityList');
    const input = modal.querySelector('#networkCityInput');
    const stateSelect = modal.querySelector('#networkCityState');
    stateSelect.value = getDefaultNetworkState();
    const status = modal.querySelector('#networkCityStatus');
    const foldersBox = modal.querySelector('#networkCityFolders');
    const folderInput = modal.querySelector('#networkCityFolderInput');
    const preview = modal.querySelector('#networkCityPreview');
    const ok = modal.querySelector('[data-net-city="ok"]');
    const esc = (v) => escapeHtml(String(v ?? ''));
    const folders = NETWORK_CITY_FOLDER_SUGGESTIONS.map(name => ({ name, on: false }));
    const existing = new Map(getOpenProjectRoots().filter(isNetworkRoot).map(r => [getRootId(r), r.querySelector(':scope > .folder-title').dataset.folderName]));
    input.value = '';
    folderInput.value = '';
    list.innerHTML = '';
    const render = () => {
        const city = formatNetworkCityName(input.value);
        const id = city ? getNetworkId(city) : '';
        const already = id && existing.get(id);
        status.className = `net-city-modal__status${already ? ' is-exists' : city ? ' is-ok' : ''}`;
        status.innerHTML = already ? `${uiSvgIcon('i-folder')} <span><b>${esc(already)}</b> já existe: ela será aberta.</span>`
            : city ? `${uiSvgIcon('i-check')} <span>Vai criar <b>${esc(networkDisplayName(city, stateSelect.value))}</b></span>` : '';
        ok.textContent = already ? 'Abrir a cidade' : 'Cadastrar cidade';
        ok.disabled = !city;
        foldersBox.innerHTML = folders.map((f, i) => `<button type="button" class="btn-card net-city-folder${f.on ? ' is-on' : ''}" data-folder-i="${i}" aria-pressed="${f.on}">
            <span class="net-city-folder__check" aria-hidden="true">${uiSvgIcon('i-check')}</span>
            <span class="net-city-folder__text"><b>${esc(f.name)}</b><small>${esc(NETWORK_CITY_FOLDER_HINTS[f.name] || 'Pasta criada por você')}</small></span>
        </button>`).join('');
        const chosen = folders.filter(f => f.on).map(f => f.name);
        const name = already || (city ? networkDisplayName(city, stateSelect.value) : 'Rede · (nome da cidade)');
        preview.classList.toggle('is-placeholder', !city);
        preview.innerHTML = `
            <div class="net-city-preview__root">${uiSvgIcon('i-building')}<b>${esc(name)}</b><em>✓ Salva</em></div>
            <div class="net-city-preview__types"><small>Por tipo · automático</small><span>POPs</span><span>CEOs</span><span>CTOs</span><span>Cabos</span><span>Clientes</span></div>
            ${already ? '<div class="net-city-preview__folder is-muted">Abre a cidade como está</div>'
                : chosen.length ? chosen.map(n => `<div class="net-city-preview__folder">${uiSvgIcon('i-folder')}${esc(n)}</div>`).join('')
                : '<div class="net-city-preview__folder is-muted">Sem pastas: os itens ficam direto na cidade</div>'}`;
    };
    modal.style.display = 'flex';
    render();
    listNetworkCities().then(cities => {
        const free = cities.filter(c => !existing.has(getNetworkId(c)));
        list.innerHTML = free.length ? `<small class="net-city-list__label">Cidades dos seus projetos, ainda sem rede</small>${free.map(c => `<button type="button" class="btn-chip net-city" data-city="${esc(c)}">${uiSvgIcon('i-marker')}${esc(c)}</button>`).join('')}` : '';
    }).catch(() => { list.innerHTML = ''; });
    setTimeout(() => input.focus(), 50);
    return new Promise(resolve => {
        const finish = (value) => {
            modal.style.display = 'none';
            modal.removeEventListener('click', onClick);
            modal.removeEventListener('input', render);
            document.removeEventListener('keydown', onKey, true);
            resolve(value);
        };
        const result = () => {
            const city = formatNetworkCityName(input.value);
            return city ? { city, state: stateSelect.value, folders: folders.filter(f => f.on).map(f => f.name), open: existing.has(getNetworkId(city)) } : null;
        };
        const addFolder = () => {
            const name = folderInput.value.trim().replace(/\s+/g, ' ');
            if (!name) return;
            const same = folders.find(f => f.name.toLowerCase() === name.toLowerCase());
            if (same) same.on = true; else folders.push({ name, on: true });
            folderInput.value = '';
            render();
            folderInput.focus();
        };
        const onClick = (e) => {
            const pick = e.target.closest('.net-city');
            if (pick) { input.value = pick.dataset.city; render(); input.focus(); return; }
            const chip = e.target.closest('[data-folder-i]');
            if (chip) { const f = folders[Number(chip.dataset.folderI)]; f.on = !f.on; render(); return; }
            const action = e.target.closest('[data-net-city]')?.dataset.netCity;
            if (action === 'add-folder') { addFolder(); return; }
            if (action === 'cancel' || e.target === modal) finish(null);
            else if (action === 'ok' && result()) finish(result());
            else if (action === 'ok') input.focus();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
            else if (e.key === 'Enter' && e.target === folderInput) { e.preventDefault(); addFolder(); }
            else if (e.key === 'Enter' && e.target === input && result()) { e.preventDefault(); finish(result()); }
        };
        modal.addEventListener('click', onClick);
        modal.addEventListener('input', render);
        document.addEventListener('keydown', onKey, true);
    });
}

//"+ Cidade": cadastra a cidade na rede (com as pastas escolhidas) e deixa selecionada
async function createNetworkCity(name = '', { folders = [], state = '' } = {}) {
    if (!requireEdit('cadastrar cidades na rede')) return null;
    let city = formatNetworkCityName(name);
    if (!city) {
        const picked = await pickNetworkCity();
        if (!picked) return null;
        city = picked.city;
        folders = picked.folders;
        state = picked.state || '';
        try { if (state) localStorage.setItem(networkStateKey(), state); } catch (e) { /* ignora */ }
    }
    const id = getNetworkId(city);
    if (document.getElementById(id)) {
        showToast('Cidade já cadastrada', `"${city}" já está na rede.`, 'progress');
        await showNetworkCity(city);
        return document.getElementById(id)?.closest('.folder') || null;
    }
    const { data: existing } = await supabaseClient.from('projects').select('id').eq('id', id).maybeSingle();
    if (existing) {
        await listNetworksInSidebar();
        await showNetworkCity(city);
        return document.getElementById(id)?.closest('.folder') || null;
    }
    const data = emptyNetworkData(city);
    if (state) { data.sidebar.name = networkDisplayName(city, state); data.sidebar.state = state; }
    data.sidebar.children = folders.map((folderName, i) => ({
        id: `folder-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`, name: folderName, isProject: false, type: 'folder', children: [],
    }));
    rebuildSidebarFromJSON([data.sidebar], document.getElementById('sidebar'));
    updateSidebarEmptyState();
    const root = document.getElementById(id).closest('.folder');
    try {
        await persistProject(root);
    } catch (error) {
        removeProjectFromWorkspace(id, root);
        showAlert('Erro', `Não foi possível cadastrar a cidade. ${error.message || ''}`);
        return null;
    }
    if (typeof liveSyncJoin === 'function') liveSyncJoin(id);
    setActiveFolder(id);
    if (document.getElementById(id)?.classList.contains('hidden')) toggleFolder(id);
    showToast(`Rede · ${city}`, folders.length
        ? `Cidade cadastrada com ${folders.length} pasta${folders.length === 1 ? '' : 's'}. Ela se salva sozinha.`
        : 'Cidade cadastrada. Crie pastas pelo menu ⋮ dela ou comece com + Marcador. Ela se salva sozinha.');
    return root;
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

//O que vai para a rede: as caixas (com o plano de fusão de cada uma) e os cabos. Casas, clientes, postes, polígonos e
//os outros marcadores ficam só no projeto (clientes são ligados nas caixas no modo Rede)
const NETWORK_MARKER_TYPES = new Set(['CTO', 'CEO', 'POP', 'RESERVA', 'TORRE', 'PREDIO']);
const goesToNetwork = (marker) => NETWORK_MARKER_TYPES.has(marker.type);

const walkFolders = (node, visit, parent = null) => {
    visit(node, parent);
    (node.children || []).forEach(child => walkFolders(child, visit, node));
};

function findNetworkFolder(sidebar, id) {
    let found = null;
    walkFolders(sidebar, (node) => { if (!found && node.id === id) found = node; });
    return found;
}

//Tira da rede o que veio de projeto e não é da rede (casas, postes, polígonos: projetos concluídos antes desta regra).
//O que foi incluído direto na rede (clientes, marcadores sem origem em projeto) fica.
function cleanNetworkData(data) {
    const fromProject = (item) => !!item.asBuilt?.projectId;
    const markersIn = data.markers || [];
    const polygonsIn = data.polygons || [];
    const markersOut = markersIn.filter(m => !fromProject(m) || goesToNetwork(m));
    const polygonsOut = polygonsIn.filter(p => !fromProject(p));
    const removed = (markersIn.length - markersOut.length) + (polygonsIn.length - polygonsOut.length);
    return { content: removed ? { ...data, markers: markersOut, polygons: polygonsOut } : data, removed };
}

//Pastas da rede para escolher o destino: [{ id, name, depth }] (a cidade é a primeira, profundidade 0)
function listNetworkFolders(sidebar) {
    const out = [];
    const visit = (node, depth) => {
        out.push({ id: node.id, name: node.name, depth });
        (node.children || []).forEach(child => visit(child, depth + 1));
    };
    if (sidebar) visit(sidebar, 0);
    return out;
}

//Junta o projeto (o JSON salvo) na rede. As caixas e os cabos entram como Existente, com a origem anotada, numa pasta
//nova com o nome do projeto ou numa pasta da rede escolhida (targetFolderId); só as pastas do projeto que têm caixa ou
//cabo vão junto. Item com o mesmo identificador de um que já está na rede é atualizado no lugar (não duplica). Concluir
//de novo o mesmo projeto substitui o que ele tinha mandado. Devolve { network, boxes, cables, plans }.
function mergeProjectIntoNetwork(network, project, meta) {
    const net = JSON.parse(JSON.stringify(network));
    net.markers = net.markers || [];
    net.cables = net.cables || [];
    net.polygons = net.polygons || [];
    net.sidebar.children = net.sidebar.children || [];
    const stamp = { projectId: meta.projectId, projectName: meta.projectName, at: meta.at, by: meta.byName || '' };
    //O que este projeto já tinha mandado sai antes (pastas criadas por ele e os itens com a origem nele)
    const removed = new Set();
    walkFolders(net.sidebar, (node) => {
        const before = (node.children || []).length;
        node.children = (node.children || []).filter(child => {
            if (child.fromProject !== meta.projectId) return true;
            walkFolders(child, (inner) => removed.add(inner.id));
            return false;
        });
        if (node.children.length !== before) node.children.forEach((child, i) => { child.order = i; });
    });
    const fromThis = (item) => item.asBuilt?.projectId === meta.projectId || removed.has(item.folderId);
    ['markers', 'cables', 'polygons'].forEach(key => { net[key] = net[key].filter(item => !fromThis(item)); });
    //Pastas do projeto que têm o que vai para a rede
    const boxes = (project.markers || []).filter(goesToNetwork);
    const cables = project.cables || [];
    const used = new Set([...boxes, ...cables].map(item => item.folderId));
    const keep = (node) => {
        const children = (node.children || []).map(keep).filter(Boolean);
        if (!children.length && !used.has(node.id)) return null;
        return { ...node, isProject: false, type: 'folder', city: null, neighborhood: null, fromProject: meta.projectId, children };
    };
    const folders = (project.sidebar.children || []).map(keep).filter(Boolean);
    const target = meta.targetFolderId ? findNetworkFolder(net.sidebar, meta.targetFolderId) : null;
    let destId;
    if (target) {
        destId = target.id;
        target.children = target.children || [];
        folders.forEach(folder => { folder.order = target.children.length; target.children.push(folder); });
    } else {
        destId = project.sidebar.id;
        net.sidebar.children.push({
            id: destId, name: meta.folderName || project.sidebar.name, isProject: false, type: 'folder',
            fromProject: meta.projectId, order: net.sidebar.children.length, children: folders,
        });
    }
    const folderOf = (id) => (id === project.sidebar.id ? destId : id);
    const upsert = (list, item) => {
        const at = item.uid ? list.findIndex(other => other.uid === item.uid) : -1;
        if (at >= 0) list[at] = { ...item, folderId: list[at].folderId };
        else list.push(item);
    };
    boxes.forEach(marker => upsert(net.markers, toAsBuiltMarker({ ...marker, folderId: folderOf(marker.folderId) }, stamp)));
    cables.forEach(cable => upsert(net.cables, toAsBuiltCable({ ...cable, folderId: folderOf(cable.folderId) }, stamp)));
    //Histórico da rede (js/network/network-docs.js)
    net.changeLog = [...(net.changeLog || []), {
        at: meta.at, by: meta.byName || '', action: 'projeto', name: meta.projectName,
        detail: `${boxes.length} ${boxes.length === 1 ? 'caixa' : 'caixas'} e ${cables.length} ${cables.length === 1 ? 'cabo' : 'cabos'}`,
    }].slice(-500);
    return { network: net, boxes: boxes.length, cables: cables.length, plans: boxes.filter(m => m.fusionPlan).length };
}

//O que o projeto aberto manda para a rede e o que fica só nele
function getProjectSummaryForNetwork(projectId) {
    const folderIds = new Set(getAllDescendantFolderIds(projectId));
    const own = markers.filter(m => folderIds.has(m.folderId));
    const cables = savedCables.filter(c => folderIds.has(c.folderId));
    const count = (type) => own.filter(m => m.type === type).length;
    const boxes = own.filter(goesToNetwork);
    return {
        ctos: count('CTO'), ceos: count('CEO'), pops: count('POP'), reserves: count('RESERVA'), towers: count('TORRE'),
        plans: boxes.filter(m => m.fusionPlan).length,
        cables: cables.length,
        meters: cables.reduce((sum, c) => sum + (Number(c.totalLength) || 0), 0),
        stays: {
            casas: count('CASA'), clientes: count('CLIENTE'), postes: count('POSTE'),
            poligonos: savedPolygons.filter(p => folderIds.has(p.folderId)).length,
            outros: own.filter(m => !goesToNetwork(m) && !['CASA', 'CLIENTE', 'POSTE'].includes(m.type)).length,
        },
        issues: typeof runProjectCheck === 'function' ? runProjectCheck({ projectId, markers: own, cables }).filter(i => i.level === 'erro').length : 0,
    };
}

function ensureConcludeModal() {
    let modal = document.getElementById('concludeProjectModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'concludeProjectModal';
    modal.className = 'modal';
    modal.innerHTML = '<div class="modal-content conclude-modal" role="dialog" aria-labelledby="concludeProjectTitle"></div>';
    document.body.appendChild(modal);
    return modal;
}

//Janela "Enviar para a rede": de onde para onde, o que vai e o que fica, a pasta de destino e os erros da verificação
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
    const esc = (v) => escapeHtml(String(v ?? ''));
    const fmt = (v) => Math.round(v).toLocaleString('pt-BR');
    const networkId = getNetworkId(city);
    const { data: row } = await supabaseClient.from('projects').select('id, data').eq('id', networkId).maybeSingle();
    const folders = listNetworkFolders(row?.data?.sidebar).slice(1);
    const modal = ensureConcludeModal();
    const content = modal.querySelector('.conclude-modal');
    const goes = [
        ['CTO', sum.ctos], ['CEO', sum.ceos], ['POP', sum.pops], ['Reserva técnica', sum.reserves], ['Torre', sum.towers],
        [`Cabo${sum.cables === 1 ? '' : 's'} · ${fmt(sum.meters)} m`, sum.cables], ['Plano de fusão', sum.plans],
    ].filter(([, n]) => n > 0);
    const stays = [['casa', sum.stays.casas], ['cliente', sum.stays.clientes], ['poste', sum.stays.postes], ['polígono', sum.stays.poligonos], ['outro marcador', sum.stays.outros]]
        .filter(([, n]) => n > 0).map(([label, n]) => `${fmt(n)} ${label}${n === 1 ? '' : 's'}`);
    content.innerHTML = `
        <h2 id="concludeProjectTitle">Migrar para o modo Rede</h2>
        <div class="modal-body-content">
            <div class="conclude-flow">
                <div class="conclude-flow__box"><small>Projeto</small><b>${esc(name)}</b></div>
                <span class="conclude-flow__arrow" aria-hidden="true">→</span>
                <div class="conclude-flow__box is-network"><small>Rede${row ? '' : ' (nova)'}</small><b>Rede · ${esc(city)}</b></div>
            </div>
            <h4 class="conclude-sec">Vai para a rede, como Existente</h4>
            ${goes.length ? `<ul class="conclude-goes">${goes.map(([label, n]) => `<li><b>${fmt(n)}</b><span>${esc(label)}</span></li>`).join('')}</ul>`
                : '<p class="conclude-empty">O projeto não tem caixas nem cabos para enviar.</p>'}
            ${stays.length ? `<p class="conclude-stays"><b>Fica só no projeto:</b> ${esc(stays.join(', '))}. Os clientes são ligados nas caixas no modo Rede.</p>` : ''}
            <label class="conclude-sec" for="concludeFolder">Onde fica na rede</label>
            <select id="concludeFolder">
                <option value="">Pasta nova com o nome do projeto</option>
                ${folders.map(f => `<option value="${esc(f.id)}">${'— '.repeat(Math.max(0, f.depth - 1))}${esc(f.name)}</option>`).join('')}
            </select>
            <input type="text" id="concludeFolderName" value="${esc(name)}" aria-label="Nome da pasta nova" />
            ${sum.issues ? `<div class="conclude-warn">⚠ A verificação achou <b>${sum.issues} erro(s)</b>. Vale corrigir antes, para a rede não ficar com pontas soltas. <button type="button" class="btn btn-secondary btn-sm" data-conclude="check">Ver os erros</button></div>` : '<p class="conclude-ok">✓ A verificação não achou erros.</p>'}
            <p class="conclude-note">Depois de migrar, o projeto fica <b>arquivado</b> (Abrir projeto → Arquivados), só para consulta: relatório, PDF e planilha continuam. As mudanças na rede passam a ser feitas no modo Rede.</p>
        </div>
        <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-conclude="cancel">Cancelar</button>
            <button type="button" class="btn btn-success" data-conclude="go"${goes.length ? '' : ' disabled'}>Migrar para a rede</button>
        </div>`;
    const select = content.querySelector('#concludeFolder');
    const folderName = content.querySelector('#concludeFolderName');
    select.addEventListener('change', () => { folderName.hidden = !!select.value; });
    modal.style.display = 'flex';
    const close = () => { modal.style.display = 'none'; modal.onclick = null; };
    modal.onclick = async (e) => {
        const action = e.target.closest('[data-conclude]')?.dataset.conclude;
        if (e.target === modal || action === 'cancel' || action === 'stay') return close();
        if (action === 'close-project') { close(); closeProjectFromWorkspace(projectId); return; }
        if (action === 'check') { close(); setActiveFolder(projectId); openProjectCheck(); return; }
        if (action === 'open') { close(); closeProjectFromWorkspace(projectId); setAppMode('rede', { city }); return; }
        if (action !== 'go') return;
        const go = e.target.closest('[data-conclude="go"]');
        go.disabled = true;
        go.textContent = 'Migrando…';
        try {
            const done = await concludeProject(projectId, { targetFolderId: select.value || null, folderName: folderName.value.trim() || name });
            content.innerHTML = `
                <h2 id="concludeProjectTitle">Projeto na rede</h2>
                <div class="modal-body-content">
                    <p class="conclude-done">✓ <b>${esc(name)}</b> entrou na <b>${esc(done.networkName)}</b>: ${fmt(done.boxes)} caixa(s) e ${fmt(done.cables)} cabo(s)${done.plans ? `, com ${fmt(done.plans)} plano(s) de fusão` : ''}.</p>
                    <p class="conclude-note">${done.archived ? 'O projeto foi <b>arquivado</b>: está em Projeto → Abrir projeto → Arquivados, só para consulta.' : 'O projeto ficou só para consulta.'}</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-conclude="stay">Ver o projeto</button>
                    ${done.archived ? '<button type="button" class="btn btn-secondary" data-conclude="close-project">Fechar o projeto</button>' : ''}
                    <button type="button" class="btn btn-success" data-conclude="open">Abrir a rede</button>
                </div>`;
        } catch (error) {
            console.error('Erro ao concluir o projeto:', error);
            go.disabled = false;
            go.textContent = 'Migrar para a rede';
            showAlert('Erro', `Não foi possível enviar o projeto para a rede. ${error.message || ''}`);
        }
    };
}

//Grava a rede da cidade com o projeto dentro e marca o projeto como concluído. Se outra pessoa salvou a rede no meio
//do caminho, lê de novo e junta outra vez (até 3 tentativas). Devolve a conclusão com o que foi enviado.
async function concludeProject(projectId, { targetFolderId = null, folderName = '' } = {}) {
    const root = document.getElementById(projectId).closest('.folder');
    const title = root.querySelector(':scope > .folder-title');
    const city = title.dataset.folderCity.trim();
    const networkId = getNetworkId(city);
    const networkName = `Rede · ${city}`;
    const record = buildProjectRecord(root);
    const at = new Date().toISOString();
    const byName = AppSession.profile?.full_name || '';
    const meta = { projectId, projectName: record.name, at, byName, folderName: folderName || record.name, targetFolderId };
    for (let attempt = 0; attempt < 3; attempt++) {
        const { data: row, error } = await supabaseClient.from('projects').select('id, data, revision').eq('id', networkId).maybeSingle();
        if (error) throw error;
        const base = row?.data?.sidebar ? row.data : emptyNetworkData(city);
        const merged = mergeProjectIntoNetwork(base, record.data, meta);
        if (row) {
            let query = supabaseClient.from('projects').update({ data: merged.network, name: networkName, city, project_type: NETWORK_PROJECT_TYPE }).eq('id', networkId);
            if (row.revision != null) query = query.eq('revision', row.revision);
            const { data: saved, error: saveError } = await query.select('revision');
            if (saveError) throw saveError;
            if (!saved?.length) continue;
        } else {
            const { error: saveError } = await supabaseClient.from('projects').upsert({
                id: networkId, company_id: AppSession.company.id, created_by: AppSession.userId,
                name: networkName, city, neighborhood: null, project_type: NETWORK_PROJECT_TYPE, data: merged.network,
            }, { onConflict: 'id' });
            if (saveError) throw saveError;
        }
        projectConclusions[projectId] = { at, by: AppSession.userId, byName, networkId, networkName, boxes: merged.boxes, cables: merged.cables, plans: merged.plans };
        try {
            await persistProject(root, { allowConcluded: true });
        } catch (saveError) {
            if (!(saveError instanceof ProjectConflictError)) throw saveError;
            await persistProject(root, { allowConcluded: true, force: true });
        }
        applyProjectConclusionUi(projectId);
        //Migrado para a rede: o projeto fica arquivado em "Abrir projeto → Arquivados"
        if (typeof setProjectArchived === 'function') projectConclusions[projectId].archived = await setProjectArchived(projectId, true, { silent: true });
        if (typeof networkLayer !== 'undefined') { networkLayer.cache.delete(city); scheduleNetworkLayerRefresh(0); }
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

//Tela inicial do cargo (sem link de caixa para abrir): a viabilidade já abre com a consulta de viabilidade; o técnico de
//campo, com as ocorrências abertas com ele (na cidade que tem mais)
async function openRoleHome() {
    if (getPendingFieldLink()) return;
    if (AppSession.isViabilidade && typeof startViability === 'function') { await startViability(); return; }
    if (!AppSession.isTecnico || typeof isMyOccurrence !== 'function') return;
    const { data, error } = await supabaseClient.from('projects').select('id, occurrences:data->occurrences')
        .eq('project_type', NETWORK_PROJECT_TYPE).is('deleted_at', null);
    if (error) return;
    const mine = (data || []).map(row => ({ id: row.id, list: (row.occurrences ?? row.data?.occurrences ?? []).filter(o => isOccurrenceOpen(o) && isMyOccurrence(o)) }))
        .filter(row => row.list.length && document.getElementById(row.id)).sort((a, b) => b.list.length - a.list.length);
    if (!mine.length) return;
    const total = mine.reduce((n, row) => n + row.list.length, 0);
    await loadNetworkRoot(mine[0].id);
    setActiveFolder(mine[0].id);
    occurrences.filter = 'minhas';
    await openNetworkPanel('ocorrencias');
    showToast('Ocorrências com você', `${total} ${total === 1 ? 'ocorrência aberta' : 'ocorrências abertas'}${mine.length > 1 ? ` em ${mine.length} cidades` : ''}. Atrasadas aparecem primeiro.`, 'progress');
}

appReady.then(() => {
    document.querySelectorAll('[data-app-mode]').forEach(button => button.addEventListener('click', () => setAppMode(button.dataset.appMode)));
    document.getElementById('networkAddCityButton')?.addEventListener('click', () => createNetworkCity());
    //"+ Marcador" no modo Rede: o mesmo de Desenhar → Marcador (CTO, CEO, cliente…), na pasta selecionada
    document.getElementById('networkAddMarkerButton')?.addEventListener('click', () => document.getElementById('addMarkerButton')?.click());
    ['createProjectButton', 'loadProjectButton'].forEach(guardProjectOnlyButton);
    wirePendingNetworkClicks();
    applyAppModeUi();
    //Entrar no modo Rede (preferência ou última vez): quando o mapa estiver pronto
    if (getStartupAppMode() === 'rede') appModeStartup = mapReady.then(() => setAppMode('rede', { startup: true })).then(openRoleHome);
});
