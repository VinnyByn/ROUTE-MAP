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

function checkLayer(el) {
    const visible = isLayerVisible(el);
    if (visible && !layerWasVisible.get(el)) bringLayerToFront(el);
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

setupLayering();
