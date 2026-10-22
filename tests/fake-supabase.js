// Supabase simulado para os testes: usuário logado, administrador de uma empresa, sem dados.
// Substitui o supabase-js do CDN só durante o teste (tests/smoke.mjs).
// Cenário "conta com verificação em 2 etapas": window.__fakeMfa = true (código certo: 123456).
window.supabase = { createClient() {
  const ok = (data) => Promise.resolve({ data, error: null });
  const fail = (message) => Promise.resolve({ data: null, error: { message } });
  const mfaOn = () => !!window.__fakeMfa;
  const aal = () => (mfaOn() && sessionStorage.getItem('fakeAal') !== 'aal2' ? 'aal1' : (mfaOn() ? 'aal2' : 'aal1'));
  //Tabelas em memória (window.__fakeDb): projects e client_errors entendem os filtros usados pelo sistema;
  //as demais respondem vazio
  const db = window.__fakeDb = window.__fakeDb || { projects: {}, client_errors: [], versions: [] };
  const query = (table) => {
    const st = { op: 'select', filters: [], payload: null, wantRows: false };
    const run = () => {
      if (table === 'client_errors' && st.op === 'insert') { db.client_errors.push(...[].concat(st.payload)); return { data: null, error: null }; }
      //Configurações da empresa: por padrão, empresa que já existia (catálogo salvo, sem planilhas);
      //window.__fakeNewCompany = true simula a empresa recém-criada (sem catálogo salvo)
      if (table === 'company_settings') {
        if (!('settings' in db)) db.settings = window.__fakeNewCompany ? null : { material_catalog: { materials: [], sources: {} } };
        if (st.op === 'upsert') { db.settings = { ...(db.settings || {}), ...st.payload }; return { data: null, error: null }; }
        return { data: st.single ? db.settings : [db.settings].filter(Boolean), error: null };
      }
      if (table === 'project_versions') {
        const found = db.versions.filter(v => st.filters.every(([col, val]) => v[col] === val));
        return { data: st.single ? (found[0] || null) : found, error: null };
      }
      if (table !== 'projects') return { data: st.single ? null : [], error: null };
      const rows = Object.values(db.projects).filter(r => st.filters.every(([col, val]) => r[col] === val));
      if (st.op === 'update') {
        rows.forEach(r => {
          const contentChanged = 'data' in st.payload || 'name' in st.payload;
          if (contentChanged) db.versions.push({ id: db.versions.length + 1, project_id: r.id, revision: r.revision, data: r.data, name: r.name, saved_at: r.updated_at || '2026-10-05T10:00:00Z' });
          Object.assign(r, st.payload, { revision: r.revision + (contentChanged ? 1 : 0), updated_by: 'u1', updated_at: new Date().toISOString() });
        });
        return { data: rows.map(r => ({ ...r })), error: null };
      }
      if (st.op === 'upsert') {
        const r = db.projects[st.payload.id] = { ...(db.projects[st.payload.id] || { revision: 0 }), ...st.payload };
        r.revision += 1; r.updated_by = 'u1'; r.updated_at = new Date().toISOString();
        return { data: [{ ...r }], error: null };
      }
      if (st.op === 'delete') { rows.forEach(r => delete db.projects[r.id]); return { data: rows, error: null }; }
      return { data: st.single ? (rows[0] ? { ...rows[0] } : null) : rows.map(r => ({ ...r })), error: null };
    };
    const b = {
      select() { return b; }, is() { return b; }, order() { return b; }, limit() { return b; }, range() { return b; }, or() { return b; },
      eq(col, val) { st.filters.push([col, val]); return b; },
      update(payload) { st.op = 'update'; st.payload = payload; return b; },
      upsert(payload) { st.op = 'upsert'; st.payload = payload; return b; },
      insert(payload) { st.op = 'insert'; st.payload = payload; return b; },
      delete() { st.op = 'delete'; return b; },
      maybeSingle() { st.single = true; return b; }, single() { st.single = true; return b; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return b;
  };
  return {
    auth: {
      getSession: () => ok({ session: { access_token: 'teste' } }),
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      getUser: () => ok({ user: { created_at: '2026-05-12T10:00:00Z', last_sign_in_at: '2026-10-03T09:12:00Z' } }),
      signInWithPassword: () => ok({}), signOut: () => ok({}),
      //Trocar a senha libera a conta com senha provisória (como o gatilho do banco)
      updateUser: (attrs) => { if (attrs?.password) { window.__fakeMustChange = false; try { sessionStorage.setItem('fakeMustChange', 'off'); } catch (e) {} } return ok({}); },
      mfa: {
        getAuthenticatorAssuranceLevel: () => ok({ currentLevel: aal(), nextLevel: mfaOn() ? 'aal2' : 'aal1' }),
        listFactors: () => ok(mfaOn()
          ? { totp: [{ id: 'f1', status: 'verified', created_at: '2026-10-01T00:00:00Z' }], all: [{ id: 'f1', status: 'verified' }] }
          : { totp: [], all: [] }),
        challengeAndVerify: ({ code }) => {
          if (code !== '123456') return fail('Invalid TOTP code entered');
          sessionStorage.setItem('fakeAal', 'aal2');
          return ok({});
        },
      },
    },
    rpc: (name, args = {}) => name === 'get_my_context'
      ? ok({ user_id: 'u1', email: 'teste@routemap.dev', profile: { full_name: 'Usuário Teste', preferences: {} },
             must_change_password: !!window.__fakeMustChange, platform_admin: !!window.__fakePlatformAdmin,
             company: { id: 'c1', name: 'Empresa Teste', role: 'admin', blocked: !!window.__fakeBlocked, blocked_reason: window.__fakeBlocked || null } })
      : name === 'list_company_members' ? ok(window.__fakeMembers || [])
      //Lista de projetos: ativos ou arquivados, sem as redes das cidades nem a lixeira
      : name === 'search_projects' ? (() => {
          const rows = Object.values(db.projects).filter(p => !p.deleted_at && p.project_type !== 'Rede' && !!p.archived_at === !!args.p_archived);
          return ok(rows.map(p => ({ id: p.id, name: p.name, city: p.city || null, neighborhood: p.neighborhood || null, project_type: p.project_type, updated_at: p.updated_at || '2026-10-05T10:00:00Z',
            summary: {}, total_count: rows.length, archived_at: p.archived_at || null, concluded: !!p.data?.concluded })));
        })()
      : name === 'list_project_versions' ? ok(db.versions.filter(v => v.project_id === args.p_project).reverse()
          .map(v => ({ id: v.id, revision: v.revision, name: 'v', saved_at: v.saved_at || '2026-10-05T10:00:00Z', saved_by_name: 'Bia', markers: (v.data?.markers || []).length, cables: (v.data?.cables || []).length })))
      : name === 'list_trash' ? ok(Object.values(db.projects).filter(p => p.deleted_at)
          .map(p => ({ id: p.id, name: p.name, city: null, project_type: null, deleted_at: p.deleted_at, deleted_by_name: 'Teste', can_manage: true })))
      : name === 'project_facets' ? ok({ total: 0, trash: Object.values(db.projects).filter(p => p.deleted_at).length, types: [], cities: [] })
      : ok(null),
    from: (table) => query(table),
    //Função do servidor admin-users simulada: guarda as chamadas em window.__fakeFunctionCalls
    functions: {
      invoke(fn, { body } = {}) {
        (window.__fakeFunctionCalls = window.__fakeFunctionCalls || []).push({ fn, body });
        const a = body?.action;
        if (a === 'team.create') return ok({ user: { id: 'n1', email: body.email, full_name: body.full_name, role: body.role }, password: body.password || 'Abcd-Efgh-Jkmn' });
        if (a === 'team.reset_password' || a === 'owner.reset_password') return ok({ password: 'Prov-Isor-ia22' });
        if (a === 'owner.create_company') return ok({ company: { id: 'c9', name: body.company_name }, admin: { id: 'a9', email: body.admin_email }, password: 'Nova-Empr-esa2' });
        if (a === 'owner.set_blocked') return ok({ blocked: !!body.blocked });
        if (a === 'owner.list_companies') return ok({ companies: [
          { id: 'c1', name: 'Empresa Teste', created_at: '2026-09-01T00:00:00Z', blocked: false, members: 3, admins: [{ id: 'u1', email: 'teste@routemap.dev' }] },
          { id: 'c2', name: 'Fibra Cliente', document: '12.345.678/0001-90', created_at: '2026-10-01T00:00:00Z', blocked: false, members: 5, admins: [{ id: 'a2', email: 'chefe@cliente.com' }] },
        ] });
        return ok({ error: 'Ação desconhecida.' });
      },
    },
    //Realtime simulado entre abas do mesmo navegador (BroadcastChannel): broadcast e presença por tópico
    channel(topic, opts = {}) {
      const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fake-realtime') : null;
      const key = opts?.config?.presence?.key || Math.random().toString(36).slice(2);
      const handlers = { broadcast: [], sync: [] };
      const peers = {};
      let mine = null;
      const fireSync = () => handlers.sync.forEach(cb => cb());
      const ch = {
        on(type, filter, cb) { if (type === 'broadcast') handlers.broadcast.push(cb); if (type === 'presence') handlers.sync.push(cb); return ch; },
        subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 30); return ch; },
        send({ payload }) { bc?.postMessage({ topic, kind: 'broadcast', payload }); return Promise.resolve('ok'); },
        track(meta) { mine = meta; peers[key] = [meta]; bc?.postMessage({ topic, kind: 'join', key, meta }); fireSync(); return Promise.resolve('ok'); },
        presenceState() { return { ...peers }; },
        _close() { bc?.postMessage({ topic, kind: 'leave', key }); bc?.close(); },
      };
      if (bc) bc.onmessage = ({ data }) => {
        if (data.topic !== topic) return;
        if (data.kind === 'broadcast') handlers.broadcast.forEach(cb => cb({ payload: data.payload }));
        if (data.kind === 'join') {
          const isNew = !peers[data.key];
          peers[data.key] = [data.meta];
          if (isNew && mine) bc.postMessage({ topic, kind: 'join', key, meta: mine }); //Responde para quem chegou
          fireSync();
        }
        if (data.kind === 'leave') { delete peers[data.key]; fireSync(); }
      };
      return ch;
    },
    removeChannel(ch) { ch?._close?.(); },
    //Storage em memória (window.__fakeStorage: caminho → { blob, contentType, at })
    storage: {
      from(bucket) {
        const files = (window.__fakeStorage ||= new Map());
        const key = (p) => `${bucket}/${p}`;
        return {
          upload(path, blob, opts = {}) {
            if (files.has(key(path)) && !opts.upsert) return Promise.resolve({ data: null, error: { message: 'The resource already exists' } });
            files.set(key(path), { blob, contentType: opts.contentType || blob?.type || '', at: new Date().toISOString() });
            return Promise.resolve({ data: { path }, error: null });
          },
          list(prefix = '', opts = {}) {
            const base = `${bucket}/${prefix ? prefix.replace(/\/$/, '') + '/' : ''}`;
            const names = new Map();
            files.forEach((f, k) => {
              if (!k.startsWith(base)) return;
              const rest = k.slice(base.length);
              const [first, ...more] = rest.split('/');
              if (more.length) names.set(first, { name: first, id: null, metadata: null });
              else names.set(first, { name: first, id: k, created_at: f.at, metadata: { size: f.blob?.size || 0, mimetype: f.contentType } });
            });
            const data = [...names.values()].sort((x, y) => x.name.localeCompare(y.name)).slice(0, opts.limit || 100);
            return Promise.resolve({ data, error: null });
          },
          download(path) {
            const f = files.get(key(path));
            return Promise.resolve(f ? { data: f.blob, error: null } : { data: null, error: { message: 'Object not found' } });
          },
          remove(paths) {
            paths.forEach(p => files.delete(key(p)));
            return Promise.resolve({ data: paths.map(name => ({ name })), error: null });
          },
        };
      },
    },
  };
} };
