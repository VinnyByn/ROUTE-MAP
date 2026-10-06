// Projetos no banco (Supabase, tabela projects): salvar, abrir, limpar a área de trabalho e
// converter marcadores, cabos, polígonos e a estrutura da barra lateral de/para JSON.
// Depende de script.js (map, markers, savedCables, savedPolygons, criação de itens na barra lateral).

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

//Revisão do projeto (migração 20261005): null = banco ainda sem a coluna (salva do jeito antigo)
let projectRevisionsSupported = null;
const isMissingColumnError = (error) => /column .* does not exist|42703|PGRST204|schema cache/i.test(`${error?.code || ''} ${error?.message || ''}`);

//Erro de salvamento quando outra pessoa salvou o projeto depois de ele ter sido aberto aqui
class ProjectConflictError extends Error {
    constructor(info) {
        super('O projeto foi alterado por outra pessoa.');
        this.name = 'ProjectConflictError';
        this.info = info; //{ updatedAt, updatedByName, revision }
    }
}

function getProjectRevision(projectRootElement) {
    const value = parseInt(projectRootElement?.querySelector('.folder-title')?.dataset.projectRevision, 10);
    return Number.isFinite(value) ? value : null;
}

function setProjectRevision(projectRootElement, revision) {
    const title = projectRootElement?.querySelector('.folder-title');
    if (title && Number.isFinite(revision)) title.dataset.projectRevision = String(revision);
}

async function fetchProjectSaveInfo(projectId) {
    const { data } = await supabaseClient.from('projects')
        .select('revision, updated_at, updated_by, deleted_at').eq('id', projectId).maybeSingle();
    if (!data) return null;
    let updatedByName = '';
    if (data.updated_by) {
        const { data: profile } = await supabaseClient.from('profiles').select('full_name').eq('id', data.updated_by).maybeSingle();
        updatedByName = profile?.full_name || '';
    }
    return { revision: data.revision, updatedAt: data.updated_at, updatedByName, deletedAt: data.deleted_at, isMe: data.updated_by === AppSession.userId };
}

//Grava (cria ou atualiza) o projeto no banco. Com a revisão conhecida, só grava se ninguém salvou
//depois que o projeto foi aberto aqui; senão lança ProjectConflictError (force: true grava mesmo assim).
async function persistProject(projectRootElement, { force = false } = {}) {
    await appReady;
    if (!AppSession.canEdit) throw new Error('Seu cargo é somente de visualização.');
    const record = buildProjectRecord(projectRootElement);
    const revision = getProjectRevision(projectRootElement);
    if (projectRevisionsSupported !== false && revision !== null) {
        const { created_by, company_id, ...changes } = record;
        let query = supabaseClient.from('projects').update(changes).eq('id', record.id);
        if (!force) query = query.eq('revision', revision);
        const { data, error } = await query.select('revision');
        if (error) throw error;
        if (data && data.length) {
            setProjectRevision(projectRootElement, data[0].revision);
            if (typeof liveSyncAnnounceSaved === 'function') liveSyncAnnounceSaved(record.id, data[0].revision);
            return record;
        }
        const info = await fetchProjectSaveInfo(record.id);
        if (info && !force) throw new ProjectConflictError(info);
        if (info) throw new Error('Seu cargo não permite alterar este projeto.');
        //Projeto não existe mais no banco (apagado de vez): grava de novo como novo
    }
    const { data, error } = await supabaseClient.from('projects').upsert(record, { onConflict: 'id' }).select('revision');
    if (error && isMissingColumnError(error)) {
        projectRevisionsSupported = false;
        const retry = await supabaseClient.from('projects').upsert(record, { onConflict: 'id' });
        if (retry.error) throw retry.error;
        return record;
    }
    if (error) throw error;
    if (data?.[0]?.revision != null) {
        projectRevisionsSupported = true;
        setProjectRevision(projectRootElement, data[0].revision);
        if (typeof liveSyncAnnounceSaved === 'function') liveSyncAnnounceSaved(record.id, data[0].revision);
    }
    return record;
}

function describeProjectConflict(info) {
    const who = info.isMe ? 'Você (em outra aba ou aparelho)' : (info.updatedByName || 'Outra pessoa da equipe');
    const when = info.updatedAt ? new Date(info.updatedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    return `${who} salvou este projeto${when ? ` em ${when}` : ''}, depois que você o abriu.`;
}

//Pergunta o que fazer quando outra pessoa salvou antes; resolve true se o projeto foi salvo
function resolveProjectConflict(projectRootElement, projectName, info) {
    return new Promise((resolve) => {
        showChoice({
            title: 'Projeto alterado por outra pessoa',
            message: `${describeProjectConflict(info)}\n\nSalvar mesmo assim substitui a versão salva pela sua — a outra continua no histórico de versões e pode ser restaurada. Para ver as alterações da outra pessoa, recarregue o projeto (as suas alterações não salvas serão perdidas).`,
            choices: [
                { label: 'Cancelar', kind: 'secondary', value: 'cancel' },
                { label: 'Recarregar projeto', kind: 'secondary', value: 'reload' },
                { label: 'Salvar mesmo assim', kind: 'primary', value: 'force' },
            ],
        }).then(async (choice) => {
            if (choice === 'force') {
                try {
                    await persistProject(projectRootElement, { force: true });
                    showToast('Projeto salvo', `"${projectName}" foi salvo. A versão anterior está no histórico.`);
                    resolve(true);
                } catch (error) {
                    showAlert('Erro', `Não foi possível salvar o projeto. ${error.message || ''}`);
                    resolve(false);
                }
            } else if (choice === 'reload') {
                const projectId = projectRootElement.querySelector('.folder-title').dataset.folderId;
                removeProjectFromWorkspace(projectId, projectRootElement);
                await openProjectFromDatabase(projectId);
                resolve(false);
            } else {
                resolve(false);
            }
        });
    });
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
        if (error instanceof ProjectConflictError) {
            document.getElementById('alertModal').style.display = 'none';
            await resolveProjectConflict(projectRootElement, projectName, error.info);
            return;
        }
        console.error("Erro ao salvar projeto:", error);
        showAlert("Erro", `Não foi possível salvar o projeto. ${error.message || ''}`);
    }
}

//Salvamento silencioso após reorganizar itens na sidebar
function saveProjectElement(projectRootElement) {
    if (!projectRootElement || !AppSession.canEdit) return;
    const projectName = projectRootElement.querySelector('.folder-title')?.dataset.folderName || 'Projeto';
    persistProject(projectRootElement).catch((error) => {
        if (error instanceof ProjectConflictError) {
            resolveProjectConflict(projectRootElement, projectName, error.info);
            return;
        }
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
    let { data, error } = await supabaseClient.from('projects').select('id, name, data, revision').eq('id', projectId).single();
    if (error && isMissingColumnError(error)) {
        projectRevisionsSupported = false;
        ({ data, error } = await supabaseClient.from('projects').select('id, name, data').eq('id', projectId).single());
    }
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
    if (data.revision != null) {
        projectRevisionsSupported = true;
        setProjectRevision(document.getElementById(data.id)?.closest('.folder'), data.revision);
    }
    if (typeof rememberLastProject === 'function') rememberLastProject(data.id);
    if (typeof liveSyncJoin === 'function') liveSyncJoin(data.id);
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
function loadAndDisplayProject(projectId, projectData, { silent = false } = {}) {
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
    if (!silent) showAlert("Sucesso", `Projeto "${projectData.projectName}" carregado!`);
    if (typeof resetProjectUndo === 'function') resetProjectUndo(projectId);
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
        popEquipment: markerInfo.type === 'POP' && markerInfo.popEquipment ? markerInfo.popEquipment : undefined,
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

//Identificador permanente de cabo e polígono (edição ao vivo: js/live-sync.js)
function ensureItemUid(info, prefix, list) {
    if (!info.uid || list.some(x => x !== info && x.uid === info.uid)) {
        info.uid = `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    }
    return info.uid;
}

//Converte o objeto de cabo para o formato JSON, salvando os dados no banco de dados
function serializeCable(cableInfo) {
    return {
        uid: ensureItemUid(cableInfo, 'cb', savedCables),
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
        uid: ensureItemUid(polygonInfo, 'pg', savedPolygons),
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
    marker.addListener("click", (e) => {
        //Shift + clique: entra ou sai da seleção múltipla (js/map-selection.js)
        if (e?.domEvent?.shiftKey && !isDrawingCable && typeof toggleMapSelection === 'function') {
            toggleMapSelection(markerInfo);
            return;
        }
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
