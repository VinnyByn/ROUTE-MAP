// Conexão com o Supabase (projeto GeoVini) — usada pelo login e pelo sistema.
// A chave publicável é pública por natureza: o acesso aos dados é protegido pelas
// políticas de segurança (RLS) definidas em supabase/migrations.
const SUPABASE_URL = 'https://ipdpilzhlchcxijsmgsf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PEBdXchznn68Mkg-YmPfiQ_6uYQt0R4';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

//Cargos: admin controla tudo; projetista cria/edita/salva projetos; member (Membro) só visualiza.
const ROLE_LABELS = { admin: 'Administrador', projetista: 'Projetista', member: 'Membro' };
const ROLE_DESCRIPTIONS = {
    admin: 'Controla tudo: equipe, convites, dados da empresa, preços, kits e configurações. Vê quem está online.',
    projetista: 'Cria, edita e salva projetos. Não acessa a parte administrativa.',
    member: 'Somente visualiza: abre e consulta projetos, sem editar nem salvar.'
};

//Contexto do usuário logado (preenchido por loadAppContext)
const AppSession = {
    userId: null,
    email: '',
    profile: null,
    company: null,        // { id, name, document, role }
    pendingInvite: null,  // { id, company_name, role }
    accessToken: null,    // usado só para avisar "saí" ao fechar a página
    get role() { return this.company?.role || null; },
    get isAdmin() { return this.company?.role === 'admin'; },
    get canEdit() { return this.company?.role === 'admin' || this.company?.role === 'projetista'; },
    get isViewer() { return !!this.company && !this.canEdit; },
    get roleLabel() { return ROLE_LABELS[this.company?.role] || ''; },
    get displayName() { return this.profile?.full_name || this.email || 'Usuário'; }
};

supabaseClient.auth.onAuthStateChange((_event, session) => { AppSession.accessToken = session?.access_token || null; });

//Barreira de segurança no navegador (o banco também bloqueia por RLS). Retorna false e avisa se o cargo não permite.
function requireEdit(actionLabel = 'fazer alterações') {
    if (AppSession.canEdit) return true;
    const message = `Seu cargo (${AppSession.roleLabel || 'Membro'}) é somente de visualização. Peça a um administrador para ${actionLabel}.`;
    if (typeof showToast === 'function') showToast('Somente visualização', message, 'progress');
    else console.warn(message);
    return false;
}

async function loadAppContext() {
    const { data, error } = await supabaseClient.rpc('get_my_context');
    if (error) throw error;
    AppSession.userId = data.user_id;
    AppSession.email = data.email || '';
    AppSession.profile = data.profile || {};
    AppSession.company = data.company || null;
    AppSession.pendingInvite = data.pending_invite || null;
    return AppSession;
}

//Mensagens de erro do Supabase Auth em português
function translateAuthError(error) {
    const message = String(error?.message || error || '');
    const code = error?.code || '';
    const map = [
        [/invalid login credentials|invalid_credentials/i, 'E-mail ou senha incorretos.'],
        [/email not confirmed|email_not_confirmed/i, 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.'],
        [/user already registered|user_already_exists/i, 'Já existe uma conta com este e-mail.'],
        [/password should be at least|weak_password/i, 'A senha precisa ter pelo menos 8 caracteres.'],
        [/rate limit|over_email_send_rate_limit|too many/i, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'],
        [/unable to validate email|invalid email|email_address_invalid/i, 'O formato do e-mail é inválido.'],
        [/same password|same_password/i, 'A nova senha precisa ser diferente da atual.'],
        [/failed to fetch|network/i, 'Sem conexão com o servidor. Verifique sua internet.']
    ];
    for (const [pattern, text] of map) {
        if (pattern.test(message) || pattern.test(code)) return text;
    }
    return message || 'Ocorreu um erro inesperado.';
}
