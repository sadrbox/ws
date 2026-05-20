/**
 * XLSX template engine — fills a SheetJS WorkBook with data.
 *
 * Scalar placeholders:  {{key}}          — replaced with data[key] value
 * Section markers:      {{#sectionName}} — start of repeating row block
 *                       {{/sectionName}} — end of repeating row block
 *   Each row between markers is cloned for every item in data[sectionName][].
 *   Within a section row, {{field}} refers to the item object fields.
 *
 * Merge cells inside sections are cloned per item; merges outside sections
 * are offset to match the new row numbering after expansion.
 */
import * as XLSX from "xlsx";
import type { WorkBook, WorkSheet, CellObject, Range } from "xlsx";

// ── Public types ─────────────────────────────────────────────────────────────

export type TTemplateScalar = string | number | boolean | null | undefined;
export type TTemplateItem   = Record<string, TTemplateScalar>;
export type TTemplateData   = Record<string, TTemplateScalar | TTemplateItem[]>;

// ── Internal helpers ─────────────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{([^{}]+)\}\}/g;

function replacePlaceholders(text: string, ctx: Record<string, TTemplateScalar>): string {
  return text.replace(PLACEHOLDER_RE, (_, key) => {
    const v = ctx[key.trim()];
    return v == null ? "" : String(v);
  });
}

/** Return the placeholder key if the cell contains only {{key}}, else null. */
function singlePlaceholder(raw: string): string | null {
  const m = raw.match(/^\s*\{\{([^{}]+)\}\}\s*$/);
  return m ? m[1].trim() : null;
}

/** Apply scalar data to a cell in-place. Preserves numeric type when possible. */
function applyScalar(cell: CellObject, ctx: Record<string, TTemplateScalar>): CellObject {
  const v = cell.v;
  if (typeof v !== "string") return cell;

  const single = singlePlaceholder(v);
  if (single != null) {
    const val = ctx[single];
    if (typeof val === "number") return { ...cell, t: "n", v: val, w: String(val) };
    if (typeof val === "boolean") return { ...cell, t: "b", v: val };
    const s = val == null ? "" : String(val);
    return { ...cell, t: "s", v: s, w: s };
  }

  const replaced = replacePlaceholders(v, ctx);
  return { ...cell, t: "s", v: replaced, w: replaced };
}

// ── Row-level types for section parsing ──────────────────────────────────────

interface TemplateRow {
  rowIdx: number;      // 0-based row index in source sheet
  cells: (CellObject | null)[];  // indexed by column (0-based)
  sectionStart?: string;   // name of section that starts here (marker row)
  sectionEnd?:   string;   // name of section that ends here (marker row)
}

interface SectionDef {
  name: string;
  templateRows: TemplateRow[];  // rows between markers (exclusive)
  startRowIdx: number;          // 0-based idx of {{#name}} marker row
  endRowIdx:   number;          // 0-based idx of {{/name}} marker row
}

// ── Sheet decoding ────────────────────────────────────────────────────────────

function decodeSheet(ws: WorkSheet): { rows: TemplateRow[]; numCols: number } {
  const ref = ws["!ref"];
  if (!ref) return { rows: [], numCols: 0 };
  const range = XLSX.utils.decode_range(ref);
  const numCols = range.e.c - range.s.c + 1;
  const numRows = range.e.r - range.s.r + 1;
  const rows: TemplateRow[] = [];

  for (let r = 0; r < numRows; r++) {
    const absRow = range.s.r + r;
    const cells: (CellObject | null)[] = [];
    let sectionStart: string | undefined;
    let sectionEnd:   string | undefined;

    for (let c = 0; c < numCols; c++) {
      const absCol = range.s.c + c;
      const addr = XLSX.utils.encode_cell({ r: absRow, c: absCol });
      const cell: CellObject | undefined = ws[addr];
      cells.push(cell ?? null);
      if (cell && typeof cell.v === "string") {
        const m = cell.v.trim().match(/^\{\{(#|\/)([^{}]+)\}\}$/);
        if (m) {
          if (m[1] === "#") sectionStart = m[2].trim();
          else               sectionEnd   = m[2].trim();
        }
      }
    }
    rows.push({ rowIdx: absRow, cells, sectionStart, sectionEnd });
  }

  return { rows, numCols };
}

// ── Section expansion ─────────────────────────────────────────────────────────

function parseSections(rows: TemplateRow[]): SectionDef[] {
  const sections: SectionDef[] = [];
  const stack: { name: string; startIdx: number }[] = [];

  rows.forEach((row, i) => {
    if (row.sectionStart) stack.push({ name: row.sectionStart, startIdx: i });
    if (row.sectionEnd && stack.length) {
      const top = stack.pop()!;
      sections.push({
        name: top.name,
        templateRows: rows.slice(top.startIdx + 1, i),
        startRowIdx: rows[top.startIdx].rowIdx,
        endRowIdx:   row.rowIdx,
      });
    }
  });

  return sections;
}

interface OutputRow {
  cells: (CellObject | null)[];
  srcRowIdx: number;  // original row index this output row came from
}

function expandRows(
  rows: TemplateRow[],
  data: TTemplateData,
  sections: SectionDef[],
): OutputRow[] {
  const sectionByStart = new Map(sections.map(s => [s.startRowIdx, s]));
  const sectionByEnd   = new Set(sections.map(s => s.endRowIdx));
  const sectionRows    = new Set(sections.flatMap(s => s.templateRows.map(r => r.rowIdx)));

  const output: OutputRow[] = [];

  for (const row of rows) {
    const sec = sectionByStart.get(row.rowIdx);
    if (sec) continue;                          // skip {{#name}} marker
    if (sectionByEnd.has(row.rowIdx)) continue; // skip {{/name}} marker
    if (sectionRows.has(row.rowIdx)) {
      // This template row belongs to a section — will be output by section expansion
      continue;
    }
    output.push({ cells: row.cells, srcRowIdx: row.rowIdx });
  }

  // Now insert section expansions at correct positions
  // Build a plan: for each section, replace its marker position with expanded rows
  // Re-process in source order
  const orderedRows = [...rows].sort((a, b) => a.rowIdx - b.rowIdx);
  const finalOutput: OutputRow[] = [];
  const addedScalarRows = new Set<number>();

  for (const row of orderedRows) {
    const sec = sectionByStart.get(row.rowIdx);
    if (sec) {
      const items = data[sec.name];
      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          for (const tRow of sec.templateRows) {
            const filledCells = tRow.cells.map(cell => {
              if (!cell) return null;
              if (typeof cell.v === "string" && PLACEHOLDER_RE.test(cell.v)) {
                PLACEHOLDER_RE.lastIndex = 0;
                return applyScalar(cell, item as Record<string, TTemplateScalar>);
              }
              return cell;
            });
            finalOutput.push({ cells: filledCells, srcRowIdx: tRow.rowIdx });
          }
        }
      }
      continue;
    }
    if (sectionByEnd.has(row.rowIdx)) continue;
    if (sectionRows.has(row.rowIdx))  continue;
    if (!addedScalarRows.has(row.rowIdx)) {
      addedScalarRows.add(row.rowIdx);
      finalOutput.push({ cells: row.cells, srcRowIdx: row.rowIdx });
    }
  }

  return finalOutput;
}

// ── Merge remapping ───────────────────────────────────────────────────────────

function remapMerges(
  ws: WorkSheet,
  outputRows: OutputRow[],
  sections: SectionDef[],
  data: TTemplateData,
  colOffset: number,
): Range[] {
  const merges: Range[] = ws["!merges"] ?? [];
  const result: Range[] = [];

  // Build srcRow → [outRow indices] map (a source row can appear multiple times in sections)
  const srcToOut = new Map<number, number[]>();
  outputRows.forEach((r, outIdx) => {
    const arr = srcToOut.get(r.srcRowIdx) ?? [];
    arr.push(outIdx);
    srcToOut.set(r.srcRowIdx, arr);
  });

  for (const m of merges) {
    // Merges that span a single source row
    if (m.s.r === m.e.r) {
      const outs = srcToOut.get(m.s.r - colOffset);
      if (!outs) continue;
      for (const outIdx of outs) {
        result.push({
          s: { r: outIdx, c: m.s.c },
          e: { r: outIdx, c: m.e.c },
        });
      }
    } else {
      // Multi-row merge: only include if all rows map uniquely (not in a section)
      const sRows: number[] = [];
      for (let r = m.s.r; r <= m.e.r; r++) {
        const outs = srcToOut.get(r - colOffset);
        if (!outs || outs.length !== 1) { sRows.length = 0; break; }
        sRows.push(outs[0]);
      }
      if (sRows.length === m.e.r - m.s.r + 1) {
        result.push({
          s: { r: sRows[0], c: m.s.c },
          e: { r: sRows[sRows.length - 1], c: m.e.c },
        });
      }
    }
  }

  return result;
}

// ── Worksheet fill ────────────────────────────────────────────────────────────

function fillWorksheet(ws: WorkSheet, data: TTemplateData): WorkSheet {
  const ref = ws["!ref"];
  if (!ref) return ws;
  const range = XLSX.utils.decode_range(ref);
  const colOffset = range.s.r;

  const { rows, numCols } = decodeSheet(ws);
  const sections = parseSections(rows);
  const outputRows = expandRows(rows, data, sections);

  // Build scalar context (non-array values)
  const scalarCtx: Record<string, TTemplateScalar> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!Array.isArray(v)) scalarCtx[k] = v;
  }

  // Apply scalar replacements to non-section rows
  const finalRows = outputRows.map(r => ({
    ...r,
    cells: r.cells.map(cell => {
      if (!cell || typeof cell.v !== "string") return cell;
      if (!PLACEHOLDER_RE.test(cell.v)) return cell;
      PLACEHOLDER_RE.lastIndex = 0;
      return applyScalar(cell, scalarCtx);
    }),
  }));

  // Assemble new worksheet
  const newWs: WorkSheet = {};
  const colStart = range.s.c;

  finalRows.forEach((row, outIdx) => {
    row.cells.forEach((cell, colLocal) => {
      if (!cell) return;
      const addr = XLSX.utils.encode_cell({ r: outIdx, c: colStart + colLocal });
      newWs[addr] = cell;
    });
  });

  const newRef = XLSX.utils.encode_range({
    s: { r: 0, c: colStart },
    e: { r: Math.max(0, finalRows.length - 1), c: colStart + numCols - 1 },
  });
  newWs["!ref"] = newRef;

  // Carry over column widths
  if (ws["!cols"]) newWs["!cols"] = ws["!cols"];

  // Remap merges
  const newMerges = remapMerges(ws, outputRows, sections, data, colOffset);
  if (newMerges.length) newWs["!merges"] = newMerges;

  return newWs;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fill all sheets in a WorkBook with template data.
 * Returns a new WorkBook (original is not mutated).
 */
export function fillXlsxTemplate(wb: WorkBook, data: TTemplateData): WorkBook {
  const newWb = XLSX.utils.book_new();
  for (const sheetName of wb.SheetNames) {
    const filled = fillWorksheet(wb.Sheets[sheetName], data);
    XLSX.utils.book_append_sheet(newWb, filled, sheetName);
  }
  return newWb;
}
