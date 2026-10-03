// Supabase simulado para os testes: usuário logado, administrador de uma empresa, sem dados.
// Substitui o supabase-js do CDN só durante o teste (tests/smoke.mjs).
window.supabase = { createClient() {
  const ok = (data) => Promise.resolve({ data, error: null });
  const q = { select() { return q; }, is() { return q; }, order() { return ok([]); }, eq() { return ok(null); },
    update() { return q; }, upsert() { return ok(null); }, insert() { return ok(null); }, delete() { return q; },
    maybeSingle() { return ok(null); }, single() { return ok(null); }, then(r) { return ok(null).then(r); } };
  return {
    auth: {
      getSession: () => ok({ session: { access_token: 'teste' } }),
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      getUser: () => ok({ user: { created_at: '2026-05-12T10:00:00Z', last_sign_in_at: '2026-10-03T09:12:00Z' } }),
      signInWithPassword: () => ok({}), signOut: () => ok({}), updateUser: () => ok({}),
      mfa: {
        getAuthenticatorAssuranceLevel: () => ok({ currentLevel: 'aal1', nextLevel: 'aal1' }),
        listFactors: () => ok({ totp: [], all: [] }),
      },
    },
    rpc: (name) => name === 'get_my_context'
      ? ok({ user_id: 'u1', email: 'teste@routemap.dev', profile: { full_name: 'Usuário Teste', preferences: {} },
             company: { id: 'c1', name: 'Empresa Teste', role: 'admin' } })
      : name === 'list_company_members' ? ok([]) : ok(null),
    from: () => q,
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() {},
  };
} };
