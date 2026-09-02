import { expect, type Page, test } from '@playwright/test';

async function copyRange(page: Page, startSelector: string, endSelector: string, startOffset?: number, endOffset?: number) {
  return page.evaluate(async ({ startSelector, endSelector, startOffset, endOffset }) => {
    const start = document.querySelector(startSelector)!;
    const end = document.querySelector(endSelector)!;
    const range = document.createRange();
    if (startOffset === undefined) range.setStart(start, 0);
    else range.setStart(start.firstChild!, startOffset);
    if (endOffset === undefined) range.setEnd(end, end.childNodes.length);
    else range.setEnd(end.firstChild!, endOffset);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    let copied = '';
    document.addEventListener('copy', (event) => { copied = event.clipboardData?.getData('text/plain') ?? ''; }, { once: true });
    document.execCommand('copy');
    return copied;
  }, { startSelector, endSelector, startOffset, endOffset });
}

test('preserves history across reference navigation', async ({ page }) => {
  await page.goto('/john/3/#16');
  await expect(page.locator('.verse-focused')).toHaveCount(1);
  await page.getByRole('searchbox').fill('John 4:3');
  await page.getByRole('searchbox').press('Enter');
  await expect(page).toHaveURL(/\/john\/4\/#3$/);
  await expect(page.getByRole('searchbox')).not.toBeFocused();
  await expect(page.locator('[data-chapter-path="/john/4/"] [data-verse="3"]')).toHaveClass(/verse-focused/);
  await page.goBack();
  await expect(page).toHaveURL(/\/john\/3\/#16$/);
  await expect(page.locator('[data-chapter-path="/john/3/"] [data-verse="16"]')).toHaveClass(/verse-focused/);
});

test('preserves the prior passage when reference entry outlasts the search debounce', async ({ page }) => {
  await page.goto('/john/3/#16');
  await expect(page.locator('.verse-focused')).toHaveCount(1);
  await page.getByRole('searchbox').fill('John 3:17');
  await page.waitForTimeout(200);
  await expect(page).toHaveURL(/\?q=John(?:\+|%20)3%3A17#16$/);
  await page.getByRole('searchbox').press('Enter');
  await expect(page).toHaveURL(/\/john\/3\/#17$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/john\/3\/#16$/);
  await expect(page.locator('[data-chapter-path="/john/3/"] [data-verse="16"]')).toHaveClass(/verse-focused/);
});

test('preserves the reading position when an earlier chapter is prepended', async ({ page }) => {
  await page.goto('/john/3/');
  await expect(page.locator('[data-chapter-path="/john/2/"]')).toBeAttached();
  await expect.poll(() => page.evaluate(() => {
    const reader = document.querySelector('.reader')!;
    const chapter = document.querySelector('[data-chapter-path="/john/3/"]')!;
    return Math.abs(chapter.getBoundingClientRect().top - reader.getBoundingClientRect().top);
  })).toBeLessThan(100);
});

test('scrolls continuously across a book boundary and bounds ordinary DOM growth', async ({ page }) => {
  await page.goto('/malachi/4/');
  await expect(page.locator('[data-chapter-path="/matthew/1/"]')).toBeAttached();
  await page.locator('.reader').evaluate((reader) => {
    reader.scrollTop = reader.scrollHeight;
    reader.dispatchEvent(new Event('scroll'));
  });
  await expect(page).toHaveURL(/\/matthew\/1\/$/);
  for (let index = 0; index < 10; index += 1) {
    await page.locator('.reader').evaluate((reader) => {
      reader.scrollTop = reader.scrollHeight;
      reader.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(30);
  }
  await expect.poll(() => page.locator('[data-chapter-path]').count()).toBeLessThanOrEqual(7);
});

test('does not leave a viewport-sized spacer after the final chapter', async ({ page }) => {
  await page.goto('/revelation/22/');
  const finalChapter = page.locator('[data-chapter-path="/revelation/22/"]');
  await expect(finalChapter).toBeVisible();
  await expect(page.locator('.reader-end-space')).toHaveCount(0);
  await expect.poll(() => page.locator('.reader').evaluate((reader) => {
    reader.scrollTop = reader.scrollHeight;
    const chapter = reader.querySelector<HTMLElement>('[data-chapter-path="/revelation/22/"]')!;
    return Math.abs(reader.getBoundingClientRect().bottom - chapter.getBoundingClientRect().bottom);
  })).toBeLessThan(24);
});

test('remounts cached chapters when reversing after pruning', async ({ page }) => {
  await page.goto('/genesis/1/');
  await expect(page.locator('[data-chapter-path="/genesis/1/"]')).toBeAttached();
  for (let index = 0; index < 14; index += 1) {
    await page.locator('.reader').evaluate((reader) => {
      reader.scrollTop = reader.scrollHeight;
      reader.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(40);
  }
  await expect.poll(() => page.locator('[data-chapter-path="/genesis/1/"]').count()).toBe(0);

  for (let index = 0; index < 14; index += 1) {
    await page.locator('.reader').evaluate((reader) => {
      reader.scrollTop = 0;
      reader.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(40);
  }
  await expect(page.locator('[data-chapter-path="/genesis/1/"]')).toBeAttached();
  await expect(page).toHaveURL(/\/genesis\/1\/$/);
});

test('preserves compact reference syntax and published reference choices', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox').fill('John3:16');
  await expect(page.getByRole('link', { name: 'John 3:16', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'John 3', exact: true })).toBeVisible();
  await page.getByRole('searchbox').press('Enter');
  await expect(page).toHaveURL(/\/john\/3\/#16$/);
});

test('restores published search matching and clamps invalid pagination', async ({ page }) => {
  test.slow();
  await page.goto('/?q=beginning');
  await expect(page.getByRole('link', { name: 'Genesis 11:6', exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.result-list li')).toHaveCount(20);
  await expect(page.locator('.result-list li em').first()).toBeAttached();

  await page.goto('/?q=beginning&p=999');
  await expect(page).not.toHaveURL(/p=999/, { timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Next page' }).first()).toBeDisabled();
});

test('keeps chapters in a native cross-chapter selection mounted until selection clears', async ({ page }) => {
  await page.goto('/john/3/');
  await expect(page.locator('[data-chapter-path="/john/4/"]')).toBeAttached();
  await page.evaluate(() => {
    const start = document.querySelector('[data-chapter-path="/john/3/"] [data-verse="36"] .verse-text')!;
    const end = document.querySelector('[data-chapter-path="/john/4/"] [data-verse="1"] .verse-text')!;
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.childNodes.length);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  for (let index = 0; index < 9; index += 1) {
    await page.locator('.reader').evaluate((reader) => {
      reader.scrollTop = reader.scrollHeight;
      reader.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(30);
  }
  await expect(page.locator('[data-chapter-path="/john/3/"]')).toBeAttached();
  await expect(page.locator('[data-chapter-path="/john/4/"]')).toBeAttached();
  await page.evaluate(() => {
    document.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.locator('.reader').evaluate((reader) => reader.dispatchEvent(new Event('scroll')));
  await expect.poll(() => page.locator('[data-chapter-path]').count()).toBeLessThanOrEqual(7);
});

test('formats partial, cross-chapter, and cross-book copies', async ({ page }) => {
  await page.goto('/john/3/#16');
  await expect(page.locator('[data-chapter-path="/john/3/"] [data-verse="16"] .verse-text')).toBeVisible();
  const partial = await copyRange(
    page,
    '[data-chapter-path="/john/3/"] [data-verse="16"] .verse-text',
    '[data-chapter-path="/john/3/"] [data-verse="16"] .verse-text',
    4,
    10
  );
  expect(partial).toContain('God so');
  expect(partial).toContain('[John 3:16]');

  await page.goto('/john/3/#36-4_3');
  await expect(page.locator('.verse-focused')).toHaveCount(4);
  await expect(page.locator('[data-chapter-path="/john/3/"] [data-verse="36"] .verse-text')).toBeVisible();
  await expect(page.locator('[data-chapter-path="/john/4/"] [data-verse="3"] .verse-text')).toBeVisible();
  const crossChapter = await copyRange(
    page,
    '[data-chapter-path="/john/3/"] [data-verse="36"] .verse-text',
    '[data-chapter-path="/john/4/"] [data-verse="3"] .verse-text'
  );
  expect(crossChapter).toContain('[John 3:36-4:3]');

  await page.goto('/malachi/4/');
  await expect(page.locator('[data-chapter-path="/matthew/1/"]')).toBeAttached();
  const crossBook = await copyRange(
    page,
    '[data-chapter-path="/malachi/4/"] [data-verse="6"] .verse-text',
    '[data-chapter-path="/matthew/1/"] [data-verse="1"] .verse-text'
  );
  expect(crossBook).toContain('[Malachi 4:6]');
  expect(crossBook).toContain('[Matthew 1:1]');
});

test('recovers after browser storage is cleared', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Available offline', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.unregister();
    await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('armorer-offline-v2');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Armorer', exact: true })).toBeVisible();
  await expect(page.locator('.offline-status')).toContainText(/Saving offline content|Available offline/);
});
