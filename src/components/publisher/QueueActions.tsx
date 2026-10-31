"use client";
import { useTransition } from "react";
import { cancelJobAction, publishJobNowAction } from "@/app/actions";
import { useI18n } from "@/lib/i18n/client";

export function QueueActions({ jobId }: { jobId: number }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <div className="flex justify-end gap-3 text-xs">
      <button disabled={pending} onClick={() => start(() => publishJobNowAction(jobId))} className="font-medium text-accent-strong hover:underline disabled:opacity-50">
        {t.publisher.publishNow}
      </button>
      <button disabled={pending} onClick={() => start(() => cancelJobAction(jobId))} className="text-muted hover:text-ink disabled:opacity-50">
        {t.publisher.cancel}
      </button>
    </div>
  );
}
