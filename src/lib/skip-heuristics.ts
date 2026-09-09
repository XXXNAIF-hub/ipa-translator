/**
 * Heuristics for strings that should not be machine-translated.
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

export function shouldSkipTranslation(
  value: string
): { skip: boolean; reason?: string } {
  const v = value.trim();
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
  // Mostly placeholders / format-only
  if (/^(%[@dioxXufFeEgGaAcspSn%]|%%|\s)+$/.test(v))
    return { skip: true, reason: "format-only" };
  return { skip: false };
}

/** True when ≥50% of letters are Arabic script (U+0600–U+06FF). */
export function isMostlyArabic(text: string): boolean {
  const letters = text.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return false;
  const arabic = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return arabic / letters.length >= 0.5;
}
