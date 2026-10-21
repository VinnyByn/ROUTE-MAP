// Contas criadas pelo administrador da empresa e pelo dono do sistema (senha provisória, troca no 1º acesso).
// Roda no servidor do Supabase com a chave de serviço; o navegador só chama esta função com a sessão do usuário.
// As regras de quem pode o quê ficam aqui e no banco (supabase/migrations/20261016120000_contas_pelo_admin.sql).
//
// Ações (POST { action, ... }):
//   team.create          administrador: cria usuário da empresa  { email, full_name, role, password? }
//   team.reset_password  administrador: nova senha provisória    { user_id, password? }
//   owner.list_companies dono do sistema: empresas, equipe e administradores
//   owner.create_company dono do sistema: empresa + administrador { company_name, document?, admin_email, admin_name, password? }
//   owner.set_blocked    dono do sistema: bloqueia/reativa        { company_id, blocked, reason? }
//   owner.reset_password dono do sistema: nova senha provisória   { user_id, password? }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ROLES = ['admin', 'projetista', 'tecnico', 'member'];
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

//Senha provisória legível (sem 0/O, 1/l/I): 4-4-4
export function makeTemporaryPassword(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

function readPassword(value: unknown): string {
  const password = String(value ?? '').trim();
  if (!password) return makeTemporaryPassword();
  if (password.length < 8) throw new HttpError(400, 'A senha provisória precisa ter pelo menos 8 caracteres.');
  return password;
}

function readEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-mail inválido.');
  return email;
}

function readName(value: unknown, label: string): string {
  const name = String(value ?? '').trim();
  if (name.length < 2 || name.length > 120) throw new HttpError(400, `Informe ${label}.`);
  return name;
}

// deno-lint-ignore no-explicit-any
type Client = any;

//Conta nova já confirmada, com senha provisória (troca obrigatória no primeiro acesso)
async function createAccount(db: Client, email: string, fullName: string, password: string): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error || !data?.user) {
    if (/already|registered|exists/i.test(error?.message || '')) throw new HttpError(409, 'Este e-mail já tem conta no sistema.');
    throw new HttpError(500, `Não foi possível criar a conta: ${error?.message || 'erro desconhecido'}`);
  }
  const userId = data.user.id;
  const profile = await db.from('profiles').upsert({ id: userId, full_name: fullName, must_change_password: true });
  if (profile.error) {
    await db.auth.admin.deleteUser(userId);
    throw new HttpError(500, `Não foi possível criar o perfil: ${profile.error.message}`);
  }
  return userId;
}

//Nova senha provisória: a pessoa troca de novo no próximo acesso
async function setTemporaryPassword(db: Client, userId: string, password: string) {
  const { error } = await db.auth.admin.updateUserById(userId, { password });
  if (error) throw new HttpError(500, `Não foi possível trocar a senha: ${error.message}`);
  //Depois da troca (o banco libera a conta ao mudar a senha): volta a exigir a troca
  const profile = await db.from('profiles').update({ must_change_password: true }).eq('id', userId);
  if (profile.error) throw new HttpError(500, `Não foi possível marcar a troca de senha: ${profile.error.message}`);
}

async function getEmail(db: Client, userId: string): Promise<string> {
  const { data } = await db.auth.admin.getUserById(userId);
  return data?.user?.email || '';
}

export async function handleRequest(
  req: Request,
  deps: { env: (key: string) => string | undefined; createClient: (url: string, key: string, options?: unknown) => Client },
): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    const url = deps.env('SUPABASE_URL') || '';
    const anonKey = deps.env('SUPABASE_ANON_KEY') || '';
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY') || '';
    const authorization = req.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+/.test(authorization)) throw new HttpError(401, 'Entre novamente para continuar.');

    //Quem chamou: sessão do usuário, com as mesmas exigências do banco (2 etapas e conta liberada)
    const asUser = deps.createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: userData, error: userError } = await asUser.auth.getUser();
    const caller = userData?.user;
    if (userError || !caller) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
    const mfa = await asUser.rpc('mfa_satisfied');
    if (mfa.error || mfa.data !== true) throw new HttpError(403, 'Digite o código do aplicativo autenticador para continuar.');
    const active = await asUser.rpc('account_active');
    if (active.error || active.data !== true) throw new HttpError(403, 'Troque a senha provisória (ou reative a empresa) para continuar.');

    const db = deps.createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    const membership = (await db.from('company_members').select('company_id, role').eq('user_id', caller.id).maybeSingle()).data;
    const isCompanyAdmin = membership?.role === 'admin';
    const isOwner = !!(await db.from('platform_admins').select('user_id').eq('user_id', caller.id).maybeSingle()).data;

    if (action.startsWith('team.') && !isCompanyAdmin) throw new HttpError(403, 'Só o administrador da empresa gerencia a equipe.');
    if (action.startsWith('owner.') && !isOwner) throw new HttpError(403, 'Só o dono do sistema acessa o painel do sistema.');

    switch (action) {
      case 'team.create': {
        const email = readEmail(body.email);
        const fullName = readName(body.full_name, 'o nome da pessoa');
        const role = ROLES.includes(body.role) ? body.role : 'projetista';
        const password = readPassword(body.password);
        const userId = await createAccount(db, email, fullName, password);
        const member = await db.from('company_members').insert({ company_id: membership.company_id, user_id: userId, role });
        if (member.error) {
          await db.auth.admin.deleteUser(userId);
          throw new HttpError(500, `Não foi possível incluir na equipe: ${member.error.message}`);
        }
        return reply(200, { user: { id: userId, email, full_name: fullName, role }, password });
      }
      case 'team.reset_password': {
        const userId = String(body.user_id || '');
        if (!userId || userId === caller.id) throw new HttpError(400, 'Para trocar a sua própria senha, use Minha conta › Segurança.');
        const target = (await db.from('company_members').select('user_id').eq('company_id', membership.company_id).eq('user_id', userId).maybeSingle()).data;
        if (!target) throw new HttpError(404, 'Essa pessoa não faz parte da sua empresa.');
        const password = readPassword(body.password);
        await setTemporaryPassword(db, userId, password);
        return reply(200, { password });
      }
      case 'owner.list_companies': {
        const companies = await db.from('companies').select('id, name, document, created_at, blocked_at, blocked_reason').order('created_at', { ascending: false });
        if (companies.error) throw new HttpError(500, companies.error.message);
        const members = await db.from('company_members').select('company_id, user_id, role');
        if (members.error) throw new HttpError(500, members.error.message);
        const list = await Promise.all((companies.data || []).map(async (company: Client) => {
          const team = (members.data || []).filter((m: Client) => m.company_id === company.id);
          const admins = await Promise.all(team.filter((m: Client) => m.role === 'admin').map(async (m: Client) => ({ id: m.user_id, email: await getEmail(db, m.user_id) })));
          return { ...company, blocked: !!company.blocked_at, members: team.length, admins };
        }));
        return reply(200, { companies: list });
      }
      case 'owner.create_company': {
        const companyName = readName(body.company_name, 'o nome da empresa');
        const document = String(body.document || '').trim() || null;
        const email = readEmail(body.admin_email);
        const adminName = readName(body.admin_name, 'o nome do administrador');
        const password = readPassword(body.password);
        const userId = await createAccount(db, email, adminName, password);
        const company = await db.from('companies').insert({ name: companyName, document, created_by: caller.id }).select('id, name').single();
        if (company.error) {
          await db.auth.admin.deleteUser(userId);
          throw new HttpError(500, `Não foi possível criar a empresa: ${company.error.message}`);
        }
        const companyId = company.data.id;
        const member = await db.from('company_members').insert({ company_id: companyId, user_id: userId, role: 'admin' });
        if (member.error) {
          await db.from('companies').delete().eq('id', companyId);
          await db.auth.admin.deleteUser(userId);
          throw new HttpError(500, `Não foi possível ligar o administrador: ${member.error.message}`);
        }
        await db.from('company_settings').insert({ company_id: companyId });
        return reply(200, { company: { id: companyId, name: companyName }, admin: { id: userId, email, full_name: adminName }, password });
      }
      case 'owner.set_blocked': {
        const companyId = String(body.company_id || '');
        if (!companyId) throw new HttpError(400, 'Empresa não informada.');
        if (membership?.company_id === companyId && body.blocked) throw new HttpError(400, 'Você não pode bloquear a sua própria empresa.');
        const blocked = !!body.blocked;
        const result = await db.from('companies')
          .update({ blocked_at: blocked ? new Date().toISOString() : null, blocked_reason: blocked ? (String(body.reason || '').trim() || null) : null })
          .eq('id', companyId);
        if (result.error) throw new HttpError(500, result.error.message);
        return reply(200, { blocked });
      }
      case 'owner.reset_password': {
        const userId = String(body.user_id || '');
        if (!userId || userId === caller.id) throw new HttpError(400, 'Para trocar a sua própria senha, use Minha conta › Segurança.');
        const password = readPassword(body.password);
        await setTemporaryPassword(db, userId, password);
        return reply(200, { password });
      }
      default:
        throw new HttpError(400, 'Ação desconhecida.');
    }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Erro inesperado.';
    return reply(status, { error: message });
  }
}
