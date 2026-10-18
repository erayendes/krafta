<div align="center">

# krafta

**Check, audit and scan interfaces against explicit design rules.**<br>
A CI gate and an agent review in one package.

[![CI](https://github.com/erayendes/krafta/actions/workflows/ci.yml/badge.svg)](https://github.com/erayendes/krafta/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/krafta?color=cb3837&logo=npm)](https://www.npmjs.com/package/krafta)
[![Node.js](https://img.shields.io/node/v/krafta?logo=node.js&logoColor=white)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Yerli üretim](https://img.shields.io/badge/%F0%9F%A4%9D-YERL%C4%B0%20%C3%9CRET%C4%B0M-red)](https://github.com/erayendes)

🇬🇧 [English](#english) · 🇹🇷 [Türkçe](#türkçe)

</div>

## English

> **Why "krafta"?** It is *crafter* in Belter Creole, the language of the Belt in *The Expanse*. Belters turn a final "-er" into "-a" (Belter → Belta), so a crafter becomes a *krafta*: someone who makes things by hand, with care. That is the bar this tool holds an interface to.

- [What it does](#what-it-does) · [Install](#install) · [Use](#use) · [What it checks](#what-it-checks) · [Config](#config) · [Mark layout elements](#mark-layout-elements)
- [Agent skill](#agent-skill) · [Playwright](#playwright) · [CI](#ci) · [API](#api) · [Limits](#limits) · [Development](#development) · [Credits and license](#credits-and-license)

### What it does

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

For a page that loads asynchronously, add `--ready '[data-app-ready]'` to `check` or `--wait-for` to `audit`. For signed-in pages, pass a Playwright storage state with `--storage-state auth.json`. Run `npx krafta --help` for every option.

### What it checks

**The gate (`krafta check`)** runs these rules at each configured viewport and theme. Any rule can be excepted for a selector, with a reason.

| Area | Rules |
| --- | --- |
| Type | `font-family`, `font-size`, `font-loading`, `tabular-numbers`, `numeric-alignment` |
| Controls | `control-size`, `control-gap`, `control-inset`, `target-size`, `control-state`, `icon-button-tooltip` |
| Layout | `layout-gap`, `layout-alignment`, `nested-radius`, `horizontal-overflow`, `viewport-bounds`, `content-clipping`, `content-overflow`, `root-background` |
| Contrast | `text-contrast` (text and SVG, per theme) |
| Accessibility | `accessible-name`, `form-label`, `aria-reference`, `label-consistency`, `keyboard-operation`, `focus-visible`, `focus-obscured`, `dialog-focus`, plus [axe-core](https://github.com/dequelabs/axe-core) |
| Copy | `copy` (phrases you ban, such as "seamlessly") |

**The audit (`krafta audit`)** writes `krafta-audit/report.md` and, for each viewport and theme, `viewport.png`, `full.png`, `annotated.png` and `tiles/`. The same pass runs the gate rules, so the report starts with what will fail CI. After that come the leads: covered controls, overlapping and clipped text, near-miss alignment, uneven gaps, unequal cards, focus problems, layout shift, broken images, generic-look tells, and a token inventory. Leads are measurements to confirm, not verdicts. Use `--no-gate` to skip the gate rules. `--stress` adds runs with about 40% longer Turkish text and with doubled text size, and lists what breaks only under stress.

**The scan (`krafta scan`)** reads source without running it:

| Scanner | Finds |
| --- | --- |
| `theme` | Fixed colors and backgrounds that ignore dark mode, light/dark mixes, missing dark assets or `values-night`, Tailwind classes without a `dark:` pair, missing `color-scheme` |
| `tokens` | Off-grid spacing, one-off font sizes and radii, too many distinct values, fixed sizes that ignore Dynamic Type |
| `hit-area` | Small tap targets, overlays that catch taps, tap catchers, clipped overflow |

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
- The full schema is in [schema/krafta.config.schema.json](schema/krafta.config.schema.json).

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

Bug reports, wrong findings and ideas are welcome. Read [CONTRIBUTING](.github/CONTRIBUTING.md) first; report security issues privately as described in [SECURITY](.github/SECURITY.md). Changes are listed in the [CHANGELOG](CHANGELOG.md).

### Credits and license

MIT © [Eray Endeş](https://github.com/erayendes). krafta adapts [lintapple](https://github.com/gholtzap/lintapple) (MIT, © Gavin Holtzapple) and [interface-craft](https://github.com/harun-yardimci/interface-craft) (MIT, © Harun Yardimci), and the works interface-craft builds on. See [NOTICE](NOTICE).

---

## Türkçe

**Arayüzleri açık tasarım kurallarına göre denetler, inceler ve tarar.** CI kapısı ile ajan incelemesini tek pakette birleştirir.

> **Neden "krafta"?** *The Expanse* evrenindeki Kuşak halkının dili Belter Creole'de *crafter* demektir. Belter'lar kelime sonundaki "-er"i "-a" yapar (Belter → Belta). Böylece crafter, *krafta* olur: işini elle ve özenle yapan kişi. Bu araç da arayüzü o özenle ölçer.

- [Ne yapar](#ne-yapar) · [Kurulum](#kurulum) · [Kullanım](#kullanım) · [Neleri denetler](#neleri-denetler) · [Yapılandırma](#yapılandırma) · [Düzen öğelerini işaretleme](#düzen-öğelerini-işaretleme)
- [Ajan skill'i](#ajan-skilli) · [Playwright](#playwright-1) · [CI](#ci-1) · [API](#api-1) · [Sınırlar](#sınırlar) · [Geliştirme](#geliştirme) · [Teşekkür ve lisans](#teşekkür-ve-lisans)

### Ne yapar

krafta iki açık kaynak projeyi bir araya getirir:

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

Başka sayfa ve dosyalar:

```sh
npx krafta check http://localhost:3000/settings --json
npx krafta audit design/mockup.html --viewports 375x812,1440x900 --themes light,dark
npx krafta audit http://localhost:3000/invoices --states empty,loading,error
npx krafta tile screenshot.png       # ekran görüntüsünü yakınlaştırılmış karolara böler
```

Geç yüklenen sayfalar için `check` komutuna `--ready '[data-app-ready]'`, `audit` komutuna `--wait-for` ekleyin. Oturum açılmış sayfalar için `--storage-state auth.json` ile bir Playwright storage state verin. Tüm seçenekler için `npx krafta --help` çalıştırın.

### Neleri denetler

**Kapı (`krafta check`)** aşağıdaki kuralları yapılandırılan her ekran boyutu ve temada çalıştırır. Her kural bir seçici için gerekçe yazılarak istisna tutulabilir.

| Alan | Kurallar |
| --- | --- |
| Yazı | `font-family`, `font-size`, `font-loading`, `tabular-numbers`, `numeric-alignment` |
| Kontroller | `control-size`, `control-gap`, `control-inset`, `target-size`, `control-state`, `icon-button-tooltip` |
| Düzen | `layout-gap`, `layout-alignment`, `nested-radius`, `horizontal-overflow`, `viewport-bounds`, `content-clipping`, `content-overflow`, `root-background` |
| Kontrast | `text-contrast` (metin ve SVG, her tema için) |
| Erişilebilirlik | `accessible-name`, `form-label`, `aria-reference`, `label-consistency`, `keyboard-operation`, `focus-visible`, `focus-obscured`, `dialog-focus` ve [axe-core](https://github.com/dequelabs/axe-core) |
| Metin | `copy` (yasakladığınız ifadeler, örneğin "seamlessly") |

**İnceleme (`krafta audit`)** `krafta-audit/report.md` dosyasını ve her ekran boyutu ile tema için `viewport.png`, `full.png`, `annotated.png` ve `tiles/` çıktısını yazar. Kapı kurallarını aynı geçişte çalıştırır, bu yüzden rapor CI'ı kıracak bulgularla başlar. Ardından ipuçları gelir: örtülen kontroller, üst üste binen veya kesilen metin, birkaç piksellik hizalama kaymaları, eşit olmayan boşluklar ve kartlar, odak sorunları, düzen kayması, bozuk görseller, "jenerik görünüm" işaretleri ve token envanteri. İpuçları doğrulanması gereken ölçümlerdir, hüküm değildir. Kapı kurallarını atlamak için `--no-gate` kullanın. `--stress` seçeneği metinleri Türkçe karakterlerle yaklaşık %40 uzatır, yazı boyutunu iki katına çıkarır ve yalnızca bu koşullarda bozulan yerleri listeler.

**Tarama (`krafta scan`)** kaynak kodu çalıştırmadan okur:

| Tarayıcı | Bulduğu |
| --- | --- |
| `theme` | Dark mode'u yok sayan sabit renk ve arka planlar, açık/koyu tema karışımları, eksik koyu görseller veya `values-night`, `dark:` eşi olmayan Tailwind sınıfları, eksik `color-scheme` |
| `tokens` | Izgara dışı boşluklar, bir kez kullanılan yazı boyutu ve yarıçaplar, fazla sayıda farklı değer, Dynamic Type ile büyümeyen sabit boyutlar |
| `hit-area` | Küçük dokunma alanları, dokunmayı yutan katmanlar, tıklama tuzakları, kesilen taşmalar |

### Yapılandırma

Örnek için yukarıdaki [Config](#config) bölümüne bakın. Önemli noktalar:

- `theme`, uygulamanın temayı nasıl değiştirdiğini söyler: `media` (prefers-color-scheme, varsayılan), `class` veya `attribute` (`{ "strategy": "attribute", "name": "data-theme", "dark": "dark", "light": "light" }`).
- Her istisna bir gerekçe ister. Kaynak kodda bir tarama bulgusu, aynı satırda veya bir üst satırda şöyle hariç tutulabilir: `// krafta-ignore theme/fixed-bg: marka bandı beyaz yazıyı bilerek kullanıyor`. Gerekçesiz yorum hiçbir şeyi hariç tutmaz.
- lintapple'ın `ui-policy.json` dosyası olduğu gibi çalışır: `krafta.config.json` yoksa krafta onu `check` bölümü olarak okur.
- Şemanın tamamı [schema/krafta.config.schema.json](schema/krafta.config.schema.json) dosyasında.

### Düzen öğelerini işaretleme

Font, kontrast, kontrol boyutu ve ekran sınırı denetimleri ek işaretleme olmadan çalışır. Düzen niyeti gerektiren denetimler için şu nitelikleri ekleyin:

| Nitelik | Nerede kullanılır |
| --- | --- |
| `data-ui-stack` | Alt öğeleri arasındaki boşluk denetlenecek grup. |
| `data-ui-actions` | Aradaki boşlukları denetlenecek buton grubu. |
| `data-ui-container` | Buton iç boşlukları denetlenecek yüzey. |
| `data-ui-number` | Rakam genişlikleri eşit olması gereken, değişen sayı. |
| `data-ui-content` | Metni kenarlarının içinde kalması gereken kap. |
| `data-ui-align="start"` | İşaretli öğeleri hizalı olması gereken grup. Diğer hizalamalar için `center` veya `end`. |
| `data-ui-align-item` | Hizalama grubunda karşılaştırılacak her öğe. |
| `data-ui-radius` | Köşe yarıçapları ve iç boşlukları eşit olan dış yüzey. |
| `data-ui-radius-inner` | Doğrudan içindeki yüzey. Yarıçapı, dış yarıçap eksi iç boşluğa eşit olmalı. |

[Örnek stillere](examples/ui.css) bakın. Tıklamayla açılan durumlar (menüler, diyaloglar, form hataları) `krafta check --interactions plan.json` ile denetlenir; ayrıntılar [kapı referansında](skills/krafta/references/gate.md#states-behind-clicks).

### Ajan skill'i

Skill, kodlama ajanına hangi komutu ne zaman çalıştıracağını, raporu nasıl okuyacağını ve arayüzü nasıl inceleyip düzelteceğini anlatır: görev akışı, mikro metin, durumlar, erişilebilirlik, tema, dayanıklı düzen ve görsel işçilik. Ajana politikayı değil arayüzü düzeltmesini de söyler.

- Claude Code eklentisi: `/plugin marketplace add erayendes/krafta`, ardından `/plugin install krafta@krafta`.
- Tek bir projeye: `npx krafta skill` (`.claude/skills/krafta` klasörüne kopyalar) veya `npx krafta init --skill`.
- Codex ve diğer ajanlar: `skills/krafta` klasörünü ajanın skill klasörüne kopyalayın. `skills/krafta/agents/openai.yaml` dosyası onu Codex'e tanıtır.

Sonra örneğin şunu isteyin: "ödeme ekranını incele", "dark mode'u kontrol et", "kartlar aynı boyda değil".

### Playwright

Var olan bir testte, sayfa denetlenecek duruma geldikten sonra şunu ekleyin:

```ts
import { expectUI } from 'krafta/playwright';

await expectUI(page, testInfo);
```

Bulgular testi düşürür ve bir JSON raporu ekler. Yardımcı fonksiyon `krafta.config.json` dosyasını okur. [Örnek testlere](examples/playwright/) bakın.

### CI

```yaml
- run: npm ci
- run: npx playwright install --with-deps chromium
- run: npm run build && (npm start &)   # uygulamanızı başlatın
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

### Sınırlar

krafta görsel kaliteyi, doğru ifadeyi veya test kapsamını kanıtlayamaz. Audit ve scan bulguları doğrulanması gereken ipuçlarıdır. Hangi sayfa, durum ve temaları kontrol ettiğinizi belirtin.

### Geliştirme

Tüm kaynak kod, testler ve örnekler strict TypeScript kullanır.

```sh
npm ci
npm run typecheck
npm test
npm run test:playwright
```

Hata bildirimleri, yanlış bulgular ve fikirler memnuniyetle karşılanır. Önce [CONTRIBUTING](.github/CONTRIBUTING.md) dosyasını okuyun; güvenlik sorunlarını [SECURITY](.github/SECURITY.md) dosyasında anlatıldığı gibi özel olarak bildirin. Değişiklikler [CHANGELOG](CHANGELOG.md) dosyasında.

### Teşekkür ve lisans

MIT © [Eray Endeş](https://github.com/erayendes). krafta, [lintapple](https://github.com/gholtzap/lintapple) (MIT, © Gavin Holtzapple) ve [interface-craft](https://github.com/harun-yardimci/interface-craft) (MIT, © Harun Yardimci) projelerinden ve interface-craft'ın dayandığı çalışmalardan uyarlanmıştır. Ayrıntılar için [NOTICE](NOTICE).
