import JSZip from "jszip";
import {
  decodeBytes,
  localeFromPath,
  parseStringsFile,
  parseXcstringsFile,
} from "./strings-parser";
import { shouldSkipTranslation } from "./skip-heuristics";
import type { LocalizedString, ParseOptions, ParseResult } from "./types";

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB
/** Hard cap for last-resort Mach-O / binary UI phrase extraction. */
export const BINARY_STRING_CAP = 200;
/** Default translate-list cap after locale filter + dedupe. */
export const DEFAULT_MAX_STRINGS = 1500;
/** Small text-like files scanned for quoted UI strings (bytes). */
const SMALL_TEXT_MAX = 64 * 1024;
/** Binary scan: only consider main executable under this size. */
const BINARY_SCAN_MAX = 40 * 1024 * 1024;

/** Short single-token UI labels allowed from binary without spaces. */
const KNOWN_UI_WORDS = new Set(
  [
    "OK",
    "Cancel",
    "Done",
    "Save",
    "Delete",
    "Edit",
    "Back",
    "Next",
    "Close",
    "Search",
    "Share",
    "Print",
    "Settings",
    "Help",
    "Home",
    "More",
    "Retry",
    "Continue",
    "Skip",
    "Yes",
    "No",
    "Error",
    "Warning",
    "Info",
    "Login",
    "Logout",
    "Register",
    "Submit",
    "Apply",
    "Reset",
    "Clear",
    "Copy",
    "Paste",
    "Cut",
    "Undo",
    "Redo",
    "Refresh",
    "Reload",
    "Stop",
    "Start",
    "Pause",
    "Play",
    "Open",
    "Send",
    "Add",
    "Remove",
    "Select",
    "All",
    "None",
  ].map((w) => w.toLowerCase())
);

export function assertIpaSize(size: number) {
  if (size > MAX_BYTES) {
    throw new Error(
      `حجم الملف كبير جداً (${(size / 1024 / 1024).toFixed(1)} ميجابايت). الحد الأقصى 200 ميجابايت.`
    );
  }
  if (size < 64) {
    throw new Error("الملف صغير جداً أو تالف.");
  }
}

function guessAppName(entries: string[]): string | null {
  for (const p of entries) {
    const m = p.match(/^Payload\/([^/]+)\.app\//);
    if (m) return m[1];
  }
  return null;
}

function isLocalizationFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith(".strings") && !lower.endsWith(".stringsdict"))
    return true;
  if (lower.endsWith(".xcstrings")) return true;
  return false;
}

function isInfoPlist(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith("/info.plist") ||
    lower.endsWith("info.plist") ||
    /\/Payload\/[^/]+\.app\/Info\.plist$/i.test(path)
  );
}

function printableRatio(buf: Uint8Array): number {
  if (buf.length === 0) return 0;
  let ok = 0;
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) ok++;
  }
  return ok / n;
}

function isProbablyTextFile(path: string, buf: Uint8Array): boolean {
  if (buf.length === 0 || buf.length > SMALL_TEXT_MAX) return false;
  const lower = path.toLowerCase();
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".car") ||
    lower.endsWith(".nib") ||
    lower.endsWith(".storyboardc") ||
    lower.endsWith(".dylib") ||
    lower.endsWith(".framework") ||
    lower.endsWith(".mo") ||
    lower.endsWith(".bin")
  ) {
    return false;
  }
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".json") ||
    lower.endsWith(".plist") ||
    lower.endsWith(".xml") ||
    lower.endsWith(".html") ||
    lower.endsWith(".js") ||
    lower.endsWith(".css") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".md")
  ) {
    return printableRatio(buf) > 0.85;
  }
  return printableRatio(buf) > 0.92;
}

const QUOTED_RE = /"([^"\\]{3,80})"/g;

function extractQuotedUiStrings(
  text: string,
  filePath: string,
  locale: string,
  sourceTag: string
): LocalizedString[] {
  const results: LocalizedString[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  let idx = 0;
  QUOTED_RE.lastIndex = 0;
  while ((m = QUOTED_RE.exec(text)) !== null) {
    const value = m[1].trim();
    if (!isLikelyUiPhrase(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    const { skip, reason } = shouldSkipTranslation(value, value);
    results.push({
      id: `${filePath}::quoted::${idx}`,
      key: value,
      value,
      locale,
      filePath: `${filePath}#${sourceTag}`,
      skip,
      skipReason: reason,
    });
    idx++;
  }
  return results;
}

/** CFBundleDisplayName / CFBundleName / usage descriptions from XML plist. */
function extractPlistDisplayStrings(
  text: string,
  filePath: string
): LocalizedString[] {
  const results: LocalizedString[] = [];
  const interestingKeys = [
    "CFBundleDisplayName",
    "CFBundleName",
    "CFBundleSpokenName",
    "NSHumanReadableCopyright",
  ];
  const keyValRe =
    /<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = keyValRe.exec(text)) !== null) {
    const key = m[1].trim();
    const value = m[2].trim();
    const interesting =
      interestingKeys.includes(key) ||
      /UsageDescription$/i.test(key) ||
      /^CFBundle(DisplayName|Name)$/i.test(key);
    if (!interesting) continue;
    if (!value || value.length < 2) continue;
    const { skip, reason } = shouldSkipTranslation(value, key);
    results.push({
      id: `${filePath}::plist::${key}::${idx}`,
      key,
      value,
      locale: "en",
      filePath: `${filePath}#plist`,
      skip,
      skipReason: reason,
    });
    idx++;
  }
  return results;
}

/**
 * Latin UI phrases for binary scrape: length 4–60, has spaces OR Title-Case
 * multi-word OR known short UI word. Excludes paths, URLs, camelCase ids, hex.
 */
export function isLikelyUiPhrase(s: string): boolean {
  const v = s.trim();
  if (v.length < 2 || v.length > 60) return false;
  // Known short UI labels (OK, No, …) bypass the 4-char minimum
  if (KNOWN_UI_WORDS.has(v.toLowerCase()) && v.length <= 20 && !/\s/.test(v)) {
    return /^[\x20-\x7E]+$/.test(v);
  }
  if (v.length < 4) return false;
  if (!/[A-Za-z]/.test(v)) return false;
  if (/https?:\/\//i.test(v)) return false;
  if (/^[a-z0-9]+(\.[a-z0-9]+){2,}$/i.test(v)) return false;
  if (/^\/[\w./-]+$/.test(v)) return false;
  if (/\\|\.\.\/|[\w-]+\.(png|jpg|jpeg|gif|json|plist|nib|storyboard)/i.test(v))
    return false;
  if (/^[_A-Z][A-Z0-9_]{4,}$/.test(v)) return false; // CONSTANTS
  if (/^[a-f0-9]{8,}$/i.test(v)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(v)) return false;
  // camelCase / PascalCase identifiers without spaces (e.g. viewDidLoad, NSError)
  if (!/\s/.test(v) && /^[A-Za-z][A-Za-z0-9]*[a-z][A-Z][A-Za-z0-9]*$/.test(v))
    return false;
  if (!/\s/.test(v) && /^[a-z]+(?:[A-Z][a-z0-9]+)+$/.test(v)) return false;
  if (/[%$\\{}<>]/.test(v) && !/%[@dioxdufFeEgGcs%]/.test(v)) {
    if (/[{}<>\\]/.test(v)) return false;
  }
  if (!/^[\x20-\x7E]+$/.test(v)) return false;

  const hasSpace = /\s/.test(v);
  if (hasSpace) {
    // Prefer readable phrases, not path fragments with spaces
    if (/\/|\\|\.app\b/i.test(v)) return false;
    return true;
  }

  // Single token: Title Case word OR known UI word
  if (KNOWN_UI_WORDS.has(v.toLowerCase())) return true;
  const titleCaseWord = /^[A-Z][a-z]{2,}$/.test(v);
  const titleCasePhrase =
    /^[A-Z][a-zA-Z0-9]*(?:\s+[A-Z][a-zA-Z0-9]*)+$/.test(v) ||
    /^[A-Z][a-z]+(?:\s+[A-Za-z][a-z]*)*$/.test(v);
  if (titleCasePhrase) return true;
  // Single Title-Case token alone is weak — only if length ≥ 4 and not all-caps API-ish
  if (titleCaseWord && v.length >= 4 && v.length <= 20) return true;
  return false;
}

/** Extract C-strings from a binary buffer (ASCII runs). */
export function extractBinaryUiPhrases(
  buf: Uint8Array,
  filePath: string,
  cap = BINARY_STRING_CAP
): LocalizedString[] {
  const results: LocalizedString[] = [];
  const seen = new Set<string>();
  let i = 0;
  const n = buf.length;
  const hardCap = Math.min(cap, BINARY_STRING_CAP);
  while (i < n && results.length < hardCap) {
    while (i < n && (buf[i] < 32 || buf[i] >= 127)) i++;
    const start = i;
    while (i < n && buf[i] >= 32 && buf[i] < 127) i++;
    const len = i - start;
    if (len < 4 || len > 60) continue;
    let s = "";
    for (let j = start; j < i; j++) s += String.fromCharCode(buf[j]);
    s = s.trim();
    if (!isLikelyUiPhrase(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    const { skip, reason } = shouldSkipTranslation(s, s);
    results.push({
      id: `${filePath}::bin::${results.length}`,
      key: s,
      value: s,
      locale: "en",
      filePath: `${filePath}#binary`,
      skip,
      skipReason: reason,
    });
  }
  return results;
}

function findMainExecutablePath(
  allPaths: string[],
  appName: string | null,
  plistText: string | null
): string | null {
  let execName: string | null = null;
  if (plistText) {
    const m = plistText.match(
      /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/i
    );
    if (m) execName = m[1].trim();
  }
  if (!execName && appName) execName = appName;
  if (!execName) return null;
  const candidates = allPaths.filter(
    (p) =>
      p === `Payload/${appName}.app/${execName}` ||
      p.endsWith(`.app/${execName}`)
  );
  return candidates[0] || null;
}

/** Lower number = preferred when same key appears in many locales. */
export function localePriority(locale: string): number {
  const l = (locale || "").toLowerCase().replace(/_/g, "-");
  if (l === "base") return 0;
  if (l === "en" || l === "en-us") return 1;
  if (l === "en-gb" || l === "en-au" || l === "en-ca") return 2;
  if (l.startsWith("en")) return 3;
  if (l === "xcstrings" || l === "unknown") return 50;
  return 100;
}

export function isBaseOrEnglishLocale(locale: string): boolean {
  const l = (locale || "").toLowerCase().replace(/_/g, "-");
  return l === "base" || l === "en" || l.startsWith("en-") || l.startsWith("en_");
}

function normalizeLocaleFilter(
  filter: ParseOptions["localeFilter"]
): "base-en" | "all" | Set<string> {
  if (!filter || filter === "base-en") return "base-en";
  if (filter === "all") return "all";
  return new Set(filter.map((x) => x.toLowerCase().replace(/_/g, "-")));
}

function localeMatchesFilter(
  locale: string,
  filter: ReturnType<typeof normalizeLocaleFilter>
): boolean {
  if (filter === "all") return true;
  const l = (locale || "").toLowerCase().replace(/_/g, "-");
  // Always keep plist/binary/text extractions tagged en / unknown / xcstrings
  if (l === "xcstrings" || l === "unknown") return true;
  if (filter === "base-en") return isBaseOrEnglishLocale(locale) || l === "en";
  if (filter.has(l)) return true;
  if (filter.has("base") && l === "base") return true;
  if (filter.has("en") && (l === "en" || l.startsWith("en-"))) return true;
  return false;
}

/**
 * Identity for cross-locale key dedupe: strip *.lproj so the same
 * Localizable.strings key across en/fr/de collapses to one.
 */
export function localizationIdentity(s: LocalizedString): string {
  const path = s.filePath.split("#")[0];
  const stripped = path
    .replace(/\/[A-Za-z]{2}(?:[-_][A-Za-z0-9]+)?\.lproj\//gi, "/")
    .replace(/\/Base\.lproj\//gi, "/");
  return `${stripped}::${s.key}`;
}

/**
 * Prefer Base / en over other locales for the same key; then identical key+value.
 */
export function dedupeLocalizedStrings(
  strings: LocalizedString[]
): LocalizedString[] {
  const byIdentity = new Map<string, LocalizedString>();
  for (const s of strings) {
    const id = localizationIdentity(s);
    const prev = byIdentity.get(id);
    if (!prev) {
      byIdentity.set(id, s);
      continue;
    }
    const pNew = localePriority(s.locale);
    const pOld = localePriority(prev.locale);
    if (pNew < pOld) {
      byIdentity.set(id, s);
    }
  }

  // Second pass: identical key+value across different files
  const byKeyVal = new Map<string, LocalizedString>();
  for (const s of byIdentity.values()) {
    const k = `${s.key}::${s.value}`;
    const prev = byKeyVal.get(k);
    if (!prev) {
      byKeyVal.set(k, s);
      continue;
    }
    if (localePriority(s.locale) < localePriority(prev.locale)) {
      byKeyVal.set(k, s);
    }
  }
  return Array.from(byKeyVal.values());
}

/** Parse an IPA (ZIP) entirely in-memory in the browser via JSZip. */
export async function parseIpaArrayBuffer(
  buffer: ArrayBuffer,
  options: ParseOptions = {}
): Promise<ParseResult> {
  assertIpaSize(buffer.byteLength);

  const localeFilter = normalizeLocaleFilter(options.localeFilter ?? "base-en");
  const enableBinary = options.enableBinaryExtraction === true;
  const binaryCap = Math.min(
    options.binaryCap ?? BINARY_STRING_CAP,
    BINARY_STRING_CAP
  );
  const maxStrings =
    options.maxStrings === 0 || options.maxStrings === Infinity
      ? Infinity
      : (options.maxStrings ?? DEFAULT_MAX_STRINGS);

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error(
      "تعذر فتح ملف IPA. تأكد أنه ملف IPA صالح (صيغة ZIP)."
    );
  }

  const allPaths: string[] = [];
  zip.forEach((relativePath) => {
    allPaths.push(relativePath);
  });
  const appName = guessAppName(allPaths);

  const strings: LocalizedString[] = [];
  const files: string[] = [];
  const localeSet = new Set<string>();
  const notes: string[] = [];
  let localizationFileCount = 0;
  let mainPlistText: string | null = null;

  const entries = Object.values(zip.files);

  // Pass 1: classic localization + Info.plist + small text
  for (const entry of entries) {
    if (entry.dir) continue;
    const path = entry.name;
    if (path.includes("__MACOSX") || path.includes(".DS_Store")) continue;

    let data: Uint8Array;
    try {
      data = await entry.async("uint8array");
    } catch {
      continue;
    }

    if (isLocalizationFile(path)) {
      localizationFileCount++;
      files.push(path);
      const locale = localeFromPath("/" + path);
      if (locale !== "unknown" && locale !== "xcstrings") {
        localeSet.add(locale);
      }

      if (path.toLowerCase().endsWith(".xcstrings")) {
        const text = new TextDecoder("utf-8").decode(data);
        const parsed = parseXcstringsFile(text, path);
        for (const s of parsed) {
          strings.push(s);
          if (s.locale) localeSet.add(s.locale);
        }
      } else {
        const text = decodeBytes(data);
        const parsed = parseStringsFile(text, path, locale);
        strings.push(...parsed);
      }
      continue;
    }

    if (isInfoPlist(path) && data.length < SMALL_TEXT_MAX) {
      const text = decodeBytes(data);
      if (path.match(/Payload\/[^/]+\.app\/Info\.plist$/i)) {
        mainPlistText = text;
      }
      if (text.includes("<plist") || text.includes("<?xml")) {
        const fromPlist = extractPlistDisplayStrings(text, path);
        if (fromPlist.length) {
          strings.push(...fromPlist);
          notes.push(`Info.plist: ${fromPlist.length} display/usage strings`);
        }
      }
      continue;
    }

    if (isProbablyTextFile(path, data) && !isLocalizationFile(path)) {
      const text = decodeBytes(data);
      const quoted = extractQuotedUiStrings(text, path, "en", "text");
      if (quoted.length) {
        strings.push(...quoted);
        files.push(path);
      }
    }
  }

  const allLocales = Array.from(localeSet).sort();
  const rawBeforeFilter = strings.length;

  // Locale filter (default: Base / English only — stops multi-lproj explosion)
  let filtered = strings.filter((s) =>
    localeMatchesFilter(s.locale, localeFilter)
  );
  const afterLocale = filtered.length;
  if (localeFilter === "base-en") {
    notes.push(
      `Locale filter: Base/en only (${rawBeforeFilter} → ${afterLocale} before key dedupe).`
    );
  } else if (localeFilter !== "all") {
    notes.push(
      `Locale filter: custom (${rawBeforeFilter} → ${afterLocale} before key dedupe).`
    );
  }

  // Prefer Base/en when same key appears in many locales; drop identical key+value
  filtered = dedupeLocalizedStrings(filtered);
  notes.push(
    `Key dedupe (prefer Base/en): ${afterLocale} → ${filtered.length}.`
  );

  // Pass 2: last resort — Mach-O / main binary ONLY if enabled AND no localization
  if (localizationFileCount === 0 && enableBinary) {
    notes.push(
      `No .strings/.xcstrings — binary UI extraction enabled (cap ${binaryCap}).`
    );
    const execPath = findMainExecutablePath(
      allPaths,
      appName,
      mainPlistText
    );
    const binaryCandidates = execPath
      ? [execPath]
      : allPaths.filter((p) => {
          if (!/Payload\/[^/]+\.app\/[^/]+$/.test(p) || p.endsWith("/"))
            return false;
          const base = p.split("/").pop() || "";
          // Filename must have no extension (ignore ".app" in parent folders)
          return base.length > 0 && !base.includes(".");
        });

    for (const binPath of binaryCandidates) {
      const entry = zip.file(binPath);
      if (!entry) continue;
      let data: Uint8Array;
      try {
        data = await entry.async("uint8array");
      } catch {
        continue;
      }
      if (data.length > BINARY_SCAN_MAX) {
        notes.push(
          `Skipped ${binPath} (${(data.length / 1024 / 1024).toFixed(1)}MB > scan limit).`
        );
        continue;
      }
      const extracted = extractBinaryUiPhrases(data, binPath, binaryCap);
      if (extracted.length) {
        filtered = dedupeLocalizedStrings([...filtered, ...extracted]);
        files.push(binPath + "#binary");
        notes.push(
          `Binary extract from ${binPath}: ${extracted.length} phrases (cap ${binaryCap}).`
        );
        break;
      }
    }
  } else if (localizationFileCount === 0 && !enableBinary) {
    notes.push(
      "No .strings/.xcstrings found — binary extraction is OFF by default (enable in options)."
    );
  }

  const rawStringCount = rawBeforeFilter;
  let truncated = false;
  let truncatedFrom: number | undefined;
  let unique = filtered;

  if (unique.length > maxStrings && Number.isFinite(maxStrings)) {
    truncatedFrom = unique.length;
    unique = unique.slice(0, maxStrings);
    truncated = true;
    notes.push(
      `Translate list capped at ${maxStrings} (was ${truncatedFrom}).`
    );
  }

  if (unique.length === 0) {
    throw new Error(
      "لم يتم العثور على نصوص قابلة للترجمة داخل الـ IPA. " +
        "الحدود: ملفات .strings/.xcstrings (افتراضياً Base/en فقط)، Info.plist (XML)، ملفات نصية صغيرة. " +
        `استخراج الثنائي معطّل افتراضياً (حد ${BINARY_STRING_CAP} عند التفعيل). ` +
        "ملفات plist الثنائية وواجهات SwiftUI المجمّعة قد لا تُستخرج."
    );
  }

  if (notes.length === 0 && localizationFileCount > 0) {
    notes.push(
      `Extracted from ${localizationFileCount} localization file(s).`
    );
  }

  return {
    appName,
    locales: Array.from(
      new Set(unique.map((s) => s.locale).filter(Boolean))
    ).sort(),
    allLocales,
    stringCount: unique.length,
    rawStringCount,
    strings: unique,
    files,
    extractionNotes: notes,
    truncated,
    truncatedFrom,
  };
}
