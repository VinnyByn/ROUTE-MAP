// Cargos na interface: administrador (tudo), projetista (edita projetos) e membro (só visualiza).
// O banco também bloqueia por RLS (supabase/migrations); aqui a interface esconde o que o cargo não pode usar.
// Depende de supabase-client.js (AppSession) e de script.js (appReady).

function applyRoleToUi() {
    const role = AppSession.role;
    ['admin', 'projetista', 'member'].forEach(r => document.body.classList.toggle(`role-${r}`, role === r));
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
    root.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
}

appReady.then(applyRoleToUi);
