import path from "path";
import { protectPlaceholders } from "./placeholders";
import type { LocalizedString, TranslationRow } from "./types";

/**
 * Offline neural MT via Transformers.js + NLLB-200 distilled (multilingual).
 * One model covers many targets; cached under <project>/.cache — no API keys,
 * no daily quota. Optional secondary: LibreTranslate via TRANSLATE_API_URL.
 */

const NLLB_MODEL = "Xenova/nllb-200-distilled-600M";

/** App / ISO-ish codes → NLLB FLORES codes */
const NLLB_LANG: Record<string, string> = {
  en: "eng_Latn",
  ar: "arb_Arab",
  fr: "fra_Latn",
  es: "spa_Latn",
  de: "deu_Latn",
  tr: "tur_Latn",
  hi: "hin_Deva",
  ur: "urd_Arab",
  "zh-cn": "zho_Hans",
  zh: "zho_Hans",
  ja: "jpn_Jpan",
  it: "ita_Latn",
  ru: "rus_Cyrl",
  nl: "nld_Latn",
  pt: "por_Latn",
  pl: "pol_Latn",
  ko: "kor_Hang",
  id: "ind_Latn",
  vi: "vie_Latn",
  sv: "swe_Latn",
  uk: "ukr_Cyrl",
  cs: "ces_Latn",
  ro: "ron_Latn",
  hu: "hun_Latn",
  fi: "fin_Latn",
  da: "dan_Latn",
  he: "heb_Hebr",
  fa: "pes_Arab",
};

export function supportedLocalTargets(): string[] {
  return Object.keys(NLLB_LANG).filter((k) => k !== "zh" && k !== "en");
}

function normalizeLang(code: string): string {
  return code.toLowerCase().replace("_", "-");
}

function nllbCode(lang: string): string | null {
  return NLLB_LANG[normalizeLang(lang)] ?? null;
}

function unsupportedMessage(source: string, target: string): string {
  const supported = supportedLocalTargets().join(", ");
  return (
    `لا يتوفر موديل ترجمة محلي للزوج ${source}→${target}. ` +
    `اللغات المدعومة محلياً: ${supported}. ` +
    `يمكنك تعيين TRANSLATE_API_URL لمثيل LibreTranslate خاص كخيار ثانوي.`
  );
}

type TranslatorFn = (
  texts: string | string[],
  opts?: {
    src_lang?: string;
    tgt_lang?: string;
    max_new_tokens?: number;
  }
) => Promise<{ translation_text: string } | { translation_text: string }[]>;

let pipelinePromise: Promise<TranslatorFn> | null = null;
let envConfigured = false;

function cacheDir(): string {
  return process.env.TRANSFORMERS_CACHE || path.join(process.cwd(), ".cache");
}

async function getLocalTranslator(): Promise<TranslatorFn> {
  if (!envConfigured) {
    const { env } = await import("@xenova/transformers");
    env.cacheDir = cacheDir();
    env.allowLocalModels = true;
    env.allowRemoteModels = true;
    envConfigured = true;
  }

  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline } = await import("@xenova/transformers");
      const translator = await pipeline("translation", NLLB_MODEL);
      return translator as unknown as TranslatorFn;
    })();
  }
  return pipelinePromise;
}

async function translateLibre(
  text: string,
  source: string,
  target: string
): Promise<string | null> {
  const base = process.env.TRANSLATE_API_URL?.replace(/\/$/, "");
  if (!base) return null;
  const apiKey = process.env.TRANSLATE_API_KEY;
  try {
    const res = await fetch(`${base}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
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

function extractTexts(
  result: { translation_text: string } | { translation_text: string }[]
): string[] {
  if (Array.isArray(result)) {
    return result.map((r) => r.translation_text);
  }
  return [result.translation_text];
}

async function translateTextsLocal(
  texts: string[],
  srcLang: string,
  tgtLang: string
): Promise<string[]> {
  const translator = await getLocalTranslator();
  const BATCH = 4; // NLLB is heavier — keep batches small
  const out: string[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH);
    const result = await translator(chunk.length === 1 ? chunk[0] : chunk, {
      src_lang: srcLang,
      tgt_lang: tgtLang,
      max_new_tokens: 256,
    });
    out.push(...extractTexts(result));
  }
  return out;
}

export type TranslateOptions = {
  strings: LocalizedString[];
  targetLang: string;
  sourceLang?: string;
  onProgress?: (done: number, total: number, row: TranslationRow) => void;
  delayMs?: number;
};

export async function translateStrings(
  opts: TranslateOptions
): Promise<TranslationRow[]> {
  const source = normalizeLang(opts.sourceLang || "en");
  const target = normalizeLang(opts.targetLang);
  const total = opts.strings.length;
  const rows: TranslationRow[] = new Array(total);

  if (source === target) {
    for (let i = 0; i < opts.strings.length; i++) {
      const s = opts.strings[i];
      const row: TranslationRow = {
        id: s.id,
        key: s.key,
        original: s.value,
        translation: s.value,
        locale: s.locale,
        filePath: s.filePath,
        skipped: !!s.skip,
        skipReason: s.skipReason || (s.skip ? undefined : "same-language"),
      };
      rows[i] = row;
      opts.onProgress?.(i + 1, total, row);
    }
    return rows;
  }

  const srcNllb = nllbCode(source);
  const tgtNllb = nllbCode(target);
  const useCloudSecondary = Boolean(process.env.TRANSLATE_API_URL);
  const canLocal = Boolean(srcNllb && tgtNllb);

  if (!canLocal && !useCloudSecondary) {
    throw new Error(unsupportedMessage(source, target));
  }

  const toTranslate: {
    index: number;
    original: string;
    restore: (t: string) => string;
  }[] = [];

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
      opts.onProgress?.(i + 1, total, row);
    } else {
      const { protectedText, restore } = protectPlaceholders(s.value);
      toTranslate.push({ index: i, original: protectedText, restore });
    }
  }

  const SUB = 4;
  for (let b = 0; b < toTranslate.length; b += SUB) {
    const chunk = toTranslate.slice(b, b + SUB);
    const inputs = chunk.map((c) => c.original);
    let translated: string[];

    try {
      if (canLocal && srcNllb && tgtNllb) {
        translated = await translateTextsLocal(inputs, srcNllb, tgtNllb);
      } else {
        translated = [];
        for (const text of inputs) {
          const t = await translateLibre(text, source, target);
          if (!t) throw new Error(unsupportedMessage(source, target));
          translated.push(t);
        }
      }
    } catch (err) {
      if (canLocal && useCloudSecondary) {
        translated = [];
        for (const text of inputs) {
          const t = await translateLibre(text, source, target);
          if (!t) {
            const message =
              err instanceof Error
                ? err.message
                : unsupportedMessage(source, target);
            throw new Error(message);
          }
          translated.push(t);
        }
      } else {
        throw err;
      }
    }

    if (translated.length !== chunk.length) {
      throw new Error("فشلت الترجمة المحلية: عدد النتائج لا يطابق المدخلات.");
    }

    for (let j = 0; j < chunk.length; j++) {
      const { index, restore } = chunk[j];
      const s = opts.strings[index];
      const text = (translated[j] || "").trim();
      if (!text) {
        throw new Error(
          `فشلت الترجمة المحلية للنص: «${s.value.slice(0, 80)}» — نتيجة فارغة.`
        );
      }
      const row: TranslationRow = {
        id: s.id,
        key: s.key,
        original: s.value,
        translation: restore(text),
        locale: s.locale,
        filePath: s.filePath,
        skipped: false,
      };
      rows[index] = row;
      opts.onProgress?.(index + 1, total, row);
    }
  }

  return rows;
}

export async function translateBatch(
  strings: LocalizedString[],
  targetLang: string,
  sourceLang = "en"
): Promise<TranslationRow[]> {
  return translateStrings({
    strings,
    targetLang,
    sourceLang,
    delayMs: 0,
  });
}

export const LOCAL_ENGINE = {
  name: "nllb",
  model: NLLB_MODEL,
  approxDownloadMB: 870,
} as const;
