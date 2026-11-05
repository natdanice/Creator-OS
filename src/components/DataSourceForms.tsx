"use client";
import { useActionState, useTransition } from "react";
import { FileUp, RotateCcw } from "lucide-react";
import { importCsvAction, importSampleAction, resetDemoAction, type ImportState } from "@/app/actions";
import { btn } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";

function Result({ state }: { state: ImportState | null }) {
  if (!state) return null;
  return (
    <p role="status" className={`rounded-lg px-3 py-2 text-xs ${state.ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>
      {state.message}
    </p>
  );
}

export function CsvImportForm({ platform }: { platform: string }) {
  const { t, live } = useI18n();
  const [state, upload, uploading] = useActionState(importCsvAction, null);
  const [sampleState, loadSample, sampling] = useActionState(importSampleAction, null);
  return (
    <div className="space-y-2">
      <form action={upload} className="space-y-2">
        <input type="hidden" name="platform" value={platform} />
        <label className="block text-xs text-muted">
          {t.settings.metricsCsv}
          <input type="file" name="metrics" accept=".csv,text/csv" className="mt-1 block w-full text-xs file:mr-2 file:rounded-md file:border file:border-line file:bg-white file:px-2 file:py-1" />
        </label>
        <label className="block text-xs text-muted">
          {t.settings.commentsCsv}
          <input type="file" name="comments" accept=".csv,text/csv" className="mt-1 block w-full text-xs file:mr-2 file:rounded-md file:border file:border-line file:bg-white file:px-2 file:py-1" />
        </label>
        <button className={`${btn.ghost} w-full`} disabled={uploading}>
          <FileUp size={14} aria-hidden /> {t.settings.import}
        </button>
      </form>
      {/* Sample files are demo data; never offer them against the real database. */}
      {!live && (
        <form action={loadSample}>
          <input type="hidden" name="platform" value={platform} />
          <button className="w-full text-center text-xs text-accent-strong hover:underline disabled:opacity-50" disabled={sampling}>
            {t.settings.loadSample}
          </button>
        </form>
      )}
      <Result state={state ?? sampleState} />
    </div>
  );
}

export function ResetDemoButton() {
  const { t, dateShort } = useI18n();
  const [pending, start] = useTransition();
  return (
    <button className={btn.ghost} disabled={pending} onClick={() => start(() => resetDemoAction())}>
      <RotateCcw size={14} aria-hidden /> {pending ? "…" : t.settings.reset}
    </button>
  );
}
