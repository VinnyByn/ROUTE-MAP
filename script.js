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

//"Pontos do mapa" (Mapa e Satélite): esconde comércios, igrejas, pontos de ônibus... e mantém os nomes das ruas
const HIDE_MAP_POI_STYLES = [
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];
let mapPoiVisible = (() => { try { return localStorage.getItem('routemap.mapPoi') !== 'off'; } catch (e) { return true; } })();

function applyMapTheme() {
    if (typeof map === 'undefined' || !map) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const styles = [...(isDark ? DARK_MAP_STYLES : []), ...(mapPoiVisible ? [] : HIDE_MAP_POI_STYLES)];
    map.setOptions({ styles: styles.length ? styles : null });
}

function setMapPoiVisible(visible) {
    mapPoiVisible = visible;
    try { localStorage.setItem('routemap.mapPoi', visible ? 'on' : 'off'); } catch (e) { /* sem armazenamento */ }
    applyMapTheme();
}

//Seletor Mapa/Satélite próprio: os dois menus têm "Pontos do mapa" (os nomes das ruas continuam aparecendo)
function setupMapPoiControl() {
    const poiOption = '<label title="Mostrar ou esconder comércios, igrejas, pontos de ônibus e outros locais do Google"><input type="checkbox" data-opt="poi"> Pontos do mapa</label>';
    const box = document.createElement('div');
    box.className = 'map-type-control';
    box.innerHTML = `
      <div class="mtc-item" data-kind="map">
        <button type="button" class="mtc-btn" data-type="roadmap"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>Mapa</button>
        <div class="mtc-menu">${poiOption}</div>
      </div>
      <div class="mtc-item" data-kind="sat">
        <button type="button" class="mtc-btn" data-type="hybrid"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/></svg>Satélite</button>
        <div class="mtc-menu">${poiOption}</div>
      </div>`;
    const poiInputs = [...box.querySelectorAll('[data-opt="poi"]')];
    poiInputs.forEach(input => {
        input.checked = mapPoiVisible;
        input.addEventListener('change', () => {
            poiInputs.forEach(other => { other.checked = input.checked; });
            setMapPoiVisible(input.checked);
        });
    });
    box.querySelectorAll('[data-type]').forEach(button => {
        button.addEventListener('click', () => map.setMapTypeId(button.dataset.type));
    });
    const sync = () => {
        const isMap = ['roadmap', 'terrain'].includes(map.getMapTypeId());
        box.querySelector('[data-kind="map"]').classList.toggle('is-active', isMap);
        box.querySelector('[data-kind="sat"]').classList.toggle('is-active', !isMap);
    };
    map.addListener('maptypeid_changed', sync);
    sync();
    map.controls[google.maps.ControlPosition.TOP_LEFT].push(box);
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
let projectObjectives = {}; // Resumo / objetivo escrito para o relatório, por Id do projeto (vazio = texto automático)
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
            mapTypeControl: false,
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
        setupMapPoiControl();
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
        showConfirm('Recalcular Lista', 'Isso descartará todas as alterações manuais nesta lista (inclusive itens retirados) e a recalculará a partir do mapa. Deseja continuar?', () => {
            Object.values(projectBoms[projectId] || {}).forEach(item => { delete item.removed; });
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
                    li.innerHTML = `<b>${escapeHtml(item.quantity)}x</b> ${escapeHtml(item.name)}`;
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
    setupProjectSummaryEditor();
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
        if (typeof openGlobalSearch === 'function') {
            openGlobalSearch();
            return;
        }
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
    const usage = { isInPlan: false, hasFusions: false, locations: [], boxes: [] };
    if (!cableInfo?.name) return usage;
    markers.filter(m => (m.type === 'CEO' || m.type === 'CTO' || m.type === 'POP') && m.fusionPlan).forEach(markerInfo => {
        const plan = readFusionPlan(markerInfo);
        const cable = plan?.cables.find(c => planCableMatches(c, cableInfo, markerInfo));
        if (!cable) return;
        usage.isInPlan = true;
        usage.boxes.push(markerInfo);
        if (!usage.locations.includes(markerInfo.name)) usage.locations.push(markerInfo.name);
        if (cable.fibers.some(f => f.connected)) usage.hasFusions = true;
    });
    return usage;
}

//Remove o cabo (sem fusões) dos planos de fusão salvos
function removeCableFromSavedFusionPlans(cableInfo, boxes) {
    boxes.forEach(markerInfo => {
        if (!markerInfo.fusionPlan) return;
        try {
            const planData = JSON.parse(markerInfo.fusionPlan);
            const html = planData.elements || planData.canvas;
            if (!html) return;
            const tempDiv = parseStoredHtml(html);
            const cableElement = Array.from(tempDiv.querySelectorAll('.cable-element'))
                .find(el => planCableMatches({ name: el.dataset.cableName || '', uid: el.dataset.cableUid || '' }, cableInfo, markerInfo));
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

//Excluir projeto: vai para a lixeira (js/project-safety.js); sem a migração da lixeira, apaga de vez
function deleteProject(projectId, projectElement, projectName) {
    moveProjectToTrash(projectId, projectElement, projectName);
}

async function projectExistsInDatabase(projectId) {
    const { data } = await supabaseClient.from('projects').select('id').eq('id', projectId).maybeSingle();
    return !!data;
}

//Fecha o projeto na tela (continua salvo no banco)
function closeProject(projectId, projectElement, projectName) {
    showConfirm('Fechar projeto', `Fechar "${projectName}"? Alterações não salvas serão perdidas. O projeto continua disponível em Projeto → Carregar Projeto.`, () => {
        if (typeof liveSyncLeave === 'function') liveSyncLeave(projectId);
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
        delete projectObjectives[projectId];
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
    if (markerInfo?.name && !cable.startAnchorUid && !cable.endAnchorUid && !markers.some(m => m !== markerInfo && m.name === markerInfo.name)) {
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
    marker.addListener("rightclick", (e) => {
        if (isDrawingCable) return; //No desenho do cabo o botão direito desfaz pontos
        openMapItemMenu('marker', markerInfo, e?.domEvent);
    });
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
    projectSummaryModal: '#saveProjectSummaryButton',
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
    //Distâncias em pixels da tela (convertidas para metros no zoom atual)
    const mpp = getMetersPerPixelAt(clickLatLng);
    const maxDistM = 22 * mpp;
    const minVertexDistM = 9 * mpp;
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

function getMetersPerPixelAt(latLng) {
    const zoom = typeof map?.getZoom === 'function' ? (map.getZoom() ?? 16) : 16;
    const lat = typeof latLng?.lat === 'function' ? latLng.lat() : 0;
    return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
}

// ---------------------------------------------------------------
// Edição do traçado: faixa larga e invisível para o clique pegar fácil, e um ponto-fantasma no meio
// de cada trecho (arrastar ou clicar nele cria um ponto novo ali)
// ---------------------------------------------------------------
let cableHitPolyline = null;
let cableMidHandles = [];
let cableMidDragging = false;

function getCableMidHandleIcon(active = false) {
    return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: active ? 6 : 4.5,
        fillColor: '#ffffff',
        fillOpacity: active ? 1 : 0.85,
        strokeColor: '#2563eb',
        strokeOpacity: 0.9,
        strokeWeight: 1.5,
    };
}

function clearCableEditHelpers() {
    if (cableHitPolyline) cableHitPolyline.setMap(null);
    cableHitPolyline = null;
    cableMidHandles.forEach(h => h.setMap(null));
    cableMidHandles = [];
    cableMidDragging = false;
}

function insertCableVertexFromClick(latLng) {
    const info = findCablePolylineInsertInfo(latLng);
    if (!info) return false;
    if (typeof scheduleSuppressNextCableMapClick === 'function') scheduleSuppressNextCableMapClick();
    insertCableVertexAtIndex(info.insertAt, info.point);
    updatePolylineFromMarkers();
    return true;
}

function refreshCableMidHandles() {
    if (cableMidDragging) return;
    cableMidHandles.forEach(h => h.setMap(null));
    cableMidHandles = [];
    if (!isDrawingCable || cableMarkers.length < 2) return;
    for (let i = 0; i < cableMarkers.length - 1; i++) {
        const a = cableMarkers[i].getPosition();
        const b = cableMarkers[i + 1].getPosition();
        const mid = google.maps.geometry.spherical.interpolate(a, b, 0.5);
        const handle = new google.maps.Marker({
            position: mid, map, draggable: true, zIndex: 900, cursor: 'copy',
            title: 'Arraste (ou clique) para criar um ponto aqui', icon: getCableMidHandleIcon(false),
        });
        let vertex = null;
        handle.addListener('mouseover', () => handle.setIcon(getCableMidHandleIcon(true)));
        handle.addListener('mouseout', () => { if (!vertex) handle.setIcon(getCableMidHandleIcon(false)); });
        handle.addListener('click', () => {
            if (typeof scheduleSuppressNextCableMapClick === 'function') scheduleSuppressNextCableMapClick();
            insertCableVertexAtIndex(i + 1, handle.getPosition());
            updatePolylineFromMarkers();
        });
        handle.addListener('dragstart', () => {
            cableMidDragging = true;
            insertCableVertexAtIndex(i + 1, handle.getPosition());
            vertex = cableMarkers[i + 1];
            vertex.setVisible(false);
        });
        handle.addListener('drag', () => {
            if (!vertex) return;
            vertex.setPosition(handle.getPosition());
            updatePolylineFromMarkers();
        });
        handle.addListener('dragend', () => {
            if (!vertex) return;
            vertex.setPosition(handle.getPosition());
            vertex.setVisible(true);
            cableMidDragging = false;
            handle.setMap(null);
            handleCableVertexDragEnd(cableMarkers.indexOf(vertex));
            updatePolylineFromMarkers();
        });
        cableMidHandles.push(handle);
    }
}

function setupCablePolylineClickInsert() {
    if (!cablePolyline || !isDrawingCable || cableMarkers.length < 2) {
        clearCableEditHelpers();
        return;
    }
    google.maps.event.clearListeners(cablePolyline, "click");
    cablePolyline.addListener("click", (e) => insertCableVertexFromClick(e.latLng));
    //Faixa invisível bem mais larga que o cabo: o clique no "meio do cabo" não escapa
    if (cableHitPolyline) cableHitPolyline.setMap(null);
    cableHitPolyline = new google.maps.Polyline({
        path: cablePolyline.getPath(), map, clickable: true, zIndex: 49,
        strokeColor: '#000000', strokeOpacity: 0.01, strokeWeight: 22,
    });
    cableHitPolyline.addListener('click', (e) => insertCableVertexFromClick(e.latLng));
    refreshCableMidHandles();
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

//Nome no padrão automático ("FO-12-" + nome de uma caixa do mapa): pode ser refeito ao trocar tipo ou ponta B
function isAutoCableName(name) {
    const match = AUTO_CABLE_NAME_RE.exec(name || '');
    return !!match && markers.some(m => m.name === match[2] && (isCableAnchorMarkerType(m.type) || isB2BCableAnchor(m)));
}

//Ponta B mudou (clique, arraste, inverter): o nome automático acompanha a nova caixa
function syncCableNameAutoFill() {
    const endName = cableDrawAnchors.end?.name;
    if (!isDrawingCable || !endName || endName === cableNameAutoFill.endMarkerName) return;
    applyCableNameAutoFill(endName);
}

//Preenche o nome do cabo com "tipo de fibra-nome do marcador da ponta B" (ex.: FO-12-Marcador)
//e o refaz ao trocar o tipo ou a ponta B, enquanto o nome não for digitado à mão
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
    //Foi direto da caixa A para a caixa B: sugere uma rota pelas ruas (o usuário aceita ou desenha)
    if (cableMarkers.length === 2 && typeof suggestCableDrawRoute === 'function') suggestCableDrawRoute();
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
    //Ponta com uid já é de outro marcador; só a ponta sem uid (projeto antigo) olha nome e posição,
    //e só dentro do mesmo projeto (um projeto colado em cima do original fica na mesma posição)
    if (typeof isSameProject === 'function' && !isSameProject(cable, markerInfo)) return false;
    const markerPosition = markerInfo.marker?.getPosition?.();
    const thresholdM = 1;
    const endMatches = (uid, name, point) => {
        if (uid) return false;
        const near = !!markerPosition && google.maps.geometry.spherical.computeDistanceBetween(markerPosition, point) < thresholdM;
        return near || (!!name && name === markerInfo.name && !markers.some(m => m !== markerInfo && m.name === name));
    };
    return endMatches(cable.startAnchorUid, cable.startAnchorMarkerName, cable.path[0])
        || endMatches(cable.endAnchorUid, cable.endAnchorMarkerName, cable.path[cable.path.length - 1]);
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

//Caixa na ponta do cabo (pela âncora gravada ou pela posição)
function getCableEndpointMarker(cable, isStart) {
    if (!cable?.path?.length) return null;
    const point = isStart ? cable.path[0] : cable.path[cable.path.length - 1];
    return resolveCableEndAnchor(cable, isStart)
        || getAnchorMarkerAtPoint(point, 1, getAnchorMarkerCandidatesForFolder(cable.folderId));
}

function getReserveForCableEndpoint(cable, isStart) {
    if (!cable?.path?.length) return 0;
    const markerInfo = getCableEndpointMarker(cable, isStart);
    //Cabo dividido numa reserva técnica: a sobra é uma só, contada no trecho que chega nela (ponta B)
    if (isStart && markerInfo?.type === 'RESERVA' && markerInfo.uid
        && savedCables.some(c => c !== cable && c.endAnchorUid === markerInfo.uid)) return 0;
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

// ---------------------------------------------------------------
// Cabo aéreo x tubulado na lista de materiais
// ---------------------------------------------------------------
//Cada tipo de cabo com parte em duto ganha uma segunda linha ("— TUBULADO"), com acréscimo próprio.
//Vai para o tubulado: os trechos tubulados do traçado e a reserva técnica deixada em caixa instalada em duto.
//O resto (traçado aéreo e reservas nos postes) fica na linha normal do cabo, que é a base das ferragens de poste.
const CABLE_TUBED_SUFFIX = ' — TUBULADO';
const MARKER_DUCT_ACCESSORY = 'Duto';

function getCableTubedBomKey(cableType) {
    return makeBomKey(cableType) + CABLE_TUBED_SUFFIX;
}

//CEO ou reserva instalada em duto/caixa subterrânea (sem raquete nem suporte no poste)
function isMarkerInDuct(markerInfo) {
    if (!markerInfo) return false;
    const accessory = markerInfo.type === 'CEO' ? markerInfo.ceoAccessory
        : markerInfo.type === 'RESERVA' ? markerInfo.reservaAccessory : null;
    return accessory === MARKER_DUCT_ACCESSORY;
}

//Metros do cabo que vão em duto. Do traçado: os trechos tubulados. Da reserva técnica: a das pontas
//que chegam pelo duto (trecho tubulado encostado na ponta) ou em caixa instalada em duto.
//O arredondamento (lançamento de 10 em 10 m e total de 10 em 10 m) é dividido na mesma proporção.
function getCableTubedLength(cable, base = getCableBaseLength(cable)) {
    if (!cable?.path || cable.path.length < 2 || base <= 0) return 0;
    const ranges = cable.conduit?.length && typeof getCableConduitRanges === 'function' ? getCableConduitRanges(cable) : [];
    const hasDuctBox = isMarkerInDuct(getCableEndpointMarker(cable, true)) || isMarkerInDuct(getCableEndpointMarker(cable, false));
    if (!ranges.length && !hasDuctBox) return 0;
    const drawn = google.maps.geometry.spherical.computeLength(cable.path);
    const tubedDrawn = ranges.reduce((sum, r) => sum + (r.to - r.from), 0);
    const closed = cable.path[0].equals(cable.path[cable.path.length - 1]);
    const startReserve = getReserveForCableEndpoint(cable, true);
    const endReserve = closed ? 0 : getReserveForCableEndpoint(cable, false);
    const endInDuct = (isStart) => (isStart ? ranges.some(r => r.from <= 1) : ranges.some(r => r.to >= drawn - 1))
        || isMarkerInDuct(getCableEndpointMarker(cable, isStart));
    const tubedReserve = (endInDuct(true) ? startReserve : 0) + (endInDuct(false) ? endReserve : 0);
    const raw = drawn + startReserve + endReserve;
    if (raw <= 0) return 0;
    return Math.min(base, base * ((tubedDrawn + tubedReserve) / raw));
}

//Medição do tipo de cabo separada em aérea e tubulada, cada parte com o seu acréscimo
function getCableTypeLengthParts(cables, aerialSurcharge = 0, tubedSurcharge = aerialSurcharge) {
    let total = 0;
    let tubed = 0;
    (cables || []).forEach((cable) => {
        const base = getCableBaseLength(cable);
        total += base;
        tubed += getCableTubedLength(cable, base);
    });
    tubed = Math.round(tubed); //Metro inteiro: evita que 500,0000001 m vire 510 m no arredondamento
    const aerialBase = roundLengthUpToTen(total - tubed);
    const tubedBase = roundLengthUpToTen(tubed);
    return {
        aerialBase,
        tubedBase,
        aerial: roundLengthUpToTen(aerialBase * (1 + aerialSurcharge / 100)),
        tubed: roundLengthUpToTen(tubedBase * (1 + tubedSurcharge / 100)),
    };
}

//Acréscimo da linha tubulada; sem valor próprio, segue o do cabo aéreo
function getCableTubedSurcharge(cableType, bom = bomState) {
    const saved = bom?.[getCableTubedBomKey(cableType)]?.surchargePercent;
    const fallback = bom?.[makeBomKey(cableType)]?.surchargePercent;
    return Math.max(0, parseFloat(saved ?? fallback) || 0);
}

//Quantidades exibidas (respeitam a quantidade digitada à mão em cada linha)
function getCableDisplayParts(cableType, cables) {
    const parts = getCableTypeLengthParts(cables, getCableTypeSurcharge(cableType), getCableTubedSurcharge(cableType));
    const manual = (key) => {
        const item = bomState[key];
        return item?.manualQuantity && item.quantity != null ? roundLengthUpToTen(item.quantity) : null;
    };
    parts.aerial = manual(makeBomKey(cableType)) ?? parts.aerial;
    if (parts.tubedBase > 0) parts.tubed = manual(getCableTubedBomKey(cableType)) ?? parts.tubed;
    return parts;
}

function getCableUnitPrice(cableType) {
    const bomKey = makeBomKey(cableType);
    const priceInfo = MATERIAL_PRICES[cableType] || { price: 0 };
    return bomState[bomKey]?.unitPrice ?? priceInfo.price;
}

function getCableDisplayQuantity(cableType, cables) {
    const parts = getCableDisplayParts(cableType, cables);
    return parts.aerial + parts.tubed;
}

//Metragem cobrada do tipo (aéreo + tubulado)
function getCableTypeBillableLength(cables, surchargePercent, tubedSurchargePercent) {
    const type = cables[0]?.type;
    const surcharge = surchargePercent ?? getCableTypeSurcharge(type);
    const tubedSurcharge = tubedSurchargePercent ?? (surchargePercent == null ? getCableTubedSurcharge(type) : surcharge);
    const parts = getCableTypeLengthParts(cables, surcharge, tubedSurcharge);
    return parts.aerial + parts.tubed;
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
    if (typeof syncCableRouteSuggestion === 'function') syncCableRouteSuggestion();
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
    syncCableNameAutoFill();
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

//Nome automático do cabo: "FO-12-<caixa>" (desenho) ou "Cabo AS 80 FO-12-<caixa>" (cabo dividido), com "(2)" opcional
const AUTO_CABLE_NAME_RE = /^(.*?FO-\d+)-(.+?)(?: \(\d+\))?$/;

//A ponta do cabo está nesta caixa? Pela âncora gravada; cabos antigos sem âncora, pelo nome antigo e a posição
function isCableEndAtMarker(cable, markerInfo, isStart, oldName) {
    const uid = isStart ? cable.startAnchorUid : cable.endAnchorUid;
    if (uid && uid === markerInfo.uid) return true;
    if (typeof isSameProject === 'function' && !isSameProject(cable, markerInfo)) return false;
    //Âncora apontando para outra caixa: só vale se essa caixa existir no mesmo projeto do cabo
    //(pasta copiada e colada pode trazer a âncora da caixa original, do outro projeto)
    if (uid) {
        const anchored = markers.find(m => m.uid === uid && m !== markerInfo);
        if (anchored && (typeof isSameProject !== 'function' || isSameProject(cable, anchored))) return false;
    }
    const stored = isStart ? cable.startAnchorMarkerName : cable.endAnchorMarkerName;
    if (stored && stored !== oldName && stored !== markerInfo.name) return false;
    const position = markerInfo.marker?.getPosition?.();
    const point = cable.path?.length ? cable.path[isStart ? 0 : cable.path.length - 1] : null;
    if (!position || !point) return false;
    const reach = stored ? KML_CABLE_ANCHOR_SNAP_DISTANCE_M : 1.5;
    return google.maps.geometry.spherical.computeDistanceBetween(point, position) <= reach;
}

//Mantém o nome gravado nos cabos quando o marcador é renomeado. Cabo que chega nele (ponta B)
//com nome automático "FO-12-<nome antigo>" passa a "FO-12-<nome novo>"; nome digitado à mão fica.
function syncCableAnchorNamesForMarker(markerInfo, oldName = null) {
    if (!markerInfo) return;
    const renamed = [];
    savedCables.forEach(cable => {
        if (isCableEndAtMarker(cable, markerInfo, true, oldName)) cable.startAnchorMarkerName = markerInfo.name;
        if (!isCableEndAtMarker(cable, markerInfo, false, oldName)) return;
        cable.endAnchorMarkerName = markerInfo.name;
        if (cable.endAnchorUid !== markerInfo.uid) { //Cabo antigo ou colado: passa a ficar ligado a esta caixa
            cable.endAnchorUid = ensureMarkerUid(markerInfo);
            cable.endAnchorMarkerFolderId = markerInfo.folderId || null;
        }
        const match = oldName && AUTO_CABLE_NAME_RE.exec(cable.name || '');
        if (!match || match[2] !== oldName || !markerInfo.name) return;
        const base = `${match[1]}-${markerInfo.name}`;
        let newName = base;
        for (let i = 2; savedCables.some(c => c !== cable && c.name === newName); i++) newName = `${base} (${i})`;
        renamed.push({ cable, from: cable.name, to: newName });
    });
    renamed.forEach(({ cable, from, to }) => {
        cable.name = to;
        if (cable.item) updateCableSidebarLabel(cable);
        updateCableNameInAllFusionPlans(from, to, cable);
    });
    if (renamed.length) {
        showToast(renamed.length === 1 ? 'Cabo renomeado' : 'Cabos renomeados',
            renamed.map(r => `"${r.from}" → "${r.to}"`).join(', '));
    }
}

function undoCableVertex() {
    if (!isDrawingCable || cableMarkers.length === 0) return;
    const allowShort = editingCableIndex === null;
    removeCableVertexAtIndex(cableMarkers.length - 1, { allowShort, showAlert: !allowShort });
}

//Cabo importado do KML pode ter as pontas fora das caixas: dá para editar e salvar mesmo assim
function isEditingLooseImportedCable() {
    const cable = editingCableIndex !== null ? savedCables[editingCableIndex] : null;
    return !!(cable && (cable.isImported || cable.fromKmlImport));
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
    const editedCable = editingCableIndex !== null ? savedCables[editingCableIndex] : null;
    const aerialDistance = Math.max(0, (cableDistance.lancamento || 0) - (editedCable && typeof getCableConduitMeters === 'function' ? getCableConduitMeters(editedCable) : 0));
    const tubedMeters = editedCable && typeof getCableConduitMeters === 'function' && editedCable.conduit?.length ? Math.round(getCableConduitMeters(editedCable)) : 0;
    const tubedStat = document.getElementById('cableConduitStat');
    if (tubedStat) tubedStat.hidden = !tubedMeters;
    setText('cableConduitLength', `${tubedMeters} m`);
    setText('cablePoleEstimate', String(aerialDistance ? Math.ceil(aerialDistance / getPoleSpanDistance()) + 1 : 0));
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
    if (saveButton) saveButton.disabled = isEditingLooseImportedCable() ? cableMarkers.length < 2 : !(startAnchor && endAnchor);
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
    clearCableEditHelpers();
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
    if (typeof clearCableRouteSuggestion === 'function') clearCableRouteSuggestion();
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
    clearCableEditHelpers();
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
    const looseImported = isEditingLooseImportedCable();
    if (!startAnchor && !looseImported) {
        showAlert("Ponta A sem caixa", "O cabo deve começar em uma CEO, CTO, reserva ou POP.");
        return;
    }
    if (!endAnchor && !looseImported) {
        showAlert("Ponta B sem caixa", "Termine o cabo clicando em uma CEO, CTO, reserva ou POP antes de salvar.");
        return;
    }
    if (startAnchor && endAnchor && isSameCableAnchorMarker(startAnchor, endAnchor)) {
        showAlert("Pontas iguais", "O cabo não pode começar e terminar na mesma caixa.");
        return;
    }
    //Caixas no mesmo poste (pontas a menos de 1 m) podem ser ligadas: o cabo fica só com a reserva técnica
    if (!(startAnchor && endAnchor) && google.maps.geometry.spherical.computeLength(cablePath) < 1) {
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
        if (oldName !== name) updateCableNameInAllFusionPlans(oldName, name, cabo);
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

//O cabo aberto no editor foi mexido (traçado ou dados) desde que abriu?
function isEditingCableDirty() {
    const cabo = editingCableIndex !== null ? savedCables[editingCableIndex] : null;
    if (!cabo) return false;
    const path = cableMarkers.map(m => m.getPosition());
    const samePath = path.length === cabo.path.length && path.every((p, i) => p.equals(cabo.path[i]));
    const value = (id) => document.getElementById(id)?.value;
    const typeMatches = !getFiberType(cabo.type) || getFiberType(cabo.type) === value('cableType');
    return !samePath || value('cableName') !== cabo.name || !typeMatches
        || String(value('cableWidth')) !== String(cabo.width || getDefaultCableWidthForStatus(cabo.status))
        || value('cableStatusSelect') !== (cabo.status || 'Novo');
}

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
        //Editando outro cabo (clique na barra lateral ou no mapa): troca para o novo.
        //Sem alterações, troca direto; com alterações, pergunta antes de descartar.
        if (editingCableIndex !== null) {
            const switchTo = () => { cancelCableDrawingSession(); openCableEditor(cabo); };
            if (!isEditingCableDirty()) {
                switchTo();
            } else {
                const current = savedCables[editingCableIndex];
                showConfirm('Trocar de cabo', `O cabo "${current?.name || ''}" tem alterações não salvas. Descartar e abrir "${cabo.name}"?`, switchTo);
            }
            return;
        }
        showToast('Cabo em desenho', 'Salve ou cancele o cabo novo antes de abrir outro.', 'progress');
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
    //Nome automático ("FO-12-CTO-01") volta a acompanhar tipo e ponta B; nome digitado à mão fica como está
    cableNameAutoFill = { endMarkerName: cableDrawAnchors.end?.name || null, lastValue: isAutoCableName(cabo.name) ? cabo.name : null };
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
                li.innerHTML = `<b>${escapeHtml(item.quantity)}x</b> ${escapeHtml(item.name)}`;
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

//Trocar a situação (no cabo novo ou na edição) ajusta a espessura: Novo 4, Existente 2
document.getElementById("cableStatusSelect").addEventListener("change", () => {
    if (isDrawingCable) {
        const status = document.getElementById("cableStatusSelect").value;
        if (editingCableIndex === null) currentCableStatus = status;
        const defaultWidth = getDefaultCableWidthForStatus(status);
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
        if (usage.isInPlan) removeCableFromSavedFusionPlans(cableToDelete, usage.boxes);
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
        popEquipment: data.type === "POP" && data.popEquipment ? data.popEquipment : undefined,
        pole: data.type === "POSTE" && data.pole ? data.pole : undefined,
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
    marker.addListener("click", (e) => {
        //Shift + clique: entra ou sai da seleção múltipla (js/map-selection.js)
        if (e?.domEvent?.shiftKey && !isDrawingCable && typeof toggleMapSelectionFromMap === 'function') {
            toggleMapSelectionFromMap(markerInfo);
            return;
        }
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
    const typeLabels = { CEO: 'CEO', CTO: 'CTO', CORDOALHA: 'Cordoalha', RESERVA: 'Reserva', POP: 'POP', POSTE: 'Poste' };
    let details = [];
    if (markerInfo.type === "CTO") details = [markerInfo.ctoStatus, markerInfo.isPredial ? 'Predial' : null, markerInfo.needsStickers ? 'Adesivos' : null];
    if (markerInfo.type === "CEO") details = [markerInfo.ceoStatus, isMarkerInDuct(markerInfo) ? 'Em duto' : markerInfo.ceoAccessory, markerInfo.is144F ? '144F' : null];
    if (markerInfo.type === "CORDOALHA") details = [markerInfo.cordoalhaStatus, markerInfo.derivationTCount ? `${markerInfo.derivationTCount} deriv.` : null];
    if (markerInfo.type === "RESERVA") details = [markerInfo.reservaStatus, isMarkerInDuct(markerInfo) ? 'Em duto' : markerInfo.reservaAccessory];
    if (markerInfo.type === "POSTE") details = [markerInfo.pole?.situation, markerInfo.pole?.height ? `${markerInfo.pole.height} m` : null, markerInfo.pole?.effort ? `${markerInfo.pole.effort} daN` : null];
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
        ul.querySelectorAll(':scope > .ge-pro-item > .ge-vis-checkbox').forEach((cb) => {
            cb.checked = newVisibility;
            cb.dataset.visible = String(newVisibility);
        });
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
    const tubed = typeof getCableConduitMeters === 'function' && cable.conduit?.length ? Math.round(getCableConduitMeters(cable)) : 0;
    setSidebarItemLabel(cable.item, cable.name, [kind, statusLabel, length, tubed ? `${tubed.toLocaleString('pt-BR')} m tubulados` : ''].filter(Boolean).join(' · '));
    applyCableSidebarColorStyles(cable);
}

function setCableInfrastructureStatus(cable, status) {
    if (!cable) return;
    cable.status = status;
    updateCableSidebarLabel(cable);
    refreshBomAfterProjectChange();
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
        totalLength += getCableTypeBillableLength(cables, surcharge, getCableTubedSurcharge(cableType, projectBoms[projectId]));
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

//Atualiza a posição da caixa
function updateInfoBoxPosition(e) {
    if (markerHoverCard?.classList.contains('is-visible')) positionMarkerHoverCard(e.clientX, e.clientY);
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
    polyline.addListener('mouseover', function(event) {
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
        showCableHoverCard(cableData, event?.domEvent);
        mapDiv.addEventListener('mousemove', updateInfoBoxPosition);
    });
    polyline.addListener('rightclick', function(event) {
        const cableData = getCableInfoByPolyline(this);
        if (!cableData || isDrawingCable) return;
        hideMarkerHoverCard(true);
        openMapItemMenu('cable', cableData, event?.domEvent);
    });
    polyline.addListener('mouseout', function() {
        this.setOptions(originalOptions);
        hideMarkerHoverCard();
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

// ---------------------------------------------------------------
// Uma coisa aberta por vez: ao usar a barra superior (menus, conta, relatório, busca…),
// as edições e painéis abertos no mapa fecham. Com alterações não salvas, pergunta antes.
// ---------------------------------------------------------------
function hasUnsavedMapEdit() {
    if (isDrawingCable) return editingCableIndex !== null ? isEditingCableDirty() : cableMarkers.length > 0;
    if (isDrawingPolygon) return true;
    if (typeof dropEditSession !== 'undefined' && dropEditSession) return true;
    return typeof isMarkerPanelDirty === 'function' && isMarkerPanelDirty();
}

function closeOpenMapEditors() {
    if (typeof dropEditSession !== 'undefined' && dropEditSession && typeof cancelClientDropEdit === 'function') cancelClientDropEdit();
    if (typeof isConduitToolOpen === 'function' && isConduitToolOpen()) closeConduitTool();
    if (typeof isCableRouteOpen === 'function' && isCableRouteOpen()) closeCableRoute();
    if (isDrawingCable) cancelCableDrawingSession();
    if (isDrawingPolygon && typeof cancelPolygonDrawing === 'function') cancelPolygonDrawing();
    if (isMeasuring && typeof stopRuler === 'function') stopRuler();
    if (typeof isMarkerPanelOpen === 'function' && (isMarkerPanelOpen() || isAddingMarker)) resetMarkerModal();
    if (typeof closeNetworkImpact === 'function' && !document.getElementById('networkImpactBox')?.classList.contains('hidden')) closeNetworkImpact();
    document.getElementById('projectCheckBox')?.classList.add('hidden');
    if (typeof isAutoDesignOpen === 'function' && isAutoDesignOpen()) closeAutoDesign();
}

document.addEventListener('click', (e) => {
    const button = e.target.closest?.('.top-bar button');
    if (!button || button.id === 'quickSaveButton') return;
    if (!hasUnsavedMapEdit()) {
        closeOpenMapEditors();
        return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    showConfirm('Descartar alterações?', 'Há uma edição aberta no mapa com alterações não salvas. Descartar e continuar?', () => {
        closeOpenMapEditors();
        setTimeout(() => button.click(), 0); //Depois do clique em "Confirmar" (que fecha os menus abertos)
    });
}, true);

//Clicar fora da janela (no fundo escuro) fecha, como o X. O plano de fusão e a prévia do relatório,
//onde se perde trabalho fácil, só fecham pelo botão.
const MODALS_WITHOUT_BACKDROP_CLOSE = new Set(['fusionModal', 'reportPreviewModal']);
let modalBackdropPress = null;
document.addEventListener('mousedown', (e) => {
    modalBackdropPress = e.button === 0 && e.target.classList?.contains('modal') ? e.target : null;
}, true);
document.addEventListener('click', (e) => {
    const modal = e.target;
    if (!modalBackdropPress || modal !== modalBackdropPress) return;
    modalBackdropPress = null;
    if (!modal.classList.contains('modal') || MODALS_WITHOUT_BACKDROP_CLOSE.has(modal.id)) return;
    modal.querySelector('.close')?.click();
    if (getComputedStyle(modal).display !== 'none') modal.style.display = 'none';
}, true);

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
//Renomeia o cabo nos planos de fusão: nome do cartão, ids das fibras (levavam o nome antigo) e as fusões
//cable (opcional): só os cartões deste cabo (pelo uid; cartões antigos sem uid, pelo nome)
function renameCableInPlanDom(root, lineRoot, oldName, newName, cable = null, box = null, newUid = null) {
    const cards = Array.from(root.querySelectorAll('.cable-element')).filter(el => {
        if (el.dataset.cableName !== oldName) return false;
        if (!cable) return true;
        if (el.dataset.cableUid) return el.dataset.cableUid === cable.uid;
        //Cartão antigo (sem uid): é deste cabo se não há outro com o nome antigo, ou se ele chega na caixa
        const others = savedCables.filter(c => c !== cable && c.name === oldName);
        return !others.length || (!!box && isCableConnectedToMarker(cable, box) && !others.some(c => isCableConnectedToMarker(c, box)));
    });
    if (!cards.length) return false;
    const safeNew = newName.replace(/\s+/g, '-');
    const idMap = new Map();
    cards.forEach(card => {
        card.dataset.cableName = newName;
        if (newUid) card.dataset.cableUid = newUid;
        const title = card.querySelector('.cable-header-name, .cable-header span');
        if (title) title.textContent = title.textContent.replace(oldName, newName);
        card.querySelectorAll('.fiber-row').forEach(row => {
            const n = getFiberNumberFromId(row.id);
            if (!n) return;
            let id = `cable-${safeNew}-fiber-${n}`;
            for (let i = 2; root.querySelector(`[id="${CSS.escape(id)}"]`) && root.querySelector(`[id="${CSS.escape(id)}"]`) !== row; i++) {
                id = `cable-${safeNew}~${i}-fiber-${n}`;
            }
            if (id !== row.id) idMap.set(row.id, id);
            row.id = id;
        });
    });
    lineRoot?.querySelectorAll('.fusion-line').forEach(line => {
        if (idMap.has(line.dataset.startId)) line.dataset.startId = idMap.get(line.dataset.startId);
        if (idMap.has(line.dataset.endId)) line.dataset.endId = idMap.get(line.dataset.endId);
    });
    return true;
}

function updateCableNameInAllFusionPlans(oldName, newName, cable = null) {
    if (oldName === newName) return;
    markers.forEach(markerInfo => {
        //Cliente ligado direto no cabo (B2B) guarda o nome do cabo
        if (markerInfo.type === 'CLIENTE' && markerInfo.client) {
            if (cable && markerInfo.client.cableUid && markerInfo.client.cableUid !== cable.uid) return;
            if (markerInfo.client.cableName === oldName) markerInfo.client.cableName = newName;
            if (markerInfo.client.linkedCable === oldName) markerInfo.client.linkedCable = newName;
            return;
        }
        if ((markerInfo.type !== 'CTO' && markerInfo.type !== 'CEO' && markerInfo.type !== 'POP') || !markerInfo.fusionPlan) return;
        try {
            const planData = JSON.parse(markerInfo.fusionPlan);
            if (!planData.elements) return;
            const tempDiv = parseStoredHtml(planData.elements);
            const tempSvg = planData.svg ? parseStoredSvg(planData.svg) : null;
            if (!renameCableInPlanDom(tempDiv, tempSvg, oldName, newName, cable, markerInfo)) return;
            planData.elements = tempDiv.innerHTML;
            if (tempSvg) planData.svg = tempSvg.innerHTML;
            markerInfo.fusionPlan = JSON.stringify(planData);
            //Plano aberto na tela: aplica o mesmo
            if (activeMarkerForFusion === markerInfo) {
                renameCableInPlanDom(getFusionStage(), getFusionSvg(), oldName, newName, cable, markerInfo);
            }
        } catch (e) {
            console.error(`Erro ao atualizar o nome do cabo no plano de fusão da ${markerInfo.name}:`, e);
        }
    });
}
