import { test } from 'playwright/test';
import { expectUI } from 'krafta/playwright';

const page = new URL('../good.html', import.meta.url).href;

test('project page follows the UI policy', async ({ page: tab }, testInfo) => {
  await tab.goto(page);
  await expectUI(tab, testInfo);
});

test('project page follows the UI policy in dark mode', async ({ page: tab }, testInfo) => {
  await tab.emulateMedia({ colorScheme: 'dark' });
  await tab.goto(page);
  await expectUI(tab, testInfo);
});
