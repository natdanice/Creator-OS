import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { loginAction } from "@/app/actions";
import { btn } from "@/components/ui";
import { authEnabled } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.auth.title };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { t } = await getI18n();
  const { next = "/", error } = await searchParams;
  if (!authEnabled()) redirect("/");
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-4">
      <form action={loginAction} className="w-full max-w-sm rounded-xl border border-line bg-white p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent font-heading text-lg font-semibold text-white">C</div>
          <div className="font-heading text-xl">{t.app.name}</div>
        </div>
        <h1 className="flex items-center gap-2 text-lg font-medium">
          <Lock size={16} className="text-muted" aria-hidden /> {t.auth.title}
        </h1>
        <p className="mt-1 text-sm text-muted">{t.auth.hint}</p>
        <input type="hidden" name="next" value={next.startsWith("/") && !next.startsWith("//") ? next : "/"} />
        <label className="mt-4 block text-sm">
          <span className="mb-1 block text-xs text-muted">{t.auth.password}</span>
          <input id="password" name="password" type="password" required autoFocus autoComplete="current-password" className={`${btn.input} w-full`} />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-sm text-bad">
            {t.auth.wrong}
          </p>
        )}
        <button className={`${btn.primary} mt-4 w-full`}>{t.auth.submit}</button>
      </form>
    </main>
  );
}
