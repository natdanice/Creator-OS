import type { CommentClassifier } from "./CommentClassifier";
import { KeywordClassifier } from "./keywordClassifier";

/** Swap point: return an LLM-backed CommentClassifier here when ready. */
export function getClassifier(): CommentClassifier {
  return new KeywordClassifier();
}

export type { CommentClassifier } from "./CommentClassifier";
