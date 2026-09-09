/**
 * Node smoke: multi-engine Sign In → Arabic (translate-pa → MyMemory → LibreTranslate).
 */
const TE_LIB_KEY = "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520";
const PA = "https://translate-pa.googleapis.com/v1/translateHtml";
const MYMEMORY = "https://api.mymemory.translated.net/get";
const LIBRE = "https://libretranslate.com/translate";

const FIXTURES = [
  "Sign In",
  "Settings",
  "Welcome to Sample App",
  "Hello %@, you have %d messages",
  "Cancel",
  "Save",
];

const ARABIC = /[\u0600-\u06FF]/;

async function translatePa(texts, sl = "en", tl = "ar") {
  const res = await fetch(PA, {
    method: "POST",
    headers: {
      "Content-Type": "application/json+protobuf",
      "X-Goog-API-Key": TE_LIB_KEY,
    },
    body: JSON.stringify([[texts, sl, tl], "te_lib"]),
  });
  if (!res.ok) throw new Error(`pa ${res.status} ${await res.text()}`);
  const data = await res.json();
  const out = Array.isArray(data?.[0]) ? data[0] : data;
  if (!Array.isArray(out) || out.length !== texts.length) {
    throw new Error(`bad shape ${JSON.stringify(data).slice(0, 200)}`);
  }
  return out;
}

async function translateMyMemory(text, sl = "en", tl = "ar") {
  const url = `${MYMEMORY}?q=${encodeURIComponent(text)}&langpair=${sl}|${tl}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mymemory ${res.status}`);
  const data = await res.json();
  const out = data?.responseData?.translatedText || "";
  if (/MYMEMORY WARNING/i.test(out)) throw new Error("mymemory quota");
  if (!out) throw new Error("mymemory empty");
  return out;
}

async function translateLibre(text, sl = "en", tl = "ar") {
  const res = await fetch(LIBRE, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ q: text, source: sl, target: tl, format: "text" }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`libre ${res.status} ${body.slice(0, 120)}`);
  const data = JSON.parse(body);
  if (!data.translatedText) throw new Error("libre empty");
  return data.translatedText;
}

async function translateOne(text) {
  const errors = [];
  try {
    const [out] = await translatePa([text]);
    if (ARABIC.test(out)) return { engine: "translate-pa", out };
    errors.push(`pa no-ar: ${out}`);
  } catch (e) {
    errors.push(`pa: ${e.message}`);
  }
  try {
    const out = await translateMyMemory(text);
    if (ARABIC.test(out)) return { engine: "mymemory", out };
    errors.push(`mm no-ar: ${out}`);
  } catch (e) {
    errors.push(`mm: ${e.message}`);
  }
  try {
    const out = await translateLibre(text);
    if (ARABIC.test(out)) return { engine: "libretranslate", out };
    errors.push(`lt no-ar: ${out}`);
  } catch (e) {
    errors.push(`lt: ${e.message}`);
  }
  throw new Error(errors.join(" | "));
}

// Required: Sign In must succeed via at least one engine
const signIn = await translateOne("Sign In");
console.log(
  `Sign In → ${JSON.stringify(signIn.out)} via ${signIn.engine}`
);
if (!ARABIC.test(signIn.out)) {
  console.error("FAIL: Sign In did not yield Arabic");
  process.exit(1);
}

let fail = 0;
for (const phrase of FIXTURES) {
  try {
    const { engine, out } = await translateOne(phrase);
    const ok = ARABIC.test(out);
    const phOk =
      !phrase.includes("%@") ||
      (out.includes("%@") && (!phrase.includes("%d") || out.includes("%d")));
    console.log(
      `${ok && phOk ? "OK" : "FAIL"}  [${engine}] ${JSON.stringify(phrase)} → ${JSON.stringify(out)}`
    );
    if (!ok || !phOk) fail++;
  } catch (e) {
    console.log(`FAIL  ${JSON.stringify(phrase)} — ${e.message}`);
    fail++;
  }
}

if (fail) {
  console.error(`FAILED ${fail}/${FIXTURES.length}`);
  process.exit(1);
}
console.log(`PASS ${FIXTURES.length}/${FIXTURES.length}`);
