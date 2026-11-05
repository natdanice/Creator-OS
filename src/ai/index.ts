import type { Assistant } from "./Assistant";
import { ClaudeAssistant } from "./claudeAssistant";
import { RuleAssistant } from "./ruleAssistant";

/** Claude when an API key is configured, otherwise the offline rule-based engine. */
export function getAssistant(): Assistant {
  return process.env.ANTHROPIC_API_KEY ? new ClaudeAssistant() : new RuleAssistant();
}

export { RuleAssistant };
export type { Answer, ChatTurn, Citation } from "./Assistant";
