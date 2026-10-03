// Supabase simulado para os testes: usuário logado, administrador de uma empresa, sem dados.
// Substitui o supabase-js do CDN só durante o teste (tests/smoke.mjs).
// Cenário "conta com verificação em 2 etapas": window.__fakeMfa = true (código certo: 123456).
window.supabase = { createClient() {
  const ok = (data) => Promise.resolve({ data, error: null });
  const fail = (message) => Promise.resolve({ data: null, error: { message } });
  const mfaOn = () => !!window.__fakeMfa;
  const aal = () => (mfaOn() && sessionStorage.getItem('fakeAal') !== 'aal2' ? 'aal1' : (mfaOn() ? 'aal2' : 'aal1'));
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
    rpc: (name) => name === 'get_my_context'
      ? ok({ user_id: 'u1', email: 'teste@routemap.dev', profile: { full_name: 'Usuário Teste', preferences: {} },
             company: { id: 'c1', name: 'Empresa Teste', role: 'admin' } })
      : name === 'list_company_members' ? ok([]) : ok(null),
    from: () => q,
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() {},
  };
} };
