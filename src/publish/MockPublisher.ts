import type { PlatformId, PlatformPublisher, PublishRequest, PublishResult } from "./types";

const PREFIX: Record<PlatformId, string> = { tiktok: "tt", instagram: "ig", youtube: "yt" };

/** Pretends to publish: always succeeds and returns a fake platform ID. Nothing leaves the machine. */
export class MockPublisher implements PlatformPublisher {
  readonly kind = "mock" as const;
  constructor(readonly platform: PlatformId) {}
  async publish(req: PublishRequest): Promise<PublishResult> {
    void req;
    return { ok: true, externalId: `${PREFIX[this.platform]}_pub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
  }
}

/** Swap point: return an API-backed publisher per platform when credentials exist. */
export function getPublisher(platform: PlatformId): PlatformPublisher {
  return new MockPublisher(platform);
}
