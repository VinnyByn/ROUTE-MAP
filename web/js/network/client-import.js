// Importar clientes de uma planilha (modo Rede): .xlsx, .xls ou .csv com uma linha por cliente, como sai do sistema do
// provedor. Confere a CTO (pelo nome, na cidade aberta) e a porta, mostra a prévia linha a linha e atualiza pelo código
// quem já está cadastrado. Depende de js/app.js, js/network/clients.js, js/projects/network-mode.js e js/network/network-docs.js.

const CLIENT_IMPORT_COLUMNS = [
    { key: 'name', label: 'Nome', aliases: ['nome', 'cliente', 'nome do cliente', 'razao social', 'assinante'], example: ['Maria Souza', 'Padaria Central'], help: 'Nome do cliente. Obrigatório.' },
    { key: 'code', label: 'Código', aliases: ['codigo', 'cod', 'id', 'contrato', 'codigo do cliente', 'id cliente', 'matricula'], example: ['10234', '10235'], help: 'Código no seu sistema. Importar de novo com o mesmo código atualiza o cliente em vez de duplicar.' },
    { key: 'cto', label: 'CTO', aliases: ['cto', 'caixa', 'cto/caixa', 'caixa de atendimento', 'nap'], example: ['CTO-01', 'CTO-01'], help: 'Nome da CTO na rede da cidade, igual ao do mapa.' },
    { key: 'port', label: 'Porta', aliases: ['porta', 'porta cto', 'port', 'porta da cto', 'splitter porta'], example: [3, ''], help: 'Porta da CTO. Vazia: usa a primeira porta livre.' },
    { key: 'status', label: 'Situação', aliases: ['situacao', 'status', 'situacao do cliente', 'estado'], example: ['Instalado', 'A instalar'], help: 'Viabilidade, A instalar, Instalado ou Cancelado. Vazia: Instalado.' },
    { key: 'lat', label: 'Latitude', aliases: ['latitude', 'lat'], example: [-21.2451, ''], help: 'Latitude do cliente (ex.: -21.2451). Vazia: o cliente fica ao lado da CTO.' },
    { key: 'lng', label: 'Longitude', aliases: ['longitude', 'lng', 'lon', 'long'], example: [-45.0012, ''], help: 'Longitude do cliente (ex.: -45.0012).' },
    { key: 'coords', label: 'Coordenadas', aliases: ['coordenadas', 'coordenada', 'lat,lng', 'lat/lng', 'localizacao', 'geolocalizacao'], template: false, help: 'Ou as duas juntas: "-21.2451, -45.0012".' },
    { key: 'address', label: 'Endereço', aliases: ['endereco', 'logradouro', 'endereco completo', 'endereco de instalacao'], example: ['Rua das Flores, 120 - Centro', 'Av. Brasil, 900'], help: '' },
    { key: 'phone', label: 'Telefone', aliases: ['telefone', 'celular', 'fone', 'whatsapp', 'contato'], example: ['(35) 99999-0000', ''], help: '' },
    { key: 'plan', label: 'Plano', aliases: ['plano', 'velocidade', 'pacote'], example: ['500 Mega', '1 Giga'], help: '' },
    { key: 'document', label: 'CPF/CNPJ', aliases: ['cpf/cnpj', 'cpf', 'cnpj', 'documento', 'cpf cnpj'], example: ['', ''], help: '' },
    { key: 'kind', label: 'Tipo', aliases: ['tipo', 'tipo de cliente', 'categoria'], example: ['Residencial', 'Empresarial'], help: 'Residencial, Empresarial ou Predial. Vazia: Residencial.' },
    { key: 'serial', label: 'Serial da ONU', aliases: ['serial da onu', 'serial', 'onu', 'sn', 'serial onu', 'numero de serie', 'gpon sn'], example: ['ZTEG12345678', ''], help: '' },
    { key: 'notes', label: 'Observações', aliases: ['observacoes', 'observacao', 'obs', 'notas'], example: ['', ''], help: '' },
];

const CLIENT_IMPORT_STATUS_WORDS = {
    viabilidade: ['viabilidade', 'viavel', 'consulta', 'prospect', 'prospeccao'],
    a_instalar: ['a instalar', 'instalar', 'pendente', 'aguardando', 'agendado', 'em instalacao', 'novo', 'venda'],
    instalado: ['instalado', 'ativo', 'ativado', 'habilitado', 'conectado', 'online', 'liberado', 'em uso', 'suspenso', 'bloqueado'],
    cancelado: ['cancelado', 'inativo', 'desativado', 'cancelada', 'retirado', 'desligado'],
};
const CLIENT_IMPORT_PREVIEW_MAX = 300;

const clientImport = { rows: [], fileName: '', rootId: '', onlyIssues: false };

const normalizeImportText = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[:*]+$/g, '').replace(/\s+/g, ' ').trim();
const normalizeImportKey = (value) => normalizeImportText(value).replace(/[\s_.\-/]+/g, '');

function parseImportNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    let text = String(value ?? '').trim();
    if (!text) return null;
    if (text.includes(',') && !text.includes('.')) text = text.replace(',', '.');
    const n = Number(text.replace(/[^\d.+-]/g, ''));
    return Number.isFinite(n) ? n : null;
}

function parseImportCoords(row) {
    let lat = parseImportNumber(row.lat);
    let lng = parseImportNumber(row.lng);
    if ((lat === null || lng === null) && row.coords) {
        const parts = String(row.coords).match(/-?\d+(?:[.,]\d+)?/g) || [];
        if (parts.length >= 2) { lat = parseImportNumber(parts[0]); lng = parseImportNumber(parts[1]); }
    }
    if (lat === null || lng === null) return { position: null };
    //Latitude e longitude trocadas (no Brasil a longitude vai de -74 a -34)
    let swapped = false;
    if (lat < -34 && lat > -75 && lng > -35 && lng < 6) { [lat, lng] = [lng, lat]; swapped = true; }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return { position: null, invalid: true };
    return { position: { lat, lng }, swapped };
}

function parseImportStatus(value) {
    const text = normalizeImportText(value);
    if (!text) return { status: 'instalado' };
    for (const [id, words] of Object.entries(CLIENT_IMPORT_STATUS_WORDS)) {
        if (words.includes(text) || words.some(w => text.startsWith(w))) return { status: id };
    }
    return { status: 'instalado', unknown: String(value).trim() };
}

function parseImportKind(value) {
    const text = normalizeImportText(value);
    if (/empres|b2b|corpor|dedicad|pj\b|comerc/.test(text)) return 'b2b';
    if (/predi|condom|edific/.test(text)) return 'predial';
    return 'residencial';
}

//Primeira aba: a linha de cabeçalho é a primeira com o nome (ou o cliente) e pelo menos mais uma coluna conhecida
function readClientSheetRows(book) {
    const sheet = book.Sheets[book.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: false });
    const lookup = new Map();
    CLIENT_IMPORT_COLUMNS.forEach(col => [col.label, ...col.aliases].forEach(a => lookup.set(normalizeImportKey(a), col.key)));
    let headerIndex = -1;
    let map = [];
    for (let i = 0; i < Math.min(grid.length, 15); i++) {
        const keys = grid[i].map(cell => lookup.get(normalizeImportKey(cell)) || null);
        if (keys.includes('name') && keys.filter(Boolean).length >= 2) { headerIndex = i; map = keys; break; }
    }
    if (headerIndex < 0) return { error: 'Não achei a linha de cabeçalho. A planilha precisa ter pelo menos as colunas Nome e CTO (ou Latitude/Longitude). Baixe o modelo para ver o formato.' };
    const rows = [];
    for (let i = headerIndex + 1; i < grid.length; i++) {
        const row = { line: i + 1 };
        map.forEach((key, c) => { if (key && row[key] === undefined) row[key] = grid[i][c]; });
        if (Object.entries(row).some(([k, v]) => k !== 'line' && String(v ?? '').trim())) rows.push(row);
    }
    return { rows, columns: [...new Set(map.filter(Boolean))] };
}

//Confere cada linha com a rede da cidade: novo, atualiza ou erro (com o motivo)
function validateClientImport(rows, root) {
    const scope = getNetworkScope(root);
    const ctos = scope.markers.filter(m => m.type === 'CTO');
    const ctoByName = new Map();
    ctos.forEach(cto => { const key = normalizeImportKey(cto.name); if (!ctoByName.has(key)) ctoByName.set(key, cto); });
    const clients = scope.markers.filter(m => m.type === 'CLIENTE');
    const byCode = new Map();
    clients.forEach(c => { const code = String(c.client?.code || '').trim(); if (code && !byCode.has(code)) byCode.set(code, c); });
    const seenCodes = new Map();
    const taken = new Map(); //uid da CTO → Map(porta → descrição de quem ocupa) incluindo as linhas já aceitas
    const occupied = (cto) => {
        if (!taken.has(cto.uid)) {
            const ports = new Map();
            getOccupiedPorts(cto).forEach((client, port) => ports.set(port, { client, label: client.name }));
            taken.set(cto.uid, ports);
        }
        return taken.get(cto.uid);
    };
    const nearCount = new Map();
    return rows.map(row => {
        const out = { line: row.line, raw: row, errors: [], warnings: [] };
        const name = String(row.name ?? '').trim();
        const code = String(row.code ?? '').trim();
        out.name = name;
        out.code = code;
        if (!name) out.errors.push('sem nome');
        if (code) {
            if (seenCodes.has(code)) out.errors.push(`código ${code} repetido (linha ${seenCodes.get(code)})`);
            else seenCodes.set(code, row.line);
        }
        out.existing = code ? byCode.get(code) || null : null;
        const { status, unknown } = parseImportStatus(row.status);
        out.status = status;
        if (unknown) out.warnings.push(`situação "${unknown}" não reconhecida: ficou Instalado`);
        out.kind = row.kind ? parseImportKind(row.kind) : (out.existing?.client?.kind || 'residencial');
        //CTO e porta
        const ctoText = String(row.cto ?? '').trim();
        out.cto = null;
        out.port = null;
        if (ctoText) {
            out.cto = ctoByName.get(normalizeImportKey(ctoText)) || ctos.find(c => c.uid === ctoText) || null;
            if (!out.cto) out.errors.push(`a CTO "${ctoText}" não existe nesta cidade`);
        }
        if (out.cto) {
            const capacity = getCtoPortCapacity(out.cto);
            const max = capacity || DEFAULT_CTO_PORTS;
            const ports = occupied(out.cto);
            const portText = String(row.port ?? '').trim();
            const holder = (port) => { const h = ports.get(port); return h && h.client !== out.existing ? h : null; };
            if (portText) {
                const port = parseInt(portText.replace(/\D+/g, ''), 10);
                if (!port || port < 1 || port > max) out.errors.push(`a porta ${portText} não existe (a ${out.cto.name} tem ${max})`);
                else if (status !== 'cancelado' && holder(port)) out.errors.push(`a porta ${port} da ${out.cto.name} já é de ${holder(port).label}`);
                else out.port = port;
            } else if (status !== 'cancelado') {
                const keep = out.existing?.client?.ctoUid === out.cto.uid ? Number(out.existing.client.ctoPort) || null : null;
                if (keep && !holder(keep)) out.port = keep;
                else {
                    for (let p = 1; p <= max; p++) if (!holder(p)) { out.port = p; break; }
                    if (out.port) out.warnings.push(`porta livre escolhida: ${out.port}`);
                    else out.errors.push(`a ${out.cto.name} está lotada`);
                }
            }
            if (out.port && status !== 'cancelado' && !out.errors.length) ports.set(out.port, { client: out.existing || out, label: `${name || 'linha'} (linha ${row.line})` });
        }
        //Posição: a da planilha, a de antes (cliente que já existe) ou ao lado da CTO
        const coords = parseImportCoords(row);
        if (coords.invalid) out.errors.push('coordenadas inválidas');
        if (coords.swapped) out.warnings.push('latitude e longitude estavam trocadas');
        out.position = coords.position;
        if (!out.position && !coords.invalid) {
            if (out.existing) out.keepPosition = true;
            else if (out.cto) {
                const n = nearCount.get(out.cto.uid) || 0;
                nearCount.set(out.cto.uid, n + 1);
                const p = out.cto.marker.getPosition();
                const angle = n * 2.4;
                const dist = 8 + 2.5 * Math.floor(n / 6);
                out.position = { lat: p.lat() + (dist * Math.cos(angle)) / 111320, lng: p.lng() + (dist * Math.sin(angle)) / (111320 * Math.cos(p.lat() * Math.PI / 180)) };
                out.nearCto = true;
                out.warnings.push('sem coordenadas: fica ao lado da CTO');
            } else out.errors.push('sem coordenadas e sem CTO');
        }
        out.action = out.errors.length ? 'erro' : out.existing ? 'atualiza' : 'novo';
        return out;
    });
}

function getClientImportCounts(rows) {
    return {
        novo: rows.filter(r => r.action === 'novo').length,
        atualiza: rows.filter(r => r.action === 'atualiza').length,
        erro: rows.filter(r => r.action === 'erro').length,
    };
}

//Avisos que valem para a planilha toda (uma vez só, em vez de em cada linha)
function getClientImportNotes(rows) {
    const notes = [];
    const noSplitter = [...new Set(rows.filter(r => r.cto && !getCtoPortCapacity(r.cto)).map(r => r.cto.name))];
    if (noSplitter.length) {
        const names = noSplitter.slice(0, 4).join(', ') + (noSplitter.length > 4 ? ` e mais ${noSplitter.length - 4}` : '');
        notes.push(`${noSplitter.length === 1 ? 'A CTO' : 'As CTOs'} ${names} ${noSplitter.length === 1 ? 'não tem' : 'não têm'} splitter no plano de fusão: considerei ${DEFAULT_CTO_PORTS} portas.`);
    }
    const noCode = rows.filter(r => r.action === 'novo' && !r.code).length;
    if (noCode) notes.push(`${noCode} cliente${noCode === 1 ? '' : 's'} sem código: importar a planilha de novo ${noCode === 1 ? 'cria outro' : 'cria outros'} em vez de atualizar.`);
    return notes;
}

// ---------------------------------------------------------------
// Janela
// ---------------------------------------------------------------

function ensureClientImportModal() {
    let modal = document.getElementById('clientImportModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'clientImportModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content client-import-modal" role="dialog" aria-labelledby="clientImportTitle">
            <h2 id="clientImportTitle">Importar clientes</h2>
            <div class="modal-body-content" id="clientImportBody"></div>
            <div class="modal-footer" id="clientImportFooter"></div>
        </div>
        <input type="file" id="clientImportFile" accept=".xlsx,.xls,.csv" hidden />`;
    document.body.appendChild(modal);
    modal.addEventListener('click', handleClientImportClick);
    modal.addEventListener('change', (e) => {
        if (e.target.id === 'clientImportFile' && e.target.files?.[0]) readClientImportFile(e.target.files[0]);
        if (e.target.id === 'clientImportOnlyIssues') { clientImport.onlyIssues = e.target.checked; renderClientImport(); }
    });
    const drop = (e) => { e.preventDefault(); const file = e.dataTransfer?.files?.[0]; if (file) readClientImportFile(file); };
    modal.addEventListener('dragover', (e) => e.preventDefault());
    modal.addEventListener('drop', drop);
    return modal;
}

async function openClientImport() {
    if (!requireDocument('importar clientes')) return;
    const root = await ensureActiveNetworkCity('importar os clientes');
    if (!root) return;
    if (typeof XLSX === 'undefined') {
        showAlert('Importar clientes', 'A biblioteca de planilhas não carregou. Recarregue a página e tente de novo.');
        return;
    }
    clientImport.rootId = getRootId(root);
    clientImport.rows = [];
    clientImport.fileName = '';
    clientImport.onlyIssues = false;
    //Painel e viabilidade abertos ficariam por cima da janela
    document.getElementById('networkPanelBox')?.classList.add('hidden');
    if (typeof viability !== 'undefined' && viability.active) stopViability();
    const modal = ensureClientImportModal();
    renderClientImport();
    modal.style.display = 'flex';
}

function closeClientImport() {
    const modal = document.getElementById('clientImportModal');
    if (modal) modal.style.display = 'none';
    clientImport.rows = [];
}

function getClientImportRoot() {
    return document.getElementById(clientImport.rootId)?.closest('.folder') || null;
}

function renderClientImport(done = null) {
    const modal = ensureClientImportModal();
    const body = modal.querySelector('#clientImportBody');
    const footer = modal.querySelector('#clientImportFooter');
    const esc = (v) => escapeHtml(String(v ?? ''));
    const root = getClientImportRoot();
    const city = root?.querySelector(':scope > .folder-title')?.dataset.folderName || 'Rede';
    if (done) {
        body.innerHTML = `
            <div class="client-import__done">
                <b>${done.created + done.updated} cliente${done.created + done.updated === 1 ? '' : 's'} na ${esc(city)}</b>
                <span>${done.created} novo${done.created === 1 ? '' : 's'} · ${done.updated} atualizado${done.updated === 1 ? '' : 's'}${done.skipped ? ` · ${done.skipped} linha${done.skipped === 1 ? '' : 's'} com erro ficaram de fora` : ''}</span>
                <small>${done.saved ? 'A rede foi salva e o histórico registra a importação.' : 'Salve a rede para guardar a importação.'}</small>
            </div>`;
        footer.innerHTML = `<button type="button" class="btn btn-success" data-import="close">Concluir</button>`;
        return;
    }
    const counts = getClientImportCounts(clientImport.rows);
    const head = `
        <div class="client-import__drop">
            <div>
                <b>${clientImport.fileName ? esc(clientImport.fileName) : 'Planilha do seu sistema'}</b>
                <small>Clientes de <b>${esc(city)}</b>: .xlsx, .xls ou .csv, uma linha por cliente. Use as colunas do modelo (Nome, Código, CTO, Porta, Situação, Latitude, Longitude…); a ordem não importa.</small>
            </div>
            <div class="client-import__drop-actions">
                <button type="button" class="btn btn-secondary" data-import="template">Baixar modelo</button>
                <button type="button" class="btn btn-primary" data-import="pick">${clientImport.fileName ? 'Trocar arquivo' : 'Escolher arquivo'}</button>
            </div>
        </div>`;
    if (!clientImport.rows.length) {
        body.innerHTML = `${head}
            <ul class="client-import__rules">
                <li><b>CTO</b> pelo nome que está no mapa; a <b>porta</b> é conferida (existe e está livre).</li>
                <li>Mesmo <b>código</b> de um cliente já cadastrado: atualiza, não duplica.</li>
                <li>Sem latitude/longitude, o cliente fica ao lado da CTO para você ajustar depois.</li>
                <li>Linhas com erro aparecem na prévia e ficam de fora.</li>
            </ul>`;
        footer.innerHTML = `<button type="button" class="btn btn-secondary" data-import="close">Cancelar</button>`;
        return;
    }
    const rows = clientImport.rows.filter(r => !clientImport.onlyIssues || r.action === 'erro' || r.warnings.length);
    const shown = rows.slice(0, CLIENT_IMPORT_PREVIEW_MAX);
    const label = { novo: 'Novo', atualiza: 'Atualiza', erro: 'Erro' };
    const notes = getClientImportNotes(clientImport.rows);
    body.innerHTML = `${head}
        <div class="client-import__counts">
            <span class="is-novo"><b>${counts.novo}</b> novo${counts.novo === 1 ? '' : 's'}</span>
            <span class="is-atualiza"><b>${counts.atualiza}</b> atualiza${counts.atualiza === 1 ? '' : 'm'}</span>
            <span class="is-erro"><b>${counts.erro}</b> com erro</span>
            <label class="client-import__filter"><input type="checkbox" id="clientImportOnlyIssues" ${clientImport.onlyIssues ? 'checked' : ''}/> Só linhas com problema</label>
        </div>
        ${notes.length ? `<ul class="client-import__notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        <div class="client-import__table-wrap">
            <table class="client-import__table">
                <thead><tr><th>Linha</th><th>Cliente</th><th>CTO · porta</th><th>Resultado</th></tr></thead>
                <tbody>${shown.map(r => `
                    <tr class="is-${r.action}">
                        <td>${r.line}</td>
                        <td><b>${esc(r.name || '—')}</b>${r.code ? `<small>${esc(r.code)}</small>` : ''}</td>
                        <td>${r.cto ? `${esc(r.cto.name)}${r.port ? ` · ${r.port}` : ''}` : esc(String(r.raw.cto ?? '').trim() || '—')}</td>
                        <td><span class="client-import__tag">${label[r.action]}</span>${[...r.errors, ...r.warnings].map(m => `<small>${esc(m)}</small>`).join('')}</td>
                    </tr>`).join('') || '<tr><td colspan="4" class="client-import__empty">Nenhuma linha com problema.</td></tr>'}
                </tbody>
            </table>
            ${rows.length > shown.length ? `<p class="client-import__more">e mais ${rows.length - shown.length} linha${rows.length - shown.length === 1 ? '' : 's'}…</p>` : ''}
        </div>`;
    const total = counts.novo + counts.atualiza;
    footer.innerHTML = `
        <button type="button" class="btn btn-secondary" data-import="close">Cancelar</button>
        <button type="button" class="btn btn-success" data-import="run" ${total ? '' : 'disabled'}>Importar ${total} cliente${total === 1 ? '' : 's'}</button>`;
}

async function readClientImportFile(file) {
    const root = getClientImportRoot();
    if (!root) { closeClientImport(); return; }
    try {
        const buffer = await file.arrayBuffer();
        const book = XLSX.read(buffer, { type: 'array', cellDates: false });
        const parsed = readClientSheetRows(book);
        if (parsed.error) { showAlert('Importar clientes', parsed.error); return; }
        if (!parsed.rows.length) { showAlert('Importar clientes', 'A planilha não tem nenhum cliente abaixo do cabeçalho.'); return; }
        clientImport.fileName = file.name;
        clientImport.rows = validateClientImport(parsed.rows, root);
        renderClientImport();
    } catch (e) {
        console.error(e);
        showAlert('Importar clientes', 'Não consegui ler esse arquivo. Salve como .xlsx ou .csv e tente de novo.');
    } finally {
        const input = document.getElementById('clientImportFile');
        if (input) input.value = '';
    }
}

function downloadClientImportTemplate() {
    const cols = CLIENT_IMPORT_COLUMNS.filter(c => c.template !== false);
    const rows = [cols.map(c => c.label), ...[0, 1].map(i => cols.map(c => c.example?.[i] ?? ''))];
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = cols.map(c => ({ wch: Math.max(12, c.label.length + 4, ...(c.example || []).map(v => String(v).length + 2)) }));
    XLSX.utils.book_append_sheet(book, sheet, 'Clientes');
    const help = [['Coluna', 'Como preencher', 'Também aceito como'], ...CLIENT_IMPORT_COLUMNS.map(c => [c.label, c.help || '', c.aliases.slice(0, 4).join(', ')])];
    const helpSheet = XLSX.utils.aoa_to_sheet(help);
    helpSheet['!cols'] = [{ wch: 16 }, { wch: 80 }, { wch: 44 }];
    XLSX.utils.book_append_sheet(book, helpSheet, 'Como preencher');
    XLSX.writeFile(book, 'modelo-clientes.xlsx');
}

// ---------------------------------------------------------------
// Importação
// ---------------------------------------------------------------

function buildImportedClientData(r, previous = {}) {
    const raw = r.raw;
    const text = (key) => String(raw[key] ?? '').trim();
    const pick = (key, old) => (text(key) ? text(key) : old || '');
    const client = normalizeClientData({ ...previous });
    client.kind = r.kind;
    client.status = r.status;
    client.code = r.code || client.code || '';
    client.phone = pick('phone', client.phone);
    client.plan = pick('plan', client.plan);
    client.document = pick('document', client.document);
    client.address = pick('address', client.address);
    if (text('address')) client.addressAuto = false;
    client.ctoUid = r.cto ? r.cto.uid : (text('cto') ? client.ctoUid : client.ctoUid || null);
    client.ctoPort = r.cto ? r.port : client.ctoPort || null;
    client.notes = pick('notes', client.notes);
    const serial = text('serial');
    if (serial && !client.equipments.some(eq => eq.serial === serial)) {
        const onu = client.equipments.find(eq => eq.type === 'ONU/ONT');
        if (onu) onu.serial = serial;
        else client.equipments.push({ type: 'ONU/ONT', model: '', serial, mac: '' });
    }
    if (client.kind !== 'predial') client.predial = client.predial || {};
    return client;
}

//Traçado do drop já calculado (pela rede ou reto): importar muitos clientes não dispara uma rota pela rua para cada um
function prepareImportedDrop(info, net) {
    const cto = findMarkerByUid(info.client.ctoUid);
    if (!cto?.marker || isPredialClient(info)) return;
    const ctoPos = cto.marker.getPosition();
    const clientPos = info.marker.getPosition();
    const routed = net ? routeDropAlongNetwork(net, ctoPos, clientPos) : null;
    info.client.dropPath = (routed || [ctoPos, clientPos]).map(p => ({ lat: p.lat(), lng: p.lng() }));
    info.client.dropRoute = routed ? 'rede' : 'reta';
    info.client.dropKey = getDropKey(cto, info);
}

async function runClientImport() {
    const root = getClientImportRoot();
    if (!root || !requireDocument('importar clientes')) return;
    const rows = clientImport.rows.filter(r => r.action !== 'erro');
    if (!rows.length) return;
    const projectId = getRootId(root);
    const folderIds = new Set(getAllDescendantFolderIds(projectId));
    const fallbackFolder = folderIds.has(activeFolderId) ? activeFolderId : projectId;
    const touched = [];
    let created = 0;
    let updated = 0;
    clientDropsSuspended = true;
    try {
        rows.forEach(r => {
            if (r.existing && markers.includes(r.existing)) {
                const info = r.existing;
                const previous = info.client || {};
                const client = buildImportedClientData(r, previous);
                const moved = !!r.position && (Math.abs(info.marker.getPosition().lat() - r.position.lat) > 1e-9 || Math.abs(info.marker.getPosition().lng() - r.position.lng) > 1e-9);
                if (moved) {
                    const latLng = new google.maps.LatLng(r.position.lat, r.position.lng);
                    info.marker.setPosition(latLng);
                    info.position = latLng;
                }
                if (moved || previous.ctoUid !== client.ctoUid) { client.dropPath = null; client.dropRoute = null; client.dropKey = null; }
                const oldName = info.name;
                info.name = r.name;
                if (oldName !== r.name && typeof syncCableAnchorNamesForMarker === 'function') syncCableAnchorNamesForMarker(info, oldName);
                info.client = client;
                info.description = client.notes;
                updateMarkerAppearance(info);
                touched.push(info);
                updated++;
                return;
            }
            const client = buildImportedClientData(r);
            rebuildMarker({
                type: 'CLIENTE', name: r.name, folderId: r.cto?.folderId && folderIds.has(r.cto.folderId) ? r.cto.folderId : fallbackFolder,
                color: getClientStatus(client.status).color, labelColor: '#000000', size: DEFAULT_MARKER_SIZE,
                description: client.notes, position: r.position, client,
            });
            touched.push(markers[markers.length - 1]);
            created++;
        });
    } finally {
        clientDropsSuspended = false;
    }
    //Drops: pela rede da cidade quando dá, senão reto (cada um pode ser recalculado depois)
    const net = typeof buildDropNetwork === 'function' && google.maps?.geometry ? buildDropNetwork(projectId) : null;
    touched.forEach(info => { if (!info.client.dropPath) prepareImportedDrop(info, net); });
    const box = root.querySelector(':scope > .folder-title .visibility-toggle-btn');
    if (box && !box.checked) handleVisibilityToggle(box, true);
    else touched.forEach(info => info.marker.setVisible(true));
    refreshClientDrops();
    if (typeof updateSidebarCounts === 'function') updateSidebarCounts();
    const skipped = clientImport.rows.length - rows.length;
    markNetworkBulkChange(projectId, {
        action: 'importou', type: 'CLIENTE', name: clientImport.fileName,
        detail: `${created} novo${created === 1 ? '' : 's'}, ${updated} atualizado${updated === 1 ? '' : 's'}`,
    }, touched.map(info => info.uid));
    const saved = await saveNetworkRoot(root);
    renderClientImport({ created, updated, skipped, saved });
}

function handleClientImportClick(e) {
    const action = e.target.closest('[data-import]')?.dataset.import;
    if (!action) {
        if (e.target.id === 'clientImportModal') closeClientImport();
        return;
    }
    if (action === 'close') closeClientImport();
    if (action === 'pick') document.getElementById('clientImportFile')?.click();
    if (action === 'template') downloadClientImportTemplate();
    if (action === 'run') runClientImport();
}

appReady.then(() => {
    document.getElementById('networkImportClientsButton')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('networkDropdown')?.classList.remove('show');
        openClientImport();
    });
});
