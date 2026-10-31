import { cookies } from "next/headers";
import { asLocale, LOCALE_COOKIE, makeI18n, type I18n } from "./index";

/** Current request's UI language (from the `locale` cookie). */
export async function getI18n(): Promise<I18n> {
  const store = await cookies();
  return makeI18n(asLocale(store.get(LOCALE_COOKIE)?.value));
}
