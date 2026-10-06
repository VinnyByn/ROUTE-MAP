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
      if (table !== 'projects') return { data: st.single ? null : [], error: null };
      const rows = Object.values(db.projects).filter(r => st.filters.every(([col, val]) => r[col] === val));
      if (st.op === 'update') {
        rows.forEach(r => {
          const contentChanged = 'data' in st.payload || 'name' in st.payload;
          if (contentChanged) db.versions.push({ project_id: r.id, revision: r.revision, data: r.data });
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
      signInWithPassword: () => ok({}), signOut: () => ok({}), updateUser: () => ok({}),
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
             company: { id: 'c1', name: 'Empresa Teste', role: 'admin' } })
      : name === 'list_company_members' ? ok([])
      : name === 'list_project_versions' ? ok(db.versions.filter(v => v.project_id === args.p_project).reverse()
          .map((v, i) => ({ id: i + 1, revision: v.revision, name: 'v', saved_at: '2026-10-05T10:00:00Z', saved_by_name: 'Bia', markers: 0, cables: 0 })))
      : name === 'list_trash' ? ok(Object.values(db.projects).filter(p => p.deleted_at)
          .map(p => ({ id: p.id, name: p.name, city: null, project_type: null, deleted_at: p.deleted_at, deleted_by_name: 'Teste', can_manage: true })))
      : name === 'project_facets' ? ok({ total: 0, trash: Object.values(db.projects).filter(p => p.deleted_at).length, types: [], cities: [] })
      : ok(null),
    from: (table) => query(table),
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
  };
} };
