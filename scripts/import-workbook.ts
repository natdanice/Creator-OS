/** npm run import:workbook -- file1.xlsx file2.xlsx …   (reads the files; never modifies them) */
import fs from "node:fs";
import { getDb } from "@/db/client";
import { importWorkbook } from "@/cdp/adapters/workbook/importWorkbook";
import { bangkokNow } from "@/lib/clock";

(async () => {
  const db = getDb();
  for (const file of process.argv.slice(2)) {
    const buf = fs.readFileSync(file);
    const r = await importWorkbook(db, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, bangkokNow());
    console.log(`✓ ${file.split("/").pop()}`, JSON.stringify(r));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
