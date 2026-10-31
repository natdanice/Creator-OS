/**
 * Media upload for the Publisher. Stores the file under data/uploads/ and records
 * a media_assets row. A route handler (not a Server Action) so large videos aren't
 * subject to the 1 MB Server Action body limit.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { mediaAssets } from "@/db/schema";
import { getStoryDate } from "@/lib/queries/settings";
import { UPLOAD_DIR } from "@/publish/service";

const MAX_BYTES = 500 * 1024 * 1024;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "no file" }, { status: 400 });
  const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
  if (!kind) return NextResponse.json({ error: "unsupported type" }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large" }, { status: 413 });

  const num = (k: string) => {
    const v = Number(form.get(k));
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const ext = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "") || (kind === "video" ? ".mp4" : ".jpg");
  const storedName = `${randomUUID()}${ext}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), Buffer.from(await file.arrayBuffer()));

  const db = getDb();
  const row = db
    .insert(mediaAssets)
    .values({
      originalName: file.name.slice(0, 200),
      storedName,
      mime: file.type,
      kind,
      sizeBytes: file.size,
      width: num("width"),
      height: num("height"),
      durationSec: num("durationSec"),
      uploadedAt: `${getStoryDate(db)}T10:00:00`,
    })
    .returning()
    .get();
  return NextResponse.json({ id: row.id, kind: row.kind, durationSec: row.durationSec, width: row.width, height: row.height, sizeBytes: row.sizeBytes, name: row.originalName });
}
