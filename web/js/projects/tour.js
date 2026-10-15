// Tour pelo sistema (primeiro acesso ou menu da conta) e tecla "?" para a lista de atalhos.
// Boas-vindas, passos que destacam cada parte da tela (abrindo o menu quando o passo é um menu) e um fim com dicas.
// Os passos seguem o cargo: quem só visualiza não vê as ferramentas de edição; o administrador vê a equipe online.

const canEditForTour = () => typeof AppSession === 'undefined' || AppSession.canEdit !== false;
const isAdminForTour = () => typeof AppSession !== 'undefined' && !!AppSession.isAdmin;

const TOUR_STEPS = [
    { target: '#sidebar', icon: 'folder', title: 'Projetos e pastas',
        text: 'Aqui ficam os projetos abertos, as pastas e cada caixa, cabo e cliente. Clique direito em qualquer linha para ver as ações; arraste para reorganizar.' },
    { target: '#projectButton', menu: '#projectDropdown', icon: 'project', title: 'Menu Projeto',
        text: 'Criar, abrir e salvar projetos, importar KML, exportar planilha e plano de fusão, desfazer e verificar o projeto antes de entregar.' },
    { target: '#toolsButton', menu: '#toolsDropdown', icon: 'tools', title: 'Ferramentas', when: canEditForTour,
        text: 'Desenhe cabos e polígonos, meça distâncias e adicione marcadores. Em Marcador, "Marcar vários seguidos" coloca uma caixa ou cliente atrás do outro, com os nomes em sequência.' },
    { target: '#autoDesignMenuButton', menu: '#toolsDropdown', icon: 'cto', title: 'Pré-projeto automático', when: canEditForTour,
        text: 'Desenhe a área e diga quantas casas tem: o sistema sugere CTOs, CEOs e cabos pelas ruas, considera as caixas que já existem e mostra até 3 opções com o custo. Nada é salvo até você aceitar.' },
    { target: '#materialsMenuButton', menu: '#materialsDropdown', icon: 'package', title: 'Materiais',
        text: 'Lista de materiais e mão de obra do projeto, já com os preços e kits da sua empresa.' },
    { target: '#projectReportButton', icon: 'report', title: 'Relatório',
        text: 'Relatório completo do projeto, com o logo da empresa, para imprimir ou gerar PDF.' },
    { target: '#openSearchModalButton', icon: 'search', title: 'Busca', keys: ['Ctrl', 'K'],
        text: 'Encontre qualquer caixa, cliente, código, cabo, endereço ou coordenada e vá direto para ele no mapa.' },
    { target: '#map', icon: 'marker', title: 'Mapa',
        text: 'Clique numa caixa para editar ou abrir o plano de fusão; botão direito mostra as ações. Shift + arrastar seleciona vários itens de uma vez.' },
    { target: '#onlineChip', icon: 'users', title: 'Equipe online', when: isAdminForTour,
        text: 'Quem da equipe está usando o sistema agora e em qual projeto. Clique para gerenciar a equipe.' },
    { target: '#userMenuButton', menu: '#userDropdown', icon: 'user', title: 'Sua conta',
        text: 'Perfil, senha e verificação em 2 etapas, preferências e atalhos. O administrador também cuida da empresa e da equipe por aqui.' },
];
const TOUR_DONE_KEY = 'routeMapTourDone';
let tourIndex = -1;
let tourOpenMenu = null;

const tourIcon = (name) => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const tourKeys = (keys) => keys.map(k => `<kbd>${escapeHtml(k)}</kbd>`).join('<i>+</i>');

function markTourDone() {
    try { localStorage.setItem(TOUR_DONE_KEY, '1'); } catch (e) { /* sem armazenamento */ }
    if (typeof supabaseClient !== 'undefined' && supabaseClient?.auth?.updateUser) {
        supabaseClient.auth.updateUser({ data: { tour_done: true } }).catch(() => {});
    }
}

//Passo disponível: o cargo permite e o elemento (ou o botão do menu dele) está na tela
function getTourSteps() {
    return TOUR_STEPS.filter(step => {
        if (step.when && !step.when()) return false;
        const anchor = step.menu ? document.querySelector(step.menu)?.parentElement : document.querySelector(step.target);
        return !!anchor?.getClientRects().length && !!document.querySelector(step.target);
    });
}

//welcome = true no primeiro acesso: começa pela tela de boas-vindas
function startTour(options = {}) {
    markTourDone();
    document.querySelectorAll('.dropdown-content.show, .user-menu.show').forEach(el => el.classList.remove('show'));
    document.querySelectorAll('.dropdown.dropdown-open').forEach(el => el.classList.remove('dropdown-open'));
    const accountModal = document.getElementById('accountModal');
    if (accountModal) accountModal.style.display = 'none';
    document.getElementById('tourLayer')?.remove();
    const layer = document.createElement('div');
    layer.id = 'tourLayer';
    layer.className = 'tour-layer';
    layer.innerHTML = `<div class="tour-spot"></div><div class="tour-pop" role="dialog" aria-modal="true" aria-live="polite" aria-labelledby="tourTitle"></div>`;
    document.body.appendChild(layer);
    //Os cliques no tour não chegam ao documento (senão fechariam o menu que o passo abriu)
    layer.addEventListener('click', (e) => {
        e.stopPropagation();
        const button = e.target.closest('[data-tour]');
        const action = button?.dataset.tour;
        if (action === 'skip' || action === 'done') endTour();
        if (action === 'start') showTourStep(0);
        if (action === 'prev') showTourStep(tourIndex - 1);
        if (action === 'next') showTourStep(tourIndex + 1);
        if (action === 'goto') showTourStep(Number(button.dataset.step));
        if (action === 'shortcuts') { endTour(); openShortcutsList(); }
        if (action === 'setup') { endTour(); if (typeof openCompanySetup === 'function') openCompanySetup(); }
    });
    if (options.welcome) showTourWelcome();
    else showTourStep(0);
}

function setTourMenu(selector) {
    if (tourOpenMenu && tourOpenMenu !== selector) {
        const old = document.querySelector(tourOpenMenu);
        old?.classList.remove('show');
        old?.closest('.dropdown')?.classList.remove('dropdown-open');
    }
    tourOpenMenu = selector || null;
    if (!selector) return;
    const menu = document.querySelector(selector);
    if (!menu) return;
    menu.classList.add('show');
    menu.closest('.dropdown')?.classList.add('dropdown-open');
    //Mesma posição de quando o menu é aberto pelo botão
    const button = menu.closest('.dropdown')?.querySelector('.top-bar-button');
    if (button && typeof positionDropdownMenu === 'function') positionDropdownMenu(button, menu);
}

//Telas de boas-vindas e de fim: balão no meio, sem destaque
function showTourCard(html) {
    const layer = document.getElementById('tourLayer');
    if (!layer) return;
    setTourMenu(null);
    tourIndex = -2;
    layer.classList.add('is-card');
    const pop = layer.querySelector('.tour-pop');
    pop.className = 'tour-pop tour-pop--card';
    pop.removeAttribute('style');
    delete pop.dataset.side;
    pop.innerHTML = html;
    pop.querySelector('.is-primary')?.focus();
}

function showTourWelcome() {
    const first = String(AppSession?.profile?.full_name || '').trim().split(/\s+/)[0];
    const parts = getTourSteps().map(s => `<li>${tourIcon(s.icon)}${escapeHtml(s.title)}</li>`).join('');
    showTourCard(`
        <div class="tour-hero" aria-hidden="true">${tourIcon('route')}</div>
        <strong class="tour-title" id="tourTitle">${first ? `Olá, ${escapeHtml(first)}!` : 'Boas-vindas!'}</strong>
        <p class="tour-text">Este é o ROUTE MAP${AppSession?.company?.name ? ` da ${escapeHtml(AppSession.company.name)}` : ''}. Em 1 minuto você conhece as partes principais:</p>
        <ul class="tour-parts">${parts}</ul>
        <div class="tour-actions"><button type="button" data-tour="skip">Agora não</button><span></span><button type="button" data-tour="start" class="is-primary">Começar o tour</button></div>
        <small class="tour-foot">Dá para ver de novo quando quiser, no menu da conta.</small>`);
}

function showTourEnd() {
    const setup = isAdminForTour() && document.getElementById('companySetupMenuItem') && typeof openCompanySetup === 'function';
    showTourCard(`
        <div class="tour-hero tour-hero--done" aria-hidden="true">${tourIcon('check')}</div>
        <strong class="tour-title" id="tourTitle">Pronto, você já conhece o básico!</strong>
        <p class="tour-text">Três atalhos que poupam tempo:</p>
        <ul class="tour-tips">
            <li>${tourKeys(['Ctrl', 'K'])}<span>Busca qualquer caixa, cliente ou endereço</span></li>
            <li>${tourKeys(['Ctrl', 'Z'])}<span>Desfaz a última alteração do projeto</span></li>
            <li>${tourKeys(['?'])}<span>Mostra todos os atalhos do teclado</span></li>
        </ul>
        <div class="tour-actions">
            ${setup ? '<button type="button" data-tour="setup">Primeiros passos da empresa</button>' : '<button type="button" data-tour="shortcuts">Ver atalhos</button>'}
            <span></span><button type="button" data-tour="done" class="is-primary">Concluir</button>
        </div>
        <small class="tour-foot">O tour fica no menu da conta para ver de novo.</small>`);
}

function showTourStep(i) {
    const layer = document.getElementById('tourLayer');
    if (!layer) return;
    const steps = getTourSteps();
    if (i >= steps.length) return showTourEnd();
    if (!steps.length) return endTour();
    tourIndex = Math.max(0, i);
    const step = steps[tourIndex];
    layer.classList.remove('is-card');
    setTourMenu(step.menu);
    //Destaque: o elemento (e o menu aberto junto, quando o passo é o botão do menu)
    const rects = [document.querySelector(step.target).getBoundingClientRect()];
    if (step.menu && document.querySelector(step.menu)?.contains(document.querySelector(step.target)) === false) {
        rects.push(document.querySelector(step.menu).getBoundingClientRect());
    }
    const rect = {
        left: Math.min(...rects.map(r => r.left)), top: Math.min(...rects.map(r => r.top)),
        right: Math.max(...rects.map(r => r.right)), bottom: Math.max(...rects.map(r => r.bottom)),
    };
    rect.width = rect.right - rect.left;
    rect.height = rect.bottom - rect.top;
    const spot = layer.querySelector('.tour-spot');
    const pad = 6;
    Object.assign(spot.style, { left: `${rect.left - pad}px`, top: `${rect.top - pad}px`, width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px` });
    const last = tourIndex === steps.length - 1;
    const dots = steps.map((s, n) => `<button type="button" class="tour-dot${n === tourIndex ? ' is-active' : ''}${n < tourIndex ? ' is-done' : ''}" data-tour="goto" data-step="${n}" aria-label="Passo ${n + 1}: ${escapeHtml(s.title)}"></button>`).join('');
    const pop = layer.querySelector('.tour-pop');
    pop.className = 'tour-pop';
    pop.innerHTML = `
        <div class="tour-head">
            <span class="tour-icon" aria-hidden="true">${tourIcon(step.icon)}</span>
            <div><small class="tour-step">${tourIndex + 1} de ${steps.length}</small><strong class="tour-title" id="tourTitle">${escapeHtml(step.title)}</strong></div>
            ${step.keys ? `<span class="tour-keys">${tourKeys(step.keys)}</span>` : ''}
        </div>
        <p class="tour-text">${escapeHtml(step.text)}</p>
        <div class="tour-progress"><i></i></div>
        <div class="tour-dots" role="group" aria-label="Passos do tour">${dots}</div>
        <div class="tour-actions"><button type="button" data-tour="skip">Pular</button><span></span><button type="button" data-tour="prev"${tourIndex === 0 ? ' disabled' : ''}>Voltar</button><button type="button" data-tour="next" class="is-primary">${last ? 'Concluir' : 'Próximo'}</button></div>`;
    pop.querySelector('.tour-progress i').style.width = `${((tourIndex + 1) / steps.length) * 100}%`;
    placeTourPop(pop, rect);
    pop.querySelector('[data-tour="next"]').focus();
}

//Balão abaixo, acima, à direita ou à esquerda do destaque (o primeiro lugar em que cabe), com a seta apontando
function placeTourPop(pop, rect) {
    const box = pop.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight, gap = 16, m = 12;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const options = [
        { side: 'bottom', left: cx - box.width / 2, top: rect.bottom + gap, fits: rect.bottom + gap + box.height < H - m },
        { side: 'top', left: cx - box.width / 2, top: rect.top - gap - box.height, fits: rect.top - gap - box.height > m },
        { side: 'right', left: rect.right + gap, top: cy - box.height / 2, fits: rect.right + gap + box.width < W - m },
        { side: 'left', left: rect.left - gap - box.width, top: cy - box.height / 2, fits: rect.left - gap - box.width > m },
    ];
    //Destaque grande (mapa, barra lateral): ao lado ou por cima, no meio dele
    const big = rect.width > W * 0.5 && rect.height > H * 0.5;
    const pick = big ? { side: 'none', left: cx - box.width / 2, top: H - box.height - 40 } : (options.find(o => o.fits) || { ...options[0], side: 'none', top: H - box.height - m });
    const left = Math.min(Math.max(m, pick.left), W - box.width - m);
    const top = Math.min(Math.max(m, pick.top), H - box.height - m);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.dataset.side = pick.side;
    const arrowX = Math.min(Math.max(18, cx - left), box.width - 18);
    const arrowY = Math.min(Math.max(18, cy - top), box.height - 18);
    pop.style.setProperty('--arrow-x', `${arrowX}px`);
    pop.style.setProperty('--arrow-y', `${arrowY}px`);
}

function endTour() {
    setTourMenu(null);
    document.getElementById('tourLayer')?.remove();
    tourIndex = -1;
    try { localStorage.setItem(TOUR_DONE_KEY, '1'); } catch (e) { /* sem armazenamento */ }
}

function openShortcutsList() {
    if (typeof openAccountModal !== 'function') return;
    openAccountModal('preferences');
    setTimeout(() => document.querySelector('#accountModal .shortcut-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80);
}

document.addEventListener('keydown', (e) => {
    if (document.getElementById('tourLayer')) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endTour(); }
        if (tourIndex === -2) {
            //Boas-vindas e fim: Enter aciona o botão principal
            if (e.key === 'Enter') { e.preventDefault(); document.querySelector('#tourLayer .is-primary')?.click(); }
            return;
        }
        if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); showTourStep(tourIndex + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); showTourStep(tourIndex - 1); }
        return;
    }
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
    e.preventDefault();
    openShortcutsList();
}, true);

window.addEventListener('resize', () => { if (tourIndex >= 0) showTourStep(tourIndex); });

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('startTourButton')?.addEventListener('click', () => startTour());
    document.getElementById('userMenuTour')?.addEventListener('click', (e) => { e.preventDefault(); startTour(); });
    //Primeiro acesso: oferece o tour depois que o sistema abre
    if (typeof appReady !== 'undefined' && appReady?.then) {
        appReady.then(() => {
            let done = false;
            try { done = localStorage.getItem(TOUR_DONE_KEY) === '1'; } catch (e) { done = true; }
            if (done || navigator.webdriver) return;
            //Conta que já viu o tour em outro navegador
            Promise.resolve(supabaseClient?.auth?.getUser?.()).then((res) => {
                if (res?.data?.user?.user_metadata?.tour_done) {
                    try { localStorage.setItem(TOUR_DONE_KEY, '1'); } catch (e) { /* sem armazenamento */ }
                    return;
                }
                setTimeout(() => startTour({ welcome: true }), 1200);
            }).catch(() => setTimeout(() => startTour({ welcome: true }), 1200));
        });
    }
});
