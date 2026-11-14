/** Small fetch helpers that turn API errors into readable messages. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** "host: 400 message" from a failed response (JSON error bodies from Google, Meta and TikTok). */
export async function readError(res: Response, url = res.url): Promise<string> {
  const text = await res.text().catch(() => "");
  return errorText(url, res.status, text);
}

function errorText(url: string, status: number, text: string): string {
  let d: { error?: { message?: string; error_user_msg?: string } | string; error_description?: string; message?: string } | null = null;
  try {
    d = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  const msg = (typeof d?.error === "object" ? (d.error?.error_user_msg ?? d.error?.message) : (d?.error_description ?? d?.error ?? d?.message)) ?? text.slice(0, 200);
  let host = "request";
  try {
    host = new URL(url).host;
  } catch {
    /* keep default */
  }
  return `${host}: ${status} ${msg}`;
}

export async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new ApiError(errorText(url, res.status, text), res.status);
  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    return null as T;
  }
}

export const bearer = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}` } });

export function form(body: Record<string, string>): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() };
}
