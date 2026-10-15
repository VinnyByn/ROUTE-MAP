// Painel do sistema (só para o dono do sistema): empresas clientes, o administrador de cada uma,
// bloqueio/reativação e senha provisória. Tudo passa pela função do servidor admin-users (owner.*).
// Depende de js/core/supabase-client.js (callAdminUsers) e js/app.js (showConfirm, showAlert, showToast).

function openPlatformPanel() {
    if (!AppSession.isPlatformAdmin) return;
    document.getElementById('userDropdown')?.classList.remove('show');
    document.getElementById('platformModal').style.display = 'flex';
    loadPlatformCompanies();
}

function closePlatformPanel() {
    document.getElementById('platformModal').style.display = 'none';
}

function setPlatformFeedback(text, kind = 'success') {
    const el = document.getElementById('platformFeedback');
    el.textContent = text;
    el.dataset.kind = kind;
    el.hidden = !text;
}

async function loadPlatformCompanies() {
    const list = document.getElementById('platformCompaniesList');
    list.innerHTML = '<li class="platform-list__state">Carregando…</li>';
    try {
        const { companies } = await callAdminUsers('owner.list_companies');
        renderPlatformCompanies(companies || []);
    } catch (error) {
        list.innerHTML = `<li class="platform-list__state platform-list__state--error">${escapeHtml(error.message)}</li>`;
    }
}

function renderPlatformCompanies(companies) {
    const list = document.getElementById('platformCompaniesList');
    if (!companies.length) {
        list.innerHTML = '<li class="platform-list__state">Nenhuma empresa ainda.</li>';
        return;
    }
    list.innerHTML = '';
    companies.forEach(company => {
        const own = company.id === AppSession.company?.id;
        const li = document.createElement('li');
        li.className = `platform-list__item${company.blocked ? ' is-blocked' : ''}`;
        const admins = (company.admins || []).map(a => a.email).filter(Boolean);
        li.innerHTML = `
            <div class="platform-list__info">
                <strong>${escapeHtml(company.name)}${own ? ' <em>(sua empresa)</em>' : ''}</strong>
                <span>${[company.document ? `CNPJ ${escapeHtml(company.document)}` : '', `${company.members} usuário(s)`, `desde ${new Date(company.created_at).toLocaleDateString('pt-BR')}`].filter(Boolean).join(' · ')}</span>
                <span>Administrador: ${admins.length ? admins.map(escapeHtml).join(', ') : '—'}</span>
            </div>
            <span class="platform-badge${company.blocked ? ' is-blocked' : ''}" title="${escapeHtml(company.blocked_reason || '')}">${company.blocked ? 'Bloqueada' : 'Ativa'}</span>
            <div class="platform-list__actions">
                ${company.admins?.length && !own ? '<button type="button" class="btn btn-secondary account-small-btn" data-platform="reset">Senha do admin</button>' : ''}
                ${own ? '' : `<button type="button" class="btn ${company.blocked ? 'btn-success' : 'btn-danger'} account-small-btn" data-platform="block">${company.blocked ? 'Reativar' : 'Bloquear'}</button>`}
            </div>`;
        li.querySelector('[data-platform="block"]')?.addEventListener('click', () => togglePlatformCompanyBlock(company));
        li.querySelector('[data-platform="reset"]')?.addEventListener('click', () => resetPlatformAdminPassword(company));
        list.appendChild(li);
    });
}

function togglePlatformCompanyBlock(company) {
    const blocking = !company.blocked;
    const message = blocking
        ? `Bloquear "${company.name}"? A equipe continua entrando, mas não acessa projetos nem configurações até você reativar.`
        : `Reativar "${company.name}"? A equipe volta a acessar tudo.`;
    showConfirm(blocking ? 'Bloquear empresa' : 'Reativar empresa', message, async () => {
        try {
            await callAdminUsers('owner.set_blocked', { company_id: company.id, blocked: blocking });
            showToast(blocking ? 'Empresa bloqueada' : 'Empresa reativada', company.name);
            loadPlatformCompanies();
        } catch (error) {
            showAlert('Não foi possível concluir', error.message);
        }
    });
}

function resetPlatformAdminPassword(company) {
    const admin = company.admins[0];
    showConfirm('Senha do administrador', `Gerar uma senha provisória para ${admin.email} (${company.name})? A senha atual deixa de valer.`, async () => {
        try {
            const result = await callAdminUsers('owner.reset_password', { user_id: admin.id });
            showPlatformCredentials('Senha redefinida', admin.email, result.password);
        } catch (error) {
            showAlert('Não foi possível redefinir', error.message);
        }
    });
}

function showPlatformCredentials(title, email, password) {
    document.getElementById('platformCredentialsTitle').textContent = title;
    document.getElementById('platformCredentialsEmail').textContent = email;
    document.getElementById('platformCredentialsPassword').textContent = password;
    const box = document.getElementById('platformCredentials');
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function createPlatformCompany(event) {
    event.preventDefault();
    const value = (id) => document.getElementById(id).value.trim();
    const payload = {
        company_name: value('platformCompanyName'),
        document: value('platformCompanyDocument') || undefined,
        admin_name: value('platformAdminName'),
        admin_email: value('platformAdminEmail').toLowerCase(),
        password: value('platformAdminPassword') || undefined,
    };
    if (payload.company_name.length < 2) return setPlatformFeedback('Informe o nome da empresa.', 'error');
    if (payload.admin_name.length < 2) return setPlatformFeedback('Informe o nome do administrador.', 'error');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.admin_email)) return setPlatformFeedback('Informe o e-mail do administrador.', 'error');
    if (payload.password && payload.password.length < 8) return setPlatformFeedback('A senha provisória precisa ter pelo menos 8 caracteres (ou deixe em branco).', 'error');
    const button = event.submitter || document.querySelector('#platformCompanyForm [type="submit"]');
    button.disabled = true;
    try {
        const result = await callAdminUsers('owner.create_company', payload);
        document.getElementById('platformCompanyForm').reset();
        setPlatformFeedback('');
        showPlatformCredentials(`Empresa criada: ${result.company?.name || payload.company_name}`, result.admin?.email || payload.admin_email, result.password);
        loadPlatformCompanies();
    } catch (error) {
        setPlatformFeedback(error.message, 'error');
    } finally {
        button.disabled = false;
    }
}

async function copyPlatformCredentials() {
    const email = document.getElementById('platformCredentialsEmail').textContent;
    const password = document.getElementById('platformCredentialsPassword').textContent;
    const text = `Acesso ao ROUTE MAP\n${location.origin}/login.html\nE-mail: ${email}\nSenha provisória: ${password}\n(Você cria a sua senha no primeiro acesso.)`;
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copiado', 'Os dados de acesso foram copiados.');
    } catch (e) {
        showAlert('Copie os dados', text);
    }
}

(function setupPlatformPanel() {
    const button = document.getElementById('platformPanelButton');
    button?.addEventListener('click', (e) => { e.preventDefault(); openPlatformPanel(); });
    document.getElementById('closePlatformModal')?.addEventListener('click', closePlatformPanel);
    document.getElementById('platformCompanyForm')?.addEventListener('submit', createPlatformCompany);
    document.getElementById('reloadPlatformCompanies')?.addEventListener('click', loadPlatformCompanies);
    document.getElementById('copyPlatformCredentials')?.addEventListener('click', copyPlatformCredentials);
    document.getElementById('closePlatformCredentials')?.addEventListener('click', () => { document.getElementById('platformCredentials').hidden = true; });
    //O item do menu só aparece para o dono do sistema
    whenAppReady(() => { if (button) button.hidden = !AppSession.isPlatformAdmin; });
})();
