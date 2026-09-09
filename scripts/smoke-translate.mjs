/**
 * Node smoke: Google translate-pa (+ gtx fallback) for fixture UI phrases.
 */
const TE_LIB_KEY = "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520";
const PA = "https://translate-pa.googleapis.com/v1/translateHtml";

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

const out = await translatePa(FIXTURES);
console.log("engine: translate-pa");
let fail = 0;
for (let i = 0; i < FIXTURES.length; i++) {
  const ok = ARABIC.test(out[i]);
  const phOk =
    !FIXTURES[i].includes("%@") ||
    (out[i].includes("%@") && out[i].includes("%d"));
  console.log(
    `${ok && phOk ? "OK" : "FAIL"}  ${JSON.stringify(FIXTURES[i])} → ${JSON.stringify(out[i])}`
  );
  if (!ok || !phOk) fail++;
}
if (fail) {
  console.error(`FAILED ${fail}/${FIXTURES.length}`);
  process.exit(1);
}
console.log(`PASS ${FIXTURES.length}/${FIXTURES.length}`);
