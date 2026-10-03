// Tela de login: entrar, criar conta, recuperar senha, código da verificação em 2 etapas e primeiro acesso
// (criar empresa ou aceitar convite). Depende de js/supabase-client.js.

const views = ['authLoading', 'viewLogin', 'viewSignup', 'viewCheckEmail', 'viewForgot', 'viewReset', 'viewMfa', 'viewCompany'];
const goTargets = { login: 'viewLogin', signup: 'viewSignup', forgot: 'viewForgot' };
let recoveryMode = /type=recovery/.test(location.hash);

function showView(id) {
    views.forEach(v => { document.getElementById(v).hidden = v !== id; });
    document.querySelectorAll('.error-message, .info-message').forEach(el => { el.textContent = ''; el.style.display = 'none'; });
    const firstInput = document.querySelector(`#${id} input`);
    if (firstInput) setTimeout(() => firstInput.focus(), 30);
}

function setMessage(container, text, kind = 'error') {
    const el = container.querySelector(kind === 'error' ? '.error-message' : '.info-message');
    if (!el) return;
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
}

async function withBusy(button, busyText, task) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
    try { return await task(); } finally { button.disabled = false; button.textContent = original; }
}

//Conta com verificação em duas etapas: pede o código antes de liberar o sistema
async function needsMfaCode() {
    try {
        const { data, error } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
        return !error && data?.nextLevel === 'aal2' && data?.currentLevel !== 'aal2';
    } catch (e) {
        return false;
    }
}

//Depois do login: garante que o usuário tenha uma empresa antes de abrir o sistema
async function routeAfterLogin() {
    showView('authLoading');
    if (await needsMfaCode()) return showView('viewMfa');
    try {
        await loadAppContext();
    } catch (error) {
        console.error(error);
        showView('viewLogin');
        setMessage(document.getElementById('viewLogin'), 'Não foi possível carregar sua conta. ' + translateAuthError(error));
        return;
    }
    if (AppSession.company) {
        window.location.replace('index.html');
        return;
    }
    document.querySelectorAll('.current-email').forEach(el => { el.textContent = AppSession.email; });
    const invite = AppSession.pendingInvite;
    document.getElementById('companyInvite').hidden = !invite;
    document.getElementById('companyCreate').hidden = !!invite;
    if (invite) {
        document.getElementById('inviteCompanyName').textContent = invite.company_name;
        document.getElementById('inviteRoleName').textContent = ROLE_LABELS[invite.role] || invite.role;
    }
    showView('viewCompany');
}

document.querySelectorAll('[data-go]').forEach(btn => {
    btn.addEventListener('click', () => {
        const loginEmail = document.getElementById('loginEmail').value.trim();
        if (btn.dataset.go === 'forgot' && loginEmail) document.getElementById('forgotEmail').value = loginEmail;
        showView(goTargets[btn.dataset.go]);
    });
});

document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const view = document.getElementById('viewLogin');
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return setMessage(view, 'Informe e-mail e senha.');
    await withBusy(event.submitter || view.querySelector('.login-button'), 'Entrando…', async () => {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) return setMessage(view, translateAuthError(error));
        await routeAfterLogin();
    });
});

document.getElementById('signupForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const view = document.getElementById('viewSignup');
    const fullName = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirm = document.getElementById('signupPasswordConfirm').value;
    if (!fullName || !email) return setMessage(view, 'Preencha nome e e-mail.');
    if (password.length < 8) return setMessage(view, 'A senha precisa ter pelo menos 8 caracteres.');
    if (password !== confirm) return setMessage(view, 'As senhas não conferem.');
    await withBusy(view.querySelector('.login-button'), 'Criando…', async () => {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: fullName },
                emailRedirectTo: location.origin + location.pathname
            }
        });
        if (error) return setMessage(view, translateAuthError(error));
        if (data.session) return routeAfterLogin();
        document.getElementById('checkEmailAddress').textContent = email;
        showView('viewCheckEmail');
    });
});

document.getElementById('forgotForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const view = document.getElementById('viewForgot');
    const email = document.getElementById('forgotEmail').value.trim();
    if (!email) return setMessage(view, 'Informe seu e-mail.');
    await withBusy(view.querySelector('.login-button'), 'Enviando…', async () => {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: location.origin + location.pathname
        });
        if (error) return setMessage(view, translateAuthError(error));
        setMessage(view, '');
        setMessage(view, 'Se houver uma conta com este e-mail, você receberá o link em instantes.', 'info');
    });
});

document.getElementById('resetForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const view = document.getElementById('viewReset');
    const password = document.getElementById('resetPassword').value;
    const confirm = document.getElementById('resetPasswordConfirm').value;
    if (password.length < 8) return setMessage(view, 'A senha precisa ter pelo menos 8 caracteres.');
    if (password !== confirm) return setMessage(view, 'As senhas não conferem.');
    await withBusy(view.querySelector('.login-button'), 'Salvando…', async () => {
        const { error } = await supabaseClient.auth.updateUser({ password });
        if (error) return setMessage(view, translateAuthError(error));
        recoveryMode = false;
        history.replaceState(null, '', location.pathname);
        await routeAfterLogin();
    });
});

document.getElementById('acceptInviteButton').addEventListener('click', async (event) => {
    const view = document.getElementById('companyInvite');
    await withBusy(event.currentTarget, 'Entrando…', async () => {
        const { error } = await supabaseClient.rpc('accept_pending_invite');
        if (error) return setMessage(view, translateAuthError(error));
        await routeAfterLogin();
    });
});

document.getElementById('companyForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const view = document.getElementById('companyCreate');
    const name = document.getElementById('companyName').value.trim();
    const documentNumber = document.getElementById('companyDocument').value.trim();
    if (name.length < 2) return setMessage(view, 'Informe o nome da empresa.');
    await withBusy(view.querySelector('.login-button'), 'Criando…', async () => {
        const { error } = await supabaseClient.rpc('create_company', { p_name: name, p_document: documentNumber || null });
        if (error) return setMessage(view, translateAuthError(error));
        await routeAfterLogin();
    });
});

document.getElementById('mfaCode').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
});

document.getElementById('mfaForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const view = document.getElementById('viewMfa');
    const code = document.getElementById('mfaCode').value.trim();
    if (!/^\d{6}$/.test(code)) return setMessage(view, 'Digite os 6 dígitos do aplicativo autenticador.');
    await withBusy(view.querySelector('.login-button'), 'Verificando…', async () => {
        const { data: factors, error: listError } = await supabaseClient.auth.mfa.listFactors();
        const factor = (factors?.totp || []).find(f => f.status === 'verified');
        if (listError || !factor) return setMessage(view, 'Não foi possível encontrar o autenticador desta conta.');
        const { error } = await supabaseClient.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
        if (error) {
            document.getElementById('mfaCode').value = '';
            return setMessage(view, /invalid|expired/i.test(error.message) ? 'Código incorreto ou expirado. Tente o código atual do aplicativo.' : translateAuthError(error));
        }
        await routeAfterLogin();
    });
});

document.getElementById('mfaLogoutButton').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    showView('viewLogin');
});

document.getElementById('companyLogoutButton').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    showView('viewLogin');
});

supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
        recoveryMode = true;
        showView('viewReset');
    }
});

(async function init() {
    const { data } = await supabaseClient.auth.getSession();
    if (recoveryMode && data.session) return showView('viewReset');
    if (data.session) return routeAfterLogin();
    showView('viewLogin');
    try {
        if (sessionStorage.getItem('routeMapIdleLogout')) {
            sessionStorage.removeItem('routeMapIdleLogout');
            setMessage(document.getElementById('viewLogin'), 'Sua sessão foi encerrada por inatividade. Entre novamente.', 'info');
        }
    } catch (e) { /* ignora */ }
})();

(function setupLoginTheme() {
    const button = document.getElementById('loginThemeToggle');
    const label = document.getElementById('loginThemeLabel');
    function apply(theme) {
        const nextTheme = theme === 'dark' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', nextTheme);
        try { localStorage.setItem('routeMapTheme', nextTheme); } catch (e) {}
        if (label) label.textContent = nextTheme === 'dark' ? 'Tema claro' : 'Tema escuro';
    }
    apply(document.documentElement.getAttribute('data-theme'));
    button.addEventListener('click', function () {
        apply(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
})();
