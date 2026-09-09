import { protectPlaceholders } from "./placeholders";
import type { LocalizedString, TranslationRow } from "./types";

/**
 * Browser-side neural MT via Transformers.js + Opus-MT (Helsinki-NLP).
 *
 * NLLB-200 distilled (~870MB) is too heavy for typical phone browsers (OOM risk),
 * so we use per-pair Opus-MT models (~80–300MB quantized) cached in the browser.
 * Default Arabic path: Xenova/opus-mt-en-ar.
 */

/** source|target → HuggingFace Xenova model id (known-good browser models) */
const OPUS_MODELS: Record<string, string> = {
  "en|ar": "Xenova/opus-mt-en-ar",
  "en|fr": "Xenova/opus-mt-en-fr",
  "en|es": "Xenova/opus-mt-en-es",
  "en|de": "Xenova/opus-mt-en-de",
  "en|it": "Xenova/opus-mt-en-it",
  "en|ru": "Xenova/opus-mt-en-ru",
  "en|tr": "Xenova/opus-mt-en-tr",
  "en|hi": "Xenova/opus-mt-en-hi",
  "en|zh": "Xenova/opus-mt-en-zh",
  "en|zh-cn": "Xenova/opus-mt-en-zh",
  "en|nl": "Xenova/opus-mt-en-nl",
  "en|pl": "Xenova/opus-mt-en-pl",
  "en|uk": "Xenova/opus-mt-en-uk",
  "en|cs": "Xenova/opus-mt-en-cs",
  "en|sv": "Xenova/opus-mt-en-sv",
  "en|da": "Xenova/opus-mt-en-da",
  "en|fi": "Xenova/opus-mt-en-fi",
  "en|hu": "Xenova/opus-mt-en-hu",
  "en|ro": "Xenova/opus-mt-en-ro",
  "en|id": "Xenova/opus-mt-en-id",
  "en|vi": "Xenova/opus-mt-en-vi",
  "en|he": "Xenova/opus-mt-en-he",
  "ar|en": "Xenova/opus-mt-ar-en",
};

export function supportedLocalTargets(): string[] {
  const targets = new Set<string>();
  for (const key of Object.keys(OPUS_MODELS)) {
    const [, tgt] = key.split("|");
    if (tgt && tgt !== "en" && tgt !== "zh") targets.add(tgt);
  }
  return Array.from(targets).sort();
}

function normalizeLang(code: string): string {
  return code.toLowerCase().replace("_", "-");
}

function modelForPair(source: string, target: string): string | null {
  const s = normalizeLang(source);
  const t = normalizeLang(target);
  return OPUS_MODELS[`${s}|${t}`] ?? null;
}

function unsupportedMessage(source: string, target: string): string {
  const supported = supportedLocalTargets().join(", ");
  return (
    `لا يتوفر موديل ترجمة في المتصفح للزوج ${source}→${target}. ` +
    `اللغات المدعومة من الإنجليزية: ${supported}.`
  );
}

type TranslatorFn = (
  texts: string | string[],
  opts?: { max_new_tokens?: number }
) => Promise<{ translation_text: string } | { translation_text: string }[]>;

const pipelineCache = new Map<string, Promise<TranslatorFn>>();
let envConfigured = false;

async function getTranslator(modelId: string): Promise<TranslatorFn> {
  if (!envConfigured) {
    const { env } = await import("@xenova/transformers");
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    envConfigured = true;
  }

  let p = pipelineCache.get(modelId);
  if (!p) {
    p = (async () => {
      const { pipeline } = await import("@xenova/transformers");
      const translator = await pipeline("translation", modelId);
      return translator as unknown as TranslatorFn;
    })();
    pipelineCache.set(modelId, p);
  }
  return p;
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
  modelId: string,
  onModelProgress?: (msg: string) => void
): Promise<string[]> {
  onModelProgress?.(
    "جاري تحميل/تهيئة موديل الترجمة في المتصفح (أول مرة قد تستغرق دقائق)..."
  );
  const translator = await getTranslator(modelId);
  const BATCH = 8;
  const out: string[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH);
    const result = await translator(chunk.length === 1 ? chunk[0] : chunk, {
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
  onStatus?: (msg: string) => void;
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

  const modelId = modelForPair(source, target);
  if (!modelId) {
    throw new Error(unsupportedMessage(source, target));
  }

  const toTranslate: {
    index: number;
    original: string;
    restore: (t: string) => string;
  }[] = [];

  let doneCount = 0;
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
    } else {
      const { protectedText, restore } = protectPlaceholders(s.value);
      toTranslate.push({ index: i, original: protectedText, restore });
    }
  }

  const SUB = 8;

  for (let b = 0; b < toTranslate.length; b += SUB) {
    const chunk = toTranslate.slice(b, b + SUB);
    const inputs = chunk.map((c) => c.original);

    opts.onStatus?.(
      b === 0
        ? `تحميل الموديل ${modelId} ثم الترجمة...`
        : `ترجمة ${b + 1}–${Math.min(b + SUB, toTranslate.length)} من ${toTranslate.length}...`
    );

    const translated = await translateTextsLocal(
      inputs,
      modelId,
      opts.onStatus
    );

    if (translated.length !== chunk.length) {
      throw new Error("فشلت الترجمة: عدد النتائج لا يطابق المدخلات.");
    }

    for (let j = 0; j < chunk.length; j++) {
      const { index, restore } = chunk[j];
      const s = opts.strings[index];
      const text = (translated[j] || "").trim();
      if (!text) {
        throw new Error(
          `فشلت الترجمة للنص: «${s.value.slice(0, 80)}» — نتيجة فارغة.`
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
      doneCount++;
      opts.onProgress?.(doneCount, total, row);
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

export const LOCAL_ENGINE = {
  name: "opus-mt",
  defaultModel: "Xenova/opus-mt-en-ar",
  approxDownloadMB: 150,
  note: "NLLB-200 (~870MB) skipped for browser OOM risk on phones; Opus-MT per pair instead.",
} as const;
