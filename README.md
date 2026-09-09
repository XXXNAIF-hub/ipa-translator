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
2. يستخرج `.strings` / `.xcstrings`، وأسماء العرض من `Info.plist` (XML)، وملفات نصية صغيرة؛ وإن لم يوجد شيء يحاول عبارات من الثنائي (حد 500).
3. يترجم عبر محركات متعددة في المتصفح بالترتيب: **translate-pa → MyMemory → LibreTranslate**.
4. تنزيل **IPA مترجم** فيه `Payload/*.app/ar.lproj/Localizable.strings`، أو ZIP للنصوص فقط.

**صدق المنتج:** الموقع يترجم نصوص الواجهة ويخرج IPA فيه مجلد ar.lproj — مو سحر يغيّر الصور أو الكود المجمّع كله.

### إثبات فوري على الصفحة
- صندوق تجريبي + زر «ترجم الآن» (بدون رفع IPA).
- اختبار ذاتي أخضر OK / أحمر FAIL لـ «Sign In» → عربية.

### الترجمة
- لا تُعرض الإنجليزية كنجاح صامت — الصفوف الفاشلة تُعلَّم **فشل**.
- النصوص العربية أصلاً تُتخطى عند الهدف العربية.

### التشغيل محلياً

```bash
git clone https://github.com/XXXNAIF-hub/ipa-translator.git
cd ipa-translator
npm install
npm run dev
```

```bash
npm run build
npm run smoke     # Sign In → Arabic via at least one engine
npm run verify    # fixture IPA → translated IPA with ar.lproj
```

---

## English

### Live URL
[https://xxxnaif-hub.github.io/ipa-translator/](https://xxxnaif-hub.github.io/ipa-translator/)

### Pipeline
1. Upload `.ipa` (~200MB) — parsed in-browser (JSZip).
2. Extract `.strings` / `.xcstrings`, XML `Info.plist` display/usage strings, small text files; last resort: Latin UI phrases from the main binary (cap **500**).
3. Translate with **translate-pa → MyMemory → LibreTranslate** until Arabic is returned.
4. Download **translated IPA** (original entries + injected `ar.lproj/Localizable.strings`) and/or strings ZIP.

### Limits (documented)
- Binary plists are not parsed (XML only).
- Compiled SwiftUI / storyboard layouts are not rewritten.
- Binary string scrape is capped and heuristic — App Store IPAs without localization files may still yield partial results.
- **Signing:** the downloaded IPA is unsigned/unmodified for code signature purposes — you must re-sign with your own identity to install on a device.

### Stack
- Vite + React + TypeScript + Tailwind CSS → GitHub Pages
- JSZip (client-side IPA read + IPA/ZIP write)
- Multi-engine MT (no paid key for translate-pa / MyMemory free tier)

### Deploy
- **Live:** https://xxxnaif-hub.github.io/ipa-translator/
- Source for Pages: `gh-pages` branch (`dist/` contents).
- Template: `docs/deploy-pages.yml`

### License / ethics
Use only on software you are authorized to localize. No piracy tooling included.
