// Fotos da rede (modo Rede): fotos de cada caixa ou cabo e das ocorrências, tiradas no celular ou enviadas do computador.
// Ficam no Storage do Supabase (bucket privado "rede-fotos", supabase/migrations/20261021120000_rede_em_campo.sql), numa
// pasta por empresa: <empresa>/<rede>/<caixa ou cabo>/<data>_<código>[_<ocorrência>].jpg, com a miniatura em thumb/.
// A foto é reduzida no navegador antes de enviar. Depende de js/app.js, js/network/network-docs.js e js/network/field-docs.js.

const NETWORK_PHOTO_BUCKET = 'rede-fotos';
const NETWORK_PHOTO_MAX_SIDE = 1600;
const NETWORK_PHOTO_THUMB_SIDE = 360;
const networkPhotos = { urls: new Map(), viewing: null, pending: [] };

function getNetworkPhotoFolder(item) {
    const root = getNetworkRootOf(item);
    const company = AppSession.company?.id;
    return root && company && item?.uid ? `${company}/${getRootId(root)}/${item.uid}` : '';
}

//Reduz a foto (lado maior) e grava em JPEG
async function compressNetworkPhoto(file, maxSide, quality) {
    let source;
    try {
        source = await createImageBitmap(file);
    } catch (e) {
        source = await new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem ilegível')); };
            img.src = url;
        });
    }
    const w = source.width;
    const h = source.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close?.();
    return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Falha ao gerar a foto'))), 'image/jpeg', quality));
}

function describeNetworkPhotoError(error) {
    const text = String(error?.message || error || '');
    if (/bucket/i.test(text) && /not found/i.test(text)) return 'As fotos ainda não estão liberadas no banco: peça ao administrador para rodar a atualização "rede em campo" no Supabase.';
    if (/row-level security|unauthorized|permission/i.test(text)) return 'Seu cargo não pode enviar fotos.';
    return text || 'Erro desconhecido.';
}

//Envia as fotos da caixa/cabo (occurrenceId: fotos da ocorrência). Retorna quantas foram.
async function uploadNetworkPhotos(item, files, { occurrenceId = '' } = {}) {
    if (!requireDocument('enviar fotos')) return 0;
    const folder = getNetworkPhotoFolder(item);
    if (!folder) return 0;
    const bucket = supabaseClient.storage.from(NETWORK_PHOTO_BUCKET);
    let sent = 0;
    for (const file of files) {
        try {
            const [full, thumb] = await Promise.all([
                compressNetworkPhoto(file, NETWORK_PHOTO_MAX_SIDE, 0.82),
                compressNetworkPhoto(file, NETWORK_PHOTO_THUMB_SIDE, 0.7),
            ]);
            const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
            const name = `${stamp}_${Math.random().toString(36).slice(2, 8)}${occurrenceId ? `_${occurrenceId}` : ''}.jpg`;
            const up = await bucket.upload(`${folder}/${name}`, full, { contentType: 'image/jpeg', upsert: false });
            if (up.error) throw up.error;
            await bucket.upload(`${folder}/thumb/${name}`, thumb, { contentType: 'image/jpeg', upsert: true });
            sent++;
        } catch (error) {
            console.error(error);
            showAlert('Foto não enviada', describeNetworkPhotoError(error));
            break;
        }
    }
    if (sent) showToast(sent === 1 ? 'Foto enviada' : `${sent} fotos enviadas`, `${item.name}${occurrenceId ? ' · ocorrência' : ''}`);
    return sent;
}

//Fotos de uma caixa/cabo, da mais nova para a mais antiga: [{ path, thumb, at, occurrenceId }]
async function listNetworkPhotos(item) {
    const folder = getNetworkPhotoFolder(item);
    if (!folder) return [];
    const { data, error } = await supabaseClient.storage.from(NETWORK_PHOTO_BUCKET).list(folder, { limit: 200, sortBy: { column: 'name', order: 'desc' } });
    if (error) throw error;
    return (data || []).filter(f => f.id && /\.jpe?g$/i.test(f.name)).map(f => {
        const [stamp, , occ] = f.name.replace(/\.jpe?g$/i, '').split('_');
        const at = /^\d{8}T\d{6}$/.test(stamp) ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z` : f.created_at;
        return { path: `${folder}/${f.name}`, thumb: `${folder}/thumb/${f.name}`, at, occurrenceId: occ ? `${occ}` : '' };
    }).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

//Arquivo privado → endereço local (blob:) para o <img>; o CSP só libera imagens blob:/data:
async function getNetworkPhotoUrl(path) {
    if (networkPhotos.urls.has(path)) return networkPhotos.urls.get(path);
    const { data, error } = await supabaseClient.storage.from(NETWORK_PHOTO_BUCKET).download(path);
    if (error || !data) throw error || new Error('Foto não encontrada');
    const url = URL.createObjectURL(data);
    networkPhotos.urls.set(path, url);
    return url;
}

async function fillNetworkPhotoGrid(grid, photos) {
    const esc = (v) => escapeHtml(String(v ?? ''));
    grid.innerHTML = photos.map((p, i) => `<button type="button" class="net-photo" data-photo-i="${i}" title="${esc(formatDocDate(p.at))}"><span class="net-photo__ph"></span></button>`).join('');
    await Promise.all(photos.map(async (p, i) => {
        const button = grid.querySelector(`[data-photo-i="${i}"]`);
        try {
            const url = await getNetworkPhotoUrl(p.thumb).catch(() => getNetworkPhotoUrl(p.path));
            button.innerHTML = `<img src="${url}" alt="Foto de ${esc(formatDocDate(p.at))}" loading="lazy" />`;
        } catch (e) {
            button.innerHTML = '<span class="net-photo__ph">?</span>';
        }
    }));
}

//Parte "Fotos" do painel da caixa (js/network/network-docs.js chama depois de montar o painel)
async function fillDocPhotos(panel, item) {
    const box = panel.querySelector('.marker-doc__photos');
    if (!box) return;
    const grid = box.querySelector('.net-photo-grid');
    box.dataset.uid = item.uid;
    try {
        const photos = await listNetworkPhotos(item);
        if (box.dataset.uid !== item.uid) return;
        networkPhotos.docList = { item, photos };
        box.querySelector('header span').textContent = photos.length ? `Fotos (${photos.length})` : 'Fotos';
        if (!photos.length) { grid.innerHTML = '<small class="marker-doc__occ-empty">Nenhuma foto ainda.</small>'; return; }
        await fillNetworkPhotoGrid(grid, photos.slice(0, 8));
    } catch (error) {
        grid.innerHTML = `<small class="marker-doc__occ-empty">${escapeHtml(/bucket/i.test(String(error?.message)) ? 'Fotos ainda não liberadas no banco.' : 'Não foi possível carregar as fotos.')}</small>`;
    }
}

function renderDocPhotosHtml() {
    return `<div class="marker-doc__photos">
        <header><span>Fotos</span>${AppSession.canDocument ? '<button type="button" class="btn-link" data-photo-add="doc">+ Foto</button>' : ''}</header>
        <div class="net-photo-grid"><small class="marker-doc__occ-empty">Carregando…</small></div>
    </div>`;
}

//Fotos dentro da janela da ocorrência (js/network/network-occurrences.js)
function renderOccurrencePhotos(container, occurrence, root) {
    networkPhotos.pending = [];
    if (!container) return;
    const item = occurrence ? findOccurrenceItem(occurrence) : null;
    container.innerHTML = `<div class="occurrence-photos">
        <span class="occurrence-modal__label">Fotos</span>
        <div class="net-photo-grid" id="occurrencePhotoGrid"></div>
        ${AppSession.canDocument ? '<button type="button" class="btn btn-secondary occurrence-photos__add" data-photo-add="occ">+ Foto</button><small class="occurrence-photos__pending" id="occurrencePhotoPending"></small>' : ''}
    </div>`;
    const grid = container.querySelector('#occurrencePhotoGrid');
    if (!item) return;
    listNetworkPhotos(item).then(photos => {
        const mine = photos.filter(p => p.occurrenceId === occurrence.id);
        networkPhotos.occList = { item, photos: mine };
        if (mine.length) fillNetworkPhotoGrid(grid, mine);
    }).catch(() => {});
}

//Ocorrência salva: envia as fotos escolhidas na janela
async function flushOccurrencePhotos(occurrence) {
    const files = networkPhotos.pending;
    networkPhotos.pending = [];
    if (!files.length || !occurrence) return 0;
    const item = findOccurrenceItem(occurrence);
    return item ? uploadNetworkPhotos(item, files, { occurrenceId: occurrence.id }) : 0;
}

function pickNetworkPhotos(onFiles) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => { if (input.files?.length) onFiles([...input.files]); });
    input.click();
}

// ---------------------------------------------------------------
// Ver a foto
// ---------------------------------------------------------------

function ensurePhotoViewer() {
    let modal = document.getElementById('networkPhotoModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'networkPhotoModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content net-photo-viewer" role="dialog" aria-label="Foto">
            <div class="net-photo-viewer__img"><img alt="" id="networkPhotoImg" /></div>
            <div class="modal-footer">
                <small id="networkPhotoCaption"></small>
                <button type="button" class="btn btn-danger" data-photo="delete">Apagar</button>
                <a class="btn btn-secondary" id="networkPhotoDownload" download>Baixar</a>
                <button type="button" class="btn btn-secondary" data-photo="close">Fechar</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        const action = e.target.closest('[data-photo]')?.dataset.photo;
        if (e.target === modal || action === 'close') modal.style.display = 'none';
        if (action === 'delete') deleteViewedPhoto();
    });
    return modal;
}

async function openNetworkPhoto(item, photo) {
    const modal = ensurePhotoViewer();
    networkPhotos.viewing = { item, photo };
    const img = modal.querySelector('#networkPhotoImg');
    img.removeAttribute('src');
    modal.querySelector('#networkPhotoCaption').textContent = `${item.name} · ${formatDocDate(photo.at)}`;
    modal.querySelector('[data-photo="delete"]').hidden = !AppSession.canDocument;
    modal.style.display = 'flex';
    try {
        const url = await getNetworkPhotoUrl(photo.path);
        img.src = url;
        const link = modal.querySelector('#networkPhotoDownload');
        link.href = url;
        link.download = `${String(item.name || 'foto').replace(/[\\/:*?"<>|]+/g, '-')}-${photo.path.split('/').pop()}`;
    } catch (e) {
        showToast('Foto não encontrada', 'Ela pode ter sido apagada.', 'progress');
    }
}

function deleteViewedPhoto() {
    const v = networkPhotos.viewing;
    if (!v || !requireDocument('apagar fotos')) return;
    showConfirm('Apagar foto', `Apagar esta foto de ${v.item.name}?`, async () => {
        const { error } = await supabaseClient.storage.from(NETWORK_PHOTO_BUCKET).remove([v.photo.path, v.photo.thumb]);
        if (error) { showAlert('Foto não apagada', describeNetworkPhotoError(error)); return; }
        document.getElementById('networkPhotoModal').style.display = 'none';
        showToast('Foto apagada', v.item.name);
        refreshDocPhotos();
    });
}

function refreshDocPhotos() {
    const panel = document.getElementById('markerDocPanel');
    const item = typeof editingMarkerInfo !== 'undefined' ? editingMarkerInfo : null;
    if (panel && item && !panel.classList.contains('hidden')) fillDocPhotos(panel, item);
}

appReady.then(() => {
    document.getElementById('markerDocPanel')?.addEventListener('click', (e) => {
        const item = typeof editingMarkerInfo !== 'undefined' ? editingMarkerInfo : null;
        if (!item) return;
        if (e.target.closest('[data-photo-add="doc"]')) {
            pickNetworkPhotos(async (files) => { if (await uploadNetworkPhotos(item, files)) refreshDocPhotos(); });
            return;
        }
        const thumb = e.target.closest('[data-photo-i]');
        if (thumb && networkPhotos.docList?.item === item) openNetworkPhoto(item, networkPhotos.docList.photos[Number(thumb.dataset.photoI)]);
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#occurrenceModal')) return;
        if (e.target.closest('[data-photo-add="occ"]')) {
            pickNetworkPhotos((files) => {
                networkPhotos.pending.push(...files);
                const note = document.getElementById('occurrencePhotoPending');
                if (note) note.textContent = `${networkPhotos.pending.length} foto${networkPhotos.pending.length === 1 ? '' : 's'} para enviar ao salvar`;
            });
            return;
        }
        const thumb = e.target.closest('#occurrencePhotoGrid [data-photo-i]');
        if (thumb && networkPhotos.occList) openNetworkPhoto(networkPhotos.occList.item, networkPhotos.occList.photos[Number(thumb.dataset.photoI)]);
    });
});
