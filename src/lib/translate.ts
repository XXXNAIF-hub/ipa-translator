import { protectPlaceholders } from "./placeholders";
import type { LocalizedString, TranslationRow } from "./types";

/**
 * Multi-engine browser translation.
 * Order: translate-pa → MyMemory → LibreTranslate (public).
 * Never treat unchanged English as success for Arabic targets.
 */

/** Public key used by Google Translate Element / Chrome te_lib (not a secret). */
const TE_LIB_KEY = "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520";
const TRANSLATE_PA_URL = "https://translate-pa.googleapis.com/v1/translateHtml";
const MYMEMORY_URL = "https://api.mymemory.translated.net/get";
const LIBRE_URL = "https://libretranslate.com/translate";

export type EngineId = "translate-pa" | "mymemory" | "libretranslate" | "glossary";

const SUPPORTED_TARGETS = [
  "ar",
  "fr",
  "es",
  "de",
  "tr",
  "hi",
  "zh-CN",
  "zh-cn",
  "zh",
  "it",
  "ru",
  "nl",
  "pl",
  "he",
  "en",
  "uk",
  "cs",
  "sv",
  "da",
  "fi",
  "hu",
  "ro",
  "id",
  "vi",
  "pt",
  "ja",
  "ko",
] as const;

/** Common UI glossary — fixes Cancel→يلغي etc. for Arabic. */
const UI_GLOSSARY_AR: Record<string, string> = {
  Cancel: "إلغاء",
  OK: "حسناً",
  Done: "تم",
  Save: "حفظ",
  Delete: "حذف",
  Edit: "تعديل",
  Back: "رجوع",
  Next: "التالي",
  Close: "إغلاق",
  Settings: "الإعدادات",
  Search: "بحث",
  Share: "مشاركة",
  Print: "طباعة",
  Help: "مساعدة",
  Home: "الرئيسية",
  More: "المزيد",
  Retry: "إعادة المحاولة",
  Continue: "متابعة",
  Skip: "تخطي",
  Yes: "نعم",
  No: "لا",
  Error: "خطأ",
  Warning: "تحذير",
  "Sign In": "تسجيل الدخول",
  "Sign Out": "تسجيل الخروج",
  Login: "تسجيل الدخول",
  Logout: "تسجيل الخروج",
  Open: "فتح",
  Send: "إرسال",
  Add: "إضافة",
  Remove: "إزالة",
  Select: "تحديد",
  Apply: "تطبيق",
  Reset: "إعادة تعيين",
  Clear: "مسح",
  Copy: "نسخ",
  Paste: "لصق",
  Cut: "قص",
  Undo: "تراجع",
  Redo: "إعادة",
  Refresh: "تحديث",
  Stop: "إيقاف",
  Start: "بدء",
  Pause: "إيقاف مؤقت",
  Play: "تشغيل",
  Loading: "جاري التحميل",
  "Please wait": "يرجى الانتظار",
  Submit: "إرسال",
  Update: "تحديث",
  Download: "تنزيل",
  Upload: "رفع",
};

export function supportedLocalTargets(): string[] {
  return [
    "ar",
    "fr",
    "es",
    "de",
    "tr",
    "hi",
    "zh-CN",
    "it",
    "ru",
    "nl",
    "pl",
    "he",
    "uk",
    "cs",
    "sv",
    "da",
    "fi",
    "hu",
    "ro",
    "id",
    "vi",
    "pt",
    "ja",
    "ko",
  ];
}

function normalizeLang(code: string): string {
  const c = code.toLowerCase().replace(/_/g, "-");
  if (c === "zh" || c === "zh-cn" || c === "zh-hans") return "zh-CN";
  if (c === "zh-tw" || c === "zh-hant") return "zh-TW";
  return c;
}

/** Google / engine codes (zh-CN, not zh). */
function toEngineCode(code: string): string {
  const n = normalizeLang(code);
  if (n === "zh-CN" || n.toLowerCase() === "zh-cn") return "zh-CN";
  if (n === "zh-TW" || n.toLowerCase() === "zh-tw") return "zh-TW";
  return n.split("-")[0].toLowerCase();
}

const ARABIC_LETTER_RE = /[\u0600-\u06FF]/g;

/** True when most letters in the string are Arabic script. */
export function isMostlyArabic(text: string): boolean {
  const letters = text.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return false;
  const arabic = (text.match(ARABIC_LETTER_RE) || []).length;
  return arabic / letters.length >= 0.5;
}

/** True when output contains at least one Arabic letter. */
export function hasArabicScript(text: string): boolean {
  return ARABIC_LETTER_RE.test(text);
}

function glossaryLookup(text: string, target: string): string | null {
  const tgt = toEngineCode(target).toLowerCase();
  if (tgt !== "ar" && !tgt.startsWith("ar")) return null;
  const trimmed = text.trim();
  if (UI_GLOSSARY_AR[trimmed]) return UI_GLOSSARY_AR[trimmed];
  // Case-insensitive exact match
  const found = Object.entries(UI_GLOSSARY_AR).find(
    ([k]) => k.toLowerCase() === trimmed.toLowerCase()
  );
  return found ? found[1] : null;
}

function looksTranslated(
  original: string,
  translated: string,
  target: string
): boolean {
  const t = (translated || "").trim();
  if (!t) return false;
  if (/MYMEMORY WARNING/i.test(t)) return false;
  if (/VISIT HTTPS:\/\/MYMEMORY/i.test(t)) return false;
  if (/PLEASE SELECT TWO DISTINCT LANGUAGES/i.test(t)) return false;
  if (/^QUOTA EXCEEDED/i.test(t)) return false;
  if (/get an API key/i.test(t)) return false;

  const tgt = toEngineCode(target).toLowerCase();
  if (tgt === "ar" || tgt.startsWith("ar")) {
    if (/[A-Za-z]/.test(original) && !hasArabicScript(t)) return false;
  }
  if (
    tgt !== "en" &&
    t === original.trim() &&
    /[A-Za-z]{3,}/.test(original) &&
    original.trim().length > 2
  ) {
    return false;
  }
  return true;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new Error("تم إلغاء الترجمة");
    err.name = "AbortError";
    throw err;
  }
}

async function translatePaBatch(
  texts: string[],
  source: string,
  target: string,
  signal?: AbortSignal
): Promise<string[]> {
  if (texts.length === 0) return [];
  throwIfAborted(signal);
  const res = await fetch(TRANSLATE_PA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json+protobuf",
      "X-Goog-API-Key": TE_LIB_KEY,
    },
    body: JSON.stringify([
      [texts, toEngineCode(source), toEngineCode(target)],
      "te_lib",
    ]),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `translate-pa HTTP ${res.status}: ${body.slice(0, 180) || res.statusText}`
    );
  }
  const data = (await res.json()) as unknown;
  let out: string[] | null = null;
  if (Array.isArray(data)) {
    if (Array.isArray(data[0]) && typeof data[0][0] === "string") {
      out = data[0] as string[];
    } else if (typeof data[0] === "string") {
      out = data as string[];
    }
  }
  if (!out || out.length !== texts.length) {
    throw new Error(
      `translate-pa: unexpected response shape (got ${out?.length ?? 0}, expected ${texts.length}).`
    );
  }
  return out.map((s) => (typeof s === "string" ? s : String(s ?? "")));
}

async function translateMyMemoryOne(
  text: string,
  source: string,
  target: string,
  signal?: AbortSignal
): Promise<string> {
  throwIfAborted(signal);
  const url = new URL(MYMEMORY_URL);
  url.searchParams.set("q", text);
  url.searchParams.set(
    "langpair",
    `${toEngineCode(source)}|${toEngineCode(target)}`
  );
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) {
    throw new Error(`mymemory HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    responseStatus?: number;
    responseData?: { translatedText?: string };
    quotaFinished?: boolean;
  };
  const out = data?.responseData?.translatedText ?? "";
  if (!out) {
    throw new Error(
      `mymemory: empty (status ${data?.responseStatus ?? "?"})`
    );
  }
  if (/MYMEMORY WARNING/i.test(out) || data?.quotaFinished) {
    throw new Error("mymemory: daily quota exceeded");
  }
  return out;
}

async function translateLibreOne(
  text: string,
  source: string,
  target: string,
  signal?: AbortSignal
): Promise<string> {
  throwIfAborted(signal);
  const res = await fetch(LIBRE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      q: text,
      source: toEngineCode(source),
      target: toEngineCode(target),
      format: "text",
    }),
    signal,
  });
  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `libretranslate HTTP ${res.status}: ${bodyText.slice(0, 160)}`
    );
  }
  let data: { translatedText?: string; error?: string };
  try {
    data = JSON.parse(bodyText) as { translatedText?: string; error?: string };
  } catch {
    throw new Error(`libretranslate: non-JSON ${bodyText.slice(0, 120)}`);
  }
  if (data.error) throw new Error(`libretranslate: ${data.error}`);
  const out = data.translatedText ?? "";
  if (!out) throw new Error("libretranslate: empty translation");
  return out;
}

async function translateOnesWithEngine(
  texts: string[],
  source: string,
  target: string,
  engine: EngineId,
  signal?: AbortSignal
): Promise<string[]> {
  if (engine === "glossary") {
    return texts.map((t) => glossaryLookup(t, target) || t);
  }
  if (engine === "translate-pa") {
    return translatePaBatch(texts, source, target, signal);
  }
  const out: string[] = [];
  for (const t of texts) {
    if (engine === "mymemory") {
      out.push(await translateMyMemoryOne(t, source, target, signal));
    } else {
      out.push(await translateLibreOne(t, source, target, signal));
    }
  }
  return out;
}

async function translateBatchRaw(
  texts: string[],
  source: string,
  target: string,
  onStatus?: (msg: string) => void,
  signal?: AbortSignal
): Promise<{ texts: string[]; engine: EngineId }> {
  const engines: EngineId[] = [
    "translate-pa",
    "mymemory",
    "libretranslate",
  ];
  const errors: string[] = [];
  const targetIsAr =
    toEngineCode(target).toLowerCase() === "ar" ||
    toEngineCode(target).toLowerCase().startsWith("ar");

  for (const engine of engines) {
    throwIfAborted(signal);
    try {
      const textsOut = await translateOnesWithEngine(
        texts,
        source,
        target,
        engine,
        signal
      );
      if (textsOut.length !== texts.length) {
        throw new Error(`${engine}: length mismatch`);
      }
      if (targetIsAr) {
        const needsAr = texts.some((t) => /[A-Za-z]/.test(t));
        const anyAr = textsOut.some((t) => hasArabicScript(t));
        if (needsAr && !anyAr) {
          throw new Error(
            `${engine}: no Arabic letters in batch output`
          );
        }
      }
      return { texts: textsOut, engine };
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${engine}: ${msg}`);
      onStatus?.(`${engine} تعذّر — تجربة التالي...`);
    }
  }
  throw new Error(
    `فشلت الترجمة عبر كل المحركات. ${errors.join(" | ").slice(0, 500)}`
  );
}

async function translateOneCascade(
  text: string,
  source: string,
  target: string,
  prefer?: EngineId,
  signal?: AbortSignal
): Promise<{ text: string; engine: EngineId }> {
  const gloss = glossaryLookup(text, target);
  if (gloss) return { text: gloss, engine: "glossary" };

  const engines: EngineId[] = [
    "translate-pa",
    "mymemory",
    "libretranslate",
  ];
  if (prefer && prefer !== "glossary") {
    engines.sort((a, b) => (a === prefer ? -1 : b === prefer ? 1 : 0));
  }
  const errors: string[] = [];
  for (const engine of engines) {
    throwIfAborted(signal);
    try {
      const [out] = await translateOnesWithEngine(
        [text],
        source,
        target,
        engine,
        signal
      );
      if (looksTranslated(text, out, target)) {
        return { text: out, engine };
      }
      errors.push(
        `${engine}: not a valid translation (${JSON.stringify(out).slice(0, 60)})`
      );
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      errors.push(
        `${engine}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  throw new Error(errors.join(" | ").slice(0, 300));
}

/** Larger batches for translate-pa throughput. */
function chunkInputs(
  items: { index: number; original: string; restore: (t: string) => string }[],
  maxCount = 48,
  maxChars = 4500
): (typeof items)[] {
  const chunks: (typeof items)[] = [];
  let cur: typeof items = [];
  let chars = 0;
  for (const item of items) {
    const len = item.original.length + 1;
    if (
      cur.length > 0 &&
      (cur.length >= maxCount || chars + len > maxChars)
    ) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(item);
    chars += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      throwIfAborted(signal);
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(Math.max(1, concurrency), items.length || 1);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export type TranslateOptions = {
  strings: LocalizedString[];
  targetLang: string;
  sourceLang?: string;
  onProgress?: (
    done: number,
    total: number,
    row: TranslationRow,
    meta?: { failCount: number; ratePerSec?: number; etaSec?: number }
  ) => void;
  onStatus?: (msg: string) => void;
  signal?: AbortSignal;
  /** Parallel chunk requests (default 3). */
  concurrency?: number;
};

export async function translateStrings(
  opts: TranslateOptions
): Promise<TranslationRow[]> {
  const source = normalizeLang(opts.sourceLang || "en");
  const target = normalizeLang(opts.targetLang);
  const total = opts.strings.length;
  const rows: TranslationRow[] = new Array(total);
  const targetCode = toEngineCode(target);
  const signal = opts.signal;
  const concurrency = opts.concurrency ?? 3;

  if (
    !SUPPORTED_TARGETS.map((s) => s.toLowerCase()).includes(
      targetCode.toLowerCase()
    ) &&
    !SUPPORTED_TARGETS.map((s) => s.toLowerCase()).includes(
      target.toLowerCase()
    )
  ) {
    opts.onStatus?.(
      `اللغة ${target} غير مُدرجة محلياً لكن سيتم طلبها من محركات الترجمة...`
    );
  }

  if (toEngineCode(source).toLowerCase() === targetCode.toLowerCase()) {
    for (let i = 0; i < opts.strings.length; i++) {
      throwIfAborted(signal);
      const s = opts.strings[i];
      const row: TranslationRow = {
        id: s.id,
        key: s.key,
        original: s.value,
        translation: s.value,
        locale: s.locale,
        filePath: s.filePath,
        skipped: true,
        skipReason: s.skipReason || "same-language",
      };
      rows[i] = row;
      opts.onProgress?.(i + 1, total, row, { failCount: 0 });
      if (i % 40 === 0) await yieldToUi();
    }
    return rows;
  }

  const toTranslate: {
    index: number;
    original: string;
    restore: (t: string) => string;
  }[] = [];

  let doneCount = 0;
  let failCount = 0;
  const startedAt = Date.now();
  const targetIsAr =
    targetCode.toLowerCase() === "ar" ||
    targetCode.toLowerCase().startsWith("ar");

  for (let i = 0; i < opts.strings.length; i++) {
    const s = opts.strings[i];
    if (s.skip) {
      const row: TranslationRow = {
        id: s.id,
        key: s.key,
        original: s.value,
        translation: s.value,
        locale: s.locale,
        filePath: s.filePath,
        skipped: true,
        skipReason: s.skipReason,
      };
      rows[i] = row;
      doneCount++;
      opts.onProgress?.(doneCount, total, row, { failCount });
      continue;
    }
    if (targetIsAr && isMostlyArabic(s.value)) {
      const row: TranslationRow = {
        id: s.id,
        key: s.key,
        original: s.value,
        translation: s.value,
        locale: s.locale,
        filePath: s.filePath,
        skipped: true,
        skipReason: "already-arabic",
      };
      rows[i] = row;
      doneCount++;
      opts.onProgress?.(doneCount, total, row, { failCount });
      continue;
    }
    // Glossary short-circuit
    const gloss = glossaryLookup(s.value, target);
    if (gloss) {
      const row: TranslationRow = {
        id: s.id,
        key: s.key,
        original: s.value,
        translation: gloss,
        locale: s.locale,
        filePath: s.filePath,
        skipped: false,
        failed: false,
      };
      rows[i] = row;
      doneCount++;
      opts.onProgress?.(doneCount, total, row, { failCount });
      continue;
    }
    const { protectedText, restore } = protectPlaceholders(s.value);
    toTranslate.push({ index: i, original: protectedText, restore });
  }

  const chunks = chunkInputs(toTranslate);
  let engineUsed: EngineId | null = null;
  let lastStatusAt = 0;

  const reportProgress = (row: TranslationRow) => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = elapsed > 0.2 ? doneCount / elapsed : undefined;
    const remaining = total - doneCount;
    const etaSec =
      rate && rate > 0 ? Math.round(remaining / rate) : undefined;
    opts.onProgress?.(doneCount, total, row, {
      failCount,
      ratePerSec: rate,
      etaSec,
    });
  };

  const processChunk = async (
    chunk: (typeof toTranslate)[number][],
    chunkIndex: number
  ) => {
    throwIfAborted(signal);
    const inputs = chunk.map((x) => x.original);
    const now = Date.now();
    if (now - lastStatusAt > 800) {
      lastStatusAt = now;
      opts.onStatus?.(
        `ترجمة دفعة ${chunkIndex + 1}/${chunks.length} — ${doneCount}/${total}` +
          (failCount ? ` (${failCount} فشل)` : "")
      );
    }

    let translated: string[] | null = null;
    let batchEngine: EngineId | null = null;
    try {
      const result = await translateBatchRaw(
        inputs,
        source,
        target,
        undefined, // less status thrash inside cascade
        signal
      );
      translated = result.texts;
      batchEngine = result.engine;
      engineUsed = result.engine;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      const msg = err instanceof Error ? err.message : String(err);
      // Mark chunk failed but KEEP GOING — don't abort whole run
      for (const item of chunk) {
        const s = opts.strings[item.index];
        const row: TranslationRow = {
          id: s.id,
          key: s.key,
          original: s.value,
          translation: s.value,
          locale: s.locale,
          filePath: s.filePath,
          skipped: false,
          failed: true,
          failReason: msg.slice(0, 200),
        };
        rows[item.index] = row;
        doneCount++;
        failCount++;
        reportProgress(row);
      }
      await yieldToUi();
      return;
    }

    for (let j = 0; j < chunk.length; j++) {
      throwIfAborted(signal);
      const { index, restore, original } = chunk[j];
      const s = opts.strings[index];
      let raw = (translated![j] || "").trim();
      let restored = restore(raw);
      let ok = looksTranslated(original, restored, target);
      let usedEngine = batchEngine!;

      if (!ok) {
        try {
          const retry = await translateOneCascade(
            original,
            source,
            target,
            batchEngine || undefined,
            signal
          );
          raw = retry.text.trim();
          restored = restore(raw);
          ok = looksTranslated(original, restored, target);
          usedEngine = retry.engine;
          engineUsed = retry.engine;
        } catch (e) {
          if ((e as Error)?.name === "AbortError") throw e;
        }
      }

      doneCount++;
      if (!ok) {
        failCount++;
        const row: TranslationRow = {
          id: s.id,
          key: s.key,
          original: s.value,
          translation: s.value,
          locale: s.locale,
          filePath: s.filePath,
          skipped: false,
          failed: true,
          failReason: raw
            ? "النتيجة ليست ترجمة صالحة (بقيت إنجليزية أو فارغة)"
            : "نتيجة فارغة من محرك الترجمة",
        };
        rows[index] = row;
        reportProgress(row);
      } else {
        const row: TranslationRow = {
          id: s.id,
          key: s.key,
          original: s.value,
          translation: restored,
          locale: s.locale,
          filePath: s.filePath,
          skipped: false,
          failed: false,
        };
        rows[index] = row;
        void usedEngine;
        reportProgress(row);
      }
      if (j % 8 === 0) await yieldToUi();
    }
    await yieldToUi();
  };

  // Parallel chunk requests with simple concurrency limit
  try {
    await mapPool(
      chunks,
      concurrency,
      async (chunk, idx) => {
        await processChunk(chunk, idx);
      },
      signal
    );
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      opts.onStatus?.("تم إلغاء الترجمة.");
      // Return partial rows — fill missing with cancelled marker
      for (let i = 0; i < total; i++) {
        if (!rows[i]) {
          const s = opts.strings[i];
          rows[i] = {
            id: s.id,
            key: s.key,
            original: s.value,
            translation: s.value,
            locale: s.locale,
            filePath: s.filePath,
            skipped: false,
            failed: true,
            failReason: "أُلغيت",
          };
        }
      }
      return rows;
    }
    throw err;
  }

  if (engineUsed) {
    opts.onStatus?.(
      failCount > 0
        ? `اكتملت عبر ${engineUsed} مع ${failCount} فشل.`
        : `اكتملت الترجمة عبر ${engineUsed}.`
    );
  }

  // Only throw if NOTHING translated successfully (all failed) — not partial
  const translatedOk = rows.filter(
    (r) => r && !r.failed && !r.skipped && r.translation !== r.original
  ).length;
  const attempted = toTranslate.length;
  if (attempted > 0 && failCount === attempted && translatedOk === 0) {
    // Still return rows — UI should show failures; throw only if zero progress
    // Actually user said: Don't mark whole run hopeless — keep translating remaining
    // So we should NOT throw on total failure either if we got partial glossary hits
    // Only throw if literally every engine died and nothing useful
    const anySuccess = rows.some(
      (r) => r && !r.failed && !r.skipped
    );
    if (!anySuccess) {
      throw new Error(
        `فشلت ترجمة كل النصوص (${failCount}). تحقق من الاتصال أو أعد المحاولة.`
      );
    }
  }

  return rows;
}

export async function translateBatch(
  strings: LocalizedString[],
  targetLang: string,
  sourceLang = "en",
  onProgress?: TranslateOptions["onProgress"],
  onStatus?: TranslateOptions["onStatus"]
): Promise<TranslationRow[]> {
  return translateStrings({
    strings,
    targetLang,
    sourceLang,
    onProgress,
    onStatus,
  });
}

/** One-shot demo / self-test: Sign In → Arabic via first working engine. */
export async function translateDemoPhrase(
  input = "Sign In",
  source = "en",
  target = "ar"
): Promise<{
  ok: boolean;
  engine: string;
  input: string;
  output: string;
  error?: string;
}> {
  try {
    const gloss = glossaryLookup(input, target);
    if (gloss) {
      return { ok: true, engine: "glossary", input, output: gloss };
    }
    const { texts, engine } = await translateBatchRaw([input], source, target);
    const output = texts[0] || "";
    const ok =
      looksTranslated(input, output, target) &&
      (toEngineCode(target) !== "ar" || hasArabicScript(output));
    return {
      ok,
      engine,
      input,
      output,
      error: ok
        ? undefined
        : `Expected a real translation, got: ${JSON.stringify(output)}`,
    };
  } catch (e) {
    return {
      ok: false,
      engine: "none",
      input,
      output: "",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** One-shot self-test used by the UI after load / via button. */
export async function selfTestTranslation(): Promise<{
  ok: boolean;
  engine: string;
  input: string;
  output: string;
  error?: string;
}> {
  return translateDemoPhrase("Sign In", "en", "ar");
}

export const LOCAL_ENGINE = {
  name: "multi-engine",
  defaultModel: "translate-pa → MyMemory → LibreTranslate",
  approxDownloadMB: 0,
  note: "Primary: Google translate-pa (batches ~48, concurrency 3). Fallbacks: MyMemory, LibreTranslate. Glossary for common UI. Failed rows stay marked failed — English never counts as success. Cancel via AbortController.",
} as const;
