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

const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
watchCsp(page);
await page.route('**/supabase.js', r => r.fulfill({ path: path.join(here, 'fake-supabase.js'), contentType: 'text/javascript' }));
await page.route(/maps\.googleapis|maps\.gstatic/, r => r.abort());
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(baseUrl + '/index.html');
await page.waitForFunction(() => typeof AppSession !== 'undefined' && AppSession.company, null, { timeout: 15000 });
await page.waitForTimeout(800);

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
  const fns = ['saveActiveProject', 'openProjectFromDatabase', 'buildProjectRecord', 'serializeMarker', 'rebuildCable', 'openReportModal', 'showProjectReportDetails', 'buildReportPreviewFlowBlocks', 'startSketch', 'finishPolygonSketch', 'formatDistance'];
  const missing = fns.filter(n => typeof window[n] !== 'function');
  let error = null;
  try { openReportModal(); } catch (e) { error = e.message; }
  const opened = getComputedStyle(document.getElementById('reportModal')).display !== 'none';
  document.getElementById('reportModal').style.display = 'none';
  return { missing, error, opened, distance: formatDistance(1234.5) };
});
check(!report.missing.length, `salvar/abrir projeto, relatório e régua disponíveis${report.missing.length ? ' (faltando: ' + report.missing.join(', ') + ')' : ''}`);
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
