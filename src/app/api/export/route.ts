import { NextRequest, NextResponse } from "next/server";
import { buildTranslationZip } from "@/lib/export-zip";
import type { TranslationRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      rows?: TranslationRow[];
      targetLang?: string;
      appName?: string | null;
    };

    if (!body.rows || !Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json(
        { error: "لا توجد ترجمات للتصدير." },
        { status: 400 }
      );
    }

    const targetLang = (body.targetLang || "ar").toLowerCase();
    const zipBuf = await buildTranslationZip(body.rows, targetLang);
    const safeName = (body.appName || "localization")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 60);

    return new NextResponse(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}-${targetLang}-strings.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "فشل إنشاء ملف ZIP.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
