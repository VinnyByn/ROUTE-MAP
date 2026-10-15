// Primeiros passos da empresa (administrador): planilha de preços, preços no catálogo, materiais e regras de
// cálculo, logo e dados, equipe. Abre sozinho na empresa nova enquanto falta algo; reabre pelo menu Materiais.
// Depende de js/catalog/catalog.js (catálogo e configurações) e js/auth/account.js (Minha conta).

const COMPANY_SETUP_STORAGE_PREFIX = 'routeMapCompanySetup:';

function readCompanySetupState() {
    try { return JSON.parse(localStorage.getItem(COMPANY_SETUP_STORAGE_PREFIX + (AppSession.company?.id || '')) || '{}') || {}; } catch (e) { return {}; }
}

function writeCompanySetupState(patch) {
    const state = { ...readCompanySetupState(), ...patch };
    try { localStorage.setItem(COMPANY_SETUP_STORAGE_PREFIX + (AppSession.company?.id || ''), JSON.stringify(state)); } catch (e) { /* sem armazenamento */ }
    return state;
}

//Abre o catálogo em Regras de cálculo, rolando até o cartão pedido
function openCatalogConfigCard(id) {
    openMaterialCatalogModal();
    setCatalogTab('config');
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
}

function getCompanySetupSteps() {
    const visited = readCompanySetupState().visited || {};
    const branding = getCompanyBranding();
    const visit = (id) => writeCompanySetupState({ visited: { ...visited, [id]: true } });
    return [
        { id: 'sheet', title: 'Planilha de preços', text: 'Informe o link da planilha do Google com os preços da empresa.',
            done: !!getCompanySheets().prices, action: () => openCatalogConfigCard('companySheetsCard') },
        { id: 'prices', title: 'Preços no catálogo', text: 'Traga os preços da planilha ("Atualizar da planilha") ou importe um Excel.',
            done: materialCatalog.materials.some(m => Number(m.price) > 0), action: () => { openMaterialCatalogModal(); setCatalogTab('materials'); } },
        { id: 'rules', title: 'Materiais e regras de cálculo', text: 'Confira qual material entra para cada caixa e cabo, as reservas, os kits e a mão de obra.',
            done: !!visited.rules || Object.keys(companyMaterialAliases).length > 0, action: () => { visit('rules'); openCatalogConfigCard('materialRulesList'); } },
        { id: 'brand', title: 'Logo e dados da empresa', text: 'Aparecem no topo do relatório e do PDF.',
            done: !!(branding.logo || branding.address || branding.phone || branding.contact), action: () => openAccountModal('company') },
        { id: 'team', title: 'Convidar a equipe', text: 'Projetistas e visualizadores entram por convite, com o e-mail de cada um.',
            done: !!visited.team, action: () => { visit('team'); openAccountModal('team'); } },
    ];
}

function renderCompanySetup() {
    const box = document.getElementById('companySetupBox');
    if (!box || box.classList.contains('hidden')) return;
    const steps = getCompanySetupSteps();
    const done = steps.filter(s => s.done).length;
    document.getElementById('companySetupSubtitle').textContent = `${done} de ${steps.length} concluídos`;
    document.getElementById('companySetupProgress').style.width = `${Math.round((done / steps.length) * 100)}%`;
    const list = document.getElementById('companySetupList');
    list.innerHTML = steps.map((step, i) => `
        <li class="company-setup__step${step.done ? ' is-done' : ''}">
            <span class="company-setup__mark" aria-hidden="true">${step.done ? '✓' : i + 1}</span>
            <div><strong>${escapeHtml(step.title)}</strong><small>${escapeHtml(step.text)}</small></div>
            <button type="button" class="map-tool-btn" data-company-setup="${step.id}">${step.done ? 'Ver' : 'Fazer'}</button>
        </li>`).join('');
    list.querySelectorAll('[data-company-setup]').forEach(button => {
        button.addEventListener('click', () => {
            steps.find(s => s.id === button.dataset.companySetup)?.action();
            renderCompanySetup();
        });
    });
    if (done === steps.length) writeCompanySetupState({ completed: true });
}

function openCompanySetup() {
    if (!AppSession.isAdmin) return;
    document.getElementById('companySetupBox')?.classList.remove('hidden');
    renderCompanySetup();
}

function closeCompanySetup() {
    document.getElementById('companySetupBox')?.classList.add('hidden');
}

//Empresa nova: abre sozinho depois do tour (se houver), enquanto falta algo e não foi dispensado
function maybeShowCompanySetup() {
    if (!AppSession.isAdmin || !materialCatalog.blankSeed) return;
    const state = readCompanySetupState();
    if (state.dismissed || state.completed || getCompanySetupSteps().every(s => s.done)) return;
    let tries = 0;
    const wait = () => {
        if (document.getElementById('tourLayer') && tries++ < 120) return setTimeout(wait, 1000);
        openCompanySetup();
    };
    setTimeout(wait, 1200);
}

//Chamado quando algo dos passos muda (planilha, preços, empresa)
function refreshCompanySetup() {
    renderCompanySetup();
}

(function setupCompanySetup() {
    document.getElementById('closeCompanySetup')?.addEventListener('click', closeCompanySetup);
    document.getElementById('dismissCompanySetup')?.addEventListener('click', () => {
        writeCompanySetupState({ dismissed: true });
        closeCompanySetup();
        showToast('Primeiros passos', 'Para ver de novo: menu Materiais › Primeiros passos da empresa.');
    });
    document.getElementById('companySetupMenuItem')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('materialsDropdown')?.classList.remove('show');
        openCompanySetup();
    });
    //Volta para a janela (depois de importar preços, salvar a empresa…): atualiza o que já foi feito
    window.addEventListener('focus', renderCompanySetup);
    document.addEventListener('click', () => setTimeout(renderCompanySetup, 80));
})();
