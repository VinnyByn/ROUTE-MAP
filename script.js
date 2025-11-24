// ===================================================================
// == INÍCIO DA LÓGICA DE AUTENTICAÇÃO
// ===================================================================

// Objeto de configuração do Firebase (o mesmo da sua tela de login)
const firebaseConfig = {
    apiKey: "AIzaSyDU9hPehECHZcT22hqwNif8QgHbw8i1nRo",
    authDomain: "tccmapa-cf786.firebaseapp.com",
    projectId: "tccmapa-cf786",
    storageBucket: "tccmapa-cf786.firebasestorage.app",
    messagingSenderId: "1030067224652",
    appId: "1:1030067224652:web:128c5f55810a83b18074e9"
};

// Inicializa o Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// GUARDIÃO: Verifica o estado de autenticação do usuário
// Esta função é o "porteiro" da sua página.
auth.onAuthStateChanged((user) => {
    if (user) {
        // Se existe um 'user', significa que ele está logado.
        // A página pode continuar carregando normalmente.
        console.log('Usuário autenticado:', user.email);
    } else {
        // Se não existe um 'user', ele não está logado.
        // Redireciona imediatamente para a tela de login.
        console.log('Nenhum usuário autenticado. Redirecionando para login...');
        window.location.href = 'login.html';
    }
});
// ===================================================================
// == FIM DA LÓGICA DE AUTENTICAÇÃO
// ===================================================================

// (O código completo do script.js será inserido aqui)
let map;
let isAddingMarker = false;
let pendingSplitterInfo = null; // <-- ADICIONADO
let selectedMarkerType = "";
let cablePath = [];
let cablePolyline = null;
let isDrawingCable = false;
let cableDistance = { lancamento: 0, reserva: 0, total: 0 }; // MODIFICADO
let activeFolderId = null;
let cableMarkers = []; // armazenar marcadores dos pontos do cabo
let savedCables = [];
// Armazena cabos desenhados
let editingCableIndex = null; // Índice do cabo sendo editado
let currentCableStatus = "Novo";
let selectedSplitterInfo = { type: "", connector: "" }; // NOVO: Armazena a seleção do splitter
let selectedMarkerData = {
  type: "",
  name: "",
  color: "#ff0000",
  labelColor: "#000000",
  size: 8,
  description: "",
  ctoStatus: "Nova",
  ceoStatus: "Nova",
  ceoAccessory: "Raquete",
  cordoalhaStatus: "Nova",
  reservaStatus: "Nova",
  reservaAccessory: "Raquete",
  derivationTCount: 0,
};
let markers = []; // Array para armazenar todos os objetos de marcadores
let editingMarkerInfo = null;
// Guarda o objeto do marcador que está sendo editado
let placeMarkerListener = null;
// Variável para armazenar o listener de clique temporário
let activeMarkerForFusion = null;
// Guarda o marcador ativo para o painel de fusão
let editingFolderElement = null; // Guarda o elemento da pasta/projeto sendo editado
let bomState = {}; // O estado ATUAL da Lista de Materiais (Bill of Materials)
let savedBomState = {}; // O estado SALVO da Lista de Materiais
let removedMaterials = new Set(); // Guarda os nomes dos itens removidos
let addedMaterials = {}; // Guarda os itens adicionados manualmente
let projectBoms = {};
// Variáveis para a lógica de conexão de fusão
let fusionDrawingState = {
    isActive: false,
    startElement: null,
    points: [],
    tempLine: null,
    tempHandles: []
};
let activeLineForAction = null;
let isEditingLine = false;    
let cableInfoBox;
let searchMarker = null;
let drawingManager;
let isMeasuring = false;
let rulerPolyline;
let rulerMarkers = [];
let savedPolygons = [];
let isDrawingPolygon = false;
let editingPolygonIndex = null;
let tempPolygon = null; // Armazena o polígono enquanto ele é desenhado
let draggedLineData = null;
let adjustingKmlMarkerInfo = null;
let hoverTooltipTimer = null; // Guarda o timer do delay de 2s
let hoverTooltipElement = null; // O elemento <div> do tooltip
let projectObservations = {};

const ABNT_FIBER_COLORS = [
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
const ABNT_GROUP_COLORS = {
  colors: ["#28a745", "#ffc107", "#ffffff"],
  names: ["Verde", "Amarelo", "Branco"],
};

// --- NOVAS FUNÇÕES PARA MODAIS PERSONALIZADOS ---
function showAlert(title, message) {
  const alertModal = document.getElementById('alertModal');
  document.getElementById('alertModalTitle').textContent = title;
  document.getElementById('alertModalMessage').textContent = message;
  alertModal.style.display = 'flex';
}

function showConfirm(title, message, onConfirm) {
  const confirmModal = document.getElementById('confirmModal');
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalMessage').textContent = message;

  const confirmButton = document.getElementById('confirmModalConfirmButton');
  
  // Clona e substitui o botão para remover listeners antigos
  const newConfirmButton = confirmButton.cloneNode(true);
  confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);

  newConfirmButton.addEventListener('click', () => {
    confirmModal.style.display = 'none';
    onConfirm();
  });

  confirmModal.style.display = 'flex';
}

// ===================================================================
// == NOVAS FUNÇÕES DE BANCO DE DADOS (FIRESTORE)
// ===================================================================

// Encontre e substitua toda a sua função saveProjectToFirestore por esta:

/**
 * Coleta todos os dados de um projeto e os salva no Firestore. (VERSÃO CORRIGIDA)
 */
function saveProjectToFirestore() {
    const currentUser = auth.currentUser;
    if (!currentUser) {
        showAlert("Erro", "Você precisa estar logado para salvar um projeto.");
        return;
    }

    const activeElement = document.getElementById(activeFolderId);
    if (!activeElement) {
        showAlert("Atenção", "Por favor, selecione um projeto ou um item dentro de um projeto para salvar.");
        return;
    }

    const projectRootElement = activeElement.closest('.folder');
    if (!projectRootElement) {
        showAlert("Erro", "Não foi possível encontrar o projeto principal. Selecione um item e tente novamente.");
        return;
    }

    const projectTitleDiv = projectRootElement.querySelector('.folder-title');
    const projectUl = projectRootElement.querySelector('ul');
    const projectId = projectTitleDiv.dataset.folderId;
    const projectName = projectTitleDiv.dataset.folderName;

    showAlert("Salvando...", `O projeto "${projectName}" está sendo salvo no banco de dados.`);

    // ----> CORREÇÃO PRINCIPAL AQUI <----
    // 1. Cria um objeto para o projeto principal, em vez de apenas pegar seus filhos.
    const sidebarStructure = {
        id: projectUl.id,
        name: projectTitleDiv.dataset.folderName,
        city: projectTitleDiv.dataset.folderCity || null,
        neighborhood: projectTitleDiv.dataset.folderNeighborhood || null,
        type: projectTitleDiv.dataset.folderType,
        isProject: true,
        children: getSidebarStructureAsJSON(projectUl) // Pega as subpastas recursivamente
    };

    // 2. Serializa os marcadores, cabos e polígonos do projeto
    const allFolderIds = getAllDescendantFolderIds(projectId);
    const projectMarkers = markers.filter(m => allFolderIds.includes(m.folderId)).map(serializeMarker);
    const projectCables = savedCables.filter(c => allFolderIds.includes(c.folderId)).map(serializeCable);
    const projectPolygons = savedPolygons.filter(p => allFolderIds.includes(p.folderId)).map(serializePolygon);
    
    // 3. Monta o objeto de dados final
    const projectData = {
        userId: currentUser.uid,
        projectName: projectName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        sidebar: sidebarStructure, 
        markers: projectMarkers,
        cables: projectCables,
        polygons: projectPolygons,
        bom: projectBoms[projectId] || null,
        observations: projectObservations[projectId] || null
    };

    // 4. Envia para o Firestore
    db.collection("users").doc(currentUser.uid).collection("projects").doc(projectId).set(projectData)
        .then(() => {
            showAlert("Sucesso!", `Projeto "${projectName}" salvo com sucesso.`);
        })
        .catch((error) => {
            console.error("Erro ao salvar projeto: ", error);
            showAlert("Erro", "Ocorreu um erro ao salvar o projeto. Verifique o console para mais detalhes.");
        });
}

/**
 * Busca os projetos do usuário no Firestore e os exibe no modal de carregamento. (VERSÃO MODIFICADA)
 */
function loadProjectsFromFirestore() {
    const currentUser = auth.currentUser;
    if (!currentUser) {
        showAlert("Erro", "Você precisa estar logado para carregar projetos.");
        return;
    }

    const modal = document.getElementById('loadProjectModal');
    const listElement = document.getElementById('saved-projects-list');
    listElement.innerHTML = '<li>Carregando...</li>';
    modal.style.display = 'flex';

    db.collection("users").doc(currentUser.uid).collection("projects").orderBy("createdAt", "desc").get()
        .then((querySnapshot) => {
            listElement.innerHTML = '';
            if (querySnapshot.empty) {
                listElement.innerHTML = '<li>Nenhum projeto salvo encontrado.</li>';
                return;
            }
            
            querySnapshot.forEach((doc) => {
                const project = doc.data();
                const projectId = doc.id;
                const li = document.createElement('li');
                
                li.innerHTML = `
                    <div style="padding: 15px; border: 1px solid #ddd; border-radius: 5px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                        <span><strong>${project.projectName}</strong> <br><small>Salvo em: ${project.createdAt ? project.createdAt.toDate().toLocaleString() : 'Data indisponível'}</small></span>
                        <button class="load-project-btn" style="padding: 8px 12px;">Carregar</button>
                    </div>
                `;
                listElement.appendChild(li);

                const loadButton = li.querySelector('.load-project-btn');
                loadButton.addEventListener('click', () => {
                    console.log(`Botão 'Carregar' clicado para o projeto: ${project.projectName} (ID: ${projectId})`);

                    if (document.getElementById(projectId)) {
                        showAlert("Aviso", `O projeto "${project.projectName}" já está carregado.`);
                        modal.style.display = 'none';
                        return;
                    }
                    
                    modal.style.display = 'none';
                    loadAndDisplayProject(projectId, project);
                });
            });
        })
        .catch((error) => {
            console.error("Erro ao carregar lista de projetos: ", error);
            listElement.innerHTML = '<li>Ocorreu um erro ao buscar os projetos.</li>';
        });
}


// ===================================================================
// == FUNÇÕES AUXILIARES PARA SALVAR/CARREGAR
// ===================================================================

/** Limpa completamente a área de trabalho (sidebar e mapa). */
function clearWorkspace() {
    // Limpa o mapa
    markers.forEach(m => m.marker.setMap(null));
    savedCables.forEach(c => c.polyline.setMap(null));
    savedPolygons.forEach(p => p.polygonObject.setMap(null));
    if (searchMarker) searchMarker.setMap(null);

    // Reseta os arrays de estado
    markers = [];
    savedCables = [];
    savedPolygons = [];
    
    // Limpa a sidebar
    document.getElementById("sidebar").innerHTML = '';
    
    // Reseta contadores e estado ativo
    activeFolderId = null;
    projectCounter = 1;
    folderCounter = 1;
}

// Encontre e substitua toda a sua função loadAndDisplayProject por esta:

function loadAndDisplayProject(projectId, projectData) {
    if (!projectData || !projectData.sidebar) {
        console.error("Dados do projeto ou da sidebar estão faltando. Carregamento cancelado.", projectData);
        showAlert("Erro de Dados", "Os dados deste projeto parecem estar corrompidos. Não foi possível carregar.");
        return;
    }
    
    const sidebar = document.getElementById("sidebar");
    
    rebuildSidebarFromJSON([projectData.sidebar], sidebar);
    
    if (projectData.polygons) {
        projectData.polygons.forEach(polygonData => rebuildPolygon(polygonData));
    }
    if (projectData.markers) {
        projectData.markers.forEach(markerData => rebuildMarker(markerData));
    }
    if (projectData.cables) {
        projectData.cables.forEach(cableData => rebuildCable(cableData));
    }
    if (projectData.bom) {
        projectBoms[projectId] = projectData.bom;
    }
    if (projectData.observations) {
        projectObservations[projectId] = projectData.observations;
    }
    showAlert("Sucesso", `Projeto "${projectData.projectName}" carregado!`);
}

/**
 * Adiciona um projeto específico à área de trabalho. (VERSÃO CORRIGIDA)
 */
function rebuildPolygon(data) {
    const googleMapsPath = data.path.map(p => new google.maps.LatLng(p.lat, p.lng));

    const polygon = new google.maps.Polygon({
        paths: googleMapsPath,
        map: map,
        fillColor: data.color,
        strokeColor: data.color,
        fillOpacity: 0.5,
        strokeWeight: 2,
        clickable: true,
        editable: false
    });
    const template = document.getElementById('polygon-template');
    const clone = template.content.cloneNode(true);
    const li = clone.querySelector('li');
    li.querySelector('.item-name').textContent = data.name;
    li.querySelector('.item-icon').style.backgroundColor = data.color;
    
    const parentUl = document.getElementById(data.folderId);
    if (parentUl) {
      parentUl.appendChild(li);
    } else {
      console.error(`Elemento pai com ID "${data.folderId}" não encontrado para o polígono "${data.name}"`);
    }

    const polygonInfo = { ...data, path: googleMapsPath, polygonObject: polygon, listItem: li };
    savedPolygons.push(polygonInfo);

    // ----> CORREÇÃO PRINCIPAL AQUI <----
    // Adiciona eventos passando o objeto 'polygonInfo' diretamente
    polygon.addListener('click', () => openPolygonEditor(polygonInfo));
    li.querySelector('.item-name').addEventListener('click', () => openPolygonEditor(polygonInfo));
    
    li.querySelector('.visibility-toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = polygon.getVisible();
        polygon.setVisible(!isVisible);
        e.currentTarget.querySelector('img').src = isVisible ? 'img/Ocultar.png' : 'img/Mostrar.png';
    });
}

// --- Funções de Serialização (Objeto JavaScript -> JSON Simples) ---

function serializeMarker(markerInfo) {
    const marker = markerInfo.marker;
    const position = marker.getPosition();
    return {
        folderId: markerInfo.folderId,
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
        position: { lat: position.lat(), lng: position.lng() }
    };
}

function serializeCable(cableInfo) {
    return {
        folderId: cableInfo.folderId,
        name: cableInfo.name,
        type: cableInfo.type,
        width: cableInfo.width,
        color: cableInfo.color,
        status: cableInfo.status,
        lancamento: cableInfo.lancamento,
        reserva: cableInfo.reserva,
        totalLength: cableInfo.totalLength,
        path: cableInfo.path.map(latLng => ({ lat: latLng.lat(), lng: latLng.lng() }))
    };
}

// SUBSTITUA A SUA FUNÇÃO 'serializePolygon' POR ESTA:
function serializePolygon(polygonInfo) {
    // Pega o caminho ATUAL diretamente do objeto do Google Maps
    const currentPath = polygonInfo.polygonObject.getPath().getArray();
    
    return {
        folderId: polygonInfo.folderId,
        name: polygonInfo.name,
        color: polygonInfo.color,
        // SEMPRE converte o caminho atual para {lat, lng} antes de salvar
        path: currentPath.map(p => ({ lat: p.lat(), lng: p.lng() }))
    };
}

function getSidebarStructureAsJSON(ulElement) {
    const structure = [];
    const children = ulElement.children; // li ou div.folder

    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.matches('[data-placeholder="true"]')) continue;

        let titleDiv, subUl, isProject;
        
        if (child.classList.contains('folder')) { // É um Projeto
             titleDiv = child.querySelector('.folder-title');
             subUl = child.querySelector('ul');
             isProject = true;
        } else if (child.classList.contains('folder-wrapper')) { // É uma Pasta
             titleDiv = child.querySelector('.folder-title');
             subUl = child.querySelector('ul');
             isProject = false;
        } else { // É um item (marcador, cabo, etc)
            // Não precisamos salvar itens individuais aqui, pois eles já estão nos arrays de dados
            continue; 
        }

        if (titleDiv && subUl) {
            const node = {
                id: subUl.id,
                name: titleDiv.dataset.folderName,
                city: titleDiv.dataset.folderCity || null,
                neighborhood: titleDiv.dataset.folderNeighborhood || null,
                type: isProject ? titleDiv.dataset.folderType : 'folder',
                isProject: isProject,
                children: getSidebarStructureAsJSON(subUl) // Recursão
            };
            structure.push(node);
        }
    }
    return structure;
}

// --- Funções de Reconstrução (JSON Simples -> Objetos e DOM) ---

// (VERSÃO CORRIGIDA)
function rebuildSidebarFromJSON(structureArray, parentElement) {
    structureArray.forEach(nodeData => {
        if (!nodeData) return;
        
        const templateId = nodeData.isProject ? 'project-template' : 'folder-template';
        const template = document.getElementById(templateId);
        if (!template) {
            console.error(`Template com ID "${templateId}" não encontrado!`);
            return;
        }

        const clone = template.content.cloneNode(true);
        const titleDiv = clone.querySelector('.folder-title');
        const nameSpan = clone.querySelector('.folder-name-text');
        const subList = clone.querySelector('ul');
        const visibilityBtn = clone.querySelector('.visibility-toggle-btn');

        nameSpan.textContent = nodeData.name;
        subList.id = nodeData.id;
        titleDiv.dataset.folderId = nodeData.id;
        titleDiv.dataset.folderName = nodeData.name;
        if(visibilityBtn) visibilityBtn.dataset.folderId = nodeData.id;
        
        if (nodeData.isProject) {
            titleDiv.dataset.folderCity = nodeData.city;
            titleDiv.dataset.folderNeighborhood = nodeData.neighborhood;
            titleDiv.dataset.folderType = nodeData.type;
        }

        const toggleIcon = titleDiv.querySelector('.toggle-icon');
        toggleIcon.onclick = (e) => { e.stopPropagation(); toggleFolder(nodeData.id); };
        titleDiv.onclick = (e) => {
            if (e.target.closest('.folder-buttons') || e.target.closest('.toggle-icon')) return;
            e.stopPropagation();
            setActiveFolder(nodeData.id);
        };
        
        addDropTargetListenersToFolderTitle(titleDiv);

        titleDiv.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            titleDiv.classList.remove('dragover-target'); // Remove feedback visual
            
            const subUl = document.getElementById(titleDiv.dataset.folderId);
            if (subUl && !subUl.contains(e.relatedTarget)) {
                subUl.classList.remove('dragover'); // Esconde o placeholder
            }
        });

        titleDiv.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            titleDiv.classList.remove('dragover-target');
            
            const subUl = document.getElementById(titleDiv.dataset.folderId);
            if (subUl) {
                subUl.classList.remove('dragover'); // Limpa
                handleDropOnFolder(e, subUl); // Delega para sua função de drop existente
            }
        });
        // ===================================================================
        // == FIM DA MODIFICAÇÃO                                          ==
        // ===================================================================

        enableDropOnFolder(subList);

        if (nodeData.children && nodeData.children.length > 0) {
            rebuildSidebarFromJSON(nodeData.children, subList);
        }
        
        const finalElement = clone.querySelector('.folder') || clone.querySelector('.folder-wrapper');
        enableDragAndDropForItem(finalElement);
        parentElement.appendChild(finalElement);
    });
}

// Recria um marcador a partir dos dados salvos (VERSÃO CORRIGIDA)
function rebuildMarker(data) {
    const position = new google.maps.LatLng(data.position.lat, data.position.lng);

    const marker = new google.maps.Marker({
        position: position,
        map: map,
        draggable: false
    });
    
    const li = document.createElement("li");
    enableDragAndDropForItem(li);
    const nameSpan = document.createElement("span");
    nameSpan.className = 'item-name';
    nameSpan.style.cursor = "pointer";
    nameSpan.style.flexGrow = '1';
    
    const visibilityBtn = document.createElement("button");
    visibilityBtn.className = 'visibility-toggle-btn item-toggle';
    visibilityBtn.innerHTML = `<img src="img/Mostrar.png" width="16" height="16" alt="Visibilidade">`;
    visibilityBtn.dataset.visible = 'true';
    
    li.appendChild(nameSpan);
    li.appendChild(visibilityBtn);
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    
    const parentUl = document.getElementById(data.folderId);
    if(parentUl) {
      parentUl.appendChild(li);
    } else {
      console.error(`Elemento pai com ID "${data.folderId}" não encontrado para o marcador "${data.name}"`);
    }

    const markerInfo = { ...data, position: position, marker: marker, listItem: li };
    markers.push(markerInfo);
    updateMarkerAppearance(markerInfo);

    // --- CORREÇÃO PRINCIPAL AQUI ---
    // Adiciona o event listener de clique com a lógica COMPLETA
    marker.addListener("click", () => {
        if (isDrawingCable) {
            // Lógica de desenho de cabo que estava faltando
            if (cablePath.length === 0) {
                if (markerInfo.type !== "CEO" && markerInfo.type !== "CTO" && markerInfo.type !== "RESERVA") {
                        showAlert("Aviso", "Cabos devem ser iniciados em um marcador do tipo CEO, CTO ou Reserva.");
                    return;
                }
            }

            const markerPosition = markerInfo.marker.getPosition();
            cablePath.push(markerPosition);

            const cablePointMarker = new google.maps.Marker({
                position: markerPosition,
                map: map,
                draggable: true,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 5,
                    fillColor: "#ffffff",
                    fillOpacity: 1,
                    strokeColor: "#000000",
                    strokeWeight: 1,
                },
            });

            cableMarkers.push(cablePointMarker);
            cablePointMarker.addListener("drag", () => updatePolylineFromMarkers());
            cablePointMarker.addListener("dblclick", () => {
                const index = cableMarkers.indexOf(cablePointMarker);
                if (index !== -1) {
                    cableMarkers[index].setMap(null);
                    cableMarkers.splice(index, 1);
                    updatePolylineFromMarkers();
                }
            });
            updatePolylineFromMarkers();
        } else {
            // Lógica para editar o marcador (já estava correta)
            openMarkerEditor(markerInfo);
        }
    });

    nameSpan.addEventListener("click", () => openMarkerEditor(markerInfo));
    visibilityBtn.onclick = (e) => {
      e.stopPropagation();
      const isVisible = marker.getVisible();
      marker.setVisible(!isVisible);
      visibilityBtn.dataset.visible = !isVisible;
      visibilityBtn.querySelector('img').src = !isVisible ? 'img/Mostrar.png' : 'img/Ocultar.png';
    };
}

// EM script.js:
// Localize e substitua TODA a sua função rebuildCable por esta versão

// Recria um cabo a partir dos dados salvos
function rebuildCable(data) {
    const googleMapsPath = data.path.map(p => new google.maps.LatLng(p.lat, p.lng));

    const polyline = new google.maps.Polyline({
        path: googleMapsPath,
        map: map,
        strokeColor: data.color,
        strokeWeight: data.width,
        clickable: true
    });
    
    const item = document.createElement("li");
    const nameSpan = document.createElement("span");
    
    // --- CORREÇÃO 1: A variável correta é 'item', não 'li' ---
    enableDragAndDropForItem(item);
    
    nameSpan.className = 'item-name';
    nameSpan.textContent = `${data.name} (${data.status}) - ${data.totalLength}m`;
    nameSpan.style.color = data.color;
    nameSpan.style.cursor = "pointer";
    nameSpan.style.flexGrow = '1';

    const visibilityBtn = document.createElement("button");
    visibilityBtn.className = 'visibility-toggle-btn item-toggle';
    visibilityBtn.innerHTML = `<img src="img/Mostrar.png" width="16" height="16" alt="Visibilidade">`;
    visibilityBtn.dataset.visible = 'true';
    
    item.appendChild(nameSpan);
    item.appendChild(visibilityBtn);
    item.style.display = 'flex';
    // Adicionei estas duas linhas para garantir o alinhamento dos botões no item
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';

    // --- CORREÇÃO 2: Verificação de segurança ANTES de anexar ---
    const parentUl = document.getElementById(data.folderId);
    if (parentUl) {
        // Se a pasta-pai (ul) foi encontrada, anexa o item (li) nela
        parentUl.appendChild(item);
    } else {
        // Se a pasta-pai não foi encontrada, o script NÃO QUEBRA.
        // Ele avisa no console e descarta este cabo, mas continua o loop para os próximos.
        console.error(`Falha ao carregar o cabo "${data.name}". A pasta-pai (ID: ${data.folderId}) não foi encontrada no DOM.`);
        // Remove a polyline do mapa, já que não podemos adicioná-la à lista
        polyline.setMap(null); 
        return; // Pula para o próximo cabo no loop
    }
    // --- Fim da Correção 2 ---

    // O resto da função continua
    const cableInfo = { ...data, path: googleMapsPath, polyline: polyline, item: item };
    savedCables.push(cableInfo);
    
    const realIndex = savedCables.length - 1;

    nameSpan.addEventListener("click", () => openCableEditor(cableInfo));
    polyline.addListener("click", () => openCableEditor(cableInfo));
    addCableEventListeners(polyline, realIndex);
    
    visibilityBtn.onclick = (e) => {
      e.stopPropagation();
      const isVisible = polyline.getVisible();
      polyline.setVisible(!isVisible);
      visibilityBtn.dataset.visible = !isVisible;
      visibilityBtn.querySelector('img').src = !isVisible ? 'img/Mostrar.png' : 'img/Ocultar.png';
    };
}

// Recria um polígono a partir dos dados salvos (VERSÃO CORRIGIDA)
function rebuildPolygon(data) {
    // ----> CORREÇÃO PRINCIPAL AQUI <----
    const googleMapsPath = data.path.map(p => new google.maps.LatLng(p.lat, p.lng));

    const polygon = new google.maps.Polygon({
        paths: googleMapsPath, // Usa o caminho convertido
        map: map,
        fillColor: data.color,
        strokeColor: data.color,
        fillOpacity: 0.5,
        strokeWeight: 2,
        clickable: true,
        editable: false
    });
    const template = document.getElementById('polygon-template');
    const clone = template.content.cloneNode(true);
    const li = clone.querySelector('li');
    enableDragAndDropForItem(li);
    li.querySelector('.item-name').textContent = data.name;
    li.querySelector('.item-icon').style.backgroundColor = data.color;
    
    const parentUl = document.getElementById(data.folderId);
    if (parentUl) {
      parentUl.appendChild(li);
    } else {
      console.error(`Elemento pai com ID "${data.folderId}" não encontrado para o polígono "${data.name}"`);
    }


    const index = savedPolygons.length;
    // Salva a informação completa, incluindo o objeto do Google Maps
    const polygonInfo = { ...data, path: googleMapsPath, polygonObject: polygon, listItem: li };
    savedPolygons.push(polygonInfo);

    // Adiciona eventos
    polygon.addListener('click', () => openPolygonEditor(index));
    li.querySelector('.item-name').addEventListener('click', () => openPolygonEditor(index));
    li.querySelector('.visibility-toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = polygon.getVisible();
        polygon.setVisible(!isVisible);
        e.currentTarget.querySelector('img').src = isVisible ? 'img/Ocultar.png' : 'img/Mostrar.png';
    });
}

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: -20.1394, lng: -44.8872 },
    zoom: 10,
  });
  cableInfoBox = document.getElementById('cableInfoBox');
  map.addListener("click", handleMapClick);

  map.addListener("dblclick", () => {
    if (isDrawingCable && cablePath.length >= 2) {
      showAlert("Aviso", "Clique em 'Salvar Cabo' para finalizar.");
    }
  });

  // --- CONFIGURAÇÃO DOS MODAIS E LISTENERS ---

   // Listeners para os botões de Salvar e Carregar
  document.getElementById('saveProjectButton').addEventListener('click', saveProjectToFirestore);

    // NOVO: Listener para o botão "Carregar Projeto" na barra superior
  document.getElementById('loadProjectButton').addEventListener('click', () => {
      // Apenas abre o modal e limpa os campos e resultados anteriores
      document.getElementById('searchProjectName').value = '';
      document.getElementById('searchProjectCity').value = '';
      document.getElementById('searchProjectNeighborhood').value = '';
      document.getElementById('saved-projects-list').innerHTML = '';
      document.getElementById('loadProjectModal').style.display = 'flex';
  });

  // NOVO: Listener para o botão de "Buscar" DENTRO do modal
  document.getElementById('searchProjectsButton').addEventListener('click', searchProjectsInFirestore);

  // NOVO: Listener para o botão de fechar do modal de carregamento
  document.getElementById('closeLoadProjectModal').addEventListener('click', () => {
      document.getElementById('loadProjectModal').style.display = 'none';
  });

  // Listeners para os modais de Alerta e Confirmação
  const alertModal = document.getElementById('alertModal');
  document.getElementById('alertModalOkButton').addEventListener('click', () => alertModal.style.display = 'none');

  const confirmModal = document.getElementById('confirmModal');
  document.getElementById('confirmModalCancelButton').addEventListener('click', () => confirmModal.style.display = 'none');

   document.getElementById('exportKmlButton').addEventListener('click', (e) => {
        e.preventDefault();
        exportProjectToKML();
        document.getElementById('projectDropdown').classList.remove('show');
    });

    // Listener para o novo botão de Importar KML
    const kmlFileInput = document.getElementById('kml-file-input');
    document.getElementById('importKmlButton').addEventListener('click', (e) => {
        e.preventDefault();
        kmlFileInput.click(); // Abre a janela de seleção de arquivo
        document.getElementById('projectDropdown').classList.remove('show');
    });
    kmlFileInput.addEventListener('change', handleKmlFileSelect);

  // Modal de Novo Projeto
  const projectModal = document.getElementById("projectModal");
  const closeProjectModal = document.getElementById("closeProjectModal");
  const cancelProjectButton = document.getElementById("cancelProjectButton");
  const confirmProjectButton = document.getElementById("confirmProjectButton");
  const createProjectButton = document.getElementById("createProjectButton");

  createProjectButton.addEventListener("click", () => {
    document.getElementById("projectName").value = "";
    document.getElementById("projectCity").value = "";
    document.getElementById("projectNeighborhood").value = "";
    document.getElementById("projectType").value = "TCR";
    projectModal.style.display = "flex";
  });
  const closeProjectModalFunction = () => {
    const projectModal = document.getElementById('projectModal');
    // Reseta o modal para o modo de criação
    projectModal.querySelector('h2').textContent = 'Novo Projeto';
    projectModal.querySelector('#confirmProjectButton').textContent = 'Criar Projeto';
    document.getElementById('projectCity').closest('div').style.display = 'block';
    document.getElementById('projectNeighborhood').closest('div').style.display = 'block';
    document.getElementById('projectType').closest('div').style.display = 'block';
    
    projectModal.style.display = "none";
    editingFolderElement = null; // Limpa a variável de edição
  };
  closeProjectModal.addEventListener("click", closeProjectModalFunction);
  cancelProjectButton.addEventListener("click", closeProjectModalFunction);
  confirmProjectButton.addEventListener("click", createProject);
  
  // Modal de Nova Pasta
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
    // Reseta o modal para o modo de criação
    folderModal.querySelector('h2').textContent = 'Nova Pasta';
    folderModal.querySelector('#confirmFolderButton').textContent = 'Criar Pasta';

    folderModal.style.display = "none";
    editingFolderElement = null; // Limpa a variável de edição
  };
  closeFolderModal.addEventListener("click", closeFolderModalFunction);
  cancelFolderButton.addEventListener("click", closeFolderModalFunction);
  confirmFolderButton.addEventListener("click", createFolder);

  // Modal de Lista de Materiais
  // Encontre e substitua o listener do materialListButton dentro de initMap():
  materialListButton.addEventListener("click", () => {
      if (!activeFolderId) {
          showAlert("Atenção", "Por favor, selecione um projeto na barra lateral para ver sua lista de materiais.");
          return;
      }

      const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
      if (!projectRootElement) {
          showAlert("Erro", "Item selecionado não pertence a um projeto. Selecione o projeto ou um item dentro dele.");
          return;
      }

      const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
      const projectName = projectRootElement.querySelector('.folder-title').dataset.folderName;

      // Atualiza o título do modal com o nome do projeto correto
      document.getElementById('materialModalTitle').textContent = `Lista de Materiais: ${projectName}`;

      // ----> LÓGICA PRINCIPAL AQUI <----
      // 1. Verifica se já existe uma lista salva na memória para este projeto
      if (projectBoms[projectId]) {
          // Se sim, carrega essa lista (que pode conter edições manuais)
          bomState = JSON.parse(JSON.stringify(projectBoms[projectId]));
      } else {
          // 2. Se não, calcula uma lista nova do zero com base nos itens do mapa
          calculateBomState(); // A função já sabe usar o projeto ativo
          // 3. E salva essa lista recém-calculada na memória para futuras consultas
          projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
      }
      
      // Renderiza a tabela com a lista correta (seja a salva ou a recém-calculada)
      renderBomTable();
      materialModal.style.display = "flex";
  });

  const materialModal = document.getElementById("materialModal");
  const closeMaterialModal = document.getElementById("closeMaterialModal");
  const saveMaterialChangesButton = document.getElementById('saveMaterialChangesButton');
  const recalculateBomButton = document.getElementById('recalculateBomButton');
  const exportMaterialButton = document.getElementById('exportMaterialButton');

  closeMaterialModal.addEventListener("click", () => {
    materialModal.style.display = "none";
  });

  saveMaterialChangesButton.addEventListener('click', () => {
    if (!activeFolderId) return;
    const projectId = document.getElementById(activeFolderId).closest('.folder').querySelector('.folder-title').dataset.folderId;
    projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
    showAlert('Sucesso', 'Alterações salvas com sucesso!');
  });

  recalculateBomButton.addEventListener('click', () => {
      if (!activeFolderId) {
          showAlert("Atenção", "Nenhum projeto selecionado para recalcular.");
          return;
      }
      const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
      const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;

      showConfirm('Recalcular Lista', 'Isso descartará todas as alterações manuais nesta lista e a recalculará a partir do mapa. Deseja continuar?', () => {
        calculateBomState(); // Recalcula o estado atual a partir do mapa
        // Salva a nova lista recalculada como a versão "oficial" para este projeto
        projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
        renderBomTable(); // Atualiza a visualização com a nova lista
      });
  });

  exportMaterialButton.addEventListener('click', () => {
      exportTablesToExcel();
  });

    // --- INÍCIO DO BLOCO CORRIGIDO DO MODAL DE ADESIVOS ---
      // Define a variável do modal aqui, para que todos os listeners a acessem
      const stickersModal = document.getElementById('stickersModal');

      // Listener para o botão "Adesivos" na lista de materiais
      document.getElementById('openStickersModalButton').addEventListener('click', () => {
          
          // 1. Verificar se um projeto está ativo
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

          // 2. Coletar os dados (apenas marcadores são necessários aqui)
          const { markers: projectMarkers } = getProjectItems(projectId);
          
          // 3. Filtrar os nomes das CTOs que precisam de adesivos
          const ctoNames = projectMarkers
              .filter(m => m.type === 'CTO' && m.needsStickers === true)
              .map(m => m.name);

          // 4. Calcular a contagem
          const counts = calculateStickerCounts(ctoNames);

          // 5. Renderizar o HTML no modal
          renderStickerCounts(counts);
          
          // 6. Mostrar o modal
          stickersModal.style.display = 'flex';
      });

      // CORREÇÃO: Listener para o 'X' de fechar (ID: closeStickersModal)
      document.getElementById('closeStickersModal').addEventListener('click', () => {
          stickersModal.style.display = 'none';
      });
      
      // CORREÇÃO: Listener para o botão "Fechar" (ID: closeStickersModalButton)
      document.getElementById('closeStickersModalButton').addEventListener('click', () => {
          stickersModal.style.display = 'none';
      });
      // --- FIM DO BLOCO CORRIGIDO DO MODAL DE ADESIVOS ---

  // Listeners para o NOVO modal de Edição de Material
  const editMaterialModal = document.getElementById('editMaterialModal');
  document.getElementById('closeEditMaterialModal').addEventListener('click', () => editMaterialModal.style.display = 'none');
  document.getElementById('cancelEditMaterial').addEventListener('click', () => editMaterialModal.style.display = 'none');
  document.getElementById('confirmEditMaterial').addEventListener('click', handleUpdateMaterial);

  // Listener para o botão Mão de Obra
  document.getElementById('laborButton').addEventListener('click', openLaborModal);

  // Listeners para o NOVO modal de Adicionar Material
  const addMaterialModal = document.getElementById('addMaterialModal');
  const addMaterialButton = document.getElementById('addMaterialButton');
  const closeAddMaterialModal = document.getElementById('closeAddMaterialModal');
  const cancelAddMaterial = document.getElementById('cancelAddMaterial');
  const confirmAddMaterial = document.getElementById('confirmAddMaterial');

  addMaterialButton.addEventListener('click', () => {
    // Limpa os campos antes de abrir
    document.getElementById('materialNameInput').value = '';
    document.getElementById('materialQtyInput').value = 1;
    document.getElementById('materialPriceInput').value = 0;
    addMaterialModal.style.display = 'flex';
  });
  
  closeAddMaterialModal.addEventListener('click', () => addMaterialModal.style.display = 'none');
  cancelAddMaterial.addEventListener('click', () => addMaterialModal.style.display = 'none');
  confirmAddMaterial.addEventListener('click', handleAddNewMaterial);

  // Listeners para os modais de Mão de Obra
  document.getElementById('closeLaborModal').addEventListener('click', () => document.getElementById('laborModal').style.display = 'none');
  document.getElementById('closeOutsourcedDetailsModal').addEventListener('click', () => document.getElementById('outsourcedDetailsModal').style.display = 'none');
  
  document.getElementById('closeRegionalLaborModal').addEventListener('click', () => document.getElementById('regionalLaborModal').style.display = 'none');
  document.getElementById('cancelRegionalLabor').addEventListener('click', () => document.getElementById('regionalLaborModal').style.display = 'none');
  document.getElementById('confirmRegionalLabor').addEventListener('click', handleRegionalLaborConfirm);

  document.getElementById('closeOutsourcedLaborModal').addEventListener('click', () => document.getElementById('outsourcedLaborModal').style.display = 'none');
  document.getElementById('cancelOutsourcedLabor').addEventListener('click', () => document.getElementById('outsourcedLaborModal').style.display = 'none');
  document.getElementById('confirmOutsourcedLabor').addEventListener('click', handleOutsourcedLaborConfirm);

    // --- NOVO BLOCO DE LISTENERS PARA O MODAL DE AÇÃO DA LINHA ---
  const lineActionModal = document.getElementById('lineActionModal');
  const closeLineActionModal = document.getElementById('closeLineActionModal');
  const cancelLineActionButton = document.getElementById('cancelLineActionButton');
  const editLineButton = document.getElementById('editLineButton');
  const deleteLineConfirmButton = document.getElementById('deleteLineConfirmButton');

  const closeActionModal = () => {
      lineActionModal.style.display = 'none';
      activeLineForAction = null;
  };

  closeLineActionModal.addEventListener('click', closeActionModal);
  cancelLineActionButton.addEventListener('click', closeActionModal);

  deleteLineConfirmButton.addEventListener('click', () => {
      if (activeLineForAction) {
          const lineId = activeLineForAction.id;
          activeLineForAction.remove();
          document.querySelectorAll(`.line-handle[data-line-id="${lineId}"]`).forEach(h => h.remove());
          const materialName = "TUBETE PROTETOR DE EMENDA OPTICA";
          if (activeFolderId) {
              const projectId = document.getElementById(activeFolderId).closest('.folder')?.querySelector('.folder-title').dataset.folderId;
              if (projectId && projectBoms[projectId] && projectBoms[projectId][materialName]) {
                  if (projectBoms[projectId][materialName].quantity > 0) {
                      projectBoms[projectId][materialName].quantity -= 1;
                  }
              }
          }
      }
      closeActionModal();
  });

  editLineButton.addEventListener('click', () => {
      if (activeLineForAction) {
          startLineEdit(activeLineForAction);
      }
      closeActionModal();
  });

  // Modal de Seleção de Tipo de Marcador
  const markerTypeModal = document.getElementById("markerTypeModal");
  const closeTypeModalButton = document.getElementById("closeTypeModal");
  closeTypeModalButton.addEventListener("click", () => {
    markerTypeModal.style.display = "none";
  });

  // Modal de Seleção de Estado do Cabo
  const cableStatusSelectionModal = document.getElementById("cableStatusSelectionModal");
  const closeCableStatusModal = document.getElementById("closeCableStatusModal");
  closeCableStatusModal.addEventListener("click", () => {
      cableStatusSelectionModal.style.display = "none";
  });

  // Modal de Seleção de Estado da CTO
  const ctoStatusSelectionModal = document.getElementById("ctoStatusSelectionModal");
  const closeCtoStatusModal = document.getElementById("closeCtoStatusModal");
  closeCtoStatusModal.addEventListener("click", () => {
      ctoStatusSelectionModal.style.display = "none";
  });

  // Novos Modais da CEO
  const ceoStatusSelectionModal = document.getElementById("ceoStatusSelectionModal");
  const closeCeoStatusModal = document.getElementById("closeCeoStatusModal");
  closeCeoStatusModal.addEventListener("click", () => {
    ceoStatusSelectionModal.style.display = "none";
  });

  const ceoAccessorySelectionModal = document.getElementById("ceoAccessorySelectionModal");
  const closeCeoAccessoryModal = document.getElementById("closeCeoAccessoryModal");
  closeCeoAccessoryModal.addEventListener("click", () => {
    ceoAccessorySelectionModal.style.display = "none";
  });

  // Modais de Cordoalha e Reserva
  const cordoalhaStatusSelectionModal = document.getElementById("cordoalhaStatusSelectionModal");
  const closeCordoalhaStatusModal = document.getElementById("closeCordoalhaStatusModal");
  closeCordoalhaStatusModal.addEventListener("click", () => {
      cordoalhaStatusSelectionModal.style.display = "none";
  });

  const reservaStatusSelectionModal = document.getElementById("reservaStatusSelectionModal");
  const closeReservaStatusModal = document.getElementById("closeReservaStatusModal");
  closeReservaStatusModal.addEventListener("click", () => {
      reservaStatusSelectionModal.style.display = "none";
  });

    // Modal de Data Center
  const datacenterChoiceModal = document.getElementById("datacenterChoiceModal");
  const addDatacenterEquipmentButton = document.getElementById("addDatacenterEquipmentButton");
  const closeDatacenterChoiceModal = document.getElementById("closeDatacenterChoiceModal");
  addDatacenterEquipmentButton.addEventListener("click", () => {
      datacenterChoiceModal.style.display = "flex";
  });
  closeDatacenterChoiceModal.addEventListener("click", () => {
      datacenterChoiceModal.style.display = "none";
  });

  // ===== INÍCIO DA CORREÇÃO =====
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
            fixedItemsList.innerHTML = ''; // Limpa a lista antes de preencher
            POP_KIT_CONFIG.fixed.forEach(item => {
                const li = document.createElement('li');
                li.style.marginBottom = '5px';
                li.innerHTML = `<b>${item.quantity}x</b> ${item.name}`;
                fixedItemsList.appendChild(li);
            });

            popKitModal.style.display = 'flex';
        }
    });
    });
    // ===== FIM DA CORREÇÃO =====

  // Modal do Kit Placa
  const placaKitModal = document.getElementById("placaKitModal");
  const closePlacaKitModal = document.getElementById("closePlacaKitModal");
  const cancelPlacaKit = document.getElementById("cancelPlacaKit");
  const confirmPlacaKit = document.getElementById("confirmPlacaKit");

  const closePlacaModalFn = () => placaKitModal.style.display = 'none';
  closePlacaKitModal.addEventListener("click", closePlacaModalFn);
  cancelPlacaKit.addEventListener("click", closePlacaModalFn);
  confirmPlacaKit.addEventListener("click", () => {
    // 1. Pega o ID do projeto ativo para saber onde salvar
    const projectRootElement = document.getElementById(activeFolderId)?.closest('.folder');
    if (!projectRootElement) {
        showAlert("Erro", "Nenhum projeto selecionado. Não foi possível adicionar o material.");
        return;
    }
    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;

    // 2. Adiciona os materiais (isso atualiza a lista salva 'projectBoms')
    const cordaoQty = parseInt(document.getElementById('placaCordaoQty').value, 10);
    const oltQty = parseInt(document.getElementById('placaOltQty').value, 10);
    const sfpQty = parseInt(document.getElementById('placaSfpQty').value, 10);

    if (cordaoQty > 0) addMaterialToBom('CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2m', cordaoQty);
    if (oltQty > 0) addMaterialToBom('PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)', oltQty);
    if (sfpQty > 0) addMaterialToBom('MÓDULO SFP C+ PARA PLACA OLT LINE ANYPON ZTE', sfpQty);
    
    // 3. === CORREÇÃO CRÍTICA ===
    // Sincroniza a lista temporária (bomState) com a lista salva e atualizada do projeto.
    if (projectBoms[projectId]) {
        bomState = JSON.parse(JSON.stringify(projectBoms[projectId]));
    }

    // 4. Agora, redesenha a tabela com os dados corretos
    renderBomTable();
    
    // 5. Fecha os modais
    placaKitModal.style.display = 'none';
    datacenterChoiceModal.style.display = 'none';
  });

  // Modal do Kit OLT
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

    if (cordaoQty > 0) addMaterialToBom('CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2m', cordaoQty);
    if (placaOltQty > 0) addMaterialToBom('PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)', placaOltQty);
    if (sfpQty > 0) addMaterialToBom('MÓDULO SFP C+ PARA PLACA OLT LINE ANYPON ZTE', sfpQty);

    addMaterialToBom('CHASSI OLT C650 ZTE', 1);
    addMaterialToBom('LICENÇA OLT', 1);
    addMaterialToBom('MÓDULO DE ENERGIA DC C650-C600 PARA OLT ZTE', 2);
    addMaterialToBom('PLACA CONTROLADORA E SWITCHING C600/C650', 1);
    addMaterialToBom('SWITCH MPLS 24 PORTAS', 1);
    addMaterialToBom('SFP 850NM 10G 0,3KM MULTIMODO DUPLEX', 2);
    addMaterialToBom('SFP GBIC ELÉTRICO', 1);

    if (projectBoms[projectId]) {
        bomState = JSON.parse(JSON.stringify(projectBoms[projectId]));
    }
    
    renderBomTable();
    oltKitModal.style.display = 'none';
    datacenterChoiceModal.style.display = 'none';
  });
    
    // Modal do Kit POP
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

    if (placaOltQty > 0) addMaterialToBom('PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)', placaOltQty);
    if (sfpQty > 0) addMaterialToBom('MÓDULO SFP C+ PARA PLACA OLT LINE ANYPON ZTE', sfpQty);
    if (cordaoScApcQty > 0) addMaterialToBom('CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2m', cordaoScApcQty);
    
    POP_KIT_CONFIG.fixed.forEach(item => addMaterialToBom(item.name, item.quantity));

    if (projectBoms[projectId]) {
        bomState = JSON.parse(JSON.stringify(projectBoms[projectId]));
    }

    renderBomTable();
    popKitModal.style.display = 'none';
    datacenterChoiceModal.style.display = 'none';
  });

  // Modal de Edição de Marcador
  document.getElementById("closeModal").addEventListener("click", () => {
    resetMarkerModal();
  });

  // Modal de Fusão
  const fusionModal = document.getElementById("fusionModal");
  const closeFusionModal = document.getElementById("closeFusionModal");
  const saveFusionPlanButton = document.getElementById("saveFusionPlan");
  const fusionCanvas = document.getElementById("fusionCanvas");
  fusionCanvas.addEventListener('dragstart', (e) => {
      e.preventDefault();
  });
  fusionCanvas.addEventListener('mousedown', (e) => {
      if (e.target.closest('.fusion-line')) {
          e.preventDefault();
      }
  });
  closeFusionModal.addEventListener("click", () => {
    fusionModal.style.display = "none";
    activeMarkerForFusion = null;
  });

  saveFusionPlanButton.addEventListener("click", () => {
    if (activeMarkerForFusion) {
      const canvas = document.getElementById("fusionCanvas");
      const svgLayer = document.getElementById("fusion-svg-layer");

      // 1. Cria um container temporário para armazenar apenas os elementos
      const elementsContainer = document.createElement('div');
      canvas.querySelectorAll('.cable-element, .splitter-element').forEach(el => {
        // Clona cada elemento para não afetar o original
        elementsContainer.appendChild(el.cloneNode(true));
      });
      
      // 2. Salva o HTML dos elementos e o HTML do conteúdo do SVG em chaves separadas
      const elementsHTML = elementsContainer.innerHTML;
      const svgHTML = svgLayer.innerHTML;

      const planData = {
        elements: elementsHTML, // Salva apenas os cabos e splitters
        svg: svgHTML,           // Salva apenas as linhas e handles
      };

      // 3. Adiciona os dados extras (quantidade de bandejas para CEO)
      if (activeMarkerForFusion.type === 'CEO') {
          planData.trayQuantity = document.getElementById('trayKitQuantity').value || 0;
      }

      // 4. Converte tudo para uma string JSON e salva no marcador
      activeMarkerForFusion.fusionPlan = JSON.stringify(planData);

      showAlert("Sucesso", "Plano de fusão salvo com sucesso!");
    }
    fusionModal.style.display = "none";
    activeMarkerForFusion = null;
  });
  
  document.getElementById("addCableToFusion").addEventListener("click", () => {
    openCableSelectionModal();
  });

  // Modal de Seleção de Splitter
  const splitterModal = document.getElementById("splitterSelectionModal");
  const closeSplitterModal = document.getElementById("closeSplitterModal");
  document
    .getElementById("addSplitterToFusion")
    .addEventListener("click", () => {
      selectedSplitterInfo = { type: "", connector: "" };
      document.getElementById("splitterTypeModal").style.display = "flex";
    });
  closeSplitterModal.addEventListener("click", () => {
    splitterModal.style.display = "none";
  });
  
  const splitterTypeModal = document.getElementById("splitterTypeModal");
  const splitterConnectorModal = document.getElementById("splitterConnectorModal");

  document.getElementById("closeSplitterTypeModal").addEventListener('click', () => splitterTypeModal.style.display = 'none');
  document.getElementById("closeSplitterConnectorModal").addEventListener('click', () => splitterConnectorModal.style.display = 'none');
  
  function showFinalSplitterModal(categoryToShow) {
    const finalModal = document.getElementById("splitterSelectionModal");
    const categories = finalModal.querySelectorAll(".splitter-category");
    
    categories.forEach(cat => {
      if (cat.dataset.category === categoryToShow) {
        cat.classList.remove('hidden');
      } else {
        cat.classList.add('hidden');
      }
    });

    finalModal.style.display = "flex";
  }

  splitterTypeModal.querySelectorAll(".datacenter-option").forEach(option => {
    option.addEventListener("click", () => {
      const type = option.getAttribute("data-type");
      selectedSplitterInfo.type = type;
      splitterTypeModal.style.display = "none";

      if (type === "Atendimento") {
        splitterConnectorModal.style.display = "flex";
      } else {
        showFinalSplitterModal('fusao');
      }
    });
  });

  splitterConnectorModal.querySelectorAll(".datacenter-option").forEach(option => {
    option.addEventListener("click", () => {
      const connector = option.getAttribute("data-connector");
      selectedSplitterInfo.connector = connector;
      splitterConnectorModal.style.display = "none";

      showFinalSplitterModal('atendimento');
    });
  });
  
  document.querySelectorAll(".splitter-option").forEach((option) => {
      option.addEventListener("click", () => {
          const type = option.getAttribute("data-type");
          const ratio = option.getAttribute("data-ratio");

          let label = ratio.replace("/", ":");
          if (selectedSplitterInfo.type === "Atendimento") {
              label += ` ${selectedSplitterInfo.connector}`;
          }

          const outputCount = parseInt(ratio.split("/")[1], 10);

          pendingSplitterInfo = {
              label,
              outputCount,
              type: selectedSplitterInfo.type,
              connector: selectedSplitterInfo.connector
          };

          const splitterSelectionModal = document.getElementById("splitterSelectionModal");
          splitterSelectionModal.style.display = "none";

          document.getElementById("splitterStatusSelectionModal").style.display = "flex";
      });
  });

    const splitterStatusSelectionModal = document.getElementById("splitterStatusSelectionModal");
    document.getElementById("closeSplitterStatusModal").addEventListener("click", () => {
        splitterStatusSelectionModal.style.display = "none";
    });

    document.querySelectorAll(".splitter-status-option").forEach(option => {
        option.addEventListener("click", () => {
            const status = option.getAttribute("data-status");
            splitterStatusSelectionModal.style.display = "none";
            addSplitterToCanvas(status);
        });
    });

  // Modal de Seleção de Cabo
  const cableSelectionModal = document.getElementById("cableSelectionModal");
  const closeCableSelectionModal = document.getElementById(
    "closeCableSelectionModal"
  );
  closeCableSelectionModal.addEventListener("click", () => {
    cableSelectionModal.style.display = "none";
  });
  
// Modal de Relatório 
  const projectReportButton = document.getElementById("projectReportButton");
  const reportModal = document.getElementById("reportModal");
  const closeReportModal = document.getElementById("closeReportModal");
  const backToProjectList = document.getElementById("backToProjectList");

  projectReportButton.addEventListener("click", openReportModal);
  closeReportModal.addEventListener("click", () => { reportModal.style.display = "none"; });
  backToProjectList.addEventListener("click", () => {
    document.getElementById("report-project-details").classList.add("hidden");
    document.getElementById("report-project-list").classList.remove("hidden");
  });

  // Outros Listeners
  document
    .getElementById("deleteMarkerButton")
    .addEventListener("click", deleteEditingMarker);
  
  document.getElementById("sidebar").addEventListener('click', (e) => {
      const actionToggleButton = e.target.closest('.item-actions-toggle-btn');

      if (actionToggleButton) {
          e.preventDefault();
          e.stopPropagation();
          const menu = actionToggleButton.nextElementSibling;

          document.querySelectorAll('.item-actions-menu.show').forEach(openMenu => {
              if (openMenu !== menu) {
                  openMenu.classList.remove('show');
              }
          });
          
          if (menu) {
              menu.classList.toggle('show');
          }
        
          return;
      }

      const visibilityButton = e.target.closest('.visibility-toggle-btn:not(.item-toggle)');
      const editButton = e.target.closest('.edit-folder-btn');
      const deleteProjectButton = e.target.closest('.delete-project-btn');
      const deleteFolderButton = e.target.closest('.delete-folder-btn');

      const menuLink = e.target.closest('.item-actions-menu a');
      if (menuLink) {
          const parentMenu = menuLink.closest('.item-actions-menu');
          if (parentMenu) {
              parentMenu.classList.remove('show');
          }
      }

      if (visibilityButton) {
          handleVisibilityToggle(visibilityButton);
          return;
      }
      if (editButton) {
          const titleElement = editButton.closest('.folder-title');
          openFolderEditor(titleElement);
          return;
      }
      if (deleteProjectButton) {
          const titleElement = deleteProjectButton.closest('.folder-title');
          const projectElement = titleElement.closest('.folder');
          const projectId = titleElement.dataset.folderId;
          const projectName = titleElement.dataset.folderName;
          deleteProject(projectId, projectElement, projectName);
          return;
      }
      if (deleteFolderButton) {
        const titleElement = deleteFolderButton.closest('.folder-title');
        const folderElement = titleElement.closest('.folder-wrapper');
        const folderId = titleElement.dataset.folderId;
        const folderName = titleElement.dataset.folderName;
        deleteFolder(folderId, folderElement, folderName);
        return;
      }
  });

    const openSearchModalButton = document.getElementById('openSearchModalButton');
    const searchModal = document.getElementById('searchModal');
    const closeSearchModal = document.getElementById('closeSearchModal');
    const structuredSearchButton = document.getElementById('structuredSearchButton');

    openSearchModalButton.addEventListener('click', () => {
      // Removemos as linhas que tentavam limpar os campos de endereço
      document.getElementById('searchCoordinates').value = '';
      searchModal.style.display = 'flex';
    });

    closeSearchModal.addEventListener('click', () => {
      searchModal.style.display = 'none';
    });

    structuredSearchButton.addEventListener('click', performStructuredSearch);
    
    function setupDropdownInteractions() {
        window.addEventListener('click', (event) => {
            if (!event.target.closest('.dropdown')) {
                document.querySelectorAll('.dropdown-content.show').forEach(openDropdown => {
                    openDropdown.classList.remove('show');
                });
            }
        });

        document.querySelectorAll('.dropdown .top-bar-button').forEach(button => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const dropdownContent = button.nextElementSibling;
                const isAlreadyOpen = dropdownContent.classList.contains('show');
                
                document.querySelectorAll('.dropdown-content.show').forEach(openDropdown => {
                    if (openDropdown !== dropdownContent) {
                        openDropdown.classList.remove('show');
                    }
                });

                if (!isAlreadyOpen) {
                    dropdownContent.classList.add('show');
                } else {
                    dropdownContent.classList.remove('show');
                }
            });
        });
    }

    setupDropdownInteractions();

    document.getElementById('drawPolygonButton').addEventListener('click', startPolygonTool);
    document.getElementById('savePolygonButton').addEventListener('click', savePolygon);
    document.getElementById('cancelPolygonButton').addEventListener('click', cancelPolygonDrawing);
    document.getElementById('deletePolygonButton').addEventListener('click', deletePolygon);
    document.getElementById('rulerButton').addEventListener('click', startRuler);
    document.getElementById('cancelRulerButton').addEventListener('click', stopRuler);

    const logoutButton = document.getElementById('logoutButton');
    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            auth.signOut().then(() => {
                console.log('Usuário deslogado com sucesso.');
            }).catch((error) => {
                console.error('Erro ao fazer logout:', error);
                showAlert('Erro', 'Não foi possível sair. Tente novamente.');
            });
        });
    }

    function makeSidebarResizable() {
    const resizer = document.getElementById('dragHandle');
    const container = document.querySelector('.container');

    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isResizing = true;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', stopResizing);
    });

    function handleMouseMove(e) {
        if (!isResizing) return;
        const newSidebarWidth = e.clientX;
        if (newSidebarWidth > 200 && newSidebarWidth < 800) {
            container.style.gridTemplateColumns = `${newSidebarWidth}px 5px 1fr`;
        }
    }

    function stopResizing() {
        isResizing = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', stopResizing);
    }
  }

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
        clearTimeout(hoverTooltipTimer); // Cancela qualquer timer pendente
        hoverTooltipTimer = null;
        
        if (hoverTooltipElement) {
            hoverTooltipElement.style.opacity = '0'; // Inicia o "fade-out"
            
            // Espera a animação de fade-out terminar para esconder o <div>
            setTimeout(() => {
                // Só esconde se um novo timer não tiver sido iniciado
                if (!hoverTooltipTimer) { 
                    hoverTooltipElement.style.display = 'none';
                }
            }, 200); // 200ms (tempo da transição do CSS)
        }
    };

    // 2. Monitora o MOUSEOVER na barra lateral inteira
    sidebar.addEventListener('mouseover', (e) => {
        // Verifica se o mouse está sobre um nome de pasta ou item
        const target = e.target.closest('.folder-name-text, .item-name');
        
        if (!target) {
            // Se o mouse não está sobre um alvo, esconde
            hideTooltip();
            return;
        }

        // Verifica se o texto do alvo está realmente cortado (ellipsis)
        // (Se o nome completo já for visível, não faz nada)
        const isTruncated = target.scrollWidth > target.clientWidth;

        if (isTruncated) {
            // Limpa qualquer timer antigo
            clearTimeout(hoverTooltipTimer);
            
            // Pega o texto completo e a posição do alvo
            const fullText = target.textContent;
            const rect = target.getBoundingClientRect();
            
            // Posição: 5px abaixo do elemento, alinhado à esquerda
            const posX = rect.left;
            const posY = rect.bottom + 5;

            // Inicia o timer de 2 segundos
            hoverTooltipTimer = setTimeout(() => {
                hoverTooltipElement.textContent = fullText;
                hoverTooltipElement.style.left = `${posX}px`;
                hoverTooltipElement.style.top = `${posY}px`;
                hoverTooltipElement.style.display = 'block';
                
                // Truque para forçar a animação de "fade-in"
                requestAnimationFrame(() => {
                    hoverTooltipElement.style.opacity = '1';
                });
            }, 2000); // 2 segundos (2000ms)
        } else {
            // Se o texto não está cortado, garante que o tooltip esteja escondido
            hideTooltip();
        }
    });

    // 3. Monitora o MOUSELEAVE (saída do mouse)
    // Se o mouse sair da barra lateral inteira, esconde o tooltip
    sidebar.addEventListener('mouseleave', hideTooltip);
    // --- FIM DA ADIÇÃO (Passo 2.B) ---

    const observationsModal = document.getElementById('observationsModal');
    const openObservationsButton = document.getElementById('openObservationsButton');
    const closeObservationsModal = document.getElementById('closeObservationsModal');
    const cancelObservationButton = document.getElementById('cancelObservationButton');
    const saveObservationButton = document.getElementById('saveObservationButton');

    // Botão "Adicionar/Editar Observações" (no modal de relatório)
    openObservationsButton.addEventListener('click', () => {
        // Pega o ID do projeto que o relatório está exibindo
        const projectId = document.getElementById('report-project-details').dataset.currentProjectId;
        if (!projectId) {
            showAlert("Erro", "Não foi possível identificar o projeto.");
            return;
        }

        // Armazena o ID no modal de observações
        document.getElementById('observationProjectId').value = projectId;

        // Carrega o texto salvo (se houver)
        document.getElementById('observationsTextarea').value = projectObservations[projectId] || '';

        // Mostra o modal de observações
        observationsModal.style.display = 'flex';
    });

    const closeObsModalFn = () => {
        observationsModal.style.display = 'none';
    };
    closeObservationsModal.addEventListener('click', closeObsModalFn);
    cancelObservationButton.addEventListener('click', closeObsModalFn);

    // Botão "Salvar Observação" (no novo modal)
    saveObservationButton.addEventListener('click', () => {
        const projectId = document.getElementById('observationProjectId').value;
        const newText = document.getElementById('observationsTextarea').value;

        if (!projectId) {
            showAlert("Erro", "ID do projeto perdido. Não foi possível salvar.");
            return;
        }

        // Salva o texto na nossa variável global
        projectObservations[projectId] = newText;

        showAlert("Observação Salva", "Sua observação foi salva. Lembre-se de salvar o projeto principal para mantê-la no banco de dados.");
        observationsModal.style.display = 'none';
    });
}

// Localize e substitua toda esta função (por volta da linha 1060)
function addSplitterToCanvas(status) {
    if (!pendingSplitterInfo) return;

    const { label, outputCount, type, connector } = pendingSplitterInfo;

    // A adição à lista de materiais só acontece se o status for "Novo" e um projeto estiver ativo.
    if (status === "Novo" && activeFolderId) {
        const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
        if (projectRootElement) {
            const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;

            // Garante que a lista de materiais do projeto exista antes de adicionar itens
            if (!projectBoms[projectId]) {
                calculateBomState();
                projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
            }

            // 1. Adiciona o próprio splitter à lista
            const splitterMaterialName = `Splitter ${label.replace(':', '/')}`;
            const splitterPriceInfo = MATERIAL_PRICES[splitterMaterialName] || { price: 0, category: 'Fusão' };
            if (!projectBoms[projectId][splitterMaterialName]) {
                projectBoms[projectId][splitterMaterialName] = { quantity: 0, type: 'un', unitPrice: splitterPriceInfo.price, category: 'Fusão', removed: false };
            }
            projectBoms[projectId][splitterMaterialName].quantity += 1;

            let adapterMaterialName = '';
            // 2. Se for de Atendimento, adiciona também os adaptadores
            if (type === "Atendimento" && activeMarkerForFusion) {
                const isPredial = activeMarkerForFusion.isPredial || false;
                
                if (isPredial) { // Caixa Predial -> Adaptador SEM abas
                    adapterMaterialName = (connector === 'APC')
                        ? "ADAPTADOR SC/APC SEM ABAS (PASSANTE)"
                        : "ADAPTADOR SC/UPC SEM ABAS (PASSANTE)";
                } else { // Caixa Comum -> Adaptador COM abas
                    adapterMaterialName = (connector === 'APC')
                        ? "ADAPTADOR SC/APC COM ABAS (PASSANTE)"
                        : "ADAPTADOR SC/UPC COM ABAS (PASSANTE)";
                }
                
                const adapterPriceInfo = MATERIAL_PRICES[adapterMaterialName] || { price: 0, category: 'Fusão' };
                if (!projectBoms[projectId][adapterMaterialName]) {
                    projectBoms[projectId][adapterMaterialName] = { quantity: 0, type: 'un', unitPrice: adapterPriceInfo.price, category: 'Fusão', removed: false };
                }
                projectBoms[projectId][adapterMaterialName].quantity += outputCount;
            }

            // 3. Mostra um alerta final e claro para o usuário
            if (adapterMaterialName) {
                showAlert("Materiais Adicionados", `"${splitterMaterialName}" e ${outputCount}x "${adapterMaterialName}" foram adicionados à lista.`);
            } else {
                showAlert("Material Adicionado", `"${splitterMaterialName}" foi adicionado à Lista de Materiais.`);
            }
        }
    }

    // O resto da função para desenhar o splitter no canvas permanece o mesmo...
    const canvas = document.getElementById("fusionCanvas");
    const placeholder = canvas.querySelector(".canvas-placeholder");
    if (placeholder) {
        placeholder.remove();
    }
    const splitterElement = createInteractiveSplitter(label, outputCount, status);
    splitterElement.classList.add(
        type === "Fusão" ? "splitter-fusao" : "splitter-atendimento"
    );
    if (type === "Atendimento" && connector === "UPC") {
        splitterElement.classList.add("splitter-upc");
    }
    repackAllElements();
    pendingSplitterInfo = null;
}

/**
 * Verifica se dois elementos DOM estão se sobrepondo.
 * @param {HTMLElement} el1 O primeiro elemento.
 * @param {HTMLElement} el2 O segundo elemento.
 * @returns {boolean} Verdadeiro se houver colisão, falso caso contrário.
 */
function checkCollision(el1, el2) {
    const rect1 = el1.getBoundingClientRect();
    const rect2 = el2.getBoundingClientRect();

    return !(
        rect1.right < rect2.left ||
        rect1.left > rect2.right ||
        rect1.bottom < rect2.top ||
        rect1.top > rect2.bottom
    );
}

// Localize e substitua TODA a sua função repackAllElements por esta versão
function repackAllElements() {
    const canvas = document.getElementById('fusionCanvas');
    if (!canvas) return;
    const verticalMargin = 20;

    const elementsByColumn = new Map();

    const allElements = canvas.querySelectorAll('.splitter-element, .cable-element');
    allElements.forEach(el => {
        const columnKey = el.offsetLeft;
        if (!elementsByColumn.has(columnKey)) {
            elementsByColumn.set(columnKey, []);
        }
        elementsByColumn.get(columnKey).push(el);
    });

    elementsByColumn.forEach(columnElements => {
        // CORREÇÃO: A linha abaixo, que causava o bug, foi REMOVIDA.
        // columnElements.sort((a, b) => a.offsetTop - b.offsetTop);

        let currentTop = verticalMargin;
        // Agora, o loop processa os elementos na ordem em que eles estão no HTML.
        columnElements.forEach(el => {
            el.style.transition = 'top 0.2s ease-in-out';
            el.style.top = `${currentTop}px`;
            currentTop += el.offsetHeight + verticalMargin;
        });
    });

    setTimeout(() => {
        updateAllConnections();
        updateSvgLayerSize();
        allElements.forEach(el => el.style.transition = '');
    }, 200);
}

// Localize e substitua toda esta função (por volta da linha 1720)
function handleDeleteSplitter(deleteButton) {
    const splitterElement = deleteButton.closest('.splitter-element');
    if (!splitterElement) return;

    const status = splitterElement.dataset.status;
    const type = splitterElement.classList.contains('splitter-fusao') ? 'Fusão' : 'Atendimento';

    // A remoção de materiais só acontece se o status for "Novo"
    if (status === 'Novo' && activeFolderId) {
        const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
        if (projectRootElement) {
            const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
            const labelElement = splitterElement.querySelector('.splitter-body span');
            
            if (labelElement && projectBoms[projectId]) {
                const label = labelElement.textContent.trim();
                
                // 1. Remove o próprio splitter
                const splitterMaterialName = `Splitter ${label.replace(':', '/')}`;
                if (projectBoms[projectId][splitterMaterialName] && projectBoms[projectId][splitterMaterialName].quantity > 0) {
                    projectBoms[projectId][splitterMaterialName].quantity -= 1;
                }

                let adapterMaterialName = '';
                // 2. Se for de Atendimento, remove também os adaptadores
                if (type === 'Atendimento' && activeMarkerForFusion) {
                    const isPredial = activeMarkerForFusion.isPredial || false;
                    const connector = label.includes('APC') ? 'APC' : 'UPC';
                    const ratioMatch = label.match(/1:(\d+)/);
                    const outputCount = ratioMatch ? parseInt(ratioMatch[1], 10) : 0;
                    
                    if (isPredial) {
                        adapterMaterialName = (connector === 'APC') ? "ADAPTADOR SC/APC SEM ABAS (PASSANTE)" : "ADAPTADOR SC/UPC SEM ABAS (PASSANTE)";
                    } else {
                        adapterMaterialName = (connector === 'APC') ? "ADAPTADOR SC/APC COM ABAS (PASSANTE)" : "ADAPTADOR SC/UPC COM ABAS (PASSANTE)";
                    }

                    if (outputCount > 0 && projectBoms[projectId][adapterMaterialName] && projectBoms[projectId][adapterMaterialName].quantity > 0) {
                        projectBoms[projectId][adapterMaterialName].quantity -= outputCount;
                    }
                }

                // 3. Mostra um alerta final
                if (adapterMaterialName) {
                    showAlert("Materiais Removidos", `"${splitterMaterialName}" e seus adaptadores correspondentes foram removidos.`);
                } else {
                    showAlert("Material Removido", `"${splitterMaterialName}" foi removido da lista.`);
                }
            }
        }
    }

    // Remove o elemento do canvas e reorganiza
    splitterElement.remove();
    repackAllElements();
}

// EM script.js:
// Localize e substitua TODA a sua função handleDeleteCableFromFusion por esta versão

/**
 * Lida com a exclusão de um elemento de cabo do plano de fusão,
 * incluindo a remoção das linhas de fusão conectadas a ele. (VERSÃO CORRIGIDA)
 * @param {HTMLButtonElement} deleteButton - O botão de exclusão que foi clicado.
 */
function handleDeleteCableFromFusion(deleteButton) {
    const cableElement = deleteButton.closest('.cable-element');
    if (!cableElement) return;

    // =======================================================================
    // == INÍCIO DA NOVA LÓGICA PARA REMOVER FUSÕES VINCULADAS
    // =======================================================================

    // 1. Coleta os IDs de todas as fibras pertencentes a este cabo
    const fiberIdsToRemove = Array.from(cableElement.querySelectorAll('.fiber-row.connectable')).map(fiber => fiber.id);

    // 2. Encontra a camada SVG onde as linhas estão
    const svgLayer = document.getElementById('fusion-svg-layer');
    if (svgLayer && fiberIdsToRemove.length > 0) {
        // 3. Pega todas as linhas de fusão existentes
        const allFusionLines = svgLayer.querySelectorAll('.fusion-line');

        // 4. Itera sobre cada linha para verificar se ela está conectada ao cabo
        allFusionLines.forEach(line => {
            const startId = line.dataset.startId;
            const endId = line.dataset.endId;

            // 5. Se a linha começa ou termina em uma das fibras do cabo a ser removido...
            if (fiberIdsToRemove.includes(startId) || fiberIdsToRemove.includes(endId)) {
                const lineId = line.id;
                // ...remove a linha...
                line.remove();
                // ...e remove também seus pontos de controle (handles), se existirem.
                if (lineId) {
                    svgLayer.querySelectorAll(`.line-handle[data-line-id="${lineId}"]`).forEach(handle => handle.remove());
                }
                 // (Opcional, mas recomendado) Remove o tubete associado da lista de materiais
                 removeMaterialFromBom("TUBETE PROTETOR DE EMENDA OPTICA", 1);
            }
        });
    }
    // =======================================================================
    // == FIM DA NOVA LÓGICA
    // =======================================================================

    // Remove o elemento visual do cabo do canvas
    cableElement.remove();
    // Reorganiza o layout para preencher o espaço vazio
    repackAllElements();
    
    showAlert("Cabo Removido", "O cabo e suas fusões associadas foram removidos do plano.");
}

// EM script.js:
// Localize e substitua TODA a sua função checkCableUsageInFusionPlans por esta versão com console.log

// EM script.js:
// Tente esta versão que itera pelos elementos em vez de usar querySelector direto

function checkCableUsageInFusionPlans(cableInfo) {
    const usage = { isInPlan: false, hasFusions: false, locations: [] };
    if (!cableInfo) {
        console.log("checkCableUsageInFusionPlans: cableInfo é nulo.");
        return usage;
    }

    // Usar o nome atual, removendo espaços extras
    const cableNameToFind = cableInfo.name.trim();
    console.log(`checkCableUsageInFusionPlans: Verificando uso do cabo "${cableNameToFind}"`);
    const projectMarkers = markers.filter(m => m.type === 'CEO' || m.type === 'CTO');

    for (const markerInfo of projectMarkers) {
        if (markerInfo.fusionPlan) {
            console.log(` -> Verificando plano da caixa "${markerInfo.name}"`);
            try {
                const planData = JSON.parse(markerInfo.fusionPlan);
                if (!planData.elements || !planData.svg) {
                    console.log(`    Plano da caixa "${markerInfo.name}" inválido. Pulando.`);
                    continue;
                }

                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = planData.elements;

                let cableElementInPlan = null;
                // *** INÍCIO DA MUDANÇA: Iterar em vez de querySelector ***
                const savedCableElements = tempDiv.querySelectorAll('.cable-element');
                console.log(`    Procurando por "${cableNameToFind}" entre ${savedCableElements.length} cabos salvos no plano.`);

                for (const savedEl of savedCableElements) {
                    const savedName = savedEl.dataset.cableName;
                    // Compara os nomes após remover espaços extras de ambos
                    if (savedName && savedName.trim() === cableNameToFind) {
                        cableElementInPlan = savedEl;
                        console.log(`    !!!! CABO "${cableNameToFind}" ENCONTRADO (comparando nomes) no plano da caixa "${markerInfo.name}" !!!!`);
                        break; // Para a busca assim que encontrar
                    } else {
                         console.log(`       -> Comparando com: "${savedName ? savedName.trim() : 'NOME INDEFINIDO'}" - Não corresponde.`);
                    }
                }
                // *** FIM DA MUDANÇA ***

                if (cableElementInPlan) {
                    usage.isInPlan = true;
                    if (!usage.locations.includes(markerInfo.name)) {
                        usage.locations.push(markerInfo.name);
                    }

                    // (Verificação de fusão permanece a mesma)
                    const svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svgContainer.innerHTML = planData.svg;
                    if (svgContainer) {
                        const fiberIds = Array.from(cableElementInPlan.querySelectorAll('.fiber-row')).map(f => f.id);
                        const fusionLines = svgContainer.querySelectorAll('.fusion-line');
                        for (const line of fusionLines) {
                            if (fiberIds.includes(line.dataset.startId) || fiberIds.includes(line.dataset.endId)) {
                                console.log(`    !!!! Fusão ENCONTRADA para o cabo "${cableNameToFind}" na caixa "${markerInfo.name}" !!!!`);
                                usage.hasFusions = true;
                                return usage;
                            }
                        }
                         console.log(`    Nenhuma fusão encontrada para "${cableNameToFind}" nesta caixa.`);
                    }
                } else {
                     console.log(`    Cabo "${cableNameToFind}" NÃO encontrado (após iteração) no plano da caixa "${markerInfo.name}".`);
                }
            } catch (e) {
                console.error(`Erro ao verificar o plano de fusão da caixa "${markerInfo.name}":`, e);
            }
        }
    }
    console.log(`checkCableUsageInFusionPlans: Finalizando verificação para "${cableNameToFind}". Resultado:`, usage);
    return usage;
}

/**
 * Remove o elemento visual de um cabo de todos os planos de fusão salvos onde ele aparece.
 * @param {string} cableName - O nome do cabo a ser removido.
 * @param {string[]} markerNames - Uma lista com os nomes das caixas (CEOs/CTOs) onde o cabo está.
 */
function removeCableFromSavedFusionPlans(cableName, markerNames) {
    markers.forEach(markerInfo => {
        if (markerNames.includes(markerInfo.name) && markerInfo.fusionPlan) {
            try {
                const planData = JSON.parse(markerInfo.fusionPlan);
                if (!planData.canvas) return;

                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = planData.canvas;
                
                const cableElementToRemove = tempDiv.querySelector(`.cable-element[data-cable-name="${cableName}"]`);
                if (cableElementToRemove) {
                    cableElementToRemove.remove();
                    // Atualiza o plano de fusão do marcador com o HTML modificado
                    markerInfo.fusionPlan = JSON.stringify({ canvas: tempDiv.innerHTML });
                    console.log(`Cabo "${cableName}" removido do plano de fusão da caixa "${markerInfo.name}".`);
                }
            } catch(e) {
                console.error(`Erro ao remover o cabo do plano de fusão da caixa "${markerInfo.name}":`, e);
            }
        }
    });
}

function removeMaterialFromBom(materialName, quantity) {
    if (!activeFolderId) return;
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) return;

    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    if (projectBoms[projectId] && projectBoms[projectId][materialName]) {
        projectBoms[projectId][materialName].quantity -= quantity;
        if (projectBoms[projectId][materialName].quantity < 0) {
            projectBoms[projectId][materialName].quantity = 0;
        }
    }
}

function deleteProject(projectId, projectElement, projectName) {
    const message = `Tem certeza que deseja excluir o projeto "${projectName}" e TODOS os seus conteúdos? Esta ação não pode ser desfeita.`;
    showConfirm('Excluir Projeto', message, () => {
        const folderIdsToDelete = getAllDescendantFolderIds(projectId);

        // Remover marcadores do mapa e do array
        const markersToRemove = markers.filter(m => folderIdsToDelete.includes(m.folderId));
        markersToRemove.forEach(m => m.marker.setMap(null));
        markers = markers.filter(m => !folderIdsToDelete.includes(m.folderId));

        // Remover cabos do mapa e do array
        const cablesToRemove = savedCables.filter(c => folderIdsToDelete.includes(c.folderId));
        cablesToRemove.forEach(c => c.polyline.setMap(null));
        savedCables = savedCables.filter(c => !folderIdsToDelete.includes(c.folderId));

        // ===================================================================
        // == CORREÇÃO ADICIONADA AQUI                                    ==
        // ===================================================================
        // Remover polígonos do mapa e do array
        const polygonsToRemove = savedPolygons.filter(p => folderIdsToDelete.includes(p.folderId));
        polygonsToRemove.forEach(p => p.polygonObject.setMap(null));
        savedPolygons = savedPolygons.filter(p => !folderIdsToDelete.includes(p.folderId));
        // ===================================================================
        // == FIM DA CORREÇÃO                                             ==
        // ===================================================================

        // Remover o elemento do projeto da barra lateral
        projectElement.remove();

        // Resetar a pasta ativa se ela foi excluída
        if (folderIdsToDelete.includes(activeFolderId)) {
            activeFolderId = null;
        }

        delete projectObservations[projectId];

        showAlert("Sucesso", `Projeto "${projectName}" excluído com sucesso.`);
    });
}

function deleteFolder(folderId, folderElement, folderName) {
    const message = `Tem certeza que deseja excluir a pasta "${folderName}" e todos os seus conteúdos? Esta ação não pode ser desfeita.`;
    showConfirm('Excluir Pasta', message, () => {
        const folderIdsToDelete = getAllDescendantFolderIds(folderId);

        // Remover marcadores do mapa e do array
        const markersToRemove = markers.filter(m => folderIdsToDelete.includes(m.folderId));
        markersToRemove.forEach(m => m.marker.setMap(null));
        markers = markers.filter(m => !folderIdsToDelete.includes(m.folderId));

        // Remover cabos do mapa e do array
        const cablesToRemove = savedCables.filter(c => folderIdsToDelete.includes(c.folderId));
        cablesToRemove.forEach(c => c.polyline.setMap(null));
        savedCables = savedCables.filter(c => !folderIdsToDelete.includes(c.folderId));

        // ===================================================================
        // == CORREÇÃO ADICIONADA AQUI                                    ==
        // ===================================================================
        // Remover polígonos do mapa e do array
        const polygonsToRemove = savedPolygons.filter(p => folderIdsToDelete.includes(p.folderId));
        polygonsToRemove.forEach(p => p.polygonObject.setMap(null));
        savedPolygons = savedPolygons.filter(p => !folderIdsToDelete.includes(p.folderId));
        // ===================================================================
        // == FIM DA CORREÇÃO                                             ==
        // ===================================================================

        // Remover o elemento da pasta da barra lateral
        folderElement.remove();

        // Resetar a pasta ativa se ela foi excluída
        if (folderIdsToDelete.includes(activeFolderId)) {
            activeFolderId = null;
        }

        showAlert("Sucesso", `Pasta "${folderName}" excluída com sucesso.`);
    });
}


// Localize e substitua TODA a sua função makeDraggable por esta versão
function makeDraggable(element) {
    
}

function openCableSelectionModal() {
  if (!activeMarkerForFusion) {
    showAlert("Erro", "Nenhum marcador ativo para o plano de fusão.");
    return;
  }

  const markerPosition = activeMarkerForFusion.marker.getPosition();
  const listContainer = document.getElementById("connected-cables-list");
  listContainer.innerHTML = "";
  let cablesFound = false;
  const canvas = document.getElementById("fusionCanvas");

  // Pega os nomes dos cabos que já estão no canvas para não listá-los novamente
  const existingCableNames = Array.from(canvas.querySelectorAll(".cable-element"))
                                    .map(el => el.dataset.cableName)
                                    .filter(name => name); // Garante que não haja valores nulos ou undefined

  savedCables.forEach((cable) => {
    // Pula o cabo se ele já estiver no canvas ou se não tiver um nome
    if (!cable.name || existingCableNames.includes(cable.name)) {
      return;
    }

    if (!cable.path || cable.path.length < 1) return;

    const startPoint = cable.path[0];
    const endPoint = cable.path[cable.path.length - 1];

    const isConnected = (google.maps.geometry.spherical.computeDistanceBetween(markerPosition, startPoint) < 0.1) ||
                        (google.maps.geometry.spherical.computeDistanceBetween(markerPosition, endPoint) < 0.1);

    if (isConnected) {
      cablesFound = true;
      const fiberType = getFiberType(cable.type);
      const fiberCount = fiberType ? parseInt(fiberType.split("-")[1], 10) : 0;
      const cableOptionDiv = document.createElement("div");
      cableOptionDiv.className = "cable-option";
      cableOptionDiv.innerHTML = `
        <span class="cable-name">${cable.name}</span>
        <span class="cable-fibers">${fiberCount} Fibras</span>
      `;

      cableOptionDiv.addEventListener("click", () => {
        const placeholder = canvas.querySelector(".canvas-placeholder");
        if (placeholder) placeholder.remove();

        const role = (google.maps.geometry.spherical.computeDistanceBetween(markerPosition, startPoint) < 0.1) ? 'saida' : 'entrada';

        const cableElement = createInteractiveCable(cable, role);
        canvas.appendChild(cableElement);
        document.getElementById("cableSelectionModal").style.display = "none";
        
        repackAllElements();
      });

      listContainer.appendChild(cableOptionDiv);
    }
  });

  if (!cablesFound) {
    listContainer.innerHTML =
      '<p class="no-cables-message">Nenhum cabo disponível para adicionar.</p>';
  }

  document.getElementById("cableSelectionModal").style.display = "flex";
}

// Localize e substitua TODA a sua função createInteractiveCable por esta versão
function createInteractiveCable(cableObject, role) {
    const fiberType = getFiberType(cableObject.type);
    const fiberCount = fiberType ? parseInt(fiberType.split("-")[1], 10) : 0;
    const numGroups = Math.ceil(fiberCount / 12);

    const cableContainer = document.createElement("div");
    cableContainer.className = "cable-element";
    cableContainer.dataset.cableName = cableObject.name;

    const sideClass = role === 'entrada' ? 'cable-entrada' : 'cable-saida';
    const label = role === 'entrada' ? '(Ponta B - Entrada)' : '(Ponta A - Saída)';

    cableContainer.classList.add(sideClass);
    if (role === 'entrada') {
        cableContainer.style.left = '20px';
    } else {
        cableContainer.style.right = '20px';
    }

    const header = document.createElement("div");
    header.className = "cable-header";

    const headerContent = document.createElement('div');
    headerContent.style.cssText = 'display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; width: 100%;';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = `${cableObject.name} ${label}`;
    // --- ESTILOS MODIFICADOS ---
    // Permite que o texto quebre a linha se for muito longo
    titleSpan.style.whiteSpace = 'normal';
    // Quebra palavras longas para evitar transbordamento
    titleSpan.style.wordBreak = 'break-word';
    // Adiciona um pequeno espaço à direita para não colar nos botões
    titleSpan.style.paddingRight = '5px'; 
    // --- FIM DA MODIFICAÇÃO ---

    if (role === 'saida' && activeMarkerForFusion && activeMarkerForFusion.type === 'CEO') {
        const kitContainer = document.createElement('div');
        kitContainer.className = 'derivation-kit-container';
        const checkboxId = `kit-${cableObject.name.replace(/\s+/g, '-')}-${Date.now()}`;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = checkboxId;
        checkbox.className = 'derivation-kit-checkbox';
        checkbox.onclick = () => handleDerivationKitToggle(checkbox);
        const kitLabel = document.createElement('label');
        kitLabel.htmlFor = checkboxId;
        kitLabel.textContent = 'Kit Derivação';
        kitContainer.appendChild(checkbox);
        kitContainer.appendChild(kitLabel);
        headerContent.appendChild(kitContainer);
    }

    const buttonContainer = document.createElement('div');
    buttonContainer.style.flexShrink = '0'; 
    const upButton = document.createElement('button');
    upButton.innerHTML = '&#9650;';
    upButton.title = 'Mover para cima';
    upButton.style.cssText = 'padding: 1px 5px; margin-left: 8px; cursor: pointer; font-size: 10px;';
    const downButton = document.createElement('button');
    downButton.innerHTML = '&#9660;';
    downButton.title = 'Mover para baixo';
    downButton.style.cssText = 'padding: 1px 5px; margin-left: 4px; cursor: pointer; font-size: 10px;';

    buttonContainer.appendChild(upButton);
    buttonContainer.appendChild(downButton);
    headerContent.appendChild(titleSpan);
    headerContent.appendChild(buttonContainer);
    header.appendChild(headerContent);
    cableContainer.appendChild(header);

    const fibersContainer = document.createElement("div");
    fibersContainer.className = "cable-fibers-container";
    for (let groupIndex = 0; groupIndex < numGroups; groupIndex++) {
        const groupNum = groupIndex + 1;
        const groupColor = ABNT_GROUP_COLORS.colors[groupIndex] || ABNT_GROUP_COLORS.colors[2];
        const groupName = ABNT_GROUP_COLORS.names[groupIndex] || ABNT_GROUP_COLORS.names[2];

        const groupHeader = document.createElement('div');
        groupHeader.className = 'group-header';
        groupHeader.textContent = `Grupo ${groupNum} - ${groupName}`;
        groupHeader.style.backgroundColor = groupColor;
        if (groupColor === '#ffffff') {
            groupHeader.style.color = '#333';
            groupHeader.style.border = '1px solid #ddd';
        }
        fibersContainer.appendChild(groupHeader);

        // --- INÍCIO DA ALTERAÇÃO ---
        for (let fiberIndex = 0; fiberIndex < 12; fiberIndex++) {
            const absoluteFiberNumber = groupIndex * 12 + fiberIndex + 1;
            if (absoluteFiberNumber > fiberCount) break;

            const fiberRow = document.createElement("div");
            fiberRow.className = "fiber-row connectable"; // A classe principal agora controla tudo
            fiberRow.id = `cable-${cableObject.name.replace(/\s+/g, '-')}-fiber-${absoluteFiberNumber}`;
            
            // Define o texto diretamente no elemento
            fiberRow.textContent = `Fibra ${absoluteFiberNumber}`;
            
            // Define a cor de fundo diretamente no elemento
            const color = ABNT_FIBER_COLORS[fiberIndex];
            fiberRow.style.backgroundColor = color;

            // Lógica para garantir a legibilidade do texto em fundos claros
            if (color === '#ffffff' || color === '#ffc107') { // Branco ou Amarelo
                fiberRow.style.color = '#333'; // Texto escuro
                fiberRow.style.textShadow = 'none'; // Remove sombra
            }

            fibersContainer.appendChild(fiberRow);
        }
        // --- FIM DA ALTERAÇÃO ---
    }

    cableContainer.appendChild(fibersContainer);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-component-btn';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.onclick = () => handleDeleteCableFromFusion(deleteBtn);
    cableContainer.appendChild(deleteBtn);

    upButton.addEventListener('click', () => moveCable(cableContainer, 'up'));
    downButton.addEventListener('click', () => moveCable(cableContainer, 'down'));
    makeDraggable(cableContainer);
    return cableContainer;
}

// Localize e substitua TODA a sua função moveCable por esta versão
/**
 * Move um elemento de cabo para cima ou para baixo, trocando de lugar
 * com qualquer componente vizinho na mesma coluna (cabo ou splitter).
 * @param {HTMLElement} cableElement O elemento de cabo a ser movido.
 * @param {'up' | 'down'} direction A direção para mover o cabo.
 */
// Localize e substitua a função moveCable
function moveCable(cableElement, direction) {
    const parent = cableElement.parentNode;
    if (!parent) return;

    // CORREÇÃO: Verifica se o cabo está na coluna da direita olhando seu estilo.
    const isRightColumn = cableElement.style.right && cableElement.style.right !== 'auto';

    if (direction === 'up') {
        const previousSibling = cableElement.previousElementSibling;
        if (previousSibling) {
            // Verifica se o vizinho está na mesma coluna.
            const siblingIsRightColumn = previousSibling.style.right && previousSibling.style.right !== 'auto';
            if (isRightColumn === siblingIsRightColumn) { // Só troca se ambos estiverem na mesma coluna.
                parent.insertBefore(cableElement, previousSibling);
            }
        }
    } else if (direction === 'down') {
        const nextSibling = cableElement.nextElementSibling;
        if (nextSibling) {
            // Verifica se o vizinho está na mesma coluna.
            const siblingIsRightColumn = nextSibling.style.right && nextSibling.style.right !== 'auto';
            if (isRightColumn === siblingIsRightColumn) { // Só troca se ambos estiverem na mesma coluna.
                parent.insertBefore(nextSibling, cableElement);
            }
        }
    }
    repackAllElements();
}

// Localize e substitua TODA a sua função moveSplitterVertical por esta versão
/**
 * Move um splitter para cima ou para baixo, trocando de lugar
 * com qualquer componente vizinho na mesma coluna (cabo ou outro splitter).
 * @param {HTMLElement} splitterElement O elemento splitter a ser movido.
 * @param {'up' | 'down'} direction A direção do movimento.
 */
// Localize e substitua a função moveSplitterVertical
function moveSplitterVertical(splitterElement, direction) {
    const parent = splitterElement.parentNode;
    if (!parent) return;

    // CORREÇÃO: Verifica se o splitter está na coluna da direita olhando seu estilo.
    const isRightColumn = splitterElement.style.right && splitterElement.style.right !== 'auto';

    if (direction === 'up') {
        const previousSibling = splitterElement.previousElementSibling;
        if (previousSibling) {
            const siblingIsRightColumn = previousSibling.style.right && previousSibling.style.right !== 'auto';
            if (isRightColumn === siblingIsRightColumn) {
                parent.insertBefore(splitterElement, previousSibling);
            }
        }
    } else if (direction === 'down') {
        const nextSibling = splitterElement.nextElementSibling;
        if (nextSibling) {
            const siblingIsRightColumn = nextSibling.style.right && nextSibling.style.right !== 'auto';
            if (isRightColumn === siblingIsRightColumn) {
                parent.insertBefore(nextSibling, splitterElement);
            }
        }
    }
    repackAllElements();
}


// Localize e substitua TODA a sua função setSplitterSide por esta versão
/**
 * Posiciona um splitter em uma borda, ajustando sua posição vertical
 * para o primeiro espaço livre disponível e reorganizando o canvas.
 * @param {HTMLElement} splitterElement O elemento splitter a ser movido.
 * @param {'left' | 'right'} side O lado para o qual mover o splitter.
 */
function setSplitterSide(splitterElement, side) {
    const canvas = document.getElementById('fusionCanvas');
    if (!canvas) return;
    
    // --- Posiciona o splitter horizontalmente na borda desejada ---
    const lanePosition = '20px';
    splitterElement.style.right = 'auto';
    splitterElement.style.left = 'auto';
    splitterElement.style.transform = '';

    if (side === 'left') {
        splitterElement.style.left = lanePosition;
    } else if (side === 'right') {
        splitterElement.style.right = lanePosition;
    }

    // --- Busca a melhor posição vertical no novo local ---
    const verticalMargin = 20;
    let topPosition = 20;

    while (true) {
        let collisionDetected = false;
        splitterElement.style.top = `${topPosition}px`;

        const existingElements = Array.from(canvas.querySelectorAll('.splitter-element, .cable-element')).filter(el => el !== splitterElement);

        for (const existingEl of existingElements) {
            if (checkCollision(splitterElement, existingEl)) {
                topPosition = existingEl.offsetTop + existingEl.offsetHeight + verticalMargin;
                collisionDetected = true;
                break;
            }
        }

        if (!collisionDetected) {
            break;
        }
    }
    
    // ==========================================================
    // == CORREÇÃO CRÍTICA ADICIONADA AQUI                     ==
    // ==========================================================
    // Chama a função que reorganiza TODOS os componentes.
    // Isso irá fechar o buraco deixado na coluna original.
    repackAllElements();
}

// Localize e substitua TODA a sua função createInteractiveSplitter por esta versão
function createInteractiveSplitter(label, outputCount, status) {
    const splitterContainer = document.createElement("div");
    splitterContainer.className = "splitter-element";

    // CORREÇÃO: Gera uma ID única para este splitter específico.
    const uniqueSplitterId = `splitter-${label.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now()}`;
    splitterContainer.id = uniqueSplitterId; // Atribui a ID ao container principal

    if (status) {
        splitterContainer.dataset.status = status;
    }

    const inputSide = document.createElement("div");
    inputSide.className = "splitter-input";
    const inputPort = document.createElement("div");
    inputPort.className = "splitter-port-row connectable";
    // CORREÇÃO: Usa a ID única para a porta de entrada.
    inputPort.id = `${uniqueSplitterId}-input-port`;
    inputPort.innerHTML = `<span class="splitter-port-number">Entrada</span>`;
    inputSide.appendChild(inputPort);

    const body = document.createElement("div");
    body.className = "splitter-body";
    body.style.cssText = "display: flex; flex-direction: column; align-items: center; gap: 5px;";

    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;

    const buttonContainer = document.createElement('div');
    const upButton = document.createElement('button');
    upButton.innerHTML = '&#9650;';
    upButton.title = 'Mover para cima';
    upButton.style.cssText = 'padding: 1px 5px; cursor: pointer; font-size: 10px;';

    const downButton = document.createElement('button');
    downButton.innerHTML = '&#9660;';
    downButton.title = 'Mover para baixo';
    downButton.style.cssText = 'padding: 1px 5px; margin-left: 4px; cursor: pointer; font-size: 10px;';
    
    const leftButton = document.createElement('button');
    leftButton.innerHTML = '&#9664;';
    leftButton.title = 'Mover para a esquerda';
    leftButton.style.cssText = 'padding: 1px 5px; margin-left: 4px; cursor: pointer; font-size: 10px;';

    const rightButton = document.createElement('button');
    rightButton.innerHTML = '&#9654;';
    rightButton.title = 'Mover para a direita';
    rightButton.style.cssText = 'padding: 1px 5px; margin-left: 4px; cursor: pointer; font-size: 10px;';
    
    buttonContainer.appendChild(upButton);
    buttonContainer.appendChild(downButton);
    buttonContainer.appendChild(leftButton);
    buttonContainer.appendChild(rightButton);

    body.appendChild(labelSpan);
    body.appendChild(buttonContainer);
    
    const outputSide = document.createElement("div");
    outputSide.className = "splitter-outputs";
    for (let i = 1; i <= outputCount; i++) {
        const outputPort = document.createElement("div");
        outputPort.className = "splitter-port-row connectable";
        // CORREÇÃO: Usa a ID única para cada porta de saída.
        outputPort.id = `${uniqueSplitterId}-output-${i}`;
        outputPort.innerHTML = `<span class="splitter-port-number">Porta ${i}</span>`;
        outputSide.appendChild(outputPort);
    }

    splitterContainer.appendChild(inputSide);
    splitterContainer.appendChild(body);
    splitterContainer.appendChild(outputSide);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-component-btn';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.onclick = () => handleDeleteSplitter(deleteBtn);
    splitterContainer.appendChild(deleteBtn);

    upButton.addEventListener('click', (e) => { e.stopPropagation(); moveSplitterVertical(splitterContainer, 'up'); });
    downButton.addEventListener('click', (e) => { e.stopPropagation(); moveSplitterVertical(splitterContainer, 'down'); });
    leftButton.addEventListener('click', (e) => { e.stopPropagation(); setSplitterSide(splitterContainer, 'left'); });
    rightButton.addEventListener('click', (e) => { e.stopPropagation(); setSplitterSide(splitterContainer, 'right'); });
    
    const canvas = document.getElementById('fusionCanvas');
    
    const lanePosition = '20px';
    splitterContainer.style.left = lanePosition;
    splitterContainer.style.transform = 'none';

    splitterContainer.style.visibility = 'hidden'; 
    canvas.appendChild(splitterContainer); 

    const verticalMargin = 20; 
    let topPosition = 20;

    while (true) {
        let collisionDetected = false;
        splitterContainer.style.top = `${topPosition}px`;
        const existingElements = Array.from(canvas.querySelectorAll('.splitter-element, .cable-element')).filter(el => el !== splitterContainer);
        for (const existingEl of existingElements) {
            if (checkCollision(splitterContainer, existingEl)) {
                topPosition = existingEl.offsetTop + existingEl.offsetHeight + verticalMargin;
                collisionDetected = true;
                break; 
            }
        }
        if (!collisionDetected) {
            break; 
        }
    }
    
    splitterContainer.style.visibility = 'visible';
    makeDraggable(splitterContainer);
    return splitterContainer;
}


function setMapCursor(cursor) {
  const mapContainer = document.getElementById("map");
  const layers = mapContainer.querySelectorAll("div, canvas");
  layers.forEach((el) => {
    el.style.cursor = cursor || "";
  });
}

// EM script.js:
// SUBSTITUA a função enableDragAndDropForItem (aprox. linha 1898)

function enableDragAndDropForItem(itemElement) {
  // Verificação de segurança para não adicionar listeners duas vezes
  if (itemElement.classList.contains('draggable')) {
    return;
  }
  itemElement.draggable = true;
  itemElement.classList.add("draggable");

  // --- O DRAGSTART PREPARA O ESTADO ---
  itemElement.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/plain", "");
    e.dataTransfer.effectAllowed = "move";
    window.draggedItem = itemElement;
    window.draggedItemSourceProject = itemElement.closest('.folder');
    
    // ---- ADIÇÃO ----
    // Reseta o "status do drop" no início do arrasto
    window.dropWasSuccessful = false; 
    // ----------------

    document.body.classList.add("is-dragging-globally");
    itemElement.style.opacity = '0.5'; 
    itemElement.classList.add("is-being-dragged");
  });

  // --- O DRAGEND LIMPA TUDO ---
  // (Substitua seu listener 'dragend' inteiro por este)
  itemElement.addEventListener("dragend", () => {
    
    // --- LÓGICA DE LIMPEZA GLOBAL ---
    
    // 1. Verifica se o drop foi bem-sucedido (flag definida em handleDropOnFolder)
    if (window.dropWasSuccessful) {
        // Aplica o "flash" de sucesso (a cor azul que você viu)
        itemElement.style.transition = "background-color 0.3s";
        itemElement.style.backgroundColor = "#b2ebf2"; // Cor de sucesso
        
        // Agenda a remoção do "flash"
        setTimeout(() => {
            if(itemElement) { // Verifica se o item ainda existe
               itemElement.style.backgroundColor = ""; 
               itemElement.style.transition = "";
            }
        }, 600);
    }

    // 2. Limpa a aparência do item arrastado (sempre executa)
    document.body.classList.remove("is-dragging-globally");
    itemElement.classList.remove("is-being-dragged");
    itemElement.style.opacity = '1'; // Restaura opacidade

    // 3. Limpa TODOS os alvos de drop (remove "cores" e "solte aqui" de TUDO)
    // Isso corrige o bug de "estado preso".
    document.querySelectorAll('.folder-title.dragover-target').forEach(title => {
        title.classList.remove('dragover-target');
    });
    document.querySelectorAll('.subfolders.dragover').forEach(ul => {
        ul.classList.remove('dragover');
    });
    
    // 4. Limpa as variáveis globais
    window.draggedItem = null;
    window.draggedItemSourceProject = null;
    window.dropWasSuccessful = false; // Reseta a flag para o próximo arraste
  });
}

/**
 * (NOVA FUNÇÃO HELPER)
 * Salva a estrutura e os dados de um elemento de projeto específico.
 * É uma versão reutilizável da sua 'saveProjectToFirestore' original.
 * @param {HTMLElement} projectRootElement - O elemento DOM (div.folder) do projeto a ser salvo.
 */
function saveProjectElement(projectRootElement) {
    if (!projectRootElement) {
        console.warn("saveProjectElement foi chamada com um elemento nulo.");
        return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
        console.error("Usuário não logado, não é possível salvar o projeto.");
        return;
    }

    const projectTitleDiv = projectRootElement.querySelector('.folder-title');
    const projectUl = projectRootElement.querySelector('ul.subfolders'); // Garante que é o UL principal
    if (!projectTitleDiv || !projectUl) {
        console.error("Elemento de projeto inválido. Faltando .folder-title or ul.subfolders.", projectRootElement);
        return;
    }

    const projectId = projectTitleDiv.dataset.folderId;
    const projectName = projectTitleDiv.dataset.folderName;

    console.log(`Salvando projeto (via D&D): ${projectName} (ID: ${projectId})`);

    // O resto da lógica é idêntica a saveProjectToFirestore
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
    const projectMarkers = markers.filter(m => allFolderIds.includes(m.folderId)).map(serializeMarker);
    const projectCables = savedCables.filter(c => allFolderIds.includes(c.folderId)).map(serializeCable);
    const projectPolygons = savedPolygons.filter(p => allFolderIds.includes(p.folderId)).map(serializePolygon);
    
    const projectData = {
        userId: currentUser.uid,
        projectName: projectName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(), // Recria o timestamp, como na sua função original
        sidebar: sidebarStructure,
        markers: projectMarkers,
        cables: projectCables,
        polygons: projectPolygons,
        bom: projectBoms[projectId] || null
    };
    
    db.collection("users").doc(currentUser.uid).collection("projects").doc(projectId).set(projectData)
        .then(() => {
            console.log(`Projeto "${projectName}" salvo com sucesso (via D&D).`);
        })
        .catch((error) => {
            console.error(`Erro ao salvar projeto "${projectName}": `, error);
            showAlert("Erro de D&D", `Ocorreu um erro ao salvar o projeto "${projectName}".`);
        });
}

// EM script.js:
// SUBSTITUA a função handleDropOnFolder (aprox. linha 1922)

/**
 * (VERSÃO CORRIGIDA)
 * Lida com o evento 'drop' para um <ul> de pasta.
 * Apenas move o item e define uma flag de sucesso. O visual é tratado pelo 'dragend'.
 * @param {DragEvent} e - O evento de drop.
 * @param {HTMLElement} destinationUl - O elemento <ul> que recebeu o drop.
 */
function handleDropOnFolder(e, destinationUl) {
    const draggedItem = window.draggedItem;
    const sourceProjectElement = window.draggedItemSourceProject;
    
    if (!draggedItem || !destinationUl) {
        window.dropWasSuccessful = false; // Indica que o drop falhou
        return;
    }

    // Impede que uma pasta seja movida para dentro de si mesma
    if (draggedItem.contains(destinationUl)) {
        showAlert("Erro", "Não é possível mover uma pasta para dentro dela mesma.");
        window.dropWasSuccessful = false; // Indica que o drop falhou
        return;
    }

    const destinationProjectElement = destinationUl.closest('.folder');

    // Tenta encontrar se é um item (marcador, cabo, polígono)
    let itemData = markers.find(m => m.listItem === draggedItem) ||
                   savedCables.find(c => c.item === draggedItem) ||
                   savedPolygons.find(p => p.listItem === draggedItem);
    
    // CASO 1: É um item
    if (itemData) {
        itemData.folderId = destinationUl.id;
        destinationUl.appendChild(draggedItem); // Anexa ao final

        saveProjectElement(destinationProjectElement);
        if (sourceProjectElement && sourceProjectElement !== destinationProjectElement) {
            saveProjectElement(sourceProjectElement);
        }

    // CASO 2: É uma pasta
    } else if (draggedItem.classList.contains('folder') || draggedItem.classList.contains('folder-wrapper')) {
        destinationUl.appendChild(draggedItem); // Anexa ao final

        saveProjectElement(destinationProjectElement);
        if (sourceProjectElement && sourceProjectElement !== destinationProjectElement) {
            saveProjectElement(sourceProjectElement);
        }
    }

    // ----- CORREÇÃO PRINCIPAL -----
    // 1. Remove toda a lógica de "setTimeout" e "backgroundColor" daqui.
    
    // 2. Apenas informa à função 'dragend' (que executará a seguir) que o drop foi um sucesso.
    window.dropWasSuccessful = true; 
    // ------------------------------
}


// EM script.js:
// ADICIONE esta nova função auxiliar (por exemplo, após a função handleDropOnFolder)

/**
 * Adiciona os listeners de 'dragover', 'dragleave' e 'drop' ao TÍTULO de uma pasta.
 * Isso permite soltar itens em pastas (mesmo quando estão fechadas).
 * @param {HTMLElement} titleDiv O elemento .folder-title
 */
function addDropTargetListenersToFolderTitle(titleDiv) {
    titleDiv.addEventListener('dragover', (e) => {
        e.preventDefault(); // Permite soltar
        e.stopPropagation(); // Impede que o evento suba para pastas-pai
        titleDiv.classList.add('dragover-target'); // Feedback visual no título
        
        const subUl = document.getElementById(titleDiv.dataset.folderId);
        if (subUl) {
            subUl.classList.add('dragover'); // Mostra o placeholder "Solte aqui" dentro
        }
    });

    titleDiv.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        titleDiv.classList.remove('dragover-target'); // Remove feedback visual do título
        
        const subUl = document.getElementById(titleDiv.dataset.folderId);
        // Só remove o feedback do placeholder se o mouse não estiver entrando no próprio placeholder
        if (subUl && !subUl.contains(e.relatedTarget)) {
            subUl.classList.remove('dragover'); // Esconde o placeholder
        }
    });

    titleDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        titleDiv.classList.remove('dragover-target');
        
        const subUl = document.getElementById(titleDiv.dataset.folderId);
        if (subUl) {
            subUl.classList.remove('dragover'); // Limpa
            handleDropOnFolder(e, subUl); // Delega para a função de drop principal
        }
    });
}

// EM script.js:
// SUBSTITUA TODA a sua função enableDropOnFolder por esta versão:

function enableDropOnFolder(ul) {
  // Verifica se o listener já foi adicionado
  if (!ul || ul.classList.contains("drop-enabled")) return;
  ul.classList.add("drop-enabled");
  
  // 1. Adiciona os listeners de 'dragover' e 'dragleave' ao UL (a pasta)
  ul.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Adiciona a classe que o seu CSS usa para MOSTRAR o placeholder
    ul.classList.add("dragover"); 
  });

  ul.addEventListener("dragleave", (e) => {
    e.stopPropagation();
    // Remove a classe para ESCONDER o placeholder
    if (!e.currentTarget.contains(e.relatedTarget)) {
        ul.classList.remove("dragover");
    }
  });
  
  // 2. Adiciona o listener 'drop' ao UL (pasta)
  ul.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Limpa o 'dragover' ANTES de processar o drop
      ul.classList.remove("dragover");
      handleDropOnFolder(e, ul);
  });

  // 3. CRIA O PLACEHOLDER (O INDICADOR)
  const placeholder = document.createElement("li");
  placeholder.className = "drop-placeholder";
  placeholder.textContent = "⬇ Solte aqui";
  placeholder.setAttribute("data-placeholder", "true");
  
  if (!ul.querySelector('.drop-placeholder')) {
    // Insere o placeholder no TOPO da pasta
    ul.prepend(placeholder); 
  }
}


function createProject() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
      showAlert("Erro", "Você precisa estar logado para criar um projeto.");
      return;
  }

  const projectNameInput = document.getElementById("projectName");
  const projectCityInput = document.getElementById("projectCity");
  const projectNeighborhoodInput = document.getElementById("projectNeighborhood");
  const projectTypeInput = document.getElementById("projectType");

  const projectName = projectNameInput.value.trim();
  const projectCity = projectCityInput.value.trim();
  const projectNeighborhood = projectNeighborhoodInput.value.trim();
  const projectType = projectTypeInput.value;

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
    editingFolderElement = null;
    document.getElementById("projectModal").style.display = "none";
    saveProjectToFirestore(); 
    return;
  }

  if (!projectName) {
    showAlert("Erro", "Por favor, digite o nome do projeto.");
    return;
  }

  const newProjectRef = db.collection("users").doc(currentUser.uid).collection("projects").doc();
  const projectId = newProjectRef.id;

  const template = document.getElementById('project-template');
  const clone = template.content.cloneNode(true);
  const titleDiv = clone.querySelector('.folder-title');
  const nameSpan = clone.querySelector('.folder-name-text');
  const subList = clone.querySelector('.subfolders');
  const visibilityBtn = clone.querySelector('.visibility-toggle-btn'); // Pega o botão
  const projectElement = clone.querySelector('.folder');
  enableDragAndDropForItem(projectElement);

  nameSpan.textContent = projectName;
  subList.id = projectId;
  titleDiv.dataset.folderId = projectId;
  titleDiv.dataset.folderName = projectName;
  titleDiv.dataset.folderCity = projectCity;
  titleDiv.dataset.folderNeighborhood = projectNeighborhood;
  titleDiv.dataset.folderType = projectType;
  titleDiv.dataset.isProject = "true";
  
  visibilityBtn.dataset.folderId = projectId;

  const toggleIcon = titleDiv.querySelector('.toggle-icon');
  toggleIcon.onclick = (e) => { e.stopPropagation(); toggleFolder(projectId); };
  titleDiv.onclick = (e) => {
    if (e.target.closest('.folder-buttons') || e.target.closest('.toggle-icon')) return;
    e.stopPropagation();
    setActiveFolder(projectId);
  };
  
  addDropTargetListenersToFolderTitle(titleDiv);

  titleDiv.addEventListener('dragleave', (e) => {
      e.stopPropagation();
      titleDiv.classList.remove('dragover-target'); // Remove feedback visual
      
      const subUl = document.getElementById(titleDiv.dataset.folderId);
      if (subUl && !subUl.contains(e.relatedTarget)) {
          subUl.classList.remove('dragover'); // Esconde o placeholder
      }
  });

  titleDiv.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      titleDiv.classList.remove('dragover-target');
      
      const subUl = document.getElementById(titleDiv.dataset.folderId);
      if (subUl) {
          subUl.classList.remove('dragover'); // Limpa
          handleDropOnFolder(e, subUl); // Delega para sua função de drop existente
      }
  });
  // ===================================================================
  // == FIM DA MODIFICAÇÃO                                          ==
  // ===================================================================

  enableDropOnFolder(subList);

  document.getElementById("sidebar").appendChild(clone);
  
  const minimalProjectData = {
      userId: currentUser.uid,
      projectName: projectName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      sidebar: {
          id: projectId, name: projectName, city: projectCity, neighborhood: projectNeighborhood,
          type: projectType, isProject: true, children: []
      },
      markers: [], cables: [], polygons: []
  };

  newProjectRef.set(minimalProjectData).then(() => {
      console.log("Documento do projeto criado com sucesso no Firestore com o ID:", projectId);
      setActiveFolder(projectId);
      document.getElementById("projectModal").style.display = "none";
  }).catch(error => {
      console.error("Erro ao criar documento inicial do projeto: ", error);
      showAlert("Erro de Banco de Dados", "Não foi possível criar o projeto. Tente novamente.");
      document.getElementById(projectId)?.closest('.folder')?.remove();
  });
}

// Encontre e substitua TODA a sua função createFolder por esta versão:

function createFolder() {
  const folderNameInput = document.getElementById("folderNameInput");
  const folderName = folderNameInput.value.trim();

  if (editingFolderElement) {
    if (!folderName) {
      showAlert("Erro", "O nome da pasta não pode ficar vazio.");
      return;
    }
    editingFolderElement.querySelector('.folder-name-text').textContent = folderName;
    editingFolderElement.dataset.folderName = folderName;
    editingFolderElement = null;
    document.getElementById("folderModal").style.display = "none";
    saveProjectToFirestore();
    return;
  }

  if (!activeFolderId) {
    showAlert("Atenção", "Selecione uma pasta ou projeto para adicionar.");
    return;
  }
  if (!folderName) {
    showAlert("Erro", "Por favor, digite o nome da pasta.");
    return;
  }

  const folderId = `folder-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

  const template = document.getElementById('folder-template');
  const clone = template.content.cloneNode(true);
  const wrapperLi = clone.querySelector('.folder-wrapper');
  const titleDiv = clone.querySelector('.folder-title');
  const nameSpan = clone.querySelector('.folder-name-text');
  const subList = clone.querySelector('.subfolders');
  const visibilityBtn = clone.querySelector('.visibility-toggle-btn'); // Pega o botão
  enableDragAndDropForItem(wrapperLi);

  nameSpan.textContent = folderName;
  subList.id = folderId;
  titleDiv.dataset.folderId = folderId;
  titleDiv.dataset.folderName = folderName;
  titleDiv.dataset.isProject = "false";

  visibilityBtn.dataset.folderId = folderId;

  const toggleIcon = titleDiv.querySelector('.toggle-icon');
  toggleIcon.onclick = (e) => { e.stopPropagation(); toggleFolder(folderId); };
  titleDiv.onclick = (e) => {
    if (e.target.closest('.folder-buttons') || e.target.closest('.toggle-icon')) return;
    e.stopPropagation();
    setActiveFolder(folderId);
  };
  
  addDropTargetListenersToFolderTitle(titleDiv);

  titleDiv.addEventListener('dragleave', (e) => {
      e.stopPropagation();
      titleDiv.classList.remove('dragover-target'); // Remove feedback visual
      
      const subUl = document.getElementById(titleDiv.dataset.folderId);
      if (subUl && !subUl.contains(e.relatedTarget)) {
          subUl.classList.remove('dragover'); // Esconde o placeholder
      }
  });

  titleDiv.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      titleDiv.classList.remove('dragover-target');
      
      const subUl = document.getElementById(titleDiv.dataset.folderId);
      if (subUl) {
          subUl.classList.remove('dragover'); // Limpa
          handleDropOnFolder(e, subUl); // Delega para sua função de drop existente
      }
  });
  // ===================================================================
  // == FIM DA MODIFICAÇÃO                                          ==
  // ===================================================================

  enableDropOnFolder(subList);

  const parentUl = document.getElementById(activeFolderId);
  parentUl.appendChild(wrapperLi);
  
  setActiveFolder(folderId);
  document.getElementById("folderModal").style.display = "none";
}


// EM script.js:
// Substitua a função toggleFolder

function toggleFolder(id) {
  const folderUl = document.getElementById(id); // O UL que será escondido/mostrado
  if (!folderUl) return;

  // Encontra o div.folder-title que precede o UL
  const titleDiv = folderUl.previousElementSibling;
  if (!titleDiv || !titleDiv.classList.contains("folder-title")) return;

  const iconSpan = titleDiv.querySelector(".toggle-icon"); // O span que contém o ícone ►/▼
  const isHidden = folderUl.classList.contains("hidden");

  folderUl.classList.toggle("hidden"); // Alterna a visibilidade do UL

  // Muda o ícone de texto
  if (iconSpan) {
    iconSpan.textContent = isHidden ? '▼' : '►'; // Muda para baixo se estava escondido (abrindo), senão para direita (fechando)
  }
}

function setActiveFolder(id) {
  document
    .querySelectorAll(".folder-title.active")
    .forEach((el) => el.classList.remove("active"));

  const ul = document.getElementById(id);
  if (ul) {
    activeFolderId = id;
    const title = ul.previousElementSibling;
    if (title) {
      title.classList.add("active");
    }
  }
  
  bomState = {}; 
}

function handleMapClick(event) {
  if (!isDrawingCable) return;
  if (cablePath.length === 0) {
    showAlert("Aviso", "Para iniciar um cabo, clique em um marcador do tipo CEO, CTO ou Reserva.");
    return;
  }

  const location = event.latLng;
  cablePath.push(location);

  const marker = new google.maps.Marker({
    position: location,
    map: map,
    draggable: true,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 5,
      fillColor: "#ffffff",
      fillOpacity: 1,
      strokeColor: "#000000",
      strokeWeight: 1,
    },
  });
  cableMarkers.push(marker);

  marker.addListener("drag", () => {
    updatePolylineFromMarkers();
  });
  marker.addListener("dblclick", () => {
    const index = cableMarkers.indexOf(marker);
    if (index !== -1) {
      cableMarkers[index].setMap(null);
      cableMarkers.splice(index, 1);
      updatePolylineFromMarkers();
    }
  });
  updatePolylineFromMarkers();
}


function updatePolylineFromMarkers() {
  cablePath = cableMarkers.map((marker) => marker.getPosition());

  if (cablePolyline) cablePolyline.setMap(null);

  const fiberType = document.getElementById("cableType").value; // MODIFICADO
  const cor = getCableColor(fiberType); // MODIFICADO
  const largura = parseInt(document.getElementById("cableWidth").value);

  cablePolyline = new google.maps.Polyline({
    path: cablePath,
    geodesic: true,
    strokeColor: cor,
    strokeOpacity: 1.0,
    strokeWeight: largura,
    map: map,
  });

  let drawnDistance = 0;
  if (cablePath.length >= 2) {
    drawnDistance = google.maps.geometry.spherical.computeLength(
      cablePolyline.getPath()
    );
  }

  const lancamento = Math.ceil(drawnDistance / 10) * 10;

  let reserva = 0;
  const getReserveForPoint = (point) => {
    if (!point) return 0;
    for (const markerInfo of markers) {
      if (markerInfo.marker.getPosition().equals(point)) {
        switch (markerInfo.type) {
          case "CEO":
          case "RESERVA":
            return 25;
          case "CTO":
            return 5;
          default:
            return 0;
        }
      }
    }
    return 0;
  };
  
  if (cablePath.length >= 1) {
    const startPoint = cablePath[0];
    const endPoint = cablePath[cablePath.length - 1];
    reserva += getReserveForPoint(startPoint);
    if (cablePath.length > 1 && !startPoint.equals(endPoint)) {
       reserva += getReserveForPoint(endPoint);
    }
  }
  
  const totalDistance = lancamento + reserva;

  cableDistance = {
      lancamento: lancamento,
      reserva: reserva,
      total: totalDistance
  };

  document.getElementById(
    "cableDrawnDistance"
  ).textContent = `Lançamento: ${lancamento} m`;
  document.getElementById(
    "cableReserveDistance"
  ).textContent = `Reserva: ${reserva} m`;
  document.getElementById(
    "cableTotalDistance"
  ).textContent = `Total: ${totalDistance} m`;
}

function startDrawingCable() {
    isDrawingCable = true;
    setAllPolygonsClickable(false);
    cablePath = [];
    cableDistance = { lancamento: 0, reserva: 0, total: 0 }; // MODIFICADO
    if (cablePolyline) cablePolyline.setMap(null);
    
    const cableBox = document.getElementById("cableDrawingBox");
    cableBox.classList.remove("hidden");
    
    const statusDisplay = document.getElementById("cableStatusDisplay");
    statusDisplay.textContent = `Status: ${currentCableStatus}`;
    statusDisplay.style.display = 'block';

    document.getElementById("cableDrawnDistance").textContent = "Lançamento: 0 m";
    document.getElementById("cableReserveDistance").textContent = "Reserva: 0 m";
    document.getElementById("cableTotalDistance").textContent = "Total: 0 m";
    document.getElementById("cableName").value = "";
    document.getElementById("cableWidth").value = 3;
    document.getElementById("map").classList.add("cursor-draw");
    setMapCursor("crosshair");
}

document.getElementById("drawCableButton").addEventListener("click", () => {
  if (isAddingMarker || isDrawingCable) {
    showAlert("Atenção", "Finalize a ação atual antes de adicionar outro marcador ou cabo.");
    return;
  }
  if (!activeFolderId) {
    showAlert("Atenção", "Selecione uma pasta para salvar o cabo.");
    return;
  }

  document.getElementById("cableStatusSelectionModal").style.display = "flex";
});


// EM script.js:
// Localize e substitua toda a função de clique do botão "Salvar Cabo"

document.getElementById("saveCableButton").addEventListener("click", () => {
  const name = document.getElementById("cableName").value.trim();
  const asType = document.getElementById("cableASType").value;
  const newFiberTypeSelection = document.getElementById("cableType").value;
  const fullCableType = `Cabo ${asType} ${newFiberTypeSelection}`;
  const cor = getCableColor(newFiberTypeSelection);
  const largura = parseInt(document.getElementById("cableWidth").value);

  // =======================================================================
  // == INÍCIO DA NOVA VERIFICAÇÃO DE FUSÃO ANTES DE SALVAR
  // =======================================================================

  // A verificação só é necessária se estivermos editando um cabo existente
  if (editingCableIndex !== null) {
    const originalCable = savedCables[editingCableIndex];
    const originalFiberType = getFiberType(originalCable.type);
    const newFiberType = getFiberType(fullCableType);

    // Compara o tipo de fibra original com o novo. Se forem diferentes...
    if (originalFiberType !== newFiberType) {
      // ...chama a função que verifica se o cabo tem fusões ativas.
      const usage = checkCableUsageInFusionPlans(originalCable);

      // Se a verificação retornar que existem fusões...
      if (usage.hasFusions) {
        // ...mostra um alerta bloqueando a ação e informa o usuário.
        showAlert(
          "Ação Bloqueada",
          `Não é possível alterar o tipo do cabo "${originalCable.name}" porque ele possui fusões ativas na(s) caixa(s): ${usage.locations.join(', ')}. Por favor, remova as fusões deste cabo antes de alterar seu tipo.`
        );
        // Interrompe a execução da função, impedindo que o cabo seja salvo.
        return;
      }
    }
  }
  // =======================================================================
  // == FIM DA NOVA VERIFICAÇÃO
  // =======================================================================


  if (!name) {
    showAlert("Erro", "Digite um nome para o cabo.");
    return;
  }
  if (cablePath.length < 2) {
    showAlert("Erro", "Desenhe pelo menos dois pontos.");
    return;
  }

  const lastPoint = cablePath[cablePath.length - 1];
  let isEndPointValid = false;
  for (const markerInfo of markers) {
    if ((markerInfo.type === "CEO" || markerInfo.type === "CTO" || markerInfo.type === "RESERVA") && markerInfo.marker.getPosition().equals(lastPoint)) {
      isEndPointValid = true;
      break;
    }
  }
  if (!isEndPointValid) {
    showAlert("Erro", "O cabo deve finalizar em um marcador do tipo CEO, CTO ou Reserva. Clique em um marcador válido para terminar o desenho antes de salvar.");
    return;
  }
  

  if (editingCableIndex !== null) {
    const cabo = savedCables[editingCableIndex];

    // --- INÍCIO DA NOVA LÓGICA ---
    const oldName = cabo.name; // 1. Captura o nome antigo
    const newName = name;      // 2. O 'name' do input é o novo nome
    // --- FIM DA NOVA LÓGICA ---

    cabo.name = newName; // Atualiza o nome no objeto principal
    cabo.type = fullCableType;
    cabo.color = cor;
    cabo.width = largura;
    cabo.path = [...cablePath];
    cabo.lancamento = cableDistance.lancamento;
    cabo.reserva = cableDistance.reserva;
    cabo.totalLength = cableDistance.total;
    
    cabo.polyline.setOptions({
      strokeColor: cor,
      strokeWeight: largura,
    });
    cabo.polyline.setPath(cablePath);

    cabo.item.querySelector('.item-name').textContent = `${newName} (${cabo.status}) - ${cabo.totalLength}m`;
    cabo.item.style.color = cor;

    if (cabo.isImported) {
        const adjustBtn = cabo.item.querySelector('.adjust-kml-btn');
        if (adjustBtn) {
            adjustBtn.remove();
        }
        cabo.isImported = false;
    }

    cabo.polyline.setVisible(true); 
    if (cablePolyline) cablePolyline.setMap(null);

    // --- INÍCIO DA NOVA LÓGICA ---
    // 3. Chama a função de sincronização se o nome mudou
    if (oldName !== newName) {
        updateCableNameInAllFusionPlans(oldName, newName);
    }
    // --- FIM DA NOVA LÓGICA ---

    showAlert("Sucesso", "Cabo atualizado com sucesso!");
  }
  // Lógica para CRIAR um novo cabo (continua a mesma)
  else {
    const polyline = new google.maps.Polyline({
      path: cablePath,
      geodesic: true,
      strokeColor: cor,
      strokeOpacity: 1.0,
      strokeWeight: largura,
      clickable: true,
      map: map,
    });
    const item = document.createElement("li");
    enableDragAndDropForItem(item);

    const nameSpan = document.createElement("span");
    nameSpan.className = 'item-name';
    nameSpan.textContent = `${name} (${currentCableStatus}) - ${cableDistance.total}m`;
    nameSpan.style.color = cor;
    nameSpan.style.cursor = "pointer";
    nameSpan.style.flexGrow = '1';

    const visibilityBtn = document.createElement("button");
    visibilityBtn.className = 'visibility-toggle-btn item-toggle';
    visibilityBtn.innerHTML = `<img src="img/Mostrar.png" width="16" height="16" alt="Visibilidade">`; 
    visibilityBtn.title = 'Ocultar/Exibir item no mapa';
    visibilityBtn.dataset.visible = 'true';

    item.appendChild(nameSpan);
    item.appendChild(visibilityBtn);
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';

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
      status: currentCableStatus,
      lancamento: cableDistance.lancamento,
      reserva: cableDistance.reserva,
      totalLength: cableDistance.total,
    };

    savedCables.push(newCableInfo);

    nameSpan.addEventListener("click", () => openCableEditor(newCableInfo));
    polyline.addListener("click", () => openCableEditor(newCableInfo));
    
    const newCableIndex = savedCables.length - 1;
    addCableEventListeners(polyline, newCableIndex);
    
    visibilityBtn.onclick = (e) => {
        e.stopPropagation();
        const isVisible = newCableInfo.polyline.getVisible();
        newCableInfo.polyline.setVisible(!isVisible);
        const iconSrc = isVisible ? 'img/Ocultar.png' : 'img/Mostrar.png';
        visibilityBtn.querySelector('img').src = iconSrc;
    };
    if (cablePolyline) cablePolyline.setMap(null);
    showAlert("Sucesso", "Cabo salvo com sucesso!");
  }

  // Limpeza final da interface (continua a mesma)
  cableMarkers.forEach((marker) => marker.setMap(null));
  cableMarkers = [];
  cablePath = [];
  cableDistance = { lancamento: 0, reserva: 0, total: 0 };
  editingCableIndex = null;
  isDrawingCable = false;
  setAllPolygonsClickable(true);
  document.getElementById("invertCableButton").classList.add("hidden");
  document.getElementById("cableDrawingBox").classList.add("hidden");
  document.getElementById("cableStatusDisplay").style.display = 'none';
  document.getElementById("map").classList.remove("cursor-draw");
  setMapCursor("");
});

function openCableEditor(cabo) { 
    const index = savedCables.indexOf(cabo);
    if (index === -1) {
        showAlert("Erro", "Não foi possível encontrar o cabo para edição.");
        return;
    }

    if (editingCableIndex !== null && editingCableIndex !== index) {
        const originalCable = savedCables[editingCableIndex];
        if (originalCable && originalCable.polyline) {
            originalCable.polyline.setVisible(true);
        }
    }

    if (cabo && cabo.polyline) {
        cabo.polyline.setVisible(false);
    }

    document.getElementById("cableName").value = cabo.name;

    const typeParts = cabo.type.split(' ');
    if (typeParts.length >= 4) {
        document.getElementById("cableASType").value = `${typeParts[1]} ${typeParts[2]}`;
        document.getElementById("cableType").value = typeParts[3];
    } else {
        document.getElementById("cableType").value = cabo.type;
    }

    document.getElementById("cableWidth").value = cabo.width;
    document.getElementById("deleteCableButton").classList.remove("hidden");
    document.getElementById("invertCableButton").classList.remove("hidden"); // Mostra o botão Inverter

    const statusDisplay = document.getElementById("cableStatusDisplay");
    if (cabo.status) {
        statusDisplay.textContent = `Status: ${cabo.status}`;
        statusDisplay.style.display = 'block';
    } else {
        statusDisplay.style.display = 'none';
    }

    cablePath = [...cabo.path];
    cableMarkers.forEach((marker) => marker.setMap(null));
    cableMarkers = [];

    // ===== INÍCIO DA MODIFICAÇÃO PRINCIPAL AQUI =====
    cablePath.forEach((position, i) => {
        let markerLabel = null;
        let markerIconScale = 5;

        // Define o rótulo "A" para o primeiro ponto e "B" para o último
        if (i === 0) {
            markerLabel = "A";
            markerIconScale = 7; // Deixa a ponta um pouco maior para destacar
        } else if (i === cablePath.length - 1) {
            markerLabel = "B";
            markerIconScale = 7;
        }

        const marker = new google.maps.Marker({
            position,
            map,
            draggable: true,
            label: {
                text: markerLabel,
                color: "black",
                fontWeight: "bold",
                fontSize: "12px"
            },
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: markerIconScale,
                fillColor: "#ffffff",
                fillOpacity: 1,
                strokeColor: "#000000",
                strokeWeight: 1.5,
            },
        });
        // ===== FIM DA MODIFICAÇÃO PRINCIPAL AQUI =====

        marker.addListener("drag", () => {
            updatePolylineFromMarkers();
        });

        marker.addListener("dragend", () => {
            handleCableVertexDragEnd(i);
        });

        marker.addListener("dblclick", () => {
            // Guarda uma referência ao objeto do cabo que está sendo editado
            const currentCableBeingEdited = savedCables[editingCableIndex];
            if (!currentCableBeingEdited) return; // Verificação de segurança

            const indexToDelete = cableMarkers.indexOf(marker);
            if (indexToDelete !== -1) {
                console.log(`Tentando deletar vértice no índice: ${indexToDelete}`); // Log para depuração

                // 1. Remove visualmente o marcador do mapa
                cableMarkers[indexToDelete].setMap(null);
                console.log("Marcador removido do mapa.");

                // 2. Remove o objeto do marcador do array 'cableMarkers'
                cableMarkers.splice(indexToDelete, 1);
                console.log("Marcador removido do array cableMarkers.");

                // 3. ATUALIZA o array cablePath INTERNO e redesenha a polyline
                //    baseado nos marcadores restantes em cableMarkers. ESSENCIAL!
                updatePolylineFromMarkers();
                console.log("updatePolylineFromMarkers chamado após splice.");

                // 4. Reabre o editor para redesenhar os marcadores restantes
                //    com os rótulos A/B corretos, usando o mesmo objeto de cabo.
                //    Isso garante que a UI reflita o estado atualizado.
                openCableEditor(currentCableBeingEdited);
                console.log("Editor reaberto para atualizar marcadores A/B.");

                // Adiciona um alerta para feedback imediato (opcional)
                showAlert("Ponto Removido", "O ponto foi removido. Salve o cabo para confirmar a alteração.");

            } else {
                 console.log("Erro: Não foi possível encontrar o índice do marcador para deletar.");
            }
        });

        cableMarkers.push(marker);
    });

    isDrawingCable = true;
    editingCableIndex = index;
    updatePolylineFromMarkers();
    document.getElementById("cableDrawingBox").classList.remove("hidden");
    document.getElementById("map").classList.add("cursor-draw");
    setMapCursor("crosshair");
}

document.getElementById("cancelCableButton").addEventListener("click", () => {
  if (editingCableIndex !== null) {
    const originalCable = savedCables[editingCableIndex];
    if (originalCable && originalCable.polyline) {
      originalCable.polyline.setVisible(true);
    }
  }
  if (cablePolyline) cablePolyline.setMap(null);
  cableMarkers.forEach((marker) => marker.setMap(null));
  cableMarkers = [];
  cablePath = [];
  cableDistance = { lancamento: 0, reserva: 0, total: 0 };
  isDrawingCable = false;
  setAllPolygonsClickable(true);
  editingCableIndex = null; // Limpa o índice de edição
  document.getElementById("invertCableButton").classList.add("hidden");
  document.getElementById("cableDrawingBox").classList.add("hidden");
  document.getElementById("cableStatusDisplay").style.display = 'none';
  document.getElementById("map").classList.remove("cursor-draw");
  setMapCursor("");
});

document.getElementById("addMarkerButton").addEventListener("click", () => {
  if (isAddingMarker || isDrawingCable) {
    showAlert("Atenção", "Finalize a ação atual antes de adicionar outro marcador ou cabo.");
    return;
  }
  if (!activeFolderId) {
    // A LINHA ABAIXO FOI CORRIGIDA
    showAlert("Atenção", "Selecione uma pasta para salvar o marcador.");
    return;
  }
  
  resetMarkerModal();

  document.querySelectorAll("#markerTypeModal .marker-option.selected").forEach(o => o.classList.remove("selected"));

  document.getElementById("markerTypeModal").style.display = "flex";
});

// Substitua a função startPlacingMarker inteira
function startPlacingMarker() {
    isAddingMarker = true;
    setAllPolygonsClickable(false);
    setMapCursor("crosshair");

    document.getElementById("markerModal").style.display = "none";
    document.getElementById("markerTypeModal").style.display = "none";

    // MODO DE AJUSTE: Se estamos a ajustar um marcador existente...
    if (adjustingKmlMarkerInfo) {
        // 1. Pega a posição exata do marcador antigo
        const originalPosition = adjustingKmlMarkerInfo.marker.getPosition();

        // 2. Apaga o marcador "Importado" antigo (do mapa, da lista e do array)
        adjustingKmlMarkerInfo.marker.setMap(null);
        adjustingKmlMarkerInfo.listItem.remove();
        markers = markers.filter((m) => m !== adjustingKmlMarkerInfo);

        // 3. Cria imediatamente o novo marcador na mesma posição
        addCustomMarker(originalPosition);

        // 4. Limpa o estado
        isAddingMarker = false;
        setMapCursor("");
        resetMarkerModal(); // Chama resetMarkerModal aqui para limpar os dados
        adjustingKmlMarkerInfo = null; // Finaliza o modo de ajuste

    } else { // MODO DE CRIAÇÃO NORMAL: Se não estamos a ajustar...
        // O comportamento original permanece: espera um clique no mapa
        placeMarkerListener = map.addListener("click", function placeMarker(event) {
            if (!isAddingMarker) return;
            addCustomMarker(event.latLng);
            isAddingMarker = false;
            setMapCursor("");
            resetMarkerModal();
        });
    }
}

document.querySelectorAll("#markerTypeModal .marker-option").forEach((opt) => {
    opt.addEventListener("click", () => {
        const markerType = opt.getAttribute("data-type");
        selectedMarkerData.type = markerType;
        document.getElementById("markerTypeModal").style.display = "none";
      
        if (markerType === "CTO") {
            document.getElementById("ctoStatusSelectionModal").style.display = "flex";
            return;
        }
      
        if (markerType === "CEO") {
            document.getElementById("ceoStatusSelectionModal").style.display = "flex";
            return;
        }

        if (markerType === "CORDOALHA") {
            document.getElementById("cordoalhaStatusSelectionModal").style.display = "flex";
            return;
        }

        if (markerType === "RESERVA") {
            document.getElementById("reservaStatusSelectionModal").style.display = "flex";
            return;
        }

        if (markerType === "CASA") {
            document.getElementById("markerModalTitle").textContent = "Adicionar Casas";
            document.getElementById("nameGroup").classList.add("hidden");
            document.querySelector(".compact-inputs-container").classList.add("hidden");
            document.getElementById("descGroup").classList.add("hidden");
            document.getElementById("colorGroup").classList.add("hidden");
            document.getElementById("sizeGroup").classList.add("hidden");
            document.getElementById("houseNumberGroup").classList.remove("hidden");
        }

        // --- ADIÇÃO PARA PRÉ-PREENCHER OS DADOS (para o tipo CASA) ---
        if (adjustingKmlMarkerInfo) {
            // Para "Casa", o nome vai para o campo de quantidade
            document.getElementById('markerNumber').value = adjustingKmlMarkerInfo.name; 
        }
        // --- FIM DA ADIÇÃO ---

        document.getElementById("markerModal").style.display = "flex";
    });
});

document.querySelectorAll(".cable-status-option").forEach(option => {
    option.addEventListener("click", () => {
        currentCableStatus = option.getAttribute("data-status");
        document.getElementById("cableStatusSelectionModal").style.display = "none";
        startDrawingCable();
    });
});

document.querySelectorAll(".cto-status-option").forEach(option => {
    option.addEventListener("click", () => {
        const status = option.getAttribute("data-status");
        
        document.getElementById("ctoStatusSelectionModal").style.display = "none";
        
        selectedMarkerData.type = "CTO";
        selectedMarkerData.ctoStatus = status;

        document.getElementById("markerModalTitle").textContent = "Adicionar Caixa de Atrendimento (CTO)";
      
        const ctoInfoDisplay = document.getElementById("ctoInfoDisplay");
        document.getElementById("ctoStatusInfo").textContent = `Status: ${selectedMarkerData.ctoStatus}`;
        ctoInfoDisplay.classList.remove("hidden");
        
        document.getElementById("labelColorGroup").classList.remove("hidden");
        document.getElementById("ctoPredialGroup").classList.remove("hidden");
        document.getElementById("ctoStickerGroup").classList.remove("hidden");
        
        const buttonContainer = document.getElementById("modalButtonContainer");
        const existingButton = document.getElementById("fusionPlanButton");
        if (existingButton) existingButton.remove();

        const fusionButton = document.createElement("button");
        fusionButton.id = "fusionPlanButton";
        fusionButton.textContent = "Plano de Fusão";
        fusionButton.style.backgroundColor = "#4CAF50";
        fusionButton.disabled = true;
        fusionButton.title = "Salve o marcador para definir o plano de fusão";
        fusionButton.style.opacity = 0.6;
        buttonContainer.appendChild(fusionButton);

        // --- ADIÇÃO PARA PRÉ-PREENCHER OS DADOS ---
        if (adjustingKmlMarkerInfo) {
            document.getElementById('markerName').value = adjustingKmlMarkerInfo.name;
            document.getElementById('markerDescription').value = adjustingKmlMarkerInfo.description;
        }
        // --- FIM DA ADIÇÃO ---
        document.getElementById("markerModal").style.display = "flex";
    });
});

document.querySelectorAll(".ceo-status-option").forEach(option => {
    option.addEventListener("click", () => {
        const status = option.getAttribute("data-status");
        selectedMarkerData.ceoStatus = status;
        document.getElementById("ceoStatusSelectionModal").style.display = "none";
        document.getElementById("ceoAccessorySelectionModal").style.display = "flex";
    });
});

document.querySelectorAll(".ceo-accessory-option").forEach(option => {
    option.addEventListener("click", () => {
        const accessory = option.getAttribute("data-accessory");
        document.getElementById("ceoAccessorySelectionModal").style.display = "none";

        if (selectedMarkerData.type === 'CEO') {
            const chosenStatus = selectedMarkerData.ceoStatus;
            selectedMarkerData.ceoAccessory = accessory;
            
            document.getElementById("markerModalTitle").textContent = "Adicionar Caixa de Emenda (CEO)";
            
            const infoDisplay = document.getElementById("ceoInfoDisplay");
            document.getElementById("ceoStatusInfo").textContent = `Status: ${chosenStatus}`;
            document.getElementById("ceoAccessoryInfo").textContent = `Instalação: ${accessory}`;
            infoDisplay.classList.remove("hidden");
            
            document.getElementById("labelColorGroup").classList.remove("hidden");
            
            const buttonContainer = document.getElementById("modalButtonContainer");
            const existingButton = document.getElementById("fusionPlanButton");
            if (existingButton) existingButton.remove();

            const fusionButton = document.createElement("button");
            fusionButton.id = "fusionPlanButton";
            fusionButton.textContent = "Plano de Fusão";
            fusionButton.style.backgroundColor = "#4CAF50";
            fusionButton.disabled = true;
            fusionButton.title = "Salve o marcador para definir o plano de fusão";
            fusionButton.style.opacity = 0.6;
            buttonContainer.appendChild(fusionButton);

            document.getElementById("ceo144Group").classList.remove("hidden");
            
        } else if (selectedMarkerData.type === 'RESERVA') { //
            const chosenStatus = selectedMarkerData.reservaStatus;
            selectedMarkerData.reservaAccessory = accessory;

            document.getElementById("markerModalTitle").textContent = "Adicionar Reserva Técnica";

            const infoDisplay = document.getElementById("reservaInfoDisplay");
            document.getElementById("reservaStatusInfo").textContent = `Status: ${chosenStatus}`; //
            document.getElementById("reservaAccessoryInfo").textContent = `Instalação: ${accessory}`; //
            infoDisplay.classList.remove("hidden");

            document.getElementById("labelColorGroup").classList.remove("hidden"); //
        }

        // --- ADIÇÃO PARA PRÉ-PREENCHER OS DADOS ---
        if (adjustingKmlMarkerInfo) {
            document.getElementById('markerName').value = adjustingKmlMarkerInfo.name;
            document.getElementById('markerDescription').value = adjustingKmlMarkerInfo.description;
        }
        // --- FIM DA ADIÇÃO ---

        document.getElementById("markerModal").style.display = "flex";
    });
});

document.querySelectorAll(".cordoalha-status-option").forEach(option => {
    option.addEventListener("click", () => {
        const status = option.getAttribute("data-status");
        document.getElementById("cordoalhaStatusSelectionModal").style.display = "none";

        selectedMarkerData.type = "CORDOALHA";
        selectedMarkerData.cordoalhaStatus = status;

        document.getElementById("markerModalTitle").textContent = "Adicionar Cordoalha";
        
        const infoDisplay = document.getElementById("cordoalhaInfoDisplay");
        document.getElementById("cordoalhaStatusInfo").textContent = `Status: ${selectedMarkerData.cordoalhaStatus}`;
        infoDisplay.classList.remove("hidden");
        
        document.getElementById("labelColorGroup").classList.remove("hidden");
        document.getElementById("derivationTGroup").classList.remove("hidden");

        // --- ADIÇÃO PARA PRÉ-PREENCHER OS DADOS ---
        if (adjustingKmlMarkerInfo) {
            document.getElementById('markerName').value = adjustingKmlMarkerInfo.name;
            document.getElementById('markerDescription').value = adjustingKmlMarkerInfo.description;
        }
        // --- FIM DA ADIÇÃO ---
        document.getElementById("markerSize").value = 8; // Define o tamanho 8 SÓ para Cordoalha
        document.getElementById("markerModal").style.display = "flex";
    });
});

document.querySelectorAll(".reserva-status-option").forEach(option => {
    option.addEventListener("click", () => {
        const status = option.getAttribute("data-status");
        selectedMarkerData.reservaStatus = status;
        document.getElementById("reservaStatusSelectionModal").style.display = "none";
        document.getElementById("ceoAccessorySelectionModal").style.display = "flex";
    });
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
            fixedItemsList.innerHTML = ''; // Limpa a lista antes de preencher
            POP_KIT_CONFIG.fixed.forEach(item => {
                const li = document.createElement('li');
                li.style.marginBottom = '5px';
                li.innerHTML = `<b>${item.quantity}x</b> ${item.name}`;
                fixedItemsList.appendChild(li);
            });
            
            popKitModal.style.display = 'flex';
        }
    });
});

// Adicione estas duas funções auxiliares
function addMaterialToBom(materialName, quantity) {
    if (!activeFolderId) return;
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) return;

    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    if (!projectBoms[projectId]) {
        calculateBomState();
        projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
    }

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
    
    const priceInfo = MATERIAL_PRICES[materialName] || { price: 0, category: 'Outros' };
    if (!projectBoms[projectId][materialName]) {
        projectBoms[projectId][materialName] = { quantity: 0, type: priceInfo.unit || 'un', unitPrice: priceInfo.price, category: priceInfo.category, removed: false };
    }
    projectBoms[projectId][materialName].quantity += quantity;
}

function removeMaterialFromBom(materialName, quantity) {
    if (!activeFolderId) return;
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) return;

    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    if (projectBoms[projectId] && projectBoms[projectId][materialName]) {
        projectBoms[projectId][materialName].quantity -= quantity;
        if (projectBoms[projectId][materialName].quantity < 0) {
            projectBoms[projectId][materialName].quantity = 0;
        }
    }
}

/**
 * Lida com a marcação/desmarcação do Kit Derivação em um cabo de saída.
 * Adiciona ou remove o material da lista de materiais do projeto.
 * @param {HTMLInputElement} checkboxElement - O elemento do checkbox que foi clicado.
 */
function handleDerivationKitToggle(checkboxElement) {
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione um projeto para gerenciar os materiais.");
        checkboxElement.checked = !checkboxElement.checked; // Desfaz a ação
        return;
    }

    const materialName = "KIT DERIVAÇÃO PARA CAIXA DE EMENDA OPTICA";

    if (checkboxElement.checked) {
        // Se a caixa foi marcada, adiciona o material
        addMaterialToBom(materialName, 1);
        showAlert("Material Adicionado", `"${materialName}" foi adicionado à lista.`);
    } else {
        // Se a caixa foi desmarcada, remove o material
        removeMaterialFromBom(materialName, 1);
        showAlert("Material Removido", `"${materialName}" foi removido da lista.`);
    }
    checkboxElement.dataset.checked = checkboxElement.checked;
}

/**
 * Lida com a alteração da quantidade de Kits de Bandeja.
 * Calcula a diferença e atualiza a lista de materiais do projeto.
 * @param {HTMLInputElement} inputElement - O campo de input que foi alterado.
 */
function handleTrayQuantityChange(inputElement) {
    const materialName = "KIT DE BANDEJA PARA CAIXA DE EMENDA";
    const newQuantity = parseInt(inputElement.value, 10) || 0;
    const oldQuantity = parseInt(inputElement.dataset.oldValue, 10) || 0;

    // Calcula a diferença para adicionar ou remover
    const difference = newQuantity - oldQuantity;

    if (difference > 0) {
        addMaterialToBom(materialName, difference);
    } else if (difference < 0) {
        removeMaterialFromBom(materialName, Math.abs(difference));
    }

    // Atualiza o valor antigo no próprio elemento para o próximo cálculo
    inputElement.dataset.oldValue = newQuantity;
}

document.getElementById("closeModal").addEventListener("click", () => {
  resetMarkerModal();
});

/**
 * Retorna a cor do cabo com base no tipo de fibra (ex: "FO-06").
 * @param {string} fiberType - A parte do tipo do cabo que indica a fibra.
 * @returns {string} O código hexadecimal da cor.
 */
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

/**
 * Extrai a parte da fibra (ex: "FO-06") do nome completo do cabo.
 * @param {string} fullCableType - O nome completo (ex: "Cabo AS 80 FO-06").
 * @returns {string|null} O tipo de fibra ou null se não for encontrado.
 */
function getFiberType(fullCableType) {
    if (!fullCableType) return null;
    const match = fullCableType.match(/FO-\d+/);
    return match ? match[0] : null;
}


document.getElementById("cableType").addEventListener("change", () => {
  if (cablePolyline && isDrawingCable) {
    const fiberType = document.getElementById("cableType").value;
    const novaCor = getCableColor(fiberType);
    cablePolyline.setOptions({ strokeColor: novaCor });
  }
});

document.getElementById("cableWidth").addEventListener("change", () => {
  if (cablePolyline && isDrawingCable) {
    const novaLargura = parseInt(document.getElementById("cableWidth").value);
    cablePolyline.setOptions({ strokeWeight: novaLargura });
  }
});

document.getElementById("deleteCableButton").addEventListener("click", () => {
  if (editingCableIndex === null) return;

  const cableToDelete = savedCables[editingCableIndex];
  
  // 1. VERIFICA O USO DO CABO ANTES DE QUALQUER AÇÃO
  const usage = checkCableUsageInFusionPlans(cableToDelete);

  // 2. SE O CABO TIVER FUSÕES, BLOQUEIA A EXCLUSÃO E AVISA O USUÁRIO
  if (usage.hasFusions) {
      showAlert(
          "Ação Bloqueada",
          `O cabo "${cableToDelete.name}" possui fusões ativas nas caixas: ${usage.locations.join(', ')}. Por favor, acesse o plano de fusão destas caixas e remova as conexões antes de excluir o cabo.`
      );
      return; // Interrompe a função
  }

  // 3. SE NÃO TIVER FUSÕES, PROSSEGUE COM A CONFIRMAÇÃO
  let confirmMessage = `Tem certeza que deseja excluir o cabo "${cableToDelete.name}"?`;
  if (usage.isInPlan) {
      confirmMessage += `\n\nEste cabo será removido automaticamente dos planos de fusão das caixas: ${usage.locations.join(', ')}.`;
  }

  showConfirm('Excluir Cabo', confirmMessage, () => {
      // 4. SE O CABO ESTIVER EM PLANOS (SEM FUSÕES), LIMPA-OS
      if (usage.isInPlan) {
          removeCableFromSavedFusionPlans(cableToDelete.name, usage.locations);
      }

      // 5. EXECUTA A EXCLUSÃO PADRÃO DO CABO
      const cabo = savedCables[editingCableIndex];
      if (cabo.polyline) cabo.polyline.setMap(null);
      if (cablePolyline) cablePolyline.setMap(null);
      if (cabo.item) cabo.item.remove();
      
      savedCables.splice(editingCableIndex, 1);
      
      // 6. LIMPA A INTERFACE
      cableMarkers.forEach((marker) => marker.setMap(null));
      cableMarkers = [];
      cablePath = [];
      cableDistance = { lancamento: 0, reserva: 0, total: 0 };
      editingCableIndex = null;
      isDrawingCable = false;
      document.getElementById("invertCableButton").classList.add("hidden"); // Esconde o botão Inverter
      document.getElementById("cableDrawingBox").classList.add("hidden");
      document.getElementById("deleteCableButton").classList.add("hidden");
      
      showAlert("Sucesso", "Cabo excluído com sucesso.");
  });
});

document.querySelectorAll(".marker-option").forEach((opt) => {
  opt.addEventListener("click", () => {
    document
      .querySelectorAll(".marker-option")
      .forEach((o) => o.classList.remove("selected"));
    opt.classList.add("selected");
  });
});

document.getElementById("confirmMarker").addEventListener("click", () => {
  // --- LÓGICA DE EDIÇÃO ---
  if (editingMarkerInfo) {
    if (editingMarkerInfo.type === "CASA") {
      editingMarkerInfo.name = document.getElementById("markerNumber").value || "0";
    } else {
      editingMarkerInfo.name = document.getElementById("markerName").value || "Marcador";
      editingMarkerInfo.color = document.getElementById("markerColor").value;
      editingMarkerInfo.labelColor = document.getElementById("markerLabelColor").value;
      editingMarkerInfo.size = parseInt(document.getElementById("markerSize").value) || 8;
      editingMarkerInfo.description = document.getElementById("markerDescription").value;

      if (editingMarkerInfo.type === "CORDOALHA") {
        editingMarkerInfo.derivationTCount = parseInt(document.getElementById("markerDerivationT").value) || 0;
      }
      if (editingMarkerInfo.type === "CTO") {
          editingMarkerInfo.isPredial = document.getElementById("ctoPredialCheckbox").checked;
          editingMarkerInfo.needsStickers = document.getElementById("ctoStickerCheckbox").checked;
      }
      // ADICIONADO: Salvar o estado da CEO
      if (editingMarkerInfo.type === "CEO") {
          editingMarkerInfo.is144F = document.getElementById("ceo144Checkbox").checked;
      }
    }
    updateMarkerAppearance(editingMarkerInfo);
    const fusionButton = document.getElementById("fusionPlanButton");
    if (fusionButton) {
      fusionButton.disabled = false;
      fusionButton.style.opacity = 1;
      fusionButton.title = "Editar o plano de fusão";
    }
    resetMarkerModal();

  // --- LÓGICA DE CRIAÇÃO ---
  } else {
    if (selectedMarkerData.type === "CASA") {
        selectedMarkerData.name = document.getElementById("markerNumber").value || "0";
    } else {
        selectedMarkerData.name = document.getElementById("markerName").value || "Marcador";
        selectedMarkerData.color = document.getElementById("markerColor").value;
        selectedMarkerData.labelColor = document.getElementById("markerLabelColor").value;
        selectedMarkerData.size = parseInt(document.getElementById("markerSize").value) || 8;
        selectedMarkerData.description = document.getElementById("markerDescription").value;
    }
    if (selectedMarkerData.type === "CORDOALHA") {
        selectedMarkerData.derivationTCount = parseInt(document.getElementById("markerDerivationT").value) || 0;
    }
    if (selectedMarkerData.type === "CTO") {
        selectedMarkerData.isPredial = document.getElementById("ctoPredialCheckbox").checked;
        selectedMarkerData.needsStickers = document.getElementById("ctoStickerCheckbox").checked;
    }
    // ADICIONADO: Salvar o estado da CEO
    if (selectedMarkerData.type === "CEO") {
        selectedMarkerData.is144F = document.getElementById("ceo144Checkbox").checked;
    }
    if (!selectedMarkerData.type) return;
    startPlacingMarker();
  }
});

// Substitua a função addCustomMarker inteira
function addCustomMarker(location, importedData = null) {
    const data = importedData || selectedMarkerData;

    const isCasa = data.type === "CASA";
    const marker = new google.maps.Marker({
        position: location,
        map: map,
        draggable: false,
    });
    const li = document.createElement("li");
    enableDragAndDropForItem(li);

    const nameSpan = document.createElement("span");
    nameSpan.className = 'item-name';
    nameSpan.style.cursor = "pointer";
    nameSpan.style.flexGrow = '1';

    const visibilityBtn = document.createElement("button");
    visibilityBtn.className = 'visibility-toggle-btn item-toggle';
    visibilityBtn.innerHTML = `<img src="img/Mostrar.png" width="16" height="16" alt="Visibilidade">`;
    visibilityBtn.title = 'Ocultar/Exibir item no mapa';
    visibilityBtn.dataset.visible = 'true';

    li.appendChild(nameSpan);
    
    // ADIÇÃO: Se o marcador é importado, adiciona o botão "Ajustar"
    if (data.isImported) {
        const adjustBtn = document.createElement("button");
        adjustBtn.className = 'adjust-kml-btn';
        adjustBtn.textContent = 'Ajustar';
        li.appendChild(adjustBtn);

        adjustBtn.onclick = (e) => {
            e.stopPropagation();
            startMarkerAdjustment(markerInfo);
        };
    }

    li.appendChild(visibilityBtn);
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';

    const parentUl = document.getElementById(activeFolderId);
    if (parentUl) {
        parentUl.appendChild(li);
    }

    const markerInfo = {
        marker: marker,
        listItem: li,
        folderId: activeFolderId,
        type: data.type,
        name: data.name,
        color: isCasa ? "#000000" : data.color,
        labelColor: data.labelColor,
        size: isCasa ? 8 : data.size,
        description: data.description,
        fusionPlan: "",
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
    };

    visibilityBtn.onclick = (e) => {
        e.stopPropagation();
        const isVisible = markerInfo.marker.getVisible();
        markerInfo.marker.setVisible(!isVisible);
        visibilityBtn.dataset.visible = !isVisible;
        visibilityBtn.querySelector('img').src = isVisible ? 'img/Ocultar.png' : 'img/Mostrar.png';
    };

    markers.push(markerInfo);
    updateMarkerAppearance(markerInfo);

    // (Dentro da função rebuildMarker, substitua o listener de clique por este)

    marker.addListener("click", () => {
      // Se não estiver no modo de desenho/edição de cabo, abre o editor do marcador
      if (!isDrawingCable) {
        openMarkerEditor(markerInfo);
        return;
      }

      // --- LÓGICA DE DESENHO DE CABO ATIVA ---

      // CASO 1: INICIANDO UM NOVO CABO (primeiro clique)
      if (cablePath.length === 0) {
        // Valida se o marcador de início é um ponto de ancoragem
        if (markerInfo.type !== "CEO" && markerInfo.type !== "CTO" && markerInfo.type !== "RESERVA") {
          showAlert("Aviso", "Cabos devem ser iniciados em um marcador do tipo CEO, CTO ou Reserva.");
          return;
        }
        // Se for válido, a lógica de "Adicionar Ponto" (CASO 3) será executada.
      }
      
      // CASO 2: EDITANDO UM CABO (a correção)
      // Se estamos editando (editingCableIndex não é nulo) e já temos vértices no editor
      else if (editingCableIndex !== null && cableMarkers.length > 0) {
          
          // Valida se o marcador clicado é um ponto de ancoragem
          if (markerInfo.type !== "CEO" && markerInfo.type !== "CTO" && markerInfo.type !== "RESERVA") {
              showAlert("Aviso", "As pontas dos cabos só podem ser ancoradas em marcadores CEO, CTO ou Reserva.");
              return; // Impede a ancoragem em marcadores inválidos
          }
          
          // Pega o último marcador de vértice (a ponta "B" que está sendo editada)
          const lastVertexMarker = cableMarkers[cableMarkers.length - 1];
          const newPosition = markerInfo.marker.getPosition();
          
          // MOVE o marcador do vértice para a posição do novo marcador de ancoragem
          lastVertexMarker.setPosition(newPosition);
          
          // Atualiza a linha do cabo e os cálculos de distância
          updatePolylineFromMarkers();
          
          // IMPORTANTE: Impede que a lógica de "Adicionar Ponto" (abaixo) seja executada
          return; 
      }

      // CASO 3: ADICIONANDO UM NOVO PONTO
      // (Roda no Caso 1, ou se estiver desenhando um novo cabo (ponto 2, 3, etc.))
      const markerPosition = markerInfo.marker.getPosition();
      cablePath.push(markerPosition);

      const cablePointMarker = new google.maps.Marker({
        position: markerPosition,
        map: map,
        draggable: true,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 5,
          fillColor: "#ffffff",
          fillOpacity: 1,
          strokeColor: "#000000",
          strokeWeight: 1,
        },
      });

      cableMarkers.push(cablePointMarker);
      
      // Listeners para o novo ponto de vértice
      cablePointMarker.addListener("drag", () => updatePolylineFromMarkers());
      cablePointMarker.addListener("dblclick", () => {
        const index = cableMarkers.indexOf(cablePointMarker);
        if (index !== -1) {
          cableMarkers[index].setMap(null);
          cableMarkers.splice(index, 1);
          updatePolylineFromMarkers();
        }
      });
      
      updatePolylineFromMarkers();
    });

  nameSpan.addEventListener("click", () => openMarkerEditor(markerInfo));
}

function updateMarkerAppearance(markerInfo) {
  const isCasa = markerInfo.type === "CASA";
  const nameSpan = markerInfo.listItem.querySelector('.item-name');
  if (!nameSpan) return;
  
  if (isCasa) {
    markerInfo.marker.setIcon(null);
    markerInfo.marker.setLabel({
      text: markerInfo.name,
      color: "black",
      fontSize: "14px",
      fontWeight: "bold",
    });
    markerInfo.marker.setTitle(`Casas: ${markerInfo.name}`);
    nameSpan.textContent = `Casas (${markerInfo.name})`;
    nameSpan.style.color = "#000000";
  } else {
    let icon;
    markerInfo.marker.setLabel({
      text: markerInfo.name,
      color: markerInfo.labelColor || "#000000",
      fontWeight: "bold",
      className: 'marker-label-with-outline' // <-- Isso aplica o contorno no TEXTO
    });

    // Esta é a altura padrão (corrigida) para TODOS os marcadores
    const originalLabelOrigin = new google.maps.Point(0, -3.0);

    switch (markerInfo.type) {
      case "CEO":
        icon = {
          path: google.maps.SymbolPath.CIRCLE,
          scale: markerInfo.size,
          fillColor: markerInfo.color,
          fillOpacity: 1,
          strokeColor: "#000", // <-- Contorno preto
          strokeWeight: 1,
          labelOrigin: originalLabelOrigin,
        };
        break;
      case "CTO":
        icon = {
          path: "M -1 -1 L 1 -1 L 1 1 L -1 1 Z",
          scale: markerInfo.size,
          fillColor: markerInfo.color,
          fillOpacity: 1,
          strokeColor: "#000", // <-- Contorno preto
          strokeWeight: 1,
          labelOrigin: originalLabelOrigin,
        };
        break;
      case "CORDOALHA":
        // Este path desenha o ícone "+" COMO UMA FORMA
        const plusShapePath = "M -1 -0.2 L -0.2 -0.2 L -0.2 -1 L 0.2 -1 L 0.2 -0.2 L 1 -0.2 L 1 0.2 L 0.2 0.2 L 0.2 1 L -0.2 1 L -0.2 0.2 L -1 0.2 Z";
        
        icon = {
          path: plusShapePath,
          scale: markerInfo.size,
          fillColor: markerInfo.color,
          fillOpacity: 1,
          strokeColor: "#000", // <-- Contorno preto (O QUE FALTAVA NA IMAGEM)
          strokeWeight: 1,
          labelOrigin: originalLabelOrigin,
        };
        break;
      case "RESERVA":
        icon = {
          path: "M 0 -1 L 1 1 L -1 1 Z",
          scale: markerInfo.size * 1.25,
          fillColor: markerInfo.color,
          fillOpacity: 1,
          strokeColor: "#000", // <-- Contorno preto
          strokeWeight: 1,
          labelOrigin: originalLabelOrigin,
        };
        break;
      default:
        icon = {
          path: google.maps.SymbolPath.CIRCLE,
          scale: markerInfo.size,
          fillColor: markerInfo.color,
          fillOpacity: 1,
          strokeColor: "#000", // <-- Contorno preto
          strokeWeight: 1,
          labelOrigin: originalLabelOrigin,
        };
    }
    let title = markerInfo.name;
    let listItemText = `${markerInfo.name} (${markerInfo.type})`;
    if (markerInfo.type === "CTO") {
      title += ` - ${markerInfo.ctoStatus}`;
      listItemText += ` - ${markerInfo.ctoStatus}`;
      if (markerInfo.isPredial) {
        title += " (Predial)";
        listItemText += " (Predial)";
      }
      if (markerInfo.needsStickers) {
        title += " (Adesivos)";
        listItemText += " (Adesivos)";
      }
    }
    if (markerInfo.type === "CEO") {
        let details = `${markerInfo.ceoStatus}, ${markerInfo.ceoAccessory}`;
        if (markerInfo.is144F) {
            details += " (144F)";
        }
        title += ` - ${details}`;
        listItemText += ` - ${details}`;
    }
    if (markerInfo.type === "CORDOALHA") {
        title += ` - ${markerInfo.cordoalhaStatus}`;
        listItemText += ` - ${markerInfo.cordoalhaStatus}`;
    }
    if (markerInfo.type === "RESERVA") {
        let details = `${markerInfo.reservaStatus}, ${markerInfo.reservaAccessory}`;
        title += ` - ${details}`;
        listItemText += ` - ${details}`;
    }
    markerInfo.marker.setTitle(title);
    nameSpan.textContent = listItemText;
    markerInfo.listItem.title = markerInfo.description;
    nameSpan.style.color = markerInfo.color;
    markerInfo.marker.setIcon(icon);  
  }
}

// EM script.js:
// Localize e substitua TODA a sua função populateFusionPlan por esta versão
function populateFusionPlan(markerInfo) {
  activeMarkerForFusion = markerInfo;
  const canvas = document.getElementById("fusionCanvas");
  const svgLayer = document.getElementById("fusion-svg-layer");

  // Limpa completamente o estado anterior
  canvas.querySelectorAll(".cable-element, .splitter-element").forEach(el => el.remove());
  if (svgLayer) svgLayer.innerHTML = '';

  const trayContainer = document.getElementById('trayKitContainer');
  const trayInput = document.getElementById('trayKitQuantity');
  trayContainer.classList.add('hidden');

  if (markerInfo.fusionPlan) {
    try {
      const planData = JSON.parse(markerInfo.fusionPlan);

      // Carrega o HTML dos elementos e das linhas
      if (planData.elements) {
        canvas.insertAdjacentHTML('beforeend', planData.elements);
      }
      if (planData.svg && svgLayer) {
        svgLayer.innerHTML = planData.svg;
      }

      // Re-associa eventos de clique e funcionalidade existentes
      canvas.querySelectorAll('.splitter-element .delete-component-btn').forEach(button => button.onclick = () => handleDeleteSplitter(button));
      canvas.querySelectorAll('.cable-element .delete-component-btn').forEach(button => button.onclick = () => handleDeleteCableFromFusion(button));
      canvas.querySelectorAll('.derivation-kit-checkbox').forEach(checkbox => {
          checkbox.onclick = () => handleDerivationKitToggle(checkbox);
          if (checkbox.dataset.checked === 'true') checkbox.checked = true;
      });

      // =================================================================
      // == CORREÇÃO: REATIVA OS BOTÕES DE MOVER (SEM ARRASTAR)       ==
      // =================================================================
      // Itera sobre todos os splitters que foram carregados
      canvas.querySelectorAll('.splitter-element').forEach(splitter => {
          const body = splitter.querySelector('.splitter-body');
          if (body) {
              const buttons = body.querySelectorAll('button');
              // Procura pelos botões de mover e reatribui suas funções
              if (buttons.length >= 4) {
                  const upButton = buttons[0];
                  const downButton = buttons[1];
                  const leftButton = buttons[2];
                  const rightButton = buttons[3];

                  upButton.onclick = (e) => { e.stopPropagation(); moveSplitterVertical(splitter, 'up'); };
                  downButton.onclick = (e) => { e.stopPropagation(); moveSplitterVertical(splitter, 'down'); };
                  leftButton.onclick = (e) => { e.stopPropagation(); setSplitterSide(splitter, 'left'); };
                  rightButton.onclick = (e) => { e.stopPropagation(); setSplitterSide(splitter, 'right'); };
              }
          }
      });

      // Itera sobre todos os cabos que foram carregados
      canvas.querySelectorAll('.cable-element').forEach(cable => {
          const header = cable.querySelector('.cable-header');
          if (header) {
              const buttons = header.querySelectorAll('button');
              // Procura pelos botões de mover e reatribui suas funções
              if (buttons.length >= 2) {
                  const upButton = buttons[0];
                  const downButton = buttons[1];

                  upButton.onclick = () => moveCable(cable, 'up');
                  downButton.onclick = () => moveCable(cable, 'down');
              }
          }
      });
      // =================================================================
      // == FIM DA CORREÇÃO                                           ==
      // =================================================================

      if (svgLayer) {
        svgLayer.querySelectorAll('.fusion-line').forEach(line => {
          line.style.pointerEvents = 'auto';
          const lineId = line.id;
          if (lineId) {
            line.addEventListener('mouseover', () => setHandlesVisibility(lineId, true));
            line.addEventListener('mouseout', () => setHandlesVisibility(lineId, false));
            line.addEventListener('click', (e) => {
              if (fusionDrawingState.isActive || e.target.classList.contains('line-handle')) return;
              
              const startId = line.dataset.startId;
              const endId = line.dataset.endId;
              const startDescription = getConnectionDescription(startId);
              const endDescription = getConnectionDescription(endId);
              const infoElement = document.getElementById('lineConnectionInfo');
              infoElement.innerHTML = `<strong>De:</strong> ${startDescription}<br><strong>Para:</strong> ${endDescription}`;

              activeLineForAction = line;
              document.getElementById('lineActionModal').style.display = 'flex';
            });
          }
        });

        svgLayer.querySelectorAll('.line-handle').forEach(handle => {
          handle.style.pointerEvents = 'auto';
          const lineId = handle.dataset.lineId;
          const linePath = document.getElementById(lineId);
          if (linePath) {
            handle.addEventListener('mousedown', (e) => onHandleMouseDown(e, handle, linePath));
          }
        });
      }

      if (markerInfo.type === 'CEO') {
        trayContainer.classList.remove('hidden');
        const savedQuantity = (planData && planData.trayQuantity) ? parseInt(planData.trayQuantity, 10) : 0;
        trayInput.value = savedQuantity;
        trayInput.dataset.oldValue = savedQuantity;
        trayInput.onchange = () => handleTrayQuantityChange(trayInput);
      }

    } catch (e) {
      console.error("Erro ao carregar plano de fusão:", e);
      canvas.innerHTML = '<svg id="fusion-svg-layer" class="fusion-svg-layer"></svg><p class="canvas-placeholder">Ocorreu um erro ao carregar o plano.</p>';
    }
  } else if (markerInfo.type === 'CEO') {
    trayContainer.classList.remove('hidden');
    trayInput.value = 0;
    trayInput.dataset.oldValue = 0;
    trayInput.onchange = () => handleTrayQuantityChange(trayInput);
  }

  const placeholder = canvas.querySelector(".canvas-placeholder");
  if (canvas.querySelector('.cable-element') || canvas.querySelector('.splitter-element')) {
    if (placeholder) placeholder.remove();
  } else if (!placeholder) {
    const p = document.createElement('p');
    p.className = 'canvas-placeholder';
    p.textContent = 'A área de fusão aparecerá aqui.';
    canvas.appendChild(p);
  }

  canvas.removeEventListener('click', handleConnectionClick);
  canvas.removeEventListener('contextmenu', handleFusionCanvasRightClick);
  canvas.addEventListener('click', handleConnectionClick);
  canvas.addEventListener('contextmenu', handleFusionCanvasRightClick);

  setTimeout(() => {
    updateAllConnections();
    updateSvgLayerSize();
  }, 100);
}

function openMarkerEditor(markerInfo) {
  resetMarkerModal(); 
  editingMarkerInfo = markerInfo;

  document.getElementById("confirmMarker").textContent = "Salvar Alterações";
  document.getElementById("deleteMarkerButton").classList.remove("hidden");

  const editPositionBtn = document.getElementById("editPositionButton");
  
  const newEditPositionBtn = editPositionBtn.cloneNode(true);
  editPositionBtn.parentNode.replaceChild(newEditPositionBtn, editPositionBtn);
  
  newEditPositionBtn.addEventListener('click', () => {
    if (!editingMarkerInfo) return;

    const marker = editingMarkerInfo.marker;
    const oldPosition = marker.getPosition();

    document.getElementById("markerModal").style.display = "none";
    marker.setDraggable(true);

    google.maps.event.addListenerOnce(marker, "dragend", () => {
        marker.setDraggable(false);
        const newPosition = marker.getPosition();
        updateCablesForMovedMarker(oldPosition, newPosition);
        
        const newLat = newPosition.lat().toFixed(6);
        const newLng = newPosition.lng().toFixed(6);
        document.getElementById("markerCoordinatesText").textContent = `${newLat}, ${newLng}`;
        
        document.getElementById("markerModal").style.display = "flex"; 
    });
  });

  if (markerInfo.type === "CASA") {
    document.getElementById("markerModalTitle").textContent = "Editar Casas";
    
    document.getElementById("nameGroup").classList.add("hidden");
    document.querySelector(".compact-inputs-container").classList.add("hidden");
    document.getElementById("descGroup").classList.add("hidden");
    document.getElementById("markerCoordinatesGroup").classList.add("hidden");
    newEditPositionBtn.classList.add("hidden");
    document.getElementById("colorGroup").classList.add("hidden");
    document.getElementById("sizeGroup").classList.add("hidden");
    document.getElementById("houseNumberGroup").classList.remove("hidden");
    document.getElementById("markerNumber").value = markerInfo.name;
  } else {
    newEditPositionBtn.classList.remove("hidden");
    document.getElementById("nameGroup").classList.remove("hidden");
    document.querySelector(".compact-inputs-container").classList.remove("hidden");
    document.getElementById("descGroup").classList.remove("hidden");
    document.getElementById("markerName").value = markerInfo.name;
    document.getElementById("markerColor").value = markerInfo.color;
    document.getElementById("markerSize").value = markerInfo.size;
    document.getElementById("markerDescription").value = markerInfo.description;
    
    const position = markerInfo.marker.getPosition();
    const lat = position.lat().toFixed(6);
    const lng = position.lng().toFixed(6);
    document.getElementById("markerCoordinatesText").textContent = `${lat}, ${lng}`;
    document.getElementById("markerCoordinatesGroup").classList.remove("hidden");

    if (markerInfo.type === "CEO") {
        document.getElementById("markerModalTitle").textContent = "Editar Caixa de Emenda (CEO)";
        const infoDisplay = document.getElementById("ceoInfoDisplay");
        document.getElementById("ceoStatusInfo").textContent = `Status: ${markerInfo.ceoStatus}`;
        document.getElementById("ceoAccessoryInfo").textContent = `Instalação: ${markerInfo.ceoAccessory}`;
        infoDisplay.classList.remove("hidden");
        document.getElementById("labelColorGroup").classList.remove("hidden");
        document.getElementById("markerLabelColor").value = markerInfo.labelColor || "#000000";
        document.getElementById("ceo144Group").classList.remove("hidden");
        document.getElementById("ceo144Checkbox").checked = markerInfo.is144F || false;
    } else if (markerInfo.type === "CTO") {
        document.getElementById("markerModalTitle").textContent = "Editar CTO";
        const ctoInfoDisplay = document.getElementById("ctoInfoDisplay");
        document.getElementById("ctoStatusInfo").textContent = `Status: ${markerInfo.ctoStatus}`;
        ctoInfoDisplay.classList.remove("hidden");
        document.getElementById("labelColorGroup").classList.remove("hidden");
        document.getElementById("markerLabelColor").value = markerInfo.labelColor || "#000000";
        document.getElementById("ctoPredialGroup").classList.remove("hidden");
        document.getElementById("ctoPredialCheckbox").checked = markerInfo.isPredial || false;
        document.getElementById("ctoStickerGroup").classList.remove("hidden");
        document.getElementById("ctoStickerCheckbox").checked = markerInfo.needsStickers || false;
    } else if (markerInfo.type === "CORDOALHA") {
        document.getElementById("markerModalTitle").textContent = "Editar Cordoalha";
        const infoDisplay = document.getElementById("cordoalhaInfoDisplay");
        document.getElementById("cordoalhaStatusInfo").textContent = `Status: ${markerInfo.cordoalhaStatus}`;
        infoDisplay.classList.remove("hidden");
        document.getElementById("labelColorGroup").classList.remove("hidden");
        document.getElementById("markerLabelColor").value = markerInfo.labelColor || "#000000";
        document.getElementById("derivationTGroup").classList.remove("hidden");
        document.getElementById("markerDerivationT").value = markerInfo.derivationTCount || 0;
    } else if (markerInfo.type === "RESERVA") {
        document.getElementById("markerModalTitle").textContent = "Editar Reserva Técnica";
        const infoDisplay = document.getElementById("reservaInfoDisplay");
        document.getElementById("reservaStatusInfo").textContent = `Status: ${markerInfo.reservaStatus}`;
        document.getElementById("reservaAccessoryInfo").textContent = `Instalação: ${markerInfo.reservaAccessory}`;
        infoDisplay.classList.remove("hidden");
        document.getElementById("labelColorGroup").classList.remove("hidden");
        document.getElementById("markerLabelColor").value = markerInfo.labelColor || "#000000";
    } else {
        document.getElementById("markerModalTitle").textContent = "Editar Marcador";
    }
  }

  const buttonContainer = document.getElementById("modalButtonContainer");
  const fusionButtonExists = document.getElementById("fusionPlanButton");
  if (fusionButtonExists) fusionButtonExists.remove();

  if (markerInfo.type === "CEO" || markerInfo.type === "CTO") {
    const fusionButton = document.createElement("button");
    fusionButton.id = "fusionPlanButton";
    fusionButton.textContent = "Plano de Fusão";
    fusionButton.style.backgroundColor = "#4CAF50";

    fusionButton.addEventListener("click", () => {
      populateFusionPlan(markerInfo);
      document.getElementById("fusionModal").style.display = "flex";
      resetMarkerModal();
    });
    buttonContainer.appendChild(fusionButton);
  }

  document.getElementById("markerModal").style.display = "flex";
}

function updateCablesForMovedMarker(oldPosition, newPosition) {
  savedCables.forEach(cable => {
    let pathUpdated = false;
    
    const newPath = cable.path.map(point => {
      if (point.equals(oldPosition)) {
        pathUpdated = true;
        return newPosition;
      }
      return point;
    });

    if (pathUpdated) {
      cable.path = newPath;
      cable.polyline.setPath(newPath);
    }
  });
}

function deleteEditingMarker() {
  if (!editingMarkerInfo) return;
  const message = `Tem certeza que deseja excluir o marcador "${editingMarkerInfo.name}"?`;
  showConfirm('Excluir Marcador', message, () => {
    editingMarkerInfo.marker.setMap(null);
    editingMarkerInfo.listItem.remove();
    markers = markers.filter((m) => m !== editingMarkerInfo);
    showAlert("Sucesso", "Marcador excluído com sucesso.");
    resetMarkerModal();
  });
}

function resetMarkerModal() {
  const modal = document.getElementById("markerModal");
  modal.style.display = "none";

  if (placeMarkerListener) {
    google.maps.event.removeListener(placeMarkerListener);
    placeMarkerListener = null;
  }

  if (isAddingMarker) {
    isAddingMarker = false;
    setMapCursor("");
  }

  if (editingMarkerInfo) {
    editingMarkerInfo.marker.setDraggable(false);
    editingMarkerInfo = null;
  }

  document.getElementById("markerModalTitle").textContent = "Adicionar Marcador";
  document.getElementById("confirmMarker").textContent = "Confirmar";

  document.getElementById("markerName").value = "";
  document.getElementById("markerColor").value = "#ff0000";
  document.getElementById("markerLabelColor").value = "#ff0000";
  document.getElementById("markerSize").value = 4;
  document.getElementById("markerDescription").value = "";
  document.getElementById("markerNumber").value = "";
  document.getElementById("markerCoordinatesText").textContent = "";
  document.getElementById("markerDerivationT").value = "0";

  document.getElementById("nameGroup").classList.remove("hidden");
  document.querySelector(".compact-inputs-container").classList.remove("hidden");
  document.getElementById("descGroup").classList.remove("hidden");
  document.getElementById("colorGroup").classList.remove("hidden");
  document.getElementById("sizeGroup").classList.remove("hidden");
  
  document.getElementById("houseNumberGroup").classList.add("hidden");
  document.getElementById("labelColorGroup").classList.add("hidden");
  document.getElementById("ceoInfoDisplay").classList.add("hidden");
  document.getElementById("ctoInfoDisplay").classList.add("hidden");
  document.getElementById("cordoalhaInfoDisplay").classList.add("hidden");
  document.getElementById("reservaInfoDisplay").classList.add("hidden");
  document.getElementById("markerCoordinatesGroup").classList.add("hidden");
  document.getElementById("derivationTGroup").classList.add("hidden");

  // ADICIONADO: Resetar os novos campos
  document.getElementById("ctoPredialCheckbox").checked = false;
  document.getElementById("ctoPredialGroup").classList.add("hidden");
  document.getElementById("ctoStickerCheckbox").checked = false;
  document.getElementById("ctoStickerGroup").classList.add("hidden");
  document.getElementById("ceo144Checkbox").checked = false;
  document.getElementById("ceo144Group").classList.add("hidden");

  document.getElementById("deleteMarkerButton").classList.add("hidden");
  document.getElementById("editPositionButton").classList.add("hidden");

  const fusionButton = document.getElementById("fusionPlanButton");
  if (fusionButton) fusionButton.remove();

  selectedMarkerData = {
    type: "",
    name: "",
    color: "#ff0000",
    labelColor: "#000000",
    size: 8,
    description: "",
    ctoStatus: "Nova",
    isPredial: false,
    needsStickers: false,
    ceoStatus: "Nova",
    ceoAccessory: "Raquete",
    is144F: false,
    cordoalhaStatus: "Nova",
    reservaStatus: "Nova",
    reservaAccessory: "Raquete",
    derivationTCount: 0,
  };

  setAllPolygonsClickable(true);
}

// ===================================================================
// == FUNÇÕES PARA CONEXÃO DE FUSÃO
// ===================================================================

/**
 * Gera o atributo 'd' de um SVG <path> para uma polilinha.
 * @param {Array<{x: number, y: number}>} points - Um array de pontos.
 * @returns {string} O valor para o atributo 'd' do caminho.
 */
function generatePolylinePath(points) {
    if (points.length === 0) return "";
    const pathParts = points.map((p, i) => {
        return (i === 0 ? 'M' : 'L') + ` ${p.x} ${p.y}`;
    });
    return pathParts.join(' ');
}

// Reseta o estado do desenho para o inicial
function resetFusionDrawingState() {
    if (fusionDrawingState.tempLine) {
        fusionDrawingState.tempLine.remove();
    }
    fusionDrawingState.tempHandles.forEach(h => h.remove());

    fusionDrawingState.isActive = false;
    fusionDrawingState.startElement = null;
    fusionDrawingState.points = [];
    fusionDrawingState.tempLine = null;
    fusionDrawingState.tempHandles = [];
    
    // Remove o listener de movimento do mouse quando não está desenhando
    document.getElementById('fusionCanvas').removeEventListener('mousemove', handleFusionCanvasMouseMove);
}

// Localize e substitua a função startLineEdit
/**
 * Inicia o modo de edição para uma linha de fusão existente.
 * @param {SVGPathElement} lineElement O elemento <path> da linha a ser editada.
 */
function startLineEdit(lineElement) {
    if (!lineElement || fusionDrawingState.isActive) return;

    const startId = lineElement.dataset.startId;
    const pointsData = lineElement.dataset.points;
    
    const startElement = document.getElementById(startId);
    if (!startElement) {
        showAlert("Erro", "Não foi possível encontrar o ponto de início da conexão para editar.");
        return;
    }

    isEditingLine = true;
    activeLineForAction = lineElement;

    // --- CORREÇÃO PRINCIPAL AQUI ---
    // Removemos a classe 'fusion-line' para que a função isPortConnected não a encontre.
    // Adicionamos uma classe temporária para controle.
    lineElement.classList.remove('fusion-line');
    lineElement.classList.add('fusion-line-editing');
    // Escondemos os pontos de controle (handles) associados.
    document.querySelectorAll(`.line-handle[data-line-id="${lineElement.id}"]`).forEach(h => h.style.display = 'none');
    // --- FIM DA CORREÇÃO ---

    fusionDrawingState.isActive = true;
    fusionDrawingState.startElement = startElement;

    const startPos = getElementCenter(startElement);
    const intermediatePoints = pointsData ? JSON.parse(pointsData) : [];
    fusionDrawingState.points = [startPos, ...intermediatePoints];

    const svgLayer = document.getElementById('fusion-svg-layer');
    fusionDrawingState.tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    fusionDrawingState.tempLine.setAttribute('fill', 'none');
    fusionDrawingState.tempLine.setAttribute('class', 'connecting-line');
    svgLayer.appendChild(fusionDrawingState.tempLine);
    
    document.getElementById('fusionCanvas').addEventListener('mousemove', handleFusionCanvasMouseMove);
    
    showAlert("Modo de Edição", "Clique em uma nova porta para mover a conexão. Clique com o botão direito para cancelar.");
}

// Localize e substitua TODA a sua função handleConnectionClick por esta versão
function handleConnectionClick(event) {
    const target = event.target;
    const isConnectable = target.closest('.connectable');
    const isLine = target.closest('.fusion-line');

    if (isLine && !fusionDrawingState.isActive) {
        activeLineForAction = isLine;
        document.getElementById('lineActionModal').style.display = 'flex';
        return;
    }

    // Estado 1: Início do Desenho
    if (!fusionDrawingState.isActive && isConnectable) {
        if (isPortConnected(isConnectable.id)) {
            showAlert("Porta Ocupada", "Esta porta já possui uma conexão.");
            return;
        }
        
        fusionDrawingState.isActive = true;
        fusionDrawingState.startElement = isConnectable;
        const startPos = getElementCenter(isConnectable);
        fusionDrawingState.points.push(startPos);

        const svgLayer = document.getElementById('fusion-svg-layer');
        fusionDrawingState.tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fusionDrawingState.tempLine.setAttribute('fill', 'none');
        fusionDrawingState.tempLine.setAttribute('class', 'connecting-line');
        svgLayer.appendChild(fusionDrawingState.tempLine);
        
        document.getElementById('fusionCanvas').addEventListener('mousemove', handleFusionCanvasMouseMove);
        return;
    }

    // =================================================================
    // == INÍCIO DA CORREÇÃO CRÍTICA                                  ==
    // =================================================================
    // Estado 2: Final do Desenho (ou da Edição)
    // A condição foi alterada para permitir a conexão no mesmo ponto de partida APENAS SE estiver editando.
    if (fusionDrawingState.isActive && isConnectable && (isConnectable !== fusionDrawingState.startElement || isEditingLine)) {
    // =================================================================
    // == FIM DA CORREÇÃO CRÍTICA                                     ==
    // =================================================================
        
        const portIsOccupied = isEditingLine 
            ? isPortConnected(isConnectable.id, activeLineForAction) 
            : isPortConnected(isConnectable.id);

        if (portIsOccupied) {
            showAlert("Porta Ocupada", "Esta porta já possui uma conexão com outra fibra. A conexão foi cancelada.");
            handleFusionCanvasRightClick(new MouseEvent('contextmenu'));
            return;
        }

        if (isEditingLine && activeLineForAction) {
            const oldLineId = activeLineForAction.id;
            activeLineForAction.remove();
            document.querySelectorAll(`.line-handle[data-line-id="${oldLineId}"]`).forEach(h => h.remove());
            isEditingLine = false;
            activeLineForAction = null;
        }
        
        const endPos = getElementCenter(isConnectable);
        const allPoints = [...fusionDrawingState.points, endPos];
        const finalPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        finalPath.setAttribute('fill', 'none');
        finalPath.setAttribute('class', 'fusion-line');
        finalPath.id = `line-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        finalPath.style.pointerEvents = 'auto';
        finalPath.setAttribute('d', generatePolylinePath(allPoints));
        finalPath.dataset.startId = fusionDrawingState.startElement.id;
        finalPath.dataset.endId = isConnectable.id;
        finalPath.dataset.points = JSON.stringify(fusionDrawingState.points.slice(1));
        const svgLayer = document.getElementById('fusion-svg-layer');
        svgLayer.appendChild(finalPath);
        const materialName = "TUBETE PROTETOR DE EMENDA OPTICA";
        if (activeFolderId) {
            const projectId = document.getElementById(activeFolderId).closest('.folder')?.querySelector('.folder-title').dataset.folderId;
            if(projectId) {
                if (!projectBoms[projectId]) {
                    calculateBomState();
                    projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
                }
                if (!projectBoms[projectId][materialName]) {
                    projectBoms[projectId][materialName] = { quantity: 0, type: 'un', unitPrice: 0.08, category: 'Fusão', removed: false };
                }
                projectBoms[projectId][materialName].quantity += 1;
            }
        }
        const intermediatePoints = fusionDrawingState.points.slice(1);
        intermediatePoints.forEach((point, index) => {
             const handle = createDraggableHandle(point.x, point.y, finalPath, index);
             handle.style.pointerEvents = 'auto';
             svgLayer.appendChild(handle);
        });
        resetFusionDrawingState();
        return;
    }

    // Estado 3: Adicionar Ponto Intermediário
    if (fusionDrawingState.isActive) {
        const canvas = document.getElementById('fusionCanvas');
        const canvasRect = canvas.getBoundingClientRect();
        const newPoint = {
            x: event.clientX - canvasRect.left + canvas.scrollLeft,
            y: event.clientY - canvasRect.top + canvas.scrollTop
        };
        fusionDrawingState.points.push(newPoint);
        const tempHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        tempHandle.setAttribute('class', 'line-handle-temp');
        tempHandle.setAttribute('cx', newPoint.x);
        tempHandle.setAttribute('cy', newPoint.y);
        tempHandle.setAttribute('r', 4);
        document.getElementById('fusion-svg-layer').appendChild(tempHandle);
        fusionDrawingState.tempHandles.push(tempHandle);
    }
}

// Encontre e substitua TODA a sua função endConnection por esta versão:

function endConnection(element) {
    if (element === fusionDrawingState.startElement) {
        handleFusionCanvasRightClick(new MouseEvent('contextmenu'));
        return;
    }

    // --- NOVA VERIFICAÇÃO ADICIONADA AQUI ---
    if (isPortConnected(element.id)) {
        showAlert("Porta Ocupada", "A porta de destino já possui uma conexão. A conexão foi cancelada.");
        handleFusionCanvasRightClick(new MouseEvent('contextmenu'));
        return;
    }
    // --- FIM DA VERIFICAÇÃO ---

    const finalPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    finalPath.setAttribute('class', 'fusion-line');
    finalPath.id = `line-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    finalPath.style.pointerEvents = 'auto';

    const endPos = getElementCenter(element);
    const allPoints = [...fusionDrawingState.points, endPos];
    finalPath.setAttribute('d', generatePolylinePath(allPoints));
    
    finalPath.dataset.startId = fusionDrawingState.startElement.id;
    finalPath.dataset.endId = element.id;
    finalPath.dataset.points = JSON.stringify(fusionDrawingState.points.slice(1));

    const svgLayer = document.getElementById('fusion-svg-layer');
    svgLayer.appendChild(finalPath);
    
    finalPath.addEventListener('mouseover', () => setHandlesVisibility(finalPath.id, true));
    finalPath.addEventListener('mouseout', () => setHandlesVisibility(finalPath.id, false));

    const intermediatePoints = fusionDrawingState.points.slice(1);
    intermediatePoints.forEach((point, index) => {
         const handle = createDraggableHandle(point.x, point.y, finalPath, index);
         handle.style.pointerEvents = 'auto';
         svgLayer.appendChild(handle);
    });

    finalPath.addEventListener('click', (e) => {
      if (e.target.classList.contains('line-handle')) return;
      showConfirm('Excluir Conexão', 'Deseja excluir esta conexão?', () => {
          finalPath.remove();
          document.querySelectorAll(`.line-handle[data-line-id="${finalPath.id}"]`).forEach(h => h.remove());
      });
    });

    resetFusionDrawingState();
}

// Atualiza a linha de pré-visualização para seguir o mouse
function handleFusionCanvasMouseMove(event) {
    if (!fusionDrawingState.isActive) return;

    const canvas = document.getElementById('fusionCanvas');
    const canvasRect = canvas.getBoundingClientRect();
    const mousePos = {
        x: event.clientX - canvasRect.left + canvas.scrollLeft,
        y: event.clientY - canvasRect.top + canvas.scrollTop
    };
    
    // Desenha o caminho com todos os pontos + a posição atual do mouse
    fusionDrawingState.tempLine.setAttribute('d', generatePolylinePath([...fusionDrawingState.points, mousePos]));
}

function handleFusionCanvasRightClick(event) {
    event.preventDefault(); 
    if (fusionDrawingState.isActive) {
        if (isEditingLine && activeLineForAction) {
            activeLineForAction.classList.add('fusion-line');
            activeLineForAction.classList.remove('fusion-line-editing');
            document.querySelectorAll(`.line-handle[data-line-id="${activeLineForAction.id}"]`).forEach(h => h.style.display = 'block');

            isEditingLine = false;
            activeLineForAction = null;
        }
        resetFusionDrawingState();
    }
}

/**
 * Cria um ponto de controle (círculo) arrastável para uma linha.
 * @param {number} cx - Coordenada X do centro do círculo.
 * @param {number} cy - Coordenada Y do centro do círculo.
 * @param {SVGPathElement} linePath - O elemento <path> da linha ao qual o ponto pertence.
 * @param {number} index - O índice deste ponto no array de pontos intermediários da linha.
 * @returns {SVGCircleElement} O elemento <circle> do ponto de controle.
 */
function createDraggableHandle(cx, cy, linePath, index) {
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    handle.setAttribute('class', 'line-handle');
    handle.setAttribute('cx', cx);
    handle.setAttribute('cy', cy);
    handle.setAttribute('r', 6);
    
    // --- CORREÇÃO PRINCIPAL AQUI ---
    // Adiciona o ID da linha e o índice do ponto aos dados do próprio handle.
    // Isso é crucial para que a função de arrastar saiba qual ponto está sendo movido.
    if (linePath.id) {
        handle.dataset.lineId = linePath.id;
    }
    handle.dataset.pointIndex = index;

    handle.addEventListener('mousedown', (e) => onHandleMouseDown(e, handle, linePath));
    return handle;
}

// Localize e substitua TODA a sua função getElementCenter por esta versão
/**
 * Calcula o ponto de conexão na borda da porta/fibra, com base na posição
 * do componente (esquerda/direita) dentro do canvas de fusão.
 * @param {HTMLElement} element O elemento conectável (a porta ou a fibra).
 * @returns {{x: number, y: number}} As coordenadas x e y para o ponto de conexão.
 */
function getElementCenter(element) {
    const parentComponent = element.closest('.splitter-element, .cable-element');
    const canvas = document.getElementById('fusionCanvas');

    if (!parentComponent || !canvas) {
        // Fallback de segurança.
        console.error("Componente pai ou canvas não encontrado para o elemento:", element);
        const rect = element.getBoundingClientRect();
        const canvasRect = element.closest('.fusion-canvas').getBoundingClientRect();
        return {
            x: rect.left - canvasRect.left + rect.width / 2,
            y: rect.top - canvasRect.top + rect.height / 2
        };
    }

    // A coordenada Y (vertical) é sempre o centro do elemento clicado (a linha/row). Isso está correto.
    const y = parentComponent.offsetTop + element.offsetTop + (element.offsetHeight / 2);

    let x;
    const canvasMidpoint = canvas.offsetWidth / 2;
    const isComponentOnLeft = parentComponent.offsetLeft < canvasMidpoint;

    // A lógica agora se divide para tratar cabos e splitters de forma específica.
    if (parentComponent.classList.contains('cable-element')) {
        // NOVO: Se for um cabo, encontramos o polígono colorido DENTRO da linha clicada.
        const colorShape = element.querySelector('.fiber-color-shape');
        
        if (colorShape) {
            // Calcula a posição exata das bordas do polígono colorido.
            const shapeLeftEdge = parentComponent.offsetLeft + element.offsetLeft + colorShape.offsetLeft;
            const shapeRightEdge = shapeLeftEdge + colorShape.offsetWidth;
            
            x = isComponentOnLeft ? shapeRightEdge : shapeLeftEdge;
        } else {
            // Fallback: se não encontrar o polígono, usa a borda da linha inteira.
            const portLeftEdge = parentComponent.offsetLeft + element.offsetLeft;
            const portRightEdge = portLeftEdge + element.offsetWidth;
            x = isComponentOnLeft ? portRightEdge : portLeftEdge;
        }

    } else { // Se for um splitter, a lógica anterior já estava correta.
        const portLeftEdge = parentComponent.offsetLeft + element.offsetLeft;
        const portRightEdge = portLeftEdge + element.offsetWidth;
        
        x = isComponentOnLeft ? portRightEdge : portLeftEdge;
    }

    return { x, y };
}

// Modifica a função updateAllConnections para suportar as novas linhas
function updateAllConnections() {
    const svgLayer = document.getElementById('fusion-svg-layer');
    if (!svgLayer) return;
    const lines = svgLayer.querySelectorAll('.fusion-line');

    lines.forEach(line => {
        const startEl = document.getElementById(line.dataset.startId);
        const endEl = document.getElementById(line.dataset.endId);
        const intermediatePoints = JSON.parse(line.dataset.points);

        if (startEl && endEl) {
            const startPos = getElementCenter(startEl);
            const endPos = getElementCenter(endEl);
            const allPoints = [startPos, ...intermediatePoints, endPos];
            line.setAttribute('d', generatePolylinePath(allPoints));

            // Atualiza também a posição dos pontos de controle
            const handles = svgLayer.querySelectorAll(`.line-handle[data-line-id="${line.id}"]`);
            handles.forEach((handle, index) => {
                const point = intermediatePoints[index];
                if (point) {
                    handle.setAttribute('cx', point.x);
                    handle.setAttribute('cy', point.y);
                }
            });
        }
    });
}

// ===================================================================
// == FUNÇÕES DE PASTA (VISIBILIDADE E EDIÇÃO)
// ===================================================================

function openFolderEditor(titleElement) {
  editingFolderElement = titleElement; // Define o elemento que está sendo editado
  const isProject = titleElement.dataset.isProject === 'true';

  if (isProject) {
    // É um projeto, abre o modal de projeto
    const projectModal = document.getElementById('projectModal');
    
    // Preenche todos os campos com os dados armazenados
    document.getElementById('projectName').value = titleElement.dataset.folderName;
    document.getElementById('projectCity').value = titleElement.dataset.folderCity;
    document.getElementById('projectNeighborhood').value = titleElement.dataset.folderNeighborhood;
    document.getElementById('projectType').value = titleElement.dataset.folderType;

    // Garante que os campos estejam visíveis
    document.getElementById('projectCity').closest('div').style.display = 'block';
    document.getElementById('projectNeighborhood').closest('div').style.display = 'block';
    document.getElementById('projectType').closest('div').style.display = 'block';

    // Altera textos para o modo de edição
    projectModal.querySelector('h2').textContent = 'Editar Projeto';
    projectModal.querySelector('#confirmProjectButton').textContent = 'Salvar Alterações';
    projectModal.style.display = 'flex';
  } else {
    // É uma pasta, abre o modal de pasta
    const folderModal = document.getElementById('folderModal');
    // Preenche o campo com o nome atual
    document.getElementById('folderNameInput').value = titleElement.dataset.folderName;
    
    // Altera textos para o modo de edição
    folderModal.querySelector('h2').textContent = 'Editar Pasta';
    folderModal.querySelector('#confirmFolderButton').textContent = 'Salvar Alterações';
    folderModal.style.display = 'flex';
  }
}

function getAllDescendantFolderIds(startFolderId) {
    const startElement = document.getElementById(startFolderId);
    if (!startElement) return [];
    // Encontra todos os elementos <ul> dentro do elemento inicial
    const descendantUls = startElement.querySelectorAll('ul');
    return [startFolderId, ...Array.from(descendantUls).map(ul => ul.id)];
}

function handleVisibilityToggle(button) {
    const folderId = button.dataset.folderId;
    const isCurrentlyVisible = button.dataset.visible === 'true';
    const newVisibility = !isCurrentlyVisible;

    const folderIdsToToggle = getAllDescendantFolderIds(folderId);

    // Oculta/exibe os MARCADORES
    markers.forEach(markerInfo => {
        if (folderIdsToToggle.includes(markerInfo.folderId)) {
            markerInfo.marker.setVisible(newVisibility);
        }
    });

    // Oculta/exibe os CABOS
    savedCables.forEach(cable => {
        if (folderIdsToToggle.includes(cable.folderId)) {
            cable.polyline.setVisible(newVisibility);
        }
    });
    // Oculta/exibe os POLÍGONOS
    savedPolygons.forEach(polygon => {
        if (folderIdsToToggle.includes(polygon.folderId)) {
            polygon.polygonObject.setVisible(newVisibility);
        }
    });
    // --- FIM DA CORREÇÃO ---

    // Atualiza o estado e o ícone do botão
    button.dataset.visible = newVisibility;
    const iconSrc = newVisibility ? 'img/Mostrar.png' : 'img/Ocultar.png';
    button.innerHTML = `<img src="${iconSrc}" width="16" height="16" alt="Visibilidade">`;
    button.title = newVisibility ? 'Ocultar itens no mapa' : 'Exibir itens no mapa';
}

const MATERIAL_PRICES = {
  // --- KITS / ITENS COMPOSTOS ---
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

  // --- MATERIAIS INDIVIDUAIS ---
  "CAIXA DE ATENDIMENTO": { price: 92.29, unit: 'un', category: 'Fusão' },
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
  "ABRAÇADEIRA DE NYLON": { price: 0.22, unit: 'un', category: 'Ferragem' },
  "ANEL GUIA": { price: 0.75, unit: 'un', category: 'Ferragem' },
  "FECHO DENTADO PARA FITA DE AÇO INOX 3/4": { price: 0.44, unit: 'un', category: 'Ferragem' },
  "FITA DE AÇO INOX 3/4'' (FITA FUSIMEC) ROLO DE 25M": { price: 51.80, unit: 'un', category: 'Ferragem' },
  
  // Itens de Ferragem para cabos
  "PLAQUETA DE IDENTIFICAÇÃO": { price: 1.17, unit: 'un', category: 'Ferragem' },
  "SUPORTE DIELETRICO DUPLO": { price: 9.00, unit: 'un', category: 'Ferragem' },
  "PARAFUSO M12X35 - SEM PORCA": { price: 0.65, unit: 'un', category: 'Ferragem' },
  "SUPORTE REFORÇADO HORIZONTAL PARA BAP": { price: 2.50, unit: 'un', category: 'Ferragem' },
  "SUPORTE ANCORAGEM PARA CABOS OPTICOS (SUPAS)": { price: 9.51, unit: 'un', category: 'Ferragem' },
  "ALÇA PREFORMADA OPDE 1008 - 6,8mm a 7,4mm": { price: 2.29, unit: 'un', category: 'Ferragem' },
  "ALÇA PREFORMADA OPDE 1020 - 9,0mm a 9,8mm": { price: 5.91, unit: 'un', category: 'Ferragem' },
  "ALÇA PREFORMADA OPDE 1021 - 9,6mm a 10,4mm": { price: 8.40, unit: 'un', category: 'Ferragem' },
  "ABRAÇADEIRA BAP 3": { price: 16.08, unit: 'un', category: 'Ferragem' },

  // Itens da CEO
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

  "RESERVA": { price: 0, unit: 'un', category: 'Ferragem' },
  "CASA": { price: 0.00, unit: 'un', category: 'Atendimento' },
  
  // Data Center (Geral e Kits)
  "PLACA": { price: 0, unit: 'un', category: 'Data Center'},
  "CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2m": { price: 6.90, unit: 'un', category: 'Data Center'},
  "CHASSI OLT C650 ZTE": { price: 2598.40, unit: 'un', category: 'Data Center'},
  "LICENÇA OLT": { price: 5043.00, unit: 'un', category: 'Data Center'},
  "MÓDULO DE ENERGIA DC C650-C600 PARA OLT ZTE": { price: 659.43, unit: 'un', category: 'Data Center'},
  "PLACA CONTROLADORA E SWITCHING C600/C650": { price: 6056.20, unit: 'un', category: 'Data Center'},
  "SFP 1270NM TX/1330NM RX 20KM, 10G, BIDI": { price: 140, unit: 'un', category: 'Data Center' },
  "SFP 1330NM TX/1270NM RX 20KM, 10G, BIDI": { price: 140, unit: 'un', category: 'Data Center' },
  "XFP 850NM 10G 0,3KM MULTIMODO DUPLEX": { price: 249, unit: 'un', category: 'Data Center' },
  
  // Materiais POP (agora todos Data Center)
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

  // Cabos // MODIFICADO PARA INCLUIR AS 80 E AS 200
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

  // Mão de obra
  "Mão de Obra Regional": { price: 320.00, unit: 'un', category: 'Mão de Obra' }, // Custo por técnico/dia (8h * R$40/h)
  "Mão de Obra Terceirizada": { price: 0, unit: 'un', category: 'Mão de Obra' }
};

const POP_KIT_CONFIG = {
  variable: [
    'PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)',
    'MÓDULO SFP C+ PARA PLACA OLT LINE ANYPON ZTE',
    'CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2M'
  ],
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

// Função para renderizar a tabela a partir do bomState
// EM script.js:
// Localize e substitua TODA a sua função renderBomTable por esta versão CORRIGIDA

// Função para renderizar a tabela a partir do bomState
function renderBomTable() {
    const ferragemBody = document.getElementById('ferragem-list-body');
    const cabosBody = document.getElementById('cabos-list-body');
    const fusaoBody = document.getElementById('fusao-list-body');
    const datacenterBody = document.getElementById('datacenter-list-body');
    
    ferragemBody.innerHTML = '';
    cabosBody.innerHTML = '';
    fusaoBody.innerHTML = '';
    datacenterBody.innerHTML = '';

    for (const materialName in bomState) {
        const material = bomState[materialName];
        if (material.removed || material.category === 'Mão de Obra') continue; // Ignora mão de obra

        // --- INÍCIO DA MODIFICAÇÃO CORRIGIDA ---
        let displayName = materialName;
        
        // Verifica se a CATEGORIA do material é 'Fusão'
        if (material.category === 'Fusão') {
            displayName = materialName.toUpperCase(); // Se sim, converte para MAIÚSCULAS
        }
        // --- FIM DA MODIFICAÇÃO CORRIGIDA ---

        const row = document.createElement('tr');
        const unit = material.type === 'length' || material.type === 'm' ? 'm' : 'un';
        
        const formattedQuantity = Number.isInteger(material.quantity) 
          ? `${material.quantity} ${unit}`
          : `${parseFloat(material.quantity).toFixed(2)} ${unit}`;
        
        const formattedUnitPrice = `R$ ${material.unitPrice.toFixed(2).replace('.', ',')}`;
        const formattedTotalPrice = `R$ ${(material.quantity * material.unitPrice).toFixed(2).replace('.', ',')}`;

        row.innerHTML = `
          <td>${displayName}</td> <td>${material.category}</td>
          <td>${formattedQuantity}</td>
          <td style="text-align: center;">
            <button class="edit-qty-btn" data-material-name="${materialName}" title="Editar Quantidade" style="cursor: pointer; border: none; background: none; font-size: 16px;">✏️</button>
            <button class="remove-item-btn" data-material-name="${materialName}" title="Remover Item" style="cursor: pointer; border: none; background: none; font-size: 16px;">🗑️</button>
          </td>
          <td>${formattedUnitPrice}</td>
          <td>${formattedTotalPrice}</td>
        `;

        if (material.category === 'Ferragem') {
            ferragemBody.appendChild(row);
        } else if (material.category === 'Lançamento') {
            cabosBody.appendChild(row);
        } else if (material.category === 'Fusão') {
            fusaoBody.appendChild(row);
        } else if (material.category === 'Data Center') {
            datacenterBody.appendChild(row);
        } else { // Categoria Padrão
            ferragemBody.appendChild(row);
        }
    }
  
  document.querySelectorAll('.edit-qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
          const materialName = btn.dataset.materialName;
          openMaterialEditor(materialName);
      });
  });
  document.querySelectorAll('.remove-item-btn').forEach(btn => btn.addEventListener('click', () => handleRemoveItem(btn)));

  recalculateGrandTotal();
}

/**
 * Lê os dados das tabelas de materiais, seleciona colunas específicas e exporta para um arquivo Excel (.xlsx).
 */
function exportTablesToExcel() {
    // Encontra o nome do projeto a partir do título do modal
    const projectTitle = document.getElementById('materialModalTitle').textContent.replace('Lista de Materiais: ', '').trim();
    const fileName = `Lista_de_Materiais_${projectTitle.replace(/[^a-z0-9]/gi, '_')}.xlsx`;

    // Cria uma nova "pasta de trabalho" (o arquivo Excel)
    const wb = XLSX.utils.book_new();

    // Cabeçalhos que queremos no nosso arquivo Excel
    const headers = ["Item", "Tipo", "Quantidade", "Preço Unitário (R$)", "Preço Total (R$)"];

    // Array com os IDs das tabelas e os nomes que elas terão nas abas da planilha
    const tablesToExport = [
        { id: 'ferragem-table', name: 'Ferragens' },
        { id: 'cabos-table', name: 'Cabos' },
        { id: 'fusao-table', name: 'Fusao' },
        { id: 'datacenter-table', name: 'Data Center' }
    ];

    tablesToExport.forEach(tableInfo => {
        const table = document.getElementById(tableInfo.id);
        if (table) {
            // 1. Inicia o array de dados com os cabeçalhos
            const data = [headers];

            // 2. Itera sobre as linhas do corpo da tabela (tbody)
            const rows = table.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                // Pega o conteúdo apenas das colunas desejadas, ignorando "Ações"
                const rowData = [
                    cells[0].textContent, // Item
                    cells[1].textContent, // Tipo
                    cells[2].textContent, // Quantidade
                    cells[4].textContent, // Preço Unitário
                    cells[5].textContent  // Preço Total
                ];
                data.push(rowData);
            });

            // 3. Adiciona a linha de subtotal
            const footer = table.querySelector('tfoot tr');
            if (footer) {
                const footerCells = footer.querySelectorAll('td');
                const subtotalLabel = footerCells[0].textContent;
                const subtotalValue = footerCells[1].textContent;
                data.push(['', '', '', subtotalLabel, subtotalValue]); // Adiciona a linha de subtotal formatada
            }

            // 4. Converte o array de dados para uma planilha
            const ws = XLSX.utils.aoa_to_sheet(data);
            
            // Adiciona a planilha (ws) à pasta de trabalho (wb) com o nome desejado
            XLSX.utils.book_append_sheet(wb, ws, tableInfo.name);
        }
    });

    // Gera o arquivo Excel e inicia o download
    XLSX.writeFile(wb, fileName);
}

function calculateHardwareForCable(cableLength, alcaPreformadaName) {
  const hardware = {};
  
  const totalPostes = Math.ceil(cableLength / 35);
  if (totalPostes <= 0) return hardware;

  const qtdSuporteDieletrico = Math.ceil(totalPostes * 0.25);
  const qtdSupa = Math.ceil(totalPostes * 0.75);
  const qtdAlcaPreformada = qtdSupa * 2;

  hardware["PLAQUETA DE IDENTIFICAÇÃO"] = totalPostes;
  hardware["ABRAÇADEIRA BAP 3"] = totalPostes;
  hardware["SUPORTE DIELETRICO DUPLO"] = qtdSuporteDieletrico;
  hardware["PARAFUSO M12X35 - SEM PORCA"] = qtdSuporteDieletrico;
  hardware["SUPORTE REFORÇADO HORIZONTAL PARA BAP"] = qtdSuporteDieletrico;
  hardware["SUPORTE ANCORAGEM PARA CABOS OPTICOS (SUPAS)"] = qtdSupa;
  hardware[alcaPreformadaName] = qtdAlcaPreformada;
  
  return hardware;
}


// EM script.js:
// Localize e substitua TODA a sua função calculateBomState por esta versão corrigida

function calculateBomState() {
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

  // Preserva os itens de Data Center antes de recalcular
  const preservedDatacenterItems = {};
  const currentProjectBom = projectBoms[projectId] || {};
  for (const materialName in currentProjectBom) {
      if (currentProjectBom[materialName].category === 'Data Center') {
          preservedDatacenterItems[materialName] = currentProjectBom[materialName];
      }
  }

  bomState = {}; // Reseta o estado para um novo cálculo

  const folderIdsToInclude = getAllDescendantFolderIds(projectId);
  const projectMarkers = markers.filter(m => folderIdsToInclude.includes(m.folderId));
  const projectCables = savedCables.filter(c => folderIdsToInclude.includes(c.folderId));

  let ctoCount = 0;
  let raqueteInstallCount = 0; // Contador para instalações com raquete
  
  const addOrUpdateMaterial = (name, quantity, type = 'unit') => {
    if (!name || quantity <= 0) return;
    const priceInfo = MATERIAL_PRICES[name] || { price: 0, category: 'Outros' };
    if (!bomState[name]) {
      bomState[name] = { 
        quantity: 0, 
        type: priceInfo.unit || type, 
        unitPrice: priceInfo.price, 
        category: priceInfo.category 
      };
    }
    bomState[name].quantity += quantity;
  };

  // Etapa 1: Processa os marcadores do mapa (esta parte estava correta)
  projectMarkers.forEach(markerInfo => {
    if (markerInfo.isImported) return;
    const type = markerInfo.type;
    if (type === 'CASA' || (markerInfo.ceoStatus === 'Existente') || (markerInfo.ctoStatus === 'Existente') || (markerInfo.cordoalhaStatus === 'Existente') || (markerInfo.reservaStatus === 'Existente')) return;
    
    if (type === 'CTO') {
        if (markerInfo.isPredial) {
            addOrUpdateMaterial("CAIXA DE ATENDIMENTO PREDIAL", 1);
            addOrUpdateMaterial("ABRAÇADEIRA DE NYLON", 4);
        } else {
            ctoCount++;
            const priceInfo = MATERIAL_PRICES['CTO'];
            if (priceInfo && priceInfo.components) {
                priceInfo.components.forEach(c => addOrUpdateMaterial(c.name, c.quantity));
            }
        }
        return; 
    }
    if (type === 'CEO') {
        if (markerInfo.is144F) {
            addOrUpdateMaterial("CAIXA DE EMENDA OPTICA (CEO) 144 FUSÕES", 1);
        } else {
            addOrUpdateMaterial("CAIXA DE EMENDA ÓPTICA (CEO)", 1);
        }
        if (markerInfo.ceoAccessory === "Raquete") {
            raqueteInstallCount++; // Apenas incrementa o contador
            addOrUpdateMaterial("PRENSA DE ESPINAR", 2);
            addOrUpdateMaterial("RAQUETE PARA CEO", 2);
            addOrUpdateMaterial("TAP BRACKET", 4);
            addOrUpdateMaterial("CABO DE AÇO CORDOALHA 3/16 POL", 50, 'length');
            addOrUpdateMaterial("ALÇA PREFORMADA PARA CORDOALHA 3/16 POL", 2);
            addOrUpdateMaterial("FITA DE AMARRAÇÃO INOX 16 POL", 10);
            addOrUpdateMaterial("SUPORTE PRESBOW (REX)", 2);
            addOrUpdateMaterial("ISOLADOR ROLDANA", 2);
        } else if (markerInfo.ceoAccessory === "Suporte") {
            addOrUpdateMaterial("SUPORTE PARA CEO", 1);
            addOrUpdateMaterial("ABRAÇADEIRA DE NYLON", 4);
            addOrUpdateMaterial("ABRAÇADEIRA BAP 3", 2);
        }
        return; 
    }
    if (type === 'RESERVA') {
        if (markerInfo.reservaAccessory === "Raquete") {
            raqueteInstallCount++; // Apenas incrementa o contador
            addOrUpdateMaterial("PRENSA DE ESPINAR", 2);
            addOrUpdateMaterial("RAQUETE PARA CEO", 2);
            addOrUpdateMaterial("TAP BRACKET", 4);
            addOrUpdateMaterial("CABO DE AÇO CORDOALHA 3/16 POL", 50, 'length');
            addOrUpdateMaterial("ALÇA PREFORMADA PARA CORDOALHA 3/16 POL", 2);
            addOrUpdateMaterial("FITA DE AMARRAÇÃO INOX 16 POL", 10);
            addOrUpdateMaterial("SUPORTE PRESBOW (REX)", 2);
            addOrUpdateMaterial("ISOLADOR ROLDANA", 2);
        } else if (markerInfo.reservaAccessory === "Suporte") {
            addOrUpdateMaterial("SUPORTE PARA CEO", 1);
            addOrUpdateMaterial("ABRAÇADEIRA DE NYLON", 4);
            addOrUpdateMaterial("ABRAÇADEIRA BAP 3", 2);
        }
        return;
    }
    if (type === 'CORDOALHA') {
        addOrUpdateMaterial("SUPORTE PRESBOW (REX)", 4);
        addOrUpdateMaterial("ISOLADOR ROLDANA", 4);
        addOrUpdateMaterial("ALÇA PREFORMADA PARA CORDOALHA 3/16 POL", 4);
        addOrUpdateMaterial("CABO DE AÇO CORDOALHA 3/16 POL", 50, 'length');
        if (markerInfo.derivationTCount && markerInfo.derivationTCount > 0) {
            addOrUpdateMaterial("DERIVAÇÃO EM T", markerInfo.derivationTCount);
        }
        return;
    }
    const priceInfo = MATERIAL_PRICES[type];
    if (priceInfo && priceInfo.components) {
      priceInfo.components.forEach(c => addOrUpdateMaterial(c.name, c.quantity));
    } else if (type) {
      addOrUpdateMaterial(type, 1);
    }
  });

  // Cálculo de Arame de Espinar
  if (raqueteInstallCount > 0) {
      const totalArameNeeded = raqueteInstallCount * 50;
      const arameRolls = Math.ceil(totalArameNeeded / 105);
      addOrUpdateMaterial("ARAME DE ESPIMAR (105 m)", arameRolls);
  }

  if (ctoCount > 0) {
    const fitaName = "FITA DE AÇO INOX 3/4'' (FITA FUSIMEC) ROLO DE 25M";
    addOrUpdateMaterial(fitaName, Math.ceil((3 * ctoCount) / 25));
  }
  
  // =========================================================================
  // == INÍCIO DA CORREÇÃO
  // =========================================================================
  // Etapa 2: Itera sobre os marcadores para re-contar itens dos planos de fusão
  projectMarkers.forEach(markerInfo => {
      if ((markerInfo.type === 'CTO' || markerInfo.type === 'CEO') && markerInfo.fusionPlan) {
          try {
              const planData = JSON.parse(markerInfo.fusionPlan);
              
              // CORREÇÃO 1: Verifica 'planData.elements' em vez de 'planData.canvas'
              if (planData.elements) {
                  const tempDiv = document.createElement('div');
                  // CORREÇÃO 2: Lê o HTML de 'planData.elements'
                  tempDiv.innerHTML = planData.elements;
                  
                  // Re-contabiliza os Splitters e Adaptadores (Passantes)
                  const splittersInPlan = tempDiv.querySelectorAll('.splitter-element');
                  splittersInPlan.forEach(splitterEl => {
                      if (splitterEl.dataset.status === 'Novo') {
                          const label = splitterEl.querySelector('.splitter-body span')?.textContent.trim();
                          if (label) {
                              const splitterMaterialName = `Splitter ${label.replace(':', '/')}`;
                              addOrUpdateMaterial(splitterMaterialName, 1);

                              if (splitterEl.classList.contains('splitter-atendimento')) {
                                  const isPredial = markerInfo.isPredial || false;
                                  const connector = label.includes('APC') ? 'APC' : 'UPC';
                                  const ratioMatch = label.match(/1:(\d+)/);
                                  const outputCount = ratioMatch ? parseInt(ratioMatch[1], 10) : 0;

                                  if (outputCount > 0) {
                                      let adapterMaterialName = isPredial
                                          ? `ADAPTADOR SC/${connector} SEM ABAS (PASSANTE)`
                                          : `ADAPTADOR SC/${connector} COM ABAS (PASSANTE)`;
                                      addOrUpdateMaterial(adapterMaterialName, outputCount);
                                  }
                              }
                          }
                      }
                  });

                  // Re-contabiliza os Kits de Derivação (em CEOs)
                  if (markerInfo.type === 'CEO') {
                      const outgoingCables = tempDiv.querySelectorAll('.cable-element.cable-saida');
                      outgoingCables.forEach(cableEl => {
                          const checkbox = cableEl.querySelector('.derivation-kit-checkbox');
                          if (checkbox && (checkbox.dataset.checked === 'true' || checkbox.checked)) {
                              addOrUpdateMaterial("KIT DERIVAÇÃO PARA CAIXA DE EMENDA OPTICA", 1);
                          }
                      });
                  }
              }

              // Re-contabiliza os Kits de Bandeja (em CEOs)
              if (markerInfo.type === 'CEO' && planData.trayQuantity) {
                  const trayQuantity = parseInt(planData.trayQuantity, 10);
                  if (trayQuantity > 0) {
                      addOrUpdateMaterial("KIT DE BANDEJA PARA CAIXA DE EMENDA", trayQuantity);
                  }
              }

              // CORREÇÃO 3: Re-contabiliza os Tubetes (linhas de fusão) lendo 'planData.svg'
              if (planData.svg) {
                  const svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                  svgContainer.innerHTML = planData.svg;
                  const fusionLinesCount = svgContainer.querySelectorAll('.fusion-line').length;
                  if (fusionLinesCount > 0) {
                      addOrUpdateMaterial("TUBETE PROTETOR DE EMENDA OPTICA", fusionLinesCount);
                  }
              }

          } catch (e) {
              console.error(`Erro ao analisar o plano de fusão para o marcador "${markerInfo.name}":`, e);
          }
      }
  });
  // =========================================================================
  // == FIM DA CORREÇÃO
  // =========================================================================

  // Etapa 3: Processa os cabos e suas ferragens
  projectCables.forEach(cable => {
      if (cable.status === 'Existente' || cable.isImported) return;
      addOrUpdateMaterial(cable.type, cable.totalLength, 'length');
  });
  
  // Etapa 4: Adiciona a Fita Isolante, se necessário
  const tapeName = "FITA ISOLANTE";
  if (bomState["TUBETE PROTETOR DE EMENDA OPTICA"] || bomState["KIT DERIVAÇÃO PARA CAIXA DE EMENDA OPTICA"]) {
      if (!bomState[tapeName]) {
          addOrUpdateMaterial(tapeName, 1);
      }
  }


  // Etapa 5: Calcula as ferragens dos cabos
  const cableHardwareMap = {
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
    "Cabo AS 200 FO-48": "ALÇA PREFORMADA OPDE 1021 - 9,0mm a 9,8mm", 
    "Cabo AS 200 FO-72": "ALÇA PREFORMADA OPDE 1007- 9,6mm a 10,4mm", 
    "Cabo AS 200 FO-144": "ALÇA PREFORMADA OPDE 1007 - 12,8MM A 14,2MM" 
  };

  const aggregatedCableLengths = {}; // Agrega pelo nome completo do cabo
  for (const name in bomState) {
      if (bomState[name].category === 'Lançamento') {
          if (!aggregatedCableLengths[name]) aggregatedCableLengths[name] = 0;
          aggregatedCableLengths[name] += bomState[name].quantity;
      }
  }

  Object.keys(aggregatedCableLengths).forEach(cableName => {
      const totalLength = aggregatedCableLengths[cableName];
      if (totalLength > 0 && cableHardwareMap[cableName]) { 
          const alcaName = cableHardwareMap[cableName];
          const hardwareItems = calculateHardwareForCable(totalLength, alcaName);
          for (const itemName in hardwareItems) {
              addOrUpdateMaterial(itemName, hardwareItems[itemName]);
          }
      }
  });

  // 6. Restaura os itens de Data Center que foram preservados
  for (const materialName in preservedDatacenterItems) {
      if (!bomState[materialName]) {
          bomState[materialName] = preservedDatacenterItems[materialName];
      }
  }
}

function handleRemoveItem(button) {
  const name = button.dataset.materialName;
  showConfirm('Remover Item', `Tem certeza que deseja remover "${name}" da lista?`, () => {
    bomState[name].removed = true; // Marca como removido em vez de deletar
    // Para remover permanentemente, use: delete bomState[name];
    renderBomTable();
  });
}

function handleAddNewMaterial() {
  const name = document.getElementById('materialNameInput').value.trim();
  const quantity = parseFloat(document.getElementById('materialQtyInput').value);
  const category = document.getElementById('materialCategoryInput').value;
  const unitPrice = parseFloat(document.getElementById('materialPriceInput').value);

  if (!name || isNaN(quantity) || isNaN(unitPrice)) {
    showAlert("Erro", "Por favor, preencha todos os campos corretamente.");
    return;
  }

  bomState[name] = { quantity, type: 'un', unitPrice, category, removed: false };
  renderBomTable();
  document.getElementById('addMaterialModal').style.display = 'none';
}

/**
 * Abre o modal de edição para um item da lista de materiais.
 * @param {string} materialName - O nome original do material a ser editado.
 */
function openMaterialEditor(materialName) {
  const materialData = bomState[materialName];
  if (!materialData) {
    showAlert('Erro', 'Não foi possível encontrar o material para edição.');
    return;
  }

  // Armazena o nome original para o caso de ser alterado
  document.getElementById('originalMaterialName').value = materialName;

  // Preenche o modal com os dados atuais
  document.getElementById('editMaterialName').value = materialName;
  document.getElementById('editMaterialQty').value = materialData.quantity;
  document.getElementById('editMaterialUnit').value = materialData.type;
  document.getElementById('editMaterialPrice').value = materialData.unitPrice;

  // Exibe o modal
  document.getElementById('editMaterialModal').style.display = 'flex';
}

/**
 * Salva as alterações feitas em um item da lista de materiais.
 */
function handleUpdateMaterial() {
  const originalName = document.getElementById('originalMaterialName').value;
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

  const originalCategory = bomState[originalName]?.category || 'Outros';

  // Se o nome foi alterado, remove o antigo e cria um novo
  if (originalName !== newName) {
    if (bomState[newName]) {
        showAlert('Erro', 'Já existe um material com este novo nome. Por favor, escolha outro nome.');
        return;
    }
    delete bomState[originalName];
  }

  // Atualiza ou cria o item no estado da BOM
  bomState[newName] = {
    quantity: newQty,
    type: newUnit,
    unitPrice: newPrice,
    category: originalCategory, // Mantém a categoria original
    removed: false
  };

  document.getElementById('editMaterialModal').style.display = 'none';
  renderBomTable();
}

// ===================================================================
// == NOVAS FUNÇÕES DE MÃO DE OBRA
// ===================================================================

function getProjectQuantities() {
    // ---> INÍCIO DA CORREÇÃO <---

    // 1. Verifica se há um projeto ativo. Sem isso, a função pegava todos os cabos.
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione um projeto para calcular a mão de obra.");
        return { cableLength: 0, cordoalhaLength: 0, ctoCount: 0, ceoCount: 0, reservaCount: 0 };
    }

    // 2. Encontra o ID do projeto raiz a partir do item ativo na barra lateral.
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) {
        console.error("Não foi possível encontrar o projeto raiz para o cálculo da mão de obra.");
        return { cableLength: 0, cordoalhaLength: 0, ctoCount: 0, ceoCount: 0, reservaCount: 0 };
    }
    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;

    // 3. Pega APENAS os marcadores e cabos que pertencem ao projeto ativo.
    const { markers: projectMarkers, cables: projectCables } = getProjectItems(projectId);

    let totalLength = 0;
    let cordoalhaLength = 0;
    let ctoCount = 0;
    let ceoCount = 0;
    let reservaCount = 0;

    // 4. Itera sobre a lista FILTRADA de cabos e usa o comprimento total correto.
    projectCables.forEach(cable => {
        if (cable.status !== 'Existente') {
            // Usa o 'totalLength' que já inclui lançamento + reserva, garantindo consistência.
            totalLength += cable.totalLength;
        }
    });

    // 5. Itera sobre a lista FILTRADA de marcadores.
    projectMarkers.forEach(marker => {
        if (marker.type === 'CTO' && marker.ctoStatus !== 'Existente') ctoCount++;
        if (marker.type === 'CEO' && marker.ceoStatus !== 'Existente') ceoCount++;
        if (marker.type === 'RESERVA' && marker.reservaStatus !== 'Existente') reservaCount++;
        if (marker.type === 'CORDOALHA' && marker.cordoalhaStatus !== 'Existente') {
            cordoalhaLength += 50; // Assumindo um comprimento padrão para cada unidade de cordoalha
        }
    });

    return {
        cableLength: Math.round(totalLength),
        cordoalhaLength: Math.round(cordoalhaLength),
        ctoCount,
        ceoCount,
        reservaCount
    };
    // ---> FIM DA CORREÇÃO <---
}
// EM script.js:
// Localize e substitua TODA a sua função openLaborModal por esta versão

function openLaborModal() {
    // --- INÍCIO DA CORREÇÃO ---
    // 1. Identificar o projeto ativo ANTES de ler o bomState
    if (!activeFolderId) {
        showAlert("Atenção", "Por favor, selecione um projeto na barra lateral para ver a mão de obra.");
        return;
    }

    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) {
        showAlert("Erro", "Item selecionado não pertence a um projeto. Selecione o projeto ou um item dentro dele.");
        return;
    }

    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    const projectName = projectRootElement.querySelector('.folder-title').dataset.folderName;

    // 2. Sincronizar o bomState global com o BOM do projeto específico
    // (Esta é a lógica que estava faltando, copiada do listener do 'materialListButton')
    if (projectBoms[projectId]) {
        // Se já existe uma lista salva na memória para este projeto, carrega ela
        bomState = JSON.parse(JSON.stringify(projectBoms[projectId]));
    } else {
        // Se não, calcula uma lista nova do zero
        calculateBomState(); // A função já sabe usar o projeto ativo
        // E salva essa lista recém-calculada na memória
        projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
    }
    // --- FIM DA CORREÇÃO ---

    // 3. Agora, o resto da função pode continuar, lendo o 'bomState' que
    // temos certeza que é do projeto correto.
    const tableBody = document.getElementById('labor-items-body');
    tableBody.innerHTML = ''; // Limpa a tabela
    let totalLaborCost = 0;
    let hasRegional = false;
    let hasOutsourced = false;

    // Itera sobre o estado atual da lista de materiais (agora sincronizado)
    for (const name in bomState) {
        const item = bomState[name];
        // Verifica se é um item de Mão de Obra e não está marcado como removido
        if (item.category === 'Mão de Obra' && !item.removed) {
            // Calcula o custo total do item
            const itemTotal = item.details ? item.details.totalCost : item.unitPrice;
            totalLaborCost += itemTotal;

            const row = tableBody.insertRow();
            let type = '';
            let detailsHtml = '';
            // Define os botões padrão: Editar e Remover
            let actionsHtml = `
                <button data-name="${name}" class="edit-labor-btn" style="background-color: #ffc107; color: #333; border: none; cursor: pointer; border-radius: 4px; padding: 4px 10px; margin-right: 5px;">Editar</button>
                <button data-name="${name}" class="remove-labor-btn" style="background-color: #f44336; color: white; border: none; cursor: pointer; border-radius: 4px; padding: 4px 10px;">Remover</button>
            `;

            // Lógica específica para Mão de Obra Regional
            if (name === 'Mão de Obra Regional') {
                type = 'Regional';
                hasRegional = true;
                const details = item.details || {};

                const totalFuel = (details.fuelQty || 0) * (details.fuelPrice || 0);
                const totalFood = (details.foodQty || 0) * (details.foodPrice || 0);
                const totalLodging = (details.lodgingQty || 0) * (details.lodgingPrice || 0);
                const totalToll = (details.tollQty || 0) * (details.tollPrice || 0);
                const expenses = totalFuel + totalFood + totalLodging + totalToll;
                
                detailsHtml = `
                    <ul class="details-list">
                        <li><strong>Técnicos:</strong> ${details.techs || 'N/A'}</li>
                        <li><strong>Dias Calc.:</strong> ${details.days || 'N/A'}</li>
                        <li><strong>Despesas Adic.:</strong> R$ ${expenses.toFixed(2).replace('.', ',')}</li>
                    </ul>`;
            }
            // Lógica específica para Mão de Obra Terceirizada
            else if (name.startsWith('Mão de Obra - ')) {
                type = 'Terceirizada';
                hasOutsourced = true;
                const details = item.details || {};
                const companyName = details.companyName || name.replace('Mão de Obra - ', '');
                detailsHtml = companyName;
                actionsHtml = `<button data-name="${name}" class="view-labor-details-btn" style="background-color: #17a2b8; color: white; border: none; cursor: pointer; border-radius: 4px; padding: 4px 10px; margin-right: 5px;">Ver Detalhes</button>` + actionsHtml;
            }

            // Preenche a linha da tabela com os dados
            row.innerHTML = `
                <td>${type}</td>
                <td>${detailsHtml}</td>
                <td>R$ ${itemTotal.toFixed(2).replace('.', ',')}</td>
                <td style="text-align: center;">${actionsHtml}</td>
            `;
        }
    }

    // Atualiza o total geral na interface
    document.getElementById('labor-grand-total-price').textContent = `R$ ${totalLaborCost.toFixed(2).replace('.', ',')}`;
    
    // Mostra ou esconde os botões de adicionar
    const regionalBtnElement = document.getElementById('addNewRegionalLaborButton');
    const outsourcedBtnElement = document.getElementById('addNewOutsourcedLaborButton');
    regionalBtnElement.style.display = hasRegional ? 'none' : 'inline-block';
    outsourcedBtnElement.style.display = hasOutsourced ? 'none' : 'inline-block';

    // Anexa os listeners para os botões "+ Adicionar"
    const newRegionalBtn = regionalBtnElement.cloneNode(true);
    regionalBtnElement.parentNode.replaceChild(newRegionalBtn, regionalBtnElement);
    newRegionalBtn.addEventListener('click', () => openRegionalLaborModal()); 

    const newOutsourcedBtn = outsourcedBtnElement.cloneNode(true);
    outsourcedBtnElement.parentNode.replaceChild(newOutsourcedBtn, outsourcedBtnElement);
    newOutsourcedBtn.addEventListener('click', () => openOutsourcedLaborModal());

    // Listeners para os botões da tabela (Editar, Remover, Ver Detalhes)
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

    // Exibe o modal principal de Mão de Obra
    document.getElementById('laborModal').style.display = 'flex';
}

function showOutsourcedDetails(itemName) {
    const laborItem = bomState[itemName];
    if (!laborItem || !laborItem.details || !laborItem.details.services) {
        showAlert('Erro', 'Detalhes não encontrados para este item.');
        return;
    }

    const details = laborItem.details;
    const modal = document.getElementById('outsourcedDetailsModal');
    const title = document.getElementById('outsourcedDetailsTitle');
    const tableBody = document.getElementById('outsourcedDetailsBody');

    title.textContent = `Detalhes - ${details.companyName}`;
    tableBody.innerHTML = '';

    details.services.forEach(service => {
        if (service.qty > 0) { // Mostra apenas serviços com quantidade maior que zero
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

    modal.style.display = 'flex';
}

// EM script.js:
// Localize e substitua TODA a sua função openRegionalLaborModal por esta versão
// **ESTA VERSÃO CONTÉM O BLOCO try...catch PARA DEPURAR**

function openRegionalLaborModal(itemNameForEdit = null) {
    try { // <-- NOVO: Bloco de captura de erro
        const modal = document.getElementById('regionalLaborModal');
        const titleElement = modal.querySelector('h2');
        const confirmButton = document.getElementById('confirmRegionalLabor');

        // Verifica se já existe M.O. Regional e não está editando (bloqueia adição duplicada)
        if (!itemNameForEdit && bomState['Mão de Obra Regional']) {
            showAlert('Atenção', 'A Mão de Obra Regional já foi adicionada.');
            return;
        }

        // 1. Calcula os dias (Estimativa)
        const quantities = getProjectQuantities();
        const calculatedDays = Math.ceil((quantities.cableLength / 2000) + (quantities.ctoCount / 10) + (quantities.ceoCount / 1));
        
        // Exibe a estimativa
        document.getElementById('regionalDaysDisplay').textContent = calculatedDays;
        
        // Pega o campo de input de dias manuais
        const manualDaysInput = document.getElementById('regionalDaysInput');

        // Lista de todos os IDs de input para facilitar
        const inputIds = [
            'regionalTechs', 'regionalDaysInput',
            'regionalFuelQty', 'regionalFuelPrice',
            'regionalFoodQty', 'regionalFoodPrice',
            'regionalLodgingQty', 'regionalLodgingPrice',
            'regionalTollQty', 'regionalTollPrice'
        ];

        // Configura o modal para MODO EDIÇÃO
        if (itemNameForEdit && bomState[itemNameForEdit]) {
            titleElement.textContent = 'Editar Mão de Obra Regional';
            confirmButton.textContent = 'Salvar Alterações';
            modal.dataset.editingItemName = itemNameForEdit; // Guarda o nome do item sendo editado

            const details = bomState[itemNameForEdit].details || {};
            
            // Pré-preenche os campos com os valores salvos
            document.getElementById('regionalTechs').value = details.techs || 1;
            manualDaysInput.value = details.manualDays !== undefined ? details.manualDays : calculatedDays;
            
            // Pré-preenche os campos de despesas
            document.getElementById('regionalFuelQty').value = details.fuelQty || 0;
            document.getElementById('regionalFuelPrice').value = details.fuelPrice || 0;
            document.getElementById('regionalFoodQty').value = details.foodQty || 0;
            document.getElementById('regionalFoodPrice').value = details.foodPrice || 0;
            document.getElementById('regionalLodgingQty').value = details.lodgingQty || 0;
            document.getElementById('regionalLodgingPrice').value = details.lodgingPrice || 0;
            document.getElementById('regionalTollQty').value = details.tollQty || 0;
            document.getElementById('regionalTollPrice').value = details.tollPrice || 0;

        }
        // Configura o modal para MODO ADIÇÃO
        else {
            titleElement.textContent = 'Adicionar Mão de Obra Regional';
            confirmButton.textContent = 'Confirmar';
            modal.dataset.editingItemName = ''; // Limpa o nome do item em edição

            // Limpa/reseta os campos para os valores padrão
            document.getElementById('regionalTechs').value = 1;
            manualDaysInput.value = calculatedDays;
            
            // Reseta todos os campos de despesa
            inputIds.slice(2).forEach(id => {
                document.getElementById(id).value = 0;
            });
        }

        // Adiciona os listeners de 'oninput' a TODOS os campos
        inputIds.forEach(id => {
            const inputElement = document.getElementById(id);
            if (!inputElement) {
                // Se um campo não for encontrado, lança um erro que será capturado
                throw new Error(`Elemento de input não encontrado: #${id}. Verifique seu index.html.`);
            }
            inputElement.oninput = null; // Remove listener antigo
            inputElement.oninput = updateRegionalCost; // Adiciona o novo
        });

        updateRegionalCost(); // Calcula o custo inicial (seja adição ou edição)
        modal.style.display = 'flex'; // Exibe o modal
        
    } catch (error) {
        // <-- NOVO: Se qualquer coisa acima falhar, este alerta será exibido
        console.error("Erro ao abrir o modal de M.O. Regional:", error);
        showAlert(
            "Erro de Sincronização",
            "Não foi possível abrir o modal. Verifique se o seu 'index.html' (passo 1) e o seu 'script.js' (passo 2) estão ambos atualizados. Detalhe do erro: " + error.message
        );
    }
}

// EM script.js:
// Localize e substitua TODA a sua função updateRegionalCost por esta versão

function updateRegionalCost() {
    const modal = document.getElementById('regionalLaborModal');
    const techs = parseInt(document.getElementById('regionalTechs').value, 10) || 0;
    
    // Lê os dias do CAMPO DE INPUT
    const days = parseInt(document.getElementById('regionalDaysInput').value, 10) || 0;
    
    // Lê os novos campos de Quantidade e Preço
    const fuelQty = parseFloat(document.getElementById('regionalFuelQty').value) || 0;
    const fuelPrice = parseFloat(document.getElementById('regionalFuelPrice').value) || 0;
    const foodQty = parseFloat(document.getElementById('regionalFoodQty').value) || 0;
    const foodPrice = parseFloat(document.getElementById('regionalFoodPrice').value) || 0;
    const lodgingQty = parseFloat(document.getElementById('regionalLodgingQty').value) || 0;
    const lodgingPrice = parseFloat(document.getElementById('regionalLodgingPrice').value) || 0;
    const tollQty = parseFloat(document.getElementById('regionalTollQty').value) || 0;
    const tollPrice = parseFloat(document.getElementById('regionalTollPrice').value) || 0;

    // Custo base (Técnicos * Dias * 8h * R$40/h)
    const baseCost = techs * days * 8 * 40;
    
    // Calcula o total de cada despesa
    const totalFuel = fuelQty * fuelPrice;
    const totalFood = foodQty * foodPrice;
    const totalLodging = lodgingQty * lodgingPrice;
    const totalToll = tollQty * tollPrice;

    // Soma o custo base + todas as despesas
    const totalCost = baseCost + totalFuel + totalFood + totalLodging + totalToll;

    document.getElementById('regionalBaseCostDisplay').textContent = `R$ ${baseCost.toFixed(2).replace('.', ',')}`;
    document.getElementById('regionalTotalCostDisplay').textContent = `R$ ${totalCost.toFixed(2).replace('.', ',')}`;
}

// EM script.js:
// Localize e substitua TODA a sua função handleRegionalLaborConfirm por esta versão

function handleRegionalLaborConfirm() {
    const techs = parseInt(document.getElementById('regionalTechs').value, 10);
    // Validação da quantidade de técnicos
    if (isNaN(techs) || techs < 1) {
        showAlert('Erro', 'A quantidade de técnicos deve ser um número maior que zero.');
        return;
    }

    const modal = document.getElementById('regionalLaborModal');
    // Pega o nome do item que estava sendo editado (se houver)
    const editingItemName = modal.dataset.editingItemName;

    // Pega os outros valores do formulário
    const calculatedDays = parseInt(document.getElementById('regionalDaysDisplay').textContent, 10) || 0; // Pega o valor calculado (para salvar)
    const manualDays = parseInt(document.getElementById('regionalDaysInput').value, 10) || 0; // Pega os dias manuais
    
    // Pega os valores de Qtd e Preço das despesas
    const fuelQty = parseFloat(document.getElementById('regionalFuelQty').value) || 0;
    const fuelPrice = parseFloat(document.getElementById('regionalFuelPrice').value) || 0;
    const foodQty = parseFloat(document.getElementById('regionalFoodQty').value) || 0;
    const foodPrice = parseFloat(document.getElementById('regionalFoodPrice').value) || 0;
    const lodgingQty = parseFloat(document.getElementById('regionalLodgingQty').value) || 0;
    const lodgingPrice = parseFloat(document.getElementById('regionalLodgingPrice').value) || 0;
    const tollQty = parseFloat(document.getElementById('regionalTollQty').value) || 0;
    const tollPrice = parseFloat(document.getElementById('regionalTollPrice').value) || 0;
    
    // Calcula os custos (espelhando a função updateRegionalCost)
    const baseCost = techs * manualDays * 8 * 40;
    const totalFuel = fuelQty * fuelPrice;
    const totalFood = foodQty * foodPrice;
    const totalLodging = lodgingQty * lodgingPrice;
    const totalToll = tollQty * tollPrice;
    const totalCost = baseCost + totalFuel + totalFood + totalLodging + totalToll;

    // Define o nome do item (será sempre 'Mão de Obra Regional')
    const itemName = 'Mão de Obra Regional';

    // Cria ou atualiza a entrada no bomState
    bomState[itemName] = {
        quantity: 1, // Quantidade é sempre 1 para M.O.
        type: 'Regional', // Tipo (para exibição)
        unitPrice: totalCost, // O custo total calculado é o "preço unitário"
        category: 'Mão de Obra', // Categoria
        removed: false, // Não está removido
        details: { // Guarda os detalhes para exibição e edição futura
            techs, 
            days: calculatedDays, // Salva o dia calculado (original)
            manualDays: manualDays, // Salva o dia manual
            
            // Salva todos os novos campos
            fuelQty, fuelPrice,
            foodQty, foodPrice,
            lodgingQty, lodgingPrice,
            tollQty, tollPrice,

            baseCost, 
            totalCost
        }
    };

    // Bloco de correção para salvar no projectBoms[projectId]
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

    // Limpa o estado de edição e fecha o modal
    modal.dataset.editingItemName = '';
    document.getElementById('regionalLaborModal').style.display = 'none';
    openLaborModal(); // Reabre o modal principal para mostrar a lista atualizada
}

// EM script.js:
// Localize e substitua TODA a função openOutsourcedLaborModal por esta versão

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
    // Lista padrão de serviços com preços e unidades
    const defaultServices = [
        { name: 'LANÇAMENTO DE CABO AÉREA URBANA', price: 1.80, unit: 'm', defaultQtyKey: 'cableLength' },
        { name: 'LANÇAMENTO DE CABO AÉREA RURAL', price: 2.59, unit: 'm', defaultQtyKey: null }, // Qtd padrão 0
        { name: 'LANÇAMENTO DE CABO EM DUTO OCUPADO', price: 3.00, unit: 'm', defaultQtyKey: null }, // Qtd padrão 0
        { name: 'INSTALAÇÃO DE RESERVA TÉCNICA', price: 80.00, unit: 'un', defaultQtyKey: 'reservaCount' },
        { name: 'LANÇAMENTO DE CORDOALHA', price: 1.50, unit: 'm', defaultQtyKey: 'cordoalhaLength' },
        { name: 'REMOÇÃO DE CABO EM REDE AÉREA', price: 1.00, unit: 'm', defaultQtyKey: null }, // Qtd padrão 0
        { name: 'INSTALAÇÃO DE CAIXA DE EMENDA (CEO)', price: 110.00, unit: 'un', defaultQtyKey: 'ceoCount' },
        { name: 'INSTALAÇÃO DE CAIXA DE ATENDIMENTO (CTO)', price: 80.00, unit: 'un', defaultQtyKey: 'ctoCount' },
        { name: 'FUSÃO DE FIBRA ÓPTICA', price: 20.00, unit: 'un', defaultQtyKey: null }, // Qtd padrão 0
        { name: 'INSTALAÇÃO DE POSTE', price: 270.00, unit: 'un', defaultQtyKey: null }, // Qtd padrão 0
        { name: 'VALOR DO POSTE', price: 120.00, unit: 'un', defaultQtyKey: null }, // Qtd padrão 0
    ];

    tableBody.innerHTML = ''; // Limpa a tabela de serviços
    let savedServicesData = {}; // Para armazenar quantidades salvas no modo edição

    // Configura para MODO EDIÇÃO
    if (itemNameForEdit && bomState[itemNameForEdit]) {
        titleElement.textContent = 'Editar Mão de Obra Terceirizada';
        confirmButton.textContent = 'Salvar Alterações';
        modal.dataset.editingItemName = itemNameForEdit; // Guarda o nome

        const details = bomState[itemNameForEdit].details || {};
        companyNameInput.value = details.companyName || itemNameForEdit.replace('Mão de Obra - ', ''); // Preenche nome da empresa
        // Mapeia os serviços salvos pelo nome para fácil acesso
        savedServicesData = (details.services || []).reduce((acc, service) => {
            acc[service.name] = service.qty;
            return acc;
        }, {});
    }
    // Configura para MODO ADIÇÃO
    else {
        titleElement.textContent = 'Adicionar Mão de Obra Terceirizada';
        confirmButton.textContent = 'Confirmar';
        modal.dataset.editingItemName = ''; // Limpa o nome
        companyNameInput.value = ''; // Limpa nome da empresa
    }

    // Preenche a tabela de serviços
    defaultServices.forEach(service => {
        let quantity = 0;
        // No modo edição, usa a quantidade salva
        if (itemNameForEdit) {
            quantity = savedServicesData[service.name] || 0;
        }
        // No modo adição, usa a quantidade calculada do projeto (se aplicável)
        else if (service.defaultQtyKey) {
            quantity = quantities[service.defaultQtyKey] || 0;
        }

        const row = tableBody.insertRow();
        row.innerHTML = `
            <td>${service.name}</td>
            <td>R$ ${service.price.toFixed(2).replace('.', ',')} / ${service.unit}</td>
            <td><input type="number" class="outsourced-qty-input" value="${quantity}" min="0" data-price="${service.price}" data-name="${service.name}" data-unit="${service.unit}"></td>
            <td class="outsourced-subtotal">R$ 0,00</td>
        `;
    });

    // Adiciona ou re-adiciona listeners de input para atualizar o custo total
    document.querySelectorAll('.outsourced-qty-input').forEach(input => {
        input.oninput = null; // Remove listener antigo
        input.oninput = updateOutsourcedCost;
    });

    updateOutsourcedCost(); // Calcula o custo total inicial
    modal.style.display = 'flex'; // Exibe o modal
}

function updateOutsourcedCost() {
    let total = 0;
    document.querySelectorAll('#outsourcedServicesBody tr').forEach(row => {
        const input = row.querySelector('.outsourced-qty-input');
        const subtotalCell = row.querySelector('.outsourced-subtotal');
        const price = parseFloat(input.dataset.price);
        const qty = parseFloat(input.value) || 0;
        const subtotal = price * qty;
        subtotalCell.textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
        total += subtotal;
    });

    document.getElementById('outsourcedTotalCostDisplay').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
}


function handleOutsourcedLaborConfirm() {
    const modal = document.getElementById('outsourcedLaborModal');
    // Pega o nome do item que estava sendo editado (se houver)
    const editingItemName = modal.dataset.editingItemName;
    // Pega o nome da empresa (pode ter sido alterado na edição)
    const companyName = document.getElementById('outsourcedCompanyName').value.trim() || 'Terceirizada';

    // Calcula o custo total a partir do display
    const totalCostString = document.getElementById('outsourcedTotalCostDisplay').textContent;
    const totalCost = parseFloat(totalCostString.replace('R$ ', '').replace(/[.]/g, '').replace(',', '.'));

    // Coleta os dados de todos os serviços (nomes, preços, unidades, quantidades)
    const services = [];
    document.querySelectorAll('.outsourced-qty-input').forEach(input => {
        services.push({
            name: input.dataset.name,
            price: parseFloat(input.dataset.price),
            unit: input.dataset.unit,
            qty: parseFloat(input.value) || 0 // Pega a quantidade atual do input
        });
    });

    // Determina o nome da chave no bomState
    // Se está editando, usa o nome original. Se está adicionando, cria um novo.
    const itemName = editingItemName || `Mão de Obra - ${companyName}`;

    // Verifica se o custo é válido antes de salvar/atualizar
    if (totalCost >= 0) {
        // Cria ou atualiza a entrada no bomState
        bomState[itemName] = {
            quantity: 1,
            type: 'Outsourced', // Tipo para exibição
            unitPrice: totalCost, // Custo total é o "preço unitário"
            category: 'Mão de Obra',
            removed: false,
            details: { // Guarda os detalhes atualizados
                companyName: companyName, // Salva o nome da empresa (pode ser diferente da chave)
                services: services, // Salva a lista de serviços com as quantidades atuais
                totalCost: totalCost // Salva o custo total calculado
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
    openLaborModal(); // Reabre o modal principal para mostrar a lista atualizada
}


function recalculateGrandTotal() {
    let ferragemTotal = 0;
    let cabosTotal = 0;
    let fusaoTotal = 0;
    let datacenterTotal = 0;

    for (const name in bomState) {
        const item = bomState[name];
        if (!item.removed && item.category !== 'Mão de Obra') {
            const itemTotal = item.quantity * item.unitPrice;
            if (item.category === 'Ferragem') {
                ferragemTotal += itemTotal;
            } else if (item.category === 'Lançamento') {
                cabosTotal += itemTotal;
            } else if (item.category === 'Fusão') {
                fusaoTotal += itemTotal;
            } else if (item.category === 'Data Center') {
                datacenterTotal += itemTotal;
            } else { 
                ferragemTotal += itemTotal;
            }
        }
    }

    const grandTotal = ferragemTotal + cabosTotal + fusaoTotal + datacenterTotal;

    document.getElementById('ferragem-total-price').textContent = `R$ ${ferragemTotal.toFixed(2).replace('.', ',')}`;
    document.getElementById('cabos-total-price').textContent = `R$ ${cabosTotal.toFixed(2).replace('.', ',')}`;
    document.getElementById('fusao-total-price').textContent = `R$ ${fusaoTotal.toFixed(2).replace('.', ',')}`;
    document.getElementById('datacenter-total-price').textContent = `R$ ${datacenterTotal.toFixed(2).replace('.', ',')}`;
    document.getElementById('grand-total-price').textContent = `R$ ${grandTotal.toFixed(2).replace('.', ',')}`;
}

/**
 * Coleta todos os marcadores, cabos e polígonos que pertencem a um projeto e seus sub-folders. (VERSÃO CORRIGIDA)
 * @param {string} projectId - O ID do elemento <ul> do projeto principal.
 * @returns {{markers: Array, cables: Array, polygons: Array}} - Um objeto com os marcadores, cabos e polígonos do projeto.
 */
function getProjectItems(projectId) {
  const allFolderIds = getAllDescendantFolderIds(projectId);
  const projectMarkers = markers.filter(m => allFolderIds.includes(m.folderId));
  const projectCables = savedCables.filter(c => allFolderIds.includes(c.folderId));
  // A LINHA ABAIXO ESTAVA EM FALTA:
  const projectPolygons = savedPolygons.filter(p => allFolderIds.includes(p.folderId));

  // O RETORNO AGORA INCLUI OS POLÍGONOS:
  return { markers: projectMarkers, cables: projectCables, polygons: projectPolygons };
}


/**
 * (NOVA FUNÇÃO) Calcula os subtotais de custo por categoria a partir de um objeto de lista de materiais (BOM) já existente.
 * @param {object} projectBom - O objeto da lista de materiais do projeto (ex: projectBoms[projectId]).
 * @returns {object} - Um objeto com os custos detalhados por categoria e o total geral.
 */
function summarizeBomCosts(projectBom) {
    let ferragemTotal = 0;
    let cabosTotal = 0;
    let fusaoTotal = 0;
    let datacenterTotal = 0;

    for (const name in projectBom) {
        const item = projectBom[name];
        // Pula itens removidos ou que não são da categoria correta
        if (item.removed || !item.category) continue;

        const itemTotal = (item.quantity || 0) * (item.unitPrice || 0);

        switch (item.category) {
            case 'Ferragem':
                ferragemTotal += itemTotal;
                break;
            case 'Lançamento':
                cabosTotal += itemTotal;
                break;
            case 'Fusão':
                fusaoTotal += itemTotal;
                break;
            case 'Data Center':
                datacenterTotal += itemTotal;
                break;
        }
    }

    const grandTotal = ferragemTotal + cabosTotal + fusaoTotal + datacenterTotal;

    return { ferragemTotal, cabosTotal, fusaoTotal, datacenterTotal, grandTotal };
}


/**
 * Calcula o custo detalhado de materiais para um conjunto específico de marcadores e cabos.
 * @param {Array} projectMarkers - A lista de marcadores do projeto.
 * @param {Array} projectCables - A lista de cabos do projeto.
 * @returns {object} - Um objeto com os custos detalhados: { ferragemTotal, cabosTotal, fusaoTotal, datacenterTotal, grandTotal }.
 */
function calculateProjectCost(projectMarkers, projectCables) {
  const tempBomState = {};
  let ctoCount = 0;
  let raqueteInstallCount = 0; // Contador para instalações com raquete

  const addOrUpdate = (name, qty, type = 'unit') => {
    if (!name || qty <= 0) return;
    const priceInfo = MATERIAL_PRICES[name] || { price: 0, category: 'Outros' };
    if (!tempBomState[name]) {
      tempBomState[name] = { quantity: 0, type: type, unitPrice: priceInfo.price, category: priceInfo.category };
    }
    tempBomState[name].quantity += qty;
  };

  projectMarkers.forEach(markerInfo => {
    if (markerInfo.isImported) return;
    const type = markerInfo.type;
    if (type === 'CASA' || (markerInfo.ceoStatus === 'Existente') || (markerInfo.ctoStatus === 'Existente') || (markerInfo.cordoalhaStatus === 'Existente') || (markerInfo.reservaStatus === 'Existente')) return;
    
    if (type === 'CTO') {
        if (markerInfo.isPredial) { addOrUpdate("CAIXA DE ATENDIMENTO PREDIAL", 1); addOrUpdate("ABRAÇADEIRA DE NYLON", 4); } 
        else { ctoCount++; const priceInfo = MATERIAL_PRICES['CTO']; if (priceInfo && priceInfo.components) { priceInfo.components.forEach(c => addOrUpdate(c.name, c.quantity)); } }
    } else if (type === 'CEO') {
        if (markerInfo.is144F) { addOrUpdate("CAIXA DE EMENDA OPTICA (CEO) 144 FUSÕES", 1); } 
        else { addOrUpdate("CAIXA DE EMENDA ÓPTICA (CEO)", 1); }
        if (markerInfo.ceoAccessory === "Raquete") {
            raqueteInstallCount++;
            addOrUpdate("PRENSA DE ESPINAR", 2);
            addOrUpdate("RAQUETE PARA CEO", 2);
            addOrUpdate("TAP BRACKET", 4);
            addOrUpdate("CABO DE AÇO CORDOALHA 3/16 POL", 50, 'length');
            addOrUpdate("ALÇA PREFORMADA PARA CORDOALHA 3/16 POL", 2);
            addOrUpdate("FITA DE AMARRAÇÃO INOX 16 POL", 10);
            addOrUpdate("SUPORTE PRESBOW (REX)", 2);
            addOrUpdate("ISOLADOR ROLDANA", 2);
        } else if (markerInfo.ceoAccessory === "Suporte") {
            addOrUpdate("SUPORTE PARA CEO", 1); addOrUpdate("ABRAÇADEIRA DE NYLON", 4); addOrUpdate("ABRAÇADEIRA BAP 3", 2);
        }
    } else if (type === 'RESERVA') {
        if (markerInfo.reservaAccessory === "Raquete") {
            raqueteInstallCount++;
            addOrUpdate("PRENSA DE ESPINAR", 2);
            addOrUpdate("RAQUETE PARA CEO", 2);
            addOrUpdate("TAP BRACKET", 4);
            addOrUpdate("CABO DE AÇO CORDOALHA 3/16 POL", 50, 'length');
            addOrUpdate("ALÇA PREFORMADA PARA CORDOALHA 3/16 POL", 2);
            addOrUpdate("FITA DE AMARRAÇÃO INOX 16 POL", 10);
            addOrUpdate("SUPORTE PRESBOW (REX)", 2);
            addOrUpdate("ISOLADOR ROLDANA", 2);
        } else if (markerInfo.reservaAccessory === "Suporte") {
            addOrUpdate("SUPORTE PARA CEO", 1); addOrUpdate("ABRAÇADEIRA DE NYLON", 4); addOrUpdate("ABRAÇADEIRA BAP 3", 2);
        }
    } else if (type === 'CORDOALHA') {
        addOrUpdate("SUPORTE PRESBOW (REX)", 4); addOrUpdate("ISOLADOR ROLDANA", 4);
        addOrUpdate("ALÇA PREFORMADA PARA CORDOALHA 3/16 POL", 4);
        addOrUpdate("CABO DE AÇO CORDOALHA 3/16 POL", 50, 'length');
        if (markerInfo.derivationTCount && markerInfo.derivationTCount > 0) {
            addOrUpdate("DERIVAÇÃO EM T", markerInfo.derivationTCount);
        }
    }
  });

  if (raqueteInstallCount > 0) {
      const totalArameNeeded = raqueteInstallCount * 50;
      const arameRolls = Math.ceil(totalArameNeeded / 105);
      addOrUpdate("ARAME DE ESPIMAR (105 m)", arameRolls);
  }

  if (ctoCount > 0) {
    addOrUpdate("FITA DE AÇO INOX 3/4'' (FITA FUSIMEC) ROLO DE 25M", Math.ceil((3 * ctoCount) / 25));
  }
  
  projectMarkers.forEach(markerInfo => {
      if ((markerInfo.type === 'CTO' || markerInfo.type === 'CEO') && markerInfo.fusionPlan) {
          try {
              const planData = JSON.parse(markerInfo.fusionPlan);
              if (!planData.canvas) return;
              const tempDiv = document.createElement('div');
              tempDiv.innerHTML = planData.canvas;
              
              tempDiv.querySelectorAll('.splitter-element').forEach(splitterEl => { /* ... lógica dos splitters ... */ });
              if (markerInfo.type === 'CEO') { /* ... lógica dos kits ... */ }
              tempDiv.querySelectorAll('.fusion-line').forEach(() => addOrUpdate("TUBETE PROTETOR DE EMENDA OPTICA", 1));

          } catch (e) { /* silent fail */ }
      }
  });

  projectCables.forEach(cable => {
      if (cable.status !== 'Existente' && !cable.isImported) addOrUpdate(cable.type, cable.totalLength, 'length');
  });

  addOrUpdate("FITA ISOLANTE", 1);

  const cableHardwareMap = { /* ... seu objeto cableHardwareMap ... */ };
  const aggregatedFiberLengths = {};
  for (const name in tempBomState) {
      const fiberType = getFiberType(name);
      if (fiberType && tempBomState[name].category === 'Lançamento') {
          if (!aggregatedFiberLengths[fiberType]) aggregatedFiberLengths[fiberType] = 0;
          aggregatedFiberLengths[fiberType] += tempBomState[name].quantity;
      }
  }
  Object.keys(aggregatedFiberLengths).forEach(fiberType => {
      const totalLength = aggregatedFiberLengths[fiberType];
      if (totalLength > 0 && cableHardwareMap[fiberType]) {
          const hardwareItems = calculateHardwareForCable(totalLength, cableHardwareMap[fiberType]);
          for (const itemName in hardwareItems) { addOrUpdate(itemName, hardwareItems[itemName]); }
      }
  });

  let ferragemTotal = 0, cabosTotal = 0, fusaoTotal = 0, datacenterTotal = 0;
  
  for (const name in tempBomState) {
    const item = tempBomState[name];
    const itemTotal = item.quantity * item.unitPrice;
    
    switch (item.category) {
        case 'Ferragem':
            ferragemTotal += itemTotal;
            break;
        case 'Lançamento':
            cabosTotal += itemTotal;
            break;
        case 'Fusão':
            fusaoTotal += itemTotal;
            break;
        case 'Data Center':
            datacenterTotal += itemTotal;
            break;
    }
  }
  
  const grandTotal = ferragemTotal + cabosTotal + fusaoTotal + datacenterTotal;
  
  return { ferragemTotal, cabosTotal, fusaoTotal, datacenterTotal, grandTotal };
}

/**
 * Calcula o custo detalhado de mão de obra para um conjunto específico de itens e um BOM.
 * @param {object} projectItems - Objeto contendo os arrays de marcadores e cabos do projeto.
 * @param {object} projectBomForReport - O objeto da lista de materiais (BOM) salvo para este projeto.
 * @returns {object} - Um objeto com os custos de mão de obra: { regionalCost, outsourcedCost, totalLaborCost }.
 */
function calculateProjectLaborCost(projectItems, projectBomForReport) {
    let regionalCost = 0;
    let outsourcedCost = 0;

    const bomToUse = projectBomForReport || {};

    const regionalLabor = bomToUse['Mão de Obra Regional'];
    const outsourcedLabor = Object.values(bomToUse).find(item => item.type === 'Outsourced');

    // 1. CÁLCULO DA MÃO DE OBRA REGIONAL (CORRIGIDO)
    if (regionalLabor && !regionalLabor.removed) {
        
        // --- INÍCIO DA CORREÇÃO ---
        // Em vez de recalcular, agora lemos o custo total que já foi salvo
        // no objeto 'details' ou no 'unitPrice' pela função handleRegionalLaborConfirm.
        if (regionalLabor.details && typeof regionalLabor.details.totalCost === 'number') {
            regionalCost = regionalLabor.details.totalCost;
        } else {
            // Fallback para o unitPrice, que também deve conter o custo total
            regionalCost = regionalLabor.unitPrice || 0;
        }
        // --- FIM DA CORREÇÃO ---
    }

    // 2. CÁLCULO DA MÃO DE OBRA TERCEIRIZADA (Lógica existente)
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

function getProjectQuantitiesFromItems(projectItems) {
    let totalLength = 0, cordoalhaLength = 0, ctoCount = 0, ceoCount = 0, reservaCount = 0;
    
    projectItems.cables.forEach(cable => {
        if (cable.status !== 'Existente') {
            totalLength += cable.totalLength; // Usa o comprimento total salvo (lançamento + reserva)
        }
    });

    projectItems.markers.forEach(marker => {
        if (marker.type === 'CTO' && marker.ctoStatus !== 'Existente') ctoCount++;
        if (marker.type === 'CEO' && marker.ceoStatus !== 'Existente') ceoCount++;
        if (marker.type === 'RESERVA' && marker.reservaStatus !== 'Existente') reservaCount++;
        if (marker.type === 'CORDOALHA' && marker.cordoalhaStatus !== 'Existente') {
            cordoalhaLength += 50;
        }
    });

    return { cableLength: Math.round(totalLength), cordoalhaLength, ctoCount, ceoCount, reservaCount };
}


/**
 * Abre o modal de relatório e preenche a lista de projetos.
 */
function openReportModal() {
  const projectListUl = document.getElementById("report-projects-ul");
  projectListUl.innerHTML = ""; // Limpa a lista anterior

  const projectElements = document.querySelectorAll('.folder-title[data-is-project="true"]');

  if (projectElements.length === 0) {
    projectListUl.innerHTML = "<li>Nenhum projeto encontrado.</li>";
  } else {
    projectElements.forEach(projEl => {
        const li = document.createElement("li");
        li.dataset.projectId = projEl.dataset.folderId;
    
        const projectName = projEl.dataset.folderName || 'Projeto sem nome';
        const projectCity = projEl.dataset.folderCity || 'N/A';
        const projectNeighborhood = projEl.dataset.folderNeighborhood || 'N/A';
    
        li.innerHTML = `
            <span class="report-project-name">${projectName}</span>
            <span class="report-project-details">${projectCity} - ${projectNeighborhood}</span>
        `;
    
        li.addEventListener("click", () => showProjectReportDetails(li.dataset.projectId, projectName));
        projectListUl.appendChild(li);
    });
  }

  // Garante que a visualização correta seja exibida
  document.getElementById("report-project-details").classList.add("hidden");
  document.getElementById("report-project-list").classList.remove("hidden");
  document.getElementById("reportModal").style.display = "flex";
}


/**
 * Calcula e exibe os detalhes do relatório para um projeto específico.
 * @param {string} projectId - O ID do projeto selecionado.
 * @param {string} projectName - O nome do projeto selecionado.
 */
// EM script.js:
// Localize e substitua TODA a sua função showProjectReportDetails por esta versão

function showProjectReportDetails(projectId, projectName) {
  console.log(`--- Gerando Relatório para Projeto ID: ${projectId}, Nome: ${projectName} ---`);
  document.getElementById('report-project-details').dataset.currentProjectId = projectId;
  const projectElement = document.querySelector(`.folder-title[data-folder-id="${projectId}"]`);
  // Obter itens específicos do projeto
  const { markers: projectMarkers, cables: projectCables } = getProjectItems(projectId);
  const projectItems = { markers: projectMarkers, cables: projectCables };
  const quantities = getProjectQuantitiesFromItems(projectItems);

  // --- Lógica para Calcular Portas (com Debugging) ---
  let portasExistentes = 0;
  let novasPortas = 0;
  console.log("Iniciando contagem de portas..."); // LOG Contagem
  projectMarkers.forEach(marker => {
    // Verifica se é CTO ou CEO e se tem um plano de fusão salvo
    if ((marker.type === 'CTO' || marker.type === 'CEO') && marker.fusionPlan) {
      console.log(` -> Verificando plano da caixa: "${marker.name}" (Tipo: ${marker.type})`); // LOG Caixa
      try {
        const planData = JSON.parse(marker.fusionPlan);
        // Verifica se os dados necessários existem no plano salvo
        if (!planData.elements) {
            console.log("    WARN: planData.elements não encontrado neste plano. Pulando contagem de portas."); // LOG Warn
            return; // Pula para o próximo marcador se não houver 'elements'
        }

        // Cria um elemento temporário para analisar o HTML dos componentes
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = planData.elements;

        // Encontra todos os splitters DE ATENDIMENTO dentro do plano
        const splitters = tempDiv.querySelectorAll('.splitter-atendimento');
        console.log(`    Encontrados ${splitters.length} splitter(s) de atendimento.`); // LOG Splitters encontrados

        splitters.forEach(splitterElement => {
          // Lê o status salvo no atributo data-status
          const status = splitterElement.dataset.status;
          // Encontra o span com o label (nome) do splitter
          const labelElement = splitterElement.querySelector('.splitter-body span');
          const label = labelElement ? labelElement.textContent.trim() : null;

          console.log(`      - Splitter encontrado: Label="${label || 'N/A'}", Status="${status || 'N/A'}"`); // LOG Detalhes Splitter

          if (!label || !status) {
              console.log("        WARN: Label ou Status do splitter não encontrado. Pulando este splitter."); // LOG Warn Splitter
              return; // Pula para o próximo splitter se faltar label ou status
          }

          // Extrai o número de portas do label (ex: "1:8 APC" -> 8)
          const ratioMatch = label.match(/1:(\d+)/);
          const portsInThisSplitter = ratioMatch ? parseInt(ratioMatch[1], 10) : 0;

          console.log(`        Portas extraídas do label: ${portsInThisSplitter}`); // LOG Portas Extraídas

          // Acumula a contagem baseado no status
          if (status === 'Existente') {
              portasExistentes += portsInThisSplitter;
              console.log(`        Adicionado a portasExistentes. Total agora: ${portasExistentes}`); // LOG Acumulado Existente
          } else { // Assume 'Novo' ou 'Troca' como novas portas
              novasPortas += portsInThisSplitter;
              console.log(`        Adicionado a novasPortas. Total agora: ${novasPortas}`); // LOG Acumulado Novas
          }
        });
      } catch (e) {
         console.error(`    ERRO ao analisar portas no plano de fusão da caixa "${marker.name}":`, e); // LOG Erro
      }
    }
  }); // Fim do loop forEach(marker)

  console.log(`Contagem Final: Existentes=${portasExistentes}, Novas=${novasPortas}`); // LOG Final Contagem

  const totalPortas = portasExistentes + novasPortas; // Soma final
  const totalCasas = projectMarkers.filter(m => m.type === 'CASA').reduce((sum, m) => sum + parseInt(m.name || 0, 10), 0);

  // --- Restante da lógica de cálculo de custos (sem alterações) ---
  const projectBomForReport = projectBoms[projectId] || {};
  const materialCosts = summarizeBomCosts(projectBomForReport);
  const laborCosts = calculateProjectLaborCost(projectItems, projectBomForReport); // Passa o BOM para cálculo de M.O.
  const materialCost = materialCosts.grandTotal;
  const laborCost = laborCosts.totalLaborCost;
  const totalCost = materialCost + laborCost;
  const safetyCoef = totalCost * 0.05;
  const finalCost = totalCost + safetyCoef;
  const costPerPort = novasPortas > 0 ? (finalCost / novasPortas) : 0;
  const prazoEstimado = Math.ceil((quantities.cableLength / 2000) + (quantities.ctoCount / 10) + (quantities.ceoCount / 1));

  // ---> ADICIONADO CÁLCULO DA TAXA DE PENETRAÇÃO <---
  const penetrationRate = (totalCasas > 0) ? (totalPortas / totalCasas) * 100 : 0;

  // --- Atualiza a UI ---
  document.getElementById("report-title").textContent = `Relatório: ${projectName}`;
  document.getElementById("report-neighborhoods").textContent = projectElement.dataset.folderNeighborhood || 'N/A';
  document.getElementById("report-houses").textContent = totalCasas;
  document.getElementById("report-existing-ports").textContent = portasExistentes; // Exibe o valor calculado
  document.getElementById("report-new-ports").textContent = novasPortas;       // Exibe o valor calculado
  document.getElementById("report-total-ports").textContent = totalPortas;     // Exibe a soma
  
  // ---> ADICIONADO LINHA PARA ATUALIZAR A UI <---
  document.getElementById("report-penetration-rate").textContent = `${penetrationRate.toFixed(2)} %`;

  document.getElementById("report-cable-length").textContent = `${quantities.cableLength} m`;

  document.getElementById("report-ferragem-cost").textContent = `R$ ${materialCosts.ferragemTotal.toFixed(2).replace('.', ',')}`;
  document.getElementById("report-cabos-cost").textContent = `R$ ${materialCosts.cabosTotal.toFixed(2).replace('.', ',')}`;
  document.getElementById("report-fusao-cost").textContent = `R$ ${materialCosts.fusaoTotal.toFixed(2).replace('.', ',')}`;
  document.getElementById("report-datacenter-cost").textContent = `R$ ${materialCosts.datacenterTotal.toFixed(2).replace('.', ',')}`;
  document.getElementById("report-material-cost").textContent = `R$ ${materialCost.toFixed(2).replace('.', ',')}`;

  document.getElementById("report-regional-labor-cost").textContent = `R$ ${laborCosts.regionalCost.toFixed(2).replace('.', ',')}`;
  document.getElementById("report-outsourced-labor-cost").textContent = `R$ ${laborCosts.outsourcedCost.toFixed(2).replace('.', ',')}`;
  document.getElementById("report-labor-cost").textContent = `R$ ${laborCost.toFixed(2).replace('.', ',')}`;

  document.getElementById("report-total-cost").textContent = `R$ ${totalCost.toFixed(2).replace('.', ',')}`;
  document.getElementById("report-safety-coef").textContent = `R$ ${safetyCoef.toFixed(2).replace('.', ',')}`;
  document.getElementById("report-final-cost").textContent = `R$ ${finalCost.toFixed(2).replace('.', ',')}`;
  document.getElementById("report-cost-per-port").textContent = `R$ ${costPerPort.toFixed(2).replace('.', ',')}`;
  document.getElementById("report-duration").textContent = `${prazoEstimado} dias`;

  // Trocar de visualização
  document.getElementById("report-project-list").classList.add("hidden");
  document.getElementById("report-project-details").classList.remove("hidden");
}

/**
 * Atualiza a posição da caixa de informações do cabo com base no evento do mouse.
 * @param {MouseEvent} e - O evento de movimento do mouse.
 */
function updateInfoBoxPosition(e) {
    if (!cableInfoBox) return;
    const xOffset = 15;
    const yOffset = 15;
    cableInfoBox.style.left = `${e.clientX + xOffset}px`;
    cableInfoBox.style.top = `${e.clientY + yOffset}px`;
}

/**
 * Adiciona listeners de mouseover e mouseout a uma polilinha de cabo para realce e exibição de informações.
 * @param {google.maps.Polyline} polyline - O objeto da polilinha do cabo.
 * @param {number} cableIndex - O índice do cabo no array savedCables.
 */
function addCableEventListeners(polyline, cableIndex) {
    let originalOptions = {
        strokeWeight: polyline.get('strokeWeight'),
        zIndex: polyline.get('zIndex') || 1
    };

    const mapDiv = document.getElementById('map');

    polyline.addListener('mouseover', function(e) {
        const cableData = savedCables[cableIndex];
        if (!cableData || !cableData.polyline.getVisible()) return;

        originalOptions = {
            strokeWeight: polyline.get('strokeWeight'),
            zIndex: polyline.get('zIndex') || 1
        };

        this.setOptions({
            strokeWeight: (originalOptions.strokeWeight || 3) + 3,
            zIndex: 100
        });

        cableInfoBox.innerHTML = `<strong>${cableData.name}</strong><br>Total: ${cableData.totalLength} m`;
        cableInfoBox.classList.remove('hidden');

        mapDiv.addEventListener('mousemove', updateInfoBoxPosition);
    });

    polyline.addListener('mouseout', function(e) {
        this.setOptions(originalOptions);
        cableInfoBox.classList.add('hidden');
        mapDiv.removeEventListener('mousemove', updateInfoBoxPosition);
    });
}

/**
 * Realiza a busca no mapa com base nos campos do modal de pesquisa.
 * Prioriza a busca por coordenadas se o campo estiver preenchido.
 * Utiliza a cidade do projeto ativo como fallback se o campo de cidade estiver vazio.
 */
/**
 * Realiza a busca no mapa com base nos campos do modal de pesquisa.
 * Prioriza a busca por coordenadas se o campo estiver preenchido.
 * Utiliza a cidade do projeto ativo como fallback se o campo de cidade estiver vazio.
 */
/**
 * Realiza a busca no mapa com base nos campos do modal de pesquisa.
 * (MODIFICADO) Busca APENAS por coordenadas, conforme solicitado.
 */
function performStructuredSearch() {
  const coordinatesQuery = document.getElementById('searchCoordinates').value.trim();
  
  // Os campos de endereço agora são ignorados
  // const street = document.getElementById('searchStreet').value.trim();
  // const number = document.getElementById('searchNumber').value.trim();
  // const neighborhood = document.getElementById('searchNeighborhood').value.trim();
  // let city = document.getElementById('searchCity').value.trim();

  // Fecha o modal após iniciar a busca
  document.getElementById('searchModal').style.display = 'none';

  // Se o campo de coordenadas estiver preenchido, processa a busca
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
    // Se o campo de coordenadas estiver VAZIO, avisa o usuário.
    showAlert('Dados Insuficientes', 'Por favor, insira as coordenadas para a busca. A busca por endereço está temporariamente desabilitada.');
  }
}

/**
 * Centraliza o mapa na localização encontrada e adiciona um marcador temporário.
 * @param {google.maps.LatLng} location - O objeto LatLng da localização.
 * @param {string} title - O título para o marcador.
 */
function panToLocation(location, title) {
  map.setCenter(location);
  map.setZoom(18); // Zoom mais próximo para ver detalhes da rua

  // Remove o marcador de busca anterior, se existir
  if (searchMarker) {
    searchMarker.setMap(null);
  }

  // Cria um novo marcador para o resultado da busca
  searchMarker = new google.maps.Marker({
    position: location,
    map: map,
    title: title,
    animation: google.maps.Animation.DROP, // Adiciona uma animação
  });

  // (Opcional) Adiciona um InfoWindow para mostrar o endereço/coordenada
  const infowindow = new google.maps.InfoWindow({
    content: `<b>Resultado da Busca:</b><br>${title}`
  });
  infowindow.open(map, searchMarker);

  // ===================================================================
  // == CORREÇÃO ADICIONADA AQUI                                    ==
  // ===================================================================
  
  // 1. Cria uma função de limpeza
  const clearSearchMarker = () => {
      if (searchMarker) {
          searchMarker.setMap(null);
          searchMarker = null;
      }
  };

  // 2. Adiciona um listener (que só roda UMA VEZ) para o mapa
  // Se o usuário clicar em qualquer lugar do mapa, o marcador some.
  google.maps.event.addListenerOnce(map, 'click', clearSearchMarker);

  // 3. Adiciona um listener (que só roda UMA VEZ) para o "X" da InfoWindow
  // Se o usuário fechar a janela, o marcador some.
  google.maps.event.addListenerOnce(infowindow, 'closeclick', clearSearchMarker);
  
  // ===================================================================
  // == FIM DA CORREÇÃO                                             ==
  // ===================================================================
}

// Adicione estas novas funções no final do arquivo script.js

/**
 * Inicia a ferramenta de desenho de polígono ou abre o editor.
 */
function startPolygonTool() {
  if (isDrawingCable || isAddingMarker || isMeasuring) {
    showAlert("Atenção", "Finalize a ação atual antes de desenhar um polígono.");
    return;
  }
  if (!activeFolderId) {
    showAlert("Atenção", "Selecione uma pasta de projeto para salvar o polígono.");
    return;
  }

  isDrawingPolygon = true;
  editingPolygonIndex = null; // Garante que estamos no modo de criação

  const box = document.getElementById('polygonDrawingBox');
  document.getElementById('polygonBoxTitle').textContent = 'Desenhar Polígono';
  document.getElementById('polygonName').value = '';
  document.getElementById('polygonColor').value = '#2196f3';
  document.getElementById('deletePolygonButton').classList.add('hidden');
  box.classList.remove('hidden');

  // Esconde o dropdown
  document.getElementById('toolsDropdown').classList.remove('show');

  if (!drawingManager) {
    drawingManager = new google.maps.drawing.DrawingManager({
      drawingMode: google.maps.drawing.OverlayType.POLYGON,
      drawingControl: false,
      polygonOptions: {
        fillColor: '#2196f3',
        fillOpacity: 0.5,
        strokeWeight: 2,
        strokeColor: '#2196f3',
        clickable: false, // O polígono final será clicável, não o rascunho
        editable: true,
        zIndex: 1
      }
    });
    drawingManager.setMap(map);

    google.maps.event.addListener(drawingManager, 'polygoncomplete', (polygon) => {
      if (tempPolygon) {
        tempPolygon.setMap(null); // Remove o rascunho anterior se houver
      }
      tempPolygon = polygon; // Armazena o novo rascunho
      drawingManager.setDrawingMode(null); // Para de desenhar
    });
  } else {
    drawingManager.setMap(map);
    drawingManager.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
  }
  setMapCursor("crosshair");
}

/**
 * Salva um polígono novo ou atualiza um existente.
 */
function savePolygon() {
  const name = document.getElementById('polygonName').value.trim();
  const color = document.getElementById('polygonColor').value;

  if (!name) {
    showAlert("Erro", "Por favor, dê um nome ao polígono.");
    return;
  }

  let finalPolygon;
  // Se estiver editando um polígono existente
  if (editingPolygonIndex !== null) {
      const polygonInfo = savedPolygons[editingPolygonIndex];
      finalPolygon = polygonInfo.polygonObject;

      polygonInfo.name = name;
      polygonInfo.color = color;
      polygonInfo.path = finalPolygon.getPath().getArray().map(p => ({lat: p.lat(), lng: p.lng()}));

      finalPolygon.setOptions({ fillColor: color, strokeColor: color, editable: false });
      polygonInfo.listItem.querySelector('.item-name').textContent = name;
      polygonInfo.listItem.querySelector('.item-icon').style.backgroundColor = color;

  } else { // Se for um polígono novo
      if (!tempPolygon) {
        showAlert("Erro", "Desenhe um polígono no mapa antes de salvar.");
        return;
      }
      finalPolygon = tempPolygon;
      tempPolygon = null;

      finalPolygon.setOptions({ clickable: true, editable: false, fillColor: color, strokeColor: color });

      const template = document.getElementById('polygon-template');
      const clone = template.content.cloneNode(true);
      const li = clone.querySelector('li');
      enableDragAndDropForItem(li);
      const icon = li.querySelector('.item-icon');
      const nameSpan = li.querySelector('.item-name');
      const visibilityBtn = li.querySelector('.visibility-toggle-btn');

      nameSpan.textContent = name;
      icon.style.backgroundColor = color;

      document.getElementById(activeFolderId).appendChild(li);

      const polygonInfo = {
        folderId: activeFolderId,
        name: name,
        color: color,
        path: finalPolygon.getPath().getArray().map(p => ({lat: p.lat(), lng: p.lng()})),
        polygonObject: finalPolygon,
        listItem: li
      };
      savedPolygons.push(polygonInfo);

      // --- CORREÇÃO PRINCIPAL AQUI ---
      // Agora passamos o objeto 'polygonInfo' para a função de edição, em vez do índice.
      finalPolygon.addListener('click', () => openPolygonEditor(polygonInfo));
      nameSpan.addEventListener('click', () => openPolygonEditor(polygonInfo));
      
      visibilityBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isVisible = finalPolygon.getVisible();
          finalPolygon.setVisible(!isVisible);
          visibilityBtn.dataset.visible = !isVisible;
          visibilityBtn.querySelector('img').src = isVisible ? 'img/Ocultar.png' : 'img/Mostrar.png';
      });
  }

  cancelPolygonDrawing();
}

/**
 * Abre a janela de edição para um polígono salvo.
 * @param {number} index - O índice do polígono no array `savedPolygons`.
 */
function openPolygonEditor(polygonInfo) { // MODIFICADO: Recebe o objeto do polígono diretamente
    if (!polygonInfo) return;

    // Encontra o índice do polígono para poder salvar as edições
    const index = savedPolygons.indexOf(polygonInfo);
    if (index === -1) {
      showAlert("Erro", "Não foi possível encontrar o polígono para edição.");
      return;
    }

    cancelPolygonDrawing();
    cancelCableButton.click();

    editingPolygonIndex = index;
    isDrawingPolygon = true;

    const box = document.getElementById('polygonDrawingBox');
    document.getElementById('polygonBoxTitle').textContent = 'Editar Polígono';
    document.getElementById('polygonName').value = polygonInfo.name;
    document.getElementById('polygonColor').value = polygonInfo.color;
    document.getElementById('deletePolygonButton').classList.remove("hidden");
    box.classList.remove("hidden");

    polygonInfo.polygonObject.setEditable(true);
}

/**
 * Cancela a operação de desenho ou edição de polígono.
 */
function cancelPolygonDrawing() {
  // Desativa o DrawingManager do mapa ANTES de mudar seu modo.
  // Isso impede que ele finalize automaticamente um desenho em andamento.
  if (drawingManager) {
    drawingManager.setMap(null); 
    drawingManager.setDrawingMode(null);
  }

  // Se um polígono temporário (já finalizado, mas não salvo) existir, remova-o.
  if (tempPolygon) {
    tempPolygon.setMap(null); 
    tempPolygon = null;
  }

  // Se estava no modo de edição, reverte as alterações e para a edição.
  if (editingPolygonIndex !== null) {
    const polygonInfo = savedPolygons[editingPolygonIndex];
    if (polygonInfo) {
        polygonInfo.polygonObject.setPath(polygonInfo.path);
        polygonInfo.polygonObject.setEditable(false);
    }
  }

  // Esconde a caixa de ferramentas e reseta as variáveis de estado.
  document.getElementById('polygonDrawingBox').classList.add('hidden');
  setMapCursor("");
  isDrawingPolygon = false;
  editingPolygonIndex = null;
}

/**
 * Altera a propriedade 'clickable' de todos os polígonos no mapa.
 * @param {boolean} isClickable - True para tornar os polígonos clicáveis, false para desativar.
 */
function setAllPolygonsClickable(isClickable) {
    savedPolygons.forEach(polygonInfo => {
        if (polygonInfo.polygonObject) {
            polygonInfo.polygonObject.setOptions({ clickable: isClickable });
        }
    });
}


/**
 * Exclui o polígono que está sendo editado. (VERSÃO CORRIGIDA)
 */
function deletePolygon() {
  if (editingPolygonIndex === null) return;
  
  const polygonInfo = savedPolygons[editingPolygonIndex];
  
  showConfirm('Excluir Polígono', `Tem certeza que deseja excluir "${polygonInfo.name}"?`, () => {
    // 1. Remove o polígono do mapa
    polygonInfo.polygonObject.setMap(null);
    
    // 2. Remove o item da lista na barra lateral
    polygonInfo.listItem.remove();
    
    // 3. Remove o polígono do nosso array de dados
    savedPolygons.splice(editingPolygonIndex, 1);
    
    // 4. Limpa a interface e reseta o estado da ferramenta (A PARTE QUE FALTAVA)
    document.getElementById('polygonDrawingBox').classList.add('hidden');
    setMapCursor("");
    isDrawingPolygon = false;
    editingPolygonIndex = null;

    // Garante que o modo de desenho seja desativado
    if (drawingManager) {
        drawingManager.setDrawingMode(null);
        drawingManager.setMap(null);
    }
  });
}

/**
 * Inicia a ferramenta de régua de medição.
 */
function startRuler() {
  if (isDrawingCable || isAddingMarker || (drawingManager && drawingManager.getMap())) {
    showAlert("Atenção", "Finalize a ação atual antes de usar a régua.");
    return;
  }

  isMeasuring = true;
  document.getElementById('toolsDropdown').classList.remove('show');
  document.getElementById('rulerBox').classList.remove('hidden');
  document.getElementById('rulerDistance').textContent = 'Distância: 0 m';
  setMapCursor('crosshair');

  // Limpa medições anteriores
  stopRuler(false); // false para não esconder a caixa que acabamos de mostrar
  isMeasuring = true; // stopRuler seta para false, então precisamos reativar

  rulerPolyline = new google.maps.Polyline({
    path: [],
    geodesic: true,
    strokeColor: '#FF0000',
    strokeOpacity: 1.0,
    strokeWeight: 3,
    map: map
  });

  // Adiciona o listener de clique no mapa para a régua
  map.addListener('click', handleRulerClick);
}

/**
 * Lida com cada clique no mapa durante a medição.
 * @param {google.maps.MapMouseEvent} event O evento de clique do mapa.
 */
function handleRulerClick(event) {
    if (!isMeasuring) return;

    const path = rulerPolyline.getPath();
    path.push(event.latLng);

    // Adiciona um pequeno marcador no ponto clicado
    const marker = new google.maps.Marker({
        position: event.latLng,
        map: map,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 4,
            fillColor: '#FF0000',
            fillOpacity: 1,
            strokeWeight: 0
        }
    });
    rulerMarkers.push(marker);

    // Calcula e exibe a distância
    const distance = google.maps.geometry.spherical.computeLength(path);
    document.getElementById('rulerDistance').textContent = `Distância: ${distance.toFixed(2)} m`;
}

/**
 * Para a ferramenta de régua e limpa os elementos do mapa.
 * @param {boolean} [hideBox=true] - Se a caixa de informações da régua deve ser escondida.
 */
function stopRuler(hideBox = true) {
  isMeasuring = false;
  setMapCursor('');

  if (hideBox) {
    document.getElementById('rulerBox').classList.add('hidden');
  }

  if (rulerPolyline) {
    rulerPolyline.setMap(null);
    rulerPolyline = null;
  }

  rulerMarkers.forEach(marker => marker.setMap(null));
  rulerMarkers = [];

  // Remove o listener de clique específico da régua
  google.maps.event.clearListeners(map, 'click');
  // Readiciona o listener de clique principal para desenho de cabos
  map.addListener("click", handleMapClick); 
}

// Adicione esta nova função ao seu script.js

/**
 * Mostra ou esconde todos os pontos de controle associados a uma linha de fusão.
 * @param {string} lineId - O ID do elemento <path> da linha.
 * @param {boolean} isVisible - True para mostrar, false para esconder.
 */
function setHandlesVisibility(lineId, isVisible) {
    const handles = document.querySelectorAll(`.line-handle[data-line-id="${lineId}"]`);
    handles.forEach(handle => {
        // Usamos 'style.opacity' para que a transição do CSS ainda funcione
        handle.style.opacity = isVisible ? '1' : '0';
    });
}

// ===================================================================
// == FUNÇÕES PARA CONEXÃO DE FUSÃO
// ===================================================================


// Localize e substitua a função isPortConnected
/**
 * Verifica se uma porta específica já possui uma conexão de fusão.
 * @param {string} portId O ID do elemento da porta a ser verificado.
 * @returns {boolean} True se a porta já estiver conectada, false caso contrário.
 */
function isPortConnected(portId) {
    // Esta busca agora ignora automaticamente a linha que está em edição.
    const existingLines = document.querySelectorAll('#fusion-svg-layer .fusion-line');
    for (const line of existingLines) {
        if (line.dataset.startId === portId || line.dataset.endId === portId) {
            return true; // Encontrou uma conexão
        }
    }
    return false; // Nenhuma conexão encontrada
}

/**
 * Inicia a exportação do projeto ativo para um arquivo KML.
 */

/**
 * Remove caracteres que podem quebrar a estrutura XML/KML.
 * @param {string} text O texto a ser limpo.
 * @returns {string} O texto seguro para ser usado em KML.
 */
function sanitizeForKML(text) {
    if (typeof text !== 'string') {
        return '';
    }
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&apos;');
}


/**
 * Inicia a exportação do projeto ativo para um arquivo KML. (VERSÃO CORRIGIDA E ROBUSTA)
 */
/**
 * Gera o conteúdo KML para uma pasta específica e suas subpastas de forma recursiva.
 * @param {HTMLUListElement} ulElement - O elemento <ul> da pasta a ser processada.
 * @param {object} projectData - Objeto contendo os arrays de marcadores, cabos e polígonos do projeto.
 * @returns {string} - O conteúdo KML para esta pasta.
 */
function generateKmlForFolder(ulElement, projectData) {
    let folderContent = '';
    const toKmlColor = (hex, opacity = 'ff') => {
        if (!hex || hex.length !== 7) return `${opacity}ffffff`;
        const r = hex.substring(1, 3);
        const g = hex.substring(3, 5);
        const b = hex.substring(5, 7);
        return `${opacity}${b}${g}${r}`;
    };

    // Itera sobre os filhos diretos da lista (pastas ou itens)
    for (const childNode of ulElement.children) {
        // CASO 1: É UMA SUBPASTA
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
        // CASO 2: É UM ITEM (MARCADOR, CABO, POLÍGONO)
        else if (childNode.tagName === 'LI') {
            const marker = projectData.markers.find(m => m.listItem === childNode);
            const cable = projectData.cables.find(c => c.item === childNode);
            const polygon = projectData.polygons.find(p => p.listItem === childNode);

            if (polygon) {
                const coords = polygon.path.map(coord => `${coord.lng()},${coord.lat()},0`).join(' ');
                folderContent += `
      <Placemark>
        <name>${sanitizeForKML(polygon.name)}</name>
        <Style><PolyStyle><color>${toKmlColor(polygon.color, '80')}</color></PolyStyle></Style>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>
      </Placemark>`;
            } else if (cable) {
                const coords = cable.path.map(coord => `${coord.lng()},${coord.lat()},0`).join(' ');
                folderContent += `
      <Placemark>
        <name>${sanitizeForKML(cable.name)}</name>
        <Style><LineStyle><color>${toKmlColor(cable.color, 'ff')}</color><width>${cable.width || 3}</width></LineStyle></Style>
        <LineString><coordinates>${coords}</coordinates></LineString>
      </Placemark>`;
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

/**
 * Inicia a exportação do projeto ativo para um arquivo KML, preservando a estrutura de pastas. (VERSÃO ATUALIZADA)
 */
function exportProjectToKML() {
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione um projeto na barra lateral para exportar.");
        return;
    }
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) {
        showAlert("Erro", "Item selecionado não pertence a um projeto.");
        return;
    }

    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    const projectName = projectRootElement.querySelector('.folder-title').dataset.folderName || 'Projeto Exportado';
    const projectData = getProjectItems(projectId);

    if (projectData.markers.length === 0 && projectData.cables.length === 0 && projectData.polygons.length === 0) {
        showAlert("Aviso", "O projeto selecionado está vazio e não possui itens para exportar.");
        return;
    }

    // A função principal agora apenas prepara o KML e chama a função recursiva
    const projectUlElement = projectRootElement.querySelector('ul.subfolders');
    const foldersAndPlacemarks = generateKmlForFolder(projectUlElement, projectData);

    let kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${sanitizeForKML(projectName)}</name>
    ${foldersAndPlacemarks}
  </Document>
</kml>`;

    // Criação e download do arquivo (sem alterações)
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
/**
 * Lida com o arquivo KML selecionado pelo usuário, lê seu conteúdo e o processa.
 * @param {Event} event O evento do input de arquivo.
 */
function handleKmlFileSelect(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const kmlText = e.target.result;
        try {
            const parser = new DOMParser();
            const kmlDoc = parser.parseFromString(kmlText, "text/xml");
            parseAndDisplayKML(kmlDoc);
        } catch (error) {
            showAlert("Erro de Importação", "Não foi possível ler o arquivo KML. Verifique se o arquivo está no formato correto.");
            console.error("Erro ao processar KML:", error);
        }
    };
    reader.readAsText(file);

    // Limpa o valor do input para permitir a seleção do mesmo arquivo novamente
    event.target.value = '';
}

/**
 * Cria programaticamente uma nova pasta na barra lateral.
 * Diferente da função createFolder(), esta não depende de um modal.
 * @param {string} folderName - O nome para a nova pasta.
 * @param {string} parentUlId - O ID do elemento <ul> pai onde a pasta será inserida.
 * @returns {string} - O ID da nova pasta criada.
 */
function createFolderFromKML(folderName, parentUlId) {
    const parentUl = document.getElementById(parentUlId);
    if (!parentUl) {
        console.error(`Elemento pai com ID "${parentUlId}" não encontrado.`);
        return null;
    }

    const folderId = `folder-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const template = document.getElementById('folder-template');
    const clone = template.content.cloneNode(true);

    const wrapperLi = clone.querySelector('.folder-wrapper');
    enableDragAndDropForItem(wrapperLi);
    const titleDiv = clone.querySelector('.folder-title');
    const nameSpan = clone.querySelector('.folder-name-text');
    const subList = clone.querySelector('.subfolders');
    const visibilityBtn = clone.querySelector('.visibility-toggle-btn');

    nameSpan.textContent = folderName;
    subList.id = folderId;
    titleDiv.dataset.folderId = folderId;
    titleDiv.dataset.folderName = folderName;
    titleDiv.dataset.isProject = "false";
    visibilityBtn.dataset.folderId = folderId;

    const toggleIcon = titleDiv.querySelector('.toggle-icon');
    toggleIcon.onclick = (e) => { e.stopPropagation(); toggleFolder(folderId); };
    titleDiv.onclick = (e) => {
        if (e.target.closest('.folder-buttons') || e.target.closest('.toggle-icon')) return;
        e.stopPropagation();
        setActiveFolder(folderId);
    };

    addDropTargetListenersToFolderTitle(titleDiv);
    enableDropOnFolder(subList);
    parentUl.appendChild(wrapperLi);

    return folderId;
}

/**
 * Processa um nó do KML (Documento ou Pasta) de forma recursiva,
 * recriando a sua estrutura e elementos no mapa e na barra lateral.
 * @param {Element} kmlNode - O nó XML do KML a ser processado (ex: <Folder>).
 * @param {string} parentSidebarId - O ID da pasta na barra lateral onde os itens serão inseridos.
 * @returns {number} - A contagem de itens (Placemarks) importados dentro deste nó.
 */
function processKmlNode(kmlNode, parentSidebarId) {
    let itemsImported = 0;

    // Iteramos apenas sobre os filhos diretos do nó atual
    for (const child of kmlNode.children) {
        const nodeName = child.tagName;

        if (nodeName === 'Folder') {
            const folderName = child.querySelector('name')?.textContent || 'Pasta Importada';
            const newFolderId = createFolderFromKML(folderName, parentSidebarId);
            if (newFolderId) {
                // Chamada recursiva para processar o conteúdo da subpasta
                itemsImported += processKmlNode(child, newFolderId);
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

                // Salva o ID da pasta atual antes de modificar
                const currentFolderId = parentSidebarId;
                
                // Cria um marcador genérico com addCustomMarker, mas com a flag "isImported"
                const originalActiveFolder = activeFolderId;
                activeFolderId = currentFolderId; // Define temporariamente a pasta ativa
                
                addCustomMarker(position, {
                    type: 'Importado',
                    name,
                    color: '#ff0000',
                    labelColor: '#ff0000',
                    size: 5,
                    description,
                    isImported: true 
                });
                
                activeFolderId = originalActiveFolder; // Restaura a pasta ativa original
                itemsImported++;
            // Localize este bloco dentro da função processKmlNode e substitua-o
            // Dentro da função processKmlNode, substitua o bloco "else if (line)"
            } else if (line) {
              const coordsText = line.querySelector('coordinates')?.textContent.trim();
              if (!coordsText) continue;
              const path = coordsText.split(/\s+/).filter(c => c).map(pair => {
                  const [lng, lat] = pair.split(',');
                  return new google.maps.LatLng(parseFloat(lat), parseFloat(lng));
              });
              
              const polyline = new google.maps.Polyline({ path, map, strokeColor: '#FFC300', strokeWeight: 3, clickable: true });
              
              const item = document.createElement("li");
              enableDragAndDropForItem(item); // <--- Correção que já fizemos
              item.style.display = 'flex';
              item.style.alignItems = 'center';

              // ===================================================================
              // == INÍCIO DA CORREÇÃO (Botão de Visibilidade)                  ==
              // ===================================================================

              // 1. Cria o <span> para o nome
              const nameSpan = document.createElement("span");
              nameSpan.className = 'item-name';
              nameSpan.style.flexGrow = '1';
              nameSpan.textContent = `${name} (Cabo Importado)`;
              item.appendChild(nameSpan);
              
              // 2. Cria o botão "Ajustar"
              const adjustBtn = document.createElement("button");
              adjustBtn.className = 'adjust-kml-btn';
              adjustBtn.textContent = 'Ajustar Cabo';
              item.appendChild(adjustBtn);
              
              // 3. CRIA O BOTÃO DE VISIBILIDADE (O "OLHO")
              const visibilityBtn = document.createElement("button");
              visibilityBtn.className = 'visibility-toggle-btn item-toggle';
              visibilityBtn.innerHTML = `<img src="img/Mostrar.png" width="16" height="16" alt="Visibilidade">`;
              visibilityBtn.title = 'Ocultar/Exibir item no mapa';
              visibilityBtn.dataset.visible = 'true';
              item.appendChild(visibilityBtn); // Adiciona o botão ao item <li>
              
              // ===================================================================
              // == FIM DA CORREÇÃO                                             ==
              // ===================================================================
              
              document.getElementById(parentSidebarId).appendChild(item);
              
              const newCableInfo = {
                  folderId: parentSidebarId, name, type: 'Cabo Importado', width: 3, color: '#FFC300', path, polyline, item, status: 'Novo',
                  lancamento: 0, reserva: 0, totalLength: Math.round(google.maps.geometry.spherical.computeLength(path)),
                  isImported: true
              };
              
              adjustBtn.onclick = (e) => {
                  e.stopPropagation();
                  openCableEditor(newCableInfo);
              };
              
              polyline.addListener('click', () => openCableEditor(newCableInfo));

              savedCables.push(newCableInfo);

              addCableEventListeners(polyline, savedCables.length - 1);

              // ===================================================================
              // == INÍCIO DA CORREÇÃO (Listener do Botão)                      ==
              // ===================================================================
              // 4. ADICIONA A LÓGICA DE CLIQUE AO BOTÃO DE VISIBILIDADE
              visibilityBtn.onclick = (e) => {
                  e.stopPropagation();
                  const isVisible = newCableInfo.polyline.getVisible();
                  newCableInfo.polyline.setVisible(!isVisible);
                  const iconSrc = isVisible ? 'img/Ocultar.png' : 'img/Mostrar.png';
                  visibilityBtn.querySelector('img').src = iconSrc;
              };
              // ===================================================================
              // == FIM DA CORREÇÃO                                             ==
              // ===================================================================

              itemsImported++;
          } else if (polygon) {
                const coordsText = polygon.querySelector('outerBoundaryIs > LinearRing > coordinates')?.textContent.trim();
                if (!coordsText) continue;

                // Converte as coordenadas KML (lng,lat,alt) para o formato do Google Maps LatLng
                const path = coordsText.split(/\s+/).filter(c => c).map(pair => {
                    const [lng, lat] = pair.split(','); // Ignora a altitude (alt) se houver
                    // Adiciona validação para garantir que lat e lng são números válidos
                    const parsedLat = parseFloat(lat);
                    const parsedLng = parseFloat(lng);
                    if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
                        return new google.maps.LatLng(parsedLat, parsedLng);
                    }
                    return null; // Retorna null para coordenadas inválidas
                }).filter(coord => coord !== null); // Remove quaisquer coordenadas nulas/inválidas

                // Só cria o polígono se houver pelo menos 3 pontos válidos
                if (path.length < 3) {
                    console.warn(`Polígono "${name}" ignorado devido a coordenadas inválidas ou insuficientes.`);
                    continue;
                }


                // Define a cor padrão para importação, mas permite personalização futura se necessário
                const polygonColor = '#C70039'; // Cor padrão para polígonos importados

                // Cria o objeto do polígono no mapa
                const polygonObject = new google.maps.Polygon({
                    paths: path,
                    map: map,
                    fillColor: polygonColor,
                    strokeColor: polygonColor,
                    fillOpacity: 0.5,
                    strokeWeight: 2,
                    clickable: true, // Habilita cliques para edição
                    editable: false   // Começa não editável
                });

                // Cria o item correspondente na barra lateral usando o template
                const template = document.getElementById('polygon-template');
                const clone = template.content.cloneNode(true);
                const li = clone.querySelector('li');
                enableDragAndDropForItem(li);
                const icon = li.querySelector('.item-icon');
                const nameSpan = li.querySelector('.item-name');
                const visibilityBtn = li.querySelector('.visibility-toggle-btn');

                nameSpan.textContent = name;
                icon.style.backgroundColor = polygonColor;
                visibilityBtn.dataset.visible = 'true'; // Define o estado inicial

                // Adiciona o item à pasta correta na barra lateral
                const parentUl = document.getElementById(parentSidebarId);
                 if (parentUl) {
                    parentUl.appendChild(li);
                } else {
                     console.error(`Elemento pai com ID "${parentSidebarId}" não encontrado para o polígono importado "${name}"`);
                     continue; // Pula este polígono se a pasta pai não for encontrada
                 }

                // Cria o objeto de informações completo
                const polygonInfo = {
                    folderId: parentSidebarId,
                    name: name,
                    color: polygonColor,
                    // Salva o path no formato {lat, lng} para consistência com outros polígonos
                    path: path.map(p => ({lat: p.lat(), lng: p.lng()})),
                    polygonObject: polygonObject,
                    listItem: li
                };

                // Adiciona ao array principal de polígonos
                savedPolygons.push(polygonInfo);

                // =============================================================
                // == ADIÇÃO CRÍTICA: Adiciona os listeners para edição aqui ==
                // =============================================================
                // Listener para clique no polígono no MAPA
                polygonObject.addListener('click', () => openPolygonEditor(polygonInfo));
                // Listener para clique no nome do polígono na SIDEBAR
                nameSpan.addEventListener('click', () => openPolygonEditor(polygonInfo));
                // Listener para o botão de visibilidade
                visibilityBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isVisible = polygonObject.getVisible();
                    polygonObject.setVisible(!isVisible);
                    visibilityBtn.dataset.visible = !isVisible;
                    visibilityBtn.querySelector('img').src = !isVisible ? 'img/Mostrar.png' : 'img/Ocultar.png';
                });
                // =============================================================
                // == FIM DA ADIÇÃO CRÍTICA                                  ==
                // =============================================================

                itemsImported++;
            } // Fim do 'else if (polygon)'
        }
    }
    return itemsImported;
}

/**
 * Interpreta o documento KML (XML) e inicia o processo de recriação da sua estrutura. (VERSÃO ATUALIZADA)
 * @param {XMLDocument} kmlDoc O documento KML parseado.
 */
function parseAndDisplayKML(kmlDoc) {
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione um projeto ou uma pasta para importar os dados do KML.");
        return;
    }

    // O nó raiz pode ser <kml> ou <Document>
    const rootNode = kmlDoc.querySelector('Document') || kmlDoc.documentElement;
    
    // Inicia o processo recursivo a partir do nó raiz, inserindo na pasta ativa
    const totalItems = processKmlNode(rootNode, activeFolderId);
    
    showAlert("Importação Concluída", `${totalItems} elementos foram importados, mantendo a estrutura de pastas do arquivo.`);
}

/**
 * Inicia o processo de ajuste de um marcador KML importado,
 * guardando a sua informação e abrindo o modal de seleção de tipo.
 * @param {object} markerInfo O objeto do marcador a ser ajustado.
 */
function startMarkerAdjustment(markerInfo) {
    // Guarda a informação do marcador que estamos a ajustar
    adjustingKmlMarkerInfo = markerInfo;

    // Abre o primeiro passo do fluxo de criação: a seleção do tipo de marcador
    document.getElementById('markerTypeModal').style.display = 'flex';
}

// EM script.js:
// Localize e modifique a função handleCableVertexDragEnd

/**
 * Lida com o final do arrasto de um vértice de cabo durante a edição, aplicando "snap" a marcadores próximos.
 * Esta função só atua nas extremidades do cabo (início e fim). (VERSÃO CORRIGIDA)
 * @param {number} vertexIndex - O índice do vértice que foi arrastado no array cableMarkers.
 */
function handleCableVertexDragEnd(vertexIndex) {
    // Garante que estamos no modo de edição e que o vértice é válido
    if (!isDrawingCable || !cableMarkers[vertexIndex]) {
        return;
    }

    // A lógica de "snap" só se aplica à primeira (0) e à última ponta do cabo
    const isEndpoint = (vertexIndex === 0 || vertexIndex === cableMarkers.length - 1);
    if (!isEndpoint) {
        return;
    }

    const draggedVertex = cableMarkers[vertexIndex];
    const newPosition = draggedVertex.getPosition();

    let closestMarker = null;
    let minDistance = Infinity;

    // Procura o marcador (CEO ou CTO) mais próximo
    markers.forEach(markerInfo => {
        // Só considera marcadores válidos para ancoragem
        if (markerInfo.type === "CEO" || markerInfo.type === "CTO" || markerInfo.type === "RESERVA") {
            const distance = google.maps.geometry.spherical.computeDistanceBetween(newPosition, markerInfo.marker.getPosition());
            if (distance < minDistance) {
                minDistance = distance;
                closestMarker = markerInfo;
            }
        }
    });

    // Se um marcador foi encontrado a uma distância de até 20 metros, "ancora" o cabo
    if (closestMarker && minDistance < 20) {
        const markerPosition = closestMarker.marker.getPosition();

        // Move o marcador de edição do cabo para a posição exata do CEO/CTO
        draggedVertex.setPosition(markerPosition);

        // =======================================================================
        // == CORREÇÃO ADICIONADA AQUI ==
        // =======================================================================
        // Chama explicitamente a função para atualizar o array cablePath e a
        // linha visual (polyline) COM a nova posição ancorada.
        updatePolylineFromMarkers();
        // =======================================================================
        // == FIM DA CORREÇÃO ==
        // =======================================================================

        showAlert("Ancorado!", `A ponta do cabo foi vinculada ao marcador "${closestMarker.name}".`);
    }
    // (Opcional) Se você quiser que a linha seja redesenhada mesmo se não houver snap,
    // você pode chamar updatePolylineFromMarkers() fora do 'if' também, mas
    // geralmente ela já é chamada durante o 'drag', então pode ser redundante.
    // else {
    //    updatePolylineFromMarkers(); // Garante atualização mesmo sem snap
    // }
}

/**
 * Busca projetos no Firestore com base nos filtros fornecidos pelo usuário.
 */
function searchProjectsInFirestore() {
    const currentUser = auth.currentUser;
    if (!currentUser) {
        showAlert("Erro", "Você precisa estar logado para buscar projetos.");
        return;
    }

    // Pega os valores dos campos de filtro
    const nameFilter = document.getElementById('searchProjectName').value.trim();
    const cityFilter = document.getElementById('searchProjectCity').value.trim();
    const neighborhoodFilter = document.getElementById('searchProjectNeighborhood').value.trim();

    // Valida se pelo menos um campo foi preenchido
    if (!nameFilter && !cityFilter && !neighborhoodFilter) {
        showAlert("Atenção", "Preencha pelo menos um campo para realizar a busca.");
        return;
    }

    const listElement = document.getElementById('saved-projects-list');
    listElement.innerHTML = '<li>Buscando projetos...</li>';

    // Constrói a consulta no Firestore dinamicamente
    let query = db.collection("users").doc(currentUser.uid).collection("projects");

    if (nameFilter) {
        query = query.where('projectName', '==', nameFilter);
    }
    if (cityFilter) {
        // Os dados de cidade e bairro estão dentro do objeto 'sidebar' no banco de dados
        query = query.where('sidebar.city', '==', cityFilter);
    }
    if (neighborhoodFilter) {
        query = query.where('sidebar.neighborhood', '==', neighborhoodFilter);
    }

    // Executa a consulta
    query.get()
        .then((querySnapshot) => {
            listElement.innerHTML = '';
            if (querySnapshot.empty) {
                listElement.innerHTML = '<li>Nenhum projeto encontrado com os filtros informados.</li>';
                return;
            }
            
            querySnapshot.forEach((doc) => {
                const project = doc.data();
                const projectId = doc.id;
                const li = document.createElement('li');
                
                li.innerHTML = `
                    <div style="padding: 15px; border: 1px solid #ddd; border-radius: 5px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                        <span><strong>${project.projectName}</strong> <br><small>${project.sidebar.city || ''} - ${project.sidebar.neighborhood || ''}</small></span>
                        <button class="load-project-btn" style="padding: 8px 12px; background-color: #4CAF50;">Carregar</button>
                    </div>
                `;
                listElement.appendChild(li);

                // Adiciona o listener para o botão de carregar específico deste resultado
                li.querySelector('.load-project-btn').addEventListener('click', () => {
                    if (document.getElementById(projectId)) {
                        showAlert("Aviso", `O projeto "${project.projectName}" já está carregado na barra lateral.`);
                        return;
                    }
                    document.getElementById('loadProjectModal').style.display = 'none';
                    loadAndDisplayProject(projectId, project);
                });
            });
        })
        .catch((error) => {
            console.error("Erro ao buscar projetos: ", error);
            listElement.innerHTML = '<li>Ocorreu um erro ao buscar os projetos.</li>';
            showAlert("Erro de Consulta", "A busca falhou. Isso pode exigir a criação de um índice no banco de dados. Verifique o console do navegador (F12) para um link de criação de índice.");
        });
}

// EM script.js:
// Localize e substitua a sua função invertCableDirection inteira por esta versão

/**
 * Inverte a direção (o array de pontos) de um cabo que está sendo editado.
 * Recalcula a reserva técnica e atualiza a interface. (VERSÃO ATUALIZADA COM VERIFICAÇÃO)
 */
function invertCableDirection() {
    if (editingCableIndex === null) {
        showAlert("Erro", "Nenhum cabo selecionado para inverter.");
        return;
    }

    const cableToInvert = savedCables[editingCableIndex];

    // =======================================================================
    // == INÍCIO DA NOVA VERIFICAÇÃO: Verifica se o cabo está em ALGUM plano de fusão
    // =======================================================================
    const usage = checkCableUsageInFusionPlans(cableToInvert);

    // Se a verificação retornar que o cabo está presente em pelo menos um plano ('isInPlan')...
    if (usage.isInPlan) {
        // ...mostra um alerta bloqueando a ação e informa o usuário.
        showAlert(
            "Ação Bloqueada",
            `Este cabo não pode ser invertido porque está em uso no plano de fusão da(s) caixa(s): ${usage.locations.join(', ')}. Remova o cabo do plano de fusão antes de inverter.`
        );
        // Interrompe a função, impedindo a inversão.
        return;
    }
    // =======================================================================
    // == FIM DA NOVA VERIFICAÇÃO
    // =======================================================================

    // Se o cabo NÃO está em nenhum plano, prossegue com a confirmação e a inversão
    showConfirm('Inverter Cabo', 'Tem certeza que deseja inverter a direção deste cabo? Isso irá recalcular a reserva técnica com base nas novas pontas.', () => {
        // Lógica de inversão (permanece a mesma)
        cableToInvert.path.reverse();
        cablePath = [...cableToInvert.path];

        cableMarkers.forEach(marker => marker.setMap(null));
        cableMarkers = [];

        cablePath.forEach((position, i) => {
            let markerLabel = null;
            let markerIconScale = 5;

            if (i === 0) {
                markerLabel = "A";
                markerIconScale = 7;
            } else if (i === cablePath.length - 1) {
                markerLabel = "B";
                markerIconScale = 7;
            }

            const marker = new google.maps.Marker({
                position, map, draggable: true,
                label: { text: markerLabel, color: "black", fontWeight: "bold", fontSize: "12px" },
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: markerIconScale, fillColor: "#ffffff", fillOpacity: 1, strokeColor: "#000000", strokeWeight: 1.5 },
            });

            marker.addListener("drag", updatePolylineFromMarkers);
            marker.addListener("dragend", () => handleCableVertexDragEnd(i));
              marker.addListener("dblclick", () => {
                const index = cableMarkers.indexOf(marker);
                if (index !== -1) {
                    cableMarkers.splice(index, 1)[0].setMap(null);
                    openCableEditor(cableToInvert);
                }
            });
            cableMarkers.push(marker);
        });

        updatePolylineFromMarkers();

        cableToInvert.lancamento = cableDistance.lancamento;
        cableToInvert.reserva = cableDistance.reserva;
        cableToInvert.totalLength = cableDistance.total;

        cableToInvert.item.querySelector('.item-name').textContent = `${cableToInvert.name} (${cableToInvert.status}) - ${cableToInvert.totalLength}m`;

        showAlert("Sucesso", "A direção do cabo foi invertida.");
    });
}

document.addEventListener('DOMContentLoaded', () => {
   document.getElementById("invertCableButton").addEventListener("click", invertCableDirection);
});

function updateSvgLayerSize() {
    const canvas = document.getElementById('fusionCanvas');
    const svgLayer = document.getElementById('fusion-svg-layer');
    if (canvas && svgLayer) {
        // Define o tamanho do SVG para ser igual ao tamanho total do conteúdo do canvas
        svgLayer.style.width = canvas.scrollWidth + 'px';
        svgLayer.style.height = canvas.scrollHeight + 'px';
    }
}

/**
 * (NOVA FUNÇÃO)
 * A partir da ID de uma porta, retorna uma descrição legível de sua origem.
 * Ex: "Cabo Principal, Fibra 5" ou "Splitter 1:8, Porta 3"
 * @param {string} portId A ID do elemento da porta (ex: 'cable-Cabo-1-fiber-5').
 * @returns {string} Uma descrição formatada da conexão.
 */
function getConnectionDescription(portId) {
  const portElement = document.getElementById(portId);
  if (!portElement) return 'Desconhecido';

  const parentComponent = portElement.closest('.cable-element, .splitter-element');
  if (!parentComponent) return 'Componente Desconhecido';

  // Se a porta pertence a um cabo
  if (parentComponent.classList.contains('cable-element')) {
    const cableName = parentComponent.dataset.cableName || 'Cabo';
    const fiberNumber = portId.split('-').pop(); // Pega o número no final da ID
    return `${cableName}, Fibra ${fiberNumber}`;
  }

  // Se a porta pertence a um splitter
  if (parentComponent.classList.contains('splitter-element')) {
    const splitterLabel = parentComponent.querySelector('.splitter-body span')?.textContent || 'Splitter';
    const portLabel = portElement.querySelector('.splitter-port-number')?.textContent || 'Porta';
    return `${splitterLabel}, ${portLabel}`;
  }

  return 'Item Desconhecido';
}// Localize e substitua a função repackAllElements


// Localize e substitua a função repackAllElements
function repackAllElements() {
    const canvas = document.getElementById('fusionCanvas');
    if (!canvas) return;
    const verticalMargin = 20;

    const leftColumnElements = [];
    const rightColumnElements = [];

    // Pega todos os elementos na sua ordem atual no HTML.
    const allElementsInOrder = Array.from(canvas.children).filter(el =>
        el.classList.contains('splitter-element') || el.classList.contains('cable-element')
    );

    // CORREÇÃO: Agrupa os elementos em colunas com base na propriedade de estilo 'right'.
    allElementsInOrder.forEach(el => {
        if (el.style.right && el.style.right !== 'auto') {
            rightColumnElements.push(el);
        } else {
            leftColumnElements.push(el);
        }
    });

    // Função interna para aplicar as novas posições verticais (sem alterações).
    const repackColumn = (elements) => {
        let currentTop = verticalMargin;
        elements.forEach(el => {
            el.style.transition = 'top 0.2s ease-in-out';
            el.style.top = `${currentTop}px`;
            currentTop += el.offsetHeight + verticalMargin;
        });
    };

    // Reorganiza a coluna da esquerda e a da direita separadamente.
    repackColumn(leftColumnElements);
    repackColumn(rightColumnElements);

    setTimeout(() => {
        updateAllConnections();
        updateSvgLayerSize();
        allElementsInOrder.forEach(el => el.style.transition = '');
    }, 200);
}

/**
 * (NOVA FUNÇÃO)
 * Verifica se um componente (cabo ou splitter) tem alguma linha de fusão conectada a ele.
 * @param {HTMLElement} componentElement O elemento do componente (splitter-element ou cable-element).
 * @returns {boolean} True se o componente tiver pelo menos uma fusão, false caso contrário.
 */
function isComponentFused(componentElement) {
    if (!componentElement) return false;

    // 1. Pega todas as portas/fibras conectáveis deste componente
    const portIds = Array.from(componentElement.querySelectorAll('.connectable')).map(p => p.id);

    if (portIds.length === 0) return false; // Componente sem portas não pode ter fusão

    // 2. Pega todas as linhas de fusão ativas no canvas
    const allFusionLines = document.querySelectorAll('#fusion-svg-layer .fusion-line');

    // 3. Verifica se alguma linha está conectada a alguma das portas do componente
    for (const line of allFusionLines) {
        if (portIds.includes(line.dataset.startId) || portIds.includes(line.dataset.endId)) {
            return true; // Encontrou uma fusão!
        }
    }

    return false; // Nenhuma fusão encontrada
}

/**
 * Calcula a contagem individual de cada letra e número de uma lista de nomes.
 * @param {string[]} ctoNames - Um array de nomes de CTOs.
 * @returns {object} - Um objeto onde as chaves são caracteres (A-Z, 0-9) e os valores são suas contagens.
 */
function calculateStickerCounts(ctoNames) {
  const counts = {};
  const charRegex = /[A-Z0-9]/; // Expressão regular para letras (maiúsculas) e números

  ctoNames.forEach(name => {
    if (typeof name !== 'string') return; // Pula se o nome não for uma string
    
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

/**
 * Renderiza a contagem de adesivos calculada no modal de adesivos.
 * @param {object} counts - O objeto de contagem retornado por calculateStickerCounts.
 */
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

/**
 * (NOVA FUNÇÃO)
 * Varre todos os planos de fusão salvos e atualiza o nome de um cabo.
 * Isso é chamado DEPOIS que um cabo é renomeado no editor principal.
 * @param {string} oldName - O nome original do cabo.
 * @param {string} newName - O novo nome do cabo.
 */
function updateCableNameInAllFusionPlans(oldName, newName) {
    if (oldName === newName) return; // Nenhum trabalho a fazer

    console.log(`Atualizando nome do cabo em todos os planos: de "${oldName}" para "${newName}"`);

    markers.forEach(markerInfo => {
        // 1. Verifica se o marcador tem um plano de fusão
        if ((markerInfo.type === 'CTO' || markerInfo.type === 'CEO') && markerInfo.fusionPlan) {
            let planUpdated = false;
            try {
                const planData = JSON.parse(markerInfo.fusionPlan);
                if (!planData.elements) return; // Pula se o plano não tiver elementos

                // 2. Cria um DOM temporário para manipular o HTML salvo
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = planData.elements;

                // 3. Encontra o elemento do cabo pelo NOME ANTIGO
                // Usamos querySelectorAll para o caso (improvável) de o mesmo cabo estar 2x
                const cableElements = tempDiv.querySelectorAll(`.cable-element[data-cable-name="${oldName}"]`);

                if (cableElements.length > 0) {
                    cableElements.forEach(cableElement => {
                        // 4. Atualiza os dados no DOM temporário
                        cableElement.dataset.cableName = newName; // Atualiza o dataset
                        const titleSpan = cableElement.querySelector('.cable-header span');
                        if (titleSpan) {
                            // Substitui apenas a primeira ocorrência do nome antigo, preservando a (Ponta A/B)
                            titleSpan.textContent = titleSpan.textContent.replace(oldName, newName);
                        }
                    });
                    planUpdated = true;
                }

                // 5. Se o plano foi alterado, salva-o de volta no marcador
                if (planUpdated) {
                    planData.elements = tempDiv.innerHTML;
                    markerInfo.fusionPlan = JSON.stringify(planData);
                    console.log(`Plano de fusão da caixa "${markerInfo.name}" atualizado.`);

                    // 6. (CRUCIAL) Se este plano de fusão estiver ABERTO AGORA, atualiza o DOM ao vivo
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