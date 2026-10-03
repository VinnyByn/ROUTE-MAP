// Teste de fumaça do site: abre index.html num Chromium com Supabase simulado e Google Maps bloqueado
// e confere se carrega sem erros e se as partes principais funcionam. Uso: node tests/smoke.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const failures = [];
const check = (ok, message) => { console.log(`${ok ? '✓' : '✗'} ${message}`); if (!ok) failures.push(message); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.route('**/supabase.js', r => r.fulfill({ path: path.join(here, 'fake-supabase.js'), contentType: 'text/javascript' }));
await page.route(/maps\.googleapis|maps\.gstatic/, r => r.abort());
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto('file://' + path.join(root, 'index.html'));
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

await browser.close();
if (failures.length) { console.error(`\n${failures.length} verificação(ões) falharam.`); process.exit(1); }
console.log('\nTudo certo.');
