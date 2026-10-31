import { DB_PATH } from "@/db/client";
import { seedDatabase } from "@/seed/seedDatabase";

const started = Date.now();
seedDatabase(DB_PATH)
  .then((r) => {
    console.log(`✓ Seeded ${r.file} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.table(r.counts);
    console.log(`Keyword classifier agreement with generator intent: ${(r.classifierAgreement * 100).toFixed(1)}%`);
    console.log("Next: npm run dev  (optional: npm run verify)");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
