/** One-stop import, step 2: import (or skip) the tables that were waiting for the creator. */
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getStoryDate } from "@/lib/queries/settings";
import { stamp } from "@/lib/clock";
import { confirm, type Decision } from "@/import/batch";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { batchId, decisions } = (await req.json()) as { batchId?: string; decisions?: Decision[] };
  if (!batchId || !Array.isArray(decisions)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const db = getDb();
  try {
    const plan = await confirm(db, batchId, decisions, stamp(getStoryDate(db)));
    revalidatePath("/", "layout");
    return NextResponse.json(plan);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
