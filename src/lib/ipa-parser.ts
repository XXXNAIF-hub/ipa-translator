import JSZip from "jszip";
import {
  decodeBytes,
  localeFromPath,
  parseStringsFile,
  parseXcstringsFile,
} from "./strings-parser";
import type { LocalizedString, ParseResult } from "./types";

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB

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
  if (lower.endsWith(".strings") && !lower.endsWith(".stringsdict")) return true;
  if (lower.endsWith(".xcstrings")) return true;
  return false;
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

  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir) continue;
    const path = entry.name;
    if (path.includes("__MACOSX") || path.includes(".DS_Store")) continue;
    if (!isLocalizationFile(path)) continue;

    let data: Uint8Array;
    try {
      data = await entry.async("uint8array");
    } catch {
      continue;
    }

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
  }

  if (strings.length === 0 && files.length === 0) {
    throw new Error(
      "لم يتم العثور على ملفات ترجمة (.strings أو .xcstrings) داخل الـ IPA."
    );
  }

  return {
    appName,
    locales: Array.from(localeSet).sort(),
    stringCount: strings.length,
    strings,
    files,
  };
}
