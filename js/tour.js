// Tour pelo sistema (primeiro acesso ou menu da conta) e tecla "?" para a lista de atalhos.
// Cada passo destaca um elemento da tela com um balão explicativo.

const TOUR_STEPS = [
    { target: '#sidebar', title: 'Projetos e pastas', text: 'Aqui ficam os projetos abertos, as pastas e cada caixa, cabo e cliente. Clique direito em qualquer linha para ver as ações.' },
    { target: '#projectButton', title: 'Menu Projeto', text: 'Criar, abrir e salvar projetos, importar KML, exportar planilha, verificar o projeto e desfazer alterações.' },
    { target: '#toolsButton', title: 'Ferramentas', text: 'Adicionar marcadores (CEO, CTO, POP, clientes), desenhar cabos e polígonos e medir distâncias.' },
    { target: '#materialsMenuButton', title: 'Materiais', text: 'Lista de materiais e custos do projeto, catálogo de preços e configurações de lançamento e orçamento óptico.' },
    { target: '#projectReportButton', title: 'Relatório', text: 'Relatório completo do projeto para imprimir ou gerar PDF.' },
    { target: '#openSearchModalButton', title: 'Busca (Ctrl+K)', text: 'Encontre qualquer caixa, cliente, código, cabo, endereço ou coordenada.' },
    { target: '#map', title: 'Mapa', text: 'Clique num item para editar, botão direito para as ações. Shift + arrastar seleciona vários marcadores, cabos e polígonos de uma vez (na barra lateral: Ctrl + clique ou Shift + clique).' },
    { target: '#userMenuButton', title: 'Conta', text: 'Perfil, segurança, equipe, preferências e a lista de atalhos. O tour fica aqui para ver de novo.' },
];
const TOUR_DONE_KEY = 'routeMapTourDone';
let tourIndex = -1;

function startTour() {
    //Visto uma vez já conta: não reaparece mesmo se a página for fechada no meio
    try { localStorage.setItem(TOUR_DONE_KEY, '1'); } catch (e) { /* sem armazenamento */ }
    if (typeof supabaseClient !== 'undefined' && supabaseClient?.auth?.updateUser) {
        supabaseClient.auth.updateUser({ data: { tour_done: true } }).catch(() => {});
    }
    document.querySelectorAll('.dropdown-content.show, .user-menu.show').forEach(el => el.classList.remove('show'));
    const accountModal = document.getElementById('accountModal');
    if (accountModal) accountModal.style.display = 'none';
    document.getElementById('tourLayer')?.remove();
    const layer = document.createElement('div');
    layer.id = 'tourLayer';
    layer.className = 'tour-layer';
    layer.innerHTML = `<div class="tour-spot"></div><div class="tour-pop" role="dialog" aria-live="polite">
        <small class="tour-step"></small><strong class="tour-title"></strong><p class="tour-text"></p>
        <div class="tour-actions"><button type="button" data-tour="skip">Pular</button><span></span><button type="button" data-tour="prev">Voltar</button><button type="button" data-tour="next" class="is-primary">Próximo</button></div></div>`;
    document.body.appendChild(layer);
    layer.addEventListener('click', (e) => {
        const action = e.target.closest('[data-tour]')?.dataset.tour;
        if (action === 'skip') endTour();
        if (action === 'prev') showTourStep(tourIndex - 1);
        if (action === 'next') showTourStep(tourIndex + 1);
    });
    showTourStep(0);
}

function showTourStep(i) {
    const steps = TOUR_STEPS.filter(s => document.querySelector(s.target)?.getClientRects().length);
    if (i >= steps.length) return endTour();
    tourIndex = Math.max(0, i);
    const step = steps[tourIndex];
    const layer = document.getElementById('tourLayer');
    const rect = document.querySelector(step.target).getBoundingClientRect();
    const spot = layer.querySelector('.tour-spot');
    const pad = 6;
    Object.assign(spot.style, { left: `${rect.left - pad}px`, top: `${rect.top - pad}px`, width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px` });
    layer.querySelector('.tour-step').textContent = `${tourIndex + 1} de ${steps.length}`;
    layer.querySelector('.tour-title').textContent = step.title;
    layer.querySelector('.tour-text').textContent = step.text;
    layer.querySelector('[data-tour="prev"]').disabled = tourIndex === 0;
    layer.querySelector('[data-tour="next"]').textContent = tourIndex === steps.length - 1 ? 'Concluir' : 'Próximo';
    //Balão abaixo do elemento (ou ao lado, se o elemento for grande)
    const pop = layer.querySelector('.tour-pop');
    const box = pop.getBoundingClientRect();
    let left, top;
    if (rect.height > window.innerHeight * 0.5) {
        left = rect.right + 16 + box.width < window.innerWidth ? rect.right + 16 : rect.left - box.width - 16;
        top = Math.min(window.innerHeight / 2 - box.height / 2, window.innerHeight - box.height - 16);
        if (rect.width > window.innerWidth * 0.5) left = rect.left + rect.width / 2 - box.width / 2;
    } else {
        left = rect.left + rect.width / 2 - box.width / 2;
        top = rect.bottom + 14 + box.height < window.innerHeight ? rect.bottom + 14 : rect.top - box.height - 14;
    }
    pop.style.left = `${Math.min(Math.max(12, left), window.innerWidth - box.width - 12)}px`;
    pop.style.top = `${Math.min(Math.max(12, top), window.innerHeight - box.height - 12)}px`;
    layer.querySelector('[data-tour="next"]').focus();
}

function endTour() {
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
    if (tourIndex >= 0) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endTour(); }
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
    document.getElementById('startTourButton')?.addEventListener('click', startTour);
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
                setTimeout(startTour, 1200);
            }).catch(() => setTimeout(startTour, 1200));
        });
    }
});
