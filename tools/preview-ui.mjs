// Visual fixture using the real templates, module CSS and installed Foundry CSS.
// Usage: node tools/preview-ui.mjs <Foundry resources/app> <runtime node_modules>
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const [foundry, packages] = process.argv.slice(2);
if (!foundry || !packages) throw new Error("Pass Foundry resources/app and runtime node_modules paths.");
const Handlebars = require(path.join(foundry, "node_modules/handlebars"));
const { chromium } = require(path.join(packages, "playwright"));
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "docs/preview");
await fs.mkdir(output, { recursive: true });
const translations = JSON.parse(await fs.readFile(path.join(root, "lang/ru.json"), "utf8"));
const localize = key => translations[key] ?? key;
globalThis.game = { i18n: { localize } };
globalThis.foundry = { utils: {} };
Handlebars.registerHelper("localize", localize);
const { renderRuleMultiselect } = await import("../scripts/ui/rule-presentation.js");
const { listRulePresets } = await import("../scripts/ui/rule-presets.js");
const select = name => renderRuleMultiselect({ name, selectedValues: [], placeholder: "Без ограничений", groups: [{ key: "items", label: "Предметы", options: [{ value: "weapon", label: "Оружие" }, { value: "equipment", label: "Снаряжение" }] }] });
const context = {
  containerName: "Походная сумка следопыта", reductionPct: 50,
  previewBefore: "24", previewAfter: "12", previewUnit: "фнт", previewIsActual: true,
  modeAll: true,
  tabs: [
    { id: "presets", label: "Пресеты", icon: "fas fa-wand-magic-sparkles", active: true },
    { id: "restrictions", label: "Содержимое", icon: "fas fa-box-open" },
    { id: "properties", label: "Свойства", icon: "fas fa-sliders" }
  ],
  presets: listRulePresets().map(p => ({ ...p, label: localize(p.label), summary: p.config.reductionPct !== undefined ? `Снижение веса: ${p.config.reductionPct}%` : "Ограничения содержимого" })),
  themeOptions: ["auto", "light", "dark"].map(value => ({ value, label: localize(`weighty-containers.theme.${value}`), icon: `fas fa-${value === "auto" ? "circle-half-stroke" : value === "dark" ? "moon" : "sun"}`, active: value === "auto" })),
  allowedTypesSelect: select("allowedTypes"), allowedSubtypesSelect: select("allowedSubtypes"),
  requiredPropertiesSelect: select("requiredProperties"), forbiddenPropertiesSelect: select("forbiddenProperties")
};
const render = async file => Handlebars.compile(await fs.readFile(path.join(root, file), "utf8"))(context);
const cssUrl = file => pathToFileURL(file).href;
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Anvil — visual fixture</title>
<link rel="stylesheet" href="${cssUrl(path.join(foundry, "public/css/foundry2.css"))}">
<link rel="stylesheet" href="${cssUrl(path.join(foundry, "public/fonts/fontawesome/css/all.min.css"))}">
<link rel="stylesheet" href="${cssUrl(path.join(root, "styles/anvil.css"))}">
<link rel="stylesheet" href="${cssUrl(path.join(root, "styles/container-rules.css"))}">
<style>body{margin:0;background:#77736d;display:grid;place-items:center;height:100vh} .application.container-rules{position:relative;inset:auto;width:880px;height:720px} .cr-pane[data-tab=presets]{display:grid} .window-content{flex:1;min-height:0} </style>
<body class="theme-dark"><form class="application container-rules anvil cr-ready">
<header class="window-header"><i class="fas fa-box-open"></i><h1 class="window-title">Правила контейнера</h1><button type="button" class="header-control" aria-label="Закрыть">×</button></header>
<div class="window-content anvil-ground">${await render("templates/container-rules.hbs")}${await render("templates/container-rules-footer.hbs")}</div></form>
<script>
const root=document.querySelector('.container-rules');
root.style.setProperty('--cr-range-progress','50%');
document.querySelectorAll('[data-selection]').forEach(el=>el.innerHTML='<span class="cr-placeholder">Без ограничений</span>');
document.querySelectorAll('.cr-select-clear').forEach(el=>el.hidden=true);
document.querySelector('[data-rule-summary]').innerHTML='<p>Вес содержимого снижен на 50%. Ограничений по типам и свойствам нет.</p>';
document.querySelectorAll('[data-action=setTheme]').forEach(button=>button.onclick=()=>{if(button.dataset.theme==='auto')delete root.dataset.avTheme;else root.dataset.avTheme=button.dataset.theme;document.querySelectorAll('[data-action=setTheme]').forEach(b=>b.setAttribute('aria-pressed',b===button));});
document.querySelectorAll('[data-action=selectTab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('.cr-pane').forEach(p=>p.style.display=p.dataset.tab===button.dataset.tab?'grid':'none');document.querySelectorAll('.cr-tab').forEach(b=>{b.classList.toggle('is-active',b===button);b.setAttribute('aria-selected',b===button)});});
</script></html>`;
const file = path.join(output, "index.html");
await fs.writeFile(file, html);
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1080, height: 880 } });
await page.goto(pathToFileURL(file).href);
await page.waitForTimeout(1200);
const results = [];
for (const theme of ["light", "dark"]) {
  await page.evaluate(theme => document.body.className = `theme-${theme}`, theme);
  for (const width of [880, 400]) {
    await page.locator("form.application").evaluate((el, width) => el.style.width = `${width}px`, width);
    for (const tab of ["presets", "restrictions", "properties"]) {
      await page.locator(`[data-action=selectTab][data-tab=${tab}]`).click();
      await page.locator('.window-title').click();
      await page.waitForTimeout(300);
      const geometry = await page.evaluate(() => {
        const root = document.querySelector('form.application');
        const pane = document.querySelector('.cr-panes');
        return { scheme: getComputedStyle(root).colorScheme, overflow: root.scrollWidth > root.clientWidth + 1, paneHeight: pane.clientHeight, footerVisible: document.querySelector('.cr-footer').getBoundingClientRect().bottom <= root.getBoundingClientRect().bottom + 1 };
      });
      results.push({ theme, width, tab, ...geometry });
      if (geometry.overflow || !geometry.footerVisible || geometry.paneHeight < 80) throw new Error(JSON.stringify(results.at(-1)));
      if (tab === 'presets') {
        const clipped = await page.locator('.cr-preset').evaluateAll(elements => elements.some(el => el.scrollHeight > el.clientHeight + 1));
        if (clipped) throw new Error('Preset labels are clipped');
      }
      await page.locator('form.application').screenshot({ path: path.join(output, `${theme}-${width}-${tab}.png`) });
    }
  }
}
// Exercise the native top-layer popover with the actual generated option markup.
await page.locator('[data-action=selectTab][data-tab=restrictions]').click();
await page.evaluate(() => {
  const panel = document.querySelector('.cr-select-panel');
  panel.hidden = false;
  panel.style.cssText = 'width:350px;height:290px;left:365px;top:310px';
  panel.showPopover();
});
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(output, 'popover.png') });
await page.evaluate(() => { const panel = document.querySelector('.cr-select-panel'); panel.hidePopover(); panel.hidden = true; });
for (const [body, override] of [["dark", "light"], ["light", "dark"]]) {
  await page.evaluate(body => document.body.className = `theme-${body}`, body);
  await page.locator(`[data-theme=${override}]`).click();
  const scheme = await page.locator('form.application').evaluate(el => getComputedStyle(el).colorScheme);
  if (scheme !== override) throw new Error('Manual theme override failed');
  await page.locator('[data-theme=auto]').click();
  if (await page.locator('form.application').evaluate(el => getComputedStyle(el).colorScheme) !== body) throw new Error('Auto theme failed');
}
await page.emulateMedia({ reducedMotion: 'reduce' });
const duration = await page.locator('.cr-hero').evaluate(el => getComputedStyle(el).transitionDuration);
if (duration.split(',').some(t => parseFloat(t) > .001)) throw new Error('Reduced motion failed');
await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify({ results, manualTheme: 'passed', reducedMotion: 'passed' }, null, 2));
console.log(JSON.stringify({ checks: results.length, manualTheme: 'passed', reducedMotion: 'passed', output }));
await browser.close();
