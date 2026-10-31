"use client";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { t } from "@/lib/i18n";
import { btn } from "@/components/ui";

export function PrintBar() {
  const router = useRouter();
  return (
    <div className="no-print sticky top-0 z-10 mb-6 flex items-center justify-between border-b border-line bg-paper/90 px-4 py-3 backdrop-blur">
      <button onClick={() => router.back()} className={btn.ghost}>
        <ArrowLeft size={16} aria-hidden /> {t.common.back}
      </button>
      <button onClick={() => window.print()} className={btn.primary}>
        <Printer size={16} aria-hidden /> {t.common.print}
      </button>
    </div>
  );
}
