import JSZip from "jszip";
import { serializeStringsFile } from "./strings-parser";
import type { TranslationRow } from "./types";

/**
 * Build a ZIP mirroring *.lproj/*.strings structure for the target locale.
 * Returns a Blob suitable for browser download.
 */
export async function buildTranslationZip(
  rows: TranslationRow[],
  targetLang: string
): Promise<Blob> {
  const zip = new JSZip();

  const byFile = new Map<string, { key: string; value: string }[]>();

  for (const row of rows) {
    let outPath = row.filePath.split("#")[0];
    outPath = outPath.replace(
      /\/[A-Za-z]{2}(?:[-_][A-Za-z0-9]+)?\.lproj\//,
      `/${targetLang}.lproj/`
    );
    outPath = outPath.replace(/\/Base\.lproj\//i, `/${targetLang}.lproj/`);

    if (outPath.toLowerCase().endsWith(".xcstrings")) {
      const dir = outPath.replace(/\/[^/]+\.xcstrings$/i, "");
      outPath = `${dir}/${targetLang}.lproj/Localizable.strings`;
    }

    // Binary / plist / text extractions → single Localizable.strings under app
    if (
      outPath.includes("#") ||
      /#(binary|plist|text)$/.test(row.filePath) ||
      !outPath.includes(".lproj")
    ) {
      const appMatch = outPath.match(/^(Payload\/[^/]+\.app)\//);
      if (appMatch) {
        outPath = `${appMatch[1]}/${targetLang}.lproj/Localizable.strings`;
      } else {
        outPath = `${targetLang}.lproj/Localizable.strings`;
      }
    }

    if (!byFile.has(outPath)) byFile.set(outPath, []);
    byFile.get(outPath)!.push({
      key: row.key,
      value: row.translation,
    });
  }

  for (const [path, entries] of byFile) {
    zip.file(path, serializeStringsFile(dedupeEntries(entries)));
  }

  zip.file(
    "README.txt",
    [
      "IPA Translator — localization export",
      `Target language: ${targetLang}`,
      "",
      "These files are for legitimate localization of apps you own or have rights to.",
      "Copy the *.lproj folders into your Xcode project / app bundle as needed.",
      "This ZIP does not contain a re-signed IPA and will not install on devices.",
      "",
    ].join("\n")
  );

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
  });
}

function dedupeEntries(
  entries: { key: string; value: string }[]
): { key: string; value: string }[] {
  const map = new Map<string, string>();
  for (const e of entries) {
    if (!map.has(e.key)) map.set(e.key, e.value);
  }
  return Array.from(map.entries()).map(([key, value]) => ({ key, value }));
}

/**
 * Merge all translated keys (from every source locale / file) into one
 * Localizable.strings map. Prefer non-failed rows; first wins on key clash.
 */
export function mergeRowsToLocalizable(
  rows: TranslationRow[]
): { key: string; value: string }[] {
  const map = new Map<string, string>();
  // Pass 1: successful / skipped translations
  for (const row of rows) {
    if (row.failed) continue;
    if (!map.has(row.key)) map.set(row.key, row.translation);
  }
  // Pass 2: failed — only if key missing (keep original so file is complete)
  for (const row of rows) {
    if (!row.failed) continue;
    if (!map.has(row.key)) map.set(row.key, row.translation);
  }
  return Array.from(map.entries()).map(([key, value]) => ({ key, value }));
}

function findAppPayloadPrefix(paths: string[]): string | null {
  for (const p of paths) {
    const m = p.match(/^(Payload\/[^/]+\.app)\//);
    if (m) return m[1];
  }
  // bare Payload/Foo.app/
  for (const p of paths) {
    const m = p.match(/^(Payload\/[^/]+\.app)\/?$/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Copy the original IPA entries and inject/update
 * Payload/*.app/{lang}.lproj/Localizable.strings with merged translations.
 * Output is still a ZIP (.ipa); it is NOT re-signed — device install needs
 * the user's own signing.
 */
export async function buildTranslatedIpa(
  originalIpa: ArrayBuffer,
  rows: TranslationRow[],
  targetLang: string
): Promise<Blob> {
  const src = await JSZip.loadAsync(originalIpa);
  const out = new JSZip();

  const allPaths: string[] = [];
  const copyJobs: Promise<void>[] = [];

  src.forEach((relativePath, file) => {
    allPaths.push(relativePath);
    if (file.dir) {
      out.folder(relativePath);
      return;
    }
    copyJobs.push(
      file.async("uint8array").then((data) => {
        out.file(relativePath, data, {
          binary: true,
          date: file.date,
          unixPermissions: file.unixPermissions,
          dosPermissions: file.dosPermissions,
        });
      })
    );
  });
  await Promise.all(copyJobs);

  const appPrefix = findAppPayloadPrefix(allPaths);
  const stringsPath = appPrefix
    ? `${appPrefix}/${targetLang}.lproj/Localizable.strings`
    : `${targetLang}.lproj/Localizable.strings`;

  const merged = mergeRowsToLocalizable(rows);
  out.file(stringsPath, serializeStringsFile(merged));

  // Also drop a short note inside the IPA (harmless)
  const notePath = appPrefix
    ? `${appPrefix}/${targetLang}.lproj/README-IPA-TRANSLATOR.txt`
    : `README-IPA-TRANSLATOR.txt`;
  out.file(
    notePath,
    [
      "Generated by IPA Translator (ما يترجم).",
      `Injected: ${stringsPath}`,
      `Keys: ${merged.length}`,
      "",
      "This IPA is NOT re-signed. Installing on a device still requires YOUR",
      "own Apple signing / provisioning. No jailbreak or piracy tooling.",
      "Only UI localization strings (ar.lproj) were added/updated — images",
      "and compiled code are unchanged.",
      "",
    ].join("\n")
  );

  return out.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
