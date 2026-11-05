import type { I18n } from "@/lib/i18n";
import type { Facts } from "./facts";

export interface Citation {
  label: string;
  href: string;
}

export interface Answer {
  text: string;
  citations: Citation[];
  engine: "rules" | "claude";
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * Answers a plain-language question from `Facts`. `RuleAssistant` works offline;
 * `ClaudeAssistant` is used when ANTHROPIC_API_KEY is set (see ./index.ts).
 */
export interface Assistant {
  readonly engine: Answer["engine"];
  answer(question: string, facts: Facts, i18n: I18n, history: ChatTurn[]): Promise<Answer>;
}
