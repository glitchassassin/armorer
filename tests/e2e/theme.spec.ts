import { expect, test, type Page } from '@playwright/test';

async function expectBackground(page: Page, scheme: 'light' | 'dark') {
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  })).toEqual(scheme === 'light' ? [250, 247, 240] : [33, 37, 41]);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`uses the ${scheme} system appearance before hydration`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ colorScheme: scheme, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/');
    await expectBackground(page, scheme);
    await expect(page.locator('.brand img')).toHaveCSS('filter', scheme === 'light' ? 'brightness(0)' : 'none');
    await expect(page.locator('.intro img')).toHaveCSS('filter', scheme === 'light' ? 'brightness(0)' : 'none');
    await page.screenshot({ path: testInfo.outputPath(`${scheme}.png`) });
    await context.close();
  });
}

test('responds to system appearance changes without losing reader or search state', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/john/3/#16');
  const verse = page.locator('[data-chapter-path="/john/3/"] [data-verse="16"]');
  await expect(verse).toHaveClass(/verse-focused/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectBackground(page, 'dark');
  await expect(verse).toHaveClass(/verse-focused/);
  await page.locator('#search').fill('love');
  await expect(page.locator('.search-results')).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  await expectBackground(page, 'light');
  await expect(page.locator('#search')).toHaveValue('love');
  await expect(page.locator('.search-results')).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`keeps ${scheme} palette text readable on its surfaces`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    const contrasts = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.append(probe);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      function luminance(token: string) {
        probe.style.color = `var(--${token})`;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(probe).color;
        context.fillRect(0, 0, 1, 1);
        const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      }
      const pairs = [
        ...['text', 'muted', 'muted-subtle', 'heading', 'navigation-text', 'verse-number', 'link'].map((token) => [token, 'background']),
        ['muted', 'surface'], ['navigation-text', 'surface-strong'], ['active-text', 'active-background']
      ];
      const result = pairs.map(([foreground, background]) => {
        const a = luminance(foreground);
        const b = luminance(background);
        return { foreground, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
      probe.remove();
      return result;
    });
    for (const { foreground, background, ratio } of contrasts) {
      expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test('preserves the cool hue of dark text variants', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const colors = await page.evaluate(() => {
    const probe = document.createElement('span');
    document.body.append(probe);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const samples = ['heading', 'navigation-text', 'muted-subtle', 'control-border', 'verse-number'].map((token) => {
      probe.style.color = `var(--${token})`;
      context.fillStyle = getComputedStyle(probe).color;
      context.fillRect(0, 0, 1, 1);
      return { token, rgb: [...context.getImageData(0, 0, 1, 1).data].slice(0, 3) };
    });
    probe.remove();
    return samples;
  });
  for (const { token, rgb: [red, green, blue] } of colors) {
    expect(blue, `${token}: blue exceeds green`).toBeGreaterThan(green);
    expect(green, `${token}: green exceeds red`).toBeGreaterThan(red);
  }
});
