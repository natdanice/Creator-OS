/**
 * Suggested replies (Thai, because the audience and brands are Thai).
 * Plain templates for the prototype; an LLM could personalise them later.
 */
import type { CommentCategory, ProductCategory } from "@/db/schema";
import type { BriefSignal } from "@/db/schema";
import { baht } from "@/lib/format";

const COMMENT_REPLIES: Record<CommentCategory, string> = {
  product_question: "ขอบคุณที่ถามนะคะ 🙏 รายละเอียดและลิงก์สินค้าอยู่ที่ลิงก์ในไบโอเลยค่ะ",
  general_question: "ขอบคุณที่ดูนะคะ 😊 {answer}",
  content_request: "ไอเดียดีมากค่ะ จดไว้แล้ว เดี๋ยวทำให้ดูนะคะ ✨",
  praise: "ขอบคุณมากๆ ค่ะ ดีใจที่ชอบนะคะ ❤️",
  spam: "",
};

const PQ_BY_CATEGORY: Partial<Record<ProductCategory, string>> = {
  tech: "ขอบคุณที่ถามนะคะ 🙏 สเปก ราคา และลิงก์ร้านที่มีประกันศูนย์ อยู่ในไบโอเลยค่ะ",
  skincare: "ขอบคุณที่ถามนะคะ 🙏 ส่วนผสมและลิงก์ร้านทางการอยู่ในไบโอค่ะ ผิวแพ้ง่ายแนะนำทดสอบที่ท้องแขนก่อนนะคะ",
};

export function suggestCommentReply(category: CommentCategory, productCategory: ProductCategory, isSponsored: boolean) {
  if (category === "product_question") {
    const base = PQ_BY_CATEGORY[productCategory] ?? COMMENT_REPLIES.product_question;
    return isSponsored ? `${base} (มีโค้ดส่วนลดจากแบรนด์ในไบโอด้วยค่ะ)` : base;
  }
  return COMMENT_REPLIES[category].replace("{answer}", "รายละเอียดอยู่ใต้คลิปเลยค่ะ");
}

/** A first reply to a brand, depending on what they just sent. */
export function suggestBrandReply(contactName: string, lastInbound: { body: string; brief: BriefSignal | null } | null) {
  const hi = `สวัสดีค่ะ ${contactName}`;
  if (!lastInbound) return `${hi} `;
  if (lastInbound.brief) {
    const b = lastInbound.brief;
    const parts = [b.product && `“${b.product}”`, b.timing && `ช่วง${b.timing.replace(/^ช่วง/, "")}`, b.budget && `งบ ${baht(b.budget)}`].filter(Boolean).join(" · ");
    return `${hi} ขอบคุณสำหรับบรีฟนะคะ${parts ? ` (${parts})` : ""} สนใจร่วมงานค่ะ ขอเวลาวางไอเดียแล้วจะส่งใบเสนอราคาให้ภายใน 24 ชั่วโมงนะคะ`;
  }
  if (/โอน|ชำระ|บิล|บัญชี/.test(lastInbound.body)) return `${hi} รับทราบค่ะ ขอบคุณที่แจ้งนะคะ โอนแล้วรบกวนส่งสลิปให้ด้วยนะคะ 🙏`;
  if (/ลด|ต่อรอง|ปรับ/.test(lastInbound.body)) return `${hi} ขอบคุณค่ะ ขอเสนอเป็นราคาเดิมแต่เพิ่มสิทธิ์ใช้คอนเทนต์ 30 วันให้ฟรีได้ไหมคะ หรือปรับลดจำนวนชิ้นงานเพื่อให้อยู่ในงบค่ะ`;
  if (/ส่ง.*(ตัวอย่าง|สินค้า|ของ)/.test(lastInbound.body)) return `${hi} ขอบคุณค่ะ ได้รับของแล้วจะแจ้งนะคะ แล้วจะส่งดราฟต์ให้ตรวจตามกำหนดค่ะ`;
  return `${hi} ขอบคุณค่ะ รับทราบนะคะ 🙏`;
}
