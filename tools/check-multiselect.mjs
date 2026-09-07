// Browser regression: focus must not scroll the popover away from its content.
// node tools/check-multiselect.mjs <Foundry resources/app> <runtime node_modules>
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const [foundry, packages] = process.argv.slice(2);
const { chromium } = require(path.join(packages, 'playwright'));
const root = path.resolve(import.meta.dirname, '..');
const server = http.createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const base = url.startsWith('/foundry/') ? foundry : root;
    const file = path.resolve(base, '.' + url.replace(/^\/foundry/, ''));
    if (!file.startsWith(path.resolve(base) + path.sep)) throw new Error('Outside fixture root');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', error => console.error(error));
  await page.goto(`http://127.0.0.1:${server.address().port}/package.json`);
  await page.setContent(`<link rel="stylesheet" href="/foundry/public/css/foundry2.css">
    <link rel="stylesheet" href="/styles/anvil.css"><link rel="stylesheet" href="/styles/container-rules.css">
    <style>body{padding:40px}.container-rules{width:980px;padding:24px;position:relative}.cr-multiselect{margin:20px 0}</style>
    <body class="theme-dark"><form class="application anvil container-rules"></form></body>`);
  await page.evaluate(async () => {
    globalThis.foundry = { utils: {} };
    globalThis.game = { i18n: { localize: key => key.split('.').at(-1), format: (key, args) => JSON.stringify(args) } };
    const { renderRuleMultiselect } = await import('/scripts/ui/rule-presentation.js');
    const { ContainerRulesState, RULE_SELECTION_NAMES } = await import('/scripts/ui/container-rules-state.js');
    const { ContainerRulesMultiselectController } = await import('/scripts/ui/container-rules-multiselect.js');
    const options = Array.from({ length: 45 }, (_, i) => ({ value: i === 30 ? 'shield' : `option${i}`, label: i === 30 ? 'Shield' : `Option ${String(i).padStart(2, '0')}` }));
    const groups = [{ key: 'equipment', label: 'Equipment', options }];
    const catalogs = Object.fromEntries(RULE_SELECTION_NAMES.map(name => [name, groups]));
    const rules = new ContainerRulesState({ draft: {}, catalogs });
    const element = document.querySelector('form');
    element.innerHTML = RULE_SELECTION_NAMES.map(name => renderRuleMultiselect({ name, groups, selectedValues: [], placeholder: name })).join('');
    const controller = new ContainerRulesMultiselectController({ rules, getElement: () => element, animate: () => {}, onSelectionChange: () => {} });
    element.addEventListener('change', event => controller.handleChange(event.target));
    element.addEventListener('keydown', event => controller.handleKeyDown(event));
    controller.refreshAll();
    globalThis.fixture = { controller, rules };
  });
  for (const theme of ['light', 'dark']) {
  await page.evaluate(theme => document.body.className = `theme-${theme}`, theme);
  for (const name of ['allowedTypes', 'allowedSubtypes', 'requiredProperties', 'forbiddenProperties']) {
    await page.evaluate(name => fixture.controller.setSelection(name, []), name);
    await page.evaluate(name => fixture.controller.open(fixture.controller.root(name)), name);
    await page.waitForTimeout(260);
    const base = `[data-select="${name}"]`;
    const row = page.locator(`${base} .cr-option-row`).filter({ hasText: 'Shield' });
    await row.scrollIntoViewIfNeeded();
    const before = await page.locator(`${base} .cr-select-panel`).evaluate(el => ({ scroll: el.scrollTop, height: el.clientHeight, content: el.scrollHeight }));
    await row.click();
    await page.waitForTimeout(260);
    const after = await page.locator(`${base} .cr-select-panel`).evaluate(el => ({ scroll: el.scrollTop, height: el.clientHeight, content: el.scrollHeight, toolbarTop: el.querySelector('.cr-select-toolbar').getBoundingClientRect().top, top: el.getBoundingClientRect().top }));
    console.log(JSON.stringify({ theme, name, before, after }));
    assert.equal(await page.locator(`${base} input[value=shield]`).isChecked(), true);
    assert.equal(after.scroll, 0, 'Selecting an option must not scroll the entire panel past its toolbar');
    assert.ok(after.toolbarTop >= after.top - 1, 'Search toolbar remains inside the panel');
    // End/Home must scroll the options, not the enclosing panel, and Space still selects.
    await page.keyboard.press('End');
    await page.keyboard.press('Space');
    assert.equal(await page.locator(`${base} input[value=option44]`).isChecked(), true);
    await page.keyboard.press('Home');
    await page.keyboard.press('Space');
    assert.equal(await page.locator(`${base} input[value=option0]`).isChecked(), true);
    await page.locator(`${base} .cr-option-group-header`).click();
    assert.equal(await page.locator(`${base} .cr-option-row input:checked`).count(), 45);
    assert.equal(await page.locator(`${base} .cr-select-panel`).evaluate(el => el.scrollTop), 0);
    assert.equal(await page.locator(`${base} .cr-select-panel`).evaluate(el => el.matches(':popover-open')), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(`${base} .cr-combobox`).getAttribute('aria-expanded'), 'false');
  }
  }
  console.log('PASS: 8 list/theme combinations; mouse, keyboard, group selection and Escape.');
} finally {
  await browser.close();
  server.close();
}
