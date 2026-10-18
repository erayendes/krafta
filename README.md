# krafta

Check, audit and scan interfaces against explicit design rules. A CI gate and an agent review in one package.

[![Yerli üretim](https://img.shields.io/badge/%F0%9F%A4%9D-YERL%C4%B0%20%C3%9CRET%C4%B0M-red)](https://github.com/erayendes)

🇬🇧 [English](#english) · 🇹🇷 [Türkçe](#türkçe)

## English

krafta combines two open-source projects:

- [lintapple](https://github.com/gholtzap/lintapple) measures a rendered page against a design policy and passes or fails. It is a good CI gate, but it sees only what it can measure.
- [interface-craft](https://github.com/harun-yardimci/interface-craft) teaches a coding agent to review an interface like a product designer and measures the page to find leads. It sees more, but its result depends on the agent.

krafta keeps both strengths and joins them: one config, one browser pass, one report, one agent skill.

| Command | Question it answers | Result |
| --- | --- | --- |
| `krafta check` | Does the page follow our design policy? | Pass or fail. Exit 0, 1 or 2. Use it in CI. |
| `krafta audit` | What does the rendered page get wrong that a glance misses? | `report.md`, screenshots, an annotated screenshot and zoomed tiles. Gate findings come first. |
| `krafta scan` | Where in the source are the theme mixes, token drift and hit-area bugs? | File and line leads for SwiftUI, Compose, Android XML, CSS and Tailwind. |

### Install

Requires Node.js 22 or later. In your app's project directory:

```sh
npm install -D krafta && npx krafta init
```

This creates `krafta.config.json` and the `lint:ui`, `audit:ui` and `scan:ui` scripts. Existing files and scripts are kept. Set the fonts, text sizes and app `url` in `krafta.config.json`. The first browser run downloads Chromium; set `CHROME_PATH` to use an installed Chrome or Edge instead.

### Use

Start your app, then:

```sh
npm run lint:ui                      # krafta check: the gate
npx krafta audit --stress            # the review, with long-text and large-text runs
npx krafta scan src                  # the source scan
```

Each gate finding has the rule, element, measured value and a fix. Exit codes: `0` passed, `1` findings, `2` the command did not finish.

Other pages and files:

```sh
npx krafta check http://localhost:3000/settings --json
npx krafta audit design/mockup.html --viewports 375x812,1440x900 --themes light,dark
npx krafta audit http://localhost:3000/invoices --states empty,loading,error
npx krafta tile screenshot.png       # cut a screenshot into zoomed tiles
```

For a page that loads asynchronously, add `--ready '[data-app-ready]'` to `check` or `--wait-for` to `audit`. For signed-in pages, pass a Playwright storage state with `--storage-state auth.json`.

### The audit report

`krafta audit` writes `krafta-audit/report.md` and, for each viewport and theme, `viewport.png`, `full.png`, `annotated.png` and `tiles/`. The same pass runs the gate rules, so the report starts with what will fail CI. After that come the leads: covered controls, overlapping and clipped text, near-miss alignment, uneven gaps, unequal cards, focus problems, layout shift, broken images, generic-look tells, and a token inventory. Leads are measurements to confirm, not verdicts. Use `--no-gate` to skip the gate rules.

`--stress` adds runs with about 40% longer Turkish text and with doubled text size, and lists what breaks only under stress.

### Config

```json
{
  "$schema": "./node_modules/krafta/schema/krafta.config.schema.json",
  "url": "http://localhost:3000",
  "theme": { "strategy": "class", "name": "dark" },
  "check": {
    "fonts": ["Inter", "system-ui"],
    "fontSizes": [12, 14, 16, 20, 24, 32],
    "colorSchemes": ["light", "dark"],
    "exceptions": [{ "selector": ".legal", "rules": ["font-size"], "reason": "Legal text uses the contract size." }]
  },
  "audit": { "themes": ["light", "dark"], "stress": true },
  "scan": {
    "paths": ["src", "ios", "android"],
    "failOn": "high",
    "exceptions": [{ "path": "src/brand/**", "rules": ["theme/fixed-bg"], "reason": "Brand banner keeps white text." }]
  }
}
```

- `theme` tells krafta how the app switches themes: `media` (prefers-color-scheme, the default), `class`, or `attribute` (`{ "strategy": "attribute", "name": "data-theme", "dark": "dark", "light": "light" }`).
- Every exception needs a reason. In source, a scan hit can also be excluded on its line or the line above: `// krafta-ignore theme/fixed-bg: brand banner keeps white text`. An ignore without a reason does nothing.
- A lintapple `ui-policy.json` works as is: without `krafta.config.json`, krafta reads it as the `check` section.

### Mark layout elements

Font, contrast, control size and screen bounds checks work without extra markup. Add these attributes for checks that need layout intent:

| Attribute | Use on |
| --- | --- |
| `data-ui-stack` | A group whose child spacing must be checked. |
| `data-ui-actions` | A button group whose gaps must be checked. |
| `data-ui-container` | A surface whose button insets must be checked. |
| `data-ui-number` | A changing number that needs equal digit widths. |
| `data-ui-content` | A container whose text must stay inside its edges. |
| `data-ui-align="start"` | A group whose marked elements must align. Use `center` or `end` for other alignments. |
| `data-ui-align-item` | Each element to compare in an alignment group. |
| `data-ui-radius` | An outer surface with equal corner radii and insets. |
| `data-ui-radius-inner` | Its direct inner surface. Its radius must equal the outer radius minus the inset. |

See the [example styles](examples/ui.css). States behind clicks (menus, dialogs, form errors) are checked with `krafta check --interactions plan.json`; see [the gate reference](skills/krafta/references/gate.md#states-behind-clicks).

### Agent skill

The skill tells a coding agent when to run each command, how to read the report, and how to review and fix an interface: task flow, microcopy, states, accessibility, theming, layout resilience and visual craft. It also tells the agent to fix the interface, not the policy.

- Claude Code plugin: `/plugin marketplace add erayendes/krafta`, then `/plugin install krafta@krafta`.
- Into one project: `npx krafta skill` (copies it to `.claude/skills/krafta`), or `npx krafta init --skill`.
- Codex and other agents: copy `skills/krafta` into the agent's skills folder. `skills/krafta/agents/openai.yaml` describes it for Codex.

Then ask, for example: "review the checkout screen", "check dark mode", "the cards have different heights".

### Playwright

Add this to an existing test after the page reaches the state to check:

```ts
import { expectUI } from 'krafta/playwright';

await expectUI(page, testInfo);
```

Findings fail the test and attach a JSON report. The helper reads `krafta.config.json`. See the [example tests](examples/playwright/).

### CI

```yaml
- run: npm ci
- run: npx playwright install --with-deps chromium
- run: npm run build && (npm start &)   # start your app
- run: npx krafta check
- run: npx krafta scan --fail-on high
```

### API

```ts
import { checkUrl, auditUrl, scanPath, loadConfig } from 'krafta';

const config = await loadConfig();
const gate = await checkUrl('http://localhost:3000', config.check, { theme: config.theme });
const review = await auditUrl('http://localhost:3000', { ...config.audit, policy: config.check, theme: config.theme });
const source = await scanPath(process.cwd(), config.scan);
```

### Limits

krafta cannot prove visual quality, correct wording or test coverage. Audit and scan hits are leads to confirm. Say which routes, states and themes you checked.

### Development

All source, tests and examples use strict TypeScript.

```sh
npm ci
npm run typecheck
npm test
npm run test:playwright
```

### Credits and license

MIT © [Eray Endeş](https://github.com/erayendes). krafta adapts [lintapple](https://github.com/gholtzap/lintapple) (MIT, © Gavin Holtzapple) and [interface-craft](https://github.com/harun-yardimci/interface-craft) (MIT, © Harun Yardimci), and the works interface-craft builds on. See [NOTICE](NOTICE).

---

## Türkçe

krafta, arayüzleri açık tasarım kurallarına göre denetler, inceler ve tarar. CI kapısı ile ajan incelemesini tek pakette birleştirir.

İki açık kaynak projeyi bir araya getirir:

- [lintapple](https://github.com/gholtzap/lintapple), çizilmiş sayfayı bir tasarım politikasına göre ölçer ve geçti/kaldı sonucu verir. İyi bir CI kapısıdır ama yalnızca ölçebildiğini görür.
- [interface-craft](https://github.com/harun-yardimci/interface-craft), kodlama ajanına arayüzü bir ürün tasarımcısı gibi incelemeyi öğretir ve ipuçları bulmak için sayfayı ölçer. Daha fazlasını görür ama sonucu ajana bağlıdır.

krafta ikisinin de güçlü yanını korur ve birleştirir: tek yapılandırma, tek tarayıcı geçişi, tek rapor, tek ajan skill'i.

| Komut | Yanıtladığı soru | Sonuç |
| --- | --- | --- |
| `krafta check` | Sayfa tasarım politikamıza uyuyor mu? | Geçti ya da kaldı. Çıkış kodu 0, 1 veya 2. CI'da kullanın. |
| `krafta audit` | Çizilen sayfada göz atınca kaçan neler var? | `report.md`, ekran görüntüleri, numaralı ekran görüntüsü ve yakınlaştırılmış karolar. Kapı bulguları en üstte. |
| `krafta scan` | Kaynak kodda tema karışıklıkları, token sapmaları ve dokunma alanı hataları nerede? | SwiftUI, Compose, Android XML, CSS ve Tailwind için dosya ve satır ipuçları. |

### Kurulum

Node.js 22 veya üstü gerekir. Uygulamanızın proje klasöründe:

```sh
npm install -D krafta && npx krafta init
```

Bu komut `krafta.config.json` dosyasını ve `lint:ui`, `audit:ui`, `scan:ui` scriptlerini oluşturur. Var olan dosya ve scriptlere dokunmaz. `krafta.config.json` içinde fontları, yazı boyutlarını ve uygulama `url`'sini ayarlayın. İlk tarayıcı çalıştırması Chromium indirir. Kurulu Chrome veya Edge kullanmak için `CHROME_PATH` ayarlayın.

### Kullanım

Uygulamanızı başlatın, sonra:

```sh
npm run lint:ui                      # krafta check: kapı
npx krafta audit --stress            # inceleme, uzun metin ve büyük yazı denemeleriyle
npx krafta scan src                  # kaynak kod taraması
```

Her kapı bulgusu kuralı, öğeyi, ölçülen değeri ve düzeltmeyi içerir. Çıkış kodları: `0` geçti, `1` bulgu var, `2` komut tamamlanamadı.

`krafta audit`, kapı kurallarını aynı geçişte çalıştırır. Bu yüzden rapor CI'ı kıracak bulgularla başlar. Ardından ipuçları gelir: örtülen kontroller, üst üste binen veya kesilen metin, birkaç piksellik hizalama kaymaları, eşit olmayan boşluklar ve kartlar, odak sorunları, düzen kayması, bozuk görseller, "jenerik görünüm" işaretleri ve token envanteri. İpuçları doğrulanması gereken ölçümlerdir, hüküm değildir. `--stress` seçeneği metinleri Türkçe karakterlerle yaklaşık %40 uzatır, yazı boyutunu iki katına çıkarır ve yalnızca bu koşullarda bozulan yerleri listeler.

### Yapılandırma

Örnek için yukarıdaki [Config](#config) bölümüne bakın. Önemli noktalar:

- `theme`, uygulamanın temayı nasıl değiştirdiğini söyler: `media` (varsayılan), `class` veya `attribute`.
- Her istisna bir gerekçe ister. Kaynak kodda bir tarama bulgusu, aynı satırda veya bir üst satırda şöyle hariç tutulabilir: `// krafta-ignore theme/fixed-bg: marka bandı beyaz yazıyı bilerek kullanıyor`. Gerekçesiz yorum hiçbir şeyi hariç tutmaz.
- lintapple'ın `ui-policy.json` dosyası olduğu gibi çalışır: `krafta.config.json` yoksa krafta onu `check` bölümü olarak okur.

### Ajan skill'i

Skill, kodlama ajanına hangi komutu ne zaman çalıştıracağını, raporu nasıl okuyacağını ve arayüzü nasıl inceleyip düzelteceğini anlatır: görev akışı, mikro metin, durumlar, erişilebilirlik, tema, dayanıklı düzen ve görsel işçilik. Ajana politikayı değil arayüzü düzeltmesini de söyler.

- Claude Code eklentisi: `/plugin marketplace add erayendes/krafta`, ardından `/plugin install krafta@krafta`.
- Tek bir projeye: `npx krafta skill` (`.claude/skills/krafta` klasörüne kopyalar) veya `npx krafta init --skill`.
- Codex ve diğer ajanlar: `skills/krafta` klasörünü ajanın skill klasörüne kopyalayın.

Sonra örneğin şunu isteyin: "ödeme ekranını incele", "dark mode'u kontrol et", "kartlar aynı boyda değil".

### Playwright ve CI

Playwright testlerinde `import { expectUI } from 'krafta/playwright'` ile sayfayı istediğiniz durumda denetleyin. CI'da uygulamayı başlattıktan sonra `npx krafta check` ve `npx krafta scan --fail-on high` çalıştırın.

### Sınırlar

krafta görsel kaliteyi, doğru ifadeyi veya test kapsamını kanıtlayamaz. Audit ve scan bulguları doğrulanması gereken ipuçlarıdır. Hangi sayfa, durum ve temaları kontrol ettiğinizi belirtin.

### Lisans

MIT © [Eray Endeş](https://github.com/erayendes). krafta, [lintapple](https://github.com/gholtzap/lintapple) (MIT, © Gavin Holtzapple) ve [interface-craft](https://github.com/harun-yardimci/interface-craft) (MIT, © Harun Yardimci) projelerinden ve interface-craft'ın dayandığı çalışmalardan uyarlanmıştır. Ayrıntılar için [NOTICE](NOTICE).
