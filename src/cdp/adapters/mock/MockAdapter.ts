import type { PlatformAdapter, PlatformId } from "../PlatformAdapter";
import type { PlatformBundle } from "./generator";

/** Serves pre-generated mock records through the same interface a real source would use. */
export class MockAdapter implements PlatformAdapter {
  readonly kind = "mock" as const;
  constructor(
    readonly platform: PlatformId,
    private bundle: PlatformBundle,
  ) {}
  async importContents() {
    return this.bundle.contents;
  }
  async importMetrics() {
    return this.bundle.metrics;
  }
  async importComments() {
    return this.bundle.comments;
  }
  async importAudience() {
    return this.bundle.audience;
  }
}
