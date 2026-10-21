// Cargos na interface: administrador (tudo), projetista (edita projetos) e membro (só visualiza).
// O banco também bloqueia por RLS (supabase/migrations); aqui a interface esconde o que o cargo não pode usar.
// Depende de js/core/supabase-client.js (AppSession) e de js/app.js (appReady).

function applyRoleToUi() {
    const role = AppSession.role;
    ['admin', 'projetista', 'tecnico', 'member'].forEach(r => document.body.classList.toggle(`role-${r}`, role === r));
    document.body.classList.toggle('is-company-admin', AppSession.isAdmin);
    document.body.classList.toggle('is-viewer', AppSession.isViewer);
    document.body.classList.toggle('can-edit', AppSession.canEdit);
}

//Trava os campos de uma janela/painel para quem só visualiza (os botões de ação são ocultados por CSS)
function lockFormsForViewer(rootId) {
    if (!AppSession.isViewer) return;
    const root = document.getElementById(rootId);
    if (!root) return;
    root.classList.add('is-readonly');
    root.querySelectorAll('input, select, textarea').forEach(el => {
        if (!el.disabled) el.dataset.viewerLocked = '1';
        el.disabled = true;
    });
}

//Desfaz o lockFormsForViewer (técnico de campo no modo Rede edita clientes)
function unlockFormsForViewer(rootId) {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.classList.remove('is-readonly');
    root.querySelectorAll('[data-viewer-locked]').forEach(el => { el.disabled = false; delete el.dataset.viewerLocked; });
}

appReady.then(applyRoleToUi);
