// Testes da função do servidor supabase/functions/admin-users (contas criadas pelo administrador e pelo dono).
// Uso: node --experimental-strip-types tests/admin-users.test.mjs   (Supabase simulado em memória)
import { handleRequest, makeTemporaryPassword } from '../supabase/functions/admin-users/handler.ts';

const failures = [];
const check = (ok, message) => { console.log(`${ok ? '✓' : '✗'} ${message}`); if (!ok) failures.push(message); };

//Banco simulado: usuários (Auth), perfis, empresas, equipe e donos do sistema
function makeWorld() {
  const w = {
    users: { admin1: { id: 'admin1', email: 'admin@a.com' }, proj1: { id: 'proj1', email: 'proj@a.com' }, admin2: { id: 'admin2', email: 'admin@b.com' }, owner: { id: 'owner', email: 'dono@s.com' }, temp: { id: 'temp', email: 'temp@a.com' } },
    sessions: { 'tok-admin1': 'admin1', 'tok-proj1': 'proj1', 'tok-admin2': 'admin2', 'tok-owner': 'owner', 'tok-temp': 'temp' },
    mfaPending: new Set(), inactive: new Set(['temp']),
    tables: {
      profiles: [], platform_admins: [{ user_id: 'owner' }], company_settings: [],
      companies: [{ id: 'cA', name: 'A' }, { id: 'cB', name: 'B' }, { id: 'cO', name: 'Dono' }],
      company_members: [
        { company_id: 'cA', user_id: 'admin1', role: 'admin' }, { company_id: 'cA', user_id: 'proj1', role: 'projetista' },
        { company_id: 'cB', user_id: 'admin2', role: 'admin' }, { company_id: 'cO', user_id: 'owner', role: 'admin' },
        { company_id: 'cA', user_id: 'temp', role: 'projetista' },
      ],
    },
    passwords: {}, nextId: 1,
  };
  const table = (name) => {
    const st = { op: 'select', filters: [], payload: null, single: false };
    const rows = () => w.tables[name].filter(r => st.filters.every(([c, v]) => r[c] === v));
    const run = () => {
      if (st.op === 'insert') {
        const row = { ...(name === 'companies' ? { id: `c${w.nextId++}` } : {}), ...st.payload };
        w.tables[name].push(row);
        return { data: st.single ? row : [row], error: null };
      }
      if (st.op === 'upsert') {
        const found = w.tables[name].find(r => r.id === st.payload.id);
        if (found) Object.assign(found, st.payload); else w.tables[name].push({ ...st.payload });
        return { data: null, error: null };
      }
      if (st.op === 'update') { rows().forEach(r => Object.assign(r, st.payload)); return { data: null, error: null }; }
      if (st.op === 'delete') { const del = new Set(rows()); w.tables[name] = w.tables[name].filter(r => !del.has(r)); return { data: null, error: null }; }
      const out = rows();
      return { data: st.single ? (out[0] || null) : out, error: null };
    };
    const b = {
      select() { return b; }, order() { return b; },
      eq(c, v) { st.filters.push([c, v]); return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      upsert(p) { st.op = 'upsert'; st.payload = p; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      delete() { st.op = 'delete'; return b; },
      maybeSingle() { st.single = true; return b; }, single() { st.single = true; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  };
  const createClient = (url, key, options = {}) => {
    const token = String(options?.global?.headers?.Authorization || '').replace(/^Bearer\s+/, '');
    const uid = w.sessions[token];
    if (key === 'anon') {
      return {
        auth: { getUser: async () => (uid ? { data: { user: w.users[uid] }, error: null } : { data: { user: null }, error: { message: 'invalid' } }) },
        rpc: async (fn) => ({ data: fn === 'mfa_satisfied' ? !w.mfaPending.has(uid) : fn === 'account_active' ? !w.inactive.has(uid) : null, error: null }),
      };
    }
    return {
      from: table,
      auth: { admin: {
        createUser: async ({ email, password, email_confirm }) => {
          if (Object.values(w.users).some(u => u.email === email)) return { data: null, error: { message: 'A user with this email address has already been registered' } };
          const id = `u${w.nextId++}`;
          w.users[id] = { id, email, confirmed: email_confirm };
          w.passwords[id] = password;
          w.tables.profiles.push({ id, must_change_password: false });
          return { data: { user: w.users[id] }, error: null };
        },
        updateUserById: async (id, { password }) => { w.passwords[id] = password; const p = w.tables.profiles.find(r => r.id === id); if (p) p.must_change_password = false; else w.tables.profiles.push({ id, must_change_password: false }); return { error: null }; },
        deleteUser: async (id) => { delete w.users[id]; return { error: null }; },
        getUserById: async (id) => ({ data: { user: w.users[id] || null } }),
      } },
    };
  };
  const call = async (token, body) => {
    const res = await handleRequest(new Request('https://x/functions/v1/admin-users', {
      method: 'POST', headers: { Authorization: token ? `Bearer ${token}` : '', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), { env: (k) => ({ SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], createClient });
    return { status: res.status, body: await res.json() };
  };
  return { w, call };
}

const { w, call } = makeWorld();
const pw = makeTemporaryPassword();
check(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(pw) && !/[0O1lI]/.test(pw), `senha provisória legível (${pw})`);

let r = await call(null, { action: 'team.create' });
check(r.status === 401, 'sem sessão: recusa');
r = await call('tok-proj1', { action: 'team.create', email: 'x@a.com', full_name: 'X' });
check(r.status === 403, 'projetista não cria usuário');
w.mfaPending.add('admin1');
r = await call('tok-admin1', { action: 'team.create', email: 'x@a.com', full_name: 'X' });
check(r.status === 403 && /autenticador/.test(r.body.error), 'administrador com 2 etapas pendente: recusa');
w.mfaPending.delete('admin1');
r = await call('tok-temp', { action: 'team.create', email: 'x@a.com', full_name: 'X' });
check(r.status === 403, 'conta com senha provisória não cria usuário');

r = await call('tok-admin1', { action: 'team.create', email: ' Nova@A.com ', full_name: 'Nova Pessoa', role: 'viabilidade' });
const created = r.body.user;
check(r.status === 200 && created.email === 'nova@a.com' && created.role === 'viabilidade' && /^\S{4}-\S{4}-\S{4}$/.test(r.body.password)
  && w.users[created.id].confirmed === true && w.passwords[created.id] === r.body.password,
  `administrador cria usuário confirmado com senha provisória (${JSON.stringify(r.body)})`);
check(w.tables.profiles.find(p => p.id === created.id)?.must_change_password === true
  && w.tables.company_members.some(m => m.user_id === created.id && m.company_id === 'cA' && m.role === 'viabilidade'),
  'usuário novo: troca obrigatória e na empresa do administrador');
r = await call('tok-admin1', { action: 'team.create', email: 'nova@a.com', full_name: 'Repetida' });
check(r.status === 409, 'e-mail repetido: avisa');
r = await call('tok-admin1', { action: 'team.create', email: 'curta@a.com', full_name: 'Curta', password: '123' });
check(r.status === 400, 'senha provisória curta: recusa');

r = await call('tok-admin1', { action: 'team.reset_password', user_id: 'proj1', password: 'Provisoria123' });
check(r.status === 200 && w.passwords.proj1 === 'Provisoria123' && w.tables.profiles.find(p => p.id === 'proj1')?.must_change_password === true,
  'administrador redefine a senha da equipe (troca obrigatória de novo)');
r = await call('tok-admin1', { action: 'team.reset_password', user_id: 'admin2' });
check(r.status === 404 && !w.passwords.admin2, 'administrador não mexe em usuário de outra empresa');
r = await call('tok-admin1', { action: 'team.reset_password', user_id: 'admin1' });
check(r.status === 400, 'a própria senha fica em Minha conta › Segurança');

r = await call('tok-admin1', { action: 'owner.list_companies' });
check(r.status === 403, 'administrador comum não acessa o painel do sistema');
r = await call('tok-owner', { action: 'owner.create_company', company_name: 'Fibra Nova', document: '12.345.678/0001-90', admin_email: 'chefe@nova.com', admin_name: 'Chefe' });
const nova = r.body;
check(r.status === 200 && nova.company?.name === 'Fibra Nova' && w.tables.company_members.some(m => m.company_id === nova.company.id && m.user_id === nova.admin.id && m.role === 'admin')
  && w.tables.company_settings.some(s => s.company_id === nova.company.id) && w.tables.profiles.find(p => p.id === nova.admin.id)?.must_change_password === true,
  `dono do sistema cria empresa com administrador (${JSON.stringify(nova)})`);
r = await call('tok-owner', { action: 'owner.list_companies' });
const listed = r.body.companies?.find(c => c.id === nova.company.id);
check(r.status === 200 && listed?.members === 1 && listed.admins[0]?.email === 'chefe@nova.com', 'painel lista empresas com o administrador');
r = await call('tok-owner', { action: 'owner.set_blocked', company_id: 'cB', blocked: true, reason: 'pagamento' });
check(r.status === 200 && !!w.tables.companies.find(c => c.id === 'cB').blocked_at && w.tables.companies.find(c => c.id === 'cB').blocked_reason === 'pagamento', 'dono bloqueia empresa');
r = await call('tok-owner', { action: 'owner.set_blocked', company_id: 'cB', blocked: false });
check(r.status === 200 && w.tables.companies.find(c => c.id === 'cB').blocked_at === null, 'dono reativa empresa');
r = await call('tok-owner', { action: 'owner.set_blocked', company_id: 'cO', blocked: true });
check(r.status === 400, 'dono não bloqueia a própria empresa');
r = await call('tok-owner', { action: 'owner.reset_password', user_id: 'admin2' });
check(r.status === 200 && w.passwords.admin2 === r.body.password, 'dono redefine a senha de um administrador');
r = await call('tok-owner', { action: 'apagar.tudo' });
check(r.status === 400, 'ação desconhecida: recusa');

if (failures.length) { console.error(`\n${failures.length} verificação(ões) falharam.`); process.exit(1); }
console.log('\nTudo certo.');
