// Conexão com o Supabase (projeto GeoVini) — usada pelo login e pelo sistema.
// A chave publicável é pública por natureza: o acesso aos dados é protegido pelas
// políticas de segurança (RLS) definidas em supabase/migrations.
const SUPABASE_URL = 'https://ipdpilzhlchcxijsmgsf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PEBdXchznn68Mkg-YmPfiQ_6uYQt0R4';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

//Contexto do usuário logado (preenchido por loadAppContext)
const AppSession = {
    userId: null,
    email: '',
    profile: null,
    company: null,        // { id, name, document, role }
    pendingInvite: null,  // { id, company_name, role }
    get isAdmin() { return this.company?.role === 'admin'; },
    get displayName() { return this.profile?.full_name || this.email || 'Usuário'; }
};

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
