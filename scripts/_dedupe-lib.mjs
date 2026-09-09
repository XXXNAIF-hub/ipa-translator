/**
 * Node-friendly mirror of ipa-parser locale filter + dedupe + caps for CI smoke.
 * Kept in sync with src/lib/ipa-parser.ts defaults.
 */
import JSZip from "jszip";

export const BINARY_STRING_CAP = 200;
export const DEFAULT_MAX_STRINGS = 1500;

const KNOWN_UI_WORDS = new Set(
  [
    "OK", "Cancel", "Done", "Save", "Delete", "Edit", "Back", "Next", "Close",
    "Search", "Share", "Print", "Settings", "Help", "Home", "More", "Retry",
    "Continue", "Skip", "Yes", "No", "Error", "Warning", "Info", "Login",
    "Logout", "Register", "Submit", "Apply", "Reset", "Clear", "Copy", "Paste",
    "Cut", "Undo", "Redo", "Refresh", "Reload", "Stop", "Start", "Pause",
    "Play", "Open", "Send", "Add", "Remove", "Select", "All", "None",
  ].map((w) => w.toLowerCase())
);

function localeFromPath(filePath) {
  const m = filePath.match(/\/([A-Za-z]{2}(?:[-_][A-Za-z0-9]+)?)\.lproj\//);
  if (m) return m[1].replace("_", "-");
  if (/\/Base\.lproj\//i.test(filePath)) return "Base";
  if (filePath.endsWith(".xcstrings")) return "xcstrings";
  return "unknown";
}

function parseStringsFile(content, filePath, locale) {
  const results = [];
  const cleaned = content.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/^\s*\/\/.*$/gm, "");
  const pairRe = /"((?:\\.|[^"\\])*)"\s*=\s*"((?:\\.|[^"\\])*)"\s*;/g;
  let m;
  let idx = 0;
  while ((m = pairRe.exec(cleaned)) !== null) {
    results.push({
      id: `${filePath}::${m[1]}::${idx}`,
      key: m[1],
      value: m[2],
      locale,
      filePath,
    });
    idx++;
  }
  return results;
}

export function localePriority(locale) {
  const l = (locale || "").toLowerCase().replace(/_/g, "-");
  if (l === "base") return 0;
  if (l === "en" || l === "en-us") return 1;
  if (l === "en-gb" || l === "en-au" || l === "en-ca") return 2;
  if (l.startsWith("en")) return 3;
  if (l === "xcstrings" || l === "unknown") return 50;
  return 100;
}

export function isBaseOrEnglishLocale(locale) {
  const l = (locale || "").toLowerCase().replace(/_/g, "-");
  return l === "base" || l === "en" || l.startsWith("en-") || l.startsWith("en_");
}

export function localizationIdentity(s) {
  const path = s.filePath.split("#")[0];
  const stripped = path
    .replace(/\/[A-Za-z]{2}(?:[-_][A-Za-z0-9]+)?\.lproj\//gi, "/")
    .replace(/\/Base\.lproj\//gi, "/");
  return `${stripped}::${s.key}`;
}

export function dedupeLocalizedStrings(strings) {
  const byIdentity = new Map();
  for (const s of strings) {
    const id = localizationIdentity(s);
    const prev = byIdentity.get(id);
    if (!prev || localePriority(s.locale) < localePriority(prev.locale)) {
      byIdentity.set(id, s);
    }
  }
  const byKeyVal = new Map();
  for (const s of byIdentity.values()) {
    const k = `${s.key}::${s.value}`;
    const prev = byKeyVal.get(k);
    if (!prev || localePriority(s.locale) < localePriority(prev.locale)) {
      byKeyVal.set(k, s);
    }
  }
  return Array.from(byKeyVal.values());
}

export function isLikelyUiPhrase(s) {
  const v = s.trim();
  if (v.length < 2 || v.length > 60) return false;
  if (KNOWN_UI_WORDS.has(v.toLowerCase()) && v.length <= 20 && !/\s/.test(v)) {
    return /^[\x20-\x7E]+$/.test(v);
  }
  if (v.length < 4) return false;
  if (!/[A-Za-z]/.test(v)) return false;
  if (/https?:\/\//i.test(v)) return false;
  if (/^[a-z0-9]+(\.[a-z0-9]+){2,}$/i.test(v)) return false;
  if (/^\/[\w./-]+$/.test(v)) return false;
  if (/^[_A-Z][A-Z0-9_]{4,}$/.test(v)) return false;
  if (/^[a-f0-9]{8,}$/i.test(v)) return false;
  if (!/\s/.test(v) && /^[a-z]+(?:[A-Z][a-z0-9]+)+$/.test(v)) return false;
  if (!/^[\x20-\x7E]+$/.test(v)) return false;
  if (/\s/.test(v)) return !/\/|\\|\.app\b/i.test(v);
  return /^[A-Z][a-z]{2,}$/.test(v);
}

export function extractBinaryUiPhrases(buf, filePath, cap = BINARY_STRING_CAP) {
  const results = [];
  const seen = new Set();
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
    if (!isLikelyUiPhrase(s) || seen.has(s)) continue;
    seen.add(s);
    results.push({
      id: `${filePath}::bin::${results.length}`,
      key: s,
      value: s,
      locale: "en",
      filePath: `${filePath}#binary`,
    });
  }
  return results;
}

function localeMatchesFilter(locale, filter) {
  if (filter === "all") return true;
  const l = (locale || "").toLowerCase().replace(/_/g, "-");
  if (l === "xcstrings" || l === "unknown") return true;
  if (filter === "base-en") return isBaseOrEnglishLocale(locale) || l === "en";
  return false;
}

export async function parseIpaArrayBuffer(buffer, options = {}) {
  const localeFilter = options.localeFilter ?? "base-en";
  const enableBinary = options.enableBinaryExtraction === true;
  const binaryCap = Math.min(options.binaryCap ?? BINARY_STRING_CAP, BINARY_STRING_CAP);
  const maxStrings =
    options.maxStrings === 0 || options.maxStrings === Infinity
      ? Infinity
      : (options.maxStrings ?? DEFAULT_MAX_STRINGS);

  const zip = await JSZip.loadAsync(buffer);
  const strings = [];
  const localeSet = new Set();
  const notes = [];
  let localizationFileCount = 0;
  const files = [];
  let appName = null;

  const allPaths = [];
  zip.forEach((p) => allPaths.push(p));
  for (const p of allPaths) {
    const m = p.match(/^Payload\/([^/]+)\.app\//);
    if (m) {
      appName = m[1];
      break;
    }
  }

  for (const path of allPaths) {
    const entry = zip.files[path];
    if (!entry || entry.dir) continue;
    if (path.includes("__MACOSX")) continue;
    const lower = path.toLowerCase();
    if (lower.endsWith(".strings") && !lower.endsWith(".stringsdict")) {
      localizationFileCount++;
      files.push(path);
      const locale = localeFromPath("/" + path);
      if (locale !== "unknown") localeSet.add(locale);
      const data = await entry.async("uint8array");
      const text = new TextDecoder("utf-8").decode(data);
      strings.push(...parseStringsFile(text, path, locale));
    }
  }

  const allLocales = Array.from(localeSet).sort();
  const rawBeforeFilter = strings.length;
  let filtered = strings.filter((s) => localeMatchesFilter(s.locale, localeFilter));
  filtered = dedupeLocalizedStrings(filtered);

  if (localizationFileCount === 0 && enableBinary) {
    const binPath = allPaths.find((p) => {
      if (!/Payload\/[^/]+\.app\/[^/]+$/.test(p) || p.endsWith("/")) return false;
      const base = p.split("/").pop() || "";
      return base.length > 0 && !base.includes(".");
    });
    if (binPath) {
      const data = await zip.file(binPath).async("uint8array");
      const extracted = extractBinaryUiPhrases(data, binPath, binaryCap);
      filtered = dedupeLocalizedStrings([...filtered, ...extracted]);
      notes.push(`Binary extract: ${extracted.length}`);
    }
  } else if (localizationFileCount === 0 && !enableBinary) {
    notes.push("binary extraction is OFF by default");
  }

  // plist display
  const plistPath = allPaths.find((p) => /Payload\/[^/]+\.app\/Info\.plist$/i.test(p));
  if (plistPath) {
    const text = new TextDecoder("utf-8").decode(await zip.file(plistPath).async("uint8array"));
    const keyValRe = /<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/gi;
    let m;
    while ((m = keyValRe.exec(text)) !== null) {
      if (/CFBundleDisplayName|CFBundleName|UsageDescription$/i.test(m[1])) {
        filtered.push({
          id: `${plistPath}::${m[1]}`,
          key: m[1],
          value: m[2],
          locale: "en",
          filePath: `${plistPath}#plist`,
        });
      }
    }
    filtered = dedupeLocalizedStrings(filtered);
  }

  let truncated = false;
  let truncatedFrom;
  let unique = filtered;
  if (unique.length > maxStrings && Number.isFinite(maxStrings)) {
    truncatedFrom = unique.length;
    unique = unique.slice(0, maxStrings);
    truncated = true;
  }

  return {
    appName,
    locales: Array.from(new Set(unique.map((s) => s.locale))).sort(),
    allLocales,
    stringCount: unique.length,
    rawStringCount: rawBeforeFilter,
    strings: unique,
    files,
    extractionNotes: notes,
    truncated,
    truncatedFrom,
  };
}
