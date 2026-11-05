/** Small fetch helpers that turn API errors into readable messages. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const d = data as { error?: { message?: string } | string; error_description?: string; message?: string } | null;
    const msg = (typeof d?.error === "object" ? d.error?.message : d?.error_description ?? d?.error ?? d?.message) ?? text.slice(0, 200);
    throw new ApiError(`${new URL(url).host}: ${res.status} ${msg}`, res.status);
  }
  return data as T;
}

export const bearer = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}` } });

export function form(body: Record<string, string>): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() };
}
