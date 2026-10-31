import type { CommentCategory } from "@/db/schema";
import type { ClassifyInput, CommentClassifier } from "./CommentClassifier";

/**
 * Rule-based classifier. Rules are checked top to bottom; the first match wins.
 * Order matters: spam is removed first, then the commercially valuable
 * product questions, then requests, then any other question, else praise.
 */
const RULES: { category: CommentCategory; patterns: RegExp[] }[] = [
  {
    category: "spam",
    patterns: [/https?:\/\//i, /ติดตามกลับ/, /ฟอลกลับ/, /\bf4f\b/i, /ทักไลน์/, /รายได้เสริม/, /รับสมัคร/, /ปั๊มยอด/, /เว็บตรง/],
  },
  {
    category: "product_question",
    patterns: [
      /ซื้อ(ได้)?ที่ไหน/, /ราคา/, /กี่บาท/, /ลิ้?งค์|ลิงก์/, /โค้ด(ส่วนลด)?/, /ส่วนลด/, /ของแท้/, /รุ่นไหน/, /ร้านไหน/,
      /สั่ง(ซื้อ)?ยังไง/, /มีขาย/, /แพ้ง่าย.*ได้(ไหม|มั้ย)/, /แบต(อยู่)?.*(กี่|นาน)/, /ใช้กับ.+ได้(ไหม|มั้ย)/,
      /shopee|lazada/i, /ส่งต่างประเทศ/, /ประกัน(กี่|ศูนย์)/,
    ],
  },
  {
    category: "content_request",
    patterns: [/อยากให้(ลอง)?รีวิว/, /ทำคลิป/, /ขอคลิป/, /ทำต่อ/, /ภาค\s?2/, /อยากดู/, /รีวิว.+หน่อย/, /ทำ.+ด้วย(นะ|ค่ะ|ครับ)?$/, /ขอ(ฮาวทู|how ?to)/i],
  },
  {
    category: "general_question",
    patterns: [/\?|？/, /(ไหม|มั้ย|อะไร|ยังไง|เมื่อไหร่|ที่ไหน|กี่โมง)(คะ|ครับ|จ้า)?\s*$/],
  },
];

export class KeywordClassifier implements CommentClassifier {
  readonly name = "keyword-v1";

  classifyOne(text: string): CommentCategory {
    const t = text.trim();
    for (const rule of RULES) {
      if (rule.patterns.some((p) => p.test(t))) return rule.category;
    }
    return "praise";
  }

  async classifyBatch(inputs: ClassifyInput[]): Promise<CommentCategory[]> {
    return inputs.map((i) => this.classifyOne(i.text));
  }
}
