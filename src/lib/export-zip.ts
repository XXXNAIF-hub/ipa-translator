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
    let outPath = row.filePath;
    outPath = outPath.replace(
      /\/[A-Za-z]{2}(?:[-_][A-Za-z0-9]+)?\.lproj\//,
      `/${targetLang}.lproj/`
    );
    outPath = outPath.replace(/\/Base\.lproj\//i, `/${targetLang}.lproj/`);

    if (outPath.toLowerCase().endsWith(".xcstrings")) {
      const dir = outPath.replace(/\/[^/]+\.xcstrings$/i, "");
      outPath = `${dir}/${targetLang}.lproj/Localizable.strings`;
    }

    if (!byFile.has(outPath)) byFile.set(outPath, []);
    byFile.get(outPath)!.push({
      key: row.key,
      value: row.translation,
    });
  }

  for (const [path, entries] of byFile) {
    zip.file(path, serializeStringsFile(entries));
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
