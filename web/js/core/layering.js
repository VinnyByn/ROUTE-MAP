// Ordem das janelas: o que foi aberto por último fica por cima.
// Todas as janelas (.modal) e caixas flutuantes (.floating-box) tinham a mesma camada (z-index), então
// ficava por cima a que vinha depois no HTML, não a última aberta. Aqui cada uma que aparece recebe a
// próxima camada da pilha; clicar numa caixa flutuante já aberta também a traz para frente.
// Menus (10050+), dicas e o cartão do mouse continuam acima de tudo.

const LAYER_SELECTOR = '.modal, .floating-box';
const LAYER_BASE = 1100;
const LAYER_MAX = 9000;
let layerSeq = LAYER_BASE;
const layerWasVisible = new WeakMap();

function isLayerVisible(el) {
    if (el.hidden || el.classList.contains('hidden')) return false;
    return getComputedStyle(el).display !== 'none';
}

function bringLayerToFront(el) {
    const open = Array.from(document.querySelectorAll(LAYER_SELECTOR)).filter(isLayerVisible);
    //Pilha cresceu demais: renumera as abertas mantendo a ordem atual
    if (layerSeq >= LAYER_MAX) {
        open.sort((a, b) => (parseInt(a.style.zIndex, 10) || 0) - (parseInt(b.style.zIndex, 10) || 0));
        layerSeq = LAYER_BASE;
        open.forEach(o => { if (o !== el) o.style.zIndex = String(++layerSeq); });
    }
    if (parseInt(el.style.zIndex, 10) === layerSeq) return; //já é a de cima
    el.style.zIndex = String(++layerSeq);
}

//Painéis de consulta no mesmo canto do mapa: abrir um fecha os outros (pelo botão Fechar de cada um, para
//desfazer o que ele desenhou). Editores (marcador, cabo, polígono, drop) não entram: fechar perderia a edição.
const EXCLUSIVE_PANELS = {
    viabilityBox: 'closeViabilityBox', networkFilterBox: 'closeNetworkFilterBox', networkPanelBox: 'closeNetworkPanelBox',
    nearbyBox: 'closeNearbyBox', signalTraceBox: 'closeSignalTraceBox', projectCheckBox: 'closeProjectCheckBox',
    networkImpactBox: 'closeNetworkImpactBox', rulerBox: 'closeRulerBoxButton', cableRouteBox: 'closeCableRouteBox',
    autoDesignBox: 'closeAutoDesignButton', networkAreaBox: 'closeNetworkAreaBox',
};

function closeOtherPanels(el) {
    if (!(el.id in EXCLUSIVE_PANELS)) return;
    Object.entries(EXCLUSIVE_PANELS).forEach(([id, closeId]) => {
        const other = document.getElementById(id);
        if (!other || other === el || !isLayerVisible(other)) return;
        const close = document.getElementById(closeId);
        if (close) close.click(); else other.classList.add('hidden');
        if (isLayerVisible(other)) other.classList.add('hidden');
    });
}

function checkLayer(el) {
    const visible = isLayerVisible(el);
    if (visible && !layerWasVisible.get(el)) {
        bringLayerToFront(el);
        setTimeout(() => updateRangesIn(el), 0);
        //Janela com campo principal (ex.: nome da pasta): já chega com o cursor nele, texto selecionado
        const auto = el.querySelector?.('[data-autofocus]');
        if (auto) setTimeout(() => { if (isLayerVisible(el)) { auto.focus(); auto.select?.(); } }, 60);
        closeOtherPanels(el);
    }
    layerWasVisible.set(el, visible);
}

const layerObserver = new MutationObserver((mutations) => {
    const seen = new Set();
    mutations.forEach(m => {
        if (m.type === 'attributes' && m.target.matches?.(LAYER_SELECTOR)) seen.add(m.target);
        m.addedNodes?.forEach(node => {
            if (node.nodeType !== 1) return;
            if (node.matches(LAYER_SELECTOR)) watchLayer(node);
            node.querySelectorAll?.(LAYER_SELECTOR).forEach(watchLayer);
        });
    });
    seen.forEach(checkLayer);
});

function watchLayer(el) {
    if (layerWasVisible.has(el)) return;
    layerWasVisible.set(el, isLayerVisible(el));
    layerObserver.observe(el, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
}

function setupLayering() {
    document.querySelectorAll(LAYER_SELECTOR).forEach(watchLayer);
    layerObserver.observe(document.body, { childList: true, subtree: true });
    //Clicar numa caixa flutuante aberta a traz para frente (as janelas cobrem a tela, não precisam)
    document.addEventListener('pointerdown', (e) => {
        const box = e.target.closest?.('.floating-box');
        if (box && isLayerVisible(box)) bringLayerToFront(box);
    }, true);
}

//Clicar de novo no botão de um painel já aberto fecha o painel
const PANEL_TOGGLES = {
    networkViabilityButton: 'viabilityBox', networkFilterButton: 'networkFilterBox', networkPanelButton: 'networkPanelBox',
    networkCheckButton: 'projectCheckBox', projectCheckButton: 'projectCheckBox',
    networkImpactMenuButton: 'networkImpactBox', networkImpactButton: 'networkImpactBox',
    rulerButton: 'rulerBox', autoDesignMenuButton: 'autoDesignBox',
};
document.addEventListener('click', (e) => {
    const button = e.target.closest?.('[id]');
    const boxId = button && PANEL_TOGGLES[button.id];
    const box = boxId && document.getElementById(boxId);
    if (!box || !isLayerVisible(box)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    document.querySelectorAll('.dropdown-content.show').forEach(d => d.classList.remove('show'));
    const close = document.getElementById(EXCLUSIVE_PANELS[boxId]);
    if (close) close.click(); else box.classList.add('hidden');
}, true);

//Controles deslizantes: a parte preenchida do trilho acompanha o valor (CSS em ui-v4.css, variável --fill)
function updateRangeFill(input) {
    const min = Number(input.min || 0), max = Number(input.max || 100), v = Number(input.value);
    input.style.setProperty('--fill', `${max > min ? ((v - min) / (max - min)) * 100 : 0}%`);
}
function updateRangesIn(root = document) { root.querySelectorAll?.('input[type="range"]').forEach(updateRangeFill); }
document.addEventListener('input', (e) => { if (e.target?.type === 'range') updateRangeFill(e.target); }, true);
document.addEventListener('change', (e) => { if (e.target?.type === 'range') updateRangeFill(e.target); }, true);
document.addEventListener('pointerover', (e) => { if (e.target?.type === 'range') updateRangeFill(e.target); }, true);

setupLayering();
