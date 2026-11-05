/**
 * The seeded STORY. Every brand and deal here is fictional.
 * Offsets are "days before STORY_DATE" so the story moves with the anchor date.
 *
 * What the data is meant to show (checked by `npm run verify`):
 *  - Glowberry Skin is a Partner (4 paid deals in the last 12 months).
 *  - Sunday Brew, Lumi Lens and Daisy Thread are One-time brands silent > 120 days.
 *  - Pixel Pal has an invoice 35 days past due.
 *  - Nook Home posted exactly 7 days ago  → +7 report rule.
 *  - Glowberry posted exactly 30 days ago → +30 report + proposal rule.
 *  - Tech posts get a burst of product questions in the last 7 days → spike rule.
 */
import type { DealStage, ProductCategory } from "@/db/schema";

export const PLATFORMS = [
  { id: "tiktok", name: "TikTok", handle: "@everyday.mock", color: "#2a78d6" },
  { id: "instagram", name: "Instagram", handle: "@everyday.mock", color: "#d55181" },
  { id: "youtube", name: "YouTube", handle: "Everyday Mock", color: "#c98500" },
] as const;

export interface RateCardItem {
  code: string;
  name: string;
  platformId: "tiktok" | "instagram" | "youtube" | null;
  kind: "single" | "bundle" | "retainer" | "addon";
  description: string;
  price: number;
  includes: string[];
}

export const RATE_CARD: RateCardItem[] = [
  { code: "TT_VIDEO", name: "TikTok วิดีโอ 60 วิ", platformId: "tiktok", kind: "single", description: "วิดีโอรีวิว/ฮาวทู 1 คลิป แก้ไขได้ 1 ครั้ง", price: 18000, includes: ["TT_VIDEO"] },
  { code: "IG_REEL", name: "Instagram Reel", platformId: "instagram", kind: "single", description: "Reel 1 ชิ้น + แคปชันพร้อมแท็กแบรนด์", price: 15000, includes: ["IG_REEL"] },
  { code: "IG_STORY", name: "IG Story 3 เฟรม", platformId: "instagram", kind: "single", description: "สตอรี่ 3 เฟรม พร้อมลิงก์สติกเกอร์", price: 6000, includes: [] },
  { code: "YT_INTEGRATION", name: "YouTube Integration 60–90 วิ", platformId: "youtube", kind: "single", description: "ช่วงพูดถึงสินค้าในคลิปหลัก", price: 20000, includes: ["YT_INTEGRATION"] },
  { code: "YT_DEDICATED", name: "YouTube รีวิวเต็มคลิป", platformId: "youtube", kind: "single", description: "คลิปรีวิวเฉพาะสินค้า 8–12 นาที", price: 45000, includes: ["YT_DEDICATED"] },
  { code: "BUNDLE_3P", name: "แพ็กเกจ 3 แพลตฟอร์ม", platformId: null, kind: "bundle", description: "TikTok + IG Reel + YouTube Integration (ประหยัดกว่าแยก 8,000)", price: 45000, includes: ["TT_VIDEO", "IG_REEL", "YT_INTEGRATION"] },
  { code: "RETAINER_Q", name: "Retainer รายไตรมาส", platformId: null, kind: "retainer", description: "แพ็กเกจ 3 แพลตฟอร์ม × 3 เดือน ส่วนลด 10%", price: 121500, includes: ["TT_VIDEO", "IG_REEL", "YT_INTEGRATION"] },
  { code: "ADDON_USAGE", name: "สิทธิ์ใช้คอนเทนต์ 30 วัน", platformId: null, kind: "addon", description: "แบรนด์นำคลิปไปใช้ในโฆษณาได้ 30 วัน", price: 8000, includes: [] },
  { code: "ADDON_SPARK", name: "Spark Ads / Whitelisting code", platformId: null, kind: "addon", description: "ให้โค้ดโปรโมตโพสต์จากบัญชีครีเอเตอร์", price: 5000, includes: [] },
  { code: "ADDON_RUSH", name: "งานด่วน 72 ชม.", platformId: null, kind: "addon", description: "ส่งดราฟต์ภายใน 72 ชั่วโมง", price: 5000, includes: [] },
];

export { DELIVERABLE_PLATFORM } from "@/crm/deliverables";

export interface BrandSpec {
  key: string;
  name: string;
  category: ProductCategory;
  contact: { name: string; role: string; channel: "line" | "email" | "ig_dm" };
  createdDaysAgo: number;
  notes?: string;
}

export const BRANDS: BrandSpec[] = [
  { key: "glow", name: "Glowberry Skin", category: "skincare", contact: { name: "คุณแพรวา (สมมติ)", role: "Brand Manager", channel: "line" }, createdDaysAgo: 450, notes: "ลูกค้าหลัก ชอบรายงานผลแบบละเอียด" },
  { key: "nook", name: "Nook Home", category: "home", contact: { name: "คุณต้นกล้า (สมมติ)", role: "Marketing Lead", channel: "email" }, createdDaysAgo: 230 },
  { key: "pixel", name: "Pixel Pal", category: "tech", contact: { name: "คุณภูมิ (สมมติ)", role: "Influencer Marketing", channel: "email" }, createdDaysAgo: 310, notes: "จ่ายช้า ต้องตามบิล" },
  { key: "mellow", name: "Mellow Bites", category: "food", contact: { name: "คุณมะปราง (สมมติ)", role: "Brand Executive", channel: "line" }, createdDaysAgo: 430 },
  { key: "sunday", name: "Sunday Brew", category: "food", contact: { name: "คุณข้าวหอม (สมมติ)", role: "Founder", channel: "ig_dm" }, createdDaysAgo: 510 },
  { key: "lumi", name: "Lumi Lens", category: "tech", contact: { name: "คุณเจได (สมมติ)", role: "PR Manager", channel: "email" }, createdDaysAgo: 200 },
  { key: "daisy", name: "Daisy Thread", category: "fashion", contact: { name: "คุณใบเตย (สมมติ)", role: "Social Media Lead", channel: "ig_dm" }, createdDaysAgo: 180 },
  { key: "kumo", name: "Kumo Audio", category: "tech", contact: { name: "คุณโอ๊ต (สมมติ)", role: "Marketing Manager", channel: "line" }, createdDaysAgo: 110 },
  { key: "aroma", name: "Aroma Lab", category: "home", contact: { name: "คุณน้ำผึ้ง (สมมติ)", role: "Brand Owner", channel: "line" }, createdDaysAgo: 95 },
  { key: "fresh", name: "Fresh Leaf", category: "food", contact: { name: "คุณกานต์ (สมมติ)", role: "Digital Marketing", channel: "email" }, createdDaysAgo: 120 },
  { key: "orbit", name: "Orbit Fit", category: "fashion", contact: { name: "คุณบอส (สมมติ)", role: "Partnership", channel: "email" }, createdDaysAgo: 22 },
  { key: "cloud", name: "Cloud Nine Bedding", category: "home", contact: { name: "คุณฟ้า (สมมติ)", role: "Marketing", channel: "line" }, createdDaysAgo: 10 },
  { key: "zesty", name: "Zesty Kitchen", category: "food", contact: { name: "คุณส้ม (สมมติ)", role: "Brand Manager", channel: "line" }, createdDaysAgo: 27 },
  { key: "byte", name: "Byte Buddy", category: "tech", contact: { name: "คุณเต้ (สมมติ)", role: "Growth Lead", channel: "ig_dm" }, createdDaysAgo: 3 },
  { key: "petal", name: "Petal Pure", category: "skincare", contact: { name: "คุณดาว (สมมติ)", role: "E-commerce Manager", channel: "email" }, createdDaysAgo: 13 },
];

export interface DealSpec {
  key: string;
  brand: string;
  title: string;
  stage: DealStage;
  deliverables: string[];
  discountPct?: number;
  /** For posted+ deals, defaults to postedDaysAgo + 21. */
  createdDaysAgo?: number;
  postedDaysAgo?: number;
  /** Paid deals default to postedDaysAgo − 25. */
  paidDaysAgo?: number;
}

export const DEALS: DealSpec[] = [
  // Glowberry Skin — Partner
  { key: "G0", brand: "glow", title: "เปิดตัวเซรั่มวิตามินซี", stage: "paid", deliverables: ["BUNDLE_3P"], postedDaysAgo: 420 },
  { key: "G1", brand: "glow", title: "แคมเปญกันแดดหน้าร้อน", stage: "paid", deliverables: ["TT_VIDEO", "IG_REEL"], postedDaysAgo: 330, discountPct: 10 },
  { key: "G2", brand: "glow", title: "Glow Set ปลายปี", stage: "paid", deliverables: ["BUNDLE_3P"], postedDaysAgo: 250, discountPct: 10 },
  { key: "G3", brand: "glow", title: "รีวิวเต็มคลิป Night Cream", stage: "paid", deliverables: ["YT_DEDICATED"], postedDaysAgo: 150, discountPct: 10 },
  { key: "G4", brand: "glow", title: "คลีนซิ่งสูตรใหม่", stage: "paid", deliverables: ["BUNDLE_3P", "ADDON_USAGE"], postedDaysAgo: 72, discountPct: 10 },
  { key: "G5", brand: "glow", title: "มอยส์เจอไรเซอร์ผิวแพ้ง่าย", stage: "invoiced", deliverables: ["BUNDLE_3P"], postedDaysAgo: 30, discountPct: 10 },
  { key: "G6", brand: "glow", title: "แคมเปญ 12.12", stage: "brief", deliverables: ["TT_VIDEO", "IG_REEL"], createdDaysAgo: 3 },
  // Nook Home — Repeat
  { key: "N1", brand: "nook", title: "เทียนหอมคอลเลกชันใหม่", stage: "paid", deliverables: ["IG_REEL", "IG_STORY"], postedDaysAgo: 200 },
  { key: "N2", brand: "nook", title: "จัดห้องทำงานกับ Nook", stage: "paid", deliverables: ["IG_REEL", "TT_VIDEO"], postedDaysAgo: 88 },
  { key: "N3", brand: "nook", title: "เครื่องฟอกอากาศมินิ", stage: "posted", deliverables: ["TT_VIDEO", "IG_REEL"], postedDaysAgo: 7 },
  { key: "N4", brand: "nook", title: "รีวิวยาว Smart Home Set", stage: "production", deliverables: ["YT_INTEGRATION"], createdDaysAgo: 10 },
  // Pixel Pal — Repeat, slow payer
  { key: "P1", brand: "pixel", title: "พาวเวอร์แบงค์รุ่นบาง", stage: "paid", deliverables: ["YT_INTEGRATION"], postedDaysAgo: 280 },
  { key: "P2", brand: "pixel", title: "รีวิวเต็มคลิปกล้องแอคชั่น", stage: "paid", deliverables: ["YT_DEDICATED"], postedDaysAgo: 140 },
  { key: "P3", brand: "pixel", title: "หูฟังตัดเสียงรบกวน", stage: "invoiced", deliverables: ["TT_VIDEO", "YT_INTEGRATION"], postedDaysAgo: 75 },
  { key: "P4", brand: "pixel", title: "เสนองานไตรมาส 1", stage: "lead", deliverables: ["BUNDLE_3P"], createdDaysAgo: 5 },
  // Mellow Bites — Repeat
  { key: "M0", brand: "mellow", title: "ขนมคลีนรสใหม่", stage: "paid", deliverables: ["TT_VIDEO"], postedDaysAgo: 400 },
  { key: "M1", brand: "mellow", title: "กราโนล่าสงกรานต์", stage: "paid", deliverables: ["TT_VIDEO"], postedDaysAgo: 230 },
  { key: "M2", brand: "mellow", title: "Snack Box ออฟฟิศ", stage: "paid", deliverables: ["TT_VIDEO", "IG_STORY"], postedDaysAgo: 110 },
  { key: "M3", brand: "mellow", title: "ขนมคลีนปีใหม่", stage: "production", deliverables: ["TT_VIDEO", "IG_REEL"], createdDaysAgo: 14 },
  // One-time, gone silent > 120 days
  { key: "S0", brand: "sunday", title: "กาแฟดริปซอง", stage: "paid", deliverables: ["IG_REEL"], postedDaysAgo: 480 },
  { key: "S1", brand: "sunday", title: "Cold Brew ขวดใหม่", stage: "paid", deliverables: ["TT_VIDEO"], postedDaysAgo: 210 },
  { key: "L1", brand: "lumi", title: "เลนส์มือถือ Macro", stage: "paid", deliverables: ["YT_INTEGRATION"], postedDaysAgo: 175 },
  { key: "D1", brand: "daisy", title: "เสื้อลินินคอลเลกชันฤดูร้อน", stage: "paid", deliverables: ["IG_REEL", "IG_STORY"], postedDaysAgo: 155 },
  // One-time, recent
  { key: "K1", brand: "kumo", title: "หูฟัง TWS รุ่นเริ่มต้น", stage: "paid", deliverables: ["TT_VIDEO"], postedDaysAgo: 85 },
  { key: "K2", brand: "kumo", title: "รีวิวเต็มคลิปลำโพงพกพา", stage: "report_sent", deliverables: ["YT_DEDICATED"], postedDaysAgo: 19 },
  { key: "A1", brand: "aroma", title: "ก้านไม้หอมกลิ่นใหม่", stage: "paid", deliverables: ["IG_REEL"], postedDaysAgo: 68 },
  { key: "A2", brand: "aroma", title: "แพ็กเกจปลายปี", stage: "quotation", deliverables: ["BUNDLE_3P"], createdDaysAgo: 8 },
  { key: "F1", brand: "fresh", title: "ชาเขียวออร์แกนิก", stage: "paid", deliverables: ["TT_VIDEO"], postedDaysAgo: 95 },
  // Leads
  { key: "O1", brand: "orbit", title: "รองเท้าวิ่งรุ่นใหม่", stage: "lead", deliverables: ["TT_VIDEO"], createdDaysAgo: 20 },
  { key: "O2", brand: "orbit", title: "ชุดออกกำลังกาย", stage: "brief", deliverables: ["IG_REEL", "IG_STORY"], createdDaysAgo: 6 },
  { key: "C1", brand: "cloud", title: "หมอนยางพารา", stage: "brief", deliverables: ["IG_REEL"], createdDaysAgo: 9 },
  { key: "Z1", brand: "zesty", title: "ซอสพริกสูตรเผ็ด", stage: "brief", deliverables: ["TT_VIDEO"], createdDaysAgo: 25 },
  { key: "Z2", brand: "zesty", title: "เซ็ตครัวมือใหม่", stage: "quotation", deliverables: ["TT_VIDEO", "IG_REEL"], createdDaysAgo: 4 },
  { key: "B1", brand: "byte", title: "คีย์บอร์ดไร้สาย", stage: "lead", deliverables: ["YT_INTEGRATION"], createdDaysAgo: 2 },
  { key: "PP1", brand: "petal", title: "ไลน์คลีนซิ่งออร์แกนิก", stage: "quotation", deliverables: ["BUNDLE_3P"], createdDaysAgo: 11 },
];

export const AUTOMATION_RULES = [
  { id: "post_plus_7", name: "รายงานผล +7 วัน", trigger: "โพสต์สปอนเซอร์ครบ 7 วัน", channel: "email" as const },
  { id: "post_plus_30", name: "รายงานผล +30 วัน + เสนองานต่อ", trigger: "โพสต์สปอนเซอร์ครบ 30 วัน", channel: "email" as const },
  { id: "brand_silent_120", name: "ทักแบรนด์ที่เงียบไป", trigger: "แบรนด์ไม่มีการติดต่อ ≥ 120 วัน", channel: "line" as const },
  { id: "invoice_overdue_30", name: "เตือนบิลค้างชำระ", trigger: "ใบแจ้งหนี้เลยกำหนด ≥ 30 วัน", channel: "internal" as const },
  { id: "pq_spike", name: "คำถามสินค้าพุ่ง", trigger: "คอมเมนต์ถามสินค้าในหมวด 7 วันล่าสุด ≥ 3× ค่าเฉลี่ย 28 วันก่อนหน้า (และ ≥ 20)", channel: "internal" as const },
];

export interface MessageSpec {
  brand: string;
  daysAgo: number;
  time: string;
  direction: "in" | "out";
  body: string;
  /** Deal this conversation became (marks a detected brief as converted). */
  deal?: string;
  unread?: boolean;
}

/**
 * Brand inbox (mock LINE OA / IG DM / email). `{inv:KEY}` is replaced with that deal's invoice number.
 * Two new briefs are waiting: Kumo Audio and Fresh Leaf. Silent brands have no recent messages.
 */
export const MESSAGES: MessageSpec[] = [
  { brand: "glow", daysAgo: 13, time: "16:05:00", direction: "in", body: "ขอบคุณสำหรับรายงานผลมอยส์เจอไรเซอร์นะคะ ทีมชอบมากเลยค่ะ" },
  { brand: "glow", daysAgo: 12, time: "09:20:00", direction: "out", body: "ยินดีค่ะคุณแพรวา ไว้มีแคมเปญใหม่บอกได้เลยนะคะ 🙏" },
  { brand: "glow", daysAgo: 3, time: "09:30:00", direction: "in", deal: "G6", body: "สวัสดีค่ะ มีบรีฟแคมเปญ 12.12 มาฝากค่ะ อยากได้ TikTok 1 คลิป + IG Reel 1 ชิ้น โพสต์ก่อนวันที่ 10 ธ.ค. งบประมาณ 30,000 บาทค่ะ" },
  { brand: "glow", daysAgo: 3, time: "11:10:00", direction: "out", body: "รับบรีฟแล้วค่ะ ขอเวลาวางไอเดีย แล้วจะส่งใบเสนอราคาให้ภายในพรุ่งนี้นะคะ" },

  { brand: "kumo", daysAgo: 9, time: "14:30:00", direction: "in", body: "ขอบคุณสำหรับรายงานผลลำโพงนะครับ ผลดีกว่าที่คาดไว้เยอะเลย" },
  { brand: "kumo", daysAgo: 9, time: "15:02:00", direction: "out", body: "ขอบคุณมากค่ะคุณโอ๊ต ยินดีร่วมงานต่อเลยค่ะ" },
  { brand: "kumo", daysAgo: 1, time: "20:15:00", direction: "in", unread: true, body: "สวัสดีครับ ทาง Kumo มีหูฟังรุ่นใหม่ Kumo Air 2 เปิดตัวต้นเดือนธันวาคม อยากได้คลิป TikTok 1 คลิป และ YouTube รีวิวสั้น งบประมาณราว 40,000 บาทครับ สนใจร่วมงานไหมครับ" },

  { brand: "fresh", daysAgo: 1, time: "17:40:00", direction: "in", unread: true, body: "สวัสดีค่ะ Fresh Leaf มีชาเขียวรสใหม่ Matcha Yuzu อยากร่วมงานรอบใหม่ค่ะ ขอเป็น TikTok ช่วงกลางเดือนพฤศจิกายน งบประมาณ 2 หมื่นค่ะ" },

  { brand: "pixel", daysAgo: 20, time: "14:30:00", direction: "out", body: "เรียนคุณภูมิ ขออนุญาตติดตามใบแจ้งหนี้ {inv:P3} ซึ่งครบกำหนดแล้วค่ะ หากชำระแล้วรบกวนส่งหลักฐานการโอนให้ด้วยนะคะ ขอบคุณค่ะ" },
  { brand: "pixel", daysAgo: 5, time: "10:15:00", direction: "in", deal: "P4", body: "สวัสดีครับ ไตรมาส 1 ปีหน้าเราอยากเสนองานแพ็กเกจ 3 แพลตฟอร์มครับ เดี๋ยวขอส่งรายละเอียดตามมานะครับ" },
  { brand: "pixel", daysAgo: 1, time: "18:20:00", direction: "in", unread: true, body: "ขออภัยเรื่องบิลล่าช้าครับ ฝ่ายบัญชีแจ้งว่าจะโอนภายในสัปดาห์หน้าครับ" },

  { brand: "mellow", daysAgo: 30, time: "14:30:00", direction: "out", body: "ส่งไอเดียคอนเทนต์ปีใหม่ให้ดูนะคะ มี 3 แบบ แนบไฟล์ไว้ในอีเมลแล้วค่ะ" },
  { brand: "mellow", daysAgo: 14, time: "10:00:00", direction: "in", deal: "M3", body: "ชอบไอเดียที่ 2 ค่ะ ขอเป็น TikTok + IG Reel นะคะ ตามเรทเดิมได้เลยค่ะ" },
  { brand: "mellow", daysAgo: 2, time: "13:45:00", direction: "in", body: "ดราฟต์โอเคแล้วค่ะ โพสต์ได้ตามแผนเลยนะคะ" },

  { brand: "aroma", daysAgo: 8, time: "15:00:00", direction: "out", body: "ส่งใบเสนอราคาแพ็กเกจปลายปีให้แล้วนะคะ มีข้อสงสัยทักมาได้เลยค่ะ" },
  { brand: "aroma", daysAgo: 0, time: "08:40:00", direction: "in", unread: true, body: "ขอบคุณค่ะ ขอปรับลดเหลือ 40,000 ได้ไหมคะ ถ้าได้จะยืนยันภายในอาทิตย์นี้ค่ะ" },

  { brand: "cloud", daysAgo: 9, time: "11:30:00", direction: "in", deal: "C1", body: "สวัสดีค่ะ สนใจให้รีวิวหมอนยางพาราลง IG Reel ค่ะ อยากให้โพสต์ภายในเดือนหน้า" },
  { brand: "cloud", daysAgo: 1, time: "12:05:00", direction: "in", unread: true, body: "ส่งหมอนตัวอย่างไปให้แล้วนะคะ น่าจะถึงวันจันทร์ค่ะ" },

  { brand: "orbit", daysAgo: 20, time: "13:20:00", direction: "in", deal: "O1", body: "สอบถามเรทรีวิวรองเท้าวิ่งบน TikTok ค่ะ" },
  { brand: "orbit", daysAgo: 6, time: "09:30:00", direction: "in", deal: "O2", body: "มีบรีฟชุดออกกำลังกายมาเพิ่มค่ะ IG Reel + Story ปลายเดือนพฤศจิกายนค่ะ" },

  { brand: "byte", daysAgo: 2, time: "13:20:00", direction: "in", deal: "B1", body: "สวัสดีครับ สนใจให้รีวิวคีย์บอร์ดไร้สายบน YouTube ครับ งบ 2 หมื่นครับ" },

  { brand: "zesty", daysAgo: 4, time: "15:00:00", direction: "out", body: "ส่งใบเสนอราคาเซ็ตครัวมือใหม่ให้แล้วนะคะ" },
  { brand: "zesty", daysAgo: 0, time: "09:10:00", direction: "in", unread: true, body: "ได้รับแล้วค่ะ ขอเสนอหัวหน้าก่อนนะคะ" },

  { brand: "petal", daysAgo: 11, time: "09:30:00", direction: "in", deal: "PP1", body: "เรียนคุณครีเอเตอร์ ทางเราสนใจร่วมงานแคมเปญไลน์คลีนซิ่งออร์แกนิก ทั้ง TikTok, IG และ YouTube งบประมาณ 45,000 บาท" },
];
