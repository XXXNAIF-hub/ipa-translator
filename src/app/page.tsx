"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { LocalizedString, TranslationRow } from "@/lib/types";

const MAX_MB = 200;
const BATCH_SIZE = 8;

const LANGS = [
  { code: "ar", label: "العربية (ar)" },
  { code: "en", label: "English (en)" },
  { code: "fr", label: "Français (fr)" },
  { code: "es", label: "Español (es)" },
  { code: "de", label: "Deutsch (de)" },
  { code: "tr", label: "Türkçe (tr)" },
  { code: "hi", label: "Hindi (hi)" },
  { code: "ur", label: "اردو (ur)" },
  { code: "zh-CN", label: "中文 (zh-CN)" },
  { code: "ja", label: "日本語 (ja)" },
  { code: "it", label: "Italiano (it)" },
  { code: "ru", label: "Русский (ru)" },
];

type ParseSummary = {
  appName: string | null;
  locales: string[];
  stringCount: number;
  files: string[];
};

export default function HomePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"idle" | "parse" | "translate" | "export">(
    "idle"
  );
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const [strings, setStrings] = useState<LocalizedString[]>([]);
  const [rows, setRows] = useState<TranslationRow[]>([]);
  const [targetLang, setTargetLang] = useState("ar");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [search, setSearch] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);

  const reset = () => {
    setError(null);
    setSummary(null);
    setStrings([]);
    setRows([]);
    setProgress({ done: 0, total: 0 });
    setFileName(null);
  };

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setRows([]);
    setSummary(null);
    setStrings([]);

    if (!file.name.toLowerCase().endsWith(".ipa") && !file.name.toLowerCase().endsWith(".zip")) {
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
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "فشل تحليل الملف.");
        return;
      }
      setSummary({
        appName: data.appName,
        locales: data.locales || [],
        stringCount: data.stringCount,
        files: data.files || [],
      });
      setStrings(data.strings || []);
    } catch {
      setError("تعذر الاتصال بالخادم أثناء الرفع.");
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

    const allRows: TranslationRow[] = [];
    try {
      for (let i = 0; i < strings.length; i += BATCH_SIZE) {
        const batch = strings.slice(i, i + BATCH_SIZE);
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strings: batch,
            targetLang,
            sourceLang: "en",
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "فشلت الترجمة.");
          break;
        }
        allRows.push(...(data.rows as TranslationRow[]));
        setRows([...allRows]);
        setProgress({ done: allRows.length, total: strings.length });
      }
    } catch {
      setError("تعذر الاتصال أثناء الترجمة المحلية. تأكد أن الخادم يعمل وأن الموديل جاهز.");
    } finally {
      setBusy("idle");
    }
  };

  const downloadZip = async () => {
    if (rows.length === 0) return;
    setBusy("export");
    setError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows,
          targetLang,
          appName: summary?.appName,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "فشل التصدير.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${summary?.appName || "localization"}-${targetLang}-strings.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("تعذر تنزيل ملف ZIP.");
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
      prev.map((r) => (r.id === id ? { ...r, translation: value } : r))
    );
  };

  const pct =
    progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-sm text-muted">أداة مجانية للمطورين</p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            مترجم نصوص IPA
          </h1>
          <p className="mt-2 max-w-2xl text-muted">
            ارفع ملف <span className="text-foreground">.ipa</span> لاستخراج
            النصوص المحلية وترجمتها (العربية افتراضياً) ثم تنزيل ZIP لملفات
            الترجمة — دون إعادة توقيع أو تثبيت.
          </p>
          <p className="mt-2 max-w-2xl text-sm text-accent-2">
            ترجمة محلية بدون حد يومي — أول تشغيل يحمّل الموديل (~870 ميجابايت، مرة واحدة لكل الموديل متعدد اللغات).
          </p>
        </div>
        <div className="text-sm text-muted">IPA Translator</div>
      </header>

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
            الحد الأقصى {MAX_MB} ميجابايت · صيغة ZIP داخلية
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

        {busy === "parse" && (
          <p className="mt-4 text-center text-sm text-accent-2">
            جاري استخراج النصوص...
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
                className="btn btn-secondary"
                type="button"
                onClick={() => void downloadZip()}
                disabled={busy !== "idle" || rows.length === 0}
              >
                {busy === "export" ? "جاري التصدير..." : "تنزيل ZIP"}
              </button>
            </div>
          </div>

          {(busy === "translate" || progress.total > 0) && (
            <div>
              <div className="mb-2 flex justify-between text-sm text-muted">
                <span>تقدم الترجمة</span>
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
                    </td>
                    <td className="text-sm whitespace-pre-wrap break-words">
                      {r.original}
                    </td>
                    <td>
                      <textarea
                        className="w-full min-h-[2.5rem] resize-y text-sm"
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
          ملاحظة: هذه الأداة مخصّصة للترجمة الشرعية لتطبيقات تملكها أو لديك
          حقوق تعديلها. لا توفّر تجاوز DRM، ولا أدوات sideloading أو jailbreak،
          ولا تدّعي أن ملف IPA غير موقّع سيعمل بالتثبيت.
        </p>
        <p>
          الناتج الأساسي هو أرشيف ZIP لملفات{" "}
          <code className="text-foreground">*.lproj/*.strings</code> فقط.
        </p>
        <p>
          المحرّك الافتراضي: ترجمة عصبية محلية (NLLB-200 عبر Transformers.js) —
          بدون مفاتيح أو حصص سحابية. أول ترجمة تحمّل الموديل مرة واحدة إلى{" "}
          <code className="text-foreground">.cache/</code> (~870 ميجابايت).
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
