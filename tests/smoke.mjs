// Teste de fumaça do site: abre index.html num Chromium com Supabase simulado e Google Maps bloqueado
// e confere se carrega sem erros e se as partes principais funcionam. Uso: node tests/smoke.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const failures = [];
const check = (ok, message) => { console.log(`${ok ? '✓' : '✗'} ${message}`); if (!ok) failures.push(message); };

//Servidor local com os mesmos cabeçalhos do firebase.json. A CSP, publicada em modo "só aviso",
//aqui é aplicada de verdade: qualquer bloqueio vira falha do teste.
const firebaseHeaders = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8')).hosting.headers;
const globMatches = (glob, file) => glob === '**' || new RegExp('^' + glob.replace(/\./g, '\\.').replace(/\*\*\//g, '(.*/)?').replace(/\*/g, '[^/]*').replace(/\{([^}]+)\}/g, (_, g) => '(' + g.split(',').join('|') + ')') + '$').test(file);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' };
  firebaseHeaders.filter(h => globMatches(h.source, rel)).forEach(h => h.headers.forEach(({ key, value }) => {
    headers[key === 'Content-Security-Policy-Report-Only' ? 'Content-Security-Policy' : key] = value;
  }));
  res.writeHead(200, headers);
  if (rel.endsWith('.html')) {
    //O Supabase é trocado pelo simulado (tests/fake-supabase.js): só ele perde a verificação de integridade
    const html = fs.readFileSync(file, 'utf8').replace(/(<script src="[^"]*supabase-js[^"]*") integrity="[^"]*"/g, '$1');
    return res.end(html);
  }
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const cspViolations = [];
const watchCsp = (p) => p.on('console', m => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text().slice(0, 200)); });

//Tela de login carrega sem erros
const loginPage = await browser.newPage();
watchCsp(loginPage);
await loginPage.route('**/supabase.js', r => r.fulfill({ path: path.join(here, 'fake-supabase.js'), contentType: 'text/javascript' }));
const loginErrors = [];
loginPage.on('pageerror', e => loginErrors.push(e.message));
await loginPage.goto(baseUrl + '/login.html');
await loginPage.waitForTimeout(800);
check(loginErrors.length === 0, `tela de login carrega sem erros${loginErrors.length ? ': ' + loginErrors.join(' | ') : ''}`);
await loginPage.close();

//Login com verificação em 2 etapas: pede o código, recusa código errado, libera com o certo,
//e o sistema não abre com sessão sem o código
const mfaPage = await browser.newPage();
await mfaPage.addInitScript(() => { window.__fakeMfa = true; });
await mfaPage.route('**/supabase.js', r => r.fulfill({ path: path.join(here, 'fake-supabase.js'), contentType: 'text/javascript' }));
await mfaPage.route(/maps\.googleapis|maps\.gstatic/, r => r.abort());
await mfaPage.goto(baseUrl + '/index.html');
await mfaPage.waitForURL(/login\.html/, { timeout: 10000 }).catch(() => {});
check(/login\.html/.test(mfaPage.url()), 'sistema não abre sem o código da verificação em 2 etapas');
await mfaPage.waitForSelector('#viewMfa:not([hidden])', { timeout: 10000 }).catch(() => {});
check(await mfaPage.isVisible('#viewMfa'), 'login pede o código do autenticador');
await mfaPage.fill('#mfaCode', '000000');
await mfaPage.click('#mfaForm button[type="submit"]');
await mfaPage.waitForTimeout(400);
const mfaError = await mfaPage.textContent('#viewMfa .error-message');
check(/incorreto|expirado/i.test(mfaError || '') && /login\.html/.test(mfaPage.url()), 'código errado é recusado');
await mfaPage.fill('#mfaCode', '123456');
await mfaPage.click('#mfaForm button[type="submit"]');
await mfaPage.waitForURL(/index\.html/, { timeout: 10000 }).catch(() => {});
await mfaPage.waitForFunction(() => typeof AppSession !== 'undefined' && AppSession.company, null, { timeout: 10000 }).catch(() => {});
check(/index\.html/.test(mfaPage.url()) && await mfaPage.evaluate(() => typeof AppSession !== 'undefined' && !!AppSession.company), 'código certo libera o sistema');
await mfaPage.close();

const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
watchCsp(page);
await page.route('**/supabase.js', r => r.fulfill({ path: path.join(here, 'fake-supabase.js'), contentType: 'text/javascript' }));
await page.route(/maps\.googleapis|maps\.gstatic/, r => r.abort());
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(baseUrl + '/index.html');
await page.waitForFunction(() => typeof AppSession !== 'undefined' && AppSession.company, null, { timeout: 15000 });
await page.waitForTimeout(800);

//Bibliotecas das CDNs carregadas com verificação de integridade (no GitHub; aqui a rede pode bloquear as CDNs)
if (process.env.CI) {
  const libs = await page.evaluate(() => ({
    xlsx: typeof XLSX !== 'undefined' && typeof XLSX.utils === 'object',
    jszip: typeof JSZip === 'function',
    jspdf: typeof window.jspdf?.jsPDF === 'function',
    autotable: typeof window.jspdf?.jsPDF?.API?.autoTable === 'function',
    docx: typeof htmlDocx === 'object',
  }));
  const missing = Object.entries(libs).filter(([, ok]) => !ok).map(([name]) => name);
  check(!missing.length, `bibliotecas externas carregadas com verificação de integridade${missing.length ? ' (falharam: ' + missing.join(', ') + ')' : ''}`);
}
check(pageErrors.length === 0, `site carrega sem erros${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

const r = await page.evaluate(() => {
  initMaterialCatalog();
  const totals = summarizeBomCosts({
    a: { category: 'Ferragem', quantity: 2, unitPrice: 10 },
    b: { category: 'Lançamento', quantity: 100, unitPrice: 2.5 },
    c: { category: 'Outros', quantity: 1, unitPrice: 7 },
    d: { category: 'Fusão', quantity: 3, unitPrice: 1, removed: true },
    e: { category: 'Mão de Obra', quantity: 1, unitPrice: 999 },
    f: { category: 'Data Center', quantity: 1, unitPrice: 100 },
  });
  return {
    totals,
    materials: materialCatalog.materials.length,
    kits: materialCatalog.kits.length,
    ctoKit: (MATERIAL_PRICES['CTO']?.components || []).length,
    kml: typeof exportProjectToKML === 'function' && typeof parseAndDisplayKML === 'function',
    cableType: inferCableTypeFromKml({ name: 'CABO FO-12 AS80', description: '', folderPath: [], lineColorHex: '', extendedData: {} }).type,
    labor: typeof openLaborModal === 'function' && typeof calculateProjectLaborCost === 'function',
  };
});
check(r.totals.ferragemTotal === 27 && r.totals.cabosTotal === 250 && r.totals.fusaoTotal === 0
  && r.totals.datacenterTotal === 100 && r.totals.grandTotal === 377, 'totais da lista de materiais (outros → ferragens; removidos e mão de obra fora)');
check(r.materials > 0 && r.kits > 0 && r.ctoKit > 0, `catálogo carrega (${r.materials} materiais, ${r.kits} kits)`);
check(r.kml && r.cableType === 'Cabo AS 80 FO-12', 'importação/exportação KML disponível e reconhece tipo de cabo');
check(r.labor, 'mão de obra disponível');

const report = await page.evaluate(() => {
  const fns = ['createProject', 'createFolder', 'setActiveFolder', 'copySidebarSelection', 'pasteSidebarClipboard', 'enableDragAndDropForItem', 'saveActiveProject', 'openProjectFromDatabase', 'buildProjectRecord', 'serializeMarker', 'rebuildCable', 'openReportModal', 'showProjectReportDetails', 'buildReportPreviewFlowBlocks', 'startSketch', 'finishPolygonSketch', 'formatDistance'];
  const missing = fns.filter(n => typeof window[n] !== 'function');
  let error = null;
  try { openReportModal(); } catch (e) { error = e.message; }
  const opened = getComputedStyle(document.getElementById('reportModal')).display !== 'none';
  document.getElementById('reportModal').style.display = 'none';
  return { missing, error, opened, distance: formatDistance(1234.5) };
});
check(!report.missing.length, `barra lateral, salvar/abrir projeto, relatório e régua disponíveis${report.missing.length ? ' (faltando: ' + report.missing.join(', ') + ')' : ''}`);
check(!report.error && report.opened, `janela de relatório abre${report.error ? ': ' + report.error : ''}`);

//Lista de materiais de um projeto de exemplo: totais conferidos com a versão publicada em 03/10/2026.
//Se o cálculo mudar de propósito (preço, kit, regra), atualize os valores esperados aqui.
const bom = await page.evaluate(() => {
  document.getElementById('sidebar').insertAdjacentHTML('beforeend', '<li class="folder"><span class="folder-title" data-folder-id="projTeste">Projeto teste</span><ul id="projTeste"></ul></li>');
  const previousFolder = activeFolderId;
  activeFolderId = 'projTeste';
  const base = { folderId: 'projTeste', size: 30 };
  const added = [
    { ...base, type: 'CTO', name: 'CTO-01', ctoStatus: 'Nova' },
    { ...base, type: 'CTO', name: 'CTO-02', ctoStatus: 'Nova', isPredial: true },
    { ...base, type: 'CEO', name: 'CEO-01', ceoStatus: 'Nova', ceoAccessory: 'Raquete', is144F: false },
    { ...base, type: 'RESERVA', name: 'RES-01', reservaStatus: 'Nova', reservaAccessory: 'Suporte' },
    { ...base, type: 'CORDOALHA', name: 'COR-01', cordoalhaStatus: 'Nova', derivationTCount: 2 },
    { ...base, type: 'CTO', name: 'CTO-EXIST', ctoStatus: 'Existente' },
    { ...base, type: 'CLIENTE', name: 'Empresa X', client: { kind: 'b2b', status: 'a_instalar', equipments: [
      { type: 'Switch', model: 'SWITCH MPLS 24 PORTAS', material: 'SWITCH MPLS 24 PORTAS' },
      { type: 'Outro', model: 'Cordão Óptico especial', price: 45.5 },
    ] } },
  ];
  markers.push(...added);
  calculateBomState();
  const items = Object.values(bomState).filter(i => !i.removed);
  const totals = summarizeBomCosts(bomState);
  const typed = items.find(i => i.materialName === 'Outro - Cordão Óptico especial');
  added.forEach(m => markers.splice(markers.indexOf(m), 1));
  activeFolderId = previousFolder;
  bomState = {};
  document.querySelector('[data-folder-id="projTeste"]').closest('li').remove();
  const round = v => Math.round(v * 100) / 100;
  return { count: items.length, typedPrice: typed?.unitPrice, typedCategory: typed?.category,
    ferragem: round(totals.ferragemTotal), fusao: round(totals.fusaoTotal), datacenter: round(totals.datacenterTotal), total: round(totals.grandTotal) };
});
check(bom.count === 23 && bom.ferragem === 719.94 && bom.fusao === 403.29 && bom.datacenter === 23050.5 && bom.total === 24173.73,
  `lista de materiais do projeto de exemplo (${bom.count} itens, total R$ ${bom.total})`);
check(bom.typedPrice === 45.5 && bom.typedCategory === 'Data Center', 'equipamento digitado do cliente B2B entra com o valor informado, em Data Center');

//Planos de fusão: monta uma CEO e uma CTO com os construtores do editor e confere tudo que lê os planos
//(lista de materiais, uso do cabo, portas, cartão do mouse, fibras livres, relatório e OLTs).
const fusion = await page.evaluate(() => {
  const makePlan = (cards, links, extra = {}) => {
    const box = document.createElement('div'); cards.forEach(c => box.appendChild(c));
    const svg = links.map(([a, b], i) => `<path id="fl-${i}" class="fusion-line" data-start-id="${a}" data-end-id="${b}" d="M0 0"></path>`).join('');
    return JSON.stringify({ version: 2, elements: box.innerHTML, svg, ...extra });
  };
  const fiber = (card, n) => [...card.querySelectorAll('.fiber-row')][n - 1].id;
  const cA = buildFusionCableCard({ name: 'CABO-A', type: 'Cabo AS 80 FO-12', status: 'Novo', role: 'entrada', fiberCount: 12 });
  const cB = buildFusionCableCard({ name: 'CABO-B', type: 'Cabo AS 80 FO-06', status: 'Novo', role: 'saida', fiberCount: 6 });
  const cB2 = buildFusionCableCard({ name: 'CABO-B', type: 'Cabo AS 80 FO-06', status: 'Novo', role: 'entrada', fiberCount: 6 });
  const sp1 = buildFusionSplitterCard({ id: 'splitter-1', label: '1:8 APC', outputs: 8, status: 'Novo', type: 'Atendimento', connector: 'APC', olt: { olt: 'OLT-1', placa: '2', pon: '5' } });
  const sp2 = buildFusionSplitterCard({ id: 'splitter-2', label: '1:2', outputs: 2, status: 'Existente', type: 'Fusão', connector: 'APC' });
  const sp3 = buildFusionSplitterCard({ id: 'splitter-3', label: '1:16 UPC', outputs: 16, status: 'Existente', type: 'Atendimento', connector: 'UPC' });
  document.getElementById('sidebar').insertAdjacentHTML('beforeend', '<li class="folder"><span class="folder-title" data-folder-id="projF">P</span><ul id="projF"></ul></li>');
  const previousFolder = activeFolderId;
  activeFolderId = 'projF';
  const ceo = { folderId: 'projF', type: 'CEO', name: 'CEO-01', ceoStatus: 'Existente',
    fusionPlan: makePlan([cA, cB, sp2], [[fiber(cA, 1), fiber(cB, 1)], [fiber(cA, 2), fiber(cB, 2)], [fiber(cA, 3), 'splitter-2-input-port']], { trayQuantity: 3 }) };
  const cto = { folderId: 'projF', type: 'CTO', name: 'CTO-01', ctoStatus: 'Existente', uid: 'cto-uid-1',
    fusionPlan: makePlan([cB2, sp1, sp3], [[fiber(cB2, 1), 'splitter-1-input-port']]) };
  const broken = { folderId: 'projF', type: 'CEO', name: 'CEO-RUIM', ceoStatus: 'Existente', fusionPlan: '{não é json' };
  markers.push(ceo, cto, broken);
  calculateBomState();
  const bomQty = (name) => Object.values(bomState).find(i => i.materialName === name)?.quantity || 0;
  activeMarkerForFusion = { folderId: 'projF', name: 'outra' };
  const result = {
    splitterBom: bomQty('SPLITTER CONECTORIZADO 1/8 SC/APC'), adapters: bomQty('ADAPTADOR SC/APC COM ABAS (PASSANTE)'),
    tubes: bomQty('TUBETE PROTETOR DE EMENDA OPTICA'), trays: bomQty('KIT DE BANDEJA PARA CAIXA TIPO FOSC - 24F'),
    usageA: checkCableUsageInFusionPlans({ name: 'CABO-A' }), usageB: checkCableUsageInFusionPlans({ name: 'CABO-B' }),
    capacity: getCtoPortCapacity(cto), hover: summarizeFusionPlan(cto), hoverCeo: summarizeFusionPlan(ceo), broken: summarizeFusionPlan(broken),
    fibersA: getCableFiberUsage({ name: 'CABO-A', type: 'Cabo AS 80 FO-12' }), ports: countProjectPorts([ceo, cto]),
    olt: collectProjectOltUsage(),
  };
  activeMarkerForFusion = null;
  [ceo, cto, broken].forEach(m => markers.splice(markers.indexOf(m), 1));
  activeFolderId = previousFolder; bomState = {};
  document.querySelector('[data-folder-id="projF"]').closest('li').remove();
  return result;
});
check(fusion.splitterBom === 1 && fusion.adapters === 8 && fusion.tubes === 4 && fusion.trays === 3,
  'plano de fusão → lista de materiais (splitter novo, adaptadores, tubetes por fusão, bandejas)');
check(fusion.usageA.isInPlan && fusion.usageA.hasFusions && fusion.usageB.locations.join() === 'CEO-01,CTO-01', 'uso do cabo nos planos de fusão');
check(fusion.capacity === 24 && fusion.hover.ports === 24 && fusion.hover.splitters === 2 && fusion.hover.ratios === '1:8 APC, 1:16 UPC'
  && fusion.hoverCeo.usedFibers === 5 && fusion.broken === null, 'portas da CTO e cartão ao passar o mouse');
check(fusion.fibersA.used.join() === '1,2,3' && fusion.fibersA.free.length === 9, 'fibras em uso e vagas do cabo');
check(fusion.ports.portasExistentes === 16 && fusion.ports.novasPortas === 8 && fusion.olt.length === 1 && fusion.olt[0].pon === '5',
  'portas do relatório e OLTs vinculadas');

//Cabos: metragem, reserva nas caixas e ferragens. O Google Maps fica bloqueado no teste, então entra um
//substituto mínimo com a mesma fórmula de distância (haversine, raio da Terra do Google).
//Valores conferidos com a versão publicada em 04/10/2026.
const cables = await page.evaluate(() => {
  const realGoogle = window.google;
  class LatLng { constructor(a, b) { this._a = a; this._b = b; } lat() { return this._a; } lng() { return this._b; } equals(o) { return !!o && o.lat() === this._a && o.lng() === this._b; } toJSON() { return { lat: this._a, lng: this._b }; } }
  const R = 6378137, rad = d => d * Math.PI / 180;
  const dist = (p, q) => { const dLat = rad(q.lat() - p.lat()), dLng = rad(q.lng() - p.lng()); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p.lat())) * Math.cos(rad(q.lat())) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  window.google = { maps: { LatLng, geometry: { spherical: {
    computeDistanceBetween: dist,
    computeLength: path => { const pts = Array.isArray(path) ? path : path.getArray(); let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; },
  } } } };
  document.getElementById('sidebar').insertAdjacentHTML('beforeend', '<li class="folder"><span class="folder-title" data-folder-id="projC">P</span><ul id="projC"></ul></li>');
  const previousFolder = activeFolderId;
  activeFolderId = 'projC';
  const at = (lat, lng) => ({ getPosition: () => new LatLng(lat, lng), setPosition() {}, setIcon() {}, setMap() {}, getMap() { return null; } });
  const boxes = [
    { folderId: 'projC', type: 'CTO', name: 'CTO-01', ctoStatus: 'Nova', uid: 'u-cto', marker: at(-20, -44) },
    { folderId: 'projC', type: 'CEO', name: 'CEO-01', ceoStatus: 'Nova', ceoAccessory: 'Raquete', uid: 'u-ceo', marker: at(-20.01, -44) },
  ];
  const lines = [
    { folderId: 'projC', name: 'CABO-1', type: 'Cabo AS 80 FO-12', status: 'Novo', path: [new LatLng(-20, -44), new LatLng(-20.01, -44)] },
    { folderId: 'projC', name: 'CABO-2', type: 'Cabo AS 80 FO-12', status: 'Novo', path: [new LatLng(-20.01, -44), new LatLng(-20.01, -44.004), new LatLng(-20.012, -44.004)] },
    { folderId: 'projC', name: 'CABO-3', type: 'Cabo AS 80 FO-06', status: 'Existente', path: [new LatLng(-20, -44), new LatLng(-20.02, -44)] },
  ];
  markers.push(...boxes); savedCables.push(...lines);
  calculateBomState();
  const qty = name => Object.values(bomState).find(i => i.materialName === name)?.quantity || 0;
  const round = v => Math.round(v * 100) / 100;
  const t = summarizeBomCosts(bomState);
  const result = {
    m1: calculateCableMeasurement(lines[0]), m2: calculateCableMeasurement(lines[1]),
    cable12: qty('CFOA SM ASU 80 S 12 FIBRAS NR'), cable06: Object.values(bomState).some(i => /06 FIBRAS/.test(i.materialName)),
    bap: qty('ABRAÇADEIRA BAP 3'), alca: qty('ALÇA PREFORMADA OPDE 1008 - 6,8mm a 7,4mm'),
    ferragem: round(t.ferragemTotal), cabos: round(t.cabosTotal), total: round(t.grandTotal),
  };
  boxes.forEach(m => markers.splice(markers.indexOf(m), 1));
  lines.forEach(c => savedCables.splice(savedCables.indexOf(c), 1));
  activeFolderId = previousFolder; bomState = {};
  document.querySelector('[data-folder-id="projC"]').closest('li').remove();
  window.google = realGoogle;
  return result;
});
check(cables.m1.lancamento === 1120 && cables.m1.reserva === 30 && cables.m1.total === 1150
  && cables.m2.lancamento === 650 && cables.m2.reserva === 25 && cables.m2.total === 680, 'metragem dos cabos: lançamento + reserva das caixas, arredondados');
check(cables.cable12 === 1830 && !cables.cable06, 'cabos na lista de materiais (soma por tipo; cabo existente fora)');
check(cables.bap === 53 && cables.alca === 106 && cables.ferragem === 2594.33 && cables.cabos === 3696.6 && cables.total === 6569.51,
  `ferragens e totais do projeto com cabos (total R$ ${cables.total})`);

//Barra lateral: cria pastas, converte a estrutura em JSON (como vai para o banco) e reconstrói igual
const sidebarRoundTrip = await page.evaluate(() => {
  const box = document.createElement('ul');
  document.getElementById('sidebar').appendChild(box);
  appendFolderToParent(box, 'Pasta A', 'fA');
  appendFolderToParent(document.getElementById('fA'), 'Sub <b>1</b>', 'fA1');
  appendFolderToParent(box, 'Pasta B', 'fB');
  const json = getSidebarStructureAsJSON(box);
  box.remove();
  const rebuilt = document.createElement('ul');
  document.getElementById('sidebar').appendChild(rebuilt);
  rebuildSidebarFromJSON(json, rebuilt);
  const again = getSidebarStructureAsJSON(rebuilt);
  const names = [...rebuilt.querySelectorAll('.folder-name-text')].map(e => e.textContent);
  const injected = !!rebuilt.querySelector('.folder-name-text b');
  rebuilt.remove();
  const strip = list => list.map(n => ({ id: n.id, name: n.name, children: strip(n.children) }));
  return { same: JSON.stringify(strip(json)) === JSON.stringify(strip(again)), names, injected };
});
check(sidebarRoundTrip.same && sidebarRoundTrip.names.join('|') === 'Pasta A|Sub <b>1</b>|Pasta B' && !sidebarRoundTrip.injected,
  'barra lateral: pastas viram JSON e voltam iguais (nome com HTML continua texto)');

//Duas pessoas no mesmo projeto, lixeira, histórico e registro de erros (Supabase simulado com tabela em memória)
await page.evaluate(() => {
  window.__fakeDb.projects.projX = { id: 'projX', name: 'Projeto X', revision: 1, data: {}, updated_by: 'u1', deleted_at: null };
  loadAndDisplayProject('projX', { sidebar: { id: 'projX', name: 'Projeto X', type: 'TCR', isProject: true, children: [] }, markers: [], cables: [], polygons: [] });
  setProjectRevision(document.getElementById('projX').closest('.folder'), 1);
  activeFolderId = 'projX';
  //Outra pessoa salva depois que o projeto foi aberto aqui
  Object.assign(window.__fakeDb.projects.projX, { revision: 2, updated_by: 'u2', updated_at: '2026-10-05T14:32:00Z' });
  saveActiveProject();
});
await page.waitForSelector('#choiceModal', { state: 'visible', timeout: 5000 }).catch(() => {});
const conflictText = await page.textContent('#choiceModalMessage').catch(() => '');
check(/salvou este projeto/.test(conflictText || '') && await page.isVisible('#choiceModal'), 'salvar projeto alterado por outra pessoa mostra o aviso em vez de sobrescrever');
const keptOther = await page.evaluate(() => window.__fakeDb.projects.projX.revision === 2);
check(keptOther, 'nada é gravado antes da escolha');
await page.click('#choiceModalButtons button:has-text("Salvar mesmo assim")');
await page.waitForTimeout(400);
const forced = await page.evaluate(() => ({ db: window.__fakeDb.projects.projX.revision, local: getProjectRevision(document.getElementById('projX').closest('.folder')) }));
check(forced.db === 3 && forced.local === 3, '"Salvar mesmo assim" grava e atualiza a revisão');
const normal = await page.evaluate(async () => {
  await persistProject(document.getElementById('projX').closest('.folder'));
  return window.__fakeDb.projects.projX.revision;
});
check(normal === 4, 'salvamento normal (sem ninguém no meio) grava direto');

//Capturas de tela opcionais das janelas novas (SMOKE_SHOTS=pasta node smoke.mjs)
if (process.env.SMOKE_SHOTS) {
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    showChoice({ title: 'Projeto alterado por outra pessoa', message: describeProjectConflict({ updatedByName: 'Bia Projetista', updatedAt: '2026-10-05T14:32:00Z' }) + '\n\nSalvar mesmo assim substitui a versão salva pela sua — a outra continua no histórico de versões e pode ser restaurada. Para ver as alterações da outra pessoa, recarregue o projeto (as suas alterações não salvas serão perdidas).', choices: [{ label: 'Cancelar', value: 'c' }, { label: 'Recarregar projeto', value: 'r' }, { label: 'Salvar mesmo assim', kind: 'primary', value: 'f' }] });
  });
  await page.waitForTimeout(300);
  await page.locator('#choiceModal .modal-content').screenshot({ path: path.join(process.env.SMOKE_SHOTS, 'conflito.png') });
  await page.evaluate(() => { document.getElementById('choiceModal').style.display = 'none'; });
}
const history = await page.evaluate(async () => {
  await openProjectHistory('projX', document.getElementById('projX').closest('.folder'), 'Projeto X');
  const items = document.querySelectorAll('#projectHistoryList .safety-list__item').length;
  return items;
});
if (process.env.SMOKE_SHOTS) await page.locator('#projectHistoryModal .modal-content').screenshot({ path: path.join(process.env.SMOKE_SHOTS, 'historico.png') });
await page.evaluate(() => { document.getElementById('projectHistoryModal').style.display = 'none'; });
check(history >= 2, `histórico de versões lista as versões salvas (${history})`);

await page.evaluate(() => deleteProject('projX', document.getElementById('projX').closest('.folder'), 'Projeto X'));
await page.click('#confirmModalConfirmButton');
await page.waitForTimeout(400);
const trashed = await page.evaluate(() => ({ deleted: !!window.__fakeDb.projects.projX?.deleted_at, inSidebar: !!document.getElementById('projX') }));
check(trashed.deleted && !trashed.inSidebar, 'excluir projeto manda para a lixeira (não apaga do banco)');
//Ordem das janelas: a última aberta fica por cima, em qualquer ordem (js/layering.js)
const layering = await page.evaluate(async () => {
  const wait = () => new Promise(r => setTimeout(r, 30));
  const show = async (id) => { document.getElementById(id).style.display = 'flex'; await wait(); };
  const hide = (id) => { document.getElementById(id).style.display = 'none'; };
  const isTop = (id) => {
    const el = document.getElementById(id);
    const box = (el.querySelector('.modal-content') || el).getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.left + box.width / 2, box.top + 12));
  };
  const results = [];
  const pairs = [['loadProjectModal', 'trashModal'], ['accountModal', 'loadProjectModal'], ['materialCatalogModal', 'accountModal'], ['projectHistoryModal', 'materialModal']];
  for (const [a, b] of pairs) {
    if (!document.getElementById(a) || !document.getElementById(b)) continue;
    await show(a); await show(b); results.push([`${a} → ${b}`, isTop(b)]); hide(a); hide(b);
    await show(b); await show(a); results.push([`${b} → ${a}`, isTop(a)]); hide(a); hide(b);
  }
  await show('loadProjectModal'); await show('trashModal');
  showConfirm('Excluir de vez', 'teste', () => {}); await wait();
  results.push(['confirmação por cima da lixeira', isTop('confirmModal')]);
  hide('confirmModal'); hide('trashModal'); hide('loadProjectModal');
  //Caixa de ferramenta aberta e depois uma janela: a janela cobre
  const ruler = document.getElementById('rulerBox'), poly = document.getElementById('polygonDrawingBox');
  ruler.classList.remove('hidden'); await wait();
  await show('accountModal');
  results.push(['janela aberta depois da régua fica por cima', isTop('accountModal')]);
  hide('accountModal');
  //Duas caixas abertas: clicar na de baixo a traz para frente
  poly.classList.remove('hidden'); await wait();
  ruler.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  results.push(['clicar na caixa a traz para frente', parseInt(ruler.style.zIndex, 10) > parseInt(poly.style.zIndex, 10)]);
  ruler.classList.add('hidden'); poly.classList.add('hidden');
  return results;
});
const layeringFail = layering.filter(([, ok]) => !ok).map(([name]) => name);
check(layering.length >= 8 && !layeringFail.length, `a última janela aberta fica por cima (${layering.length} combinações)${layeringFail.length ? ': falhou ' + layeringFail.join('; ') : ''}`);
await page.evaluate(() => openTrash());
await page.waitForSelector('#trashList [data-trash-action="restore"]', { timeout: 5000 }).catch(() => {});
if (process.env.SMOKE_SHOTS) await page.locator('#trashModal .modal-content').screenshot({ path: path.join(process.env.SMOKE_SHOTS, 'lixeira.png') });
await page.click('#trashList [data-trash-action="restore"]').catch(() => {});
await page.waitForTimeout(400);
const restored = await page.evaluate(() => {
  document.getElementById('trashModal').style.display = 'none';
  return window.__fakeDb.projects.projX?.deleted_at === null;
});
check(restored, 'projeto volta da lixeira');

const errorsLogged = await page.evaluate(async () => {
  const fire = (message) => window.dispatchEvent(new ErrorEvent('error', { message, filename: location.origin + '/js/x.js', lineno: 1, colno: 2, error: new Error(message) }));
  fire('Erro de teste do registro');
  fire('Erro de teste do registro');          //repetido: ignora
  fire('ResizeObserver loop limit exceeded');  //ruído: ignora
  await new Promise(r => setTimeout(r, 300));
  return window.__fakeDb.client_errors.map(e => e.message);
});
check(errorsLogged.length === 1 && errorsLogged[0] === 'Erro de teste do registro', 'erros do navegador são registrados (sem repetidos nem ruído)');

//Nome no mapa: opção vale para cliente residencial (antes só empresarial) e clientes B2B antigos continuam
const clientLabel = await page.evaluate(() => {
  openClientModal(null, 'residencial');
  const box = document.getElementById('clientShowLabel');
  const visible = !!box && box.offsetParent !== null;
  box.checked = true; box.dispatchEvent(new Event('change'));
  document.getElementById('clientLabelColor').value = '#ff0000';
  document.getElementById('clientName').value = 'Casa do João';
  const collected = collectClientForm();
  closeClientModal();
  return {
    visible,
    saved: collected.client.showLabel === true && collected.client.labelColor === '#ff0000',
    legacyB2B: getClientMapLabel({ kind: 'b2b', b2b: { showLabel: true, labelColor: '#123456' } }),
    off: getClientMapLabel({ kind: 'residencial' }).show,
  };
});
if (process.env.SMOKE_SHOTS) {
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); openClientModal(null, 'residencial'); document.querySelector('#clientShowLabel').scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(300);
  await page.locator('#clientModal .modal-content').screenshot({ path: path.join(process.env.SMOKE_SHOTS, 'cliente.png') });
  await page.evaluate(() => closeClientModal());
}
check(clientLabel.visible && clientLabel.saved, 'cliente residencial tem a opção "Exibir o nome no mapa"');
check(clientLabel.legacyB2B.show && clientLabel.legacyB2B.color === '#123456' && !clientLabel.off, 'clientes empresariais antigos continuam com o nome no mapa');

//Drop do cliente aparece na barra lateral embaixo do cliente: ocultar, centralizar e editar pelo menu
const dropRow = await page.evaluate(() => {
  const realInfo = window.getClientDropInfo;
  window.getClientDropInfo = (c) => c.dropLine?.getPath().getLength() >= 2 ? { length: 45, route: c.client.dropRoute, isManual: false } : null;
  const calls = [];
  const path = [1, 2];
  const line = { getPath: () => ({ getLength: () => path.length, forEach: () => {} }), setVisible: v => calls.push(v) };
  const marker = { getVisible: () => true };
  const ul = document.createElement('ul');
  ul.className = 'subfolders';
  document.getElementById('sidebar').appendChild(ul);
  const li = buildGeProMapItemRow(Object.assign(document.createElement('span'), { className: 'item-name', textContent: 'Casa 1' }), null, 'ge-icon-client');
  ul.appendChild(li);
  const info = { type: 'CLIENTE', name: 'Casa 1', listItem: li, marker, dropLine: line, client: { kind: 'residencial', status: 'ativo', ctoUid: 'cto-1', dropRoute: 'rede' } };
  markers.push(info);
  refreshClientDropSidebarRow(info);
  const row = li.querySelector(':scope > .ge-drop-row');
  const result = { exists: !!row, meta: row?.querySelector('.item-meta').textContent, counted: li.querySelectorAll('.ge-pro-item').length };
  const entity = getSidebarEntity(row.querySelector('.item-name'));
  result.kind = entity?.kind;
  result.client = entity?.info === info;
  result.actions = buildSidebarMenuItems(entity).map(i => i.action).filter(Boolean);
  const cb = row.querySelector('.ge-drop-vis');
  cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true }));
  result.hidden = info.client.dropHidden === true && calls.at(-1) === false;
  result.menuAfterHide = buildSidebarMenuItems(getSidebarEntity(row)).some(i => i.action === 'show');
  setClientDropHidden(info, false);
  result.shown = !info.client.dropHidden && calls.at(-1) === true && cb.checked;
  path.length = 0;
  refreshClientDropSidebarRow(info);
  result.removed = !li.querySelector('.ge-drop-row');
  path.push(1, 2);
  refreshClientDropSidebarRow(info);
  window.__dropTest = { info, ul, realInfo };
  return result;
});
if (process.env.SMOKE_SHOTS) {
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); window.__dropTest.ul.scrollIntoView(); });
  await page.waitForTimeout(200);
  await page.locator('#sidebar').screenshot({ path: path.join(process.env.SMOKE_SHOTS, 'drop-sidebar.png') });
}
await page.evaluate(() => {
  const { info, ul, realInfo } = window.__dropTest;
  markers.splice(markers.indexOf(info), 1); ul.remove(); window.getClientDropInfo = realInfo;
});
check(dropRow.exists && dropRow.meta.startsWith('45 m') && dropRow.counted === 0, `drop aparece embaixo do cliente na barra lateral (${dropRow.meta})`);
check(dropRow.kind === 'drop' && dropRow.client && ['drop-edit', 'drop-recalc', 'focus', 'hide', 'open-client'].every(a => dropRow.actions.includes(a)), 'menu do drop tem editar traçado, recalcular, centralizar, ocultar e abrir cliente');
check(dropRow.hidden && dropRow.menuAfterHide && dropRow.shown, 'ocultar e mostrar o drop sem ocultar o cliente');
check(dropRow.removed, 'cliente sem drop não mostra a linha');

//Segurança: texto digitado e planos de fusão adulterados não executam código
const xss = await page.evaluate(async () => {
  window.__xss = 0;
  const evil = '<img src=x onerror="window.__xss++"><svg onload="window.__xss++"></svg><script>window.__xss++<\/script>';
  const row = createMaterialRow('ITEM', { materialName: 'Item ' + evil, category: 'Ferragem', quantity: 1, unitPrice: 1, type: 'un' });
  document.body.appendChild(row);
  const plan = JSON.stringify({
    elements: '<div class="cable-element" data-cable-name="C1"><div class="fiber-row" id="cable-C1-fiber-1" onclick="window.__xss++"></div></div>' + evil,
    svg: '<path class="fusion-line" data-start-id="cable-C1-fiber-1" data-end-id="x" onmouseover="window.__xss++"></path><image href="x" onerror="window.__xss++"/>',
  });
  const marker = { type: 'CEO', name: 'CEO ' + evil, fusionPlan: plan };
  summarizeFusionPlan(marker);
  getPlanCableFiberUsage(marker);
  const parsed = parseStoredHtml(JSON.parse(plan).elements);
  await new Promise(r => setTimeout(r, 400));
  row.remove();
  return {
    executed: window.__xss,
    textShown: row.textContent.includes('<img'),
    handlersLeft: parsed.querySelectorAll('[onclick], [onerror], script').length,
    fiberKept: !!parsed.querySelector('#cable-C1-fiber-1'),
  };
});
check(xss.executed === 0 && xss.handlersLeft === 0, `código embutido não executa (execuções: ${xss.executed}, atributos de evento restantes: ${xss.handlersLeft})`);
check(xss.textShown && xss.fiberKept, 'texto aparece como texto e o plano de fusão continua legível');

//Minha conta: todas as abas abrem sem estourar a largura do painel
for (const tab of ['profile', 'security', 'company', 'team', 'preferences']) {
  const info = await page.evaluate(t => {
    openAccountModal(t);
    const p = document.querySelector('#accountModal .account-panels');
    return { overflowX: p.scrollWidth - p.clientWidth, visible: !document.querySelector(`#accountModal [data-panel="${t}"]`).hidden };
  }, tab);
  check(info.visible && info.overflowX <= 1, `Minha conta › ${tab} abre sem estourar a largura`);
}

//Tema escuro: nenhuma janela com bloco de fundo claro
const lightBlocks = await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
  const lum = c => { const m = c.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?/); if (!m || (m[4] !== undefined && +m[4] < 0.5)) return null; return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255; };
  const found = [];
  document.querySelectorAll('.modal').forEach(modal => {
    const prev = modal.style.display; modal.style.display = 'flex';
    modal.querySelectorAll('*').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width * rect.height < 1500 || ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'IMG', 'CANVAS', 'svg'].includes(el.tagName)) return;
      if (el.closest('.mfa-qr, .report-preview-page, .rp-page')) return; //QR code e prévia do relatório (papel) são brancos de propósito
      const l = lum(getComputedStyle(el).backgroundColor);
      if (l !== null && l > 0.8) found.push(`${modal.id} › ${el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')}`);
    });
    modal.style.display = prev;
  });
  return found;
});
check(lightBlocks.length === 0, `tema escuro sem fundos claros nas janelas${lightBlocks.length ? ': ' + lightBlocks.slice(0, 5).join(', ') : ''}`);

const before = cspViolations.length;
const inlineRan = await page.evaluate(async () => {
  window.__inlineRan = false;
  const el = document.createElement('script');
  el.textContent = 'window.__inlineRan = true';
  document.body.appendChild(el);
  await new Promise(r => setTimeout(r, 200));
  return window.__inlineRan;
});
await page.waitForTimeout(200);
check(!inlineRan && cspViolations.length > before, 'CSP bloqueia script injetado na página');
cspViolations.splice(before);
check(cspViolations.length === 0, `política de segurança de conteúdo (CSP) sem bloqueios${cspViolations.length ? ': ' + cspViolations.slice(0, 3).join(' | ') : ''}`);

await browser.close();
server.close();
if (failures.length) { console.error(`\n${failures.length} verificação(ões) falharam.`); process.exit(1); }
console.log('\nTudo certo.');
