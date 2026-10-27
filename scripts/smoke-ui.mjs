#!/usr/bin/env node
/**
 * Browser smoke test: drives the studio in headless Chrome (installed Google Chrome via playwright-core)
 * through sign-up, workspace creation, records, kanban, command menu, settings, installing the invoicing module
 * and the agent panel (which shows a setup hint when the server has no AI provider key).
 *   pnpm dev            # in another terminal (API + studio)
 *   pnpm smoke:ui       # STUDIO_URL overrides http://localhost:5173; screenshots land in .smoke/
 */
import { chromium } from 'playwright-core';

const base = process.env.STUDIO_URL ?? 'http://localhost:5173';
const stamp = Date.now().toString(36);
const email = `ui-${stamp}@example.com`;
const password = 'password123!';

import { mkdirSync } from 'node:fs';

const shots = new URL('../.smoke/', import.meta.url).pathname;
mkdirSync(shots, { recursive: true });
const errors = [];
const results = [];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
// Never let the run open an external protocol handler (Mail, FaceTime, ...): swallow mailto:/tel: clicks.
await context.addInitScript(() => {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      const href = target?.getAttribute('href') ?? '';
      if (/^(mailto|tel|sms|facetime):/i.test(href)) {
        event.preventDefault();
      }
    },
    true,
  );
});
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') {
    errors.push(m.text());
  }
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400) {
    errors.push(`HTTP ${r.status()} ${r.url()}`);
  }
});

const shot = async (name) => {
  await page.screenshot({ path: `${shots}${name}.png`, fullPage: false });
  results.push(`screenshot ${name}`);
};
const step = async (name, fn) => {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (e) {
    results.push(`✗ ${name}: ${e.message.split('\n')[0]}`);
    await shot(`fail-${name.replace(/\W+/g, '-')}`).catch(() => {});
    throw e;
  }
};

try {
  await step('sign-up page renders', async () => {
    await page.goto(`${base}/sign-up`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/name/i).first().waitFor({ timeout: 30000 });
    await shot('01-sign-up');
  });

  await step('sign up', async () => {
    await page.getByLabel(/^name/i).first().fill('UI Smoke');
    await page.getByLabel(/email/i).first().fill(email);
    await page
      .getByLabel(/password/i)
      .first()
      .fill(password);
    await page
      .getByRole('button', { name: /sign up|create account|continue/i })
      .first()
      .click();
    await page.waitForURL(/\/workspaces|\/workspaces\//, { timeout: 30000 });
  });

  await step('create workspace', async () => {
    if (!/\/workspaces/.test(page.url())) {
      await page.goto(`${base}/workspaces`);
    }
    await shot('02-workspaces');
    const nameInput = page.getByLabel(/name/i).first();
    await nameInput.waitFor({ timeout: 15000 });
    await nameInput.fill(`Smoke ${stamp}`);
    const slugInput = page.getByLabel(/slug/i).first();
    if (await slugInput.count()) {
      await slugInput.fill(`smoke-${stamp}`);
    }
    await page
      .getByRole('button', { name: /create/i })
      .first()
      .click();
    await page.waitForURL(/\/workspaces\/smoke-/, { timeout: 30000 });
  });

  await step('records tool renders seeded objects', async () => {
    // New workspaces open on Home; the records tool is one click away.
    await page.goto(`${base}/workspaces/smoke-${stamp}/records`);
    await page.waitForURL(/\/workspaces\/smoke-[a-z0-9]+\/records/, { timeout: 30000 });
    await page
      .getByText(/people/i)
      .first()
      .waitFor({ timeout: 30000 });
    await shot('03-records-index');
  });

  await step('open people table view', async () => {
    await page.goto(`${base}/workspaces/smoke-${stamp}/records/person`);
    await page.getByRole('button', { name: /new/i }).first().waitFor({ timeout: 30000 });
    await shot('04-people-table-empty');
  });

  await step('create a person through the dialog', async () => {
    await page.getByRole('button', { name: /^new/i }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 15000 });
    await dialog.locator('[data-field="firstName"] input').fill('Ada');
    await dialog.locator('[data-field="lastName"] input').fill('Lovelace');
    await dialog.locator('[data-field="email"] input').fill(`ada.${stamp}@example.com`);
    await shot('05-create-person-dialog');
    await dialog
      .getByRole('button', { name: /create|save/i })
      .first()
      .click();
    // Creating from the dialog opens the new record.
    await page.waitForURL(/\/records\/person\/[^/?]+/, { timeout: 15000 });
    await page.getByText('Ada Lovelace').first().waitFor({ timeout: 15000 });
    await shot('06-record-page-after-create');
  });

  await step('people table lists the new row', async () => {
    await page.goto(`${base}/workspaces/smoke-${stamp}/records/person`);
    // The label column renders the record link with the record's label as its exact name.
    await page.getByRole('link', { name: 'Ada', exact: true }).waitFor({ timeout: 30000 });
    await shot('07-people-table-with-row');
  });

  await step('open the record page from the table', async () => {
    await page.getByRole('link', { name: 'Ada', exact: true }).click();
    await page.waitForURL(/\/records\/person\/[^/?]+/, { timeout: 15000 });
    await page.getByText('Details').first().waitFor({ timeout: 15000 });
    await shot('08-record-page');
  });

  await step('pipeline kanban renders', async () => {
    await page.goto(`${base}/workspaces/smoke-${stamp}/records/opportunity`);
    await page
      .getByText(/screening/i)
      .first()
      .waitFor({ timeout: 30000 });
    await shot('09-pipeline-kanban');
  });

  await step('command menu opens', async () => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    await page
      .getByPlaceholder(/command|search/i)
      .first()
      .waitFor({ timeout: 10000 });
    await shot('10-command-menu');
    await page.keyboard.press('Escape');
  });

  await step('settings data model lists objects', async () => {
    await page.goto(`${base}/workspaces/smoke-${stamp}/settings/data-model`);
    await page
      .getByText(/opportunit/i)
      .first()
      .waitFor({ timeout: 30000 });
    await shot('11-settings-data-model');
  });

  await step('settings workflows renders the empty state', async () => {
    await page.goto(`${base}/workspaces/smoke-${stamp}/settings/workflows`);
    await page
      .getByText(/No workflows yet/i)
      .first()
      .waitFor({ timeout: 30000 });
    await shot('11b-settings-workflows');
    await page
      .getByRole('button', { name: /New workflow/ })
      .first()
      .click();
    // The editor is a screen of its own; the canvas draws the trigger and a "+" node.
    await page.waitForURL(/\/settings\/workflows\/new/, { timeout: 10000 });
    await page.locator('[data-canvas-node="trigger"]').waitFor({ timeout: 10000 });
    await page
      .getByRole('button', { name: /^Add a step/ })
      .first()
      .click();
    await page.getByText('If / else').click();
    await page.locator('[data-canvas-node="branch"]').waitFor({ timeout: 10000 });
    await page.getByText('Yes', { exact: true }).first().waitFor({ timeout: 10000 });
    await shot('11c-workflow-editor');
    await page.getByRole('button', { name: 'Fullscreen' }).click();
    await page.locator('[data-slot="workflow-editor"][data-fullscreen="true"]').waitFor({ timeout: 10000 });
    await shot('11d-workflow-fullscreen');
    await page.getByRole('button', { name: 'Exit fullscreen' }).click();
    await page.locator('[data-slot="workflow-editor"][data-fullscreen="false"]').waitFor({ timeout: 10000 });
    // Leaving with an unsaved branch asks first.
    await page.getByRole('button', { name: 'Back to workflows' }).click();
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await page.waitForURL(/\/settings\/workflows$/, { timeout: 10000 });
  });

  await step('settings modules installs Resend from the catalog and opens its settings', async () => {
    await page.goto(`${base}/workspaces/smoke-${stamp}/settings/modules`);
    const resend = page.locator('[data-module="email-resend"]');
    await resend.getByRole('button', { name: 'Install…' }).click({ timeout: 30000 });
    await resend.getByRole('button', { name: 'Install', exact: true }).click({ timeout: 10000 });
    await resend.locator('[data-slot="module-runtime"][data-status="unconfigured"]').waitFor({ timeout: 10000 });
    await shot('11e-module-installed');
    // Only the dialog: saving tests the key against Resend, which a smoke run must not depend on.
    await resend.getByRole('button', { name: 'Set up' }).click();
    await page.getByRole('heading', { name: 'Resend settings' }).waitFor({ timeout: 10000 });
    await page.getByLabel('API key').waitFor({ timeout: 10000 });
    await shot('11f-module-settings');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('heading', { name: 'Resend settings' }).waitFor({ state: 'hidden', timeout: 10000 });
  });

  await step('settings modules shows crm installed', async () => {
    await page.goto(`${base}/workspaces/smoke-${stamp}/settings/modules`);
    await page
      .getByText(/crm|CRM/i)
      .first()
      .waitFor({ timeout: 30000 });
    await shot('12-settings-modules');
  });

  await step('installs Invoicing from the catalog and bills a company', async () => {
    await page.goto(`${base}/workspaces/smoke-${stamp}/settings/modules`);
    const invoicing = page.locator('[data-module="invoicing"]');
    await invoicing.getByRole('button', { name: 'Install…' }).click({ timeout: 30000 });
    await invoicing.getByRole('button', { name: 'Install', exact: true }).click({ timeout: 10000 });
    await invoicing.getByText('Up to date').waitFor({ timeout: 30000 });
    await page.goto(`${base}/workspaces/smoke-${stamp}/records/invoice`);
    await page.getByRole('button', { name: /^new/i }).first().click({ timeout: 30000 });
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 15000 });
    await dialog.locator('[data-field="number"] input').fill(`INV-${stamp}`);
    await dialog
      .getByRole('button', { name: /create|save/i })
      .first()
      .click();
    await page.waitForURL(/\/records\/invoice\/[^/?]+/, { timeout: 15000 });
    // A draft is edited in place: add an item, then send it; a sent invoice offers to record a payment.
    const invoice = page.locator('[data-slot="invoice-page"]');
    await invoice.getByText('Amount due').waitFor({ timeout: 15000 });
    await invoice.getByRole('button', { name: 'Add item' }).click();
    await invoice.locator('[data-line]').first().waitFor({ timeout: 15000 });
    await shot('12b-invoice-record');
    await invoice.getByRole('button', { name: 'Send invoice' }).click();
    await invoice.getByRole('button', { name: 'Record payment' }).waitFor({ timeout: 15000 });
    await invoice.locator('[data-slot="locked"]').waitFor({ timeout: 15000 });
    await shot('12b2-invoice-sent');
    await page.goto(`${base}/workspaces/smoke-${stamp}/billing`);
    await page.getByRole('button', { name: new RegExp(`INV-${stamp}`) }).waitFor({ timeout: 30000 });
    await shot('12c-billing-tool');
  });

  await step('agent panel docks and reports its status', async () => {
    await page.goto(`${base}/workspaces/smoke-${stamp}/records/person`);
    await page.getByRole('button', { name: 'Agent chat', exact: true }).first().waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Agent chat', exact: true }).first().click();
    const panel = page.locator('[data-panel="core.agent_chat"]');
    await panel.waitFor({ timeout: 15000 });
    // Without a key the panel explains how to enable the agent; with one it shows the composer.
    await Promise.race([
      panel.getByText(/not configured/i).waitFor({ timeout: 15000 }),
      panel.getByLabel('Message the agent').waitFor({ timeout: 15000 }),
    ]);
    await shot('14-agent-chat-panel');
    // ⌘J toggles it away again.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+J' : 'Control+J');
    await panel.waitFor({ state: 'detached', timeout: 10000 });
  });

  await step('settings AI section renders', async () => {
    await page.goto(`${base}/workspaces/smoke-${stamp}/settings/ai`);
    await page
      .getByText(/approvals/i)
      .first()
      .waitFor({ timeout: 30000 });
    await page.getByText('Delete field').first().waitFor({ timeout: 15000 });
    await shot('15-settings-ai');
  });

  await step('dark mode gallery', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${base}/dev/ui`);
    await page
      .getByText(/UI gallery/i)
      .first()
      .waitFor({ timeout: 30000 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await shot('16-gallery-dark');
  });
} catch {
  // reported below
} finally {
  console.log(results.join('\n'));
  console.log(`\nconsole/network errors (${errors.length}):`);
  for (const e of [...new Set(errors)].slice(0, 25)) {
    console.log(`  - ${e.slice(0, 300)}`);
  }
  await browser.close();
  process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
}
