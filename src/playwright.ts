// Adapted from lintapple (https://github.com/gholtzap/lintapple), MIT License,
// Copyright (c) 2026 Gavin Holtzapple. See NOTICE.
import type { Page } from 'playwright';
import type { TestInfo } from 'playwright/test';
import type { Policy } from './check/types.js';
import { AssertionError } from 'node:assert';
import { checkPage } from './check/engine.js';
import { loadConfig } from './config.js';

// Run the gate rules on the page as the test left it: after sign-in, in a dialog, in an error state.
// Findings fail the test and attach a JSON report. Without a policy, krafta.config.json is used.
export async function expectUI(page: Page, testInfo: Pick<TestInfo, 'attach'>, policy?: Partial<Policy>) {
  const report = await checkPage(page, policy === undefined ? (await loadConfig()).check : policy);
  if (!report.findings.length) return;
  await testInfo.attach('krafta findings', {
    body: JSON.stringify({ url: page.url(), viewport: page.viewportSize(), ...report }, null, 2),
    contentType: 'application/json',
  });
  throw new AssertionError({
    message: `krafta found ${report.findings.length} UI findings.\n\n${report.findings.map(f => `${f.rule}: ${f.selector}\n${f.message}\nFix: ${f.fix}`).join('\n\n')}`,
    actual: report.findings,
    expected: [],
    operator: 'expectUI',
    stackStartFn: expectUI,
  });
}
