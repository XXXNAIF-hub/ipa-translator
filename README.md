# ما يترجم / IPA Translator

**Live site:** [https://xxxnaif-hub.github.io/ipa-translator/](https://xxxnaif-hub.github.io/ipa-translator/)

Arabic-first RTL web app: upload an iOS `.ipa` → extract UI strings → translate (default Arabic) → download a **translated IPA** (with `ar.lproj/Localizable.strings`) and/or a strings ZIP.

> **Legitimate use only.** For localizing apps you own or have rights to modify.  
> This tool does **not** bypass DRM, re-sign IPAs, or enable sideloading/jailbreak.  
> Device install still needs **your own signing**. Output injects localization folders only — it does not rewrite images or compiled code.

---

## العربية

### الموقع المباشر
[https://xxxnaif-hub.github.io/ipa-translator/](https://xxxnaif-hub.github.io/ipa-translator/)

### ماذا يفعل؟
1. ترفع ملف `.ipa` (حد تقريبي 200 ميجابايت) — **يُحلَّل محلياً في متصفحك**.
2. يستخرج `.strings` / `.xcstrings` مع **تصفية افتراضية: الإنجليزية / Base فقط** + إزالة تكرار المفاتيح + **حد ترجمة 1500** (قابل للتعديل).
3. يترجم عبر محركات متعددة: **translate-pa (دفعات ~48، توازي 3) → MyMemory → LibreTranslate**، مع زر **إلغاء** و ETA.
4. تنزيل **IPA مترجم** فيه `Payload/*.app/ar.lproj/Localizable.strings`، أو ZIP للنصوص فقط.

**لماذا كان يظهر ~20 ألف نص؟** تطبيقات مثل Epson iPrint تضم عشرات مجلدات `.lproj`؛ النسخة القديمة كانت تجمع كل اللغات بدون تفضيل Base/en فتنفجر القائمة. الآن الافتراضي يمنع ذلك.

### التشغيل محلياً

```bash
git clone https://github.com/XXXNAIF-hub/ipa-translator.git
cd ipa-translator
npm install
npm run dev
```

```bash
npm run build
npm run smoke          # Sign In → Arabic
npm run verify         # fixture IPA → translated IPA
npm run verify:dedupe  # multi-locale ~20k → dedupe/cap
```

---

## English

### Live URL
[https://xxxnaif-hub.github.io/ipa-translator/](https://xxxnaif-hub.github.io/ipa-translator/)

### Pipeline
1. Upload `.ipa` (~200MB) — parsed in-browser (JSZip).
2. Extract `.strings` / `.xcstrings` with defaults: **Base/en locales only**, key dedupe (prefer Base/en), translate-list cap **1500** (UI-configurable). Binary scrape **off** by default (hard cap **200** when enabled; Title-Case / spaced phrases only).
3. Translate with **translate-pa → MyMemory → LibreTranslate** (batch ~48, concurrency 3), AbortController cancel, ETA / strings-per-sec. Partial failures do not abort the run.
4. Download **translated IPA** and/or strings ZIP.

### Limits (documented)
- Multi-lproj IPAs no longer multiply strings by locale count (default Base/en).
- Binary plists are not parsed (XML only).
- Compiled SwiftUI / storyboard layouts are not rewritten.
- Binary string scrape is opt-in and capped at 200.
- **Signing:** downloaded IPA still needs your own re-sign to install.

### Stack
- Vite + React + TypeScript + Tailwind CSS → GitHub Pages
- JSZip (client-side IPA read + IPA/ZIP write)
- Multi-engine MT + small Arabic UI glossary (Cancel → إلغاء, …)

### Deploy
- **Live:** https://xxxnaif-hub.github.io/ipa-translator/
- Source for Pages: `gh-pages` branch (`dist/` contents).
- Template: `docs/deploy-pages.yml`

### License / ethics
Use only on software you are authorized to localize. No piracy tooling included.
