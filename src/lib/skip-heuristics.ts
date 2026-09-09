/**
 * Heuristics for strings that should not be machine-translated.
 * Soft-skip (not fail): product codes, CFBundle* tech values, brand/proper nouns.
 */

const URL_RE =
  /^(https?:\/\/|www\.)|^(itunes|itms|mailto|tel|sms|ftp):/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BUNDLE_ID_RE =
  /^[a-zA-Z][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+){1,}$/;
const PATH_RE = /^\/[\w./-]+$/;
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const NUMERIC_RE = /^[\d\s.,:%+\-⁄⁄]+$/;
const ONLY_SYMBOLS_RE = /^[\s\p{P}\p{S}]+$/u;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Product / SKU codes like ESCPR01, ABC123X — not UI copy. */
const PRODUCT_CODE_RE = /^[A-Z]{2,}\d+[A-Z0-9]*$/i;

/** Semver / build versions: 1.2.3, 14.0.1b2, 1.0.0-rc1 */
const VERSION_RE = /^\d+(\.\d+){1,4}([a-zA-Z0-9._+-]*)?$/;

/** Common UI words — if present, treat as real copy, not a brand. */
const UI_FUNCTION_WORDS = new Set(
  [
    "the",
    "a",
    "an",
    "your",
    "my",
    "our",
    "please",
    "tap",
    "press",
    "click",
    "select",
    "enter",
    "to",
    "for",
    "from",
    "with",
    "without",
    "and",
    "or",
    "not",
    "this",
    "that",
    "these",
    "those",
    "are",
    "is",
    "was",
    "were",
    "be",
    "been",
    "can",
    "will",
    "would",
    "should",
    "could",
    "must",
    "may",
    "of",
    "in",
    "on",
    "at",
    "by",
    "into",
    "onto",
    "about",
    "how",
    "what",
    "when",
    "where",
    "why",
    "who",
    "which",
    "you",
    "we",
    "they",
    "it",
    "if",
    "then",
    "else",
    "error",
    "failed",
    "success",
    "loading",
    "wait",
    "retry",
    "cancel",
    "ok",
    "done",
    "save",
    "delete",
    "edit",
    "back",
    "next",
    "close",
    "open",
    "settings",
    "search",
    "help",
    "home",
    "more",
    "yes",
    "no",
    "continue",
    "skip",
    "submit",
    "update",
    "download",
    "upload",
    "share",
    "print",
    "login",
    "logout",
    "sign",
    "add",
    "remove",
    "apply",
    "reset",
    "clear",
    "copy",
    "paste",
    "cut",
    "undo",
    "redo",
    "refresh",
    "stop",
    "start",
    "pause",
    "play",
  ].map((w) => w.toLowerCase())
);

/** CFBundle* keys that are technical (versions, ids) — always skip. */
const CFBUNDLE_TECH_KEY_RE =
  /^CFBundle(?!(DisplayName|Name|SpokenName)$)/i;

/**
 * True for short Title-Case / camelCase brand-like phrases
 * e.g. "Epson iPrint", "AirPrint", "Wi-Fi".
 */
function looksLikeProperNounOrBrand(v: string): boolean {
  if (v.length < 2 || v.length > 36) return false;
  if (/[.!?…]/.test(v)) return false;
  if (/%[@dioxXufFeEgGaAcspSn%]/.test(v)) return false;
  const words = v.trim().split(/\s+/);
  if (words.length === 0 || words.length > 4) return false;

  for (const w of words) {
    if (UI_FUNCTION_WORDS.has(w.toLowerCase())) return false;
  }

  // Every word starts with a letter; prefer capitals / iPhone-style camel
  let capitalish = 0;
  for (const w of words) {
    if (!/^[\p{L}][\p{L}\p{N}'’.-]*$/u.test(w)) return false;
    if (/^[A-Z]/.test(w) || /^[a-z][A-Z]/.test(w)) capitalish++;
  }
  if (capitalish < Math.ceil(words.length * 0.6)) return false;

  // Single all-lowercase dictionary-ish word → not a brand skip
  if (words.length === 1 && /^[a-z]+$/.test(words[0])) return false;

  return true;
}

export function shouldSkipTranslation(
  value: string,
  key?: string
): { skip: boolean; reason?: string } {
  const v = value.trim();
  const k = (key || "").trim();

  if (k) {
    if (CFBUNDLE_TECH_KEY_RE.test(k)) {
      return { skip: true, reason: "cfbundle-tech" };
    }
    // Bundle display/name keys are almost always product/brand names
    if (/^CFBundle(DisplayName|Name|SpokenName)$/i.test(k)) {
      return { skip: true, reason: "brand" };
    }
  }

  if (!v) return { skip: true, reason: "empty" };
  if (v.length <= 1) return { skip: true, reason: "too-short" };
  if (URL_RE.test(v) || /^https?:\/\//i.test(v))
    return { skip: true, reason: "url" };
  if (EMAIL_RE.test(v)) return { skip: true, reason: "email" };
  if (BUNDLE_ID_RE.test(v) && v.includes(".") && !/\s/.test(v))
    return { skip: true, reason: "bundle-id" };
  if (PATH_RE.test(v)) return { skip: true, reason: "path" };
  if (HEX_COLOR_RE.test(v)) return { skip: true, reason: "color" };
  if (NUMERIC_RE.test(v)) return { skip: true, reason: "numeric" };
  if (ONLY_SYMBOLS_RE.test(v)) return { skip: true, reason: "symbols" };
  if (UUID_RE.test(v)) return { skip: true, reason: "uuid" };
  if (/^(%[@dioxXufFeEgGaAcspSn%]|%%|\s)+$/.test(v))
    return { skip: true, reason: "format-only" };
  if (VERSION_RE.test(v)) return { skip: true, reason: "version" };
  if (PRODUCT_CODE_RE.test(v) && /[0-9]/.test(v) && !/\s/.test(v))
    return { skip: true, reason: "product-code" };
  if (looksLikeProperNounOrBrand(v))
    return { skip: true, reason: "proper-noun" };

  return { skip: false };
}

/** True when ≥50% of letters are Arabic script (U+0600–U+06FF). */
export function isMostlyArabic(text: string): boolean {
  const letters = text.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return false;
  const arabic = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return arabic / letters.length >= 0.5;
}
