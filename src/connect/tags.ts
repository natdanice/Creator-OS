/**
 * Platforms don't know a post's content type or product category, so API posts get a
 * best guess from the title/caption (Thai + English keywords). Defaults: review / home.
 */
import type { ContentType, ProductCategory } from "@/db/schema";
import { TIMEZONE } from "@/lib/config";

const CATEGORY: [ProductCategory, RegExp][] = [
  ["skincare", /skin|serum|sunscreen|cleans|moistur|เซรั่ม|ครีม|กันแดด|คลีนซิ่ง|สกินแคร์|ผิว|มอยส์/i],
  ["tech", /tech|phone|iphone|android|camera|headphone|earbud|laptop|keyboard|gadget|หูฟัง|กล้อง|มือถือ|โทรศัพท์|คีย์บอร์ด|แกดเจ็ต|พาวเวอร์แบงค์|ลำโพง|โน้ตบุ๊ก/i],
  ["food", /food|coffee|snack|recipe|cafe|eat|กาแฟ|ขนม|อาหาร|ซอส|ชา|กิน|ร้านอาหาร|คาเฟ่|สูตร/i],
  ["fashion", /fashion|outfit|ootd|shoe|sneaker|bag|dress|แฟชั่น|เสื้อ|รองเท้า|กระเป๋า|ชุด|แต่งตัว/i],
  ["home", /home|room|decor|clean|bed|pillow|บ้าน|ห้อง|หมอน|เทียน|ฟอกอากาศ|จัดห้อง|ของใช้/i],
];
const TYPE: [ContentType, RegExp][] = [
  ["review", /review|unbox|vs\b|รีวิว|แกะกล่อง|เทียบ|ใช้จริง/i],
  ["tutorial", /how ?to|tutorial|tips?|guide|วิธี|ฮาวทู|ทริค|สอน/i],
  ["bts", /bts|behind|เบื้องหลัง/i],
  ["vlog", /vlog|day in|weekend|วันหนึ่ง|เที่ยว|ชีวิต/i],
];

export function guessTags(text: string): { type: ContentType; productCategory: ProductCategory } {
  return { type: TYPE.find(([, re]) => re.test(text))?.[0] ?? "review", productCategory: CATEGORY.find(([, re]) => re.test(text))?.[0] ?? "home" };
}

/** "Paid partnership"-style markers in a caption. */
export const looksSponsored = (text: string) => /#ad\b|#sponsored|#โฆษณา|paid partnership|ได้รับการสนับสนุน/i.test(text);

const bkk = new Intl.DateTimeFormat("sv-SE", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
/** Any date (ISO string, Date, or unix seconds) → "YYYY-MM-DDTHH:mm:ss" Bangkok time. */
export function toBangkok(d: string | number | Date): string {
  const date = typeof d === "number" ? new Date(d * 1000) : new Date(d);
  return bkk.format(date).replace(" ", "T");
}

export function firstLine(text: string, max = 90) {
  return (text.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, max) || "(untitled)";
}
