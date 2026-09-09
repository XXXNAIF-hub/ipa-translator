/**
 * Simulate multi-locale IPA explosion → prove locale filter + key dedupe + cap.
 */
import JSZip from "jszip";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const {
  parseIpaArrayBuffer,
  DEFAULT_MAX_STRINGS,
  BINARY_STRING_CAP,
} = await import(pathToFileURL(join(root, "scripts", "_dedupe-lib.mjs")).href);

const LOCALES = [
  "Base", "en", "en-GB", "fr", "de", "es", "it", "ja", "ko", "zh-Hans",
  "zh-Hant", "ar", "ru", "pt", "nl", "pl", "tr", "sv", "da", "fi",
];
const KEY_COUNT = 1000;

function makeStringsContent(locale, n) {
  const lines = ["/* test */", ""];
  for (let i = 0; i < n; i++) {
    const key = `key_${i}`;
    const value =
      locale === "en" || locale === "Base" || locale.startsWith("en")
        ? `Hello World ${i}`
        : `[${locale}] Hello World ${i}`;
    lines.push(`"${key}" = "${value}";`);
  }
  return lines.join("\n");
}

async function buildFixture() {
  const zip = new JSZip();
  for (const loc of LOCALES) {
    zip.file(
      `Payload/Demo.app/${loc}.lproj/Localizable.strings`,
      makeStringsContent(loc, KEY_COUNT)
    );
  }
  const junk = Buffer.alloc(50_000);
  for (let i = 0; i < 2000; i++) {
    junk.write(`Some Binary Phrase Number ${i} Here`, i * 24, "ascii");
  }
  zip.file("Payload/Demo.app/Demo", junk);
  return zip.generateAsync({ type: "nodebuffer" });
}

const buf = await buildFixture();
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const rawPairs = LOCALES.length * KEY_COUNT;
console.log(`Fixture: ${LOCALES.length} locales × ${KEY_COUNT} keys = ${rawPairs} raw pairs`);

const all = await parseIpaArrayBuffer(ab, {
  localeFilter: "all",
  maxStrings: 0,
  enableBinaryExtraction: false,
});
console.log(`localeFilter=all, no cap → ${all.stringCount} (raw=${all.rawStringCount})`);

const baseEn = await parseIpaArrayBuffer(ab, {
  localeFilter: "base-en",
  maxStrings: DEFAULT_MAX_STRINGS,
  enableBinaryExtraction: false,
});
console.log(
  `localeFilter=base-en, cap=${DEFAULT_MAX_STRINGS} → ${baseEn.stringCount} (raw=${baseEn.rawStringCount}, truncated=${baseEn.truncated}, from=${baseEn.truncatedFrom})`
);

const zipBin = new JSZip();
zipBin.file(
  "Payload/OnlyBin.app/Info.plist",
  `<?xml version="1.0"?><plist><dict>
<key>CFBundleExecutable</key><string>OnlyBin</string>
<key>CFBundleDisplayName</key><string>Only Bin App</string>
</dict></plist>`
);
const junk2 = Buffer.alloc(80_000, 0);
let off = 0;
for (let i = 0; i < 5000; i++) {
  const phrase = `Title Case Phrase ${i} Extra`;
  if (off + phrase.length + 1 >= junk2.length) break;
  junk2.write(phrase, off, phrase.length, "ascii");
  off += phrase.length + 1; // leave a 0 separator
}
zipBin.file("Payload/OnlyBin.app/OnlyBin", junk2);
const binBuf = await zipBin.generateAsync({ type: "nodebuffer" });
const binAb = binBuf.buffer.slice(binBuf.byteOffset, binBuf.byteOffset + binBuf.byteLength);
const binResult = await parseIpaArrayBuffer(binAb, {
  localeFilter: "base-en",
  enableBinaryExtraction: true,
  maxStrings: 5000,
});
console.log(
  `binary-only IPA, extraction ON → ${binResult.stringCount} (≤ ${BINARY_STRING_CAP}+plist)`
);

let failed = false;
if (all.rawStringCount < 15000) {
  console.error("FAIL: expected raw ~20k before dedupe");
  failed = true;
}
if (all.stringCount > KEY_COUNT + 50) {
  console.error(`FAIL: all-locales after key dedupe ~${KEY_COUNT}, got ${all.stringCount}`);
  failed = true;
}
if (baseEn.stringCount > DEFAULT_MAX_STRINGS) {
  console.error(`FAIL: capped list exceeds ${DEFAULT_MAX_STRINGS}`);
  failed = true;
}
if (baseEn.rawStringCount < 15000) {
  console.error("FAIL: rawStringCount should still reflect pre-filter explosion");
  failed = true;
}
if (binResult.stringCount > BINARY_STRING_CAP + 10) {
  console.error(`FAIL: binary exceeded cap: ${binResult.stringCount}`);
  failed = true;
}
if (baseEn.stringCount >= 19000) {
  console.error("FAIL: still exploding near 20k");
  failed = true;
}

if (failed) {
  console.error("verify-dedupe-cap FAILED");
  process.exit(1);
}
console.log("verify-dedupe-cap OK");
console.log(
  JSON.stringify(
    {
      rawPairs,
      allAfterDedupe: all.stringCount,
      baseEnCapped: baseEn.stringCount,
      binaryCapped: binResult.stringCount,
      defaultCap: DEFAULT_MAX_STRINGS,
      binaryCap: BINARY_STRING_CAP,
    },
    null,
    2
  )
);
