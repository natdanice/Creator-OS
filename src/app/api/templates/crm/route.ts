import { crmTemplate } from "@/crm/importCrm";

/** Spreadsheet template for importing brands and deals (open in Excel / Google Sheets, save as CSV). */
export function GET() {
  return new Response(crmTemplate(), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="creator-os-brands-deals-template.csv"' } });
}
