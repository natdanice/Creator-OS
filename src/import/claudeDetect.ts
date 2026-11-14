/**
 * AI recogniser: asks Claude what an unfamiliar table is. Used only when ANTHROPIC_API_KEY is set,
 * and only for tables the built-in recogniser wasn't sure about.
 *
 * Privacy: Claude gets the file/sheet name, the column names and 3 sample rows. Values in columns
 * that look like people (names, usernames, emails, phones) are replaced with "<person>", and long
 * values are cut to 60 characters. Whole files are never sent.
 *
 * The answer comes back as JSON matching a schema (structured outputs). The SDK helper turns the
 * schema's enum lists into descriptions, so the allowed values guide Claude but aren't enforced by
 * the API: every value is checked here (kind, platform, field, and column = one of the real headers).
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { CLAUDE_MODEL } from "@/ai/claudeAssistant";
import { text } from "./values";
import { ALL_FIELDS, FIELDS, MAPPED_KINDS, PLATFORM_KINDS, type Detection, type MappedKind, type PlatformId, type Table } from "./types";

export const aiAvailable = () => !!process.env.ANTHROPIC_API_KEY;

const PERSON = /user|name|author|handle|email|e-mail|phone|tel|line ?id|ผู้ใช้|ชื่อ|อีเมล|โทร/i;

function sampleOf(t: Table) {
  const keep = t.headers.slice(0, 40);
  return t.rows.slice(0, 3).map((r) =>
    Object.fromEntries(
      keep.map((h) => {
        const v = r[h];
        if (v === null) return [h, null];
        if (PERSON.test(h)) return [h, "<person>"];
        return [h, typeof v === "number" ? v : text(v).slice(0, 60)];
      }),
    ),
  );
}

const SYSTEM = `You identify spreadsheet tables uploaded to Creator OS, a CRM and analytics app for a solo influencer (TikTok, Instagram, YouTube; often Thai).
For the table you're given, decide what it contains and which column holds each field.

Kinds and their fields:
${MAPPED_KINDS.map((k) => `- ${k}: ${FIELDS[k].join(", ")}`).join("\n")}
- unknown: anything else (map nothing)

Meanings:
- posts: one row per post/video (lifetime totals), or per post per day when there is also a "date" column. postedAt = when it was published; date = the day a metrics row is for.
- comments: one row per comment (text, who wrote it, which post).
- account_daily: account-level totals per day (no per-post rows). followers = running total; newFollowers = gained that day.
- audience_age / audience_gender / audience_country: follower demographics; key = the age bucket / gender / country, share = the percentage or count.
- brands_deals: brands the creator works with and their deals (brand, deal_title, stage, value in THB, dates).
platform: which social platform the table is from (tiktok, instagram, youtube), or "none" for brands_deals/unknown or when you can't tell.
Map only columns you are confident about; leave the rest out. confidence: high only when both the kind and (if needed) the platform are clear.`;

export async function detectByAI(t: Table): Promise<Detection | null> {
  if (!aiAvailable() || !t.headers.length) return null;
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["kind", "platform", "confidence", "reason", "mapping"],
    properties: {
      kind: { type: "string", enum: [...MAPPED_KINDS, "unknown"] },
      platform: { type: "string", enum: ["tiktok", "instagram", "youtube", "none"] },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      reason: { type: "string", description: "One short sentence: why you think so" },
      mapping: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field", "column"],
          properties: { field: { type: "string", enum: ALL_FIELDS }, column: { type: "string", enum: t.headers } },
        },
      },
    },
  } as const;

  const client = new Anthropic();
  const res = await client.beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaJSONSchemaOutputFormat(schema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: JSON.stringify({ file: t.file, sheet: t.sheet, rowCount: t.rows.length, columns: t.headers, sampleRows: sampleOf(t) }),
      },
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) return null;
  const out = res.parsed_output;
  const kind = (MAPPED_KINDS as string[]).includes(out.kind) ? (out.kind as MappedKind) : "unknown";
  // Keep only real columns and fields that belong to the chosen kind, each column once.
  const allowed = kind === "unknown" ? [] : FIELDS[kind];
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const { field, column } of out.mapping ?? []) {
    if (!allowed.includes(field) || !t.headers.includes(column) || mapping[field] || used.has(column)) continue;
    mapping[field] = column;
    used.add(column);
  }
  const platform = ["tiktok", "instagram", "youtube"].includes(out.platform) ? (out.platform as PlatformId) : null;
  const sure = (["high", "medium", "low"] as const).find((c) => c === out.confidence) ?? "low";
  const confidence = kind !== "unknown" && PLATFORM_KINDS.has(kind) && !platform ? "medium" : sure;
  return { kind, platform, mapping, confidence, by: "ai", reason: out.reason };
}
