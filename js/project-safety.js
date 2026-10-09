// Proteção do trabalho da equipe: janela de escolha, histórico de versões do projeto e lixeira.
// O conflito ao salvar (duas pessoas no mesmo projeto) fica em js/persistence.js.
// Depende de script.js (showAlert, showConfirm, showToast, escapeHtml), js/persistence.js e js/sidebar-actions.js.

// ---------------------------------------------------------------
// Janela de escolha com vários botões: resolve com o "value" do botão clicado (ou 'cancel')
// ---------------------------------------------------------------
function showChoice({ title, message, choices }) {
    return new Promise((resolve) => {
        const modal = document.getElementById('choiceModal');
        document.getElementById('choiceModalTitle').textContent = title;
        document.getElementById('choiceModalMessage').textContent = message;
        const footer = document.getElementById('choiceModalButtons');
        footer.innerHTML = '';
        const finish = (value) => {
            modal.style.display = 'none';
            document.removeEventListener('keydown', onKey, true);
            resolve(value);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('cancel'); }
        };
        choices.forEach(choice => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `btn ${choice.kind === 'primary' ? 'btn-success' : choice.kind === 'danger' ? 'btn-danger' : 'btn-secondary'}`;
            button.textContent = choice.label;
            button.addEventListener('click', () => finish(choice.value));
            footer.appendChild(button);
        });
        document.addEventListener('keydown', onKey, true);
        modal.style.display = 'flex';
        footer.querySelector('.btn-success, .btn-danger, .btn')?.focus();
    });
}

function closeSafetyModal(id) {
    document.getElementById(id).style.display = 'none';
}

function formatSafetyDate(iso) {
    return iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

const isMissingFeatureError = (error) => /PGRST202|could not find the function|42883|column .* does not exist|42703|PGRST204/i.test(`${error?.code || ''} ${error?.message || ''}`);
const SAFETY_MIGRATION_HINT = 'Este recurso precisa da migração 20261005120000_versoes_lixeira_erros.sql no Supabase.';

// ---------------------------------------------------------------
// Histórico de versões
// ---------------------------------------------------------------
let historyProject = null; //{ id, name, element }

async function openProjectHistory(projectId, projectElement, projectName) {
    historyProject = { id: projectId, name: projectName, element: projectElement };
    document.getElementById('projectHistoryTitle').textContent = `Histórico de versões — ${projectName}`;
    const list = document.getElementById('projectHistoryList');
    list.innerHTML = '<li class="safety-list__state">Carregando…</li>';
    document.getElementById('projectHistoryModal').style.display = 'flex';
    const { data, error } = await supabaseClient.rpc('list_project_versions', { p_project: projectId });
    if (error) {
        list.innerHTML = `<li class="safety-list__state safety-list__state--error">${escapeHtml(isMissingFeatureError(error) ? SAFETY_MIGRATION_HINT : 'Não foi possível carregar o histórico.')}</li>`;
        return;
    }
    if (!data?.length) {
        list.innerHTML = '<li class="safety-list__state">Ainda não há versões anteriores. Elas aparecem a partir do próximo salvamento.</li>';
        return;
    }
    list.innerHTML = '';
    data.forEach((version, index) => {
        const li = document.createElement('li');
        li.className = 'safety-list__item';
        li.innerHTML = `
            <div class="safety-list__info">
                <strong>${escapeHtml(formatSafetyDate(version.saved_at))}${index === 0 ? ' <em>(anterior à atual)</em>' : ''}</strong>
                <span>${escapeHtml(version.saved_by_name || 'Sem autor')} · ${version.markers} marcador(es) · ${version.cables} cabo(s)</span>
            </div>
            ${AppSession.canEdit ? '<button type="button" class="btn btn-secondary safety-list__btn">Restaurar</button>' : ''}`;
        li.querySelector('button')?.addEventListener('click', () => restoreProjectVersion(version));
        list.appendChild(li);
    });
}

function restoreProjectVersion(version) {
    if (!historyProject || !requireEdit('restaurar versões')) return;
    const { id, name, element } = historyProject;
    showConfirm('Restaurar versão',
        `Voltar "${name}" para a versão de ${formatSafetyDate(version.saved_at)}? A versão atual vai para o histórico. Alterações abertas aqui e não salvas serão perdidas.`,
        async () => {
            const { error } = await supabaseClient.rpc('restore_project_version', { p_version: version.id });
            if (error) return showAlert('Não foi possível restaurar', error.message);
            closeSafetyModal('projectHistoryModal');
            if (element && document.body.contains(element)) removeProjectFromWorkspace(id, element);
            await openProjectFromDatabase(id);
            showToast('Versão restaurada', `"${name}" voltou para a versão de ${formatSafetyDate(version.saved_at)}.`);
        });
}

// ---------------------------------------------------------------
// Lixeira
// ---------------------------------------------------------------
function updateTrashButton(facets) {
    const button = document.getElementById('projectTrashButton');
    if (!button) return;
    const supported = facets && typeof facets.trash === 'number';
    button.classList.toggle('hidden', !supported);
    if (supported) button.querySelector('span').textContent = facets.trash ? `Lixeira (${facets.trash})` : 'Lixeira';
}

//Move o projeto para a lixeira (some da busca; pode ser restaurado por 30 dias).
//projectElement só existe se o projeto estiver aberto na tela; onDone roda depois de excluir.
function moveProjectToTrash(projectId, projectElement, projectName, onDone = null) {
    if (!requireEdit('excluir projetos')) return;
    showConfirm('Excluir projeto',
        `Mover "${projectName}" para a lixeira? Ele some para toda a equipe, mas pode ser restaurado em até 30 dias (Projeto → Abrir projeto → Lixeira).`,
        async () => {
            const { data, error } = await supabaseClient.from('projects')
                .update({ deleted_at: new Date().toISOString() }).eq('id', projectId).select('id');
            if (error && isMissingFeatureError(error)) return deleteProjectPermanently(projectId, projectElement, projectName, onDone);
            if (error) {
                return showAlert('Sem permissão', /lixeira|42501/i.test(`${error.message} ${error.code}`)
                    ? 'Somente quem criou o projeto ou um administrador da empresa pode excluí-lo.'
                    : `Não foi possível excluir o projeto. ${error.message}`);
            }
            if (!data.length && await projectExistsInDatabase(projectId)) {
                return showAlert('Sem permissão', 'Somente quem criou o projeto ou um administrador da empresa pode excluí-lo.');
            }
            if (projectElement) {
                if (typeof liveSyncLeave === 'function') liveSyncLeave(projectId);
                removeProjectFromWorkspace(projectId, projectElement);
            }
            onDone?.();
            showToast('Projeto na lixeira', `"${projectName}" pode ser restaurado em até 30 dias.`);
        });
}

//Exclusão definitiva (sem lixeira no banco, ou a partir da lixeira)
async function deleteProjectPermanently(projectId, projectElement, projectName, onDone = null) {
    const { data, error } = await supabaseClient.from('projects').delete().eq('id', projectId).select('id');
    if (error) {
        console.error('Erro ao excluir projeto:', error);
        return showAlert('Erro', 'Não foi possível excluir o projeto do banco de dados.');
    }
    if (!data.length && await projectExistsInDatabase(projectId)) {
        return showAlert('Sem permissão', 'Somente quem criou o projeto ou um administrador da empresa pode excluí-lo.');
    }
    if (projectElement) removeProjectFromWorkspace(projectId, projectElement);
    onDone?.();
    showToast('Projeto excluído', `"${projectName}" foi apagado de vez.`);
}

async function openTrash() {
    const list = document.getElementById('trashList');
    list.innerHTML = '<li class="safety-list__state">Carregando…</li>';
    document.getElementById('trashModal').style.display = 'flex';
    const { data, error } = await supabaseClient.rpc('list_trash');
    if (error) {
        list.innerHTML = `<li class="safety-list__state safety-list__state--error">${escapeHtml(isMissingFeatureError(error) ? SAFETY_MIGRATION_HINT : 'Não foi possível carregar a lixeira.')}</li>`;
        return;
    }
    if (!data?.length) {
        list.innerHTML = '<li class="safety-list__state">A lixeira está vazia.</li>';
        return;
    }
    list.innerHTML = '';
    data.forEach(project => {
        const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(project.deleted_at).getTime()) / 86400000));
        const li = document.createElement('li');
        li.className = 'safety-list__item';
        li.innerHTML = `
            <div class="safety-list__info">
                <strong>${escapeHtml(project.name || project.id)}</strong>
                <span>${escapeHtml([project.project_type, project.city].filter(Boolean).join(' · '))}${project.project_type || project.city ? ' · ' : ''}excluído em ${escapeHtml(formatSafetyDate(project.deleted_at))}${project.deleted_by_name ? ` por ${escapeHtml(project.deleted_by_name)}` : ''} · apagado de vez em ${daysLeft} dia(s)</span>
            </div>
            ${project.can_manage ? `
                <button type="button" class="btn btn-secondary safety-list__btn" data-trash-action="restore">Restaurar</button>
                <button type="button" class="btn btn-danger safety-list__btn" data-trash-action="purge">Excluir de vez</button>` : ''}`;
        li.querySelector('[data-trash-action="restore"]')?.addEventListener('click', () => restoreFromTrash(project));
        li.querySelector('[data-trash-action="purge"]')?.addEventListener('click', () => {
            showConfirm('Excluir de vez', `Apagar "${project.name}" definitivamente, com todo o histórico de versões? Não dá para desfazer.`, async () => {
                await deleteProjectPermanently(project.id, null, project.name);
                openTrash();
                if (typeof loadProjectFacets === 'function') loadProjectFacets();
            });
        });
        list.appendChild(li);
    });
}

async function restoreFromTrash(project) {
    const { data, error } = await supabaseClient.from('projects').update({ deleted_at: null }).eq('id', project.id).select('id');
    if (error || !data?.length) return showAlert('Não foi possível restaurar', error?.message || 'Sem permissão para restaurar este projeto.');
    showToast('Projeto restaurado', `"${project.name}" voltou para a lista de projetos.`);
    openTrash();
    if (typeof loadProjectFacets === 'function') loadProjectFacets();
    if (typeof reloadProjectPickerList === 'function') reloadProjectPickerList();
}

function setupProjectSafety() {
    document.querySelectorAll('#projectHistoryModal [data-close-modal], #trashModal [data-close-modal]').forEach(btn => {
        btn.addEventListener('click', () => closeSafetyModal(btn.closest('.modal').id));
    });
    document.getElementById('projectTrashButton')?.addEventListener('click', openTrash);
}

setupProjectSafety();
