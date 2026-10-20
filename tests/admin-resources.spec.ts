import { expect, test, type Page } from '@playwright/test';
import { loadEnv, signInAsAdmin } from './helpers';

const env = loadEnv();

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers':
    'authorization,apikey,content-type,prefer,accept,range,x-client-info',
  'access-control-expose-headers': 'content-range',
};

type Row = Record<string, any>;
type Recorded = { method: string; body: any };

function uuid(n: number) {
  return `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
}

function splitOr(expression: string) {
  const source = expression.replace(/^\(/, '').replace(/\)$/, '');
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of source) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function matchesExpression(row: Row, expression: string) {
  const match = expression.match(/^([a-zA-Z0-9_]+)\.(eq|neq|ilike|in)\.(.*)$/);
  if (!match) return true;
  const [, key, operator, raw] = match;
  if (operator === 'eq') return String(row[key]) === raw;
  if (operator === 'neq') return String(row[key]) !== raw;
  if (operator === 'in') {
    return raw
      .replace(/^\(/, '')
      .replace(/\)$/, '')
      .split(',')
      .includes(String(row[key]));
  }
  return String(row[key] ?? '')
    .toLowerCase()
    .includes(raw.replace(/%/g, '').toLowerCase());
}

function matchesOr(row: Row, expression: string) {
  return splitOr(expression).some((part) => matchesExpression(row, part));
}

/**
 * Minimal in-memory PostgREST for the tables under test. Reads are filtered and
 * paginated; writes mutate the fixture only. No request reaches the database.
 */
async function mockTable(
  page: Page,
  table: string,
  initial: Row[],
  decorate?: (row: Row) => Row
) {
  const data = initial.map((row) => ({ ...row }));
  const recorded: Recorded[] = [];

  await page.route(`**/rest/v1/${table}*`, async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    const url = new URL(request.url());
    const headers = { ...CORS_HEADERS, 'content-type': 'application/json' };

    if (method === 'GET' || method === 'HEAD') {
      let rows = data.filter((row) => {
        for (const [key, value] of Array.from(url.searchParams.entries())) {
          if (['select', 'order', 'offset', 'limit', 'or', 'and', 'apikey'].includes(key)) continue;
          if (!matchesExpression(row, `${key}.${value}`)) return false;
        }
        const or = url.searchParams.get('or');
        return !or || matchesOr(row, or);
      });

      const order = url.searchParams.get('order');
      if (order) {
        const [key, direction] = order.split('.');
        rows = [...rows].sort(
          (a, b) =>
            String(a[key] ?? '').localeCompare(String(b[key] ?? '')) *
            (direction === 'desc' ? -1 : 1)
        );
      }

      const total = rows.length;
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limitValue = url.searchParams.get('limit');
      const paged = rows
        .slice(offset, offset + (limitValue ? Number(limitValue) : total))
        .map((row) => (decorate ? decorate(row) : row));
      const contentRange =
        total === 0
          ? '*/0'
          : `${offset}-${Math.max(offset, offset + paged.length - 1)}/${total}`;
      const single = (request.headers()['accept'] ?? '').includes('pgrst.object');
      await route.fulfill({
        status: 200,
        headers: { ...headers, 'content-range': contentRange },
        body: method === 'HEAD' ? '' : JSON.stringify(single ? paged[0] ?? null : paged),
      });
      return;
    }

    if (method === 'POST') {
      const body = request.postDataJSON();
      const rows = Array.isArray(body) ? body : [body];
      const created = rows.map((row) =>
        decorate ? decorate({ id: crypto.randomUUID(), ...row }) : { id: crypto.randomUUID(), ...row }
      );
      data.push(...created);
      recorded.push({ method, body });
      await route.fulfill({ status: 201, headers, body: JSON.stringify(created) });
      return;
    }

    if (method === 'PATCH') {
      const body = request.postDataJSON();
      const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '');
      recorded.push({ method, body });
      for (const row of data) if (row.id === id) Object.assign(row, body);
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (method === 'DELETE') {
      const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '');
      recorded.push({ method, body: null });
      for (let index = data.length - 1; index >= 0; index -= 1) {
        if (data[index].id === id) data.splice(index, 1);
      }
      await route.fulfill({ status: 204, headers });
      return;
    }

    await route.continue();
  });

  return { data, recorded };
}

test.describe('shipping admin pages', () => {
  test.skip(!env, 'frontend/.env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY is required');

  test.beforeEach(async ({ page }) => {
    if (!env) return;
    await signInAsAdmin(page, env);
  });

  const searchPages = [
    { path: '/dashboard/ports', heading: 'Ports', label: 'Search ports', column: 0 },
    { path: '/dashboard/vessels', heading: 'Vessels', label: 'Search vessels', column: 0 },
    { path: '/dashboard/routes', heading: 'Routes', label: 'Search routes', column: 0 },
    {
      path: '/dashboard/accommodations',
      heading: 'Accommodations',
      label: 'Search accommodations',
      column: 1,
    },
  ];

  for (const config of searchPages) {
    test(`${config.heading}: server-side search returns the matching row`, async ({ page }) => {
      await page.goto(config.path);
      await expect(page.getByRole('heading', { name: config.heading, level: 1 })).toBeVisible();
      const firstRow = page.locator('table tbody tr').first();
      await expect(firstRow).toBeVisible();
      const code = (await firstRow.locator('td').nth(config.column).innerText()).trim();
      const expected = (await page.locator('table tbody tr').allInnerTexts()).filter((text) =>
        text.includes(code)
      ).length;

      await page.getByLabel(config.label).fill(code);
      await expect(page.getByText(`Showing 1–${expected} of ${expected}`)).toBeVisible();
      const resultRows = page.locator('table tbody tr');
      await expect(resultRows).toHaveCount(expected);
      for (const row of await resultRows.all()) {
        await expect(row).toContainText(code);
      }

      await page.getByLabel('Clear search').click();
      await expect(page.getByLabel(config.label)).toHaveValue('');
      await expect(firstRow).toBeVisible();
    });
  }

  test('ports: pagination, search reset and CRUD against fixtures', async ({ page }) => {
    const fixtures = Array.from({ length: 25 }, (_, index) => ({
      id: uuid(index + 1),
      code: `P${String(index + 1).padStart(2, '0')}`,
      name: `Port ${index + 1}`,
      city: `City ${index + 1}`,
      province: null,
      country: 'Philippines',
      active: index !== 24,
    }));
    const ports = await mockTable(page, 'ports', fixtures);

    await page.goto('/dashboard/ports');
    await expect(page.getByRole('heading', { name: 'Ports', level: 1 })).toBeVisible();
    await expect(page.getByText('Showing 1–10 of 25')).toBeVisible();

    const addPort = page.getByRole('button', { name: 'Add port' });
    await addPort.focus();
    await page.keyboard.press('Enter');
    const escapeDialog = page.getByRole('dialog', { name: 'Add port' });
    await expect(escapeDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(escapeDialog).toHaveCount(0);
    await expect(addPort).toBeFocused();

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Showing 11–20 of 25')).toBeVisible();

    await page.getByLabel('Search ports').fill('P25');
    await expect(page.getByText('Showing 1–1 of 1')).toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await expect(page.locator('table tbody tr').first()).toContainText('P25');

    await page.getByLabel('Clear search').click();
    await expect(page.getByText('Showing 1–10 of 25')).toBeVisible();

    await page.getByRole('button', { name: 'Add port' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add port' });
    await dialog.getByRole('button', { name: 'Create port' }).click();
    await expect(dialog.getByText('Use at least 2 characters.')).toBeVisible();
    await expect(dialog.getByText('Name is required.')).toBeVisible();

    await dialog.getByLabel('Code').fill('P01');
    await dialog.getByLabel('Name').fill('Duplicate');
    await dialog.getByLabel('City').fill('Manila');
    await dialog.getByRole('button', { name: 'Create port' }).click();
    await expect(dialog.getByText('Port code P01 is already in use.')).toBeVisible();

    await dialog.getByLabel('Code').fill('TST');
    await dialog.getByLabel('Name').fill('Test Port');
    await dialog.getByLabel('City').fill('Test City');
    await dialog.getByRole('button', { name: 'Create port' }).click();
    await expect(page.getByText('Port TST created.')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Add port' })).toHaveCount(0);
    await page.getByLabel('Search ports').fill('TST');
    await expect(page.getByText('Showing 1–1 of 1')).toBeVisible();

    const row = page.locator('tbody tr', { hasText: 'TST' });
    await row.getByRole('button', { name: 'View' }).click();
    await expect(page.getByRole('dialog', { name: 'Port TST' })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Test City');
    await page.getByRole('button', { name: 'Close' }).click();

    await row.getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit port' });
    await edit.getByLabel('Name').fill('Test Port 2');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Port TST updated.')).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: 'TST' })).toContainText('Test Port 2');

    await page.locator('tbody tr', { hasText: 'TST' }).getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete port?' });
    await confirm.getByRole('button', { name: 'Delete port' }).click();
    await expect(page.getByText('Port TST deleted.')).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: 'TST' })).toHaveCount(0);

    expect(ports.recorded.find((entry) => entry.method === 'POST')?.body).toMatchObject({
      code: 'TST',
      name: 'Test Port',
      city: 'Test City',
      active: true,
    });
    expect(ports.recorded.find((entry) => entry.method === 'PATCH')?.body).toMatchObject({
      name: 'Test Port 2',
    });
    expect(ports.recorded.some((entry) => entry.method === 'DELETE')).toBe(true);
  });

  test('vessels: create and block deletion while trips depend on it', async ({ page }) => {
    const vesselOne = {
      id: uuid(101),
      code: 'MV-001',
      name: 'MV Sampaguita',
      capacity: 500,
      status: 'active',
    };
    const vesselTwo = {
      id: uuid(102),
      code: 'MV-002',
      name: 'MV Tausog',
      capacity: 400,
      status: 'maintenance',
    };
    const vessels = await mockTable(page, 'vessels', [vesselOne, vesselTwo]);
    await mockTable(page, 'trips', [{ id: uuid(901), vessel_id: vesselOne.id }]);
    await mockTable(page, 'vessel_accommodations', []);

    await page.goto('/dashboard/vessels');
    await expect(page.getByRole('heading', { name: 'Vessels', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Add vessel' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add vessel' });
    await dialog.getByLabel('Code').fill('MV-003');
    await dialog.getByLabel('Name').fill('MV Test');
    await dialog.getByLabel('Capacity').fill('120');
    await dialog.getByLabel('Status').selectOption('maintenance');
    await dialog.getByRole('button', { name: 'Create vessel' }).click();
    await expect(page.getByText('Vessel MV-003 created.')).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: 'MV-003' })).toContainText('MV Test');

    await page.getByLabel('Status').selectOption('maintenance');
    await expect(page.getByText('Showing 1–2 of 2')).toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(2);
    await expect(page.locator('table')).toContainText('MV-002');
    await expect(page.locator('table')).toContainText('MV-003');
    await page.getByLabel('Status').selectOption('all');
    await expect(page.getByText('Showing 1–3 of 3')).toBeVisible();

    await page.locator('tbody tr', { hasText: 'MV-001' }).getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete vessel?' });
    await confirm.getByRole('button', { name: 'Delete vessel' }).click();
    await expect(page.getByText(/Vessel MV-001 cannot be deleted/)).toBeVisible();
    expect(vessels.recorded.some((entry) => entry.method === 'DELETE')).toBe(false);

    expect(vessels.recorded.find((entry) => entry.method === 'POST')?.body).toMatchObject({
      code: 'MV-003',
      name: 'MV Test',
      capacity: 120,
      status: 'maintenance',
    });
  });

  test('routes: validates equal ports, creates and deletes a route', async ({ page }) => {
    const portA = { id: uuid(201), code: 'AAA', name: 'Port A', city: 'City A' };
    const portB = { id: uuid(202), code: 'BBB', name: 'Port B', city: 'City B' };
    const portsMock = await mockTable(page, 'ports', [portA, portB]);
    const portsById = new Map([portA, portB].map((port) => [port.id, port]));
    const routeTable = await mockTable(
      page,
      'routes',
      [
        {
          id: uuid(301),
          code: 'AAA-BBB',
          origin_port_id: portA.id,
          destination_port_id: portB.id,
          distance_km: 10,
          estimated_duration_minutes: 60,
          origin: portA,
          destination: portB,
        },
      ],
      (row) => ({
        ...row,
        origin: portsById.get(row.origin_port_id) ?? null,
        destination: portsById.get(row.destination_port_id) ?? null,
      })
    );
    const trips = await mockTable(page, 'trips', []);

    await page.goto('/dashboard/routes');
    await expect(page.getByRole('heading', { name: 'Routes', level: 1 })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toContainText('AAA');

    await page.getByLabel('Origin').selectOption(portA.id);
    await expect(page.getByText('Showing 1–1 of 1')).toBeVisible();
    await page.getByLabel('Destination').selectOption(portB.id);
    await expect(page.getByText('Showing 1–1 of 1')).toBeVisible();
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByText('Showing 1–1 of 1')).toBeVisible();

    await page.getByRole('button', { name: 'Add route' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add route' });
    await dialog.getByLabel('Code').fill('R-TEST');
    await dialog.getByLabel('Origin port').selectOption(portA.id);
    await dialog.getByLabel('Destination port').selectOption(portA.id);
    await dialog.getByRole('button', { name: 'Create route' }).click();
    await expect(dialog.getByText('Origin and destination must differ.')).toBeVisible();

    await dialog.getByLabel('Destination port').selectOption(portB.id);
    await dialog.getByLabel('Distance (km)').fill('12.5');
    await dialog.getByLabel('Duration (minutes)').fill('90');
    await dialog.getByRole('button', { name: 'Create route' }).click();
    await expect(page.getByText('Route R-TEST created.')).toBeVisible();

    const row = page.locator('tbody tr', { hasText: 'R-TEST' });
    await expect(row).toContainText('AAA — City A');
    await expect(row).toContainText('BBB — City B');

    await row.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete route?' });
    await confirm.getByRole('button', { name: 'Delete route' }).click();
    await expect(page.getByText('Route R-TEST deleted.')).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: 'R-TEST' })).toHaveCount(0);

    expect(routeTable.recorded.find((entry) => entry.method === 'POST')?.body).toMatchObject({
      code: 'R-TEST',
      origin_port_id: portA.id,
      destination_port_id: portB.id,
      distance_km: 12.5,
      estimated_duration_minutes: 90,
    });
    expect(routeTable.recorded.some((entry) => entry.method === 'DELETE')).toBe(true);
    expect(trips.recorded).toHaveLength(0);
    expect(portsMock.recorded).toHaveLength(0);
  });

  test('accommodations: creates, deactivates and re-activates a class', async ({ page }) => {
    const vessel = {
      id: uuid(401),
      code: 'MV-001',
      name: 'MV Sampaguita',
      status: 'active',
    };
    const otherVessel = {
      id: uuid(402),
      code: 'MV-002',
      name: 'MV Tausog',
      status: 'active',
    };
    await mockTable(page, 'vessels', [vessel, otherVessel]);
    const accommodations = await mockTable(page, 'vessel_accommodations', [
      {
        id: uuid(501),
        vessel_id: vessel.id,
        code: 'TOURIST',
        name: 'Tourist Class',
        capacity: 120,
        fare_amount: 1200,
        is_active: true,
        vessels: { id: vessel.id, code: vessel.code, name: vessel.name },
      },
      {
        id: uuid(502),
        vessel_id: otherVessel.id,
        code: 'OLD',
        name: 'Retired Class',
        capacity: 10,
        fare_amount: 500,
        is_active: false,
        vessels: { id: otherVessel.id, code: otherVessel.code, name: otherVessel.name },
      },
    ]);
    await mockTable(page, 'trips', []);

    await page.goto('/dashboard/accommodations');
    await expect(page.getByRole('heading', { name: 'Accommodations', level: 1 })).toBeVisible();

    await page.getByLabel('Vessel').selectOption(otherVessel.id);
    await expect(page.getByText('Showing 1–1 of 1')).toBeVisible();
    await expect(page.locator('table tbody tr')).toContainText('OLD');
    await page.getByLabel('Status').selectOption('inactive');
    await expect(page.getByText('Showing 1–1 of 1')).toBeVisible();
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByText('Showing 1–2 of 2')).toBeVisible();

    await page.getByRole('button', { name: 'Add accommodation' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add accommodation' });
    await dialog.getByLabel('Vessel').selectOption(vessel.id);
    await dialog.getByLabel('Code').fill('BUSINESS');
    await dialog.getByLabel('Name').fill('Business Class');
    await dialog.getByLabel('Capacity').fill('40');
    await dialog.getByLabel('Fare per pax (VAT-incl ₱)').fill('2200');
    await dialog.getByRole('button', { name: 'Create accommodation' }).click();
    await expect(page.getByText('Accommodation BUSINESS created.')).toBeVisible();

    const row = page.locator('tbody tr', { hasText: 'BUSINESS' });
    await expect(row).toContainText('Business Class');
    await row.getByRole('button', { name: 'Deactivate' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Deactivate accommodation?' });
    await confirm.getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByText('Accommodation BUSINESS deactivated.')).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: 'BUSINESS' })).toContainText('Inactive');
    await expect(page.locator('tbody tr', { hasText: 'BUSINESS' }).getByRole('button', { name: 'Deactivate' })).toHaveCount(0);

    await page.locator('tbody tr', { hasText: 'BUSINESS' }).getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit accommodation' });
    await edit.getByLabel('Status').selectOption('true');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Accommodation BUSINESS updated.')).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: 'BUSINESS' })).toContainText('Active');

    expect(accommodations.recorded.find((entry) => entry.method === 'POST')?.body).toMatchObject({
      vessel_id: vessel.id,
      code: 'BUSINESS',
      name: 'Business Class',
      capacity: 40,
      fare_amount: 2200,
      is_active: true,
    });
    expect(accommodations.recorded.find((entry) => entry.method === 'PATCH')?.body).toEqual({
      is_active: false,
    });
    expect(
      accommodations.recorded.filter((entry) => entry.method === 'PATCH').at(-1)?.body
    ).toMatchObject({ is_active: true });
  });
});

test.describe('mobile layout for shipping pages', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(!env, 'frontend/.env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY is required');

  for (const config of [
    { path: '/dashboard/ports', heading: 'Ports' },
    { path: '/dashboard/vessels', heading: 'Vessels' },
    { path: '/dashboard/routes', heading: 'Routes' },
    { path: '/dashboard/accommodations', heading: 'Accommodations' },
  ]) {
    test(`${config.heading} has no page-level horizontal overflow`, async ({ page }) => {
      if (!env) return;
      await signInAsAdmin(page, env);
      await page.goto(config.path);
      await expect(page.getByRole('heading', { name: config.heading, level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
