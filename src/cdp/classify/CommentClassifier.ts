import type { CommentCategory, ProductCategory } from "@/db/schema";

export interface ClassifyInput {
  text: string;
  /** Context that an LLM classifier could use (the keyword classifier ignores it). */
  contentTitle?: string;
  productCategory?: ProductCategory;
}

/**
 * Comment categorizer. The MVP uses `KeywordClassifier`; an LLM-backed class can
 * implement the same interface and be swapped in via `getClassifier()` without
 * touching ingest or analytics. Batch-shaped and async so an LLM can classify
 * many comments per request.
 */
export interface CommentClassifier {
  readonly name: string;
  classifyBatch(inputs: ClassifyInput[]): Promise<CommentCategory[]>;
}
