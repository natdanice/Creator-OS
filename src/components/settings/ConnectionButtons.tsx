"use client";
import { useState, useTransition } from "react";
import { RefreshCw, Unplug } from "lucide-react";
import { disconnectAction, logoutAction, syncNowAction } from "@/app/actions";
import { btn } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";

export function SyncButton({ provider }: { provider: string }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button className={btn.ghost} disabled={pending} onClick={() => start(async () => setResult(await syncNowAction(provider)))}>
        <RefreshCw size={14} className={pending ? "animate-spin" : ""} aria-hidden /> {pending ? t.connect.syncing : t.connect.syncNow}
      </button>
      {result && (
        <span role="status" className={`text-xs ${result.startsWith("error") ? "text-bad" : "text-good"}`}>
          {result}
        </span>
      )}
    </span>
  );
}

export function DisconnectButton({ provider }: { provider: string }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <button className="inline-flex items-center gap-1 text-xs text-muted hover:text-bad disabled:opacity-50" disabled={pending} onClick={() => start(() => disconnectAction(provider))}>
      <Unplug size={12} aria-hidden /> {t.connect.disconnect}
    </button>
  );
}

export function LogoutButton() {
  const { t } = useI18n();
  return (
    <form action={logoutAction}>
      <button className={btn.ghost}>{t.auth.logout}</button>
    </form>
  );
}
