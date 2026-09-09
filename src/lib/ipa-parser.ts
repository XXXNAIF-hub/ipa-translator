import JSZip from "jszip";
import {
  decodeBytes,
  localeFromPath,
  parseStringsFile,
  parseXcstringsFile,
} from "./strings-parser";
import { shouldSkipTranslation } from "./skip-heuristics";
import type { LocalizedString, ParseResult } from "./types";

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB
/** Cap for last-resort Mach-O / binary UI phrase extraction. */
export const BINARY_STRING_CAP = 500;
/** Small text-like files scanned for quoted UI strings (bytes). */
const SMALL_TEXT_MAX = 64 * 1024;
/** Binary scan: only consider main executable under this size. */
const BINARY_SCAN_MAX = 40 * 1024 * 1024;

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
  // unnamed small files that look like text
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
    const { skip, reason } = shouldSkipTranslation(value);
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
  // Also any *UsageDescription keys
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
    const { skip, reason } = shouldSkipTranslation(value);
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
 * Latin UI phrases: length 3–80, has spaces OR Title Case word(s).
 * Used as last resort from Mach-O readable strings.
 */
export function isLikelyUiPhrase(s: string): boolean {
  const v = s.trim();
  if (v.length < 3 || v.length > 80) return false;
  if (!/[A-Za-z]/.test(v)) return false;
  // Reject paths, URLs, bundle-ish
  if (/https?:\/\//i.test(v)) return false;
  if (/^[a-z0-9]+(\.[a-z0-9]+){2,}$/i.test(v)) return false;
  if (/^\/[\w./-]+$/.test(v)) return false;
  if (/^[_A-Z][A-Z0-9_]{4,}$/.test(v)) return false; // CONSTANTS
  if (/^[a-f0-9]{16,}$/i.test(v)) return false;
  if (/[%$\\{}<>]/.test(v) && !/%[@dioxdufFeEgGcs%]/.test(v)) {
    // allow format placeholders; reject code-like
    if (/[{}<>\\]/.test(v)) return false;
  }
  const hasSpace = /\s/.test(v);
  const titleCase =
    /^[A-Z][a-zA-Z0-9]*(?:\s+[A-Z][a-zA-Z0-9]*)+$/.test(v) ||
    /^[A-Z][a-z]+(?:\s+[A-Za-z][a-z]*)*$/.test(v);
  if (!hasSpace && !titleCase) return false;
  // Must be mostly printable letters/spaces/punct
  if (!/^[\x20-\x7E]+$/.test(v)) return false;
  return true;
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
  while (i < n && results.length < cap) {
    // find printable run
    while (i < n && (buf[i] < 32 || buf[i] >= 127)) i++;
    const start = i;
    while (i < n && buf[i] >= 32 && buf[i] < 127) i++;
    const len = i - start;
    if (len < 3 || len > 80) continue;
    let s = "";
    for (let j = start; j < i; j++) s += String.fromCharCode(buf[j]);
    s = s.trim();
    if (!isLikelyUiPhrase(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    const { skip, reason } = shouldSkipTranslation(s);
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

/** Parse an IPA (ZIP) entirely in-memory in the browser via JSZip. */
export async function parseIpaArrayBuffer(
  buffer: ArrayBuffer
): Promise<ParseResult> {
  assertIpaSize(buffer.byteLength);

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
      // Only XML plists (binary plists won't match)
      if (text.includes("<plist") || text.includes("<?xml")) {
        const fromPlist = extractPlistDisplayStrings(text, path);
        if (fromPlist.length) {
          strings.push(...fromPlist);
          notes.push(`Info.plist: ${fromPlist.length} display/usage strings`);
        }
      }
      continue;
    }

    // Small text-like files: pull quoted UI strings
    if (isProbablyTextFile(path, data) && !isLocalizationFile(path)) {
      const text = decodeBytes(data);
      const quoted = extractQuotedUiStrings(text, path, "en", "text");
      if (quoted.length) {
        strings.push(...quoted);
        files.push(path);
      }
    }
  }

  // Pass 2: last resort — Mach-O / main binary if no localization files
  if (localizationFileCount === 0) {
    notes.push(
      "No .strings/.xcstrings found — trying binary UI phrase extraction (cap " +
        BINARY_STRING_CAP +
        ")."
    );
    const execPath = findMainExecutablePath(
      allPaths,
      appName,
      mainPlistText
    );
    const binaryCandidates = execPath
      ? [execPath]
      : allPaths.filter(
          (p) =>
            /Payload\/[^/]+\.app\/[^/]+$/.test(p) &&
            !p.includes(".") &&
            !p.endsWith("/")
        );

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
      // Mach-O magic: feedcafe / cffaedfe / etc. or just any large binary
      const extracted = extractBinaryUiPhrases(
        data,
        binPath,
        BINARY_STRING_CAP
      );
      if (extracted.length) {
        strings.push(...extracted);
        files.push(binPath + "#binary");
        notes.push(
          `Binary extract from ${binPath}: ${extracted.length} phrases (cap ${BINARY_STRING_CAP}).`
        );
        break;
      }
    }
  }

  // Deduplicate by key+value (keep first)
  const dedup = new Map<string, LocalizedString>();
  for (const s of strings) {
    const k = `${s.key}::${s.value}`;
    if (!dedup.has(k)) dedup.set(k, s);
  }
  const unique = Array.from(dedup.values());

  if (unique.length === 0) {
    throw new Error(
      "لم يتم العثور على نصوص قابلة للترجمة داخل الـ IPA. " +
        "الحدود: ملفات .strings/.xcstrings، Info.plist (XML)، ملفات نصية صغيرة، " +
        `أو استخراج محدود من الثنائي (حد ${BINARY_STRING_CAP} عبارة). ` +
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
    locales: Array.from(localeSet).sort(),
    stringCount: unique.length,
    strings: unique,
    files,
    extractionNotes: notes,
  };
}
