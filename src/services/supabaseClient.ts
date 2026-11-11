/**
 * Database Client Configuration
 * Switched from Supabase Cloud to Local PostgreSQL on localhost:5432
 */

export const isLocalDbConfigured = true;
// Maintained for backward compatibility with existing component imports
export const isSupabaseConfigured = true;

/**
 * Checks connection status against the local PostgreSQL backend
 */
export async function checkLocalDbHealth(): Promise<{
  ok: boolean;
  connected: boolean;
  database: string;
  url: string;
  matchesCount: number;
  teamsCount: number;
  tradesCount: number;
  error?: string;
}> {
  try {
    const res = await fetch('/api/db/status');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err: any) {
    return {
      ok: false,
      connected: false,
      database: 'PostgreSQL',
      url: 'localhost:5432/leadhunt',
      matchesCount: 0,
      teamsCount: 0,
      tradesCount: 0,
      error: err.message,
    };
  }
}
