import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Environment variables with fallback
const SUPABASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://vbcslopjzilphqpdggzp.supabase.co';

const SUPABASE_KEY =
  (typeof import.meta !== 'undefined' &&
    (import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env?.VITE_SUPABASE_ANON_KEY)) ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY ||
  'sb_publishable_AdjpbtM51QRUXSC68vgpGg_LwEBDKAu';

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

/**
 * Centralized Supabase Client Singleton
 * Configured for both Browser and Server runtimes
 */
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  db: {
    schema: 'public',
  },
});

export { SUPABASE_URL, SUPABASE_KEY };
