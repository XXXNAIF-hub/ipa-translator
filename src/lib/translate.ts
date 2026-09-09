import { protectPlaceholders } from "./placeholders";
import type { LocalizedString, TranslationRow } from "./types";

const MYMEMORY_URL = "https://api.mymemory.translated.net/get";
const DEFAULT_LIBRE =
  process.env.TRANSLATE_API_URL || "https://libretranslate.com";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function translateMyMemory(
  text: string,
  source: string,
  target: string
): Promise<string | null> {
  const email = process.env.MYMEMORY_EMAIL;
  const params = new URLSearchParams({
    q: text,
    langpair: `${source}|${target}`,
  });
  if (email) params.set("de", email);

  const res = await fetch(`${MYMEMORY_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    responseStatus?: number;
    responseData?: { translatedText?: string };
  };
  if (data.responseStatus !== 200 || !data.responseData?.translatedText) {
    return null;
  }
  const out = data.responseData.translatedText;
  // MyMemory sometimes returns QUOTA EXCEEDED as the text
  if (/MYMEMORY WARNING|QUOTA EXCEEDED/i.test(out)) return null;
  return out;
}

async function translateLibre(
  text: string,
  source: string,
  target: string
): Promise<string | null> {
  const base = DEFAULT_LIBRE.replace(/\/$/, "");
  const apiKey = process.env.TRANSLATE_API_KEY;
  try {
    const res = await fetch(`${base}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        q: text,
        source: source === "auto" ? "auto" : source,
        target,
        format: "text",
        ...(apiKey ? { api_key: apiKey } : {}),
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { translatedText?: string };
    return data.translatedText ?? null;
  } catch {
    return null;
  }
}

async function translateOne(
  text: string,
  source: string,
  target: string
): Promise<string> {
  const { protectedText, restore } = protectPlaceholders(text);
  // Prefer MyMemory (no key), then LibreTranslate
  let translated =
    (await translateMyMemory(protectedText, source, target)) ??
    (await translateLibre(protectedText, source, target));

  if (!translated) {
    // Last resort: return original
    return text;
  }
  return restore(translated);
}

export type TranslateOptions = {
  strings: LocalizedString[];
  targetLang: string;
  sourceLang?: string;
  onProgress?: (done: number, total: number, row: TranslationRow) => void;
  /** Delay between API calls to respect free-tier rate limits */
  delayMs?: number;
};

export async function translateStrings(
  opts: TranslateOptions
): Promise<TranslationRow[]> {
  const source = (opts.sourceLang || "en").toLowerCase();
  const target = opts.targetLang.toLowerCase();
  const delay = opts.delayMs ?? 350;
  const rows: TranslationRow[] = [];
  const total = opts.strings.length;

  for (let i = 0; i < opts.strings.length; i++) {
    const s = opts.strings[i];
    let row: TranslationRow;

    if (s.skip) {
      row = {
        id: s.id,
        key: s.key,
        original: s.value,
        translation: s.value,
        locale: s.locale,
        filePath: s.filePath,
        skipped: true,
        skipReason: s.skipReason,
      };
    } else {
      try {
        const translation = await translateOne(s.value, source, target);
        row = {
          id: s.id,
          key: s.key,
          original: s.value,
          translation,
          locale: s.locale,
          filePath: s.filePath,
          skipped: false,
        };
      } catch {
        row = {
          id: s.id,
          key: s.key,
          original: s.value,
          translation: s.value,
          locale: s.locale,
          filePath: s.filePath,
          skipped: true,
          skipReason: "translate-error",
        };
      }
      if (delay > 0) await sleep(delay);
    }

    rows.push(row);
    opts.onProgress?.(i + 1, total, row);
  }

  return rows;
}

/** Batch helper used by the API for smaller payloads / faster demos */
export async function translateBatch(
  strings: LocalizedString[],
  targetLang: string,
  sourceLang = "en"
): Promise<TranslationRow[]> {
  return translateStrings({
    strings,
    targetLang,
    sourceLang,
    delayMs: Number(process.env.TRANSLATE_DELAY_MS || 300),
  });
}
