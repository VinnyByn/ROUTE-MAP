//Sessão (Supabase): exige login e empresa antes de liberar o sistema.
//supabaseClient, AppSession e loadAppContext vêm de js/supabase-client.js
const appReady = (async () => {
    const { data } = await supabaseClient.auth.getSession();
    if (!data.session) {
        window.location.replace('login.html');
        return new Promise(() => {});
    }
    //Conta com verificação em duas etapas: a sessão só vale depois do código
    try {
        const { data: aal } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') {
            window.location.replace('login.html');
            return new Promise(() => {});
        }
    } catch (e) { /* MFA indisponível: segue com a senha */ }
    await loadAppContext();
    if (!AppSession.company) {
        window.location.replace('login.html');
        return new Promise(() => {});
    }
    return AppSession;
})();

supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.replace('login.html');
});

//Aguarda a sessão; em caso de falha informa e volta para o login
function whenAppReady(callback) {
    appReady.then(callback).catch((error) => {
        console.error('Falha ao carregar a sessão:', error);
        showAlert('Erro', 'Não foi possível carregar sua conta. Entre novamente.');
        setTimeout(() => supabaseClient.auth.signOut(), 2500);
    });
}

const THEME_STORAGE_KEY = 'routeMapTheme';

function getStoredTheme() {
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'dark' || stored === 'light') return stored;
    } catch (e) { /* ignora */ }
    return 'light';
}

function applyTheme(theme) {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', nextTheme);
    try { localStorage.setItem(THEME_STORAGE_KEY, nextTheme); } catch (e) { /* ignora */ }
    const label = document.getElementById('themeToggleLabel');
    const button = document.getElementById('themeToggleButton');
    if (label) label.textContent = nextTheme === 'dark' ? 'Tema claro' : 'Tema escuro';
    if (button) button.setAttribute('aria-pressed', nextTheme === 'dark' ? 'true' : 'false');
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', nextTheme === 'dark' ? '#152028' : '#2f7a94');
    applyMapTheme();
}

//Estilo escuro do mapa (vale para "Mapa" e "Relevo"; satélite não muda)
const DARK_MAP_STYLES = [
    { elementType: 'geometry', stylers: [{ color: '#1d2a33' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#9fb3bf' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#14202a' }] },
    { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#3b4f5c' }] },
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#22323d' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#223540' }] },
    { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#7f98a6' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1f3a33' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#33485a' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a2731' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4a6376' }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#b8c9d3' }] },
    { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2a3c48' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f2a3a' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5d7f93' }] }
];

function applyMapTheme() {
    if (typeof map === 'undefined' || !map) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    map.setOptions({ styles: isDark ? DARK_MAP_STYLES : null });
}

function uiIcon(name, extraClass) {
    const cls = extraClass ? `ui-icon ${extraClass}` : 'ui-icon';
    return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function setupThemeToggle() {
    applyTheme(getStoredTheme());
    const button = document.getElementById('themeToggleButton');
    if (!button || button.dataset.themeWired === '1') return;
    button.dataset.themeWired = '1';
    button.addEventListener('click', (event) => {
        event.preventDefault();
        const nextTheme = getStoredTheme() === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme);
        if (typeof saveUserPreferences === 'function') saveUserPreferences({ theme: nextTheme });
    });
}

let map; //Instância principal do Google Maps
let resolveMapReady;
const mapReady = new Promise(resolve => { resolveMapReady = resolve; }); //Resolvida quando o mapa é criado
let isAddingMarker = false; //Indica que o usuário está no modo colocar marcador
let pendingSplitterInfo = null; //Armazenamento dos dados dos splitter antes de colocar
let selectedMarkerType = ""; //Tipo de marcador selecionado
let cablePath = []; //Array de coordenadas do cabo desenhado
let cablePolyline = null; //Linha temporária no mapa
let isDrawingCable = false; //Indica se a ferramenta de cabo está ativa
let cableDistance = { lancamento: 0, reserva: 0, total: 0 }; //Armazenamento do comprimento dos cabos
let activeFolderId = null; //Id da pasta ou do projeto que está selecionado na barra lateral
let sidebarClipboard = null; //Conteúdo copiado da sidebar (marcador ou pasta)
let selectedSidebarCopyTarget = null; //Item selecionado para copiar na sidebar
let cableMarkers = []; //Marcador auxiliar usado ao editar e desenhar cabos
let suppressNextCableMapClick = false; //Evita clique duplicado no mapa após clicar em marcador
let cableNameAutoFill = { endMarkerName: null, lastValue: null }; //Controle do nome automático do cabo
let savedCables = []; //Array principal contendo todos os cabos salvos
let editingCableIndex = null; //Íncice do cabo que está sendo salvo
let currentCableStatus = "Novo"; //Status para cabo novo
/** Espessura padrão (escala do ícone no mapa) e largura de traço dos cabos */
const DEFAULT_MARKER_SIZE = 4;
const DEFAULT_CABLE_WIDTH_NEW = 4;
const DEFAULT_CABLE_WIDTH_EXISTING = 2;

function getDefaultCableWidthForStatus(status) {
    return status === 'Existente' ? DEFAULT_CABLE_WIDTH_EXISTING : DEFAULT_CABLE_WIDTH_NEW;
}

let selectedSplitterInfo = { type: "", connector: "" }; //Dados do splitter escolhido
let selectedMarkerData = { //Modelo com configuração para novos marcadores
  type: "",
  name: "",
  color: "#ff0000",
  labelColor: "#000000",
  size: DEFAULT_MARKER_SIZE,
  description: "",
  ctoStatus: "Nova",
  ceoStatus: "Nova",
  ceoAccessory: "Raquete",
  cordoalhaStatus: "Nova",
  reservaStatus: "Nova",
  reservaAccessory: "Raquete",
  derivationTCount: 0,
};
let markers = []; //Array com todos os marcadores no mapa
let focusedMapMarkerInfo = null; //Marcador realçado no mapa após seleção na sidebar
let focusedMapMarkerRing = null; //Anel visual de destaque do marcador selecionado
let focusedMapMarkerBounceTimer = null;
let focusedMapMarkerRingTimer = null;
let markerHighlightPersistent = false;
let editingMarkerInfo = null; //Marcador que está sendo editado
let markerEditOriginPosition = null; //Posição do marcador ao abrir a edição
let markerPositionEditSession = null; //Sessão temporária de arraste da posição
let placeMarkerListener = null; //Clique do Google Maps
let activeMarkerForFusion = null; //Caixa aberta no plano de fusão
let editingFolderElement = null; //Elemento da pasta que está sendo editado
let bomState = {}; //Atual lista de material sendo visualizada
let savedBomState = {}; // Estado salvo
let removedMaterials = new Set(); //Itens marcados como removidos
let addedMaterials = {}; //Itens inseridos manualmente na lista de material
let projectBoms = {}; //Cache das listas de materiais
let fusionDrawingState = { //Diagrama de fusão - Desenho
    isActive: false,
    startElement: null,
    points: [],
    tempLine: null,
    tempHandles: []
};
/** Margens do canvas de fusão — itens mais próximos das bordas e entre si */
const FUSION_LAYOUT = { laneInset: '16px', verticalGap: 14, topStart: 12, minCanvasWidth: 540, centerChannelRatio: 0.5 };
let activeLineForAction = null; //Linha de fusão selecionada para edição - exclusão
let isEditingLine = false;
let cableInfoBox; //Informação do cabo
let searchMarker = null; //Marcador com o resultado da busca
let isMeasuring = false; //Régua
let savedPolygons = []; //Array com os polígonos salvos
let isDrawingPolygon = false;
let editingPolygonIndex = null;
let tempPolygon = null;
let draggedLineData = null;
let adjustingKmlMarkerInfo = null; //Marcador importado via KML
let hoverTooltipTimer = null; //Delay do tooltip
let hoverTooltipElement = null; //Elemento visual do tooltip
let projectObservations = {}; // Armazena os texto de observação por Id do projeto
const ABNT_FIBER_COLORS = [ //Padrão das cores de fibra óptica
  "#28a745", // 1. Verde
  "#ffc107", // 2. Amarelo
  "#ffffff", // 3. Branco
  "#007bff", // 4. Azul
  "#dc3545", // 5. Vermelho
  "#800080", // 6. Violeta
  "#a52a2a", // 7. Marrom
  "#e83e8c", // 8. Rosa
  "#343a40", // 9. Preto
  "#6c757d", // 10. Cinza
  "#ff8c00", // 11. Laranja
  "#00ffff", // 12. Aqua
];
const ABNT_GROUP_COLORS = { //Cores dos grupos
  colors: ["#28a745", "#ffc107", "#ffffff"],
  names: ["Verde", "Amarelo", "Branco"],
};

//Marcadores nos quais um cabo pode iniciar, terminar ou ter a ponta ancorada
function isCableAnchorMarkerType(type) {
    return type === "CEO" || type === "CTO" || type === "RESERVA" || type === "POP";
}

//Cliente B2B também é ponta de cabo: o cabo FO é desenhado da CEO/CTO até ele
function isB2BCableAnchor(markerInfo) {
    return markerInfo?.type === 'CLIENTE' && markerInfo.client?.kind === 'b2b';
}

function isCableAnchorMarker(markerInfo) {
    return isCableAnchorMarkerType(markerInfo?.type) || isB2BCableAnchor(markerInfo);
}

function isCableEndpointAnchorCandidate(markerInfo) {
    if (!markerInfo?.marker) return false;
    if (isCableAnchorMarker(markerInfo)) return true;
    if (markerInfo.type === 'Importado') return true;
    return false;
}

function getProjectFolderIdsForItem(folderId) {
    if (!folderId) return null;
    const folderEl = document.getElementById(folderId);
    if (!folderEl) return [folderId];
    const projectRoot = folderEl.closest('.folder');
    const rootId = projectRoot?.querySelector('.folder-title')?.dataset.folderId;
    if (!rootId) return [folderId];
    return getAllDescendantFolderIds(rootId);
}

function getAnchorMarkerCandidatesForFolder(folderId) {
    const folderIds = getProjectFolderIdsForItem(folderId);
    if (!folderIds) return markers.filter(isCableEndpointAnchorCandidate);
    return markers.filter((m) => folderIds.includes(m.folderId) && isCableEndpointAnchorCandidate(m));
}

function getMarkerSidebarIconClass(type) {
    return 'ge-icon-marker';
}

function applyMarkerSidebarColorStyles(markerInfo) {
    const listItem = markerInfo?.listItem;
    if (!listItem) return;
    const sidebarIcon = listItem.querySelector('.ge-item-icon');
    const markerColor = markerInfo.type === 'CASA'
        ? (markerInfo.color || '#ffffff')
        : (markerInfo.color || '#f9a825');
    listItem.classList.add('ge-pro-marker-item');
    if (sidebarIcon) {
        sidebarIcon.style.setProperty('--ge-item-color', markerColor);
        applyMarkerIconToElement(sidebarIcon, markerInfo.type, markerColor, {
            variant: ['b2b', 'predial'].includes(markerInfo.client?.kind) ? markerInfo.client.kind : '',
            faded: markerInfo.client?.status === 'cancelado',
        });
    }
}

function applyCableSidebarColorStyles(cable) {
    const listItem = cable?.item;
    if (!listItem) return;
    const sidebarIcon = listItem.querySelector('.ge-item-icon');
    const cableColor = cable.color || '#3367d6';

    listItem.classList.add('ge-pro-cable-item');
    if (sidebarIcon) {
        sidebarIcon.style.setProperty('--ge-item-color', cableColor);
    }
}



//Função para exibir um alerta personalizado com título e mensaggem
//Agrupa título e "×" num cabeçalho fixo, para o fechar continuar visível ao rolar.
//(O h2 fica intacto: vários fluxos trocam o título com textContent.)
function normalizeModalHeaders() {
  document.querySelectorAll('.modal > .modal-content').forEach(content => {
    const close = content.querySelector(':scope > .close');
    const title = content.querySelector(':scope > h2');
    if (!close || !title || content.querySelector(':scope > .modal-header-v2')) return;
    const header = document.createElement('div');
    header.className = 'modal-header-v2';
    title.before(header);
    header.append(title, close);
    close.setAttribute('role', 'button');
    close.setAttribute('aria-label', 'Fechar');
    close.tabIndex = 0;
  });
}
normalizeModalHeaders();

//Avisos de sucesso/andamento viram notificações discretas; erros e avisos continuam em janela
const TOAST_TITLE_PATTERN = /^(sucesso|salvando|projeto salvo|projeto carregado|projeto excluído|material(is)? adicionado|configurações salvas|copiado|convite)/i;

function showToast(title, message, kind = 'success') {
  let stack = document.getElementById('toastStack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toastStack';
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast--${kind}`;
  const titleEl = document.createElement('strong');
  titleEl.textContent = title;
  const messageEl = document.createElement('span');
  messageEl.textContent = message;
  toast.append(titleEl, messageEl);
  stack.appendChild(toast);
  //"Salvando…" é substituído pela confirmação seguinte; no máximo 3 avisos na tela
  stack.querySelectorAll('.toast--progress').forEach(el => { if (el !== toast) el.remove(); });
  const visible = Array.from(stack.children);
  visible.slice(0, Math.max(0, visible.length - 3)).forEach(el => el.remove());
  setTimeout(() => {
    toast.classList.add('toast--leaving');
    setTimeout(() => toast.remove(), 250);
  }, kind === 'progress' ? 6000 : 3200);
}

function showAlert(title, message) {
  if (TOAST_TITLE_PATTERN.test(String(title || '').trim())) {
    showToast(title, message, /salvando/i.test(title) ? 'progress' : 'success');
    return;
  }
  const alertModal = document.getElementById('alertModal');
  document.getElementById('alertModalTitle').textContent = title;
  document.getElementById('alertModalMessage').textContent = message;
  alertModal.style.display = 'flex';
  focusModalPrimaryButton(alertModal);
}

//Função para exibir uma confirmação com callback
function showConfirm(title, message, onConfirm) {
  const confirmModal = document.getElementById('confirmModal');
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalMessage').textContent = message;
  const confirmButton = document.getElementById('confirmModalConfirmButton');
  const newConfirmButton = confirmButton.cloneNode(true);
  confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);
  //Ações destrutivas: botão vermelho com o verbo da ação ("Excluir", "Remover", "Sair"…)
  const destructiveVerb = String(title || '').match(/^(excluir|remover|sair|apagar|fechar)/i)?.[1];
  newConfirmButton.classList.toggle('btn-destructive', !!destructiveVerb && !/^fechar/i.test(destructiveVerb));
  newConfirmButton.textContent = destructiveVerb
    ? destructiveVerb.charAt(0).toUpperCase() + destructiveVerb.slice(1).toLowerCase()
    : 'Confirmar';
  newConfirmButton.addEventListener('click', () => {
    confirmModal.style.display = 'none';
    onConfirm(); //Função executada se o usuário clicar em "Sim"
  });
  confirmModal.style.display = 'flex';
  focusModalPrimaryButton(confirmModal);
}

//Estado vazio da barra lateral quando não há projeto carregado
function updateSidebarEmptyState() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const existing = document.getElementById('sidebar-empty-state');
    const hasProjectItems = !!sidebar.querySelector(':scope > .folder');
    if (!hasProjectItems) {
        if (!existing) {
            const empty = document.createElement('div');
            empty.id = 'sidebar-empty-state';
            empty.className = 'sidebar-empty-state';
            empty.innerHTML = `
                <div class="empty-icon" aria-hidden="true">${uiIcon('folder', 'ui-icon--lg')}</div>
                <h4>Nenhum projeto aberto</h4>
                <p>Crie um novo projeto ou carregue um existente para começar a desenhar no mapa.</p>
                <button type="button" id="sidebar-empty-create-btn">+ Novo projeto</button>
            `;
            sidebar.appendChild(empty);
        }
    } else if (existing) {
        existing.remove();
    }
}

//Persistência de projetos (Supabase, tabela projects)

//Encontra o elemento raiz (.folder) do projeto que contém a pasta ativa
function getActiveProjectRoot() {
    const activeElement = activeFolderId ? document.getElementById(activeFolderId) : null;
    return activeElement ? activeElement.closest('.folder') : null;
}

//Monta o registro do projeto para o banco a partir da sidebar e do mapa
function buildProjectRecord(projectRootElement) {
    const projectTitleDiv = projectRootElement.querySelector('.folder-title');
    const projectUl = projectRootElement.querySelector('ul.subfolders') || projectRootElement.querySelector('ul');
    const projectId = projectTitleDiv.dataset.folderId;
    const sidebarStructure = {
        id: projectUl.id,
        name: projectTitleDiv.dataset.folderName,
        city: projectTitleDiv.dataset.folderCity || null,
        neighborhood: projectTitleDiv.dataset.folderNeighborhood || null,
        type: projectTitleDiv.dataset.folderType,
        isProject: true,
        children: getSidebarStructureAsJSON(projectUl)
    };
    const allFolderIds = getAllDescendantFolderIds(projectId);
    return {
        id: projectId,
        company_id: AppSession.company.id,
        created_by: AppSession.userId,
        name: sidebarStructure.name,
        city: sidebarStructure.city,
        neighborhood: sidebarStructure.neighborhood,
        project_type: sidebarStructure.type || null,
        data: {
            sidebar: sidebarStructure,
            markers: markers.filter(m => allFolderIds.includes(m.folderId)).map(serializeMarker),
            cables: savedCables.filter(c => allFolderIds.includes(c.folderId)).map(serializeCable),
            polygons: savedPolygons.filter(p => allFolderIds.includes(p.folderId)).map(serializePolygon),
            bom: projectBoms[projectId] || null,
            observations: projectObservations[projectId] || null
        }
    };
}

//Grava (cria ou atualiza) o projeto no banco
async function persistProject(projectRootElement) {
    await appReady;
    if (!AppSession.canEdit) throw new Error('Seu cargo é somente de visualização.');
    const record = buildProjectRecord(projectRootElement);
    const { error } = await supabaseClient.from('projects').upsert(record, { onConflict: 'id' });
    if (error) throw error;
    return record;
}

//Botão "Salvar Projeto"
async function saveActiveProject() {
    if (!requireEdit('salvar projetos')) return;
    const projectRootElement = getActiveProjectRoot();
    if (!projectRootElement) {
        showAlert("Atenção", "Selecione um projeto ou um item dentro de um projeto para salvar.");
        return;
    }
    const projectName = projectRootElement.querySelector('.folder-title')?.dataset.folderName || 'Projeto';
    showAlert("Salvando…", `Salvando o projeto "${projectName}".`);
    try {
        await persistProject(projectRootElement);
        showAlert("Projeto salvo", `O projeto "${projectName}" foi salvo.`);
    } catch (error) {
        console.error("Erro ao salvar projeto:", error);
        showAlert("Erro", `Não foi possível salvar o projeto. ${error.message || ''}`);
    }
}

//Salvamento silencioso após reorganizar itens na sidebar
function saveProjectElement(projectRootElement) {
    if (!projectRootElement || !AppSession.canEdit) return;
    const projectName = projectRootElement.querySelector('.folder-title')?.dataset.folderName || 'Projeto';
    persistProject(projectRootElement).catch((error) => {
        console.error(`Erro ao salvar projeto "${projectName}":`, error);
        showAlert("Erro ao salvar", `Não foi possível salvar a reorganização do projeto "${projectName}".`);
    });
}

function formatRelativeDate(isoDate) {
    if (!isoDate) return '';
    const date = new Date(isoDate);
    const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
    if (diffMin < 1) return 'agora';
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 24) return `há ${diffHours} h`;
    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 7) return `há ${diffDays} ${diffDays === 1 ? 'dia' : 'dias'}`;
    return date.toLocaleDateString('pt-BR');
}

//A janela "Abrir projeto" (busca, filtros e páginas) fica em js/projects.js

//Busca os dados completos do projeto e monta na sidebar/mapa
async function openProjectFromDatabase(projectId, button) {
    if (document.getElementById(projectId)) {
        document.getElementById('loadProjectModal').style.display = 'none';
        return;
    }
    if (button) {
        button.disabled = true;
        button.textContent = 'Abrindo…';
    }
    const { data, error } = await supabaseClient.from('projects').select('id, name, data').eq('id', projectId).single();
    if (error) {
        console.error("Erro ao abrir projeto:", error);
        showAlert("Erro", "Não foi possível abrir o projeto.");
        if (button) {
            button.disabled = false;
            button.textContent = 'Abrir';
        }
        return;
    }
    document.getElementById('loadProjectModal').style.display = 'none';
    loadAndDisplayProject(data.id, { ...(data.data || {}), projectName: data.name });
    if (typeof rememberLastProject === 'function') rememberLastProject(data.id);
}

/*Limpa a barra lateral e o mapa, removendo todos os elementos visuais*/
function clearWorkspace() {
    clearMapMarkerHighlight();
    //Limpeza visual do mapa como os marcadores, cabos e polígonos
    markers.forEach(m => m.marker.setMap(null));
    savedCables.forEach(c => c.polyline.setMap(null));
    savedPolygons.forEach(p => p.polygonObject.setMap(null));
    if (searchMarker) searchMarker.setMap(null);
    //Limpeza da memória, esvaziando as listas que guardam os dados
    markers = [];
    savedCables = [];
    savedPolygons = [];
    //Limpa a sidebar, apagando todo o conteúdo
    document.getElementById("sidebar").innerHTML = '';
    updateSidebarEmptyState();
    //Remove a seleção de pasta
    activeFolderId = null;
    sidebarClipboard = null;
    selectedSidebarCopyTarget = null;
    //Reseta os contados Id para garantir os novos itens comecem com a contagem correta
    projectCounter = 1;
    folderCounter = 1;
}

// Carrega e reconstrói o projeto salvo na barra lateral e no mapa:
function loadAndDisplayProject(projectId, projectData) {
    //Verifica se os dados na barra lateral já existem para evitar erros
    if (!projectData || !projectData.sidebar) {
        console.error("Dados do projeto ou da sidebar estão faltando. Carregamento cancelado.", projectData);
        showAlert("Erro de Dados", "Os dados deste projeto parecem estar corrompidos. Não foi possível carregar.");
        return;
    }
    //Recontrói toda a árvore das pastas na barra lateral
    const sidebar = document.getElementById("sidebar");
    clientDropsSuspended = true;
    rebuildSidebarFromJSON([projectData.sidebar], sidebar);
    updateSidebarEmptyState();
    //Recria os polígonos
    if (projectData.polygons) {
        projectData.polygons.forEach(polygonData => rebuildPolygon(polygonData));
    }
    //Recria os marcadores
    if (projectData.markers) {
        projectData.markers.forEach(markerData => rebuildMarker(markerData));
    }
    //Recria os cabod
    if (projectData.cables) {
        projectData.cables.forEach(cableData => rebuildCable(cableData));
        syncProjectCableMeasurements(savedCables);
    }
    clientDropsSuspended = false;
    applySidebarOrder(document.getElementById(projectId));
    refreshClientDrops({ recompute: true });
    //Recria a lista de material
    if (projectData.bom) {
        projectBoms[projectId] = normalizeBomState(projectData.bom); //Converte nomes antigos de materiais
    }
    //Carrega as observações salvas
    if (projectData.observations) {
        projectObservations[projectId] = projectData.observations;
    }
    showAlert("Sucesso", `Projeto "${projectData.projectName}" carregado!`);
}

//Converte o objeto de marcador para o formato JSON, salvando os dados no banco de dados
function serializeMarker(markerInfo) {
    //Extrai o visual do Google Maps
    const marker = markerInfo.marker;
    //Posição do marcador (latitude e longitude)
    const position = marker.getPosition();
    //Retorna com os dados essenciais a serem salvos
    return {
        uid: markerInfo.uid || null,
        folderId: markerInfo.folderId,
        order: getSidebarOrderIndex(markerInfo.listItem),
        type: markerInfo.type,
        name: markerInfo.name,
        color: markerInfo.color,
        labelColor: markerInfo.labelColor,
        size: markerInfo.size,
        description: markerInfo.description,
        fusionPlan: markerInfo.fusionPlan,
        ctoStatus: markerInfo.ctoStatus,
        needsStickers: markerInfo.needsStickers,
        isPredial: markerInfo.isPredial,
        ceoStatus: markerInfo.ceoStatus,
        ceoAccessory: markerInfo.ceoAccessory,
        is144F: markerInfo.is144F,
        cordoalhaStatus: markerInfo.cordoalhaStatus,
        derivationTCount: markerInfo.derivationTCount,
        reservaStatus: markerInfo.reservaStatus,
        reservaAccessory: markerInfo.reservaAccessory,
        client: markerInfo.type === 'CLIENTE' ? (markerInfo.client || {}) : undefined,
        position: { lat: position.lat(), lng: position.lng() }
    };
}

//Identificador permanente do marcador (usado para ligar cliente → CTO)
function generateMarkerUid() {
    return `mk_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function ensureMarkerUid(markerInfo) {
    if (!markerInfo.uid || markers.some(m => m !== markerInfo && m.uid === markerInfo.uid)) {
        markerInfo.uid = generateMarkerUid();
    }
    return markerInfo.uid;
}

//Converte o objeto de cabo para o formato JSON, salvando os dados no banco de dados
function serializeCable(cableInfo) {
    return {
        folderId: cableInfo.folderId,
        order: getSidebarOrderIndex(cableInfo.item),
        name: cableInfo.name,
        type: cableInfo.type,
        width: cableInfo.width,
        color: cableInfo.color,
        status: cableInfo.status,
        lancamento: cableInfo.lancamento,
        reserva: cableInfo.reserva,
        totalLength: cableInfo.totalLength,
        path: cableInfo.path.map(latLng => ({ lat: latLng.lat(), lng: latLng.lng() })),
        surchargePercent: cableInfo.surchargePercent || 0,
        startAnchorUid: cableInfo.startAnchorUid || null,
        endAnchorUid: cableInfo.endAnchorUid || null,
        startAnchorMarkerName: cableInfo.startAnchorMarkerName || null,
        endAnchorMarkerName: cableInfo.endAnchorMarkerName || null,
        startAnchorMarkerFolderId: cableInfo.startAnchorMarkerFolderId || null,
        endAnchorMarkerFolderId: cableInfo.endAnchorMarkerFolderId || null
    };
}

//Converte o objeto de polígono para o formato JSON, salvando os dados no banco de dados
function serializePolygon(polygonInfo) {
    //Obtem o arry de coordenadas atual
    const currentPath = polygonInfo.polygonObject.getPath().getArray();
    //Retorna com os dados essenciais a serem salvos
    return {
        folderId: polygonInfo.folderId,
        order: getSidebarOrderIndex(polygonInfo.listItem),
        name: polygonInfo.name,
        color: polygonInfo.color,
        opacity: polygonInfo.opacity ?? 0.5,
        path: currentPath.map(p => ({ lat: p.lat(), lng: p.lng() }))
    };
}

//Varre a estrutura da sidebar e converte em JSON
function getSidebarStructureAsJSON(ulElement) {
    const structure = [];
    const children = ulElement.children;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.matches('[data-placeholder="true"]')){
            continue;
        } 
        let titleDiv, subUl, isProject;
        //Verifica se é uma pasta ou projeto
        if (child.classList.contains('folder')) {
            titleDiv = child.querySelector('.folder-title');
            subUl = child.querySelector('ul');
            isProject = true;
        } else if (child.classList.contains('folder-wrapper')) {
            titleDiv = child.querySelector('.folder-title');
            subUl = child.querySelector('ul');
            isProject = false;
        } else {
            continue; 
        }
        //Se encontrou título e sub-lista, cria o objeto correspondente
        if (titleDiv && subUl) {
            const node = {
                id: subUl.id,
                order: getSidebarOrderIndex(child),
                name: titleDiv.dataset.folderName,
                city: titleDiv.dataset.folderCity || null,
                neighborhood: titleDiv.dataset.folderNeighborhood || null,
                type: isProject ? titleDiv.dataset.folderType : 'folder',
                isProject: isProject,
                //Chamada recursiva para processar subpastas
                children: getSidebarStructureAsJSON(subUl)
            };
            structure.push(node);
        }
    }
    return structure;
}

//Reconstruidno a sidebar a partir do JSON
function rebuildSidebarFromJSON(structureArray, parentElement) {
    structureArray.forEach(nodeData => {
        if (!nodeData) return;
        //Seleciona e clona o template de projeto ou pasta
        const templateId = nodeData.isProject ? 'project-template' : 'folder-template';
        const template = document.getElementById(templateId);
        if (!template) {
            console.error(`Template com ID "${templateId}" não encontrado!`);
            return;
        }
        //Preenche os dados
        const clone = template.content.cloneNode(true);
        const titleDiv = clone.querySelector('.folder-title');
        const nameSpan = clone.querySelector('.folder-name-text');
        const subList = clone.querySelector('ul');
        const visibilityControl = clone.querySelector('.visibility-toggle-btn');
        nameSpan.textContent = nodeData.name;
        subList.id = nodeData.id;
        titleDiv.dataset.folderId = nodeData.id;
        titleDiv.dataset.folderName = nodeData.name;
        if (visibilityControl) visibilityControl.dataset.folderId = nodeData.id;
        //Se for projeto restaura cidade, bairro e tipo
        if (nodeData.isProject) {
            titleDiv.dataset.folderCity = nodeData.city;
            titleDiv.dataset.folderNeighborhood = nodeData.neighborhood;
            titleDiv.dataset.folderType = nodeData.type;
        }
        //Evento de expandir e recolher as pastas
        const toggleIcon = titleDiv.querySelector('.toggle-icon');
        toggleIcon.onclick = (e) => { e.stopPropagation(); toggleFolder(nodeData.id); };
        //Pasta selecionada-ativa e arrastar/soltar: delegação na sidebar (js/sidebar.js)
        enableDropOnFolder(subList);
        //Recursão
        if (nodeData.children && nodeData.children.length > 0) {
            rebuildSidebarFromJSON(nodeData.children, subList);
        }
        //Finalização e adiciona ao DOM
        const finalElement = clone.querySelector('.folder') || clone.querySelector('.folder-wrapper');
        if (Number.isFinite(nodeData.order)) finalElement.dataset.order = String(nodeData.order);
        enableDragAndDropForItem(finalElement);
        parentElement.appendChild(finalElement);
    });
}

//Reconstrói os marcadores salvos no mapa e sidebar
function rebuildMarker(data) {
    //Cria o objeto visual no google maps
    const position = new google.maps.LatLng(data.position.lat, data.position.lng);
    const marker = new google.maps.Marker({
        position: position,
        map: map,
        draggable: false
    });
    const nameSpan = document.createElement("span");
    nameSpan.className = 'item-name';
    nameSpan.style.cursor = "pointer";
    const li = buildGeProMapItemRow(nameSpan, marker, getMarkerSidebarIconClass(data.type), data.color || '#f9a825');
    if (Number.isFinite(data.order)) li.dataset.order = String(data.order);
    //Insere o item no pasta correta
    const parentUl = document.getElementById(data.folderId);
    if(parentUl) {
      parentUl.appendChild(li);
    } else {
      console.error(`Elemento pai com ID "${data.folderId}" não encontrado para o marcador "${data.name}"`);
    }
    //Salva a referência na memória global
    const markerInfo = { ...data, position: position, marker: marker, listItem: li };
    ensureMarkerUid(markerInfo);
    markers.push(markerInfo);
    updateMarkerAppearance(markerInfo);
    wireMarkerDrawHoverCursor(marker, markerInfo);
    //Define o comportamento do clique no marcador, com o modo desenho
    marker.addListener("click", () => {
        if (handleSketchMarkerClick(markerInfo)) return;
        if (isDrawingCable) {
            handleAnchorMarkerClickDuringCableDraw(markerInfo);
        } else {
            openMarkerFromUserAction(markerInfo);
        }
    });
    wireMarkerSidebarClick(markerInfo);
    wireMarkerSidebarSelection(markerInfo);
}

//Reconstrói um cabo salvo no mapa e na sidebar
function rebuildCable(data) {
    //Converte as coordenadas salvas para objetos latlong do google maps
    const googleMapsPath = data.path.map(p => new google.maps.LatLng(p.lat, p.lng));
    //Criação da linha visual no mapa
    const polyline = new google.maps.Polyline({
        path: googleMapsPath,
        map: map,
        strokeColor: data.color,
        strokeWeight: data.width,
        clickable: true
    });
    const nameSpan = document.createElement("span");
    nameSpan.className = 'item-name';
    nameSpan.textContent = `${data.name} (${data.status}) - ${data.totalLength}m`;
    nameSpan.style.cursor = "pointer";
    const item = buildGeProMapItemRow(nameSpan, polyline, 'ge-icon-path', data.color);
    if (Number.isFinite(data.order)) item.dataset.order = String(data.order);
    const parentUl = document.getElementById(data.folderId);
    if (parentUl) {
        parentUl.appendChild(item);
    } else {
        console.error(`Falha ao carregar o cabo "${data.name}". A pasta-pai (ID: ${data.folderId}) não foi encontrada no DOM.`);
        polyline.setMap(null); 
        return;
    }
    const cableInfo = { ...data, path: googleMapsPath, polyline: polyline, item: item, surchargePercent: data.surchargePercent || 0 };
    applyCableAnchorsToPath(cableInfo);
    const measurement = calculateCableMeasurement(cableInfo);
    cableInfo.lancamento = measurement.lancamento;
    cableInfo.reserva = measurement.reserva;
    cableInfo.totalLength = measurement.total;
    updateCableSidebarLabel(cableInfo);
    savedCables.push(cableInfo);
    const realIndex = savedCables.length - 1;
    wireCableSidebarClick(cableInfo);
    addCableEventListeners(polyline);
}

//Reconstrói  um polígono salvo no mapa e na sidebar
function rebuildPolygon(data) {
    //Converte as coordenadas salvas para o formato do google maps
    const googleMapsPath = data.path.map(p => new google.maps.LatLng(p.lat, p.lng));
    //Cria o obejto visual do polígono no mapa
    const polygon = new google.maps.Polygon({
        paths: googleMapsPath,
        map: map,
        fillColor: data.color,
        strokeColor: data.color,
        fillOpacity: data.opacity ?? 0.5,
        strokeWeight: 2,
        clickable: true,
        editable: false
    });
    //Cria o item na sidebar
    const template = document.getElementById('polygon-template');
    const clone = template.content.cloneNode(true);
    const li = clone.querySelector('li');
    enableDragAndDropForItem(li);
    if (Number.isFinite(data.order)) li.dataset.order = String(data.order);
    const iconEl = li.querySelector('.ge-icon-polygon');
    if (iconEl) iconEl.style.setProperty('--ge-item-color', data.color);
    const parentUl = document.getElementById(data.folderId);
    if (parentUl) {
      parentUl.appendChild(li);
    } else {
      console.error(`Elemento pai com ID "${data.folderId}" não encontrado para o polígono "${data.name}"`);
    }
    const polygonInfo = { ...data, path: googleMapsPath, polygonObject: polygon, listItem: li };
    savedPolygons.push(polygonInfo);
    refreshPolygonSidebarLabel(polygonInfo);
    wirePolygonInteractions(polygonInfo);
}

const SIDEBAR_WIDTH_STORAGE_KEY = 'routeMapSidebarWidth';
const SIDEBAR_RESIZER_WIDTH = 6;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 720;

function applySidebarWidth(widthPx) {
    const container = document.querySelector('.container');
    if (!container || !widthPx) return;
    container.style.gridTemplateColumns = `${widthPx}px ${SIDEBAR_RESIZER_WIDTH}px 1fr`;
}

function loadSavedSidebarWidth() {
    try {
        const saved = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
        if (!saved) return;
        const width = parseInt(saved, 10);
        if (Number.isFinite(width) && width >= SIDEBAR_MIN_WIDTH && width <= SIDEBAR_MAX_WIDTH) {
            applySidebarWidth(width);
        }
    } catch (_) {
        /* ignore storage errors */
    }
}

function notifyMapResize() {
    if (map && window.google?.maps) {
        google.maps.event.trigger(map, 'resize');
    }
}

function scheduleMapResize() {
    notifyMapResize();
    requestAnimationFrame(() => {
        notifyMapResize();
        if (map) {
            const center = map.getCenter();
            if (center) map.setCenter(center);
        }
    });
}

function makeSidebarResizable() {
    const resizer = document.getElementById('dragHandle');
    const container = document.querySelector('.container');
    if (!resizer || !container) return;

    let isResizing = false;
    let resizeRaf = null;

    const clampWidth = (rawWidth) => {
        const containerWidth = container.getBoundingClientRect().width;
        const maxAllowed = Math.min(SIDEBAR_MAX_WIDTH, Math.floor(containerWidth * 0.65));
        return Math.max(SIDEBAR_MIN_WIDTH, Math.min(rawWidth, maxAllowed));
    };

    const setWidthFromPointer = (clientX) => {
        const containerRect = container.getBoundingClientRect();
        applySidebarWidth(clampWidth(clientX - containerRect.left));
        if (!resizeRaf) {
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = null;
                notifyMapResize();
            });
        }
    };

    const stopResize = (e) => {
        if (!isResizing) return;
        isResizing = false;
        resizer.classList.remove('is-dragging');
        document.body.classList.remove('sidebar-resizing');
        if (e?.pointerId !== undefined) {
            try { resizer.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        }
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);

        const sidebarColumn = document.querySelector('.sidebar-column');
        if (sidebarColumn) {
            const width = Math.round(sidebarColumn.getBoundingClientRect().width);
            try {
                localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
            } catch (_) { /* ignore */ }
        }
        notifyMapResize();
    };

    const onPointerMove = (e) => {
        if (!isResizing) return;
        setWidthFromPointer(e.clientX);
    };

    const onPointerUp = (e) => {
        stopResize(e);
    };

    resizer.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        isResizing = true;
        resizer.classList.add('is-dragging');
        document.body.classList.add('sidebar-resizing');
        try { resizer.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        setWidthFromPointer(e.clientX);
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
    });

    resizer.addEventListener('dblclick', () => {
        container.style.gridTemplateColumns = '';
        try { localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY); } catch (_) { /* ignore */ }
        notifyMapResize();
    });

    window.addEventListener('resize', () => {
        if (!container.style.gridTemplateColumns) return;
        const sidebarColumn = document.querySelector('.sidebar-column');
        if (!sidebarColumn) return;
        applySidebarWidth(clampWidth(sidebarColumn.getBoundingClientRect().width));
        notifyMapResize();
    });
}

function updateDropdownOpenState() {
    document.querySelectorAll('.dropdown').forEach((dropdown) => {
        dropdown.classList.toggle('dropdown-open', !!dropdown.querySelector('.dropdown-content.show'));
    });
}

let dropdownInteractionsReady = false;

function positionDropdownMenu(button, menu) {
    const rect = button.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 240;
    const alignEnd = menu.classList.contains('dropdown-content--user') || !!button.closest('.dropdown-user');
    const rawLeft = alignEnd ? rect.right - menuWidth : rect.left;
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(rawLeft, window.innerWidth - menuWidth - 8))}px`;
}

function setupDropdownInteractions() {
    if (dropdownInteractionsReady) return;
    dropdownInteractionsReady = true;

    document.addEventListener('click', (event) => {
        //Item de menu escolhido: fecha o menu e evita a navegação para "#"
        const menuItem = event.target.closest('.dropdown-content a');
        if (menuItem) {
            if (menuItem.getAttribute('href') === '#') event.preventDefault();
            document.querySelectorAll('.dropdown-content.show').forEach(openDropdown => openDropdown.classList.remove('show'));
            updateDropdownOpenState();
            return;
        }
        if (!event.target.closest('.dropdown')) {
            document.querySelectorAll('.dropdown-content.show').forEach(openDropdown => {
                openDropdown.classList.remove('show');
            });
            updateDropdownOpenState();
        }
    });

    document.querySelectorAll('.dropdown .top-bar-button').forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const dropdown = button.closest('.dropdown');
            const dropdownContent = dropdown?.querySelector('.dropdown-content');
            if (!dropdownContent) return;
            const isAlreadyOpen = dropdownContent.classList.contains('show');
            document.querySelectorAll('.dropdown-content.show').forEach(openDropdown => {
                if (openDropdown !== dropdownContent) {
                    openDropdown.classList.remove('show');
                }
            });
            if (!isAlreadyOpen) {
                dropdownContent.classList.add('show');
                positionDropdownMenu(button, dropdownContent);
            } else {
                dropdownContent.classList.remove('show');
            }
            updateDropdownOpenState();
        });
    });

    window.addEventListener('resize', () => {
        document.querySelectorAll('.dropdown .top-bar-button').forEach(button => {
            const menu = button.closest('.dropdown')?.querySelector('.dropdown-content.show');
            if (menu) positionDropdownMenu(button, menu);
        });
    });
}

function isPointerEventOnMap(event) {
    const mapElement = document.getElementById('map');
    if (!mapElement) return false;
    if (event.target && mapElement.contains(event.target)) return true;
    if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
        const rect = mapElement.getBoundingClientRect();
        return event.clientX >= rect.left
            && event.clientX <= rect.right
            && event.clientY >= rect.top
            && event.clientY <= rect.bottom;
    }
    return false;
}

function suppressCableDrawBrowserMenu(event) {
    if (!event) return;
    event.preventDefault();
}

function shouldSuppressCableDrawBrowserMenu(event) {
    if (isSketchToolActive()) return isPointerEventOnMap(event);
    if (!isDrawingCable) return false;
    if (cableMarkers.length <= 2) return true;
    return isPointerEventOnMap(event);
}

function handleMapContextMenuDuringCableDraw(event) {
    if (!shouldSuppressCableDrawBrowserMenu(event)) return;
    suppressCableDrawBrowserMenu(event);
}

function disableMapRightDoubleClickZoomOut(mapInstance, mapElement) {
    if (!mapInstance || !mapElement) return;

    let restoreDoubleClickZoomTimer = null;
    const RESTORE_DOUBLE_CLICK_ZOOM_MS = 450;

    const restoreDoubleClickZoom = () => {
        clearTimeout(restoreDoubleClickZoomTimer);
        restoreDoubleClickZoomTimer = null;
        mapInstance.setOptions({ disableDoubleClickZoom: false });
    };

    mapInstance.addListener('rightclick', () => {
        mapInstance.setOptions({ disableDoubleClickZoom: true });
        clearTimeout(restoreDoubleClickZoomTimer);
        restoreDoubleClickZoomTimer = setTimeout(restoreDoubleClickZoom, RESTORE_DOUBLE_CLICK_ZOOM_MS);
    });

    mapInstance.addListener('click', restoreDoubleClickZoom);

    mapElement.addEventListener('dblclick', (event) => {
        if (event.button !== 2) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);
}

function initMap() {
    setupDropdownInteractions();
    setupThemeToggle();
    initMaterialCatalog();
    setupMaterialCatalogUI();

    const mapElement = document.getElementById('map');
    if (mapElement && window.google?.maps) {
        mapElement.addEventListener('contextmenu', handleMapContextMenuDuringCableDraw, true);
        document.addEventListener('contextmenu', handleMapContextMenuDuringCableDraw, true);
        map = new google.maps.Map(mapElement, {
            center: { lat: -20.1394, lng: -44.8872 },
            zoom: 10,
        });
        map.addListener("click", handleMapClick);
        map.addListener("rightclick", handleMapRightClick);
        map.addListener("dblclick", () => {
            if (isDrawingCable && cablePath.length >= 2) {
                showAlert("Aviso", "Clique em 'Salvar Cabo' para finalizar.");
            }
        });
        disableMapRightDoubleClickZoomOut(map, mapElement);
        applyMapTheme();
        resolveMapReady(map);
        scheduleMapResize();
        window.addEventListener('load', scheduleMapResize);
    } else {
        console.error('Google Maps não pôde ser inicializado.');
    }

    cableInfoBox = document.getElementById('cableInfoBox');
    //Persistência de dados - Supabase
    document.getElementById('saveProjectButton').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('projectDropdown').classList.remove('show');
        saveActiveProject();
    });
    document.getElementById('quickSaveButton').addEventListener('click', saveActiveProject);
    document.getElementById('loadProjectButton').addEventListener('click', (e) => {
        e.preventDefault();
        openProjectPicker();
    });
    //Modais genéricos
    const alertModal = document.getElementById('alertModal');
    document.getElementById('alertModalOkButton').addEventListener('click', () => alertModal.style.display = 'none');
    const confirmModal = document.getElementById('confirmModal');
    document.getElementById('confirmModalCancelButton').addEventListener('click', () => confirmModal.style.display = 'none');
    //Importação de exportação KML
    document.getElementById('exportKmlButton').addEventListener('click', (e) => {
        e.preventDefault();
        exportProjectToKML();
        document.getElementById('projectDropdown').classList.remove('show');
    });
    const kmlFileInput = document.getElementById('kml-file-input');
    document.getElementById('importKmlButton').addEventListener('click', (e) => {
        e.preventDefault();
        kmlFileInput.click();
        document.getElementById('projectDropdown').classList.remove('show');
    });
    kmlFileInput.addEventListener('change', handleKmlFileSelect);
    //Gerenciamento de projetos - Criar e cancelar
    const projectModal = document.getElementById("projectModal");
    const closeProjectModal = document.getElementById("closeProjectModal");
    const cancelProjectButton = document.getElementById("cancelProjectButton");
    const confirmProjectButton = document.getElementById("confirmProjectButton");
    const createProjectButton = document.getElementById("createProjectButton");
    createProjectButton.addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("projectName").value = "";
        document.getElementById("projectCity").value = "";
        document.getElementById("projectNeighborhood").value = "";
        setProjectTypeValue('TCR');
        document.getElementById('projectDropdown').classList.remove('show');
        projectModal.style.display = "flex";
    });
    const closeProjectModalFunction = () => {
        const projectModal = document.getElementById('projectModal');
        projectModal.querySelector('h2').textContent = 'Novo Projeto';
        projectModal.querySelector('#confirmProjectButton').textContent = 'Criar Projeto';
        document.getElementById('projectCity').closest('div').style.display = 'block';
        document.getElementById('projectNeighborhood').closest('div').style.display = 'block';
        document.getElementById('projectType').closest('div').style.display = 'block';
        projectModal.style.display = "none";
        editingFolderElement = null;
    };
    closeProjectModal.addEventListener("click", closeProjectModalFunction);
    cancelProjectButton.addEventListener("click", closeProjectModalFunction);
    confirmProjectButton.addEventListener("click", createProject);
    //Gerenciamento de pastas
    const folderModal = document.getElementById("folderModal");
    const closeFolderModal = document.getElementById("closeFolderModal");
    const cancelFolderButton = document.getElementById("cancelFolderButton");
    const confirmFolderButton = document.getElementById("confirmFolderButton");
    const createFolderButton = document.getElementById("createFolderButton");
    createFolderButton.addEventListener("click", () => {
        if (!activeFolderId) {
            showAlert("Atenção", "Selecione uma pasta ou projeto para adicionar.");
            return;
        }
        document.getElementById("folderNameInput").value = "";
        folderModal.style.display = "flex";
    });
    const closeFolderModalFunction = () => {
        const folderModal = document.getElementById('folderModal');
        folderModal.querySelector('h2').textContent = 'Nova Pasta';
        folderModal.querySelector('#confirmFolderButton').textContent = 'Criar Pasta';
        folderModal.style.display = "none";
        editingFolderElement = null;
    };
    closeFolderModal.addEventListener("click", closeFolderModalFunction);
    cancelFolderButton.addEventListener("click", closeFolderModalFunction);
    confirmFolderButton.addEventListener("click", createFolder);
    //Lista de materiais
    const materialListButton = document.getElementById('materialListButton');
    materialListButton?.addEventListener("click", () => {
        if (!activeFolderId) {
            showAlert("Atenção", "Por favor, selecione um projeto na barra lateral para ver sua lista de materiais.");
            return;
        }
        //Identifica o projeto raiz
        const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
        if (!projectRootElement) {
            showAlert("Erro", "Item selecionado não pertence a um projeto. Selecione o projeto ou um item dentro dele.");
            return;
        }
        const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
        const projectName = projectRootElement.querySelector('.folder-title').dataset.folderName;
        document.getElementById('materialModalTitle').textContent = `Lista de Materiais: ${projectName}`;
        if (projectBoms[projectId]) {
            const savedSnapshot = JSON.parse(JSON.stringify(projectBoms[projectId]));
            calculateBomState();
            applyPersistedBomEdits(bomState, savedSnapshot);
        } else {
            calculateBomState();
            projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
        }
        renderBomTable();
        materialModal.style.display = "flex";
    });
    //Controles do modal de materiais
    const materialModal = document.getElementById("materialModal");
    const closeMaterialModal = document.getElementById("closeMaterialModal");
    const saveMaterialChangesButton = document.getElementById('saveMaterialChangesButton');
    const recalculateBomButton = document.getElementById('recalculateBomButton');
    const exportMaterialButton = document.getElementById('exportMaterialButton');
    closeMaterialModal.addEventListener("click", () => {
        materialModal.style.display = "none";
    });
    //Salva o estado atual da BOM no objeto global
    saveMaterialChangesButton.addEventListener('click', () => {
        if (!activeFolderId) return;
        const projectId = document.getElementById(activeFolderId).closest('.folder').querySelector('.folder-title').dataset.folderId;
        projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
        showAlert('Sucesso', 'Alterações salvas com sucesso!');
    });
    //Recalcula os itens no mapa
    recalculateBomButton.addEventListener('click', () => {
        if (!activeFolderId) {
            showAlert("Atenção", "Nenhum projeto selecionado para recalcular.");
            return;
        }
        const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
        const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
        showConfirm('Recalcular Lista', 'Isso descartará todas as alterações manuais nesta lista e a recalculará a partir do mapa. Deseja continuar?', () => {
            calculateBomState();
            projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
            renderBomTable();
        });
    });
    exportMaterialButton.addEventListener('click', () => {
        exportTablesToExcel();
    });
    //Modal de adesivos
    const stickersModal = document.getElementById('stickersModal');
    document.getElementById('openStickersModalButton').addEventListener('click', () => {
        //Identifica o projeto e conta as CTOs para exibir a quantidade
        if (!activeFolderId) {
            showAlert("Atenção", "Selecione um projeto para ver os adesivos.");
            return;
        }
        const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
        if (!projectRootElement) {
            showAlert("Erro", "Não foi possível identificar o projeto. Selecione o projeto ou um item dentro dele.");
            return;
        }
        const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
        const { markers: projectMarkers } = getProjectItems(projectId);
        const ctoNames = projectMarkers.filter(m => m.type === 'CTO' && m.needsStickers === true).map(m => m.name);
        const counts = calculateStickerCounts(ctoNames);
        renderStickerCounts(counts);
        stickersModal.style.display = 'flex';
    });
    document.getElementById('closeStickersModal').addEventListener('click', () => {
        stickersModal.style.display = 'none';
    });
    document.getElementById('closeStickersModalButton').addEventListener('click', () => {
        stickersModal.style.display = 'none';
    });
    //Modais de edição manual de materiais e mão de obra
    const editMaterialModal = document.getElementById('editMaterialModal');
    document.getElementById('closeEditMaterialModal').addEventListener('click', () => editMaterialModal.style.display = 'none');
    document.getElementById('cancelEditMaterial').addEventListener('click', () => editMaterialModal.style.display = 'none');
    document.getElementById('confirmEditMaterial').addEventListener('click', handleUpdateMaterial);
    const materialUsageModal = document.getElementById('materialUsageModal');
    document.getElementById('closeMaterialUsageModal')?.addEventListener('click', () => {
        materialUsageModal.style.display = 'none';
    });
    document.getElementById('closeMaterialUsageModalBtn')?.addEventListener('click', () => {
        materialUsageModal.style.display = 'none';
    });
    document.getElementById('laborButton').addEventListener('click', openLaborModal);
    const addMaterialModal = document.getElementById('addMaterialModal');
    const addMaterialButton = document.getElementById('addMaterialButton');
    const closeAddMaterialModal = document.getElementById('closeAddMaterialModal');
    const cancelAddMaterial = document.getElementById('cancelAddMaterial');
    const confirmAddMaterial = document.getElementById('confirmAddMaterial');
    addMaterialButton.addEventListener('click', () => {
        document.getElementById('materialNameInput').value = '';
        document.getElementById('materialQtyInput').value = 1;
        document.getElementById('materialPriceInput').value = 0;
        addMaterialModal.style.display = 'flex';
    });
    closeAddMaterialModal.addEventListener('click', () => addMaterialModal.style.display = 'none');
    cancelAddMaterial.addEventListener('click', () => addMaterialModal.style.display = 'none');
    confirmAddMaterial.addEventListener('click', handleAddNewMaterial);
    //Modais de configuração de mão de obra
    document.getElementById('closeLaborModal').addEventListener('click', () => document.getElementById('laborModal').style.display = 'none');
    document.getElementById('closeOutsourcedDetailsModal').addEventListener('click', () => document.getElementById('outsourcedDetailsModal').style.display = 'none');
    document.getElementById('closeRegionalLaborModal').addEventListener('click', () => document.getElementById('regionalLaborModal').style.display = 'none');
    document.getElementById('cancelRegionalLabor').addEventListener('click', () => document.getElementById('regionalLaborModal').style.display = 'none');
    document.getElementById('confirmRegionalLabor').addEventListener('click', handleRegionalLaborConfirm);
    document.getElementById('closeOutsourcedLaborModal').addEventListener('click', () => document.getElementById('outsourcedLaborModal').style.display = 'none');
    document.getElementById('cancelOutsourcedLabor').addEventListener('click', () => document.getElementById('outsourcedLaborModal').style.display = 'none');
    document.getElementById('confirmOutsourcedLabor').addEventListener('click', handleOutsourcedLaborConfirm);
    document.getElementById('addOutsourcedServiceBtn').addEventListener('click', () => {
        addOutsourcedCustomServiceRow();
        updateOutsourcedCost();
    });
    //Modais de seleção de status e tipos
    const markerTypeModal = document.getElementById("markerTypeModal");
    const closeTypeModalButton = document.getElementById("closeTypeModal");
    closeTypeModalButton.addEventListener("click", () => {
        markerTypeModal.style.display = "none";
    });
    //Datacenter e kits de equipamento
    const datacenterChoiceModal = document.getElementById("datacenterChoiceModal");
    const addDatacenterEquipmentButton = document.getElementById("addDatacenterEquipmentButton");
    const closeDatacenterChoiceModal = document.getElementById("closeDatacenterChoiceModal");
    addDatacenterEquipmentButton.addEventListener("click", () => {
        datacenterChoiceModal.style.display = "flex";
    });
    closeDatacenterChoiceModal.addEventListener("click", () => {
        datacenterChoiceModal.style.display = "none";
    });
    document.querySelectorAll(".datacenter-option").forEach(option => {
        option.addEventListener("click", () => {
            const itemName = option.getAttribute("data-item");
            if (itemName === 'PLACA') {
                const placaKitModal = document.getElementById("placaKitModal");
                document.getElementById('placaCordaoQty').value = 1;
                document.getElementById('placaOltQty').value = 1;
                document.getElementById('placaSfpQty').value = 1;
                placaKitModal.style.display = 'flex';
            } else if (itemName === 'OLT') {
                const oltKitModal = document.getElementById("oltKitModal");
                document.getElementById('oltCordaoQty').value = 1;
                document.getElementById('oltPlacaOltQty').value = 1;
                document.getElementById('oltSfpQty').value = 1;
                oltKitModal.style.display = 'flex';
            } else if (itemName === 'POP') {
                const popKitModal = document.getElementById('popKitModal');
                document.getElementById('popPlacaOltQty').value = 1;
                document.getElementById('popSfpQty').value = 1;
                document.getElementById('popCordaoScApcQty').value = 1;
                const fixedItemsList = document.getElementById('popFixedItemsList');
                fixedItemsList.innerHTML = '';
                getKitComponents('KIT POP').forEach(item => {
                    const li = document.createElement('li');
                    li.innerHTML = `<b>${item.quantity}x</b> ${item.name}`;
                    fixedItemsList.appendChild(li);
                });
                popKitModal.style.display = 'flex';
            }
        });
    });
    //Lógica do kit placa
    const placaKitModal = document.getElementById("placaKitModal");
    const closePlacaKitModal = document.getElementById("closePlacaKitModal");
    const cancelPlacaKit = document.getElementById("cancelPlacaKit");
    const confirmPlacaKit = document.getElementById("confirmPlacaKit");
    const closePlacaModalFn = () => placaKitModal.style.display = 'none';
    closePlacaKitModal.addEventListener("click", closePlacaModalFn);
    cancelPlacaKit.addEventListener("click", closePlacaModalFn);
    confirmPlacaKit.addEventListener("click", () => {
        const projectRootElement = document.getElementById(activeFolderId)?.closest('.folder');
        if (!projectRootElement) {
            showAlert("Erro", "Nenhum projeto selecionado. Não foi possível adicionar o material.");
            return;
        }
        const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
        const cordaoQty = parseInt(document.getElementById('placaCordaoQty').value, 10);
        const oltQty = parseInt(document.getElementById('placaOltQty').value, 10);
        const sfpQty = parseInt(document.getElementById('placaSfpQty').value, 10);
        if (hasSheetKit('KIT PLACA')) {
            //Kit da planilha: cada placa leva o kit completo (cordões, placa com SFPs e licença)
            addKitToBom('KIT PLACA', Math.max(1, oltQty || 1));
        } else {
            if (cordaoQty > 0) addMaterialToBom('CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2m', cordaoQty);
            if (oltQty > 0) addMaterialToBom('PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)', oltQty);
            if (sfpQty > 0) addMaterialToBom('MÓDULO SFP C+ PARA PLACA OLT LINE ANYPON ZTE', sfpQty);
        }
        if (projectBoms[projectId]) {
            bomState = normalizeBomState(JSON.parse(JSON.stringify(projectBoms[projectId])));
        }
        renderBomTable();
        placaKitModal.style.display = 'none';
        datacenterChoiceModal.style.display = 'none';
    });
    //Lógica do kit OLT
    const oltKitModal = document.getElementById("oltKitModal");
    const closeOltKitModal = document.getElementById("closeOltKitModal");
    const cancelOltKit = document.getElementById("cancelOltKit");
    const confirmOltKit = document.getElementById("confirmOltKit");
    const closeOltModalFn = () => oltKitModal.style.display = 'none';
    closeOltKitModal.addEventListener("click", closeOltModalFn);
    cancelOltKit.addEventListener("click", closeOltModalFn);
    confirmOltKit.addEventListener("click", () => {
        const projectRootElement = document.getElementById(activeFolderId)?.closest('.folder');
        if (!projectRootElement) {
            showAlert("Erro", "Nenhum projeto selecionado. Não foi possível adicionar o material.");
            return;
        }
        const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
        const cordaoQty = parseInt(document.getElementById('oltCordaoQty').value, 10);
        const placaOltQty = parseInt(document.getElementById('oltPlacaOltQty').value, 10);
        const sfpQty = parseInt(document.getElementById('oltSfpQty').value, 10);
        if (hasSheetKit('KIT OLT')) {
            //Kit da planilha já inclui a primeira placa; placas a mais entram pelo kit placa
            addKitToBom('KIT OLT');
            if (placaOltQty > 1) addKitToBom('KIT PLACA', placaOltQty - 1);
        } else {
            if (cordaoQty > 0) addMaterialToBom('CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2m', cordaoQty);
            if (placaOltQty > 0) addMaterialToBom('PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)', placaOltQty);
            if (sfpQty > 0) addMaterialToBom('MÓDULO SFP C+ PARA PLACA OLT LINE ANYPON ZTE', sfpQty);
            getKitComponents('KIT OLT').forEach(item => addMaterialToBom(item.name, item.quantity));
        }
        if (projectBoms[projectId]) {
            bomState = normalizeBomState(JSON.parse(JSON.stringify(projectBoms[projectId])));
        }
        renderBomTable();
        oltKitModal.style.display = 'none';
        datacenterChoiceModal.style.display = 'none';
    });
    //Lógica do kit POP
    const popKitModal = document.getElementById('popKitModal');
    const closePopKitModal = document.getElementById('closePopKitModal');
    const cancelPopKit = document.getElementById('cancelPopKit');
    const confirmPopKit = document.getElementById('confirmPopKit');
    const closePopModalFn = () => popKitModal.style.display = 'none';
    closePopKitModal.addEventListener('click', closePopModalFn);
    cancelPopKit.addEventListener('click', closePopModalFn);
    confirmPopKit.addEventListener("click", () => {
        const projectRootElement = document.getElementById(activeFolderId)?.closest('.folder');
        if (!projectRootElement) {
            showAlert("Erro", "Nenhum projeto selecionado. Não foi possível adicionar o material.");
            return;
        }
        const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
        const placaOltQty = parseInt(document.getElementById('popPlacaOltQty').value, 10);
        const sfpQty = parseInt(document.getElementById('popSfpQty').value, 10);
        const cordaoScApcQty = parseInt(document.getElementById('popCordaoScApcQty').value, 10);
        if (hasSheetKit('KIT POP')) {
            //Kit da planilha já inclui a primeira placa; placas a mais entram pelo kit placa
            addKitToBom('KIT POP');
            if (placaOltQty > 1) addKitToBom('KIT PLACA', placaOltQty - 1);
        } else {
            if (placaOltQty > 0) addMaterialToBom('PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)', placaOltQty);
            if (sfpQty > 0) addMaterialToBom('MÓDULO SFP C+ PARA PLACA OLT LINE ANYPON ZTE', sfpQty);
            if (cordaoScApcQty > 0) addMaterialToBom('CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2m', cordaoScApcQty);
            getKitComponents('KIT POP').forEach(item => addMaterialToBom(item.name, item.quantity));
        }
        if (projectBoms[projectId]) {
            bomState = normalizeBomState(JSON.parse(JSON.stringify(projectBoms[projectId])));
        }
        renderBomTable();
        popKitModal.style.display = 'none';
        datacenterChoiceModal.style.display = 'none';
    });
    //Plano de fusão (js/fusion.js)
    setupFusionModal();
    //Modal de Relatório
    const projectReportButton = document.getElementById("projectReportButton");
    const reportModal = document.getElementById("reportModal");
    const closeReportModal = document.getElementById("closeReportModal");
    const backToProjectList = document.getElementById("backToProjectList");
    projectReportButton.addEventListener("click", openReportModal);
    closeReportModal.addEventListener("click", () => { reportModal.style.display = "none"; });
    backToProjectList.addEventListener("click", () => {
        document.getElementById("report-project-details").classList.add("hidden");
        document.getElementById("report-project-list").classList.remove("hidden");
        document.querySelector('#reportModal .report-modal').classList.remove('is-details');
        document.getElementById('reportModalTitle').textContent = 'Relatório do projeto';
    });
    const reportProjectSearch = document.getElementById("reportProjectSearch");
    if (reportProjectSearch) {
        reportProjectSearch.addEventListener("input", filterReportProjectList);
    }
    const exportReportPdfButton = document.getElementById("exportReportPdfButton");
    if (exportReportPdfButton) {
        exportReportPdfButton.addEventListener("click", openReportPreviewModal);
    }
    document.getElementById('closeReportPreviewModal')?.addEventListener('click', closeReportPreviewModal);
    document.getElementById('cancelReportPreviewButton')?.addEventListener('click', closeReportPreviewModal);
    window.addEventListener('resize', scheduleReportPreviewRelayout);
    document.getElementById('confirmReportPdfExportButton')?.addEventListener('click', confirmReportPdfExport);
    document.getElementById('confirmReportWordExportButton')?.addEventListener('click', confirmReportWordExport);
    document.getElementById('resetReportPreviewButton')?.addEventListener('click', resetReportPreview);
    setupReportOptions();
    //Ações gerais e sidebar
    updateSidebarEmptyState();
    document.addEventListener('keydown', (e) => {
        if (handleEscapeKey(e)) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (handleEnterConfirmation(e)) return;
        if (handleSketchKeyboard(e)) return;
        if (handleMapKeyboardPan(e)) return;
        if (!(e.ctrlKey || e.metaKey) || isEditableKeyboardTarget(e.target)) return;
        const key = e.key.toLowerCase();
        if (key === 'c' && copySidebarSelection()) {
            e.preventDefault();
        } else if (key === 'v' && pasteSidebarClipboard()) {
            e.preventDefault();
        }
    }, true);
    //Eventos de menu, visibilidade, edição e exclusão
    document.getElementById("sidebar").addEventListener('click', (e) => {
        if (e.target.closest('#sidebar-empty-create-btn')) {
            e.preventDefault();
            document.getElementById('createProjectButton')?.click();
            return;
        }
        //Três pontinhos: menu de ações da linha (js/sidebar.js)
        const actionToggleButton = e.target.closest('.item-actions-toggle-btn');
        if (actionToggleButton) {
            e.preventDefault();
            e.stopPropagation();
            openSidebarMenuFromButton(actionToggleButton);
            return;
        }
        const visibilityButton = e.target.closest('.visibility-toggle-btn:not(.item-toggle)');
        if (visibilityButton && visibilityButton.type !== 'checkbox') {
            handleVisibilityToggle(visibilityButton);
        }
    });
    //Modal de busca
    const openSearchModalButton = document.getElementById('openSearchModalButton');
    const searchModal = document.getElementById('searchModal');
    const closeSearchModal = document.getElementById('closeSearchModal');
    const structuredSearchButton = document.getElementById('structuredSearchButton');
    openSearchModalButton.addEventListener('click', () => {
        document.getElementById('searchCoordinates').value = '';
        searchModal.style.display = 'flex';
    });
    closeSearchModal.addEventListener('click', () => {
        searchModal.style.display = 'none';
    });
    structuredSearchButton.addEventListener('click', performStructuredSearch);
    //Ferramentas: Polígono, régua, painel do cabo e Logout
    setupMapSketchTools();
    setupCablePanelControls();
    const logoutButton = document.getElementById('logoutButton');
    if (logoutButton) {
        logoutButton.addEventListener('click', (event) => {
            event.preventDefault();
            Promise.resolve(supabaseClient.rpc('go_offline')).catch(() => {}).then(() => supabaseClient.auth.signOut()).then(({ error }) => {
                if (error) throw error;
                window.location.replace('login.html');
            }).catch((error) => {
                console.error('Erro ao fazer logout:', error);
                showAlert('Erro', 'Não foi possível sair. Tente novamente.');
            });
        });
    }
    //Redimensionamento da sidebar
    loadSavedSidebarWidth();
    makeSidebarResizable();
    initSidebarFolderContextMenu();
    initSidebarFolderClickBehavior();
    initSplitterOltConfigModal();
    //Hover para textos longos na sidebar
    window.addEventListener('click', function(e) {
        if (!e.target.closest('.item-actions-dropdown')) {
            document.querySelectorAll('.item-actions-menu.show').forEach(openMenu => {
                openMenu.classList.remove('show');
            });
        }
    });
    hoverTooltipElement = document.createElement('div');
    hoverTooltipElement.id = 'hover-tooltip';
    document.body.appendChild(hoverTooltipElement);
    const sidebar = document.getElementById('sidebar');
    // Função para esconder o tooltip
    const hideTooltip = () => {
        clearTimeout(hoverTooltipTimer);
        hoverTooltipTimer = null;
        if (hoverTooltipElement) {
            hoverTooltipElement.style.opacity = '0';
            setTimeout(() => {
                if (!hoverTooltipTimer) { 
                    hoverTooltipElement.style.display = 'none';
                }
            }, 200);
        }
    };
    //Monitora o MOUSEOVER na sidebar inteira
    sidebar.addEventListener('mouseover', (e) => {
        // Verifica se o mouse está sobre um nome de pasta ou item
        const target = e.target.closest('.folder-name-text, .item-name');
        if (!target) {
            hideTooltip();
            return;
        }
        const isTruncated = target.scrollWidth > target.clientWidth;
        if (isTruncated) {
            clearTimeout(hoverTooltipTimer);
            const fullText = target.textContent;
            const rect = target.getBoundingClientRect();
            const posX = rect.left;
            const posY = rect.bottom + 5;
            hoverTooltipTimer = setTimeout(() => {
            hoverTooltipElement.textContent = fullText;
                hoverTooltipElement.style.left = `${posX}px`;
                hoverTooltipElement.style.top = `${posY}px`;
                hoverTooltipElement.style.display = 'block';
                requestAnimationFrame(() => {
                    hoverTooltipElement.style.opacity = '1';
                });
            }, 2000);
        } else {
            hideTooltip();
        }
    });
    sidebar.addEventListener('mouseleave', hideTooltip);

    sidebar.addEventListener('change', (e) => {
        const folderCheckbox = e.target.closest('.ge-vis-checkbox.visibility-toggle-btn:not(.item-toggle)');
        if (folderCheckbox && folderCheckbox.dataset.folderId) {
            handleVisibilityToggle(folderCheckbox, folderCheckbox.checked);
        }
    });

    //Modal de observações
    const observationsModal = document.getElementById('observationsModal');
    const openObservationsButton = document.getElementById('openObservationsButton');
    const closeObservationsModal = document.getElementById('closeObservationsModal');
    const cancelObservationButton = document.getElementById('cancelObservationButton');
    const saveObservationButton = document.getElementById('saveObservationButton');
    // Botão Adicionar/Editar Observações
    openObservationsButton.addEventListener('click', () => {
        // Pega o ID do projeto que o relatório está exibindo
        const projectId = document.getElementById('report-project-details').dataset.currentProjectId;
        if (!projectId) {
            showAlert("Erro", "Não foi possível identificar o projeto.");
            return;
        }
        document.getElementById('observationProjectId').value = projectId;
        const textarea = document.getElementById('observationsTextarea');
        textarea.value = projectObservations[projectId] || '';
        updateObservationsCounter();
        observationsModal.style.display = 'flex';
        setTimeout(() => textarea.focus(), 30);
    });
    document.getElementById('observationsTextarea').addEventListener('input', updateObservationsCounter);
    const closeObsModalFn = () => {
        observationsModal.style.display = 'none';
    };
    closeObservationsModal.addEventListener('click', closeObsModalFn);
    cancelObservationButton.addEventListener('click', closeObsModalFn);
    // Botão Salvar Observação no objeto global
    saveObservationButton.addEventListener('click', () => {
        const projectId = document.getElementById('observationProjectId').value;
        const newText = document.getElementById('observationsTextarea').value;
        if (!projectId) {
            showAlert("Erro", "ID do projeto perdido. Não foi possível salvar.");
            return;
        }
        projectObservations[projectId] = newText.trim();
        observationsModal.style.display = 'none';
        //Atualiza o painel do relatório na hora e grava o projeto no banco
        const projectTitle = document.getElementById(projectId)?.previousElementSibling;
        renderReportObservations(projectObservations[projectId]);
        const projectRoot = document.getElementById(projectId)?.closest('.folder');
        if (projectRoot && AppSession.canEdit) {
            persistProject(projectRoot)
                .then(() => showToast('Observações salvas', `Gravadas no projeto "${projectTitle?.dataset.folderName || ''}".`))
                .catch((error) => {
                    console.error('Erro ao salvar observações:', error);
                    showToast('Observações guardadas', 'Não foi possível gravar no banco agora. Salve o projeto para não perder.', 'progress');
                });
        }
    });
}

function updateObservationsCounter() {
    const textarea = document.getElementById('observationsTextarea');
    const counter = document.getElementById('observationsCounter');
    if (counter) counter.textContent = `${textarea.value.length.toLocaleString('pt-BR')} caracteres`;
}

//Cartão "Observações" do painel do relatório
function renderReportObservations(text) {
    const notes = document.getElementById('rv-notes');
    if (!notes) return;
    const hasNotes = !!(text && text.trim());
    notes.textContent = hasNotes ? text.trim() : 'Nenhuma observação registrada. Use o botão Observações para adicionar.';
    notes.classList.toggle('is-empty', !hasNotes);
}















//Diz se o cabo está em algum plano de fusão salvo e se tem fusões
function checkCableUsageInFusionPlans(cableInfo) {
    const usage = { isInPlan: false, hasFusions: false, locations: [] };
    if (!cableInfo?.name) return usage;
    const cableName = cableInfo.name.trim();
    markers.filter(m => (m.type === 'CEO' || m.type === 'CTO') && m.fusionPlan).forEach(markerInfo => {
        try {
            const planData = JSON.parse(markerInfo.fusionPlan);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = planData.elements || planData.canvas || '';
            const cableEl = Array.from(tempDiv.querySelectorAll('.cable-element')).find(el => (el.dataset.cableName || '').trim() === cableName);
            if (!cableEl) return;
            usage.isInPlan = true;
            if (!usage.locations.includes(markerInfo.name)) usage.locations.push(markerInfo.name);
            if (!planData.svg) return;
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.innerHTML = planData.svg;
            const fiberIds = Array.from(cableEl.querySelectorAll('.fiber-row')).map(f => f.id);
            const fused = Array.from(svg.querySelectorAll('.fusion-line')).some(line => fiberIds.includes(line.dataset.startId) || fiberIds.includes(line.dataset.endId));
            if (fused) usage.hasFusions = true;
        } catch (e) {
            console.error(`Erro ao verificar o plano de fusão da caixa "${markerInfo.name}":`, e);
        }
    });
    return usage;
}

//Remove o cabo (sem fusões) dos planos de fusão salvos
function removeCableFromSavedFusionPlans(cableName, markerNames) {
    markers.forEach(markerInfo => {
        if (!markerNames.includes(markerInfo.name) || !markerInfo.fusionPlan) return;
        try {
            const planData = JSON.parse(markerInfo.fusionPlan);
            const html = planData.elements || planData.canvas;
            if (!html) return;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            const cableElement = Array.from(tempDiv.querySelectorAll('.cable-element')).find(el => el.dataset.cableName === cableName);
            if (!cableElement) return;
            cableElement.remove();
            if (planData.elements !== undefined) planData.elements = tempDiv.innerHTML;
            else planData.canvas = tempDiv.innerHTML;
            markerInfo.fusionPlan = JSON.stringify(planData);
        } catch (e) {
            console.error(`Erro ao remover o cabo do plano de fusão da caixa "${markerInfo.name}":`, e);
        }
    });
}

//Remoção do material da BOM
function removeMaterialFromBom(materialName, quantity) {
    if (!activeFolderId) return;
    materialName = resolveMaterialName(materialName);
    //Identifica o projeto raiz do elemento que está ativo
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) return;
    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    //Decrementa quantidade se o material existir na lista
    if (projectBoms[projectId] && projectBoms[projectId][materialName]) {
        projectBoms[projectId][materialName].quantity -= quantity;
        if (projectBoms[projectId][materialName].quantity < 0) {
            projectBoms[projectId][materialName].quantity = 0;
        }
    }
}

//Exclusão completa de um projeto
function deleteProject(projectId, projectElement, projectName) {
    if (!requireEdit('excluir projetos')) return;
    const message = `Excluir o projeto "${projectName}" e todo o seu conteúdo do banco de dados? Ele deixará de aparecer para toda a equipe. Esta ação não pode ser desfeita.`;
    showConfirm('Excluir projeto', message, async () => {
        const { data, error } = await supabaseClient.from('projects').delete().eq('id', projectId).select('id');
        if (error) {
            console.error('Erro ao excluir projeto:', error);
            showAlert('Erro', 'Não foi possível excluir o projeto do banco de dados.');
            return;
        }
        //Nada apagado: projeto nunca salvo, ou o usuário não é o autor nem admin
        if (!data.length && await projectExistsInDatabase(projectId)) {
            showAlert('Sem permissão', 'Somente quem criou o projeto ou um administrador da empresa pode excluí-lo.');
            return;
        }
        removeProjectFromWorkspace(projectId, projectElement);
        showAlert('Projeto excluído', `O projeto "${projectName}" foi excluído.`);
    });
}

async function projectExistsInDatabase(projectId) {
    const { data } = await supabaseClient.from('projects').select('id').eq('id', projectId).maybeSingle();
    return !!data;
}

//Fecha o projeto na tela (continua salvo no banco)
function closeProject(projectId, projectElement, projectName) {
    showConfirm('Fechar projeto', `Fechar "${projectName}"? Alterações não salvas serão perdidas. O projeto continua disponível em Projeto → Carregar Projeto.`, () => {
        removeProjectFromWorkspace(projectId, projectElement);
    });
}

//Remove marcadores, cabos, polígonos e a árvore do projeto da tela
function removeProjectFromWorkspace(projectId, projectElement) {
    {
        //Identifica todas as subpastas vinculadas ao projeto
        const folderIdsToDelete = getAllDescendantFolderIds(projectId);
        //Remoção marcadores
        const markersToRemove = markers.filter(m => folderIdsToDelete.includes(m.folderId));
        markersToRemove.forEach(m => m.marker.setMap(null));
        markers = markers.filter(m => !folderIdsToDelete.includes(m.folderId));
        //Remoção dos cabos
        const cablesToRemove = savedCables.filter(c => folderIdsToDelete.includes(c.folderId));
        cablesToRemove.forEach(c => c.polyline.setMap(null));
        savedCables = savedCables.filter(c => !folderIdsToDelete.includes(c.folderId));
        //Remoção dos polígonos
        const polygonsToRemove = savedPolygons.filter(p => folderIdsToDelete.includes(p.folderId));
        polygonsToRemove.forEach(p => p.polygonObject.setMap(null));
        savedPolygons = savedPolygons.filter(p => !folderIdsToDelete.includes(p.folderId));
        //Limpeza final
        projectElement.remove();
        if (folderIdsToDelete.includes(activeFolderId)) {
            activeFolderId = null;
        }
        delete projectObservations[projectId];
        delete projectBoms[projectId];
        updateSidebarEmptyState();
    }
}

//Exclusão de pasta e conteúdo
function deleteFolder(folderId, folderElement, folderName) {
    if (!requireEdit('excluir pastas')) return;
    const message = `Tem certeza que deseja excluir a pasta "${folderName}" e todos os seus conteúdos? Esta ação não pode ser desfeita.`;
    showConfirm('Excluir Pasta', message, () => {
        //Identifica hierarquia de pastas a serem removidas
        const folderIdsToDelete = getAllDescendantFolderIds(folderId);
        //Remoção dos marcadores
        const markersToRemove = markers.filter(m => folderIdsToDelete.includes(m.folderId));
        markersToRemove.forEach(m => m.marker.setMap(null));
        markers = markers.filter(m => !folderIdsToDelete.includes(m.folderId));
        //Remoção das pastas
        const cablesToRemove = savedCables.filter(c => folderIdsToDelete.includes(c.folderId));
        cablesToRemove.forEach(c => c.polyline.setMap(null));
        savedCables = savedCables.filter(c => !folderIdsToDelete.includes(c.folderId));
        //Remoção dos polígonos
        const polygonsToRemove = savedPolygons.filter(p => folderIdsToDelete.includes(p.folderId));
        polygonsToRemove.forEach(p => p.polygonObject.setMap(null));
        savedPolygons = savedPolygons.filter(p => !folderIdsToDelete.includes(p.folderId));
        //Atualização da interface e estado
        folderElement.remove();
        if (folderIdsToDelete.includes(activeFolderId)) {
            activeFolderId = null;
        }
        showAlert("Sucesso", `Pasta "${folderName}" excluída com sucesso.`);
    });
}


function getCableRoleAtMarker(cable, markerPosition, markerInfo = null) {
    if (!cable?.path?.length || !markerPosition) return null;
    if (markerInfo?.uid) {
        if (cable.startAnchorUid === markerInfo.uid) return 'saida';
        if (cable.endAnchorUid === markerInfo.uid) return 'entrada';
    }
    if (markerInfo?.name && !cable.startAnchorUid && !cable.endAnchorUid) {
        if (cable.startAnchorMarkerName === markerInfo.name) return 'saida';
        if (cable.endAnchorMarkerName === markerInfo.name) return 'entrada';
    }
    const startPoint = cable.path[0];
    const atStart = google.maps.geometry.spherical.computeDistanceBetween(markerPosition, startPoint) < 1;
    return atStart ? 'saida' : 'entrada';
}




















//Criação visual de splitter no canvas de fusão
function getSplitterLabelText(splitterElement) {
    return splitterElement?.querySelector('.splitter-label-text')?.textContent.trim()
        || splitterElement?.querySelector('.splitter-body span')?.textContent.trim()
        || '';
}

function formatSplitterOltSummary(olt, placa, pon, { compact = false } = {}) {
    const parts = [];
    if (olt) parts.push(compact ? olt : `OLT ${olt}`);
    if (placa) parts.push(compact ? `P${placa}` : `Placa ${placa}`);
    if (pon) parts.push(compact ? `PON${pon}` : `PON ${pon}`);
    return parts.join(compact ? ' / ' : ' · ');
}

function getSplitterOltValues(splitterElement) {
    return {
        olt: splitterElement?.dataset.oltName || '',
        placa: splitterElement?.dataset.placaNumber || '',
        pon: splitterElement?.dataset.ponNumber || '',
    };
}


//Editor de OLT, placa e PON do splitter: js/fusion.js


// Controle de cursor do mapa
function setMapCursor(cursor) {
    const mapContainer = document.getElementById("map");
    const layers = mapContainer.querySelectorAll("div, canvas");
    //Aplica o cursor forçadamente a todas as camadas do mapa
    layers.forEach((el) => {
        el.style.cursor = cursor || "";
    });
}

//Durante o desenho do cabo, o ponteiro vira mãozinha sobre os marcadores (dá para clicar) e volta à mira fora deles
//Fora do desenho, CTO e CEO mostram o resumo do plano de fusão (js/marker-hover.js)
function wireMarkerDrawHoverCursor(marker, markerInfo) {
    marker.addListener("mouseover", (e) => {
        if (isDrawingCable) return setMapCursor("pointer");
        if (typeof showMarkerHoverCard === 'function') showMarkerHoverCard(markerInfo, e?.domEvent);
    });
    marker.addListener("mouseout", () => {
        if (isDrawingCable) setMapCursor("crosshair");
        if (typeof hideMarkerHoverCard === 'function') hideMarkerHoverCard();
    });
    marker.addListener("mousedown", () => { if (typeof hideMarkerHoverCard === 'function') hideMarkerHoverCard(true); });
}

//Painel Locais — helpers estilo Google Earth Pro
function createGeProExpandSpacer() {
    const el = document.createElement('span');
    el.className = 'ge-expand-spacer';
    el.setAttribute('aria-hidden', 'true');
    return el;
}

function createGeProVisibilityCheckbox(options = {}) {
    const { folderId = null, isItem = false, visible = true } = options;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'ge-vis-checkbox visibility-toggle-btn' + (isItem ? ' item-toggle' : '');
    cb.checked = visible;
    cb.dataset.visible = String(visible);
    if (folderId) cb.dataset.folderId = folderId;
    cb.title = visible ? 'Ocultar no mapa' : 'Exibir no mapa';
    return cb;
}

function buildGeProMapItemRow(nameSpan, mapObject, iconClass, iconColor) {
    const li = document.createElement('li');
    li.className = 'sidebar-tree-item ge-pro-row ge-pro-item';
    enableDragAndDropForItem(li);
    li.appendChild(createGeProExpandSpacer());
    const visibilityCb = createGeProVisibilityCheckbox({ isItem: true, visible: true });
    li.appendChild(visibilityCb);
    const icon = document.createElement('span');
    icon.className = `ge-item-icon ${iconClass}`;
    icon.setAttribute('aria-hidden', 'true');
    if (iconColor) icon.style.setProperty('--ge-item-color', iconColor);
    li.appendChild(icon);
    li.appendChild(nameSpan);
    const meta = document.createElement('span');
    meta.className = 'item-meta';
    meta.hidden = true;
    li.appendChild(meta);
    const actions = document.createElement('div');
    actions.className = 'ge-pro-actions';
    actions.innerHTML = '<button type="button" class="item-actions-toggle-btn" title="Ações" aria-label="Ações" aria-haspopup="menu">&#8942;</button>';
    li.appendChild(actions);
    wireItemVisibilityCheckbox(visibilityCb, mapObject);
    return li;
}

function wireItemVisibilityCheckbox(checkbox, mapObject) {
    checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        const visible = checkbox.checked;
        checkbox.dataset.visible = String(visible);
        checkbox.title = visible ? 'Ocultar no mapa' : 'Exibir no mapa';
        if (mapObject && typeof mapObject.setVisible === 'function') {
            mapObject.setVisible(visible);
        }
    });
}

function getMapFocusPadding() {
    const sidebar = document.getElementById('sidebar');
    return sidebar ? Math.min(420, sidebar.offsetWidth + 32) : 80;
}

function getMarkerHighlightRingIcon(markerInfo, emphasized = false) {
    const px = getMarkerPixelSize();
    return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: px / 2 + (emphasized ? 10 : 7),
        fillColor: '#2dd4bf',
        fillOpacity: emphasized ? 0.26 : 0.2,
        strokeColor: '#0f766e',
        strokeWeight: emphasized ? 3 : 2,
        strokeOpacity: 0.9,
    };
}

function clearMapMarkerHighlightTimers() {
    if (focusedMapMarkerBounceTimer) {
        clearTimeout(focusedMapMarkerBounceTimer);
        focusedMapMarkerBounceTimer = null;
    }
    if (focusedMapMarkerRingTimer) {
        clearTimeout(focusedMapMarkerRingTimer);
        focusedMapMarkerRingTimer = null;
    }
}

function removeMapMarkerHighlightRing() {
    if (focusedMapMarkerRing) {
        focusedMapMarkerRing.setMap(null);
        focusedMapMarkerRing = null;
    }
    if (focusedMapMarkerInfo?.marker) {
        focusedMapMarkerInfo.marker.setZIndex(undefined);
    }
    focusedMapMarkerInfo = null;
}

function clearMapMarkerHighlight() {
    markerHighlightPersistent = false;
    clearMapMarkerHighlightTimers();
    if (focusedMapMarkerInfo?.marker) {
        focusedMapMarkerInfo.marker.setAnimation(null);
    }
    removeMapMarkerHighlightRing();
}

function highlightMapMarker(markerInfo, options = {}) {
    const { persistent = false, bounce = false, emphasized = false } = options;
    if (!markerInfo?.marker || typeof map === 'undefined' || !map) return;
    if (!persistent && focusedMapMarkerInfo === markerInfo && focusedMapMarkerRing) return;

    clearMapMarkerHighlight();
    markerHighlightPersistent = persistent;
    focusedMapMarkerInfo = markerInfo;

    const position = markerInfo.marker.getPosition();
    if (!position) return;

    focusedMapMarkerRing = new google.maps.Marker({
        position,
        map,
        icon: getMarkerHighlightRingIcon(markerInfo, emphasized || persistent),
        clickable: false,
        optimized: false,
        zIndex: google.maps.Marker.MAX_ZINDEX - 1,
    });

    markerInfo.marker.setZIndex(google.maps.Marker.MAX_ZINDEX);

    if (bounce) {
        markerInfo.marker.setAnimation(google.maps.Animation.BOUNCE);
        focusedMapMarkerBounceTimer = window.setTimeout(() => {
            focusedMapMarkerBounceTimer = null;
            if (focusedMapMarkerInfo === markerInfo && markerInfo.marker?.getMap()) {
                markerInfo.marker.setAnimation(null);
            }
        }, 1000);
    }

    if (!persistent) {
        focusedMapMarkerRingTimer = window.setTimeout(() => {
            focusedMapMarkerRingTimer = null;
            if (focusedMapMarkerInfo === markerInfo && !markerHighlightPersistent) {
                removeMapMarkerHighlightRing();
            }
        }, 2000);
    }
}

function focusMapToMarker(markerInfo) {
    if (!markerInfo?.marker || typeof map === 'undefined' || !map) return;
    const pos = markerInfo.marker.getPosition();
    if (!pos) return;
    map.panTo(pos);
    const z = map.getZoom();
    if (!z || z < 15) map.setZoom(15);
    highlightMapMarker(markerInfo);
}

function focusMapToCable(cableInfo) {
    if (!cableInfo?.path?.length || typeof map === 'undefined' || !map) return;
    const bounds = new google.maps.LatLngBounds();
    cableInfo.path.forEach((pt) => bounds.extend(pt));
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const samePoint = ne && sw && ne.lat() === sw.lat() && ne.lng() === sw.lng();
    if (samePoint || cableInfo.path.length === 1) {
        map.panTo(bounds.getCenter());
        const z = map.getZoom();
        if (!z || z < 15) map.setZoom(15);
        return;
    }
    map.fitBounds(bounds, { top: 56, right: 48, bottom: 56, left: getMapFocusPadding() });
}

function isUnrecognizedImportedMarker(markerInfo) {
    return !!(markerInfo?.isImported || markerInfo?.type === 'Importado');
}

function openMarkerFromUserAction(markerInfo) {
    if (!markerInfo) return;
    if (markerInfo.type === 'CLIENTE') {
        openClientModal(markerInfo);
        return;
    }
    if (isUnrecognizedImportedMarker(markerInfo)) {
        startMarkerAdjustment(markerInfo);
        return;
    }
    openMarkerEditor(markerInfo);
}

function wireMarkerSidebarClick(markerInfo) {
    const li = markerInfo?.listItem;
    if (!li || li.dataset.editorDblClickBound === '1') return;
    li.dataset.editorDblClickBound = '1';
    li.addEventListener('dblclick', (e) => {
        if (isSidebarDragBlockedTarget(e.target)) return;
        if (e.target.closest('.adjust-kml-btn')) return;
        e.stopPropagation();
        selectSidebarMarker(markerInfo);
        focusMapToMarker(markerInfo);
        openMarkerFromUserAction(markerInfo);
    });
}

function isEditableKeyboardTarget(element) {
    if (!element) return false;
    if (element.isContentEditable) return true;
    const tag = element.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

const MODAL_ENTER_PRIMARY_SELECTORS = {
    alertModal: '#alertModalOkButton',
    confirmModal: '#confirmModalConfirmButton',
    projectModal: '#confirmProjectButton',
    folderModal: '#confirmFolderButton',
    searchModal: '#structuredSearchButton',
    addMaterialModal: '#confirmAddMaterial',
    editMaterialModal: '#confirmEditMaterial',
    regionalLaborModal: '#confirmRegionalLabor',
    outsourcedLaborModal: '#confirmOutsourcedLabor',
    placaKitModal: '#confirmPlacaKit',
    oltKitModal: '#confirmOltKit',
    popKitModal: '#confirmPopKit',
    fusionModal: '#saveFusionPlan',
    splitterOltConfigModal: '#confirmSplitterOltConfig',
    reportPreviewModal: '#confirmReportPdfExportButton',
    observationsModal: '#saveObservationButton',
    lineActionModal: '#editLineButton',
    materialModal: '#saveMaterialChangesButton',
    stickersModal: '#closeStickersModalButton',
    materialUsageModal: '#closeMaterialUsageModalBtn',
    outsourcedDetailsModal: '#closeOutsourcedDetailsModal',
};

const FLOATING_BOX_ENTER_ACTIONS = [
    { boxId: 'markerModal', buttonSelector: '#confirmMarker' },
    { boxId: 'cableDrawingBox', buttonSelector: '#saveCableButton' },
    { boxId: 'polygonDrawingBox', buttonSelector: '#savePolygonButton' },
    { boxId: 'rulerBox', buttonSelector: '#cancelRulerButton' },
];

const FLOATING_BOX_ESCAPE_ACTIONS = [
    { boxId: 'markerModal', buttonSelector: '#closeModal' },
    { boxId: 'cableDrawingBox', buttonSelector: '#cancelCableButton' },
    { boxId: 'polygonDrawingBox', buttonSelector: '#cancelPolygonButton' },
    { boxId: 'rulerBox', buttonSelector: '#cancelRulerButton' },
];

function isModalVisible(modal) {
    if (!modal) return false;
    return window.getComputedStyle(modal).display !== 'none';
}

function isActionButtonClickable(button) {
    if (!button || button.disabled) return false;
    if (button.classList.contains('hidden')) return false;
    const style = window.getComputedStyle(button);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

function getTopmostVisibleModal() {
    const visibleModals = Array.from(document.querySelectorAll('.modal')).filter(isModalVisible);
    if (!visibleModals.length) return null;
    return visibleModals.reduce((topModal, modal) => {
        const topZ = parseInt(window.getComputedStyle(topModal).zIndex, 10) || 0;
        const modalZ = parseInt(window.getComputedStyle(modal).zIndex, 10) || 0;
        return modalZ >= topZ ? modal : topModal;
    });
}

function closeModalElement(modal) {
    if (!modal) return false;

    const closeButton = modal.querySelector('.close');
    if (isActionButtonClickable(closeButton)) {
        closeButton.click();
        return true;
    }

    const dismissSelectors = [
        '#confirmModalCancelButton',
        '#alertModalOkButton',
        '.modal-footer .btn-danger',
        '.modal-footer .btn-secondary',
    ];
    for (const selector of dismissSelectors) {
        const button = modal.querySelector(selector);
        if (isActionButtonClickable(button)) {
            button.click();
            return true;
        }
    }

    modal.style.display = 'none';
    return true;
}

function cloneMapLatLng(latLng) {
    if (!latLng) return null;
    return new google.maps.LatLng(latLng.lat(), latLng.lng());
}








function cancelCableDrawingSession() {
    if (editingCableIndex !== null) {
        const originalCable = savedCables[editingCableIndex];
        if (originalCable?.polyline) {
            originalCable.polyline.setPath([...originalCable.path]);
            originalCable.polyline.setVisible(true);
        }
    }
    finishCableDrawingUi();
}

function closeTopmostFloatingBox() {
    for (const { boxId, buttonSelector } of FLOATING_BOX_ESCAPE_ACTIONS) {
        const box = document.getElementById(boxId);
        if (!box || box.classList.contains('hidden')) continue;
        const button = document.querySelector(buttonSelector);
        if (isActionButtonClickable(button)) {
            button.click();
            return true;
        }
    }
    return false;
}

function handleEscapeKey(event) {
    if (event.key !== 'Escape') return false;

    if (cancelMarkerPositionEdit()) return true;
    if (typeof cancelClientDropEdit === 'function' && cancelClientDropEdit()) return true;
    if (typeof cancelFusionArmFromEscape === 'function' && cancelFusionArmFromEscape()) return true;
    if (isAddingMarker) {
        resetMarkerModal();
        adjustingKmlMarkerInfo = null;
        return true;
    }

    const topModal = getTopmostVisibleModal();
    if (topModal) {
        closeModalElement(topModal);
        return true;
    }

    if (closeTopmostFloatingBox()) return true;

    const openDropdowns = document.querySelectorAll('.dropdown-content.show');
    if (openDropdowns.length) {
        openDropdowns.forEach((dropdown) => dropdown.classList.remove('show'));
        document.querySelectorAll('.dropdown.dropdown-open').forEach((dropdown) => {
            dropdown.classList.remove('dropdown-open');
        });
        return true;
    }

    return false;
}

function isEnterKey(event) {
    return event.key === 'Enter' || event.key === 'NumpadEnter';
}

function findOkButton(modal) {
    if (!modal) return null;

    const okById = modal.querySelector('[id$="OkButton"], [id*="OkButton"]');
    if (isActionButtonClickable(okById)) return okById;

    const footerButtons = modal.querySelectorAll('.modal-footer button');
    for (const button of footerButtons) {
        if (!isActionButtonClickable(button)) continue;
        if (button.textContent.trim().toUpperCase() === 'OK') return button;
    }

    return null;
}

function findSingleFooterButton(modal) {
    if (!modal) return null;
    const footerButtons = Array.from(modal.querySelectorAll('.modal-footer button')).filter(isActionButtonClickable);
    return footerButtons.length === 1 ? footerButtons[0] : null;
}

function findPrimaryActionButton(modal) {
    if (!modal) return null;

    const mappedSelector = MODAL_ENTER_PRIMARY_SELECTORS[modal.id];
    if (mappedSelector) {
        const mappedButton = modal.querySelector(mappedSelector);
        if (isActionButtonClickable(mappedButton)) return mappedButton;
    }

    const okButton = findOkButton(modal);
    if (okButton) return okButton;

    const singleFooterButton = findSingleFooterButton(modal);
    if (singleFooterButton) return singleFooterButton;

    const fallbackButtons = modal.querySelectorAll(
        '.modal-footer .btn-success, .modal-footer .btn-primary, .material-toolbar-btn-primary, .material-toolbar-btn-success, .material-buttons .btn-primary, .search-action-row .btn-primary'
    );
    for (const button of fallbackButtons) {
        if (!isActionButtonClickable(button)) continue;
        if (button.classList.contains('btn-danger') || button.classList.contains('btn-secondary')) continue;
        return button;
    }

    return null;
}

function focusModalPrimaryButton(modal) {
    const button = findPrimaryActionButton(modal);
    if (!button) return;
    requestAnimationFrame(() => button.focus());
}

function shouldIgnoreEnterForTarget(target, topModal) {
    if (!target) return true;
    if (target.isContentEditable) return true;
    if (target.tagName === 'TEXTAREA') return true;
    //Formulários tratam o Enter com o próprio submit
    if (target.closest?.('form')) return true;
    if (target.tagName === 'BUTTON') {
        if (!topModal) return true;
        const primaryButton = findPrimaryActionButton(topModal);
        return primaryButton !== target;
    }
    return false;
}

function triggerFloatingBoxPrimaryAction() {
    for (const { boxId, buttonSelector } of FLOATING_BOX_ENTER_ACTIONS) {
        const box = document.getElementById(boxId);
        if (!box || box.classList.contains('hidden')) continue;
        const button = document.querySelector(buttonSelector);
        if (isActionButtonClickable(button)) {
            button.click();
            return true;
        }
    }
    return false;
}

function handleEnterConfirmation(event) {
    if (!isEnterKey(event)) return false;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;

    const topModal = getTopmostVisibleModal();
    if (shouldIgnoreEnterForTarget(event.target, topModal)) return false;

    if (topModal) {
        const primaryButton = findPrimaryActionButton(topModal);
        if (primaryButton) {
            event.preventDefault();
            event.stopPropagation();
            primaryButton.click();
            return true;
        }
    }

    if (triggerFloatingBoxPrimaryAction()) {
        event.preventDefault();
        return true;
    }

    return false;
}

const MAP_KEYBOARD_PAN_STEP = 80;

function isMapEditSessionActive() {
    return !!(editingMarkerInfo || editingCableIndex !== null || adjustingKmlMarkerInfo);
}

function isMapKeyboardPanModeActive() {
    return !!(isDrawingCable || isAddingMarker || isMapEditSessionActive());
}

function shouldBlockMapKeyboardPan(event) {
    if (!event || event.ctrlKey || event.metaKey || event.altKey) return true;
    if (isEditableKeyboardTarget(event.target)) return true;
    if (getTopmostVisibleModal() && !isMapEditSessionActive()) return true;
    return false;
}

function handleMapKeyboardPan(event) {
    if (!isMapKeyboardPanModeActive() || typeof map === 'undefined' || !map) return false;
    if (shouldBlockMapKeyboardPan(event)) return false;

    const panOffsets = {
        w: [0, -MAP_KEYBOARD_PAN_STEP],
        s: [0, MAP_KEYBOARD_PAN_STEP],
        a: [-MAP_KEYBOARD_PAN_STEP, 0],
        d: [MAP_KEYBOARD_PAN_STEP, 0],
    };
    const offset = panOffsets[event.key.toLowerCase()];
    if (!offset) return false;

    map.panBy(offset[0], offset[1]);
    event.preventDefault();
    return true;
}

function generateFolderId() {
    return `folder-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
}

function clearSidebarItemSelection() {
    document.querySelectorAll('.folder-title.active').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('.ge-pro-item.active').forEach((el) => el.classList.remove('active'));
}

function selectSidebarItem(listItem, copyTarget = null) {
    if (!listItem) return;
    clearSidebarItemSelection();
    listItem.classList.add('active');
    if (copyTarget !== null) {
        selectedSidebarCopyTarget = copyTarget;
    }
}

function selectSidebarMarker(markerInfo) {
    if (!markerInfo?.listItem) return;
    selectSidebarItem(markerInfo.listItem, { type: 'marker', markerInfo });
}

function selectSidebarCable(cableInfo) {
    if (!cableInfo?.item) return;
    selectSidebarItem(cableInfo.item, { type: 'cable', cableInfo });
}

function wireCableSidebarSelection(cableInfo) {
    const li = cableInfo?.item;
    if (!li || li.dataset.copySelectBound === '1') return;
    li.dataset.copySelectBound = '1';
    li.style.cursor = 'pointer';
    li.addEventListener('click', (e) => {
        if (isSidebarDragBlockedTarget(e.target)) return;
        e.stopPropagation();
        selectSidebarCable(cableInfo);
        focusMapToCable(cableInfo);
    });
}

function wireMarkerSidebarSelection(markerInfo) {
    const li = markerInfo?.listItem;
    if (!li || li.dataset.copySelectBound === '1') return;
    li.dataset.copySelectBound = '1';
    li.style.cursor = 'pointer';
    li.addEventListener('click', (e) => {
        if (isSidebarDragBlockedTarget(e.target)) return;
        if (e.target.closest('.adjust-kml-btn')) return;
        e.stopPropagation();
        selectSidebarMarker(markerInfo);
        focusMapToMarker(markerInfo);
    });
}

function serializeFolderForClipboard(folderId) {
    const ul = document.getElementById(folderId);
    if (!ul) return null;
    const titleDiv = ul.previousElementSibling;
    if (!titleDiv) return null;
    const descendantIds = getAllDescendantFolderIds(folderId);
    return {
        type: 'folder',
        sourceFolderId: folderId,
        name: titleDiv.dataset.folderName,
        structure: getSidebarStructureAsJSON(ul),
        markers: markers.filter((m) => descendantIds.includes(m.folderId)).map(serializeMarker)
    };
}

function buildFolderIdMap(sourceFolderId, structure) {
    const idMap = { [sourceFolderId]: generateFolderId() };
    function walk(nodes) {
        (nodes || []).forEach((node) => {
            idMap[node.id] = generateFolderId();
            if (node.children?.length) walk(node.children);
        });
    }
    walk(structure);
    return idMap;
}

function remapSidebarStructureIds(structure, idMap) {
    return structure.map((node) => ({
        ...node,
        id: idMap[node.id] || node.id,
        children: node.children?.length ? remapSidebarStructureIds(node.children, idMap) : []
    }));
}

function appendFolderToParent(parentUl, folderName, folderId) {
    const template = document.getElementById('folder-template');
    const clone = template.content.cloneNode(true);
    const wrapperLi = clone.querySelector('.folder-wrapper');
    const titleDiv = clone.querySelector('.folder-title');
    const nameSpan = clone.querySelector('.folder-name-text');
    const subList = clone.querySelector('.subfolders');
    const visibilityBtn = clone.querySelector('.visibility-toggle-btn');

    enableDragAndDropForItem(wrapperLi);
    nameSpan.textContent = folderName;
    subList.id = folderId;
    titleDiv.dataset.folderId = folderId;
    titleDiv.dataset.folderName = folderName;
    titleDiv.dataset.isProject = 'false';
    visibilityBtn.dataset.folderId = folderId;

    const toggleIcon = titleDiv.querySelector('.toggle-icon');
    toggleIcon.onclick = (e) => { e.stopPropagation(); toggleFolder(folderId); };
    enableDropOnFolder(subList);
    parentUl.appendChild(wrapperLi);
    return folderId;
}

function copySidebarSelection() {
    if (selectedSidebarCopyTarget?.type === 'marker') {
        sidebarClipboard = {
            type: 'marker',
            data: serializeMarker(selectedSidebarCopyTarget.markerInfo)
        };
        return true;
    }
    if (selectedSidebarCopyTarget?.type === 'cable') {
        sidebarClipboard = {
            type: 'cable',
            data: serializeCable(selectedSidebarCopyTarget.cableInfo)
        };
        return true;
    }
    if (selectedSidebarCopyTarget?.type === 'folder') {
        const payload = serializeFolderForClipboard(selectedSidebarCopyTarget.folderId);
        if (payload) {
            sidebarClipboard = payload;
            return true;
        }
    }
    return false;
}

function pasteMarkerFromClipboard(targetFolderId) {
    const clip = sidebarClipboard;
    if (!clip || clip.type !== 'marker' || !clip.data) return false;
    const parentUl = document.getElementById(targetFolderId);
    if (!parentUl) return false;

    const data = { ...clip.data };
    data.folderId = targetFolderId;
    data.name = `${data.name} (cópia)`;
    rebuildMarker(data);
    return true;
}

function pasteCableFromClipboard(targetFolderId) {
    const clip = sidebarClipboard;
    if (!clip || clip.type !== 'cable' || !clip.data) return false;
    if (!document.getElementById(targetFolderId)) return false;
    const data = { ...clip.data, path: clip.data.path.map(p => ({ ...p })) };
    data.folderId = targetFolderId;
    data.name = `${data.name} (cópia)`;
    delete data.order;
    rebuildCable(data);
    return true;
}

function pasteFolderFromClipboard(targetFolderId) {
    const clip = sidebarClipboard;
    if (!clip || clip.type !== 'folder') return false;
    const parentUl = document.getElementById(targetFolderId);
    if (!parentUl) return false;

    const idMap = buildFolderIdMap(clip.sourceFolderId, clip.structure);
    const newRootId = idMap[clip.sourceFolderId];
    appendFolderToParent(parentUl, `${clip.name} (cópia)`, newRootId);

    if (clip.structure.length > 0) {
        const remappedStructure = remapSidebarStructureIds(clip.structure, idMap);
        const rootUl = document.getElementById(newRootId);
        rebuildSidebarFromJSON(remappedStructure, rootUl);
    }

    clip.markers.forEach((markerData) => {
        const mappedFolderId = idMap[markerData.folderId];
        if (!mappedFolderId) return;
        const newData = { ...markerData };
        newData.folderId = mappedFolderId;
        newData.name = `${markerData.name} (cópia)`;
        rebuildMarker(newData);
    });

    setActiveFolder(newRootId);
    return true;
}

function pasteSidebarClipboard() {
    if (!AppSession.canEdit) return false;
    if (!sidebarClipboard || !activeFolderId) return false;
    if (sidebarClipboard.type === 'marker') {
        return pasteMarkerFromClipboard(activeFolderId);
    }
    if (sidebarClipboard.type === 'cable') {
        return pasteCableFromClipboard(activeFolderId);
    }
    if (sidebarClipboard.type === 'folder') {
        return pasteFolderFromClipboard(activeFolderId);
    }
    return false;
}

function wireCableSidebarClick(cableInfo) {
    if (!cableInfo) return;
    wireCableSidebarSelection(cableInfo);
    const openEditor = (e) => {
        if (e) e.stopPropagation();
        selectSidebarCable(cableInfo);
        focusMapToCable(cableInfo);
        openCableEditor(cableInfo);
    };
    const nameSpan = cableInfo.item?.querySelector('.item-name');
    if (nameSpan && nameSpan.dataset.editorClickBound !== '1') {
        nameSpan.dataset.editorClickBound = '1';
        nameSpan.style.cursor = 'pointer';
        nameSpan.addEventListener('click', openEditor);
    }
    if (cableInfo.polyline && !cableInfo._mapClickEditorBound) {
        cableInfo._mapClickEditorBound = true;
        cableInfo.polyline.addListener('click', () => openCableEditor(cableInfo));
    }
}

//Arrastar e soltar na barra lateral: o arraste começa no item (abaixo); o destino
//(antes, depois ou dentro de uma pasta) é calculado por delegação em js/sidebar.js
window.sidebarDropTarget = null;

function isDraggedSidebarFolder(element) {
    return !!element && (element.classList.contains('folder-wrapper') || element.classList.contains('folder'));
}

function isSidebarDragBlockedTarget(target) {
    return !!target.closest(
        '.ge-vis-checkbox, .visibility-toggle-btn, .item-actions-dropdown, .item-actions-menu, .item-actions-toggle-btn, .toggle-icon, .ge-expand, button, a, input, select, textarea'
    );
}

function beginSidebarDrag(containerElement, e) {
    if (!AppSession.canEdit) {
        e.preventDefault();
        return;
    }
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', containerElement.id || 'sidebar-item');
    e.dataTransfer.effectAllowed = 'move';
    window.draggedItem = containerElement;
    window.draggedItemSourceProject = containerElement.closest('.folder');
    window.dropWasSuccessful = false;
    document.body.classList.add('is-dragging-globally');
    containerElement.classList.add('is-being-dragged');
    if (typeof setSidebarDragGhost === 'function') setSidebarDragGhost(e, containerElement);
}

function enableDragAndDropForItem(itemElement) {
    if (!itemElement || itemElement.dataset.sidebarDndBound === '1') {
        return;
    }
    itemElement.dataset.sidebarDndBound = '1';
    itemElement.classList.add('sidebar-draggable');
    itemElement.querySelectorAll('.sidebar-drag-handle').forEach((h) => h.remove());
    itemElement.draggable = true;

    const onDragEnd = () => {
        if (window.dropWasSuccessful) {
            const row = itemElement.querySelector(':scope > .folder-title') || itemElement;
            row.classList.add('sidebar-drop-flash');
            setTimeout(() => row.classList.remove('sidebar-drop-flash'), 700);
        }
        document.body.classList.remove('is-dragging-globally');
        itemElement.classList.remove('is-being-dragged');
        clearSidebarDropState();
        window.draggedItem = null;
        window.draggedItemSourceProject = null;
        window.dropWasSuccessful = false;
    };

    itemElement.addEventListener('dragstart', (e) => {
        if (isSidebarDragBlockedTarget(e.target)) {
            e.preventDefault();
            return;
        }
        beginSidebarDrag(itemElement, e);
    });
    itemElement.addEventListener('dragend', onDragEnd);
}

//Mantida para compatibilidade: as listas só recebem a marca de "aceita soltar"
function enableDropOnFolder(ul) {
    if (!ul || ul.classList.contains('drop-enabled')) return;
    ul.classList.add('drop-enabled');
    ul.querySelectorAll(':scope > .drop-placeholder').forEach((el) => el.remove());
}

//Criação e edição de projetos
function createProject() {
    if (!requireEdit('criar projetos')) return;
    //Captura do formulário
    const projectNameInput = document.getElementById("projectName");
    const projectCityInput = document.getElementById("projectCity");
    const projectNeighborhoodInput = document.getElementById("projectNeighborhood");
    const projectTypeInput = document.getElementById("projectType");
    const projectName = projectNameInput.value.trim();
    const projectCity = projectCityInput.value.trim();
    const projectNeighborhood = projectNeighborhoodInput.value.trim();
    const projectType = projectTypeInput.value;
    //Modo edição
    if (editingFolderElement) {
        if (!projectName) {
        showAlert("Erro", "O nome do projeto não pode ficar vazio.");
        return;
        }
        editingFolderElement.dataset.folderName = projectName;
        editingFolderElement.dataset.folderCity = projectCity;
        editingFolderElement.dataset.folderNeighborhood = projectNeighborhood;
        editingFolderElement.dataset.folderType = projectType;
        editingFolderElement.querySelector('.folder-name-text').textContent = projectName;
        const editedProjectRoot = editingFolderElement.closest('.folder');
        editingFolderElement = null;
        document.getElementById("projectModal").style.display = "none";
        saveProjectElement(editedProjectRoot);
        return;
    }
    //Modo criação
    if (!projectName) {
        showAlert("Erro", "Por favor, digite o nome do projeto.");
        return;
    }
    //ID do projeto (também usado como id da lista na sidebar)
    const projectId = `proj_${crypto.randomUUID().replace(/-/g, '')}`;
    //Cria elemento visual na sidebar
    const template = document.getElementById('project-template');
    const clone = template.content.cloneNode(true);
    const titleDiv = clone.querySelector('.folder-title');
    const nameSpan = clone.querySelector('.folder-name-text');
    const subList = clone.querySelector('.subfolders');
    const visibilityBtn = clone.querySelector('.visibility-toggle-btn');
    const projectElement = clone.querySelector('.folder');
    //Configura o drag & drop do proprio projeto
    enableDragAndDropForItem(projectElement);
    //Define metadados no DOM
    nameSpan.textContent = projectName;
    subList.id = projectId;
    titleDiv.dataset.folderId = projectId;
    titleDiv.dataset.folderName = projectName;
    titleDiv.dataset.folderCity = projectCity;
    titleDiv.dataset.folderNeighborhood = projectNeighborhood;
    titleDiv.dataset.folderType = projectType;
    titleDiv.dataset.isProject = "true";
    visibilityBtn.dataset.folderId = projectId;
    //Configura eventso de clique na pasta projeto
    const toggleIcon = titleDiv.querySelector('.toggle-icon');
    toggleIcon.onclick = (e) => { e.stopPropagation(); toggleFolder(projectId); };
    enableDropOnFolder(subList);
    //Adiciona ao DOM
    document.getElementById("sidebar").appendChild(clone);
    updateSidebarEmptyState();
    //Persistência inicial no banco
    const projectRoot = document.getElementById(projectId).closest('.folder');
    persistProject(projectRoot).then(() => {
        setActiveFolder(projectId);
        document.getElementById("projectModal").style.display = "none";
        if (typeof rememberLastProject === 'function') rememberLastProject(projectId);
    }).catch(error => {
        console.error("Erro ao criar o projeto no banco:", error);
        showAlert("Erro de Banco de Dados", "Não foi possível criar o projeto. Tente novamente.");
        projectRoot?.remove();
        updateSidebarEmptyState();
    });
}

//Criação e edição de pastas
function createFolder() {
    if (!requireEdit('criar pastas')) return;
    const folderNameInput = document.getElementById("folderNameInput");
    const folderName = folderNameInput.value.trim();
    //Modo edição
    if (editingFolderElement) {
        if (!folderName) {
        showAlert("Erro", "O nome da pasta não pode ficar vazio.");
        return;
        }
        editingFolderElement.querySelector('.folder-name-text').textContent = folderName;
        editingFolderElement.dataset.folderName = folderName;
        const editedProjectRoot = editingFolderElement.closest('.folder');
        editingFolderElement = null;
        document.getElementById("folderModal").style.display = "none";
        saveProjectElement(editedProjectRoot);
        return;
    }
    //Modo criação
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione uma pasta ou projeto para adicionar.");
        return;
    }
    if (!folderName) {
        showAlert("Erro", "Por favor, digite o nome da pasta.");
        return;
    }
    //Gera ID único
    const folderId = `folder-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const template = document.getElementById('folder-template');
    const clone = template.content.cloneNode(true);
    //Referências aos elementos
    const wrapperLi = clone.querySelector('.folder-wrapper');
    const titleDiv = clone.querySelector('.folder-title');
    const nameSpan = clone.querySelector('.folder-name-text');
    const subList = clone.querySelector('.subfolders');
    const visibilityBtn = clone.querySelector('.visibility-toggle-btn');
    //Configura a própria pasta para ser arrastável
    enableDragAndDropForItem(wrapperLi);
    //Define metadados dos IDs
    nameSpan.textContent = folderName;
    subList.id = folderId;
    titleDiv.dataset.folderId = folderId;
    titleDiv.dataset.folderName = folderName;
    titleDiv.dataset.isProject = "false";
    visibilityBtn.dataset.folderId = folderId;
    //Eventos de interação
    const toggleIcon = titleDiv.querySelector('.toggle-icon');
    //Remove destaque visual ao sair da área do drop
    toggleIcon.onclick = (e) => { e.stopPropagation(); toggleFolder(folderId); };
    enableDropOnFolder(subList);
    //Inserção no DOM
    const parentUl = document.getElementById(activeFolderId);
    parentUl.appendChild(wrapperLi);
    setActiveFolder(folderId);
    document.getElementById("folderModal").style.display = "none";
}

//Altenar visibilidade da pasta - expandir e recolher
function toggleFolder(id) {
    const folderUl = document.getElementById(id);
    if (!folderUl) return;
    const titleDiv = folderUl.previousElementSibling;
    if (!titleDiv || !titleDiv.classList.contains("folder-title")) return;
    const iconSpan = titleDiv.querySelector(".toggle-icon");
    const isHidden = folderUl.classList.contains("hidden");
    folderUl.classList.toggle("hidden");
    if (iconSpan) {
        iconSpan.textContent = isHidden ? '▼' : '►';
    }
}

//Definir a pasta ativa para a inserção
function shouldIgnoreFolderTitleInteraction(event) {
    return !!event.target.closest(
        '.folder-buttons, .toggle-icon, .ge-vis-checkbox, .item-actions-dropdown, .sidebar-drag-handle, .item-actions-toggle-btn'
    );
}

function initSidebarFolderClickBehavior() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    sidebar.addEventListener('click', (e) => {
        const titleElement = e.target.closest('.folder-title');
        if (!titleElement || shouldIgnoreFolderTitleInteraction(e)) return;
        const folderId = titleElement.dataset.folderId;
        if (!folderId) return;
        e.stopPropagation();
        setActiveFolder(folderId);
    });

    sidebar.addEventListener('dblclick', (e) => {
        const titleElement = e.target.closest('.folder-title');
        if (!titleElement || shouldIgnoreFolderTitleInteraction(e)) return;
        const folderId = titleElement.dataset.folderId;
        if (!folderId) return;
        e.preventDefault();
        e.stopPropagation();
        setActiveFolder(folderId);
        focusMapToFolderScope(folderId);
    });
}

function setActiveFolder(id) {
    clearSidebarItemSelection();
    const ul = document.getElementById(id);
    if (ul) {
        activeFolderId = id;
        const title = ul.previousElementSibling;
        if (title) {
            title.classList.add("active");
            if (title.dataset.isProject === 'true') {
                selectedSidebarCopyTarget = null;
            } else {
                selectedSidebarCopyTarget = { type: 'folder', folderId: id };
            }
        }
    } else {
        selectedSidebarCopyTarget = null;
    }
    bomState = {};
}

function handleMapClick(event) {
    if (!isDrawingCable) return;
    if (suppressNextCableMapClick) {
        suppressNextCableMapClick = false;
        return;
    }
    //Impede criar pontos soltos no mapa
    if (cableMarkers.length === 0) {
        showToast('Comece numa caixa', 'Clique em uma CEO, CTO, reserva ou POP para iniciar o cabo (ponta A).', 'progress');
        return;
    }
    const location = event.latLng;
    const lastMarker = cableMarkers[cableMarkers.length - 1];
    const distanceToLast = google.maps.geometry.spherical.computeDistanceBetween(location, lastMarker.getPosition());
    if (distanceToLast < 3) return;
    const marker = createCableDrawVertexMarker(location);
    cableMarkers.push(marker);
    wireCableVertexMarker(marker);
    //A ponta B passa a ser este novo ponto
    cableDrawAnchors.end = null;
    updatePolylineFromMarkers();
}

//Rótulos A/B e ícones dos vértices (pontas ancoradas ficam verdes)
function updateCableVertexLabels() {
    const lastIndex = cableMarkers.length - 1;
    cableMarkers.forEach((marker, i) => {
        const isFirst = i === 0;
        const isLast = i === lastIndex && lastIndex > 0;
        if (!isFirst && !isLast) {
            marker.setLabel(null);
            marker.setIcon(getCableVertexIcon(false, false));
            marker.setZIndex(1000);
            return;
        }
        const anchored = !!resolveCableDrawEndpointForIndex(i, { snap: false });
        marker.setLabel({ text: isFirst ? 'A' : 'B', color: anchored ? '#ffffff' : '#0f172a', fontWeight: '700', fontSize: '11px' });
        marker.setIcon(getCableVertexIcon(true, anchored));
        marker.setZIndex(1001);
    });
}

function wireCableVertexMarker(marker) {
    marker.addListener("drag", () => updatePolylineFromMarkers());
    marker.addListener("dragend", () => handleCableVertexDragEnd(cableMarkers.indexOf(marker)));
    marker.addListener("rightclick", (event) => {
        if (event.domEvent) {
            suppressCableDrawBrowserMenu(event.domEvent);
        }
        removeCableVertexAtIndex(cableMarkers.indexOf(marker));
    });
}

function findCableVertexIndexNearPoint(clickLatLng, maxDistanceM = 14) {
    if (!clickLatLng) return -1;
    for (let i = 0; i < cableMarkers.length; i++) {
        const distance = google.maps.geometry.spherical.computeDistanceBetween(
            clickLatLng,
            cableMarkers[i].getPosition()
        );
        if (distance < maxDistanceM) return i;
    }
    return -1;
}

function removeCableVertexAtIndex(indexToDelete, options = {}) {
    if (indexToDelete < 0 || indexToDelete >= cableMarkers.length) return false;
    const minPoints = options.allowShort ? 0 : 2;
    if (cableMarkers.length <= minPoints) {
        if (options.showAlert !== false) {
            showToast('Não foi possível remover', 'O cabo precisa ter pelo menos dois pontos.', 'progress');
        }
        return false;
    }
    const wasLast = indexToDelete === cableMarkers.length - 1;
    cableMarkers[indexToDelete].setMap(null);
    cableMarkers.splice(indexToDelete, 1);
    if (indexToDelete === 0) cableDrawAnchors.start = null;
    if (wasLast) cableDrawAnchors.end = null;
    if (cableMarkers.length === 0) cableNameAutoFill = { endMarkerName: null, lastValue: null };
    updatePolylineFromMarkers();
    return true;
}

function handleMapRightClick(event) {
    if (isSketchToolActive()) {
        if (event.domEvent) suppressCableDrawBrowserMenu(event.domEvent);
        undoSketchPoint();
        return;
    }
    if (!isDrawingCable) return;
    if (event.domEvent) {
        suppressCableDrawBrowserMenu(event.domEvent);
    }
    if (cableMarkers.length === 0) return;
    const vertexIndex = findCableVertexIndexNearPoint(event.latLng);
    if (vertexIndex !== -1) {
        removeCableVertexAtIndex(vertexIndex);
        return;
    }
    undoCableVertex();
}

//Encontra o segmento mais próximo do clique e a posição interpolada para inserir um vértice
function findCablePolylineInsertInfo(clickLatLng) {
    if (!clickLatLng || cableMarkers.length < 2) return null;
    const maxDistM = 55;
    const minVertexDistM = 14;
    for (let m = 0; m < cableMarkers.length; m++) {
        const d = google.maps.geometry.spherical.computeDistanceBetween(clickLatLng, cableMarkers[m].getPosition());
        if (d < minVertexDistM) return null;
    }
    let bestDist = Infinity;
    let bestInsertAt = -1;
    let bestPoint = null;
    for (let i = 0; i < cableMarkers.length - 1; i++) {
        const a = cableMarkers[i].getPosition();
        const b = cableMarkers[i + 1].getPosition();
        for (let s = 0; s <= 24; s++) {
            const t = s / 24;
            const p = google.maps.geometry.spherical.interpolate(a, b, t);
            const d = google.maps.geometry.spherical.computeDistanceBetween(clickLatLng, p);
            if (d < bestDist) {
                bestDist = d;
                bestInsertAt = i + 1;
                bestPoint = p;
            }
        }
    }
    if (bestDist > maxDistM || bestInsertAt < 1) return null;
    return { insertAt: bestInsertAt, point: bestPoint, distanceMeters: bestDist };
}

function insertCableVertexAtIndex(insertAtIndex, position) {
    const marker = createCableDrawVertexMarker(position);
    cableMarkers.splice(insertAtIndex, 0, marker);
    wireCableVertexMarker(marker);
}

function setupCablePolylineClickInsert() {
    if (!cablePolyline || !isDrawingCable || cableMarkers.length < 2) return;
    google.maps.event.clearListeners(cablePolyline, "click");
    cablePolyline.addListener("click", (e) => {
        const info = findCablePolylineInsertInfo(e.latLng);
        if (!info) return;
        insertCableVertexAtIndex(info.insertAt, info.point);
        updatePolylineFromMarkers();
    });
}

//Reserva técnica no ponto de ancoragem do cabo
const KML_CABLE_ANCHOR_SNAP_DISTANCE_M = 30;
const CABLE_DRAW_ANCHOR_SNAP_DISTANCE_M = 8; //Ponta sem clique na caixa só encaixa se estiver a poucos metros

function getCableDrawEndpointAnchorCandidates(folderId = activeFolderId) {
    const candidates = folderId
        ? getAnchorMarkerCandidatesForFolder(folderId)
        : markers.filter(isCableEndpointAnchorCandidate);
    return candidates.filter(isCableAnchorMarker);
}

function resolveCableDrawEndpointAnchor(point, folderId = activeFolderId, excludeMarker = null, maxDistanceM = CABLE_DRAW_ANCHOR_SNAP_DISTANCE_M) {
    if (!point) return null;
    let candidates = getCableDrawEndpointAnchorCandidates(folderId);
    if (excludeMarker) {
        candidates = candidates.filter((markerInfo) => markerInfo.marker !== excludeMarker.marker);
    }
    return getAnchorMarkerAtPoint(point, maxDistanceM, candidates);
}

function scheduleSuppressNextCableMapClick() {
    suppressNextCableMapClick = true;
    setTimeout(() => {
        suppressNextCableMapClick = false;
    }, 250);
}

function isSameCableAnchorMarker(markerA, markerB) {
    if (!markerA || !markerB) return false;
    if (markerA.marker && markerB.marker) {
        return markerA.marker === markerB.marker;
    }
    return markerA === markerB;
}

function getCableDrawStartAnchorMarker() {
    return resolveCableDrawEndpointForIndex(0, { snap: false });
}

//Preenche o nome do cabo com "tipo de fibra-nome do marcador da ponta B" (ex.: FO-12-Marcador)
function applyCableNameAutoFill(endMarkerName) {
    if (typeof endMarkerName === 'string') {
        cableNameAutoFill.endMarkerName = endMarkerName;
    }
    if (!cableNameAutoFill.endMarkerName) return;
    const nameInput = document.getElementById("cableName");
    if (!nameInput) return;
    const current = nameInput.value.trim();
    if (current && current !== (cableNameAutoFill.lastValue || '')) return;
    const fiberType = document.getElementById("cableType").value;
    const autoValue = `${fiberType}-${cableNameAutoFill.endMarkerName}`;
    nameInput.value = autoValue;
    cableNameAutoFill.lastValue = autoValue;
}

function syncCablePathFromDrawMarkers() {
    cablePath = cableMarkers.map((marker) => marker.getPosition());
}

function snapCableDrawVertexToNearestAnchor(vertexIndex, folderId = activeFolderId, excludeMarker = null) {
    const vertexMarker = cableMarkers[vertexIndex];
    if (!vertexMarker) return null;
    const anchor = resolveCableDrawEndpointAnchor(vertexMarker.getPosition(), folderId, excludeMarker);
    if (!anchor) return null;
    vertexMarker.setPosition(anchor.marker.getPosition());
    return anchor;
}

//Resolve as pontas: vale o marcador clicado; sem clique, só encaixa se estiver a poucos metros
function snapCableDrawEndpointsToAnchors() {
    const startAnchor = cableMarkers.length >= 1 ? resolveCableDrawEndpointForIndex(0, { snap: true }) : null;
    const endAnchor = cableMarkers.length >= 2 ? resolveCableDrawEndpointForIndex(cableMarkers.length - 1, { snap: true, exclude: startAnchor }) : null;
    syncCablePathFromDrawMarkers();
    return { startAnchor, endAnchor };
}

function createCableDrawVertexMarker(position) {
    return new google.maps.Marker({
        position,
        map: map,
        draggable: true,
        zIndex: 1000,
        icon: getCableVertexIcon(false, false),
    });
}

function handleAnchorMarkerClickDuringCableDraw(markerInfo) {
    scheduleSuppressNextCableMapClick();
    const markerPosition = markerInfo.marker.getPosition();
    const isAnchor = isCableAnchorMarker(markerInfo);
    const addVertexAt = (position) => {
        const vertex = createCableDrawVertexMarker(position);
        cableMarkers.push(vertex);
        wireCableVertexMarker(vertex);
    };
    //Ponta A
    if (cableMarkers.length === 0) {
        if (!isAnchor) {
            showToast('Comece numa caixa', 'O cabo começa em uma CEO, CTO, reserva, POP ou cliente B2B.', 'progress');
            return;
        }
        addVertexAt(markerPosition);
        cableDrawAnchors.start = markerInfo;
        updatePolylineFromMarkers();
        return;
    }
    //Marcadores que não são ponta (cordoalha, casas, cliente) viram um ponto da rota
    if (!isAnchor) {
        addVertexAt(markerPosition);
        cableDrawAnchors.end = null;
        updatePolylineFromMarkers();
        return;
    }
    const startAnchor = cableDrawAnchors.start || getCableDrawStartAnchorMarker();
    if (isSameCableAnchorMarker(startAnchor, markerInfo)) {
        showToast('Escolha outra caixa', cableMarkers.length === 1
            ? 'Desenhe a rota no mapa antes de escolher a ponta B.'
            : 'O cabo não pode começar e terminar na mesma caixa.', 'progress');
        return;
    }
    //Só junta com o último ponto se ele já estiver praticamente sobre a caixa
    const lastMarker = cableMarkers[cableMarkers.length - 1];
    const distanceToMarker = google.maps.geometry.spherical.computeDistanceBetween(lastMarker.getPosition(), markerPosition);
    if (distanceToMarker <= 2 && cableMarkers.length > 1) {
        lastMarker.setPosition(markerPosition);
    } else {
        addVertexAt(markerPosition);
    }
    cableDrawAnchors.end = markerInfo;
    applyCableNameAutoFill(markerInfo.name);
    showToast('Ponta B definida', `Cabo ancorado em "${markerInfo.name}". Confira o nome e salve.`);
    updatePolylineFromMarkers();
}

function getAnchorMarkerAtPoint(point, maxDistanceM = 0.5, candidateMarkers = null) {
    if (!point || typeof google === 'undefined' || !google.maps?.geometry) return null;
    let nearestMarker = null;
    let nearestDistance = maxDistanceM;
    const pool = candidateMarkers || markers.filter(isCableAnchorMarkerType);
    for (const markerInfo of pool) {
        const markerPosition = markerInfo.marker?.getPosition();
        if (!markerPosition) continue;
        const distance = google.maps.geometry.spherical.computeDistanceBetween(point, markerPosition);
        if (distance <= nearestDistance) {
            nearestDistance = distance;
            nearestMarker = markerInfo;
        }
    }
    return nearestMarker;
}

function snapPointToNearestAnchorMarker(point, maxDistanceM = KML_CABLE_ANCHOR_SNAP_DISTANCE_M, candidateMarkers = null) {
    const anchorMarker = getAnchorMarkerAtPoint(point, maxDistanceM, candidateMarkers);
    return anchorMarker
        ? { point: anchorMarker.marker.getPosition(), markerInfo: anchorMarker }
        : { point, markerInfo: null };
}

function assignCableAnchorMarkers(cable, startMarker, endMarker) {
    if (!cable) return;
    cable.startAnchorUid = startMarker ? ensureMarkerUid(startMarker) : null;
    cable.endAnchorUid = endMarker ? ensureMarkerUid(endMarker) : null;
    cable.startAnchorMarkerName = startMarker?.name || null;
    cable.endAnchorMarkerName = endMarker?.name || null;
    cable.startAnchorMarkerFolderId = startMarker?.folderId || null;
    cable.endAnchorMarkerFolderId = endMarker?.folderId || null;
}

function resolveCableAnchorMarker(markerName, folderId, nearPoint = null) {
    if (!markerName) return null;
    const pickClosest = (candidates) => {
        if (candidates.length === 0) return null;
        if (candidates.length === 1 || !nearPoint || !google.maps?.geometry) {
            return candidates[0];
        }
        let best = candidates[0];
        let bestDist = Infinity;
        for (const m of candidates) {
            const pos = m.marker?.getPosition();
            if (!pos) continue;
            const d = google.maps.geometry.spherical.computeDistanceBetween(nearPoint, pos);
            if (d < bestDist) {
                bestDist = d;
                best = m;
            }
        }
        return best;
    };
    if (folderId) {
        const scoped = markers.filter(
            (m) => m.name === markerName && m.folderId === folderId && isCableEndpointAnchorCandidate(m)
        );
        const scopedMatch = pickClosest(scoped);
        if (scopedMatch) return scopedMatch;
    }
    const all = markers.filter((m) => m.name === markerName && isCableEndpointAnchorCandidate(m));
    return pickClosest(all);
}

//Encosta as pontas do cabo nos marcadores de ancoragem (pelo identificador; nome só em projetos antigos)
function applyCableAnchorsToPath(cable) {
    if (!cable?.path?.length) return false;
    const startMarker = resolveCableEndAnchor(cable, true);
    const endMarker = cable.path.length > 1 ? resolveCableEndAnchor(cable, false) : null;
    if (startMarker && endMarker && startMarker.marker === endMarker.marker) return false;
    let changed = false;
    if (startMarker) {
        cable.path[0] = startMarker.marker.getPosition();
        changed = true;
    }
    if (endMarker) {
        cable.path[cable.path.length - 1] = endMarker.marker.getPosition();
        changed = true;
    }
    //Projetos antigos: grava o identificador para não depender mais do nome
    if (startMarker || endMarker) {
        assignCableAnchorMarkers(cable, startMarker || null, endMarker || null);
    }
    if (changed && cable.polyline) cable.polyline.setPath(cable.path);
    return changed;
}

function anchorCablePathToMarkers(path, folderId) {
    if (!path || path.length < 2) {
        return { path, startAnchor: null, endAnchor: null };
    }
    const candidates = folderId ? getAnchorMarkerCandidatesForFolder(folderId) : markers.filter(isCableEndpointAnchorCandidate);
    const anchoredPath = [...path];
    const start = snapPointToNearestAnchorMarker(anchoredPath[0], KML_CABLE_ANCHOR_SNAP_DISTANCE_M, candidates);
    anchoredPath[0] = start.point;
    const lastIndex = anchoredPath.length - 1;
    const end = snapPointToNearestAnchorMarker(anchoredPath[lastIndex], KML_CABLE_ANCHOR_SNAP_DISTANCE_M, candidates);
    anchoredPath[lastIndex] = end.point;
    return { path: anchoredPath, startAnchor: start.markerInfo, endAnchor: end.markerInfo };
}

function captureCableAnchorsFromPath(cable) {
    if (!cable?.path?.length) return;
    const candidates = getAnchorMarkerCandidatesForFolder(cable.folderId);
    const startAnchor = getAnchorMarkerAtPoint(cable.path[0], KML_CABLE_ANCHOR_SNAP_DISTANCE_M, candidates);
    const endAnchor = getAnchorMarkerAtPoint(
        cable.path[cable.path.length - 1],
        KML_CABLE_ANCHOR_SNAP_DISTANCE_M,
        candidates
    );
    assignCableAnchorMarkers(cable, startAnchor, endAnchor);
}

function isCableConnectedToMarker(cable, markerInfo) {
    if (!cable?.path?.length || !markerInfo) return false;
    if (markerInfo.uid && (cable.startAnchorUid === markerInfo.uid || cable.endAnchorUid === markerInfo.uid)) return true;
    if (cable.startAnchorUid && cable.endAnchorUid) return false;
    const markerName = markerInfo.name;
    if (cable.startAnchorMarkerName === markerName || cable.endAnchorMarkerName === markerName) {
        return true;
    }
    const markerPosition = markerInfo.marker.getPosition();
    const startPoint = cable.path[0];
    const endPoint = cable.path[cable.path.length - 1];
    const thresholdM = 1;
    return google.maps.geometry.spherical.computeDistanceBetween(markerPosition, startPoint) < thresholdM
        || google.maps.geometry.spherical.computeDistanceBetween(markerPosition, endPoint) < thresholdM;
}

function getReserveForMarkerType(type) {
    switch (type) {
        case 'CEO':
        case 'RESERVA':
        case 'POP':
            return 25;
        case 'CTO':
            return 5;
        default:
            return 0;
    }
}

function getReserveForMarker(markerInfo) {
    if (!markerInfo) return 0;
    if (isCableAnchorMarkerType(markerInfo.type)) {
        return getReserveForMarkerType(markerInfo.type);
    }
    if (markerInfo.type === 'Importado') {
        const inferred = inferMarkerTypeFromKml({
            name: markerInfo.name,
            description: markerInfo.description || '',
            folderPath: [],
            extendedData: {},
        });
        if (inferred.type !== 'Importado') {
            return getReserveForMarkerType(inferred.type);
        }
    }
    return 0;
}

function getReserveForCableEndpoint(cable, isStart) {
    if (!cable?.path?.length) return 0;
    const point = isStart ? cable.path[0] : cable.path[cable.path.length - 1];
    const markerInfo = resolveCableEndAnchor(cable, isStart)
        || getAnchorMarkerAtPoint(point, 1, getAnchorMarkerCandidatesForFolder(cable.folderId));
    return getReserveForMarker(markerInfo);
}

function getReserveForCablePoint(point, folderId = null) {
    if (!point) return 0;
    const candidates = folderId
        ? getAnchorMarkerCandidatesForFolder(folderId)
        : markers.filter(isCableAnchorMarkerType);
    const markerInfo = getAnchorMarkerAtPoint(point, 1, candidates);
    return getReserveForMarker(markerInfo);
}

//Arredonda metragem para cima em múltiplos de 10 m (191 → 200)
function roundLengthUpToTen(value) {
    const safeValue = Number.isFinite(value) ? value : 0;
    if (safeValue <= 0) return 0;
    return Math.ceil(safeValue / 10) * 10;
}

//Calcula lançamento, reserva e total a partir do traçado do cabo
function calculateCableMeasurement(cableOrPath) {
    const path = Array.isArray(cableOrPath) ? cableOrPath : cableOrPath?.path;
    if (!path || path.length < 2) {
        if (cableOrPath && !Array.isArray(cableOrPath)) {
            const lancamento = cableOrPath.lancamento || 0;
            const reserva = cableOrPath.reserva || 0;
            const rawTotal = cableOrPath.totalLength || (lancamento + reserva);
            return {
                lancamento,
                reserva,
                total: roundLengthUpToTen(rawTotal)
            };
        }
        return { lancamento: 0, reserva: 0, total: 0 };
    }
    const drawnDistance = google.maps.geometry.spherical.computeLength(path);
    const lancamento = Math.ceil(drawnDistance / 10) * 10;
    let reserva = 0;
    const startPoint = path[0];
    const endPoint = path[path.length - 1];
    const cableObject = Array.isArray(cableOrPath) ? null : cableOrPath;
    if (cableObject) {
        reserva += getReserveForCableEndpoint(cableObject, true);
        if (path.length > 1 && !startPoint.equals(endPoint)) {
            reserva += getReserveForCableEndpoint(cableObject, false);
        }
    } else {
        reserva += getReserveForCablePoint(startPoint, activeFolderId);
        if (path.length > 1 && !startPoint.equals(endPoint)) {
            reserva += getReserveForCablePoint(endPoint, activeFolderId);
        }
    }
    return { lancamento, reserva, total: roundLengthUpToTen(lancamento + reserva) };
}

function syncProjectCableMeasurements(cables) {
    (cables || []).forEach((cable) => {
        if (!cable.path || cable.path.length < 2) return;
        applyCableAnchorsToPath(cable);
        const measurement = calculateCableMeasurement(cable);
        cable.lancamento = measurement.lancamento;
        cable.reserva = measurement.reserva;
        cable.totalLength = measurement.total;
        if (cable.item) updateCableSidebarLabel(cable);
    });
}

function getCableBaseLength(cable) {
    return calculateCableMeasurement(cable).total;
}

function getBillableProjectCables(projectId) {
    if (!projectId) return [];
    return getProjectItems(projectId).cables.filter(
        (cable) => cable.status !== 'Existente' && cable.type !== 'Cabo Importado'
    );
}

function groupCablesByType(cables) {
    const groups = {};
    (cables || []).forEach((cable) => {
        if (!groups[cable.type]) groups[cable.type] = [];
        groups[cable.type].push(cable);
    });
    return groups;
}

function getCableTypeBaseLength(cables) {
    const sum = (cables || []).reduce((total, cable) => total + getCableBaseLength(cable), 0);
    return roundLengthUpToTen(sum);
}

function getCableTypeSurcharge(cableType) {
    const bomKey = makeBomKey(cableType);
    return Math.max(0, parseFloat(bomState[bomKey]?.surchargePercent) || 0);
}

function getCableUnitPrice(cableType) {
    const bomKey = makeBomKey(cableType);
    const priceInfo = MATERIAL_PRICES[cableType] || { price: 0 };
    return bomState[bomKey]?.unitPrice ?? priceInfo.price;
}

function getCableDisplayQuantity(cableType, cables) {
    const bomKey = makeBomKey(cableType);
    const item = bomState[bomKey];
    if (item?.manualQuantity && item.quantity != null) {
        return roundLengthUpToTen(item.quantity);
    }
    const surcharge = getCableTypeSurcharge(cableType);
    return getCableTypeBillableLength(cables, surcharge);
}

function getCableTypeBillableLength(cables, surchargePercent) {
    const baseSum = getCableTypeBaseLength(cables);
    const surcharge = surchargePercent ?? getCableTypeSurcharge(cables[0]?.type);
    return roundLengthUpToTen(baseSum * (1 + surcharge / 100));
}

function getCableBillableLength(cable) {
    const projectId = getActiveProjectId();
    if (!projectId || !cable?.type) return getCableBaseLength(cable);
    const cablesOfType = getBillableProjectCables(projectId).filter((c) => c.type === cable.type);
    if (cablesOfType.length === 0) return getCableBaseLength(cable);
    const typeBillable = getCableTypeBillableLength(cablesOfType);
    const typeBase = getCableTypeBaseLength(cablesOfType);
    if (typeBase <= 0) return 0;
    return roundLengthUpToTen(getCableBaseLength(cable) * (typeBillable / typeBase));
}

function getActiveProjectId() {
    if (!activeFolderId) return null;
    const projectRootElement = document.getElementById(activeFolderId)?.closest('.folder');
    if (!projectRootElement) return null;
    return projectRootElement.querySelector('.folder-title')?.dataset.folderId || null;
}

//Atualização visual e cálculo de metragem do cabo
function updatePolylineFromMarkers() {
    cablePath = cableMarkers.map((marker) => marker.getPosition());
    if (cablePolyline) cablePolyline.setMap(null);
    const fiberType = document.getElementById("cableType").value;
    cablePolyline = new google.maps.Polyline({
        path: cablePath,
        geodesic: true,
        strokeColor: getCableColor(fiberType),
        strokeOpacity: 1.0,
        strokeWeight: parseInt(document.getElementById("cableWidth").value, 10) || 4,
        clickable: true,
        zIndex: 50,
        map: map,
    });
    setupCablePolylineClickInsert();
    const measurement = calculateCableMeasurement(cablePath);
    cableDistance = {
        lancamento: measurement.lancamento,
        reserva: measurement.reserva,
        total: measurement.total
    };
    if (isDrawingCable && cableMarkers.length > 0) {
        updateCableVertexLabels();
    }
    updateCableDrawReadout();
}

let cableDrawAnchors = { start: null, end: null }; //Marcadores clicados como ponta A e ponta B

//Ícone dos vértices do cabo em desenho
function getCableVertexIcon(isEndpoint, anchored) {
    return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: isEndpoint ? 8 : 4.5,
        fillColor: anchored ? '#16a34a' : '#ffffff',
        fillOpacity: 1,
        strokeColor: anchored ? '#ffffff' : '#0f172a',
        strokeWeight: isEndpoint ? 2 : 1.5,
    };
}

//Marcador de ancoragem de uma ponta: o clicado (se o ponto ainda estiver nele) ou o mais próximo a poucos metros
function resolveCableDrawEndpointForIndex(index, { snap = false, exclude = null } = {}) {
    const vertex = cableMarkers[index];
    if (!vertex) return null;
    const isStart = index === 0;
    const explicit = isStart ? cableDrawAnchors.start : cableDrawAnchors.end;
    const position = vertex.getPosition();
    if (explicit?.marker?.getMap() && markers.includes(explicit)) {
        const distance = google.maps.geometry.spherical.computeDistanceBetween(position, explicit.marker.getPosition());
        if (distance < 1.5) {
            if (snap) vertex.setPosition(explicit.marker.getPosition());
            return explicit;
        }
    }
    const nearby = resolveCableDrawEndpointAnchor(position, activeFolderId, exclude);
    if (nearby && snap) vertex.setPosition(nearby.marker.getPosition());
    return nearby;
}

//Marcador de ancoragem salvo de uma ponta do cabo
function resolveCableEndAnchor(cable, isStart) {
    const uid = isStart ? cable.startAnchorUid : cable.endAnchorUid;
    if (uid) {
        const byUid = markers.find(m => m.uid === uid && m.marker);
        if (byUid) return byUid;
    }
    const name = isStart ? cable.startAnchorMarkerName : cable.endAnchorMarkerName;
    if (!name || !cable.path?.length) return null;
    const point = isStart ? cable.path[0] : cable.path[cable.path.length - 1];
    const folderId = isStart ? cable.startAnchorMarkerFolderId : cable.endAnchorMarkerFolderId;
    const byName = resolveCableAnchorMarker(name, folderId || cable.folderId, point);
    if (!byName) return null;
    //Nunca "puxa" a ponta para um marcador distante só porque o nome é igual
    const distance = google.maps.geometry.spherical.computeDistanceBetween(point, byName.marker.getPosition());
    return distance <= KML_CABLE_ANCHOR_SNAP_DISTANCE_M ? byName : null;
}

//Mantém o nome gravado nos cabos quando o marcador é renomeado
function syncCableAnchorNamesForMarker(markerInfo) {
    if (!markerInfo?.uid) return;
    savedCables.forEach(cable => {
        if (cable.startAnchorUid === markerInfo.uid) cable.startAnchorMarkerName = markerInfo.name;
        if (cable.endAnchorUid === markerInfo.uid) cable.endAnchorMarkerName = markerInfo.name;
    });
}

function undoCableVertex() {
    if (!isDrawingCable || cableMarkers.length === 0) return;
    const allowShort = editingCableIndex === null;
    removeCableVertexAtIndex(cableMarkers.length - 1, { allowShort, showAlert: !allowShort });
}

//Painel do cabo: leituras, pontas e controles
function updateCableDrawReadout() {
    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const hasPoints = cableMarkers.length > 0;
    const startAnchor = hasPoints ? resolveCableDrawEndpointForIndex(0) : null;
    const endAnchor = cableMarkers.length > 1 ? resolveCableDrawEndpointForIndex(cableMarkers.length - 1, { exclude: startAnchor }) : null;
    setText('cableTotalDistance', `${cableDistance.total || 0} m`);
    setText('cableDrawnDistance', `${cableDistance.lancamento || 0} m`);
    setText('cableReserveDistance', `${cableDistance.reserva || 0} m`);
    setText('cablePoleEstimate', String(cableDistance.lancamento ? Math.ceil(cableDistance.lancamento / getPoleSpanDistance()) + 1 : 0));
    setText('cableVertexCount', `${cableMarkers.length} ponto${cableMarkers.length === 1 ? '' : 's'}`);
    setText('cableEndAName', startAnchor ? startAnchor.name : 'Clique em uma caixa');
    setText('cableEndBName', endAnchor ? endAnchor.name : (cableMarkers.length > 1 ? 'Clique na caixa de destino' : '—'));
    document.getElementById('cableEndA')?.classList.toggle('is-anchored', !!startAnchor);
    document.getElementById('cableEndB')?.classList.toggle('is-anchored', !!endAnchor);
    const help = document.getElementById('cableHelp');
    if (help) {
        help.innerHTML = !hasPoints
            ? 'Clique em uma <strong>CEO, CTO, reserva ou POP</strong> para iniciar o cabo (ponta A).'
            : (!endAnchor
                ? 'Clique no mapa seguindo os postes e termine clicando na <strong>caixa de destino</strong> (ponta B). Clique na linha para inserir um ponto; clique direito desfaz.'
                : 'Rota pronta. Arraste os pontos para ajustar ou clique em <strong>Salvar cabo</strong>.');
    }
    const saveButton = document.getElementById('saveCableButton');
    if (saveButton) saveButton.disabled = !(startAnchor && endAnchor);
    const undoButton = document.getElementById('undoCableVertexButton');
    if (undoButton) undoButton.disabled = !hasPoints;
    syncCablePanelControls();
}

function syncCablePanelControls() {
    const type = document.getElementById('cableType').value;
    const color = getCableColor(type);
    document.getElementById('cableTypeLabel').textContent = type;
    document.querySelectorAll('#cableTypeSwatches button').forEach(b => b.classList.toggle('is-active', b.dataset.value === type));
    document.querySelectorAll('#cableStatusSegmented button').forEach(b => b.classList.toggle('is-active', b.dataset.value === document.getElementById('cableStatusSelect').value));
    document.querySelectorAll('#cableASSegmented button').forEach(b => b.classList.toggle('is-active', b.dataset.value === document.getElementById('cableASType').value));
    document.getElementById('cableWidthValue').textContent = document.getElementById('cableWidth').value;
    const icon = document.getElementById('cablePanelIcon');
    if (icon) icon.style.setProperty('--cable-color', color);
}

function setupCablePanelControls() {
    const swatches = document.getElementById('cableTypeSwatches');
    if (swatches && !swatches.children.length) {
        Array.from(document.getElementById('cableType').options).forEach(option => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.value = option.value;
            button.title = option.textContent;
            button.style.setProperty('--swatch', getCableColor(option.value));
            button.innerHTML = `<span class="fiber-swatches__dot"></span>${option.value.replace('FO-', '')}`;
            swatches.appendChild(button);
        });
    }
    const bindSegmented = (groupId, selectId) => {
        document.querySelectorAll(`#${groupId} button`).forEach(button => {
            button.addEventListener('click', () => {
                const select = document.getElementById(selectId);
                select.value = button.dataset.value;
                select.dispatchEvent(new Event('change'));
                syncCablePanelControls();
            });
        });
    };
    bindSegmented('cableTypeSwatches', 'cableType');
    bindSegmented('cableStatusSegmented', 'cableStatusSelect');
    bindSegmented('cableASSegmented', 'cableASType');
    document.getElementById('cableWidth').addEventListener('input', () => {
        if (cablePolyline && isDrawingCable) cablePolyline.setOptions({ strokeWeight: parseInt(document.getElementById('cableWidth').value, 10) });
        syncCablePanelControls();
    });
    document.getElementById('undoCableVertexButton').addEventListener('click', undoCableVertex);
    document.getElementById('closeCablePanelButton').addEventListener('click', cancelCableDrawingSession);
}

function openCablePanel({ title, subtitle }) {
    document.getElementById('cablePanelTitle').textContent = title;
    document.getElementById('cablePanelSubtitle').textContent = subtitle;
    document.getElementById("cableDrawingBox").classList.remove("hidden");
    updateCableDrawReadout();
}

//Ferramenta de desenho do cabo
function startDrawingCable() {
    isDrawingCable = true;
    setAllPolygonsClickable(false);
    setAllCablesClickable(false);
    cablePath = [];
    cableMarkers.forEach((marker) => marker.setMap(null));
    cableMarkers = [];
    cableDrawAnchors = { start: null, end: null };
    cableDistance = { lancamento: 0, reserva: 0, total: 0 };
    if (cablePolyline) cablePolyline.setMap(null);
    cablePolyline = null;
    document.getElementById("cableStatusSelect").value = currentCableStatus;
    document.getElementById("cableName").value = "";
    cableNameAutoFill = { endMarkerName: null, lastValue: null };
    document.getElementById("cableWidth").value = getDefaultCableWidthForStatus(currentCableStatus);
    document.getElementById("deleteCableButton").classList.add("hidden");
    document.getElementById("invertCableButton").classList.add("hidden");
    openCablePanel({ title: 'Novo cabo', subtitle: 'Da ponta A até a ponta B' });
    document.getElementById("map").classList.add("cursor-draw");
    setMapCursor("crosshair");
}

//Atualiza o nome automático do cabo ao trocar o tipo de fibra
document.getElementById("cableType").addEventListener("change", () => {
    if (isDrawingCable) {
        applyCableNameAutoFill();
        updatePolylineFromMarkers();
    }
});

//Listener do botão desenhar cabo
document.getElementById("drawCableButton").addEventListener("click", () => {
    if (!requireEdit('desenhar cabos')) return;
    if (isAddingMarker || isDrawingCable) {
        showAlert("Atenção", "Finalize a ação atual antes de adicionar outro marcador ou cabo.");
        return;
    }
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione uma pasta para salvar o cabo.");
        return;
    }
    if (isMeasuring) stopRuler();
    if (isDrawingPolygon) cancelPolygonDrawing();
    if (isMarkerPanelOpen()) resetMarkerModal();
    currentCableStatus = 'Novo';
    startDrawingCable();
});

function finishCableDrawingUi() {
    cableMarkers.forEach((marker) => marker.setMap(null));
    cableMarkers = [];
    cablePath = [];
    cableDistance = { lancamento: 0, reserva: 0, total: 0 };
    cableDrawAnchors = { start: null, end: null };
    cableNameAutoFill = { endMarkerName: null, lastValue: null };
    suppressNextCableMapClick = false;
    editingCableIndex = null;
    isDrawingCable = false;
    if (cablePolyline) cablePolyline.setMap(null);
    cablePolyline = null;
    setAllPolygonsClickable(true);
    setAllCablesClickable(true);
    document.getElementById("invertCableButton").classList.add("hidden");
    document.getElementById("deleteCableButton").classList.add("hidden");
    document.getElementById("cableDrawingBox").classList.add("hidden");
    document.getElementById("map").classList.remove("cursor-draw");
    setMapCursor("");
}

//Salvar cabo
document.getElementById("saveCableButton").addEventListener("click", () => {
    const name = document.getElementById("cableName").value.trim();
    const asType = document.getElementById("cableASType").value;
    const newFiberTypeSelection = document.getElementById("cableType").value;
    const fullCableType = `Cabo ${asType} ${newFiberTypeSelection}`;
    const cor = getCableColor(newFiberTypeSelection);
    const largura = parseInt(document.getElementById("cableWidth").value, 10) || 4;
    const cableStatus = document.getElementById("cableStatusSelect").value || "Novo";
    //Não troca o tipo de fibra de um cabo que já tem fusões
    if (editingCableIndex !== null) {
        const originalCable = savedCables[editingCableIndex];
        if (getFiberType(originalCable.type) !== getFiberType(fullCableType)) {
            const usage = checkCableUsageInFusionPlans(originalCable);
            if (usage.hasFusions) {
                showAlert("Ação bloqueada", `Não é possível alterar o tipo do cabo "${originalCable.name}" porque ele tem fusões na(s) caixa(s): ${usage.locations.join(', ')}. Remova as fusões deste cabo antes de alterar o tipo.`);
                return;
            }
        }
    }
    if (!name) {
        showToast('Falta o nome', 'Digite um nome para o cabo.', 'progress');
        document.getElementById("cableName").focus();
        return;
    }
    if (cablePath.length < 2) {
        showToast('Rota incompleta', 'Desenhe pelo menos dois pontos.', 'progress');
        return;
    }
    const { startAnchor, endAnchor } = snapCableDrawEndpointsToAnchors();
    updatePolylineFromMarkers();
    if (!startAnchor) {
        showAlert("Ponta A sem caixa", "O cabo deve começar em uma CEO, CTO, reserva ou POP.");
        return;
    }
    if (!endAnchor) {
        showAlert("Ponta B sem caixa", "Termine o cabo clicando em uma CEO, CTO, reserva ou POP antes de salvar.");
        return;
    }
    if (isSameCableAnchorMarker(startAnchor, endAnchor)) {
        showAlert("Pontas iguais", "O cabo não pode começar e terminar na mesma caixa.");
        return;
    }
    if (google.maps.geometry.spherical.computeLength(cablePath) < 1) {
        showToast('Rota incompleta', 'Desenhe a rota do cabo antes de salvar.', 'progress');
        return;
    }
    if (editingCableIndex !== null) {
        const cabo = savedCables[editingCableIndex];
        const oldName = cabo.name;
        cabo.name = name;
        cabo.type = fullCableType;
        cabo.color = cor;
        cabo.width = largura;
        cabo.path = [...cablePath];
        cabo.status = cableStatus;
        assignCableAnchorMarkers(cabo, startAnchor, endAnchor);
        const measurement = calculateCableMeasurement(cabo);
        cabo.lancamento = measurement.lancamento;
        cabo.reserva = measurement.reserva;
        cabo.totalLength = measurement.total;
        cabo.polyline.setOptions({ strokeColor: cor, strokeWeight: largura });
        cabo.polyline.setPath(cabo.path);
        updateCableSidebarLabel(cabo);
        if (cabo.isImported) {
            cabo.item.querySelector('.adjust-kml-btn')?.remove();
            cabo.item.querySelector('.kml-status-btn')?.remove();
            cabo.isImported = false;
            wireCableSidebarClick(cabo);
        }
        cabo.polyline.setVisible(true);
        if (oldName !== name) updateCableNameInAllFusionPlans(oldName, name);
        finishCableDrawingUi();
        refreshBomAfterProjectChange();
        refreshClientDrops({ recompute: true });
        showToast('Cabo atualizado', `"${name}" · ${cabo.totalLength} m`);
        return;
    }
    const polyline = new google.maps.Polyline({
        path: cablePath,
        geodesic: true,
        strokeColor: cor,
        strokeOpacity: 1.0,
        strokeWeight: largura,
        clickable: true,
        map: map,
    });
    const nameSpan = document.createElement("span");
    nameSpan.className = 'item-name';
    nameSpan.style.cursor = "pointer";
    const item = buildGeProMapItemRow(nameSpan, polyline, 'ge-icon-path', cor);
    const parentUl = document.getElementById(activeFolderId);
    enableDropOnFolder(parentUl);
    parentUl.appendChild(item);
    const newCableInfo = {
        folderId: activeFolderId,
        name,
        type: fullCableType,
        width: largura,
        color: cor,
        path: [...cablePath],
        polyline,
        item,
        status: cableStatus,
        surchargePercent: 0,
    };
    assignCableAnchorMarkers(newCableInfo, startAnchor, endAnchor);
    const measurement = calculateCableMeasurement(newCableInfo);
    newCableInfo.lancamento = measurement.lancamento;
    newCableInfo.reserva = measurement.reserva;
    newCableInfo.totalLength = measurement.total;
    updateCableSidebarLabel(newCableInfo);
    savedCables.push(newCableInfo);
    wireCableSidebarClick(newCableInfo);
    addCableEventListeners(polyline);
    finishCableDrawingUi();
    refreshBomAfterProjectChange();
    refreshClientDrops({ recompute: true });
    showToast('Cabo salvo', `"${name}" · ${newCableInfo.totalLength} m`);
});

function openCableEditor(cabo) {
    const index = savedCables.indexOf(cabo);
    if (index === -1) {
        showAlert("Erro", "Não foi possível encontrar o cabo para edição.");
        return;
    }
    //Somente visualização: mostra os dados do cabo sem abrir o editor
    if (!AppSession.canEdit) {
        focusMapToCable(cabo);
        showToast(cabo.name, `${cabo.type} · ${cabo.status || 'Novo'} · ${cabo.totalLength} m (lançamento ${cabo.lancamento} m + reserva ${cabo.reserva} m)`, 'progress');
        return;
    }
    //Não troca de cabo no meio de um desenho: isso fazia o cabo em edição sumir
    if (isDrawingCable) {
        if (editingCableIndex === index) return;
        showToast('Cabo em edição', 'Salve ou cancele o cabo atual antes de abrir outro.', 'progress');
        return;
    }
    if (isAddingMarker || isSketchToolActive()) return;
    if (isMarkerPanelOpen()) resetMarkerModal();
    cabo.polyline?.setVisible(false);
    document.getElementById("cableName").value = cabo.name;
    const typeParts = cabo.type.split(' ');
    if (typeParts.length >= 4) {
        document.getElementById("cableASType").value = `${typeParts[1]} ${typeParts[2]}`;
        document.getElementById("cableType").value = typeParts[3];
    } else if (getFiberType(cabo.type)) {
        document.getElementById("cableType").value = getFiberType(cabo.type);
    }
    document.getElementById("cableWidth").value = cabo.width || getDefaultCableWidthForStatus(cabo.status);
    document.getElementById("cableStatusSelect").value = cabo.status || "Novo";
    document.getElementById("deleteCableButton").classList.remove("hidden");
    document.getElementById("invertCableButton").classList.remove("hidden");
    applyCableAnchorsToPath(cabo);
    cableDrawAnchors = { start: resolveCableEndAnchor(cabo, true), end: resolveCableEndAnchor(cabo, false) };
    cableNameAutoFill = { endMarkerName: null, lastValue: null };
    cableMarkers.forEach((marker) => marker.setMap(null));
    cableMarkers = [];
    cabo.path.forEach((position) => {
        const marker = createCableDrawVertexMarker(position);
        cableMarkers.push(marker);
        wireCableVertexMarker(marker);
    });
    isDrawingCable = true;
    editingCableIndex = index;
    setAllPolygonsClickable(false);
    setAllCablesClickable(false);
    updatePolylineFromMarkers();
    openCablePanel({ title: 'Editar cabo', subtitle: `${cabo.type} · ${cabo.status || 'Novo'}` });
    document.getElementById("map").classList.add("cursor-draw");
    setMapCursor("crosshair");
}

//Cancelar o desenho ou edição do cabo
document.getElementById("cancelCableButton").addEventListener("click", () => {
    cancelCableDrawingSession();
});

//Inicio da adiçao de marcador
document.getElementById("addMarkerButton").addEventListener("click", () => {
    if (!requireEdit('adicionar marcadores')) return;
    //Validação de estado
    if (isAddingMarker || isDrawingCable) {
        showAlert("Atenção", "Finalize a ação atual antes de adicionar outro marcador ou cabo.");
        return;
    }
    //Exige uma pasta ativa para salvar o item
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione uma pasta para salvar o marcador.");
        return;
    }
    if (isMeasuring) stopRuler();
    if (isDrawingPolygon) cancelPolygonDrawing();
    //Reseta formulários, seleções anteriores e abre o modal
    resetMarkerModal();
    document.querySelectorAll("#markerTypeModal .marker-option.selected").forEach(o => o.classList.remove("selected"));
    document.getElementById("markerTypeModal").style.display = "flex";
});


//Seleção de kits de datacenter
document.querySelectorAll(".datacenter-option").forEach(option => {
    option.addEventListener("click", () => {
        const itemName = option.getAttribute("data-item");
        if (itemName === 'PLACA') {
            const placaKitModal = document.getElementById("placaKitModal");
            document.getElementById('placaCordaoQty').value = 1;
            document.getElementById('placaOltQty').value = 1;
            document.getElementById('placaSfpQty').value = 1;
            placaKitModal.style.display = 'flex';
        } else if (itemName === 'OLT') {
            const oltKitModal = document.getElementById("oltKitModal");
            document.getElementById('oltCordaoQty').value = 1;
            document.getElementById('oltPlacaOltQty').value = 1;
            document.getElementById('oltSfpQty').value = 1;
            oltKitModal.style.display = 'flex';
        } else if (itemName === 'POP') {
            const popKitModal = document.getElementById('popKitModal');
            document.getElementById('popPlacaOltQty').value = 1;
            document.getElementById('popSfpQty').value = 1;
            document.getElementById('popCordaoScApcQty').value = 1;
            //Popula lista de itens fixos
            const fixedItemsList = document.getElementById('popFixedItemsList');
            fixedItemsList.innerHTML = ''; 
            getKitComponents('KIT POP').forEach(item => {
                const li = document.createElement('li');
                li.innerHTML = `<b>${item.quantity}x</b> ${item.name}`;
                fixedItemsList.appendChild(li);
            });
            popKitModal.style.display = 'flex';
        }
    });
});

//Adicionar material a BOM
function addMaterialToBom(materialName, quantity, unitPrice) {
    if (!activeFolderId) return;
    //Itens de kit da planilha de kits mantêm o nome da planilha; os demais usam o nome do catálogo
    if (unitPrice === undefined) materialName = resolveMaterialName(materialName);
    //Identifica o projeto e inicializa a BOM se necessário
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) return;
    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    if (!projectBoms[projectId]) {
        calculateBomState();
        projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
    }
    //Regra de negócio - insere automaticamente fita isolante se não existir
    const tapeName = "FITA ISOLANTE";
    if (!projectBoms[projectId][tapeName]) {
        const tapePriceInfo = MATERIAL_PRICES[tapeName];
        projectBoms[projectId][tapeName] = {
            quantity: 1,
            type: 'un',
            unitPrice: tapePriceInfo.price,
            category: 'Fusão',
            removed: false
        };
    }
    //Cria o item se não existir ou incrementa a quantidade
    const priceInfo = MATERIAL_PRICES[materialName] || { price: 0, category: 'Outros' };
    if (!projectBoms[projectId][materialName]) {
        projectBoms[projectId][materialName] = { quantity: 0, type: priceInfo.unit || 'un', unitPrice: unitPrice ?? priceInfo.price, category: unitPrice !== undefined ? 'Data Center' : (priceInfo.category || 'Outros'), removed: false };
    }
    projectBoms[projectId][materialName].quantity += quantity;
}

//Remover material da BOM
function removeMaterialFromBom(materialName, quantity) {
    if (!activeFolderId) return;
    materialName = resolveMaterialName(materialName);
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) return;
    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    //Decrementa a quantidade, garantindo que não fique negativa
    if (projectBoms[projectId] && projectBoms[projectId][materialName]) {
        projectBoms[projectId][materialName].quantity -= quantity;
        if (projectBoms[projectId][materialName].quantity < 0) {
            projectBoms[projectId][materialName].quantity = 0;
        }
    }
}




//Mapeamento de cores por tipo de fibras
function getCableColor(fiberType) {
    switch (fiberType) {
        case "FO-06": return "#000000";
        case "FO-12": return "#008000";
        case "FO-24": return "#FF69B4";
        case "FO-36": return "#0000FF";
        case "FO-48": return "#FF0000";
        case "FO-72": return "#800080";
        case "FO-144": return "#FFFF00";
        default: return "#000000";
    }
}

//Extração de padrão FO-XX
function getFiberType(fullCableType) {
    if (!fullCableType) return null;
    const match = fullCableType.match(/FO-\d+/);
    return match ? match[0] : null;
}

//Listeners atualização visual em tempo real
document.getElementById("cableType").addEventListener("change", () => {
    //Atualiza a cor da linha no mapa
    if (cablePolyline && isDrawingCable) {
        const fiberType = document.getElementById("cableType").value;
        const novaCor = getCableColor(fiberType);
        cablePolyline.setOptions({ strokeColor: novaCor });
    }
});

document.getElementById("cableWidth").addEventListener("change", () => {
    //Atualiza a espessua da linha
    if (cablePolyline && isDrawingCable) {
        const novaLargura = parseInt(document.getElementById("cableWidth").value);
        cablePolyline.setOptions({ strokeWeight: novaLargura });
    }
});

document.getElementById("cableStatusSelect").addEventListener("change", () => {
    if (isDrawingCable && editingCableIndex === null) {
        currentCableStatus = document.getElementById("cableStatusSelect").value;
        const defaultWidth = getDefaultCableWidthForStatus(currentCableStatus);
        document.getElementById("cableWidth").value = defaultWidth;
        if (cablePolyline) {
            cablePolyline.setOptions({ strokeWeight: defaultWidth });
        }
    }
});

//Exclusão de cabo
document.getElementById("deleteCableButton").addEventListener("click", () => {
    if (editingCableIndex === null) return;
    const cableToDelete = savedCables[editingCableIndex];
    const usage = checkCableUsageInFusionPlans(cableToDelete);
    if (usage.hasFusions) {
        showAlert("Ação bloqueada", `O cabo "${cableToDelete.name}" tem fusões nas caixas: ${usage.locations.join(', ')}. Remova as fusões no plano de fusão destas caixas antes de excluir o cabo.`);
        return;
    }
    let confirmMessage = `Excluir o cabo "${cableToDelete.name}"?`;
    if (usage.isInPlan) {
        confirmMessage += ` Ele também sai do plano de fusão de: ${usage.locations.join(', ')}.`;
    }
    showConfirm('Excluir cabo', confirmMessage, () => {
        if (usage.isInPlan) removeCableFromSavedFusionPlans(cableToDelete.name, usage.locations);
        const cabo = savedCables[editingCableIndex];
        cabo.polyline?.setMap(null);
        cabo.item?.remove();
        savedCables.splice(editingCableIndex, 1);
        finishCableDrawingUi();
        refreshBomAfterProjectChange();
        refreshClientDrops({ recompute: true });
        showToast('Cabo excluído', `"${cableToDelete.name}" foi removido.`);
    });
});

function initSelectionCardFeedback() {
    const cardSelector = [
        '.selection-card',
        '.marker-option',
        '.cto-status-option',
        '.ceo-status-option',
        '.ceo-accessory-option',
        '.cordoalha-status-option',
        '.reserva-status-option',
        '.cable-status-option',
        '.datacenter-option',
        '.splitter-status-option',
    ].join(', ');

    document.querySelectorAll(cardSelector).forEach((card) => {
        if (card.dataset.selectionFeedbackBound === '1') return;
        card.dataset.selectionFeedbackBound = '1';
        card.addEventListener('click', () => {
            const group = card.closest('.selection-grid, .marker-grid');
            if (!group) return;
            group.querySelectorAll(cardSelector).forEach((sibling) => sibling.classList.remove('selected'));
            card.classList.add('selected');
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                card.click();
            }
        });
    });
}
initSelectionCardFeedback();

document.querySelectorAll('.modal-option-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
        if (e.target.matches('input, label')) return;
        const checkbox = chip.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = !checkbox.checked;
    });
});

//Criação e gerencimento de marcador personalizado
function addCustomMarker(location, importedData = null) {
    //Iniciallização e renderização no mapa
    const data = importedData || selectedMarkerData;
    const isCasa = data.type === "CASA";
    //Cria o objeto marcador do Google Maps
    const marker = new google.maps.Marker({
        position: location,
        map: map,
        draggable: false,
    });
    //Criação do elemento na sidebar
    const nameSpan = document.createElement("span");
    nameSpan.className = 'item-name';
    nameSpan.style.cursor = "pointer";
    const li = buildGeProMapItemRow(nameSpan, marker, getMarkerSidebarIconClass(data.type), isCasa ? (data.color || '#ffffff') : (data.color || '#f9a825'));
    if (data.isImported) {
        const adjustBtn = document.createElement("button");
        adjustBtn.className = 'adjust-kml-btn';
        adjustBtn.textContent = 'Ajustar';
        adjustBtn.type = 'button';
        li.appendChild(adjustBtn);
    }
    const markerInfo = {
        marker: marker,
        listItem: li,
        folderId: activeFolderId,
        type: data.type,
        name: data.name,
        color: isCasa ? (data.color || "#ffffff") : data.color,
        labelColor: data.labelColor,
        size: data.size || DEFAULT_MARKER_SIZE,
        description: data.description,
        fusionPlan: "",
        fromKmlImport: data.fromKmlImport || false,
        pendingImportStatus: data.type === 'Importado' ? (data.pendingImportStatus || 'Nova') : null,
        //Propriedades específicas
        isImported: data.isImported || false, 
        ctoStatus: data.type === "CTO" ? data.ctoStatus : null,
        isPredial: data.type === "CTO" ? data.isPredial : null,
        needsStickers: data.type === "CTO" ? data.needsStickers : null,
        ceoStatus: data.type === "CEO" ? data.ceoStatus : null,
        ceoAccessory: data.type === "CEO" ? data.ceoAccessory : null,
        is144F: data.type === "CEO" ? data.is144F : null,
        cordoalhaStatus: data.type === "CORDOALHA" ? data.cordoalhaStatus : null,
        derivationTCount: data.type === "CORDOALHA" ? data.derivationTCount : null,
        reservaStatus: data.type === "RESERVA" ? data.reservaStatus : null,
        reservaAccessory: data.type === "RESERVA" ? data.reservaAccessory : null,
        client: data.type === "CLIENTE" ? { ...(data.client || {}) } : undefined,
        uid: data.uid || null,
    };
    ensureMarkerUid(markerInfo);
    if (markerInfo.type === "CLIENTE") resolveAutomaticClientCto(markerInfo);
    const parentUl = document.getElementById(activeFolderId);
    if (parentUl) {
        parentUl.appendChild(li);
    }
    if (data.isImported) {
        const adjustBtn = li.querySelector('.adjust-kml-btn');
        if (adjustBtn) {
            adjustBtn.onclick = (e) => {
                e.stopPropagation();
                focusMapToMarker(markerInfo);
                startMarkerAdjustment(markerInfo);
            };
        }
    }
    markers.push(markerInfo);
    //Um erro no visual ou na lista de materiais não pode deixar o marcador sem eventos nem travar o posicionamento
    try {
        updateMarkerAppearance(markerInfo);
        if (markerInfo.type === "CLIENTE") {
            refreshBomAfterProjectChange();
            if (!importedData) fillClientAddressFromMap(markerInfo);
        }
    } catch (error) {
        console.error(`Erro ao atualizar o marcador "${markerInfo.name}":`, error);
    }
    wireMarkerDrawHoverCursor(marker, markerInfo);
    //Evento de clique no marcador
    marker.addListener("click", () => {
        if (handleSketchMarkerClick(markerInfo)) return;
        if (!isDrawingCable) {
            openMarkerFromUserAction(markerInfo);
            return;
        }
        handleAnchorMarkerClickDuringCableDraw(markerInfo);
    });
    wireMarkerSidebarClick(markerInfo);
    wireMarkerSidebarSelection(markerInfo);
}

//Atualização visual do marcador (ícones em js/marker-icons.js)
function updateMarkerAppearance(markerInfo) {
    if (markerInfo.type === "CLIENTE") {
        applyClientAppearance(markerInfo);
        refreshClientDrops();
        return;
    }
    if (markerInfo.type === "CTO") refreshClientDrops();
    const isCasa = markerInfo.type === "CASA";
    const color = markerInfo.color || (isCasa ? '#ffffff' : '#f59e0b');
    markerInfo.marker.setIcon(buildMarkerMapIcon(markerInfo.type, {
        color,
        size: markerInfo.size,
        text: isCasa ? markerInfo.name : '',
        labelColor: markerInfo.labelColor,
    }));
    markerInfo.marker.setLabel(isCasa ? null : buildMarkerMapLabel(markerInfo.name, markerInfo.labelColor));
    //Barra lateral: nome em destaque e os detalhes (tipo, situação, instalação) em cinza
    const typeLabels = { CEO: 'CEO', CTO: 'CTO', CORDOALHA: 'Cordoalha', RESERVA: 'Reserva', POP: 'POP' };
    let details = [];
    if (markerInfo.type === "CTO") details = [markerInfo.ctoStatus, markerInfo.isPredial ? 'Predial' : null, markerInfo.needsStickers ? 'Adesivos' : null];
    if (markerInfo.type === "CEO") details = [markerInfo.ceoStatus, markerInfo.ceoAccessory, markerInfo.is144F ? '144F' : null];
    if (markerInfo.type === "CORDOALHA") details = [markerInfo.cordoalhaStatus, markerInfo.derivationTCount ? `${markerInfo.derivationTCount} deriv.` : null];
    if (markerInfo.type === "RESERVA") details = [markerInfo.reservaStatus, markerInfo.reservaAccessory];
    details = details.filter(Boolean);
    let name = markerInfo.name;
    let meta = [typeLabels[markerInfo.type] || markerInfo.type, ...details].join(' · ');
    let title = details.length ? `${markerInfo.name} - ${details.join(' · ')}` : markerInfo.name;
    if (isCasa) {
        const count = parseInt(markerInfo.name, 10) || 0;
        name = `${markerInfo.name} ${count === 1 ? 'casa' : 'casas'}`;
        meta = '';
        title = `Casas: ${markerInfo.name}`;
    }
    if (markerInfo.type === "Importado") {
        const pending = markerInfo.pendingImportStatus || 'Nova';
        meta = `Importado · ${pending === 'Existente' ? 'Existente' : 'Novo'}`;
        title = `${markerInfo.name} (${meta})`;
    }
    //Sem dica nativa do navegador no mapa (CTO/CEO mostram o cartão próprio); o título fica na barra lateral
    markerInfo.marker.setTitle(null);
    setSidebarItemLabel(markerInfo.listItem, name, meta);
    if (markerInfo.listItem) markerInfo.listItem.title = markerInfo.description || '';
    applyMarkerSidebarColorStyles(markerInfo);
}





//Controle do botão Plano de Fusão no modal de marcador
function setFusionPlanButtonState({ visible = false, enabled = false, title = '', onClick = null } = {}) {
    const btn = document.getElementById('fusionPlanButton');
    if (!btn) return;
    btn.classList.toggle('hidden', !visible);
    btn.disabled = !enabled;
    btn.title = title;
    btn.onclick = enabled && onClick ? onClick : null;
}


//Leva junto as pontas dos cabos ancorados no marcador que foi movido
function updateCablesForMovedMarker(oldPosition, newPosition, movedMarkerInfo = null) {
    const isAnchoredEnd = (cable, isStart, point) => {
        const uid = isStart ? cable.startAnchorUid : cable.endAnchorUid;
        if (uid) return !!movedMarkerInfo && uid === movedMarkerInfo.uid;
        const name = isStart ? cable.startAnchorMarkerName : cable.endAnchorMarkerName;
        const near = google.maps.geometry.spherical.computeDistanceBetween(point, oldPosition) < 1.5;
        return near && (!name || !movedMarkerInfo || name === movedMarkerInfo.name);
    };
    savedCables.forEach((cable) => {
        if (!cable.path?.length) return;
        let pathUpdated = false;
        const lastIndex = cable.path.length - 1;
        const newPath = cable.path.map((point, index) => {
            if ((index === 0 && isAnchoredEnd(cable, true, point)) || (index === lastIndex && index > 0 && isAnchoredEnd(cable, false, point))) {
                pathUpdated = true;
                return newPosition;
            }
            //Pontos intermediários colocados exatamente sobre o marcador acompanham
            if (index > 0 && index < lastIndex && google.maps.geometry.spherical.computeDistanceBetween(point, oldPosition) < 0.3) {
                pathUpdated = true;
                return newPosition;
            }
            return point;
        });
        if (pathUpdated) {
            cable.path = newPath;
            cable.polyline.setPath(newPath);
            const measurement = calculateCableMeasurement(cable);
            cable.lancamento = measurement.lancamento;
            cable.reserva = measurement.reserva;
            cable.totalLength = measurement.total;
            if (cable.item) updateCableSidebarLabel(cable);
        }
    });
}

//Exclusão de marcador
function deleteEditingMarker() {
    if (!editingMarkerInfo) return;
    const message = `Tem certeza que deseja excluir o marcador "${editingMarkerInfo.name}"?`;
    showConfirm('Excluir Marcador', message, () => {
        if (focusedMapMarkerInfo === editingMarkerInfo) {
            clearMapMarkerHighlight();
        }
        //Remove visualmente e dos dados globais
        editingMarkerInfo.marker.setMap(null);
        editingMarkerInfo.listItem.remove();
        markers = markers.filter((m) => m !== editingMarkerInfo);
        refreshClientDrops();
        showAlert("Sucesso", "Marcador excluído com sucesso.");
        resetMarkerModal();
    });
}


//Utilitário para gerar caminho
function generatePolylinePath(points) {
    if (points.length === 0) return "";
    //Mapeia array de coordenadas para comando
    const pathParts = points.map((p, i) => {
        return (i === 0 ? 'M' : 'L') + ` ${p.x} ${p.y}`;
    });
    return pathParts.join(' ');
}









//Editor de pastas e projetos
function openFolderEditor(titleElement) {
    if (!requireEdit('editar pastas e projetos')) return;
    editingFolderElement = titleElement;
    const isProject = titleElement.dataset.isProject === 'true';
    //Configuração para projetos
    if (isProject) {
        const projectModal = document.getElementById('projectModal');
        document.getElementById('projectName').value = titleElement.dataset.folderName;
        document.getElementById('projectCity').value = titleElement.dataset.folderCity;
        document.getElementById('projectNeighborhood').value = titleElement.dataset.folderNeighborhood;
        setProjectTypeValue(titleElement.dataset.folderType);
        document.getElementById('projectCity').closest('div').style.display = 'block';
        document.getElementById('projectNeighborhood').closest('div').style.display = 'block';
        document.getElementById('projectType').closest('div').style.display = 'block';
        projectModal.querySelector('h2').textContent = 'Editar Projeto';
        projectModal.querySelector('#confirmProjectButton').textContent = 'Salvar Alterações';
        projectModal.style.display = 'flex';
    } else {
        //Configuração para pastas comuns
        const folderModal = document.getElementById('folderModal');
        document.getElementById('folderNameInput').value = titleElement.dataset.folderName;
        folderModal.querySelector('h2').textContent = 'Editar Pasta';
        folderModal.querySelector('#confirmFolderButton').textContent = 'Salvar Alterações';
        folderModal.style.display = 'flex';
    }
}

let activeSplitterForOltConfig = null;

function getMarkersInFolderScope(folderId) {
    const folderIds = getAllDescendantFolderIds(folderId);
    return markers.filter((markerInfo) => {
        if (!folderIds.includes(markerInfo.folderId)) return false;
        if (markerInfo.type === 'CASA') return false;
        return true;
    });
}

//Menu de ações da barra lateral e "Padronizar estilo": js/sidebar.js

//Utilitário: Obter IDs de subpastas
function getAllDescendantFolderIds(startFolderId) {
    const startElement = document.getElementById(startFolderId);
    if (!startElement) return [];
    //Retorna ID da pasta atual
    const descendantUls = startElement.querySelectorAll('ul');
    return [startFolderId, ...Array.from(descendantUls).map(ul => ul.id)];
}

//Centraliza o mapa na área dos itens da pasta/projeto (e subpastas), para facilitar a navegação.
function focusMapToFolderScope(folderUlId) {
    if (!folderUlId || typeof map === 'undefined' || !map) return;
    const folderIds = getAllDescendantFolderIds(folderUlId);
    if (!folderIds.length) return;

    const bounds = new google.maps.LatLngBounds();
    let pointCount = 0;

    markers.forEach((m) => {
        if (!folderIds.includes(m.folderId) || !m.marker) return;
        const pos = m.marker.getPosition();
        if (!pos) return;
        bounds.extend(pos);
        pointCount += 1;
    });

    savedCables.forEach((c) => {
        if (!folderIds.includes(c.folderId) || !c.path || !c.path.length) return;
        c.path.forEach((pt) => {
            bounds.extend(pt);
            pointCount += 1;
        });
    });

    savedPolygons.forEach((p) => {
        if (!folderIds.includes(p.folderId) || !p.path || !p.path.length) return;
        p.path.forEach((pt) => {
            bounds.extend(pt);
            pointCount += 1;
        });
    });

    if (pointCount > 0) {
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        const samePoint = ne && sw && ne.lat() === sw.lat() && ne.lng() === sw.lng();
        if (samePoint || pointCount === 1) {
            map.panTo(bounds.getCenter());
            const z = map.getZoom();
            if (!z || z < 15) map.setZoom(15);
            return;
        }
        map.fitBounds(bounds, { top: 56, right: 48, bottom: 56, left: getMapFocusPadding() });
        return;
    }

    const ulEl = document.getElementById(folderUlId);
    const titleEl = ulEl?.previousElementSibling;
    if (!titleEl || !titleEl.classList.contains('folder-title')) return;
    const city = titleEl.dataset.folderCity;
    const neighborhood = titleEl.dataset.folderNeighborhood;
    const query = [neighborhood, city].filter(Boolean).join(', ');
    if (!query) return;
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: `${query}, Brasil`, region: 'BR' }, (results, status) => {
        if (status !== 'OK' || !results || !results[0]) return;
        map.panTo(results[0].geometry.location);
        map.setZoom(14);
    });
}

//Controle de visibilidade em massa
function handleVisibilityToggle(element, explicitVisible) {
    const folderId = element.dataset.folderId;
    if (!folderId) return;
    const newVisibility = explicitVisible !== undefined
        ? explicitVisible
        : (element.type === 'checkbox' ? element.checked : element.dataset.visible !== 'true');
    const folderIdsToToggle = getAllDescendantFolderIds(folderId);
    markers.forEach(markerInfo => {
        if (folderIdsToToggle.includes(markerInfo.folderId)) {
            markerInfo.marker.setVisible(newVisibility);
        }
    });
    savedCables.forEach(cable => {
        if (folderIdsToToggle.includes(cable.folderId)) {
            cable.polyline.setVisible(newVisibility);
        }
    });
    savedPolygons.forEach(polygon => {
        if (folderIdsToToggle.includes(polygon.folderId)) {
            polygon.polygonObject.setVisible(newVisibility);
        }
    });
    element.dataset.visible = String(newVisibility);
    if (element.type === 'checkbox') {
        element.checked = newVisibility;
        element.title = newVisibility ? 'Ocultar no mapa' : 'Exibir no mapa';
    } else {
        element.innerHTML = uiIcon(newVisibility ? 'eye' : 'eye-off');
        element.title = newVisibility ? 'Ocultar itens no mapa' : 'Exibir itens no mapa';
    }
    folderIdsToToggle.forEach((id) => {
        const ul = document.getElementById(id);
        if (!ul) return;
        ul.querySelectorAll(':scope > .ge-pro-item .ge-vis-checkbox').forEach((cb) => {
            cb.checked = newVisibility;
            cb.dataset.visible = String(newVisibility);
        });
    });
}

//Nomes antigos do sistema → nomes da planilha de preços da empresa.
//O código continua usando os nomes antigos internamente (tipos de cabo, splitters…);
//tudo que vira material (preço, lista de materiais, catálogo, relatórios) passa pelo nome novo.
const MATERIAL_RENAMES = {
    "SUPORTE ANCORAGEM PARA CABOS OPTICOS (SUPAS)": "SUPORTE ANCORAGEM PARA CABOS OPTICOS (SUPA)",
    "RESERVA OPTILOOP": "RESERVA OPTILOOP (RAQUETE)",
    "DERIVAÇÃO EM T": "ALÇA PREFORMADA DERIVAÇÃO EM T",
    "FITA DE AÇO INOX 3/4'' (FITA FUSIMEC) ROLO DE 25M": "FITA DE AÇO INOX 3/4\" (FITA FUSIMEC) ROLO DE 25M",
    "PLAQUETA DE IDENTIFICAÇÃO": "PLAQUETA DE IDENTIFICAÇÃO DE CABOS",
    "ALÇA PREFORMADA OPDE 1007 - 12,8MM A 14,2MM": "ALÇA PREFORMADA OPDE 1007 - 12,8mm a 14,2mm",
    "ARAME DE ESPIMAR (105 m)": "ARAME DE ESPINAR (BOBINA DE 105M)",
    "PRENSA DE ESPINAR": "PRENÇA PARA ESPINAR",
    "CABO DROP FLAT LOW FRICTION 1F": "DROP FLAT 1FO",
    "Cabo AS 80 FO-06": "CFOA SM ASU 80 S 06 FIBRAS NR",
    "Cabo AS 80 FO-12": "CFOA SM ASU 80 S 12 FIBRAS NR",
    "Cabo AS 80 FO-24": "CFOA SM AS 80 S 24 FIBRAS NR KP",
    "Cabo AS 80 FO-36": "CFOA SM AS 80 S 36 FIBRAS NR KP",
    "Cabo AS 80 FO-48": "CFOA SM AS 80 S 48 FIBRAS NR KP",
    "Cabo AS 80 FO-72": "CFOA SM AS 80 S 72 FIBRAS NR KP",
    "Cabo AS 80 FO-144": "CFOA SM AS 80 S 144 FIBRAS NR KP",
    "Cabo AS 200 FO-12": "CFOA SM AS 200 S 12 FIBRAS NR KP",
    "Cabo AS 200 FO-24": "CFOA SM AS 200 S 24 FIBRAS NR KP",
    "Cabo AS 200 FO-36": "CFOA SM AS 200 S 36 FIBRAS NR KP",
    "CAIXA DE ATENDIMENTO": "CTO FIBERSUL",
    "CAIXA DE EMENDA OPTICA (CEO) 144 FUSÕES": "CAIXAS DE EMENDA OPTICA DE 144 FIBRAS",
    "CAIXA DE EMENDA ÓPTICA (CEO)": "CAIXAS DE FUSÃO - 24F (EXPANSIVA)",
    "Splitter 1/2": "SPLITTER FUSÃO 1/2",
    "Splitter 1/4": "SPLITTER FUSÃO 1/4",
    "Splitter 1/8": "SPLITTER FUSÃO 1/8",
    "Splitter 1/8 APC": "SPLITTER CONECTORIZADO 1/8 SC/APC",
    "Splitter 1/8 UPC": "SPLITTER CONECTORIZADO 1/8 SC/UPC",
    "Splitter 1/16 APC": "SPLITTER CONECTORIZADO 1/16 SC/APC",
    "Splitter 1/16 UPC": "SPLITTER CONECTORIZADO 1/16 SC/UPC",
    "KIT DE BANDEJA PARA CAIXA DE EMENDA": "KIT DE BANDEJA PARA CAIXA TIPO FOSC - 24F",
    "KIT DERIVAÇÃO PARA CAIXA DE EMENDA OPTICA": "KIT DERIVAÇÃO PARA CAIXA DE EMENDA ÓPTICA",
    "PTO - PONTO DE TERMINAÇÃO ÓPTICA": "PONTO DE TERMINAÇÃO ÓPTICA (PTO)",
    "CAIXA DE ATENDIMENTO PREDIAL": "CAIXA DE TERMINAÇÃO ÓPTICA PREDIAL",
    "CONECTOR DE CAMPO SC/APC": "CONECTOR PRÉ-POLIDO",
    "RODIZIO RP50 PL50X67 - KIT 4 PEÇAS": "KIT RODIZIO DE 4 PEÇAS COM 4 RODAS PARA RACK IPMETAL 60X60CM RP50 PL50X67",
    "KIT PORCA GAIOLA + PARAFUSO": "PORCA GAIOLA + PARAFUSO",
    "ROLO VELCRO DE 3 METROS PARA ORGANIZAR CABOS": "ROLO VELCRO 3M PARA ORGANIZAR CABOS",
    "DGO 144 SC/APC COM PIGTAILS COR PRETA": "DIO DE 144 POSIÇÕES SC/APC COM PIGTAILS COR PRETA",
    "CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2m": "CORDÕES SC-PC/ SC-APC",
    "CORDÃO ÓPTICO DUPLEX MULTIMODO LC/UPC > LC/UPC OM3 2M": "CORDÃO ÓPTICO DUPLEX MULTIMODO LC/UPC - LC/UPC 2m",
    "CORDÃO ÓPTICO DUPLEX MONOMODO LC/UPC > SC/APC 2M": "CORDÃO ÓPTICO DUPLEX MONOMODO LC/UPC - SC/APC 2m",
    "PATCHCORD CAT6 AZUL 1,5M": "PATCHCORD MAXITELECOM CAT6 1,5m",
    "SFP 1270NM TX/1330NM RX 20KM, 10G, BIDI": "SFP+ (1270nm TX/1330nm RX 20Km, 10G, BIDI)",
    "SFP 1330NM TX/1270NM RX 20KM, 10G, BIDI": "SFP+ (1330nm TX/1270nm RX 20Km, 10G, BIDI)",
    "SFP 850NM 10G 0,3KM MULTIMODO DUPLEX": "SFP (MULTIMODO, 10G, DUPLEX)",
    "FONTE INVERSORA 48VCC/110VCA 600W": "INVERSOR 48VCC/110VCA 600W - XPS",
    "AR CONDICIONADO SPLIT HI WALL LG DUAL INVERTER 12000 BTUS FRIO 220V": "AR CONDICIONADO SPLIT HI WALL LG DUAL INVERTER 12000 BTUs FRIO"
};

function resolveMaterialName(name) {
    return MATERIAL_RENAMES[name] || name;
}

//Banco de dados de preços e materiais (chaves com os nomes da planilha; aceita também os antigos)
const MATERIAL_PRICES_BASE = {
    //Define itens que, ao serem adicionados, inserem automaticamente subcomponentes na BOM
    "CTO": {
        price: 0,
        unit: 'un',
        components: [
            { name: "CAIXA DE ATENDIMENTO", quantity: 1 },
            { name: "ABRAÇADEIRA DE NYLON", quantity: 4 },
            { name: "ANEL GUIA", quantity: 4 },
            { name: "FECHO DENTADO PARA FITA DE AÇO INOX 3/4", quantity: 2 }
        ]
    },

    //Componentes passivos de fusão
    "CAIXA DE ATENDIMENTO": { price: 92.29, unit: 'un', category: 'Fusão' },
    //Diferenciação de preços entre conectores
    "Splitter 1/2": { price: 28.91, unit: 'un', category: 'Fusão' },
    "Splitter 1/4": { price: 29.00, unit: 'un', category: 'Fusão' },
    "Splitter 1/8": { price: 38.90, unit: 'un', category: 'Fusão' },
    "Splitter 1/16": { price: 49.90, unit: 'un', category: 'Fusão' },
    "Splitter 1/2 APC": { price: 31.89, unit: 'un', category: 'Fusão' },
    "Splitter 1/4 APC": { price: 38.50, unit: 'un', category: 'Fusão' },
    "Splitter 1/8 APC": { price: 55.00, unit: 'un', category: 'Fusão' },
    "Splitter 1/16 APC": { price: 94.00, unit: 'un', category: 'Fusão' },
    "Splitter 1/2 UPC": { price: 30.30, unit: 'un', category: 'Fusão' },
    "Splitter 1/4 UPC": { price: 37.00, unit: 'un', category: 'Fusão' },
    "Splitter 1/8 UPC": { price: 42.00, unit: 'un', category: 'Fusão' },
    "Splitter 1/16 UPC": { price: 86.84, unit: 'un', category: 'Fusão' },
    "TUBETE PROTETOR DE EMENDA OPTICA": { price: 0.08, unit: 'un', category: 'Fusão' },
    "ADAPTADOR SC/APC COM ABAS (PASSANTE)": { price: 1.10, unit: 'un', category: 'Fusão' },
    "ADAPTADOR SC/UPC COM ABAS (PASSANTE)": { price: 1.10, unit: 'un', category: 'Fusão' },
    "ADAPTADOR SC/APC SEM ABAS (PASSANTE)": { price: 0.89, unit: 'un', category: 'Fusão' },
    "ADAPTADOR SC/UPC SEM ABAS (PASSANTE)": { price: 0.89, unit: 'un', category: 'Fusão' },
    "KIT DERIVAÇÃO PARA CAIXA DE EMENDA OPTICA": { price: 14.40, unit: 'un', category: 'Fusão' },
    "FITA ISOLANTE": { price: 5.10, unit: 'un', category: 'Fusão' },
    "KIT DE BANDEJA PARA CAIXA DE EMENDA": { price: 16.54, unit: 'un', category: 'Fusão' },
    "CAIXA DE ATENDIMENTO PREDIAL": { price: 85.59, unit: 'un', category: 'Fusão' }, //
    //Ferragens de poste e sustentação
    "ABRAÇADEIRA DE NYLON": { price: 0.22, unit: 'un', category: 'Ferragem' },
    "ANEL GUIA": { price: 0.75, unit: 'un', category: 'Ferragem' },
    "FECHO DENTADO PARA FITA DE AÇO INOX 3/4": { price: 0.44, unit: 'un', category: 'Ferragem' },
    "FITA DE AÇO INOX 3/4'' (FITA FUSIMEC) ROLO DE 25M": { price: 51.80, unit: 'un', category: 'Ferragem' },
    "PLAQUETA DE IDENTIFICAÇÃO": { price: 1.17, unit: 'un', category: 'Ferragem' },
    "SUPORTE DIELETRICO DUPLO": { price: 9.00, unit: 'un', category: 'Ferragem' },
    "PARAFUSO M12X35 - SEM PORCA": { price: 0.65, unit: 'un', category: 'Ferragem' },
    "SUPORTE REFORÇADO HORIZONTAL PARA BAP": { price: 2.50, unit: 'un', category: 'Ferragem' },
    "SUPORTE ANCORAGEM PARA CABOS OPTICOS (SUPAS)": { price: 9.51, unit: 'un', category: 'Ferragem' },
    "ALÇA PREFORMADA OPDE 1008 - 6,8mm a 7,4mm": { price: 2.29, unit: 'un', category: 'Ferragem' },
    "ALÇA PREFORMADA OPDE 1020 - 9,0mm a 9,8mm": { price: 5.91, unit: 'un', category: 'Ferragem' },
    "ALÇA PREFORMADA OPDE 1021 - 9,6mm a 10,4mm": { price: 8.40, unit: 'un', category: 'Ferragem' },
    "ABRAÇADEIRA BAP 3": { price: 16.08, unit: 'un', category: 'Ferragem' },
    //Caixa de emenda e acessórios
    "CAIXA DE EMENDA ÓPTICA (CEO)": { price: 186.29, unit: 'un', category: 'Fusão' },
    "CAIXA DE EMENDA OPTICA (CEO) 144 FUSÕES": { price: 265, unit: 'un', category: 'Fusão' },
    "SUPORTE PARA CEO": { price: 16.92, unit: 'un', category: 'Ferragem' },
    "RAQUETE PARA CEO": { price: 37.00, unit: 'un', category: 'Ferragem' },
    "TAP BRACKET": { price: 9.21, unit: 'un', category: 'Ferragem' },
    "ARAME DE ESPIMAR (105 m)": { price: 22.00, unit: 'un', category: 'Ferragem' },
    "PRENSA DE ESPINAR": { price: 2.73, unit: 'un', category: 'Ferragem' },
    "ALÇA PREFORMADA PARA CORDOALHA 3/16 POL": { price: 3.19, unit: 'un', category: 'Ferragem' },
    "FITA DE AMARRAÇÃO INOX 16 POL": { price: 2.48, unit: 'un', category: 'Ferragem' },
    "SUPORTE PRESBOW (REX)": { price: 15.68, unit: 'un', category: 'Ferragem' },
    "ISOLADOR ROLDANA": { price: 9.50, unit: 'un', category: 'Ferragem' },
    "KIT DERIVAÇÃO POR CABO": { price: 14.40, unit: 'un', category: 'Fusão' },
    "DERIVAÇÃO EM T": { price: 3.95, unit: 'un', category: 'Ferragem' },
    "CABO DE AÇO CORDOALHA 3/16 POL": { price: 3.29, unit: 'm', category: 'Ferragem' },
    //Marcadores lógicos
    "RESERVA": { price: 0, unit: 'un', category: 'Ferragem' },
    "CASA": { price: 0.00, unit: 'un', category: 'Atendimento' },
    //Atendimento ao cliente (drop e acessórios do kit de instalação)
    "CABO DROP FLAT LOW FRICTION 1F": { price: 0.55, unit: 'm', category: 'Lançamento' },
    "CONECTOR DE CAMPO SC/APC": { price: 3.90, unit: 'un', category: 'Fusão' },
    "ESTICADOR PARA CABO DROP": { price: 1.20, unit: 'un', category: 'Ferragem' },
    "PTO - PONTO DE TERMINAÇÃO ÓPTICA": { price: 6.50, unit: 'un', category: 'Fusão' },
    //Equipamentos ativos
    "PLACA": { price: 0, unit: 'un', category: 'Data Center'},
    "CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2m": { price: 6.90, unit: 'un', category: 'Data Center'},
    "CHASSI OLT C650 ZTE": { price: 2598.40, unit: 'un', category: 'Data Center'},
    "LICENÇA OLT": { price: 5043.00, unit: 'un', category: 'Data Center'},
    "MÓDULO DE ENERGIA DC C650-C600 PARA OLT ZTE": { price: 659.43, unit: 'un', category: 'Data Center'},
    "PLACA CONTROLADORA E SWITCHING C600/C650": { price: 6056.20, unit: 'un', category: 'Data Center'},
    "SFP 1270NM TX/1330NM RX 20KM, 10G, BIDI": { price: 140, unit: 'un', category: 'Data Center' },
    "SFP 1330NM TX/1270NM RX 20KM, 10G, BIDI": { price: 140, unit: 'un', category: 'Data Center' },
    "XFP 850NM 10G 0,3KM MULTIMODO DUPLEX": { price: 249, unit: 'un', category: 'Data Center' },
    "RACK INDOOR IPMETAL 44U 800X1000MM / PRETO / PORTA DIANTEIRA PERFURADO E TRASEIRA BI-PARTIDA PERFURADO / CALHA LATERAL": { price: 4736.38, unit: 'un', category: 'Data Center' },
    "RODIZIO RP50 PL50X67 - KIT 4 PEÇAS": { price: 99.69, unit: 'un', category: 'Data Center' },
    "BANDEJA DE VENTILAÇÃO DE TETO PARA RACK IPMETAL 44U 1000MM": { price: 388.08, unit: 'un', category: 'Data Center' },
    "GUIA DE CABO 1U EM ABS COR PRETA": { price: 16.62, unit: 'un', category: 'Data Center' },
    "KIT PORCA GAIOLA + PARAFUSO": { price: 0.80, unit: 'un', category: 'Data Center' },
    "RÉGUA DE TOMADA 2P+T 10A, CABO DE 2,5M COM BITOLA 1,5MM² / SEM FUSÍVEL E DISJUNTOR": { price: 125.09, unit: 'un', category: 'Data Center' },
    "ROLO VELCRO DE 3 METROS PARA ORGANIZAR CABOS": { price: 8.55, unit: 'un', category: 'Data Center' },
    "DGO 144 SC/APC COM PIGTAILS COR PRETA": { price: 3671.13, unit: 'un', category: 'Data Center' },
    "CAIXA DE EMENDA OPTICA FIBRACEM 216F JUMBO SVM COM REENTRADA DIAMETRO 13 A 18MM": { price: 265, unit: 'un', category: 'Data Center' },
    "KIT DE DERIVAÇÃO SVM PARA CEO 144F GROMMET (2 ENTRADAS 7 A 13MM)": { price: 15.61, unit: 'un', category: 'Data Center' },
    "ALÇA PREFORMADA OPDE 1007 - 12,8MM A 14,2MM": { price: 10.2, unit: 'un', category: 'Data Center' },
    "SUPORTE REX ARMAÇÃO SECUNDÁRIA 1X1 PRESBOW 4,8 MM": { price: 12.54, unit: 'un', category: 'Data Center' },
    "ISOLADOR ROLDANA 72X72 PORCELANA": { price: 7.33, unit: 'un', category: 'Data Center' },
    "BRAÇADEIRA BAP 3": { price: 12.06, unit: 'un', category: 'Data Center' },
    "RESERVA OPTILOOP": { price: 36.5, unit: 'un', category: 'Data Center' },
    "CABO DE AÇO CORDOALHA 3/16 POL D": { price: 3.29, unit: 'm', category: 'Data Center' },
    "ALÇA PREFORMADA PARA CORDOALHA 3/16 (4,8MM)": { price: 3.68, unit: 'un', category: 'Data Center' },
    "CORDÃO ÓPTICO DUPLEX MULTIMODO LC/UPC > LC/UPC OM3 2M": { price: 41.9, unit: 'un', category: 'Data Center' },
    "CORDÃO ÓPTICO DUPLEX MONOMODO LC/UPC > SC/APC 2M": { price: 17.9, unit: 'un', category: 'Data Center' },
    "PATCHCORD CAT6 AZUL 1,5M": { price: 29.9, unit: 'un', category: 'Data Center' },
    "PATCHCORD CAT6 AZUL 2,5M": { price: 45.9, unit: 'un', category: 'Data Center' },
    "PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)": { price: 5545, unit: 'un', category: 'Data Center' },
    "MÓDULO SFP C+ PARA PLACA OLT LINE ANYPON ZTE": { price: 300.08, unit: 'un', category: 'Data Center' },
    "SWITCH MPLS 24 PORTAS": { price: 24538.31, unit: 'un', category: 'Data Center' },
    "SFP 850NM 10G 0,3KM MULTIMODO DUPLEX": { price: 50.43, unit: 'un', category: 'Data Center' },
    "SFP GBIC ELÉTRICO": { price: 92.17, unit: 'un', category: 'Data Center' },
    "FONTE RETIFICADORA 48VCC / 100A ~ 200A": { price: 11580, unit: 'un', category: 'Data Center' },
    "BATERIA DE LÍTIO 100A FB100B3 ZTE": { price: 6660, unit: 'un', category: 'Data Center' },
    "FONTE INVERSORA 48VCC/110VCA 600W": { price: 2324, unit: 'un', category: 'Data Center' },
    "VALOR ESTIMADO COM MATERIAIS ELÉTRICOS, DISJUNTORES, QDC, CABOS, ILUMINAÇÃO, ETC,.": { price: 6500, unit: 'un', category: 'Data Center' },
    "PRESTAÇÃO DE SERVIÇO ELETRICISTA": { price: 6000, unit: 'un', category: 'Data Center' },
    "AR CONDICIONADO SPLIT HI WALL LG DUAL INVERTER 12000 BTUS FRIO 220V": { price: 3196, unit: 'un', category: 'Data Center' },
    "PRESTAÇÃO DE SERVIÇO INSTALAÇÃO AR CONDICIONADO": { price: 900, unit: 'un', category: 'Data Center' },
    "CAMERA DE MONITORAMENTO IP INTELBRAS VIP 1220 B G3": { price: 339, unit: 'un', category: 'Data Center' },
    "MÉDIA DE ALUGUEL MENSAL": { price: 900, unit: 'un', category: 'Data Center' },

    //CAbos AS 80 e AS 200
    "CABO ÓPTICO AS 80 S 144 FIBRAS NR KP": { price: 10.80, unit: 'm', category: 'Data Center' },
    "Cabo AS 80 FO-06": { price: 1.66, unit: 'm', category: 'Lançamento' },
    "Cabo AS 200 FO-06": { price: 2.08, unit: 'm', category: 'Lançamento' },
    "Cabo AS 80 FO-12": { price: 2.02, unit: 'm', category: 'Lançamento' },
    "Cabo AS 200 FO-12": { price: 2.53, unit: 'm', category: 'Lançamento' },
    "Cabo AS 80 FO-24": { price: 3.26, unit: 'm', category: 'Lançamento' },
    "Cabo AS 200 FO-24": { price: 4.08, unit: 'm', category: 'Lançamento' },
    "Cabo AS 80 FO-36": { price: 3.93, unit: 'm', category: 'Lançamento' },
    "Cabo AS 200 FO-36": { price: 4.91, unit: 'm', category: 'Lançamento' },
    "Cabo AS 80 FO-48": { price: 5.10, unit: 'm', category: 'Lançamento' },
    "Cabo AS 200 FO-48": { price: 6.38, unit: 'm', category: 'Lançamento' },
    "Cabo AS 80 FO-72": { price: 5.32, unit: 'm', category: 'Lançamento' },
    "Cabo AS 200 FO-72": { price: 6.65, unit: 'm', category: 'Lançamento' },
    "Cabo AS 80 FO-144": { price: 10.80, unit: 'm', category: 'Lançamento' },
    "Cabo AS 200 FO-144": { price: 13.50, unit: 'm', category: 'Lançamento' },
    //Mão de obra
    "Mão de Obra Regional": { price: 320.00, unit: 'un', category: 'Mão de Obra' }, // Custo por técnico/dia (8h * R$40/h)
    "Mão de Obra Terceirizada": { price: 0, unit: 'un', category: 'Mão de Obra' }
};
//Materiais do sistema que não estão na planilha de preços da empresa: saem do catálogo e dos preços
//(se algum cálculo ainda usar, aparece na lista de materiais sem preço)
const MATERIALS_NOT_IN_SHEET = [
    "Splitter 1/16",
    "Splitter 1/2 APC",
    "Splitter 1/4 APC",
    "Splitter 1/2 UPC",
    "Splitter 1/4 UPC",
    "ADAPTADOR SC/APC SEM ABAS (PASSANTE)",
    "SUPORTE REFORÇADO HORIZONTAL PARA BAP",
    "RAQUETE PARA CEO",
    "SUPORTE PRESBOW (REX)",
    "ISOLADOR ROLDANA",
    "KIT DERIVAÇÃO POR CABO",
    "ESTICADOR PARA CABO DROP",
    "CHASSI OLT C650 ZTE",
    "LICENÇA OLT",
    "MÓDULO DE ENERGIA DC C650-C600 PARA OLT ZTE",
    "PLACA CONTROLADORA E SWITCHING C600/C650",
    "XFP 850NM 10G 0,3KM MULTIMODO DUPLEX",
    "RACK INDOOR IPMETAL 44U 800X1000MM / PRETO / PORTA DIANTEIRA PERFURADO E TRASEIRA BI-PARTIDA PERFURADO / CALHA LATERAL",
    "BANDEJA DE VENTILAÇÃO DE TETO PARA RACK IPMETAL 44U 1000MM",
    "RÉGUA DE TOMADA 2P+T 10A, CABO DE 2,5M COM BITOLA 1,5MM² / SEM FUSÍVEL E DISJUNTOR",
    "CAIXA DE EMENDA OPTICA FIBRACEM 216F JUMBO SVM COM REENTRADA DIAMETRO 13 A 18MM",
    "KIT DE DERIVAÇÃO SVM PARA CEO 144F GROMMET (2 ENTRADAS 7 A 13MM)",
    "BRAÇADEIRA BAP 3",
    "CABO DE AÇO CORDOALHA 3/16 POL D",
    "ALÇA PREFORMADA PARA CORDOALHA 3/16 (4,8MM)",
    "PATCHCORD CAT6 AZUL 2,5M",
    "PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)",
    "MÓDULO SFP C+ PARA PLACA OLT LINE ANYPON ZTE",
    "SWITCH MPLS 24 PORTAS",
    "SFP GBIC ELÉTRICO",
    "FONTE RETIFICADORA 48VCC / 100A ~ 200A",
    "BATERIA DE LÍTIO 100A FB100B3 ZTE",
    "VALOR ESTIMADO COM MATERIAIS ELÉTRICOS, DISJUNTORES, QDC, CABOS, ILUMINAÇÃO, ETC,.",
    "PRESTAÇÃO DE SERVIÇO ELETRICISTA",
    "PRESTAÇÃO DE SERVIÇO INSTALAÇÃO AR CONDICIONADO",
    "CAMERA DE MONITORAMENTO IP INTELBRAS VIP 1220 B G3",
    "MÉDIA DE ALUGUEL MENSAL",
    "CABO ÓPTICO AS 80 S 144 FIBRAS NR KP",
    "Cabo AS 200 FO-06",
    "Cabo AS 200 FO-48",
    "Cabo AS 200 FO-72",
    "Cabo AS 200 FO-144",
];
MATERIALS_NOT_IN_SHEET.forEach(name => { delete MATERIAL_PRICES_BASE[name]; });
//Itens retirados que têm equivalente na planilha: kits e cálculos passam a usar o item da planilha
//Itens da planilha usados pelos kits (preço da planilha; atualizado pelo botão "Atualizar pela API")
Object.assign(MATERIAL_PRICES_BASE, {
    "Rack Indoor": { price: 499.69, unit: 'un', category: 'Data Center' },
    "BANDEJA DE VENTILAÇÃO DE TETO PARA RACK SERVIDOR IPMETAL 60X60CM 2 VENT. 600 MM BI-VOLT PT": { price: 141.83, unit: 'un', category: 'Data Center' },
    "CALHA DE TOMADA PARA RACK 19\" COM 12 TOMADAS - 10A ( 2T+P, CABO DE 2,5m COM BITOLA 2,5mm²)": { price: 85.6, unit: 'un', category: 'Data Center' },
    "CAIXA DE EMENDA ÓPTICA FIST GCO2 B 144 FUSÕES": { price: 209.72, unit: 'un', category: 'Fusão' },
    "KIT DERIVAÇÃO PARA CAIXA FIST 144FO CS2279-000 -GCO2-16": { price: 17.23, unit: 'un', category: 'Fusão' },
    "CHASSI OLT - NA 5516": { price: 16050, unit: 'un', category: 'Data Center' },
    "PLACA EC16B - FIBERHOME": { price: 13375, unit: 'un', category: 'Data Center' },
    "SWITCH HUAWEI 6720 48P": { price: 23005, unit: 'un', category: 'Data Center' },
    "FONTE 48VCC 30A - XPS": { price: 5155.26, unit: 'un', category: 'Data Center' },
    "BATERIAS ESTACIONÁRIAS - 12V/70AH UNIPOWER": { price: 875.54, unit: 'un', category: 'Data Center' },
});
const MATERIAL_SUBSTITUTES = {
    "RAQUETE PARA CEO": "RESERVA OPTILOOP (RAQUETE)",
    "SUPORTE PRESBOW (REX)": "SUPORTE REX ARMAÇÃO SECUNDÁRIA 1X1 PRESBOW 4,8 MM",
    "ISOLADOR ROLDANA": "ISOLADOR ROLDANA 72X72 PORCELANA",
    "BRAÇADEIRA BAP 3": "ABRAÇADEIRA BAP 3",
    "CABO DE AÇO CORDOALHA 3/16 POL D": "CABO DE AÇO CORDOALHA 3/16 POL",
    "ALÇA PREFORMADA PARA CORDOALHA 3/16 (4,8MM)": "ALÇA PREFORMADA PARA CORDOALHA 3/16 POL",
    "CABO ÓPTICO AS 80 S 144 FIBRAS NR KP": "CFOA SM AS 80 S 144 FIBRAS NR KP",
    "PATCHCORD CAT6 AZUL 2,5M": "PATCHCORD MAXITELECOM CAT6 1,5m",
    "ADAPTADOR SC/APC SEM ABAS (PASSANTE)": "ADAPTADOR SC/APC COM ABAS (PASSANTE)",
    "Splitter 1/2 APC": "SPLITTER FUSÃO 1/2",
    "Splitter 1/2 UPC": "SPLITTER FUSÃO 1/2",
    "Splitter 1/4 APC": "SPLITTER FUSÃO 1/4",
    "Splitter 1/4 UPC": "SPLITTER FUSÃO 1/4",
    "Splitter 1/16": "SPLITTER CONECTORIZADO 1/16 SC/APC",
    "KIT DERIVAÇÃO POR CABO": "KIT DERIVAÇÃO PARA CAIXA DE EMENDA ÓPTICA",
    "CAIXA DE EMENDA OPTICA FIBRACEM 216F JUMBO SVM COM REENTRADA DIAMETRO 13 A 18MM": "CAIXA DE EMENDA ÓPTICA FIST GCO2 B 144 FUSÕES",
    "KIT DE DERIVAÇÃO SVM PARA CEO 144F GROMMET (2 ENTRADAS 7 A 13MM)": "KIT DERIVAÇÃO PARA CAIXA FIST 144FO CS2279-000 -GCO2-16",
    "CHASSI OLT C650 ZTE": "CHASSI OLT - NA 5516",
    "PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)": "PLACA EC16B - FIBERHOME",
    "SWITCH MPLS 24 PORTAS": "SWITCH HUAWEI 6720 48P",
    "FONTE RETIFICADORA 48VCC / 100A ~ 200A": "FONTE 48VCC 30A - XPS",
    "BATERIA DE LÍTIO 100A FB100B3 ZTE": "BATERIAS ESTACIONÁRIAS - 12V/70AH UNIPOWER",
    "RACK INDOOR IPMETAL 44U 800X1000MM / PRETO / PORTA DIANTEIRA PERFURADO E TRASEIRA BI-PARTIDA PERFURADO / CALHA LATERAL": "Rack Indoor",
    "BANDEJA DE VENTILAÇÃO DE TETO PARA RACK IPMETAL 44U 1000MM": "BANDEJA DE VENTILAÇÃO DE TETO PARA RACK SERVIDOR IPMETAL 60X60CM 2 VENT. 600 MM BI-VOLT PT",
    "RÉGUA DE TOMADA 2P+T 10A, CABO DE 2,5M COM BITOLA 1,5MM² / SEM FUSÍVEL E DISJUNTOR": "CALHA DE TOMADA PARA RACK 19\" COM 12 TOMADAS - 10A ( 2T+P, CABO DE 2,5m COM BITOLA 2,5mm²)",
    "XFP 850NM 10G 0,3KM MULTIMODO DUPLEX": "SFP (MULTIMODO, 10G, DUPLEX)",
};
Object.assign(MATERIAL_RENAMES, MATERIAL_SUBSTITUTES);
//Itens retirados sem equivalente na planilha: saem dos kits e da lista de materiais
//(os tipos de cabo sem preço continuam, porque são a metragem dos cabos desenhados)
const MATERIALS_DROPPED_SET = new Set(MATERIALS_NOT_IN_SHEET
    .filter(name => !(name in MATERIAL_SUBSTITUTES) && !/^Cabo AS /.test(name))
    .map(name => String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()));

function isDroppedMaterial(name) {
    return MATERIALS_DROPPED_SET.has(String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim());
}

//Componentes de kit com os nomes da planilha, sem os itens retirados
function normalizeKitComponents(components) {
    const merged = [];
    (components || []).forEach(c => {
        const name = resolveMaterialName(String(c.name || '').trim());
        if (!name || isDroppedMaterial(name)) return;
        const existing = merged.find(m => m.name === name);
        if (existing) existing.quantity += Number(c.quantity) || 1;
        else merged.push({ name, quantity: Number(c.quantity) || 1 });
    });
    return merged;
}
const MATERIALS_NOT_IN_SHEET_SET = new Set(MATERIALS_NOT_IN_SHEET.map(name => String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()));
Object.keys(MATERIAL_RENAMES).forEach(oldName => {
    if (!(oldName in MATERIAL_PRICES_BASE)) return;
    const newName = MATERIAL_RENAMES[oldName];
    if (!(newName in MATERIAL_PRICES_BASE)) MATERIAL_PRICES_BASE[newName] = MATERIAL_PRICES_BASE[oldName];
    delete MATERIAL_PRICES_BASE[oldName];
});
const materialPriceKey = (key) => (typeof key === 'string' ? resolveMaterialName(key) : key);
const MATERIAL_PRICES = new Proxy(MATERIAL_PRICES_BASE, {
    get: (target, key) => target[materialPriceKey(key)],
    set: (target, key, value) => { target[materialPriceKey(key)] = value; return true; },
    has: (target, key) => materialPriceKey(key) in target,
    deleteProperty: (target, key) => delete target[materialPriceKey(key)],
});

/* =====================================================================
   CADASTRO DE MATERIAIS E KITS
   - Catálogo editável pela interface (nome, categoria, unidade, preço
     unitário e fornecedor) com kits (conjuntos de materiais).
   - Salvo por empresa no Supabase (tabela company_settings) e semeado a
     partir do MATERIAL_PRICES. Só o administrador pode alterar.
   ===================================================================== */
//Chaves antigas: o catálogo ficava só no navegador. Usadas uma vez para
//levar os preços existentes para a empresa (ver loadCompanySettings).
const LEGACY_CATALOG_STORAGE_KEY = 'routeMapMaterialCatalog_v1';
const LEGACY_LANCAMENTO_STORAGE_KEY = 'routeMapLancamentoConfig_v1';

//Estado em memória do catálogo
let materialCatalog = { materials: [], kits: [] };

const DEFAULT_LANCAMENTO_CONFIG = {
    poleSpan: 35,        //Distância padrão entre postes (m)
    plaquetaPerPole: 1,  //Plaquetas por poste
    bapPerPole: 1,       //Abraçadeiras BAP por poste
    supaPerPole: 2,      //Suportes de ancoragem (SUPAS) por poste
    alcaPerSupa: 1,      //Alças preformadas por SUPA
    dropSlack: 15        //Metros somados a cada drop de cliente (subida, reserva e acomodação)
};

const DEFAULT_LABOR_CONFIG = {
    hourlyRate: 40,      //Custo por técnico/hora (R$)
    hoursPerDay: 8,
    cablePerDay: 2000,   //Metros de cabo lançados por dia
    ctoPerDay: 10,
    ceoPerDay: 1
};

//Configuração do lançamento (vão entre postes e ferragens por poste)
let lancamentoConfig = { ...DEFAULT_LANCAMENTO_CONFIG };
//Custo e produtividade da mão de obra regional
let laborConfig = { ...DEFAULT_LABOR_CONFIG };

function normalizeLancamentoConfig(stored) {
    const src = stored || {};
    const n = (value, fallback) => (value != null && Number.isFinite(Number(value)) ? Number(value) : fallback);
    return {
        poleSpan: Number(src.poleSpan) > 0 ? Number(src.poleSpan) : DEFAULT_LANCAMENTO_CONFIG.poleSpan,
        plaquetaPerPole: n(src.plaquetaPerPole, DEFAULT_LANCAMENTO_CONFIG.plaquetaPerPole),
        bapPerPole: n(src.bapPerPole, DEFAULT_LANCAMENTO_CONFIG.bapPerPole),
        supaPerPole: n(src.supaPerPole, DEFAULT_LANCAMENTO_CONFIG.supaPerPole),
        alcaPerSupa: n(src.alcaPerSupa, DEFAULT_LANCAMENTO_CONFIG.alcaPerSupa),
        dropSlack: n(src.dropSlack, DEFAULT_LANCAMENTO_CONFIG.dropSlack)
    };
}

function normalizeLaborConfig(stored) {
    const src = stored || {};
    const positive = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
    return {
        hourlyRate: Number(src.hourlyRate) >= 0 && src.hourlyRate != null ? Number(src.hourlyRate) : DEFAULT_LABOR_CONFIG.hourlyRate,
        hoursPerDay: positive(src.hoursPerDay, DEFAULT_LABOR_CONFIG.hoursPerDay),
        cablePerDay: positive(src.cablePerDay, DEFAULT_LABOR_CONFIG.cablePerDay),
        ctoPerDay: positive(src.ctoPerDay, DEFAULT_LABOR_CONFIG.ctoPerDay),
        ceoPerDay: positive(src.ceoPerDay, DEFAULT_LABOR_CONFIG.ceoPerDay)
    };
}

//Dias estimados de obra a partir dos quantitativos do projeto
function estimateLaborDays(quantities) {
    return Math.ceil(
        (quantities.cableLength / laborConfig.cablePerDay)
        + (quantities.ctoCount / laborConfig.ctoPerDay)
        + (quantities.ceoCount / laborConfig.ceoPerDay)
    );
}

function readLegacyLocalSetting(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

//Grava campos em company_settings (somente administrador)
let companySettingsSaveChain = Promise.resolve();
function saveCompanySettings(patch) {
    if (!AppSession.isAdmin) return Promise.resolve(false);
    companySettingsSaveChain = companySettingsSaveChain.then(async () => {
        const { error } = await supabaseClient
            .from('company_settings')
            .upsert({ company_id: AppSession.company.id, ...patch }, { onConflict: 'company_id' });
        if (error) {
            console.error('Erro ao salvar configurações da empresa:', error);
            showAlert('Erro', 'Não foi possível salvar as alterações da empresa no banco de dados.');
            return false;
        }
        return true;
    });
    return companySettingsSaveChain;
}

function persistLancamentoConfig() {
    return saveCompanySettings({ lancamento_config: lancamentoConfig, labor_config: laborConfig });
}

//Carrega catálogo e configurações da empresa após o login
async function loadCompanySettings() {
    const { data, error } = await supabaseClient
        .from('company_settings')
        .select('material_catalog, lancamento_config, labor_config')
        .eq('company_id', AppSession.company.id)
        .maybeSingle();
    if (error) {
        console.error('Erro ao carregar configurações da empresa:', error);
        showAlert('Aviso', 'Não foi possível carregar os preços da empresa. Os valores padrão estão sendo usados.');
        return;
    }
    let storedCatalog = data?.material_catalog || null;
    let storedLancamento = data?.lancamento_config || null;
    const storedLabor = data?.labor_config || null;
    //Primeiro acesso do admin: aproveita o catálogo que estava salvo neste navegador
    let importedLegacy = false;
    if (!storedCatalog && AppSession.isAdmin) {
        const legacyCatalog = readLegacyLocalSetting(LEGACY_CATALOG_STORAGE_KEY);
        if (legacyCatalog && Array.isArray(legacyCatalog.materials)) {
            storedCatalog = legacyCatalog;
            storedLancamento = storedLancamento || readLegacyLocalSetting(LEGACY_LANCAMENTO_STORAGE_KEY);
            importedLegacy = true;
        }
    }
    loadMaterialCatalog(storedCatalog);
    lancamentoConfig = normalizeLancamentoConfig(storedLancamento);
    laborConfig = normalizeLaborConfig(storedLabor);
    applyCatalogToMaterialPrices();
    if (AppSession.isAdmin && (!data?.material_catalog || importedLegacy)) {
        await saveCompanySettings({
            material_catalog: materialCatalog,
            lancamento_config: lancamentoConfig,
            labor_config: laborConfig
        });
    }
    applyCatalogPermissions();
    try { syncCatalogPricesIntoBoms(); } catch (e) { /* sem listas calculadas ainda */ }
    await addMissingSheetMaterials();
    await loadSheetKits();
}

//Kits POP, OLT e placa vindos da planilha de kits (kits.json, gerado no deploy).
//Os itens e valores do kit são os da planilha; materiais que não existem no catálogo são adicionados.
const SHEET_KIT_SOURCE = 'planilha-kits';

async function loadSheetKits() {
    let data;
    try {
        const response = await fetch(`kits.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        data = await response.json();
    } catch (e) {
        return;
    }
    const sheetKits = data?.kits || {};
    if (!Object.keys(sheetKits).length) return;
    const known = new Set(materialCatalog.materials.map(m => normalizeMaterialName(m.name)));
    const knownCodes = new Set(materialCatalog.materials.map(m => String(m.code || '').trim()).filter(Boolean));
    //Nomes antigos do sistema (em qualquer grafia) que já viraram um material da planilha de preços
    //(as trocas por aproximação não contam: a planilha de kits usa o item original)
    const renamedNorms = new Set(Object.keys(MATERIAL_RENAMES).filter(k => !(k in MATERIAL_SUBSTITUTES)).map(normalizeMaterialName));
    let changed = false;
    Object.entries(sheetKits).forEach(([kitName, items]) => {
        const components = (items || [])
            .filter(i => i.descricao && Number(i.quantidade) > 0)
            .map(i => ({
                name: String(i.descricao).trim(),
                quantity: Number(i.quantidade),
                unit: normalizeImportUnit(i.unidade),
                price: Number(i.valor_unitario) || 0,
                code: String(i.codigo || '').trim(),
            }));
        if (!components.length) return;
        components.forEach(c => {
            const norm = normalizeMaterialName(c.name);
            if (known.has(norm) || renamedNorms.has(norm) || (c.code && knownCodes.has(c.code))) return;
            materialCatalog.materials.push({
                id: generateCatalogId('mat'),
                name: c.name,
                category: 'Data Center',
                unit: c.unit,
                price: c.price,
                supplier: '',
                code: c.code,
                notes: 'Da planilha de kits',
            });
            known.add(norm);
            changed = true;
        });
        const existing = materialCatalog.kits.find(k => k.name.toUpperCase() === kitName.toUpperCase());
        const signature = JSON.stringify(components);
        if (existing && JSON.stringify(existing.components) === signature && existing.source === SHEET_KIT_SOURCE) return;
        if (existing) {
            existing.components = components;
            existing.source = SHEET_KIT_SOURCE;
            existing.category = 'Data Center';
        } else {
            materialCatalog.kits.push({ id: generateCatalogId('kit'), name: kitName, category: 'Data Center', components, source: SHEET_KIT_SOURCE });
        }
        changed = true;
    });
    if (!changed) return;
    applyCatalogToMaterialPrices();
    if (document.getElementById('materialCatalogModal')?.style.display === 'flex') renderCatalog();
    if (AppSession.isAdmin) persistMaterialCatalog();
}

//Adiciona um kit à lista de materiais com os valores do próprio kit (planilha de kits)
function addKitToBom(kitName, multiplier = 1) {
    getKitComponents(kitName).forEach(item => {
        const qty = (Number(item.quantity) || 0) * multiplier;
        if (qty > 0) addMaterialToBom(item.name, qty, Number.isFinite(item.price) ? item.price : undefined);
    });
}

function hasSheetKit(kitName) {
    return materialCatalog.kits.some(k => k.name.toUpperCase() === kitName.toUpperCase() && k.source === SHEET_KIT_SOURCE && k.components.length);
}

//Completa o catálogo com os itens da planilha de preços que ainda não existem no sistema
//(código, unidade e valor da planilha; o que já existe não é alterado)
async function addMissingSheetMaterials() {
    let data;
    try {
        const response = await fetch(`materiais.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        data = await response.json();
    } catch (e) {
        return; //Sem o arquivo (ex.: rodando localmente): fica como está
    }
    const known = new Set(materialCatalog.materials.map(m => normalizeMaterialName(m.name)));
    const knownCodes = new Set(materialCatalog.materials.map(m => String(m.code || '').trim()).filter(c => c && c !== '?'));
    let added = 0;
    let sectionsChanged = false;
    (data?.itens || []).forEach(item => {
        const name = String(item.descricao || '').trim();
        const price = Number(item.valor_unitario);
        const code = String(item.codigo || '').trim();
        if (!name || !Number.isFinite(price)) return;
        const norm = normalizeMaterialName(name);
        const aliasTarget = SHEET_MATERIAL_ALIASES[norm];
        const section = String(item.secao || '').trim();
        //Material que já existe: guarda a seção da planilha (define a categoria)
        const targetNorm = aliasTarget ? normalizeMaterialName(resolveMaterialName(aliasTarget)) : norm;
        const existing = materialCatalog.materials.find(m => normalizeMaterialName(m.name) === targetNorm || normalizeMaterialName(m.name) === norm);
        if (existing) {
            if (section && existing.section !== section) { existing.section = section; sectionsChanged = true; }
            return;
        }
        if (known.has(norm)) return;
        if (code && code !== '?' && knownCodes.has(code) && materialCatalog.materials.some(m => m.code === code && normalizeMaterialName(m.name) === norm)) return;
        materialCatalog.materials.push({
            id: generateCatalogId('mat'),
            name,
            category: classifyPriceSheetCategory(name),
            unit: normalizeImportUnit(item.unidade),
            price,
            supplier: '',
            code: code === '?' ? '' : code,
            notes: 'Da planilha de preços',
            section,
        });
        known.add(norm);
        added++;
    });
    if (!added && !sectionsChanged) return;
    applyCatalogToMaterialPrices();
    populateCatalogCategoryFilters?.();
    if (document.getElementById('materialCatalogModal')?.style.display === 'flex') renderCatalog();
    if (AppSession.isAdmin) persistMaterialCatalog();
}

//Esconde as ações de edição do catálogo para quem não é admin
function applyCatalogPermissions() {
    const readOnly = !AppSession.isAdmin;
    document.body.classList.toggle('catalog-readonly', readOnly);
    const note = document.getElementById('catalogReadonlyNote');
    if (note) note.hidden = !readOnly;
    document.querySelectorAll('#catalogConfigView input').forEach(input => { input.disabled = readOnly; });
}

function getPoleSpanDistance() {
    return Number(lancamentoConfig.poleSpan) > 0 ? Number(lancamentoConfig.poleSpan) : 35;
}

//Definições padrão dos kits automáticos (CEO, Cordoalha, POP, OLT).
//Calculado em runtime porque depende de POP_KIT_CONFIG (definido mais abaixo).
function getDefaultKitDefinitions() {
    return {
        "KIT CEO RAQUETE": { category: 'Fusão', components: [
            { name: "PRENSA DE ESPINAR", quantity: 2 },
            { name: "RAQUETE PARA CEO", quantity: 2 },
            { name: "TAP BRACKET", quantity: 4 },
            { name: "CABO DE AÇO CORDOALHA 3/16 POL", quantity: 50 },
            { name: "ALÇA PREFORMADA PARA CORDOALHA 3/16 POL", quantity: 2 },
            { name: "FITA DE AMARRAÇÃO INOX 16 POL", quantity: 10 },
            { name: "SUPORTE PRESBOW (REX)", quantity: 2 },
            { name: "ISOLADOR ROLDANA", quantity: 2 }
        ]},
        "KIT CEO SUPORTE": { category: 'Fusão', components: [
            { name: "SUPORTE PARA CEO", quantity: 1 },
            { name: "ABRAÇADEIRA DE NYLON", quantity: 4 },
            { name: "ABRAÇADEIRA BAP 3", quantity: 2 }
        ]},
        "KIT ATENDIMENTO CLIENTE": { category: 'Fusão', components: [
            { name: "CONECTOR DE CAMPO SC/APC", quantity: 2 },
            { name: "ESTICADOR PARA CABO DROP", quantity: 2 },
            { name: "PTO - PONTO DE TERMINAÇÃO ÓPTICA", quantity: 1 }
        ]},
        "KIT CORDOALHA": { category: 'Ferragem', components: [
            { name: "SUPORTE PRESBOW (REX)", quantity: 4 },
            { name: "ISOLADOR ROLDANA", quantity: 4 },
            { name: "ALÇA PREFORMADA PARA CORDOALHA 3/16 POL", quantity: 4 },
            { name: "CABO DE AÇO CORDOALHA 3/16 POL", quantity: 50 }
        ]},
        "KIT POP": { category: 'Data Center', components: (typeof POP_KIT_CONFIG !== 'undefined' ? POP_KIT_CONFIG.fixed : []).map(i => ({ name: i.name, quantity: i.quantity })) },
        "KIT OLT": { category: 'Data Center', components: [
            { name: 'CHASSI OLT C650 ZTE', quantity: 1 },
            { name: 'LICENÇA OLT', quantity: 1 },
            { name: 'MÓDULO DE ENERGIA DC C650-C600 PARA OLT ZTE', quantity: 2 },
            { name: 'PLACA CONTROLADORA E SWITCHING C600/C650', quantity: 1 },
            { name: 'SWITCH MPLS 24 PORTAS', quantity: 1 },
            { name: 'SFP 850NM 10G 0,3KM MULTIMODO DUPLEX', quantity: 2 },
            { name: 'SFP GBIC ELÉTRICO', quantity: 1 }
        ]}
    };
}

//Kit "Cabos e alças": qual alça preformada cada tipo de cabo usa (editável no catálogo, aba Kits)
const CABLE_ALCA_KIT_NAME = 'KIT CABOS E ALÇAS';
const CABLE_ALCA_VERSION = 2; //Tabela oficial da empresa (troca de versão descarta escolhas antigas)
//Cabos usados pela empresa, na ordem exibida no kit (alça padrão em CABLE_HARDWARE_MAP)
const CABLE_ALCA_KIT_TYPES = [
    'Cabo AS 80 FO-06', 'Cabo AS 80 FO-12',
    'Cabo AS 200 FO-12', 'Cabo AS 80 FO-24', 'Cabo AS 80 FO-36', 'Cabo AS 80 FO-48',
    'Cabo AS 200 FO-36', 'Cabo AS 80 FO-72', 'Cabo AS 200 FO-24',
    'Cabo AS 80 FO-144',
];

function getCableAlca(cableType) {
    const custom = materialCatalog.cableAlcas?.[cableType];
    return resolveMaterialName(custom || CABLE_HARDWARE_MAP[cableType] || '') || null;
}

//Retorna os componentes de um kit, priorizando o que está no catálogo (editável)
function getKitComponents(kitName) {
    const kit = materialCatalog.kits.find(k => k.name.toUpperCase() === String(kitName).toUpperCase());
    if (kit && kit.components.length) return kit.components;
    const defaults = getDefaultKitDefinitions()[kitName];
    return defaults ? normalizeKitComponents(defaults.components) : [];
}

//Gera um id simples e único para itens do catálogo
function generateCatalogId(prefix = 'mat') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

//Constrói o catálogo inicial a partir do MATERIAL_PRICES fixo
function buildSeedCatalog() {
    const materials = [];
    const kits = [];
    Object.keys(MATERIAL_PRICES).forEach(name => {
        const info = MATERIAL_PRICES[name] || {};
        if (Array.isArray(info.components) && info.components.length > 0) {
            kits.push({
                id: generateCatalogId('kit'),
                name,
                category: info.category || 'Outros',
                components: normalizeKitComponents(info.components)
            });
        } else {
            materials.push({
                id: generateCatalogId('mat'),
                name,
                category: info.category || 'Outros',
                unit: info.unit || 'un',
                price: Number(info.price) || 0,
                supplier: '',
                code: '',
                notes: ''
            });
        }
    });
    //Inclui os kits automáticos (CEO, Cordoalha, POP, OLT) para edição na aba Kits
    const defaults = getDefaultKitDefinitions();
    const existingKitNames = new Set(kits.map(k => k.name.toUpperCase()));
    Object.keys(defaults).forEach(kitName => {
        if (existingKitNames.has(kitName.toUpperCase())) return;
        kits.push({
            id: generateCatalogId('kit'),
            name: kitName,
            category: defaults[kitName].category || 'Outros',
            components: normalizeKitComponents(defaults[kitName].components)
        });
    });
    return { materials, kits };
}

//Carrega o catálogo salvo da empresa, mesclando novos itens do seed
function loadMaterialCatalog(stored) {
    const seed = buildSeedCatalog();
    if (!stored || !Array.isArray(stored.materials)) {
        materialCatalog = { ...seed, cableAlcas: {}, cableAlcasVersion: CABLE_ALCA_VERSION };
        return;
    }
    //Normaliza itens salvos
    const materials = stored.materials.map(m => ({
        id: m.id || generateCatalogId('mat'),
        name: resolveMaterialName(String(m.name || '').trim()),
        category: m.category || 'Outros',
        unit: m.unit || 'un',
        price: Number(m.price) || 0,
        supplier: m.supplier || '',
        code: m.code || '',
        notes: m.notes || '',
        section: m.section || ''
    })).filter((m, i, all) => m.name && all.findIndex(o => o.name === m.name) === i) //Nome antigo e novo viram um só
        .filter(m => m.notes === 'Da planilha de kits' || !MATERIALS_NOT_IN_SHEET_SET.has(normalizeMaterialName(m.name))); //Fora da planilha da empresa
    const kits = Array.isArray(stored.kits) ? stored.kits.map(k => ({
        id: k.id || generateCatalogId('kit'),
        name: String(k.name || '').trim(),
        category: k.category || 'Outros',
        source: k.source || undefined,
        components: !Array.isArray(k.components) ? []
            : k.source === SHEET_KIT_SOURCE ? k.components.map(c => ({ ...c, quantity: Number(c.quantity) || 1 }))
            : normalizeKitComponents(k.components)
    })).filter(k => k.name) : [];
    //Mescla itens do seed que ainda não existem (atualizações do código)
    const existingNames = new Set([...materials, ...kits].map(i => i.name.toUpperCase()));
    seed.materials.forEach(sm => {
        if (!existingNames.has(sm.name.toUpperCase())) materials.push(sm);
    });
    seed.kits.forEach(sk => {
        if (!existingNames.has(sk.name.toUpperCase())) kits.push(sk);
    });
    //Kits de lançamento por cabo (versão anterior) viraram o kit único "Cabos e alças"
    materialCatalog = {
        materials,
        kits: kits.filter(k => !k.name.toUpperCase().startsWith('KIT LANÇAMENTO ')),
        cableAlcas: stored.cableAlcasVersion === CABLE_ALCA_VERSION && stored.cableAlcas && typeof stored.cableAlcas === 'object' ? { ...stored.cableAlcas } : {},
        cableAlcasVersion: CABLE_ALCA_VERSION,
    };
}

//Salva o catálogo da empresa no banco
function persistMaterialCatalog() {
    return saveCompanySettings({ material_catalog: materialCatalog });
}

//Aplica os preços/itens do catálogo ao MATERIAL_PRICES (reflete na BOM)
function applyCatalogToMaterialPrices() {
    applyMaterialCategoryRules(materialCatalog.materials);
    materialCatalog.materials.forEach(m => {
        const existing = MATERIAL_PRICES[m.name] || {};
        MATERIAL_PRICES[m.name] = {
            ...existing,
            price: Number(m.price) || 0,
            unit: m.unit || 'un',
            category: m.category || existing.category || 'Outros',
            supplier: m.supplier || ''
        };
    });
    materialCatalog.kits.forEach(k => {
        const existing = MATERIAL_PRICES[k.name] || {};
        MATERIAL_PRICES[k.name] = {
            ...existing,
            price: Number(existing.price) || 0,
            unit: existing.unit || 'un',
            category: k.category || existing.category || 'Outros',
            components: k.components.map(c => ({ name: c.name, quantity: Number(c.quantity) || 1 }))
        };
    });
}

//Inicializa o catálogo com os valores padrão; os da empresa chegam após o login
function initMaterialCatalog() {
    loadMaterialCatalog(null);
    applyCatalogToMaterialPrices();
    whenAppReady(loadCompanySettings);
}

//Sincroniza os preços do catálogo em TODAS as listas de materiais já calculadas
//(preserva quantidades e edições manuais; só atualiza o preço unitário)
function syncCatalogPricesIntoBoms() {
    const applyToBom = (bom) => {
        if (!bom || typeof bom !== 'object') return;
        Object.keys(bom).forEach(key => {
            const item = bom[key];
            if (!item || !item.materialName) return;
            const info = MATERIAL_PRICES[item.materialName];
            if (info && typeof info.price === 'number') {
                item.unitPrice = info.price;
            }
        });
    };
    if (typeof projectBoms === 'object' && projectBoms) {
        Object.keys(projectBoms).forEach(pid => applyToBom(projectBoms[pid]));
    }
    if (typeof bomState === 'object' && bomState) {
        applyToBom(bomState);
    }
    //Atualiza a tela da Lista de Materiais se estiver aberta
    const materialModal = document.getElementById('materialModal');
    if (materialModal && materialModal.style.display === 'flex' && typeof renderBomTable === 'function') {
        try { renderBomTable(); } catch (e) { /* ignora */ }
    }
}

/* ------------------ Interface do cadastro de materiais ------------------ */
let catalogActiveTab = 'materials';

function formatCatalogPrice(value) {
    return (Number(value) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

//Categorias únicas do catálogo (materiais + kits)
function getCatalogCategories() {
    const set = new Set();
    materialCatalog.materials.forEach(m => { if (m.category) set.add(m.category); });
    materialCatalog.kits.forEach(k => { if (k.category) set.add(k.category); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

//Preenche o filtro de categorias (chips), os datalists e o seletor oculto
function populateCatalogCategoryFilters() {
    const categories = getCatalogCategories();
    const filter = document.getElementById('catalogCategoryFilter');
    if (filter) {
        const current = filter.value;
        filter.innerHTML = '<option value="">Todas as categorias</option>' +
            categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        filter.value = categories.includes(current) ? current : '';
    }
    renderCatalogCategoryChips();
    const datalist = document.getElementById('catalogCategoryOptions');
    if (datalist) {
        datalist.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
    }
    const matOptions = document.getElementById('kitMaterialOptions');
    if (matOptions) {
        matOptions.innerHTML = materialCatalog.materials
            .map(m => `<option value="${escapeHtml(m.name)}"></option>`).join('');
    }
}

//Cor fixa por categoria (mesma cor nos chips e nos grupos da tabela)
function getCatalogCategoryColor(category) {
    const palette = ['#0f766e', '#2563eb', '#b45309', '#7c3aed', '#be185d', '#15803d', '#0369a1', '#a16207'];
    const fixed = { 'Ferragem': '#b45309', 'Lançamento': '#2563eb', 'Fusão': '#7c3aed', 'Data Center': '#0f766e', 'Clientes': '#15803d' };
    if (fixed[category]) return fixed[category];
    let hash = 0;
    String(category || '').split('').forEach(ch => { hash = (hash * 31 + ch.charCodeAt(0)) >>> 0; });
    return palette[hash % palette.length];
}

function renderCatalogCategoryChips() {
    const wrap = document.getElementById('catalogCategoryChips');
    const filter = document.getElementById('catalogCategoryFilter');
    if (!wrap || !filter) return;
    const source = catalogActiveTab === 'kits' ? materialCatalog.kits : materialCatalog.materials;
    const counts = {};
    source.forEach(item => { const c = item.category || 'Outros'; counts[c] = (counts[c] || 0) + 1; });
    const categories = Object.keys(counts).sort((a, b) => getCatalogCategoryRank(a) - getCatalogCategoryRank(b) || a.localeCompare(b, 'pt-BR'));
    const current = filter.value;
    const chip = (value, label, count, color) => `<button type="button" class="cat3-chip${value === current ? ' is-active' : ''}" data-category="${escapeHtml(value)}" role="tab" style="--chip:${color}"><span class="cat3-chip__dot"></span>${escapeHtml(label)}<small>${count}</small></button>`;
    wrap.innerHTML = chip('', 'Todas', source.length, '#64748b') + categories.map(c => chip(c, c, counts[c], getCatalogCategoryColor(c))).join('');
}

//Escapa texto para uso seguro em HTML
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function openMaterialCatalogModal() {
    const modal = document.getElementById('materialCatalogModal');
    if (!modal) return;
    populateCatalogCategoryFilters();
    updateCatalogStats();
    setCatalogTab(catalogActiveTab);
    modal.style.display = 'flex';
}

function setCatalogTab(tab) {
    catalogActiveTab = ['kits', 'config'].includes(tab) ? tab : 'materials';
    document.querySelectorAll('.catalog-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.catalogTab === catalogActiveTab);
    });
    const views = { materials: 'catalogMaterialsView', kits: 'catalogKitsView', config: 'catalogConfigView' };
    Object.entries(views).forEach(([key, id]) => {
        const view = document.getElementById(id);
        if (view) view.style.display = catalogActiveTab === key ? '' : 'none';
    });
    const isConfig = catalogActiveTab === 'config';
    document.getElementById('catalogToolbar').style.display = isConfig ? 'none' : '';
    document.getElementById('catalogCategoryChips').style.display = isConfig ? 'none' : '';
    const addBtn = document.getElementById('catalogAddButton');
    if (addBtn) addBtn.textContent = catalogActiveTab === 'kits' ? '+ Novo kit' : '+ Novo material';
    const importBtn = document.getElementById('catalogImportButton');
    if (importBtn) importBtn.hidden = catalogActiveTab === 'kits';
    const apiBtn = document.getElementById('catalogApiSyncButton');
    if (apiBtn) apiBtn.hidden = catalogActiveTab === 'kits';
    const filter = document.getElementById('catalogCategoryFilter');
    if (filter) filter.value = '';
    if (isConfig) renderLancamentoConfigForm();
    else {
        renderCatalogCategoryChips();
        renderCatalog();
    }
}

function renderLancamentoConfigForm() {
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
    set('configPoleSpan', lancamentoConfig.poleSpan);
    set('configPlaquetaPerPole', lancamentoConfig.plaquetaPerPole);
    set('configBapPerPole', lancamentoConfig.bapPerPole);
    set('configSupaPerPole', lancamentoConfig.supaPerPole);
    set('configAlcaPerSupa', lancamentoConfig.alcaPerSupa);
    set('configDropSlack', lancamentoConfig.dropSlack);
    set('configLaborHourlyRate', laborConfig.hourlyRate);
    set('configLaborHoursPerDay', laborConfig.hoursPerDay);
    set('configCablePerDay', laborConfig.cablePerDay);
    set('configCtoPerDay', laborConfig.ctoPerDay);
    set('configCeoPerDay', laborConfig.ceoPerDay);
    updateLancamentoPreview();
    updateLaborPreview();
    applyCatalogPermissions();
}

function readLaborConfigForm() {
    const num = (id) => parseFloat(document.getElementById(id)?.value);
    return normalizeLaborConfig({
        hourlyRate: num('configLaborHourlyRate'),
        hoursPerDay: num('configLaborHoursPerDay'),
        cablePerDay: num('configCablePerDay'),
        ctoPerDay: num('configCtoPerDay'),
        ceoPerDay: num('configCeoPerDay')
    });
}

function updateLaborPreview() {
    const preview = document.getElementById('configLaborPreview');
    if (!preview) return;
    const cfg = readLaborConfigForm();
    const dayCost = cfg.hourlyRate * cfg.hoursPerDay;
    const money = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const days = Math.ceil(5000 / cfg.cablePerDay + 20 / cfg.ctoPerDay + 2 / cfg.ceoPerDay);
    preview.innerHTML = `<span class="cat3-example__label">Exemplo</span>
        <span class="cat3-example__flow">
            <span class="cat3-token">5.000 m de cabo</span><span class="cat3-token">20 CTOs</span><span class="cat3-token">2 CEOs</span>
            <span class="cat3-arrow">→</span>
            <span class="cat3-token cat3-token--strong">${days} dias</span>
            <span class="cat3-token cat3-token--strong">${money(dayCost)} / dia por técnico</span>
            <span class="cat3-token cat3-token--strong">${money(days * dayCost)} por técnico</span>
        </span>`;
}

//Mostra um exemplo de cálculo com os valores atuais do formulário
function updateLancamentoPreview() {
    const preview = document.getElementById('configLancamentoPreview');
    if (!preview) return;
    const num = (id, fb) => {
        const v = parseFloat(document.getElementById(id)?.value);
        return Number.isFinite(v) && v >= 0 ? v : fb;
    };
    const span = num('configPoleSpan', 35) > 0 ? num('configPoleSpan', 35) : 35;
    const plaq = num('configPlaquetaPerPole', 1);
    const bap = num('configBapPerPole', 1);
    const supa = num('configSupaPerPole', 2);
    const alca = num('configAlcaPerSupa', 1);
    const exemplo = 1000;
    const postes = Math.ceil(exemplo / span);
    const poles = Array.from({ length: 7 }, () => '<i class="cat3-pole"></i>').join('<i class="cat3-span"></i>');
    preview.innerHTML = `<span class="cat3-example__label">Exemplo</span>
        <div class="cat3-poles" aria-hidden="true">${poles}<em>${span} m</em></div>
        <span class="cat3-example__flow">
            <span class="cat3-token">Cabo de ${exemplo} m</span>
            <span class="cat3-arrow">→</span>
            <span class="cat3-token cat3-token--strong">${postes} postes</span>
            <span class="cat3-token">${postes * plaq} plaquetas</span>
            <span class="cat3-token">${postes * bap} BAP</span>
            <span class="cat3-token">${postes * supa} SUPAS</span>
            <span class="cat3-token">${postes * supa * alca} alças</span>
        </span>`;
}

async function saveLancamentoConfigHandler() {
    if (!AppSession.isAdmin) {
        showAlert('Sem permissão', 'Somente o administrador da empresa pode alterar as configurações.');
        return;
    }
    laborConfig = readLaborConfigForm();
    const num = (id, fallback) => {
        const v = parseFloat(document.getElementById(id)?.value);
        return Number.isFinite(v) && v >= 0 ? v : fallback;
    };
    const poleSpan = num('configPoleSpan', 35);
    lancamentoConfig = {
        poleSpan: poleSpan > 0 ? poleSpan : 35,
        plaquetaPerPole: num('configPlaquetaPerPole', 1),
        bapPerPole: num('configBapPerPole', 1),
        supaPerPole: num('configSupaPerPole', 2),
        alcaPerSupa: num('configAlcaPerSupa', 1),
        dropSlack: num('configDropSlack', DEFAULT_LANCAMENTO_CONFIG.dropSlack)
    };
    const saved = await persistLancamentoConfig();
    if (typeof refreshClientDrops === 'function') refreshClientDrops();
    renderLancamentoConfigForm();
    //Recalcula a lista de materiais do projeto ativo, se houver
    if (typeof refreshBomAfterProjectChange === 'function') {
        try { refreshBomAfterProjectChange(); } catch (e) { /* ignora se não houver projeto */ }
    }
    if (saved) showAlert('Configurações salvas', 'As novas configurações valem para toda a equipe da empresa.');
}

function getCatalogFilters() {
    const term = (document.getElementById('catalogSearchInput')?.value || '').trim().toLowerCase();
    const category = document.getElementById('catalogCategoryFilter')?.value || '';
    return { term, category };
}

function renderCatalog() {
    updateCatalogStats();
    if (catalogActiveTab === 'kits') renderCatalogKits();
    else renderCatalogMaterials();
}

//Ordem fixa das categorias na tabela de materiais
const CATALOG_CATEGORY_ORDER = ['Ferragem', 'Lançamento', 'Fusão', 'Data Center'];

function getCatalogCategoryRank(cat) {
    const idx = CATALOG_CATEGORY_ORDER.indexOf(cat);
    return idx === -1 ? CATALOG_CATEGORY_ORDER.length : idx;
}

function buildCatalogMaterialRowHtml(m) {
    const meta = [m.code ? `Cód. ${escapeHtml(m.code)}` : '', m.notes ? escapeHtml(m.notes) : ''].filter(Boolean).join(' · ');
    return `
        <tr data-material-id="${m.id}">
            <td><span class="catalog-item-name">${escapeHtml(m.name)}</span>${meta ? `<small class="cat3-meta">${meta}</small>` : ''}</td>
            <td><span class="cat3-unit">${escapeHtml(m.unit || 'un')}</span></td>
            <td class="cat3-num"><button type="button" class="cat3-price" data-price-material="${m.id}" title="${AppSession.isAdmin ? 'Clique para editar o preço' : ''}">R$ ${formatCatalogPrice(m.price)}</button></td>
            <td>${m.supplier ? escapeHtml(m.supplier) : '<span class="catalog-supplier-empty">—</span>'}</td>
            <td>
                <div class="catalog-row-actions">
                    <button type="button" class="catalog-icon-btn" data-edit-material="${m.id}" title="Editar material" aria-label="Editar material">${uiIcon('edit')}</button>
                    <button type="button" class="catalog-icon-btn danger" data-delete-material="${m.id}" title="Excluir material" aria-label="Excluir material">${uiIcon('trash')}</button>
                </div>
            </td>
        </tr>`;
}

function renderCatalogMaterials() {
    const body = document.getElementById('catalogMaterialsBody');
    const empty = document.getElementById('catalogMaterialsEmpty');
    if (!body) return;
    const { term, category } = getCatalogFilters();
    const rows = materialCatalog.materials
        .filter(m => !category || (m.category || 'Outros') === category)
        .filter(m => !term ||
            m.name.toLowerCase().includes(term) ||
            (m.category || '').toLowerCase().includes(term) ||
            (m.supplier || '').toLowerCase().includes(term) ||
            (m.code || '').toLowerCase().includes(term));
    const groups = {};
    rows.forEach(m => {
        const cat = m.category || 'Outros';
        (groups[cat] = groups[cat] || []).push(m);
    });
    const orderedCats = Object.keys(groups).sort((a, b) => {
        const ra = getCatalogCategoryRank(a);
        const rb = getCatalogCategoryRank(b);
        return ra !== rb ? ra - rb : a.localeCompare(b, 'pt-BR');
    });
    body.innerHTML = orderedCats.map(cat => {
        const items = groups[cat].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        const total = items.reduce((sum, m) => sum + (Number(m.price) || 0), 0);
        return `<tr class="catalog-group-row" style="--chip:${getCatalogCategoryColor(cat)}"><td colspan="5"><span class="cat3-chip__dot"></span>${escapeHtml(cat)} <span class="catalog-group-count">${items.length} ite${items.length === 1 ? 'm' : 'ns'} · média R$ ${formatCatalogPrice(total / items.length)}</span></td></tr>`
            + items.map(buildCatalogMaterialRowHtml).join('');
    }).join('');
    if (empty) empty.style.display = rows.length ? 'none' : 'flex';
}

//Edição do preço direto na tabela (administrador)
function startInlinePriceEdit(button) {
    if (!AppSession.isAdmin) return;
    const material = materialCatalog.materials.find(m => m.id === button.dataset.priceMaterial);
    if (!material) return;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.className = 'cat3-price-input';
    input.value = Number(material.price) || 0;
    button.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
        if (done) return;
        done = true;
        const value = parseFloat(input.value);
        if (save && Number.isFinite(value) && value >= 0 && value !== Number(material.price)) {
            material.price = Math.round(value * 100) / 100;
            persistMaterialCatalog();
            applyCatalogToMaterialPrices();
            syncCatalogPricesIntoBoms();
            showToast('Preço atualizado', `${material.name}: R$ ${formatCatalogPrice(material.price)}`);
        }
        renderCatalogMaterials();
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
}

function renderCatalogKits() {
    const list = document.getElementById('catalogKitsList');
    const empty = document.getElementById('catalogKitsEmpty');
    if (!list) return;
    const { term, category } = getCatalogFilters();
    const priceOf = (name) => Number(materialCatalog.materials.find(m => m.name.toUpperCase() === String(name).toUpperCase())?.price) || 0;
    const kits = materialCatalog.kits
        .filter(k => !category || (k.category || 'Outros') === category)
        .filter(k => !term ||
            k.name.toLowerCase().includes(term) ||
            (k.category || '').toLowerCase().includes(term) ||
            k.components.some(c => c.name.toLowerCase().includes(term)))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const cableKitMatches = (!category || category === 'Lançamento') && (!term || CABLE_ALCA_KIT_NAME.toLowerCase().includes(term) || 'cabo alça'.includes(term));
    const cableKitHtml = cableKitMatches ? renderCableAlcaKit(priceOf) : '';
    list.innerHTML = cableKitHtml + kits.map(k => {
        const unitOf = (c) => (Number.isFinite(c.price) ? c.price : priceOf(c.name));
        const total = k.components.reduce((sum, c) => sum + unitOf(c) * (Number(c.quantity) || 0), 0);
        const color = getCatalogCategoryColor(k.category || 'Outros');
        return `
        <article class="catalog-kit-card cat3-kit" style="--chip:${color}">
            <header>
                <div>
                    <h4>${escapeHtml(k.name)}</h4>
                    <span class="kit-card-meta"><span class="cat3-chip__dot"></span>${escapeHtml(k.category || 'Outros')} · ${k.components.length} ite${k.components.length === 1 ? 'm' : 'ns'}</span>
                </div>
                <strong class="cat3-kit__total">R$ ${formatCatalogPrice(total)}</strong>
            </header>
            <ul>${k.components.map(c => `<li><span class="kit-li-qty">${c.quantity}×</span><span class="cat3-kit__name">${escapeHtml(c.name)}</span><span class="cat3-kit__price">R$ ${formatCatalogPrice(unitOf(c) * (Number(c.quantity) || 0))}</span></li>`).join('') || '<li class="cat3-kit__empty">Sem itens</li>'}</ul>
            <div class="catalog-row-actions">
                <button type="button" class="catalog-icon-btn" data-edit-kit="${k.id}">${uiIcon('edit')} Editar</button>
                <button type="button" class="catalog-icon-btn danger" data-delete-kit="${k.id}" title="Excluir kit" aria-label="Excluir kit">${uiIcon('trash')}</button>
            </div>
        </article>`;
    }).join('');
    if (empty) empty.style.display = kits.length || cableKitHtml ? 'none' : 'flex';
}

//Cartão do kit "Cabos e alças": clicando, lista cada cabo com a sua alça (trocável)
function renderCableAlcaKit(priceOf) {
    const alcaOptions = [...new Set(materialCatalog.materials
        .filter(m => /ALÇA PREFORMADA OPDE/i.test(m.name))
        .map(m => m.name))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
    const cableTypes = CABLE_ALCA_KIT_TYPES;
    const color = getCatalogCategoryColor('Lançamento');
    const rows = cableTypes.map(type => {
        const alca = getCableAlca(type) || '';
        const options = (alcaOptions.includes(alca) || !alca ? alcaOptions : [alca, ...alcaOptions])
            .map(name => `<option value="${escapeHtml(name)}"${name === alca ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('');
        return `<li class="cable-alca-row">
            <span class="cable-alca-row__cable">${escapeHtml(resolveMaterialName(type))}</span>
            <span class="cable-alca-row__arrow" aria-hidden="true">→</span>
            <select class="cable-alca-row__select" data-cable-alca="${escapeHtml(type)}" aria-label="Alça do cabo"${AppSession.canEdit ? '' : ' disabled'}>${options}</select>
            <span class="cat3-kit__price">R$ ${formatCatalogPrice(priceOf(alca))}</span>
        </li>`;
    }).join('');
    return `
        <article class="catalog-kit-card cat3-kit cable-alca-kit" style="--chip:${color}">
            <details>
                <summary>
                    <div>
                        <h4>${CABLE_ALCA_KIT_NAME}</h4>
                        <span class="kit-card-meta"><span class="cat3-chip__dot"></span>Lançamento · ${cableTypes.length} cabos · clique para ver cada cabo e a sua alça</span>
                    </div>
                </summary>
                <ul class="cable-alca-list">${rows}</ul>
                <p class="cable-alca-note">As quantidades por poste (alças por SUPA, SUPA, BAP e plaquetas) ficam em Configurações.</p>
            </details>
        </article>`;
}

//Atualiza os contadores do cabeçalho
function updateCatalogStats() {
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('catalogMaterialsCount', materialCatalog.materials.length);
    set('catalogKitsCount', materialCatalog.kits.length);
    set('catalogCategoriesCount', getCatalogCategories().length);
}

/* ------------------ Formulário de material ------------------ */
function openMaterialForm(materialId = null) {
    const modal = document.getElementById('materialFormModal');
    if (!modal) return;
    const material = materialId ? materialCatalog.materials.find(m => m.id === materialId) : null;
    document.getElementById('materialFormTitle').textContent = material ? 'Editar Material' : 'Adicionar Material';
    document.getElementById('materialFormId').value = material ? material.id : '';
    document.getElementById('materialFormName').value = material ? material.name : '';
    document.getElementById('materialFormCategory').value = material ? (material.category || '') : '';
    document.getElementById('materialFormUnit').value = material ? (material.unit || 'un') : 'un';
    document.getElementById('materialFormPrice').value = material ? (material.price || 0) : 0;
    document.getElementById('materialFormCode').value = material ? (material.code || '') : '';
    document.getElementById('materialFormSupplier').value = material ? (material.supplier || '') : '';
    document.getElementById('materialFormNotes').value = material ? (material.notes || '') : '';
    populateCatalogCategoryFilters();
    modal.style.display = 'flex';
}

function saveMaterialFormHandler() {
    const id = document.getElementById('materialFormId').value;
    const name = document.getElementById('materialFormName').value.trim();
    if (!name) {
        showAlert('Atenção', 'Informe o nome do material.');
        return;
    }
    const duplicate = materialCatalog.materials.find(m => m.id !== id && m.name.toUpperCase() === name.toUpperCase())
        || materialCatalog.kits.find(k => k.name.toUpperCase() === name.toUpperCase());
    if (duplicate) {
        showAlert('Atenção', 'Já existe um material ou kit com esse nome.');
        return;
    }
    const data = {
        name,
        category: document.getElementById('materialFormCategory').value.trim() || 'Outros',
        unit: document.getElementById('materialFormUnit').value || 'un',
        price: parseFloat(document.getElementById('materialFormPrice').value) || 0,
        code: document.getElementById('materialFormCode').value.trim(),
        supplier: document.getElementById('materialFormSupplier').value.trim(),
        notes: document.getElementById('materialFormNotes').value.trim()
    };
    if (id) {
        const material = materialCatalog.materials.find(m => m.id === id);
        if (material) Object.assign(material, data);
    } else {
        materialCatalog.materials.push({ id: generateCatalogId('mat'), ...data });
    }
    persistMaterialCatalog();
    applyCatalogToMaterialPrices();
    syncCatalogPricesIntoBoms();
    populateCatalogCategoryFilters();
    renderCatalog();
    document.getElementById('materialFormModal').style.display = 'none';
}

function deleteCatalogMaterial(materialId) {
    const material = materialCatalog.materials.find(m => m.id === materialId);
    if (!material) return;
    showConfirm('Excluir material', `Remover "${material.name}" do catálogo?`, () => {
        materialCatalog.materials = materialCatalog.materials.filter(m => m.id !== materialId);
        persistMaterialCatalog();
        populateCatalogCategoryFilters();
        renderCatalog();
    });
}

/* ------------------ Formulário de kit ------------------ */
function addKitComponentRow(name = '', quantity = 1) {
    const list = document.getElementById('kitComponentsList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'kit-component-row';
    row.innerHTML = `
        <input type="text" class="kit-component-name" list="kitMaterialOptions" placeholder="Material" value="${escapeHtml(name)}" />
        <input type="number" class="kit-component-qty" min="0" step="1" value="${Number(quantity) || 1}" />
        <button type="button" class="kit-component-remove" title="Remover">&times;</button>`;
    row.querySelector('.kit-component-remove').addEventListener('click', () => row.remove());
    list.appendChild(row);
}

function openKitForm(kitId = null) {
    const modal = document.getElementById('kitFormModal');
    if (!modal) return;
    const kit = kitId ? materialCatalog.kits.find(k => k.id === kitId) : null;
    document.getElementById('kitFormTitle').textContent = kit ? 'Editar Kit' : 'Adicionar Kit';
    document.getElementById('kitFormId').value = kit ? kit.id : '';
    document.getElementById('kitFormName').value = kit ? kit.name : '';
    document.getElementById('kitFormCategory').value = kit ? (kit.category || '') : '';
    const list = document.getElementById('kitComponentsList');
    if (list) list.innerHTML = '';
    populateCatalogCategoryFilters();
    if (kit && kit.components.length) {
        kit.components.forEach(c => addKitComponentRow(c.name, c.quantity));
    } else {
        addKitComponentRow();
    }
    modal.style.display = 'flex';
}

function saveKitFormHandler() {
    const id = document.getElementById('kitFormId').value;
    const name = document.getElementById('kitFormName').value.trim();
    if (!name) {
        showAlert('Atenção', 'Informe o nome do kit.');
        return;
    }
    const duplicate = materialCatalog.kits.find(k => k.id !== id && k.name.toUpperCase() === name.toUpperCase())
        || materialCatalog.materials.find(m => m.name.toUpperCase() === name.toUpperCase());
    if (duplicate) {
        showAlert('Atenção', 'Já existe um material ou kit com esse nome.');
        return;
    }
    const components = [];
    document.querySelectorAll('#kitComponentsList .kit-component-row').forEach(row => {
        const cName = row.querySelector('.kit-component-name').value.trim();
        const cQty = Number(row.querySelector('.kit-component-qty').value) || 0;
        if (cName && cQty > 0) components.push({ name: cName, quantity: cQty });
    });
    if (!components.length) {
        showAlert('Atenção', 'Adicione pelo menos um material ao kit.');
        return;
    }
    const data = {
        name,
        category: document.getElementById('kitFormCategory').value.trim() || 'Outros',
        components
    };
    if (id) {
        const kit = materialCatalog.kits.find(k => k.id === id);
        if (kit) Object.assign(kit, data);
    } else {
        materialCatalog.kits.push({ id: generateCatalogId('kit'), ...data });
    }
    persistMaterialCatalog();
    applyCatalogToMaterialPrices();
    populateCatalogCategoryFilters();
    renderCatalog();
    document.getElementById('kitFormModal').style.display = 'none';
}

function deleteCatalogKit(kitId) {
    const kit = materialCatalog.kits.find(k => k.id === kitId);
    if (!kit) return;
    showConfirm('Excluir kit', `Remover o kit "${kit.name}"?`, () => {
        materialCatalog.kits = materialCatalog.kits.filter(k => k.id !== kitId);
        persistMaterialCatalog();
        populateCatalogCategoryFilters();
        renderCatalog();
    });
}

/* ------------------ Importação de planilha de preços ------------------ */
let currentImportPreview = [];

//Normaliza nomes para comparação (sem acentos, maiúsculo, só alfanumérico)
function normalizeMaterialName(str) {
    return String(str || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

//Converte unidade da planilha para o padrão do sistema
function normalizeImportUnit(unit) {
    const u = String(unit || '').toLowerCase().trim();
    if (u.startsWith('m') && !u.startsWith('un')) return 'm';
    if (u.startsWith('un') || u === 'pç' || u === 'pc' || u === 'pcs') return 'un';
    return 'un';
}

//Lê a planilha e extrai linhas válidas {name, unit, price}
function parseImportWorkbook(arrayBuffer) {
    if (typeof XLSX === 'undefined') {
        throw new Error('Biblioteca de leitura de planilha indisponível.');
    }
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const rows = [];
    let block = 0; //Blocos/seções separados por linhas "Total" ou cabeçalhos
    const SECTION_LABELS = ['total', 'valor unitário', 'valor unitario', 'item', 'descrição', 'descricao', 'subtotal'];
    wb.SheetNames.forEach(sheetName => {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) return;
        const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
        let blockHasItems = false;
        matrix.forEach(cols => {
            if (!Array.isArray(cols)) return;
            //Detecta separadores de seção em qualquer coluna (ex.: "Total")
            const isSeparator = cols.some(c => c != null && SECTION_LABELS.includes(String(c).trim().toLowerCase()));
            //Nome = primeira célula de texto
            const name = (cols[0] != null ? String(cols[0]) : '').trim();
            if (isSeparator) {
                if (blockHasItems) { block++; blockHasItems = false; } //Avança para o próximo bloco
                return;
            }
            if (!name) return;
            //Preço = última célula numérica da linha
            let price = null;
            let unit = '';
            for (let i = 1; i < cols.length; i++) {
                const cell = cols[i];
                if (cell == null) continue;
                if (typeof cell === 'number' && isFinite(cell)) {
                    price = cell;
                } else {
                    const txt = String(cell).trim();
                    if (/^[a-zA-Zçãéúíó]+\.?$/.test(txt) && txt.length <= 5) unit = txt;
                    //Tenta converter texto numérico (ex.: "R$ 1,10")
                    const num = parseFloat(txt.replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
                    if (Number.isFinite(num) && txt !== '-' && /\d/.test(txt)) price = num;
                }
            }
            if (price == null || !Number.isFinite(price)) return; //Sem preço válido
            blockHasItems = true;
            rows.push({ name, unit: normalizeImportUnit(unit), price: Number(price), block });
        });
        if (blockHasItems) { block++; blockHasItems = false; } //Separa por planilha
    });
    return rows;
}

//Categoria dos materiais da planilha de preços: só Lançamento (cabos), Fusão ou Ferragem.
//Data Center fica para o que vem da planilha de kits e não existe na planilha de preços.
function classifyPriceSheetCategory(name) {
    const n = normalizeMaterialName(name);
    if (/\b(CFOA|DROP|FIGURA 08|CABO OPTICO|CABO UTP)\b/.test(n)) return 'Lançamento';
    if (/\b(SPLITTER|ADAPTADOR|TUBETE|EMENDA|CEO|BANDEJA|FUSAO|FUSOES|CTO|CAIXA|CAIXAS|PIGTAIL|PIGTAILS|CONECTOR|PTO|DERIVACAO|DIO|DGO|CORDAO|CORDOES|PATCHCORD|TERMINACAO|FOSC)\b/.test(n)) return 'Fusão';
    return 'Ferragem';
}

//Aplica a regra de categorias no catálogo (itens de mão de obra e marcadores internos ficam como estão)
const CATALOG_FIXED_CATEGORY_NAMES = new Set(['CTO', 'RESERVA', 'CASA', 'PLACA', 'MAO DE OBRA REGIONAL', 'MAO DE OBRA TERCEIRIZADA']);
//Seção da planilha de preços → categoria do sistema
function categoryFromSheetSection(section) {
    const s = normalizeMaterialName(section);
    if (!s) return null;
    if (/DATA ?CENTER/.test(s)) return 'Data Center';
    if (/\bCABOS?\b/.test(s)) return 'Lançamento';
    if (/\bFERRAGENS?\b/.test(s)) return 'Ferragem';
    return 'Fusão'; //Seção de caixas, splitters e acessórios de fusão
}

function applyMaterialCategoryRules(materials) {
    materials.forEach(m => {
        if (CATALOG_FIXED_CATEGORY_NAMES.has(normalizeMaterialName(m.name))) return;
        m.category = m.notes === 'Da planilha de kits' ? 'Data Center'
            : (categoryFromSheetSection(m.section) || classifyPriceSheetCategory(m.name));
    });
}

//Infere a categoria de um material novo pelo nome
function inferCategoryFromName(name) {
    const n = normalizeMaterialName(name);
    if (/\b(CABO|FIBRA|FIBRAS|DROP|CFOA|FIGURA 08|FO)\b/.test(n)) return 'Lançamento';
    if (/\b(SPLITTER|ADAPTADOR|TUBETE|EMENDA|CEO|BANDEJA|FUSAO|CTO|CAIXA|PIGTAIL|CONECTOR|PTO|DERIVACAO)\b/.test(n)) return 'Fusão';
    if (/\b(OLT|SFP|XFP|RACK|DGO|CHASSI|SWITCH|BATERIA|FONTE|PATCHCORD|CORDAO|MODULO)\b/.test(n)) return 'Data Center';
    return 'Ferragem';
}

//Pontuação de similaridade entre dois nomes normalizados (Jaccard de tokens)
function nameSimilarity(aNorm, bNorm) {
    const a = new Set(aNorm.split(' ').filter(Boolean));
    const b = new Set(bNorm.split(' ').filter(Boolean));
    if (!a.size || !b.size) return 0;
    let inter = 0;
    a.forEach(t => { if (b.has(t)) inter++; });
    return inter / (a.size + b.size - inter);
}

//Nomes da planilha de preços da empresa → material do sistema (os nomes usados nos cálculos)
//Itens com o mesmo nome dos dois lados não precisam estar aqui.
const SHEET_MATERIAL_ALIASES = {
    'CFOA SM ASU 80 S 06 FIBRAS NR': 'Cabo AS 80 FO-06',
    'CFOA SM ASU 80 S 12 FIBRAS NR': 'Cabo AS 80 FO-12',
    'CFOA SM AS 80 S 24 FIBRAS NR KP': 'Cabo AS 80 FO-24',
    'CFOA SM AS 80 S 36 FIBRAS NR KP': 'Cabo AS 80 FO-36',
    'CFOA SM AS 80 S 48 FIBRAS NR KP': 'Cabo AS 80 FO-48',
    'CFOA SM AS 80 S 72 FIBRAS NR KP': 'Cabo AS 80 FO-72',
    'CFOA SM AS 80 S 144 FIBRAS NR KP': 'Cabo AS 80 FO-144',
    'CFOA SM AS 200 S 12 FIBRAS NR KP': 'Cabo AS 200 FO-12',
    'CFOA SM AS 200 S 24 FIBRAS NR KP': 'Cabo AS 200 FO-24',
    'CFOA SM AS 200 S 36 FIBRAS NR KP': 'Cabo AS 200 FO-36',
    'DROP FLAT 1FO': 'CABO DROP FLAT LOW FRICTION 1F',
    'SPLITTER FUSAO 1 2': 'Splitter 1/2',
    'SPLITTER FUSAO 1 4': 'Splitter 1/4',
    'SPLITTER FUSAO 1 8': 'Splitter 1/8',
    'SPLITTER CONECTORIZADO 1 8 SC APC': 'Splitter 1/8 APC',
    'SPLITTER CONECTORIZADO 1 8 SC UPC': 'Splitter 1/8 UPC',
    'SPLITTER CONECTORIZADO 1 16 SC APC': 'Splitter 1/16 APC',
    'SPLITTER CONECTORIZADO 1 16 SC UPC': 'Splitter 1/16 UPC',
    'CTO FIBERSUL': 'CAIXA DE ATENDIMENTO',
    'CAIXA DE TERMINACAO OPTICA PREDIAL': 'CAIXA DE ATENDIMENTO PREDIAL',
    'CAIXAS DE FUSAO 24F EXPANSIVA': 'CAIXA DE EMENDA ÓPTICA (CEO)',
    'CAIXAS DE EMENDA OPTICA DE 144 FIBRAS': 'CAIXA DE EMENDA OPTICA (CEO) 144 FUSÕES',
    'KIT DE BANDEJA PARA CAIXA TIPO FOSC 24F': 'KIT DE BANDEJA PARA CAIXA DE EMENDA',
    'SUPORTE ANCORAGEM PARA CABOS OPTICOS SUPA': 'SUPORTE ANCORAGEM PARA CABOS OPTICOS (SUPAS)',
    'RESERVA OPTILOOP RAQUETE': 'RESERVA OPTILOOP',
    'ALCA PREFORMADA DERIVACAO EM T': 'DERIVAÇÃO EM T',
    'PLAQUETA DE IDENTIFICACAO DE CABOS': 'PLAQUETA DE IDENTIFICAÇÃO',
    'ARAME DE ESPINAR BOBINA DE 105M': 'ARAME DE ESPIMAR (105 m)',
    'PRENCA PARA ESPINAR': 'PRENSA DE ESPINAR',
    'PONTO DE TERMINACAO OPTICA PTO': 'PTO - PONTO DE TERMINAÇÃO ÓPTICA',
    'CONECTOR PRE POLIDO': 'CONECTOR DE CAMPO SC/APC',
    'CORDOES SC PC SC APC': 'CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2m',
    'CORDAO OPTICO DUPLEX MULTIMODO LC UPC LC UPC 2M': 'CORDÃO ÓPTICO DUPLEX MULTIMODO LC/UPC > LC/UPC OM3 2M',
    'CORDAO OPTICO DUPLEX MONOMODO LC UPC SC APC 2M': 'CORDÃO ÓPTICO DUPLEX MONOMODO LC/UPC > SC/APC 2M',
    'PATCHCORD MAXITELECOM CAT6 1 5M': 'PATCHCORD CAT6 AZUL 1,5M',
    'DIO DE 144 POSICOES SC APC COM PIGTAILS COR PRETA': 'DGO 144 SC/APC COM PIGTAILS COR PRETA',
    'ROLO VELCRO 3M PARA ORGANIZAR CABOS': 'ROLO VELCRO DE 3 METROS PARA ORGANIZAR CABOS',
    'PORCA GAIOLA PARAFUSO': 'KIT PORCA GAIOLA + PARAFUSO',
    'KIT RODIZIO DE 4 PECAS COM 4 RODAS PARA RACK IPMETAL 60X60CM RP50 PL50X67': 'RODIZIO RP50 PL50X67 - KIT 4 PEÇAS',
    'SFP 1270NM TX 1330NM RX 20KM 10G BIDI': 'SFP 1270NM TX/1330NM RX 20KM, 10G, BIDI',
    'SFP 1330NM TX 1270NM RX 20KM 10G BIDI': 'SFP 1330NM TX/1270NM RX 20KM, 10G, BIDI',
    'SFP MULTIMODO 10G DUPLEX': 'SFP 850NM 10G 0,3KM MULTIMODO DUPLEX',
    'INVERSOR 48VCC 110VCA 600W XPS': 'FONTE INVERSORA 48VCC/110VCA 600W',
    'AR CONDICIONADO SPLIT HI WALL LG DUAL INVERTER 12000 BTUS FRIO': 'AR CONDICIONADO SPLIT HI WALL LG DUAL INVERTER 12000 BTUS FRIO 220V',
};

//Encontra o melhor material correspondente para um nome da planilha
function findCatalogMatch(sheetName, code = '') {
    //Equivalência conhecida entre a planilha e o sistema
    const aliasName = SHEET_MATERIAL_ALIASES[normalizeMaterialName(sheetName)] ? resolveMaterialName(SHEET_MATERIAL_ALIASES[normalizeMaterialName(sheetName)]) : null;
    if (aliasName) {
        const aliasTarget = normalizeMaterialName(aliasName);
        const byAlias = materialCatalog.materials.find(m => normalizeMaterialName(m.name) === aliasTarget);
        if (byAlias) return { material: byAlias, score: 1 };
    }
    //Código igual ao do catálogo tem prioridade sobre o nome
    const byCode = code && materialCatalog.materials.find(m => m.code && String(m.code).trim().toLowerCase() === String(code).trim().toLowerCase());
    if (byCode) return { material: byCode, score: 1 };
    const target = normalizeMaterialName(sheetName);
    let exact = null;
    let best = null;
    let bestScore = 0;
    materialCatalog.materials.forEach(m => {
        const norm = normalizeMaterialName(m.name);
        if (norm === target) { exact = m; return; }
        const score = nameSimilarity(target, norm);
        if (score > bestScore) { bestScore = score; best = m; }
    });
    if (exact) return { material: exact, score: 1 };
    if (best && bestScore >= 0.6) return { material: best, score: bestScore };
    return { material: null, score: bestScore };
}

//Constrói a prévia da importação
function buildImportPreview(rows) {
    const entries = rows.map((row, idx) => {
        const match = findCatalogMatch(row.name, row.code);
        return {
            idx,
            code: row.code || '',
            sheetName: row.name,
            unit: row.unit,
            price: row.price,
            block: row.block || 0,
            matchId: match.material ? match.material.id : null,
            matchCategory: match.material ? (match.material.category || 'Outros') : null,
            score: match.score
        };
    });
    //Categoria dominante de cada bloco (com base nos itens que casaram)
    const blockCategoryVotes = {};
    entries.forEach(e => {
        if (e.matchCategory) {
            blockCategoryVotes[e.block] = blockCategoryVotes[e.block] || {};
            blockCategoryVotes[e.block][e.matchCategory] = (blockCategoryVotes[e.block][e.matchCategory] || 0) + 1;
        }
    });
    const blockCategory = {};
    Object.keys(blockCategoryVotes).forEach(b => {
        blockCategory[b] = Object.entries(blockCategoryVotes[b]).sort((a, c) => c[1] - a[1])[0][0];
    });
    //Define a categoria final de cada item
    entries.forEach(e => {
        e.category = e.matchCategory || blockCategory[e.block] || inferCategoryFromName(e.sheetName);
    });
    return entries;
}

//Determina status com base no material escolhido e preço
function computeImportRowStatus(entry, selectValue) {
    if (!Number.isFinite(entry.price)) return { status: 'invalid', checked: false, currentPrice: null };
    if (selectValue === '__ignore__') return { status: 'ignore', checked: false, currentPrice: null };
    if (selectValue === '__new__') return { status: 'new', checked: true, currentPrice: null };
    const material = materialCatalog.materials.find(m => m.id === selectValue);
    if (!material) return { status: 'ignore', checked: false, currentPrice: null };
    const same = Math.abs((Number(material.price) || 0) - entry.price) < 0.005;
    return { status: same ? 'same' : 'update', checked: !same, currentPrice: Number(material.price) || 0 };
}

const IMPORT_STATUS_LABELS = {
    update: { label: 'Atualizar', cls: 'update' },
    same: { label: 'Sem alteração', cls: 'same' },
    new: { label: 'Novo', cls: 'new' },
    ignore: { label: 'Ignorar', cls: 'invalid' },
    invalid: { label: 'Inválido', cls: 'invalid' }
};

function buildImportMatchSelect(entry) {
    const sorted = [...materialCatalog.materials].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const options = sorted.map(m =>
        `<option value="${m.id}" ${m.id === entry.matchId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
    ).join('');
    const defaultIgnore = !entry.matchId ? 'selected' : '';
    return `<select class="import-map-select" data-idx="${entry.idx}">
        <option value="__new__">➕ Adicionar como novo material</option>
        <option value="__ignore__" ${defaultIgnore}>— Ignorar esta linha —</option>
        ${options}
    </select>`;
}

function buildImportRowHtml(entry) {
    const selectValue = entry.matchId || '__ignore__';
    const st = computeImportRowStatus(entry, selectValue);
    const meta = IMPORT_STATUS_LABELS[st.status];
    const disabled = (st.status === 'invalid' || st.status === 'ignore') ? 'disabled' : '';
    return `<tr data-idx="${entry.idx}">
        <td class="import-col-check"><input type="checkbox" class="import-row-check" data-idx="${entry.idx}" ${st.checked ? 'checked' : ''} ${disabled} /></td>
        <td><span class="import-sheet-name">${escapeHtml(entry.sheetName)}</span><small class="import-sheet-meta">${escapeHtml(entry.unit)}</small></td>
        <td>${buildImportMatchSelect(entry)}</td>
        <td class="import-price import-current-price">${st.currentPrice != null ? 'R$ ' + formatCatalogPrice(st.currentPrice) : '—'}</td>
        <td class="import-price">R$ ${formatCatalogPrice(entry.price)}</td>
        <td><span class="import-badge ${meta.cls}">${meta.label}</span></td>
    </tr>`;
}

function renderImportPreview() {
    const body = document.getElementById('importPreviewBody');
    if (!body) return;
    //Agrupa por categoria/tipo
    const groups = {};
    currentImportPreview.forEach(entry => {
        const cat = entry.category || 'Outros';
        (groups[cat] = groups[cat] || []).push(entry);
    });
    const orderedCats = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    body.innerHTML = orderedCats.map(cat => {
        const rows = groups[cat].map(buildImportRowHtml).join('');
        return `<tr class="import-group-row"><td colspan="6">${escapeHtml(cat)} <span class="import-group-count">(${groups[cat].length})</span></td></tr>${rows}`;
    }).join('');
    updateImportSummary();
}

function updateImportRow(idx) {
    const tr = document.querySelector(`#importPreviewBody tr[data-idx="${idx}"]`);
    const entry = currentImportPreview.find(e => e.idx === idx);
    if (!tr || !entry) return;
    const select = tr.querySelector('.import-map-select');
    const st = computeImportRowStatus(entry, select.value);
    const meta = IMPORT_STATUS_LABELS[st.status];
    const checkbox = tr.querySelector('.import-row-check');
    checkbox.checked = st.checked;
    checkbox.disabled = (st.status === 'invalid' || st.status === 'ignore');
    tr.querySelector('.import-current-price').textContent = st.currentPrice != null ? 'R$ ' + formatCatalogPrice(st.currentPrice) : '—';
    const badge = tr.querySelector('.import-badge');
    badge.className = `import-badge ${meta.cls}`;
    badge.textContent = meta.label;
    updateImportSummary();
}

function updateImportSummary() {
    const summary = document.getElementById('importSummary');
    if (!summary) return;
    let update = 0, novo = 0, same = 0, ignore = 0;
    document.querySelectorAll('#importPreviewBody tr').forEach(tr => {
        const select = tr.querySelector('.import-map-select');
        const idx = Number(tr.dataset.idx);
        const entry = currentImportPreview.find(e => e.idx === idx);
        if (!entry || !select) return;
        const st = computeImportRowStatus(entry, select.value);
        if (st.status === 'update') update++;
        else if (st.status === 'new') novo++;
        else if (st.status === 'same') same++;
        else ignore++;
    });
    summary.innerHTML =
        `<span><strong>${currentImportPreview.length}</strong> itens lidos</span>` +
        `<span class="import-badge update">${update} para atualizar</span>` +
        `<span class="import-badge new">${novo} novos</span>` +
        `<span class="import-badge same">${same} sem alteração</span>` +
        `<span class="import-badge invalid">${ignore} ignorados</span>`;
}

function handleCatalogImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const rows = parseImportWorkbook(e.target.result);
            if (!rows.length) {
                showAlert('Planilha vazia', 'Não encontrei itens com preço válido na planilha. Confira se há colunas com o nome do item e o preço unitário.');
                return;
            }
            currentImportPreview = buildImportPreview(rows);
            document.getElementById('importFileName').textContent = `Arquivo: ${file.name}`;
            renderImportPreview();
            const toggleAll = document.getElementById('importToggleAll');
            if (toggleAll) toggleAll.checked = false;
            document.getElementById('materialImportModal').style.display = 'flex';
        } catch (err) {
            console.error(err);
            showAlert('Erro ao ler planilha', 'Não foi possível ler o arquivo. Use um arquivo .xlsx, .xls ou .csv válido.');
        }
    };
    reader.onerror = () => showAlert('Erro', 'Falha ao abrir o arquivo.');
    reader.readAsArrayBuffer(file);
}

// ---------------------------------------------------------------
// Preços pela API de materiais (mesmo formato da FastAPI em api/)
// Ordem: API configurada → planilha ao vivo (Google Sheets) → materiais.json publicado no deploy
// ---------------------------------------------------------------
const MATERIALS_API_URL_KEY = 'routeMapMaterialsApiUrl';
const DEFAULT_MATERIALS_API_URL = ''; //URL da FastAPI, se for publicada num servidor (ex.: https://routemap-materiais.onrender.com)
const MATERIALS_SHEET_ID = '1vM1Oobfzbz0MnTKku1Vo6Nxpf9sOkYWBN9tiUqzjMbk';
const MATERIALS_SHEET_GID = '0';
const MATERIALS_HEADER_ALIASES = {
    codigo: ['codigo', 'cod', 'cod.', 'codigo do item', 'item', 'sku', 'referencia', 'ref'],
    descricao: ['descricao', 'descricao do item', 'material', 'produto', 'nome'],
    unidade: ['unidade', 'und', 'un', 'unid', 'unid.', 'medida'],
    valor_unitario: ['valor unitario', 'vlr unitario', 'preco unitario', 'valor unit', 'valor', 'preco', 'custo unitario'],
};

function getMaterialsApiUrl() {
    let saved = '';
    try { saved = localStorage.getItem(MATERIALS_API_URL_KEY) || ''; } catch (e) { /* sem armazenamento */ }
    return (saved || DEFAULT_MATERIALS_API_URL).replace(/\/+$/, '');
}

function normalizeSheetHeader(text) {
    return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function parseSheetPrice(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    let text = String(value ?? '').trim();
    if (!/\d/.test(text)) return null;
    text = text.replace(/[^0-9,.-]/g, '');
    if (text.includes(',') && text.includes('.')) {
        text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
    } else if (text.includes(',')) {
        text = text.replace(/\./g, '').replace(',', '.');
    }
    const number = parseFloat(text);
    return Number.isFinite(number) ? number : null;
}

//Lê o CSV da planilha no mesmo formato de resposta da API: { itens: [{ codigo, descricao, unidade, valor_unitario }] }
function parseMaterialsSheetCsv(csvText) {
    const wb = XLSX.read(csvText, { type: 'string', raw: true });
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    let start = -1;
    let cols = null;
    for (let r = 0; r < Math.min(matrix.length, 30) && start < 0; r++) {
        const cells = (matrix[r] || []).map(normalizeSheetHeader);
        const found = {};
        Object.entries(MATERIALS_HEADER_ALIASES).forEach(([field, aliases]) => {
            const col = cells.findIndex((cell, i) => !Object.values(found).includes(i)
                && (aliases.includes(cell) || aliases.some(a => a.length > 3 && cell.startsWith(a))));
            if (col >= 0) found[field] = col;
        });
        if ('descricao' in found && 'valor_unitario' in found) { start = r; cols = found; }
    }
    if (start < 0) throw new Error('Cabeçalho não encontrado na planilha (Descrição e Valor unitário).');
    const get = (row, field) => (field in cols ? String(row[cols[field]] ?? '').trim() : '');
    const itens = [];
    matrix.slice(start + 1).forEach(row => {
        const descricao = get(row, 'descricao');
        const valor = parseSheetPrice(get(row, 'valor_unitario'));
        if (!descricao || valor == null || ['total', 'subtotal'].includes(normalizeSheetHeader(descricao))) return;
        itens.push({ codigo: get(row, 'codigo'), descricao, unidade: get(row, 'unidade') || 'un', valor_unitario: valor });
    });
    return { itens, atualizado_em: new Date().toISOString() };
}

async function fetchMaterialsData() {
    const errors = [];
    const apiUrl = getMaterialsApiUrl();
    if (apiUrl) {
        try {
            const response = await fetch(`${apiUrl}/materiais?atualizar=true`);
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || `Erro ${response.status}`);
            return { data, source: 'API de materiais' };
        } catch (error) { errors.push(`API: ${error.message}`); }
    }
    try {
        const url = `https://docs.google.com/spreadsheets/d/${MATERIALS_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${MATERIALS_SHEET_GID}&t=${Date.now()}`;
        const response = await fetch(url);
        const text = await response.text();
        if (!response.ok || /^\s*</.test(text)) throw new Error('planilha não está pública');
        return { data: parseMaterialsSheetCsv(text), source: 'planilha (ao vivo)' };
    } catch (error) { errors.push(`Planilha: ${error.message}`); }
    try {
        const response = await fetch(`materiais.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Erro ${response.status}`);
        return { data: await response.json(), source: 'materiais.json (gerado no deploy)' };
    } catch (error) { errors.push(`materiais.json: ${error.message}`); }
    throw new Error(errors.join(' · '));
}

async function syncCatalogFromApi() {
    const button = document.getElementById('catalogApiSyncButton');
    if (button) button.disabled = true;
    showToast('Buscando preços', 'Lendo a planilha de materiais…', 'progress');
    try {
        const { data, source } = await fetchMaterialsData();
        const rows = (data.itens || [])
            .filter(item => item.descricao && Number.isFinite(Number(item.valor_unitario)))
            .map(item => ({ name: item.descricao, code: item.codigo || '', unit: normalizeImportUnit(item.unidade), price: Number(item.valor_unitario), block: 0 }));
        if (!rows.length) {
            showAlert('Planilha vazia', 'Não encontrei itens com descrição e valor unitário na planilha.');
            return;
        }
        currentImportPreview = buildImportPreview(rows);
        document.getElementById('importFileName').textContent = `Fonte: ${source} · ${rows.length} itens · ${new Date(data.atualizado_em || Date.now()).toLocaleString('pt-BR')}`;
        renderImportPreview();
        const toggleAll = document.getElementById('importToggleAll');
        if (toggleAll) toggleAll.checked = false;
        document.getElementById('materialImportModal').style.display = 'flex';
    } catch (error) {
        console.error('Erro ao buscar a planilha de materiais:', error);
        showAlert('Não foi possível ler a planilha', `Confira se a planilha está compartilhada como "Qualquer pessoa com o link: Leitor". Detalhes: ${error.message}`);
    } finally {
        if (button) button.disabled = false;
    }
}

function applyMaterialImportHandler() {
    let updated = 0, created = 0;
    document.querySelectorAll('#importPreviewBody tr').forEach(tr => {
        const checkbox = tr.querySelector('.import-row-check');
        if (!checkbox || !checkbox.checked || checkbox.disabled) return;
        const idx = Number(tr.dataset.idx);
        const entry = currentImportPreview.find(e => e.idx === idx);
        const select = tr.querySelector('.import-map-select');
        if (!entry || !select) return;
        const value = select.value;
        if (value === '__new__') {
            const dup = materialCatalog.materials.find(m => normalizeMaterialName(m.name) === normalizeMaterialName(entry.sheetName));
            if (dup) {
                dup.price = entry.price;
                updated++;
            } else {
                materialCatalog.materials.push({
                    id: generateCatalogId('mat'),
                    name: entry.sheetName,
                    category: entry.category || 'Outros',
                    unit: entry.unit || 'un',
                    price: entry.price,
                    supplier: '',
                    code: entry.code || '',
                    notes: 'Importado de planilha'
                });
                created++;
            }
        } else if (value !== '__ignore__') {
            const material = materialCatalog.materials.find(m => m.id === value);
            if (material) {
                material.price = entry.price;
                if (entry.code && !material.code) material.code = entry.code;
                updated++;
            }
        }
    });
    if (updated === 0 && created === 0) {
        showAlert('Nada para aplicar', 'Selecione ao menos um item para atualizar ou adicionar.');
        return;
    }
    persistMaterialCatalog();
    applyCatalogToMaterialPrices();
    syncCatalogPricesIntoBoms();
    populateCatalogCategoryFilters();
    renderCatalog();
    document.getElementById('materialImportModal').style.display = 'none';
    showAlert('Importação concluída', `${updated} preço(s) atualizado(s) e ${created} material(is) adicionado(s). As listas de materiais já refletem os novos valores.`);
}

//Conecta todos os eventos da interface do catálogo
function setupMaterialCatalogUI() {
    const openBtn = document.getElementById('materialCatalogButton');
    openBtn?.addEventListener('click', openMaterialCatalogModal);

    const modal = document.getElementById('materialCatalogModal');
    document.getElementById('closeMaterialCatalogModal')?.addEventListener('click', () => {
        if (modal) modal.style.display = 'none';
    });

    document.querySelectorAll('.catalog-tab').forEach(btn => {
        btn.addEventListener('click', () => setCatalogTab(btn.dataset.catalogTab));
    });
    document.getElementById('catalogSearchInput')?.addEventListener('input', renderCatalog);
    document.getElementById('catalogCategoryFilter')?.addEventListener('change', renderCatalog);
    document.getElementById('catalogAddButton')?.addEventListener('click', () => {
        if (catalogActiveTab === 'kits') openKitForm(null);
        else openMaterialForm(null);
    });

    //Delegação de ações na tabela de materiais
    document.getElementById('catalogMaterialsBody')?.addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-edit-material]');
        const delBtn = e.target.closest('[data-delete-material]');
        const priceBtn = e.target.closest('[data-price-material]');
        if (editBtn) openMaterialForm(editBtn.dataset.editMaterial);
        else if (delBtn) deleteCatalogMaterial(delBtn.dataset.deleteMaterial);
        else if (priceBtn) startInlinePriceEdit(priceBtn);
    });
    //Chips de categoria
    document.getElementById('catalogCategoryChips')?.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-category]');
        if (!chip) return;
        document.getElementById('catalogCategoryFilter').value = chip.dataset.category;
        renderCatalogCategoryChips();
        renderCatalog();
    });
    //Delegação de ações nos cards de kit
    document.getElementById('catalogKitsList')?.addEventListener('change', (e) => {
        const select = e.target.closest('[data-cable-alca]');
        if (!select) return;
        materialCatalog.cableAlcas = { ...(materialCatalog.cableAlcas || {}), [select.dataset.cableAlca]: select.value };
        persistMaterialCatalog();
        refreshBomAfterProjectChange();
        renderCatalogKits();
        const reopened = document.querySelector('.cable-alca-kit details');
        if (reopened) reopened.open = true;
        showToast('Alça atualizada', `${resolveMaterialName(select.dataset.cableAlca)} → ${select.value}`);
    });
    document.getElementById('catalogKitsList')?.addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-edit-kit]');
        const delBtn = e.target.closest('[data-delete-kit]');
        if (editBtn) openKitForm(editBtn.dataset.editKit);
        else if (delBtn) deleteCatalogKit(delBtn.dataset.deleteKit);
    });

    //Formulário de material
    document.getElementById('closeMaterialFormModal')?.addEventListener('click', () => {
        document.getElementById('materialFormModal').style.display = 'none';
    });
    document.getElementById('cancelMaterialForm')?.addEventListener('click', () => {
        document.getElementById('materialFormModal').style.display = 'none';
    });
    document.getElementById('saveMaterialForm')?.addEventListener('click', saveMaterialFormHandler);

    //Formulário de kit
    document.getElementById('closeKitFormModal')?.addEventListener('click', () => {
        document.getElementById('kitFormModal').style.display = 'none';
    });
    document.getElementById('cancelKitForm')?.addEventListener('click', () => {
        document.getElementById('kitFormModal').style.display = 'none';
    });
    document.getElementById('kitAddComponentButton')?.addEventListener('click', () => addKitComponentRow());
    document.getElementById('saveKitForm')?.addEventListener('click', saveKitFormHandler);

    //Configurações de lançamento
    document.getElementById('saveLancamentoConfig')?.addEventListener('click', saveLancamentoConfigHandler);
    ['configPoleSpan', 'configPlaquetaPerPole', 'configBapPerPole', 'configSupaPerPole', 'configAlcaPerSupa'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateLancamentoPreview);
    });
    ['configLaborHourlyRate', 'configLaborHoursPerDay', 'configCablePerDay', 'configCtoPerDay', 'configCeoPerDay'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateLaborPreview);
    });

    //Importação de planilha de preços
    const importBtn = document.getElementById('catalogImportButton');
    const importFile = document.getElementById('catalogImportFile');
    importBtn?.addEventListener('click', () => importFile?.click());
    document.getElementById('catalogApiSyncButton')?.addEventListener('click', syncCatalogFromApi);
    importFile?.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        handleCatalogImportFile(file);
        e.target.value = ''; //Permite reimportar o mesmo arquivo
    });
    document.getElementById('closeMaterialImportModal')?.addEventListener('click', () => {
        document.getElementById('materialImportModal').style.display = 'none';
    });
    document.getElementById('cancelMaterialImport')?.addEventListener('click', () => {
        document.getElementById('materialImportModal').style.display = 'none';
    });
    document.getElementById('applyMaterialImport')?.addEventListener('click', applyMaterialImportHandler);
    //Recalcula status quando o mapeamento muda
    document.getElementById('importPreviewBody')?.addEventListener('change', (e) => {
        if (e.target.classList.contains('import-map-select')) {
            updateImportRow(Number(e.target.dataset.idx));
        } else if (e.target.classList.contains('import-row-check')) {
            updateImportSummary();
        }
    });
    document.getElementById('importToggleAll')?.addEventListener('change', (e) => {
        const checked = e.target.checked;
        document.querySelectorAll('#importPreviewBody .import-row-check').forEach(cb => {
            if (!cb.disabled) cb.checked = checked;
        });
        updateImportSummary();
    });
}

//Configuração do kit POP
const POP_KIT_CONFIG = {
    //Itens variáveis do Kit
    variable: [
        'PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)',
        'MÓDULO SFP C+ PARA PLACA OLT LINE ANYPON ZTE',
        'CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2M'
    ],
    //Itens fixos
    fixed: [
        { name: 'RACK INDOOR IPMETAL 44U 800X1000MM / PRETO / PORTA DIANTEIRA PERFURADO E TRASEIRA BI-PARTIDA PERFURADO / CALHA LATERAL', quantity: 1 },
        { name: 'RODIZIO RP50 PL50X67 - KIT 4 PEÇAS', quantity: 1 },
        { name: 'BANDEJA DE VENTILAÇÃO DE TETO PARA RACK IPMETAL 44U 1000MM', quantity: 1 },
        { name: 'GUIA DE CABO 1U EM ABS COR PRETA', quantity: 6 },
        { name: 'KIT PORCA GAIOLA + PARAFUSO', quantity: 100 },
        { name: 'RÉGUA DE TOMADA 2P+T 10A, CABO DE 2,5M COM BITOLA 1,5MM² / SEM FUSÍVEL E DISJUNTOR', quantity: 2 },
        { name: 'ROLO VELCRO DE 3 METROS PARA ORGANIZAR CABOS', quantity: 1 },
        { name: 'DGO 144 SC/APC COM PIGTAILS COR PRETA', quantity: 1 },
        { name: 'CAIXA DE EMENDA OPTICA FIBRACEM 216F JUMBO SVM COM REENTRADA DIAMETRO 13 A 18MM', quantity: 1 },
        { name: 'KIT DE DERIVAÇÃO SVM PARA CEO 144F GROMMET (2 ENTRADAS 7 A 13MM)', quantity: 5 },
        { name: 'CABO ÓPTICO AS 80 S 144 FIBRAS NR KP', quantity: 100 },
        { name: 'ALÇA PREFORMADA OPDE 1007 - 12,8MM A 14,2MM', quantity: 6 },
        { name: 'SUPORTE REX ARMAÇÃO SECUNDÁRIA 1X1 PRESBOW 4,8 MM', quantity: 4 },
        { name: 'ISOLADOR ROLDANA 72X72 PORCELANA', quantity: 4 },
        { name: 'BRAÇADEIRA BAP 3', quantity: 4 },
        { name: 'RESERVA OPTILOOP', quantity: 2 },
        { name: 'CABO DE AÇO CORDOALHA 3/16 POL', quantity: 50 },
        { name: 'ALÇA PREFORMADA PARA CORDOALHA 3/16 (4,8MM)', quantity: 2 },
        { name: 'CORDÃO ÓPTICO DUPLEX MULTIMODO LC/UPC > LC/UPC OM3 2M', quantity: 6 },
        { name: 'CORDÃO ÓPTICO DUPLEX MONOMODO LC/UPC > SC/APC 2M', quantity: 6 },
        { name: 'PATCHCORD CAT6 AZUL 1,5M', quantity: 2 },
        { name: 'PATCHCORD CAT6 AZUL 2,5M', quantity: 2 },
        { name: 'CHASSI OLT C650 ZTE', quantity: 1 },
        { name: 'LICENÇA OLT', quantity: 1 },
        { name: 'MÓDULO DE ENERGIA DC C650-C600 PARA OLT ZTE', quantity: 2 },
        { name: 'PLACA CONTROLADORA E SWITCHING C600/C650', quantity: 1 },
        { name: 'SWITCH MPLS 24 PORTAS', quantity: 1 },
        { name: 'SFP 1270NM TX/1330NM RX 20KM, 10G, BIDI', quantity: 1 },
        { name: 'SFP 1330NM TX/1270NM RX 20KM, 10G, BIDI', quantity: 1 },
        { name: 'SFP 850NM 10G 0,3KM MULTIMODO DUPLEX', quantity: 2 },
        { name: 'SFP GBIC ELÉTRICO', quantity: 2 },
        { name: 'FONTE RETIFICADORA 48VCC / 100A ~ 200A', quantity: 1 },
        { name: 'BATERIA DE LÍTIO 100A FB100B3 ZTE', quantity: 1 },
        { name: 'FONTE INVERSORA 48VCC/110VCA 600W', quantity: 1 },
        { name: 'VALOR ESTIMADO COM MATERIAIS ELÉTRICOS, DISJUNTORES, QDC, CABOS, ILUMINAÇÃO, ETC,.', quantity: 1 },
        { name: 'PRESTAÇÃO DE SERVIÇO ELETRICISTA', quantity: 1 },
        { name: 'AR CONDICIONADO SPLIT HI WALL LG DUAL INVERTER 12000 BTUS FRIO 220V', quantity: 1 },
        { name: 'PRESTAÇÃO DE SERVIÇO INSTALAÇÃO AR CONDICIONADO', quantity: 1 },
        { name: 'CAMERA DE MONITORAMENTO IP INTELBRAS VIP 1220 B G3', quantity: 1 },
        { name: 'MÉDIA DE ALUGUEL MENSAL', quantity: 1 }
    ]
};

const BOM_GROUP_SEPARATOR = '|||';

const BOM_GROUP_LABELS = {
    'CTO': 'CTO — Terminação Óptica',
    'CTO Predial': 'CTO Predial',
    'CEO': 'CEO — Caixa de Emenda',
    'Reserva': 'Reserva Técnica',
    'Cordoalha': 'Cordoalha',
    'Instalação Raquete': 'Instalação em Raquete',
    'Fusão CEO': 'Fusão — CEO',
    'Fusão CTO': 'Fusão — CTO',
    'Fusão Geral': 'Fusão — Geral',
    'Data Center': 'Data Center',
    'Adicionado manualmente': 'Adicionado Manualmente',
    'Outros': 'Outros'
};

const BOM_GROUP_ORDER = {
    Ferragem: ['CTO', 'CTO Predial', 'CEO', 'Reserva', 'Cordoalha', 'Instalação Raquete'],
    Fusão: ['Fusão CEO', 'Fusão CTO', 'Fusão Geral'],
    'Data Center': ['Data Center', 'Adicionado manualmente']
};

function makeBomKey(materialName, group) {
    return resolveMaterialName(materialName);
}

function resolveBomKey(key) {
    if (key && bomState[key]) return key;
    const parsed = parseBomKey(key || '');
    const byName = makeBomKey(parsed.materialName);
    if (bomState[byName]) return byName;
    return key;
}

function parseBomKey(bomKey) {
    const sepIndex = bomKey.indexOf(BOM_GROUP_SEPARATOR);
    if (sepIndex === -1) return { materialName: bomKey, group: null };
    return {
        materialName: bomKey.slice(0, sepIndex),
        group: bomKey.slice(sepIndex + BOM_GROUP_SEPARATOR.length)
    };
}

function getMaterialDisplayName(bomKey, material) {
    if (material?.materialName) return material.materialName;
    return parseBomKey(bomKey).materialName;
}

function getBomGroup(bomKey, material) {
    if (material?.bomGroup) return material.bomGroup;
    const parsed = parseBomKey(bomKey);
    if (parsed.group) return parsed.group;
    return inferBomGroup(getMaterialDisplayName(bomKey, material), material?.category);
}

function inferBomGroup(materialName, category) {
    if (category === 'Lançamento' || materialName.startsWith('Cabo ') || materialName.startsWith('CFOA ') || materialName.includes('CABO ÓPTICO')) {
        return materialName;
    }
    const ceoNames = [resolveMaterialName('CAIXA DE EMENDA ÓPTICA (CEO)'), resolveMaterialName('CAIXA DE EMENDA OPTICA (CEO) 144 FUSÕES')];
    if (ceoNames.includes(materialName) || materialName.includes('(CEO)') || materialName.includes('CEO') && category === 'Fusão') return 'CEO';
    if (materialName === resolveMaterialName('CAIXA DE ATENDIMENTO') || materialName === resolveMaterialName('CAIXA DE ATENDIMENTO PREDIAL')) return 'CTO';
    if (category === 'Data Center') return 'Data Center';
    if (category === 'Fusão') return 'Fusão Geral';
    return 'Outros';
}

function formatBomGroupLabel(group) {
    if (group.startsWith('Ferragens: ')) {
        return `Ferragens de Cabo — ${group.slice('Ferragens: '.length)}`;
    }
    return BOM_GROUP_LABELS[group] || group;
}

function sortBomGroups(groupA, groupB, category) {
    const fixedOrder = BOM_GROUP_ORDER[category] || [];
    const idxA = fixedOrder.indexOf(groupA);
    const idxB = fixedOrder.indexOf(groupB);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    if (groupA.startsWith('Ferragens: ') && groupB.startsWith('Ferragens: ')) {
        return groupA.localeCompare(groupB, 'pt-BR');
    }
    if (groupA.startsWith('Ferragens: ')) return 1;
    if (groupB.startsWith('Ferragens: ')) return -1;
    if (groupA === 'Outros') return 1;
    if (groupB === 'Outros') return -1;
    return groupA.localeCompare(groupB, 'pt-BR');
}

function mergeBomItems(target, source) {
    const targetQty = target.quantity || 0;
    const sourceQty = source.quantity || 0;
    const totalQty = targetQty + sourceQty;
    if (totalQty > 0) {
        const targetValue = targetQty * (target.unitPrice || 0);
        const sourceValue = sourceQty * (source.unitPrice || 0);
        target.unitPrice = (targetValue + sourceValue) / totalQty;
    }
    target.quantity = totalQty;
    target.removed = target.removed && source.removed;
    if (!target.type && source.type) target.type = source.type;
    if (!target.category && source.category) target.category = source.category;
    mergeBomUsage(target, source);
}

function makeUsageKey(group, detail) {
    return detail ? `${group}|||${detail}` : group;
}

function addUsageEntry(item, group, quantity, detail = null) {
    if (!item || !quantity) return;
    if (!item.usage) item.usage = {};
    const key = makeUsageKey(group, detail);
    const label = detail
        ? `${formatBomGroupLabel(group)} — ${detail}`
        : formatBomGroupLabel(group);
    if (!item.usage[key]) {
        item.usage[key] = { group, detail, label, quantity: 0 };
    }
    item.usage[key].quantity += quantity;
}

function mergeBomUsage(target, source) {
    if (!source?.usage) return;
    if (!target.usage) target.usage = {};
    for (const key in source.usage) {
        const entry = source.usage[key];
        if (!target.usage[key]) {
            target.usage[key] = { ...entry };
        } else {
            target.usage[key].quantity += entry.quantity || 0;
        }
    }
}

function getMaterialUsageList(material) {
    if (!material?.usage) return [];
    return Object.values(material.usage)
        .filter((entry) => entry.quantity > 0)
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

function formatMaterialQuantity(quantity, type) {
    const unit = type === 'length' ? 'm' : (type || 'un');
    const formatted = Number.isInteger(quantity)
        ? String(quantity)
        : parseFloat(quantity).toFixed(2);
    return `${formatted} ${unit}`;
}

function syncBomUsageFromCalculation() {
    if (!activeFolderId) return;
    const savedBom = JSON.parse(JSON.stringify(bomState));
    calculateBomState();
    const calculatedBom = bomState;
    bomState = savedBom;

    const calcByName = {};
    for (const key in calculatedBom) {
        const item = calculatedBom[key];
        const name = getMaterialDisplayName(key, item);
        calcByName[name] = item;
    }
    for (const key in bomState) {
        const item = bomState[key];
        if (item.removed) continue;
        const name = getMaterialDisplayName(key, item);
        if (calcByName[name]?.usage) {
            item.usage = JSON.parse(JSON.stringify(calcByName[name].usage));
        }
    }
}

function openMaterialUsageModal(bomKey) {
    const material = bomState[bomKey];
    if (!material || material.removed) return;

    if (!material.usage || Object.keys(material.usage).length === 0) {
        syncBomUsageFromCalculation();
    }

    const materialName = getMaterialDisplayName(bomKey, material);
    const usageList = getMaterialUsageList(bomState[bomKey]);
    const modal = document.getElementById('materialUsageModal');
    const titleEl = document.getElementById('materialUsageModalTitle');
    const bodyEl = document.getElementById('materialUsageModalBody');
    const totalEl = document.getElementById('materialUsageModalTotal');

    titleEl.textContent = materialName;
    bodyEl.innerHTML = '';

    if (usageList.length === 0) {
        bodyEl.innerHTML = '<p class="material-usage-empty">Nenhum detalhe de utilização disponível. Clique em <strong>Recalcular</strong> para atualizar a lista a partir do mapa.</p>';
    } else {
        const table = document.createElement('table');
        table.className = 'material-usage-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Local / Origem</th>
                    <th>Quantidade</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');
        usageList.forEach((entry) => {
            const row = document.createElement('tr');
            const labelCell = document.createElement('td');
            const qtyCell = document.createElement('td');
            labelCell.textContent = entry.label;
            qtyCell.className = 'material-usage-qty';
            qtyCell.textContent = formatMaterialQuantity(entry.quantity, material.type);
            row.appendChild(labelCell);
            row.appendChild(qtyCell);
            tbody.appendChild(row);
        });
        bodyEl.appendChild(table);
    }

    totalEl.textContent = `Total: ${formatMaterialQuantity(material.quantity, material.type)}`;
    modal.style.display = 'flex';
}

function normalizeBomState(state) {
    const normalized = {};
    for (const key in state || {}) {
        const item = { ...state[key] };
        const materialName = resolveMaterialName(item.materialName || parseBomKey(key).materialName);
        const consolidatedKey = makeBomKey(materialName);
        item.materialName = materialName;
        if (!item.bomGroup) item.bomGroup = getBomGroup(key, item);
        if (!normalized[consolidatedKey]) {
            normalized[consolidatedKey] = item;
        } else {
            mergeBomItems(normalized[consolidatedKey], item);
        }
    }
    return normalized;
}

function applyPersistedBomEdits(calculated, saved) {
    const normalizedSaved = normalizeBomState(saved);
    for (const key in normalizedSaved) {
        const savedItem = normalizedSaved[key];
        if (savedItem.removed) {
            if (calculated[key]) calculated[key].removed = true;
            continue;
        }
        if (savedItem.bomGroup === 'Adicionado manualmente') {
            calculated[key] = JSON.parse(JSON.stringify(savedItem));
            continue;
        }
        if (!calculated[key]) continue;
        if (savedItem.category === 'Lançamento') {
            if (calculated[key]) {
                if (savedItem.surchargePercent != null) {
                    calculated[key].surchargePercent = savedItem.surchargePercent;
                    if (!savedItem.manualQuantity && calculated[key].baseMeasurement != null) {
                        calculated[key].quantity = roundLengthUpToTen(
                            calculated[key].baseMeasurement * (1 + savedItem.surchargePercent / 100)
                        );
                    }
                }
                if (savedItem.manualQuantity && savedItem.quantity != null) {
                    calculated[key].quantity = roundLengthUpToTen(savedItem.quantity);
                    calculated[key].manualQuantity = true;
                }
                //Preço sempre vem do catálogo; só mantém o salvo se o item não existir no catálogo
                if (savedItem.unitPrice != null && savedItem.unitPrice !== calculated[key].unitPrice
                    && !MATERIAL_PRICES[calculated[key].materialName]) {
                    calculated[key].unitPrice = savedItem.unitPrice;
                }
            }
            continue;
        }
        if (savedItem.quantity !== calculated[key].quantity) {
            calculated[key].quantity = savedItem.quantity;
        }
        //Preço sempre do catálogo (fonte de verdade); preserva o salvo só p/ itens fora do catálogo
        //(um preço zerado salvo não apaga o valor informado no equipamento do cliente)
        if (savedItem.unitPrice !== calculated[key].unitPrice
            && !MATERIAL_PRICES[calculated[key].materialName]
            && (Number(savedItem.unitPrice) > 0 || !(calculated[key].unitPrice > 0))) {
            calculated[key].unitPrice = savedItem.unitPrice;
        }
    }
}

function createMaterialRow(bomKey, material) {
    const materialName = getMaterialDisplayName(bomKey, material);
    let displayName = materialName;
    if (material.category === 'Fusão') {
        displayName = materialName.toUpperCase();
    }
    const unit = material.type === 'length' ? 'm' : (material.type || 'un');
    const formattedQuantity = Number.isInteger(material.quantity)
        ? String(material.quantity)
        : parseFloat(material.quantity).toFixed(2);
    const formattedUnitPrice = `R$ ${material.unitPrice.toFixed(2).replace('.', ',')}`;
    const formattedTotalPrice = `R$ ${(material.quantity * material.unitPrice).toFixed(2).replace('.', ',')}`;
    const row = document.createElement('tr');
    row.dataset.bomKey = bomKey;
    row.dataset.bomGroup = getBomGroup(bomKey, material);
    row.innerHTML = `
      <td class="material-item-name material-item-clickable" data-bom-key="${bomKey.replace(/"/g, '&quot;')}" title="Ver onde está sendo utilizado">${displayName}</td>
      <td><span class="material-category-badge">${material.category}</span></td>
      <td class="material-qty">${formattedQuantity}</td>
      <td class="material-unit">${unit}</td>
      <td>
        <div class="material-actions">
          <button type="button" class="edit-qty-btn" data-bom-key="${bomKey.replace(/"/g, '&quot;')}" title="Editar quantidade" aria-label="Editar">${uiIcon('edit')}</button>
          <button type="button" class="remove-item-btn" data-bom-key="${bomKey.replace(/"/g, '&quot;')}" title="Remover item" aria-label="Remover">${uiIcon('x')}</button>
        </div>
      </td>
      <td class="material-price">${formattedUnitPrice}</td>
      <td class="material-price material-price-total">${formattedTotalPrice}</td>
    `;
    return row;
}

function appendGroupedMaterialRows(tbody, entries, category) {
    entries
        .sort((a, b) => getMaterialDisplayName(a.bomKey, a.material).localeCompare(getMaterialDisplayName(b.bomKey, b.material), 'pt-BR'))
        .forEach((entry) => tbody.appendChild(createMaterialRow(entry.bomKey, entry.material)));
}

function formatMaterialLengthValue(value) {
    return String(roundLengthUpToTen(value));
}

function renderCabosTable(tbody, projectId) {
    tbody.innerHTML = '';
    if (!projectId) return;

    const projectCables = getBillableProjectCables(projectId);
    syncProjectCableMeasurements(projectCables);
    const cableGroups = groupCablesByType(projectCables);

    Object.keys(cableGroups).sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach((cableType) => {
        const bomKey = makeBomKey(cableType);
        if (bomState[bomKey]?.removed) return;

        const cables = cableGroups[cableType];
        const baseSum = getCableTypeBaseLength(cables);
        const surcharge = getCableTypeSurcharge(cableType);
        const billableLength = getCableDisplayQuantity(cableType, cables);
        const unitPrice = getCableUnitPrice(cableType);
        const safeBomKey = bomKey.replace(/"/g, '&quot;');
        const safeType = cableType.replace(/"/g, '&quot;');
        const row = document.createElement('tr');
        row.className = 'cable-material-row';
        row.dataset.cableType = cableType;
        row.dataset.bomKey = bomKey;
        row.innerHTML = `
      <td class="material-item-name material-item-clickable cable-type-usage-trigger" data-cable-type="${safeType}" title="Ver trechos deste cabo">${escapeHtml(resolveMaterialName(cableType))}</td>
      <td><span class="material-category-badge">Lançamento</span></td>
      <td class="material-qty">${formatMaterialLengthValue(baseSum)}</td>
      <td class="material-surcharge-cell">
        <input type="number" class="cable-surcharge-input" min="0" step="0.1" value="${surcharge}" data-cable-type="${safeType}" aria-label="Acréscimo percentual" />
      </td>
      <td class="material-qty cable-final-qty">${formatMaterialLengthValue(billableLength)}</td>
      <td class="material-unit">m</td>
      <td>
        <div class="material-actions">
          <button type="button" class="edit-qty-btn" data-bom-key="${safeBomKey}" title="Editar item" aria-label="Editar">${uiIcon('edit')}</button>
          <button type="button" class="remove-item-btn" data-bom-key="${safeBomKey}" title="Remover item" aria-label="Remover">${uiIcon('x')}</button>
        </div>
      </td>
      <td class="material-price">R$ ${unitPrice.toFixed(2).replace('.', ',')}</td>
      <td class="material-price material-price-total">R$ ${(billableLength * unitPrice).toFixed(2).replace('.', ',')}</td>
    `;
        tbody.appendChild(row);
    });
}

function handleCableSurchargeChange(input) {
    const cableType = input.dataset.cableType;
    if (!cableType) return;
    const surcharge = Math.max(0, parseFloat(input.value) || 0);
    const projectId = getActiveProjectId();
    const bomKey = makeBomKey(cableType);
    if (bomState[bomKey]) {
        bomState[bomKey].surchargePercent = surcharge;
        delete bomState[bomKey].manualQuantity;
    }
    if (projectId) {
        if (!projectBoms[projectId]) projectBoms[projectId] = {};
        if (!projectBoms[projectId][bomKey]) {
            projectBoms[projectId][bomKey] = { category: 'Lançamento', materialName: resolveMaterialName(cableType) };
        }
        projectBoms[projectId][bomKey].surchargePercent = surcharge;
        delete projectBoms[projectId][bomKey].manualQuantity;
        if (bomState[bomKey]?.unitPrice != null) {
            projectBoms[projectId][bomKey].unitPrice = bomState[bomKey].unitPrice;
        }
    }
    calculateBomState();
    syncBomStateToActiveProject();
    renderBomTable();
}

function openCableTypeUsageModal(cableType) {
    const projectId = getActiveProjectId();
    if (!projectId) return;
    const cables = getBillableProjectCables(projectId).filter((c) => c.type === cableType);
    syncProjectCableMeasurements(cables);
    const baseSum = getCableTypeBaseLength(cables);
    const surcharge = getCableTypeSurcharge(cableType);
    const billableLength = getCableDisplayQuantity(cableType, cables);
    const modal = document.getElementById('materialUsageModal');
    const titleEl = document.getElementById('materialUsageModalTitle');
    const bodyEl = document.getElementById('materialUsageModalBody');
    const totalEl = document.getElementById('materialUsageModalTotal');

    titleEl.textContent = resolveMaterialName(cableType);
    bodyEl.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'material-usage-table';
    table.innerHTML = `
        <thead>
            <tr><th>Trecho</th><th>Medição</th></tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    cables.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR')).forEach((cable) => {
        const measurement = calculateCableMeasurement(cable);
        const row = document.createElement('tr');
        const labelCell = document.createElement('td');
        const qtyCell = document.createElement('td');
        labelCell.textContent = `${cable.name} (${measurement.lancamento} m + ${measurement.reserva} m)`;
        qtyCell.className = 'material-usage-qty';
        qtyCell.textContent = `${measurement.total} m`;
        row.appendChild(labelCell);
        row.appendChild(qtyCell);
        tbody.appendChild(row);
    });
    bodyEl.appendChild(table);

    if (surcharge > 0) {
        const extra = document.createElement('p');
        extra.className = 'material-usage-hint';
        extra.textContent = `Acréscimo de ${surcharge}% aplicado sobre o total de ${formatMaterialLengthValue(baseSum)} m.`;
        bodyEl.appendChild(extra);
    }

    totalEl.textContent = `Total faturado: ${formatMaterialLengthValue(billableLength)} m`;
    modal.style.display = 'flex';
}

//Renderização das tabelas de materiais
function renderBomTable() {
    const ferragemBody = document.getElementById('ferragem-list-body');
    const cabosBody = document.getElementById('cabos-list-body');
    const fusaoBody = document.getElementById('fusao-list-body');
    const datacenterBody = document.getElementById('datacenter-list-body');
    ferragemBody.innerHTML = '';
    cabosBody.innerHTML = '';
    fusaoBody.innerHTML = '';
    datacenterBody.innerHTML = '';

    const buckets = {
        Ferragem: [],
        'Lançamento': [],
        Fusão: [],
        'Data Center': []
    };

    for (const bomKey in bomState) {
        const material = bomState[bomKey];
        const bucketKey = getBomCostSection(material);
        if (!bucketKey) continue;
        buckets[bucketKey].push({ bomKey, material });
    }

    appendGroupedMaterialRows(ferragemBody, buckets.Ferragem, 'Ferragem');
    renderCabosTable(cabosBody, getActiveProjectId());
    appendGroupedMaterialRows(fusaoBody, buckets.Fusão, 'Fusão');
    appendGroupedMaterialRows(datacenterBody, buckets['Data Center'], 'Data Center');

    document.querySelectorAll('.edit-qty-btn').forEach((btn) => {
        btn.addEventListener('click', () => openMaterialEditor(btn.dataset.bomKey));
    });
    document.querySelectorAll('.remove-item-btn').forEach((btn) => btn.addEventListener('click', () => handleRemoveItem(btn)));
    document.querySelectorAll('.material-item-clickable:not(.cable-type-usage-trigger)').forEach((cell) => {
        cell.addEventListener('click', () => openMaterialUsageModal(cell.dataset.bomKey));
    });
    document.querySelectorAll('.cable-type-usage-trigger').forEach((cell) => {
        cell.addEventListener('click', () => openCableTypeUsageModal(cell.dataset.cableType));
    });
    document.querySelectorAll('.cable-surcharge-input').forEach((input) => {
        input.addEventListener('click', (event) => event.stopPropagation());
        input.addEventListener('change', () => handleCableSurchargeChange(input));
    });
    updateMaterialTableEmptyStates();
    recalculateGrandTotal();
}

function updateMaterialTableEmptyStates() {
    const tableConfigs = [
        { bodyId: 'ferragem-list-body', colspan: 7 },
        { bodyId: 'cabos-list-body', colspan: 9 },
        { bodyId: 'fusao-list-body', colspan: 7 },
        { bodyId: 'datacenter-list-body', colspan: 7 }
    ];
    tableConfigs.forEach(({ bodyId, colspan }) => {
        const tbody = document.getElementById(bodyId);
        if (!tbody) return;
        tbody.querySelectorAll('.material-empty-row').forEach((row) => row.remove());
        const dataRows = Array.from(tbody.children).filter((row) =>
            !row.classList.contains('material-empty-row') && !row.classList.contains('material-group-header')
        );
        if (dataRows.length === 0) {
            const tr = document.createElement('tr');
            tr.className = 'material-empty-row';
            tr.innerHTML = `<td colspan="${colspan}">Nenhum item nesta categoria</td>`;
            tbody.appendChild(tr);
        }
    });
}

//Exporta a lista para Excel
function exportTablesToExcel() {
    const projectTitle = document.getElementById('materialModalTitle').textContent.replace('Lista de Materiais: ', '').trim();
    const fileName = `Lista_de_Materiais_${projectTitle.replace(/[^a-z0-9]/gi, '_')}.xlsx`;
    const wb = XLSX.utils.book_new();
    const headers = ["Grupo", "Item", "Tipo", "Quantidade", "Unidade", "Preço Unitário (R$)", "Preço Total (R$)"];
    const tablesToExport = [
        { id: 'ferragem-table', name: 'Ferragens' },
        { id: 'cabos-table', name: 'Cabos' },
        { id: 'fusao-table', name: 'Fusao' },
        { id: 'datacenter-table', name: 'Data Center' }
    ];
    tablesToExport.forEach(tableInfo => {
        const table = document.getElementById(tableInfo.id);
        if (table) {
            let data;
            if (tableInfo.id === 'cabos-table') {
                data = [["Item", "Tipo", "Medição (m)", "Acr.%", "Qtd. (m)", "Un.", "Ações", "Preço Unitário (R$)", "Preço Total (R$)"]];
            } else {
                data = [headers];
            }

            const rows = table.querySelectorAll('tbody tr:not(.material-empty-row):not(.material-group-header)');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (tableInfo.id === 'cabos-table') {
                    const surchargeInput = row.querySelector('.cable-surcharge-input');
                    data.push([
                        cells[0].textContent,
                        cells[1].textContent,
                        cells[2].textContent,
                        surchargeInput ? surchargeInput.value : '',
                        cells[4].textContent,
                        cells[5].textContent,
                        '',
                        cells[7].textContent,
                        cells[8].textContent
                    ]);
                } else {
                    data.push([
                        row.dataset.bomGroup || '',
                        cells[0].textContent,
                        cells[1].textContent,
                        cells[2].textContent,
                        cells[3].textContent,
                        cells[5].textContent,
                        cells[6].textContent
                    ]);
                }
            });

            const footer = table.querySelector('tfoot tr');
            if (footer) {
                const footerCells = footer.querySelectorAll('td');
                const subtotalLabel = footerCells[0].textContent;
                const subtotalValue = footerCells[footerCells.length - 1].textContent;
                if (tableInfo.id === 'cabos-table') {
                    data.push(['', '', '', '', '', '', '', subtotalLabel, subtotalValue]);
                } else {
                    data.push(['', '', '', '', '', subtotalLabel, subtotalValue]);
                }
            }

            //Converte o array de dados para uma planilha
            const ws = XLSX.utils.aoa_to_sheet(data);
            
            //Adiciona a planilha (ws) à pasta de trabalho (wb) com o nome desejado
            XLSX.utils.book_append_sheet(wb, ws, tableInfo.name);
        }
    });

    // Gera o arquivo Excel e inicia o download
    XLSX.writeFile(wb, fileName);
}

//Calculo dos postes através dos cabos
function calculateHardwareForCable(cableLength, alcaPreformadaName) {
    const hardware = {};
    //Calcula total de postes a partir do vão configurável (padrão 35m)
    const totalPostes = Math.ceil(cableLength / getPoleSpanDistance());
    if (totalPostes <= 0) return hardware;
    //Quantidades por poste configuráveis (aba Configurações do cadastro de materiais)
    const qtdPlaqueta = totalPostes * (Number(lancamentoConfig.plaquetaPerPole) || 0);
    const qtdBap = totalPostes * (Number(lancamentoConfig.bapPerPole) || 0);
    const qtdSupa = totalPostes * (Number(lancamentoConfig.supaPerPole) || 0);
    const qtdAlcaPreformada = qtdSupa * (Number(lancamentoConfig.alcaPerSupa) || 0);
    if (qtdPlaqueta > 0) hardware["PLAQUETA DE IDENTIFICAÇÃO"] = qtdPlaqueta;
    if (qtdBap > 0) hardware["ABRAÇADEIRA BAP 3"] = qtdBap;
    if (qtdSupa > 0) hardware["SUPORTE ANCORAGEM PARA CABOS OPTICOS (SUPAS)"] = qtdSupa;
    // Adiciona a Alça Específica do Cabo
    if (alcaPreformadaName && qtdAlcaPreformada > 0) {
        hardware[alcaPreformadaName] = qtdAlcaPreformada;
    }
    return hardware;
}

const CABLE_HARDWARE_MAP = {
    "Cabo AS 80 FO-06": "ALÇA PREFORMADA OPDE 1008 - 6,8mm a 7,4mm",
    "Cabo AS 80 FO-12": "ALÇA PREFORMADA OPDE 1008 - 6,8mm a 7,4mm",
    "Cabo AS 80 FO-24": "ALÇA PREFORMADA OPDE 1020 - 9,0mm a 9,8mm",
    "Cabo AS 80 FO-36": "ALÇA PREFORMADA OPDE 1020 - 9,0mm a 9,8mm",
    "Cabo AS 80 FO-48": "ALÇA PREFORMADA OPDE 1020 - 9,0mm a 9,8mm",
    "Cabo AS 80 FO-72": "ALÇA PREFORMADA OPDE 1021 - 9,6mm a 10,4mm",
    "Cabo AS 80 FO-144": "ALÇA PREFORMADA OPDE 1007 - 12,8MM A 14,2MM",
    "CABO ÓPTICO AS 80 S 144 FIBRAS NR KP": "ALÇA PREFORMADA OPDE 1007 - 12,8MM A 14,2MM",
    "Cabo AS 200 FO-06": "ALÇA PREFORMADA OPDE 1008 - 6,8mm a 7,4mm",
    "Cabo AS 200 FO-12": "ALÇA PREFORMADA OPDE 1020 - 9,0mm a 9,8mm",
    "Cabo AS 200 FO-24": "ALÇA PREFORMADA OPDE 1021 - 9,6mm a 10,4mm",
    "Cabo AS 200 FO-36": "ALÇA PREFORMADA OPDE 1021 - 9,6mm a 10,4mm",
    "Cabo AS 200 FO-48": "ALÇA PREFORMADA OPDE 1021 - 9,6mm a 10,4mm",
    "Cabo AS 200 FO-72": "ALÇA PREFORMADA OPDE 1021 - 9,6mm a 10,4mm",
    "Cabo AS 200 FO-144": "ALÇA PREFORMADA OPDE 1007 - 12,8MM A 14,2MM"
};

function getAggregatedCableLengthsForFerragens(projectId) {
    const aggregated = {};
    if (!projectId) return aggregated;

    const projectCables = getBillableProjectCables(projectId);
    syncProjectCableMeasurements(projectCables);
    Object.entries(groupCablesByType(projectCables)).forEach(([cableType, cables]) => {
        const bomKey = makeBomKey(cableType);
        if (bomState[bomKey]?.removed) return;
        const length = getCableDisplayQuantity(cableType, cables);
        if (length > 0) {
            aggregated[cableType] = (aggregated[cableType] || 0) + length;
        }
    });
    return aggregated;
}

function applyCableFerragensToBom(projectId, addOrUpdateMaterialFn) {
    const aggregatedCableLengths = getAggregatedCableLengthsForFerragens(projectId);
    Object.keys(aggregatedCableLengths).forEach((cableName) => {
        const totalLength = aggregatedCableLengths[cableName];
        const alcaName = getCableAlca(cableName);
        if (totalLength <= 0 || !alcaName) return;
        const hardwareItems = calculateHardwareForCable(totalLength, alcaName);
        const hardwareGroup = `Ferragens: ${resolveMaterialName(cableName)}`;
        for (const itemName in hardwareItems) {
            addOrUpdateMaterialFn(itemName, hardwareItems[itemName], 'unit', hardwareGroup);
        }
    });
}

const MARKER_TYPES_WITH_INFRA_STATUS = ['CTO', 'CEO', 'RESERVA', 'CORDOALHA', 'Importado'];

function getMarkerInfrastructureStatus(markerInfo) {
    if (!markerInfo) return null;
    switch (markerInfo.type) {
    case 'CTO': return markerInfo.ctoStatus;
    case 'CEO': return markerInfo.ceoStatus;
    case 'RESERVA': return markerInfo.reservaStatus;
    case 'CORDOALHA': return markerInfo.cordoalhaStatus;
    case 'Importado': return markerInfo.pendingImportStatus || 'Nova';
    default: return null;
    }
}

function isMarkerStatusExistente(markerInfo) {
    return getMarkerInfrastructureStatus(markerInfo) === 'Existente';
}

function shouldDefaultCtoStickers(ctoStatus) {
    return ctoStatus === 'Nova' || ctoStatus === 'Troca';
}

function getStatusPillModifier(statusValue) {
    const normalized = String(statusValue || '').toLowerCase();
    if (normalized === 'existente') return 'status-pill--existente';
    if (normalized === 'troca') return 'status-pill--troca';
    return 'status-pill--nova';
}

function formatInfrastructureStatusLabel(statusValue) {
    const normalized = String(statusValue || 'Nova');
    if (normalized === 'Nova' || normalized === 'Novo') return 'Novo';
    return normalized;
}

function setStatusPill(element, prefix, statusValue) {
    if (!element) return;
    element.textContent = `${prefix}: ${formatInfrastructureStatusLabel(statusValue)}`;
    element.className = `status-pill ${getStatusPillModifier(statusValue)}`;
}



function applyMarkerInfrastructureStatus(markerInfo, statusValue) {
    if (!markerInfo || !statusValue) return;
    if (markerInfo.type === 'Importado') {
        markerInfo.pendingImportStatus = statusValue;
        return;
    }
    switch (markerInfo.type) {
    case 'CTO':
        markerInfo.ctoStatus = statusValue;
        if (shouldDefaultCtoStickers(statusValue)) {
            markerInfo.needsStickers = true;
        }
        break;
    case 'CEO': markerInfo.ceoStatus = statusValue; break;
    case 'RESERVA': markerInfo.reservaStatus = statusValue; break;
    case 'CORDOALHA': markerInfo.cordoalhaStatus = statusValue; break;
    default: return;
    }
}

function setMarkerInfrastructureStatus(markerInfo, statusValue) {
    applyMarkerInfrastructureStatus(markerInfo, statusValue);
    updateMarkerAppearance(markerInfo);
    refreshBomAfterProjectChange();
}




function updateCableSidebarLabel(cable) {
    if (!cable?.item) return;
    const statusLabel = cable.status || 'Novo';
    const length = `${Number(cable.totalLength || 0).toLocaleString('pt-BR')} m`;
    const kind = (cable.isImported || cable.type === 'Cabo Importado')
        ? 'Importado'
        : String(cable.type || '').replace(/^Cabo\s+/i, '');
    setSidebarItemLabel(cable.item, cable.name, [kind, statusLabel, length].filter(Boolean).join(' · '));
    applyCableSidebarColorStyles(cable);
}

function setCableInfrastructureStatus(cable, status) {
    if (!cable) return;
    cable.status = status;
    updateCableSidebarLabel(cable);
    refreshBomAfterProjectChange();
}

function refreshBomAfterProjectChange() {
    if (!activeFolderId) return;
    const projectRootElement = document.getElementById(activeFolderId)?.closest('.folder');
    if (!projectRootElement) return;
    const projectId = projectRootElement.querySelector('.folder-title')?.dataset.folderId;
    if (!projectId) return;
    calculateBomState();
    projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
    const materialModal = document.getElementById('materialModal');
    if (materialModal && materialModal.style.display === 'flex') {
        renderBomTable();
    }
}

//Cáculo geral da lista de material
function calculateBomState() {
    //Validação e preservação
    if (!activeFolderId) {
        console.error("calculateBomState foi chamada sem um projeto ativo.");
        bomState = {};
        return;
    }
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) {
        bomState = {};
        return;
    }
    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    //Preserva itens do data center
    const preservedDatacenterItems = {};
    const preservedCableSurcharges = {};
    const currentProjectBom = normalizeBomState(JSON.parse(JSON.stringify(projectBoms[projectId] || {})));
    for (const materialName in currentProjectBom) {
        if (currentProjectBom[materialName].category === 'Data Center') {
            //Guarda só a parte manual/kits; os equipamentos dos clientes são recalculados abaixo
            const item = currentProjectBom[materialName];
            const manualQty = (Number(item.quantity) || 0) - (Number(item.clientQuantity) || 0);
            if (manualQty > 0) preservedDatacenterItems[materialName] = { ...item, quantity: manualQty, clientQuantity: 0 };
        }
        if (currentProjectBom[materialName].category === 'Lançamento' && currentProjectBom[materialName].surchargePercent != null) {
            preservedCableSurcharges[materialName] = currentProjectBom[materialName].surchargePercent;
        }
    }
    bomState = {};
    const folderIdsToInclude = getAllDescendantFolderIds(projectId);
    const projectMarkers = markers.filter(m => folderIdsToInclude.includes(m.folderId));
    const projectCables = savedCables.filter(c => folderIdsToInclude.includes(c.folderId));
    syncProjectCableMeasurements(projectCables);
    //variáveis auxiliares
    let ctoCount = 0;
    let raqueteInstallCount = 0;
    const addOrUpdateMaterial = (name, quantity, type = 'unit', group = 'Outros', detail = null, unitPrice = undefined) => {
        if (!name || quantity <= 0) return;
        name = resolveMaterialName(name);
        if (isDroppedMaterial(name)) return;
        const priceInfo = MATERIAL_PRICES[name] || { price: 0, category: 'Outros' };
        const bomKey = makeBomKey(name, group);
        if (!bomState[bomKey]) {
            bomState[bomKey] = {
                materialName: name,
                bomGroup: group,
                quantity: 0,
                type: priceInfo.unit === 'm' || type === 'length' ? (priceInfo.unit || 'm') : (priceInfo.unit || type),
                unitPrice: priceInfo.price,
                category: priceInfo.category,
                removed: false,
                usage: {}
            };
        }
        //Preço informado fora do catálogo (ex.: equipamento digitado no cliente)
        if (unitPrice > 0 && !(bomState[bomKey].unitPrice > 0)) bomState[bomKey].unitPrice = unitPrice;
        bomState[bomKey].quantity += quantity;
        addUsageEntry(bomState[bomKey], group, quantity, detail);
    };
    //Processamento de marcadores
    projectMarkers.forEach(markerInfo => {
        if (markerInfo.type === 'Importado') return;
        const type = markerInfo.type;
        if (type === 'CLIENTE') return; //Tratado em addClientMaterialsToBom
        if (type === 'CASA' || type === 'POP' || isMarkerStatusExistente(markerInfo)) return;
        if (type === 'CTO') {
            if (markerInfo.isPredial) {
                addOrUpdateMaterial("CAIXA DE ATENDIMENTO PREDIAL", 1, 'unit', 'CTO Predial', markerInfo.name);
                addOrUpdateMaterial("ABRAÇADEIRA DE NYLON", 4, 'unit', 'CTO Predial', markerInfo.name);
            } else {
                ctoCount++;
                const priceInfo = MATERIAL_PRICES['CTO'];
                if (priceInfo && priceInfo.components) {
                    priceInfo.components.forEach(c => addOrUpdateMaterial(c.name, c.quantity, 'unit', 'CTO', markerInfo.name));
                }
            }
            return; 
        }
        //Lógica CEO
        if (type === 'CEO') {
            if (markerInfo.is144F) {
                addOrUpdateMaterial("CAIXA DE EMENDA OPTICA (CEO) 144 FUSÕES", 1, 'unit', 'CEO', markerInfo.name);
            } else {
                addOrUpdateMaterial("CAIXA DE EMENDA ÓPTICA (CEO)", 1, 'unit', 'CEO', markerInfo.name);
            }
            if (markerInfo.ceoAccessory === "Raquete") {
                raqueteInstallCount++;
                getKitComponents("KIT CEO RAQUETE").forEach(c => addOrUpdateMaterial(c.name, c.quantity, 'unit', 'CEO', markerInfo.name));
            } else if (markerInfo.ceoAccessory === "Suporte") {
                getKitComponents("KIT CEO SUPORTE").forEach(c => addOrUpdateMaterial(c.name, c.quantity, 'unit', 'CEO', markerInfo.name));
            }
            return; 
        }
        //Lógica reserva
        if (type === 'RESERVA') {
            if (markerInfo.reservaAccessory === "Raquete") {
                raqueteInstallCount++;
                getKitComponents("KIT CEO RAQUETE").forEach(c => addOrUpdateMaterial(c.name, c.quantity, 'unit', 'Reserva', markerInfo.name));
            } else if (markerInfo.reservaAccessory === "Suporte") {
                getKitComponents("KIT CEO SUPORTE").forEach(c => addOrUpdateMaterial(c.name, c.quantity, 'unit', 'Reserva', markerInfo.name));
            }
            return;
        }
        //Lógica cordoalha
        if (type === 'CORDOALHA') {
            getKitComponents("KIT CORDOALHA").forEach(c => addOrUpdateMaterial(c.name, c.quantity, 'unit', 'Cordoalha', markerInfo.name));
            if (markerInfo.derivationTCount && markerInfo.derivationTCount > 0) {
                addOrUpdateMaterial("DERIVAÇÃO EM T", markerInfo.derivationTCount, 'unit', 'Cordoalha', markerInfo.name);
            }
            return;
        }
        const priceInfo = MATERIAL_PRICES[type];
        if (priceInfo && priceInfo.components) {
        priceInfo.components.forEach(c => addOrUpdateMaterial(c.name, c.quantity, 'unit', type, markerInfo.name));
        } else if (type) {
        addOrUpdateMaterial(type, 1, 'unit', 'Outros', markerInfo.name);
        }
    });
    //Cálculos de ferragens
    if (raqueteInstallCount > 0) {
        const totalArameNeeded = raqueteInstallCount * 50;
        const arameRolls = Math.ceil(totalArameNeeded / 105);
        addOrUpdateMaterial("ARAME DE ESPIMAR (105 m)", arameRolls, 'unit', 'Instalação Raquete', `${raqueteInstallCount} instalação(ões)`);
    }

    if (ctoCount > 0) {
        const fitaName = "FITA DE AÇO INOX 3/4'' (FITA FUSIMEC) ROLO DE 25M";
        addOrUpdateMaterial(fitaName, Math.ceil((3 * ctoCount) / 25), 'unit', 'CTO', `${ctoCount} CTO(s)`);
    }
    //Drops e kits de instalação dos clientes
    addClientMaterialsToBom(projectMarkers, addOrUpdateMaterial);
    //Plano de fusão
    projectMarkers.forEach(markerInfo => {
        if ((markerInfo.type === 'CTO' || markerInfo.type === 'CEO') && markerInfo.fusionPlan) {
            const fusionGroup = `Fusão ${markerInfo.type}`;
            try {
                const planData = JSON.parse(markerInfo.fusionPlan);
                if (planData.elements) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = planData.elements;
                    const splittersInPlan = tempDiv.querySelectorAll('.splitter-element');
                    splittersInPlan.forEach(splitterEl => {
                        if (splitterEl.dataset.status === 'Novo') {
                            const label = getSplitterLabelText(splitterEl);
                            if (label) {
                                const splitterMaterialName = `Splitter ${label.replace(':', '/')}`;
                                addOrUpdateMaterial(splitterMaterialName, 1, 'unit', fusionGroup, markerInfo.name);
                                if (splitterEl.classList.contains('splitter-atendimento')) {
                                    const isPredial = markerInfo.isPredial || false;
                                    const connector = label.includes('APC') ? 'APC' : 'UPC';
                                    const ratioMatch = label.match(/1:(\d+)/);
                                    const outputCount = ratioMatch ? parseInt(ratioMatch[1], 10) : 0;

                                    if (outputCount > 0) {
                                        let adapterMaterialName = isPredial
                                            ? `ADAPTADOR SC/${connector} SEM ABAS (PASSANTE)`
                                            : `ADAPTADOR SC/${connector} COM ABAS (PASSANTE)`;
                                        addOrUpdateMaterial(adapterMaterialName, outputCount, 'unit', fusionGroup, markerInfo.name);
                                    }
                                }
                            }
                        }
                    });
                    if (markerInfo.type === 'CEO') {
                        tempDiv.querySelectorAll('.cable-element').forEach(cableEl => {
                            const checkbox = cableEl.querySelector('.derivation-kit-checkbox');
                            if (checkbox && (checkbox.dataset.checked === 'true' || checkbox.checked)) {
                                addOrUpdateMaterial("KIT DERIVAÇÃO PARA CAIXA DE EMENDA OPTICA", 1, 'unit', fusionGroup, markerInfo.name);
                            }
                        });
                    }
                }
                if (markerInfo.type === 'CEO' && planData.trayQuantity) {
                    const trayQuantity = parseInt(planData.trayQuantity, 10);
                    if (trayQuantity > 0) {
                        addOrUpdateMaterial("KIT DE BANDEJA PARA CAIXA DE EMENDA", trayQuantity, 'unit', fusionGroup, markerInfo.name);
                    }
                }
                if (planData.svg) {
                    const svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svgContainer.innerHTML = planData.svg;
                    const fusionLinesCount = svgContainer.querySelectorAll('.fusion-line').length;
                    if (fusionLinesCount > 0) {
                        addOrUpdateMaterial("TUBETE PROTETOR DE EMENDA OPTICA", fusionLinesCount, 'unit', fusionGroup, markerInfo.name);
                    }
                }
            } catch (e) {
                console.error(`Erro ao analisar o plano de fusão para o marcador "${markerInfo.name}":`, e);
            }
        }
    });
    //Processamento de cabos (agrupados por tipo)
    const activeBillableCables = projectCables.filter(
        (cable) => cable.status !== 'Existente' && cable.type !== 'Cabo Importado'
    );
    const cableGroups = groupCablesByType(activeBillableCables);
    Object.keys(cableGroups).sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach((cableType) => {
        const cables = cableGroups[cableType];
        const baseSum = getCableTypeBaseLength(cables);
        const surcharge = Math.max(0, parseFloat(preservedCableSurcharges[resolveMaterialName(cableType)] ?? preservedCableSurcharges[cableType]) || 0);
        const billableLength = getCableTypeBillableLength(cables, surcharge);
        const priceInfo = MATERIAL_PRICES[cableType] || { price: 0, category: 'Lançamento' };
        const bomKey = makeBomKey(cableType);
        const savedCableItem = currentProjectBom[cableType] || currentProjectBom[bomKey];
        const manualQuantity = !!savedCableItem?.manualQuantity;
        bomState[bomKey] = {
            materialName: resolveMaterialName(cableType),
            bomGroup: 'Lançamento',
            quantity: manualQuantity
                ? roundLengthUpToTen(savedCableItem.quantity)
                : billableLength,
            baseMeasurement: baseSum,
            surchargePercent: surcharge,
            manualQuantity,
            type: 'm',
            unitPrice: savedCableItem?.unitPrice ?? priceInfo.price,
            category: 'Lançamento',
            removed: !!savedCableItem?.removed,
            usage: {}
        };
        cables.forEach((cable) => {
            addUsageEntry(bomState[bomKey], 'Lançamento', getCableBaseLength(cable), cable.name || cable.type);
        });
    });
    const tapeName = "FITA ISOLANTE";
    const hasFusionConsumables = Object.entries(bomState).some(([key, item]) => {
        const name = getMaterialDisplayName(key, item);
        return name === resolveMaterialName("TUBETE PROTETOR DE EMENDA OPTICA") || name === resolveMaterialName("KIT DERIVAÇÃO PARA CAIXA DE EMENDA OPTICA");
    });
    if (hasFusionConsumables && !bomState[tapeName]) {
        addOrUpdateMaterial(tapeName, 1, 'unit', 'Fusão Geral');
    }
    //Ferragens dos cabos (baseadas na Qtd. faturada de cada cabo)
    applyCableFerragensToBom(projectId, addOrUpdateMaterial);
    for (const materialName in preservedDatacenterItems) {
        const preserved = preservedDatacenterItems[materialName];
        const preservedKey = makeBomKey(materialName);
        if (bomState[preservedKey]) {
            //Mesmo item nos kits/manual e nos equipamentos dos clientes: soma as quantidades
            bomState[preservedKey].quantity += preserved.quantity || 0;
            addUsageEntry(bomState[preservedKey], 'Data Center', preserved.quantity || 0, 'Data Center');
        } else {
            bomState[preservedKey] = {
                ...preserved,
                materialName,
                bomGroup: preserved.bomGroup || 'Data Center'
            };
            if (!bomState[preservedKey].usage) {
                bomState[preservedKey].usage = {};
            }
            addUsageEntry(
                bomState[preservedKey],
                preserved.bomGroup || 'Data Center',
                preserved.quantity || 0,
                'Data Center'
            );
        }
    }
    bomState = normalizeBomState(bomState);
}

//Remoção lógica de item
function handleRemoveItem(button) {
    const bomKey = resolveBomKey(button.dataset.bomKey);
    const materialName = getMaterialDisplayName(bomKey, bomState[bomKey]);
    showConfirm('Remover Item', `Tem certeza que deseja remover "${materialName}" da lista?`, () => {
        bomState[bomKey].removed = true;
        renderBomTable();
    });
}

//Adição manual de novo material
function handleAddNewMaterial() {
    const name = document.getElementById('materialNameInput').value.trim();
    const quantity = parseFloat(document.getElementById('materialQtyInput').value);
    const category = document.getElementById('materialCategoryInput').value;
    const unitPrice = parseFloat(document.getElementById('materialPriceInput').value);
    if (!name || isNaN(quantity) || isNaN(unitPrice)) {
        showAlert("Erro", "Por favor, preencha todos os campos corretamente.");
        return;
    }
    const bomKey = makeBomKey(name);
    if (bomState[bomKey]) {
        mergeBomItems(bomState[bomKey], {
            quantity,
            unitPrice,
            removed: false
        });
        bomState[bomKey].category = category;
        addUsageEntry(bomState[bomKey], 'Adicionado manualmente', quantity, null);
    } else {
        bomState[bomKey] = {
            materialName: name,
            bomGroup: 'Adicionado manualmente',
            quantity,
            type: 'un',
            unitPrice,
            category,
            removed: false,
            usage: {}
        };
        addUsageEntry(bomState[bomKey], 'Adicionado manualmente', quantity, null);
    }
    renderBomTable();
    document.getElementById('addMaterialModal').style.display = 'none';
}

function syncBomStateToActiveProject() {
    if (!activeFolderId) return;
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) return;
    const projectId = projectRootElement.querySelector('.folder-title')?.dataset.folderId;
    if (!projectId) return;
    projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
}

//Abertura do editor dos materiais
function openMaterialEditor(bomKey) {
    const resolvedKey = resolveBomKey(bomKey);
    const materialData = bomState[resolvedKey];
    if (!materialData) {
        showAlert('Erro', 'Não foi possível encontrar o material para edição.');
        return;
    }
    document.getElementById('originalMaterialName').value = resolvedKey;
    document.getElementById('editMaterialName').value = getMaterialDisplayName(resolvedKey, materialData);
    if (materialData.category === 'Lançamento') {
        const projectId = getActiveProjectId();
        const cableType = getMaterialDisplayName(resolvedKey, materialData);
        const cables = projectId
            ? (groupCablesByType(getBillableProjectCables(projectId))[cableType] || [])
            : [];
        document.getElementById('editMaterialQty').value = getCableDisplayQuantity(cableType, cables);
    } else {
        document.getElementById('editMaterialQty').value = materialData.quantity;
    }
    document.getElementById('editMaterialUnit').value = materialData.type;
    document.getElementById('editMaterialPrice').value = materialData.unitPrice;
    document.getElementById('editMaterialModal').style.display = 'flex';
}

//Processamento da edição e atualização
function handleUpdateMaterial() {
    const originalKey = document.getElementById('originalMaterialName').value;
    const newName = document.getElementById('editMaterialName').value.trim();
    const newQty = parseFloat(document.getElementById('editMaterialQty').value);
    const newUnit = document.getElementById('editMaterialUnit').value.trim();
    const newPrice = parseFloat(document.getElementById('editMaterialPrice').value);
    if (!newName) {
        showAlert('Erro', 'O nome do material não pode ser vazio.');
        return;
    }
    if (isNaN(newQty) || newQty < 0 || isNaN(newPrice) || newPrice < 0) {
        showAlert('Erro', 'Quantidade e Preço devem ser números válidos e não-negativos.');
        return;
    }
    const resolvedOriginalKey = resolveBomKey(originalKey);
    const originalMaterial = bomState[resolvedOriginalKey];
    if (!originalMaterial) {
        showAlert('Erro', 'Material original não encontrado.');
        return;
    }
    const originalCategory = originalMaterial.category || 'Outros';
    const bomGroup = originalMaterial.bomGroup || getBomGroup(resolvedOriginalKey, originalMaterial);
    const newKey = makeBomKey(newName, bomGroup);
    if (newKey !== resolvedOriginalKey && bomState[newKey]) {
        showAlert('Erro', 'Já existe um material com este nome. Por favor, escolha outro nome.');
        return;
    }
    if (newKey !== resolvedOriginalKey) {
        delete bomState[resolvedOriginalKey];
    }
    const isCableItem = originalCategory === 'Lançamento';
    bomState[newKey] = {
        ...originalMaterial,
        materialName: newName,
        bomGroup,
        unitPrice: newPrice,
        category: originalCategory,
        removed: false,
        quantity: isCableItem ? roundLengthUpToTen(newQty) : newQty,
        type: isCableItem ? (originalMaterial.type || 'm') : newUnit,
        manualQuantity: isCableItem ? true : undefined
    };
    if (!isCableItem) {
        delete bomState[newKey].manualQuantity;
    }
    syncBomStateToActiveProject();
    if (isCableItem) {
        calculateBomState();
        syncBomStateToActiveProject();
    }
    document.getElementById('editMaterialModal').style.display = 'none';
    renderBomTable();
}

//Levantamento de Quantitativos do Projeto
function getProjectQuantities() {
    //Verifica se há um projeto ativo. Sem isso, a função pegava todos os cabos.
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione um projeto para calcular a mão de obra.");
        return { cableLength: 0, cordoalhaLength: 0, cordoalhaCount: 0, ctoCount: 0, ceoCount: 0, reservaCount: 0 };
    }
    //Encontra o ID do projeto raiz a partir do item ativo na barra lateral.
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) {
        console.error("Não foi possível encontrar o projeto raiz para o cálculo da mão de obra.");
        return { cableLength: 0, cordoalhaLength: 0, cordoalhaCount: 0, ctoCount: 0, ceoCount: 0, reservaCount: 0 };
    }
    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    //Pega APENAS os marcadores e cabos que pertencem ao projeto ativo.
    const { markers: projectMarkers, cables: projectCables } = getProjectItems(projectId);
    let totalLength = 0;
    let cordoalhaLength = 0;
    let cordoalhaCount = 0;
    let ctoCount = 0;
    let ceoCount = 0;
    let reservaCount = 0;
    //Itera sobre a lista FILTRADA de cabos e usa o comprimento total correto.
    syncProjectCableMeasurements(projectCables);
    const cableGroups = groupCablesByType(
        projectCables.filter((c) => c.status !== 'Existente' && c.type !== 'Cabo Importado')
    );
    Object.entries(cableGroups).forEach(([cableType, cables]) => {
        const surcharge = Math.max(0, parseFloat(projectBoms[projectId]?.[cableType]?.surchargePercent) || 0);
        totalLength += getCableTypeBillableLength(cables, surcharge);
    });
    projectCables.forEach((cable) => {
        if (cable.status !== 'Existente' && cable.type === 'Cabo Importado') {
            totalLength += getCableBaseLength(cable);
        }
    });
    //Itera sobre a lista FILTRADA de marcadores.
    projectMarkers.forEach(marker => {
        if (marker.type === 'CTO' && marker.ctoStatus !== 'Existente') ctoCount++;
        if (marker.type === 'CEO' && marker.ceoStatus !== 'Existente') ceoCount++;
        if (marker.type === 'RESERVA' && marker.reservaStatus !== 'Existente') reservaCount++;
        if (marker.type === 'CORDOALHA' && marker.cordoalhaStatus !== 'Existente') {
            cordoalhaCount++;
            cordoalhaLength += 50;
        }
    });
    return {
        cableLength: Math.round(totalLength),
        cordoalhaLength: Math.round(cordoalhaLength),
        cordoalhaCount,
        ctoCount,
        ceoCount,
        reservaCount
    };
}

//Gerenciamento de mão de obra
function openLaborModal() {
    //Identificar o projeto ativo ANTES de ler o bomState
    if (!activeFolderId) {
        showAlert("Atenção", "Por favor, selecione um projeto na barra lateral para ver a mão de obra.");
        return;
    }
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) {
        showAlert("Erro", "Item selecionado não pertence a um projeto. Selecione o projeto ou um item dentro dele.");
        return;
    }
    //Carregamento do estado BOM
    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    const projectName = projectRootElement.querySelector('.folder-title').dataset.folderName;
    if (projectBoms[projectId]) {
        bomState = normalizeBomState(JSON.parse(JSON.stringify(projectBoms[projectId])));
    } else {
        calculateBomState();
        projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
    }
    //Renderização da tabela
    const tableBody = document.getElementById('labor-items-body');
    tableBody.innerHTML = '';
    let totalLaborCost = 0;
    //Flags pra controlar exibição dos bot~eos de adicionar
    let hasRegional = false;
    let hasOutsourced = false;
    for (const name in bomState) {
        const item = bomState[name];
        if (item.category === 'Mão de Obra' && !item.removed) {
            const itemTotal = item.details ? item.details.totalCost : item.unitPrice;
            totalLaborCost += itemTotal;
            const row = tableBody.insertRow();
            let type = '';
            let detailsHtml = '';
            let actionsHtml = `
                <button data-name="${name}" class="edit-labor-btn" style="background-color: #ffc107; color: #333; border: none; cursor: pointer; border-radius: 4px; padding: 4px 10px; margin-right: 5px;">Editar</button>
                <button data-name="${name}" class="remove-labor-btn" style="background-color: #f44336; color: white; border: none; cursor: pointer; border-radius: 4px; padding: 4px 10px;">Remover</button>
            `;
            //Lógica mão de obra regional com detalhe nas despesas
            if (name === 'Mão de Obra Regional') {
                type = 'Regional';
                hasRegional = true;
                const details = item.details || {};
                const totalFuel = (details.fuelQty || 0) * (details.fuelPrice || 0);
                const totalFood = (details.foodQty || 0) * (details.foodPrice || 0);
                const totalLodging = (details.lodgingQty || 0) * (details.lodgingPrice || 0);
                const totalToll = (details.tollQty || 0) * (details.tollPrice || 0);
                const expenses = totalFuel + totalFood + totalLodging + totalToll;
                const informedDays = getRegionalLaborInformedDays(details);
                const daysDisplay = informedDays !== null ? informedDays : (details.days ?? 'N/A');
                detailsHtml = `
                    <ul class="details-list">
                        <li><strong>Técnicos:</strong> ${details.techs || 'N/A'}</li>
                        <li><strong>Dias Informados:</strong> ${daysDisplay}</li>
                        <li><strong>Despesas Adic.:</strong> R$ ${expenses.toFixed(2).replace('.', ',')}</li>
                    </ul>`;
            }
            //Lógica mão de obra terceirizada
            else if (name.startsWith('Mão de Obra - ')) {
                type = 'Terceirizada';
                hasOutsourced = true;
                const details = item.details || {};
                const companyName = details.companyName || name.replace('Mão de Obra - ', '');
                detailsHtml = companyName;
                actionsHtml = `<button data-name="${name}" class="view-labor-details-btn" style="background-color: #17a2b8; color: white; border: none; cursor: pointer; border-radius: 4px; padding: 4px 10px; margin-right: 5px;">Ver Detalhes</button>` + actionsHtml;
            }
            //Preenchimento da linha da tabela
            row.innerHTML = `
                <td>${type}</td>
                <td>${detailsHtml}</td>
                <td>R$ ${itemTotal.toFixed(2).replace('.', ',')}</td>
                <td style="text-align: center;">${actionsHtml}</td>
            `;
        }
    }
    //Atualização de interface e listeneres
    document.getElementById('labor-grand-total-price').textContent = `R$ ${totalLaborCost.toFixed(2).replace('.', ',')}`;
    //Altera visibilidade dos botões de adição
    const regionalBtnElement = document.getElementById('addNewRegionalLaborButton');
    const outsourcedBtnElement = document.getElementById('addNewOutsourcedLaborButton');
    regionalBtnElement.style.display = hasRegional ? 'none' : 'inline-block';
    outsourcedBtnElement.style.display = hasOutsourced ? 'none' : 'inline-block';
    //Clona botões para remover listeners antigos e evitar acumulação de eventos
    const newRegionalBtn = regionalBtnElement.cloneNode(true);
    regionalBtnElement.parentNode.replaceChild(newRegionalBtn, regionalBtnElement);
    newRegionalBtn.addEventListener('click', () => openRegionalLaborModal()); 
    const newOutsourcedBtn = outsourcedBtnElement.cloneNode(true);
    outsourcedBtnElement.parentNode.replaceChild(newOutsourcedBtn, outsourcedBtnElement);
    newOutsourcedBtn.addEventListener('click', () => openOutsourcedLaborModal());
    //Listener de Remoção
    document.querySelectorAll('.remove-labor-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const itemName = e.target.dataset.name;
            showConfirm('Remover Mão de Obra', `Tem certeza que deseja remover "${itemName}"?`, () => {
                delete bomState[itemName]; 
                if (activeFolderId) {
                const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
                if (projectRootElement) {
                    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
                    if (projectBoms[projectId] && projectBoms[projectId][itemName]) {
                        delete projectBoms[projectId][itemName];
                    }
                }
            }
            openLaborModal();
            });
        });
    });
    //Listeners de Detalhes e Edição
    document.querySelectorAll('.view-labor-details-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const itemName = e.target.dataset.name;
            showOutsourcedDetails(itemName); 
        });
    });
    document.querySelectorAll('.edit-labor-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const itemName = e.target.dataset.name;
            if (itemName === 'Mão de Obra Regional') {
                openRegionalLaborModal(itemName); 
            } else if (itemName.startsWith('Mão de Obra - ')) {
                openOutsourcedLaborModal(itemName);
            }
        });
    });
    document.getElementById('laborModal').style.display = 'flex';
}

//Exibir detalhes de mão de obra
function showOutsourcedDetails(itemName) {
    //Recuperação e validação de dados
    const laborItem = bomState[itemName];
    if (!laborItem || !laborItem.details || !laborItem.details.services) {
        showAlert('Erro', 'Detalhes não encontrados para este item.');
        return;
    }
    //Preparação da interface
    const details = laborItem.details;
    const modal = document.getElementById('outsourcedDetailsModal');
    const title = document.getElementById('outsourcedDetailsTitle');
    const tableBody = document.getElementById('outsourcedDetailsBody');
    title.textContent = `Detalhes - ${details.companyName}`;
    tableBody.innerHTML = '';
    //Listas de serviços
    details.services.forEach(service => {
        if (service.qty > 0) {
            const row = tableBody.insertRow();
            const total = service.qty * service.price;
            row.innerHTML = `
                <td>${service.name}</td>
                <td>${service.qty}</td>
                <td>${service.unit}</td>
                <td>R$ ${service.price.toFixed(2).replace('.', ',')}</td>
                <td>R$ ${total.toFixed(2).replace('.', ',')}</td>
            `;
        }
    });
    //Exibição no modal
    modal.style.display = 'flex';
}

//Mão de obra regional
function openRegionalLaborModal(itemNameForEdit = null) {
    try {
        const modal = document.getElementById('regionalLaborModal');
        const titleElement = modal.querySelector('h2');
        const confirmButton = document.getElementById('confirmRegionalLabor');
        if (!itemNameForEdit && bomState['Mão de Obra Regional']) {
            showAlert('Atenção', 'A Mão de Obra Regional já foi adicionada.');
            return;
        }
        //Calcula os dias (Estimativa)
        const quantities = getProjectQuantities();
        const calculatedDays = estimateLaborDays(quantities);
        //Exibe a estimativa
        document.getElementById('regionalDaysDisplay').textContent = calculatedDays;
        //Pega o campo de input de dias manuais
        const manualDaysInput = document.getElementById('regionalDaysInput');
        //Lista de todos os IDs de input para facilitar
        const inputIds = [
            'regionalTechs', 'regionalDaysInput',
            'regionalFuelQty', 'regionalFuelPrice',
            'regionalFoodQty', 'regionalFoodPrice',
            'regionalLodgingQty', 'regionalLodgingPrice',
            'regionalTollQty', 'regionalTollPrice'
        ];
        //Configura o modal para o modo edição
        if (itemNameForEdit && bomState[itemNameForEdit]) {
            titleElement.textContent = 'Editar Mão de Obra Regional';
            confirmButton.textContent = 'Salvar Alterações';
            modal.dataset.editingItemName = itemNameForEdit;
            const details = bomState[itemNameForEdit].details || {};
            document.getElementById('regionalTechs').value = details.techs || 1;
            manualDaysInput.value = details.manualDays !== undefined ? details.manualDays : calculatedDays;
            document.getElementById('regionalFuelQty').value = details.fuelQty || 0;
            document.getElementById('regionalFuelPrice').value = details.fuelPrice || 0;
            document.getElementById('regionalFoodQty').value = details.foodQty || 0;
            document.getElementById('regionalFoodPrice').value = details.foodPrice || 0;
            document.getElementById('regionalLodgingQty').value = details.lodgingQty || 0;
            document.getElementById('regionalLodgingPrice').value = details.lodgingPrice || 0;
            document.getElementById('regionalTollQty').value = details.tollQty || 0;
            document.getElementById('regionalTollPrice').value = details.tollPrice || 0;
        }
        else {
            titleElement.textContent = 'Adicionar Mão de Obra Regional';
            confirmButton.textContent = 'Confirmar';
            modal.dataset.editingItemName = '';
            //Limpa/reseta os campos para os valores padrão
            document.getElementById('regionalTechs').value = 1;
            manualDaysInput.value = calculatedDays;
            //Reseta todos os campos de despesa
            inputIds.slice(2).forEach(id => {
                document.getElementById(id).value = 0;
            });
        }
        //Adiciona os listeners de 'oninput' a TODOS os campos
        inputIds.forEach(id => {
            const inputElement = document.getElementById(id);
            if (!inputElement) {
                throw new Error(`Elemento de input não encontrado: #${id}. Verifique seu index.html.`);
            }
            inputElement.oninput = null;
            inputElement.oninput = updateRegionalCost;
        });
        updateRegionalCost();
        modal.style.display = 'flex';
        
    } catch (error) {
        console.error("Erro ao abrir o modal de M.O. Regional:", error);
        showAlert(
            "Erro de Sincronização",
            "Não foi possível abrir o modal. Verifique se o seu 'index.html' (passo 1) e o seu 'script.js' (passo 2) estão ambos atualizados. Detalhe do erro: " + error.message
        );
    }
}

//Atualização dos custos mão de obra regional
function updateRegionalCost() {
    //Captura dos inputs
    const modal = document.getElementById('regionalLaborModal');
    const techs = parseInt(document.getElementById('regionalTechs').value, 10) || 0
    const days = parseInt(document.getElementById('regionalDaysInput').value, 10) || 0;
    const fuelQty = parseFloat(document.getElementById('regionalFuelQty').value) || 0;
    const fuelPrice = parseFloat(document.getElementById('regionalFuelPrice').value) || 0;
    const foodQty = parseFloat(document.getElementById('regionalFoodQty').value) || 0;
    const foodPrice = parseFloat(document.getElementById('regionalFoodPrice').value) || 0;
    const lodgingQty = parseFloat(document.getElementById('regionalLodgingQty').value) || 0;
    const lodgingPrice = parseFloat(document.getElementById('regionalLodgingPrice').value) || 0;
    const tollQty = parseFloat(document.getElementById('regionalTollQty').value) || 0;
    const tollPrice = parseFloat(document.getElementById('regionalTollPrice').value) || 0;
    //Calculo base
    const baseCost = techs * days * laborConfig.hoursPerDay * laborConfig.hourlyRate;
    const totalFuel = fuelQty * fuelPrice;
    const totalFood = foodQty * foodPrice;
    const totalLodging = lodgingQty * lodgingPrice;
    const totalToll = tollQty * tollPrice;
    const totalCost = baseCost + totalFuel + totalFood + totalLodging + totalToll;
    document.getElementById('regionalBaseCostDisplay').innerHTML = `Custo Base: <strong>R$ ${baseCost.toFixed(2).replace('.', ',')}</strong>`;
    document.getElementById('regionalTotalCostDisplay').innerHTML = `Custo Total: <strong>R$ ${totalCost.toFixed(2).replace('.', ',')}</strong>`;
}

//Confirmação e persistência mão de obra regional
function handleRegionalLaborConfirm() {
    const techs = parseInt(document.getElementById('regionalTechs').value, 10);
    //Validação da quantidade de técnicos
    if (isNaN(techs) || techs < 1) {
        showAlert('Erro', 'A quantidade de técnicos deve ser um número maior que zero.');
        return;
    }
    const modal = document.getElementById('regionalLaborModal');
    //Pega o nome do item que estava sendo editado (se houver)
    const editingItemName = modal.dataset.editingItemName;
    //Pega os outros valores do formulário
    const calculatedDays = parseInt(document.getElementById('regionalDaysDisplay').textContent, 10) || 0;
    const manualDays = parseInt(document.getElementById('regionalDaysInput').value, 10) || 0;
    //Pega os valores de Qtd e Preço das despesas
    const fuelQty = parseFloat(document.getElementById('regionalFuelQty').value) || 0;
    const fuelPrice = parseFloat(document.getElementById('regionalFuelPrice').value) || 0;
    const foodQty = parseFloat(document.getElementById('regionalFoodQty').value) || 0;
    const foodPrice = parseFloat(document.getElementById('regionalFoodPrice').value) || 0;
    const lodgingQty = parseFloat(document.getElementById('regionalLodgingQty').value) || 0;
    const lodgingPrice = parseFloat(document.getElementById('regionalLodgingPrice').value) || 0;
    const tollQty = parseFloat(document.getElementById('regionalTollQty').value) || 0;
    const tollPrice = parseFloat(document.getElementById('regionalTollPrice').value) || 0;
    //Calcula os custos
    const baseCost = techs * manualDays * laborConfig.hoursPerDay * laborConfig.hourlyRate;
    const totalFuel = fuelQty * fuelPrice;
    const totalFood = foodQty * foodPrice;
    const totalLodging = lodgingQty * lodgingPrice;
    const totalToll = tollQty * tollPrice;
    const totalCost = baseCost + totalFuel + totalFood + totalLodging + totalToll;
    //Define o nome do item
    const itemName = 'Mão de Obra Regional';
    //Cria ou atualiza a entrada no bomState
    bomState[itemName] = {
        quantity: 1,
        type: 'Regional',
        unitPrice: totalCost, 
        category: 'Mão de Obra',
        removed: false,
        details: {
            techs, 
            days: calculatedDays,
            manualDays: manualDays,
            fuelQty, fuelPrice,
            foodQty, foodPrice,
            lodgingQty, lodgingPrice,
            tollQty, tollPrice,
            baseCost, 
            totalCost
        }
    };
    if (activeFolderId) {
        const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
        if (projectRootElement) {
            const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
            if (!projectBoms[projectId]) {
                projectBoms[projectId] = {};
            }
            projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
        }
    }
    modal.dataset.editingItemName = '';
    document.getElementById('regionalLaborModal').style.display = 'none';
    openLaborModal();
}

//Modal de mão de obra terceirizada para criação e edição
const DEFAULT_OUTSOURCED_SERVICES = [
    { name: 'LANÇAMENTO DE CABO AÉREA URBANA', price: 1.80, unit: 'm', defaultQtyKey: 'cableLength' },
    { name: 'LANÇAMENTO DE CABO AÉREA RURAL', price: 2.59, unit: 'm', defaultQtyKey: null },
    { name: 'LANÇAMENTO DE CABO EM DUTO OCUPADO', price: 3.00, unit: 'm', defaultQtyKey: null },
    { name: 'INSTALAÇÃO DE RESERVA TÉCNICA', price: 80.00, unit: 'un', defaultQtyKey: 'reservaCount' },
    { name: 'LANÇAMENTO DE CORDOALHA', price: 1.50, unit: 'm', defaultQtyKey: 'cordoalhaLength' },
    { name: 'REMOÇÃO DE CABO EM REDE AÉREA', price: 1.00, unit: 'm', defaultQtyKey: null },
    { name: 'INSTALAÇÃO DE CAIXA DE EMENDA (CEO)', price: 110.00, unit: 'un', defaultQtyKey: 'ceoCount' },
    { name: 'INSTALAÇÃO DE CAIXA DE ATENDIMENTO (CTO)', price: 80.00, unit: 'un', defaultQtyKey: 'ctoCount' },
    { name: 'FUSÃO DE FIBRA ÓPTICA', price: 20.00, unit: 'un', defaultQtyKey: null },
    { name: 'INSTALAÇÃO DE POSTE', price: 270.00, unit: 'un', defaultQtyKey: null },
    { name: 'VALOR DO POSTE', price: 120.00, unit: 'un', defaultQtyKey: null },
];

function wireOutsourcedServiceRow(row) {
    row.querySelectorAll('.outsourced-price-input, .outsourced-qty-input, .outsourced-name-input, .outsourced-unit-input').forEach((el) => {
        el.oninput = updateOutsourcedCost;
        el.onchange = updateOutsourcedCost;
    });
    const removeBtn = row.querySelector('.outsourced-remove-row-btn');
    if (removeBtn) {
        removeBtn.onclick = () => {
            row.remove();
            updateOutsourcedCost();
        };
    }
}

function buildOutsourcedServiceRow({ name, price, unit, qty, isCustom = false }) {
    const row = document.createElement('tr');
    row.dataset.custom = isCustom ? 'true' : 'false';
    const priceValue = Number.isFinite(price) ? price : 0;
    const qtyValue = Number.isFinite(qty) ? qty : 0;
    const unitLabel = unit === 'un' ? '/ un' : '/ m';

    if (isCustom) {
        row.innerHTML = `
            <td><input type="text" class="outsourced-name-input" value="${name || ''}" placeholder="Nome do serviço"></td>
            <td>
                <div class="outsourced-price-cell">
                    <span>R$</span>
                    <input type="number" class="outsourced-price-input" value="${priceValue.toFixed(2)}" min="0" step="0.01">
                    <select class="outsourced-unit-input">
                        <option value="m" ${unit === 'm' ? 'selected' : ''}>/ m</option>
                        <option value="un" ${unit === 'un' ? 'selected' : ''}>/ un</option>
                    </select>
                </div>
            </td>
            <td><input type="number" class="outsourced-qty-input" value="${qtyValue}" min="0" step="any"></td>
            <td class="outsourced-subtotal">R$ 0,00</td>
            <td><button type="button" class="outsourced-remove-row-btn" title="Remover serviço">&times;</button></td>
        `;
    } else {
        row.innerHTML = `
            <td class="outsourced-service-name">${name}</td>
            <td>
                <div class="outsourced-price-cell">
                    <span>R$</span>
                    <input type="number" class="outsourced-price-input" value="${priceValue.toFixed(2)}" min="0" step="0.01">
                    <span class="outsourced-unit-label">${unitLabel}</span>
                </div>
            </td>
            <td><input type="number" class="outsourced-qty-input" value="${qtyValue}" min="0" step="any"></td>
            <td class="outsourced-subtotal">R$ 0,00</td>
            <td></td>
        `;
        row.dataset.unit = unit;
    }
    wireOutsourcedServiceRow(row);
    return row;
}

function addOutsourcedCustomServiceRow(service = {}) {
    const tableBody = document.getElementById('outsourcedServicesBody');
    if (!tableBody) return;
    const row = buildOutsourcedServiceRow({
        name: service.name || '',
        price: service.price ?? 0,
        unit: service.unit || 'un',
        qty: service.qty ?? 0,
        isCustom: true,
    });
    tableBody.appendChild(row);
    row.querySelector('.outsourced-name-input')?.focus();
}

function collectOutsourcedServicesFromTable() {
    const services = [];
    document.querySelectorAll('#outsourcedServicesBody tr').forEach((row) => {
        const isCustom = row.dataset.custom === 'true';
        const name = isCustom
            ? row.querySelector('.outsourced-name-input')?.value.trim()
            : row.querySelector('.outsourced-service-name')?.textContent.trim();
        if (!name) return;
        const price = parseFloat(row.querySelector('.outsourced-price-input')?.value) || 0;
        const qty = parseFloat(row.querySelector('.outsourced-qty-input')?.value) || 0;
        const unit = isCustom
            ? (row.querySelector('.outsourced-unit-input')?.value || 'un')
            : (row.dataset.unit || 'un');
        services.push({ name, price, unit, qty });
    });
    return services;
}

function openOutsourcedLaborModal(itemNameForEdit = null) {
    const modal = document.getElementById('outsourcedLaborModal');
    const titleElement = modal.querySelector('h2');
    const confirmButton = document.getElementById('confirmOutsourcedLabor');
    const companyNameInput = document.getElementById('outsourcedCompanyName');
    const tableBody = document.getElementById('outsourcedServicesBody');
    // Verifica se já existe M.O. Terceirizada e não está editando
    const existingOutsourced = Object.keys(bomState).find(key => key.startsWith('Mão de Obra - '));
    if (!itemNameForEdit && existingOutsourced) {
        showAlert('Atenção', 'A Mão de Obra Terceirizada já foi adicionada.');
        return;
    }
    // Calcula as quantidades atuais do projeto (para preencher no modo ADIÇÃO)
    const quantities = getProjectQuantities();
    const defaultServices = DEFAULT_OUTSOURCED_SERVICES;
    tableBody.innerHTML = '';
    let savedServicesMap = {};
    if (itemNameForEdit && bomState[itemNameForEdit]) {
        titleElement.textContent = 'Editar Mão de Obra Terceirizada';
        confirmButton.textContent = 'Salvar Alterações';
        modal.dataset.editingItemName = itemNameForEdit;
        const details = bomState[itemNameForEdit].details || {};
        companyNameInput.value = details.companyName || itemNameForEdit.replace('Mão de Obra - ', '');
        savedServicesMap = (details.services || []).reduce((acc, service) => {
            acc[service.name] = service;
            return acc;
        }, {});
    } else {
        titleElement.textContent = 'Adicionar Mão de Obra Terceirizada';
        confirmButton.textContent = 'Confirmar';
        modal.dataset.editingItemName = '';
        companyNameInput.value = '';
    }

    defaultServices.forEach((service) => {
        const saved = savedServicesMap[service.name];
        let quantity = 0;
        if (itemNameForEdit) {
            quantity = saved?.qty || 0;
        } else if (service.defaultQtyKey) {
            quantity = quantities[service.defaultQtyKey] || 0;
        }
        const price = saved?.price ?? service.price;
        tableBody.appendChild(buildOutsourcedServiceRow({
            name: service.name,
            price,
            unit: service.unit,
            qty: quantity,
            isCustom: false,
        }));
    });

    const defaultNames = new Set(defaultServices.map((s) => s.name));
    (itemNameForEdit ? (bomState[itemNameForEdit]?.details?.services || []) : []).forEach((service) => {
        if (!defaultNames.has(service.name)) {
            addOutsourcedCustomServiceRow(service);
        }
    });

    updateOutsourcedCost();
    modal.style.display = 'flex';
}

//Atualização em tempo real do custo terceirizado
function updateOutsourcedCost() {
    let total = 0;
    document.querySelectorAll('#outsourcedServicesBody tr').forEach((row) => {
        const price = parseFloat(row.querySelector('.outsourced-price-input')?.value) || 0;
        const qty = parseFloat(row.querySelector('.outsourced-qty-input')?.value) || 0;
        const subtotal = price * qty;
        const subtotalCell = row.querySelector('.outsourced-subtotal');
        if (subtotalCell) {
            subtotalCell.textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
        }
        total += subtotal;
    });
    document.getElementById('outsourcedTotalCostDisplay').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
}

//Confirmação e persistência de dados de mão de obra terceirizada
function handleOutsourcedLaborConfirm() {
    const modal = document.getElementById('outsourcedLaborModal');
    const editingItemName = modal.dataset.editingItemName;
    const companyName = document.getElementById('outsourcedCompanyName').value.trim() || 'Terceirizada';
    const services = collectOutsourcedServicesFromTable();
    const totalCost = services.reduce((sum, service) => sum + (service.price * service.qty), 0);
    // Se está editando, usa o nome original. Se está adicionando, cria um novo.
    const itemName = editingItemName || `Mão de Obra - ${companyName}`;
    // Verifica se o custo é válido antes de salvar/atualizar
    if (totalCost >= 0) {
        // Cria ou atualiza a entrada no bomState
        bomState[itemName] = {
            quantity: 1,
            type: 'Outsourced', 
            unitPrice: totalCost, 
            category: 'Mão de Obra',
            removed: false,
            details: { 
                companyName: companyName, 
                services: services, 
                totalCost: totalCost 
            }
        };
        if (activeFolderId) {
            const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
            if (projectRootElement) {
                const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
                // Garante que o objeto do projeto existe antes de salvar
                if (!projectBoms[projectId]) {
                    projectBoms[projectId] = {};
                }
                // Sincroniza o bomState atual (que agora inclui a M.O.) com o bom salvo
                projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
            }
        }
    } else {
        showAlert('Erro', 'Custo total inválido. Não foi possível salvar.');
        return; // Impede o fechamento do modal se o custo for inválido
    }
    // Limpa o estado de edição e fecha o modal
    modal.dataset.editingItemName = '';
    document.getElementById('outsourcedLaborModal').style.display = 'none';
    openLaborModal();
}

//Recalcula os totais exibidos na lista de materiais
function recalculateGrandTotal() {
    const t = summarizeBomCosts(bomState);
    const money = (v) => `R$ ${v.toFixed(2).replace('.', ',')}`;
    document.getElementById('ferragem-total-price').textContent = money(t.ferragemTotal);
    document.getElementById('cabos-total-price').textContent = money(t.cabosTotal);
    document.getElementById('fusao-total-price').textContent = money(t.fusaoTotal);
    document.getElementById('datacenter-total-price').textContent = money(t.datacenterTotal);
    document.getElementById('grand-total-price').textContent = money(t.grandTotal);
}

//Recuperação de itens
function getProjectItems(projectId) {
    //Mapeamento da estrutura de pasta
  const allFolderIds = getAllDescendantFolderIds(projectId);
  //Filtragem
  const projectMarkers = markers.filter(m => allFolderIds.includes(m.folderId));
  const projectCables = savedCables.filter(c => allFolderIds.includes(c.folderId));
  const projectPolygons = savedPolygons.filter(p => allFolderIds.includes(p.folderId));
  //Retorno consolidado
  return { markers: projectMarkers, cables: projectCables, polygons: projectPolygons };
}

//Seção de cada item na lista de materiais (mesma regra da tela, do relatório e do PDF).
//Retorna null para itens fora da soma (removidos e mão de obra).
const BOM_COST_SECTIONS = { Ferragem: 'ferragemTotal', 'Lançamento': 'cabosTotal', 'Fusão': 'fusaoTotal', 'Data Center': 'datacenterTotal' };

function getBomCostSection(item) {
    if (!item || item.removed || item.category === 'Mão de Obra') return null;
    return BOM_COST_SECTIONS[item.category] ? item.category : 'Ferragem'; //Outros entram em Ferragens
}

//Totais de materiais por seção: usado na tela e no relatório
function summarizeBomCosts(projectBom) {
    const totals = { ferragemTotal: 0, cabosTotal: 0, fusaoTotal: 0, datacenterTotal: 0 };
    for (const key in projectBom || {}) {
        const item = projectBom[key];
        const section = getBomCostSection(item);
        if (!section) continue;
        totals[BOM_COST_SECTIONS[section]] += (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
    }
    totals.grandTotal = totals.ferragemTotal + totals.cabosTotal + totals.fusaoTotal + totals.datacenterTotal;
    return totals;
}

//Cálculo final de custos maõ de obra
function calculateProjectLaborCost(projectItems, projectBomForReport) {
    let regionalCost = 0;
    let outsourcedCost = 0;
    //Garante que exista um objeto BOM
    const bomToUse = projectBomForReport || {};
    //Identificação de mão de obra
    const regionalLabor = bomToUse['Mão de Obra Regional'];
    const outsourcedLabor = Object.values(bomToUse).find(item => item.type === 'Outsourced');
    //Processamento mão de obra regional
    if (regionalLabor && !regionalLabor.removed) {
        if (regionalLabor.details && typeof regionalLabor.details.totalCost === 'number') {
            regionalCost = regionalLabor.details.totalCost;
        } else {
            regionalCost = regionalLabor.unitPrice || 0;
        }
    }
    //Processamento mão de obra terceirizada
    if (outsourcedLabor && !outsourcedLabor.removed) {
        if (outsourcedLabor.details && typeof outsourcedLabor.details.totalCost === 'number') {
            outsourcedCost = outsourcedLabor.details.totalCost;
        } else {
            outsourcedCost = outsourcedLabor.unitPrice || 0;
        }
    }
    const totalLaborCost = regionalCost + outsourcedCost;
    return { regionalCost, outsourcedCost, totalLaborCost };
}

//Cálculo de quantitativos via lista de itens - relatório
function getProjectQuantitiesFromItems(projectItems, projectId) {
    //Inicialização dos contadores
    let totalLength = 0, cordoalhaLength = 0, cordoalhaCount = 0, ctoCount = 0, ceoCount = 0, reservaCount = 0;
    const savedSurcharges = {};
    if (projectId && projectBoms[projectId]) {
        for (const key in projectBoms[projectId]) {
            if (projectBoms[projectId][key].category === 'Lançamento') {
                savedSurcharges[key] = projectBoms[projectId][key].surchargePercent || 0;
            }
        }
    }
    //Somatório dos cabos agrupados por tipo
    syncProjectCableMeasurements(projectItems.cables);
    const billableCables = projectItems.cables.filter(
        (cable) => cable.status !== 'Existente' && cable.type !== 'Cabo Importado'
    );
    Object.entries(groupCablesByType(billableCables)).forEach(([cableType, cables]) => {
        const surcharge = Math.max(0, parseFloat(savedSurcharges[cableType]) || 0);
        totalLength += getCableTypeBillableLength(cables, surcharge);
    });
    projectItems.cables.forEach((cable) => {
        if (cable.status !== 'Existente' && cable.type === 'Cabo Importado') {
            totalLength += getCableBaseLength(cable);
        }
    });
    //Contagem de ativos
    projectItems.markers.forEach(marker => {
        if (marker.type === 'CTO' && marker.ctoStatus !== 'Existente') ctoCount++;
        if (marker.type === 'CEO' && marker.ceoStatus !== 'Existente') ceoCount++;
        if (marker.type === 'RESERVA' && marker.reservaStatus !== 'Existente') reservaCount++;
        if (marker.type === 'CORDOALHA' && marker.cordoalhaStatus !== 'Existente') {
            cordoalhaCount++;
            cordoalhaLength += 50;
        }
    });
    return { cableLength: Math.round(totalLength), cordoalhaLength, cordoalhaCount, ctoCount, ceoCount, reservaCount };
}

//Abertura do modal de relatórios
function getReportProjectTypeClass(type) {
    if (!type) return '';
    const normalized = String(type).toLowerCase();
    if (normalized === 'tct') return 'type-tct';
    if (normalized === 'mdu') return 'type-mdu';
    return '';
}

function buildReportProjectListItem(projEl) {
    const li = document.createElement("li");
    li.dataset.projectId = projEl.dataset.folderId;
    li.className = 'report-pick';
    li.setAttribute("role", "option");
    li.setAttribute("tabindex", "0");

    const projectName = projEl.dataset.folderName || 'Projeto sem nome';
    const projectCity = projEl.dataset.folderCity || 'Cidade não informada';
    const projectNeighborhood = projEl.dataset.folderNeighborhood || 'Bairro não informado';
    const projectType = projEl.dataset.folderType || 'TCR';
    li.dataset.searchText = `${projectName} ${projectCity} ${projectNeighborhood} ${projectType}`.toLowerCase();

    //Resumo rápido (custo e portas) para escolher o projeto certo
    let quickStats = '';
    try {
        const data = computeProjectReportData(projEl.dataset.folderId);
        if (data) {
            quickStats = `<span class="report-pick__stat"><b>${formatPdfCurrency(data.finalCost)}</b> custo total</span>`
                + `<span class="report-pick__stat"><b>${data.novasPortas}</b> novas portas</span>`
                + `<span class="report-pick__stat"><b>${data.quantities.cableLength} m</b> lançamento</span>`;
        }
    } catch (e) { /* projeto ainda incompleto: sem resumo */ }

    li.innerHTML = `
        <span class="report-pick__icon" aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24"><use href="#i-report"></use></svg></span>
        <div class="report-pick__body">
            <div class="report-pick__head">
                <strong>${escapeHtml(projectName)}</strong>
                <span class="report-type-pill">${escapeHtml(projectType)}</span>
            </div>
            <span class="report-pick__place">${escapeHtml(projectCity)} · ${escapeHtml(projectNeighborhood)}</span>
            ${quickStats ? `<div class="report-pick__stats">${quickStats}</div>` : ''}
        </div>
        <svg class="ui-icon report-pick__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
    `;

    const openReport = () => showProjectReportDetails(li.dataset.projectId, projectName);
    li.addEventListener("click", openReport);
    li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openReport();
        }
    });
    return li;
}

function filterReportProjectList() {
    const query = (document.getElementById("reportProjectSearch")?.value || "").trim().toLowerCase();
    const items = document.querySelectorAll("#report-projects-ul li[data-search-text]");
    let visibleCount = 0;

    items.forEach((item) => {
        const matches = !query || item.dataset.searchText.includes(query);
        item.classList.toggle("hidden", !matches);
        if (matches) visibleCount++;
    });

    const noResultsEl = document.getElementById("report-no-results");
    if (noResultsEl) {
        noResultsEl.classList.toggle("hidden", visibleCount > 0 || items.length === 0);
    }
}

function openReportModal() {
    const projectListUl = document.getElementById("report-projects-ul");
    const searchInput = document.getElementById("reportProjectSearch");
    const searchWrap = document.getElementById("reportProjectSearchWrap");
    projectListUl.innerHTML = "";
    document.getElementById('reportModalTitle').textContent = 'Relatório do projeto';

    const projectElements = document.querySelectorAll('.folder-title[data-is-project="true"]');

    if (projectElements.length === 0) {
        searchWrap?.classList.add("hidden");
        if (searchInput) searchInput.value = "";
        projectListUl.innerHTML = `
            <li class="report-list-empty">
                <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-folder-plus"></use></svg>
                <p>Nenhum projeto aberto</p>
                <span>Abra ou crie um projeto para gerar o relatório.</span>
            </li>
        `;
    } else {
        projectElements.forEach((projEl) => {
            projectListUl.appendChild(buildReportProjectListItem(projEl));
        });

        const noResults = document.createElement("li");
        noResults.id = "report-no-results";
        noResults.className = "report-list-no-results hidden";
        noResults.textContent = "Nenhum projeto corresponde à sua busca.";
        projectListUl.appendChild(noResults);

        searchWrap?.classList.toggle("hidden", projectElements.length <= 3);
        if (searchInput) searchInput.value = "";
    }

    document.getElementById("report-project-details").classList.add("hidden");
    document.getElementById("report-project-list").classList.remove("hidden");
    document.querySelector('#reportModal .report-modal').classList.remove('is-details');
    document.getElementById("reportModal").style.display = "flex";
}

//Geração e exibição de detalhes do relatório de projeto
function countProjectPorts(projectMarkers) {
    let portasExistentes = 0;
    let novasPortas = 0;
    projectMarkers.forEach(marker => {
        if ((marker.type === 'CTO' || marker.type === 'CEO') && marker.fusionPlan) {
            try {
                const planData = JSON.parse(marker.fusionPlan);
                if (!planData.elements) return;
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = planData.elements;
                tempDiv.querySelectorAll('.splitter-atendimento').forEach(splitterElement => {
                    const status = splitterElement.dataset.status;
                    const label = getSplitterLabelText(splitterElement) || null;
                    if (!label || !status) return;
                    const ratioMatch = label.match(/1:(\d+)/);
                    const portsInThisSplitter = ratioMatch ? parseInt(ratioMatch[1], 10) : 0;
                    if (status === 'Existente') {
                        portasExistentes += portsInThisSplitter;
                    } else {
                        novasPortas += portsInThisSplitter;
                    }
                });
            } catch (e) {
                console.error(`Erro ao analisar portas no plano de fusão da caixa "${marker.name}":`, e);
            }
        }
    });
    return { portasExistentes, novasPortas, totalPortas: portasExistentes + novasPortas };
}

function computeProjectReportData(projectId) {
    const projectElement = document.querySelector(`.folder-title[data-folder-id="${projectId}"]`);
    if (!projectElement) return null;

    const projectName = projectElement.dataset.folderName || 'Projeto sem nome';
    const { markers: projectMarkers, cables: projectCables } = getProjectItems(projectId);
    const projectItems = { markers: projectMarkers, cables: projectCables };
    const quantities = getProjectQuantitiesFromItems(projectItems, projectId);
    const { portasExistentes, novasPortas, totalPortas } = countProjectPorts(projectMarkers);
    const totalCasas = projectMarkers.filter(m => m.type === 'CASA').reduce((sum, m) => sum + parseInt(m.name || 0, 10), 0);

    const clientMarkers = projectMarkers.filter(m => m.type === 'CLIENTE');
    const clients = {
        total: clientMarkers.length,
        b2b: clientMarkers.filter(c => c.client?.kind === 'b2b').length,
        predial: clientMarkers.filter(c => c.client?.kind === 'predial').length,
        viabilidade: clientMarkers.filter(c => c.client?.status === 'viabilidade').length,
        aInstalar: clientMarkers.filter(c => c.client?.status === 'a_instalar').length,
        instalado: clientMarkers.filter(c => c.client?.status === 'instalado').length,
    };

    const projectBomForReport = normalizeBomState(projectBoms[projectId] || {});
    const materialCosts = summarizeBomCosts(projectBomForReport);
    const laborCosts = calculateProjectLaborCost(projectItems, projectBomForReport);
    const materialCost = materialCosts.grandTotal;
    const laborCost = laborCosts.totalLaborCost;
    const totalCost = materialCost + laborCost;
    const safetyCoef = totalCost * 0.05;
    const finalCost = totalCost + safetyCoef;
    const costPerPort = novasPortas > 0 ? (finalCost / novasPortas) : 0;
    const prazoEstimado = getProjectEstimatedDurationDays(projectBomForReport, quantities);
    const penetrationRate = totalCasas > 0 ? (totalPortas / totalCasas) * 100 : 0;
    const coverageRate = totalCasas > 0 ? Math.min(100, (totalPortas / totalCasas) * 100) : 0;

    const materialClasseL = materialCosts.ferragemTotal + materialCosts.cabosTotal;
    const materialClasseF = materialCosts.fusaoTotal;
    const materialDataCenter = materialCosts.datacenterTotal;

    const outsourcedLaborDetails = getOutsourcedLaborDetails(projectBomForReport);
    const regionalLaborDetails = getRegionalLaborDetails(projectBomForReport);
    const bomItemsByCategory = groupBomItemsForPdf(projectBomForReport);

    return {
        projectId,
        projectName,
        projectCode: projectName,
        city: projectElement.dataset.folderCity || '',
        neighborhood: projectElement.dataset.folderNeighborhood || '',
        projectType: projectElement.dataset.folderType || 'TCR',
        quantities,
        clients,
        portasExistentes,
        novasPortas,
        totalPortas,
        totalCasas,
        penetrationRate,
        coverageRate,
        materialCosts,
        laborCosts,
        materialCost,
        laborCost,
        totalCost,
        safetyCoef,
        finalCost,
        costPerPort,
        prazoEstimado,
        materialClasseL,
        materialClasseF,
        materialDataCenter,
        observations: projectObservations[projectId] || '',
        outsourcedLaborDetails,
        regionalLaborDetails,
        bomItemsByCategory,
        postCount: Math.ceil(quantities.cableLength / getPoleSpanDistance()),
    };
}

function getOutsourcedLaborDetails(projectBom) {
    for (const name in projectBom) {
        const item = projectBom[name];
        if (item.removed || item.type !== 'Outsourced') continue;
        const details = item.details || {};
        const services = (details.services || []).map(service => ({
            ...service,
            total: (service.qty || 0) * (service.price || 0),
            laborClass: classifyOutsourcedLaborService(service.name),
        }));
        const launchTotal = services.filter(s => s.laborClass === 'L').reduce((sum, s) => sum + s.total, 0);
        const fusionTotal = services.filter(s => s.laborClass === 'F').reduce((sum, s) => sum + s.total, 0);
        return {
            companyName: details.companyName || name.replace('Mão de Obra - ', ''),
            services,
            launchTotal,
            fusionTotal,
            totalCost: details.totalCost || (launchTotal + fusionTotal),
        };
    }
    return null;
}

function classifyOutsourcedLaborService(serviceName) {
    const upper = String(serviceName || '').toUpperCase();
    const launchKeywords = ['LANÇAMENTO', 'CORDOALHA', 'REMOÇÃO', 'POSTE', 'RESERVA'];
    return launchKeywords.some(keyword => upper.includes(keyword)) ? 'L' : 'F';
}

function getRegionalLaborInformedDays(details) {
    if (!details) return null;
    if (details.manualDays !== undefined && details.manualDays !== null) {
        return parseInt(details.manualDays, 10) || 0;
    }
    return null;
}

function calculateProjectDurationDays(quantities) {
    return estimateLaborDays(quantities);
}

function getProjectEstimatedDurationDays(projectBom, quantities) {
    const regionalItem = projectBom['Mão de Obra Regional'];
    if (regionalItem && !regionalItem.removed && regionalItem.details) {
        const informedDays = getRegionalLaborInformedDays(regionalItem.details);
        if (informedDays !== null) {
            return informedDays;
        }
    }
    return calculateProjectDurationDays(quantities);
}

function getRegionalLaborDetails(projectBom) {
    const item = projectBom['Mão de Obra Regional'];
    if (!item || item.removed) return null;
    const details = item.details || {};
    const informedDays = getRegionalLaborInformedDays(details);
    const days = informedDays !== null ? informedDays : (parseInt(details.days, 10) || 0);
    const techs = details.techs || 0;
    const hourlyRate = (techs > 0 && days > 0 && details.baseCost)
        ? details.baseCost / (techs * days * 8)
        : 40;
    return {
        techs,
        hourlyRate,
        days,
        totalCost: details.totalCost || item.unitPrice || 0,
    };
}

function groupBomItemsForPdf(projectBom) {
    const groups = {
        ferragens: [],
        cabos: [],
        fusao: [],
        datacenterPassive: [],
        datacenterActive: [],
    };

    for (const bomKey in projectBom) {
        const item = projectBom[bomKey];
        const section = getBomCostSection(item);
        if (!section) continue;
        const materialName = getMaterialDisplayName(bomKey, item);
        const unit = item.type === 'length' ? 'm' : (item.type || 'un');
        const qty = item.quantity || 0;
        const unitPrice = item.unitPrice || 0;
        const total = qty * unitPrice;
        const row = { name: materialName, unit, qty, unitPrice, total };

        if (section === 'Ferragem') {
            groups.ferragens.push(row);
        } else if (section === 'Lançamento') {
            groups.cabos.push(row);
        } else if (section === 'Fusão') {
            groups.fusao.push(row);
        } else if (section === 'Data Center') {
            if (isActiveDatacenterItem(materialName)) {
                groups.datacenterActive.push(row);
            } else {
                groups.datacenterPassive.push(row);
            }
        }
    }

    const sortByName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
    Object.values(groups).forEach(list => list.sort(sortByName));
    return groups;
}

function isActiveDatacenterItem(materialName) {
    const upper = String(materialName || '').toUpperCase();
    return /PLACA|LICENÇ|OLT|CHASSI|SFP|XFP|MÓDULO|SWITCHING|CONTROLADORA/.test(upper);
}

function formatPdfCurrency(value) {
    const safeValue = Number.isFinite(value) ? value : 0;
    const [intPart, decPart] = safeValue.toFixed(2).split('.');
    const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `R$ ${withDots},${decPart}`;
}

function formatPdfNumber(value) {
    const safeValue = Number.isFinite(value) ? value : 0;
    const [intPart, decPart] = safeValue.toFixed(2).split('.');
    const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return decPart === '00' ? withDots : `${withDots},${decPart}`;
}

let reportPreviewOriginalSnapshot = null;
let reportPreviewResizeTimer = null;

function escapeReportPreviewHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function createReportPreviewSnapshot(data) {
    const bom = data.bomItemsByCategory || {};
    const q = data.quantities || {};
    const locationLine = [data.city, data.neighborhood, data.projectType].filter(Boolean).join(' · ');

    const bomCategoryDefs = [
        { key: 'ferragens', title: 'Ferragens' },
        { key: 'cabos', title: 'Cabos / Lançamento' },
        { key: 'fusao', title: 'Fusão' },
        { key: 'datacenterPassive', title: 'Data Center — Passivo' },
        { key: 'datacenterActive', title: 'Data Center — Ativo' },
    ];

    const bomCategories = bomCategoryDefs.map(({ key, title }) => {
        const sourceRows = bom[key] || [];
        const rows = sourceRows.map((row) => ({
            name: row.name,
            qty: formatPdfNumber(row.qty),
            unit: row.unit === 'm' ? 'm' : 'un',
            unitPriceText: formatPdfCurrency(row.unitPrice),
            totalText: formatPdfCurrency(row.total),
        }));
        const subtotalNum = sourceRows.reduce((sum, row) => sum + (row.total || 0), 0);
        return { title, rows, subtotalText: formatPdfCurrency(subtotalNum) };
    }).filter((category) => category.rows.length > 0);

    const bomGrandTotalNum = bomCategoryDefs
        .flatMap(({ key }) => bom[key] || [])
        .reduce((sum, row) => sum + (row.total || 0), 0);

    const clients = data.clients || { total: 0 };
    const shareBase = (data.materialCost + data.laborCost + data.safetyCoef) || 1;

    const snapshot = {
        projectId: data.projectId,
        projectCode: data.projectCode || data.projectName,
        projectType: data.projectType,
        company: AppSession.company?.name || '',
        author: AppSession.displayName || '',
        title: data.projectName,
        locationLine,
        generatedAt: `Gerado em ${new Date().toLocaleString('pt-BR')}`,
        //Observações entram marcadas quando existem; sem texto, a opção imprime um espaço para anotações
        options: { bom: true, labor: true, notes: !!(data.observations && data.observations.trim()) },
        costShare: {
            mat: (data.materialCost / shareBase) * 100,
            lab: (data.laborCost / shareBase) * 100,
            coef: (data.safetyCoef / shareBase) * 100,
            matText: formatPdfCurrency(data.materialCost),
            labText: formatPdfCurrency(data.laborCost),
            coefText: formatPdfCurrency(data.safetyCoef),
        },
        kpis: [
            { label: 'Custo total (com coef.)', value: formatPdfCurrency(data.finalCost) },
            { label: 'Novas portas', value: String(data.novasPortas) },
            { label: 'Lançamento', value: `${q.cableLength || 0} m` },
            { label: 'Prazo estimado', value: `${data.prazoEstimado} dias` },
        ],
        networkRows: [
            { label: 'Bairro', value: data.neighborhood || 'N/A' },
            { label: 'Casas (HP)', value: String(data.totalCasas) },
            { label: 'Portas existentes (HC)', value: String(data.portasExistentes) },
            { label: 'Novas portas', value: String(data.novasPortas) },
            { label: 'Total de portas', value: String(data.totalPortas) },
            { label: 'Taxa de penetração', value: `${data.penetrationRate.toFixed(2).replace('.', ',')}%` },
            { label: 'Lançamento estimado', value: `${q.cableLength || 0} m` },
            { label: 'Postes (estimativa)', value: String(data.postCount || 0) },
            { label: 'CTOs novas', value: String(q.ctoCount || 0) },
            { label: 'CEOs novas', value: String(q.ceoCount || 0) },
            { label: 'Reservas novas', value: String(q.reservaCount || 0) },
            { label: 'Cordoalhas novas', value: String(q.cordoalhaCount || 0) },
        ],
        clientRows: clients.total ? [
            { label: 'Clientes cadastrados', value: String(clients.total) },
            { label: 'Empresariais (B2B)', value: String(clients.b2b) },
            { label: 'Prediais', value: String(clients.predial) },
            { label: 'Em viabilidade', value: String(clients.viabilidade) },
            { label: 'A instalar', value: String(clients.aInstalar) },
            { label: 'Instalados', value: String(clients.instalado) },
        ] : [],
        materialRows: [
            { label: 'Ferragens', value: formatPdfCurrency(data.materialCosts.ferragemTotal) },
            { label: 'Cabos', value: formatPdfCurrency(data.materialCosts.cabosTotal) },
            { label: 'Fusão', value: formatPdfCurrency(data.materialCosts.fusaoTotal) },
            { label: 'Data Center', value: formatPdfCurrency(data.materialCosts.datacenterTotal) },
            { label: 'Total de materiais', value: formatPdfCurrency(data.materialCost) },
        ],
        bomCategories,
        bomGrandTotalText: bomGrandTotalNum > 0 ? formatPdfCurrency(bomGrandTotalNum) : null,
        laborRows: [
            { label: 'M.O. regional', value: formatPdfCurrency(data.laborCosts.regionalCost) },
            { label: 'M.O. terceirizada', value: formatPdfCurrency(data.laborCosts.outsourcedCost) },
            { label: 'Total de mão de obra', value: formatPdfCurrency(data.laborCost) },
        ],
        regionalLabor: null,
        outsourcedLabor: null,
        financialRows: [
            { label: 'Subtotal (materiais + mão de obra)', value: formatPdfCurrency(data.totalCost) },
            { label: 'Coef. de segurança (5%)', value: formatPdfCurrency(data.safetyCoef) },
            { label: 'Custo por nova porta', value: formatPdfCurrency(data.costPerPort) },
            { label: 'Prazo da obra', value: `${data.prazoEstimado} dias` },
            { label: 'Custo total final', value: formatPdfCurrency(data.finalCost) },
        ],
        observations: (data.observations || '').trim(),
    };

    if (data.regionalLaborDetails) {
        const rd = data.regionalLaborDetails;
        snapshot.regionalLabor = {
            title: 'Detalhe — M.O. regional',
            rows: [
                { label: 'Técnicos', value: String(rd.techs) },
                { label: 'Dias', value: String(rd.days) },
                { label: 'Valor hora', value: formatPdfCurrency(rd.hourlyRate) },
                { label: 'Total', value: formatPdfCurrency(rd.totalCost) },
            ],
        };
    }

    if (data.outsourcedLaborDetails?.services?.length) {
        const od = data.outsourcedLaborDetails;
        snapshot.outsourcedLabor = {
            title: `Detalhe — M.O. terceirizada (${od.companyName})`,
            rows: od.services.map((service) => ({
                name: service.name || '—',
                qty: String(service.qty ?? 0),
                unit: 'un',
                unitPriceText: formatPdfCurrency(service.price),
                totalText: formatPdfCurrency(service.total),
            })),
            totalText: formatPdfCurrency(od.totalCost),
        };
    }

    return snapshot;
}

const REPORT_PREVIEW_PAGE_WIDTH_MM = 210;
const REPORT_PREVIEW_PAGE_HEIGHT_MM = 297;
const REPORT_PREVIEW_PAGE_PADDING_TOP_MM = 14;
const REPORT_PREVIEW_PAGE_PADDING_BOTTOM_MM = 10;
const REPORT_PREVIEW_PAGE_PADDING_X_MM = 16;
const REPORT_PREVIEW_PAGE_FOOTER_RESERVE_MM = 7;

let reportPreviewMmToPxRatio = null;

function getReportPreviewPagesRoot() {
    return document.getElementById('reportPreviewPages');
}

function getReportPreviewMmToPx() {
    if (reportPreviewMmToPxRatio) return reportPreviewMmToPxRatio;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:-9999px;top:0;height:100mm;width:1mm;visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
    reportPreviewMmToPxRatio = probe.getBoundingClientRect().height / 100;
    probe.remove();
    return reportPreviewMmToPxRatio;
}

function reportPreviewMmToPx(mm) {
    return Math.round(getReportPreviewMmToPx() * mm);
}

function createReportPreviewMeasurePage() {
    const pageBundle = createReportPreviewPageElement();
    pageBundle.page.style.position = 'fixed';
    pageBundle.page.style.left = '-10000px';
    pageBundle.page.style.top = '0';
    pageBundle.page.style.visibility = 'hidden';
    pageBundle.page.style.pointerEvents = 'none';
    document.body.appendChild(pageBundle.page);
    return pageBundle;
}

function removeReportPreviewMeasurePage(pageBundle) {
    pageBundle?.page?.remove();
}

function createReportPreviewFlowBlock(html, extraClass = '') {
    const block = document.createElement('div');
    block.className = `rp-flow-block${extraClass ? ` ${extraClass}` : ''}`;
    block.innerHTML = html;
    return block;
}

function createReportPreviewPageElement() {
    const page = document.createElement('div');
    page.className = 'report-preview-page';

    const content = document.createElement('div');
    content.className = 'report-preview-page-content';
    page.appendChild(content);

    const footer = document.createElement('div');
    footer.className = 'report-preview-page-footer';
    page.appendChild(footer);

    return { page, content, footer };
}

function measureReportPreviewBlock(block) {
    if (!block) return 0;

    const pageBundle = createReportPreviewMeasurePage();
    const clone = block.cloneNode(true);
    pageBundle.content.appendChild(clone);

    const height = Math.ceil(Math.max(
        clone.getBoundingClientRect().height,
        clone.offsetHeight,
        clone.scrollHeight
    ));

    removeReportPreviewMeasurePage(pageBundle);
    return height;
}

function getReportPreviewContentCapacityPx() {
    const pageBundle = createReportPreviewMeasurePage();
    const footerHeight = Math.ceil(pageBundle.footer.getBoundingClientRect().height);
    const contentHeight = Math.floor(pageBundle.content.clientHeight);
    removeReportPreviewMeasurePage(pageBundle);

    if (contentHeight > 0) {
        return Math.max(0, contentHeight - 2);
    }

    const usableMm = REPORT_PREVIEW_PAGE_HEIGHT_MM
        - REPORT_PREVIEW_PAGE_PADDING_TOP_MM
        - REPORT_PREVIEW_PAGE_PADDING_BOTTOM_MM
        - REPORT_PREVIEW_PAGE_FOOTER_RESERVE_MM;
    return reportPreviewMmToPx(usableMm);
}

function updateReportPreviewPageFooters() {
    const pages = document.querySelectorAll('#reportPreviewPages .report-preview-page');
    const total = pages.length;
    const label = reportPreviewCurrentSnapshot ? getReportFooterLabel(reportPreviewCurrentSnapshot) : '';
    pages.forEach((page, index) => {
        const footer = page.querySelector('.report-preview-page-footer');
        if (footer) {
            footer.innerHTML = `<span>${escapeReportPreviewHtml(label)}</span><span>Página ${index + 1} de ${total}</span>`;
        }
    });
}

//Texto do rodapé (esquerda) de cada folha
function getReportFooterLabel(snapshot) {
    return ['ROUTE MAP', snapshot.company, snapshot.title].filter(Boolean).join(' · ');
}

function buildReportPreviewTableChunk({
    blockClassName,
    titleElement,
    showTitle,
    showContinuationTitle,
    tableHead,
    rows,
    includeSubtotalRow,
}) {
    const chunk = document.createElement('div');
    chunk.className = blockClassName || 'rp-flow-block rp-avoid-break';

    if (showTitle && titleElement) {
        chunk.appendChild(titleElement.cloneNode(true));
    } else if (showContinuationTitle && titleElement) {
        const continuedTitle = document.createElement('div');
        continuedTitle.className = 'rp-subsection-title rp-subsection-title--continued';
        continuedTitle.textContent = `${titleElement.textContent.trim()} (continuação)`;
        chunk.appendChild(continuedTitle);
    }

    const table = document.createElement('table');
    table.className = 'rp-table';
    if (tableHead) {
        table.appendChild(tableHead.cloneNode(true));
    }

    const tbody = document.createElement('tbody');
    rows.forEach((row) => tbody.appendChild(row.cloneNode(true)));
    if (includeSubtotalRow) {
        tbody.appendChild(includeSubtotalRow.cloneNode(true));
    }
    table.appendChild(tbody);
    chunk.appendChild(table);

    return chunk;
}

function splitOversizedTableBlock(block, capacity) {
    const table = block.querySelector('.rp-table');
    if (!table || !capacity) return [block];

    const blockHeight = measureReportPreviewBlock(block);
    if (blockHeight <= capacity) return [block];

    const tbody = table.querySelector('tbody');
    if (!tbody) return [block];

    const allRows = [...tbody.querySelectorAll('tr')];
    const subtotalRow = allRows.find((row) => row.classList.contains('subtotal')) || null;
    const dataRows = allRows.filter((row) => !row.classList.contains('subtotal') && !row.classList.contains('grand-total'));
    if (!dataRows.length) return [block];

    const titleElement = block.querySelector('.rp-subsection-title');
    const tableHead = table.querySelector('thead');
    const chunks = [];
    let batch = [];

    const flushBatch = (includeSubtotal) => {
        if (!batch.length) return;
        chunks.push(buildReportPreviewTableChunk({
            blockClassName: block.className,
            titleElement,
            showTitle: chunks.length === 0,
            showContinuationTitle: chunks.length > 0,
            tableHead,
            rows: batch,
            includeSubtotalRow: includeSubtotal ? subtotalRow : null,
        }));
        batch = [];
    };

    dataRows.forEach((row, index) => {
        const candidateRows = [...batch, row];
        const isLastRow = index === dataRows.length - 1;
        const candidateChunk = buildReportPreviewTableChunk({
            blockClassName: block.className,
            titleElement,
            showTitle: chunks.length === 0 && batch.length === 0,
            showContinuationTitle: chunks.length > 0,
            tableHead,
            rows: candidateRows,
            includeSubtotalRow: isLastRow ? subtotalRow : null,
        });
        const candidateHeight = measureReportPreviewBlock(candidateChunk);

        if (candidateHeight > capacity && batch.length > 0) {
            flushBatch(false);
            batch = [row];
        } else if (candidateHeight > capacity && batch.length === 0) {
            chunks.push(candidateChunk);
            batch = [];
        } else {
            batch = candidateRows;
        }
    });

    if (batch.length) {
        flushBatch(true);
    }

    return chunks.length ? chunks : [block];
}

function expandReportPreviewBlocksForLayout(blockElements, capacity) {
    const expanded = blockElements.flatMap((block) => splitOversizedTableBlock(block, capacity));
    //Títulos marcados com rp-keep-next ficam na mesma página da primeira tabela que os segue
    const result = [];
    for (let i = 0; i < expanded.length; i++) {
        const block = expanded[i];
        const next = expanded[i + 1];
        if (next && block.classList.contains('rp-keep-next')) {
            const wrapper = document.createElement('div');
            wrapper.className = 'rp-flow-block rp-avoid-break';
            wrapper.appendChild(block.cloneNode(true));
            wrapper.appendChild(next.cloneNode(true));
            wrapper.firstChild.classList.remove('rp-keep-next');
            if (!capacity || measureReportPreviewBlock(wrapper) <= capacity) {
                result.push(wrapper);
                i++;
                continue;
            }
        }
        result.push(block);
    }
    return result;
}

function layoutReportPreviewPages(blockElements) {
    const pagesRoot = getReportPreviewPagesRoot();
    if (!pagesRoot) return;

    pagesRoot.innerHTML = '';
    if (!blockElements.length) return;

    const capacity = getReportPreviewContentCapacityPx();
    const expandedBlocks = expandReportPreviewBlocksForLayout(blockElements, capacity);
    let pageBundle = createReportPreviewPageElement();
    pagesRoot.appendChild(pageBundle.page);
    let usedHeight = 0;

    expandedBlocks.forEach((block) => {
        const blockHeight = measureReportPreviewBlock(block);
        const shouldBreak = usedHeight > 0 && usedHeight + blockHeight > capacity;

        if (shouldBreak) {
            pageBundle = createReportPreviewPageElement();
            pagesRoot.appendChild(pageBundle.page);
            usedHeight = 0;
        }

        pageBundle.content.appendChild(block);
        usedHeight += blockHeight || 0;
    });

    updateReportPreviewPageFooters();
}

function finalizeReportPreviewLayout() {
    relayoutReportPreviewPages();
}

function relayoutReportPreviewPages() {
    const blocks = [...document.querySelectorAll('#reportPreviewPages .rp-flow-block')];
    if (!blocks.length) return;
    layoutReportPreviewPages(blocks);
}

function scheduleReportPreviewRelayout() {
    clearTimeout(reportPreviewResizeTimer);
    reportPreviewResizeTimer = setTimeout(() => {
        const modal = document.getElementById('reportPreviewModal');
        if (!modal || modal.style.display !== 'flex') return;
        reportPreviewMmToPxRatio = null;
        relayoutReportPreviewPages();
    }, 160);
}

function buildReportPreviewFlowBlocks(snapshot) {
    const blocks = [];
    const options = snapshot.options || { bom: true, labor: true, notes: true };

    const renderDetailRows = (rows, sectionKey, { highlightLast = false } = {}) => rows.map((row, index) => `
        <div class="rp-detail-row${highlightLast && index === rows.length - 1 ? ' rp-detail-row--final' : ''}">
            <strong>${escapeReportPreviewHtml(row.label)}</strong>
            <span contenteditable="true" data-rp-section="${sectionKey}" data-rp-row="${index}">${escapeReportPreviewHtml(row.value)}</span>
        </div>
    `).join('');

    const kpiHtml = snapshot.kpis.map((kpi, index) => `
        <div class="rp-kpi-card${index === 0 ? ' rp-kpi-primary' : ''}">
            <span class="rp-kpi-label">${escapeReportPreviewHtml(kpi.label)}</span>
            <span class="rp-kpi-value" contenteditable="true" data-rp-kpi="${index}">${escapeReportPreviewHtml(kpi.value)}</span>
        </div>
    `).join('');

    const bomCategoryBlocks = snapshot.bomCategories.map((category, catIndex) => {
        const rowsHtml = category.rows.map((row, rowIndex) => `
            <tr>
                <td contenteditable="true" data-rp-bom-cat="${catIndex}" data-rp-bom-row="${rowIndex}" data-rp-bom-col="name">${escapeReportPreviewHtml(row.name)}</td>
                <td class="num" contenteditable="true" data-rp-bom-cat="${catIndex}" data-rp-bom-row="${rowIndex}" data-rp-bom-col="qty">${escapeReportPreviewHtml(row.qty ?? row.qtyText)}</td>
                <td class="num" contenteditable="true" data-rp-bom-cat="${catIndex}" data-rp-bom-row="${rowIndex}" data-rp-bom-col="unit">${escapeReportPreviewHtml(row.unit || 'un')}</td>
                <td class="num" contenteditable="true" data-rp-bom-cat="${catIndex}" data-rp-bom-row="${rowIndex}" data-rp-bom-col="unitPrice">${escapeReportPreviewHtml(row.unitPriceText)}</td>
                <td class="num" contenteditable="true" data-rp-bom-cat="${catIndex}" data-rp-bom-row="${rowIndex}" data-rp-bom-col="total">${escapeReportPreviewHtml(row.totalText)}</td>
            </tr>
        `).join('');
        return `
            <div class="rp-subsection-title">${escapeReportPreviewHtml(category.title)}</div>
            <table class="rp-table">
                <thead>
                    <tr>
                        <th>Material</th>
                        <th class="num">Qtd.</th>
                        <th class="num">Un.</th>
                        <th class="num">Valor unit.</th>
                        <th class="num">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                    <tr class="subtotal">
                        <td colspan="4" style="text-align:right;">Subtotal</td>
                        <td class="num" contenteditable="true" data-rp-bom-subtotal="${catIndex}">${escapeReportPreviewHtml(category.subtotalText)}</td>
                    </tr>
                </tbody>
            </table>
        `;
    });

    const regionalHtml = snapshot.regionalLabor ? `
        <div class="rp-subsection-title">${escapeReportPreviewHtml(snapshot.regionalLabor.title)}</div>
        <div class="rp-detail-grid">${renderDetailRows(snapshot.regionalLabor.rows, 'regional')}</div>
    ` : '';

    const outsourcedHtml = snapshot.outsourcedLabor ? `
        <div class="rp-subsection-title" contenteditable="true" data-rp-outsourced-title="1">${escapeReportPreviewHtml(snapshot.outsourcedLabor.title)}</div>
        <table class="rp-table">
            <thead>
                <tr>
                    <th>Serviço</th>
                    <th class="num">Qtd.</th>
                    <th class="num">Un.</th>
                    <th class="num">Valor unit.</th>
                    <th class="num">Total</th>
                </tr>
            </thead>
            <tbody>
                ${snapshot.outsourcedLabor.rows.map((row, rowIndex) => `
                    <tr>
                        <td contenteditable="true" data-rp-outsourced-row="${rowIndex}" data-rp-outsourced-col="name">${escapeReportPreviewHtml(row.name)}</td>
                        <td class="num" contenteditable="true" data-rp-outsourced-row="${rowIndex}" data-rp-outsourced-col="qty">${escapeReportPreviewHtml(row.qty ?? row.qtyText)}</td>
                        <td class="num" contenteditable="true" data-rp-outsourced-row="${rowIndex}" data-rp-outsourced-col="unit">${escapeReportPreviewHtml(row.unit || 'un')}</td>
                        <td class="num" contenteditable="true" data-rp-outsourced-row="${rowIndex}" data-rp-outsourced-col="unitPrice">${escapeReportPreviewHtml(row.unitPriceText)}</td>
                        <td class="num" contenteditable="true" data-rp-outsourced-row="${rowIndex}" data-rp-outsourced-col="total">${escapeReportPreviewHtml(row.totalText)}</td>
                    </tr>
                `).join('')}
                <tr class="subtotal">
                    <td colspan="4" style="text-align:right;">Total terceirizada</td>
                    <td class="num" contenteditable="true" data-rp-outsourced-total="1">${escapeReportPreviewHtml(snapshot.outsourcedLabor.totalText)}</td>
                </tr>
            </tbody>
        </table>
    ` : '';

    //Capa: marca, empresa, projeto e local
    blocks.push(createReportPreviewFlowBlock(`
        <div class="rp-brand">
            <img class="rp-brand__logo" src="img/logo.png" alt="" width="34" height="34" />
            <div class="rp-brand__text">
                <strong>ROUTE MAP</strong>
                <span>${escapeReportPreviewHtml(snapshot.company || 'Redes de fibra óptica')}</span>
            </div>
            <div class="rp-brand__doc">
                <small>Relatório do projeto</small>
                <span contenteditable="true" data-rp-field="generatedAt">${escapeReportPreviewHtml(snapshot.generatedAt)}</span>
            </div>
        </div>
        <div class="rp-title" contenteditable="true" data-rp-field="title">${escapeReportPreviewHtml(snapshot.title)}</div>
        <div class="rp-meta">
            ${snapshot.locationLine ? `<span class="rp-chip" contenteditable="true" data-rp-field="location">${escapeReportPreviewHtml(snapshot.locationLine)}</span>` : ''}
            ${snapshot.author ? `<span class="rp-chip rp-chip--muted">Elaborado por <span contenteditable="true" data-rp-field="author">${escapeReportPreviewHtml(snapshot.author)}</span></span>` : ''}
        </div>
    `));

    blocks.push(createReportPreviewFlowBlock(`
        <div class="rp-section-title">Indicadores</div>
        <div class="rp-kpi-grid">${kpiHtml}</div>
    `, 'rp-avoid-break'));

    blocks.push(createReportPreviewFlowBlock(`
        <div class="rp-section-title">Rede e cobertura</div>
        <div class="rp-detail-grid">${renderDetailRows(snapshot.networkRows, 'network')}</div>
    `, 'rp-avoid-break'));

    if (snapshot.clientRows?.length) {
        blocks.push(createReportPreviewFlowBlock(`
            <div class="rp-section-title">Clientes</div>
            <div class="rp-detail-grid">${renderDetailRows(snapshot.clientRows, 'clients')}</div>
        `, 'rp-avoid-break'));
    }

    blocks.push(createReportPreviewFlowBlock(`
        <div class="rp-section-title">Materiais — resumo de custos</div>
        <div class="rp-detail-grid">${renderDetailRows(snapshot.materialRows, 'material')}</div>
    `, 'rp-avoid-break'));

    if (options.bom && snapshot.bomCategories.length) {
        blocks.push(createReportPreviewFlowBlock(`
            <div class="rp-section-title">Lista de materiais</div>
            <p class="rp-bom-hint">Quantitativos por categoria, com valor unitário e subtotais.</p>
        `, 'rp-avoid-break rp-keep-next'));

        bomCategoryBlocks.forEach((categoryHtml) => {
            blocks.push(createReportPreviewFlowBlock(categoryHtml, 'rp-avoid-break'));
        });

        if (snapshot.bomGrandTotalText) {
            blocks.push(createReportPreviewFlowBlock(`
                <table class="rp-table">
                    <tbody>
                        <tr class="grand-total">
                            <td colspan="4" style="text-align:right;">Total geral da lista de materiais</td>
                            <td class="num" contenteditable="true" data-rp-bom-grand-total="1">${escapeReportPreviewHtml(snapshot.bomGrandTotalText)}</td>
                        </tr>
                    </tbody>
                </table>
            `, 'rp-avoid-break'));
        }
    }

    blocks.push(createReportPreviewFlowBlock(`
        <div class="rp-section-title">Mão de obra</div>
        <div class="rp-detail-grid">${renderDetailRows(snapshot.laborRows, 'labor')}</div>
    `, 'rp-avoid-break'));

    if (options.labor) {
        if (regionalHtml) blocks.push(createReportPreviewFlowBlock(regionalHtml, 'rp-avoid-break'));
        if (outsourcedHtml) blocks.push(createReportPreviewFlowBlock(outsourcedHtml, 'rp-avoid-break'));
    }

    const share = snapshot.costShare;
    const stackHtml = share ? `
        <div class="rp-stack" aria-hidden="true">
            <span class="rp-stack__seg rp-stack__seg--mat" style="width:${Math.max(0, share.mat).toFixed(2)}%"></span>
            <span class="rp-stack__seg rp-stack__seg--lab" style="width:${Math.max(0, share.lab).toFixed(2)}%"></span>
            <span class="rp-stack__seg rp-stack__seg--coef" style="width:${Math.max(0, share.coef).toFixed(2)}%"></span>
        </div>
        <div class="rp-legend">
            <span><i class="rp-dot rp-dot--mat"></i>Materiais ${escapeReportPreviewHtml(share.matText)}</span>
            <span><i class="rp-dot rp-dot--lab"></i>Mão de obra ${escapeReportPreviewHtml(share.labText)}</span>
            <span><i class="rp-dot rp-dot--coef"></i>Coef. de segurança ${escapeReportPreviewHtml(share.coefText)}</span>
        </div>` : '';
    blocks.push(createReportPreviewFlowBlock(`
        <div class="rp-section-title">Resumo financeiro</div>
        ${stackHtml}
        <div class="rp-detail-grid">${renderDetailRows(snapshot.financialRows, 'financial', { highlightLast: true })}</div>
    `, 'rp-avoid-break'));

    if (options.notes) {
        const hasNotes = !!(snapshot.observations && snapshot.observations.trim());
        blocks.push(createReportPreviewFlowBlock(`
            <div class="rp-section-title">Observações</div>
            <div class="rp-observations${hasNotes ? '' : ' rp-observations--blank'}" contenteditable="plaintext-only" data-rp-field="observations" data-placeholder="Espaço para anotações — clique para escrever">${escapeReportPreviewHtml(snapshot.observations || '')}</div>
        `, 'rp-avoid-break'));
    }

    return blocks;
}

function renderReportPreviewHtml(snapshot) {
    const pagesRoot = getReportPreviewPagesRoot();
    if (!pagesRoot || !snapshot) return;

    const blocks = buildReportPreviewFlowBlocks(snapshot);

    layoutReportPreviewPages(blocks);
    requestAnimationFrame(() => {
        requestAnimationFrame(finalizeReportPreviewLayout);
    });
}

function readEditableText(selector) {
    return document.querySelector(selector)?.textContent.trim() || '';
}

function readReportPreviewSnapshotFromDom(baseSnapshot) {
    const snapshot = JSON.parse(JSON.stringify(baseSnapshot));

    snapshot.title = readEditableText('[data-rp-field="title"]') || snapshot.title;
    snapshot.locationLine = readEditableText('[data-rp-field="location"]') || snapshot.locationLine;
    snapshot.generatedAt = readEditableText('[data-rp-field="generatedAt"]') || snapshot.generatedAt;
    snapshot.author = readEditableText('[data-rp-field="author"]') || snapshot.author;
    //Observações: mantém as quebras de linha e aceita ficar vazia
    const notesEl = document.querySelector('[data-rp-field="observations"]');
    if (notesEl) snapshot.observations = (notesEl.innerText || '').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    snapshot.kpis.forEach((kpi, index) => {
        kpi.value = readEditableText(`[data-rp-kpi="${index}"]`) || kpi.value;
    });

    const readSectionRows = (sectionKey, rows) => {
        rows.forEach((row, index) => {
            row.value = readEditableText(`[data-rp-section="${sectionKey}"][data-rp-row="${index}"]`) || row.value;
        });
    };
    readSectionRows('network', snapshot.networkRows);
    if (snapshot.clientRows?.length) readSectionRows('clients', snapshot.clientRows);
    readSectionRows('material', snapshot.materialRows);
    readSectionRows('labor', snapshot.laborRows);
    readSectionRows('financial', snapshot.financialRows);
    if (snapshot.regionalLabor) {
        readSectionRows('regional', snapshot.regionalLabor.rows);
    }

    snapshot.bomCategories.forEach((category, catIndex) => {
        category.rows.forEach((row, rowIndex) => {
            const cell = (col) => document.querySelector(`[data-rp-bom-cat="${catIndex}"][data-rp-bom-row="${rowIndex}"][data-rp-bom-col="${col}"]`)?.textContent.trim();
            row.name = cell('name') || row.name;
            row.qty = cell('qty') || row.qty || row.qtyText;
            row.unit = cell('unit') || row.unit || 'un';
            row.unitPriceText = cell('unitPrice') || row.unitPriceText;
            row.totalText = cell('total') || row.totalText;
            delete row.qtyText;
        });
        category.subtotalText = readEditableText(`[data-rp-bom-subtotal="${catIndex}"]`) || category.subtotalText;
    });
    if (snapshot.bomGrandTotalText) {
        snapshot.bomGrandTotalText = readEditableText('[data-rp-bom-grand-total="1"]') || snapshot.bomGrandTotalText;
    }

    if (snapshot.outsourcedLabor) {
        snapshot.outsourcedLabor.title = readEditableText('[data-rp-outsourced-title="1"]') || snapshot.outsourcedLabor.title;
        snapshot.outsourcedLabor.rows.forEach((row, rowIndex) => {
            const cell = (col) => document.querySelector(`[data-rp-outsourced-row="${rowIndex}"][data-rp-outsourced-col="${col}"]`)?.textContent.trim();
            row.name = cell('name') || row.name;
            row.qty = cell('qty') || row.qty || row.qtyText;
            row.unit = cell('unit') || row.unit || 'un';
            row.unitPriceText = cell('unitPrice') || row.unitPriceText;
            row.totalText = cell('total') || row.totalText;
            delete row.qtyText;
        });
        snapshot.outsourcedLabor.totalText = readEditableText('[data-rp-outsourced-total="1"]') || snapshot.outsourcedLabor.totalText;
    }

    return snapshot;
}

let reportPreviewCurrentSnapshot = null;

function openReportPreviewModal() {
    const projectId = document.getElementById('report-project-details')?.dataset.currentProjectId;
    if (!projectId) {
        showAlert('Atenção', 'Selecione um projeto no relatório antes de exportar.');
        return;
    }

    const data = computeProjectReportData(projectId);
    if (!data) {
        showAlert('Erro', 'Não foi possível gerar os dados do relatório.');
        return;
    }

    reportPreviewOriginalSnapshot = createReportPreviewSnapshot(data);
    reportPreviewCurrentSnapshot = JSON.parse(JSON.stringify(reportPreviewOriginalSnapshot));
    syncReportOptionCheckboxes();
    document.getElementById('reportPreviewModal').style.display = 'flex';
    renderReportPreviewHtml(reportPreviewCurrentSnapshot);
}

function closeReportPreviewModal() {
    document.getElementById('reportPreviewModal').style.display = 'none';
}

function resetReportPreview() {
    if (!reportPreviewOriginalSnapshot) return;
    reportPreviewCurrentSnapshot = JSON.parse(JSON.stringify(reportPreviewOriginalSnapshot));
    syncReportOptionCheckboxes();
    renderReportPreviewHtml(reportPreviewCurrentSnapshot);
}

function syncReportOptionCheckboxes() {
    const options = reportPreviewCurrentSnapshot?.options || { bom: true, labor: true, notes: true };
    document.getElementById('rpOptBom').checked = !!options.bom;
    document.getElementById('rpOptLabor').checked = !!options.labor;
    document.getElementById('rpOptNotes').checked = !!options.notes;
}

//Liga/desliga seções do documento mantendo o que já foi editado
function handleReportOptionChange() {
    if (!reportPreviewCurrentSnapshot) return;
    const edited = readReportPreviewSnapshotFromDom(reportPreviewCurrentSnapshot);
    edited.options = {
        bom: document.getElementById('rpOptBom').checked,
        labor: document.getElementById('rpOptLabor').checked,
        notes: document.getElementById('rpOptNotes').checked,
    };
    reportPreviewCurrentSnapshot = edited;
    renderReportPreviewHtml(edited);
}

function setupReportOptions() {
    ['rpOptBom', 'rpOptLabor', 'rpOptNotes'].forEach((id) => {
        document.getElementById(id)?.addEventListener('change', handleReportOptionChange);
    });
    //Caixa de observações vazia mostra linhas para anotar; some ao digitar
    document.getElementById('reportPreviewPages')?.addEventListener('input', (event) => {
        const notes = event.target.closest?.('[data-rp-field="observations"]');
        if (notes) notes.classList.toggle('rp-observations--blank', !notes.innerText.trim());
    });
}

//Altura útil (em px) de uma página A4 no PDF, descontando as margens de exportação.
const REPORT_EXPORT_PAGE_MARGIN_TOP_MM = 14;
const REPORT_EXPORT_PAGE_MARGIN_BOTTOM_MM = 17;

function getReportExportContentCapacityPx() {
    const usableMm = REPORT_PREVIEW_PAGE_HEIGHT_MM
        - REPORT_EXPORT_PAGE_MARGIN_TOP_MM
        - REPORT_EXPORT_PAGE_MARGIN_BOTTOM_MM;
    //Pequena folga para evitar estouro por arredondamento de renderização.
    return Math.max(0, reportPreviewMmToPx(usableMm) - 8);
}

function buildReportPreviewExportFlow(snapshot, { forPdf = false } = {}) {
    const flow = document.createElement('div');
    flow.className = 'report-preview-page report-preview-export-flow';

    let blocks = buildReportPreviewFlowBlocks(snapshot);

    //Para o PDF, quebramos tabelas maiores que uma página em pedaços que caibam,
    //mantendo o título (ou "continuação") junto das linhas em cada pedaço.
    //Cada pedaço conserva a classe rp-avoid-break, então o html2pdf não separa
    //o título da sua tabela.
    if (forPdf) {
        const capacity = getReportExportContentCapacityPx();
        blocks = expandReportPreviewBlocksForLayout(blocks, capacity);
    }

    blocks.forEach((block) => {
        block.querySelectorAll('[contenteditable="true"]').forEach((el) => {
            el.removeAttribute('contenteditable');
        });
        flow.appendChild(block);
    });

    return flow;
}

//Cabeçalho (páginas 2+), rodapé com número de página e propriedades do arquivo
function decorateReportPdf(pdf, snapshot) {
    const total = pdf.internal.getNumberOfPages();
    const width = pdf.internal.pageSize.getWidth();
    const height = pdf.internal.pageSize.getHeight();
    const marginX = 16;
    const footerLabel = getReportFooterLabel(snapshot);
    for (let page = 1; page <= total; page++) {
        pdf.setPage(page);
        pdf.setLineWidth(0.2);
        pdf.setDrawColor(219, 229, 235);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(91, 116, 131);
        pdf.line(marginX, height - 12.5, width - marginX, height - 12.5);
        pdf.text(pdfText(footerLabel), marginX, height - 8.5);
        pdf.text(`Página ${page} de ${total}`, width - marginX, height - 8.5, { align: 'right' });
        if (page > 1) {
            pdf.text('ROUTE MAP · Relatório do projeto', marginX, 8);
            pdf.text(pdfText(snapshot.title || ''), width - marginX, 8, { align: 'right' });
            pdf.line(marginX, 10.2, width - marginX, 10.2);
        }
    }
    pdf.setProperties({
        title: `Relatório do projeto - ${snapshot.title || ''}`,
        subject: snapshot.locationLine || 'Relatório de projeto de rede',
        author: snapshot.author || 'ROUTE MAP',
        creator: 'ROUTE MAP',
    });
}

//O PDF é desenhado direto com jsPDF (texto de verdade): js/report-pdf.js

const REPORT_PREVIEW_WORD_STYLES = `
body { font-family: Segoe UI, Arial, sans-serif; font-size: 11pt; color: #16323f; line-height: 1.45; }
.rp-brand { margin: 0 0 10pt; }
.rp-brand__text strong { font-size: 13pt; color: #173f4e; }
.rp-brand__text span, .rp-brand__doc { font-size: 9pt; color: #5b7483; }
.rp-brand__doc small { display: block; font-size: 8pt; text-transform: uppercase; }
.rp-title { font-size: 20pt; font-weight: bold; color: #173f4e; margin: 6pt 0 4pt; }
.rp-chip { font-size: 9pt; color: #24586c; }
.rp-meta { margin: 0 0 8pt; }
.rp-subtitle { font-size: 10pt; color: #5b7483; margin: 0 0 2pt; }
.rp-section-title { font-size: 11pt; font-weight: bold; color: #173f4e; text-transform: uppercase; letter-spacing: 0.06em; margin: 14pt 0 8pt; border-bottom: 2px solid #2f7a94; padding-bottom: 4pt; }
.rp-subsection-title { font-size: 10pt; font-weight: bold; color: #24586c; margin: 8pt 0 4pt; }
.rp-bom-hint { font-size: 9pt; color: #5b7483; margin: 0 0 8pt; }
.rp-legend { font-size: 9pt; color: #5b7483; margin: 0 0 6pt; }
.rp-legend span { margin-right: 12pt; }
.rp-kpi-label { display: block; font-size: 8pt; color: #5b7483; font-weight: bold; text-transform: uppercase; margin-bottom: 4pt; }
.rp-kpi-value { display: block; font-size: 12pt; font-weight: bold; color: #16323f; }
.rp-kpi-primary .rp-kpi-value { color: #1f9d4a; }
.rp-observations { min-height: 48pt; padding: 8pt; border: 1px dashed #b8ccd6; border-radius: 6pt; font-size: 9pt; white-space: pre-wrap; background: #f5f8fa; }
.rp-table { width: 100%; border-collapse: collapse; margin-bottom: 10pt; font-size: 9pt; }
.rp-table th, .rp-table td { border: 1px solid #dbe5eb; padding: 4pt 5pt; }
.rp-table th { background: #173f4e; font-weight: bold; color: #ffffff; text-align: left; }
.rp-table td.num, .rp-table th.num { text-align: right; }
.rp-table tr.subtotal td { background: #e3f1f6; font-weight: bold; }
.rp-table tr.grand-total td { background: #173f4e; color: #ffffff; font-weight: bold; }
.rp-export-table { width: 100%; border-collapse: collapse; margin-bottom: 8pt; font-size: 10pt; }
.rp-export-table td { border: 1px solid #dbe5eb; padding: 6pt 8pt; vertical-align: top; }
.rp-export-detail td:last-child { text-align: right; color: #173f4e; font-weight: bold; }
`;

function convertReportPreviewGridsForWord(clone) {
    //Logo por caminho relativo e barras de proporção não entram no Word
    clone.querySelectorAll('.rp-brand__logo, .rp-stack').forEach((el) => el.remove());

    clone.querySelectorAll('.rp-kpi-grid').forEach((grid) => {
        const cards = [...grid.querySelectorAll('.rp-kpi-card')];
        if (!cards.length) return;
        const table = document.createElement('table');
        table.className = 'rp-export-table';
        const row = document.createElement('tr');
        cards.forEach((card) => {
            const cell = document.createElement('td');
            cell.innerHTML = card.innerHTML;
            row.appendChild(cell);
        });
        table.appendChild(row);
        grid.replaceWith(table);
    });

    clone.querySelectorAll('.rp-detail-grid').forEach((grid) => {
        const detailRows = [...grid.querySelectorAll('.rp-detail-row')];
        if (!detailRows.length) return;
        const table = document.createElement('table');
        table.className = 'rp-export-table rp-export-detail';
        detailRows.forEach((detailRow) => {
            const tr = document.createElement('tr');
            const labelCell = document.createElement('td');
            const valueCell = document.createElement('td');
            labelCell.innerHTML = detailRow.querySelector('strong')?.innerHTML || '';
            valueCell.innerHTML = detailRow.querySelector('span')?.innerHTML || '';
            tr.appendChild(labelCell);
            tr.appendChild(valueCell);
            table.appendChild(tr);
        });
        grid.replaceWith(table);
    });
}

function buildReportPreviewWordHtml(clone) {
    return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="utf-8">
<title>Relatório</title>
<style>${REPORT_PREVIEW_WORD_STYLES}</style>
</head>
<body>${clone.outerHTML}</body>
</html>`;
}

function downloadReportBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function getReportExportContext() {
    if (!reportPreviewCurrentSnapshot) return null;
    const pagesRoot = getReportPreviewPagesRoot();
    if (!pagesRoot || !pagesRoot.querySelector('.report-preview-page')) return null;
    const snapshot = readReportPreviewSnapshotFromDom(reportPreviewCurrentSnapshot);
    const slug = String(snapshot.projectCode || 'projeto')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'projeto';
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return { pagesRoot, snapshot, baseName: `Relatorio_${slug}_${stamp}` };
}

function setReportPreviewExportButtonsBusy(isBusy, activeButton, busyLabel) {
    ['confirmReportPdfExportButton', 'confirmReportWordExportButton'].forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (!btn.dataset.defaultLabel) {
            btn.dataset.defaultLabel = btn.textContent;
        }
        btn.disabled = isBusy;
        if (isBusy && btn === activeButton) {
            btn.textContent = busyLabel;
        } else if (!isBusy) {
            btn.textContent = btn.dataset.defaultLabel;
        }
    });
}

async function confirmReportPdfExport() {
    const context = getReportExportContext();
    if (!context) return;
    if (!window.jspdf?.jsPDF) {
        showAlert('Erro', 'Biblioteca de PDF não carregada. Recarregue a página e tente novamente.');
        return;
    }

    const exportBtn = document.getElementById('confirmReportPdfExportButton');
    const filename = `${context.baseName}.pdf`;
    setReportPreviewExportButtonsBusy(true, exportBtn, 'Gerando PDF...');
    showToast('Gerando PDF', 'Montando as páginas do relatório…', 'progress');

    try {
        const pages = await exportReportPdfNative(context.snapshot, filename);
        closeReportPreviewModal();
        showToast('PDF gerado', `${filename} · ${pages} ${pages === 1 ? 'página' : 'páginas'}`);
    } catch (err) {
        console.error('Erro ao exportar relatório PDF:', err);
        const detail = err?.message ? `\n\nDetalhe: ${err.message}` : '';
        showAlert('Erro', `Não foi possível gerar o PDF.${detail}`);
    } finally {
        setReportPreviewExportButtonsBusy(false);
    }
}

function confirmReportWordExport() {
    const context = getReportExportContext();
    if (!context) return;

    const exportBtn = document.getElementById('confirmReportWordExportButton');
    setReportPreviewExportButtonsBusy(true, exportBtn, 'Gerando Word...');

    try {
        const clone = buildReportPreviewExportFlow(context.snapshot);
        convertReportPreviewGridsForWord(clone);
        const html = buildReportPreviewWordHtml(clone);
        const filename = `${context.baseName}.docx`;

        if (typeof htmlDocx !== 'undefined' && typeof htmlDocx.asBlob === 'function') {
            const blob = htmlDocx.asBlob(html);
            downloadReportBlob(blob, filename);
        } else {
            const fallbackBlob = new Blob(['\ufeff', html], { type: 'application/msword' });
            downloadReportBlob(fallbackBlob, `${context.baseName}.doc`);
            showAlert('Aviso', 'O arquivo foi gerado como .doc (Word). Se preferir .docx, recarregue a página e tente novamente.');
        }
        closeReportPreviewModal();
    } catch (err) {
        console.error('Erro ao exportar relatório Word:', err);
        showAlert('Erro', 'Não foi possível gerar o Word. Verifique o console (F12) para mais detalhes.');
    } finally {
        setReportPreviewExportButtonsBusy(false);
    }
}

function showProjectReportDetails(projectId, projectName) {
    document.getElementById('report-project-details').dataset.currentProjectId = projectId;

    const data = computeProjectReportData(projectId);
    if (!data) {
        showAlert('Erro', 'Não foi possível gerar o relatório deste projeto.');
        return;
    }

    const root = document.getElementById('report-project-details');
    const money = formatPdfCurrency;
    const setById = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const setRv = (key, text) => root.querySelectorAll(`[data-rv="${key}"]`).forEach((el) => { el.textContent = text; });
    const q = data.quantities;

    document.getElementById('reportModalTitle').textContent = 'Relatório do projeto';
    setById('report-title', projectName);
    const subtitleParts = [data.city, data.neighborhood].filter(Boolean);
    setById('report-subtitle', subtitleParts.join(' · ') || 'Sem informações de localização');
    setById('report-type', data.projectType || 'TCR');

    setById('report-kpi-final-cost', money(data.finalCost));
    setById('report-kpi-new-ports', String(data.novasPortas));
    setById('report-kpi-cable', `${q.cableLength} m`);
    setById('report-kpi-duration', `${data.prazoEstimado} dias`);

    setRv('neighborhood', data.neighborhood || 'N/A');
    setRv('houses', String(data.totalCasas));
    setRv('existingPorts', String(data.portasExistentes));
    setRv('newPorts', String(data.novasPortas));
    setRv('totalPorts', String(data.totalPortas));
    setRv('penetration', `${data.penetrationRate.toFixed(2).replace('.', ',')}%`);
    document.getElementById('rv-penetration-bar').style.width = `${Math.min(100, data.penetrationRate)}%`;

    setRv('cableLength', `${q.cableLength} m`);
    setRv('posts', String(data.postCount || 0));
    setRv('ctos', String(q.ctoCount || 0));
    setRv('ceos', String(q.ceoCount || 0));
    setRv('reservas', String(q.reservaCount || 0));
    setRv('cordoalhas', String(q.cordoalhaCount || 0));

    //Materiais: barra proporcional ao peso de cada categoria
    const mc = data.materialCosts;
    const categories = [
        { label: 'Ferragens', value: mc.ferragemTotal, color: '#b45309' },
        { label: 'Cabos', value: mc.cabosTotal, color: '#2563eb' },
        { label: 'Fusão', value: mc.fusaoTotal, color: '#7c3aed' },
        { label: 'Data Center', value: mc.datacenterTotal, color: '#0f766e' },
    ];
    const materialsTotal = categories.reduce((sum, c) => sum + c.value, 0) || 1;
    document.getElementById('rv-material-bars').innerHTML = categories.map((c) => `
        <li style="--bar:${c.color}">
            <div class="rv-bars__head"><span>${c.label}</span><strong>${money(c.value)}</strong></div>
            <div class="rv-bars__track"><span style="width:${((c.value / materialsTotal) * 100).toFixed(1)}%"></span></div>
        </li>`).join('');
    setRv('materialCost', money(data.materialCost));

    setRv('regionalLabor', money(data.laborCosts.regionalCost));
    setRv('outsourcedLabor', money(data.laborCosts.outsourcedCost));
    setRv('laborCost', money(data.laborCost));
    const laborDetail = document.getElementById('rv-labor-detail');
    if (data.regionalLaborDetails) {
        const rd = data.regionalLaborDetails;
        setRv('laborDetail', `${rd.techs} técnico(s) · ${rd.days} dia(s)`);
        laborDetail.hidden = false;
    } else {
        laborDetail.hidden = true;
    }

    const clientsCard = document.getElementById('rv-clients-card');
    clientsCard.hidden = !data.clients.total;
    setRv('clientsTotal', String(data.clients.total));
    setRv('clientsB2b', String(data.clients.b2b));
    setRv('clientsPredial', String(data.clients.predial ?? 0));
    setRv('clientsViab', String(data.clients.viabilidade));
    setRv('clientsInstall', String(data.clients.aInstalar));
    setRv('clientsDone', String(data.clients.instalado));

    //Composição do custo final
    const base = (data.materialCost + data.laborCost + data.safetyCoef) || 1;
    document.getElementById('rv-stack-mat').style.width = `${(data.materialCost / base) * 100}%`;
    document.getElementById('rv-stack-lab').style.width = `${(data.laborCost / base) * 100}%`;
    document.getElementById('rv-stack-coef').style.width = `${(data.safetyCoef / base) * 100}%`;
    setRv('safetyCoef', money(data.safetyCoef));
    setRv('totalCost', money(data.totalCost));
    setRv('costPerPort', money(data.costPerPort));
    setRv('duration', `${data.prazoEstimado} dias`);
    setRv('finalCost', money(data.finalCost));

    renderReportObservations(data.observations);

    document.getElementById("report-project-list").classList.add("hidden");
    document.getElementById("report-project-details").classList.remove("hidden");
    document.querySelector('#reportModal .report-modal').classList.add('is-details');
    root.querySelector('.report-details-body').scrollTop = 0;
}

//Atualiza a posição da caixa
function updateInfoBoxPosition(e) {
    if (!cableInfoBox) return;
    const xOffset = 15;
    const yOffset = 15;
    cableInfoBox.style.left = `${e.clientX + xOffset}px`;
    cableInfoBox.style.top = `${e.clientY + yOffset}px`;
}

//Adiciona efeitos na linha dos cabos - infobox
function getCableInfoByPolyline(polyline) {
    if (!polyline) return null;
    return savedCables.find((cable) => cable.polyline === polyline) || null;
}

function addCableEventListeners(polyline) {
    let originalOptions = {
        strokeWeight: polyline.get('strokeWeight'),
        zIndex: polyline.get('zIndex') || 1
    };
    const mapDiv = document.getElementById('map');
    polyline.addListener('mouseover', function() {
        const cableData = getCableInfoByPolyline(this);
        if (!cableData || !cableData.polyline.getVisible()) return;
        originalOptions = {
            strokeWeight: polyline.get('strokeWeight'),
            zIndex: polyline.get('zIndex') || 1
        };
        this.setOptions({
            strokeWeight: (originalOptions.strokeWeight || 3) + 3,
            zIndex: 100
        });
        cableInfoBox.innerHTML = buildCableHoverHtml(cableData);
        cableInfoBox.classList.remove('hidden');
        mapDiv.addEventListener('mousemove', updateInfoBoxPosition);
    });
    polyline.addListener('mouseout', function() {
        this.setOptions(originalOptions);
        cableInfoBox.classList.add('hidden');
        mapDiv.removeEventListener('mousemove', updateInfoBoxPosition);
    });
}

//Funcionalidade de busca
function performStructuredSearch() {
    const coordinatesQuery = document.getElementById('searchCoordinates').value.trim();
    document.getElementById('searchModal').style.display = 'none';
    if (coordinatesQuery) {
        const coordRegex = /^[-]?\d+(\.\d+)?,\s*[-]?\d+(\.\d+)?$/;
        if (coordRegex.test(coordinatesQuery)) {
                const parts = coordinatesQuery.split(',');
                const lat = parseFloat(parts[0]);
                const lng = parseFloat(parts[1]);
            if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                showAlert('Coordenada Inválida', 'Por favor, insira uma latitude (-90 a 90) e longitude (-180 a 180) válidas.');
                return;
            }
            const location = new google.maps.LatLng(lat, lng);
            panToLocation(location, `Coordenadas: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        } else {
            showAlert('Formato Inválido', 'O formato das coordenadas deve ser "latitude, longitude", por exemplo: "-20.13, -44.88".');
        }
    } else {
        showAlert('Dados Insuficientes', 'Por favor, insira as coordenadas para a busca. A busca por endereço está temporariamente desabilitada.');
    }
}

//No local da procura
function panToLocation(location, title) {
    map.setCenter(location);
    map.setZoom(18);
    // Remove o marcador de busca anterior, se existir
    if (searchMarker) {
        searchMarker.setMap(null);
    }
    // Cria um novo marcador para o resultado da busca
    searchMarker = new google.maps.Marker({
        position: location,
        map: map,
        title: title,
        animation: google.maps.Animation.DROP,
    });
    const infowindow = new google.maps.InfoWindow({
        content: `<b>Resultado da Busca:</b><br>${title}`
    });
    infowindow.open(map, searchMarker);
    //Cria uma função de limpeza
    const clearSearchMarker = () => {
        if (searchMarker) {
            searchMarker.setMap(null);
            searchMarker = null;
        }
    };
    // Se o usuário clicar em qualquer lugar do mapa, o marcador some
    google.maps.event.addListenerOnce(map, 'click', clearSearchMarker);
    // Se o usuário fechar a janela, o marcador some
    google.maps.event.addListenerOnce(infowindow, 'closeclick', clearSearchMarker);
}

//Ferramentas de esboço no mapa (polígono e régua).
//Substituem a Drawing Library do Google, que foi descontinuada e removida da API.
const RULER_COLOR = '#e11d48';
const DEFAULT_POLYGON_COLOR = '#2dd4bf';
const DEFAULT_POLYGON_OPACITY = 0.35;
let sketchSession = null; //Sessão de desenho ativa: { shape, color, vertices, line, fill, rubber, labels, listeners }
let rulerMode = 'distance'; //'distance' ou 'area'
let polygonEditListeners = []; //Listeners do path do polígono em edição

function formatDistance(meters) {
    const m = Number(meters) || 0;
    if (m >= 1000) {
        return `${(m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
    }
    return `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m`;
}

//Área sempre em metros quadrados (ex.: 12.480 m²)
function formatArea(squareMeters) {
    const m2 = Number(squareMeters) || 0;
    return `${Math.round(m2).toLocaleString('pt-BR')} m²`;
}

//Rótulo de texto HTML preso a uma coordenada do mapa
function createMapTextLabel(position, text, className) {
    const overlay = new google.maps.OverlayView();
    const div = document.createElement('div');
    div.className = `map-text-label ${className || ''}`.trim();
    div.textContent = text;
    overlay.onAdd = function () { this.getPanes().floatPane.appendChild(div); };
    overlay.draw = function () {
        const point = this.getProjection()?.fromLatLngToDivPixel(position);
        if (!point) return;
        div.style.left = `${point.x}px`;
        div.style.top = `${point.y}px`;
    };
    overlay.onRemove = function () { div.remove(); };
    overlay.setMap(map);
    return overlay;
}

function setAllCablesClickable(isClickable) {
    savedCables.forEach(cableInfo => {
        if (cableInfo.polyline) cableInfo.polyline.setOptions({ clickable: isClickable });
    });
}

function isSketchToolActive() {
    return !!sketchSession;
}

function getSketchVertexIcon(color, isFirstClosable) {
    return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: isFirstClosable ? 7 : 5,
        fillColor: isFirstClosable ? color : '#ffffff',
        fillOpacity: 1,
        strokeColor: isFirstClosable ? '#ffffff' : color,
        strokeWeight: 2
    };
}

//Inicia uma sessão de desenho por cliques. shape: 'line' ou 'area'.
function startSketch(options) {
    stopSketch();
    const color = options.color;
    const session = {
        shape: options.shape,
        color,
        showSegmentLabels: !!options.showSegmentLabels,
        onChange: options.onChange || null,
        onClose: options.onClose || null,
        vertices: [],
        labels: [],
        listeners: [],
        lastCursor: null
    };
    session.line = new google.maps.Polyline({
        map, path: [], clickable: false, strokeColor: color, strokeWeight: 3, strokeOpacity: 0.95, zIndex: 2000
    });
    session.fill = new google.maps.Polygon({
        map: null, paths: [], clickable: false, strokeWeight: 0,
        fillColor: color, fillOpacity: options.fillOpacity ?? 0.22, zIndex: 1999
    });
    session.rubber = new google.maps.Polyline({
        map, path: [], clickable: false, strokeColor: color, strokeOpacity: 0, zIndex: 2000,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, scale: 2 }, offset: '0', repeat: '9px' }]
    });
    session.listeners.push(map.addListener('click', (e) => addSketchPoint(e.latLng)));
    session.listeners.push(map.addListener('mousemove', (e) => updateSketchRubber(e.latLng)));
    session.listeners.push(map.addListener('mouseout', () => updateSketchRubber(null)));
    sketchSession = session;
    setAllPolygonsClickable(false);
    setAllCablesClickable(false);
    setMapCursor('crosshair');
    refreshSketch(true);
    return session;
}

function getSketchPath() {
    return sketchSession ? sketchSession.vertices.map(v => v.getPosition()) : [];
}

function addSketchPoint(latLng) {
    const session = sketchSession;
    if (!session || !latLng) return;
    const last = session.vertices[session.vertices.length - 1];
    if (last && google.maps.geometry.spherical.computeDistanceBetween(last.getPosition(), latLng) < 0.5) return;
    const vertex = new google.maps.Marker({
        position: latLng,
        map,
        draggable: true,
        zIndex: 3000,
        icon: getSketchVertexIcon(session.color, false)
    });
    vertex.addListener('drag', () => refreshSketch(false));
    vertex.addListener('dragend', () => refreshSketch(true));
    vertex.addListener('rightclick', (e) => {
        if (e?.domEvent) e.domEvent.preventDefault();
        removeSketchVertex(vertex);
    });
    vertex.addListener('click', () => {
        //Clicar no primeiro ponto fecha a área
        if (session.shape === 'area' && session.vertices[0] === vertex && session.vertices.length >= 3 && session.onClose) {
            session.onClose();
        }
    });
    session.vertices.push(vertex);
    refreshSketch(true);
}

function removeSketchVertex(vertex) {
    const session = sketchSession;
    if (!session) return;
    const index = session.vertices.indexOf(vertex);
    if (index === -1) return;
    session.vertices.splice(index, 1)[0].setMap(null);
    refreshSketch(true);
}

function undoSketchPoint() {
    const session = sketchSession;
    if (!session || !session.vertices.length) return false;
    session.vertices.pop().setMap(null);
    refreshSketch(true);
    return true;
}

function clearSketchPoints() {
    const session = sketchSession;
    if (!session) return;
    session.vertices.forEach(v => v.setMap(null));
    session.vertices = [];
    refreshSketch(true);
}

function setSketchShape(shape) {
    if (!sketchSession) return;
    sketchSession.shape = shape;
    refreshSketch(true);
}

//Redesenha linha, área, rótulos e linha-guia a partir dos vértices
function refreshSketch(updateIcons) {
    const session = sketchSession;
    if (!session) return;
    const path = getSketchPath();
    const isClosedArea = session.shape === 'area' && path.length >= 3;
    session.line.setPath(isClosedArea ? [...path, path[0]] : path);
    session.fill.setPaths(path);
    session.fill.setMap(isClosedArea ? map : null);
    if (updateIcons) {
        session.vertices.forEach((v, i) => {
            v.setIcon(getSketchVertexIcon(session.color, isClosedArea && i === 0 && !!session.onClose));
            v.setTitle(isClosedArea && i === 0 && session.onClose ? 'Clique para fechar a forma' : 'Arraste para ajustar · clique direito remove');
        });
    }
    renderSketchSegmentLabels(path, isClosedArea);
    updateSketchRubber(session.lastCursor);
    if (session.onChange) session.onChange(path);
}

function renderSketchSegmentLabels(path, isClosedArea) {
    const session = sketchSession;
    session.labels.forEach(label => label.setMap(null));
    session.labels = [];
    if (!session.showSegmentLabels || path.length < 2) return;
    const segments = [];
    for (let i = 1; i < path.length; i++) segments.push([path[i - 1], path[i]]);
    if (isClosedArea) segments.push([path[path.length - 1], path[0]]);
    segments.forEach(([a, b]) => {
        const length = google.maps.geometry.spherical.computeDistanceBetween(a, b);
        const midpoint = google.maps.geometry.spherical.interpolate(a, b, 0.5);
        session.labels.push(createMapTextLabel(midpoint, formatDistance(length), 'map-text-label--segment'));
    });
}

//Linha tracejada do último ponto até o cursor
function updateSketchRubber(cursorLatLng) {
    const session = sketchSession;
    if (!session) return;
    session.lastCursor = cursorLatLng;
    const path = getSketchPath();
    if (!cursorLatLng || !path.length) {
        session.rubber.setPath([]);
        if (session.onCursor) session.onCursor(null);
        return;
    }
    const rubberPath = [path[path.length - 1], cursorLatLng];
    if (session.shape === 'area' && path.length >= 2) rubberPath.push(path[0]);
    session.rubber.setPath(rubberPath);
    if (session.onCursor) session.onCursor(cursorLatLng);
}

function stopSketch() {
    const session = sketchSession;
    if (!session) return;
    session.listeners.forEach(listener => google.maps.event.removeListener(listener));
    session.vertices.forEach(v => v.setMap(null));
    session.labels.forEach(label => label.setMap(null));
    session.line.setMap(null);
    session.fill.setMap(null);
    session.rubber.setMap(null);
    sketchSession = null;
    setAllPolygonsClickable(true);
    setAllCablesClickable(true);
    setMapCursor('');
}

//Clique em marcador durante o esboço: usa a posição exata do marcador como ponto
function handleSketchMarkerClick(markerInfo) {
    if (!sketchSession || !markerInfo?.marker) return false;
    addSketchPoint(markerInfo.marker.getPosition());
    return true;
}

function handleSketchKeyboard(event) {
    if (!sketchSession || isEditableKeyboardTarget(event.target)) return false;
    const key = event.key.toLowerCase();
    const isUndo = ((event.ctrlKey || event.metaKey) && key === 'z') || key === 'backspace' || key === 'delete';
    if (!isUndo) return false;
    event.preventDefault();
    undoSketchPoint();
    return true;
}

// ---------------------------------------------------------------
// Polígono
// ---------------------------------------------------------------

function getPolygonFormValues() {
    const opacityInput = document.getElementById('polygonOpacity');
    return {
        name: document.getElementById('polygonName').value.trim(),
        color: document.getElementById('polygonColor').value,
        opacity: Math.min(1, Math.max(0, Number(opacityInput.value) / 100))
    };
}

function setPolygonBoxPhase(phase) {
    //phase: 'drawing' (marcando pontos) ou 'editing' (forma fechada, ajustando vértices)
    const box = document.getElementById('polygonDrawingBox');
    box.dataset.phase = phase;
    document.getElementById('polygonUndoButton').classList.toggle('hidden', phase !== 'drawing');
    document.getElementById('polygonFinishButton').classList.toggle('hidden', phase !== 'drawing');
    document.getElementById('polygonHelp').textContent = phase === 'drawing'
        ? 'Clique no mapa para marcar os vértices. Clique no primeiro ponto ou em "Fechar forma" para concluir. Clique direito remove um ponto.'
        : 'Arraste os vértices para ajustar. Arraste os pontos intermediários para criar novos vértices.';
}

function updatePolygonStats(path) {
    const statsEl = document.getElementById('polygonStats');
    if (!statsEl) return;
    const points = path ? (Array.isArray(path) ? path : path.getArray()) : [];
    if (points.length < 3) {
        statsEl.innerHTML = `<div><dt>Vértices</dt><dd>${points.length}</dd></div><div><dt>Área</dt><dd>—</dd></div><div><dt>Perímetro</dt><dd>—</dd></div>`;
        document.getElementById('polygonFinishButton').disabled = true;
        return;
    }
    const area = google.maps.geometry.spherical.computeArea(points);
    const perimeter = google.maps.geometry.spherical.computeLength([...points, points[0]]);
    statsEl.innerHTML = `<div><dt>Vértices</dt><dd>${points.length}</dd></div><div><dt>Área</dt><dd>${formatArea(area)}</dd></div><div><dt>Perímetro</dt><dd>${formatDistance(perimeter)}</dd></div>`;
    document.getElementById('polygonFinishButton').disabled = false;
}

function clearPolygonEditListeners() {
    polygonEditListeners.forEach(listener => google.maps.event.removeListener(listener));
    polygonEditListeners = [];
}

//Mantém a área e o perímetro atualizados enquanto os vértices são arrastados
function watchPolygonPath(polygon) {
    clearPolygonEditListeners();
    const path = polygon.getPath();
    const update = () => updatePolygonStats(path);
    ['insert_at', 'set_at', 'remove_at'].forEach(evt => polygonEditListeners.push(path.addListener(evt, update)));
    update();
}

const POLYGON_SWATCHES = ['#2dd4bf', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#64748b'];

function renderPolygonSwatches() {
    const wrap = document.getElementById('polygonSwatches');
    if (!wrap) return;
    wrap.innerHTML = POLYGON_SWATCHES.map(color => `<button type="button" class="pg-swatch" data-color="${color}" role="radio" style="--swatch:${color}" title="${color}" aria-label="Cor ${color}"></button>`).join('');
    wrap.querySelectorAll('.pg-swatch').forEach(button => button.addEventListener('click', () => {
        document.getElementById('polygonColor').value = button.dataset.color;
        applyPolygonFormStyle();
    }));
}

function syncPolygonStyleControls(color, opacity) {
    document.querySelectorAll('#polygonSwatches .pg-swatch').forEach(button => {
        const active = button.dataset.color.toLowerCase() === String(color).toLowerCase();
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    document.getElementById('polygonOpacityValue').textContent = `${Math.round(opacity * 100)}%`;
    const preview = document.getElementById('polygonFillPreview');
    if (preview) {
        preview.style.setProperty('--fill-color', color);
        preview.style.setProperty('--fill-opacity', String(opacity));
    }
    const range = document.getElementById('polygonOpacity');
    range?.style.setProperty('--fill', `${Math.round(opacity * 100)}%`);
    range?.style.setProperty('--track-color', color);
}

//Aplica cor e opacidade do formulário no polígono em edição (mapa e ícone da barra lateral, ao vivo)
function applyPolygonFormStyle() {
    const { color, opacity } = getPolygonFormValues();
    syncPolygonStyleControls(color, opacity);
    const editingInfo = editingPolygonIndex !== null ? savedPolygons[editingPolygonIndex] : null;
    const target = tempPolygon || editingInfo?.polygonObject || null;
    if (target) target.setOptions({ fillColor: color, strokeColor: color, fillOpacity: opacity });
    editingInfo?.listItem?.querySelector('.ge-icon-polygon')?.style.setProperty('--ge-item-color', color);
    if (sketchSession && isDrawingPolygon) {
        sketchSession.color = color;
        sketchSession.line.setOptions({ strokeColor: color });
        sketchSession.fill.setOptions({ fillColor: color, fillOpacity: opacity });
        sketchSession.rubber.setOptions({ strokeColor: color });
        refreshSketch(true);
    }
}

function openPolygonBox(title, values) {
    const box = document.getElementById('polygonDrawingBox');
    document.getElementById('polygonBoxTitle').textContent = title;
    document.getElementById('polygonName').value = values.name;
    document.getElementById('polygonColor').value = values.color;
    document.getElementById('polygonOpacity').value = Math.round(values.opacity * 100);
    syncPolygonStyleControls(values.color, values.opacity);
    box.classList.remove('hidden');
    document.getElementById('toolsDropdown').classList.remove('show');
}

//Inicia a ferramenta de desenho de polígono
function startPolygonTool(initialPath) {
    if (!requireEdit('desenhar polígonos')) return;
    if (isDrawingCable || isAddingMarker) {
        showAlert("Atenção", "Finalize a ação atual antes de desenhar um polígono.");
        return;
    }
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione uma pasta de projeto para salvar o polígono.");
        return;
    }
    if (isMeasuring) stopRuler();
    cancelPolygonDrawing();
    isDrawingPolygon = true;
    editingPolygonIndex = null;
    openPolygonBox('Novo polígono', {
        name: `Polígono ${savedPolygons.length + 1}`,
        color: DEFAULT_POLYGON_COLOR,
        opacity: DEFAULT_POLYGON_OPACITY
    });
    document.getElementById('deletePolygonButton').classList.add('hidden');
    setPolygonBoxPhase('drawing');
    startSketch({
        shape: 'area',
        color: DEFAULT_POLYGON_COLOR,
        fillOpacity: DEFAULT_POLYGON_OPACITY,
        showSegmentLabels: false,
        onChange: updatePolygonStats,
        onClose: finishPolygonSketch
    });
    if (Array.isArray(initialPath)) {
        initialPath.forEach(point => addSketchPoint(point));
        if (initialPath.length >= 3) finishPolygonSketch();
    }
}

//Fecha a forma desenhada e passa para o ajuste dos vértices
function finishPolygonSketch() {
    const path = getSketchPath();
    if (path.length < 3) {
        showAlert("Atenção", "Marque pelo menos 3 pontos para formar um polígono.");
        return false;
    }
    const { color, opacity } = getPolygonFormValues();
    stopSketch();
    if (tempPolygon) tempPolygon.setMap(null);
    tempPolygon = new google.maps.Polygon({
        paths: path,
        map,
        fillColor: color,
        strokeColor: color,
        fillOpacity: opacity,
        strokeWeight: 2,
        editable: true,
        zIndex: 1
    });
    setAllPolygonsClickable(false);
    watchPolygonPath(tempPolygon);
    setPolygonBoxPhase('editing');
    return true;
}

function wirePolygonInteractions(polygonInfo) {
    polygonInfo.polygonObject.addListener('click', () => openPolygonEditor(polygonInfo));
    const nameEl = polygonInfo.listItem.querySelector('.item-name');
    if (nameEl) nameEl.addEventListener('click', () => openPolygonEditor(polygonInfo));
    const visCb = polygonInfo.listItem.querySelector('.ge-vis-checkbox');
    if (visCb) wireItemVisibilityCheckbox(visCb, polygonInfo.polygonObject);
}

//Salva um polígono novo ou atualiza um existente
function savePolygon() {
    const { name, color, opacity } = getPolygonFormValues();
    if (!name) {
        showAlert("Erro", "Por favor, dê um nome ao polígono.");
        return;
    }
    //Se ainda está marcando pontos, fecha a forma automaticamente
    if (sketchSession && isDrawingPolygon && !finishPolygonSketch()) return;

    if (editingPolygonIndex !== null) {
        const polygonInfo = savedPolygons[editingPolygonIndex];
        const polygon = polygonInfo.polygonObject;
        polygonInfo.name = name;
        polygonInfo.color = color;
        polygonInfo.opacity = opacity;
        polygonInfo.path = polygon.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() }));
        polygon.setOptions({ fillColor: color, strokeColor: color, fillOpacity: opacity, editable: false });
        refreshPolygonSidebarLabel(polygonInfo);
        editingPolygonIndex = null; //Evita que o cancelamento reverta o que foi salvo
    } else {
        if (!tempPolygon) {
            showAlert("Erro", "Desenhe um polígono no mapa antes de salvar.");
            return;
        }
        const polygon = tempPolygon;
        tempPolygon = null;
        polygon.setOptions({ clickable: true, editable: false, fillColor: color, strokeColor: color, fillOpacity: opacity });
        const template = document.getElementById('polygon-template');
        const li = template.content.cloneNode(true).querySelector('li');
        enableDragAndDropForItem(li);
        document.getElementById(activeFolderId).appendChild(li);
        const polygonInfo = {
            folderId: activeFolderId,
            name,
            color,
            opacity,
            path: polygon.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() })),
            polygonObject: polygon,
            listItem: li
        };
        savedPolygons.push(polygonInfo);
        refreshPolygonSidebarLabel(polygonInfo);
        wirePolygonInteractions(polygonInfo);
    }
    cancelPolygonDrawing();
}

//Abre o editor do polígono (aceita o objeto ou o índice)
function openPolygonEditor(polygonRef) {
    const polygonInfo = typeof polygonRef === 'number' ? savedPolygons[polygonRef] : polygonRef;
    if (!polygonInfo) return;
    if (!AppSession.canEdit) {
        const area = google.maps.geometry.spherical.computeArea(polygonInfo.polygonObject.getPath());
        showToast(polygonInfo.name || 'Polígono', `Área ${formatArea(area)}`, 'progress');
        return;
    }
    const index = savedPolygons.indexOf(polygonInfo);
    if (index === -1) {
        showAlert("Erro", "Não foi possível encontrar o polígono para edição.");
        return;
    }
    if (isMeasuring) stopRuler();
    cancelPolygonDrawing();
    cancelCableButton.click();
    editingPolygonIndex = index;
    isDrawingPolygon = true;
    //Guarda o estado original para poder cancelar
    polygonInfo._originalStyle = { color: polygonInfo.color, opacity: polygonInfo.opacity ?? 0.5 };
    openPolygonBox('Editar polígono', {
        name: polygonInfo.name,
        color: polygonInfo.color,
        opacity: polygonInfo.opacity ?? 0.5
    });
    document.getElementById('deletePolygonButton').classList.remove('hidden');
    setPolygonBoxPhase('editing');
    setAllPolygonsClickable(false);
    polygonInfo.polygonObject.setEditable(true);
    watchPolygonPath(polygonInfo.polygonObject);
}

//Cancela o desenho ou a edição de polígono
function cancelPolygonDrawing() {
    if (sketchSession && isDrawingPolygon) stopSketch();
    clearPolygonEditListeners();
    if (tempPolygon) {
        tempPolygon.setMap(null);
        tempPolygon = null;
    }
    //Reverte a edição não salva
    if (editingPolygonIndex !== null) {
        const polygonInfo = savedPolygons[editingPolygonIndex];
        if (polygonInfo) {
            const original = polygonInfo._originalStyle || { color: polygonInfo.color, opacity: polygonInfo.opacity ?? 0.5 };
            polygonInfo.polygonObject.setPath(polygonInfo.path);
            polygonInfo.polygonObject.setEditable(false);
            polygonInfo.polygonObject.setOptions({ fillColor: original.color, strokeColor: original.color, fillOpacity: original.opacity });
            polygonInfo.listItem?.querySelector('.ge-icon-polygon')?.style.setProperty('--ge-item-color', original.color);
        }
    }
    document.getElementById('polygonDrawingBox').classList.add('hidden');
    setAllPolygonsClickable(true);
    setMapCursor("");
    isDrawingPolygon = false;
    editingPolygonIndex = null;
}

//Controle de cliques em polígonos, desenhos sobre o polígono
function setAllPolygonsClickable(isClickable) {
    savedPolygons.forEach(polygonInfo => {
        if (polygonInfo.polygonObject) {
            polygonInfo.polygonObject.setOptions({ clickable: isClickable });
        }
    });
}

//Exclui o polígono que está sendo editado
function deletePolygon() {
    if (editingPolygonIndex === null) return;
    const polygonInfo = savedPolygons[editingPolygonIndex];
    showConfirm('Excluir Polígono', `Tem certeza que deseja excluir "${polygonInfo.name}"?`, () => {
        clearPolygonEditListeners();
        polygonInfo.polygonObject.setMap(null);
        polygonInfo.listItem.remove();
        savedPolygons.splice(savedPolygons.indexOf(polygonInfo), 1);
        editingPolygonIndex = null;
        cancelPolygonDrawing();
    });
}

// ---------------------------------------------------------------
// Régua de medição
// ---------------------------------------------------------------

function getRulerMeasurements(path) {
    const points = path || getSketchPath();
    const spherical = google.maps.geometry.spherical;
    const length = points.length >= 2 ? spherical.computeLength(points) : 0;
    const lastSegment = points.length >= 2 ? spherical.computeDistanceBetween(points[points.length - 2], points[points.length - 1]) : 0;
    const area = points.length >= 3 ? spherical.computeArea(points) : 0;
    const perimeter = points.length >= 3 ? spherical.computeLength([...points, points[0]]) : 0;
    const poleSpan = getPoleSpanDistance();
    const estimatedPoles = length > 0 ? Math.ceil(length / poleSpan) + 1 : 0;
    return { points: points.length, length, lastSegment, area, perimeter, poleSpan, estimatedPoles };
}

function renderRulerStats(path) {
    const m = getRulerMeasurements(path);
    const statsEl = document.getElementById('rulerStats');
    const valueEl = document.getElementById('rulerDistance');
    const labelEl = document.getElementById('rulerPrimaryLabel');
    const toPolygonBtn = document.getElementById('rulerToPolygonButton');
    const stat = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
    if (rulerMode === 'area') {
        labelEl.textContent = 'Área';
        valueEl.textContent = m.points >= 3 ? formatArea(m.area) : '—';
        statsEl.innerHTML = stat('Perímetro', m.points >= 3 ? formatDistance(m.perimeter) : '—') + stat('Pontos', m.points);
        toPolygonBtn.classList.toggle('hidden', m.points < 3);
    } else {
        labelEl.textContent = 'Distância total';
        valueEl.textContent = formatDistance(m.length);
        statsEl.innerHTML = stat('Último trecho', formatDistance(m.lastSegment))
            + stat('Pontos', m.points)
            + stat(`Postes (${m.poleSpan} m)`, m.estimatedPoles ? `≈ ${m.estimatedPoles}` : '—');
        toPolygonBtn.classList.add('hidden');
    }
    document.getElementById('rulerUndoButton').disabled = m.points === 0;
    document.getElementById('rulerClearButton').disabled = m.points === 0;
    document.getElementById('rulerCopyButton').disabled = rulerMode === 'area' ? m.points < 3 : m.points < 2;
}

//Mostra a distância até o cursor enquanto o usuário mira o próximo ponto
function renderRulerCursorHint(cursorLatLng) {
    const hintEl = document.getElementById('rulerCursorHint');
    if (!hintEl) return;
    const path = getSketchPath();
    if (!cursorLatLng || !path.length || rulerMode !== 'distance') {
        hintEl.textContent = '';
        return;
    }
    const spherical = google.maps.geometry.spherical;
    const toCursor = spherical.computeDistanceBetween(path[path.length - 1], cursorLatLng);
    const total = (path.length >= 2 ? spherical.computeLength(path) : 0) + toCursor;
    hintEl.textContent = `Com o próximo ponto: ${formatDistance(total)} (+${formatDistance(toCursor)})`;
}

function setRulerMode(mode) {
    rulerMode = mode === 'area' ? 'area' : 'distance';
    document.querySelectorAll('#rulerBox [data-ruler-mode]').forEach(btn => {
        const active = btn.dataset.rulerMode === rulerMode;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    setSketchShape(rulerMode === 'area' ? 'area' : 'line');
    renderRulerStats();
    renderRulerCursorHint(sketchSession?.lastCursor || null);
}

//Inicia a ferramenta de régua de medição
function startRuler() {
    if (isDrawingCable || isAddingMarker) {
        showAlert("Atenção", "Finalize a ação atual antes de usar a régua.");
        return;
    }
    if (isDrawingPolygon) cancelPolygonDrawing();
    document.getElementById('toolsDropdown').classList.remove('show');
    document.getElementById('rulerBox').classList.remove('hidden');
    isMeasuring = true;
    const session = startSketch({
        shape: rulerMode === 'area' ? 'area' : 'line',
        color: RULER_COLOR,
        fillOpacity: 0.15,
        showSegmentLabels: true,
        onChange: renderRulerStats
    });
    session.onCursor = renderRulerCursorHint;
    setRulerMode(rulerMode);
}

function copyRulerMeasurement() {
    const m = getRulerMeasurements();
    const text = rulerMode === 'area'
        ? `Área: ${formatArea(m.area)} | Perímetro: ${formatDistance(m.perimeter)} | Pontos: ${m.points}`
        : `Distância: ${formatDistance(m.length)} | Pontos: ${m.points} | Postes estimados (vão ${m.poleSpan} m): ${m.estimatedPoles}`;
    const button = document.getElementById('rulerCopyButton');
    const done = () => {
        const original = button.dataset.label || button.textContent;
        button.dataset.label = original;
        button.textContent = 'Copiado!';
        setTimeout(() => { button.textContent = original; }, 1400);
    };
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => showAlert('Medição', text));
    } else {
        showAlert('Medição', text);
    }
}

//Transforma a área medida em um polígono do projeto
function convertRulerToPolygon() {
    const path = getSketchPath();
    if (path.length < 3) return;
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione uma pasta de projeto para salvar o polígono.");
        return;
    }
    stopRuler();
    startPolygonTool(path);
}

//Para a ferramenta de régua e limpa os elementos do mapa
function stopRuler() {
    if (sketchSession && isMeasuring) stopSketch();
    isMeasuring = false;
    document.getElementById('rulerBox').classList.add('hidden');
    const hintEl = document.getElementById('rulerCursorHint');
    if (hintEl) hintEl.textContent = '';
}

function setupMapSketchTools() {
    document.getElementById('drawPolygonButton').addEventListener('click', (e) => {
        e.preventDefault();
        startPolygonTool();
    });
    document.getElementById('savePolygonButton').addEventListener('click', savePolygon);
    document.getElementById('cancelPolygonButton').addEventListener('click', cancelPolygonDrawing);
    document.getElementById('closePolygonBoxButton').addEventListener('click', cancelPolygonDrawing);
    document.getElementById('deletePolygonButton').addEventListener('click', deletePolygon);
    document.getElementById('polygonUndoButton').addEventListener('click', undoSketchPoint);
    document.getElementById('polygonFinishButton').addEventListener('click', finishPolygonSketch);
    renderPolygonSwatches();
    document.getElementById('polygonColor').addEventListener('input', applyPolygonFormStyle);
    document.getElementById('polygonOpacity').addEventListener('input', applyPolygonFormStyle);

    document.getElementById('rulerButton').addEventListener('click', (e) => {
        e.preventDefault();
        startRuler();
    });
    document.getElementById('cancelRulerButton').addEventListener('click', stopRuler);
    document.getElementById('closeRulerBoxButton').addEventListener('click', stopRuler);
    document.getElementById('rulerUndoButton').addEventListener('click', undoSketchPoint);
    document.getElementById('rulerClearButton').addEventListener('click', clearSketchPoints);
    document.getElementById('rulerCopyButton').addEventListener('click', copyRulerMeasurement);
    document.getElementById('rulerToPolygonButton').addEventListener('click', convertRulerToPolygon);
    document.querySelectorAll('#rulerBox [data-ruler-mode]').forEach(btn => {
        btn.addEventListener('click', () => setRulerMode(btn.dataset.rulerMode));
    });
}

//Verifica se uma porta específica já possui uma conexão de fusão.
function isPortConnected(portId, ignoreLine) {
    const existingLines = document.querySelectorAll('#fusion-svg-layer .fusion-line');
    for (const line of existingLines) {
        if (ignoreLine && line === ignoreLine) continue;
        if (line.dataset.startId === portId || line.dataset.endId === portId) {
            return true;
        }
    }
    return false;
}

//Inicia a exportação do projeto ativo para um arquivo KML.
function sanitizeForKML(text) {
    //Validação para garantir que a entrada é string
    if (typeof text !== 'string') {
        return '';
    }
    //Caracteres especiais reservados 
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&apos;');
}


//Inicia a exportação do projeto ativo para um arquivo KML - pasta e item
function generateKmlForFolder(ulElement, projectData) {
    let folderContent = '';
    //Conversão HEX para KML
    const toKmlColor = (hex, opacity = 'ff') => {
        if (!hex || hex.length !== 7) return `${opacity}ffffff`;
        const r = hex.substring(1, 3);
        const g = hex.substring(3, 5);
        const b = hex.substring(5, 7);
        return `${opacity}${b}${g}${r}`;
    };
    //Intera sobre os filhos da pasta atual
    for (const childNode of ulElement.children) {
        //É uma subpasta
        if (childNode.classList.contains('folder-wrapper')) {
            const titleDiv = childNode.querySelector('.folder-title');
            const subUl = childNode.querySelector('ul.subfolders');
            if (titleDiv && subUl) {
                const folderName = titleDiv.dataset.folderName || 'Subpasta';
                folderContent += `
                <Folder>
                <name>${sanitizeForKML(folderName)}</name>
                ${generateKmlForFolder(subUl, projectData)}
                </Folder>`;
            }
        }
        // É um marcador, cabo, polígono
        else if (childNode.tagName === 'LI') {
            //Associa o elemento da lista ao objedo de dado
            const marker = projectData.markers.find(m => m.listItem === childNode);
            const cable = projectData.cables.find(c => c.item === childNode);
            const polygon = projectData.polygons.find(p => p.listItem === childNode);
            //Geração XML para polígonos
            if (polygon) {
                const coords = polygon.path.map(coord => `${coord.lng()},${coord.lat()},0`).join(' ');
                folderContent += `
                <Placemark>
                    <name>${sanitizeForKML(polygon.name)}</name>
                    <Style><PolyStyle><color>${toKmlColor(polygon.color, '80')}</color></PolyStyle></Style>
                    <Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>
                </Placemark>`;
            //Geração XML para cabos
            } else if (cable) {
                const coords = cable.path.map(coord => `${coord.lng()},${coord.lat()},0`).join(' ');
                const cableLabel = cable.type && cable.type.startsWith('Cabo ')
                    ? `${sanitizeForKML(cable.name)} — ${sanitizeForKML(cable.type)}`
                    : sanitizeForKML(cable.name);
                folderContent += `
                <Placemark>
                    <name>${cableLabel}</name>
                    <Style><LineStyle><color>${toKmlColor(cable.color, 'ff')}</color><width>${cable.width || DEFAULT_CABLE_WIDTH_NEW}</width></LineStyle></Style>
                    <LineString><coordinates>${coords}</coordinates></LineString>
                </Placemark>`;
            //Geração XML para marcadores
            } else if (marker) {
                const position = marker.marker?.getPosition();
                if (position) {
                    folderContent += `
                    <Placemark>
                        <name>${sanitizeForKML(marker.name)} (${sanitizeForKML(marker.type)})</name>
                        <description>${sanitizeForKML(marker.description)}</description>
                        <Point><coordinates>${position.lng()},${position.lat()},0</coordinates></Point>
                    </Placemark>`;
                }
            }
        }
    }
    return folderContent;
}

//Inicia a exportação do projeto ativo para um arquivo KML, preservando a estrutura de pastas
function exportProjectToKML() {
    //Validação de contexto e seleção do projeto
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione um projeto na barra lateral para exportar.");
        return;
    }
    //Garente pegar a raiz do projeto
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) {
        showAlert("Erro", "Item selecionado não pertence a um projeto.");
        return;
    }
    //recuperação dos dados
    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    const projectName = projectRootElement.querySelector('.folder-title').dataset.folderName || 'Projeto Exportado';
    const projectData = getProjectItems(projectId);
    //Evita a exportação de arquivos vazios
    if (projectData.markers.length === 0 && projectData.cables.length === 0 && projectData.polygons.length === 0) {
        showAlert("Aviso", "O projeto selecionado está vazio e não possui itens para exportar.");
        return;
    }
    //Geração da estrutura XML/KML
    const projectUlElement = projectRootElement.querySelector('ul.subfolders');
    const foldersAndPlacemarks = generateKmlForFolder(projectUlElement, projectData);
    //Montagem do cabeçalho
    let kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
    <Document>
        <name>${sanitizeForKML(projectName)}</name>
        ${foldersAndPlacemarks}
    </Document>
    </kml>`;
    //Criação do Blob e download automático
    try {
        const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.kml`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    } catch (e) {
        console.error("Erro ao criar o arquivo para download:", e);
        showAlert("Erro de Exportação", "Ocorreu um problema ao tentar gerar o arquivo para download.");
    }
}

//Lida com o arquivo KML selecionado pelo usuário, lê seu conteúdo e o processa.
const KML_IMPORT_RECOGNIZED_COLOR = '#00c853';
const KML_IMPORT_UNRECOGNIZED_COLOR = '#ff9800';

const KML_MARKER_TYPE_DEFAULTS = {
    CTO: { size: DEFAULT_MARKER_SIZE, ctoStatus: 'Nova', isPredial: false, needsStickers: false },
    CEO: { size: DEFAULT_MARKER_SIZE, ceoStatus: 'Nova', ceoAccessory: 'Raquete', is144F: false },
    RESERVA: { size: DEFAULT_MARKER_SIZE, reservaStatus: 'Nova', reservaAccessory: 'Raquete' },
    POP: { size: DEFAULT_MARKER_SIZE },
    CORDOALHA: { size: DEFAULT_MARKER_SIZE, cordoalhaStatus: 'Nova', derivationTCount: 0 },
    CASA: { size: DEFAULT_MARKER_SIZE },
};

let lastKmlImportStats = null;

function buildKmlStyleIndex(kmlDoc) {
    const index = {};
    if (!kmlDoc) return index;
    kmlDoc.querySelectorAll('Style').forEach((style) => {
        const id = style.getAttribute('id');
        if (!id) return;
        index[id] = style;
        index[`#${id}`] = style;
    });
    return index;
}

function resolveKmlStyleNode(styleUrl, styleIndex) {
    if (!styleUrl) return null;
    const key = styleUrl.trim().replace(/^#/, '');
    const node = styleIndex[key] || styleIndex[`#${key}`];
    if (!node) return null;
    if (node.tagName === 'StyleMap') {
        const pairs = node.querySelectorAll('Pair');
        let normalUrl = null;
        pairs.forEach((pair) => {
            const keyEl = pair.querySelector('key');
            if (keyEl && keyEl.textContent.trim().toLowerCase() === 'normal') {
                normalUrl = pair.querySelector('styleUrl')?.textContent?.trim();
            }
        });
        if (!normalUrl && pairs.length > 0) {
            normalUrl = pairs[0].querySelector('styleUrl')?.textContent?.trim();
        }
        return resolveKmlStyleNode(normalUrl, styleIndex);
    }
    return node;
}

function extractKmlStyleHints(placemark, styleIndex) {
    let styleNode = placemark.querySelector(':scope > Style');
    const styleUrl = placemark.querySelector(':scope > styleUrl')?.textContent?.trim();
    if (!styleNode && styleUrl) {
        styleNode = resolveKmlStyleNode(styleUrl, styleIndex);
    }
    const iconHref = styleNode?.querySelector('IconStyle > Icon > href, Icon > href')?.textContent?.trim() || '';
    const iconColor = styleNode?.querySelector('IconStyle > color')?.textContent?.trim() || '';
    const lineColor = styleNode?.querySelector('LineStyle > color')?.textContent?.trim() || '';
    const lineWidth = styleNode?.querySelector('LineStyle > width')?.textContent?.trim() || '';
    return { styleUrl, iconHref, iconColor, lineColor, lineWidth };
}

function getKmlExtendedData(placemark) {
    const data = {};
    placemark.querySelectorAll('ExtendedData > Data').forEach((node) => {
        const key = node.getAttribute('name');
        const value = node.querySelector('value')?.textContent?.trim();
        if (key && value) data[key] = value;
    });
    placemark.querySelectorAll('ExtendedData > SchemaData > SimpleData').forEach((node) => {
        const key = node.getAttribute('name');
        const value = node.textContent?.trim();
        if (key && value) data[key] = value;
    });
    return data;
}

function inferMarkerTypeFromKml({ name, description, folderPath, iconHref, styleUrl, extendedData }) {
    const extValues = Object.entries(extendedData || {}).map(([k, v]) => `${k} ${v}`).join(' ');
    const pathText = (folderPath || []).join(' ');
    const blob = `${name} ${description} ${pathText} ${iconHref} ${styleUrl} ${extValues}`.toUpperCase();

    const parenType = (name || '').match(/\((CEO|CTO|RESERVA|POP|CORDOALHA|CASA)\)\s*$/i);
    if (parenType) {
        return { type: parenType[1].toUpperCase(), source: 'nome (exportado pelo app)' };
    }

    const extTypeKey = Object.keys(extendedData || {}).find((k) => /^(tipo|type|classe|class|categoria)$/i.test(k));
    if (extTypeKey) {
        const raw = extendedData[extTypeKey].toUpperCase().trim();
        if (KML_MARKER_TYPE_DEFAULTS[raw]) {
            return { type: raw, source: `campo ${extTypeKey}` };
        }
    }

    const rules = [
        { type: 'CEO', patterns: [/\bCEO\b/, /CAIXA\s*DE\s*EMENDA/, /\bEMENDA\b.*\bOPTIC/, /\bCEO\b.*\d/] },
        { type: 'CTO', patterns: [/\bCTO\b/, /TERMINAL\s*OPTIC/, /CAIXA\s*DE\s*ATENDIMENTO/, /\bCTO\b.*\d/] },
        { type: 'RESERVA', patterns: [/\bRESERVA\b/, /PONTO\s*DE\s*RESERVA/] },
        { type: 'POP', patterns: [/\bPOP\b/, /PONTO\s*DE\s*PRESEN/, /\bOLT\b/, /CENTRAL\b/] },
        { type: 'CORDOALHA', patterns: [/\bCORDOALHA\b/, /CORD\.?\s*OPTIC/, /\bCORDO\b/] },
        { type: 'CASA', patterns: [/\bCASA\b/, /\bCASAS\b/, /\bUC\b/, /UNIDADE\s*CONSUM/] },
    ];

    for (const rule of rules) {
        if (rule.patterns.some((rx) => rx.test(blob))) {
            return { type: rule.type, source: 'nome, pasta ou descrição' };
        }
    }

    const icon = (iconHref || '').toLowerCase();
    if (/cto|terminal|atendimento/.test(icon)) return { type: 'CTO', source: 'ícone KML' };
    if (/ceo|emenda|splice/.test(icon)) return { type: 'CEO', source: 'ícone KML' };
    if (/reserva/.test(icon)) return { type: 'RESERVA', source: 'ícone KML' };
    if (/pop|olt|central/.test(icon)) return { type: 'POP', source: 'ícone KML' };
    if (/cordoalha|cord/.test(icon)) return { type: 'CORDOALHA', source: 'ícone KML' };

    return { type: 'Importado', source: null };
}

function inferMarkerStatusFromKml({ name, description, folderPath, extendedData, defaultStatus = 'Nova' }) {
    const pathText = (folderPath || []).join(' ');
    const extValues = Object.entries(extendedData || {}).map(([k, v]) => `${k} ${v}`).join(' ');
    const blob = `${name} ${description} ${pathText} ${extValues}`.toUpperCase();

    const extStatusKey = Object.keys(extendedData || {}).find((k) =>
        /^(status|estado|situacao|situação|condicao|condição)$/i.test(k)
    );
    if (extStatusKey) {
        const raw = (extendedData[extStatusKey] || '').toUpperCase().trim();
        if (/EXIST/.test(raw)) return 'Existente';
        if (/TROC/.test(raw)) return 'Troca';
        if (/NOV|NEW/.test(raw)) return 'Nova';
    }

    for (const segment of folderPath || []) {
        const seg = segment.toUpperCase().trim();
        if (/^EXISTENTE(S)?$/.test(seg) || /\bEXISTENTE(S)?\b/.test(seg)) return 'Existente';
        if (/^TROCA(S)?$/.test(seg) || /\bTROCA(S)?\b/.test(seg)) return 'Troca';
        if (/^NOVO(S)?$/.test(seg) || /^NOVA(S)?$/.test(seg) || /\bNOVO(S)?\b/.test(seg) || /\bNOVA(S)?\b/.test(seg)) {
            return 'Nova';
        }
    }

    const parenStatus = (name || '').match(/\((NOVO|NOVA|EXISTENTE|TROCA)\)\s*$/i);
    if (parenStatus) {
        const token = parenStatus[1].toUpperCase();
        if (token === 'EXISTENTE') return 'Existente';
        if (token === 'TROCA') return 'Troca';
        return 'Nova';
    }

    if (/\b-\s*EXISTENTE\b/.test(blob) || /\b·\s*EXISTENTE\b/.test(blob)) return 'Existente';
    if (/\b-\s*TROCA\b/.test(blob)) return 'Troca';
    if (/\b-\s*NOVO\b/.test(blob) || /\b-\s*NOVA\b/.test(blob)) return 'Nova';

    if (/EXISTENTE|EXIST\b|INSTALAD|INSTAL\.|FEITO|\bOK\b/.test(blob)) return 'Existente';
    if (/TROC|SUBSTITU|REPLACE/.test(blob)) return 'Troca';

    return defaultStatus;
}

function buildKmlMarkerImportData(name, description, inferred, styleHints, importContext = {}) {
    const { folderPath = [], extendedData = {} } = importContext;
    const type = inferred.type;
    const pathText = (folderPath || []).join(' ');
    const textBlob = `${name} ${description} ${pathText}`.toUpperCase();
    const inferredStatus = inferMarkerStatusFromKml({
        name,
        description,
        folderPath,
        extendedData,
    });

    if (type === 'Importado') {
        return {
            type,
            name,
            description,
            color: KML_IMPORT_UNRECOGNIZED_COLOR,
            labelColor: KML_IMPORT_UNRECOGNIZED_COLOR,
            size: DEFAULT_MARKER_SIZE,
            isImported: true,
            fromKmlImport: true,
            pendingImportStatus: inferredStatus,
        };
    }

    const defaults = KML_MARKER_TYPE_DEFAULTS[type];
    const isCasa = type === 'CASA';
    const data = {
        type,
        name,
        description,
        color: isCasa ? '#ffffff' : KML_IMPORT_RECOGNIZED_COLOR,
        labelColor: isCasa ? '#000000' : KML_IMPORT_RECOGNIZED_COLOR,
        size: defaults.size,
        isImported: false,
        fromKmlImport: true,
    };

    if (type === 'CTO') {
        data.ctoStatus = inferredStatus;
        data.isPredial = /PREDIAL/.test(textBlob);
        data.needsStickers = shouldDefaultCtoStickers(inferredStatus) || /ADESIV|STICKER/.test(textBlob);
    } else if (type === 'CEO') {
        data.ceoStatus = inferredStatus;
        data.ceoAccessory = /TAP|BRACKET|TAPETE/.test(textBlob) ? 'Tapete' : defaults.ceoAccessory;
        data.is144F = /144|JUMBO/.test(textBlob);
    } else if (type === 'RESERVA') {
        data.reservaStatus = inferredStatus;
        data.reservaAccessory = /TAP|BRACKET|TAPETE/.test(textBlob) ? 'Tapete' : defaults.reservaAccessory;
    } else if (type === 'CORDOALHA') {
        data.cordoalhaStatus = inferredStatus;
        const matchT = textBlob.match(/(?:DERIVA|DERIVAÇÃO|DERIVACAO).*?(\d+)/);
        data.derivationTCount = matchT ? parseInt(matchT[1], 10) : defaults.derivationTCount;
    }

    return data;
}

const KML_CABLE_FIBER_TYPES = ['FO-06', 'FO-12', 'FO-24', 'FO-36', 'FO-48', 'FO-72', 'FO-144'];
const KML_CABLE_HEX_TO_FIBER = {
    '#000000': 'FO-06',
    '#008000': 'FO-12',
    '#ff69b4': 'FO-24',
    '#0000ff': 'FO-36',
    '#ff0000': 'FO-48',
    '#800080': 'FO-72',
    '#ffff00': 'FO-144',
};

function kmlAbgrToHex(kmlColor) {
    const s = (kmlColor || '').replace(/^#/, '').trim();
    if (!s) return null;
    let rr;
    let gg;
    let bb;
    if (s.length === 8) {
        bb = s.substring(2, 4);
        gg = s.substring(4, 6);
        rr = s.substring(6, 8);
    } else if (s.length === 6) {
        rr = s.substring(0, 2);
        gg = s.substring(2, 4);
        bb = s.substring(4, 6);
    } else {
        return null;
    }
    return `#${rr}${gg}${bb}`.toLowerCase();
}

function normalizeKmlCableAsType(text) {
    const t = (text || '').toUpperCase();
    if (/\bAS\s*200\b/.test(t)) return 'AS 200';
    if (/\bAS\s*80\b/.test(t)) return 'AS 80';
    return 'AS 80';
}

function buildFullCableType(asType, fiberType) {
    return `Cabo ${asType} ${fiberType}`;
}

function parseFullCableTypeString(text) {
    const match = (text || '').match(/Cabo\s+(AS\s*80|AS\s*200)\s*(FO-\d+)/i);
    if (!match) return null;
    const fiber = match[2].toUpperCase();
    if (!KML_CABLE_FIBER_TYPES.includes(fiber)) return null;
    const asType = normalizeKmlCableAsType(match[1]);
    return buildFullCableType(asType, fiber);
}

/** Separa nome legível e tipo quando o KML traz "Trecho 1 — Cabo AS 80 FO-24". */
function splitKmlCableNameAndType(rawName) {
    const fullType = parseFullCableTypeString(rawName);
    if (!fullType) {
        return { displayName: rawName, fullType: null };
    }
    const displayName = rawName
        .replace(/\s*[—–-]\s*Cabo\s+AS\s*(?:80|200)\s+FO-\d+\s*$/i, '')
        .replace(/\s*\(\s*Cabo\s+AS\s*(?:80|200)\s+FO-\d+\s*\)\s*$/i, '')
        .trim();
    return { displayName: displayName || rawName, fullType };
}

function inferCableStatusFromKml({ name, description, folderPath, extendedData, defaultStatus = 'Novo' }) {
    const pathText = (folderPath || []).join(' ');
    const extValues = Object.entries(extendedData || {}).map(([k, v]) => `${k} ${v}`).join(' ');
    const blob = `${name} ${description} ${pathText} ${extValues}`.toUpperCase();

    const extStatusKey = Object.keys(extendedData || {}).find((k) =>
        /^(status|estado|situacao|situação|condicao|condição)$/i.test(k)
    );
    if (extStatusKey) {
        const raw = (extendedData[extStatusKey] || '').toUpperCase().trim();
        if (/EXIST/.test(raw)) return 'Existente';
        if (/NOV|NEW/.test(raw)) return 'Novo';
    }

    for (const segment of folderPath || []) {
        const seg = segment.toUpperCase().trim();
        if (/^EXISTENTE(S)?$/.test(seg) || /\bEXISTENTE(S)?\b/.test(seg)) return 'Existente';
        if (/^NOVO(S)?$/.test(seg) || /^NOVA(S)?$/.test(seg) || /\bNOVO(S)?\b/.test(seg) || /\bNOVA(S)?\b/.test(seg)) {
            return 'Novo';
        }
    }

    const statusInName = (name || '').match(/\((NOVO|NOVA|EXISTENTE)\)/i);
    if (statusInName) {
        return /EXISTENTE/i.test(statusInName[1]) ? 'Existente' : 'Novo';
    }

    if (/\b-\s*EXISTENTE\b/.test(blob) || /\b·\s*EXISTENTE\b/.test(blob)) return 'Existente';
    if (/\b-\s*NOVO\b/.test(blob) || /\b-\s*NOVA\b/.test(blob)) return 'Novo';

    if (/EXISTENTE|EXIST\b|INSTALAD|INSTAL\.|FEITO|\bOK\b/.test(blob)) return 'Existente';

    return defaultStatus;
}

function inferCableTypeFromKml({ name, description, folderPath, lineColorHex, extendedData }) {
    const { displayName, fullType: typeFromName } = splitKmlCableNameAndType(name);
    const pathText = (folderPath || []).join(' ');
    const blob = `${name} ${description} ${pathText}`.toUpperCase();

    if (typeFromName) {
        return { type: typeFromName, displayName, source: 'nome' };
    }

    const extTypeKey = Object.keys(extendedData || {}).find((k) => /^(tipo|type|cabo|fibra|classe)$/i.test(k));
    if (extTypeKey) {
        const fromExt = parseFullCableTypeString(extendedData[extTypeKey]);
        if (fromExt) {
            return { type: fromExt, source: `campo ${extTypeKey}` };
        }
        const foOnly = (extendedData[extTypeKey] || '').match(/FO-\d+/i);
        if (foOnly) {
            const fiber = foOnly[0].toUpperCase();
            if (KML_CABLE_FIBER_TYPES.includes(fiber)) {
                return {
                    type: buildFullCableType(normalizeKmlCableAsType(extendedData[extTypeKey]), fiber),
                    source: `campo ${extTypeKey}`,
                };
            }
        }
    }

    let fiber = null;
    let source = 'nome, pasta ou descrição';
    const foMatch = blob.match(/\bFO-(\d+)\b/);
    if (foMatch) {
        const candidate = `FO-${foMatch[1]}`;
        if (KML_CABLE_FIBER_TYPES.includes(candidate)) {
            fiber = candidate;
        }
    }

    if (!fiber && lineColorHex) {
        const fromColor = KML_CABLE_HEX_TO_FIBER[lineColorHex.toLowerCase()];
        if (fromColor) {
            fiber = fromColor;
            source = 'cor da linha KML';
        }
    }

    if (fiber) {
        return {
            type: buildFullCableType(normalizeKmlCableAsType(blob), fiber),
            displayName,
            source,
        };
    }

    const cableKeywords = [
        /\bCABO\b/,
        /\bFIBRA\s*OPTIC/,
        /\bLAN[CÇ]AMENTO\b/,
        /\bDROP\b/,
        /\bBACKBONE\b/,
        /\bTRONCO\b/,
        /\bOPTIC\b/,
        /\bFO\b/,
    ];
    if (cableKeywords.some((rx) => rx.test(blob))) {
        return {
            type: buildFullCableType(normalizeKmlCableAsType(blob), 'FO-12'),
            displayName,
            source: 'palavra-chave (fibra padrão FO-12)',
        };
    }

    return { type: 'Cabo Importado', displayName, source: null };
}

function resolveKmlCableDisplayColor(cableType, styleHints) {
    const fiberType = getFiberType(cableType);
    if (fiberType) {
        return getCableColor(fiberType);
    }
    const fromKml = kmlAbgrToHex(styleHints?.lineColor);
    if (fromKml) {
        const mappedFiber = KML_CABLE_HEX_TO_FIBER[fromKml.toLowerCase()];
        if (mappedFiber) {
            return getCableColor(mappedFiber);
        }
        return fromKml;
    }
    return KML_IMPORT_UNRECOGNIZED_COLOR;
}

function buildKmlCableImportData(name, description, inferred, styleHints, importContext = {}) {
    const { folderPath = [], extendedData = {} } = importContext;
    const cableName = inferred.displayName || name;
    const status = inferCableStatusFromKml({
        name: cableName,
        description,
        folderPath,
        extendedData,
    });
    const width = parseInt(styleHints?.lineWidth, 10) || getDefaultCableWidthForStatus(status);
    const color = inferred.type === 'Cabo Importado'
        ? KML_IMPORT_UNRECOGNIZED_COLOR
        : resolveKmlCableDisplayColor(inferred.type, styleHints);

    if (inferred.type === 'Cabo Importado') {
        return {
            type: 'Cabo Importado',
            name: cableName,
            description,
            color,
            width,
            status,
            isImported: true,
        };
    }

    return {
        type: inferred.type,
        name: cableName,
        description,
        color,
        width,
        status,
        isImported: false,
    };
}

function importKmlCable(path, parentSidebarId, cableData) {
    const { path: anchoredPath, startAnchor, endAnchor } = anchorCablePathToMarkers(path, parentSidebarId);
    const polyline = new google.maps.Polyline({
        path: anchoredPath,
        map,
        strokeColor: cableData.color,
        strokeWeight: cableData.width,
        clickable: true,
    });
    const newCableInfo = {
        folderId: parentSidebarId,
        name: cableData.name,
        type: cableData.type,
        width: cableData.width,
        color: cableData.color,
        path: anchoredPath,
        polyline,
        item: null,
        status: cableData.status,
        lancamento: 0,
        reserva: 0,
        totalLength: 0,
        isImported: cableData.isImported,
        fromKmlImport: true,
        description: cableData.description || '',
    };
    assignCableAnchorMarkers(newCableInfo, startAnchor, endAnchor);
    const measurement = calculateCableMeasurement(newCableInfo);
    newCableInfo.lancamento = measurement.lancamento;
    newCableInfo.reserva = measurement.reserva;
    newCableInfo.totalLength = measurement.total;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'item-name';
    nameSpan.style.cursor = 'pointer';
    if (cableData.isImported) {
        nameSpan.textContent = `${cableData.name} (Cabo Importado · ${cableData.status || 'Novo'}) · ${measurement.total}m`;
    } else {
        nameSpan.textContent = `${cableData.name} — ${cableData.type} (${cableData.status}) · ${measurement.total}m`;
        nameSpan.title = cableData.type;
    }
    const item = buildGeProMapItemRow(nameSpan, polyline, 'ge-icon-path', cableData.color);
    document.getElementById(parentSidebarId).appendChild(item);
    newCableInfo.item = item;
    updateCableSidebarLabel(newCableInfo);
    if (cableData.isImported) {
        const adjustBtn = document.createElement('button');
        adjustBtn.className = 'adjust-kml-btn';
        adjustBtn.textContent = 'Ajustar Cabo';
        adjustBtn.type = 'button';
        item.appendChild(adjustBtn);
        adjustBtn.onclick = (e) => {
            e.stopPropagation();
            focusMapToCable(newCableInfo);
            openCableEditor(newCableInfo);
        };
    }
    wireCableSidebarClick(newCableInfo);
    applyCableSidebarColorStyles(newCableInfo);
    savedCables.push(newCableInfo);
    addCableEventListeners(polyline);
    return newCableInfo;
}

async function readKmlTextFromFile(file) {
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.kmz')) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('READ_ERROR'));
            reader.readAsText(file);
        });
    }
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZIP_MISSING');
    }
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlFiles = zip.file(/\.kml$/i).filter((entry) => !entry.dir);
    if (!kmlFiles.length) {
        throw new Error('KML_NOT_FOUND_IN_KMZ');
    }
    const docKml = kmlFiles.find((f) => /^doc\.kml$/i.test(f.name));
    const entry = docKml || kmlFiles[0];
    return entry.async('string');
}

function handleKmlFileSelect(event) {
    if (!requireEdit('importar arquivos KML')) {
        event.target.value = '';
        return;
    }
    const file = event.target.files[0];
    if (!file) return;

    readKmlTextFromFile(file)
        .then((kmlText) => {
            const parser = new DOMParser();
            const kmlDoc = parser.parseFromString(kmlText, 'text/xml');
            if (kmlDoc.querySelector('parsererror')) {
                throw new Error('PARSE_ERROR');
            }
            parseAndDisplayKML(kmlDoc);
        })
        .catch((error) => {
            console.error('Erro ao processar KML/KMZ:', error);
            if (error.message === 'JSZIP_MISSING') {
                showAlert('Erro', 'Biblioteca JSZip não carregou. Verifique sua conexão e recarregue a página.');
            } else if (error.message === 'KML_NOT_FOUND_IN_KMZ') {
                showAlert('Erro de Importação', 'Não foi encontrado um arquivo .kml dentro do KMZ.');
            } else {
                showAlert('Erro de Importação', 'Não foi possível ler o arquivo KML/KMZ. Verifique o formato do arquivo.');
            }
        })
        .finally(() => {
            event.target.value = '';
        });
}

//Cria programaticamente uma nova pasta na barra lateral para arquivo importado
function createFolderFromKML(folderName, parentUlId) {
    //Validação do container pai
    const parentUl = document.getElementById(parentUlId);
    if (!parentUl) {
        console.error(`Elemento pai com ID "${parentUlId}" não encontrado.`);
        return null;
    }
    //Instanciação via template e geração de ID
    const folderId = `folder-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const template = document.getElementById('folder-template');
    const clone = template.content.cloneNode(true);
    //Criação de elementos internos
    const wrapperLi = clone.querySelector('.folder-wrapper');
    enableDragAndDropForItem(wrapperLi);
    const titleDiv = clone.querySelector('.folder-title');
    const nameSpan = clone.querySelector('.folder-name-text');
    const subList = clone.querySelector('.subfolders');
    const visibilityBtn = clone.querySelector('.visibility-toggle-btn');
    //Preenchimento de dados
    nameSpan.textContent = folderName;
    subList.id = folderId;
    titleDiv.dataset.folderId = folderId;
    titleDiv.dataset.folderName = folderName;
    titleDiv.dataset.isProject = "false";
    visibilityBtn.dataset.folderId = folderId;
    //Configuração de eventos
    const toggleIcon = titleDiv.querySelector('.toggle-icon');
    //Expandir recolher a pasta
    toggleIcon.onclick = (e) => { e.stopPropagation(); toggleFolder(folderId); };
    //Configuração de drag & drop
    enableDropOnFolder(subList);
    //Renderização no DOM
    parentUl.appendChild(wrapperLi);
    return folderId;
}

//Processamento recursivo de nós KML na importação
function processKmlNode(kmlNode, parentSidebarId, importContext = {}) {
    let itemsImported = 0;
    const styleIndex = importContext.styleIndex || {};
    const folderPath = importContext.folderPath || [];
    const stats = importContext.stats;

    for (const child of kmlNode.children) {
        const nodeName = child.tagName;
        if (nodeName === 'Folder') {
            const folderName = child.querySelector('name')?.textContent || 'Pasta Importada';
            const newFolderId = createFolderFromKML(folderName, parentSidebarId);
            if (newFolderId) {
                itemsImported += processKmlNode(child, newFolderId, {
                    styleIndex,
                    folderPath: [...folderPath, folderName],
                    stats,
                });
            }
        } else if (nodeName === 'Placemark') {
            const name = child.querySelector('name')?.textContent.trim() || 'Item importado';
            const description = child.querySelector('description')?.textContent.trim() || '';
            const point = child.querySelector('Point');
            const line = child.querySelector('LineString');
            const polygon = child.querySelector('Polygon');
            if (point) {
                const coordsText = point.querySelector('coordinates')?.textContent.trim();
                if (!coordsText) continue;
                const [lng, lat] = coordsText.split(',');
                const position = new google.maps.LatLng(parseFloat(lat), parseFloat(lng));
                const styleHints = extractKmlStyleHints(child, styleIndex);
                const extendedData = getKmlExtendedData(child);
                const inferred = inferMarkerTypeFromKml({
                    name,
                    description,
                    folderPath,
                    iconHref: styleHints.iconHref,
                    styleUrl: styleHints.styleUrl,
                    extendedData,
                });
                const markerData = buildKmlMarkerImportData(name, description, inferred, styleHints, {
                    folderPath,
                    extendedData,
                });
                const originalActiveFolder = activeFolderId;
                activeFolderId = parentSidebarId;
                addCustomMarker(position, markerData);
                activeFolderId = originalActiveFolder;
                itemsImported++;
                if (stats) {
                    if (markerData.type === 'Importado') {
                        stats.manual += 1;
                    } else {
                        stats.classified[markerData.type] = (stats.classified[markerData.type] || 0) + 1;
                    }
                }
            } else if (line) {
                const coordsText = line.querySelector('coordinates')?.textContent.trim();
                if (!coordsText) continue;
                const path = coordsText.split(/\s+/).filter(c => c).map(pair => {
                    const [lng, lat] = pair.split(',');
                    return new google.maps.LatLng(parseFloat(lat), parseFloat(lng));
                });
                const styleHints = extractKmlStyleHints(child, styleIndex);
                const extendedData = getKmlExtendedData(child);
                const lineColorHex = kmlAbgrToHex(styleHints.lineColor);
                const inferred = inferCableTypeFromKml({
                    name,
                    description,
                    folderPath,
                    lineColorHex,
                    extendedData,
                });
                const cableData = buildKmlCableImportData(name, description, inferred, styleHints, {
                    folderPath,
                    extendedData,
                });
                if (importContext.deferredCables) {
                    importContext.deferredCables.push({ path, parentSidebarId, cableData });
                } else {
                    importKmlCable(path, parentSidebarId, cableData);
                }
                itemsImported++;
                if (stats) {
                    if (cableData.isImported) {
                        stats.cablesManual = (stats.cablesManual || 0) + 1;
                    } else {
                        const key = getFiberType(cableData.type) || cableData.type;
                        stats.cablesClassified = stats.cablesClassified || {};
                        stats.cablesClassified[key] = (stats.cablesClassified[key] || 0) + 1;
                    }
                }
            //Importação de polígonos
            } else if (polygon) {
                const coordsText = polygon.querySelector('outerBoundaryIs > LinearRing > coordinates')?.textContent.trim();
                if (!coordsText) continue;
                const path = coordsText.split(/\s+/).filter(c => c).map(pair => {
                    const [lng, lat] = pair.split(',');
                    const parsedLat = parseFloat(lat);
                    const parsedLng = parseFloat(lng);
                    if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
                        return new google.maps.LatLng(parsedLat, parsedLng);
                    }
                    return null;
                }).filter(coord => coord !== null);
                if (path.length < 3) {
                    console.warn(`Polígono "${name}" ignorado devido a coordenadas inválidas ou insuficientes.`);
                    continue;
                }
                //Criação visual e registro global
                const polygonColor = '#C70039';
                const polygonObject = new google.maps.Polygon({
                    paths: path,
                    map: map,
                    fillColor: polygonColor,
                    strokeColor: polygonColor,
                    fillOpacity: 0.5,
                    strokeWeight: 2,
                    clickable: true, 
                    editable: false
                });
                const template = document.getElementById('polygon-template');
                const clone = template.content.cloneNode(true);
                const li = clone.querySelector('li');
                enableDragAndDropForItem(li);
                const nameSpan = li.querySelector('.item-name');
                nameSpan.textContent = name;
                const iconEl = li.querySelector('.ge-icon-polygon');
                if (iconEl) iconEl.style.setProperty('--ge-item-color', polygonColor);
                const parentUl = document.getElementById(parentSidebarId);
                 if (parentUl) {
                    parentUl.appendChild(li);
                } else {
                     console.error(`Elemento pai com ID "${parentSidebarId}" não encontrado para o polígono importado "${name}"`);
                     continue;
                 }
                const polygonInfo = {
                    folderId: parentSidebarId,
                    name: name,
                    color: polygonColor,
                    path: path.map(p => ({lat: p.lat(), lng: p.lng()})),
                    polygonObject: polygonObject,
                    listItem: li
                };
                savedPolygons.push(polygonInfo);
                refreshPolygonSidebarLabel(polygonInfo);
                polygonObject.addListener('click', () => openPolygonEditor(polygonInfo));
                nameSpan.addEventListener('click', () => openPolygonEditor(polygonInfo));
                const visCb = li.querySelector('.ge-vis-checkbox');
                if (visCb) wireItemVisibilityCheckbox(visCb, polygonObject);
                itemsImported++;
            }
        }
    }
    return itemsImported;
}

//Ponto de entrada da importação
function parseAndDisplayKML(kmlDoc) {
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione um projeto ou uma pasta para importar os dados do KML.");
        return;
    }
    const styleIndex = buildKmlStyleIndex(kmlDoc);
    const stats = { classified: {}, manual: 0, cablesClassified: {}, cablesManual: 0 };
    const deferredCables = [];
    const rootNode = kmlDoc.querySelector('Document') || kmlDoc.documentElement;
    const totalItems = processKmlNode(rootNode, activeFolderId, { styleIndex, folderPath: [], stats, deferredCables });

    deferredCables.forEach(({ path, parentSidebarId, cableData }) => {
        importKmlCable(path, parentSidebarId, cableData);
    });
    syncProjectCableMeasurements(savedCables);

    lastKmlImportStats = stats;

    const classifiedParts = Object.entries(stats.classified)
        .map(([type, count]) => `${count} ${type}`)
        .join(', ');
    const cablesClassifiedParts = Object.entries(stats.cablesClassified || {})
        .map(([type, count]) => `${count} ${type}`)
        .join(', ');
    let message = `${totalItems} elemento(s) importado(s).`;
    if (classifiedParts) {
        message += `\n\nMarcadores reconhecidos (verde): ${classifiedParts}.`;
    }
    if (stats.manual > 0) {
        message += `\n\n${stats.manual} marcador(es) não reconhecidos (laranja) — use Ajustar na lista.`;
    }
    if (cablesClassifiedParts) {
        message += `\n\nCabos reconhecidos: ${cablesClassifiedParts}.`;
    }
    if (stats.cablesManual > 0) {
        message += `\n\n${stats.cablesManual} cabo(s) sem tipo definido (laranja) — use Ajustar Cabo na lista.`;
    }
    message += '\n\nDica: use nomes/pastas com CTO, CEO, FO-12, Cabo AS 80 FO-24 etc., ou exporte pelo app para melhor reconhecimento.';
    refreshBomAfterProjectChange();
    showAlert("Importação Concluída", message);
}

//Inicia o processo de ajuste de um marcador KML importado, guardando a sua informação e abrindo o modal de seleção de tipo.
function startMarkerAdjustment(markerInfo) {
    if (!requireEdit('ajustar marcadores importados')) return;
    // Guarda a informação do marcador que estamos a ajustar
    adjustingKmlMarkerInfo = markerInfo;
    // Abre o primeiro passo do fluxo de criação: a seleção do tipo de marcador
    document.getElementById('markerTypeModal').style.display = 'flex';
}

//Ao soltar uma ponta perto de uma caixa, ela é ancorada; afastada, perde a ancoragem
function handleCableVertexDragEnd(vertexIndex) {
    if (!isDrawingCable || !cableMarkers[vertexIndex]) return;
    const lastIndex = cableMarkers.length - 1;
    if (vertexIndex !== 0 && vertexIndex !== lastIndex) {
        updatePolylineFromMarkers();
        return;
    }
    const isStart = vertexIndex === 0;
    const other = isStart ? cableDrawAnchors.end : cableDrawAnchors.start;
    const previous = isStart ? cableDrawAnchors.start : cableDrawAnchors.end;
    const anchor = resolveCableDrawEndpointAnchor(cableMarkers[vertexIndex].getPosition(), activeFolderId, other, 12);
    if (anchor) {
        cableMarkers[vertexIndex].setPosition(anchor.marker.getPosition());
        if (isStart) cableDrawAnchors.start = anchor; else cableDrawAnchors.end = anchor;
        if (anchor !== previous) showToast('Ponta ancorada', `Ponta ${isStart ? 'A' : 'B'} ligada a "${anchor.name}".`);
    } else if (isStart) {
        cableDrawAnchors.start = null;
    } else {
        cableDrawAnchors.end = null;
    }
    updatePolylineFromMarkers();
}

//Inversão de sentido do cabo
function invertCableDirection() {
    if (editingCableIndex === null) return;
    const cableToInvert = savedCables[editingCableIndex];
    const usage = checkCableUsageInFusionPlans(cableToInvert);
    if (usage.isInPlan) {
        showAlert("Ação bloqueada", `Este cabo não pode ser invertido porque está no plano de fusão da(s) caixa(s): ${usage.locations.join(', ')}. Remova-o do plano de fusão antes de inverter.`);
        return;
    }
    showConfirm('Inverter cabo', 'Inverter a direção deste cabo? A ponta A vira B e a reserva técnica é recalculada.', () => {
        cableMarkers.reverse();
        cableDrawAnchors = { start: cableDrawAnchors.end, end: cableDrawAnchors.start };
        updatePolylineFromMarkers();
        showToast('Cabo invertido', 'Salve o cabo para confirmar.');
    });
}

//Listener de inicialização
document.addEventListener('DOMContentLoaded', () => {
   setupThemeToggle();
   setupDropdownInteractions();
   loadSavedSidebarWidth();
   document.getElementById("invertCableButton")?.addEventListener("click", invertCableDirection);
   document.querySelectorAll('.drop-placeholder').forEach((el) => el.remove());
   document.querySelectorAll('.sidebar-drag-handle').forEach((el) => el.remove());
});



//Se o componente está fusionado
function isComponentFused(componentElement) {
    if (!componentElement) return false;
    //Pega todas as portas/fibras conectáveis deste componente
    const portIds = Array.from(componentElement.querySelectorAll('.connectable')).map(p => p.id);
    if (portIds.length === 0) return false;
    //Pega todas as linhas de fusão ativas no canvas
    const allFusionLines = document.querySelectorAll('#fusion-svg-layer .fusion-line');
    //Verifica se alguma linha está conectada a alguma das portas do componente
    for (const line of allFusionLines) {
        if (portIds.includes(line.dataset.startId) || portIds.includes(line.dataset.endId)) {
            return true;
        }
    }
    return false;
}

//Calcula a contagem individual de cada letra e número de uma lista de nomes.
function calculateStickerCounts(ctoNames) {
     // Expressão regular para letras (maiúsculas) e números
    const counts = {};
    const charRegex = /[A-Z0-9]/;
    //Verifica o nome da CTO
    ctoNames.forEach(name => {
        // Pula se o nome não for uma string
        if (typeof name !== 'string') return; 
        for (const char of name) {
            const upperChar = char.toUpperCase();
            // Verifica se o caractere é uma letra (A-Z) ou um número (0-9)
            if (charRegex.test(upperChar)) {
                if (!counts[upperChar]) {
                counts[upperChar] = 0;
                }
                counts[upperChar]++;
            }
        }
    });
    return counts;
}

//Renderiza a contagem de adesivos calculada no modal de adesivos.
function renderStickerCounts(counts) {
    const container = document.getElementById('sticker-count-container');
    // Pega as chaves (letras/números) e as ordena
    const sortedKeys = Object.keys(counts).sort();
    if (sortedKeys.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; font-style: italic;">Nenhuma CTO com adesivos selecionados foi encontrada neste projeto.</p>';
        return;
    }
    let html = '<div class="sticker-grid-display">';
    sortedKeys.forEach(key => {
        html += `
        <div class="sticker-chip">
            <span class="sticker-char">${key}</span>
            <span class="sticker-count">${counts[key]}x</span>
        </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

//Sincronização de renomeação de cabos
function updateCableNameInAllFusionPlans(oldName, newName) {
    if (oldName === newName) return; // Nenhum trabalho a fazer
    console.log(`Atualizando nome do cabo em todos os planos: de "${oldName}" para "${newName}"`);
    markers.forEach(markerInfo => {
        //Verifica se o marcador tem um plano de fusão
        if ((markerInfo.type === 'CTO' || markerInfo.type === 'CEO') && markerInfo.fusionPlan) {
            let planUpdated = false;
            try {
                const planData = JSON.parse(markerInfo.fusionPlan);
                if (!planData.elements) return;
                // Cria um DOM temporário para manipular o HTML salvo
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = planData.elements;
                //Encontra o elemento do cabo pelo NOME ANTIGO
                const cableElements = tempDiv.querySelectorAll(`.cable-element[data-cable-name="${oldName}"]`);
                if (cableElements.length > 0) {
                    cableElements.forEach(cableElement => {
                        //Atualiza os dados no DOM temporário
                        cableElement.dataset.cableName = newName; // Atualiza o dataset
                        const titleSpan = cableElement.querySelector('.cable-header span');
                        if (titleSpan) {
                            // Substitui apenas a primeira ocorrência do nome antigo, preservando a (Ponta A/B)
                            titleSpan.textContent = titleSpan.textContent.replace(oldName, newName);
                        }
                    });
                    planUpdated = true;
                }
                //Se o plano foi alterado, salva-o de volta no marcador
                if (planUpdated) {
                    planData.elements = tempDiv.innerHTML;
                    markerInfo.fusionPlan = JSON.stringify(planData);
                    console.log(`Plano de fusão da caixa "${markerInfo.name}" atualizado.`);
                    //Se este plano de fusão estiver aberta, atualiza o DOM ao vivo
                    if (activeMarkerForFusion === markerInfo) {
                        const liveCableElements = document.querySelectorAll(`#fusionCanvas .cable-element[data-cable-name="${oldName}"]`);
                        liveCableElements.forEach(liveCableElement => {
                            liveCableElement.dataset.cableName = newName;
                            const liveTitleSpan = liveCableElement.querySelector('.cable-header span');
                            if (liveTitleSpan) {
                                liveTitleSpan.textContent = liveTitleSpan.textContent.replace(oldName, newName);
                            }
                        });
                    }
                }
            } catch (e) {
                console.error(`Erro ao atualizar o nome do cabo no plano de fusão da ${markerInfo.name}:`, e);
            }
        }
    });
}
