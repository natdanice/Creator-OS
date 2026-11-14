/**
 * One-stop import, step 1: upload any number of files. Each table is recognised and the confident
 * ones are imported straight away; the response lists what happened and what still needs the creator.
 * A route handler (not a Server Action) so large exports aren't cut off by the 1 MB action limit.
 */
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getStoryDate } from "@/lib/queries/settings";
import { stamp } from "@/lib/clock";
import { analyze } from "@/import/batch";

export const dynamic = "force-dynamic";
const MAX_BYTES = 100 * 1024 * 1024;

export async function POST(req: Request) {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "No files" }, { status: 400 });
  const tooBig = files.find((f) => f.size > MAX_BYTES);
  if (tooBig) return NextResponse.json({ error: `${tooBig.name} is larger than 100 MB` }, { status: 413 });
  const db = getDb();
  const uploads = await Promise.all(files.map(async (f) => ({ name: f.name, buf: Buffer.from(await f.arrayBuffer()) })));
  const plan = await analyze(db, uploads, stamp(getStoryDate(db)));
  revalidatePath("/", "layout");
  return NextResponse.json(plan);
}
