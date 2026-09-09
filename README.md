# مترجم IPA / IPA Translator

**Live site:** [https://xxxnaif-hub.github.io/ipa-translator/](https://xxxnaif-hub.github.io/ipa-translator/)

Arabic-first RTL web app: upload an iOS `.ipa` → extract localizable strings → translate (default Arabic) → download a ZIP of translated localization files.

> **Legitimate use only.** For localizing apps you own or have rights to modify.  
> This tool does **not** bypass DRM, re-sign IPAs, enable sideloading/jailbreak, or claim that an unsigned IPA will install. Primary output is a **strings ZIP** only.

---

## العربية

### الموقع المباشر
[https://xxxnaif-hub.github.io/ipa-translator/](https://xxxnaif-hub.github.io/ipa-translator/)

### ماذا يفعل؟
1. ترفع ملف `.ipa` (حد تقريبي 200 ميجابايت) — **يُحلَّل محلياً في متصفحك**.
2. يستخرج ملفات `.strings` و`.xcstrings` من الحزمة عبر JSZip.
3. يترجم النصوص عبر **واجهات Google Translate العامة** (`translate-pa` مع احتياطي `client=gtx`) — بدون مفتاح مدفوع.
4. تعرض جدولاً قابلاً للتحرير ثم تنزّل ZIP بهيكل `*.lproj/*.strings`.

### الترجمة (مهم)

- **المحرك الأساسي:** `translate-pa.googleapis.com/v1/translateHtml` (نفس بوابة ويدجت ترجمة Google في المتصفح — تدعم CORS من GitHub Pages).
- **احتياطي:** `translate.googleapis.com/translate_a/single?client=gtx`.
- **اختبار ذاتي** في الصفحة يترجم «Sign In» ويعرض OK/FAIL بعد التحميل.
- النصوص العربية أصلاً تُتخطى عند الهدف العربية (لا تُفسَد بترجمة عكسية).
- عند الفشل تُعلَّم الصفوف كـ **فشل** — لا تُعرض الإنجليزية كنجاح صامت.
- ~~Opus-MT / Transformers.js~~ أُزيل كمحرك وحيد بعد أن كان يُرجع `translation_text` فارغاً أو خاطئاً لعبارات UI.

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
1. Upload an `.ipa` (≈200MB limit) — **parsed in-memory in the browser** (JSZip).
2. Parse `.strings` (UTF-8 / UTF-16 LE/BE) and `.xcstrings` if present.
3. Translate via **Google’s public translate endpoints** (`translate-pa`, fallback `client=gtx`) — **no paid API key**.
4. Edit translations in a searchable table and download a ZIP mirroring `*.lproj/*.strings`.

Placeholders like `%@`, `%d`, `%1$@`, `%%` are preserved. URLs, emails, bundle-ids, and already-Arabic strings (when targeting `ar`) are skipped. Failed rows are marked failed — English is never silently treated as success.

### Why not Opus-MT / Transformers.js?
In-browser Opus-MT (`Xenova/opus-mt-en-ar`) returned **empty** `translation_text` for phrases like “Sign In” / “Settings” and wrong Arabic for others. It is no longer the primary (or only) engine.

### Stack
- Vite + React + TypeScript + Tailwind CSS (static export → GitHub Pages)
- JSZip for IPA read + ZIP export (client-side)
- Google Translate public endpoints (`translate-pa` + `gtx` fallback)
- Manual / Actions deploy of `dist/` → `gh-pages` branch

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
