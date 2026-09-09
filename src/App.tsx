import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseIpaArrayBuffer } from "@/lib/ipa-parser";
import { buildTranslationZip, buildTranslatedIpa } from "@/lib/export-zip";
import {
  translateStrings,
  selfTestTranslation,
  translateDemoPhrase,
  LOCAL_ENGINE,
} from "@/lib/translate";
import type { LocalizedString, TranslationRow } from "@/lib/types";

const MAX_MB = 200;
const DEMO_SAMPLE = "Sign In";

const LANGS = [
  { code: "ar", label: "العربية (ar)" },
  { code: "fr", label: "Français (fr)" },
  { code: "es", label: "Español (es)" },
  { code: "de", label: "Deutsch (de)" },
  { code: "tr", label: "Türkçe (tr)" },
  { code: "hi", label: "Hindi (hi)" },
  { code: "zh-CN", label: "中文 (zh-CN)" },
  { code: "it", label: "Italiano (it)" },
  { code: "ru", label: "Русский (ru)" },
  { code: "nl", label: "Nederlands (nl)" },
  { code: "pl", label: "Polski (pl)" },
  { code: "he", label: "עברית (he)" },
  { code: "en", label: "English (en) — من العربية" },
];

type ParseSummary = {
  appName: string | null;
  locales: string[];
  stringCount: number;
  files: string[];
  extractionNotes?: string[];
};

type SelfTestState =
  | { status: "idle" }
  | { status: "running" }
  | {
      status: "ok" | "fail";
      engine: string;
      input: string;
      output: string;
      error?: string;
    };

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    "idle" | "parse" | "translate" | "export" | "demo"
  >("idle");
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const [strings, setStrings] = useState<LocalizedString[]>([]);
  const [rows, setRows] = useState<TranslationRow[]>([]);
  const [targetLang, setTargetLang] = useState("ar");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [search, setSearch] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [ipaBuffer, setIpaBuffer] = useState<ArrayBuffer | null>(null);
  const [selfTest, setSelfTest] = useState<SelfTestState>({ status: "idle" });
  const [demoInput, setDemoInput] = useState(DEMO_SAMPLE);
  const [demoOutput, setDemoOutput] = useState("");
  const [demoEngine, setDemoEngine] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const autoTestRan = useRef(false);

  const runSelfTest = useCallback(async () => {
    setSelfTest({ status: "running" });
    const result = await selfTestTranslation();
    setSelfTest({
      status: result.ok ? "ok" : "fail",
      engine: result.engine,
      input: result.input,
      output: result.output,
      error: result.error,
    });
  }, []);

  useEffect(() => {
    if (autoTestRan.current) return;
    autoTestRan.current = true;
    void runSelfTest();
  }, [runSelfTest]);

  const runDemo = async () => {
    const phrase = demoInput.trim() || DEMO_SAMPLE;
    setBusy("demo");
    setDemoError(null);
    setDemoOutput("");
    setDemoEngine(null);
    try {
      const result = await translateDemoPhrase(phrase, "en", "ar");
      setDemoOutput(result.output);
      setDemoEngine(result.engine);
      if (!result.ok) {
        setDemoError(result.error || "فشلت الترجمة");
      }
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("idle");
    }
  };

  const reset = () => {
    setError(null);
    setStatus(null);
    setSummary(null);
    setStrings([]);
    setRows([]);
    setProgress({ done: 0, total: 0 });
    setFileName(null);
    setIpaBuffer(null);
  };

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setStatus(null);
    setRows([]);
    setSummary(null);
    setStrings([]);
    setIpaBuffer(null);

    if (
      !file.name.toLowerCase().endsWith(".ipa") &&
      !file.name.toLowerCase().endsWith(".zip")
    ) {
      setError("يرجى رفع ملف بامتداد .ipa فقط.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(
        `حجم الملف (${(file.size / 1024 / 1024).toFixed(1)} ميجابايت) أكبر من الحد ${MAX_MB} ميجابايت.`
      );
      return;
    }

    setFileName(file.name);
    setBusy("parse");
    setStatus("جاري قراءة الـ IPA في المتصفح...");
    try {
      const buffer = await file.arrayBuffer();
      // Keep a copy — JSZip may detach views; slice ensures we retain bytes for IPA rebuild
      const retained = buffer.slice(0);
      setIpaBuffer(retained);
      const data = await parseIpaArrayBuffer(retained);
      setSummary({
        appName: data.appName,
        locales: data.locales || [],
        stringCount: data.stringCount,
        files: data.files || [],
        extractionNotes: data.extractionNotes,
      });
      setStrings(data.strings || []);
      setStatus(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "فشل تحليل الملف في المتصفح."
      );
    } finally {
      setBusy("idle");
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) void handleFile(f);
    },
    [handleFile]
  );

  const translateAll = async () => {
    if (strings.length === 0) return;
    setError(null);
    setBusy("translate");
    setRows([]);
    setProgress({ done: 0, total: strings.length });

    const byId = new Map<string, TranslationRow>();
    try {
      const sourceLang = targetLang === "en" ? "ar" : "en";
      const result = await translateStrings({
        strings,
        targetLang,
        sourceLang,
        onStatus: (msg) => setStatus(msg),
        onProgress: (done, total, row) => {
          byId.set(row.id, row);
          setRows(
            strings
              .map((s) => byId.get(s.id))
              .filter(Boolean) as TranslationRow[]
          );
          setProgress({ done, total });
        },
      });
      const finalMap = new Map(result.map((r) => [r.id, r]));
      setRows(strings.map((s) => finalMap.get(s.id)!).filter(Boolean));
      setProgress({ done: strings.length, total: strings.length });
      const fails = result.filter((r) => r.failed).length;
      if (fails > 0) {
        setError(
          `اكتملت الترجمة مع فشل ${fails} نصاً (ظلت بالإنجليزية ومُعلَّمة كفشل — ليست نجاحاً صامتاً).`
        );
        setStatus(`اكتملت مع ${fails} فشل.`);
      } else {
        setStatus(null);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "فشلت الترجمة. تحقق من الاتصال وأعد المحاولة."
      );
    } finally {
      setBusy("idle");
    }
  };

  const downloadZip = async () => {
    if (rows.length === 0) return;
    setBusy("export");
    setError(null);
    try {
      const blob = await buildTranslationZip(rows, targetLang);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${summary?.appName || "localization"}-${targetLang}-strings.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "تعذر تنزيل ملف ZIP."
      );
    } finally {
      setBusy("idle");
    }
  };

  const downloadIpa = async () => {
    if (rows.length === 0 || !ipaBuffer) {
      setError("يلزم رفع IPA وترجمته أولاً قبل تنزيل IPA مترجم.");
      return;
    }
    setBusy("export");
    setError(null);
    try {
      const blob = await buildTranslatedIpa(ipaBuffer, rows, targetLang);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const base = (fileName || "app.ipa").replace(/\.ipa$/i, "");
      a.download = `${base}-${targetLang}-translated.ipa`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "تعذر بناء ملف IPA المترجم."
      );
    } finally {
      setBusy("idle");
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.key.toLowerCase().includes(q) ||
        r.original.toLowerCase().includes(q) ||
        r.translation.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const updateTranslation = (id: string, value: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, translation: value, failed: false } : r
      )
    );
  };

  const pct =
    progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  const failCount = rows.filter((r) => r.failed).length;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-sm text-muted">
            أداة مجانية — التحليل محلياً · الترجمة عبر محركات متعددة في المتصفح
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            ما يترجم — مترجم نصوص IPA
          </h1>
          <p className="mt-2 max-w-2xl text-muted">
            ارفع ملف <span className="text-foreground">.ipa</span> لاستخراج
            نصوص الواجهة وترجمتها ثم تنزيل{" "}
            <span className="text-foreground">IPA مترجم</span> (فيه{" "}
            <code className="text-foreground">ar.lproj</code>) أو ZIP للنصوص.
          </p>
          <p className="mt-2 max-w-2xl rounded-lg border border-accent-2/30 bg-accent-2/5 px-3 py-2 text-sm text-accent-2">
            الموقع يترجم نصوص الواجهة ويخرج IPA فيه مجلد ar.lproj — مو سحر يغيّر
            الصور أو الكود المجمّع كله.
          </p>
        </div>
        <div className="text-sm text-muted">IPA Translator</div>
      </header>

      {/* Instant proof demo — no IPA needed */}
      <section className="card border-accent/40 p-5 sm:p-6">
        <h2 className="mb-1 text-xl font-bold">جرّب الترجمة الآن (بدون IPA)</h2>
        <p className="mb-4 text-sm text-muted">
          إثبات فوري: أدخل إنجليزي واضغط «ترجم الآن» — تظهر العربية من محرك
          الترجمة الحقيقي (ليس تجميلاً شكلياً).
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-muted">English</label>
            <input
              className="w-full text-lg"
              value={demoInput}
              onChange={(e) => setDemoInput(e.target.value)}
              placeholder={DEMO_SAMPLE}
              dir="ltr"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm text-muted">العربية</label>
            <div
              className={`min-h-[2.75rem] rounded-xl border px-3 py-2 text-lg ${
                demoError
                  ? "border-danger/50 bg-danger/10 text-danger"
                  : demoOutput
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-card-border bg-[#0b1222] text-muted"
              }`}
              dir="rtl"
            >
              {demoError
                ? demoError
                : demoOutput || "— اضغط ترجم الآن —"}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-primary text-base"
            onClick={() => void runDemo()}
            disabled={busy === "demo"}
          >
            {busy === "demo" ? "جاري الترجمة…" : "ترجم الآن"}
          </button>
          {demoEngine && !demoError && (
            <span className="text-sm text-success">
              عبر {demoEngine}
            </span>
          )}
        </div>
      </section>

      {/* Self-test — impossible to miss */}
      <section
        className={`card flex flex-col gap-3 border-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 ${
          selfTest.status === "ok"
            ? "border-success/60 bg-success/10"
            : selfTest.status === "fail"
              ? "border-danger/60 bg-danger/10"
              : "border-card-border"
        }`}
      >
        <div className="text-base font-semibold">
          <span className="text-muted font-normal">اختبار ذاتي (Sign In → عربية): </span>
          {selfTest.status === "idle" && (
            <span className="text-muted">لم يُشغَّل بعد</span>
          )}
          {selfTest.status === "running" && (
            <span className="text-accent-2">جاري الاختبار…</span>
          )}
          {selfTest.status === "ok" && (
            <span className="text-success text-lg">
              ✓ OK — «{selfTest.input}» → «{selfTest.output}» ({selfTest.engine})
            </span>
          )}
          {selfTest.status === "fail" && (
            <span className="text-danger text-lg">
              ✗ FAIL — {selfTest.error || "لا توجد أحرف عربية في الناتج"}
              {selfTest.output ? ` (خرج: «${selfTest.output}»)` : ""}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-secondary text-sm"
          onClick={() => void runSelfTest()}
          disabled={selfTest.status === "running"}
        >
          {selfTest.status === "running"
            ? "جاري الاختبار…"
            : "إعادة اختبار الترجمة"}
        </button>
      </section>

      <section className="card p-5 sm:p-6">
        <div
          className={`dropzone flex cursor-pointer flex-col items-center justify-center gap-3 px-4 py-12 text-center ${
            dragOver ? "active" : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
        >
          <div className="text-4xl">📦</div>
          <div className="text-lg font-semibold">
            اسحب ملف IPA هنا أو انقر للاختيار
          </div>
          <div className="text-sm text-muted">
            الحد الأقصى {MAX_MB} ميجابايت · التحليل محلي في جهازك
          </div>
          {fileName && (
            <div className="mt-1 rounded-full bg-[#151d33] px-3 py-1 text-sm">
              {fileName}
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".ipa,.zip,application/octet-stream"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </div>

        {(busy === "parse" || status) && (
          <p className="mt-4 text-center text-sm text-accent-2">
            {status || "جاري استخراج النصوص..."}
          </p>
        )}
        {error && (
          <div className="mt-4 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}
      </section>

      {summary && (
        <section className="card grid gap-4 p-5 sm:grid-cols-4 sm:p-6">
          <Stat label="اسم التطبيق" value={summary.appName || "—"} />
          <Stat label="عدد النصوص" value={String(summary.stringCount)} />
          <Stat
            label="اللغات الموجودة"
            value={summary.locales.join(", ") || "—"}
          />
          <Stat label="ملفات الترجمة" value={String(summary.files.length)} />
          {summary.extractionNotes && summary.extractionNotes.length > 0 && (
            <div className="sm:col-span-4 rounded-xl border border-card-border bg-[#0b1222] p-3 text-xs text-muted">
              <div className="mb-1 font-semibold text-foreground">
                ملاحظات الاستخراج / الحدود
              </div>
              <ul className="list-inside list-disc space-y-1">
                {summary.extractionNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {strings.length > 0 && (
        <section className="card flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm text-muted">اللغة الهدف</label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                disabled={busy !== "idle"}
              >
                {LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={reset}
                disabled={busy !== "idle"}
              >
                إعادة تعيين
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void translateAll()}
                disabled={busy !== "idle"}
              >
                {busy === "translate" ? "جاري الترجمة..." : "ترجمة النصوص"}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void downloadIpa()}
                disabled={busy !== "idle" || rows.length === 0 || !ipaBuffer}
                title="IPA فيه ar.lproj — يحتاج توقيعك الخاص للتثبيت"
              >
                {busy === "export" ? "جاري التصدير..." : "حمّل IPA مترجم"}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => void downloadZip()}
                disabled={busy !== "idle" || rows.length === 0}
              >
                تنزيل ZIP النصوص
              </button>
            </div>
          </div>

          {rows.length > 0 && (
            <p className="rounded-lg border border-card-border bg-[#0b1222] px-3 py-2 text-sm text-muted">
              «حمّل IPA مترجم» ينسخ الحزمة ويحقن{" "}
              <code className="text-foreground">
                Payload/*.app/{targetLang}.lproj/Localizable.strings
              </code>
              . تثبيت الجهاز ما زال يحتاج{" "}
              <strong className="text-foreground">توقيعك الخاص</strong> — لا
              أدوات جيلبريك أو قرصنة هنا.
            </p>
          )}

          {(busy === "translate" || progress.total > 0) && (
            <div>
              <div className="mb-2 flex justify-between text-sm text-muted">
                <span>
                  تقدم الترجمة
                  {failCount > 0 && (
                    <span className="ms-2 text-danger">
                      ({failCount} فشل)
                    </span>
                  )}
                </span>
                <span>
                  {progress.done} / {progress.total} ({pct}%)
                </span>
              </div>
              <div className="progress-track">
                <div className="progress-bar" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
        </section>
      )}

      {rows.length > 0 && (
        <section className="card overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b border-card-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">معاينة قابلة للتحرير</h2>
            <input
              className="w-full sm:w-72"
              placeholder="بحث في المفتاح / الأصل / الترجمة..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-[32rem] overflow-auto">
            <table>
              <thead className="sticky top-0 bg-[#0c1426]">
                <tr>
                  <th className="w-[22%]">المفتاح</th>
                  <th className="w-[34%]">الأصل</th>
                  <th className="w-[44%]">الترجمة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs text-muted break-all">
                      {r.key}
                      {r.skipped && (
                        <div className="mt-1 text-[10px] text-accent-2">
                          تخطي: {r.skipReason || "—"}
                        </div>
                      )}
                      {r.failed && (
                        <div className="mt-1 text-[10px] text-danger">
                          فشل: {r.failReason || "ترجمة غير صالحة"}
                        </div>
                      )}
                    </td>
                    <td className="text-sm whitespace-pre-wrap break-words">
                      {r.original}
                    </td>
                    <td>
                      <textarea
                        className={`w-full min-h-[2.5rem] resize-y text-sm ${
                          r.failed ? "border-danger/50" : ""
                        }`}
                        value={r.translation}
                        onChange={(e) =>
                          updateTranslation(r.id, e.target.value)
                        }
                        dir="auto"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="mt-auto space-y-2 pb-6 text-sm text-muted">
        <p>
          الموقع يترجم نصوص الواجهة ويخرج IPA فيه مجلد ar.lproj — مو سحر يغيّر
          الصور أو الكود المجمّع كله. التثبيت على الجهاز يحتاج توقيع المستخدم —
          لا تجاوز DRM ولا sideloading/jailbreak.
        </p>
        <p>
          محركات الترجمة بالترتيب:{" "}
          <code className="text-foreground">{LOCAL_ENGINE.defaultModel}</code>.
          الصفوف الفاشلة تُعلَّم كفشل — الإنجليزية لا تُحسب نجاحاً صامتاً.
        </p>
        <p>
          حدود الاستخراج: ملفات{" "}
          <code className="text-foreground">.strings</code> /{" "}
          <code className="text-foreground">.xcstrings</code>، أسماء العرض من{" "}
          <code className="text-foreground">Info.plist</code> (XML)، ملفات نصية
          صغيرة، وإن لم يوجد شيء: عبارات لاتينية من الثنائي (حد 500). plists
          الثنائية وواجهات مجمّعة قد تبقى فارغة جزئياً.
        </p>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-[#0b1222] p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold" title={value}>
        {value}
      </div>
    </div>
  );
}
