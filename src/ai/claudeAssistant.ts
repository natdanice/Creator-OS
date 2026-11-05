/**
 * Optional Ask AI engine backed by Claude. Used only when ANTHROPIC_API_KEY is set.
 * Claude sees the same Facts object as the offline engine (aggregates + fictional
 * brand names, no comments or audience IDs) and must cite the source ids it used.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { I18n } from "@/lib/i18n";
import type { Answer, Assistant, ChatTurn } from "./Assistant";
import type { Facts } from "./facts";
import { citations } from "./ruleAssistant";

export const CLAUDE_MODEL = "claude-opus-5-5";

const SYSTEM = `You are the assistant inside Creator OS, a CRM + customer-data tool for a solo Thai influencer.
Answer the creator's question using ONLY the JSON facts below. If the facts don't contain the answer, say so plainly — never invent numbers, brands or dates.
Money is Thai baht (THB, write ฿ with thousands separators). "today" in the facts is the current date.
Keep answers short: 1 sentence of answer, then up to 6 short bullet lines starting with "• ". No markdown headings, tables or bold.
Reply in {LANGUAGE}.

Source ids you may cite: "brand:<id>" (a brand's Brand 360 page), "inbox:<brandId>" (that brand's message thread), "inbox", "finance", "overview", "audience", "automation".
After the answer, add one final line exactly in this form: SOURCES: id1, id2
List only ids whose data you actually used.`;

export class ClaudeAssistant implements Assistant {
  readonly engine = "claude" as const;
  private client = new Anthropic();

  async answer(question: string, facts: Facts, i18n: I18n, history: ChatTurn[]): Promise<Answer> {
    // Earlier turns, oldest first, starting with a user turn (the API requires it).
    const past = history.slice(-6);
    while (past.length && past[0].role !== "user") past.shift();

    const res = await this.client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [
        {
          type: "text",
          text: `${SYSTEM.replace("{LANGUAGE}", i18n.locale === "th" ? "Thai" : "English")}\n\nFACTS:\n${JSON.stringify(facts)}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [...past.map((m) => ({ role: m.role, content: m.text })), { role: "user", content: question }],
    });
    if (res.stop_reason === "refusal") throw new Error("refusal");

    const raw = res.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    const m = raw.match(/\n?SOURCES:\s*(.*)$/i);
    const ids = (m?.[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { text: (m ? raw.slice(0, m.index) : raw).trim(), citations: citations(i18n, facts, [...new Set(ids)]), engine: this.engine };
  }
}
