import JSZip from "jszip";
import { serializeStringsFile } from "./strings-parser";
import type { TranslationRow } from "./types";

/**
 * Build a ZIP mirroring *.lproj/*.strings structure for the target locale.
 * Paths like Payload/App.app/en.lproj/Localizable.strings
 * become     Payload/App.app/{target}.lproj/Localizable.strings
 */
export async function buildTranslationZip(
  rows: TranslationRow[],
  targetLang: string
): Promise<Buffer> {
  const zip = new JSZip();

  // Group by output file path
  const byFile = new Map<string, { key: string; value: string }[]>();

  for (const row of rows) {
    let outPath = row.filePath;
    // Remap .lproj folder to target language
    outPath = outPath.replace(
      /\/[A-Za-z]{2}(?:[-_][A-Za-z0-9]+)?\.lproj\//,
      `/${targetLang}.lproj/`
    );
    // Base.lproj → target.lproj
    outPath = outPath.replace(/\/Base\.lproj\//i, `/${targetLang}.lproj/`);

    // xcstrings → write a companion .strings under target.lproj
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
    if (path.toLowerCase().endsWith(".strings")) {
      zip.file(path, serializeStringsFile(entries));
    } else {
      // Fallback: write as strings anyway
      zip.file(path, serializeStringsFile(entries));
    }
  }

  // Add a small README inside the zip
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

  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  return Buffer.from(buf);
}
