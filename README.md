# مترجم IPA / IPA Translator

**Live site:** [https://xxxnaif-hub.github.io/ipa-translator/](https://xxxnaif-hub.github.io/ipa-translator/)

Arabic-first RTL web app that runs **entirely in your browser**: upload an iOS `.ipa` → extract localizable strings → neural translate (default Arabic) → download a ZIP of translated localization files.

> **Legitimate use only.** For localizing apps you own or have rights to modify.  
> This tool does **not** bypass DRM, re-sign IPAs, enable sideloading/jailbreak, or claim that an unsigned IPA will install. Primary output is a **strings ZIP** only.

---

## العربية

### الموقع المباشر
[https://xxxnaif-hub.github.io/ipa-translator/](https://xxxnaif-hub.github.io/ipa-translator/)

### ماذا يفعل؟
1. ترفع ملف `.ipa` (حد تقريبي 200 ميجابايت) — **يُعالَج محلياً في متصفحك، دون رفع إلى خادم**.
2. يستخرج ملفات `.strings` و`.xcstrings` من الحزمة عبر JSZip.
3. يترجم النصوص **في المتصفح** عبر Opus-MT (`@xenova/transformers`) — **بدون حد يومي ولا مفاتيح API**.
4. تعرض جدولاً قابلاً للتحرير ثم تنزّل ZIP بهيكل `*.lproj/*.strings`.

### الترجمة في المتصفح (مهم)

- **بدون حصص سحابية ولا سيرفر ترجمة**: كل شيء على جهازك.
- **أول ترجمة** تحمّل موديل اللغة الهدف مرة واحدة إلى **كاش المتصفح** ثم تعيد استخدامه.
- الافتراضي للعربية: `Xenova/opus-mt-en-ar` (~80–300 ميجابايت كمّي). أخف بكثير من NLLB-200 (~870 ميجابايت) الذي قد يُسبب نفاد ذاكرة على الهواتف.
- أزواج لغات أخرى عبر موديلات Opus-MT منفصلة (انظر الواجهة).
- الملف والمعالجة **لا تُرفع** إلى أي خادم مجاني — مناسب لقيود GitHub Pages / Vercel hobby.

> ترجمة محلية في المتصفح بدون حد يومي — أول تشغيل يحمّل الموديل إلى كاش المتصفح.

### التشغيل محلياً

```bash
git clone https://github.com/XXXNAIF-hub/ipa-translator.git
cd ipa-translator
npm install
npm run dev
```

افتح العنوان الذي يعرضه Vite (عادة http://localhost:5173/ipa-translator/).

```bash
npm run build    # مخرجات static في dist/
npm run preview  # معاينة البناء
```

---

## English

### Live URL
[https://xxxnaif-hub.github.io/ipa-translator/](https://xxxnaif-hub.github.io/ipa-translator/)

### What it does
1. Upload an `.ipa` (≈200MB limit) — **parsed entirely in-memory in the browser** (JSZip).
2. Parse `.strings` (UTF-8 / UTF-16 LE/BE) and `.xcstrings` if present.
3. Translate with **in-browser neural MT** via `@xenova/transformers` + Opus-MT — **zero API keys, zero server quota**.
4. Edit translations in a searchable table and download a ZIP mirroring `*.lproj/*.strings`.

Placeholders like `%@`, `%d`, `%1$@`, `%%` are preserved. URLs, emails, and bundle-id-like values are skipped heuristically.

### Why Opus-MT (not NLLB) in the browser?
- `Xenova/nllb-200-distilled-600M` is ~**870MB** and frequently OOMs on phones / low-RAM tabs.
- Default path uses `Xenova/opus-mt-en-ar` (~**80–300MB** quantized) with browser cache.
- Other targets use matching `Xenova/opus-mt-en-*` models when available.
- First translation downloads the model into the **user’s browser cache** — no server disk or quota.

### Stack
- Vite + React + TypeScript + Tailwind CSS (static export → GitHub Pages)
- JSZip for IPA read + ZIP export (client-side)
- `@xenova/transformers` + Opus-MT (default `en→ar`)
- GitHub Actions → GitHub Pages on every push to `main`

### Deploy / GitHub Pages
- **Live:** https://xxxnaif-hub.github.io/ipa-translator/
- Source branch for Pages: `gh-pages` (static `dist/` output).
- Actions template: copy `docs/deploy-pages.yml` → `.github/workflows/deploy-pages.yml` (pushing workflow files needs a GitHub token with the `workflow` scope). Until then, republish with:

```bash
npm run build
# then publish the contents of dist/ to the gh-pages branch
```

### Scripts
| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server |
| `npm run build` | Production static build → `dist/` |
| `npm run preview` | Preview `dist/` locally |

### License / ethics
Use only on software you are authorized to localize. No piracy tooling included.
