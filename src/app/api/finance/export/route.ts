/** The yearly income CSV for the accountant. Built by the Go API; this route only passes it on. */
import { apiFetch, ApiError } from "@/lib/api";

export async function GET(req: Request) {
  const year = new URL(req.url).searchParams.get("year");
  if (year !== null && !/^\d{4}$/.test(year)) return new Response("bad year", { status: 400 });
  try {
    const res = await apiFetch(`/api/v1/finance/export${year ? `?year=${year}` : ""}`);
    return new Response(res.body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": res.headers.get("Content-Disposition") ?? "attachment" } });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "API error", { status: e instanceof ApiError ? e.status : 502 });
  }
}
