// Uso em campo (modo Rede): QR code em cada caixa (etiqueta em PDF para colar na caixa) que, escaneado, abre a caixa no
// sistema; "Perto de mim" pelo GPS do celular, com as caixas mais próximas e como chegar; link da caixa para mandar a quem
// está na rua. Depende de js/app.js, js/projects/network-mode.js, js/network/network-docs.js, qrcode-generator e jsPDF.

const FIELD_LINK_STORAGE = 'routeMapDeepLink';
const FIELD_BOX_TYPES = ['CTO', 'CEO', 'POP', 'RESERVA'];
const FIELD_NEARBY_MAX = 12;
const field = { position: null, accuracy: 0, overlays: [], results: [], locating: false };

const getNetworkRootOf = (item) => getNetworkRoots().find(r => getAllDescendantFolderIds(getRootId(r)).includes(item?.folderId)) || null;
const getNetworkCityName = (root) => (root?.querySelector(':scope > .folder-title')?.dataset.folderName || '').replace(/^Rede · /, '');

function fieldDistance(a, b) {
    const R = 6371000;
    const rad = (d) => d * Math.PI / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

const formatFieldDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);
const getItemLatLngObject = (item) => { const p = item.marker?.getPosition?.(); return p ? { lat: p.lat(), lng: p.lng() } : null; };
const getDirectionsUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

//Endereço que o QR da caixa abre: o sistema já na rede da cidade, com a caixa aberta
function getFieldBoxLink(box) {
    const root = getNetworkRootOf(box);
    if (!root || !box?.uid) return '';
    const base = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;
    return `${base}?rede=${encodeURIComponent(getRootId(root))}&caixa=${encodeURIComponent(box.uid)}`;
}

// ---------------------------------------------------------------
// QR code (qrcode-generator: só a matriz; o desenho é feito aqui, em SVG na tela e em vetor no PDF)
// ---------------------------------------------------------------

function buildQrMatrix(text) {
    if (typeof qrcode !== 'function' || !text) return null;
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    return { n, isDark: (r, c) => qr.isDark(r, c) };
}

//Faixas pretas de cada linha (menos retângulos no PDF e no SVG)
function getQrRuns(m) {
    const runs = [];
    for (let r = 0; r < m.n; r++) {
        let c = 0;
        while (c < m.n) {
            if (!m.isDark(r, c)) { c++; continue; }
            let e = c;
            while (e < m.n && m.isDark(r, e)) e++;
            runs.push([r, c, e - c]);
            c = e;
        }
    }
    return runs;
}

function buildQrSvg(text, size = 200) {
    const m = buildQrMatrix(text);
    if (!m) return '';
    const q = 4; //Zona de silêncio
    const total = m.n + q * 2;
    const d = getQrRuns(m).map(([r, c, w]) => `M${c + q} ${r + q}h${w}v1h-${w}z`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

function drawQrOnPdf(doc, text, x, y, size) {
    const m = buildQrMatrix(text);
    if (!m) return false;
    const cell = size / m.n;
    doc.setFillColor(0, 0, 0);
    getQrRuns(m).forEach(([r, c, w]) => doc.rect(x + c * cell, y + r * cell, w * cell + 0.02, cell + 0.02, 'F'));
    return true;
}

function describeFieldBox(box) {
    const meta = typeof getMarkerTypeMeta === 'function' ? getMarkerTypeMeta(box.type) : null;
    const parts = [meta?.label || box.type];
    if (box.type === 'CTO') {
        const capacity = getCtoPortCapacity(box);
        if (capacity) parts.push(`${capacity} portas`);
    }
    return parts.join(' · ');
}

//Etiquetas A4 (2 × 6, 95 × 45 mm, com linha de corte): QR, nome grande, tipo, cidade e empresa
function buildFieldLabelsPdf(boxes) {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF || typeof qrcode !== 'function') return null;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const cols = 2, rows = 6, w = 95, h = 45, mx = 10, my = 13.5;
    const company = AppSession.company?.name || '';
    boxes.forEach((box, i) => {
        const k = i % (cols * rows);
        if (i && !k) doc.addPage();
        const x = mx + (k % cols) * w;
        const y = my + Math.floor(k / cols) * h;
        doc.setDrawColor(190, 190, 190);
        doc.setLineDashPattern([1.2, 1.2], 0);
        doc.rect(x, y, w, h);
        doc.setLineDashPattern([], 0);
        drawQrOnPdf(doc, getFieldBoxLink(box), x + 4, y + 4, 37);
        const tx = x + 45;
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(box.name.length > 12 ? 14 : 18);
        doc.text(doc.splitTextToSize(box.name || 'Caixa', 46).slice(0, 2), tx, y + 12);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.text(describeFieldBox(box), tx, y + 23);
        doc.text(getNetworkCityName(getNetworkRootOf(box)), tx, y + 28);
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(doc.splitTextToSize(`Escaneie para abrir a caixa no ROUTE MAP${company ? ` · ${company}` : ''}`, 46), tx, y + 36);
    });
    return doc;
}

function getLabelBoxes(root) {
    const rootId = getRootId(root);
    const folder = getAllDescendantFolderIds(rootId).includes(activeFolderId) ? activeFolderId : rootId;
    const ids = new Set(getAllDescendantFolderIds(folder));
    const boxes = markers.filter(m => ids.has(m.folderId) && FIELD_BOX_TYPES.includes(m.type) && m.uid)
        .sort((a, b) => a.type.localeCompare(b.type) || String(a.name).localeCompare(String(b.name), 'pt-BR', { numeric: true }));
    const folderName = document.querySelector(`.folder-title[data-folder-id="${CSS.escape(folder)}"]`)?.dataset.folderName || '';
    return { boxes, folderName, isRoot: folder === rootId };
}

function ensureFieldLibs() {
    if (typeof qrcode === 'function' && window.jspdf?.jsPDF) return true;
    showAlert('Etiquetas QR', 'As bibliotecas de QR code e PDF não carregaram. Verifique a internet e recarregue a página.');
    return false;
}

async function openFieldLabels() {
    const root = await ensureActiveNetworkCity('gerar as etiquetas');
    if (!root || !ensureFieldLibs()) return;
    const { boxes, folderName, isRoot } = getLabelBoxes(root);
    if (!boxes.length) {
        showToast('Nenhuma caixa', `Não há CTO, CEO, POP ou reserva em "${folderName}".`, 'progress');
        return;
    }
    const counts = FIELD_BOX_TYPES.map(t => [t, boxes.filter(b => b.type === t).length]).filter(([, n]) => n).map(([t, n]) => `${n} ${t}`).join(', ');
    const pages = Math.ceil(boxes.length / 12);
    const choice = await showChoice({
        title: 'Etiquetas QR das caixas',
        message: `${boxes.length} etiqueta${boxes.length === 1 ? '' : 's'} (${counts}) ${isRoot ? `de toda a ${folderName}` : `da pasta "${folderName}"`}, em ${pages} folha${pages === 1 ? '' : 's'} A4.\n\nCole a etiqueta na caixa: quem escanear com o celular abre a caixa já no sistema (portas, clientes, plano de fusão e histórico). Para só uma pasta, selecione a pasta antes.`,
        choices: [{ label: 'Cancelar', kind: 'secondary', value: 'cancel' }, { label: 'Baixar PDF', kind: 'primary', value: 'pdf' }],
    });
    if (choice !== 'pdf') return;
    const doc = buildFieldLabelsPdf(boxes);
    doc?.save(`etiquetas-qr-${(folderName || 'rede').replace(/[\\/:*?"<>|]+/g, '-')}.pdf`);
}

// ---------------------------------------------------------------
// QR de uma caixa (painel da caixa)
// ---------------------------------------------------------------

function ensureFieldQrModal() {
    let modal = document.getElementById('fieldQrModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'fieldQrModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content field-qr-modal" role="dialog" aria-labelledby="fieldQrTitle">
            <h2 id="fieldQrTitle">QR code da caixa</h2>
            <div class="modal-body-content" id="fieldQrBody"></div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-field-qr="copy">Copiar link</button>
                <button type="button" class="btn btn-secondary" data-field-qr="close">Fechar</button>
                <button type="button" class="btn btn-success" data-field-qr="pdf">Baixar etiqueta</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        const action = e.target.closest('[data-field-qr]')?.dataset.fieldQr;
        if (e.target === modal || action === 'close') { modal.style.display = 'none'; return; }
        const box = field.qrBox;
        if (!box) return;
        if (action === 'copy') copyFieldLink(box);
        if (action === 'pdf') buildFieldLabelsPdf([box])?.save(`etiqueta-${String(box.name || 'caixa').replace(/[\\/:*?"<>|]+/g, '-')}.pdf`);
    });
    return modal;
}

function openFieldQr(box) {
    const link = getFieldBoxLink(box);
    if (!link || !ensureFieldLibs()) return;
    field.qrBox = box;
    const modal = ensureFieldQrModal();
    const esc = (v) => escapeHtml(String(v ?? ''));
    modal.querySelector('#fieldQrBody').innerHTML = `
        <div class="field-qr">
            <div class="field-qr__code">${buildQrSvg(link, 200)}</div>
            <div class="field-qr__text">
                <b>${esc(box.name)}</b>
                <span>${esc(describeFieldBox(box))} · ${esc(getNetworkCityName(getNetworkRootOf(box)))}</span>
                <small>Imprima e cole na caixa. Escaneando com o celular, a caixa abre já no sistema (é preciso entrar com a conta da empresa).</small>
            </div>
        </div>
        <input type="text" class="field-qr__link" id="fieldQrLink" readonly value="${esc(link)}" aria-label="Link da caixa" />`;
    modal.style.display = 'flex';
}

async function copyFieldLink(box) {
    const link = getFieldBoxLink(box);
    try {
        await navigator.clipboard.writeText(link);
        showToast('Link copiado', `Quem abrir vai direto para ${box.name}.`);
    } catch (e) {
        //Sem acesso à área de transferência: o link fica selecionado na janela do QR para copiar à mão
        if (document.getElementById('fieldQrModal')?.style.display !== 'flex') openFieldQr(box);
        const input = document.getElementById('fieldQrLink');
        input?.focus();
        input?.select();
        showToast('Copie o link', 'O link está selecionado: use Ctrl+C (ou segure e copie no celular).', 'progress');
    }
}

// ---------------------------------------------------------------
// Abrir a caixa pelo link (QR escaneado), também depois do login
// ---------------------------------------------------------------

async function handleFieldDeepLink() {
    const link = getPendingFieldLink();
    if (!link) return;
    try { sessionStorage.removeItem(FIELD_LINK_STORAGE); } catch (e) { /* ignora */ }
    if (/[?&]caixa=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
    await mapReady;
    await appModeStartup;
    return openFieldLinkBox(link);
}

async function openFieldLinkBox(link) {
    if (appMode !== 'rede' && !(await setAppMode('rede'))) return null;
    let root = document.getElementById(link.rede)?.closest('.folder');
    if (!root) { showToast('Caixa não encontrada', 'Essa rede não existe mais ou é de outra empresa.', 'progress'); return null; }
    if (isPendingNetworkRoot(root)) root = await loadNetworkRoot(link.rede, { visible: true });
    const box = markers.find(m => m.uid === link.caixa);
    if (!box) { showToast('Caixa não encontrada', 'Ela foi excluída da rede ou trocada.', 'progress'); return null; }
    setActiveFolder(link.rede);
    focusNetworkItem(box);
    openMarkerFromUserAction(box);
    return box;
}

// ---------------------------------------------------------------
// Perto de mim (GPS)
// ---------------------------------------------------------------

function clearFieldOverlays() {
    field.overlays.forEach(o => o.setMap(null));
    field.overlays = [];
}

async function startFieldNearby() {
    if (typeof map === 'undefined' || !map) return;
    document.getElementById('nearbyBox').classList.remove('hidden');
    if (!navigator.geolocation) { renderFieldNearby('Este navegador não informa a localização.'); return; }
    field.locating = true;
    renderFieldNearby();
    navigator.geolocation.getCurrentPosition(
        (pos) => { field.locating = false; runFieldNearby({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); },
        (err) => {
            field.locating = false;
            renderFieldNearby(err?.code === 1
                ? 'Sem permissão para a localização. Libere a localização para este site no navegador e tente de novo.'
                : 'Não foi possível pegar a localização agora. Ative o GPS e tente de novo.');
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
}

function stopFieldNearby() {
    document.getElementById('nearbyBox')?.classList.add('hidden');
    clearFieldOverlays();
    field.results = [];
    field.position = null;
}

async function runFieldNearby(position) {
    //As cidades que ainda são só o nome entram na busca (carregam ocultas)
    for (const root of getNetworkRoots().filter(isPendingNetworkRoot)) await loadNetworkRoot(getRootId(root));
    field.position = { lat: position.lat, lng: position.lng };
    field.accuracy = Number(position.accuracy) || 0;
    const networkFolders = new Set(getNetworkRoots().flatMap(r => getAllDescendantFolderIds(getRootId(r))));
    field.results = markers.filter(m => networkFolders.has(m.folderId) && FIELD_BOX_TYPES.includes(m.type))
        .map(box => ({ box, pos: getItemLatLngObject(box) }))
        .filter(r => r.pos)
        .map(r => ({ ...r, distance: fieldDistance(field.position, r.pos) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, FIELD_NEARBY_MAX);
    clearFieldOverlays();
    const here = new google.maps.LatLng(field.position.lat, field.position.lng);
    if (field.accuracy) {
        field.overlays.push(new google.maps.Circle({ map, center: here, radius: field.accuracy, clickable: false, strokeColor: '#2563eb', strokeOpacity: 0.4, strokeWeight: 1, fillColor: '#2563eb', fillOpacity: 0.08 }));
    }
    field.overlays.push(new google.maps.Marker({
        map, position: here, clickable: false, zIndex: google.maps.Marker.MAX_ZINDEX - 1, title: 'Você está aqui',
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 },
    }));
    map.panTo(here);
    if (!map.getZoom() || map.getZoom() < 17) map.setZoom(17);
    renderFieldNearby();
}

function renderFieldNearby(message = '') {
    const body = document.getElementById('nearbyBody');
    if (!body) return;
    const esc = (v) => escapeHtml(String(v ?? ''));
    if (message) {
        body.innerHTML = `<div class="viability-verdict is-no"><b>Sem localização</b><span>${esc(message)}</span></div>
            <button type="button" class="map-tool-btn" data-nearby="retry">Tentar de novo</button>`;
        return;
    }
    if (field.locating) { body.innerHTML = '<p class="map-tool-help">Pegando a sua localização…</p>'; return; }
    if (!field.position) { body.innerHTML = ''; return; }
    const rows = field.results.map((r, i) => {
        const capacity = r.box.type === 'CTO' ? getCtoPortCapacity(r.box) : null;
        const free = capacity ? capacity - getOccupiedPorts(r.box).size : null;
        return `<li class="viability-row${free === 0 ? ' is-cheia' : ''}">
            <button type="button" class="viability-row__main" data-nearby="open" data-i="${i}">
                <b>${esc(r.box.name)}</b>
                <small>${esc(r.box.type)} · ${formatFieldDistance(r.distance)}${capacity ? ` · ${free} porta${free === 1 ? '' : 's'} livre${free === 1 ? '' : 's'}` : ''}</small>
            </button>
            <a class="map-tool-btn viability-row__add" href="${esc(getDirectionsUrl(r.pos))}" target="_blank" rel="noopener" title="Como chegar (Google Maps)">Ir</a>
        </li>`;
    }).join('');
    body.innerHTML = `
        <p class="map-tool-help">Você está aqui${field.accuracy ? ` (precisão de ${formatFieldDistance(field.accuracy)})` : ''}. Toque numa caixa para abrir.</p>
        ${rows ? `<ul class="viability-list">${rows}</ul>` : '<p class="map-tool-help">Nenhuma caixa da rede por perto.</p>'}
        <button type="button" class="map-tool-btn" data-nearby="retry">Atualizar posição</button>`;
}

function handleFieldNearbyClick(e) {
    const el = e.target.closest('[data-nearby]');
    if (!el) return;
    const action = el.dataset.nearby;
    if (action === 'retry') { startFieldNearby(); return; }
    if (action === 'open') {
        const r = field.results[Number(el.dataset.i)];
        if (!r) return;
        focusNetworkItem(r.box);
        openMarkerFromUserAction(r.box);
    }
}

//Painel da caixa (js/network/network-docs.js): QR, como chegar e link
function handleMarkerDocFieldClick(e) {
    const action = e.target.closest('[data-field]')?.dataset.field;
    const box = typeof editingMarkerInfo !== 'undefined' ? editingMarkerInfo : null;
    if (!action || !box) return;
    if (action === 'qr') openFieldQr(box);
    if (action === 'link') copyFieldLink(box);
    if (action === 'clients') {
        setCtoClientsShown(box, !networkClientsShown.ctos.has(box.uid));
        renderMarkerDocPanel(box);
    }
}

appReady.then(() => {
    const on = (id, fn) => document.getElementById(id)?.addEventListener('click', (e) => { e.preventDefault(); fn(); });
    on('networkQrLabelsButton', openFieldLabels);
    on('networkNearbyButton', startFieldNearby);
    on('closeNearbyBox', stopFieldNearby);
    document.getElementById('nearbyBody')?.addEventListener('click', handleFieldNearbyClick);
    document.getElementById('markerDocPanel')?.addEventListener('click', handleMarkerDocFieldClick);
    //Saiu do modo Rede: fecha o "Perto de mim"
    new MutationObserver(() => {
        if (!document.body.classList.contains('mode-rede') && field.position) stopFieldNearby();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    handleFieldDeepLink();
});
