// Função do servidor (Supabase Edge Function): contas criadas pelo administrador e pelo dono do sistema.
// A lógica fica em handler.ts (testada em tests/admin-users.test.mjs).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { handleRequest } from './handler.ts';

Deno.serve((req: Request) => handleRequest(req, { env: (key: string) => Deno.env.get(key), createClient }));
