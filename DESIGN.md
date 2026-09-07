# Anvil 2 — дизайн-система окон Foundry VTT

Направление: **современная мастерская**. Светлая тема — тёплый фарфор,
тёмная — графит, акцент — янтарь. Крупное название предмета набрано антиквой,
управляющие элементы — системным гротеском. Тонкие границы, внутренний свет и
короткое движение создают глубину, сохраняя читаемость поверх игрового поля.

## Правила композиции

- Главное действие и результат видны одновременно: регулятор снижения веса и
  пересчитанный вес. Название предмета находится над ними.
- Акцент обозначает действие или выбор. Большие поверхности нейтральны.
  Зелёный и красный используются для смысла правил, предупреждений и ошибок.
- Рабочая область прокручивается, резюме и действия закреплены. Длинное резюме
  имеет ограниченную высоту и собственную прокрутку.
- Подписи вкладок сохраняются на узком окне. Описания пресетов переносятся;
  длинное название предмета сокращается с полным текстом в подсказке.
- CSS ограничен `.anvil` и классом конкретного окна. Чужие листы не перекрашиваются.

## Компоненты

| Компонент | Контракт |
| --- | --- |
| Регулятор | Числовой ввод и ползунок; результат справа, до 560px — ниже |
| Пресет | Две колонки, до 560px — одна; минимум 72px, высота по содержимому |
| Вкладки | Значок, подпись, выбранная заливка и движущийся маркер |
| Множественный выбор | Чипы, поиск, группы, счётчик; прежнее управление клавиатурой |
| Ошибка | Значок, текст причины и доступное действие исправления |
| Резюме | Текущие правила над кнопками действий |
| Выбор темы | Три кнопки, подсказки, доступные названия, `aria-pressed` |
| Главное действие | Одна акцентная кнопка на окно |
| Подтверждение закрытия | Та же палитра; продолжение выделено, потеря изменений обозначена цветом ошибки |

Состояния: hover — мягкая заливка; pressed — короткое уменьшение;
focus-visible — двухслойное кольцо; disabled — уменьшенная непрозрачность;
read-only — прежние ограничения редактирования, доступные вкладки, тема и закрытие.
Цвет всегда дополняется текстом или значком. Пресетам требуется `height: auto`:
Foundry задаёт стандартным кнопкам фиксированную высоту.

## Движение

Hover и pressed — 140ms, вкладки и выпадающие панели — 220ms,
структурное появление — 360ms. Блик проходит один раз за 1080ms при открытии.
Значок пресета наклоняется на 6° при наведении; числа дают короткий отклик при
изменении. Постоянных пульсаций нет. Сохранение и клики никогда не ждут анимацию.

Структурные части появляются через `@starting-style` с видимым состоянием по
умолчанию. Вся `.window-content` не трансформируется: это меняло бы систему
координат вложенных фиксированных панелей. `prefers-reduced-motion` сокращает
движение до 1ms, обнуляет задержки и убирает декоративные hover-сдвиги.
Существующие JS-анимации тоже учитывают эту настройку.

## Проверка и перенос

`styles/anvil.css` — токены и общие примитивы; `styles/container-rules.css` —
пример компонентов. Ниже приведён полный справочник параметров.

`tools/preview-ui.mjs` компилирует реальные шаблоны на демонстрационных данных
с CSS и значками установленного Foundry. Для запуска нужны Foundry, Playwright
и Microsoft Edge:

```text
node tools/preview-ui.mjs <Foundry resources/app> <runtime node_modules>
```

Стенд создаёт `docs/preview/index.html`, снимки трёх вкладок в двух темах на
ширине 880 и 400px и `checks.json`: геометрия, ручная/автоматическая тема,
уменьшенное движение. Это визуальный стенд, не игровой мир. Сохранение и
интеграции проверяются через `node --test` и ручной сценарий
`tests/manual/foundry-v14-smoke.md` в Foundry.

При использовании в нескольких модулях поставляйте одну согласованную версию
Anvil: разные глобальные определения `.anvil` зависят от порядка загрузки.
Для независимых версий переименуйте корень и keyframes либо выделите общую
зависимость. Параметры конкретного модуля задавайте на его корне:

```css
.my-module.anvil { --p-hue: 152; --p-density: .95; }
```

## Parameter reference

Anvil is one stylesheet, `styles/anvil.css`. It uses the Material 3 role model
(tonal surfaces, colour roles, state layers) with iOS-style translucency and
spring motion over it.

Everything it produces comes out of one block of parameters. Colour comes from a
hue and a chroma multiplier in OKLCH; spacing from a density factor; shape from
a base radius; motion from a duration factor. **Adapting it to another module
means changing numbers in that block.** This document is the reference for those
numbers — not a list of rules to follow.

`styles/container-rules.css` is the worked example. Visual roles use tokens;
geometry, breakpoints and small decorative transforms remain local.

---

## Install

```json
"styles": ["styles/anvil.css", "styles/my-window.css"]
```

```js
static DEFAULT_OPTIONS = { classes: ["my-window", "anvil"] };
```

```js
// in _onRender
this.element.querySelector(".window-content")?.classList.add("anvil-ground");
```

Foundry reads `module.json` at server start, so adding a stylesheet needs a
**server restart**, not F5.

Requires Chromium 123+ for `light-dark()`, `oklch()` and `@starting-style`.
Foundry v13+ ships newer.

---

## The parameters

Everything below lives in the first block of `anvil.css`. Nothing else in the
file is meant to be edited when porting.

### Colour

| Parameter | Default | What it does |
| --- | --- | --- |
| `--p-hue` | `72` | OKLCH angle of the primary. Drives the accent **and** the tint in every neutral surface. |
| `--p-chroma` | `.82` | Multiplies saturation across the whole system at once. |
| `--p-hue-secondary` | `232` | Hue of the informational role. |
| `--p-hue-tertiary` | `152` | Hue of the positive-outcome role. |

Hue angles: `25` red · `72` amber · `110` lime · `152` green · `200` cyan ·
`232` blue · `300` violet · `340` pink.

`--p-chroma` at `0` gives a fully greyscale system that still has correct
contrast; `1.4` is about as loud as stays readable against the neutrals. It
scales the surface tint too, so raising it does not just brighten the buttons —
the whole window warms or cools with it.

The two supporting hues need real distance from the primary. Put secondary
within ~40° of it and "informational" and "primary action" stop reading as
different things.

### Shape

| Parameter | Default | What it does |
| --- | --- | --- |
| `--p-radius` | `14px` | Base radius. Every other radius is a ratio of it. |

```
xs = ×0.28   sm = ×0.5   md = ×0.78   lg = ×1   xl = ×1.55   full = 999px
```

Around `12px` reads as Material; `20px` and above reads as iOS. Because the
scale is proportional, changing this one value keeps small controls and large
containers in the same relationship instead of flattening them together.

### Density

| Parameter | Default | What it does |
| --- | --- | --- |
| `--p-density` | `1` | Multiplies the whole spacing scale (`--a-space-1` … `-10`, 2px → 40px). |

`0.85` for a data-dense window, `1.15` for a settings panel with room to
breathe. It does not touch type size, so text stays readable as the layout
tightens.

### Type

| Parameter | Default | What it does |
| --- | --- | --- |
| `--p-text-base` | `14px` | The `md` step. Everything else is derived. |
| `--p-text-ratio` | `1.15` | Ratio between steps. |
| `--p-font-display` | Palatino Linotype → Book Antiqua → Georgia | Headings, container names. |
| `--p-font-ui` | Segoe UI → system-ui | Body, labels, controls. |
| `--p-font-num` | UI stack with tabular numerals | Any figure a user compares. |

```
xs = base / r²   sm = base / r   md = base   lg = base × r
xl = lg × r      2xl = xl × r²   3xl = 2xl × r²
```

The gaps widen deliberately at the top: a display number should not be one
notch above body text. Raising `--p-text-ratio` past ~1.25 makes `3xl` very
large very fast — check the biggest number in your window before you commit.

Fonts use locally available system stacks with serif/sans-serif fallbacks.
There are no network requests. Exact glyph shapes vary by operating system.

### Motion

| Parameter | Default | What it does |
| --- | --- | --- |
| `--p-motion` | `1` | Multiplies every duration. |

```
instant 70ms · short 140ms · medium 220ms · long 360ms · window 480ms
stagger 48ms  (the gap between items in a cascade)
```

Easings: `--a-ease` (Material emphasized), `--a-ease-decel`, `--a-ease-accel`,
and `--a-spring`, a real spring expressed with `linear()`.

Set `--p-motion` to `0.6` for a snappier window or `1.4` for a slower, heavier
one. Do not set it to `0` to disable motion — `prefers-reduced-motion` already
collapses everything in the system to 1ms, and it is honoured for animations,
transitions and scroll behaviour together.

### Depth

| Parameter | Default | What it does |
| --- | --- | --- |
| `--p-elevation` | `1` | Scales the opacity of all three shadows. |

Depth is carried by the surface ladder first and only confirmed by shadow, so
this stays low. Raise it for a window that has to float over a busy canvas;
drop it toward `0.4` for a window docked against a sidebar.

### Translucency

| Parameter | Default | What it does |
| --- | --- | --- |
| `--p-blur` | `24px` | Backdrop blur on floating material. `0` gives flat opaque panels. |
| `--p-veil` | `0.93` | Opacity of that material. `1` drops translucency entirely. |

Legibility sets the floor on `--p-veil`, not taste. A panel carrying dense text
over a busy window needs roughly `0.9`; below that the content behind reads
straight through the options. Values near `0.8` are for panels that are mostly
chrome.

### Interaction

| Parameter | Default | What it does |
| --- | --- | --- |
| `--p-state-hover` | `.09` | Opacity of the accent wash on hover. |
| `--p-state-focus` | `.12` | Same, on focus. |
| `--p-state-press` | `.16` | Same, on press. |

These three numbers are the entire interaction feel. Material's model is a
translucent wash of the accent laid over a component, rather than a different
background colour per state, which is why one recipe works on a filled button, a
tonal card and a bare list row alike.

---

## Recipes

Complete retunes, as parameter diffs.

**Material-flavoured, cooler, denser**

```css
--p-hue: 258; --p-radius: 12px; --p-density: .9; --p-blur: 0; --p-veil: 1;
```

**iOS-flavoured, softer, roomier**

```css
--p-radius: 24px; --p-density: 1.15; --p-blur: 30px; --p-veil: .88;
--p-elevation: 1.4;
```

**Dense data window**

```css
--p-density: .8; --p-text-base: 12px; --p-radius: 10px; --p-motion: .7;
```

**Quiet utility module that should not compete with the sheet behind it**

```css
--p-chroma: .45; --p-elevation: .5; --p-state-hover: .06;
```

---

## Colour roles

Components reference roles, never values. This is the contract: a component
written against these works in any palette the parameters produce.

| Role | Use |
| --- | --- |
| `--a-primary` / `--a-on-primary` | the one colour that asks for action |
| `--a-primary-container` / `--a-on-primary-container` | tonal fills: chips, selected rows, icon tiles |
| `--a-secondary*` | informational, never a call to action |
| `--a-tertiary*` | positive outcomes — a result, a saving, a pass |
| `--a-error*` | failures and destructive intent |
| `--a-surface` `-lowest` `-low` `-high` `-highest` | the tonal ladder; higher means nearer the viewer |
| `--a-on-surface` / `--a-on-surface-variant` | body text and secondary text |
| `--a-outline` / `--a-outline-variant` | borders that must be seen, and hairlines |
| `--a-state-hover` `-focus` `-press` | the interaction washes |
| `--a-material` / `--a-scrim` | floating panel fill, and the dim behind a modal |

Two things worth knowing before you use them:

- **A container role is a background, not an accent.** Washing a whole band in
  `primary-container` turns the accent into the thing it was supposed to stand
  out from — and at amber hues in a dark theme it simply reads brown. Put a
  neutral surface down and let the accent sit on it.
- **`surface-*` is a ladder, not a set of alternatives.** Pick by how near the
  element should feel, not by which shade you like.

---

## Theme

Every colour is declared once, with `light-dark()`. Which half applies is
decided by one property, `color-scheme`. There is no second palette, so light
and dark cannot drift apart.

Priority, lowest to highest:

| Source | Mechanism |
| --- | --- |
| operating system | `color-scheme: light dark` on `.anvil` |
| Foundry's theme | `body.theme-light` / `body.theme-dark` |
| the module's override | `[data-av-theme]` on the window root |

The override is an attribute on the element, so it beats the body class
whichever way that class points.

```js
applyAnvilTheme() {
  const theme = game.settings.get(MODULE_ID, "theme");   // auto | light | dark
  if (theme === "light" || theme === "dark") this.element.dataset.avTheme = theme;
  else delete this.element.dataset.avTheme;
}
```

`auto` **removes** the attribute rather than setting it to `"auto"`. With no
attribute the CSS falls through to Foundry and then to the OS on its own, so a
window left on `auto` follows a theme change underneath it with no JS involved.

`light-dark()` accepts colours only. Keep geometry identical between themes;
the two palettes should not cause layout shifts. The module's confirmation
dialog uses the same client setting and receives live theme updates too.

---

## Primitives

Use them, or compose the same thing from roles. Both are fine — the roles are
the contract, the primitives are a convenience.

| Class | What it is |
| --- | --- |
| `.anvil-ground` | window ground: ambient accent tint from a single light source |
| `.anvil-material` | translucent blurred panel with the inner edge highlight |
| `.anvil-scroll` | scrollbars in the palette; put it on **every** scroller, popovers included |
| `.anvil-interactive` | adds the hover/press state layer to any element |
| `.anvil-card` | the standard raised surface |

Motion keyframes: `a-rise`, `a-pop`, `a-drop`, `a-slide`, `a-sheen`.

### Entry motion has a failure mode worth knowing

A keyframe animation with `animation-fill-mode: both` holds its element at
`opacity: 0` until it runs. A window rendered while its tab is not compositing
therefore stays **blank**, and stays blank until the browser gets around to it.

For anything structural, run entry as a transition out of `@starting-style`
instead. The resting state is then the final state, so if the transition never
runs the content is simply there:

```css
.my-panel {
  opacity: 1; transform: none;
  transition: opacity var(--a-dur-long) var(--a-ease-decel),
              transform var(--a-dur-long) var(--a-ease-decel);
}
@starting-style {
  .my-panel { opacity: 0; transform: translateY(10px); }
}
```

Keyframe animations are still right for elements that genuinely mount later — a
pane appearing on a tab switch, a dropdown, a notice.

---

## What is not parameterised

Deliberately, because making these adjustable makes windows inconsistent rather
than adaptable:

- The **role names**. Components depend on them.
- The **shape and space ratios**. Only their bases move.
- The **state-layer mechanism**. Only its three opacities move.
- The **reduced-motion collapse**. It is unconditional.

---

## Porting checklist

- [ ] `anvil.css` listed before your stylesheet; server restarted
- [ ] `anvil` on the root class list, `anvil-ground` on the window body
- [ ] `--p-hue`, `--p-chroma`, `--p-radius` set for the module
- [ ] `anvil-scroll` on every scroller, including popovers
- [ ] Structural entry via `@starting-style`, not filled keyframes
- [ ] Layout in container queries — Foundry windows resize, and a narrow window
      on a wide screen is the normal case
- [ ] Any window frame you repaint gets its **text** colour too: Foundry paints
      `.window-title` light for its own dark frame, and it disappears against a
      light surface
- [ ] Checked in light, in dark, and with the override pinned both ways
- [ ] Checked with `prefers-reduced-motion: reduce`

### Grafting onto someone else's sheet

Anything you inject into a system's own sheet — a button in a dnd5e item header,
say — sits outside any `.anvil` root, so no role reaches it. Have it inherit the
host's colour through `currentColor` rather than imposing your palette on a
window you do not own. `.wc-inline-gear` in `container-rules.css` is that case,
and it is the only place in the module with literal values.
