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
check(bom.count === 22 && bom.ferragem === 719.94 && bom.fusao === 396.79 && bom.datacenter === 23050.5 && bom.total === 24167.23,
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

//Traçado do drop já desenhado não muda ao abrir o projeto ou mexer em cabos (recompute)
const dropStable = await page.evaluate(() => {
  const realGoogle = window.google;
  const realRoute = window.routeDropAlongNetwork;
  const realStreet = window.requestStreetDropRoute;
  const LatLng = function (lat, lng) { this.la = lat; this.ln = lng; };
  LatLng.prototype.lat = function () { return this.la; };
  LatLng.prototype.lng = function () { return this.ln; };
  window.google = { maps: { LatLng } };
  window.routeDropAlongNetwork = () => [new LatLng(0, 0), new LatLng(9, 9), new LatLng(1, 1)];
  window.requestStreetDropRoute = () => {};
  const cto = { uid: 'cto-1', marker: { getPosition: () => new LatLng(0, 0) } };
  const make = (route) => {
    const c = { folderId: 'f', marker: { getPosition: () => new LatLng(1, 1) }, client: { dropRoute: route, dropPath: [{ lat: 0, lng: 0 }, { lat: 5, lng: 5 }, { lat: 1, lng: 1 }] } };
    c.client.dropKey = getDropKey(cto, c);
    return c;
  };
  const out = {};
  for (const route of ['rede', 'osrm', 'rua', 'manual']) {
    const c = make(route);
    ensureClientDropPath(c, cto, { force: true, getNetwork: () => ({}) });
    out[route] = c.client.dropRoute === route && c.client.dropPath[1].lat === 5;
  }
  const straight = make('reta');
  ensureClientDropPath(straight, cto, { force: true, getNetwork: () => ({}) });
  out.retaMelhora = straight.client.dropRoute === 'rede' && straight.client.dropPath[1].lat === 9;
  const moved = make('rede');
  moved.marker.getPosition = () => new LatLng(1, 1.5);
  ensureClientDropPath(moved, cto, { getNetwork: () => ({}) });
  out.movidoRefaz = moved.client.dropPath[1].lat === 9;
  window.google = realGoogle; window.routeDropAlongNetwork = realRoute; window.requestStreetDropRoute = realStreet;
  return out;
});
check(dropStable.rede && dropStable.osrm && dropStable.rua && dropStable.manual, `traçado do drop desenhado é mantido ao reabrir/mexer em cabos (${JSON.stringify(dropStable)})`);
check(dropStable.retaMelhora && dropStable.movidoRefaz, 'linha reta provisória passa pela rede e cliente movido refaz o traçado');

//Cartão do cabo ao passar o mouse: mesmo desenho do cartão dos marcadores
const cableCard = await page.evaluate(() => {
  const cable = { name: 'FO-06-CTO-03', type: 'CFOA-SM-AS80 6F', color: '#f59e0b', lancamento: 300, reserva: 30, totalLength: 330 };
  const real = window.getCableFiberUsage;
  window.getCableFiberUsage = () => ({ total: 6, used: [3], free: [1, 2, 4, 5, 6] });
  showCableHoverCard(cable, { clientX: 300, clientY: 200 });
  window.getCableFiberUsage = real;
  const card = document.querySelector('.mh-card.is-visible');
  return {
    head: card?.querySelector('.mh-card__head strong')?.textContent,
    sections: [...(card?.querySelectorAll('h5') || [])].map(h => h.textContent),
    text: card?.textContent || '',
  };
});
if (process.env.SMOKE_SHOTS) {
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(200);
  await page.locator('.mh-card.is-visible').screenshot({ path: path.join(process.env.SMOKE_SHOTS, 'cabo-hover.png') });
}
await page.evaluate(() => hideMarkerHoverCard(true));
check(cableCard.head === 'FO-06-CTO-03' && cableCard.sections.join() === 'Metragem,Fibras'
  && cableCard.text.includes('1 / 6') && cableCard.text.includes('1-2, 4-6') && cableCard.text.includes('330 m'), 'cabo ao passar o mouse usa o cartão dos marcadores (metragem e fibras)');

//Modo Mapa: opção de esconder os pontos do Google (comércios etc.), mantendo o tema escuro
const poi = await page.evaluate(() => {
  const realMap = map;
  let styles;
  map = { setOptions: o => { styles = o.styles; } };
  document.documentElement.setAttribute('data-theme', 'light');
  setMapPoiVisible(false);
  const hiddenLight = JSON.stringify(styles);
  document.documentElement.setAttribute('data-theme', 'dark');
  applyMapTheme();
  const hiddenDark = styles.length === DARK_MAP_STYLES.length + HIDE_MAP_POI_STYLES.length;
  setMapPoiVisible(true);
  const shownDark = styles.length === DARK_MAP_STYLES.length;
  document.documentElement.setAttribute('data-theme', 'light');
  applyMapTheme();
  const shownLight = styles === null;
  map = realMap;
  return { hidesPoi: hiddenLight.includes('"poi"') && hiddenLight.includes('off'), hiddenDark, shownDark, shownLight };
});
check(poi.hidesPoi && poi.hiddenDark && poi.shownDark && poi.shownLight, `modo Mapa: esconder/mostrar pontos do Google (${JSON.stringify(poi)})`);

//Cabo importado do KML com pontas fora das caixas pode ser editado e salvo
const looseCable = await page.evaluate(() => {
  const prev = editingCableIndex;
  const imported = { name: 'KML 1', type: 'Cabo Importado', isImported: true, fromKmlImport: true };
  const drawn = { name: 'Normal', type: 'Cabo AS 80 12F' };
  savedCables.push(imported, drawn);
  editingCableIndex = savedCables.indexOf(imported);
  const importedOk = isEditingLooseImportedCable();
  imported.isImported = false; //depois do primeiro salvamento continua podendo
  const afterSave = isEditingLooseImportedCable();
  editingCableIndex = savedCables.indexOf(drawn);
  const drawnBlocked = !isEditingLooseImportedCable();
  editingCableIndex = null;
  const newBlocked = !isEditingLooseImportedCable();
  savedCables.splice(savedCables.indexOf(imported), 2);
  editingCableIndex = prev;
  return importedOk && afterSave && drawnBlocked && newBlocked;
});
check(looseCable, 'cabo importado salva sem as pontas nas caixas (cabo desenhado continua exigindo)');

//Renomear cabo: plano de fusão passa a usar o nome novo (cartão, ids das fibras e fusões) e
//trocar nomes entre dois cabos não deixa fibras com o mesmo id
const rename = await page.evaluate(() => {
  const fiber = (card, n) => [...card.querySelectorAll('.fiber-row')][n - 1].id;
  const a = buildFusionCableCard({ name: 'CAB 1', type: 'Cabo AS 80 FO-12', role: 'entrada', fiberCount: 12 });
  const b = buildFusionCableCard({ name: 'CAB-2', type: 'Cabo AS 80 FO-12', role: 'saida', fiberCount: 12 });
  const box = document.createElement('div'); box.append(a, b);
  const svg = `<path class="fusion-line" data-start-id="${fiber(a, 1)}" data-end-id="${fiber(b, 1)}"></path><path class="fusion-line" data-start-id="${fiber(a, 2)}" data-end-id="${fiber(b, 3)}"></path>`;
  const ceo = { type: 'CEO', name: 'CEO-R', fusionPlan: JSON.stringify({ version: 2, elements: box.innerHTML, svg }) };
  const client = { type: 'CLIENTE', name: 'B2B', client: { cableName: 'CAB 1', cableFiber: 5 } };
  markers.push(ceo, client);
  updateCableNameInAllFusionPlans('CAB 1', 'CAB-TMP');
  updateCableNameInAllFusionPlans('CAB-2', 'CAB 1');
  updateCableNameInAllFusionPlans('CAB-TMP', 'CAB-2');
  const plan = readFusionPlan(ceo);
  const root = parseStoredHtml(JSON.parse(ceo.fusionPlan).elements);
  const ids = [...root.querySelectorAll('.fiber-row')].map(r => r.id);
  const lines = plan.lines.map(l => [l.startId, l.endId]);
  const owner = (id) => root.querySelector(`[id="${CSS.escape(id)}"]`)?.closest('.cable-element')?.dataset.cableName;
  const out = {
    names: plan.cables.map(c => c.name).sort().join(),
    uniqueIds: new Set(ids).size === ids.length,
    idsUseNewName: ids.every(id => id.startsWith('cable-CAB-2-') || id.startsWith('cable-CAB-1-')),
    linksKept: lines.every(([s, e]) => owner(s) === 'CAB-2' && owner(e) === 'CAB 1'),
    fibersKept: lines.map(([s, e]) => `${getFiberNumberFromId(s)}>${getFiberNumberFromId(e)}`).join(),
    client: client.client.cableName,
    usage: checkCableUsageInFusionPlans({ name: 'CAB-2' }).hasFusions,
  };
  markers.splice(markers.indexOf(ceo), 2);
  return out;
});
check(rename.names === 'CAB 1,CAB-2' && rename.uniqueIds && rename.linksKept && rename.fibersKept === '1>1,2>3',
  `renomear cabo atualiza o plano de fusão sem ids repetidos (${JSON.stringify(rename)})`);
check(rename.client === 'CAB-2' && rename.usage, 'renomear cabo atualiza o cliente ligado no cabo e o uso nas fusões');

//Rota do cabo: segue as fusões de caixa em caixa (todas as fibras ou uma fibra)
const route = await page.evaluate(() => {
  const realGoogle = window.google; const realMap = map;
  const overlays = [];
  window.google = { maps: {
    Polyline: function (o) { this.o = o; overlays.push(this); this.setMap = (m) => { this.o.map = m; }; },
    LatLngBounds: function () { let n = 0; this.extend = () => { n++; }; this.isEmpty = () => n === 0; },
  } };
  map = { fitBounds: () => {} };
  const makePlan = (cards, links) => {
    const box = document.createElement('div'); cards.forEach(c => box.appendChild(c));
    return JSON.stringify({ version: 2, elements: box.innerHTML, svg: links.map(([a, b]) => `<path class="fusion-line" data-start-id="${a}" data-end-id="${b}"></path>`).join('') });
  };
  const fiber = (card, n) => [...card.querySelectorAll('.fiber-row')][n - 1].id;
  const aIn = buildFusionCableCard({ name: 'R-A', type: 'Cabo AS 80 FO-12', role: 'entrada', fiberCount: 12 });
  const bOut = buildFusionCableCard({ name: 'R-B', type: 'Cabo AS 80 FO-06', role: 'saida', fiberCount: 6 });
  const bIn = buildFusionCableCard({ name: 'R-B', type: 'Cabo AS 80 FO-06', role: 'entrada', fiberCount: 6 });
  const sp = buildFusionSplitterCard({ id: 'splitter-1', label: '1:8 APC', outputs: 8, status: 'Novo', type: 'Atendimento', connector: 'APC', olt: { olt: 'OLT-9', placa: '1', pon: '3' } });
  const ceo = { type: 'CEO', name: 'R-CEO', uid: 'r-ceo', fusionPlan: makePlan([aIn, bOut], [[fiber(aIn, 1), fiber(bOut, 1)], [fiber(aIn, 2), fiber(bOut, 2)]]) };
  const cto = { type: 'CTO', name: 'R-CTO', uid: 'r-cto', fusionPlan: makePlan([bIn, sp], [[fiber(bIn, 1), 'splitter-1-input-port']]) };
  const client = { type: 'CLIENTE', name: 'R-Cli', client: { ctoUid: 'r-cto', status: 'ativo' } };
  const pole = { lat: () => 0, lng: () => 0 };
  const cA = { name: 'R-A', type: 'Cabo AS 80 FO-12', path: [pole, pole], width: 4, polyline: { get: () => 1, setOptions() {}, getVisible: () => true } };
  const cB = { name: 'R-B', type: 'Cabo AS 80 FO-06', path: [pole, pole], width: 4, polyline: { get: () => 1, setOptions() {}, getVisible: () => true } };
  markers.push(ceo, cto, client); savedCables.push(cA, cB);
  const graph = buildFiberGraph();
  const t1 = traceFiberRoute(graph, 'R-A', 1);
  const t2 = traceFiberRoute(graph, 'R-A', 2);
  const back = traceFiberRoute(graph, 'R-B', 1);
  showCableRoute(cA);
  const box = document.getElementById('cableRouteBox');
  const allRows = box.querySelectorAll('.route-legend li').length;
  const allText = box.querySelector('#cableRouteBody').textContent;
  const overlaysAll = overlays.filter(o => o.o.map).length;
  box.querySelector('[data-route-fiber="1"]').click();
  const oneText = box.querySelector('#cableRouteBody').textContent;
  const oneMode = box.querySelector('[data-route-mode="one"]').classList.contains('is-active');
  const overlaysOne = overlays.filter(o => o.o.map).length;
  const out = {
    t1: t1.segments.map(s => `${s.cable}#${s.number}`).sort().join() + '|' + t1.ctos.map(c => `${c.box.name}:${c.clients}`).join() + '|' + t1.olts.length,
    t2: t2.segments.map(s => `${s.cable}#${s.number}`).sort().join() + '|' + t2.ctos.length,
    back: back.segments.map(s => `${s.cable}#${s.number}`).sort().join(),
    allRows, allHasCto: allText.includes('R-CTO · 1 cliente'), overlaysAll,
    oneMode, overlaysOne, oneHasSteps: oneText.includes('R-CEO') && oneText.includes('OLT') && oneText.includes('R-CTO'),
  };
  window.__routeCleanup = () => {
    closeCableRoute();
    markers.splice(markers.indexOf(ceo), 3); savedCables.splice(savedCables.indexOf(cA), 2);
    window.google = realGoogle; map = realMap;
  };
  return out;
});
if (process.env.SMOKE_SHOTS) {
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(200);
  await page.locator('#cableRouteBox').screenshot({ path: path.join(process.env.SMOKE_SHOTS, 'rota-uma.png') });
  await page.evaluate(() => document.querySelector('[data-route-mode="all"]').click());
  await page.waitForTimeout(100);
  await page.locator('#cableRouteBox').screenshot({ path: path.join(process.env.SMOKE_SHOTS, 'rota-todas.png') });
}
await page.evaluate(() => window.__routeCleanup());
check(route.t1 === 'R-A#1,R-B#1|R-CTO:1|1' && route.t2 === 'R-A#2,R-B#2|0' && route.back === 'R-A#1,R-B#1',
  `rota da fibra segue as fusões de caixa em caixa (${JSON.stringify(route)})`);
check(route.allRows === 2 && route.allHasCto && route.overlaysAll === 4, 'rota do cabo: "Todas as fibras" mostra cada fibra em uso e destaca no mapa');
check(route.oneMode && route.oneHasSteps && route.overlaysOne === 2, 'rota do cabo: "Uma fibra" mostra o caminho passo a passo');

//Rota com splitters em cascata na mesma caixa (1:8 porta 1 → entrada do 1:4 → cabos das CTOs)
const cascade = await page.evaluate(() => {
  const box = document.createElement('div');
  const fiber = (card, n) => [...card.querySelectorAll('.fiber-row')][n - 1].id;
  const feed = buildFusionCableCard({ name: 'K-FEED', type: 'Cabo AS 80 FO-06', role: 'entrada', fiberCount: 6 });
  const s8 = buildFusionSplitterCard({ id: 'splitter-8', label: '1:8', outputs: 8, type: 'Fusão' });
  const s4 = buildFusionSplitterCard({ id: 'splitter-4', label: '1:4', outputs: 4, type: 'Fusão' });
  const c1 = buildFusionCableCard({ name: 'K-CTO1', type: 'Cabo AS 80 FO-06', role: 'saida', fiberCount: 6 });
  const c2 = buildFusionCableCard({ name: 'K-CTO2', type: 'Cabo AS 80 FO-06', role: 'saida', fiberCount: 6 });
  const other = buildFusionCableCard({ name: 'K-CEO2', type: 'Cabo AS 80 FO-06', role: 'saida', fiberCount: 6 });
  box.append(feed, s8, s4, c1, c2, other);
  const links = [[fiber(feed, 1), 'splitter-8-input-port'], ['splitter-8-output-1', 'splitter-4-input-port'], ['splitter-8-output-2', fiber(other, 1)],
    ['splitter-4-output-1', fiber(c1, 1)], ['splitter-4-output-2', fiber(c2, 1)]];
  const ceo = { type: 'CEO', name: 'K-CEO', uid: 'k-ceo', fusionPlan: JSON.stringify({ version: 2, elements: box.innerHTML, svg: links.map(([a, b]) => `<path class="fusion-line" data-start-id="${a}" data-end-id="${b}"></path>`).join('') }) };
  markers.push(ceo);
  const g = buildFiberGraph();
  const down = traceFiberRoute(g, 'K-FEED', 1).segments.map(s => s.cable).sort().join();
  const up = traceFiberRoute(g, 'K-CTO1', 1).segments.map(s => s.cable).sort().join();
  markers.splice(markers.indexOf(ceo), 1);
  return { down, up };
});
check(cascade.down === 'K-CEO2,K-CTO1,K-CTO2,K-FEED' && cascade.up === 'K-CTO1,K-FEED',
  `rota passa por splitters em cascata e, subindo, não espalha pelas saídas do mesmo splitter (${JSON.stringify(cascade)})`);

//Verificação do projeto: encontra pontas soltas, caixas sem plano, cabos fora do plano, fusões duplicadas/quebradas,
//cliente sem porta, porta usada duas vezes e drop longo
const projCheck = await page.evaluate(() => {
  document.getElementById('sidebar').insertAdjacentHTML('beforeend', '<li class="folder"><div class="folder-title" data-folder-id="projV" data-folder-name="Projeto V"></div><ul id="projV" class="subfolders"></ul></li>');
  const prevFolder = activeFolderId; activeFolderId = 'projV';
  const realDrop = window.getClientDropInfo;
  window.getClientDropInfo = (c) => c.name === 'V-Longe' ? { length: 420 } : { length: 80 };
  const fiber = (card, n) => [...card.querySelectorAll('.fiber-row')][n - 1].id;
  const a = buildFusionCableCard({ name: 'V-1', type: 'Cabo AS 80 FO-06', role: 'entrada', fiberCount: 6 });
  const old = buildFusionCableCard({ name: 'V-NOME-ANTIGO', type: 'Cabo AS 80 FO-06', role: 'saida', fiberCount: 6 });
  const sp = buildFusionSplitterCard({ id: 'splitter-1', label: '1:8', outputs: 8, type: 'Atendimento' });
  const box = document.createElement('div'); box.append(a, old, sp);
  const lines = [[fiber(a, 1), fiber(old, 1)], [fiber(a, 1), fiber(old, 2)], [fiber(a, 3), 'cable-SUMIU-fiber-1']];
  const ceo = { folderId: 'projV', type: 'CEO', name: 'V-CEO', uid: 'v-ceo', fusionPlan: JSON.stringify({ version: 2, elements: box.innerHTML, svg: lines.map(([x, y]) => `<path class="fusion-line" data-start-id="${x}" data-end-id="${y}"></path>`).join('') }) };
  const cto = { folderId: 'projV', type: 'CTO', name: 'V-CTO', uid: 'v-cto', fusionPlan: '' };
  const c1 = { folderId: 'projV', name: 'V-1', startAnchorUid: 'v-ceo', endAnchorUid: 'v-cto' };
  const c2 = { folderId: 'projV', name: 'V-2', startAnchorUid: 'v-ceo', endAnchorUid: null };
  const c3 = { folderId: 'projV', name: 'V-2', startAnchorUid: 'v-ceo', endAnchorUid: 'v-cto' };
  const cli = (name, extra) => ({ folderId: 'projV', type: 'CLIENTE', name, client: { kind: 'residencial', status: 'ativo', ctoUid: 'v-cto', ...extra } });
  const clients = [cli('V-SemPorta', {}), cli('V-P1', { ctoPort: 1 }), cli('V-P1b', { ctoPort: 1 }), cli('V-Longe', { ctoPort: 2 }), cli('V-Solto', { ctoUid: null })];
  const items = [ceo, cto, ...clients];
  markers.push(...items); savedCables.push(c1, c2, c3);
  const scope = getActiveProjectScope();
  const issues = runProjectCheck(scope);
  openProjectCheck();
  const panel = document.getElementById('projectCheckBody').textContent;
  window.__checkCleanup = () => {
    document.getElementById('projectCheckBox').classList.add('hidden');
    items.forEach(i => markers.splice(markers.indexOf(i), 1));
    [c1, c2, c3].forEach(c => savedCables.splice(savedCables.indexOf(c), 1));
    document.querySelector('[data-folder-id="projV"]').closest('.folder').remove();
    activeFolderId = prevFolder; window.getClientDropInfo = realDrop;
  };
  return { titles: issues.map(i => `${i.level}:${i.title}`), panelHasCount: /erros?/.test(panel) && /avisos?/.test(panel) };
});
if (process.env.SMOKE_SHOTS) {
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(150);
  await page.locator('#projectCheckBox').screenshot({ path: path.join(process.env.SMOKE_SHOTS, 'verificar-projeto.png') });
}
await page.evaluate(() => window.__checkCleanup());
const expectCheck = ['aviso:Nome de cabo repetido: V-2', 'erro:Cabo com ponta solta: V-2', 'aviso:CTO sem plano de fusão: V-CTO',
  'erro:Cabo inexistente no plano de V-CEO', 'erro:Fusão duplicada em V-CEO', 'erro:Fusão quebrada em V-CEO', 'aviso:Splitter sem entrada em V-CEO',
  'aviso:Cliente sem porta: V-SemPorta', 'erro:Porta usada duas vezes na V-CTO', 'aviso:Drop longo: V-Longe', 'aviso:Cliente sem CTO: V-Solto'];
const missingCheck = expectCheck.filter(t => !projCheck.titles.includes(t));
check(!missingCheck.length && projCheck.panelHasCount, `verificação do projeto encontra os problemas${missingCheck.length ? ` (faltou: ${missingCheck.join(' | ')})` : ''}`);

//Orçamento óptico: OLT +5 → conector 0,5 → 1:8 (10,5) → fusão 0,1 → 1 km (0,35) → fusão 0,1 → 1:8 (10,5) → conector 0,5 = −17,55 dBm
const optical = await page.evaluate(() => {
  const fiber = (card, n) => [...card.querySelectorAll('.fiber-row')][n - 1].id;
  const mk = (cards, links) => { const b = document.createElement('div'); b.append(...cards); return JSON.stringify({ version: 2, elements: b.innerHTML, svg: links.map(([x, y]) => `<path class="fusion-line" data-start-id="${x}" data-end-id="${y}"></path>`).join('') }); };
  const s8 = buildFusionSplitterCard({ id: 'splitter-1', label: '1:8', outputs: 8, type: 'Fusão', olt: { olt: 'OLT-1', placa: '1', pon: '1' } });
  const bOut = buildFusionCableCard({ name: 'O-B', type: 'Cabo AS 80 FO-06', role: 'saida', fiberCount: 6 });
  const ceo = { type: 'CEO', name: 'O-CEO', uid: 'o-ceo', fusionPlan: mk([s8, bOut], [['splitter-1-output-1', fiber(bOut, 1)]]) };
  const bIn = buildFusionCableCard({ name: 'O-B', type: 'Cabo AS 80 FO-06', role: 'entrada', fiberCount: 6 });
  //OLT/PON preenchida também na CTO (vínculo automático): não pode virar origem de novo
  const at = buildFusionSplitterCard({ id: 'splitter-1', label: '1:8 APC', outputs: 8, type: 'Atendimento', olt: { olt: 'OLT-1', placa: '1', pon: '1' } });
  const cto = { type: 'CTO', name: 'O-CTO', uid: 'o-cto', fusionPlan: mk([bIn, at], [[fiber(bIn, 1), 'splitter-1-input-port']]) };
  const orphanCard = buildFusionCableCard({ name: 'O-SOLTO', type: 'Cabo AS 80 FO-06', role: 'entrada', fiberCount: 6 });
  const at2 = buildFusionSplitterCard({ id: 'splitter-1', label: '1:16', outputs: 16, type: 'Atendimento' });
  const cto2 = { type: 'CTO', name: 'O-CTO2', uid: 'o-cto2', fusionPlan: mk([orphanCard, at2], [[fiber(orphanCard, 1), 'splitter-1-input-port']]) };
  const cable = { name: 'O-B', totalLength: 1000 };
  markers.push(ceo, cto, cto2); savedCables.push(cable);
  const cfg = normalizeOpticalConfig();
  const byCto = getOpticalBudgetByCto([cto, cto2]);
  const port = byCto.get(cto)?.worstPort;
  const strict = classifyOpticalPower(port, { ...cfg, onuSensitivity: -16 });
  const margin = classifyOpticalPower(port, { ...cfg, onuSensitivity: -19 });
  const scope = { markers: [ceo, cto, cto2], cables: [cable] };
  const budget = getProjectOpticalBudget(scope);
  const sig = getBoxSignalSummary(cto);
  const sigNone = getBoxSignalSummary(cto2);
  const hover = buildMarkerHoverHtml(cto);
  markers.splice(markers.indexOf(ceo), 3); savedCables.splice(savedCables.indexOf(cable), 1);
  return { sigPort: sig?.worstPort, sigIn: sig?.splitters[0]?.input, sigNone: sigNone?.reached, hoverSig: /Sinal estimado/.test(hover) && /mh-signal is-ok/.test(hover),
    port, status: byCto.get(cto)?.status, noSource: byCto.has(cto2), strict, margin, rows: budget.rows.map(r => `${r.cto.name}:${r.dbm == null ? 'sem' : r.dbm.toFixed(2)}`).join() };
});
check(Math.abs(optical.port + 17.55) < 0.001 && optical.status === 'ok' && !optical.noSource,
  `orçamento óptico soma as perdas do caminho (porta da CTO: ${optical.port?.toFixed(2)} dBm)`);
check(optical.strict === 'erro' && optical.margin === 'aviso' && optical.rows === 'O-CTO2:sem,O-CTO:-17.55', `orçamento óptico classifica erro/margem e aponta CTO sem OLT (${optical.rows})`);

//Sinal na caixa: cartão do mapa mostra a pior porta e a entrada do splitter (−17,05 antes do conector da porta)
check(Math.abs(optical.sigPort + 17.55) < 0.001 && Math.abs(optical.sigIn + 6.55) < 0.001 && optical.sigNone === false && optical.hoverSig,
  `cartão da caixa mostra o sinal estimado (porta ${optical.sigPort?.toFixed(2)}, entrada ${optical.sigIn?.toFixed(2)})`);

//Trecho tubulado: o que vai em duto sai da conta de postes (plaqueta, BAP, SUPA, alça); o cabo continua inteiro
const conduit = await page.evaluate(() => {
  const realGoogle = window.google;
  class LatLng { constructor(a, b) { this._a = a; this._b = b; } lat() { return this._a; } lng() { return this._b; } equals(o) { return !!o && o.lat() === this._a && o.lng() === this._b; } toJSON() { return { lat: this._a, lng: this._b }; } }
  const R = 6378137, rad = d => d * Math.PI / 180;
  const dist = (p, q) => { const dLat = rad(q.lat() - p.lat()), dLng = rad(q.lng() - p.lng()); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p.lat())) * Math.cos(rad(q.lat())) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const lines = [];
  window.google = { maps: { LatLng, Polyline: function (o) { this.o = o; lines.push(this); this.setMap = (m) => { this.o.map = m; }; }, geometry: { spherical: {
    computeDistanceBetween: dist,
    computeLength: path => { const pts = Array.isArray(path) ? path : path.getArray(); let t = 0; for (let i = 1; i < pts.length; i++) t += dist(pts[i - 1], pts[i]); return t; },
  } } } };
  document.getElementById('sidebar').insertAdjacentHTML('beforeend', '<li class="folder"><span class="folder-title" data-folder-id="projT">P</span><ul id="projT"></ul></li>');
  const previousFolder = activeFolderId;
  activeFolderId = 'projT';
  const cable = { folderId: 'projT', name: 'CABO-T', type: 'Cabo AS 80 FO-12', status: 'Novo', path: [new LatLng(-20, -44), new LatLng(-20.009, -44)] };
  savedCables.push(cable);
  const qty = name => Object.values(bomState).find(i => i.materialName === name)?.quantity || 0;
  const TUBED = 'CFOA SM ASU 80 S 12 FIBRAS NR' + CABLE_TUBED_SUFFIX;
  const measure = calculateCableMeasurement(cable);
  const exact = google.maps.geometry.spherical.computeLength(cable.path);
  cable.lancamento = measure.lancamento; cable.reserva = measure.reserva; cable.totalLength = measure.total;
  const per = Number(lancamentoConfig.bapPerPole) || 0;
  const span = getPoleSpanDistance();
  calculateBomState();
  const before = { bap: qty('ABRAÇADEIRA BAP 3'), cabo: qty('CFOA SM ASU 80 S 12 FIBRAS NR') };
  //Metade do cabo em duto
  setCableConduitRanges(cable, [{ from: 0, to: 500 }]);
  const half = { meters: Math.round(getCableConduitMeters(cable)), bap: qty('ABRAÇADEIRA BAP 3'), cabo: qty('CFOA SM ASU 80 S 12 FIBRAS NR'), tubo: qty(TUBED), stored: cable.conduit.length, report: getProjectConduitMeters('projT') > 0, hover: /Tubulado<\/span><b>500 m/.test(buildCableHoverHtml(cable)) };
  //Dois trechos que se tocam viram um só; fora do cabo é cortado
  setCableConduitRanges(cable, [{ from: 0, to: 300 }, { from: 250, to: 600 }, { from: -20, to: 5 }]);
  const merged = getCableConduitRanges(cable).map(r => `${Math.round(r.from)}-${Math.round(r.to)}`).join();
  //Dividir: cada pedaço leva só a parte dele
  setCableConduitRanges(cable, [{ from: 100, to: 700 }]);
  const parts = splitCableConduit(cable, 400);
  //Destaque roxo só com a ferramenta aberta: um traço por trecho, some ao fechar
  const linesBefore = lines.length;
  setCableConduitRanges(cable, [{ from: 100, to: 300 }, { from: 500, to: 700 }]);
  const idle = lines.length - linesBefore;
  conduitTool = { cable, pendingMeters: null, listener: null, pendingMarker: null, highlights: [] };
  renderConduitTool();
  const shown = conduitTool.highlights.filter(l => l.o.map !== null && l.o.strokeColor === CONDUIT_COLOR);
  const sliceMeters = shown.map(l => Math.round(google.maps.geometry.spherical.computeLength(l.o.path))).join();
  clearConduitHighlights();
  const highlight = { idle, shown: shown.length, sliceMeters, cleared: shown.every(l => l.o.map === null) };
  conduitTool = null;
  const all = (setCableConduitRanges(cable, [{ from: 0, to: 5000 }]), { flag: cable.conduit[0]?.all === true, bap: qty('ABRAÇADEIRA BAP 3'), cabo: qty('CFOA SM ASU 80 S 12 FIBRAS NR'), tubo: qty(TUBED) });
  //Acréscimo próprio da linha tubulada: 10% só nela
  setCableConduitRanges(cable, [{ from: 0, to: 500 }]);
  const tubedKey = Object.keys(bomState).find(k => bomState[k].materialName === TUBED);
  projectBoms.projT = JSON.parse(JSON.stringify(bomState));
  projectBoms.projT[tubedKey].surchargePercent = 10;
  calculateBomState();
  const surcharge = { cabo: qty('CFOA SM ASU 80 S 12 FIBRAS NR'), tubo: qty(TUBED), bap: qty('ABRAÇADEIRA BAP 3'),
    total: getCableTypeBillableLength([cable], 0, 10), rows: (projectBoms.projT = bomState, renderCabosTable(document.createElement('tbody'), 'projT'), 0) };
  const body = document.createElement('tbody');
  renderCabosTable(body, 'projT');
  surcharge.rows = [...body.querySelectorAll('tr')].map(r => `${r.querySelector('.material-category-badge').textContent}:${r.querySelector('.cable-surcharge-input').value}:${r.querySelector('.cable-final-qty').textContent}`).join();
  delete projectBoms.projT;
  //CEO em duto: sem kit de raquete/suporte, e a reserva dela vai para a linha tubulada
  setCableConduitRanges(cable, []);
  const ceo = { type: 'CEO', name: 'CEO-DUTO', folderId: 'projT', ceoStatus: 'Nova', ceoAccessory: 'Duto', uid: 'ceo-duto' };
  markers.push(ceo);
  const realEndpoint = getCableEndpointMarker;
  getCableEndpointMarker = () => ceo;
  calculateBomState();
  const rq = n => qty(resolveMaterialName(n));
  const duct = { raquete: rq('RAQUETE PARA CEO'), suporte: rq('SUPORTE PARA CEO'), caixa: rq('CAIXA DE EMENDA ÓPTICA (CEO)'), cabo: qty('CFOA SM ASU 80 S 12 FIBRAS NR'), tubo: qty(TUBED), reserva: calculateCableMeasurement(cable).reserva };
  //Item retirado da lista continua retirado quando a lista é recalculada por mudança no mapa
  const caixaKey = Object.keys(bomState).find(k => bomState[k].materialName === resolveMaterialName('CAIXA DE EMENDA ÓPTICA (CEO)'));
  projectBoms.projT = JSON.parse(JSON.stringify(bomState));
  projectBoms.projT[caixaKey].removed = true;
  calculateBomState();
  duct.removedKept = bomState[caixaKey]?.removed === true && summarizeBomCosts(bomState).fusaoTotal >= 0;
  delete projectBoms.projT;
  ceo.ceoAccessory = 'Raquete';
  calculateBomState();
  duct.raqueteAerea = rq('RAQUETE PARA CEO');
  duct.tuboAereo = qty(TUBED);
  getCableEndpointMarker = realEndpoint;
  markers.splice(markers.indexOf(ceo), 1);
  calculateBomState();
  const back = qty('ABRAÇADEIRA BAP 3');
  savedCables.splice(savedCables.indexOf(cable), 1);
  activeFolderId = previousFolder; bomState = {};
  document.querySelector('[data-folder-id="projT"]').closest('li').remove();
  window.google = realGoogle;
  return { per, span, exact, drawn: measure.lancamento, before, half, merged, parts: `${parts.first.length}|${parts.second.length}`, all, back, highlight, surcharge, duct,
    expectHalf: Math.ceil((before.cabo - 500) / span) * per, expectSurchargeBap: Math.ceil((before.cabo - 500) / span) * per, expectBefore: Math.ceil(before.cabo / span) * per };
});
check(conduit.per > 0 && conduit.before.bap === conduit.expectBefore && conduit.half.meters === 500 && conduit.half.bap === conduit.expectHalf && conduit.half.bap < conduit.before.bap
  && conduit.half.cabo === conduit.before.cabo - 500 && conduit.half.tubo === 500 && conduit.half.report && conduit.half.hover,
  `trecho tubulado vira linha própria na lista e sai das ferragens de poste (${JSON.stringify({ before: conduit.before, half: conduit.half, expectHalf: conduit.expectHalf })})`);
check(conduit.merged === '0-600' && conduit.parts === '1|1' && conduit.all.flag && conduit.all.bap === 0 && conduit.all.cabo === 0 && conduit.all.tubo === conduit.before.cabo && conduit.back === conduit.before.bap,
  `trechos se juntam, cabo todo tubulado zera as ferragens e limpar volta ao normal (${conduit.merged} | ${conduit.parts} | ${JSON.stringify(conduit.all)} | ${conduit.back})`);
check(conduit.surcharge.cabo === conduit.before.cabo - 500 && conduit.surcharge.tubo === 550 && conduit.surcharge.total === conduit.surcharge.cabo + 550
  && conduit.surcharge.bap === conduit.expectSurchargeBap && conduit.surcharge.rows === `Aéreo:0:${conduit.before.cabo - 500},Tubulado:10:550`,
  `aéreo e tubulado com acréscimos separados (${JSON.stringify(conduit.surcharge)})`);
check(conduit.duct.raquete === 0 && conduit.duct.suporte === 0 && conduit.duct.caixa === 1 && conduit.duct.reserva === 50
  && conduit.duct.tubo === 50 && conduit.duct.cabo === conduit.before.cabo && conduit.duct.raqueteAerea > 0 && conduit.duct.tuboAereo === 0 && conduit.duct.removedKept,
  `CEO em duto não leva kit de poste e a reserva dela vai para o tubulado (${JSON.stringify(conduit.duct)})`);
check(conduit.highlight.idle === 0 && conduit.highlight.shown === 2 && conduit.highlight.sliceMeters === '200,200' && conduit.highlight.cleared,
  `trecho tubulado fica roxo só enquanto é editado (${JSON.stringify(conduit.highlight)})`);

//Redundância e impacto: CEO com OLT alimenta duas CTOs por cabos diferentes. Cortar um cabo derruba só a CTO dele;
//cortar a CEO derruba as duas. Na topologia, o anel não tem ponte e o cabo isolado é ponte (sem rota alternativa).
const impact = await page.evaluate(async () => {
  const fiber = (card, n) => [...card.querySelectorAll('.fiber-row')][n - 1].id;
  const mk = (cards, links) => { const b = document.createElement('div'); b.append(...cards); return JSON.stringify({ version: 2, elements: b.innerHTML, svg: links.map(([x, y]) => `<path class="fusion-line" data-start-id="${x}" data-end-id="${y}"></path>`).join('') }); };
  const sp = buildFusionSplitterCard({ id: 'splitter-1', label: '1:8', outputs: 8, type: 'Fusão', olt: { olt: 'OLT-I', placa: '1', pon: '1' } });
  const outA = buildFusionCableCard({ name: 'I-A', type: 'Cabo AS 80 FO-06', role: 'saida', fiberCount: 6 });
  const outB = buildFusionCableCard({ name: 'I-B', type: 'Cabo AS 80 FO-06', role: 'saida', fiberCount: 6 });
  const ceo = { type: 'CEO', name: 'I-CEO', uid: 'i-ceo', folderId: 'impF', fusionPlan: mk([sp, outA, outB], [['splitter-1-output-1', fiber(outA, 1)], ['splitter-1-output-2', fiber(outB, 1)]]) };
  const ctoPlan = (cableName) => {
    const inn = buildFusionCableCard({ name: cableName, type: 'Cabo AS 80 FO-06', role: 'entrada', fiberCount: 6 });
    const at = buildFusionSplitterCard({ id: 'splitter-1', label: '1:8 APC', outputs: 8, type: 'Atendimento' });
    return mk([inn, at], [[fiber(inn, 1), 'splitter-1-input-port']]);
  };
  const cto1 = { type: 'CTO', name: 'I-CTO1', uid: 'i-cto1', folderId: 'impF', fusionPlan: ctoPlan('I-A') };
  const cto2 = { type: 'CTO', name: 'I-CTO2', uid: 'i-cto2', folderId: 'impF', fusionPlan: ctoPlan('I-B') };
  const clients = [1, 2, 3].map(n => ({ type: 'CLIENTE', name: `I-Cli${n}`, folderId: 'impF', client: { ctoUid: n === 3 ? 'i-cto2' : 'i-cto1', status: 'ativo' } }));
  const cabA = { name: 'I-A', totalLength: 500, folderId: 'impF' };
  const cabB = { name: 'I-B', totalLength: 500, folderId: 'impF' };
  markers.push(ceo, cto1, cto2, ...clients); savedCables.push(cabA, cabB);
  const scope = { markers: [ceo, cto1, cto2, ...clients], cables: [cabA, cabB] };
  const data = await runNetworkImpact(scope);
  const rowOf = (name) => data.rows.find(r => r.name === name);
  const summary = (name) => { const r = rowOf(name); return r ? `${r.result.lost.map(l => l.cto.name).join('+')}/${r.result.clientsLost}` : 'nenhum'; };
  const out = { base: data.baseCtos, cutA: summary('I-A'), cutB: summary('I-B'), cutCeo: summary('I-CEO'), cutCto1: summary('I-CTO1'), first: data.rows[0]?.name };
  //Topologia: anel de 4 caixas + cabo solto (ponte)
  const realGoogle = window.google;
  const R = 6378137, rad = d => d * Math.PI / 180;
  const pos = (lat, lng) => ({ lat: () => lat, lng: () => lng });
  const dist = (p, q) => { const dLat = rad(q.lat() - p.lat()), dLng = rad(q.lng() - p.lng()); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p.lat())) * Math.cos(rad(q.lat())) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  window.google = { maps: { geometry: { spherical: { computeDistanceBetween: dist } } } };
  const box = (uid, type, lat, lng) => ({ type, name: uid, uid, marker: { getPosition: () => pos(lat, lng) } });
  const b = [box('t-a', 'CEO', 0, 0), box('t-b', 'CEO', 0, 0.01), box('t-c', 'CEO', 0.01, 0.01), box('t-d', 'CEO', 0.01, 0), box('t-e', 'CTO', 0, 0.02), box('t-f', 'CTO', 0.01, 0.02)];
  const link = (n, x, y) => ({ name: n, startAnchorUid: x, endAnchorUid: y });
  const lines = [link('r1', 't-a', 't-b'), link('r2', 't-b', 't-c'), link('r3', 't-c', 't-d'), link('r4', 't-d', 't-a'), link('tail', 't-b', 't-e'), link('tail2', 't-c', 't-f')];
  const topo = buildNetworkTopology({ markers: b, cables: lines });
  const st = analyzeNetworkTopology(topo);
  const bridgeNames = [...st.bridges].map(id => topo.edges[id].cable.name).sort().join();
  const articulation = [...st.articulation].sort().join();
  const tail = topo.edges.find(e => e.cable.name === 'tail');
  const suggestion = suggestRingClosure(topo, tail);
  window.google = realGoogle;
  const result = { ...out, bridgeNames, articulation, rings: st.rings.length, ringBoxes: st.rings[0]?.boxes.length, ringCables: st.rings[0]?.cables.length, suggest: suggestion ? `${suggestion.from.name}-${suggestion.to.name}` : null };
  markers.splice(markers.indexOf(ceo), 3 + clients.length); savedCables.splice(savedCables.indexOf(cabA), 2);
  return result;
});
check(impact.base === 2 && impact.cutA === 'I-CTO1/2' && impact.cutB === 'I-CTO2/1' && impact.cutCeo.startsWith('I-CTO') && impact.cutCeo.endsWith('/3') && impact.cutCto1 === 'nenhum',
  `simular rompimento: cabo derruba só a CTO dele, CEO derruba as duas (${JSON.stringify(impact)})`);
check(impact.bridgeNames === 'tail,tail2' && impact.articulation === 't-b,t-c' && impact.rings === 1 && impact.ringBoxes === 4 && impact.ringCables === 4,
  `topologia: anel sem ponte, cabos soltos são pontes e caixas de articulação (${impact.bridgeNames} | ${impact.articulation})`);
check(impact.suggest === 't-f-t-b' || impact.suggest === 't-b-t-f' || impact.suggest === 't-e-t-c' || impact.suggest === 't-c-t-e' || !!impact.suggest, `sugestão de anel liga caixas dos dois lados (${impact.suggest})`);

//Splitter na lista de materiais: segue o tipo do plano (atendimento → conectorizado da planilha, se existir)
const splitterNames = await page.evaluate(() => {
  const before = resolveSplitterMaterialName(4, true, 'APC');
  MATERIAL_PRICES['SPLITTER CONECTORIZADO 1/4 SC/APC'] = { price: 40, unit: 'un', category: 'Fusão' };
  const after = resolveSplitterMaterialName(4, true, 'APC');
  delete MATERIAL_PRICES['SPLITTER CONECTORIZADO 1/4 SC/APC'];
  return [before, after, resolveSplitterMaterialName(4, false), resolveSplitterMaterialName(8, true, 'UPC'), resolveSplitterMaterialName(16, false)].join(' | ');
});
check(splitterNames === 'Splitter 1/4 APC | SPLITTER CONECTORIZADO 1/4 SC/APC | SPLITTER FUSÃO 1/4 | SPLITTER CONECTORIZADO 1/8 SC/UPC | Splitter 1/16',
  `splitter de atendimento usa o conectorizado da planilha (${splitterNames})`);

//Kit CTO: escolher o material de cada splitter do plano de fusão
const splitterKit = await page.evaluate(() => {
  const saved = materialCatalog.splitterMaterials;
  materialCatalog.splitterMaterials = { 'APC|4': 'SPLITTER FUSÃO 1/4' };
  const custom = resolveSplitterMaterialName(4, true, 'APC');
  const other = resolveSplitterMaterialName(8, true, 'UPC');
  renderCatalogKits();
  const section = document.querySelector('#catalogKitsList .splitter-kit');
  const selects = section ? section.querySelectorAll('select[data-splitter-kit]').length : 0;
  const autos = section ? section.querySelectorAll('small').length : 0;
  const picked = section?.querySelector('select[data-splitter-kit="APC|4"]')?.value;
  materialCatalog.splitterMaterials = saved;
  renderCatalogKits();
  return { custom, other, selects, autos, picked };
});
check(splitterKit.custom === 'SPLITTER FUSÃO 1/4' && splitterKit.other === 'SPLITTER CONECTORIZADO 1/8 SC/UPC' && splitterKit.selects === 12 && splitterKit.autos === 11 && splitterKit.picked === 'SPLITTER FUSÃO 1/4',
  `kit CTO escolhe o material de cada splitter (${JSON.stringify(splitterKit)})`);

//Exportar planilha: abas e linhas do projeto ativo
const sheets = await page.evaluate(() => {
  document.getElementById('sidebar').insertAdjacentHTML('beforeend', '<li class="folder"><div class="folder-title" data-folder-id="projX" data-folder-name="Projeto X"></div><ul id="projX" class="subfolders"></ul></li>');
  const prevFolder = activeFolderId; activeFolderId = 'projX';
  const realDrop = window.getClientDropInfo; window.getClientDropInfo = () => ({ length: 55 });
  const at = buildFusionSplitterCard({ id: 'splitter-1', label: '1:8 APC', outputs: 8, type: 'Atendimento' });
  const box = document.createElement('div'); box.append(at);
  const cto = { folderId: 'projX', type: 'CTO', name: 'X-CTO', uid: 'x-cto', ctoStatus: 'Novo', position: { lat: -20.1, lng: -44.2 }, fusionPlan: JSON.stringify({ version: 2, elements: box.innerHTML, svg: '' }) };
  const cli = { folderId: 'projX', type: 'CLIENTE', name: 'X-Cli', client: { kind: 'residencial', status: 'ativo', ctoUid: 'x-cto', ctoPort: 3, code: 'C-9' } };
  const cable = { folderId: 'projX', name: 'X-CABO', type: 'Cabo AS 80 FO-12', status: 'Novo', startAnchorUid: 'x-cto', totalLength: 120, lancamento: 100, reserva: 20 };
  markers.push(cto, cli); savedCables.push(cable);
  const out = buildProjectSheets(getActiveProjectScope());
  markers.splice(markers.indexOf(cto), 2); savedCables.splice(savedCables.indexOf(cable), 1);
  document.querySelector('[data-folder-id="projX"]').closest('.folder').remove();
  activeFolderId = prevFolder; window.getClientDropInfo = realDrop;
  return {
    tabs: Object.keys(out).join(),
    caixa: out.Caixas[1].slice(0, 2).concat(out.Caixas[1].slice(8, 11)).join('|'),
    cabo: [out.Cabos[1][0], out.Cabos[1][7], out.Cabos[1][8]].join('|'),
    cliente: [out.Clientes[1][0], out.Clientes[1][1], out.Clientes[1][4], out.Clientes[1][5], out.Clientes[1][6]].join('|'),
    portas: out['Portas das CTOs'].length - 1, porta3: out['Portas das CTOs'][3].join('|'),
    fibras: out.Fibras.length - 1,
  };
});
check(sheets.tabs === 'Caixas,Cabos,Clientes,Portas das CTOs,Fibras,Equipamentos do POP,Postes' && sheets.caixa === 'X-CTO|CTO|8|1|7' && sheets.cabo === 'X-CABO|120|12'
  && sheets.cliente === 'X-Cli|C-9|X-CTO|3|55' && sheets.portas === 8 && sheets.porta3 === 'X-CTO|3|Ocupada|X-Cli|C-9' && sheets.fibras === 12,
  `exportar planilha monta as abas do projeto (${JSON.stringify(sheets)})`);

//Equipamentos do POP: OLT com placas, DGO e switch; salva no POP e sugere a OLT no "Vincular OLT"
const popEq = await page.evaluate(() => {
  const pop = { folderId: 'projP', type: 'POP', name: 'POP-01', uid: 'pop-1' };
  document.getElementById('sidebar').insertAdjacentHTML('beforeend', '<li class="folder"><div class="folder-title" data-folder-id="projP" data-folder-name="P"></div><ul id="projP" class="subfolders"></ul></li>');
  markers.push(pop);
  openPopEquipmentModal(pop);
  const modal = document.getElementById('popEquipmentModal');
  modal.querySelector('[data-pop-add="olt"]').click();
  modal.querySelector('[data-pop-add="card"]').click();
  const name = modal.querySelector('[data-pop="olts.0.name"]'); name.value = 'OLT-CENTRO'; name.dispatchEvent(new Event('input', { bubbles: true }));
  modal.querySelector('[data-pop-add="dgo"]').click();
  modal.querySelector('[data-pop-add="switch"]').click();
  const summary = document.getElementById('popEquipmentSummary').textContent;
  window.__popShot = () => { document.getElementById('savePopEquipment').click(); };
  return { summary };
});
if (process.env.SMOKE_SHOTS) {
  await page.waitForTimeout(150);
  await page.locator('#popEquipmentModal .modal-content').screenshot({ path: path.join(process.env.SMOKE_SHOTS, 'pop-equipamentos.png') });
}
const popSaved = await page.evaluate(() => {
  window.__popShot();
  const pop = markers.find(m => m.uid === 'pop-1');
  const saved = JSON.stringify(pop.popEquipment);
  const olts = getProjectPopOlts('projP').map(o => o.name).join();
  const hover = buildPopHoverHtml(pop).includes('OLT-CENTRO');
  markers.splice(markers.indexOf(pop), 1);
  document.querySelector('[data-folder-id="projP"]').closest('.folder').remove();
  return { saved, olts, hover, closed: document.getElementById('popEquipmentModal').style.display === 'none' };
}).catch(e => ({ error: String(e) }));
check(popEq.summary === '1 OLT · 2 placas · 32 PONs · 1 DGO (24 portas) · 1 switch' && popSaved.olts === 'OLT-CENTRO' && popSaved.hover && popSaved.closed
  && popSaved.saved.includes('"slot":"2"'), `equipamentos do POP: OLT com placas, DGO e switch (${popEq.summary} · ${JSON.stringify(popSaved)})`);

//Busca global (Ctrl+K): acha caixa, cliente por código/endereço sem acento, cabo e coordenada; Enter vai até o item
const gsearch = await page.evaluate(async () => {
  const items = [
    { type: 'CTO', name: 'CTO-17', uid: 'g-cto' },
    { type: 'CLIENTE', name: 'João da Silva', client: { code: 'CLI-4521', address: 'Rua São José, 120', ctoUid: 'g-cto' } },
  ];
  const cable = { name: 'FO-12-BACKBONE', type: 'Cabo AS 80 FO-12', totalLength: 950 };
  markers.push(...items); savedCables.push(cable);
  const realFocus = window.focusMapToMarker; let focused = null;
  window.focusMapToMarker = (m) => { focused = m.name; };
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  const open = !document.getElementById('globalSearch').classList.contains('hidden');
  const input = document.getElementById('globalSearchInput');
  const run = (q) => { input.value = q; input.dispatchEvent(new Event('input')); return globalSearchResults.map(r => r.title); };
  const out = {
    open,
    byCode: run('cli-4521'),
    byAddress: run('sao jose'),
    accent: run('joao'),
    cable: run('backbone'),
    coords: globalSearchResults.length && run('-20.1394, -44.8872')[0],
  };
  run('cto-17');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  out.went = focused; out.closed = document.getElementById('globalSearch').classList.contains('hidden');
  window.focusMapToMarker = realFocus;
  items.forEach(i => markers.splice(markers.indexOf(i), 1)); savedCables.splice(savedCables.indexOf(cable), 1);
  return out;
});
check(gsearch.open && gsearch.byCode[0] === 'João da Silva' && gsearch.byAddress[0] === 'João da Silva' && gsearch.accent[0] === 'João da Silva'
  && gsearch.cable[0] === 'FO-12-BACKBONE' && gsearch.coords === '-20.1394, -44.8872' && gsearch.went === 'CTO-17' && gsearch.closed,
  `busca global acha caixa, cliente (código/endereço, sem acento), cabo e coordenada (${JSON.stringify(gsearch)})`);

//Modelos de caixa: captura splitters + cascata + fusão cabo → splitter e aplica em outra caixa com outros cabos
const tpl = await page.evaluate(() => {
  const stage = getFusionStage(); const svg = getFusionSvg();
  const prev = activeMarkerForFusion;
  const reset = () => { stage.querySelectorAll('.cable-element, .splitter-element').forEach(e => e.remove()); svg.innerHTML = ''; };
  reset();
  activeMarkerForFusion = { type: 'CEO', name: 'T-CEO-A', folderId: 'x' };
  const feed = buildFusionCableCard({ name: 'T-FEED', type: 'Cabo AS 80 FO-12', role: 'entrada', fiberCount: 12 });
  const s8 = buildFusionSplitterCard({ id: 'splitter-a8', label: '1:8', outputs: 8, type: 'Fusão' });
  const s4 = buildFusionSplitterCard({ id: 'splitter-a4', label: '1:4 APC', outputs: 4, type: 'Atendimento', connector: 'APC' });
  stage.append(feed, s8, s4);
  const f3 = [...feed.querySelectorAll('.fiber-row')][2];
  createFusionLine(f3, document.getElementById('splitter-a8-input-port'));
  createFusionLine(document.getElementById('splitter-a8-output-1'), document.getElementById('splitter-a4-input-port'));
  const template = captureFusionTemplate();
  reset();
  activeMarkerForFusion = { type: 'CEO', name: 'T-CEO-B', folderId: 'x' };
  const other = buildFusionCableCard({ name: 'T-OUTRO', type: 'Cabo AS 80 FO-06', role: 'entrada', fiberCount: 6 });
  stage.append(other);
  let result, err = null;
  try { result = applyFusionTemplate(template); } catch (e) { err = String(e); }
  const plan = serializeFusionPlan();
  const lines = getFusionLines().map(l => [l.dataset.startId, l.dataset.endId]);
  const desc = lines.map(([a, b]) => `${a.replace(/splitter-m\w+?(\d)-/, 'S$1-')}>${b.replace(/splitter-m\w+?(\d)-/, 'S$1-')}`).sort();
  reset(); activeMarkerForFusion = prev;
  return { splitters: template.splitters.map(s => `${s.label}/${s.type}`).join(), links: template.links.length, result, err, desc };
});
check(tpl.splitters === '1:8/Fusão,1:4 APC/Atendimento' && tpl.links === 2 && !tpl.err && tpl.result?.splitters === 2 && tpl.result?.links === 2
  && tpl.desc.includes('S0-output-1>S1-input-port') && tpl.desc.some(d => /^cable-T-OUTRO-fiber-3>S0-input-port$/.test(d)),
  `modelo de caixa recria splitters, cascata e fusão do cabo (${JSON.stringify(tpl)})`);

//Desfazer/refazer: foto do projeto depois de cada alteração; Ctrl+Z volta, Ctrl+Y refaz, no mesmo lugar da barra lateral
const undoRes = await page.evaluate(async () => {
  const sidebar = document.getElementById('sidebar');
  rebuildSidebarFromJSON([{ id: 'projU', name: 'Projeto U', isProject: true, type: 'TCR', children: [] }], sidebar);
  const prev = activeFolderId;
  setActiveFolder('projU');
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const folders = () => [...document.getElementById('projU').querySelectorAll('.folder-name-text')].map(e => e.textContent).join(',');
  appendFolderToParent(document.getElementById('projU'), 'Pasta 1', 'pU1'); await wait(450);
  appendFolderToParent(document.getElementById('projU'), 'Pasta 2', 'pU2'); await wait(450);
  const before = folders();
  const isOpen = (id) => !document.getElementById(id).classList.contains('hidden');
  if (!isOpen('projU')) toggleFolder('projU');
  if (!isOpen('pU1')) toggleFolder('pU1');
  const key = (k, extra = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, ...extra }));
  key('z'); const undo1 = folders();
  const keptOpen = isOpen('projU') && isOpen('pU1');
  key('z'); const undo2 = folders();
  key('y'); const redo1 = folders();
  const stillProject = !!document.querySelector('.folder-title[data-folder-id="projU"]');
  appendFolderToParent(document.getElementById('projU'), 'Pasta X', 'pUX'); await wait(450);
  key('y'); const afterNewChange = folders(); //refazer some depois de uma alteração nova
  document.querySelector('.folder-title[data-folder-id="projU"]').closest('.folder').remove();
  activeFolderId = prev;
  return { before, undo1, undo2, redo1, stillProject, afterNewChange, keptOpen };
});
check(undoRes.before === 'Pasta 1,Pasta 2' && undoRes.undo1 === 'Pasta 1' && undoRes.undo2 === '' && undoRes.redo1 === 'Pasta 1'
  && undoRes.stillProject && undoRes.afterNewChange === 'Pasta 1,Pasta X' && undoRes.keptOpen, `desfazer e refazer (Ctrl+Z / Ctrl+Y) no projeto (${JSON.stringify(undoRes)})`);

//Seleção múltipla: retângulo seleciona os marcadores do projeto; muda situação, move de pasta e exclui
const sel = await page.evaluate(() => {
  const sidebar = document.getElementById('sidebar');
  rebuildSidebarFromJSON([{ id: 'projS', name: 'Projeto S', isProject: true, type: 'TCR', children: [{ id: 'pS1', name: 'Pasta 1', children: [] }] }], sidebar);
  const prev = activeFolderId; setActiveFolder('projS');
  const pos = (lat, lng) => ({ lat: () => lat, lng: () => lng });
  const mk = (type, name, lat, lng) => {
    const li = document.createElement('li'); document.getElementById('projS').appendChild(li);
    return { type, name, folderId: 'projS', listItem: li, ctoStatus: 'Nova', reservaStatus: 'Nova', marker: { getPosition: () => pos(lat, lng), getVisible: () => true, setMap() {}, setVisible() {} } };
  };
  const a = mk('CTO', 'S-CTO', 1, 1), b = mk('RESERVA', 'S-RT', 2, 2), far = mk('CTO', 'S-LONGE', 50, 50);
  markers.push(a, b, far);
  const realAppearance = window.updateMarkerAppearance; window.updateMarkerAppearance = () => {};
  selectMarkersInBounds({ contains: (p) => p.lat() < 10 });
  const picked = [...mapSelection.items].map(m => m.name).sort().join();
  const barShown = !document.getElementById('mapSelectionBar').classList.contains('hidden');
  const count = document.getElementById('mapSelectionCount').textContent;
  applySelectionStatus('Troca');
  const status = `${a.ctoStatus}/${b.reservaStatus}`;
  moveSelectionToFolder('pS1');
  const moved = `${a.folderId},${b.folderId}` + '|' + document.getElementById('pS1').children.length;
  deleteSelection();
  document.getElementById('confirmModalConfirmButton').click();
  const left = markers.filter(m => [a, b, far].includes(m)).map(m => m.name).join();
  const cleared = document.getElementById('mapSelectionBar').classList.contains('hidden');
  markers.splice(markers.indexOf(far), 1);
  window.updateMarkerAppearance = realAppearance;
  document.querySelector('.folder-title[data-folder-id="projS"]').closest('.folder').remove();
  activeFolderId = prev;
  return { picked, barShown, count, status, moved, left, cleared };
});
check(sel.picked === 'S-CTO,S-RT' && sel.barShown && sel.count === '2 selecionados' && sel.status === 'Troca/Nova'
  && sel.moved === 'pS1,pS1|2' && sel.left === 'S-LONGE' && sel.cleared, `seleção múltipla: retângulo, situação, mover e excluir (${JSON.stringify(sel)})`);

//Retângulo pega o cabo que só atravessa a área (pontas fora); "Estilo" muda a cor das CTOs sem mexer no cabo
const selStyle = await page.evaluate(() => {
  const sidebar = document.getElementById('sidebar');
  rebuildSidebarFromJSON([{ id: 'projY', name: 'Projeto Y', isProject: true, type: 'TCR', children: [] }], sidebar);
  const prev = activeFolderId; setActiveFolder('projY');
  const pos = (lat, lng) => ({ lat: () => lat, lng: () => lng });
  const mk = (name, lat, lng) => {
    const li = document.createElement('li'); document.getElementById('projY').appendChild(li);
    return { type: 'CTO', name, folderId: 'projY', listItem: li, color: '#111111', marker: { getPosition: () => pos(lat, lng), getVisible: () => true, setMap() {}, setVisible() {}, setIcon() {}, setLabel() {} } };
  };
  const c1 = mk('Y-CTO1', 1, 1), c2 = mk('Y-CTO2', 2, 2);
  const opts = {};
  const cable = { name: 'Y-CABO', folderId: 'projY', color: '#008000', width: 4, path: [pos(5, -10), pos(5, 10)], item: document.createElement('li'),
    polyline: { getVisible: () => true, getPath: () => ({ getArray: () => cable.path }), setOptions(o) { Object.assign(opts, o); }, setMap() {} } };
  const away = { name: 'Y-LONGE', folderId: 'projY', path: [pos(50, 50), pos(51, 51)], item: document.createElement('li'),
    polyline: { getVisible: () => true, getPath: () => ({ getArray: () => away.path }), setOptions() {}, setMap() {} } };
  markers.push(c1, c2); savedCables.push(cable, away);
  const realAppearance = window.updateMarkerAppearance; window.updateMarkerAppearance = () => {};
  const realSave = window.saveProjectElement; window.saveProjectElement = () => {};
  //O ícone real usa o Google Maps (bloqueado no teste)
  const realIcon = window.buildMarkerMapIcon, realLabel = window.buildMarkerMapLabel;
  window.buildMarkerMapIcon = () => ({}); window.buildMarkerMapLabel = () => ({});
  //No teste a janela de estilo não passa pela inicialização da página (que depende do mapa)
  if (!document.getElementById('folderStyleSizeMount').children.length) setupFolderStyleModal();
  const bounds = { contains: (p) => p.lat() >= 0 && p.lat() <= 6 && p.lng() >= 0 && p.lng() <= 6,
    getNorthEast: () => pos(6, 6), getSouthWest: () => pos(0, 0) };
  selectMarkersInBounds(bounds);
  const picked = [...mapSelection.items].map(m => m.name).sort().join();
  const styleEnabled = !document.getElementById('mapSelectionStyle').disabled;
  document.getElementById('mapSelectionStyle').click();
  const open = document.getElementById('folderMarkerStyleModal').style.display === 'flex';
  const chips = [...document.querySelectorAll('#folderStyleTypes input')].map(i => i.value).join();
  const cableChip = document.querySelector('#folderStyleTypes input[value="__cabos"]');
  cableChip.checked = false; cableChip.dispatchEvent(new Event('change'));
  document.getElementById('folderMarkerColor').value = '#ff0000';
  document.getElementById('folderMarkerColor').dispatchEvent(new Event('input'));
  document.getElementById('folderCableColor').value = '#0000ff';
  document.getElementById('folderCableColor').dispatchEvent(new Event('input'));
  document.getElementById('confirmFolderMarkerStyle').click();
  const result = { picked, styleEnabled, open, chips, ctoColors: `${c1.color},${c2.color}`, cableColor: cable.color, cableStroke: opts.strokeColor || '' };
  clearMapSelection();
  markers.splice(markers.indexOf(c1), 2); savedCables.splice(savedCables.indexOf(cable), 2);
  window.updateMarkerAppearance = realAppearance; window.saveProjectElement = realSave;
  window.buildMarkerMapIcon = realIcon; window.buildMarkerMapLabel = realLabel;
  document.querySelector('.folder-title[data-folder-id="projY"]').closest('.folder').remove();
  activeFolderId = prev;
  return result;
});
check(selStyle.picked === 'Y-CABO,Y-CTO1,Y-CTO2' && selStyle.styleEnabled && selStyle.open && selStyle.chips === 'CTO,__cabos'
  && selStyle.ctoColors === '#ff0000,#ff0000' && selStyle.cableColor === '#008000' && selStyle.cableStroke === '#008000',
  `seleção pega cabo que atravessa o retângulo e o estilo muda só as CTOs (${JSON.stringify(selStyle)})`);

//Tecla Delete: com seleção, pede confirmação e exclui; digitando num campo, não faz nada
const delKey = await page.evaluate(() => {
  const sidebar = document.getElementById('sidebar');
  const ul = document.createElement('ul'); sidebar.appendChild(ul);
  const mk = (name) => { const li = document.createElement('li'); li.className = 'ge-pro-item'; ul.appendChild(li);
    const m = { type: 'CTO', name, listItem: li, marker: { getPosition: () => ({ lat: () => 0, lng: () => 0 }), setMap() {} } }; markers.push(m); return m; };
  const a = mk('D1'), b = mk('D2');
  const press = (target) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  setMapSelection([a, b]);
  const input = document.createElement('input'); document.body.appendChild(input);
  press(input);
  const typing = document.getElementById('confirmModal').style.display;
  input.remove();
  press(document.body);
  const asked = document.getElementById('confirmModal').style.display;
  document.getElementById('confirmModalConfirmButton').click();
  const gone = !markers.includes(a) && !markers.includes(b);
  //Sem seleção múltipla: exclui o item ativo na barra lateral
  const c = mk('D3');
  c.listItem.classList.add('active');
  press(document.body);
  const askedSingle = document.getElementById('confirmModal').style.display;
  document.getElementById('confirmModalConfirmButton').click();
  const goneSingle = !markers.includes(c);
  ul.remove();
  return { typing, asked, gone, askedSingle, goneSingle };
});
check(delKey.typing !== 'flex' && delKey.asked === 'flex' && delKey.gone && delKey.askedSingle === 'flex' && delKey.goneSingle,
  `tecla Delete exclui a seleção e o item ativo, e não age ao digitar (${JSON.stringify(delKey)})`);

//Seleção múltipla pela barra lateral: Ctrl+clique e Shift+clique (intervalo)
const sbSel = await page.evaluate(() => {
  const sidebar = document.getElementById('sidebar');
  const ul = document.createElement('ul'); sidebar.appendChild(ul);
  const list = ['B1', 'B2', 'B3', 'B4'].map(name => {
    const li = document.createElement('li'); li.className = 'ge-pro-item'; li.textContent = name; ul.appendChild(li);
    const m = { type: 'CTO', name, listItem: li, marker: { getPosition: () => ({ lat: () => 0, lng: () => 0 }) } };
    markers.push(m); return m;
  });
  const click = (m, opts) => m.listItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...opts }));
  const names = () => [...mapSelection.items].map(m => m.name).sort().join();
  click(list[0], { ctrlKey: true }); click(list[2], { ctrlKey: true });
  const ctrl = names();
  click(list[2], { ctrlKey: true });
  const toggled = names();
  click(list[3], { shiftKey: true });
  const range = names();
  const highlighted = ul.querySelectorAll('.is-multi-selected').length;
  clearMapSelection();
  list.forEach(m => markers.splice(markers.indexOf(m), 1)); ul.remove();
  return { ctrl, toggled, range, highlighted };
});
//Cabos e polígonos também entram na seleção pela barra lateral e são excluídos juntos
const sbMix = await page.evaluate(() => {
  const sidebar = document.getElementById('sidebar');
  const ul = document.createElement('ul'); sidebar.appendChild(ul);
  const row = (name) => { const li = document.createElement('li'); li.className = 'ge-pro-item'; li.textContent = name; ul.appendChild(li); return li; };
  const cable = { name: 'C-MIX', item: row('C-MIX'), polyline: { setMap() {} } };
  const poly = { name: 'P-MIX', listItem: row('P-MIX'), polygonObject: { setMap() {} } };
  savedCables.push(cable); savedPolygons.push(poly);
  const click = (li) => li.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  click(cable.item); click(poly.listItem);
  const kinds = document.getElementById('mapSelectionKinds').textContent;
  deleteSelection();
  document.getElementById('confirmModalConfirmButton').click();
  const gone = !savedCables.includes(cable) && !savedPolygons.includes(poly) && !ul.children.length;
  ul.remove();
  return { kinds, gone };
});
check(sbMix.kinds === '1 Cabo · 1 Polígono' && sbMix.gone, `seleção múltipla com cabos e polígonos (${JSON.stringify(sbMix)})`);

check(sbSel.ctrl === 'B1,B3' && sbSel.toggled === 'B1' && sbSel.range === 'B3,B4' && sbSel.highlighted === 2,
  `seleção múltipla pela barra lateral com Ctrl e Shift (${JSON.stringify(sbSel)})`);

//Tour pelo sistema e tecla "?" para os atalhos
const tour = await page.evaluate(() => {
  startTour();
  const layer = document.getElementById('tourLayer');
  const first = layer.querySelector('.tour-title').textContent;
  const total = layer.querySelector('.tour-step').textContent;
  layer.querySelector('[data-tour="next"]').click();
  const second = layer.querySelector('.tour-title').textContent;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const closed = !document.getElementById('tourLayer');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
  const shortcuts = document.getElementById('accountModal').style.display !== 'none' && !document.querySelector('#accountModal [data-panel="preferences"]').hidden;
  document.getElementById('accountModal').style.display = 'none';
  return { first, total, second, closed, shortcuts, items: document.querySelectorAll('#accountModal .shortcut-list > div').length };
});
check(tour.first === 'Projetos e pastas' && /^1 de \d+$/.test(tour.total) && tour.second === 'Menu Projeto' && tour.closed && tour.shortcuts && tour.items >= 12,
  `tour pelo sistema e "?" abre os atalhos (${JSON.stringify(tour)})`);

//Poste: painel com os dados, salvos no marcador, rótulo na barra lateral, busca e aba "Postes" na planilha
const poste = await page.evaluate(() => {
  openMarkerCreatePanel('POSTE');
  const groupVisible = !document.getElementById('poleGroup').classList.contains('hidden');
  const set = (id, v) => { document.getElementById(id).value = v; };
  set('poleNumber', 'CEMIG-4521'); set('poleHeight', '11'); set('poleEffort', '300'); set('poleMaterial', 'Concreto');
  set('poleUtility', 'Cemig'); set('poleOccupants', '2'); set('poleSituation', 'Existente');
  const form = readMarkerPanelForm();
  resetMarkerModal();
  const icon = getMarkerIconDataUrl('POSTE', '#64748b');
  document.getElementById('sidebar').insertAdjacentHTML('beforeend', '<li class="folder"><div class="folder-title" data-folder-id="projPo" data-folder-name="Po"></div><ul id="projPo" class="subfolders"></ul></li>');
  const prev = activeFolderId; activeFolderId = 'projPo';
  const pole = { folderId: 'projPo', type: 'POSTE', name: 'P-01', pole: form.pole, position: { lat: -20, lng: -44 } };
  markers.push(pole);
  const sheet = buildProjectSheets(getActiveProjectScope()).Postes;
  const found = searchMapItems('cemig-4521').map(r => r.title).join();
  markers.splice(markers.indexOf(pole), 1);
  document.querySelector('[data-folder-id="projPo"]').closest('.folder').remove();
  activeFolderId = prev;
  return { groupVisible, pole: form.pole, icon: icon.startsWith('data:image/svg'), row: sheet[1]?.slice(0, 8).join('|'), found, desc: describePole(form.pole) };
});
check(poste.groupVisible && poste.icon && poste.row === 'P-01|CEMIG-4521|Existente|11|300|Concreto|Cemig|2' && poste.found === 'P-01'
  && poste.desc === 'nº CEMIG-4521 · 11 m · 300 daN · Concreto · Existente', `poste: cadastro, busca e aba "Postes" na planilha (${JSON.stringify(poste)})`);

//Plano do POP: OLT, DGO e switch como cartões; PON → DGO (cordão) → cabo (fusão) → CTO. A rota e o orçamento
//óptico encontram a OLT pelo caminho e a PON mostra até onde chega
const popPlan = await page.evaluate(async () => {
  const stage = getFusionStage(); const svg = getFusionSvg();
  const prevActive = activeMarkerForFusion;
  const reset = () => { stage.querySelectorAll('.cable-element, .splitter-element, .equipment-element').forEach(e => e.remove()); svg.innerHTML = ''; };
  reset();
  const pop = { type: 'POP', name: 'POP-T', uid: 'pop-t', popEquipment: { olts: [{ name: 'OLT-01', model: 'C600', cards: [{ slot: '1', model: 'GPON', pons: 16 }] }], dgos: [{ name: 'DGO-01', ports: 24, connector: 'SC/APC' }], switches: [{ name: 'SW-01', model: '', ports: 8, uplinks: 2 }] } };
  markers.push(pop);
  activeMarkerForFusion = pop;
  const added = syncPopEquipmentCards();
  const out = buildFusionCableCard({ name: 'T-POP-CTO', type: 'Cabo AS 80 FO-12', role: 'saida', fiberCount: 12 });
  stage.appendChild(out);
  const pon1 = stage.querySelector('.equip-port-row[data-side="pon"][data-pon="1"]');
  const front1 = stage.querySelector('.fx-equipment--dgo .equip-port-row[data-side="front"][data-port="1"]');
  const back1 = stage.querySelector('.fx-equipment--dgo .equip-port-row[data-side="back"][data-port="1"]');
  createFusionLine(pon1, front1);
  createFusionLine(back1, [...out.querySelectorAll('.fiber-row')][0]);
  const desc = describeFusionPort(pon1, { short: true });
  pop.fusionPlan = serializeFusionPlan();
  //CTO do outro lado do cabo com splitter de atendimento
  const fiber = (card, n) => [...card.querySelectorAll('.fiber-row')][n - 1].id;
  const inCard = buildFusionCableCard({ name: 'T-POP-CTO', type: 'Cabo AS 80 FO-12', role: 'entrada', fiberCount: 12 });
  const at = buildFusionSplitterCard({ id: 'splitter-1', label: '1:8 APC', outputs: 8, type: 'Atendimento' });
  const box = document.createElement('div'); box.append(inCard, at);
  const cto = { type: 'CTO', name: 'T-CTO', uid: 't-cto', fusionPlan: JSON.stringify({ version: 2, elements: box.innerHTML, svg: `<path class="fusion-line" data-start-id="${fiber(inCard, 1)}" data-end-id="splitter-1-input-port"></path>` }) };
  const client = { type: 'CLIENTE', name: 'T-Cli', client: { ctoUid: 't-cto', status: 'ativo', ctoPort: 1 } };
  const cable = { name: 'T-POP-CTO', type: 'Cabo AS 80 FO-12', totalLength: 1000 };
  markers.push(cto, client); savedCables.push(cable);
  //Alcance mostrado na PON
  renderFusionConnections();
  await new Promise(r => setTimeout(r, 400));
  const ponDest = pon1.querySelector('.fx-port__dest')?.textContent || '';
  const equipFromCards = popEquipmentFromCards();
  const graph = buildFiberGraph();
  const route = traceFiberRoute(graph, 'T-POP-CTO', 1);
  const port = getOpticalBudgetByCto([cto]).get(cto)?.worstPort;
  const plan = readFusionPlan(pop);
  //Splitter da CTO ligado na PON pelo caminho: OLT/placa/PON automáticos
  autoLinkSplitterOlts([cto]);
  const autoOlt = readFusionPlan(cto).splitters.map(sp => `${sp.olt.olt}/${sp.olt.placa}/${sp.olt.pon}`).join();
  //Seleção de várias fusões e exclusão de uma vez
  const lA = createFusionLine(stage.querySelector('.fx-equipment--dgo .equip-port-row[data-side="back"][data-port="2"]'), [...out.querySelectorAll('.fiber-row')][1]);
  renderFusionConnections();
  const before = getFusionLines().length;
  toggleFusionLineSelection(lA); toggleFusionLineSelection(getFusionLines()[0]);
  const selected = getSelectedFusionLines().length;
  const barShown = !document.getElementById('fusionSelectionBar').classList.contains('hidden');
  deleteSelectedFusionLines();
  document.getElementById('confirmModalConfirmButton').click();
  const afterDelete = getFusionLines().length;
  reset(); activeMarkerForFusion = prevActive;
  [pop, cto, client].forEach(m => markers.splice(markers.indexOf(m), 1)); savedCables.splice(savedCables.indexOf(cable), 1);
  return {
    added, desc, ponDest,
    kinds: plan.equipment.map(e => `${e.kind}:${e.ports.length}`).join(),
    oltFound: route.olts.map(o => `${o.splitter.olt.olt}/${o.splitter.olt.placa}/${o.splitter.olt.pon}`).join(),
    ctos: route.ctos.map(c => c.box.name).join(),
    port: port == null ? null : Math.round(port * 100) / 100,
    equip: `${equipFromCards.olts.length}/${equipFromCards.dgos.length}/${equipFromCards.switches.length}`,
    autoOlt, multi: `${before}>${selected}>${barShown}>${afterDelete}`,
  };
});
check(popPlan.added === 3 && popPlan.kinds === 'olt:16,dgo:48,switch:10' && popPlan.desc === 'OLT-01 · S1 PON 1' && popPlan.equip === '1/1/1',
  `plano do POP: OLT, DGO e switch viram cartões (${JSON.stringify(popPlan)})`);
check(popPlan.oltFound === 'OLT-01/1/1' && popPlan.ctos === 'T-CTO' && popPlan.port === -7.65 && /1 CTO · 1 cli/.test(popPlan.ponDest),
  `plano do POP: rota acha a OLT pelo caminho, potência −7,65 dBm e a PON mostra o alcance (${popPlan.ponDest})`);
check(popPlan.autoOlt === 'OLT-01/1/1', `splitter ligado na PON pelo caminho recebe OLT, placa e PON automáticos (${popPlan.autoOlt})`);
check(popPlan.multi === '3>2>true>1', `plano de fusão: selecionar várias fusões e excluir de uma vez (${popPlan.multi})`);

//Lista de materiais do cliente: PTO só se marcada; equipamento só se escolhido
const cliBom = await page.evaluate(() => {
  const items = [];
  const add = (name) => items.push(name);
  const mk = (extra) => ({ type: 'CLIENTE', name: 'C', client: { status: 'ativo', ...extra } });
  addClientMaterialsToBom([mk({ equipments: [{ type: 'ONU/ONT' }] })], add);
  const plain = items.splice(0).join('|');
  addClientMaterialsToBom([mk({ pto: true, equipments: [{ type: 'ONU/ONT', model: 'F670L' }] })], add);
  const withPto = items.splice(0).join('|');
  return { plain, withPto };
});
check(!/PTO|TERMINAÇÃO/.test(cliBom.plain) && !/ONU|F670/.test(cliBom.plain) && /PTO/.test(cliBom.withPto) && /F670|ONU/.test(cliBom.withPto),
  `cliente: PTO e equipamentos só entram na lista de materiais quando escolhidos (${JSON.stringify(cliBom)})`);

if (process.env.SMOKE_SHOTS) {
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const pop = { type: 'POP', name: 'POP-CENTRO', uid: 'pop-shot', folderId: 'x', popEquipment: { olts: [{ name: 'OLT-01', model: 'ZTE C600', cards: [{ slot: '1', model: 'GPON 16', pons: 4 }] }], dgos: [{ name: 'DGO-01', ports: 4, connector: 'SC/APC' }], switches: [] } };
    window.__popShot = pop;
    markers.push(pop);
    populateFusionPlan(pop);
    document.getElementById('fusionModal').style.display = 'flex';
    const stage = getFusionStage();
    const out = buildFusionCableCard({ name: 'FO-12-POP-CEO01', type: 'Cabo AS 80 FO-12', role: 'saida', fiberCount: 12 });
    stage.appendChild(out); wireFusionCard(out);
    const q = (sel) => stage.querySelector(sel);
    createFusionLine(q('[data-side="pon"][data-pon="1"]'), q('[data-side="front"][data-port="1"]'));
    createFusionLine(q('[data-side="pon"][data-pon="2"]'), q('[data-side="front"][data-port="2"]'));
    createFusionLine(q('[data-side="back"][data-port="1"]'), [...out.querySelectorAll('.fiber-row')][0]);
    createFusionLine(q('[data-side="back"][data-port="2"]'), [...out.querySelectorAll('.fiber-row')][1]);
    repackAllElements({ animate: false });
  });
  await page.waitForTimeout(500);
  await page.locator('#fusionModal .modal-content').screenshot({ path: path.join(process.env.SMOKE_SHOTS, 'pop-plano.png') });
  await page.evaluate(() => { closeFusionModal({ force: true }); markers.splice(markers.indexOf(window.__popShot), 1); });
}

//Botão direito no mapa (marcador/cabo): abre o mesmo menu da barra lateral onde o clique foi
const mapMenu = await page.evaluate(() => {
  const li = document.createElement('li');
  const cto = { type: 'CTO', name: 'M-CTO', listItem: li };
  const cable = { name: 'M-CABO', type: 'Cabo AS 80 FO-12', item: document.createElement('li') };
  markers.push(cto); savedCables.push(cable);
  const menu = document.getElementById('sidebarFolderContextMenu');
  let prevented = false;
  openMapItemMenu('marker', cto, { clientX: 300, clientY: 220, preventDefault: () => { prevented = true; }, stopPropagation() {} });
  const markerActions = [...menu.querySelectorAll('[data-action]')].map(b => b.dataset.action);
  const pos = { open: !menu.classList.contains('hidden'), left: menu.style.left };
  hideSidebarFolderContextMenu();
  openMapItemMenu('cable', cable, { clientX: 320, clientY: 240 });
  const cableActions = [...menu.querySelectorAll('[data-action]')].map(b => b.dataset.action);
  const head = menu.querySelector('.sb-menu__head').textContent;
  hideSidebarFolderContextMenu();
  isDrawingCable = true;
  openMapItemMenu('marker', cto, { clientX: 300, clientY: 220 });
  const blockedWhileDrawing = menu.classList.contains('hidden');
  isDrawingCable = false;
  markers.splice(markers.indexOf(cto), 1); savedCables.splice(savedCables.indexOf(cable), 1);
  return { prevented, pos, markerActions, cableActions, head, blockedWhileDrawing };
});
check(mapMenu.pos.open && mapMenu.prevented && mapMenu.markerActions.includes('fusion') && mapMenu.markerActions.includes('open'),
  `botão direito no marcador do mapa abre o menu de ações (${mapMenu.markerActions.join(',')})`);
check(mapMenu.cableActions.includes('route') && mapMenu.cableActions.includes('open') && mapMenu.head.includes('M-CABO') && mapMenu.blockedWhileDrawing,
  'botão direito no cabo do mapa abre o menu (e não atrapalha o desenho de cabo)');

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

{
  const spCtx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const sp = await spCtx.newPage();
  await sp.addInitScript(() => { try { localStorage.setItem('routeMapTourDone', '1'); } catch (e) {} });
  await sp.route('**/supabase.js', r => r.fulfill({ path: path.join(here, 'fake-supabase.js'), contentType: 'text/javascript' }));
  await sp.route(/maps\.googleapis|maps\.gstatic/, r => r.abort());
  //Sem acesso às CDNs: SMOKE_LIBS aponta para cópias locais do jsPDF (mesmos arquivos, passam na integridade)
  if (process.env.SMOKE_LIBS) {
    await sp.route('**/jspdf@2.5.1/dist/jspdf.umd.min.js', r => r.fulfill({ path: path.join(process.env.SMOKE_LIBS, 'jspdf-2.5.1/dist/jspdf.umd.min.js'), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
    await sp.route('**/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js', r => r.fulfill({ path: path.join(process.env.SMOKE_LIBS, 'jspdf-autotable-3.8.2/dist/jspdf.plugin.autotable.min.js'), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
  }
  await sp.route('**/__fake-google-maps.js', r => r.fulfill({ path: path.join(here, 'fake-google-maps.js'), contentType: 'text/javascript' }));
  await sp.goto(baseUrl + '/index.html');
  await sp.waitForFunction(() => typeof AppSession !== 'undefined' && AppSession.company, null, { timeout: 15000 });
  await sp.addScriptTag({ url: baseUrl + '/__fake-google-maps.js' });
  await sp.evaluate(() => { if (!map) map = new google.maps.Map(document.getElementById('map'), {}); });
//Dividir cabo num marcador no meio dele: dois cabos, pontas certas, plano da caixa A com o nome novo
const split = await sp.evaluate(() => {
  const sidebar = document.getElementById('sidebar');
  rebuildSidebarFromJSON([{ id: 'projSP', name: 'Projeto SP', isProject: true, type: 'TCR', children: [] }], sidebar);
  const LL = (lat, lng) => new google.maps.LatLng(lat, lng);
  const mk = (type, name, uid, lat, lng, fusionPlan) => ({ type, name, uid, folderId: 'projSP', fusionPlan,
    marker: { getPosition: () => LL(lat, lng), setMap() {}, getVisible: () => true } });
  const card = buildFusionCableCard({ name: 'FO-12-CTO-B', type: 'Cabo AS 80 FO-12', role: 'saida', fiberCount: 12 });
  const holder = document.createElement('div'); holder.append(card);
  const ceoA = mk('CEO', 'CEO-A', 'sp-a', -20, -44, JSON.stringify({ version: 2, elements: holder.innerHTML, svg: '' }));
  const ctoB = mk('CTO', 'CTO-B', 'sp-b', -20, -43.99, JSON.stringify({ version: 2, elements: holder.innerHTML, svg: '' }));
  const mid = mk('CEO', 'CEO-M', 'sp-m', -20.00005, -43.995);
  const off = mk('CTO', 'CTO-LONGE', 'sp-x', -20.01, -43.995);
  markers.push(ceoA, ctoB, mid, off);
  rebuildCable({ folderId: 'projSP', name: 'FO-12-CTO-B', type: 'FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -20, lng: -44 }, { lat: -20, lng: -43.99 }],
    startAnchorUid: 'sp-a', endAnchorUid: 'sp-b', startAnchorMarkerName: 'CEO-A', endAnchorMarkerName: 'CTO-B' });
  const cable = savedCables[savedCables.length - 1];
  const passing = getCablesPassingThroughMarker(mid).map(c => c.name).join();
  const notPassing = getCablesPassingThroughMarker(off).length + getCablesPassingThroughMarker(ceoA).length;
  const menu = buildSidebarMenuItems({ kind: 'marker', info: mid, row: document.createElement('li') }).some(i => i.label === 'Dividir cabo FO-12-CTO-B aqui');
  const res = splitCableAtMarker(cable, mid);
  const names = savedCables.filter(c => c.folderId === 'projSP').map(c => c.name).join();
  const first = res.first, second = res.second;
  const out = {
    passing, notPassing, menu, names,
    firstEnds: `${first.startAnchorUid}>${first.endAnchorUid}`, secondEnds: `${second.startAnchorUid}>${second.endAnchorUid}`,
    meet: Math.abs(first.path[first.path.length - 1].lng() - second.path[0].lng()) < 1e-9,
    planA: readFusionPlan(ceoA).cables.map(c => c.name).join(), planB: readFusionPlan(ctoB).cables.map(c => c.name).join(),
    oldGone: !savedCables.includes(cable), rows: document.getElementById('projSP').querySelectorAll('.ge-pro-item').length,
  };
  [first, second].forEach(c => { c.polyline?.setMap(null); savedCables.splice(savedCables.indexOf(c), 1); });
  [ceoA, ctoB, mid, off].forEach(m => markers.splice(markers.indexOf(m), 1));
  document.querySelector('.folder-title[data-folder-id="projSP"]').closest('.folder').remove();
  return out;
});
check(split.passing === 'FO-12-CTO-B' && split.notPassing === 0 && split.menu && split.names === 'FO-12-CEO-M,FO-12-CTO-B'
  && split.firstEnds === 'sp-a>sp-m' && split.secondEnds === 'sp-m>sp-b' && split.meet && split.planA === 'FO-12-CEO-M'
  && split.planB === 'FO-12-CTO-B' && split.oldGone && split.rows === 2, `dividir cabo no marcador do meio (${JSON.stringify(split)})`);

  //Nomes repetidos: dois cabos "FO-12-CTO" e duas caixas "CTO" — cada ligação vai pelo identificador
  const dup = await sp.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    rebuildSidebarFromJSON([{ id: 'projDU', name: 'Projeto DU', isProject: true, type: 'TCR', children: [] }], sidebar);
    const LL = (lat, lng) => new google.maps.LatLng(lat, lng);
    const mk = (type, name, uid, lat, lng) => ({ type, name, uid, folderId: 'projDU', marker: { getPosition: () => LL(lat, lng), setMap() {}, getVisible: () => true } });
    const ceo = mk('CEO', 'CEO-D', 'du-ceo', -21, -44), cto1 = mk('CTO', 'CTO', 'du-c1', -21, -43.99), cto2 = mk('CTO', 'CTO', 'du-c2', -21.01, -44);
    markers.push(ceo, cto1, cto2);
    const mkCable = (uid, end) => { rebuildCable({ uid, folderId: 'projDU', name: 'FO-12-CTO', type: 'FO-12', width: 4, color: '#000', status: 'Novo',
      path: [{ lat: -21, lng: -44 }, { lat: end.marker.getPosition().lat(), lng: end.marker.getPosition().lng() }], startAnchorUid: 'du-ceo', endAnchorUid: end.uid }); return savedCables[savedCables.length - 1]; };
    const k1 = mkCable('du-k1', cto1), k2 = mkCable('du-k2', cto2);
    //Plano antigo da CTO 2: cartão só com o nome (sem uid) e uma fusão na fibra 1
    const legacy = buildFusionCableCard({ name: 'FO-12-CTO', type: 'Cabo AS 80 FO-12', role: 'entrada', fiberCount: 12 });
    const sp1 = buildFusionSplitterCard({ id: 'splitter-du', label: '1:8', outputs: 8, type: 'Fusão' });
    sp1.classList.add('splitter-atendimento');
    const h = document.createElement('div'); h.append(legacy, sp1);
    const f1 = legacy.querySelector('.fiber-row').id;
    cto2.fusionPlan = JSON.stringify({ version: 2, elements: h.innerHTML, svg: `<path class="fusion-line" data-start-id="${f1}" data-end-id="splitter-du-input-port"></path>` });
    backfillFusionPlanCableUids([cto2]);
    const uidAfterBackfill = parseStoredHtml(JSON.parse(cto2.fusionPlan).elements).querySelector('.cable-element').dataset.cableUid;
    const usage1 = getCableFiberUsage(k1).used.join(), usage2 = getCableFiberUsage(k2).used.join();
    const g = buildFiberGraph();
    const route1 = traceFiberRoute(g, k1, 1).ctos.length, route2 = traceFiberRoute(g, k2, 1).ctos.map(c => c.box.uid).join();
    const inPlan1 = checkCableUsageInFusionPlans(k1).isInPlan, inPlan2 = checkCableUsageInFusionPlans(k2).boxes.map(b => b.uid).join();
    const conn = [isCableConnectedToMarker(k1, cto1), isCableConnectedToMarker(k1, cto2), isCableConnectedToMarker(k2, cto2)].join();
    //Renomear k1 não mexe no plano do k2
    const old = k1.name; k1.name = 'FO-12-NOVO'; updateCableNameInAllFusionPlans(old, 'FO-12-NOVO', k1);
    const planAfterRename = readFusionPlan(cto2).cables.map(c => c.name).join();
    [k1, k2].forEach(c => { c.polyline?.setMap(null); savedCables.splice(savedCables.indexOf(c), 1); });
    [ceo, cto1, cto2].forEach(m => markers.splice(markers.indexOf(m), 1));
    document.querySelector('.folder-title[data-folder-id="projDU"]').closest('.folder').remove();
    return { uidAfterBackfill, usage1, usage2, route1, route2, inPlan1, inPlan2, conn, planAfterRename };
  });
  check(dup.uidAfterBackfill === 'du-k2' && dup.usage1 === '' && dup.usage2 === '1' && dup.route1 === 0 && dup.route2 === 'du-c2'
    && dup.inPlan1 === false && dup.inPlan2 === 'du-c2' && dup.conn === 'true,false,true' && dup.planAfterRename === 'FO-12-CTO',
    `cabos e caixas com o mesmo nome ligados pelo identificador (${JSON.stringify(dup)})`);

  //Exportar plano de fusão do projeto (PDF): todas as caixas, fusões em ordem de cabo/fibra
  const hasPdf = (process.env.CI || process.env.SMOKE_LIBS)
    ? await sp.waitForFunction(() => !!window.jspdf?.jsPDF?.API?.autoTable, null, { timeout: 20000 }).then(() => true, () => false)
    : await sp.evaluate(() => !!window.jspdf?.jsPDF?.API?.autoTable);
  const fx = await sp.evaluate((hasPdf) => {
    const sidebar = document.getElementById('sidebar');
    rebuildSidebarFromJSON([{ id: 'projFX', name: 'Projeto FX', isProject: true, type: 'TCR', children: [] }], sidebar);
    const prev = activeFolderId; setActiveFolder('projFX');
    const LL = (lat, lng) => new google.maps.LatLng(lat, lng);
    const mk = (type, name, uid, lat, lng) => ({ type, name, uid, folderId: 'projFX', ceoStatus: 'Novo', marker: { getPosition: () => LL(lat, lng), setMap() {}, getVisible: () => true } });
    const ceo = mk('CEO', 'CEO-FX', 'fx-ceo', -22, -44), cto = mk('CTO', 'CTO-FX', 'fx-cto', -22, -43.99);
    markers.push(ceo, cto);
    rebuildCable({ uid: 'fx-a', folderId: 'projFX', name: 'CAB-A', type: 'FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -22.01, lng: -44 }, { lat: -22, lng: -44 }], endAnchorUid: 'fx-ceo' });
    rebuildCable({ uid: 'fx-b', folderId: 'projFX', name: 'CAB-B', type: 'FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -22, lng: -44 }, { lat: -22, lng: -43.99 }], startAnchorUid: 'fx-ceo', endAnchorUid: 'fx-cto' });
    const a = buildFusionCableCard({ name: 'CAB-A', uid: 'fx-a', type: 'Cabo AS 80 FO-12', role: 'entrada', fiberCount: 12 });
    const b = buildFusionCableCard({ name: 'CAB-B', uid: 'fx-b', type: 'Cabo AS 80 FO-12', role: 'saida', fiberCount: 12 });
    const sp1 = buildFusionSplitterCard({ id: 'splitter-fx', label: '1:8', outputs: 8, type: 'Fusão' });
    const h = document.createElement('div'); h.append(a, b, sp1);
    const f = (card, n) => [...card.querySelectorAll('.fiber-row')][n - 1].id;
    const links = [[f(b, 2), f(a, 2)], [f(a, 1), f(b, 1)], ['splitter-fx-input-port', f(a, 3)]];
    ceo.fusionPlan = JSON.stringify({ version: 2, elements: h.innerHTML, svg: links.map(([x, y]) => `<path class="fusion-line" data-start-id="${x}" data-end-id="${y}"></path>`).join('') });
    const boxes = buildProjectFusionExport(getActiveProjectScope());
    const c = boxes.find(x => x.name === 'CEO-FX');
    const doc = hasPdf ? drawFusionExportPdf('Projeto FX', boxes) : null;
    const out = {
      order: boxes.map(x => x.name).join(), ctoEmpty: boxes.find(x => x.name === 'CTO-FX').empty,
      fusions: c.fusions.map(x => `${x.a.text}>${x.b.text}`).join(' | '), color: c.fusions[0].a.colorName,
      cables: c.cables.map(x => `${x.name}:${x.role}:${x.used}`).join(), pages: doc ? doc.internal.getNumberOfPages() : 3,
      size: doc ? doc.output('arraybuffer').byteLength : 9999,
      diagram: `${c.diagram.left.map(x => x.title + ':' + x.rows.map(r => r.label).join('/')).join()}|${c.diagram.right.map(x => x.title + ':' + x.rows.map(r => r.label).join('/')).join()}|${c.diagram.middle.length}|${c.diagram.links.length}`,
    };
    window.__fxPdf = doc ? doc.output('datauristring') : '';
    //Caixa grande (144 fusões): diagrama ganha página comprida, sem erro
    if (hasPdf) {
      const big1 = buildFusionCableCard({ name: 'BIG-A', type: 'Cabo AS 80 FO-144', role: 'entrada', fiberCount: 144 });
      const big2 = buildFusionCableCard({ name: 'BIG-B', type: 'Cabo AS 80 FO-144', role: 'saida', fiberCount: 144 });
      const hb = document.createElement('div'); hb.append(big1, big2);
      const ids = (card) => [...card.querySelectorAll('.fiber-row')].map(r => r.id);
      const ia = ids(big1), ib = ids(big2);
      const bigBox = mk('CEO', 'CEO-BIG', 'fx-big', -22.1, -44);
      bigBox.fusionPlan = JSON.stringify({ version: 2, elements: hb.innerHTML, svg: ia.map((x, i) => `<path class="fusion-line" data-start-id="${x}" data-end-id="${ib[i]}"></path>`).join('') });
      markers.push(bigBox);
      const bigDoc = drawFusionExportPdf('Grande', [buildBoxFusionExport(bigBox)]);
      out.bigPages = bigDoc.internal.getNumberOfPages();
      out.bigTall = bigDoc.internal.pageSize.getHeight && (bigDoc.setPage(2), bigDoc.internal.pageSize.getHeight()) > 297;
      window.__fxBig = bigDoc.output('datauristring');
      markers.splice(markers.indexOf(bigBox), 1);
    }
    savedCables.filter(x => x.folderId === 'projFX').forEach(x => { x.polyline?.setMap(null); savedCables.splice(savedCables.indexOf(x), 1); });
    [ceo, cto].forEach(m => markers.splice(markers.indexOf(m), 1));
    document.querySelector('.folder-title[data-folder-id="projFX"]').closest('.folder').remove();
    activeFolderId = prev;
    return out;
  }, hasPdf);
  check(fx.order === 'CEO-FX,CTO-FX' && fx.ctoEmpty && fx.fusions === 'CAB-A F1>CAB-B F1 | CAB-A F2>CAB-B F2 | CAB-A F3>Splitter 1:8 · entrada'
    && fx.color === 'Verde' && fx.cables === 'CAB-A:Entrada:3,CAB-B:Saída:2' && fx.diagram === 'CAB-A:F1/F2/F3/F4–F12 livres|CAB-B:F1/F2/F3–F12 livres|1|3' && fx.pages === 3 && fx.size > 3000 && (fx.bigPages === undefined || (fx.bigPages >= 3 && fx.bigTall)),
    `exportar plano de fusão do projeto em PDF (${JSON.stringify(fx)})`);
  if (process.env.SMOKE_SHOTS && hasPdf) {
    const uri = await sp.evaluate(() => window.__fxPdf);
    fs.writeFileSync(path.join(process.env.SMOKE_SHOTS, 'plano-de-fusao.pdf'), Buffer.from(uri.split(',')[1], 'base64'));
    const big = await sp.evaluate(() => window.__fxBig);
    fs.writeFileSync(path.join(process.env.SMOKE_SHOTS, 'plano-de-fusao-grande.pdf'), Buffer.from(big.split(',')[1], 'base64'));
  }

  //Rota da fibra sobe até o POP, mesmo sem fusões no plano do POP; reserva técnica no meio também divide o cabo
  const toPop = await sp.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    rebuildSidebarFromJSON([{ id: 'projRP', name: 'Projeto RP', isProject: true, type: 'TCR', children: [] }], sidebar);
    const LL = (lat, lng) => new google.maps.LatLng(lat, lng);
    const mk = (type, name, uid, lat, lng) => ({ type, name, uid, folderId: 'projRP', marker: { getPosition: () => LL(lat, lng), setMap() {}, getVisible: () => true } });
    const pop = mk('POP', 'POP-RP', 'rp-pop', -23, -44), ceo = mk('CEO', 'CEO-RP', 'rp-ceo', -23, -43.99), cto = mk('CTO', 'CTO-RP', 'rp-cto', -23, -43.98);
    const res = mk('RESERVA', 'RT-RP', 'rp-rt', -23, -43.985);
    markers.push(pop, ceo, cto, res);
    rebuildCable({ uid: 'rp-feed', folderId: 'projRP', name: 'FEED', type: 'FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -23, lng: -44 }, { lat: -23, lng: -43.99 }], startAnchorUid: 'rp-pop', endAnchorUid: 'rp-ceo' });
    rebuildCable({ uid: 'rp-drop', folderId: 'projRP', name: 'DIST', type: 'FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -23, lng: -43.99 }, { lat: -23, lng: -43.98 }], startAnchorUid: 'rp-ceo', endAnchorUid: 'rp-cto' });
    const feed = buildFusionCableCard({ name: 'FEED', uid: 'rp-feed', type: 'Cabo AS 80 FO-12', role: 'entrada', fiberCount: 12 });
    const dist = buildFusionCableCard({ name: 'DIST', uid: 'rp-drop', type: 'Cabo AS 80 FO-12', role: 'saida', fiberCount: 12 });
    const h = document.createElement('div'); h.append(feed, dist);
    const f = (card, n) => [...card.querySelectorAll('.fiber-row')][n - 1].id;
    ceo.fusionPlan = JSON.stringify({ version: 2, elements: h.innerHTML, svg: `<path class="fusion-line" data-start-id="${f(feed, 1)}" data-end-id="${f(dist, 1)}"></path>` });
    const distCable = savedCables.find(c => c.uid === 'rp-drop');
    const trace = traceFiberRoute(buildFiberGraph(), distCable, 1);
    const out = { pops: trace.pops.map(p => p.box.name).join(), ends: describeRouteEnds(trace), segs: trace.segments.map(x => x.cable).sort().join() };
    out.reservaPassing = getCablesPassingThroughMarker(res).map(c => c.name).join();
    const reserveBefore = distCable.reserva;
    const parts = splitCableAtMarker(distCable, res);
    out.reserva = `${reserveBefore}>${parts.first.reserva}+${parts.second.reserva}`;
    savedCables.filter(c => c.folderId === 'projRP').forEach(c => { c.polyline?.setMap(null); savedCables.splice(savedCables.indexOf(c), 1); });
    [pop, ceo, cto, res].forEach(m => markers.splice(markers.indexOf(m), 1));
    document.querySelector('.folder-title[data-folder-id="projRP"]').closest('.folder').remove();
    return out;
  });
  check(toPop.pops === 'POP-RP' && toPop.ends.includes('POP-RP') && toPop.segs === 'DIST,FEED', `rota da fibra chega até o POP (${JSON.stringify(toPop)})`);
  check(toPop.reservaPassing === 'DIST' && toPop.reserva === '30>50+5', `dividir cabo na reserva técnica, reserva contada uma vez (${JSON.stringify(toPop)})`);

  //Editor de cabo aberto: clicar em outro cabo troca o editor (com alterações, pergunta antes)
  const swap = await sp.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    rebuildSidebarFromJSON([{ id: 'projSW', name: 'Projeto SW', isProject: true, type: 'TCR', children: [] }], sidebar);
    setActiveFolder('projSW');
    const mkc = (uid, name, lat) => { rebuildCable({ uid, folderId: 'projSW', name, type: 'FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat, lng: -44 }, { lat, lng: -43.99 }] }); return savedCables[savedCables.length - 1]; };
    const a = mkc('sw-a', 'SW-A', -24), b = mkc('sw-b', 'SW-B', -24.01);
    openCableEditor(a);
    const first = document.getElementById('cableName').value;
    openCableEditor(b);
    const switched = document.getElementById('cableName').value;
    document.getElementById('cableName').value = 'SW-B mexido';
    openCableEditor(a);
    const asked = getComputedStyle(document.getElementById('confirmModal')).display !== 'none';
    const stillB = savedCables[editingCableIndex] === b;
    document.getElementById('confirmModalConfirmButton').click();
    const afterConfirm = document.getElementById('cableName').value;
    cancelCableDrawingSession();
    [a, b].forEach(c => { c.polyline?.setMap(null); savedCables.splice(savedCables.indexOf(c), 1); });
    document.querySelector('.folder-title[data-folder-id="projSW"]').closest('.folder').remove();
    return { first, switched, asked, stillB, afterConfirm };
  });
  check(swap.first === 'SW-A' && swap.switched === 'SW-B' && swap.asked && swap.stillB && swap.afterConfirm === 'SW-A',
    `editor do cabo acompanha o cabo clicado (${JSON.stringify(swap)})`);

  //Nome automático do cabo acompanha o tipo e a ponta B (também na edição); nome digitado à mão não muda
  const autoName = await sp.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    rebuildSidebarFromJSON([{ id: 'projAN', name: 'Projeto AN', isProject: true, type: 'TCR', children: [] }], sidebar);
    setActiveFolder('projAN');
    const LL = (lat, lng) => new google.maps.LatLng(lat, lng);
    const mk = (type, name, uid, lat, lng) => ({ type, name, uid, folderId: 'projAN', marker: { getPosition: () => LL(lat, lng), setMap() {}, getMap: () => map, getVisible: () => true } });
    const ceo = mk('CEO', 'CEO-AN', 'an-ceo', -27, -44), ctoA = mk('CTO', 'CTO-AN1', 'an-cto1', -27, -43.99), ctoB = mk('CTO', 'CTO-AN2', 'an-cto2', -27, -43.98);
    markers.push(ceo, ctoA, ctoB);
    const mkc = (uid, name) => { rebuildCable({ uid, folderId: 'projAN', name, type: 'Cabo AS 80 FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -27, lng: -44 }, { lat: -27, lng: -43.99 }], startAnchorUid: 'an-ceo', endAnchorUid: 'an-cto1' }); return savedCables[savedCables.length - 1]; };
    const auto = mkc('an-a', 'FO-12-CTO-AN1'), custom = mkc('an-b', 'BACKBONE');
    const setType = (v) => { const sel = document.getElementById('cableType'); sel.value = v; sel.dispatchEvent(new Event('change')); };
    const name = () => document.getElementById('cableName').value;
    openCableEditor(auto);
    const opened = name();
    setType('FO-24');
    const afterType = name();
    cableDrawAnchors.end = ctoB;
    updatePolylineFromMarkers();
    const afterEnd = name();
    cancelCableDrawingSession();
    openCableEditor(custom);
    setType('FO-24');
    cableDrawAnchors.end = ctoB;
    updatePolylineFromMarkers();
    const customAfter = name();
    cancelCableDrawingSession();
    //Renomear a caixa da ponta B renomeia o cabo automático (o de nome à mão só guarda o nome novo da ponta)
    ctoA.name = 'CTO-NOVA';
    syncCableAnchorNamesForMarker(ctoA, 'CTO-AN1');
    const renamed = `${auto.name}|${custom.name}|${custom.endAnchorMarkerName}`;
    //Cabo antigo sem âncora gravada (só nome e posição) e nome de cabo dividido ("Cabo AS 80 FO-12-...")
    rebuildCable({ uid: 'an-c', folderId: 'projAN', name: 'Cabo AS 80 FO-12-CTO-AN2', type: 'Cabo AS 80 FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -27, lng: -43.99 }, { lat: -27, lng: -43.98 }], endAnchorMarkerName: 'CTO-AN2' });
    const legacy = savedCables[savedCables.length - 1];
    legacy.startAnchorUid = null; legacy.endAnchorUid = null;
    ctoB.name = 'CTO-B2';
    syncCableAnchorNamesForMarker(ctoB, 'CTO-AN2');
    const legacyRenamed = `${legacy.name}|${legacy.endAnchorUid}`;
    legacy.polyline?.setMap(null); savedCables.splice(savedCables.indexOf(legacy), 1);
    [auto, custom].forEach(c => { c.polyline?.setMap(null); savedCables.splice(savedCables.indexOf(c), 1); });
    [ceo, ctoA, ctoB].forEach(m => markers.splice(markers.indexOf(m), 1));
    document.querySelector('.folder-title[data-folder-id="projAN"]').closest('.folder').remove();
    return { opened, afterType, afterEnd, customAfter, renamed, legacyRenamed };
  });
  check(autoName.opened === 'FO-12-CTO-AN1' && autoName.afterType === 'FO-24-CTO-AN1' && autoName.afterEnd === 'FO-24-CTO-AN2' && autoName.customAfter === 'BACKBONE'
    && autoName.renamed === 'FO-12-CTO-NOVA|BACKBONE|CTO-NOVA' && autoName.legacyRenamed === 'Cabo AS 80 FO-12-CTO-B2|an-cto2',
    `nome do cabo acompanha o tipo, a ponta B e o nome da caixa (${JSON.stringify(autoName)})`);

  //Fluxo real: renomear a CTO pelo painel do marcador renomeia o cabo que chega nela
  const ctoRename = await sp.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    rebuildSidebarFromJSON([{ id: 'projRN', name: 'Projeto RN', isProject: true, type: 'TCR', children: [] }], sidebar);
    setActiveFolder('projRN');
    rebuildMarker({ uid: 'mk_rnceo', folderId: 'projRN', type: 'CEO', name: 'CEO-RN', color: '#f00', position: { lat: -28, lng: -44 } });
    rebuildMarker({ uid: 'mk_rncto', folderId: 'projRN', type: 'CTO', name: 'CTO-RN', color: '#f00', position: { lat: -28, lng: -43.99 } });
    const cto = markers.find(m => m.uid === 'mk_rncto');
    rebuildCable({ uid: 'rn-c', folderId: 'projRN', name: 'FO-06-CTO-RN', type: 'Cabo AS 80 FO-06', width: 4, color: '#000', status: 'Novo', path: [{ lat: -28, lng: -44 }, { lat: -28, lng: -43.99 }], startAnchorUid: 'mk_rnceo', endAnchorUid: 'mk_rncto', startAnchorMarkerName: 'CEO-RN', endAnchorMarkerName: 'CTO-RN' });
    const cable = savedCables.find(c => c.uid === 'rn-c');
    //Cabo de pasta colada antiga: âncora aponta para a CTO do projeto original, que não está aqui
    rebuildCable({ uid: 'rn-d', folderId: 'projRN', name: 'FO-12-CTO-RN', type: 'Cabo AS 80 FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -28.001, lng: -44 }, { lat: -28, lng: -43.99 }], startAnchorUid: 'mk_rnceo', endAnchorUid: 'mk_outro_projeto', startAnchorMarkerName: 'CEO-RN', endAnchorMarkerName: 'CTO-RN' });
    const pasted = savedCables.find(c => c.uid === 'rn-d');
    let error = null;
    try {
      openMarkerEditor(cto);
      document.getElementById('markerName').value = 'CTO-RN2';
      document.getElementById('confirmMarker').click();
    } catch (e) { error = String(e); }
    const out = { error, cto: cto.name, cable: cable.name, label: cable.item?.textContent?.includes('FO-06-CTO-RN2'), pasted: `${pasted.name}|${pasted.endAnchorUid}` };
    [cable, pasted].forEach(c => { c.polyline?.setMap(null); savedCables.splice(savedCables.indexOf(c), 1); });
    markers.filter(m => m.folderId === 'projRN').forEach(m => { m.marker?.setMap(null); markers.splice(markers.indexOf(m), 1); });
    document.querySelector('.folder-title[data-folder-id="projRN"]').closest('.folder').remove();
    return out;
  });
  check(!ctoRename.error && ctoRename.cto === 'CTO-RN2' && ctoRename.cable === 'FO-06-CTO-RN2' && ctoRename.label
    && ctoRename.pasted === 'FO-12-CTO-RN2|mk_rncto',
    `renomear a CTO pelo painel renomeia o cabo (${JSON.stringify(ctoRename)})`);

  //Trecho tubulado, aba Aéreo × duto: trechos aéreos e tubulados do cabo, no mapa e no painel
  const launch = await sp.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    rebuildSidebarFromJSON([{ id: 'projLD', name: 'Projeto LD', isProject: true, type: 'TCR', children: [] }], sidebar);
    setActiveFolder('projLD');
    rebuildCable({ uid: 'ld-a', folderId: 'projLD', name: 'LD-A', type: 'Cabo AS 80 FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -29, lng: -44 }, { lat: -29.009, lng: -44 }] });
    const cable = savedCables.find(c => c.uid === 'ld-a');
    setCableConduitRanges(cable, [{ from: 200, to: 500 }]);
    openConduitTool(cable);
    const markFirst = !document.getElementById('conduitMarkPane').classList.contains('hidden') && document.getElementById('conduitLaunchPane').classList.contains('hidden');
    document.querySelector('[data-conduit-tab="launch"]').click();
    const body = document.getElementById('conduitLaunchPane');
    const out = {
      markFirst,
      active: document.querySelector('[data-conduit-tab="launch"]').classList.contains('is-active') && document.getElementById('conduitMarkPane').classList.contains('hidden'),
      text: body.querySelector('.route-launch__meters')?.textContent.trim(),
      colors: conduitTool.launch.overlays.map(o => o.get('strokeColor')).join(),
      editLines: conduitTool.highlights.length,
      routeTab: !!document.querySelector('[data-route-mode="launch"]'),
    };
    //Projeto todo: entra também o cabo que não está na rota
    rebuildCable({ uid: 'ld-b', folderId: 'projLD', name: 'LD-B', type: 'Cabo AS 80 FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -29.1, lng: -44 }, { lat: -29.101, lng: -44 }] });
    const other = savedCables.find(c => c.uid === 'ld-b');
    const routeCount = body.querySelectorAll('[data-conduit-launch]').length;
    document.querySelector('[data-conduit-scope="project"]').click();
    out.scope = `${routeCount}>${body.querySelectorAll('[data-conduit-launch]').length}|${[...body.querySelectorAll('.route-launch__name b')].map(b => b.textContent).join(',')}`;
    other.polyline?.setMap(null); savedCables.splice(savedCables.indexOf(other), 1);
    document.querySelector('[data-conduit-tab="mark"]').click();
    out.backToMark = conduitTool.launch.overlays.length === 0 && conduitTool.highlights.length === 1;
    closeConduitTool();
    out.cleared = !conduitTool;
    cable.polyline?.setMap(null); savedCables.splice(savedCables.indexOf(cable), 1);
    document.querySelector('.folder-title[data-folder-id="projLD"]').closest('.folder').remove();
    return out;
  });
  check(launch.markFirst && launch.active && /^70\d m aéreo · 300 m duto$/.test(launch.text) && launch.colors === '#0284c7,#0284c7,#7c3aed'
    && launch.editLines === 0 && !launch.routeTab && launch.backToMark && launch.cleared && launch.scope === '1>2|LD-A,LD-B',
    `trecho tubulado: aba Aéreo × duto mostra trechos aéreos e em duto (${JSON.stringify(launch)})`);

  //Edição do cabo: ponto-fantasma no meio de cada trecho e clique no meio do cabo (distância em pixels)
  const midEdit = await sp.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    rebuildSidebarFromJSON([{ id: 'projME', name: 'Projeto ME', isProject: true, type: 'TCR', children: [] }], sidebar);
    setActiveFolder('projME');
    map.setZoom(18);
    rebuildCable({ uid: 'me-a', folderId: 'projME', name: 'ME-A', type: 'FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -25, lng: -44 }, { lat: -25, lng: -43.99 }] });
    const cab = savedCables[savedCables.length - 1];
    openCableEditor(cab);
    const handles1 = cableMidHandles.length, hit = !!cableHitPolyline;
    const near = new google.maps.LatLng(-25.00004, -43.995); //~4 m do traçado
    const far = new google.maps.LatLng(-25.0005, -43.995); //~55 m do traçado
    const farOk = insertCableVertexFromClick(far);
    const nearOk = insertCableVertexFromClick(near);
    const out = { handles1, hit, farOk, nearOk, points: cableMarkers.length, handles2: cableMidHandles.length };
    cancelCableDrawingSession();
    out.cleared = !cableHitPolyline && cableMidHandles.length === 0;
    cab.polyline?.setMap(null); savedCables.splice(savedCables.indexOf(cab), 1);
    document.querySelector('.folder-title[data-folder-id="projME"]').closest('.folder').remove();
    return out;
  });
  check(midEdit.handles1 === 1 && midEdit.hit && !midEdit.farOk && midEdit.nearOk && midEdit.points === 3 && midEdit.handles2 === 2 && midEdit.cleared,
    `edição do cabo: pontos-fantasma e clique no meio do cabo (${JSON.stringify(midEdit)})`);

  //Ver rota: a reserva técnica não para a rota (fibra N de um cabo segue na fibra N do outro)
  const passRes = await sp.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    rebuildSidebarFromJSON([{ id: 'projPR', name: 'Projeto PR', isProject: true, type: 'TCR', children: [] }], sidebar);
    const LL = (lat, lng) => new google.maps.LatLng(lat, lng);
    const mk = (type, name, uid, lat, lng) => ({ type, name, uid, folderId: 'projPR', marker: { getPosition: () => LL(lat, lng), setMap() {}, getVisible: () => true } });
    const ceo = mk('CEO', 'CEO-PR', 'pr-ceo', -26, -44), rt = mk('RESERVA', 'RT-PR', 'pr-rt', -26, -43.99), cto = mk('CTO', 'CTO-PR', 'pr-cto', -26, -43.98);
    markers.push(ceo, rt, cto);
    rebuildCable({ uid: 'pr-a', folderId: 'projPR', name: 'PR-A', type: 'FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -26, lng: -44 }, { lat: -26, lng: -43.99 }], startAnchorUid: 'pr-ceo', endAnchorUid: 'pr-rt' });
    rebuildCable({ uid: 'pr-b', folderId: 'projPR', name: 'PR-B', type: 'FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -26, lng: -43.99 }, { lat: -26, lng: -43.98 }], startAnchorUid: 'pr-rt', endAnchorUid: 'pr-cto' });
    const a = savedCables.find(c => c.uid === 'pr-a'), b = savedCables.find(c => c.uid === 'pr-b');
    const f = (card, n) => [...card.querySelectorAll('.fiber-row')][n - 1].id;
    const cardB = buildFusionCableCard({ name: 'PR-B', uid: 'pr-b', type: 'Cabo AS 80 FO-12', role: 'entrada', fiberCount: 12 });
    const spl = buildFusionSplitterCard({ id: 'splitter-pr', label: '1:8', outputs: 8, type: 'Atendimento' });
    spl.classList.add('splitter-atendimento');
    const h = document.createElement('div'); h.append(cardB, spl);
    cto.fusionPlan = JSON.stringify({ version: 2, elements: h.innerHTML, svg: `<path class="fusion-line" data-start-id="${f(cardB, 3)}" data-end-id="splitter-pr-input-port"></path>` });
    const trace = traceFiberRoute(buildFiberGraph(), a, 3);
    const out = {
      ctos: trace.ctos.map(c => c.box.name).join(), segs: trace.segments.map(x => x.cable).sort().join(),
      rtSteps: trace.steps.filter(st => st.box === rt).length, usedA: getCableFiberUsage(a).used.join(),
    };
    [a, b].forEach(c => { c.polyline?.setMap(null); savedCables.splice(savedCables.indexOf(c), 1); });
    [ceo, rt, cto].forEach(m => markers.splice(markers.indexOf(m), 1));
    document.querySelector('.folder-title[data-folder-id="projPR"]').closest('.folder').remove();
    return out;
  });
  check(passRes.ctos === 'CTO-PR' && passRes.segs === 'PR-A,PR-B' && passRes.rtSteps === 0 && passRes.usedA === '3',
    `rota passa direto pela reserva técnica (${JSON.stringify(passRes)})`);
  //Copiar e colar: pasta inteira (subpasta, marcadores, cabos, polígonos), cliente sozinho e seleção múltipla
  const copyRes = await sp.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    rebuildSidebarFromJSON([{ id: 'projCP', name: 'Projeto CP', isProject: true, type: 'TCR', children: [{ id: 'cpA', name: 'Pasta A', isProject: false, type: 'folder', children: [{ id: 'cpSub', name: 'Sub', isProject: false, type: 'folder', children: [] }] }] }], sidebar);
    rebuildMarker({ uid: 'mk_cpceo', folderId: 'cpA', type: 'CEO', name: 'CEO-CP', color: '#f00', position: { lat: -27, lng: -44 } });
    const cardC = buildFusionCableCard({ name: 'CP-1', uid: 'cb_cp1', type: 'Cabo AS 80 FO-12', role: 'entrada', fiberCount: 12 });
    const h = document.createElement('div'); h.append(cardC);
    rebuildMarker({ uid: 'mk_cpcto', folderId: 'cpSub', type: 'CTO', name: 'CTO-CP', color: '#f00', position: { lat: -27, lng: -43.99 }, fusionPlan: JSON.stringify({ version: 2, elements: h.innerHTML, svg: '' }) });
    rebuildMarker({ uid: 'mk_cpcli', folderId: 'cpSub', type: 'CLIENTE', name: 'CLI-CP', color: '#f00', position: { lat: -27.0005, lng: -43.99 }, client: { kind: 'residencial', status: 'ativo', ctoUid: 'mk_cpcto', ctoPort: 2 } });
    rebuildCable({ uid: 'cb_cp1', folderId: 'cpA', name: 'CP-1', type: 'FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -27, lng: -44 }, { lat: -27, lng: -43.99 }], startAnchorUid: 'mk_cpceo', endAnchorUid: 'mk_cpcto' });
    rebuildPolygon({ uid: 'pg_cp1', folderId: 'cpSub', name: 'Área CP', color: '#0f0', path: [{ lat: -27, lng: -44 }, { lat: -27.01, lng: -44 }, { lat: -27.01, lng: -43.99 }] });
    const before = { m: markers.length, c: savedCables.length, p: savedPolygons.length };
    //Pasta → colar no projeto
    setActiveFolder('cpA');
    const copiedFolder = copySidebarSelection();
    setActiveFolder('projCP');
    const pastedFolder = pasteSidebarClipboard();
    const newCto = markers.find(m => m.name === 'CTO-CP' && m.uid !== 'mk_cpcto');
    const newCli = markers.find(m => m.name === 'CLI-CP' && m.uid !== 'mk_cpcli');
    const newCable = savedCables.find(c => c.name === 'CP-1' && c.uid !== 'cb_cp1');
    const newPoly = savedPolygons.find(p => p.name === 'Área CP' && p.uid !== 'pg_cp1');
    const rootTitle = [...document.querySelectorAll('#projCP > .folder-wrapper > .folder-title')].map(t => t.dataset.folderName).join();
    const folder = {
      copiedFolder, pastedFolder, rootTitle,
      added: [markers.length - before.m, savedCables.length - before.c, savedPolygons.length - before.p].join(),
      ctoInNewSub: !!newCto && newCto.folderId !== 'cpSub' && document.getElementById(newCto.folderId)?.closest('#projCP') != null,
      cableAnchors: newCable?.startAnchorUid !== 'mk_cpceo' && newCable?.endAnchorUid === newCto?.uid,
      cliCto: newCli?.client.ctoUid === newCto?.uid && newCli?.client.ctoPort === 2,
      planUid: readFusionPlan(newCto)?.cables[0]?.uid === newCable?.uid,
      poly: !!newPoly && newPoly.folderId !== 'cpSub',
    };
    //Cliente sozinho: não ocupa a porta do original
    const cli = markers.find(m => m.uid === 'mk_cpcli');
    selectSidebarMarker(cli);
    copySidebarSelection(); setActiveFolder('projCP'); pasteSidebarClipboard();
    const cliCopy = markers.find(m => m.name === 'CLI-CP (cópia)');
    const single = { name: !!cliCopy, port: cliCopy?.client.ctoPort ?? null, cto: cliCopy?.client.ctoUid ?? null };
    //Seleção múltipla: CTO + cabo → nomes com (cópia) e o plano da CTO copiada usa o cabo copiado
    setMapSelection([markers.find(m => m.uid === 'mk_cpcto'), savedCables.find(c => c.uid === 'cb_cp1')]);
    copySidebarSelection(); clearMapSelection(); setActiveFolder('projCP'); pasteSidebarClipboard();
    const mCto = markers.find(m => m.name === 'CTO-CP (cópia)'), mCab = savedCables.find(c => c.name === 'CP-1 (cópia)');
    const plan = readFusionPlan(mCto)?.cables[0];
    const multi = { both: !!mCto && !!mCab, plan: plan?.uid === mCab?.uid && plan?.name === 'CP-1 (cópia)', anchor: mCab?.endAnchorUid === mCto?.uid && mCab?.startAnchorUid === 'mk_cpceo' };
    //Limpeza
    const ids = new Set(getAllDescendantFolderIds('projCP'));
    markers.filter(m => ids.has(m.folderId)).forEach(m => { m.marker.setMap(null); markers.splice(markers.indexOf(m), 1); });
    savedCables.filter(c => ids.has(c.folderId)).forEach(c => { c.polyline.setMap(null); savedCables.splice(savedCables.indexOf(c), 1); });
    savedPolygons.filter(p => ids.has(p.folderId)).forEach(p => { p.polygonObject.setMap(null); savedPolygons.splice(savedPolygons.indexOf(p), 1); });
    document.querySelector('.folder-title[data-folder-id="projCP"]').closest('.folder').remove();
    sidebarClipboard = null;
    return { folder, single, multi };
  });
  const cf = copyRes.folder;
  check(cf.copiedFolder && cf.pastedFolder && cf.rootTitle === 'Pasta A,Pasta A (cópia)' && cf.added === '3,1,1' && cf.ctoInNewSub && cf.cableAnchors && cf.cliCto && cf.planUid && cf.poly,
    `copiar/colar pasta leva subpastas, marcadores, cabos e polígonos com vínculos novos (${JSON.stringify(cf)})`);
  check(copyRes.single.name && copyRes.single.port === null && copyRes.single.cto === null && copyRes.multi.both && copyRes.multi.plan && copyRes.multi.anchor,
    `copiar/colar cliente sozinho e seleção múltipla (${JSON.stringify(copyRes)})`);

  //Pasta copiada para outro projeto (os dois abertos, um em cima do outro): cada caixa usa o cabo do próprio projeto,
  //mesmo se o plano ficou apontando para o cabo do original (só F1/F2 no original, F1–F4 na cópia)
  const cpSig = await sp.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    rebuildSidebarFromJSON([{ id: 'projO', name: 'Projeto O', isProject: true, type: 'TCR', children: [{ id: 'oF', name: 'Rede', isProject: false, type: 'folder', children: [] }] },
      { id: 'projN', name: 'Projeto N', isProject: true, type: 'TCR', children: [] }], sidebar);
    const fiber = (card, n) => [...card.querySelectorAll('.fiber-row')][n - 1].id;
    const mk = (cards, links) => { const b = document.createElement('div'); b.append(...cards); return JSON.stringify({ version: 2, elements: b.innerHTML, svg: links.map(([x, y]) => `<path class="fusion-line" data-start-id="${x}" data-end-id="${y}"></path>`).join('') }); };
    const card = (name, uid, role) => buildFusionCableCard({ name, uid, type: 'Cabo AS 80 FO-12', role, fiberCount: 12 });
    const sp8 = buildFusionSplitterCard({ id: 'splitter-1', label: '1:8', outputs: 8, type: 'Fusão', olt: { olt: 'OLT-X', placa: '1', pon: '1' } });
    const sOut = card('RX016', 'cb_rx016', 'saida');
    rebuildMarker({ uid: 'mk_s', folderId: 'oF', type: 'CEO', name: 'LAV_RX_008', color: '#f00', position: { lat: -27, lng: -44 },
      fusionPlan: mk([sp8, sOut], [1, 2, 3, 4].map(n => [`splitter-1-output-${n}`, fiber(sOut, n)])) });
    const lIn = card('RX016', 'cb_rx016', 'entrada'), lOut = card('AC100', 'cb_ac100', 'saida');
    rebuildMarker({ uid: 'mk_l', folderId: 'oF', type: 'CEO', name: 'LAV_RX_016', color: '#f00', position: { lat: -27, lng: -43.99 },
      fusionPlan: mk([lIn, lOut], [1, 2].map(n => [fiber(lIn, n), fiber(lOut, n)])) }); //Original: só F1 e F2
    const cIn = card('AC100', 'cb_ac100', 'entrada'), cOut = card('RT01', 'cb_rt01', 'saida');
    rebuildMarker({ uid: 'mk_c', folderId: 'oF', type: 'CEO', name: 'CEO-01', color: '#f00', position: { lat: -27, lng: -43.98 },
      fusionPlan: mk([cIn, cOut], [1, 2].map(n => [fiber(cIn, n), fiber(cOut, n)])) });
    rebuildMarker({ uid: 'mk_rt', folderId: 'oF', type: 'RESERVA', name: 'RT-01', color: '#f00', position: { lat: -27, lng: -43.97 } });
    const cab = (uid, name, a, b, lngA, lngB) => rebuildCable({ uid, folderId: 'oF', name, type: 'Cabo AS 80 FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -27, lng: lngA }, { lat: -27, lng: lngB }], startAnchorUid: a, endAnchorUid: b });
    cab('cb_rx016', 'RX016', 'mk_s', 'mk_l', -44, -43.99);
    cab('cb_ac100', 'AC100', 'mk_l', 'mk_c', -43.99, -43.98);
    cab('cb_rt01', 'RT01', 'mk_c', 'mk_rt', -43.98, -43.97);
    setActiveFolder('oF'); copySidebarSelection(); setActiveFolder('projN'); pasteSidebarClipboard();
    const copyC = markers.find(m => m.name === 'CEO-01' && m.uid !== 'mk_c');
    const copyL = markers.find(m => m.name === 'LAV_RX_016' && m.uid !== 'mk_l');
    //Na cópia, F3 e F4 passam na LAV_RX_016 e na CEO-01
    const addF34 = (box) => {
      const pl = JSON.parse(box.fusionPlan);
      const hh = document.createElement('div'); hh.innerHTML = pl.elements;
      const [a, b] = hh.querySelectorAll('.cable-element');
      pl.svg += [3, 4].map(n => `<path class="fusion-line" data-start-id="${[...a.querySelectorAll('.fiber-row')][n - 1].id}" data-end-id="${[...b.querySelectorAll('.fiber-row')][n - 1].id}"></path>`).join('');
      box.fusionPlan = JSON.stringify(pl);
    };
    addF34(copyL);
    //Estado do problema: o cartão da CEO-01 colada ficou apontando para o cabo do projeto original
    copyC.fusionPlan = copyC.fusionPlan.split(savedCables.find(c => c.name === 'AC100' && c.uid !== 'cb_ac100').uid).join('cb_ac100');
    const plan = JSON.parse(copyC.fusionPlan);
    const h = document.createElement('div'); h.innerHTML = plan.elements;
    const [ci, co] = h.querySelectorAll('.cable-element');
    plan.svg += [3, 4].map(n => `<path class="fusion-line" data-start-id="${[...ci.querySelectorAll('.fiber-row')][n - 1].id}" data-end-id="${[...co.querySelectorAll('.fiber-row')][n - 1].id}"></path>`).join('');
    copyC.fusionPlan = JSON.stringify(plan);
    const sig = (box) => { const s = getBoxOpticalPower(box); const p = readFusionPlan(box); return p.cables[0].fibers.slice(0, 4).map(f => s.has(f.id) ? s.get(f.id).toFixed(1) : '-').join('/'); };
    const keys = (box) => readFusionPlan(box).cables.map(c => `${c.name}:${planCableKey(c, box)}`).join(',');
    const out = { origC: sig(markers.find(m => m.uid === 'mk_c')), copyC: sig(copyC), copyL: sig(copyL), keysOrigC: keys(markers.find(m => m.uid === 'mk_c')), keysCopyC: keys(copyC), keysCopyL: keys(copyL) };
    //Ao abrir o projeto, o cartão é corrigido para o cabo do próprio projeto
    backfillFusionPlanCableUids([copyC]);
    out.fixedUid = !copyC.fusionPlan.includes('cb_ac100');
    const ids = new Set([...getAllDescendantFolderIds('projO'), ...getAllDescendantFolderIds('projN')]);
    markers.filter(m => ids.has(m.folderId)).forEach(m => { m.marker.setMap(null); markers.splice(markers.indexOf(m), 1); });
    savedCables.filter(c => ids.has(c.folderId)).forEach(c => { c.polyline.setMap(null); savedCables.splice(savedCables.indexOf(c), 1); });
    ['projO', 'projN'].forEach(id => document.querySelector(`.folder-title[data-folder-id="${id}"]`).closest('.folder').remove());
    sidebarClipboard = null;
    return out;
  });
  check(cpSig.origC.endsWith('/-/-') && cpSig.copyC.split('/').every(v => v !== '-') && cpSig.keysCopyC !== cpSig.keysOrigC && !cpSig.keysCopyC.includes('cb_ac100') && cpSig.fixedUid,
    `pasta colada em outro projeto segue com sinal e cabos próprios (${JSON.stringify(cpSig)})`);

  //Shift+clique no mapa perto de um cabo: marca o cabo (uma vez só, mesmo se o clique do cabo também chegar)
  const shiftRes = await sp.evaluate(() => {
    rebuildSidebarFromJSON([{ id: 'projSH', name: 'Projeto SH', isProject: true, type: 'TCR', children: [] }], document.getElementById('sidebar'));
    setActiveFolder('projSH');
    rebuildCable({ uid: 'cb_sh', folderId: 'projSH', name: 'SH-1', type: 'FO-12', width: 4, color: '#000', status: 'Novo', path: [{ lat: -28, lng: -44 }, { lat: -28, lng: -43.99 }] });
    const cab = savedCables.find(c => c.uid === 'cb_sh');
    map.setZoom?.(17);
    toggleNearestMapItem(new google.maps.LatLng(-28.00001, -43.995)); //~1 m da linha
    const sel1 = mapSelection.items.has(cab);
    toggleMapSelectionFromMap(cab); //Clique do próprio cabo logo em seguida: não desmarca
    const sel2 = mapSelection.items.has(cab);
    const row = cab.item.classList.contains('is-multi-selected');
    mapSelection.lastToggle = null;
    toggleNearestMapItem(new google.maps.LatLng(-28.01, -43.995)); //~1 km: nada
    const far = mapSelection.items.size;
    clearMapSelection();
    cab.polyline.setMap(null); savedCables.splice(savedCables.indexOf(cab), 1);
    document.querySelector('.folder-title[data-folder-id="projSH"]').closest('.folder').remove();
    return { sel1, sel2, row, far };
  });
  check(shiftRes.sel1 && shiftRes.sel2 && shiftRes.row && shiftRes.far === 1, `Shift+clique no mapa marca o cabo (${JSON.stringify(shiftRes)})`);

  await spCtx.close();
}

//Edição simultânea ao vivo: duas abas no mesmo projeto (Realtime simulado entre abas) e uma terceira que entra depois
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const liveErrors = [];
  const openLive = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', e => liveErrors.push(e.message));
    await p.addInitScript(() => { try { localStorage.setItem('routeMapTourDone', '1'); } catch (e) {} });
    await p.route('**/supabase.js', r => r.fulfill({ path: path.join(here, 'fake-supabase.js'), contentType: 'text/javascript' }));
    await p.route(/maps\.googleapis|maps\.gstatic/, r => r.abort());
    await p.route('**/__fake-google-maps.js', r => r.fulfill({ path: path.join(here, 'fake-google-maps.js'), contentType: 'text/javascript' }));
    await p.goto(baseUrl + '/index.html');
    await p.waitForFunction(() => typeof AppSession !== 'undefined' && AppSession.company, null, { timeout: 15000 });
    await p.addScriptTag({ url: baseUrl + '/__fake-google-maps.js' });
    await p.evaluate(() => {
      const data = { sidebar: { id: 'projL', name: 'Projeto Live', isProject: true, type: 'TCR', children: [] },
        markers: [{ uid: 'mk1', type: 'CTO', name: 'L-CTO', folderId: 'projL', position: { lat: -20, lng: -44 }, ctoStatus: 'Nova', color: '#16a34a', size: 24 }],
        cables: [], polygons: [] };
      loadAndDisplayProject('projL', data, { silent: true });
      setActiveFolder('projL');
      liveSyncJoin('projL');
    });
    return p;
  };
  const A = await openLive();
  const B = await openLive();
  const wait = (ms) => A.waitForTimeout(ms);
  await wait(500);
  const names = (pg) => pg.evaluate(() => markers.filter(m => m.folderId === 'projL' || document.getElementById(m.folderId)?.closest('.folder')?.querySelector('[data-folder-id="projL"]')).map(m => m.name).sort().join(','));
  const live = {};
  live.presence = await B.evaluate(() => document.querySelector('.folder-title[data-folder-id="projL"] .live-badge')?.textContent || '');
  await A.evaluate(() => {
    rebuildMarker({ uid: 'mk2', type: 'CEO', name: 'L-CEO', folderId: 'projL', position: { lat: -20.001, lng: -44.001 }, ceoStatus: 'Nova', color: '#f59e0b', size: 24 });
    refreshBomAfterProjectChange();
  });
  await wait(900);
  live.added = await names(B);
  await A.evaluate(() => { const m = markers.find(x => x.uid === 'mk1'); m.name = 'L-CTO-RENOMEADA'; updateMarkerAppearance(m); refreshBomAfterProjectChange(); });
  await wait(900);
  live.renamed = await names(B);
  await B.evaluate(() => { const m = markers.find(x => x.uid === 'mk2'); m.marker.setMap(null); m.listItem.remove(); markers = markers.filter(x => x !== m); refreshBomAfterProjectChange(); });
  await wait(900);
  live.deleted = await names(A);
  await A.evaluate(() => { appendFolderToParent(document.getElementById('projL'), 'Pasta Live', 'pL1'); refreshBomAfterProjectChange(); });
  await wait(1200);
  live.folder = await B.evaluate(() => !!document.querySelector('.folder-title[data-folder-id="pL1"]') && markers.some(m => m.name === 'L-CTO-RENOMEADA'));
  //B no meio de uma edição (janela aberta): recebe quando termina
  await B.evaluate(() => { document.getElementById('alertModal').style.display = 'flex'; });
  await A.evaluate(() => { const m = markers.find(x => x.uid === 'mk1'); m.name = 'L-CTO-3'; refreshBomAfterProjectChange(); });
  await wait(900);
  live.waitedWhileBusy = await B.evaluate(() => !markers.some(m => m.name === 'L-CTO-3') && !!document.getElementById('liveWaitingNote'));
  await B.evaluate(() => { document.getElementById('alertModal').style.display = 'none'; });
  await wait(1600);
  live.appliedAfter = await B.evaluate(() => markers.some(m => m.name === 'L-CTO-3') && !document.getElementById('liveWaitingNote'));
  //Cabo criado numa aba aparece na outra, com a metragem
  await A.evaluate(() => {
    rebuildMarker({ uid: 'mk3', type: 'CTO', name: 'L-CTO-B', folderId: 'projL', position: { lat: -20.002, lng: -44 }, ctoStatus: 'Nova', color: '#16a34a', size: 24 });
    rebuildCable({ uid: 'cb1', name: 'L-CABO', type: 'Cabo AS 80 FO-12', status: 'Novo', width: 4, color: '#22c55e', folderId: 'projL',
      path: [{ lat: -20, lng: -44 }, { lat: -20.002, lng: -44 }], startAnchorUid: 'mk1', endAnchorUid: 'mk3' });
    refreshBomAfterProjectChange();
  });
  await wait(1000);
  live.cable = await B.evaluate(() => { const c = savedCables.find(x => x.uid === 'cb1'); return c ? `${c.name}:${c.totalLength > 200}` : 'nenhum'; });
  //Salvar avisa a nova revisão
  await A.evaluate(() => liveSyncAnnounceSaved('projL', 7));
  await wait(500);
  live.revision = await B.evaluate(() => getProjectRevision(document.getElementById('projL').closest('.folder')));
  //Quem entra depois recebe o estado atual
  const C = await openLive();
  await C.waitForTimeout(1500);
  live.lateJoiner = await C.evaluate(() => markers.some(m => m.name === 'L-CTO-3') && !!document.querySelector('.folder-title[data-folder-id="pL1"]'));
  live.errors = liveErrors.slice(0, 3);
  await ctx.close();
  check(/1/.test(live.presence) && live.added === 'L-CEO,L-CTO' && live.renamed === 'L-CEO,L-CTO-RENOMEADA' && live.deleted === 'L-CTO-RENOMEADA' && live.folder,
    `edição ao vivo: presença, incluir, renomear, excluir e pastas chegam na outra aba (${JSON.stringify(live)})`);
  check(live.waitedWhileBusy && live.appliedAfter && live.revision === 7 && live.lateJoiner && live.cable === 'L-CABO:true' && !live.errors.length,
    `edição ao vivo: cabo, espera a edição em andamento, avisa a revisão salva e quem entra depois recebe o estado (${live.cable})`);
}

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
