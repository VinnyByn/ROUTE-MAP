//Lógica de autenticação
//Objeto de configuração do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDj2QaP7aTsJTqD1J-ZgJwEjJgGhRZhArk",
    authDomain: "routemap-21.firebaseapp.com",
    projectId: "routemap-21",
    storageBucket: "routemap-21.firebasestorage.app",
    messagingSenderId: "855979634466",
    appId: "1:855979634466:web:ded98c3c3680c9c7e0ff7b"
};
//Inicializa o Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
//Verifica o estado de autenticação do usuário
auth.onAuthStateChanged((user) => {
    if (user) {
        //Se existe um 'user', significa que ele está logado e a página pode continuar carregando normalmente.
        console.log('Usuário autenticado:', user.email);
    } else {
        //Se não existe um 'user', ele não está logado e a página é redirecionada imediatamente para a tela de login.
        console.log('Nenhum usuário autenticado. Redirecionando para login...');
        window.location.href = 'login.html';
    }
});

let map; //Instância principal do Google Maps
let isAddingMarker = false; //Indica que o usuário está no modo colocar marcador
let pendingSplitterInfo = null; //Armazenamento dos dados dos splitter antes de colocar
let selectedMarkerType = ""; //Tipo de marcador selecionado
let cablePath = []; //Array de coordenadas do cabo desenhado
let cablePolyline = null; //Linha temporária no mapa
let isDrawingCable = false; //Indica se a ferramenta de cabo está ativa
let cableDistance = { lancamento: 0, reserva: 0, total: 0 }; //Armazenamento do comprimento dos cabos
let activeFolderId = null; //Id da pasta ou do projeto que está selecionado na barra lateral
let cableMarkers = []; //Marcador auxiliar usado ao editar e desenhar cabos
let savedCables = []; //Array principal contendo todos os cabos salvos
let editingCableIndex = null; //Íncice do cabo que está sendo salvo
let currentCableStatus = "Novo"; //Status para cabo novo
let selectedSplitterInfo = { type: "", connector: "" }; //Dados do splitter escolhido
let selectedMarkerData = { //Modelo com configuração para novos marcadores
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
let markers = []; //Array com todos os marcadores no mapa
let editingMarkerInfo = null; //Marcador que está sendo editado
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
let activeLineForAction = null; //Linha de fusão selecionada para edição - exclusão
let isEditingLine = false;
let cableInfoBox; //Informação do cabo
let searchMarker = null; //Marcador com o resultado da busca
let drawingManager; //Gerenciador de desenho do Google para os polígonos
let isMeasuring = false; //Régua
let rulerPolyline; //Linha visual da régua
let rulerMarkers = []; //Array com os pontos da régua
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

//Função para exibir um alerta personalizado com título e mensaggem
function showAlert(title, message) {
  const alertModal = document.getElementById('alertModal');
  document.getElementById('alertModalTitle').textContent = title;
  document.getElementById('alertModalMessage').textContent = message;
  alertModal.style.display = 'flex';
}

//Função para exibir uma confirmação com callback
function showConfirm(title, message, onConfirm) {
  const confirmModal = document.getElementById('confirmModal');
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalMessage').textContent = message;
  const confirmButton = document.getElementById('confirmModalConfirmButton');
  const newConfirmButton = confirmButton.cloneNode(true);
  confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);
  newConfirmButton.addEventListener('click', () => {
    confirmModal.style.display = 'none';
    onConfirm(); //Função executada se o usuário clicar em "Sim"
  });
  confirmModal.style.display = 'flex';
}

//Coleta todos os dados e salva no Firebase Firestore
function saveProjectToFirestore() {
    const currentUser = auth.currentUser;
    //Verificação de segurança
    if (!currentUser) {
        showAlert("Erro", "Você precisa estar logado para salvar um projeto.");
        return;
    }
    //Se existe um projeto selecionado na barra lateral
    const activeElement = document.getElementById(activeFolderId);
    if (!activeElement) {
        showAlert("Atenção", "Por favor, selecione um projeto ou um item dentro de um projeto para salvar.");
        return;
    }
    //Pega o elemento raiz do projeto - pasta principal
    const projectRootElement = activeElement.closest('.folder');
    if (!projectRootElement) {
        showAlert("Erro", "Não foi possível encontrar o projeto principal. Selecione um item e tente novamente.");
        return;
    }
    //Coleta dos dados do projeto
    const projectTitleDiv = projectRootElement.querySelector('.folder-title');
    const projectUl = projectRootElement.querySelector('ul');
    const projectId = projectTitleDiv.dataset.folderId;
    const projectName = projectTitleDiv.dataset.folderName;
    showAlert("Salvando...", `O projeto "${projectName}" está sendo salvo no banco de dados.`);
    //Serialização da barra lateral - Transforma o HTML em um objeto JSON
    const sidebarStructure = {
        id: projectUl.id,
        name: projectTitleDiv.dataset.folderName,
        city: projectTitleDiv.dataset.folderCity || null,
        neighborhood: projectTitleDiv.dataset.folderNeighborhood || null,
        type: projectTitleDiv.dataset.folderType,
        isProject: true,
        children: getSidebarStructureAsJSON(projectUl)
    };
    //Pega os marcadores, cabos e polígonos pertecentes ao projeto selecionado
    const allFolderIds = getAllDescendantFolderIds(projectId);
    //Converte objetos do Google Maps em JSON para o banco de dados
    const projectMarkers = markers.filter(m => allFolderIds.includes(m.folderId)).map(serializeMarker);
    const projectCables = savedCables.filter(c => allFolderIds.includes(c.folderId)).map(serializeCable);
    const projectPolygons = savedPolygons.filter(p => allFolderIds.includes(p.folderId)).map(serializePolygon);
    //Objeto final
    const projectData = {
        userId: currentUser.uid, //Vincula ao usuário
        projectName: projectName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        sidebar: sidebarStructure, 
        markers: projectMarkers,
        cables: projectCables,
        polygons: projectPolygons,
        bom: projectBoms[projectId] || null,
        observations: projectObservations[projectId] || null
    };
    //Envi para o firestore
    db.collection("users").doc(currentUser.uid).collection("projects").doc(projectId).set(projectData)
        .then(() => {
            showAlert("Sucesso!", `Projeto "${projectName}" salvo com sucesso.`);
        })
        .catch((error) => {
            console.error("Erro ao salvar projeto: ", error);
            showAlert("Erro", "Ocorreu um erro ao salvar o projeto. Verifique o console para mais detalhes.");
        });
}

//Busca o projeto do usuário no firestore e exibe a janela de carregamento
function loadProjectsFromFirestore() {
     //verificação do usuário logado
    const currentUser = auth.currentUser;
    if (!currentUser) {
        showAlert("Erro", "Você precisa estar logado para carregar projetos.");
        return;
    }
    //Preparação da interface, com a jenela de carregamento e a lista de projetos salvos
    const modal = document.getElementById('loadProjectModal');
    const listElement = document.getElementById('saved-projects-list');
    //Mensagem de carregando enquanto busca o projeto no banco de dados
    listElement.innerHTML = '<li>Carregando...</li>';
    modal.style.display = 'flex';
    //Consulta no banco de dados
    //Busca na coleção projects dentro do documento do usuário, ordenado por de criação - mais recente primeiro
    db.collection("users").doc(currentUser.uid).collection("projects").orderBy("createdAt", "desc").get().then((querySnapshot) => {
        listElement.innerHTML = '';
        if (querySnapshot.empty) {
            listElement.innerHTML = '<li>Nenhum projeto salvo encontrado.</li>';
            return;
        }
        //Para cada projeto encontrado
        querySnapshot.forEach((doc) => {
            //Dados do projeto
            const project = doc.data();
            const projectId = doc.id;
            const li = document.createElement('li');
            //Preenchimento da janela com o projeto buscado
            li.innerHTML = `
                <div style="padding: 15px; border: 1px solid #ddd; border-radius: 5px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                    <span><strong>${project.projectName}</strong> <br><small>Salvo em: ${project.createdAt ? project.createdAt.toDate().toLocaleString() : 'Data indisponível'}</small></span>
                    <button class="load-project-btn" style="padding: 8px 12px;">Carregar</button>
                </div>`;
            listElement.appendChild(li);
            //Configuração do botão carregar
            const loadButton = li.querySelector('.load-project-btn');
            loadButton.addEventListener('click', () => {
                console.log(`Botão 'Carregar' clicado para o projeto: ${project.projectName} (ID: ${projectId})`);
                //Verificação se o projeto já está aberto na barra lateral
                if (document.getElementById(projectId)) {showAlert("Aviso", `O projeto "${project.projectName}" já está carregado.`);
                    modal.style.display = 'none';
                    return;
                }
                //Se não estiver, fecha a janela e chama a função que controi o projeto na barra lateral
                modal.style.display = 'none';
                loadAndDisplayProject(projectId, project);
            });
        });
    })
    //Tratamento de erros
    .catch((error) => {
        console.error("Erro ao carregar lista de projetos: ", error);
        listElement.innerHTML = '<li>Ocorreu um erro ao buscar os projetos.</li>';
    });
}

/*Limpa a barra lateral e o mapa, removendo todos os elementos visuais*/
function clearWorkspace() {
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
    //Remove a seleção de pasta
    activeFolderId = null;
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
    rebuildSidebarFromJSON([projectData.sidebar], sidebar);
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
    }
    //Recria a lista de material
    if (projectData.bom) {
        projectBoms[projectId] = projectData.bom;
    }
    //Carrega as observações salvas
    if (projectData.observations) {
        projectObservations[projectId] = projectData.observations;
    }
    showAlert("Sucesso", `Projeto "${projectData.projectName}" carregado!`);
}

//Recontrói um polígono salvo no mapa e na barra lateral
function rebuildPolygon(data) {
    //Converte as coordenadas para objetos de latitude e longitudo de Google Maps
    const googleMapsPath = data.path.map(p => new google.maps.LatLng(p.lat, p.lng));
    //Cria polígono visualmente no mapa
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
    //Cria o polígono na barra lateral
    const template = document.getElementById('polygon-template');
    const clone = template.content.cloneNode(true);
    const li = clone.querySelector('li');
    li.querySelector('.item-name').textContent = data.name;
    li.querySelector('.item-icon').style.backgroundColor = data.color;
    //Insere o item na pasta correta
    const parentUl = document.getElementById(data.folderId);
    if (parentUl) {
      parentUl.appendChild(li);
    } else {
      console.error(`Elemento pai com ID "${data.folderId}" não encontrado para o polígono "${data.name}"`);
    }
    //Armazena a referência completa na memória do sistema
    const polygonInfo = { ...data, path: googleMapsPath, polygonObject: polygon, listItem: li };
    savedPolygons.push(polygonInfo);
    //Abrindo o editor no mapa
    polygon.addListener('click', () => openPolygonEditor(polygonInfo));
    //Abrindo o editor na barra lateral
    li.querySelector('.item-name').addEventListener('click', () => openPolygonEditor(polygonInfo));
    //Configuração do botão olho - Visibilidade
    li.querySelector('.visibility-toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = polygon.getVisible();
        polygon.setVisible(!isVisible);
        e.currentTarget.querySelector('img').src = isVisible ? 'img/Ocultar.png' : 'img/Mostrar.png';
    });
}

//Converte o objeto de marcador para o formato JSON, salvando os dados no banco de dados Firestore
function serializeMarker(markerInfo) {
    //Extrai o visual do Google Maps
    const marker = markerInfo.marker;
    //Posição do marcador (latitude e longitude)
    const position = marker.getPosition();
    //Retorna com os dados essenciais a serem salvos
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

//Converte o objeto de cabo para o formato JSON, salvando os dados no banco de dados Firestore
function serializeCable(cableInfo) {
    //Retorna com os dados essenciais a serem salvos
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

//Converte o objeto de polígono para o formato JSON, salvando os dados no banco de dados Firestore
function serializePolygon(polygonInfo) {
    //Obtem o arry de coordenadas atual
    const currentPath = polygonInfo.polygonObject.getPath().getArray();
    //Retorna com os dados essenciais a serem salvos
    return {
        folderId: polygonInfo.folderId,
        name: polygonInfo.name,
        color: polygonInfo.color,
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
        const visibilityBtn = clone.querySelector('.visibility-toggle-btn');
        nameSpan.textContent = nodeData.name;
        subList.id = nodeData.id;
        titleDiv.dataset.folderId = nodeData.id;
        titleDiv.dataset.folderName = nodeData.name;
        if(visibilityBtn) visibilityBtn.dataset.folderId = nodeData.id;
        //Se for projeto restaura cidade, bairro e tipo
        if (nodeData.isProject) {
            titleDiv.dataset.folderCity = nodeData.city;
            titleDiv.dataset.folderNeighborhood = nodeData.neighborhood;
            titleDiv.dataset.folderType = nodeData.type;
        }
        //Evento de expandir e recolher as pastas
        const toggleIcon = titleDiv.querySelector('.toggle-icon');
        toggleIcon.onclick = (e) => { e.stopPropagation(); toggleFolder(nodeData.id); };
        //Pasta selecionada-ativa
        titleDiv.onclick = (e) => {
            if (e.target.closest('.folder-buttons') || e.target.closest('.toggle-icon')) return;
            e.stopPropagation();
            setActiveFolder(nodeData.id);
        };
        //Ajuste no arrastar e soltar
        addDropTargetListenersToFolderTitle(titleDiv);
        titleDiv.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            titleDiv.classList.remove('dragover-target');
            const subUl = document.getElementById(titleDiv.dataset.folderId);
            if (subUl && !subUl.contains(e.relatedTarget)) {
                subUl.classList.remove('dragover');
            }
        });
        titleDiv.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            titleDiv.classList.remove('dragover-target');
            const subUl = document.getElementById(titleDiv.dataset.folderId);
            if (subUl) {
                subUl.classList.remove('dragover');
                handleDropOnFolder(e, subUl);
            }
        });
        enableDropOnFolder(subList);
        //Recursão
        if (nodeData.children && nodeData.children.length > 0) {
            rebuildSidebarFromJSON(nodeData.children, subList);
        }
        //Finalização e adiciona ao DOM
        const finalElement = clone.querySelector('.folder') || clone.querySelector('.folder-wrapper');
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
    //Cria o elemento da lista
    const li = document.createElement("li");
    enableDragAndDropForItem(li);
    //Configura o nome e o botão de visibilidade
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
    //Insere o item no pasta correta
    const parentUl = document.getElementById(data.folderId);
    if(parentUl) {
      parentUl.appendChild(li);
    } else {
      console.error(`Elemento pai com ID "${data.folderId}" não encontrado para o marcador "${data.name}"`);
    }
    //Salva a referência na memória global
    const markerInfo = { ...data, position: position, marker: marker, listItem: li };
    markers.push(markerInfo);
    updateMarkerAppearance(markerInfo);
    //Define o comportamento do clique no marcador, com o modo desenho
    marker.addListener("click", () => {
        if (isDrawingCable) {
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
            openMarkerEditor(markerInfo);
        }
    });
    //Interações na sidebar no botão de visibilidade
    nameSpan.addEventListener("click", () => openMarkerEditor(markerInfo));
    visibilityBtn.onclick = (e) => {
      e.stopPropagation();
      const isVisible = marker.getVisible();
      marker.setVisible(!isVisible);
      visibilityBtn.dataset.visible = !isVisible;
      visibilityBtn.querySelector('img').src = !isVisible ? 'img/Mostrar.png' : 'img/Ocultar.png';
    };
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
    //Cria o item na lista lateral
    const item = document.createElement("li");
    const nameSpan = document.createElement("span");
    enableDragAndDropForItem(item);
    nameSpan.className = 'item-name';
    nameSpan.textContent = `${data.name} (${data.status}) - ${data.totalLength}m`;
    nameSpan.style.color = data.color;
    nameSpan.style.cursor = "pointer";
    nameSpan.style.flexGrow = '1';
    //Botão de visibilidade na sidebar
    const visibilityBtn = document.createElement("button");
    visibilityBtn.className = 'visibility-toggle-btn item-toggle';
    visibilityBtn.innerHTML = `<img src="img/Mostrar.png" width="16" height="16" alt="Visibilidade">`;
    visibilityBtn.dataset.visible = 'true';
    item.appendChild(nameSpan);
    item.appendChild(visibilityBtn);
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    //Insere o item na pasta correta
    const parentUl = document.getElementById(data.folderId);
    if (parentUl) {
        parentUl.appendChild(item);
    } else {
        console.error(`Falha ao carregar o cabo "${data.name}". A pasta-pai (ID: ${data.folderId}) não foi encontrada no DOM.`);
        polyline.setMap(null); 
        return;
    }
    //Salva na memória global
    const cableInfo = { ...data, path: googleMapsPath, polyline: polyline, item: item };
    savedCables.push(cableInfo);
    //Configura eventos de interção do cabo
    const realIndex = savedCables.length - 1;
    nameSpan.addEventListener("click", () => openCableEditor(cableInfo));
    polyline.addListener("click", () => openCableEditor(cableInfo));
    addCableEventListeners(polyline, realIndex);
    //Botão de visibilidade
    visibilityBtn.onclick = (e) => {
      e.stopPropagation();
      const isVisible = polyline.getVisible();
      polyline.setVisible(!isVisible);
      visibilityBtn.dataset.visible = !isVisible;
      visibilityBtn.querySelector('img').src = !isVisible ? 'img/Mostrar.png' : 'img/Ocultar.png';
    };
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
        fillOpacity: 0.5,
        strokeWeight: 2,
        clickable: true,
        editable: false
    });
    //Cria o item na sidebar
    const template = document.getElementById('polygon-template');
    const clone = template.content.cloneNode(true);
    const li = clone.querySelector('li');
    enableDragAndDropForItem(li);
    li.querySelector('.item-name').textContent = data.name;
    li.querySelector('.item-icon').style.backgroundColor = data.color;
    //Insere o item na pasta correta
    const parentUl = document.getElementById(data.folderId);
    if (parentUl) {
      parentUl.appendChild(li);
    } else {
      console.error(`Elemento pai com ID "${data.folderId}" não encontrado para o polígono "${data.name}"`);
    }
    //Salva na memória global
    const index = savedPolygons.length;
    const polygonInfo = { ...data, path: googleMapsPath, polygonObject: polygon, listItem: li };
    savedPolygons.push(polygonInfo);
    //Configura eventos de interação
    polygon.addListener('click', () => openPolygonEditor(index));
    li.querySelector('.item-name').addEventListener('click', () => openPolygonEditor(index));
    //Botão de visibilidade
    li.querySelector('.visibility-toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = polygon.getVisible();
        polygon.setVisible(!isVisible);
        e.currentTarget.querySelector('img').src = isVisible ? 'img/Ocultar.png' : 'img/Mostrar.png';
    });
}

function initMap() {
    //Inicialização do mapa
    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: -20.1394, lng: -44.8872 },
        zoom: 10,
    });
    cableInfoBox = document.getElementById('cableInfoBox');
    //Listeners de interação do mapa
    map.addListener("click", handleMapClick);
    map.addListener("dblclick", () => {
        if (isDrawingCable && cablePath.length >= 2) {
            showAlert("Aviso", "Clique em 'Salvar Cabo' para finalizar.");
        }
    });
    //Persistência de dados - Firestore
    document.getElementById('saveProjectButton').addEventListener('click', saveProjectToFirestore);
    document.getElementById('loadProjectButton').addEventListener('click', () => {
        //Limpa campos e abre modal de carregar
        document.getElementById('searchProjectName').value = '';
        document.getElementById('searchProjectCity').value = '';
        document.getElementById('searchProjectNeighborhood').value = '';
        document.getElementById('saved-projects-list').innerHTML = '';
        document.getElementById('loadProjectModal').style.display = 'flex';
    });
    document.getElementById('searchProjectsButton').addEventListener('click', searchProjectsInFirestore);
    document.getElementById('closeLoadProjectModal').addEventListener('click', () => {
        document.getElementById('loadProjectModal').style.display = 'none';
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
    createProjectButton.addEventListener("click", () => {
        document.getElementById("projectName").value = "";
        document.getElementById("projectCity").value = "";
        document.getElementById("projectNeighborhood").value = "";
        document.getElementById("projectType").value = "TCR";
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
    materialListButton.addEventListener("click", () => {
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
            bomState = JSON.parse(JSON.stringify(projectBoms[projectId]));
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
    //Ação nos cabos
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
    //Modais de seleção de status e tipos
    const markerTypeModal = document.getElementById("markerTypeModal");
    const closeTypeModalButton = document.getElementById("closeTypeModal");
    closeTypeModalButton.addEventListener("click", () => {
        markerTypeModal.style.display = "none";
    });
    const cableStatusSelectionModal = document.getElementById("cableStatusSelectionModal");
    const closeCableStatusModal = document.getElementById("closeCableStatusModal");
    closeCableStatusModal.addEventListener("click", () => {
        cableStatusSelectionModal.style.display = "none";
    });
    const ctoStatusSelectionModal = document.getElementById("ctoStatusSelectionModal");
    const closeCtoStatusModal = document.getElementById("closeCtoStatusModal");
    closeCtoStatusModal.addEventListener("click", () => {
        ctoStatusSelectionModal.style.display = "none";
    });
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
        if (cordaoQty > 0) addMaterialToBom('CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2m', cordaoQty);
        if (oltQty > 0) addMaterialToBom('PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)', oltQty);
        if (sfpQty > 0) addMaterialToBom('MÓDULO SFP C+ PARA PLACA OLT LINE ANYPON ZTE', sfpQty);
        if (projectBoms[projectId]) {
            bomState = JSON.parse(JSON.stringify(projectBoms[projectId]));
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
    //Modal genérico de marcador
    document.getElementById("closeModal").addEventListener("click", () => {
        resetMarkerModal();
    });
    //Modal e canvas de fusão
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
    //Salvar o plano de fusão
    saveFusionPlanButton.addEventListener("click", () => {
        if (activeMarkerForFusion) {
            const canvas = document.getElementById("fusionCanvas");
            const svgLayer = document.getElementById("fusion-svg-layer");
            const elementsContainer = document.createElement('div');
            canvas.querySelectorAll('.cable-element, .splitter-element').forEach(el => {
                elementsContainer.appendChild(el.cloneNode(true));
            });
            const elementsHTML = elementsContainer.innerHTML;
            const svgHTML = svgLayer.innerHTML;
            const planData = {
                elements: elementsHTML, 
                svg: svgHTML,           
            };
            //Quantidade de bandeja
            if (activeMarkerForFusion.type === 'CEO') {
                planData.trayQuantity = document.getElementById('trayKitQuantity').value || 0;
            }
            activeMarkerForFusion.fusionPlan = JSON.stringify(planData);
            showAlert("Sucesso", "Plano de fusão salvo com sucesso!");
        }
        fusionModal.style.display = "none";
        activeMarkerForFusion = null;
    });
    //Adição de elementos na fusão
    document.getElementById("addCableToFusion").addEventListener("click", () => {
        openCableSelectionModal();
    });
    const splitterModal = document.getElementById("splitterSelectionModal");
    const closeSplitterModal = document.getElementById("closeSplitterModal");
    document.getElementById("addSplitterToFusion").addEventListener("click", () => {
        selectedSplitterInfo = { type: "", connector: "" };
        document.getElementById("splitterTypeModal").style.display = "flex";
    });
    closeSplitterModal.addEventListener("click", () => {
        splitterModal.style.display = "none";
    });
    //Modais de subtipos de splitter
    const splitterTypeModal = document.getElementById("splitterTypeModal");
    const splitterConnectorModal = document.getElementById("splitterConnectorModal");
    document.getElementById("closeSplitterTypeModal").addEventListener('click', () => splitterTypeModal.style.display = 'none');
    document.getElementById("closeSplitterConnectorModal").addEventListener('click', () => splitterConnectorModal.style.display = 'none');
    //Fluxo de seleção de splitter
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
    //Listeners para tipo de splitter
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
    //Listeners apra conctor de splitter
    splitterConnectorModal.querySelectorAll(".datacenter-option").forEach(option => {
        option.addEventListener("click", () => {
            const connector = option.getAttribute("data-connector");
            selectedSplitterInfo.connector = connector;
            splitterConnectorModal.style.display = "none";
            showFinalSplitterModal('atendimento');
        });
    });
    //Seleção final do modelo de splitter
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
    //Seleção de status do splitter e adição ao canvas
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

    //Modal de seleção de cabo
    const cableSelectionModal = document.getElementById("cableSelectionModal");
    const closeCableSelectionModal = document.getElementById("closeCableSelectionModal");
    closeCableSelectionModal.addEventListener("click", () => {
        cableSelectionModal.style.display = "none";
    });
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
    });
    //Ações gerais e sidebar
    document.getElementById("deleteMarkerButton").addEventListener("click", deleteEditingMarker);
    //Eventos de menu, visibilidade, edição e exclusão
    document.getElementById("sidebar").addEventListener('click', (e) => {
        const actionToggleButton = e.target.closest('.item-actions-toggle-btn');
        //Menu de ação - Três pontos
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
        //Identificação dos botões de ação
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
    //Controle do dropdowns e ferramentas de mapa
    function setupDropdownInteractions() {
        //Fecha dropdowns ao clicar fora
        window.addEventListener('click', (event) => {
            if (!event.target.closest('.dropdown')) {
                document.querySelectorAll('.dropdown-content.show').forEach(openDropdown => {
                    openDropdown.classList.remove('show');
                });
            }
        });
        //Toggle dos botões da barra superior
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
    //Ferramentas: Polígono, régua e Logout
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
    //Redimensionamento da sidebar
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
        document.getElementById('observationsTextarea').value = projectObservations[projectId] || '';
        observationsModal.style.display = 'flex';
    });
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
        projectObservations[projectId] = newText;
        showAlert("Observação Salva", "Sua observação foi salva. Lembre-se de salvar o projeto principal para mantê-la no banco de dados.");
        observationsModal.style.display = 'none';
    });
}

//Adiciona o splitter no canvas
function addSplitterToCanvas(status) {
    if (!pendingSplitterInfo) return;
    const { label, outputCount, type, connector } = pendingSplitterInfo;
    //Verifica se é um item novo e se há um projeto ativo/selecionado para contabilizar os materiais
    if (status === "Novo" && activeFolderId) {
        const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
        if (projectRootElement) {
            const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
            //Inicializa a BOM do projeto se não existir
            if (!projectBoms[projectId]) {
                calculateBomState();
                projectBoms[projectId] = JSON.parse(JSON.stringify(bomState));
            }
            //Adiciona o próprio splitter à lista
            const splitterMaterialName = `Splitter ${label.replace(':', '/')}`;
            const splitterPriceInfo = MATERIAL_PRICES[splitterMaterialName] || { price: 0, category: 'Fusão' };
            if (!projectBoms[projectId][splitterMaterialName]) {
                projectBoms[projectId][splitterMaterialName] = { quantity: 0, type: 'un', unitPrice: splitterPriceInfo.price, category: 'Fusão', removed: false };
            }
            projectBoms[projectId][splitterMaterialName].quantity += 1;
            let adapterMaterialName = '';
            //Se for de Atendimento, adiciona também os adaptadores
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
            //Mostra um alerta final e claro para o usuário
            if (adapterMaterialName) {
                showAlert("Materiais Adicionados", `"${splitterMaterialName}" e ${outputCount}x "${adapterMaterialName}" foram adicionados à lista.`);
            } else {
                showAlert("Material Adicionado", `"${splitterMaterialName}" foi adicionado à Lista de Materiais.`);
            }
        }
    }
    //Renderização visual do canvas
    const canvas = document.getElementById("fusionCanvas");
    const placeholder = canvas.querySelector(".canvas-placeholder");
    if (placeholder) {
        placeholder.remove();
    }
    //Cria um elemento DOM e aplica classes de estilo
    const splitterElement = createInteractiveSplitter(label, outputCount, status);
    splitterElement.classList.add(
        type === "Fusão" ? "splitter-fusao" : "splitter-atendimento"
    );
    if (type === "Atendimento" && connector === "UPC") {
        splitterElement.classList.add("splitter-upc");
    }
    //Reorganiza o layout e limpa os pendentes
    repackAllElements();
    pendingSplitterInfo = null;
}

//Verifica se dois elementos DOM estão se sobrepondo
function checkCollision(el1, el2) {
    //Obtem as dimensões e posição relativa à viewport
    const rect1 = el1.getBoundingClientRect();
    const rect2 = el2.getBoundingClientRect();
    //Retorna true se houver colisão e inverte a lógica
    return !(
        rect1.right < rect2.left ||
        rect1.left > rect2.right ||
        rect1.bottom < rect2.top ||
        rect1.top > rect2.bottom
    );
}

//Reorganização vertigcal automático do canvas
function repackAllElements() {
    const canvas = document.getElementById('fusionCanvas');
    if (!canvas) return;
    const verticalMargin = 20;
    //Agrupa elementos baseados na sua posição horizontal - coluna
    const elementsByColumn = new Map();
    const allElements = canvas.querySelectorAll('.splitter-element, .cable-element');
    allElements.forEach(el => {
        const columnKey = el.offsetLeft;
        if (!elementsByColumn.has(columnKey)) {
            elementsByColumn.set(columnKey, []);
        }
        elementsByColumn.get(columnKey).push(el);
    });
    //Reorganiza verticalmente os elementos dentro de cada coluna
    elementsByColumn.forEach(columnElements => {
        let currentTop = verticalMargin;
        //Empinha os elementos calculando o top com base na altura acumulada
        columnElements.forEach(el => {
            el.style.transition = 'top 0.2s ease-in-out';
            el.style.top = `${currentTop}px`;
            currentTop += el.offsetHeight + verticalMargin;
        });
    });
    //Atualiza as conexões SVG após o termino da animação de reposicionamento
    setTimeout(() => {
        updateAllConnections();
        updateSvgLayerSize();
        allElements.forEach(el => el.style.transition = '');
    }, 200);
}

//Eclusão de splitter e atualização de materiais
function handleDeleteSplitter(deleteButton) {
    //Identificação do elemento
    const splitterElement = deleteButton.closest('.splitter-element');
    if (!splitterElement) return;
    const status = splitterElement.dataset.status;
    const type = splitterElement.classList.contains('splitter-fusao') ? 'Fusão' : 'Atendimento';
    //Atualização da lista de material
    //Remove materiais da lista apenas se o splitter for novo e houver projeto ativo
    if (status === 'Novo' && activeFolderId) {
        const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
        if (projectRootElement) {
            const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
            const labelElement = splitterElement.querySelector('.splitter-body span');
            if (labelElement && projectBoms[projectId]) {
                //Decrementa a quantidade do próprio splitter
                const label = labelElement.textContent.trim();
                const splitterMaterialName = `Splitter ${label.replace(':', '/')}`;
                if (projectBoms[projectId][splitterMaterialName] && projectBoms[projectId][splitterMaterialName].quantity > 0) {
                    projectBoms[projectId][splitterMaterialName].quantity -= 1;
                }
                //Decrementa adaptadores - atendimento
                let adapterMaterialName = '';
                if (type === 'Atendimento' && activeMarkerForFusion) {
                    const isPredial = activeMarkerForFusion.isPredial || false;
                    const connector = label.includes('APC') ? 'APC' : 'UPC';
                    const ratioMatch = label.match(/1:(\d+)/);
                    const outputCount = ratioMatch ? parseInt(ratioMatch[1], 10) : 0;
                    //Seleciona o adaptados correto
                    if (isPredial) {
                        adapterMaterialName = (connector === 'APC') ? "ADAPTADOR SC/APC SEM ABAS (PASSANTE)" : "ADAPTADOR SC/UPC SEM ABAS (PASSANTE)";
                    } else {
                        adapterMaterialName = (connector === 'APC') ? "ADAPTADOR SC/APC COM ABAS (PASSANTE)" : "ADAPTADOR SC/UPC COM ABAS (PASSANTE)";
                    }
                    //Remove a quantidade igual ao número de saídas
                    if (outputCount > 0 && projectBoms[projectId][adapterMaterialName] && projectBoms[projectId][adapterMaterialName].quantity > 0) {
                        projectBoms[projectId][adapterMaterialName].quantity -= outputCount;
                    }
                }
                //Feedback visual ao usuário
                if (adapterMaterialName) {
                    showAlert("Materiais Removidos", `"${splitterMaterialName}" e seus adaptadores correspondentes foram removidos.`);
                } else {
                    showAlert("Material Removido", `"${splitterMaterialName}" foi removido da lista.`);
                }
            }
        }
    }
    //Remoção do DOM e reorganização
    splitterElement.remove();
    repackAllElements();
}

//Remoção de cabos no plano de fusão
function handleDeleteCableFromFusion(deleteButton) {
    //Identifica o cabo e coleta o IDs de suas fibras
    const cableElement = deleteButton.closest('.cable-element');
    if (!cableElement) return;
    const fiberIdsToRemove = Array.from(cableElement.querySelectorAll('.fiber-row.connectable')).map(fiber => fiber.id);
    //Limpeza de fusões
    const svgLayer = document.getElementById('fusion-svg-layer');
    if (svgLayer && fiberIdsToRemove.length > 0) {
        const allFusionLines = svgLayer.querySelectorAll('.fusion-line');
        allFusionLines.forEach(line => {
            const startId = line.dataset.startId;
            const endId = line.dataset.endId;
            //Se a linha conecta a este cabo, remove a linha visual e baixa o material
            if (fiberIdsToRemove.includes(startId) || fiberIdsToRemove.includes(endId)) {
                const lineId = line.id;
                line.remove();
                if (lineId) {
                    svgLayer.querySelectorAll(`.line-handle[data-line-id="${lineId}"]`).forEach(handle => handle.remove());
                }
                removeMaterialFromBom("TUBETE PROTETOR DE EMENDA OPTICA", 1);
            }
        });
    }
    //Remove o elemento do DOM e reoganiza o layout vertical
    cableElement.remove();
    repackAllElements();
    showAlert("Cabo Removido", "O cabo e suas fusões associadas foram removidos do plano.");
}

//Verificação de uso de fusão do cabo
function checkCableUsageInFusionPlans(cableInfo) {
    //Inicialização e validação
    const usage = { isInPlan: false, hasFusions: false, locations: [] };
    if (!cableInfo) {
        console.log("checkCableUsageInFusionPlans: cableInfo é nulo.");
        return usage;
    }
    const cableNameToFind = cableInfo.name.trim();
    console.log(`checkCableUsageInFusionPlans: Verificando uso do cabo "${cableNameToFind}"`);
    //Interação sobre as caixas
    const projectMarkers = markers.filter(m => m.type === 'CEO' || m.type === 'CTO');
    for (const markerInfo of projectMarkers) {
        if (markerInfo.fusionPlan) {
            console.log(` -> Verificando plano da caixa "${markerInfo.name}"`);
            try {
                //Plano salvo
                const planData = JSON.parse(markerInfo.fusionPlan);
                if (!planData.elements || !planData.svg) {
                    console.log(`    Plano da caixa "${markerInfo.name}" inválido. Pulando.`);
                    continue;
                }
                //Busca do cabo no plano
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = planData.elements;
                let cableElementInPlan = null;
                const savedCableElements = tempDiv.querySelectorAll('.cable-element');
                console.log(`    Procurando por "${cableNameToFind}" entre ${savedCableElements.length} cabos salvos no plano.`);
                for (const savedEl of savedCableElements) {
                    const savedName = savedEl.dataset.cableName;
                    if (savedName && savedName.trim() === cableNameToFind) {
                        cableElementInPlan = savedEl;
                        console.log(`    !!!! CABO "${cableNameToFind}" ENCONTRADO (comparando nomes) no plano da caixa "${markerInfo.name}" !!!!`);
                        break;
                    } else {
                         console.log(`       -> Comparando com: "${savedName ? savedName.trim() : 'NOME INDEFINIDO'}" - Não corresponde.`);
                    }
                }
                //Verifica as fusões
                if (cableElementInPlan) {
                    usage.isInPlan = true;
                    if (!usage.locations.includes(markerInfo.name)) {
                        usage.locations.push(markerInfo.name);
                    }
                    //Analisa o SVG para ser se há linha conectadas as fibras desse cabo
                    const svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svgContainer.innerHTML = planData.svg;
                    if (svgContainer) {
                        const fiberIds = Array.from(cableElementInPlan.querySelectorAll('.fiber-row')).map(f => f.id);
                        const fusionLines = svgContainer.querySelectorAll('.fusion-line');
                        for (const line of fusionLines) {
                            //Se encontrar qualquer fusão envonveldo este cabo retorna true
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

//Remoção de cabos no plano de fusão
function removeCableFromSavedFusionPlans(cableName, markerNames) {
    markers.forEach(markerInfo => {
        if (markerNames.includes(markerInfo.name) && markerInfo.fusionPlan) {
            try {
                const planData = JSON.parse(markerInfo.fusionPlan);
                if (!planData.canvas) return;
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = planData.canvas;
                const cableElementToRemove = tempDiv.querySelector(`.cable-element[data-cable-name="${cableName}"]`);
                //Se encontrar o cabo remove-o e atualiza o JSON do plano
                if (cableElementToRemove) {
                    cableElementToRemove.remove();
                    markerInfo.fusionPlan = JSON.stringify({ canvas: tempDiv.innerHTML });
                    console.log(`Cabo "${cableName}" removido do plano de fusão da caixa "${markerInfo.name}".`);
                }
            } catch(e) {
                console.error(`Erro ao remover o cabo do plano de fusão da caixa "${markerInfo.name}":`, e);
            }
        }
    });
}

//Remoção do material da BOM
function removeMaterialFromBom(materialName, quantity) {
    if (!activeFolderId) return;
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
    const message = `Tem certeza que deseja excluir o projeto "${projectName}" e TODOS os seus conteúdos? Esta ação não pode ser desfeita.`;
    showConfirm('Excluir Projeto', message, () => {
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
        showAlert("Sucesso", `Projeto "${projectName}" excluído com sucesso.`);
    });
}

//Exclusão de pasta e conteúdo
function deleteFolder(folderId, folderElement, folderName) {
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

function makeDraggable(element) {
    
}

//Seleção de cabos conectados para fusão
function openCableSelectionModal() {
        if (!activeMarkerForFusion) {
        showAlert("Erro", "Nenhum marcador ativo para o plano de fusão.");
        return;
    }
    const markerPosition = activeMarkerForFusion.marker.getPosition();
    const listContainer = document.getElementById("connected-cables-list");
    listContainer.innerHTML = "";
    let cablesFound = false;
    //Filtra cabos que já estão no canvas para evitar duplicidade
    const canvas = document.getElementById("fusionCanvas");
    const existingCableNames = Array.from(canvas.querySelectorAll(".cable-element")).map(el => el.dataset.cableName).filter(name => name);
    savedCables.forEach((cable) => {
        //Pula cabos sem nome ou já adicionados
        if (!cable.name || existingCableNames.includes(cable.name)) {
            return;
        }
        if (!cable.path || cable.path.length < 1) return;
        //Verifica a proximidade geográfica
        const startPoint = cable.path[0];
        const endPoint = cable.path[cable.path.length - 1];
        const isConnected = (google.maps.geometry.spherical.computeDistanceBetween(markerPosition, startPoint) < 0.1) || (google.maps.geometry.spherical.computeDistanceBetween(markerPosition, endPoint) < 0.1);
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
            //Ação ao selecionar o cabo
            cableOptionDiv.addEventListener("click", () => {
                const placeholder = canvas.querySelector(".canvas-placeholder");
                if (placeholder) placeholder.remove();
                //Defini se é entrada ou saída
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

//Criação visual de cabos no canvas de fusão
function createInteractiveCable(cableObject, role) {
    //Cálculo de fibras e grupos
    const fiberType = getFiberType(cableObject.type);
    const fiberCount = fiberType ? parseInt(fiberType.split("-")[1], 10) : 0;
    const numGroups = Math.ceil(fiberCount / 12);
    //Elemento container principal
    const cableContainer = document.createElement("div");
    cableContainer.className = "cable-element";
    cableContainer.dataset.cableName = cableObject.name;
    //Configuração visual entrada saída
    const sideClass = role === 'entrada' ? 'cable-entrada' : 'cable-saida';
    const label = role === 'entrada' ? '(Ponta B - Entrada)' : '(Ponta A - Saída)';
    cableContainer.classList.add(sideClass);
    if (role === 'entrada') {
        cableContainer.style.left = '20px';
    } else {
        cableContainer.style.right = '20px';
    }
    //Cabeçãlho do cabo
    const header = document.createElement("div");
    header.className = "cable-header";
    const headerContent = document.createElement('div');
    headerContent.style.cssText = 'display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; width: 100%;';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = `${cableObject.name} ${label}`;
    titleSpan.style.whiteSpace = 'normal';
    titleSpan.style.wordBreak = 'break-word';
    titleSpan.style.paddingRight = '5px';
    //Adiciona checkbox de kit derivação se for saída e CEO
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
    //Botão de movimentação
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
    //Renderização das fibras
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
        //Fibras individuais
        for (let fiberIndex = 0; fiberIndex < 12; fiberIndex++) {
            const absoluteFiberNumber = groupIndex * 12 + fiberIndex + 1;
            if (absoluteFiberNumber > fiberCount) break;
            const fiberRow = document.createElement("div");
            fiberRow.className = "fiber-row connectable";
            fiberRow.id = `cable-${cableObject.name.replace(/\s+/g, '-')}-fiber-${absoluteFiberNumber}`;
            fiberRow.textContent = `Fibra ${absoluteFiberNumber}`;
            const color = ABNT_FIBER_COLORS[fiberIndex];
            fiberRow.style.backgroundColor = color;
            if (color === '#ffffff' || color === '#ffc107') {
                fiberRow.style.color = '#333';
                fiberRow.style.textShadow = 'none'; 
            }

            fibersContainer.appendChild(fiberRow);
        }
    }
    cableContainer.appendChild(fibersContainer);
    //Botão de excluir cabo
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-component-btn';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.onclick = () => handleDeleteCableFromFusion(deleteBtn);
    cableContainer.appendChild(deleteBtn);
    //Listeners e ativação
    upButton.addEventListener('click', () => moveCable(cableContainer, 'up'));
    downButton.addEventListener('click', () => moveCable(cableContainer, 'down'));
    makeDraggable(cableContainer);
    return cableContainer;
}

//Movimentação vertical de cabos
function moveCable(cableElement, direction) {
    const parent = cableElement.parentNode;
    if (!parent) return;
    //Verifica se o elemento está na coluna da direita ou esquerda
    const isRightColumn = cableElement.style.right && cableElement.style.right !== 'auto';
    if (direction === 'up') {
        const previousSibling = cableElement.previousElementSibling;
        if (previousSibling) {
            const siblingIsRightColumn = previousSibling.style.right && previousSibling.style.right !== 'auto';
            if (isRightColumn === siblingIsRightColumn) {
                parent.insertBefore(cableElement, previousSibling);
            }
        }
    } else if (direction === 'down') {
        const nextSibling = cableElement.nextElementSibling;
        if (nextSibling) {
            const siblingIsRightColumn = nextSibling.style.right && nextSibling.style.right !== 'auto';
            if (isRightColumn === siblingIsRightColumn) { 
                parent.insertBefore(nextSibling, cableElement);
            }
        }
    }
    //Reorganiza o layout vertical após a troca
    repackAllElements();
}

//Movimentação vertical dos Splitters
function moveSplitterVertical(splitterElement, direction) {
    const parent = splitterElement.parentNode;
    if (!parent) return;
    const isRightColumn = splitterElement.style.right && splitterElement.style.right !== 'auto';
    //
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

//Posicionamento lateral de splitter
function setSplitterSide(splitterElement, side) {
    const canvas = document.getElementById('fusionCanvas');
    if (!canvas) return;
    const lanePosition = '20px';
    //Reseta posiçãoes para evitar conflito
    splitterElement.style.right = 'auto';
    splitterElement.style.left = 'auto';
    splitterElement.style.transform = '';
    if (side === 'left') {
        splitterElement.style.left = lanePosition;
    } else if (side === 'right') {
        splitterElement.style.right = lanePosition;
    }
    //Tenta posicionar o splitter no topo e desce até encontrar um espaço livre, anti colisão
    const verticalMargin = 20;
    let topPosition = 20;
    while (true) {
        let collisionDetected = false;
        splitterElement.style.top = `${topPosition}px`;
        //Compara com todos os outros elementos do canvas
        const existingElements = Array.from(canvas.querySelectorAll('.splitter-element, .cable-element')).filter(el => el !== splitterElement);
        for (const existingEl of existingElements) {
            if (checkCollision(splitterElement, existingEl)) {
                //Se colidir, move o topo para baixo do elemento obstrutor
                topPosition = existingEl.offsetTop + existingEl.offsetHeight + verticalMargin;
                collisionDetected = true;
                break;
            }
        }
        if (!collisionDetected) {
            break;
        }
    }
    repackAllElements();
}

//Criação visual de splitter no canvas de fusão
function createInteractiveSplitter(label, outputCount, status) {
    //Container principal e id
    const splitterContainer = document.createElement("div");
    splitterContainer.className = "splitter-element";
    const uniqueSplitterId = `splitter-${label.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now()}`;
    splitterContainer.id = uniqueSplitterId;
    if (status) {
        splitterContainer.dataset.status = status;
    }
    //Porta de entrada
    const inputSide = document.createElement("div");
    inputSide.className = "splitter-input";
    const inputPort = document.createElement("div");
    inputPort.className = "splitter-port-row connectable";
    inputPort.id = `${uniqueSplitterId}-input-port`;
    inputPort.innerHTML = `<span class="splitter-port-number">Entrada</span>`;
    inputSide.appendChild(inputPort);
    //Corpo central e botões de controle
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
    //Geração dinâmica de portas de saída
    const outputSide = document.createElement("div");
    outputSide.className = "splitter-outputs";
    for (let i = 1; i <= outputCount; i++) {
        const outputPort = document.createElement("div");
        outputPort.className = "splitter-port-row connectable";
        outputPort.id = `${uniqueSplitterId}-output-${i}`;
        outputPort.innerHTML = `<span class="splitter-port-number">Porta ${i}</span>`;
        outputSide.appendChild(outputPort);
    }
    //Montagem e botão de exclusão
    splitterContainer.appendChild(inputSide);
    splitterContainer.appendChild(body);
    splitterContainer.appendChild(outputSide);
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-component-btn';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.onclick = () => handleDeleteSplitter(deleteBtn);
    splitterContainer.appendChild(deleteBtn);
    //Listeners de navegação
    upButton.addEventListener('click', (e) => { e.stopPropagation(); moveSplitterVertical(splitterContainer, 'up'); });
    downButton.addEventListener('click', (e) => { e.stopPropagation(); moveSplitterVertical(splitterContainer, 'down'); });
    leftButton.addEventListener('click', (e) => { e.stopPropagation(); setSplitterSide(splitterContainer, 'left'); });
    rightButton.addEventListener('click', (e) => { e.stopPropagation(); setSplitterSide(splitterContainer, 'right'); });
    //Lógica de posicionamento anti colisão
    const canvas = document.getElementById('fusionCanvas');
    const lanePosition = '20px';
    splitterContainer.style.left = lanePosition;
    splitterContainer.style.transform = 'none';
    splitterContainer.style.visibility = 'hidden'; 
    canvas.appendChild(splitterContainer); 
    const verticalMargin = 20; 
    let topPosition = 20;
    //Encontrar espaços livre verticalmente
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

// Controle de cursor do mapa
function setMapCursor(cursor) {
    const mapContainer = document.getElementById("map");
    const layers = mapContainer.querySelectorAll("div, canvas");
    //Aplica o cursor forçadamente a todas as camadas do mapa
    layers.forEach((el) => {
        el.style.cursor = cursor || "";
    });
}

//Ativação do arrastar e soltar para itens
function enableDragAndDropForItem(itemElement) {
    //Evita registar listeners duplicados
    if (itemElement.classList.contains('draggable')) {
        return;
    }
    itemElement.draggable = true;
    itemElement.classList.add("draggable");
    //Inicio do arraste
    itemElement.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        e.dataTransfer.setData("text/plain", "");
        e.dataTransfer.effectAllowed = "move";
        window.draggedItem = itemElement;
        window.draggedItemSourceProject = itemElement.closest('.folder');
        window.dropWasSuccessful = false; 
        document.body.classList.add("is-dragging-globally");
        itemElement.style.opacity = '0.5'; 
        itemElement.classList.add("is-being-dragged");
    });
    //Fim do arraste
    itemElement.addEventListener("dragend", () => {
        if (window.dropWasSuccessful) {
            itemElement.style.transition = "background-color 0.3s";
            itemElement.style.backgroundColor = "#b2ebf2";
            setTimeout(() => {
                if(itemElement) {
                itemElement.style.backgroundColor = ""; 
                itemElement.style.transition = "";
                }
            }, 600);
        }
        document.body.classList.remove("is-dragging-globally");
        itemElement.classList.remove("is-being-dragged");
        itemElement.style.opacity = '1';
        document.querySelectorAll('.folder-title.dragover-target').forEach(title => {
            title.classList.remove('dragover-target');
        });
        document.querySelectorAll('.subfolders.dragover').forEach(ul => {
            ul.classList.remove('dragover');
        });
        window.draggedItem = null;
        window.draggedItemSourceProject = null;
        window.dropWasSuccessful = false; // Reseta a flag para o próximo arraste
    });
}

//Salva o estado do projeto após o arraste
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
    //Extração dos metadados DOM
    const projectTitleDiv = projectRootElement.querySelector('.folder-title');
    const projectUl = projectRootElement.querySelector('ul.subfolders'); // Garante que é o UL principal
    if (!projectTitleDiv || !projectUl) {
        console.error("Elemento de projeto inválido. Faltando .folder-title or ul.subfolders.", projectRootElement);
        return;
    }
    const projectId = projectTitleDiv.dataset.folderId;
    const projectName = projectTitleDiv.dataset.folderName;
    console.log(`Salvando projeto (via D&D): ${projectName} (ID: ${projectId})`);
    //Reconstrução da estrutura da sidebar JSOn
    const sidebarStructure = {
        id: projectUl.id,
        name: projectTitleDiv.dataset.folderName,
        city: projectTitleDiv.dataset.folderCity || null,
        neighborhood: projectTitleDiv.dataset.folderNeighborhood || null,
        type: projectTitleDiv.dataset.folderType,
        isProject: true,
        children: getSidebarStructureAsJSON(projectUl)
    };
    //Filtra e serializa apenas os elementos que pertencem ao projeto
    const allFolderIds = getAllDescendantFolderIds(projectId);
    const projectMarkers = markers.filter(m => allFolderIds.includes(m.folderId)).map(serializeMarker);
    const projectCables = savedCables.filter(c => allFolderIds.includes(c.folderId)).map(serializeCable);
    const projectPolygons = savedPolygons.filter(p => allFolderIds.includes(p.folderId)).map(serializePolygon);
    //Monta o objeto final
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
    db.collection("users").doc(currentUser.uid).collection("projects").doc(projectId).set(projectData).then(() => {
        console.log(`Projeto "${projectName}" salvo com sucesso (via D&D).`);
    })
    .catch((error) => {
        console.error(`Erro ao salvar projeto "${projectName}": `, error);
        showAlert("Erro de D&D", `Ocorreu um erro ao salvar o projeto "${projectName}".`);
    });
}

//Evento drop em pastas
function handleDropOnFolder(e, destinationUl) {
    //Recupera referências globais do item arrastado
    const draggedItem = window.draggedItem;
    const sourceProjectElement = window.draggedItemSourceProject;
    if (!draggedItem || !destinationUl) {
        window.dropWasSuccessful = false;
        return;
    }
    //Previne a recursividade
    if (draggedItem.contains(destinationUl)) {
        showAlert("Erro", "Não é possível mover uma pasta para dentro dela mesma.");
        window.dropWasSuccessful = false;
        return;
    }
    const destinationProjectElement = destinationUl.closest('.folder');
    //Identifica se é um Item de mapa
    let itemData = markers.find(m => m.listItem === draggedItem) || savedCables.find(c => c.item === draggedItem) || savedPolygons.find(p => p.listItem === draggedItem);
    //É um item
    if (itemData) {
        itemData.folderId = destinationUl.id;
        destinationUl.appendChild(draggedItem);
        saveProjectElement(destinationProjectElement);
        if (sourceProjectElement && sourceProjectElement !== destinationProjectElement) {
            saveProjectElement(sourceProjectElement);
        }
    //É uma pasta
    } else if (draggedItem.classList.contains('folder') || draggedItem.classList.contains('folder-wrapper')) {
        destinationUl.appendChild(draggedItem);
        saveProjectElement(destinationProjectElement);
        if (sourceProjectElement && sourceProjectElement !== destinationProjectElement) {
            saveProjectElement(sourceProjectElement);
        }
    }
    window.dropWasSuccessful = true; 
}

//Configura título da pasta como zona de drop
function addDropTargetListenersToFolderTitle(titleDiv) {
    //Arrastando sobre o título
    titleDiv.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        titleDiv.classList.add('dragover-target');
        const subUl = document.getElementById(titleDiv.dataset.folderId);
        if (subUl) {
            subUl.classList.add('dragover');
        }
    });
    //Saindo da área do título
    titleDiv.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        titleDiv.classList.remove('dragover-target');
        const subUl = document.getElementById(titleDiv.dataset.folderId);
        if (subUl && !subUl.contains(e.relatedTarget)) {
            subUl.classList.remove('dragover');
        }
    });
    //Soltando o item
    titleDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        titleDiv.classList.remove('dragover-target');
        const subUl = document.getElementById(titleDiv.dataset.folderId);
        if (subUl) {
            subUl.classList.remove('dragover');
            handleDropOnFolder(e, subUl); 
        }
    });
}


function enableDropOnFolder(ul) {
  //Verifica se o listener já foi adicionado
  if (!ul || ul.classList.contains("drop-enabled")) return;
  ul.classList.add("drop-enabled");
  //Adiciona os listeners de 'dragover' e 'dragleave' a pasta)
  ul.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ul.classList.add("dragover"); 
  });
  ul.addEventListener("dragleave", (e) => {
    e.stopPropagation();
    // Remove a classe para ESCONDER o placeholder
    if (!e.currentTarget.contains(e.relatedTarget)) {
        ul.classList.remove("dragover");
    }
  });
  // 2. Adiciona o listener 'drop' a pasta
  ul.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      ul.classList.remove("dragover");
      handleDropOnFolder(e, ul);
  });
  //CRIA O PLACEHOLDER
  const placeholder = document.createElement("li");
  placeholder.className = "drop-placeholder";
  placeholder.textContent = "⬇ Solte aqui";
  placeholder.setAttribute("data-placeholder", "true");
  if (!ul.querySelector('.drop-placeholder')) {
    ul.prepend(placeholder); 
  }
}

//Criação e edição de projetos
function createProject() {
    //Verifica a autenticação
    const currentUser = auth.currentUser;
    if (!currentUser) {
        showAlert("Erro", "Você precisa estar logado para criar um projeto.");
        return;
    }
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
        editingFolderElement = null;
        document.getElementById("projectModal").style.display = "none";
        saveProjectToFirestore(); 
        return;
    }
    //Modo criação
    if (!projectName) {
        showAlert("Erro", "Por favor, digite o nome do projeto.");
        return;
    }
    //Cria referências e ID no firestore
    const newProjectRef = db.collection("users").doc(currentUser.uid).collection("projects").doc();
    const projectId = newProjectRef.id;
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
    titleDiv.onclick = (e) => {
        if (e.target.closest('.folder-buttons') || e.target.closest('.toggle-icon')) return;
        e.stopPropagation();
        setActiveFolder(projectId);
    };
    //Configuração do drop - receber
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
            subUl.classList.remove('dragover');
            handleDropOnFolder(e, subUl);
        }
    });
    enableDropOnFolder(subList);
    //Adiciona ao DOM
    document.getElementById("sidebar").appendChild(clone);
    //Persistência inicial no firestore
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

//Criação e edição de pastas
function createFolder() {
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
        editingFolderElement = null;
        document.getElementById("folderModal").style.display = "none";
        saveProjectToFirestore();
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
    titleDiv.onclick = (e) => {
        if (e.target.closest('.folder-buttons') || e.target.closest('.toggle-icon')) return;
        e.stopPropagation();
        setActiveFolder(folderId);
    };
    addDropTargetListenersToFolderTitle(titleDiv);
    //Processa o drop do item
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
            subUl.classList.remove('dragover');
            handleDropOnFolder(e, subUl);
        }
    });
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
function setActiveFolder(id) {
    document.querySelectorAll(".folder-title.active").forEach((el) => el.classList.remove("active"));
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

//Gerenciamento de cliques no mapa - desenho de cabos
function handleMapClick(event) {
    if (!isDrawingCable) return;
    //Impede criar pontos soltos no mapa
    if (cablePath.length === 0) {
        showAlert("Aviso", "Para iniciar um cabo, clique em um marcador do tipo CEO, CTO ou Reserva.");
        return;
    }
    //Adicona a coordenada ao trajeto
    const location = event.latLng;
    cablePath.push(location);
    //Cria marcador visual para permitir edição da rota
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
    //Atualiza linha ao arrastar o ponto
    marker.addListener("drag", () => {
        updatePolylineFromMarkers();
    });
    //Remove ponto ao clique duplo
    marker.addListener("dblclick", () => {
        const index = cableMarkers.indexOf(marker);
        if (index !== -1) {
        cableMarkers[index].setMap(null);
        cableMarkers.splice(index, 1);
        updatePolylineFromMarkers();
        }
    });
    //Redesenha a polilinha visual
    updatePolylineFromMarkers();
}

//Atualização visual e cálculo de metragem do cabo
function updatePolylineFromMarkers() {
    //Atualiza o array de coordenadas e recria a polilinha
    cablePath = cableMarkers.map((marker) => marker.getPosition());
    if (cablePolyline) cablePolyline.setMap(null);
    const fiberType = document.getElementById("cableType").value;
    const cor = getCableColor(fiberType);
    const largura = parseInt(document.getElementById("cableWidth").value);
    cablePolyline = new google.maps.Polyline({
        path: cablePath,
        geodesic: true,
        strokeColor: cor,
        strokeOpacity: 1.0,
        strokeWeight: largura,
        map: map,
    });
    //Cálculo de distância - Lançamento
    //Calcula distância e arredonda para cima
    let drawnDistance = 0;
    if (cablePath.length >= 2) {
        drawnDistance = google.maps.geometry.spherical.computeLength(
        cablePolyline.getPath()
        );
    }
    const lancamento = Math.ceil(drawnDistance / 10) * 10;
    //Lógica de reserva técnica
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
    //Aplica reservas no ponto inicial e final do cabo
    if (cablePath.length >= 1) {
        const startPoint = cablePath[0];
        const endPoint = cablePath[cablePath.length - 1];
        reserva += getReserveForPoint(startPoint);
        if (cablePath.length > 1 && !startPoint.equals(endPoint)) {
        reserva += getReserveForPoint(endPoint);
        }
    }
    //Atualização de totais e UI
    const totalDistance = lancamento + reserva;
    cableDistance = {
        lancamento: lancamento,
        reserva: reserva,
        total: totalDistance
    };
    document.getElementById("cableDrawnDistance").textContent = `Lançamento: ${lancamento} m`;
    document.getElementById("cableReserveDistance").textContent = `Reserva: ${reserva} m`;
    document.getElementById("cableTotalDistance").textContent = `Total: ${totalDistance} m`;
}

//Ferramenta de desenho do cabo
function startDrawingCable() {
    //Inicialização do modo desenho
    isDrawingCable = true;
    setAllPolygonsClickable(false); // Bloqueia clicques em polígonos
    cablePath = [];
    cableDistance = { lancamento: 0, reserva: 0, total: 0 };
    //Limpa linha temporária anteriror e exibe painel de desenho
    if (cablePolyline) cablePolyline.setMap(null);
    const cableBox = document.getElementById("cableDrawingBox");
    cableBox.classList.remove("hidden");
    //Atualiz status e reseta inputs e labels
    const statusDisplay = document.getElementById("cableStatusDisplay");
    statusDisplay.textContent = `Status: ${currentCableStatus}`;
    statusDisplay.style.display = 'block';
    document.getElementById("cableDrawnDistance").textContent = "Lançamento: 0 m";
    document.getElementById("cableReserveDistance").textContent = "Reserva: 0 m";
    document.getElementById("cableTotalDistance").textContent = "Total: 0 m";
    document.getElementById("cableName").value = "";
    document.getElementById("cableWidth").value = 3;
    //Altera cursor para mira
    document.getElementById("map").classList.add("cursor-draw");
    setMapCursor("crosshair");
}

//Listener do botão desenhar cabo
document.getElementById("drawCableButton").addEventListener("click", () => {
    //Valida se já existe outra ação em andamento
    if (isAddingMarker || isDrawingCable) {
        showAlert("Atenção", "Finalize a ação atual antes de adicionar outro marcador ou cabo.");
        return;
    }
    //Exige uma pasta
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione uma pasta para salvar o cabo.");
        return;
    }
    document.getElementById("cableStatusSelectionModal").style.display = "flex";
});

//Salvar cabo
document.getElementById("saveCableButton").addEventListener("click", () => {
    //Captura dos dados
    const name = document.getElementById("cableName").value.trim();
    const asType = document.getElementById("cableASType").value;
    const newFiberTypeSelection = document.getElementById("cableType").value;
    const fullCableType = `Cabo ${asType} ${newFiberTypeSelection}`;
    const cor = getCableColor(newFiberTypeSelection);
    const largura = parseInt(document.getElementById("cableWidth").value);
    //Validação de integridade para edição
    if (editingCableIndex !== null) {
        const originalCable = savedCables[editingCableIndex];
        const originalFiberType = getFiberType(originalCable.type);
        const newFiberType = getFiberType(fullCableType);
        if (originalFiberType !== newFiberType) {
            const usage = checkCableUsageInFusionPlans(originalCable);
            if (usage.hasFusions) {
                showAlert("Ação Bloqueada",`Não é possível alterar o tipo do cabo "${originalCable.name}" porque ele possui fusões ativas na(s) caixa(s): ${usage.locations.join(', ')}. Por favor, remova as fusões deste cabo antes de alterar seu tipo.`);
                return;
            }
        }
    }
    //Validações básicas
    if (!name) {
        showAlert("Erro", "Digite um nome para o cabo.");
        return;
    }
    if (cablePath.length < 2) {
        showAlert("Erro", "Desenhe pelo menos dois pontos.");
        return;
    }
    //Valida se o cabo termina em um elemento válido
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
    //Processamento - edição/criação
    if (editingCableIndex !== null) {
        //Atualiza cabos existentes
        const cabo = savedCables[editingCableIndex];
        const oldName = cabo.name;
        const newName = name;
        //Atualiza propriedades
        cabo.name = newName; 
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
        //Atualiza a sidebar
        cabo.item.querySelector('.item-name').textContent = `${newName} (${cabo.status}) - ${cabo.totalLength}m`;
        cabo.item.style.color = cor;
        //Remove status de importado
        if (cabo.isImported) {
            const adjustBtn = cabo.item.querySelector('.adjust-kml-btn');
            if (adjustBtn) {
                adjustBtn.remove();
            }
            cabo.isImported = false;
        }
        cabo.polyline.setVisible(true); 
        if (cablePolyline) cablePolyline.setMap(null);
        //Propaga mudança de nome para as fusões
        if (oldName !== newName) {
            updateCableNameInAllFusionPlans(oldName, newName);
        }
        showAlert("Sucesso", "Cabo atualizado com sucesso!");
    }
    else {
        //Criação de um novo cabo
        const polyline = new google.maps.Polyline({
        path: cablePath,
        geodesic: true,
        strokeColor: cor,
        strokeOpacity: 1.0,
        strokeWeight: largura,
        clickable: true,
        map: map,
        });
        //Cria elemento DOM para a sidebar
        const item = document.createElement("li");
        enableDragAndDropForItem(item);
        const nameSpan = document.createElement("span");
        nameSpan.className = 'item-name';
        nameSpan.textContent = `${name} (${currentCableStatus}) - ${cableDistance.total}m`;
        nameSpan.style.color = cor;
        nameSpan.style.cursor = "pointer";
        nameSpan.style.flexGrow = '1';
        //Botão de visibilidade
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
        //Adiciona a pasta ativa
        const parentUl = document.getElementById(activeFolderId);
        enableDropOnFolder(parentUl);
        parentUl.appendChild(item);
        //Objeto de dados do cabo
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
        //Listeners para edição
        nameSpan.addEventListener("click", () => openCableEditor(newCableInfo));
        polyline.addListener("click", () => openCableEditor(newCableInfo));
        const newCableIndex = savedCables.length - 1;
        addCableEventListeners(polyline, newCableIndex);
        //Listeners de visibilidade
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
    //Limpesa e reset de estado
    cableMarkers.forEach((marker) => marker.setMap(null));
    cableMarkers = [];
    cablePath = [];
    cableDistance = { lancamento: 0, reserva: 0, total: 0 };
    editingCableIndex = null;
    isDrawingCable = false;
    //Ajuste na interface
    setAllPolygonsClickable(true);
    document.getElementById("invertCableButton").classList.add("hidden");
    document.getElementById("cableDrawingBox").classList.add("hidden");
    document.getElementById("cableStatusDisplay").style.display = 'none';
    document.getElementById("map").classList.remove("cursor-draw");
    setMapCursor("");
});

//Editor de cabos
function openCableEditor(cabo) {
    //Validação e controle visual
    const index = savedCables.indexOf(cabo);
    if (index === -1) {
        showAlert("Erro", "Não foi possível encontrar o cabo para edição.");
        return;
    }
    //Restaura visibilidade de cabo anterior se houver troca de edição
    if (editingCableIndex !== null && editingCableIndex !== index) {
        const originalCable = savedCables[editingCableIndex];
        if (originalCable && originalCable.polyline) {
            originalCable.polyline.setVisible(true);
        }
    }
    if (cabo && cabo.polyline) {
        cabo.polyline.setVisible(false);
    }
    //Preenchimento do formulário
    document.getElementById("cableName").value = cabo.name;
    //Separação por AS
    const typeParts = cabo.type.split(' ');
    if (typeParts.length >= 4) {
        document.getElementById("cableASType").value = `${typeParts[1]} ${typeParts[2]}`;
        document.getElementById("cableType").value = typeParts[3];
    } else {
        document.getElementById("cableType").value = cabo.type;
    }
    //Exibir botões de ação
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
    //Recriação dos vértices no mapa
    cablePath = [...cabo.path];
    cableMarkers.forEach((marker) => marker.setMap(null));
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
        //Listeners de interação do marcador
        marker.addListener("drag", () => {
            updatePolylineFromMarkers();
        });
        marker.addListener("dragend", () => {
            handleCableVertexDragEnd(i);
        });
        //Listener de remoção de vértice com clique duplo
        marker.addListener("dblclick", () => {
            const currentCableBeingEdited = savedCables[editingCableIndex];
            if (!currentCableBeingEdited) return;
            const indexToDelete = cableMarkers.indexOf(marker);
            if (indexToDelete !== -1) {
                console.log(`Tentando deletar vértice no índice: ${indexToDelete}`);
                //Remove visualmente o marcador do mapa
                cableMarkers[indexToDelete].setMap(null);
                console.log("Marcador removido do mapa.");
                //Remove o objeto do marcador do array 'cableMarkers'
                cableMarkers.splice(indexToDelete, 1);
                console.log("Marcador removido do array cableMarkers.");
                //ATUALIZA o array cablePath INTERNO e redesenha a polyline
                updatePolylineFromMarkers();
                console.log("updatePolylineFromMarkers chamado após splice.");
                // 4. Reabre o editor para redesenhar os marcadores restantes com os rótulos A/B
                openCableEditor(currentCableBeingEdited);
                console.log("Editor reaberto para atualizar marcadores A/B.");
                // Adiciona um alerta para feedback
                showAlert("Ponto Removido", "O ponto foi removido. Salve o cabo para confirmar a alteração.");
            } else {
                console.log("Erro: Não foi possível encontrar o índice do marcador para deletar.");
            }
        });
        cableMarkers.push(marker);
    });
    //Configuração do estado global
    isDrawingCable = true;
    editingCableIndex = index;
    updatePolylineFromMarkers();
    document.getElementById("cableDrawingBox").classList.remove("hidden");
    document.getElementById("map").classList.add("cursor-draw");
    setMapCursor("crosshair");
}

//Cancelar o desenho ou edição do cabo
document.getElementById("cancelCableButton").addEventListener("click", () => {
    //Restauração do modo edição
    if (editingCableIndex !== null) {
        const originalCable = savedCables[editingCableIndex];
        if (originalCable && originalCable.polyline) {
        originalCable.polyline.setVisible(true);
        }
    }
    //Limpeza visual
    if (cablePolyline) cablePolyline.setMap(null);
    cableMarkers.forEach((marker) => marker.setMap(null));
    //Reset de estado, zera todos os arryas e variáveis
    cableMarkers = [];
    cablePath = [];
    cableDistance = { lancamento: 0, reserva: 0, total: 0 };
    isDrawingCable = false;
    //Restauração da interface
    setAllPolygonsClickable(true);
    editingCableIndex = null;
    document.getElementById("invertCableButton").classList.add("hidden");
    document.getElementById("cableDrawingBox").classList.add("hidden");
    document.getElementById("cableStatusDisplay").style.display = 'none';
    document.getElementById("map").classList.remove("cursor-draw");
    setMapCursor("");
});

//Inicio da adiçao de marcador
document.getElementById("addMarkerButton").addEventListener("click", () => {
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
    //Reseta formulários, seleções anteriores e abre o modal
    resetMarkerModal();
    document.querySelectorAll("#markerTypeModal .marker-option.selected").forEach(o => o.classList.remove("selected"));
    document.getElementById("markerTypeModal").style.display = "flex";
});

//Posicionamento de um marcador
function startPlacingMarker() {
    //Preparação da interface
    isAddingMarker = true;
    setAllPolygonsClickable(false);
    setMapCursor("crosshair");
    document.getElementById("markerModal").style.display = "none";
    document.getElementById("markerTypeModal").style.display = "none";
    //Conversão de marcador importado
    if (adjustingKmlMarkerInfo) {
        //Pega a posição exata do marcador antigo
        const originalPosition = adjustingKmlMarkerInfo.marker.getPosition();
        //Apaga o marcador "Importado" antigo
        adjustingKmlMarkerInfo.marker.setMap(null);
        adjustingKmlMarkerInfo.listItem.remove();
        markers = markers.filter((m) => m !== adjustingKmlMarkerInfo);
        //Cria imediatamente o novo marcador na mesma posição
        addCustomMarker(originalPosition);
        //Limpa o estado
        isAddingMarker = false;
        setMapCursor("");
        resetMarkerModal();
        adjustingKmlMarkerInfo = null;

    } else {
        //Criação de novo marcador
        placeMarkerListener = map.addListener("click", function placeMarker(event) {
            if (!isAddingMarker) return;
            addCustomMarker(event.latLng);
            //Finaliza fluxo e limpa listerners
            isAddingMarker = false;
            setMapCursor("");
            resetMarkerModal();
        });
    }
}

//Listeners de seleção de tipo de marcador
document.querySelectorAll("#markerTypeModal .marker-option").forEach((opt) => {
    opt.addEventListener("click", () => {
        const markerType = opt.getAttribute("data-type");
        selectedMarkerData.type = markerType;
        document.getElementById("markerTypeModal").style.display = "none";
        //Redireciona para modais de status específicos conforme a escolha
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
        //Preenche dados se estiver editando KML importado
        if (adjustingKmlMarkerInfo) {
            document.getElementById('markerNumber').value = adjustingKmlMarkerInfo.name; 
        }
        document.getElementById("markerModal").style.display = "flex";
    });
});

//Seleção de status do cabo e início do desenho
document.querySelectorAll(".cable-status-option").forEach(option => {
    option.addEventListener("click", () => {
        currentCableStatus = option.getAttribute("data-status");
        document.getElementById("cableStatusSelectionModal").style.display = "none";
        startDrawingCable();
    });
});

//Configuração final de CTO
document.querySelectorAll(".cto-status-option").forEach(option => {
    option.addEventListener("click", () => {
        const status = option.getAttribute("data-status");
        document.getElementById("ctoStatusSelectionModal").style.display = "none";
        //Configura dados da CTO
        selectedMarkerData.type = "CTO";
        selectedMarkerData.ctoStatus = status;
        //Ajusta interface do modal principal
        document.getElementById("markerModalTitle").textContent = "Adicionar Caixa de Atrendimento (CTO)";
        const ctoInfoDisplay = document.getElementById("ctoInfoDisplay");
        document.getElementById("ctoStatusInfo").textContent = `Status: ${selectedMarkerData.ctoStatus}`;
        ctoInfoDisplay.classList.remove("hidden");
        //Exibe campos específicos de CTO
        document.getElementById("labelColorGroup").classList.remove("hidden");
        document.getElementById("ctoPredialGroup").classList.remove("hidden");
        document.getElementById("ctoStickerGroup").classList.remove("hidden");
        //Adiciona botão plano de fusão inicialmente desebilitado
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
        if (adjustingKmlMarkerInfo) {
            document.getElementById('markerName').value = adjustingKmlMarkerInfo.name;
            document.getElementById('markerDescription').value = adjustingKmlMarkerInfo.description;
        }
        document.getElementById("markerModal").style.display = "flex";
    });
});

//Configuração de CEO - acessórios - status
document.querySelectorAll(".ceo-status-option").forEach(option => {
    option.addEventListener("click", () => {
        const status = option.getAttribute("data-status");
        selectedMarkerData.ceoStatus = status;
        document.getElementById("ceoStatusSelectionModal").style.display = "none";
        document.getElementById("ceoAccessorySelectionModal").style.display = "flex";
    });
});

//Seleção de acessórios - CEO reserva e configuração
document.querySelectorAll(".ceo-accessory-option").forEach(option => {
    option.addEventListener("click", () => {
        const accessory = option.getAttribute("data-accessory");
        document.getElementById("ceoAccessorySelectionModal").style.display = "none";
        //Lógica para CEO - Status/acessórios e habilita o botão de fusão
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
        //Lógica para Reserva - Status/acessórios
        } else if (selectedMarkerData.type === 'RESERVA') {
            const chosenStatus = selectedMarkerData.reservaStatus;
            selectedMarkerData.reservaAccessory = accessory;
            document.getElementById("markerModalTitle").textContent = "Adicionar Reserva Técnica";
            const infoDisplay = document.getElementById("reservaInfoDisplay");
            document.getElementById("reservaStatusInfo").textContent = `Status: ${chosenStatus}`; //
            document.getElementById("reservaAccessoryInfo").textContent = `Instalação: ${accessory}`; //
            infoDisplay.classList.remove("hidden");
            document.getElementById("labelColorGroup").classList.remove("hidden"); //
        }
        //Preenche dados se for ajuste de KML
        if (adjustingKmlMarkerInfo) {
            document.getElementById('markerName').value = adjustingKmlMarkerInfo.name;
            document.getElementById('markerDescription').value = adjustingKmlMarkerInfo.description;
        }
        document.getElementById("markerModal").style.display = "flex";
    });
});

//Configuração final de cordoalha
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
        //Campos específicos
        document.getElementById("labelColorGroup").classList.remove("hidden");
        document.getElementById("derivationTGroup").classList.remove("hidden");
        if (adjustingKmlMarkerInfo) {
            document.getElementById('markerName').value = adjustingKmlMarkerInfo.name;
            document.getElementById('markerDescription').value = adjustingKmlMarkerInfo.description;
        }
        document.getElementById("markerSize").value = 8;
        document.getElementById("markerModal").style.display = "flex";
    });
});

//Seleção intermediária de reserva
document.querySelectorAll(".reserva-status-option").forEach(option => {
    option.addEventListener("click", () => {
        const status = option.getAttribute("data-status");
        selectedMarkerData.reservaStatus = status;
        document.getElementById("reservaStatusSelectionModal").style.display = "none";
        //Avança para modal de acessórios
        document.getElementById("ceoAccessorySelectionModal").style.display = "flex";
    });
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

//Adicionar material a BOM
function addMaterialToBom(materialName, quantity) {
    if (!activeFolderId) return;
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
        projectBoms[projectId][materialName] = { quantity: 0, type: priceInfo.unit || 'un', unitPrice: priceInfo.price, category: priceInfo.category, removed: false };
    }
    projectBoms[projectId][materialName].quantity += quantity;
}

//Remover material da BOM
function removeMaterialFromBom(materialName, quantity) {
    if (!activeFolderId) return;
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

//Acição do Kit derivação - CEO
function handleDerivationKitToggle(checkboxElement) {
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione um projeto para gerenciar os materiais.");
        checkboxElement.checked = !checkboxElement.checked;
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

//Quantidade de bandejas - CEO
function handleTrayQuantityChange(inputElement) {
    const materialName = "KIT DE BANDEJA PARA CAIXA DE EMENDA";
    //Calcula a diferença entre o valor autal e o armazenado
    const newQuantity = parseInt(inputElement.value, 10) || 0;
    const oldQuantity = parseInt(inputElement.dataset.oldValue, 10) || 0;
    const difference = newQuantity - oldQuantity;
    if (difference > 0) {
        addMaterialToBom(materialName, difference);
    } else if (difference < 0) {
        removeMaterialFromBom(materialName, Math.abs(difference));
    }
    //Atualiza o valor de referência
    inputElement.dataset.oldValue = newQuantity;
}

//Fecha o modal de marcador
document.getElementById("closeModal").addEventListener("click", () => {
    resetMarkerModal();
});

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

//Exclusão de cabo
document.getElementById("deleteCableButton").addEventListener("click", () => {
    if (editingCableIndex === null) return;
    const cableToDelete = savedCables[editingCableIndex];
    //Verificação de integridade
    const usage = checkCableUsageInFusionPlans(cableToDelete);
    if (usage.hasFusions) {
        showAlert(
            "Ação Bloqueada",
            `O cabo "${cableToDelete.name}" possui fusões ativas nas caixas: ${usage.locations.join(', ')}. Por favor, acesse o plano de fusão destas caixas e remova as conexões antes de excluir o cabo.`
        );
        return;
    }
    //Confirmação e aviso de cascata
    let confirmMessage = `Tem certeza que deseja excluir o cabo "${cableToDelete.name}"?`;
    if (usage.isInPlan) {
        confirmMessage += `\n\nEste cabo será removido automaticamente dos planos de fusão das caixas: ${usage.locations.join(', ')}.`;
    }
    showConfirm('Excluir Cabo', confirmMessage, () => {
        //Remove referências do cabo em caixas onde ele está presente e sem fusão
        if (usage.isInPlan) {
            removeCableFromSavedFusionPlans(cableToDelete.name, usage.locations);
        }
        //Remoção visual e dados
        const cabo = savedCables[editingCableIndex];
        if (cabo.polyline) cabo.polyline.setMap(null);
        if (cablePolyline) cablePolyline.setMap(null);
        if (cabo.item) cabo.item.remove();
        savedCables.splice(editingCableIndex, 1);
        //Limpeza de estado e reset de interface
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

//Seleção visual no modal de tipos de marcadores
document.querySelectorAll(".marker-option").forEach((opt) => {
    opt.addEventListener("click", () => {
        document.querySelectorAll(".marker-option").forEach((o) => o.classList.remove("selected"));
        opt.classList.add("selected");
    });
});

//Confirmação do modal de marcador - salvar edição ou iniciar criação
document.getElementById("confirmMarker").addEventListener("click", () => {
    //Verifica se é uma edição de marcador existente ou uma nova criação
    if (editingMarkerInfo) {
        //Modo edição - Atualiza objeto existente
        if (editingMarkerInfo.type === "CASA") {
            editingMarkerInfo.name = document.getElementById("markerNumber").value || "0";
        } else {
            //Atualiza propriedades gerais
            editingMarkerInfo.name = document.getElementById("markerName").value || "Marcador";
            editingMarkerInfo.color = document.getElementById("markerColor").value;
            editingMarkerInfo.labelColor = document.getElementById("markerLabelColor").value;
            editingMarkerInfo.size = parseInt(document.getElementById("markerSize").value) || 8;
            editingMarkerInfo.description = document.getElementById("markerDescription").value;
            //Atualiza propriedades específicas por tipo
            if (editingMarkerInfo.type === "CORDOALHA") {
                editingMarkerInfo.derivationTCount = parseInt(document.getElementById("markerDerivationT").value) || 0;
            }
            if (editingMarkerInfo.type === "CTO") {
                editingMarkerInfo.isPredial = document.getElementById("ctoPredialCheckbox").checked;
                editingMarkerInfo.needsStickers = document.getElementById("ctoStickerCheckbox").checked;
            }
            if (editingMarkerInfo.type === "CEO") {
                editingMarkerInfo.is144F = document.getElementById("ceo144Checkbox").checked;
            }
        }
        //Aplica mudanças visuais no mapa e reativa botão de fusão no modal
        updateMarkerAppearance(editingMarkerInfo);
        const fusionButton = document.getElementById("fusionPlanButton");
        if (fusionButton) {
            fusionButton.disabled = false;
            fusionButton.style.opacity = 1;
            fusionButton.title = "Editar o plano de fusão";
        }
        resetMarkerModal();
    } else {
        //Modo criação - prepara dados para novo marcador
        if (selectedMarkerData.type === "CASA") {
            selectedMarkerData.name = document.getElementById("markerNumber").value || "0";
        } else {
            //Captura dados do formulário para o objeto temporário de criação
            selectedMarkerData.name = document.getElementById("markerName").value || "Marcador";
            selectedMarkerData.color = document.getElementById("markerColor").value;
            selectedMarkerData.labelColor = document.getElementById("markerLabelColor").value;
            selectedMarkerData.size = parseInt(document.getElementById("markerSize").value) || 8;
            selectedMarkerData.description = document.getElementById("markerDescription").value;
        }
        //Captura dados específicos para criação
        if (selectedMarkerData.type === "CORDOALHA") {
            selectedMarkerData.derivationTCount = parseInt(document.getElementById("markerDerivationT").value) || 0;
        }
        if (selectedMarkerData.type === "CTO") {
            selectedMarkerData.isPredial = document.getElementById("ctoPredialCheckbox").checked;
            selectedMarkerData.needsStickers = document.getElementById("ctoStickerCheckbox").checked;
        }
        if (selectedMarkerData.type === "CEO") {
            selectedMarkerData.is144F = document.getElementById("ceo144Checkbox").checked;
        }
        if (!selectedMarkerData.type) return;
        //Inicia ferramenta de posicionamento no mapa
        startPlacingMarker();
    }
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
    //Botão extra para ajustar marcadores importados KML
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
    //Estruturação do obejto de dados do marcador
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
    };
    //Listeners e interatividade
    visibilityBtn.onclick = (e) => {
        e.stopPropagation();
        const isVisible = markerInfo.marker.getVisible();
        markerInfo.marker.setVisible(!isVisible);
        visibilityBtn.dataset.visible = !isVisible;
        visibilityBtn.querySelector('img').src = isVisible ? 'img/Ocultar.png' : 'img/Mostrar.png';
    };
    //Adiciona ao registro global e atualiza visual
    markers.push(markerInfo);
    updateMarkerAppearance(markerInfo);
    //Evento de clique no marcador
    marker.addListener("click", () => {
        if (!isDrawingCable) {
            openMarkerEditor(markerInfo);
            return;
        }
        //Inicio do cabo
        if (cablePath.length === 0) {
            if (markerInfo.type !== "CEO" && markerInfo.type !== "CTO" && markerInfo.type !== "RESERVA") {
                showAlert("Aviso", "Cabos devem ser iniciados em um marcador do tipo CEO, CTO ou Reserva.");
                return;
            }
        }
        //Edição de cabo existente
        else if (editingCableIndex !== null && cableMarkers.length > 0) {
            if (markerInfo.type !== "CEO" && markerInfo.type !== "CTO" && markerInfo.type !== "RESERVA") {
                showAlert("Aviso", "As pontas dos cabos só podem ser ancoradas em marcadores CEO, CTO ou Reserva.");
                return;
            }
            const lastVertexMarker = cableMarkers[cableMarkers.length - 1];
            const newPosition = markerInfo.marker.getPosition();
            lastVertexMarker.setPosition(newPosition);
            updatePolylineFromMarkers();
            return; 
        }
        //Adição de potno intermediário ou final
        const markerPosition = markerInfo.marker.getPosition();
        cablePath.push(markerPosition);
        //Criar marcador de controle visual para o vértice do cabo
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
        //Listeners do vértice do cabo
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
    });
    //Clique no nome na sidebar abre editor
    nameSpan.addEventListener("click", () => openMarkerEditor(markerInfo));
}

//Atualização visual do marcador
function updateMarkerAppearance(markerInfo) {
    const isCasa = markerInfo.type === "CASA";
    const nameSpan = markerInfo.listItem.querySelector('.item-name');
    if (!nameSpan) return;
    //Estilo específico para casas
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
        //Estilos para infraestrutura
        let icon;
        //Configura rótulo com contorno
        markerInfo.marker.setLabel({
            text: markerInfo.name,
            color: markerInfo.labelColor || "#000000",
            fontWeight: "bold",
            className: 'marker-label-with-outline'
        });
        const originalLabelOrigin = new google.maps.Point(0, -3.0);
        //Define geometria do icone baseada no tipo
        switch (markerInfo.type) {
        case "CEO":
            icon = {
                path: google.maps.SymbolPath.CIRCLE,
                scale: markerInfo.size,
                fillColor: markerInfo.color,
                fillOpacity: 1,
                strokeColor: "#000",
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
                strokeColor: "#000",
                strokeWeight: 1,
                labelOrigin: originalLabelOrigin,
            };
            break;
        case "CORDOALHA":
            const plusShapePath = "M -1 -0.2 L -0.2 -0.2 L -0.2 -1 L 0.2 -1 L 0.2 -0.2 L 1 -0.2 L 1 0.2 L 0.2 0.2 L 0.2 1 L -0.2 1 L -0.2 0.2 L -1 0.2 Z";
            icon = {
                path: plusShapePath,
                scale: markerInfo.size,
                fillColor: markerInfo.color,
                fillOpacity: 1,
                strokeColor: "#000",
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
                strokeColor: "#000",
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
                strokeColor: "#000",
                strokeWeight: 1,
                labelOrigin: originalLabelOrigin,
            };
        }
        //Construção dinâmica de texto
        let title = markerInfo.name;
        let listItemText = `${markerInfo.name} (${markerInfo.type})`;
        //Adiciona sufixos baseados em propriedades específicas
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
        //Aplica as alterações fianis ao marcador e ao DOM
        markerInfo.marker.setTitle(title);
        nameSpan.textContent = listItemText;
        markerInfo.listItem.title = markerInfo.description;
        nameSpan.style.color = markerInfo.color;
        markerInfo.marker.setIcon(icon);  
    }
}

//Carregamento e renderização do plano de fusão
function populateFusionPlan(markerInfo) {
    //Inicialização e limpeza    
    activeMarkerForFusion = markerInfo;
    const canvas = document.getElementById("fusionCanvas");
    const svgLayer = document.getElementById("fusion-svg-layer");
    //Limpa elementos anteriores e reseta container de bandejas
    canvas.querySelectorAll(".cable-element, .splitter-element").forEach(el => el.remove());
    if (svgLayer) svgLayer.innerHTML = '';
    const trayContainer = document.getElementById('trayKitContainer');
    const trayInput = document.getElementById('trayKitQuantity');
    trayContainer.classList.add('hidden');
    //Carregamento de plano salvo
    if (markerInfo.fusionPlan) {
        try {
        const planData = JSON.parse(markerInfo.fusionPlan);
        if (planData.elements) {
            canvas.insertAdjacentHTML('beforeend', planData.elements);
        }
        if (planData.svg && svgLayer) {
            svgLayer.innerHTML = planData.svg;
        }
        //Botão de exclusão
        canvas.querySelectorAll('.splitter-element .delete-component-btn').forEach(button => button.onclick = () => handleDeleteSplitter(button));
        canvas.querySelectorAll('.cable-element .delete-component-btn').forEach(button => button.onclick = () => handleDeleteCableFromFusion(button));
        //Checkbox kit derivação
        canvas.querySelectorAll('.derivation-kit-checkbox').forEach(checkbox => {
            checkbox.onclick = () => handleDerivationKitToggle(checkbox);
            if (checkbox.dataset.checked === 'true') checkbox.checked = true;
        });
        //Controles de movimentação de splitters
        canvas.querySelectorAll('.splitter-element').forEach(splitter => {
            const body = splitter.querySelector('.splitter-body');
            if (body) {
                const buttons = body.querySelectorAll('button');
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
        //Controles de movimentação de cabos
        canvas.querySelectorAll('.cable-element').forEach(cable => {
            const header = cable.querySelector('.cable-header');
            if (header) {
                const buttons = header.querySelectorAll('button');
                if (buttons.length >= 2) {
                    const upButton = buttons[0];
                    const downButton = buttons[1];
                    upButton.onclick = () => moveCable(cable, 'up');
                    downButton.onclick = () => moveCable(cable, 'down');
                }
            }
        });
        //Reatribuição de listeners
        if (svgLayer) {
            //Interações com as linhas de fusão
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
            //Interações com handles
            svgLayer.querySelectorAll('.line-handle').forEach(handle => {
                handle.style.pointerEvents = 'auto';
                const lineId = handle.dataset.lineId;
                const linePath = document.getElementById(lineId);
                if (linePath) {
                    handle.addEventListener('mousedown', (e) => onHandleMouseDown(e, handle, linePath));
                }
            });
        }
        //Lógica específica para CEO
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
    //Caso especial com novo marcador
    } else if (markerInfo.type === 'CEO') {
        trayContainer.classList.remove('hidden');
        trayInput.value = 0;
        trayInput.dataset.oldValue = 0;
        trayInput.onchange = () => handleTrayQuantityChange(trayInput);
    }
    //Finalização e renderização
    const placeholder = canvas.querySelector(".canvas-placeholder");
    if (canvas.querySelector('.cable-element') || canvas.querySelector('.splitter-element')) {
        if (placeholder) placeholder.remove();
    } else if (!placeholder) {
        const p = document.createElement('p');
        p.className = 'canvas-placeholder';
        p.textContent = 'A área de fusão aparecerá aqui.';
        canvas.appendChild(p);
    }
    //Listeners globais de criação de conexão
    canvas.removeEventListener('click', handleConnectionClick);
    canvas.removeEventListener('contextmenu', handleFusionCanvasRightClick);
    canvas.addEventListener('click', handleConnectionClick);
    canvas.addEventListener('contextmenu', handleFusionCanvasRightClick);
    setTimeout(() => {
        updateAllConnections();
        updateSvgLayerSize();
    }, 100);
}

//Editor de marcador
function openMarkerEditor(markerInfo) {
    //Inicialização e reset
    resetMarkerModal(); 
    editingMarkerInfo = markerInfo;
    //Configura botões de ação - salvar/exluir
    document.getElementById("confirmMarker").textContent = "Salvar Alterações";
    document.getElementById("deleteMarkerButton").classList.remove("hidden");
    //Lógica do botão
    const editPositionBtn = document.getElementById("editPositionButton");
    const newEditPositionBtn = editPositionBtn.cloneNode(true);
    editPositionBtn.parentNode.replaceChild(newEditPositionBtn, editPositionBtn);
    newEditPositionBtn.addEventListener('click', () => {
        if (!editingMarkerInfo) return;
        const marker = editingMarkerInfo.marker;
        const oldPosition = marker.getPosition();
        //Habilita drag & drop temporário no marcador
        document.getElementById("markerModal").style.display = "none";
        marker.setDraggable(true);
        google.maps.event.addListenerOnce(marker, "dragend", () => {
            marker.setDraggable(false);
            const newPosition = marker.getPosition();
            //Atualiza cabos conectados e exibe novas coordenadas
            updateCablesForMovedMarker(oldPosition, newPosition);
            const newLat = newPosition.lat().toFixed(6);
            const newLng = newPosition.lng().toFixed(6);
            document.getElementById("markerCoordinatesText").textContent = `${newLat}, ${newLng}`;
            document.getElementById("markerModal").style.display = "flex"; 
        });
    });
    //Preenchimento do formulário - Baseado no tipo
    //Tipo casa
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
    //Outros tipos 
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
    //Botão de plano de fusão
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

//Sincronização de cabos com movimento de marcador
function updateCablesForMovedMarker(oldPosition, newPosition) {
    //Itera sobre todos os cabos salvos para verificar conexões
    savedCables.forEach(cable => {
        let pathUpdated = false;
        //Cria novo traçado substituindo o ponto antigo pelo novo
        const newPath = cable.path.map(point => {
            if (point.equals(oldPosition)) {
                pathUpdated = true;
                return newPosition;
            }
            return point;
        });
        //Se houver alteração atualiza o objeto
        if (pathUpdated) {
            cable.path = newPath;
            cable.polyline.setPath(newPath);
        }
    });
}

//Exclusão de marcador
function deleteEditingMarker() {
    if (!editingMarkerInfo) return;
    const message = `Tem certeza que deseja excluir o marcador "${editingMarkerInfo.name}"?`;
    showConfirm('Excluir Marcador', message, () => {
        //Remove visualmente e dos dados globais
        editingMarkerInfo.marker.setMap(null);
        editingMarkerInfo.listItem.remove();
        markers = markers.filter((m) => m !== editingMarkerInfo);
        showAlert("Sucesso", "Marcador excluído com sucesso.");
        resetMarkerModal();
    });
}

//Reset completo do modal e estado de marcadores
function resetMarkerModal() {
    const modal = document.getElementById("markerModal");
    modal.style.display = "none";
    //Limpeza de listeners e estados de mapa
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
    //Reset de campos de texto e estilos padrão
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
    //Controle de visibilidade de grupos
    document.getElementById("nameGroup").classList.remove("hidden");
    document.querySelector(".compact-inputs-container").classList.remove("hidden");
    document.getElementById("descGroup").classList.remove("hidden");
    document.getElementById("colorGroup").classList.remove("hidden");
    document.getElementById("sizeGroup").classList.remove("hidden");
    //Oculta campos específicos
    document.getElementById("houseNumberGroup").classList.add("hidden");
    document.getElementById("labelColorGroup").classList.add("hidden");
    document.getElementById("ceoInfoDisplay").classList.add("hidden");
    document.getElementById("ctoInfoDisplay").classList.add("hidden");
    document.getElementById("cordoalhaInfoDisplay").classList.add("hidden");
    document.getElementById("reservaInfoDisplay").classList.add("hidden");
    document.getElementById("markerCoordinatesGroup").classList.add("hidden");
    document.getElementById("derivationTGroup").classList.add("hidden");
    //Reseta checkboxes
    document.getElementById("ctoPredialCheckbox").checked = false;
    document.getElementById("ctoPredialGroup").classList.add("hidden");
    document.getElementById("ctoStickerCheckbox").checked = false;
    document.getElementById("ctoStickerGroup").classList.add("hidden");
    document.getElementById("ceo144Checkbox").checked = false;
    document.getElementById("ceo144Group").classList.add("hidden");
    //Oculta botões de ação e remove botão dinâmico de fusão
    document.getElementById("deleteMarkerButton").classList.add("hidden");
    document.getElementById("editPositionButton").classList.add("hidden");
    const fusionButton = document.getElementById("fusionPlanButton");
    if (fusionButton) fusionButton.remove();
    //Reset do objeto de dados temporário
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

//Utilitário para gerar caminho
function generatePolylinePath(points) {
    if (points.length === 0) return "";
    //Mapeia array de coordenadas para comando
    const pathParts = points.map((p, i) => {
        return (i === 0 ? 'M' : 'L') + ` ${p.x} ${p.y}`;
    });
    return pathParts.join(' ');
}

//Reset do estado de desenho
function resetFusionDrawingState() {
    //Remove elementos visuais temporários
    if (fusionDrawingState.tempLine) {
        fusionDrawingState.tempLine.remove();
    }
    fusionDrawingState.tempHandles.forEach(h => h.remove());
    //Reseta variáveis de controle e remove lesteners de movimento
    fusionDrawingState.isActive = false;
    fusionDrawingState.startElement = null;
    fusionDrawingState.points = [];
    fusionDrawingState.tempLine = null;
    fusionDrawingState.tempHandles = [];
    document.getElementById('fusionCanvas').removeEventListener('mousemove', handleFusionCanvasMouseMove);
}

//Iniciar edição de linha existente
function startLineEdit(lineElement) {
    //Valida se o elemento existe e se não há outro desenho em andamento
    if (!lineElement || fusionDrawingState.isActive) return;
    //Recupera dados da conexão original
    const startId = lineElement.dataset.startId;
    const pointsData = lineElement.dataset.points;
    const startElement = document.getElementById(startId);
    if (!startElement) {
        showAlert("Erro", "Não foi possível encontrar o ponto de início da conexão para editar.");
        return;
    }
    //Configura flags de edição e altera estilo visual da linha
    isEditingLine = true;
    activeLineForAction = lineElement;
    lineElement.classList.remove('fusion-line');
    lineElement.classList.add('fusion-line-editing');
    //Oculta os handles da linha original para evitar confusão
    document.querySelectorAll(`.line-handle[data-line-id="${lineElement.id}"]`).forEach(h => h.style.display = 'none');
    //Inicializa estado de desenho com os pontos da lnha existente
    fusionDrawingState.isActive = true;
    fusionDrawingState.startElement = startElement;
    const startPos = getElementCenter(startElement);
    const intermediatePoints = pointsData ? JSON.parse(pointsData) : [];
    fusionDrawingState.points = [startPos, ...intermediatePoints];
    //Cria linha temporária no SVG para acompanhar o mouse
    const svgLayer = document.getElementById('fusion-svg-layer');
    fusionDrawingState.tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    fusionDrawingState.tempLine.setAttribute('fill', 'none');
    fusionDrawingState.tempLine.setAttribute('class', 'connecting-line');
    svgLayer.appendChild(fusionDrawingState.tempLine);
    //Ativa listener de movimento e instrui o usuário
    document.getElementById('fusionCanvas').addEventListener('mousemove', handleFusionCanvasMouseMove);
    showAlert("Modo de Edição", "Clique em uma nova porta para mover a conexão. Clique com o botão direito para cancelar.");
}

//Gerenciamento de cliques no canvas
function handleConnectionClick(event) {
    const target = event.target;
    const isConnectable = target.closest('.connectable');
    const isLine = target.closest('.fusion-line');
    //Abertura do menu de ação da lnha
    if (isLine && !fusionDrawingState.isActive) {
        activeLineForAction = isLine;
        document.getElementById('lineActionModal').style.display = 'flex';
        return;
    }
    //Início do Desenho
    if (!fusionDrawingState.isActive && isConnectable) {
        if (isPortConnected(isConnectable.id)) {
            showAlert("Porta Ocupada", "Esta porta já possui uma conexão.");
            return;
        }
        //Inicializa estado, define origem e cria linha guia temporária
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
    //Finalização da conexão
    if (fusionDrawingState.isActive && isConnectable && (isConnectable !== fusionDrawingState.startElement || isEditingLine)) {
        //Verifica se a porta de destino está ocupada
        const portIsOccupied = isEditingLine 
            ? isPortConnected(isConnectable.id, activeLineForAction) 
            : isPortConnected(isConnectable.id);
        if (portIsOccupied) {
            showAlert("Porta Ocupada", "Esta porta já possui uma conexão com outra fibra. A conexão foi cancelada.");
            handleFusionCanvasRightClick(new MouseEvent('contextmenu'));
            return;
        }
        //Se estiver editando, remove a linha antiga antes de criar a nova
        if (isEditingLine && activeLineForAction) {
            const oldLineId = activeLineForAction.id;
            activeLineForAction.remove();
            document.querySelectorAll(`.line-handle[data-line-id="${oldLineId}"]`).forEach(h => h.remove());
            isEditingLine = false;
            activeLineForAction = null;
        }
        //Renderiza a linha final no SVG
        const endPos = getElementCenter(isConnectable);
        const allPoints = [...fusionDrawingState.points, endPos];
        const finalPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        finalPath.setAttribute('fill', 'none');
        finalPath.setAttribute('class', 'fusion-line');
        finalPath.id = `line-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        finalPath.style.pointerEvents = 'auto';
        finalPath.setAttribute('d', generatePolylinePath(allPoints));
        //Salva metadados da conexão no elemento DOM
        finalPath.dataset.startId = fusionDrawingState.startElement.id;
        finalPath.dataset.endId = isConnectable.id;
        finalPath.dataset.points = JSON.stringify(fusionDrawingState.points.slice(1));
        const svgLayer = document.getElementById('fusion-svg-layer');
        svgLayer.appendChild(finalPath);
        //Atualiza estoque (BOM)
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
        //Criar pontos de controle para os vértice intermediários
        const intermediatePoints = fusionDrawingState.points.slice(1);
        intermediatePoints.forEach((point, index) => {
            const handle = createDraggableHandle(point.x, point.y, finalPath, index);
            handle.style.pointerEvents = 'auto';
            svgLayer.appendChild(handle);
        });
        resetFusionDrawingState();
        return;
    }
    //Adicionar Ponto Intermediário
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

//Finalização da conexão
function endConnection(element) {
    //Validação, analisando a porta ocupada
    if (element === fusionDrawingState.startElement) {
        handleFusionCanvasRightClick(new MouseEvent('contextmenu'));
        return;
    }
    if (isPortConnected(element.id)) {
        showAlert("Porta Ocupada", "A porta de destino já possui uma conexão. A conexão foi cancelada.");
        handleFusionCanvasRightClick(new MouseEvent('contextmenu'));
        return;
    }
    //Construção do elemento SVG
    const finalPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    finalPath.setAttribute('class', 'fusion-line');
    finalPath.id = `line-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    finalPath.style.pointerEvents = 'auto';
    //Geometria e metadados
    const endPos = getElementCenter(element);
    const allPoints = [...fusionDrawingState.points, endPos];
    finalPath.setAttribute('d', generatePolylinePath(allPoints));
    //Salva referência de origem-destino e pontos intermediários no DOM
    finalPath.dataset.startId = fusionDrawingState.startElement.id;
    finalPath.dataset.endId = element.id;
    finalPath.dataset.points = JSON.stringify(fusionDrawingState.points.slice(1));
    //Renderização e interatividade
    const svgLayer = document.getElementById('fusion-svg-layer');
    svgLayer.appendChild(finalPath);
    //Mostra/oculta pontos de controle ao passar o mouse
    finalPath.addEventListener('mouseover', () => setHandlesVisibility(finalPath.id, true));
    finalPath.addEventListener('mouseout', () => setHandlesVisibility(finalPath.id, false));
    const intermediatePoints = fusionDrawingState.points.slice(1);
    intermediatePoints.forEach((point, index) => {
         const handle = createDraggableHandle(point.x, point.y, finalPath, index);
         handle.style.pointerEvents = 'auto';
         svgLayer.appendChild(handle);
    });
    //Listener de exclusão
    finalPath.addEventListener('click', (e) => {
      if (e.target.classList.contains('line-handle')) return;
      showConfirm('Excluir Conexão', 'Deseja excluir esta conexão?', () => {
          finalPath.remove();
          document.querySelectorAll(`.line-handle[data-line-id="${finalPath.id}"]`).forEach(h => h.remove());
      });
    });
    resetFusionDrawingState();
}

//Atualização visual da linha
function handleFusionCanvasMouseMove(event) {
    if (!fusionDrawingState.isActive) return;
    //Calcula posição relativa ao canvas considerando scroll
    const canvas = document.getElementById('fusionCanvas');
    const canvasRect = canvas.getBoundingClientRect();
    const mousePos = {
        x: event.clientX - canvasRect.left + canvas.scrollLeft,
        y: event.clientY - canvasRect.top + canvas.scrollTop
    };
    fusionDrawingState.tempLine.setAttribute('d', generatePolylinePath([...fusionDrawingState.points, mousePos]));
}

//Cancelamento de ação
function handleFusionCanvasRightClick(event) {
    event.preventDefault();
    if (fusionDrawingState.isActive) {
        //Se estava editando uma linha existente
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

//Criação de ponto de controle
function createDraggableHandle(cx, cy, linePath, index) {
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    handle.setAttribute('class', 'line-handle');
    handle.setAttribute('cx', cx);
    handle.setAttribute('cy', cy);
    handle.setAttribute('r', 6);
    //Vincula o handle à linha pai e ao índice do ponto no arry de coordenadas
    if (linePath.id) {
        handle.dataset.lineId = linePath.id;
    }
    //Listener para iniciar o arrasto do vértice
    handle.dataset.pointIndex = index;
    handle.addEventListener('mousedown', (e) => onHandleMouseDown(e, handle, linePath));
    return handle;
}

//Cálculo do ponto de ancoragem
function getElementCenter(element) {
    const parentComponent = element.closest('.splitter-element, .cable-element');
    const canvas = document.getElementById('fusionCanvas');
    //Fallback de segurança
    if (!parentComponent || !canvas) {
        console.error("Componente pai ou canvas não encontrado para o elemento:", element);
        const rect = element.getBoundingClientRect();
        const canvasRect = element.closest('.fusion-canvas').getBoundingClientRect();
        return {
            x: rect.left - canvasRect.left + rect.width / 2,
            y: rect.top - canvasRect.top + rect.height / 2
        };
    }
    //Cálculo da coordenada Y
    const y = parentComponent.offsetTop + element.offsetTop + (element.offsetHeight / 2);
    //Cálculo da coordenada X
    let x;
    const canvasMidpoint = canvas.offsetWidth / 2;
    const isComponentOnLeft = parentComponent.offsetLeft < canvasMidpoint;
    //Lógica para cabos
    if (parentComponent.classList.contains('cable-element')) {
        const colorShape = element.querySelector('.fiber-color-shape');
        if (colorShape) {
            const shapeLeftEdge = parentComponent.offsetLeft + element.offsetLeft + colorShape.offsetLeft;
            const shapeRightEdge = shapeLeftEdge + colorShape.offsetWidth;
            //Define o ponto de conexão na borda interna
            x = isComponentOnLeft ? shapeRightEdge : shapeLeftEdge;
        } else {
            const portLeftEdge = parentComponent.offsetLeft + element.offsetLeft;
            const portRightEdge = portLeftEdge + element.offsetWidth;
            x = isComponentOnLeft ? portRightEdge : portLeftEdge;
        }
    } else {
        //Lógica para splitters
        const portLeftEdge = parentComponent.offsetLeft + element.offsetLeft;
        const portRightEdge = portLeftEdge + element.offsetWidth;
        x = isComponentOnLeft ? portRightEdge : portLeftEdge;
    }
    return { x, y };
}

//Atualização visual das conexões
function updateAllConnections() {
    const svgLayer = document.getElementById('fusion-svg-layer');
    if (!svgLayer) return;
    //Itera sobre todas as linhas existentes para recalcular coordenadas
    const lines = svgLayer.querySelectorAll('.fusion-line');
    lines.forEach(line => {
        const startEl = document.getElementById(line.dataset.startId);
        const endEl = document.getElementById(line.dataset.endId);
        const intermediatePoints = JSON.parse(line.dataset.points);
        if (startEl && endEl) {
            //Recalcula o centro dos elementos conectados
            const startPos = getElementCenter(startEl);
            const endPos = getElementCenter(endEl);
            const allPoints = [startPos, ...intermediatePoints, endPos];
            line.setAttribute('d', generatePolylinePath(allPoints));
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

//Editor de pastas e projetos
function openFolderEditor(titleElement) {
    editingFolderElement = titleElement;
    const isProject = titleElement.dataset.isProject === 'true';
    //Configuração para projetos
    if (isProject) {
        const projectModal = document.getElementById('projectModal');
        document.getElementById('projectName').value = titleElement.dataset.folderName;
        document.getElementById('projectCity').value = titleElement.dataset.folderCity;
        document.getElementById('projectNeighborhood').value = titleElement.dataset.folderNeighborhood;
        document.getElementById('projectType').value = titleElement.dataset.folderType;
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

//Utilitário: Obter IDs de subpastas
function getAllDescendantFolderIds(startFolderId) {
    const startElement = document.getElementById(startFolderId);
    if (!startElement) return [];
    //Retorna ID da pasta atual
    const descendantUls = startElement.querySelectorAll('ul');
    return [startFolderId, ...Array.from(descendantUls).map(ul => ul.id)];
}

//Controle de visibilidade em massa
function handleVisibilityToggle(button) {
    const folderId = button.dataset.folderId;
    const isCurrentlyVisible = button.dataset.visible === 'true';
    const newVisibility = !isCurrentlyVisible;
    //Identifica todos os ID afetados
    const folderIdsToToggle = getAllDescendantFolderIds(folderId);
    //Aplica visibilidade a marcadores
    markers.forEach(markerInfo => {
        if (folderIdsToToggle.includes(markerInfo.folderId)) {
            markerInfo.marker.setVisible(newVisibility);
        }
    });
    //Aplica visibilidade a cabos
    savedCables.forEach(cable => {
        if (folderIdsToToggle.includes(cable.folderId)) {
            cable.polyline.setVisible(newVisibility);
        }
    });
    //Aplica visibilidade a polígono
    savedPolygons.forEach(polygon => {
        if (folderIdsToToggle.includes(polygon.folderId)) {
            polygon.polygonObject.setVisible(newVisibility);
        }
    });
    //Atualiza ícone e estado do botão
    button.dataset.visible = newVisibility;
    const iconSrc = newVisibility ? 'img/Mostrar.png' : 'img/Ocultar.png';
    button.innerHTML = `<img src="${iconSrc}" width="16" height="16" alt="Visibilidade">`;
    button.title = newVisibility ? 'Ocultar itens no mapa' : 'Exibir itens no mapa';
}

//Banco de dados de preços e materiais
const MATERIAL_PRICES = {
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

//Renderização das tabelas de materiais
function renderBomTable() {
    //Referência e limpeza das tabelas
    const ferragemBody = document.getElementById('ferragem-list-body');
    const cabosBody = document.getElementById('cabos-list-body');
    const fusaoBody = document.getElementById('fusao-list-body');
    const datacenterBody = document.getElementById('datacenter-list-body');
    ferragemBody.innerHTML = '';
    cabosBody.innerHTML = '';
    fusaoBody.innerHTML = '';
    datacenterBody.innerHTML = '';
    //Iteração sobre o estado atual da BOM
    for (const materialName in bomState) {
        const material = bomState[materialName];
        //Ignora itens marcados como removidos ou mão de obra
        if (material.removed || material.category === 'Mão de Obra') continue;
        //Formação de dados
        let displayName = materialName;
        if (material.category === 'Fusão') {
            displayName = materialName.toUpperCase();
        }
        const row = document.createElement('tr');
        const unit = material.type === 'length' || material.type === 'm' ? 'm' : 'un';
        //Lógica de exibição de decimais
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
        //Distribuição nas tabelas por categoria
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
    //Configuração dos listeners de botões
    document.querySelectorAll('.edit-qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
            const materialName = btn.dataset.materialName;
            openMaterialEditor(materialName);
        });
    });
    document.querySelectorAll('.remove-item-btn').forEach(btn => btn.addEventListener('click', () => handleRemoveItem(btn)));
    recalculateGrandTotal();
}

//Exporta a lista para Excel
function exportTablesToExcel() {
    const projectTitle = document.getElementById('materialModalTitle').textContent.replace('Lista de Materiais: ', '').trim();
    const fileName = `Lista_de_Materiais_${projectTitle.replace(/[^a-z0-9]/gi, '_')}.xlsx`;
    const wb = XLSX.utils.book_new();
    const headers = ["Item", "Tipo", "Quantidade", "Preço Unitário (R$)", "Preço Total (R$)"];
    const tablesToExport = [
        { id: 'ferragem-table', name: 'Ferragens' },
        { id: 'cabos-table', name: 'Cabos' },
        { id: 'fusao-table', name: 'Fusao' },
        { id: 'datacenter-table', name: 'Data Center' }
    ];
    tablesToExport.forEach(tableInfo => {
        const table = document.getElementById(tableInfo.id);
        if (table) {
            //Inicia o array de dados com os cabeçalhos
            const data = [headers];

            //Itera sobre as linhas do corpo da tabela (tbody)
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

            //Adiciona a linha de subtotal
            const footer = table.querySelector('tfoot tr');
            if (footer) {
                const footerCells = footer.querySelectorAll('td');
                const subtotalLabel = footerCells[0].textContent;
                const subtotalValue = footerCells[1].textContent;
                data.push(['', '', '', subtotalLabel, subtotalValue]); // Adiciona a linha de subtotal formatada
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
    //Calcula total de postes (1 a cada 35m)
    const totalPostes = Math.ceil(cableLength / 35);
    if (totalPostes <= 0) return hardware;
    //BAP: Igual à quantidade de postes
    const qtdBap = totalPostes;
    //SUPA (Ancoragem): 75% dos postes
    //Multiplicamos por 2 pois em ancoragem o cabo chega e sai
    const qtdSupa = Math.ceil((totalPostes * 0.75) * 2);
    //Suporte Dielétrico (Suspensão): Os 25% restantes dos postes
    const qtdSuporteDieletrico = Math.ceil(totalPostes * 0.25);
    //Alças Preformadas: 1 Alça para cada SUPA.
    const qtdAlcaPreformada = qtdSupa;
    // Itens Gerais
    hardware["PLAQUETA DE IDENTIFICAÇÃO"] = totalPostes;
    hardware["ABRAÇADEIRA BAP 3"] = qtdBap;
    //Itens de Suspensão (25%)
    hardware["SUPORTE DIELETRICO DUPLO"] = qtdSuporteDieletrico;
    hardware["PARAFUSO M12X35 - SEM PORCA"] = qtdSuporteDieletrico;
    hardware["SUPORTE REFORÇADO HORIZONTAL PARA BAP"] = qtdSuporteDieletrico;
    //Itens de Ancoragem (75%)
    hardware["SUPORTE ANCORAGEM PARA CABOS OPTICOS (SUPAS)"] = qtdSupa;
    // Adiciona a Alça Específica do Cabo
    if (alcaPreformadaName) {
        hardware[alcaPreformadaName] = qtdAlcaPreformada;
    }
    return hardware;
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
    const currentProjectBom = projectBoms[projectId] || {};
    for (const materialName in currentProjectBom) {
        if (currentProjectBom[materialName].category === 'Data Center') {
            preservedDatacenterItems[materialName] = currentProjectBom[materialName];
        }
    }
    bomState = {};
    const folderIdsToInclude = getAllDescendantFolderIds(projectId);
    const projectMarkers = markers.filter(m => folderIdsToInclude.includes(m.folderId));
    const projectCables = savedCables.filter(c => folderIdsToInclude.includes(c.folderId));
    //variáveis auxiliares
    let ctoCount = 0;
    let raqueteInstallCount = 0;
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
    //Processamento de marcadores
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
        //Lógica CEO
        if (type === 'CEO') {
            if (markerInfo.is144F) {
                addOrUpdateMaterial("CAIXA DE EMENDA OPTICA (CEO) 144 FUSÕES", 1);
            } else {
                addOrUpdateMaterial("CAIXA DE EMENDA ÓPTICA (CEO)", 1);
            }
            if (markerInfo.ceoAccessory === "Raquete") {
                raqueteInstallCount++;
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
        //Lógica reserva
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
        //Lógica cordoalha
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
    //Cálculos de ferragens
    if (raqueteInstallCount > 0) {
        const totalArameNeeded = raqueteInstallCount * 50;
        const arameRolls = Math.ceil(totalArameNeeded / 105);
        addOrUpdateMaterial("ARAME DE ESPIMAR (105 m)", arameRolls);
    }

    if (ctoCount > 0) {
        const fitaName = "FITA DE AÇO INOX 3/4'' (FITA FUSIMEC) ROLO DE 25M";
        addOrUpdateMaterial(fitaName, Math.ceil((3 * ctoCount) / 25));
    }
    //Plano de fusão
    projectMarkers.forEach(markerInfo => {
        if ((markerInfo.type === 'CTO' || markerInfo.type === 'CEO') && markerInfo.fusionPlan) {
            try {
                const planData = JSON.parse(markerInfo.fusionPlan);
                if (planData.elements) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = planData.elements;
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
                if (markerInfo.type === 'CEO' && planData.trayQuantity) {
                    const trayQuantity = parseInt(planData.trayQuantity, 10);
                    if (trayQuantity > 0) {
                        addOrUpdateMaterial("KIT DE BANDEJA PARA CAIXA DE EMENDA", trayQuantity);
                    }
                }
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
    //Processamento de cabos
    projectCables.forEach(cable => {
        if (cable.status === 'Existente' || cable.isImported) return;
        addOrUpdateMaterial(cable.type, cable.totalLength, 'length');
    });
    const tapeName = "FITA ISOLANTE";
    if (bomState["TUBETE PROTETOR DE EMENDA OPTICA"] || bomState["KIT DERIVAÇÃO PARA CAIXA DE EMENDA OPTICA"]) {
        if (!bomState[tapeName]) {
            addOrUpdateMaterial(tapeName, 1);
        }
    }
    //Ferragens dos cabos
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
    const aggregatedCableLengths = {};
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
    for (const materialName in preservedDatacenterItems) {
        if (!bomState[materialName]) {
            bomState[materialName] = preservedDatacenterItems[materialName];
        }
    }
}

//Remoção lógica de item
function handleRemoveItem(button) {
    const name = button.dataset.materialName;
    showConfirm('Remover Item', `Tem certeza que deseja remover "${name}" da lista?`, () => {
        bomState[name].removed = true;
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
    bomState[name] = { quantity, type: 'un', unitPrice, category, removed: false };
    renderBomTable();
    document.getElementById('addMaterialModal').style.display = 'none';
}

//Abertura do editor dos materiais
function openMaterialEditor(materialName) {
    const materialData = bomState[materialName];
    if (!materialData) {
        showAlert('Erro', 'Não foi possível encontrar o material para edição.');
        return;
    }
    //Preenche os campos com os valores atuais
    document.getElementById('originalMaterialName').value = materialName;
    document.getElementById('editMaterialName').value = materialName;
    document.getElementById('editMaterialQty').value = materialData.quantity;
    document.getElementById('editMaterialUnit').value = materialData.type;
    document.getElementById('editMaterialPrice').value = materialData.unitPrice;
    document.getElementById('editMaterialModal').style.display = 'flex';
}

//Processamento da edição e atualização
function handleUpdateMaterial() {
    const originalName = document.getElementById('originalMaterialName').value;
    const newName = document.getElementById('editMaterialName').value.trim();
    const newQty = parseFloat(document.getElementById('editMaterialQty').value);
    const newUnit = document.getElementById('editMaterialUnit').value.trim();
    const newPrice = parseFloat(document.getElementById('editMaterialPrice').value);
    //Validações básicas
    if (!newName) {
        showAlert('Erro', 'O nome do material não pode ser vazio.');
        return;
    }
    if (isNaN(newQty) || newQty < 0 || isNaN(newPrice) || newPrice < 0) {
        showAlert('Erro', 'Quantidade e Preço devem ser números válidos e não-negativos.');
        return;
    }
    const originalCategory = bomState[originalName]?.category || 'Outros';
    //Lógica da remoção de chave no objeto
    if (originalName !== newName) {
        if (bomState[newName]) {
            showAlert('Erro', 'Já existe um material com este novo nome. Por favor, escolha outro nome.');
            return;
        }
        delete bomState[originalName];
    }
    //Atualiza o estado com os novos valores
    bomState[newName] = {
        quantity: newQty,
        type: newUnit,
        unitPrice: newPrice,
        category: originalCategory,
        removed: false
    };
    document.getElementById('editMaterialModal').style.display = 'none';
    renderBomTable();
}

//Levantamento de Quantitativos do Projeto
function getProjectQuantities() {
    //Verifica se há um projeto ativo. Sem isso, a função pegava todos os cabos.
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione um projeto para calcular a mão de obra.");
        return { cableLength: 0, cordoalhaLength: 0, ctoCount: 0, ceoCount: 0, reservaCount: 0 };
    }
    //Encontra o ID do projeto raiz a partir do item ativo na barra lateral.
    const projectRootElement = document.getElementById(activeFolderId).closest('.folder');
    if (!projectRootElement) {
        console.error("Não foi possível encontrar o projeto raiz para o cálculo da mão de obra.");
        return { cableLength: 0, cordoalhaLength: 0, ctoCount: 0, ceoCount: 0, reservaCount: 0 };
    }
    const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
    //Pega APENAS os marcadores e cabos que pertencem ao projeto ativo.
    const { markers: projectMarkers, cables: projectCables } = getProjectItems(projectId);
    let totalLength = 0;
    let cordoalhaLength = 0;
    let ctoCount = 0;
    let ceoCount = 0;
    let reservaCount = 0;
    //Itera sobre a lista FILTRADA de cabos e usa o comprimento total correto.
    projectCables.forEach(cable => {
        if (cable.status !== 'Existente') {
            totalLength += cable.totalLength;
        }
    });
    //Itera sobre a lista FILTRADA de marcadores.
    projectMarkers.forEach(marker => {
        if (marker.type === 'CTO' && marker.ctoStatus !== 'Existente') ctoCount++;
        if (marker.type === 'CEO' && marker.ceoStatus !== 'Existente') ceoCount++;
        if (marker.type === 'RESERVA' && marker.reservaStatus !== 'Existente') reservaCount++;
        if (marker.type === 'CORDOALHA' && marker.cordoalhaStatus !== 'Existente') {
            cordoalhaLength += 50;
        }
    });
    return {
        cableLength: Math.round(totalLength),
        cordoalhaLength: Math.round(cordoalhaLength),
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
        bomState = JSON.parse(JSON.stringify(projectBoms[projectId]));
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
                detailsHtml = `
                    <ul class="details-list">
                        <li><strong>Técnicos:</strong> ${details.techs || 'N/A'}</li>
                        <li><strong>Dias Calc.:</strong> ${details.days || 'N/A'}</li>
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
        const calculatedDays = Math.ceil((quantities.cableLength / 2000) + (quantities.ctoCount / 10) + (quantities.ceoCount / 1));
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
    const baseCost = techs * days * 8 * 40;
    const totalFuel = fuelQty * fuelPrice;
    const totalFood = foodQty * foodPrice;
    const totalLodging = lodgingQty * lodgingPrice;
    const totalToll = tollQty * tollPrice;
    const totalCost = baseCost + totalFuel + totalFood + totalLodging + totalToll;
    document.getElementById('regionalBaseCostDisplay').textContent = `R$ ${baseCost.toFixed(2).replace('.', ',')}`;
    document.getElementById('regionalTotalCostDisplay').textContent = `R$ ${totalCost.toFixed(2).replace('.', ',')}`;
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
    const baseCost = techs * manualDays * 8 * 40;
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
    tableBody.innerHTML = ''; 
    let savedServicesData = {};
    // Configura para MODO EDIÇÃO
    if (itemNameForEdit && bomState[itemNameForEdit]) {
        titleElement.textContent = 'Editar Mão de Obra Terceirizada';
        confirmButton.textContent = 'Salvar Alterações';
        modal.dataset.editingItemName = itemNameForEdit;
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
        modal.dataset.editingItemName = '';
        companyNameInput.value = ''; 
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
        input.oninput = null;
        input.oninput = updateOutsourcedCost;
    });
    updateOutsourcedCost();
    modal.style.display = 'flex'; 
}

//Atualização em tempo real do custo terceirizado
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

//Confirmação e persistência de dados de mão de obra terceirizada
function handleOutsourcedLaborConfirm() {
    const modal = document.getElementById('outsourcedLaborModal');
    // Pega o nome do item que estava sendo editado
    const editingItemName = modal.dataset.editingItemName;
    // Pega o nome da empresa
    const companyName = document.getElementById('outsourcedCompanyName').value.trim() || 'Terceirizada';
    // Calcula o custo total a partir do display
    const totalCostString = document.getElementById('outsourcedTotalCostDisplay').textContent;
    const totalCost = parseFloat(totalCostString.replace('R$ ', '').replace(/[.]/g, '').replace(',', '.'));
    // Coleta os dados de todos os serviços
    const services = [];
    document.querySelectorAll('.outsourced-qty-input').forEach(input => {
        services.push({
            name: input.dataset.name,
            price: parseFloat(input.dataset.price),
            unit: input.dataset.unit,
            qty: parseFloat(input.value) || 0 
        });
    });
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

//Recalcular o tatal financeiro
function recalculateGrandTotal() {
    //Divizão por categoria
    let ferragemTotal = 0;
    let cabosTotal = 0;
    let fusaoTotal = 0;
    let datacenterTotal = 0;
    //Somatória
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
    //Atualização
    const grandTotal = ferragemTotal + cabosTotal + fusaoTotal + datacenterTotal;
    document.getElementById('ferragem-total-price').textContent = `R$ ${ferragemTotal.toFixed(2).replace('.', ',')}`;
    document.getElementById('cabos-total-price').textContent = `R$ ${cabosTotal.toFixed(2).replace('.', ',')}`;
    document.getElementById('fusao-total-price').textContent = `R$ ${fusaoTotal.toFixed(2).replace('.', ',')}`;
    document.getElementById('datacenter-total-price').textContent = `R$ ${datacenterTotal.toFixed(2).replace('.', ',')}`;
    document.getElementById('grand-total-price').textContent = `R$ ${grandTotal.toFixed(2).replace('.', ',')}`;
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

//Sumarização dos custos - relatório
function summarizeBomCosts(projectBom) {
    //Inicialização de acumuladores
    let ferragemTotal = 0;
    let cabosTotal = 0;
    let fusaoTotal = 0;
    let datacenterTotal = 0;
    //Interação e calculo
    for (const name in projectBom) {
        const item = projectBom[name];
        //ignora itens removidos ou sem categoria
        if (item.removed || !item.category) continue;
        //Calcula total do item
        const itemTotal = (item.quantity || 0) * (item.unitPrice || 0);
        //Divisão por categoria
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

//Cálculo de custos do projeto
function calculateProjectCost(projectMarkers, projectCables) {
    const tempBomState = {};
    let ctoCount = 0;
    let raqueteInstallCount = 0;
    const addOrUpdate = (name, qty, type = 'unit') => {
        if (!name || qty <= 0) return;
        const priceInfo = MATERIAL_PRICES[name] || { price: 0, category: 'Outros' };
        if (!tempBomState[name]) {
        tempBomState[name] = { quantity: 0, type: type, unitPrice: priceInfo.price, category: priceInfo.category };
        }
        tempBomState[name].quantity += qty;
    };
    //Processamento dos marcadores
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
    })
    //Cálculos de consumíveis - ferragens
    if (raqueteInstallCount > 0) {
        const totalArameNeeded = raqueteInstallCount * 50;
        const arameRolls = Math.ceil(totalArameNeeded / 105);
        addOrUpdate("ARAME DE ESPIMAR (105 m)", arameRolls);
    }
    if (ctoCount > 0) {
        addOrUpdate("FITA DE AÇO INOX 3/4'' (FITA FUSIMEC) ROLO DE 25M", Math.ceil((3 * ctoCount) / 25));
    }
    //Processamento de fusões
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
    //Processamento de cabos e ferragens
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
    //Sumarização financeira final
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
function getProjectQuantitiesFromItems(projectItems) {
    //Inicialização dos contadores
    let totalLength = 0, cordoalhaLength = 0, ctoCount = 0, ceoCount = 0, reservaCount = 0;
    //Somatório dos cabos
    projectItems.cables.forEach(cable => {
        if (cable.status !== 'Existente') {
            totalLength += cable.totalLength;
        }
    });
    //Contagem de ativos
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

//Abertura do modal de relatórios
function openReportModal() {
    //Limpeza da seleção DOM
    const projectListUl = document.getElementById("report-projects-ul");
    projectListUl.innerHTML = "";
    //Busca todos os elementos identificados como projetos na sidebar
    const projectElements = document.querySelectorAll('.folder-title[data-is-project="true"]');
    //Construção da lista de seleção
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

//Geração e exibição de detalhes do relatório de projeto
function showProjectReportDetails(projectId, projectName) {
    console.log(`--- Gerando Relatório para Projeto ID: ${projectId}, Nome: ${projectName} ---`);
    //Configuração inicial
    document.getElementById('report-project-details').dataset.currentProjectId = projectId;
    const projectElement = document.querySelector(`.folder-title[data-folder-id="${projectId}"]`);
    const { markers: projectMarkers, cables: projectCables } = getProjectItems(projectId);
    const projectItems = { markers: projectMarkers, cables: projectCables };
    const quantities = getProjectQuantitiesFromItems(projectItems);
    //Contagem de portas
    let portasExistentes = 0;
    let novasPortas = 0;
    console.log("Iniciando contagem de portas...");
    projectMarkers.forEach(marker => {
        if ((marker.type === 'CTO' || marker.type === 'CEO') && marker.fusionPlan) {
        console.log(` -> Verificando plano da caixa: "${marker.name}" (Tipo: ${marker.type})`); 
        try {
            const planData = JSON.parse(marker.fusionPlan);
            if (!planData.elements) {
                console.log("    WARN: planData.elements não encontrado neste plano. Pulando contagem de portas."); 
                return; 
            }
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = planData.elements;
            const splitters = tempDiv.querySelectorAll('.splitter-atendimento');
            console.log(`    Encontrados ${splitters.length} splitter(s) de atendimento.`); 
            splitters.forEach(splitterElement => {
                const status = splitterElement.dataset.status;
                const labelElement = splitterElement.querySelector('.splitter-body span');
                const label = labelElement ? labelElement.textContent.trim() : null;
                console.log(`      - Splitter encontrado: Label="${label || 'N/A'}", Status="${status || 'N/A'}"`); 
                if (!label || !status) {
                    console.log("        WARN: Label ou Status do splitter não encontrado. Pulando este splitter."); 
                    return;
                }
                const ratioMatch = label.match(/1:(\d+)/);
                const portsInThisSplitter = ratioMatch ? parseInt(ratioMatch[1], 10) : 0;
                console.log(`        Portas extraídas do label: ${portsInThisSplitter}`);
                if (status === 'Existente') {
                    portasExistentes += portsInThisSplitter;
                    console.log(`        Adicionado a portasExistentes. Total agora: ${portasExistentes}`);  
                } else {
                    novasPortas += portsInThisSplitter;
                    console.log(`        Adicionado a novasPortas. Total agora: ${novasPortas}`);   
                }
            });
            } catch (e) {
                console.error(`    ERRO ao analisar portas no plano de fusão da caixa "${marker.name}":`, e);
            }
        }
    });
    console.log(`Contagem Final: Existentes=${portasExistentes}, Novas=${novasPortas}`);
    const totalPortas = portasExistentes + novasPortas;
    //Contagem de casas
    const totalCasas = projectMarkers.filter(m => m.type === 'CASA').reduce((sum, m) => sum + parseInt(m.name || 0, 10), 0);
    //Cálculo financeiros
    const projectBomForReport = projectBoms[projectId] || {};
    const materialCosts = summarizeBomCosts(projectBomForReport);
    const laborCosts = calculateProjectLaborCost(projectItems, projectBomForReport); 
    const materialCost = materialCosts.grandTotal;
    const laborCost = laborCosts.totalLaborCost;
    const totalCost = materialCost + laborCost;
    //Margem de segurança
    const safetyCoef = totalCost * 0.05;
    const finalCost = totalCost + safetyCoef;
    const costPerPort = novasPortas > 0 ? (finalCost / novasPortas) : 0;
    const prazoEstimado = Math.ceil((quantities.cableLength / 2000) + (quantities.ctoCount / 10) + (quantities.ceoCount / 1));
    const penetrationRate = (totalCasas > 0) ? (totalPortas / totalCasas) * 100 : 0;
    //Atualizações da interface
    document.getElementById("report-title").textContent = `Relatório: ${projectName}`;
    document.getElementById("report-neighborhoods").textContent = projectElement.dataset.folderNeighborhood || 'N/A';
    //Métricas físicas
    document.getElementById("report-houses").textContent = totalCasas;
    document.getElementById("report-existing-ports").textContent = portasExistentes;
    document.getElementById("report-new-ports").textContent = novasPortas;      
    document.getElementById("report-total-ports").textContent = totalPortas;     
    document.getElementById("report-penetration-rate").textContent = `${penetrationRate.toFixed(2)} %`;
    document.getElementById("report-cable-length").textContent = `${quantities.cableLength} m`;
    //Métricas financeiras
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
    //KPIs finais
    document.getElementById("report-cost-per-port").textContent = `R$ ${costPerPort.toFixed(2).replace('.', ',')}`;
    document.getElementById("report-duration").textContent = `${prazoEstimado} dias`;
    //Alteração visibilidade para os detalhes
    document.getElementById("report-project-list").classList.add("hidden");
    document.getElementById("report-project-details").classList.remove("hidden");
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

//Inicia a ferramenta de desenho de polígono ou abre o editor.
function startPolygonTool() {
    //Validação de conflitos
    if (isDrawingCable || isAddingMarker || isMeasuring) {
        showAlert("Atenção", "Finalize a ação atual antes de desenhar um polígono.");
        return;
    }
    //Validação se a pasta está ativa
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione uma pasta de projeto para salvar o polígono.");
        return;
    }
    //Preparação do estado e interface
    isDrawingPolygon = true;
    editingPolygonIndex = null;
    //Reseta o painel de propriedades do polígono
    const box = document.getElementById('polygonDrawingBox');
    document.getElementById('polygonBoxTitle').textContent = 'Desenhar Polígono';
    document.getElementById('polygonName').value = '';
    document.getElementById('polygonColor').value = '#2196f3';
    document.getElementById('deletePolygonButton').classList.add('hidden');
    box.classList.remove('hidden');
    document.getElementById('toolsDropdown').classList.remove('show');
    //Configuração do desenho
    if (!drawingManager) {
        drawingManager = new google.maps.drawing.DrawingManager({
        drawingMode: google.maps.drawing.OverlayType.POLYGON,
        drawingControl: false,
        polygonOptions: {
            fillColor: '#2196f3',
            fillOpacity: 0.5,
            strokeWeight: 2,
            strokeColor: '#2196f3',
            clickable: false,
            editable: true,
            zIndex: 1
        }
        });
        drawingManager.setMap(map);
        google.maps.event.addListener(drawingManager, 'polygoncomplete', (polygon) => {
        if (tempPolygon) {
            tempPolygon.setMap(null);
        }
        tempPolygon = polygon;
        drawingManager.setDrawingMode(null);
        });
    } else {
        drawingManager.setMap(map);
        drawingManager.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
    }
    setMapCursor("crosshair");
}


//Salva um polígono novo ou atualiza um existente.
function savePolygon() {
    //Validação dos dados
    const name = document.getElementById('polygonName').value.trim();
    const color = document.getElementById('polygonColor').value;
    if (!name) {
        showAlert("Erro", "Por favor, dê um nome ao polígono.");
        return;
    }
    let finalPolygon;
    //Fluxo de edição
    if (editingPolygonIndex !== null) {
        const polygonInfo = savedPolygons[editingPolygonIndex];
        finalPolygon = polygonInfo.polygonObject;
        //Atualiza os dados
        polygonInfo.name = name;
        polygonInfo.color = color;
        //Salva novas coordenadas caso tenha arrastado o vértice
        polygonInfo.path = finalPolygon.getPath().getArray().map(p => ({lat: p.lat(), lng: p.lng()}));
        finalPolygon.setOptions({ fillColor: color, strokeColor: color, editable: false });
        polygonInfo.listItem.querySelector('.item-name').textContent = name;
        polygonInfo.listItem.querySelector('.item-icon').style.backgroundColor = color;
    } else {
        //Fluxo de criação
        if (!tempPolygon) {
            showAlert("Erro", "Desenhe um polígono no mapa antes de salvar.");
            return;
        }
        finalPolygon = tempPolygon;
        tempPolygon = null;
        //Finaliza o desenho no mapa
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
        //Clique no mapa ou na lista para abrir o editor
        finalPolygon.addListener('click', () => openPolygonEditor(polygonInfo));
        nameSpan.addEventListener('click', () => openPolygonEditor(polygonInfo));
        //Botão de visibilidade
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

//Abrir o editor do polígono
function openPolygonEditor(polygonInfo) {
    //Valida a localização
    if (!polygonInfo) return;
    const index = savedPolygons.indexOf(polygonInfo);
    if (index === -1) {
        showAlert("Erro", "Não foi possível encontrar o polígono para edição.");
        return;
    }
    //Reset de ferramentas com limpeza e conflito
    cancelPolygonDrawing();
    cancelCableButton.click();
    //Configuração do estado global
    editingPolygonIndex = index;
    isDrawingPolygon = true;
    //Atualização da interface
    const box = document.getElementById('polygonDrawingBox');
    document.getElementById('polygonBoxTitle').textContent = 'Editar Polígono';
    document.getElementById('polygonName').value = polygonInfo.name;
    document.getElementById('polygonColor').value = polygonInfo.color;
    document.getElementById('deletePolygonButton').classList.remove("hidden");
    box.classList.remove("hidden");
    //Visual no mapa
    polygonInfo.polygonObject.setEditable(true);
}


//Cancela a operação de desenho ou edição de polígono.
function cancelPolygonDrawing() {
    //Desativação da ferramenta de criação
    if (drawingManager) {
        drawingManager.setMap(null); 
        drawingManager.setDrawingMode(null);
    }
    //Limpeza dos polígonos não salvos
    if (tempPolygon) {
        tempPolygon.setMap(null); 
        tempPolygon = null;
    }
    //Reversão de edição
    if (editingPolygonIndex !== null) {
        const polygonInfo = savedPolygons[editingPolygonIndex];
        if (polygonInfo) {
            polygonInfo.polygonObject.setPath(polygonInfo.path);
            polygonInfo.polygonObject.setEditable(false);
        }
    }
    //Reset da interface
    document.getElementById('polygonDrawingBox').classList.add('hidden');
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
        //Remove o polígono do mapa
        polygonInfo.polygonObject.setMap(null);
        //Remove o item da lista na barra lateral
        polygonInfo.listItem.remove();
        //Remove o polígono do nosso array de dados
        savedPolygons.splice(editingPolygonIndex, 1);
        //Limpa a interface e reseta o estado da ferramenta
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

//Inicia a ferramenta de régua de medição
function startRuler() {
    //Validação de conflitos
    if (isDrawingCable || isAddingMarker || (drawingManager && drawingManager.getMap())) {
        showAlert("Atenção", "Finalize a ação atual antes de usar a régua.");
        return;
    }
    //Configuração da interface e estado global
    isMeasuring = true;
    document.getElementById('toolsDropdown').classList.remove('show');
    document.getElementById('rulerBox').classList.remove('hidden');
    document.getElementById('rulerDistance').textContent = 'Distância: 0 m';
    setMapCursor('crosshair');
    // Limpa medições anteriores
    stopRuler(false);
    isMeasuring = true;
    //Cria a linha visual da régua
    rulerPolyline = new google.maps.Polyline({
        path: [],
        geodesic: true,
        strokeColor: '#FF0000',
        strokeOpacity: 1.0,
        strokeWeight: 3,
        map: map
    });
    //Adiciona o listener de clique no mapa para a régua
    map.addListener('click', handleRulerClick);
}

//Lida com cada clique no mapa durante a medição.
function handleRulerClick(event) {
    //Validação do estado
    if (!isMeasuring) return;
    //Atualização da geometria da linha
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


//Para a ferramenta de régua e limpa os elementos do mapa.
function stopRuler(hideBox = true) {
    //Reset do estado e interface
    isMeasuring = false;
    setMapCursor('');
    if (hideBox) {
        document.getElementById('rulerBox').classList.add('hidden');
    }
    //Limpeza da linha e marcadores do vertice
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

//Mostra ou esconde todos os pontos de controle associados a uma linha de fusão.
function setHandlesVisibility(lineId, isVisible) {
    const handles = document.querySelectorAll(`.line-handle[data-line-id="${lineId}"]`);
    handles.forEach(handle => {
        handle.style.opacity = isVisible ? '1' : '0';
    });
}

 //Verifica se uma porta específica já possui uma conexão de fusão.
function isPortConnected(portId) {
    // Esta busca agora ignora automaticamente a linha que está em edição.
    const existingLines = document.querySelectorAll('#fusion-svg-layer .fusion-line');
    for (const line of existingLines) {
         //Se encontrou uma conexão
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
                folderContent += `
                <Placemark>
                    <name>${sanitizeForKML(cable.name)}</name>
                    <Style><LineStyle><color>${toKmlColor(cable.color, 'ff')}</color><width>${cable.width || 3}</width></LineStyle></Style>
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
function handleKmlFileSelect(event) {
    //Seleciona o arquivo
    const file = event.target.files[0];
    if (!file) {
        return;
    }
    //Configuração de leitura do arquivo
    const reader = new FileReader();
    //Callback executado quando o arquivo termina de carregar
    reader.onload = function(e) {
        const kmlText = e.target.result;
        //Transforma a strig do arquivo em elementos navegáveis
        try {
            const parser = new DOMParser();
            const kmlDoc = parser.parseFromString(kmlText, "text/xml");
            parseAndDisplayKML(kmlDoc);
        } catch (error) {
            showAlert("Erro de Importação", "Não foi possível ler o arquivo KML. Verifique se o arquivo está no formato correto.");
            console.error("Erro ao processar KML:", error);
        }
    };
    //Execução da leitura e reset
    reader.readAsText(file);
    event.target.value = '';
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
    //Definir pasta ativa
    titleDiv.onclick = (e) => {
        if (e.target.closest('.folder-buttons') || e.target.closest('.toggle-icon')) return;
        e.stopPropagation();
        setActiveFolder(folderId);
    };
    //Configuração de drag & drop
    addDropTargetListenersToFolderTitle(titleDiv);
    enableDropOnFolder(subList);
    //Renderização no DOM
    parentUl.appendChild(wrapperLi);
    return folderId;
}

//Processamento recursivo de nós KML na importação
function processKmlNode(kmlNode, parentSidebarId) {
    let itemsImported = 0;
    //Intera sobre os filhos do nó XML autal
    for (const child of kmlNode.children) {
        const nodeName = child.tagName;
        //Pasta
        if (nodeName === 'Folder') {
            const folderName = child.querySelector('name')?.textContent || 'Pasta Importada';
            const newFolderId = createFolderFromKML(folderName, parentSidebarId);
            if (newFolderId) {
                itemsImported += processKmlNode(child, newFolderId);
            }
        //Item
        } else if (nodeName === 'Placemark') {
            const name = child.querySelector('name')?.textContent.trim() || 'Item importado';
            const description = child.querySelector('description')?.textContent.trim() || '';
            //Identifica se é ponto, linha ou polígono
            const point = child.querySelector('Point');
            const line = child.querySelector('LineString');
            const polygon = child.querySelector('Polygon');
            //Importação de marcadores
            if (point) {
                const coordsText = point.querySelector('coordinates')?.textContent.trim();
                if (!coordsText) continue;
                const [lng, lat] = coordsText.split(',');
                const position = new google.maps.LatLng(parseFloat(lat), parseFloat(lng));
                const currentFolderId = parentSidebarId;
                const originalActiveFolder = activeFolderId;
                activeFolderId = currentFolderId;
                addCustomMarker(position, {
                    type: 'Importado',
                    name,
                    color: '#ff0000',
                    labelColor: '#ff0000',
                    size: 5,
                    description,
                    isImported: true 
                });
                activeFolderId = originalActiveFolder;
                itemsImported++;
            //Importação de cabos
            } else if (line) {
                const coordsText = line.querySelector('coordinates')?.textContent.trim();
                if (!coordsText) continue;
                //Coordenadas KML
                const path = coordsText.split(/\s+/).filter(c => c).map(pair => {
                        const [lng, lat] = pair.split(',');
                    return new google.maps.LatLng(parseFloat(lat), parseFloat(lng));
                });
                //Criação visual e lógica do cabo
                const polyline = new google.maps.Polyline({ path, map, strokeColor: '#FFC300', strokeWeight: 3, clickable: true });
                const item = document.createElement("li");
                enableDragAndDropForItem(item);
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                const nameSpan = document.createElement("span");
                nameSpan.className = 'item-name';
                nameSpan.style.flexGrow = '1';
                nameSpan.textContent = `${name} (Cabo Importado)`;
                item.appendChild(nameSpan);
                const adjustBtn = document.createElement("button");
                adjustBtn.className = 'adjust-kml-btn';
                adjustBtn.textContent = 'Ajustar Cabo';
                item.appendChild(adjustBtn);
                const visibilityBtn = document.createElement("button");
                visibilityBtn.className = 'visibility-toggle-btn item-toggle';
                visibilityBtn.innerHTML = `<img src="img/Mostrar.png" width="16" height="16" alt="Visibilidade">`;
                visibilityBtn.title = 'Ocultar/Exibir item no mapa';
                visibilityBtn.dataset.visible = 'true';
                item.appendChild(visibilityBtn);
                document.getElementById(parentSidebarId).appendChild(item);
                //Registro no arry global de cabos
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
                visibilityBtn.onclick = (e) => {
                    e.stopPropagation();
                    const isVisible = newCableInfo.polyline.getVisible();
                    newCableInfo.polyline.setVisible(!isVisible);
                    const iconSrc = isVisible ? 'img/Ocultar.png' : 'img/Mostrar.png';
                    visibilityBtn.querySelector('img').src = iconSrc;
                };
                itemsImported++;
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
                const icon = li.querySelector('.item-icon');
                const nameSpan = li.querySelector('.item-name');
                const visibilityBtn = li.querySelector('.visibility-toggle-btn');
                nameSpan.textContent = name;
                icon.style.backgroundColor = polygonColor;
                visibilityBtn.dataset.visible = 'true';
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
                polygonObject.addListener('click', () => openPolygonEditor(polygonInfo));
                nameSpan.addEventListener('click', () => openPolygonEditor(polygonInfo));
                visibilityBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isVisible = polygonObject.getVisible();
                    polygonObject.setVisible(!isVisible);
                    visibilityBtn.dataset.visible = !isVisible;
                    visibilityBtn.querySelector('img').src = !isVisible ? 'img/Mostrar.png' : 'img/Ocultar.png';
                });
                itemsImported++;
            }
        }
    }
    return itemsImported;
}

//Ponto de entrada da importação
function parseAndDisplayKML(kmlDoc) {
    //Validação de contexto
    if (!activeFolderId) {
        showAlert("Atenção", "Selecione um projeto ou uma pasta para importar os dados do KML.");
        return;
    }
    //Normalização e execução da importação
    const rootNode = kmlDoc.querySelector('Document') || kmlDoc.documentElement;
    const totalItems = processKmlNode(rootNode, activeFolderId);
    showAlert("Importação Concluída", `${totalItems} elementos foram importados, mantendo a estrutura de pastas do arquivo.`);
}

//Inicia o processo de ajuste de um marcador KML importado, guardando a sua informação e abrindo o modal de seleção de tipo.
function startMarkerAdjustment(markerInfo) {
    // Guarda a informação do marcador que estamos a ajustar
    adjustingKmlMarkerInfo = markerInfo;
    // Abre o primeiro passo do fluxo de criação: a seleção do tipo de marcador
    document.getElementById('markerTypeModal').style.display = 'flex';
}

//Ancoragem automática do cabo
function handleCableVertexDragEnd(vertexIndex) {
    //validação de estado
    if (!isDrawingCable || !cableMarkers[vertexIndex]) {
        return;
    }
    //Ancoragem feita nas pontas do cabo
    const isEndpoint = (vertexIndex === 0 || vertexIndex === cableMarkers.length - 1);
    if (!isEndpoint) {
        return;
    }
    //Busca de proximidade
    const draggedVertex = cableMarkers[vertexIndex];
    const newPosition = draggedVertex.getPosition();
    let closestMarker = null;
    let minDistance = Infinity;
    //Filtro para elementos ancoráveis
    markers.forEach(markerInfo => {
        if (markerInfo.type === "CEO" || markerInfo.type === "CTO" || markerInfo.type === "RESERVA") {
            const distance = google.maps.geometry.spherical.computeDistanceBetween(newPosition, markerInfo.marker.getPosition());
            if (distance < minDistance) {
                minDistance = distance;
                closestMarker = markerInfo;
            }
        }
    });
    //Aplicação da ancoragem
    if (closestMarker && minDistance < 20) {
        const markerPosition = closestMarker.marker.getPosition();
        draggedVertex.setPosition(markerPosition);
        updatePolylineFromMarkers();
        showAlert("Ancorado!", `A ponta do cabo foi vinculada ao marcador "${closestMarker.name}".`);
    }
}

//Busca de projeto no firestore, filtros e carregamento
function searchProjectsInFirestore() {
    //Validação da atutenticação
    const currentUser = auth.currentUser;
    if (!currentUser) {
        showAlert("Erro", "Você precisa estar logado para buscar projetos.");
        return;
    }
    //Captura filtros de busca
    const nameFilter = document.getElementById('searchProjectName').value.trim();
    const cityFilter = document.getElementById('searchProjectCity').value.trim();
    const neighborhoodFilter = document.getElementById('searchProjectNeighborhood').value.trim();
    if (!nameFilter && !cityFilter && !neighborhoodFilter) {
        showAlert("Atenção", "Preencha pelo menos um campo para realizar a busca.");
        return;
    }
    //Configuração da query do firestore
    const listElement = document.getElementById('saved-projects-list');
    listElement.innerHTML = '<li>Buscando projetos...</li>';
    let query = db.collection("users").doc(currentUser.uid).collection("projects");
    //Aplica filtros compostos
    if (nameFilter) {
        query = query.where('projectName', '==', nameFilter);
    }
    if (cityFilter) {
        query = query.where('sidebar.city', '==', cityFilter);
    }
    if (neighborhoodFilter) {
        query = query.where('sidebar.neighborhood', '==', neighborhoodFilter);
    }
    //Execução da busca e renderizaçãdo dos resultados
    query.get().then((querySnapshot) => {
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
            li.querySelector('.load-project-btn').addEventListener('click', () => {
                if (document.getElementById(projectId)) {
                    showAlert("Aviso", `O projeto "${project.projectName}" já está carregado na barra lateral.`);                        return;
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

//Inversão de sentido do cabo
function invertCableDirection() {
    //Validação inicial
    if (editingCableIndex === null) {
        showAlert("Erro", "Nenhum cabo selecionado para inverter.");
        return;
    }
    const cableToInvert = savedCables[editingCableIndex];
    //Bloqueia a inversão se o cabo já estiver conectado
    const usage = checkCableUsageInFusionPlans(cableToInvert);
    if (usage.isInPlan) {
        showAlert("Ação Bloqueada",`Este cabo não pode ser invertido porque está em uso no plano de fusão da(s) caixa(s): ${usage.locations.join(', ')}. Remova o cabo do plano de fusão antes de inverter.`);
        return;
    }
    //Execução da inversão
    showConfirm('Inverter Cabo', 'Tem certeza que deseja inverter a direção deste cabo? Isso irá recalcular a reserva técnica com base nas novas pontas.', () => {
        cableToInvert.path.reverse();
        cablePath = [...cableToInvert.path];
        //Reconstrução visual
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
        //Atualiza os dados
        updatePolylineFromMarkers();
        //Atualiza propriedade do obejeto
        cableToInvert.lancamento = cableDistance.lancamento;
        cableToInvert.reserva = cableDistance.reserva;
        cableToInvert.totalLength = cableDistance.total;
        //Atualiza o texto na barra lateral
        cableToInvert.item.querySelector('.item-name').textContent = `${cableToInvert.name} (${cableToInvert.status}) - ${cableToInvert.totalLength}m`;
        showAlert("Sucesso", "A direção do cabo foi invertida.");
    });
}

//Listener de inicialização
document.addEventListener('DOMContentLoaded', () => {
   document.getElementById("invertCableButton").addEventListener("click", invertCableDirection);
});

//Utilitários de layout
function updateSvgLayerSize() {
    //Garante que a camada SVG acompanhe todo o tamnaho do scrll do canvas
    const canvas = document.getElementById('fusionCanvas');
    const svgLayer = document.getElementById('fusion-svg-layer');
    if (canvas && svgLayer) {
        svgLayer.style.width = canvas.scrollWidth + 'px';
        svgLayer.style.height = canvas.scrollHeight + 'px';
    }
}

//Descrição da conexão - fusão
function getConnectionDescription(portId) {
    //Localização no DOM
    const portElement = document.getElementById(portId);
    if (!portElement) return 'Desconhecido';
    //Identificação do componente pai
    const parentComponent = portElement.closest('.cable-element, .splitter-element');
    if (!parentComponent) return 'Componente Desconhecido';
    //Formatação para cabos
    if (parentComponent.classList.contains('cable-element')) {
        const cableName = parentComponent.dataset.cableName || 'Cabo';
        const fiberNumber = portId.split('-').pop();
        return `${cableName}, Fibra ${fiberNumber}`;
    }
    //Formatação para splitter
    if (parentComponent.classList.contains('splitter-element')) {
        const splitterLabel = parentComponent.querySelector('.splitter-body span')?.textContent || 'Splitter';
        const portLabel = portElement.querySelector('.splitter-port-number')?.textContent || 'Porta';
        return `${splitterLabel}, ${portLabel}`;
    }
    return 'Item Desconhecido';
}

//Reorganização automática do layout 
function repackAllElements() {
    const canvas = document.getElementById('fusionCanvas');
    if (!canvas) return;
    const verticalMargin = 20;
    //Classificação de colunas
    const leftColumnElements = [];
    const rightColumnElements = [];
    //Filtra apenas os componentes
    const allElementsInOrder = Array.from(canvas.children).filter(el =>
        el.classList.contains('splitter-element') || el.classList.contains('cable-element')
    );
    //Separa os elementos
    allElementsInOrder.forEach(el => {
        if (el.style.right && el.style.right !== 'auto') {
            rightColumnElements.push(el);
        } else {
            leftColumnElements.push(el);
        }
    });
    //Empilhamento vertical
    const repackColumn = (elements) => {
        let currentTop = verticalMargin;
        elements.forEach(el => {
            el.style.transition = 'top 0.2s ease-in-out';
            el.style.top = `${currentTop}px`;
            currentTop += el.offsetHeight + verticalMargin;
        });
    };
    //Aplica o empilhamento nas duas colunas
    repackColumn(leftColumnElements);
    repackColumn(rightColumnElements);
    //Atualização pós animação
    setTimeout(() => {
        updateAllConnections();
        updateSvgLayerSize();
        allElementsInOrder.forEach(el => el.style.transition = '');
    }, 200);
}

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