// Arquivar projeto e migrar para o modo Rede. Cada projeto tem as duas opções no menu:
// - Arquivar: sai da lista "Abrir projeto" e fica na aba Arquivados (pode ser desarquivado). O conteúdo não muda.
// - Migrar para o modo Rede (js/projects/network-mode.js → concludeProject): caixas, cabos e planos de fusão vão para
//   a rede da cidade; o projeto fica só para consulta e é arquivado junto.
// Usa as colunas archived_at/archived_by (supabase/migrations/20261022120000_projetos_arquivados.sql).
// Depende de js/app.js, js/core/persistence.js e js/projects/network-mode.js.

const ARCHIVE_MIGRATION_HINT = 'Para arquivar projetos, o administrador precisa rodar a atualização "projetos arquivados" no Supabase (supabase/migrations/20261022120000_projetos_arquivados.sql).';

const getProjectTitle = (projectId) => document.querySelector(`#sidebar .folder-title[data-folder-id="${CSS.escape(projectId)}"]`);
const isProjectArchived = (projectId) => getProjectTitle(projectId)?.dataset.archived === 'true';

//Grava arquivado/desarquivado no banco; true se gravou
async function setProjectArchived(projectId, archived, { silent = false } = {}) {
    const { data, error } = await supabaseClient.from('projects')
        .update({ archived_at: archived ? new Date().toISOString() : null, archived_by: archived ? AppSession.userId : null })
        .eq('id', projectId).select('id');
    if (error) {
        if (!silent) showAlert(archived ? 'Arquivar projeto' : 'Desarquivar projeto', isMissingColumnError(error) ? ARCHIVE_MIGRATION_HINT : `Não foi possível. ${error.message || ''}`);
        return false;
    }
    if (!data?.length) {
        if (!silent) showAlert('Sem permissão', 'Seu cargo não permite arquivar este projeto.');
        return false;
    }
    const title = getProjectTitle(projectId);
    if (title) {
        if (archived) title.dataset.archived = 'true'; else delete title.dataset.archived;
        if (typeof scheduleSidebarCounts === 'function') scheduleSidebarCounts();
    }
    return true;
}

//Projeto aberto: lê se está arquivado (sem a coluna no banco, fica como não arquivado)
async function refreshProjectArchiveState(projectId) {
    if (typeof isNetworkProjectId === 'function' && isNetworkProjectId(projectId)) return;
    const { data, error } = await supabaseClient.from('projects').select('archived_at').eq('id', projectId).maybeSingle();
    const title = getProjectTitle(projectId);
    if (error || !title) return;
    if (data?.archived_at) title.dataset.archived = 'true'; else delete title.dataset.archived;
    if (typeof scheduleSidebarCounts === 'function') scheduleSidebarCounts();
}

function closeProjectFromWorkspace(projectId) {
    const root = document.getElementById(projectId)?.closest('.folder');
    if (!root) return;
    if (typeof liveSyncLeave === 'function') liveSyncLeave(projectId);
    removeProjectFromWorkspace(projectId, root);
}

//Menu do projeto → Arquivar: salva o que estiver aberto, arquiva e fecha
async function archiveProject(projectId) {
    if (!requireEditIgnoringConclusion('arquivar projetos')) return;
    const title = getProjectTitle(projectId);
    const name = title?.dataset.folderName || 'Projeto';
    const concluded = typeof isProjectConcluded === 'function' && isProjectConcluded(projectId);
    const choice = await showChoice({
        title: `Arquivar "${name}"`,
        message: `O projeto sai da lista de projetos e fica em Projeto → Abrir projeto → Arquivados, de onde pode ser aberto ou desarquivado quando quiser.${concluded ? '' : '\n\nO que está nele não vai para a rede. Para levar as caixas, cabos e fusões para o modo Rede, use "Migrar para o modo Rede".'}`,
        choices: [{ label: 'Cancelar', kind: 'secondary', value: 'cancel' }, { label: 'Arquivar', kind: 'primary', value: 'archive' }],
    });
    if (choice !== 'archive') return;
    const root = document.getElementById(projectId)?.closest('.folder');
    if (root && !concluded) {
        try {
            await persistProject(root);
        } catch (error) {
            if (error instanceof ProjectConflictError) {
                if (!(await resolveProjectConflict(root, name, error.info))) return;
            } else {
                showAlert('Erro', `Não foi possível salvar "${name}" antes de arquivar. ${error.message || ''}`);
                return;
            }
        }
    }
    if (!(await setProjectArchived(projectId, true))) return;
    closeProjectFromWorkspace(projectId);
    showToast('Projeto arquivado', `"${name}" está em Abrir projeto → Arquivados.`);
}

async function unarchiveProject(projectId, name = '') {
    if (!requireEditIgnoringConclusion('desarquivar projetos')) return false;
    if (!(await setProjectArchived(projectId, false))) return false;
    showToast('Projeto desarquivado', `"${name || getProjectTitle(projectId)?.dataset.folderName || 'Projeto'}" voltou para a lista de projetos.`);
    return true;
}

//Arquivar e desarquivar valem também para projeto concluído (só leitura), que requireEdit bloqueia
function requireEditIgnoringConclusion(actionLabel) {
    if (AppSession.canEdit) return true;
    return requireEdit(actionLabel);
}
