"use client";
import { useTransition } from "react";
import { Check } from "lucide-react";
import { markInvoicePaid } from "@/app/actions";
import { useI18n } from "@/lib/i18n/client";

export function MarkPaidButton({ invoiceId }: { invoiceId: number }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => markInvoicePaid(invoiceId))}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-xs font-medium text-ink hover:bg-paper disabled:opacity-50"
    >
      <Check size={12} aria-hidden /> {t.finance.markPaid}
    </button>
  );
}
