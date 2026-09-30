// Menu do usuário e janela "Minha conta": perfil, senha, empresa, equipe e preferências.
// Depende de supabase-client.js (supabaseClient, AppSession) e de script.js
// (showAlert, showConfirm, applyTheme, escapeHtml, appReady, mapReady, map).

function getInitials(text) {
    const source = String(text || '').trim();
    if (!source) return '?';
    const base = source.includes('@') ? source.split('@')[0].replace(/[._-]+/g, ' ') : source;
    const parts = base.split(/\s+/).filter(Boolean);
    const initials = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : base.slice(0, 2);
    return initials.toUpperCase();
}

//Preenche nome, e-mail, empresa e papel em todos os lugares da interface
function renderUserIdentity() {
    const name = AppSession.displayName;
    const roleLabel = AppSession.roleLabel;
    document.querySelectorAll('[data-user-initials]').forEach(el => { el.textContent = getInitials(AppSession.profile?.full_name || AppSession.email); });
    document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = name; });
    document.querySelectorAll('[data-user-email]').forEach(el => { el.textContent = AppSession.email; });
    document.querySelectorAll('[data-user-role]').forEach(el => { el.textContent = roleLabel; });
    document.querySelectorAll('.company-name-slot').forEach(el => { el.textContent = AppSession.company?.name || ''; });
    document.querySelectorAll('.app-url-slot').forEach(el => { el.textContent = `${location.origin}/login.html`; });
    applyRoleToUi();
    const trigger = document.getElementById('userMenuButton');
    if (trigger) trigger.title = `${name} · ${AppSession.company?.name || ''}`;
}

function setFeedback(container, text, kind = 'success') {
    const el = container.querySelector('.account-feedback');
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind;
    el.hidden = !text;
    if (text && kind === 'success') {
        clearTimeout(el._timer);
        el._timer = setTimeout(() => { el.hidden = true; }, 3500);
    }
}

async function runBusy(button, busyText, task) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
    try { return await task(); } finally { button.disabled = false; button.textContent = original; }
}

// ---------------------------------------------------------------
// Janela e abas
// ---------------------------------------------------------------

function openAccountModal(tab = 'profile') {
    document.getElementById('userDropdown')?.classList.remove('show');
    document.querySelectorAll('.dropdown.dropdown-open').forEach(d => d.classList.remove('dropdown-open'));
    fillAccountForms();
    setAccountTab(tab);
    document.getElementById('accountModal').style.display = 'flex';
}

function setAccountTab(tab) {
    document.querySelectorAll('#accountModal .account-tab').forEach(btn => {
        const active = btn.dataset.tab === tab;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('#accountModal .account-panel').forEach(panel => {
        panel.hidden = panel.dataset.panel !== tab;
    });
    document.querySelectorAll('#accountModal .account-feedback').forEach(el => { el.hidden = true; });
    if (tab === 'team') loadTeam();
    const firstInput = document.querySelector(`#accountModal [data-panel="${tab}"] input:not([disabled])`);
    if (firstInput) setTimeout(() => firstInput.focus(), 40);
}

function fillAccountForms() {
    const profile = AppSession.profile || {};
    const prefs = profile.preferences || {};
    document.getElementById('profileFullName').value = profile.full_name || '';
    document.getElementById('profileJobTitle').value = profile.job_title || '';
    document.getElementById('profilePhone').value = profile.phone || '';
    document.getElementById('profileEmail').value = AppSession.email;
    document.getElementById('newPassword').value = '';
    document.getElementById('newPasswordConfirm').value = '';
    document.getElementById('companyNameInput').value = AppSession.company?.name || '';
    document.getElementById('companyDocumentInput').value = AppSession.company?.document || '';
    const readOnly = !AppSession.isAdmin;
    document.getElementById('companyNameInput').disabled = readOnly;
    document.getElementById('companyDocumentInput').disabled = readOnly;
    document.getElementById('companyReadonlyNote').hidden = !readOnly;
    document.getElementById('leaveCompanyCard').hidden = AppSession.isAdmin;
    const roleCard = document.getElementById('myRoleDescription');
    if (roleCard) roleCard.textContent = ROLE_DESCRIPTIONS[AppSession.role] || '';
    document.getElementById('prefTheme').value = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    document.getElementById('prefMapType').value = prefs.mapType || 'roadmap';
    document.getElementById('prefReopenLastProject').checked = !!prefs.reopenLastProject;
}

// ---------------------------------------------------------------
// Perfil, senha e preferências
// ---------------------------------------------------------------

async function saveProfile(event) {
    event.preventDefault();
    const panel = document.querySelector('#accountModal [data-panel="profile"]');
    const fullName = document.getElementById('profileFullName').value.trim();
    if (!fullName) return setFeedback(panel, 'Informe seu nome.', 'error');
    const changes = {
        full_name: fullName,
        job_title: document.getElementById('profileJobTitle').value.trim() || null,
        phone: document.getElementById('profilePhone').value.trim() || null
    };
    await runBusy(event.submitter || panel.querySelector('[type="submit"]'), 'Salvando…', async () => {
        const { error } = await supabaseClient.from('profiles').upsert({ id: AppSession.userId, ...changes });
        if (error) return setFeedback(panel, `Não foi possível salvar: ${error.message}`, 'error');
        AppSession.profile = { ...(AppSession.profile || {}), ...changes };
        renderUserIdentity();
        setFeedback(panel, 'Perfil atualizado.');
    });
}

async function changePassword(event) {
    event.preventDefault();
    const panel = document.querySelector('#accountModal [data-panel="security"]');
    const password = document.getElementById('newPassword').value;
    const confirmation = document.getElementById('newPasswordConfirm').value;
    if (password.length < 8) return setFeedback(panel, 'A senha precisa ter pelo menos 8 caracteres.', 'error');
    if (password !== confirmation) return setFeedback(panel, 'As senhas não conferem.', 'error');
    await runBusy(event.submitter || panel.querySelector('[type="submit"]'), 'Alterando…', async () => {
        const { error } = await supabaseClient.auth.updateUser({ password });
        if (error) return setFeedback(panel, translateAuthError(error), 'error');
        document.getElementById('newPassword').value = '';
        document.getElementById('newPasswordConfirm').value = '';
        setFeedback(panel, 'Senha alterada.');
    });
}

function signOutEverywhere() {
    showConfirm('Sair de todos os dispositivos', 'Encerrar sua sessão em todos os computadores e celulares? Você precisará entrar de novo.', async () => {
        await Promise.resolve(supabaseClient.rpc('go_offline')).catch(() => {});
        await supabaseClient.auth.signOut({ scope: 'global' });
        window.location.replace('login.html');
    });
}

//Salva preferências no perfil (mescla com as existentes)
let preferencesSaveTimer = null;
function saveUserPreferences(patch) {
    AppSession.profile = AppSession.profile || {};
    AppSession.profile.preferences = { ...(AppSession.profile.preferences || {}), ...patch };
    clearTimeout(preferencesSaveTimer);
    return new Promise((resolve) => {
        preferencesSaveTimer = setTimeout(async () => {
            const { error } = await supabaseClient
                .from('profiles')
                .update({ preferences: AppSession.profile.preferences })
                .eq('id', AppSession.userId);
            if (error) console.error('Erro ao salvar preferências:', error);
            resolve(!error);
        }, 300);
    });
}

async function savePreferencesForm(event) {
    event.preventDefault();
    const panel = document.querySelector('#accountModal [data-panel="preferences"]');
    const theme = document.getElementById('prefTheme').value;
    const mapType = document.getElementById('prefMapType').value;
    const reopenLastProject = document.getElementById('prefReopenLastProject').checked;
    applyTheme(theme);
    if (typeof map !== 'undefined' && map) map.setMapTypeId(mapType);
    const ok = await saveUserPreferences({ theme, mapType, reopenLastProject });
    setFeedback(panel, ok ? 'Preferências salvas.' : 'Não foi possível salvar as preferências.', ok ? 'success' : 'error');
}

function lastProjectStorageKey() {
    return `routeMapLastProject:${AppSession.userId}`;
}

function rememberLastProject(projectId) {
    try { localStorage.setItem(lastProjectStorageKey(), projectId); } catch (e) { /* ignora */ }
}

//Aplica tema, tipo de mapa e reabre o último projeto, conforme as preferências
function applyStartupPreferences() {
    const prefs = AppSession.profile?.preferences || {};
    if (prefs.theme && prefs.theme !== document.documentElement.getAttribute('data-theme')) applyTheme(prefs.theme);
    if (prefs.mapType && map) map.setMapTypeId(prefs.mapType);
    if (!prefs.reopenLastProject) return;
    let lastId = null;
    try { lastId = localStorage.getItem(lastProjectStorageKey()); } catch (e) { /* ignora */ }
    if (lastId && !document.getElementById(lastId)) openProjectFromDatabase(lastId);
}

// ---------------------------------------------------------------
// Empresa
// ---------------------------------------------------------------

async function saveCompany(event) {
    event.preventDefault();
    const panel = document.querySelector('#accountModal [data-panel="company"]');
    if (!AppSession.isAdmin) return;
    const name = document.getElementById('companyNameInput').value.trim();
    const documentNumber = document.getElementById('companyDocumentInput').value.trim() || null;
    if (name.length < 2) return setFeedback(panel, 'Informe o nome da empresa.', 'error');
    await runBusy(event.submitter || panel.querySelector('[type="submit"]'), 'Salvando…', async () => {
        const { error } = await supabaseClient.from('companies').update({ name, document: documentNumber }).eq('id', AppSession.company.id);
        if (error) return setFeedback(panel, `Não foi possível salvar: ${error.message}`, 'error');
        AppSession.company = { ...AppSession.company, name, document: documentNumber };
        renderUserIdentity();
        setFeedback(panel, 'Dados da empresa atualizados.');
    });
}

function leaveCompany() {
    showConfirm('Sair da empresa', `Sair da equipe "${AppSession.company?.name}"? Você perderá o acesso aos projetos dela.`, async () => {
        const { error } = await supabaseClient.rpc('remove_member', { p_user: AppSession.userId });
        if (error) return showAlert('Erro', error.message);
        window.location.replace('login.html');
    });
}

// ---------------------------------------------------------------
// Equipe e convites
// ---------------------------------------------------------------

async function loadTeam() {
    const membersList = document.getElementById('teamMembersList');
    if (!membersList.children.length) membersList.innerHTML = '<li class="account-list__state">Carregando…</li>';
    const [membersResult, invitesResult] = await Promise.all([
        supabaseClient.rpc('list_company_members'),
        AppSession.isAdmin
            ? supabaseClient.from('company_invites').select('id, email, role, created_at').is('accepted_at', null).order('created_at', { ascending: false })
            : Promise.resolve({ data: [] })
    ]);
    if (membersResult.error) {
        membersList.innerHTML = '<li class="account-list__state account-list__state--error">Não foi possível carregar a equipe.</li>';
        return;
    }
    const members = membersResult.data || [];
    renderMembers(members);
    renderInvites(invitesResult.data || []);
    updateOnlineChip(members);
}

//Situação de presença exibida só para o administrador
function describePresence(member, isSelf) {
    if (isSelf || member.is_online) {
        const where = isSelf ? getPresenceProjectName() : member.active_project;
        return { online: true, text: `Online agora${where ? ` · ${where}` : ''}` };
    }
    if (member.last_seen_at) return { online: false, text: `Visto ${formatRelativeDate(member.last_seen_at)}` };
    return { online: false, text: 'Ainda não acessou' };
}

function renderMembers(members) {
    const list = document.getElementById('teamMembersList');
    list.innerHTML = '';
    const onlineCount = members.filter(m => m.user_id === AppSession.userId || m.is_online).length;
    const summary = document.getElementById('teamOnlineSummary');
    if (summary) {
        summary.hidden = !AppSession.isAdmin;
        summary.textContent = `${onlineCount} de ${members.length} online agora`;
    }
    members.forEach(member => {
        const isSelf = member.user_id === AppSession.userId;
        const li = document.createElement('li');
        li.className = 'account-list__item';
        const canManage = AppSession.isAdmin && !isSelf;
        const presence = AppSession.isAdmin ? describePresence(member, isSelf) : null;
        const roleOptions = ['admin', 'projetista', 'member']
            .map(role => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${ROLE_LABELS[role]}</option>`).join('');
        li.innerHTML = `
            <span class="user-avatar${presence ? ' user-avatar--presence' : ''}${presence?.online ? ' is-online' : ''}">${escapeHtml(getInitials(member.full_name || member.email))}</span>
            <div class="account-list__info">
                <strong>${escapeHtml(member.full_name || member.email)}${isSelf ? ' <em>(você)</em>' : ''}</strong>
                <span>${escapeHtml(member.email)}${member.job_title ? ` · ${escapeHtml(member.job_title)}` : ''}</span>
                ${presence ? `<span class="presence-line${presence.online ? ' is-online' : ''}"><i></i>${escapeHtml(presence.text)}</span>` : ''}
            </div>
            ${canManage ? `
                <select class="account-role-select" aria-label="Cargo de ${escapeHtml(member.email)}">${roleOptions}</select>
                <button type="button" class="account-icon-btn" title="Remover da equipe" aria-label="Remover ${escapeHtml(member.email)}">
                    <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-trash"></use></svg>
                </button>`
            : `<span class="account-badge account-badge--${member.role}">${ROLE_LABELS[member.role]}</span>`}`;
        if (canManage) {
            li.querySelector('select').addEventListener('change', (e) => changeMemberRole(member, e.target));
            li.querySelector('button').addEventListener('click', () => removeMember(member));
        }
        list.appendChild(li);
    });
}

function renderInvites(invites) {
    const list = document.getElementById('pendingInvitesList');
    list.innerHTML = '';
    if (!invites.length) return;
    invites.forEach(invite => {
        const li = document.createElement('li');
        li.className = 'account-list__item account-list__item--pending';
        li.innerHTML = `
            <span class="user-avatar user-avatar--pending"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-mail"></use></svg></span>
            <div class="account-list__info">
                <strong>${escapeHtml(invite.email)}</strong>
                <span>Convite pendente · ${ROLE_LABELS[invite.role]}</span>
            </div>
            <button type="button" class="btn btn-secondary account-small-btn">Cancelar convite</button>`;
        li.querySelector('button').addEventListener('click', async (e) => {
            await runBusy(e.currentTarget, 'Cancelando…', async () => {
                const { error } = await supabaseClient.from('company_invites').delete().eq('id', invite.id);
                if (error) return showAlert('Erro', 'Não foi possível cancelar o convite.');
                loadTeam();
            });
        });
        list.appendChild(li);
    });
}

async function sendInvite(event) {
    event.preventDefault();
    const panel = document.querySelector('#accountModal [data-panel="team"]');
    const emailInput = document.getElementById('inviteEmail');
    const email = emailInput.value.trim().toLowerCase();
    const role = document.getElementById('inviteRole').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setFeedback(panel, 'Informe um e-mail válido.', 'error');
    await runBusy(event.submitter || panel.querySelector('#inviteForm [type="submit"]'), 'Enviando…', async () => {
        const { data: members } = await supabaseClient.rpc('list_company_members');
        if ((members || []).some(m => m.email.toLowerCase() === email)) {
            return setFeedback(panel, 'Essa pessoa já faz parte da equipe.', 'error');
        }
        const { error } = await supabaseClient.from('company_invites').insert({
            company_id: AppSession.company.id,
            email,
            role,
            invited_by: AppSession.userId
        });
        if (error) {
            const message = error.code === '23505' ? 'Já existe um convite pendente para este e-mail.' : `Não foi possível convidar: ${error.message}`;
            return setFeedback(panel, message, 'error');
        }
        emailInput.value = '';
        setFeedback(panel, `Convite registrado. Avise ${email} para criar a conta em ${location.origin}/login.html.`);
        loadTeam();
    });
}

async function changeMemberRole(member, select) {
    const previous = member.role;
    const next = select.value;
    select.disabled = true;
    const { error } = await supabaseClient.rpc('set_member_role', { p_user: member.user_id, p_role: next });
    select.disabled = false;
    if (error) {
        select.value = previous;
        return showAlert('Não foi possível alterar', error.message);
    }
    member.role = next;
    showToast('Cargo alterado', `${member.full_name || member.email} agora é ${ROLE_LABELS[next]}.`);
}

function removeMember(member) {
    showConfirm('Remover da equipe', `Remover ${member.full_name || member.email} da empresa? A pessoa perde o acesso aos projetos da equipe.`, async () => {
        const { error } = await supabaseClient.rpc('remove_member', { p_user: member.user_id });
        if (error) return showAlert('Não foi possível remover', error.message);
        loadTeam();
    });
}

// ---------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// Presença online: cada usuário avisa que está conectado; só o administrador consulta
// ---------------------------------------------------------------

const PRESENCE_INTERVAL_MS = 45000;
const ONLINE_CHIP_INTERVAL_MS = 30000;
let presenceTimer = null;
let onlineChipTimer = null;

function getPresenceProjectName() {
    try {
        return getActiveProjectRoot()?.querySelector('.folder-title')?.dataset.folderName || '';
    } catch (e) {
        return '';
    }
}

async function sendHeartbeat() {
    if (!AppSession.company || document.hidden) return;
    const { error } = await supabaseClient.rpc('heartbeat', { p_project: getPresenceProjectName() || null });
    if (error) console.warn('Presença indisponível:', error.message);
}

//Ao fechar a página avisa que saiu (fetch com keepalive sobrevive ao fechamento)
function sendGoOffline() {
    if (!AppSession.accessToken) return;
    try {
        fetch(`${SUPABASE_URL}/rest/v1/rpc/go_offline`, {
            method: 'POST',
            keepalive: true,
            headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${AppSession.accessToken}`, 'Content-Type': 'application/json' },
            body: '{}'
        });
    } catch (e) { /* ignora */ }
}

function updateOnlineChip(members) {
    const chip = document.getElementById('onlineChip');
    if (!chip || !AppSession.isAdmin) return;
    const online = (members || []).filter(m => m.user_id === AppSession.userId || m.is_online);
    chip.querySelector('[data-online-count]').textContent = String(online.length);
    chip.title = online.length
        ? `Online agora: ${online.map(m => m.full_name || m.email).join(', ')}`
        : 'Ninguém online';
    chip.classList.toggle('has-others', online.some(m => m.user_id !== AppSession.userId));
}

async function refreshOnlineChip() {
    if (!AppSession.isAdmin || document.hidden) return;
    const { data, error } = await supabaseClient.rpc('list_company_members');
    if (!error) updateOnlineChip(data || []);
}

function startPresence() {
    if (!AppSession.company) return;
    sendHeartbeat();
    presenceTimer = setInterval(sendHeartbeat, PRESENCE_INTERVAL_MS);
    if (AppSession.isAdmin) {
        refreshOnlineChip();
        onlineChipTimer = setInterval(refreshOnlineChip, ONLINE_CHIP_INTERVAL_MS);
        document.getElementById('onlineChip')?.addEventListener('click', () => openAccountModal('team'));
    }
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { sendHeartbeat(); refreshOnlineChip(); }
    });
    window.addEventListener('pagehide', sendGoOffline);
}

function setupAccountMenu() {
    document.querySelectorAll('#userDropdown [data-account-tab]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            openAccountModal(link.dataset.accountTab);
        });
    });
    document.querySelectorAll('#accountModal .account-tab').forEach(btn => {
        btn.addEventListener('click', () => setAccountTab(btn.dataset.tab));
    });
    document.getElementById('closeAccountModal').addEventListener('click', () => {
        document.getElementById('accountModal').style.display = 'none';
    });
    document.getElementById('profileForm').addEventListener('submit', saveProfile);
    document.getElementById('passwordForm').addEventListener('submit', changePassword);
    document.getElementById('companyForm').addEventListener('submit', saveCompany);
    document.getElementById('preferencesForm').addEventListener('submit', savePreferencesForm);
    document.getElementById('inviteForm').addEventListener('submit', sendInvite);
    document.getElementById('signOutEverywhereButton').addEventListener('click', signOutEverywhere);
    document.getElementById('leaveCompanyButton').addEventListener('click', leaveCompany);
    document.getElementById('inviteRole').addEventListener('change', updateInviteRoleHint);
    updateInviteRoleHint();
}

//Explica o que o cargo escolhido no convite permite
function updateInviteRoleHint() {
    const hint = document.getElementById('inviteRoleHint');
    if (hint) hint.textContent = ROLE_DESCRIPTIONS[document.getElementById('inviteRole').value] || '';
}

setupAccountMenu();
appReady.then(renderUserIdentity);
appReady.then(startPresence);
Promise.all([appReady, mapReady]).then(applyStartupPreferences);
