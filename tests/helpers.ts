import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

export type SupabaseEnv = { url: string; anonKey: string };

export function loadEnv(): SupabaseEnv | null {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (url && anonKey) return { url, anonKey };
  try {
    const text = readFileSync(resolve(process.cwd(), 'frontend/.env'), 'utf8');
    const values: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
    return values.VITE_SUPABASE_URL && values.VITE_SUPABASE_ANON_KEY
      ? { url: values.VITE_SUPABASE_URL, anonKey: values.VITE_SUPABASE_ANON_KEY }
      : null;
  } catch {
    return null;
  }
}

/**
 * Test-only session: the publishable/anon key is used as the access token so
 * public RLS reads work. The profile endpoint is mocked to admin; no write ever
 * reaches the real database in these tests.
 */
export async function signInAsAdmin(page: Page, credentials: SupabaseEnv) {
  const ref = new URL(credentials.url).hostname.split('.')[0];
  const session = {
    access_token: credentials.anonKey,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4102444800,
    refresh_token: 'playwright-test-refresh',
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'admin@test.local',
      email_confirmed_at: '2026-01-01T00:00:00.000Z',
      phone: '',
      confirmed_at: '2026-01-01T00:00:00.000Z',
      last_sign_in_at: '2026-01-01T00:00:00.000Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      is_anonymous: false,
    },
  };

  await page.addInitScript(
    ({ key, value }) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // about:blank and other opaque origins have no storage; the app origin does.
      }
    },
    { key: `sb-${ref}-auth-token`, value: JSON.stringify(session) }
  );

  await page.route('**/rest/v1/profiles*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '00000000-0000-0000-0000-000000000001',
        role: 'admin',
        is_active: true,
        email: 'admin@test.local',
      }),
    })
  );
}
