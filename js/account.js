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
    document.querySelectorAll('[data-user-role-badge]').forEach(el => {
        el.textContent = roleLabel;
        el.className = `account-badge account-badge--${AppSession.role || 'member'}`;
    });
    document.querySelectorAll('[data-user-email-value]').forEach(el => { el.value = AppSession.email; });
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

function formatAccountDate(value, withTime = false) {
    if (!value) return '—';
    const date = new Date(value);
    if (isNaN(date)) return '—';
    return withTime
        ? date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

//Navegador e sistema deste aparelho (só para exibição)
function describeThisDevice() {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'sistema desconhecido';
    return `${browser} no ${os}`;
}

function formatPhone(value) {
    const d = String(value || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
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
    document.getElementById('profilePhone').value = formatPhone(profile.phone);
    updateProfileDirtyState();
    closeEmailChange();
    ['currentPassword', 'newPassword', 'newPasswordConfirm'].forEach(id => { document.getElementById(id).value = ''; });
    updatePasswordStrength();
    document.getElementById('prefIdleLock').value = String(prefs.idleLockMinutes || 0);
    document.getElementById('currentDeviceText').textContent = `${describeThisDevice()} · conectado agora`;
    refreshAuthDetails();
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
    document.getElementById('prefMarkerScale').value = prefs.markerScale || 'medio';
}

// ---------------------------------------------------------------
// Perfil, senha e preferências
// ---------------------------------------------------------------

function getProfileFormValues() {
    return {
        full_name: document.getElementById('profileFullName').value.trim(),
        job_title: document.getElementById('profileJobTitle').value.trim() || null,
        phone: document.getElementById('profilePhone').value.trim() || null
    };
}

//Salvar/Descartar só ficam ativos com alteração pendente
function updateProfileDirtyState() {
    const profile = AppSession.profile || {};
    const current = getProfileFormValues();
    const dirty = current.full_name !== (profile.full_name || '')
        || (current.job_title || '') !== (profile.job_title || '')
        || (current.phone || '') !== formatPhone(profile.phone);
    document.getElementById('profileSaveButton').disabled = !dirty;
    document.getElementById('profileResetButton').disabled = !dirty;
}

async function saveProfile(event) {
    event.preventDefault();
    const panel = document.querySelector('#accountModal [data-panel="profile"]');
    const changes = getProfileFormValues();
    if (changes.full_name.length < 2) return setFeedback(panel, 'Informe seu nome completo.', 'error');
    const digits = String(changes.phone || '').replace(/\D/g, '');
    if (digits && (digits.length < 10 || digits.length > 11)) return setFeedback(panel, 'Telefone incompleto: use DDD + número.', 'error');
    await runBusy(document.getElementById('profileSaveButton'), 'Salvando…', async () => {
        const { error } = await supabaseClient.from('profiles').upsert({ id: AppSession.userId, ...changes });
        if (error) return setFeedback(panel, `Não foi possível salvar: ${error.message}`, 'error');
        AppSession.profile = { ...(AppSession.profile || {}), ...changes };
        renderUserIdentity();
        setFeedback(panel, 'Perfil atualizado.');
    });
    updateProfileDirtyState();
}

function resetProfileForm() {
    const profile = AppSession.profile || {};
    document.getElementById('profileFullName').value = profile.full_name || '';
    document.getElementById('profileJobTitle').value = profile.job_title || '';
    document.getElementById('profilePhone').value = formatPhone(profile.phone);
    updateProfileDirtyState();
}

//Confirma que quem está mexendo na conta sabe a senha atual (protege computador deixado aberto)
//Usa um cliente à parte, sem salvar sessão, para não trocar a sessão em uso (nem perder a verificação em duas etapas)
async function verifyCurrentPassword(password) {
    if (!password) return 'Informe sua senha atual.';
    const checker = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'routeMapPasswordCheck' }
    });
    const { error } = await checker.auth.signInWithPassword({ email: AppSession.email, password });
    if (!error) {
        await checker.auth.signOut({ scope: 'local' }).catch(() => {});
        return null;
    }
    return /invalid login credentials|invalid_credentials/i.test(error.message + (error.code || '')) ? 'Senha atual incorreta.' : translateAuthError(error);
}

// --- Troca de e-mail ---
function openEmailChange() {
    document.getElementById('emailChangeForm').hidden = false;
    document.getElementById('emailChangeOpenButton').hidden = true;
    document.getElementById('newEmail').value = '';
    document.getElementById('emailChangePassword').value = '';
    document.getElementById('newEmail').focus();
}

function closeEmailChange() {
    document.getElementById('emailChangeForm').hidden = true;
    document.getElementById('emailChangeOpenButton').hidden = false;
}

async function changeEmail(event) {
    event.preventDefault();
    const form = document.getElementById('emailChangeForm');
    const email = document.getElementById('newEmail').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setFeedback(form, 'Informe um e-mail válido.', 'error');
    if (email === AppSession.email.toLowerCase()) return setFeedback(form, 'Esse já é o seu e-mail atual.', 'error');
    await runBusy(form.querySelector('[type="submit"]'), 'Enviando…', async () => {
        const passwordError = await verifyCurrentPassword(document.getElementById('emailChangePassword').value);
        if (passwordError) return setFeedback(form, passwordError, 'error');
        const { error } = await supabaseClient.auth.updateUser({ email }, { emailRedirectTo: `${location.origin}/login.html` });
        if (error) return setFeedback(form, translateAuthError(error), 'error');
        document.getElementById('emailChangePassword').value = '';
        setFeedback(form, `Enviamos a confirmação para ${email} (e um aviso para o e-mail atual). A troca vale depois de clicar no link.`);
    });
}

// --- Senha ---
function evaluatePassword(password) {
    const rules = {
        length: password.length >= 8,
        case: /[a-z]/.test(password) && /[A-Z]/.test(password),
        number: /\d/.test(password),
        symbol: /[^A-Za-z0-9]/.test(password),
    };
    let score = Object.values(rules).filter(Boolean).length;
    if (password.length >= 12 && score >= 3) score = Math.min(4, score + 1);
    if (!rules.length) score = Math.min(score, 1);
    if (/^(.)\1+$/.test(password) || /^(12345678|password|senha123|qwerty)/i.test(password)) score = 1;
    return { rules, score: password ? Math.max(1, score) : 0 };
}

function updatePasswordStrength() {
    const password = document.getElementById('newPassword').value;
    const confirmation = document.getElementById('newPasswordConfirm').value;
    const { rules, score } = evaluatePassword(password);
    rules.match = !!password && password === confirmation;
    const meter = document.getElementById('passwordStrength');
    meter.dataset.level = String(score);
    meter.querySelector('.password-strength__label').textContent = ['Digite a nova senha', 'Fraca', 'Razoável', 'Boa', 'Forte'][score];
    document.querySelectorAll('#passwordRules [data-rule]').forEach(li => li.classList.toggle('is-ok', !!rules[li.dataset.rule]));
}

async function changePassword(event) {
    event.preventDefault();
    const panel = document.getElementById('passwordForm');
    const current = document.getElementById('currentPassword').value;
    const password = document.getElementById('newPassword').value;
    const confirmation = document.getElementById('newPasswordConfirm').value;
    const { rules, score } = evaluatePassword(password);
    if (!rules.length) return setFeedback(panel, 'A nova senha precisa ter pelo menos 8 caracteres.', 'error');
    if (score < 3) return setFeedback(panel, 'Senha fraca: misture maiúsculas, minúsculas, números e símbolos.', 'error');
    if (password !== confirmation) return setFeedback(panel, 'As senhas não conferem.', 'error');
    if (password === current) return setFeedback(panel, 'A nova senha precisa ser diferente da atual.', 'error');
    await runBusy(panel.querySelector('[type="submit"]'), 'Alterando…', async () => {
        const passwordError = await verifyCurrentPassword(current);
        if (passwordError) return setFeedback(panel, passwordError, 'error');
        const { error } = await supabaseClient.auth.updateUser({ password });
        if (error) return setFeedback(panel, translateAuthError(error), 'error');
        ['currentPassword', 'newPassword', 'newPasswordConfirm'].forEach(id => { document.getElementById(id).value = ''; });
        updatePasswordStrength();
        setFeedback(panel, 'Senha alterada. Se você usa o sistema em outros aparelhos, considere "Sair de todos".');
    });
}

// --- Verificação em duas etapas (TOTP) ---
let mfaState = { available: true, factor: null, enrolling: null };

async function loadMfaState() {
    try {
        const { data, error } = await supabaseClient.auth.mfa.listFactors();
        if (error) throw error;
        mfaState.available = true;
        mfaState.factor = (data?.totp || []).find(f => f.status === 'verified') || null;
    } catch (e) {
        console.warn('Verificação em duas etapas indisponível:', e);
        mfaState.available = false;
        mfaState.factor = null;
    }
    renderMfaState();
    return mfaState;
}

function renderMfaState() {
    const on = !!mfaState.factor;
    const title = document.getElementById('mfaStatusTitle');
    const text = document.getElementById('mfaStatusText');
    const card = document.getElementById('mfaStatusCard');
    card.classList.toggle('account-card--ok', on);
    if (!mfaState.available) {
        title.textContent = 'Indisponível no momento';
        text.textContent = 'Não foi possível consultar a verificação em duas etapas. Tente mais tarde.';
    } else if (on) {
        title.textContent = 'Ativada';
        text.textContent = `Ao entrar, o sistema pede o código do aplicativo autenticador. Ativada em ${formatAccountDate(mfaState.factor.created_at)}.`;
    } else {
        title.textContent = 'Desativada';
        text.textContent = 'Além da senha, pede um código do aplicativo autenticador do celular ao entrar. Recomendado.';
    }
    document.getElementById('mfaEnableButton').hidden = !mfaState.available || on || !!mfaState.enrolling;
    document.getElementById('mfaDisableButton').hidden = !on || !document.getElementById('mfaDisableForm').hidden;
    const fact = document.getElementById('accountMfaFact');
    if (fact) {
        fact.textContent = !mfaState.available ? '—' : on ? 'Ativada' : 'Desativada';
        fact.dataset.state = on ? 'on' : 'off';
    }
    renderSecurityLevel();
}

async function startMfaEnroll() {
    const form = document.getElementById('mfaEnrollForm');
    const button = document.getElementById('mfaEnableButton');
    await runBusy(button, 'Preparando…', async () => {
        //Remove tentativas anteriores não concluídas
        const { data: factors } = await supabaseClient.auth.mfa.listFactors();
        for (const f of (factors?.all || []).filter(f => f.status !== 'verified')) {
            await supabaseClient.auth.mfa.unenroll({ factorId: f.id });
        }
        const { data, error } = await supabaseClient.auth.mfa.enroll({ factorType: 'totp', friendlyName: `ROUTE MAP ${Date.now()}` });
        if (error) return showAlert('Não foi possível ativar', translateAuthError(error));
        mfaState.enrolling = data;
        const qr = data.totp.qr_code || '';
        document.getElementById('mfaQrImage').src = qr.startsWith('data:') ? qr : `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`;
        document.getElementById('mfaSecretText').textContent = data.totp.secret.replace(/(.{4})/g, '$1 ').trim();
        document.getElementById('mfaEnrollCode').value = '';
        form.hidden = false;
        renderMfaState();
        document.getElementById('mfaEnrollCode').focus();
    });
}

async function cancelMfaEnroll() {
    const pending = mfaState.enrolling;
    mfaState.enrolling = null;
    document.getElementById('mfaEnrollForm').hidden = true;
    if (pending) await supabaseClient.auth.mfa.unenroll({ factorId: pending.id }).catch(() => {});
    renderMfaState();
}

async function confirmMfaEnroll(event) {
    event.preventDefault();
    const form = document.getElementById('mfaEnrollForm');
    const code = document.getElementById('mfaEnrollCode').value.trim();
    if (!/^\d{6}$/.test(code)) return setFeedback(form, 'Digite os 6 dígitos que aparecem no aplicativo.', 'error');
    await runBusy(form.querySelector('[type="submit"]'), 'Verificando…', async () => {
        const { error } = await supabaseClient.auth.mfa.challengeAndVerify({ factorId: mfaState.enrolling.id, code });
        if (error) return setFeedback(form, 'Código incorreto ou expirado. Confira o horário do celular e use o código atual.', 'error');
        mfaState.enrolling = null;
        form.hidden = true;
        await loadMfaState();
        showToast('Verificação em duas etapas ativada', 'No próximo acesso o sistema vai pedir o código do aplicativo.');
    });
}

function openMfaDisable() {
    document.getElementById('mfaDisableForm').hidden = false;
    document.getElementById('mfaDisableCode').value = '';
    document.getElementById('mfaDisableCode').focus();
    renderMfaState();
}

function closeMfaDisable() {
    document.getElementById('mfaDisableForm').hidden = true;
    renderMfaState();
}

async function confirmMfaDisable(event) {
    event.preventDefault();
    const form = document.getElementById('mfaDisableForm');
    const code = document.getElementById('mfaDisableCode').value.trim();
    if (!/^\d{6}$/.test(code)) return setFeedback(form, 'Digite os 6 dígitos do aplicativo.', 'error');
    await runBusy(form.querySelector('[type="submit"]'), 'Desativando…', async () => {
        const factorId = mfaState.factor.id;
        const verify = await supabaseClient.auth.mfa.challengeAndVerify({ factorId, code });
        if (verify.error) return setFeedback(form, 'Código incorreto ou expirado.', 'error');
        const { error } = await supabaseClient.auth.mfa.unenroll({ factorId });
        if (error) return setFeedback(form, translateAuthError(error), 'error');
        form.hidden = true;
        await loadMfaState();
        showToast('Verificação em duas etapas desativada', 'Sua conta volta a pedir só a senha.');
    });
}

// --- Nível de proteção, datas e sessões ---
function renderSecurityLevel() {
    const idle = Number(AppSession.profile?.preferences?.idleLockMinutes) || 0;
    const checks = [
        { ok: true, text: 'Senha cadastrada' },
        { ok: !!mfaState.factor, text: 'Verificação em duas etapas' },
        { ok: idle > 0, text: 'Bloqueio por inatividade' },
    ];
    const score = checks.filter(c => c.ok).length;
    const level = ['Baixa', 'Básica', 'Boa', 'Forte'][score];
    const box = document.getElementById('securityLevel');
    if (!box) return;
    box.dataset.level = String(score);
    document.getElementById('securityLevelLabel').textContent = level;
    document.getElementById('securityLevelBar').style.width = `${(score / checks.length) * 100}%`;
    document.getElementById('securityChecklist').innerHTML = checks
        .map(c => `<li class="${c.ok ? 'is-ok' : ''}">${escapeHtml(c.text)}</li>`).join('');
    const flag = document.getElementById('userMenuSecurityFlag');
    if (flag) {
        flag.hidden = !mfaState.available || !!mfaState.factor;
        flag.textContent = 'Ativar 2FA';
    }
}

async function refreshAuthDetails() {
    try {
        const { data } = await supabaseClient.auth.getUser();
        const user = data?.user;
        document.getElementById('accountCreatedAt').textContent = formatAccountDate(user?.created_at);
        document.getElementById('accountLastSignIn').textContent = formatAccountDate(user?.last_sign_in_at, true);
        const note = document.querySelector('#emailChangeCard p');
        if (note) note.textContent = user?.new_email
            ? `Troca para ${user.new_email} aguardando confirmação no e-mail.`
            : 'Usado para entrar e recuperar a senha.';
    } catch (e) { /* mantém "—" */ }
    loadMfaState();
}

function signOutHere() {
    showConfirm('Sair deste dispositivo', 'Encerrar a sessão neste navegador?', async () => {
        await Promise.resolve(supabaseClient.rpc('go_offline')).catch(() => {});
        await supabaseClient.auth.signOut({ scope: 'local' });
        window.location.replace('login.html');
    });
}

function signOutEverywhere() {
    showConfirm('Sair de todos os dispositivos', 'Encerrar sua sessão em todos os computadores e celulares? Você precisará entrar de novo.', async () => {
        await Promise.resolve(supabaseClient.rpc('go_offline')).catch(() => {});
        await supabaseClient.auth.signOut({ scope: 'global' });
        window.location.replace('login.html');
    });
}

// --- Bloqueio por inatividade ---
const IDLE_WARNING_MS = 60000;
let idleTimer = null;
let idleWarnTimer = null;
let idleLastActivity = Date.now();

function scheduleIdleLock() {
    clearTimeout(idleTimer);
    clearTimeout(idleWarnTimer);
    const minutes = Number(AppSession.profile?.preferences?.idleLockMinutes) || 0;
    if (!minutes) return;
    const total = minutes * 60000;
    idleWarnTimer = setTimeout(() => {
        showToast('Sessão quase expirando', 'Sem atividade: você será desconectado em 1 minuto. Mexa o mouse para continuar.', 'progress');
    }, Math.max(0, total - IDLE_WARNING_MS));
    idleTimer = setTimeout(async () => {
        await Promise.resolve(supabaseClient.rpc('go_offline')).catch(() => {});
        try { sessionStorage.setItem('routeMapIdleLogout', '1'); } catch (e) { /* ignora */ }
        await supabaseClient.auth.signOut({ scope: 'local' });
        window.location.replace('login.html');
    }, total);
}

function noteActivity() {
    const now = Date.now();
    if (now - idleLastActivity < 5000) return; //no máximo um reinício a cada 5 s
    idleLastActivity = now;
    scheduleIdleLock();
}

function startIdleLock() {
    ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, noteActivity, { passive: true, capture: true });
    });
    scheduleIdleLock();
}

async function saveIdleLock(event) {
    const minutes = Number(event.target.value) || 0;
    await saveUserPreferences({ idleLockMinutes: minutes });
    scheduleIdleLock();
    renderSecurityLevel();
    showToast('Bloqueio por inatividade', minutes ? `A sessão encerra após ${event.target.selectedOptions[0].textContent} sem uso.` : 'Desligado.');
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
    const markerScale = document.getElementById('prefMarkerScale').value;
    applyTheme(theme);
    applyMarkerScale(markerScale);
    if (typeof map !== 'undefined' && map) map.setMapTypeId(mapType);
    const ok = await saveUserPreferences({ theme, mapType, reopenLastProject, markerScale });
    setFeedback(panel, ok ? 'Preferências salvas.' : 'Não foi possível salvar as preferências.', ok ? 'success' : 'error');
}

function lastProjectStorageKey() {
    return `routeMapLastProject:${AppSession.userId}`;
}

function rememberLastProject(projectId) {
    try { localStorage.setItem(lastProjectStorageKey(), projectId); } catch (e) { /* ignora */ }
}

//Redesenha todos os marcadores no tamanho escolhido nas preferências
function applyMarkerScale(scale) {
    if (!setMarkerScale(scale)) return;
    if (typeof markers === 'undefined') return;
    markers.forEach(info => {
        if (!info.marker) return;
        if (info.type === 'CLIENTE') return applyClientAppearance(info);
        const isCasa = info.type === 'CASA';
        info.marker.setIcon(buildMarkerMapIcon(info.type, {
            color: info.color || (isCasa ? '#ffffff' : '#f59e0b'),
            text: isCasa ? info.name : '',
            labelColor: info.labelColor,
        }));
    });
}

//Aplica tema, tipo de mapa e reabre o último projeto, conforme as preferências
function applyStartupPreferences() {
    const prefs = AppSession.profile?.preferences || {};
    if (prefs.theme && prefs.theme !== document.documentElement.getAttribute('data-theme')) applyTheme(prefs.theme);
    if (prefs.mapType && map) map.setMapTypeId(prefs.mapType);
    applyMarkerScale(prefs.markerScale);
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
        if (mfaState.enrolling) cancelMfaEnroll();
        document.getElementById('accountModal').style.display = 'none';
    });
    document.getElementById('profileForm').addEventListener('submit', saveProfile);
    document.getElementById('profileForm').addEventListener('input', updateProfileDirtyState);
    document.getElementById('profileResetButton').addEventListener('click', resetProfileForm);
    document.getElementById('profilePhone').addEventListener('input', (e) => { e.target.value = formatPhone(e.target.value); });
    document.getElementById('emailChangeOpenButton').addEventListener('click', openEmailChange);
    document.getElementById('emailChangeCancelButton').addEventListener('click', closeEmailChange);
    document.getElementById('emailChangeForm').addEventListener('submit', changeEmail);
    document.getElementById('passwordForm').addEventListener('submit', changePassword);
    ['newPassword', 'newPasswordConfirm'].forEach(id => document.getElementById(id).addEventListener('input', updatePasswordStrength));
    document.querySelectorAll('#accountModal [data-toggle-password]').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = btn.parentElement.querySelector('input');
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
            btn.querySelector('use').setAttribute('href', show ? '#i-eye-off' : '#i-eye');
        });
    });
    document.querySelectorAll('#accountModal .mfa-code').forEach(input => {
        input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
    });
    document.getElementById('mfaEnableButton').addEventListener('click', startMfaEnroll);
    document.getElementById('mfaEnrollCancelButton').addEventListener('click', cancelMfaEnroll);
    document.getElementById('mfaEnrollForm').addEventListener('submit', confirmMfaEnroll);
    document.getElementById('mfaDisableButton').addEventListener('click', openMfaDisable);
    document.getElementById('mfaDisableCancelButton').addEventListener('click', closeMfaDisable);
    document.getElementById('mfaDisableForm').addEventListener('submit', confirmMfaDisable);
    document.getElementById('mfaCopySecretButton').addEventListener('click', () => {
        const secret = document.getElementById('mfaSecretText').textContent.replace(/\s/g, '');
        navigator.clipboard?.writeText(secret).then(() => showToast('Chave copiada', 'Cole no aplicativo autenticador.'));
    });
    document.getElementById('signOutHereButton').addEventListener('click', signOutHere);
    document.getElementById('prefIdleLock').addEventListener('change', saveIdleLock);
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
appReady.then(startIdleLock);
appReady.then(loadMfaState);
Promise.all([appReady, mapReady]).then(applyStartupPreferences);
