# مترجم IPA / IPA Translator

Arabic-first RTL web app: upload an iOS `.ipa` → extract localizable strings → translate (default Arabic) → download a ZIP of translated localization files.

> **Legitimate use only.** For localizing apps you own or have rights to modify.  
> This tool does **not** bypass DRM, re-sign IPAs, enable sideloading/jailbreak, or claim that an unsigned IPA will install. Primary output is a **strings ZIP** only.

---

## العربية

### ماذا يفعل؟
1. ترفع ملف `.ipa` (حد تقريبي 200 ميجابايت).
2. يستخرج ملفات `.strings` و`.xcstrings` من الحزمة.
3. يترجم النصوص عبر واجهات مجانية (MyMemory و/أو LibreTranslate).
4. تعرض جدولاً قابلاً للتحرير ثم تنزّل ZIP بهيكل `*.lproj/*.strings`.

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

### متغيرات البيئة

انظر `.env.example`:

| المتغير | الوصف |
|---------|--------|
| `TRANSLATE_API_URL` | عنوان LibreTranslate (افتراضي: المثيل العام) |
| `TRANSLATE_API_KEY` | مفتاح إن كان المثيل يتطلبه |
| `MYMEMORY_EMAIL` | بريد لزيادة الحصة الناعمة في MyMemory |
| `TRANSLATE_DELAY_MS` | تأخير بين طلبات الترجمة (افتراضي 300) |

### حدود الترجمة المجانية
- **MyMemory**: حصة يومية محدودة لكل IP (تقريباً بضعة آلاف كلمة). قد تُرفض الطلبات عند تجاوز الحد.
- **LibreTranslate** العام: قد يكون بطيئاً أو يطلب مفتاحاً أو يقيّد الاستخدام.
- الأفضل: تشغيل LibreTranslate محلياً أو توفير مثيل خاص عبر `TRANSLATE_API_URL`.

---

## English

### What it does
1. Upload an `.ipa` (≈200MB limit).
2. Parse `.strings` (UTF-8 / UTF-16 LE/BE) and `.xcstrings` if present.
3. Translate with free APIs (MyMemory, then LibreTranslate fallback).
4. Edit translations in a searchable table and download a ZIP mirroring `*.lproj/*.strings`.

Placeholders like `%@`, `%d`, `%1$@`, `%%` are preserved. URLs, emails, and bundle-id-like values are skipped heuristically.

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
- Free translation: MyMemory + optional LibreTranslate

### Scripts
| Script | Purpose |
|--------|---------|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production |
| `npm run smoke` | Parse fixture → translate → write ZIP under `/tmp` |

### License / ethics
Use only on software you are authorized to localize. No piracy tooling included.
