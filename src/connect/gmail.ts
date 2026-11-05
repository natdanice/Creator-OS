/**
 * Gmail → Inbox, and approved replies → Gmail drafts (never sent automatically).
 * An email belongs to a brand when the sender matches a brand contact's email or the
 * brand's website domain. Mail from unknown senders is only imported when it looks
 * like a brief; then a new brand is created for it.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { brandContacts, brands, messages } from "@/db/schema";
import { getBriefDetector } from "@/inbox/briefDetector";
import { bearer, getJson } from "./http";
import { guessTags, toBangkok } from "./tags";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me)\./i;

type Part = { mimeType: string; body?: { data?: string }; parts?: Part[] };
type Msg = { id: string; internalDate: string; snippet: string; payload: Part & { headers: { name: string; value: string }[] } };

function plainText(p: Part): string | null {
  if (p.mimeType === "text/plain" && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8");
  for (const c of p.parts ?? []) {
    const t = plainText(c);
    if (t) return t;
  }
  return null;
}

/** Drop quoted history ("On … wrote:" and "> " lines). */
function stripQuoted(text: string) {
  const cut = text.search(/\n(On .+wrote:|เมื่อ .+เขียนว่า:)/);
  return (cut > 0 ? text.slice(0, cut) : text)
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .trim();
}

function parseFrom(v: string) {
  const m = v.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  const email = (m ? m[2] : v).trim().toLowerCase();
  return { name: (m?.[1] ?? "").trim(), email, domain: email.split("@")[1] ?? "" };
}

export async function importGmail(db: DB, token: string, ownEmail: string) {
  const q = encodeURIComponent("in:inbox newer_than:14d -category:promotions -category:social -category:updates");
  const list = await getJson<{ messages?: { id: string }[] }>(`${API}/messages?q=${q}&maxResults=50`, bearer(token));
  const detector = getBriefDetector();
  let imported = 0;
  let created = 0;
  for (const { id } of list.messages ?? []) {
    if (db.select({ id: messages.id }).from(messages).where(eq(messages.externalId, `gmail:${id}`)).get()) continue;
    const m = await getJson<Msg>(`${API}/messages/${id}?format=full`, bearer(token));
    const header = (n: string) => m.payload.headers.find((h) => h.name.toLowerCase() === n)?.value ?? "";
    const from = parseFrom(header("from"));
    if (!from.email || from.email === ownEmail.toLowerCase()) continue;
    const body = `${header("subject")}\n\n${stripQuoted(plainText(m.payload) ?? m.snippet)}`.slice(0, 3000);

    let brandId =
      db.select({ id: brandContacts.brandId }).from(brandContacts).where(and(eq(brandContacts.channel, "email"), sql`lower(${brandContacts.handle}) = ${from.email}`)).get()?.id ??
      (FREE_MAIL.test(from.domain) ? undefined : db.select({ id: brands.id }).from(brands).where(sql`lower(${brands.website}) like ${"%" + from.domain}`).get()?.id);
    const brief = detector.detect(body);
    if (!brandId) {
      if (!brief) continue;
      const name = from.name || from.domain.split(".")[0];
      brandId = db
        .insert(brands)
        .values({ name, category: guessTags(body).productCategory, website: FREE_MAIL.test(from.domain) ? null : from.domain, createdAt: toBangkok(Number(m.internalDate) / 1000) })
        .returning({ id: brands.id })
        .get().id;
      db.insert(brandContacts).values({ brandId, name: from.name || from.email, role: "—", channel: "email", handle: from.email, isPrimary: true }).run();
      created++;
    }
    db.insert(messages)
      .values({ brandId, direction: "in", channel: "email", body, sentAt: toBangkok(Number(m.internalDate) / 1000), brief, briefStatus: brief ? "new" : "none", externalId: `gmail:${id}` })
      .run();
    imported++;
  }
  return { imported, newBrands: created };
}

const encodeHeader = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`);

/** Saves a draft in the creator's Gmail. The creator reviews and sends it from Gmail. */
export async function createGmailDraft(token: string, to: string, subject: string, body: string) {
  const mime = [`To: ${to}`, `Subject: ${encodeHeader(subject)}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(body, "utf8").toString("base64")].join("\r\n");
  return getJson<{ id: string }>(`${API}/drafts`, {
    method: "POST",
    headers: { ...(bearer(token).headers as Record<string, string>), "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw: Buffer.from(mime, "utf8").toString("base64url") } }),
  });
}
