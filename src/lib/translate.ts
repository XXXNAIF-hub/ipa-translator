import { protectPlaceholders } from "./placeholders";
import type { LocalizedString, TranslationRow } from "./types";

/**
 * Browser-side translation via Google’s public translate endpoints.
 *
 * Primary: translate-pa.googleapis.com/v1/translateHtml (Chrome te_lib /
 * Translate Element gateway). Supports CORS from GitHub Pages, accepts a
 * batch of strings, no billed API key required — uses the same public key
 * embedded in Google’s website-translation widget.
 *
 * Fallback: legacy translate.googleapis.com/translate_a/single?client=gtx
 * (often CORS/rate-limit blocked in browsers; kept for resilience).
 *
 * Opus-MT / Transformers.js was removed as the sole engine: in practice it
 * returned empty translation_text for UI phrases like "Sign In" / "Settings"
 * and garbage for others, so the UI silently kept English.
 */

/** Public key used by Google Translate Element / Chrome te_lib (not a secret). */
const TE_LIB_KEY = "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520";
const TRANSLATE_PA_URL = "https://translate-pa.googleapis.com/v1/translateHtml";
const GTX_URL = "https://translate.googleapis.com/translate_a/single";

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

/** Google expects specific codes (zh-CN, not zh). */
function toGoogleCode(code: string): string {
  const n = normalizeLang(code);
  if (n === "zh-CN" || n.toLowerCase() === "zh-cn") return "zh-CN";
  if (n === "zh-TW" || n.toLowerCase() === "zh-tw") return "zh-TW";
  // Prefer bare ISO codes for Google (ar, en, fr, …)
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
  const tgt = toGoogleCode(target).toLowerCase();
  if (tgt === "ar" || tgt.startsWith("ar")) {
    // Must contain Arabic letters for UI phrases that are Latin-script source
    if (/[A-Za-z]/.test(original) && !hasArabicScript(t)) return false;
  }
  // Identical copy of a multi-word Latin phrase is suspicious for non-en targets
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
      [texts, toGoogleCode(source), toGoogleCode(target)],
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
  // Shape: [["t1","t2",...], ...] or just ["t1","t2"] depending on version
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

async function translateGtxOne(
  text: string,
  source: string,
  target: string
): Promise<string> {
  const url = new URL(GTX_URL);
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", toGoogleCode(source));
  url.searchParams.set("tl", toGoogleCode(target));
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`gtx HTTP ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  // [[[translated, original, ...], ...], ...]
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error("gtx: unexpected response shape");
  }
  const parts = (data[0] as unknown[])
    .map((seg) => (Array.isArray(seg) ? String(seg[0] ?? "") : ""))
    .join("");
  return parts;
}

async function translateGtxBatch(
  texts: string[],
  source: string,
  target: string
): Promise<string[]> {
  // Legacy gtx: one q per request to avoid URL length + parse ambiguity
  const out: string[] = [];
  for (const t of texts) {
    out.push(await translateGtxOne(t, source, target));
  }
  return out;
}

/**
 * Translate a batch with primary translate-pa, fallback to gtx.
 * Throws if both fail.
 */
async function translateBatchRaw(
  texts: string[],
  source: string,
  target: string,
  onStatus?: (msg: string) => void
): Promise<{ texts: string[]; engine: "translate-pa" | "gtx" }> {
  try {
    onStatus?.("ترجمة عبر Google Translate (translate-pa)...");
    const textsOut = await translatePaBatch(texts, source, target);
    return { texts: textsOut, engine: "translate-pa" };
  } catch (paErr) {
    const paMsg = paErr instanceof Error ? paErr.message : String(paErr);
    onStatus?.(`translate-pa تعذّر (${paMsg.slice(0, 80)}) — تجربة gtx...`);
    try {
      const textsOut = await translateGtxBatch(texts, source, target);
      return { texts: textsOut, engine: "gtx" };
    } catch (gtxErr) {
      const gtxMsg = gtxErr instanceof Error ? gtxErr.message : String(gtxErr);
      throw new Error(
        `فشلت الترجمة عبر Google (translate-pa و gtx). pa: ${paMsg} | gtx: ${gtxMsg}`
      );
    }
  }
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
  const targetGoogle = toGoogleCode(target);

  if (!SUPPORTED_TARGETS.map((s) => s.toLowerCase()).includes(targetGoogle.toLowerCase()) &&
      !SUPPORTED_TARGETS.map((s) => s.toLowerCase()).includes(target.toLowerCase())) {
    // Still allow — Google covers many langs; only warn via status
    opts.onStatus?.(
      `اللغة ${target} غير مُدرجة محلياً لكن سيتم طلبها من Google Translate...`
    );
  }

  if (toGoogleCode(source).toLowerCase() === targetGoogle.toLowerCase()) {
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
    targetGoogle.toLowerCase() === "ar" ||
    targetGoogle.toLowerCase().startsWith("ar");

  for (let i = 0; i < opts.strings.length; i++) {
    const s = opts.strings[i];
    // Skip heuristics already on string, plus Arabic-script when targeting Arabic
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
  let engineUsed: "translate-pa" | "gtx" | null = null;
  let failCount = 0;

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const inputs = chunk.map((x) => x.original);
    opts.onStatus?.(
      c === 0
        ? `ترجمة ${toTranslate.length} نصاً عبر Google Translate...`
        : `ترجمة دفعة ${c + 1}/${chunks.length} (${doneCount}/${total})...`
    );

    let translated: string[];
    try {
      const result = await translateBatchRaw(
        inputs,
        source,
        target,
        opts.onStatus
      );
      translated = result.texts;
      engineUsed = result.engine;
    } catch (err) {
      // Mark entire chunk as failed — do not pretend English is success
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
      const raw = (translated[j] || "").trim();
      const restored = restore(raw);
      const ok = looksTranslated(original, restored, target);
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

/** One-shot self-test used by the UI after load / via button. */
export async function selfTestTranslation(): Promise<{
  ok: boolean;
  engine: string;
  input: string;
  output: string;
  error?: string;
}> {
  const input = "Sign In";
  try {
    const { texts, engine } = await translateBatchRaw([input], "en", "ar");
    const output = texts[0] || "";
    const ok = hasArabicScript(output) && output !== input;
    return {
      ok,
      engine,
      input,
      output,
      error: ok
        ? undefined
        : `Expected Arabic letters, got: ${JSON.stringify(output)}`,
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

export const LOCAL_ENGINE = {
  name: "google-translate-pa",
  defaultModel: "translate-pa.googleapis.com/v1/translateHtml",
  approxDownloadMB: 0,
  note: "Primary: Google translate-pa (Chrome te_lib). Fallback: client=gtx. Opus-MT removed — returned empty/wrong Arabic.",
} as const;
