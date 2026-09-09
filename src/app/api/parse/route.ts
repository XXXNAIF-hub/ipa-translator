import { NextRequest, NextResponse } from "next/server";
import { parseIpaBuffer } from "@/lib/ipa-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "يُرجى رفع الملف كـ multipart/form-data." },
        { status: 400 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "لم يتم إرفاق ملف IPA. استخدم الحقل file." },
        { status: 400 }
      );
    }

    const name = file.name || "upload.ipa";
    if (!name.toLowerCase().endsWith(".ipa") && !name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json(
        { error: "امتداد الملف غير مدعوم. ارفع ملف .ipa فقط." },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `حجم الملف كبير جداً (${(file.size / 1024 / 1024).toFixed(1)} ميجابايت). الحد 200 ميجابايت.`,
        },
        { status: 413 }
      );
    }

    const ab = await file.arrayBuffer();
    const buffer = Buffer.from(ab);
    const result = parseIpaBuffer(buffer);

    return NextResponse.json({
      ok: true,
      appName: result.appName,
      locales: result.locales,
      stringCount: result.stringCount,
      files: result.files,
      strings: result.strings,
      note: "للإضافة الشرعية لتطبيقات تملك حقوقها فقط. الناتج ملفات ترجمة وليس IPA قابل للتثبيت.",
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "حدث خطأ أثناء تحليل الملف.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
