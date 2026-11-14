/**
 * Reads any uploaded file into tables: one per CSV/TSV, one per Excel sheet.
 * Handles UTF-8 and UTF-16 text (Excel's "Unicode text"), comma / tab / semicolon separators,
 * and exports that put a title or note above the real header row.
 */
import readXlsxFile, { readSheetNames } from "read-excel-file/node";
import { parseCsvRows } from "@/cdp/adapters/csv/parseCsv";
import type { Cell, Table } from "./types";

const SPREADSHEET = /\.(xlsx|xlsm)$/i;
const TEXT = /\.(csv|tsv|txt)$/i;

export const isSupported = (name: string) => SPREADSHEET.test(name) || TEXT.test(name);

function decode(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  return buf.toString("utf8");
}

function delimiterOf(text: string): string {
  const first = text.split(/\r?\n/, 5).join("\n");
  const count = (c: string) => first.split(c).length - 1;
  return [",", "\t", ";"].sort((a, b) => count(b) - count(a))[0];
}

const filled = (r: Cell[]) => r.filter((c) => c !== null && c !== undefined && String(c).trim() !== "").length;

/** Header = the first row (of the first 10) that is nearly as wide as the widest row. */
function toTable(matrix: Cell[][], base: Omit<Table, "headers" | "rows">): Table | null {
  const rows = matrix.filter((r) => filled(r) > 0);
  if (rows.length < 2) return null;
  const width = Math.max(...rows.slice(0, 50).map(filled));
  const h = rows.slice(0, 10).findIndex((r) => filled(r) >= Math.max(2, Math.ceil(width * 0.6)));
  if (h < 0) return null;
  // Name every column; give blanks and repeats a unique name so no data is dropped.
  const seen = new Map<string, number>();
  const headers = rows[h].map((c, i) => {
    const base = String(c ?? "").trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const body = rows
    .slice(h + 1)
    .map((r) => Object.fromEntries(headers.map((k, i) => [k, r[i] === undefined || r[i] === "" ? null : r[i]])) as Record<string, Cell>)
    .filter((r) => Object.values(r).some((v) => v !== null));
  return body.length ? { ...base, headers, rows: body } : null;
}

export async function readTables(file: string, fileIndex: number, buf: Buffer): Promise<Table[]> {
  if (SPREADSHEET.test(file)) {
    const out: Table[] = [];
    for (const sheet of await readSheetNames(buf)) {
      const matrix = (await readXlsxFile(buf, { sheet })) as Cell[][];
      const t = toTable(matrix, { id: `${fileIndex}:${sheet}`, file, fileIndex, sheet });
      if (t) out.push(t);
    }
    return out;
  }
  if (TEXT.test(file)) {
    const text = decode(buf);
    const matrix = parseCsvRows(text, delimiterOf(text)).map((r) => r.map((c) => c.trim()));
    const t = toTable(matrix, { id: `${fileIndex}:`, file, fileIndex, sheet: null });
    return t ? [t] : [];
  }
  return [];
}

/** Sheet names of an Excel file (for recognising the creator's own workbook). */
export async function sheetNamesOf(file: string, buf: Buffer): Promise<string[]> {
  return SPREADSHEET.test(file) ? readSheetNames(buf) : [];
}
