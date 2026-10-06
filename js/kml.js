// Importação e exportação KML: exporta o projeto com a estrutura de pastas e importa
// marcadores e cabos, reconhecendo tipo, status e fibras pelo nome, estilo e dados extras.
// Depende de script.js (markers, savedCables, DEFAULT_MARKER_SIZE, criação de itens na barra lateral e no mapa).

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
                polygonObject.addListener('rightclick', (e) => openMapItemMenu('polygon', polygonInfo, e?.domEvent));
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
