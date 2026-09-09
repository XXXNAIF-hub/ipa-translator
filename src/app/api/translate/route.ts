import { NextRequest, NextResponse } from "next/server";
import { translateBatch } from "@/lib/translate";
import type { LocalizedString } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      strings?: LocalizedString[];
      targetLang?: string;
      sourceLang?: string;
    };

    if (!body.strings || !Array.isArray(body.strings) || body.strings.length === 0) {
      return NextResponse.json(
        { error: "لا توجد نصوص للترجمة." },
        { status: 400 }
      );
    }

    if (body.strings.length > 500) {
      return NextResponse.json(
        {
          error:
            "عدد النصوص كبير جداً دفعة واحدة (الحد 500). قسّم الطلب أو ترجم على دفعات من الواجهة.",
        },
        { status: 400 }
      );
    }

    const targetLang = (body.targetLang || "ar").toLowerCase();
    const sourceLang = (body.sourceLang || "en").toLowerCase();

    const rows = await translateBatch(body.strings, targetLang, sourceLang);

    return NextResponse.json({
      ok: true,
      targetLang,
      sourceLang,
      rows,
      count: rows.length,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "فشلت الترجمة.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
