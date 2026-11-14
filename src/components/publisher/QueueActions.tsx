"use client";
import { useTransition } from "react";
import { cancelJobAction, publishJobNowAction, retryJobAction } from "@/app/actions";
import { useI18n } from "@/lib/i18n/client";
import type { PublishStatus } from "@/db/schema";

export function QueueActions({ jobId, status }: { jobId: number; status: PublishStatus }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  if (status === "failed" || status === "partial") {
    return (
      <div className="flex justify-end text-xs">
        <button disabled={pending} onClick={() => start(() => retryJobAction(jobId))} className="font-medium text-accent-strong hover:underline disabled:opacity-50">
          {pending ? t.publisher.publishing : t.publisher.retry}
        </button>
      </div>
    );
  }
  return (
    <div className="flex justify-end gap-3 text-xs">
      <button disabled={pending} onClick={() => start(() => publishJobNowAction(jobId))} className="font-medium text-accent-strong hover:underline disabled:opacity-50">
        {pending ? t.publisher.publishing : t.publisher.publishNow}
      </button>
      <button disabled={pending} onClick={() => start(() => cancelJobAction(jobId))} className="text-muted hover:text-ink disabled:opacity-50">
        {t.publisher.cancel}
      </button>
    </div>
  );
}
