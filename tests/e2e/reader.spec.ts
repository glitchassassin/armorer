import { expect, test } from '@playwright/test';

test('renders the preserved home and table of contents', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Armorer', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Genesis' })).toBeVisible();
  await expect(page.locator('.offline-status')).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/site.webmanifest');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
});

test('serves meaningful prerendered home and book pages without prerendering chapters', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Armorer', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Genesis', exact: true })).toBeVisible();

  await page.goto('/john/');
  await expect(page.getByRole('heading', { name: 'John', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '21', exact: true })).toBeVisible();

  await page.goto('/john/3/');
  await expect(page.getByRole('heading', { name: 'John', exact: true })).toHaveCount(0);
  await expect(page.locator('#app')).toBeEmpty();
  await context.close();
});

test('hydrates a prerendered book page and keeps client chapter navigation working', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/john/');
  await expect(page.getByRole('heading', { name: 'John', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '3', exact: true }).click();
  await expect(page.locator('[data-chapter-path="/john/3/"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('keeps verse numbers available to assistive technology while excluding them from custom copy', async ({ page }) => {
  await page.goto('/john/3/#16');
  const verseNumber = page.locator('[data-chapter-path="/john/3/"] [data-verse="16"] .verse-number');
  await expect(verseNumber).toHaveText('16');
  await expect(verseNumber).not.toHaveAttribute('aria-hidden', 'true');
});

test('restores and validates forward and backward fragment ranges', async ({ page }) => {
  await page.goto('/john/3/#36-4_3');
  await expect(page.locator('[data-chapter-path="/john/3/"] [data-verse="36"]')).toHaveClass(/verse-focused/);
  await expect(page.locator('[data-chapter-path="/john/4/"] [data-verse="3"]')).toHaveClass(/verse-focused/);
  await expect(page.locator('.verse-focused')).toHaveCount(4);

  await page.goto('/john/4/#3-3_36');
  await expect(page.locator('[data-chapter-path="/john/4/"] [data-verse="3"]')).toHaveClass(/verse-focused/);
  await expect(page.locator('[data-chapter-path="/john/3/"] [data-verse="36"]')).toHaveClass(/verse-focused/);
  await expect(page.locator('.verse-focused')).toHaveCount(4);

  await page.goto('/john/3/#999');
  await expect(page.locator('[data-chapter-path="/john/3/"]')).toBeVisible();
  await expect(page.locator('.verse-focused')).toHaveCount(0);
});

test('shows the themed unsynchronized error and recovers', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/data/chapters/**', (route) => route.abort());
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Armorer', exact: true })).toBeVisible();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect.poll(() => page.evaluate(async () => {
    const script = document.querySelector<HTMLScriptElement>('script[type="module"]');
    return Boolean(script && await caches.match(script.src, { ignoreSearch: true, ignoreVary: true }));
  })).toBe(true);
  await page.context().setOffline(true);
  await page.getByRole('link', { name: 'John', exact: true }).click();
  await page.getByRole('link', { name: '3', exact: true }).click();
  await expect(page.getByRole('heading', { name: /John 3 is unavailable offline/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Available content' })).toBeVisible();
  await page.context().setOffline(false);
  await page.unroute('**/data/chapters/**');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('[data-chapter-path="/john/3/"]')).toBeVisible();
  await context.close();
});

test('shows the unavailable passage when scrolling reaches an unsynchronized boundary', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/data/chapters/**', (route) => {
    if (/\/genesis-1\.[a-f0-9]+\.json$/.test(new URL(route.request().url()).pathname)) void route.continue();
    else void route.abort();
  });
  await page.goto('/genesis/1/');
  await expect(page.locator('[data-chapter-path="/genesis/1/"]')).toBeVisible();
  await context.setOffline(true);
  await page.locator('.reader').evaluate((reader) => {
    reader.scrollTop = reader.scrollHeight;
    reader.dispatchEvent(new Event('scroll'));
  });
  const heading = page.getByRole('heading', { name: /^Genesis \d+ is unavailable offline$/ });
  await expect(heading).toBeVisible();
  const chapter = new URL(page.url()).pathname.match(/^\/genesis\/(\d+)\/$/)?.[1];
  await expect(heading).toHaveText(`Genesis ${chapter} is unavailable offline`);
  await context.setOffline(false);
  await context.close();
});

test('synchronizes the corpus for cold offline reading and search', async ({ page, context }, testInfo) => {
  test.slow();
  await page.goto('/');
  await expect(page.getByText('Available offline', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByText('Available offline', { exact: true })).toBeVisible();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect.poll(() => page.evaluate(async () => {
    const script = document.querySelector<HTMLScriptElement>('script[type="module"]');
    return Boolean(script && await caches.match(script.src, { ignoreSearch: true, ignoreVary: true }));
  })).toBe(true);
  await context.setOffline(true);
  if (testInfo.project.name.includes('webkit')) {
    await page.getByRole('link', { name: 'Psalms', exact: true }).click();
    await page.getByRole('link', { name: '119', exact: true }).click();
    await page.evaluate(() => { window.location.hash = '#100-105'; });
  } else {
    await page.goto('/psalms/119/#100-105');
  }
  await expect(page.locator('.verse-focused')).toHaveCount(6);
  await page.getByRole('searchbox').fill('beginning');
  await expect(page.getByRole('link', { name: 'Genesis 1:1' })).toBeVisible();
  await page.getByRole('searchbox').fill('love');
  await expect(page.locator('.result-list li').first().getByRole('link')).toHaveText('Genesis 22:2');
  await context.setOffline(false);
});

test('copies scripture text with canonical markdown references', async ({ page }) => {
  await page.goto('/john/3/#16-18');
  await expect(page.locator('.verse-focused')).toHaveCount(3);
  const copied = await page.evaluate(async () => {
    const first = document.querySelector('[data-chapter-path="/john/3/"] [data-verse="16"] .verse-text')!;
    const last = document.querySelector('[data-chapter-path="/john/3/"] [data-verse="18"] .verse-text')!;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.childNodes.length);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    let copied = '';
    document.addEventListener('copy', (event) => { copied = event.clipboardData?.getData('text/plain') ?? ''; }, { once: true });
    document.execCommand('copy');
    return copied;
  });
  expect(copied).toContain('For God so loved the world');
  expect(copied).not.toMatch(/^16\s/);
  expect(copied).toContain('[John 3:16-18](http://127.0.0.1:4317/john/3/#16-18)');
});

test('falls back to the last working application shell when an update does not become healthy', async ({ page }) => {
  await page.route('**/assets/main-*.js', (route) => route.abort());
  await page.goto('/404.html');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.unroute('**/assets/main-*.js');
  await expect.poll(() => page.evaluate(async () => {
    const currentName = (await caches.keys()).find((name) => name.startsWith('armorer-app-'));
    if (!currentName) return undefined;
    const response = await (await caches.open(currentName)).match('/__armorer_state__');
    return response ? (await response.json()).status : undefined;
  })).toBe('candidate');
  await page.evaluate(async () => {
    const currentName = (await caches.keys()).find((name) => name.startsWith('armorer-app-'))!;
    const current = await caches.open(currentName);
    const fallback = await caches.open('armorer-app-test-working');
    await fallback.put(new URL('/index.html', location.href).href, new Response('<!doctype html><html><body data-working-shell="true">Working shell</body></html>', {
      headers: { 'content-type': 'text/html' }
    }));
    await current.put(new URL('/__armorer_state__', location.href).href, new Response(JSON.stringify({
      status: 'candidate', attempts: 1, attemptedAt: 0
    }), { headers: { 'content-type': 'application/json' } }));
  });
  await page.goto('/');
  await expect(page.locator('body[data-working-shell="true"]')).toHaveText('Working shell');
});
