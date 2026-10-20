import { expect, test } from '@playwright/test';
import { loadEnv, signInAsAdmin } from './helpers';

const env = loadEnv();

function localDate(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

test.describe('trip scheduling', () => {
  test.skip(!env, 'frontend/.env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY is required');

  test.beforeEach(async ({ page }) => {
    if (!env) return;
    await signInAsAdmin(page, env);
    await page.goto('/dashboard/trips');
    await expect(page.getByRole('heading', { name: 'Trip scheduling' })).toBeVisible();
  });

  test('searches server-side and rejects an inverted date range', async ({ page }) => {
    const firstRef = (await page.locator('table tbody tr').first().getByRole('button').first().innerText()).trim();
    expect(firstRef).toMatch(/^[A-Z0-9-]+-\d{8}-\d{4}$/);

    await page.getByLabel('Search trips').fill(firstRef);
    await expect(page.getByText('Showing 1–1 of 1')).toBeVisible();

    await page.getByLabel('Search trips').fill('');
    await page.getByLabel('From').fill('2026-10-20');
    await page.getByLabel('To').fill('2026-10-14');
    await expect(page.getByText('“From” must be on or before “To”.')).toBeVisible();
    await expect(page.getByText('No trips match these filters.')).toBeVisible();
    await expect(page.getByText('Loading trips...')).toHaveCount(0);
  });

  test('renders day, week and month calendars for a known departure', async ({ page }) => {
    const firstRef = (await page.locator('table tbody tr').first().getByRole('button').first().innerText()).trim();
    const match = firstRef.match(/-(\d{4})(\d{2})(\d{2})-/);
    expect(match).not.toBeNull();
    const day = `${match![1]}-${match![2]}-${match![3]}`;

    await page.getByRole('tab', { name: 'Week' }).click();
    await page.getByLabel('Jump to date').fill(day);
    await expect(page.getByRole('button', { name: new RegExp(`Open ${firstRef}`) })).toBeVisible();

    await page.getByRole('tab', { name: 'Month' }).click();
    await expect(page.getByRole('heading', { name: /October 2026|November 2026/ })).toBeVisible();

    await page.getByRole('tab', { name: 'Day' }).click();
    await expect(page.getByRole('button', { name: new RegExp(firstRef) })).toBeVisible();
  });

  test('blocks past/duplicate previews and saves a future batch once', async ({ page }) => {
    await page.getByRole('button', { name: 'Bulk schedule trips' }).click();
    const dialog = page.getByRole('dialog', { name: 'Bulk schedule trips' });

    await dialog.getByLabel('Schedule start').fill('2026-10-14');
    await dialog.getByLabel('Schedule end').fill('2026-10-16');
    await dialog.getByLabel('Departure time').fill('20:00');
    await dialog.getByLabel('Travel duration (minutes)').fill('720');
    await dialog.getByRole('radio', { name: 'Daily' }).check();

    await expect(dialog.getByText('3 blocked')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Create 0 trips' })).toBeDisabled();

    const start = localDate(2);
    const end = localDate(4);
    await dialog.getByLabel('Schedule start').fill(start);
    await dialog.getByLabel('Schedule end').fill(end);
    await expect(dialog.getByText('3 ready')).toBeVisible();

    let posted: Array<Record<string, unknown>> = [];
    await page.route('**/rest/v1/trips*', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posted = route.request().postDataJSON() as Array<Record<string, unknown>>;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(posted.map((_, index) => ({ id: `00000000-0000-0000-0000-00000000020${index}` }))),
      });
    });

    await dialog.getByRole('button', { name: 'Create 3 trips' }).click();
    await expect(dialog.getByText('3 trips created')).toBeVisible();
    expect(posted).toHaveLength(3);
    for (const row of posted) {
      expect(row.status).toBe('scheduled');
      expect(row.route_id).toBeTruthy();
      expect(row.vessel_id).toBeTruthy();
      expect(row.departure_port_id).toBeTruthy();
      expect(row.arrival_port_id).toBeTruthy();
      expect(new Date(String(row.arrival_at)).getTime()).toBeGreaterThan(
        new Date(String(row.departure_at)).getTime()
      );
      expect(row.booking_open).toBeTruthy();
      expect(row.booking_close).toBeTruthy();
    }
  });
});

test.describe('mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(!env, 'frontend/.env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY is required');

  test('fits the scheduling page without page-level horizontal overflow', async ({ page }) => {
    if (!env) return;
    await signInAsAdmin(page, env);
    await page.goto('/dashboard/trips');
    await expect(page.getByRole('heading', { name: 'Trip scheduling' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bulk schedule trips' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
