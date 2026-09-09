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

export type EngineId = "translate-pa" | "mymemory" | "libretranslate";

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

function looksTranslated(
  original: string,
  translated: string,
  target: string
): boolean {
  const t = (translated || "").trim();
  if (!t) return false;
  // Reject MyMemory quota / warning payloads
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

async function translatePaBatch(
  texts: string[],
  source: string,
  target: string
): Promise<string[]> {
  if (texts.length === 0) return [];
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
  target: string
): Promise<string> {
  const url = new URL(MYMEMORY_URL);
  url.searchParams.set("q", text);
  url.searchParams.set(
    "langpair",
    `${toEngineCode(source)}|${toEngineCode(target)}`
  );
  const res = await fetch(url.toString());
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
  target: string
): Promise<string> {
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
  engine: EngineId
): Promise<string[]> {
  if (engine === "translate-pa") {
    return translatePaBatch(texts, source, target);
  }
  const out: string[] = [];
  for (const t of texts) {
    if (engine === "mymemory") {
      out.push(await translateMyMemoryOne(t, source, target));
    } else {
      out.push(await translateLibreOne(t, source, target));
    }
  }
  return out;
}

/**
 * Translate a batch trying engines in order until one returns usable output.
 * For Arabic targets, at least one result in the batch must contain Arabic
 * (or the engine throws / we try next).
 */
async function translateBatchRaw(
  texts: string[],
  source: string,
  target: string,
  onStatus?: (msg: string) => void
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
    try {
      onStatus?.(
        engine === "translate-pa"
          ? "ترجمة عبر translate-pa..."
          : engine === "mymemory"
            ? "ترجمة عبر MyMemory..."
            : "ترجمة عبر LibreTranslate..."
      );
      const textsOut = await translateOnesWithEngine(
        texts,
        source,
        target,
        engine
      );
      if (textsOut.length !== texts.length) {
        throw new Error(`${engine}: length mismatch`);
      }
      // For ar: require at least one Arabic hit if any Latin source present
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
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${engine}: ${msg}`);
      onStatus?.(`${engine} تعذّر — تجربة المحرك التالي...`);
    }
  }
  throw new Error(
    `فشلت الترجمة عبر كل المحركات. ${errors.join(" | ").slice(0, 500)}`
  );
}

/** Per-string cascade used when a batch item fails looksTranslated. */
async function translateOneCascade(
  text: string,
  source: string,
  target: string,
  prefer?: EngineId
): Promise<{ text: string; engine: EngineId }> {
  const engines: EngineId[] = [
    "translate-pa",
    "mymemory",
    "libretranslate",
  ];
  if (prefer) {
    engines.sort((a, b) => (a === prefer ? -1 : b === prefer ? 1 : 0));
  }
  const errors: string[] = [];
  for (const engine of engines) {
    try {
      const [out] = await translateOnesWithEngine([text], source, target, engine);
      if (looksTranslated(text, out, target)) {
        return { text: out, engine };
      }
      errors.push(`${engine}: not a valid translation (${JSON.stringify(out).slice(0, 60)})`);
    } catch (e) {
      errors.push(
        `${engine}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  throw new Error(errors.join(" | ").slice(0, 300));
}

/** Chunk by count and approximate char budget for URL/body safety. */
function chunkInputs(
  items: { index: number; original: string; restore: (t: string) => string }[],
  maxCount = 32,
  maxChars = 3500
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

export type TranslateOptions = {
  strings: LocalizedString[];
  targetLang: string;
  sourceLang?: string;
  onProgress?: (done: number, total: number, row: TranslationRow) => void;
  onStatus?: (msg: string) => void;
};

export async function translateStrings(
  opts: TranslateOptions
): Promise<TranslationRow[]> {
  const source = normalizeLang(opts.sourceLang || "en");
  const target = normalizeLang(opts.targetLang);
  const total = opts.strings.length;
  const rows: TranslationRow[] = new Array(total);
  const targetCode = toEngineCode(target);

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
      opts.onProgress?.(i + 1, total, row);
    }
    return rows;
  }

  const toTranslate: {
    index: number;
    original: string;
    restore: (t: string) => string;
  }[] = [];

  let doneCount = 0;
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
      opts.onProgress?.(doneCount, total, row);
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
      opts.onProgress?.(doneCount, total, row);
      continue;
    }
    const { protectedText, restore } = protectPlaceholders(s.value);
    toTranslate.push({ index: i, original: protectedText, restore });
  }

  const chunks = chunkInputs(toTranslate);
  let engineUsed: EngineId | null = null;
  let failCount = 0;

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const inputs = chunk.map((x) => x.original);
    opts.onStatus?.(
      c === 0
        ? `ترجمة ${toTranslate.length} نصاً (translate-pa → MyMemory → LibreTranslate)...`
        : `ترجمة دفعة ${c + 1}/${chunks.length} (${doneCount}/${total})...`
    );

    let translated: string[] | null = null;
    let batchEngine: EngineId | null = null;
    try {
      const result = await translateBatchRaw(
        inputs,
        source,
        target,
        opts.onStatus
      );
      translated = result.texts;
      batchEngine = result.engine;
      engineUsed = result.engine;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
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
        opts.onProgress?.(doneCount, total, row);
      }
      continue;
    }

    for (let j = 0; j < chunk.length; j++) {
      const { index, restore, original } = chunk[j];
      const s = opts.strings[index];
      let raw = (translated![j] || "").trim();
      let restored = restore(raw);
      let ok = looksTranslated(original, restored, target);
      let usedEngine = batchEngine!;

      if (!ok) {
        // Per-string cascade through remaining engines
        try {
          opts.onStatus?.(
            `إعادة محاولة مفردة: «${original.slice(0, 40)}»...`
          );
          const retry = await translateOneCascade(
            original,
            source,
            target,
            batchEngine || undefined
          );
          raw = retry.text.trim();
          restored = restore(raw);
          ok = looksTranslated(original, restored, target);
          usedEngine = retry.engine;
          engineUsed = retry.engine;
        } catch {
          // keep ok=false
        }
      }

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
      }
      doneCount++;
      opts.onProgress?.(doneCount, total, rows[index]);
    }
  }

  if (engineUsed) {
    opts.onStatus?.(
      failCount > 0
        ? `اكتملت عبر ${engineUsed} مع ${failCount} فشل.`
        : `اكتملت الترجمة عبر ${engineUsed}.`
    );
  }

  if (failCount === toTranslate.length && toTranslate.length > 0) {
    throw new Error(
      `فشلت ترجمة كل النصوص (${failCount}). تحقق من الاتصال أو أعد المحاولة.`
    );
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
  note: "Primary: Google translate-pa. Fallbacks: MyMemory, LibreTranslate public. Failed rows stay marked failed — English never counts as success.",
} as const;
