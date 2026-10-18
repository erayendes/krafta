# Gate: the design policy that fails CI

`krafta check` loads the page at each viewport and theme in `check.viewports` and `check.colorSchemes`, measures the rendered result, and compares it with the policy in `krafta.config.json`. It passes or fails. `krafta audit` runs the same rules in its own pass and lists them first in `report.md`.

## Rules for agents
- Run `npx krafta check` on each changed route and relevant state. A nonzero exit code means the check has not passed.
- Fix the interface. Do not change the policy, add exceptions, or remove `data-ui-*` attributes just to make a check pass. A design-policy change needs a user request.
- Unresolved contrast findings require review; they are not passes. Check placeholders and color changes on hover and focus.
- Keep elements and text within the horizontal viewport. Fixed elements and open dialogs must also fit vertically. Let long text wrap or use a local scroll region. Do not hide overflow to conceal a layout error.
- The gate cannot prove visual quality, correct wording, or test coverage. State which routes and states you checked.

## Policy (`check` in krafta.config.json)

| Field | Meaning |
| --- | --- |
| `fonts` | Approved font families. The first family in the computed `font-family` must be one of them. Code, pre, kbd and samp are exempt. |
| `fontSizes` | Approved text sizes in px. |
| `typeRules` | Sizes for a role, for example `{ "selector": "h1", "sizes": [24, 32] }`. The first rule whose selector matches the element or one of its ancestors applies. |
| `minControlSize`, `controlSizeRules` | Minimum button size, optionally per selector and viewport width. |
| `minControlGap` | Minimum gap between buttons in one group (`data-ui-actions` or the same parent). |
| `minControlInset`, `controlContainers` | Minimum distance from a button to the inner edge of its container. |
| `minLayoutGap` | Minimum gap between the children of a `data-ui-stack`. |
| `bannedCopy` | Phrases that must not appear in visible text. |
| `viewports`, `colorSchemes` | Where the gate runs. Add `"dark"` to `colorSchemes` when the product has a dark theme. |
| `exceptions` | `{ "selector", "rules", "reason" }`. A reason is required. Excluded findings are listed in the JSON report. |

If the app switches themes with a class or attribute on `<html>`, set the top-level `theme` field: `{ "strategy": "class", "name": "dark" }` or `{ "strategy": "attribute", "name": "data-theme", "dark": "dark", "light": "light" }`.

A lintapple `ui-policy.json` also works: krafta reads it as the `check` section when there is no `krafta.config.json`.

## Contract attributes
Font, contrast, control size and screen bounds work without markup. These attributes turn on checks that need layout intent:

| Attribute | Use on |
| --- | --- |
| `data-ui-stack` | A group whose child spacing must be checked. |
| `data-ui-actions` | A button group whose gaps must be checked. |
| `data-ui-container` | A surface whose button insets must be checked. |
| `data-ui-number` | A changing number that needs equal digit widths (`font-variant-numeric: tabular-nums`). Numeric table cells are checked automatically. |
| `data-ui-content` | A container whose text must stay inside its edges. |
| `data-ui-align="start"` | A group whose marked elements must align. Use `center` or `end` for other alignments. |
| `data-ui-align-item` | Each element to compare in an alignment group. |
| `data-ui-radius` | An outer surface with equal corner radii and insets. |
| `data-ui-radius-inner` | Its direct inner surface. Its radius must equal the outer radius minus the inset. |
| `data-ui-disclosure` | A button that shows and hides a panel. It needs `aria-expanded` and `aria-controls`. |
| `data-ui-tooltip` | The ID of the text tooltip for a button without a visible label. |

## Rule IDs
Design: `font-family`, `font-size`, `copy`, `control-size`, `control-gap`, `control-inset`, `layout-gap`, `layout-alignment`, `tabular-numbers`, `numeric-alignment`, `nested-radius`, `root-background`, `horizontal-overflow`, `viewport-bounds`, `content-clipping`, `content-overflow`, `text-contrast`, `font-loading`, `icon-button-tooltip`.
Accessibility: `accessible-name`, `form-label`, `aria-reference`, `label-consistency`, `control-state`, `keyboard-operation`, `focus-visible`, `focus-obscured`, `dialog-focus`, `target-size`.

## States behind clicks
The gate checks the page as it loads. For a menu, a dialog, a form error or a saved result, pass an interaction plan:

```json
{
  "states": [
    { "name": "Dialog open", "action": "click", "selector": "#edit", "ready": { "selector": "#editor" } },
    { "name": "Form error", "action": "click", "selector": "#save", "ready": { "selector": "#error", "expectedText": "Enter a project name." } }
  ],
  "focus": [{ "selector": "#save" }],
  "dialogs": [{ "open": "#edit", "dialog": "#editor", "close": "#cancel", "returnFocus": "#edit" }]
}
```

```bash
npx krafta check http://localhost:3000/projects --interactions plan.json
```

Plans can also test `buttons` (Enter and Space), `tooltips`, `tabs` and `menus` with arrow keys. Each state is checked with every page rule.

## In Playwright tests
After the test reaches the state (signed in, dialog open, error shown):

```ts
import { expectUI } from 'krafta/playwright';

await expectUI(page, testInfo);
```

Findings fail the test and attach a JSON report. The helper reads `krafta.config.json`.

## In CI
Start the app in the background first, then:

```yaml
- run: npx playwright install --with-deps chromium
- run: npx krafta check
- run: npx krafta scan --fail-on high
```
