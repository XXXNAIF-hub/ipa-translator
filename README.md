# مترجم IPA / IPA Translator

Arabic-first RTL web app: upload an iOS `.ipa` → extract localizable strings → **offline neural translate** (default Arabic) → download a ZIP of translated localization files.

> **Legitimate use only.** For localizing apps you own or have rights to modify.  
> This tool does **not** bypass DRM, re-sign IPAs, enable sideloading/jailbreak, or claim that an unsigned IPA will install. Primary output is a **strings ZIP** only.

---

## العربية

### ماذا يفعل؟
1. ترفع ملف `.ipa` (حد تقريبي 200 ميجابايت).
2. يستخرج ملفات `.strings` و`.xcstrings` من الحزمة.
3. يترجم النصوص **محلياً** عبر موديل عصبي (NLLB-200 / Transformers.js) — **بدون حد يومي ولا مفاتيح API**.
4. تعرض جدولاً قابلاً للتحرير ثم تنزّل ZIP بهيكل `*.lproj/*.strings`.

### الترجمة المحلية (مهم)

- **بدون حصص سحابية**: لا MyMemory ولا LibreTranslate العام كمسار افتراضي.
- **أول تشغيل** يحمّل موديل اللغة الهدف مرة واحدة إلى مجلد المشروع `.cache/` ثم يعيد استخدامه.
- حجم تقريبي لكل زوج لغوي (موديل واحد متعدد اللغات `Xenova/nllb-200-distilled-600M`): **~870 ميجابايت** على القرص. أول تشغيل قد يستغرق بضع دقائق حسب الشبكة؛ بعدها يعمل بدون إنترنت للترجمة.
- إن لم يتوفر موديل محلي للزوج المطلوب تظهر رسالة عربية واضحة — ولن تُرجَع الإنجليزية صامتة كترجمة مزيفة.

> ترجمة محلية بدون حد يومي — أول تشغيل يحمّل الموديل.

### التشغيل محلياً

```bash
git clone https://github.com/XXXNAIF-hub/ipa-translator.git
cd ipa-translator
cp .env.example .env   # اختياري
npm install
npm run dev
```

افتح [http://localhost:3000](http://localhost:3000).

للتجربة بدون IPA حقيقي استخدم `fixtures/sample.ipa`.

```bash
npm run smoke
```

### متغيرات البيئة

انظر `.env.example`:

| المتغير | الوصف |
|---------|--------|
| `TRANSFORMERS_CACHE` | مسار كاش الموديلات (افتراضي: `.cache/` داخل المشروع) |
| `TRANSLATE_API_URL` | اختياري: مثيل LibreTranslate خاص/مدفوع كمسار ثانوي فقط |
| `TRANSLATE_API_KEY` | مفتاح إن كان المثيل الثانوي يتطلبه |

---

## English

### What it does
1. Upload an `.ipa` (≈200MB limit).
2. Parse `.strings` (UTF-8 / UTF-16 LE/BE) and `.xcstrings` if present.
3. Translate with **offline neural MT** via `@xenova/transformers` (`Xenova/nllb-200-distilled-600M`) — **zero API keys, zero cloud quota**.
4. Edit translations in a searchable table and download a ZIP mirroring `*.lproj/*.strings`.

Placeholders like `%@`, `%d`, `%1$@`, `%%` are preserved. URLs, emails, and bundle-id-like values are skipped heuristically.

### Local models / first run
- On first translate the multilingual model downloads into `.cache/` (~**870MB** quantized NLLB-200 distilled).
- Subsequent runs reuse the cache — no daily limits.
- Unsupported pairs fail with a clear Arabic error (no silent English passthrough).
- Optional: set `TRANSLATE_API_URL` to your own LibreTranslate instance as a **secondary** backend only.

### Run locally

```bash
git clone https://github.com/XXXNAIF-hub/ipa-translator.git
cd ipa-translator
cp .env.example .env   # optional
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Smoke-test fixture: `fixtures/sample.ipa`.

```bash
npm run smoke
```

### Stack
- Next.js App Router + TypeScript + Tailwind CSS
- `adm-zip` / `jszip` for IPA (zip) and export
- Offline translation: `@xenova/transformers` + Xenova NLLB-200 distilled
- Optional secondary: self-hosted LibreTranslate via env

### Scripts
| Script | Purpose |
|--------|---------|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production |
| `npm run smoke` | Parse fixture → local NLLB translate → write ZIP under `/tmp` |

### License / ethics
Use only on software you are authorized to localize. No piracy tooling included.
