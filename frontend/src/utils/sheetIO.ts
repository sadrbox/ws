// ─────────────────────────────────────────────────────────────────────────────
// Переиспользуемое ядро импорта/экспорта таблиц (T2.4). Раньше чтение xlsx, сборка
// книги и маппинг колонок жили внутри ProductImportExport; вынесены сюда, чтобы тот
// же механизм применять к контрагентам/остаткам/номенклатуре без копипасты.
//
// Чистые функции (mapRowsByHeader/recordsToAoa) тестируются headless; тонкие
// XLSX-обёртки (readWorkbookAoa/downloadAoa) — браузерный ввод/скачивание.
// ─────────────────────────────────────────────────────────────────────────────
import * as XLSX from "xlsx";
import { asText } from "src/utils/asText";

/** Массив-строк листа (header:1) в записи по СИНОНИМАМ заголовков.
 *  aliases: { поле: ["вариант1","вариант2",...] } (регистр/пробелы игнорируются). */
export function mapRowsByHeader(
  aoa: unknown[][],
  aliases: Record<string, string[]>,
): Record<string, string>[] {
  if (!aoa.length) return [];
  const norm = (s: unknown) => asText(s).trim().toLowerCase().replace(/[\s_]+/g, "");
  const header = (aoa[0] ?? []).map(norm);
  // индекс колонки для каждого канонического поля
  const colOf: Record<string, number> = {};
  for (const [field, alist] of Object.entries(aliases)) {
    const want = alist.map((a) => a.toLowerCase().replace(/[\s_]+/g, ""));
    const idx = header.findIndex((h) => want.includes(h));
    if (idx >= 0) colOf[field] = idx;
  }
  const out: Record<string, string>[] = [];
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    if (!row.some((c) => asText(c).trim())) continue; // пустая строка
    const rec: Record<string, string> = {};
    for (const field of Object.keys(colOf)) rec[field] = asText(row[colOf[field]]).trim();
    out.push(rec);
  }
  return out;
}

/** Записи → массив-строк (header + данные) по порядку колонок. */
export function recordsToAoa(
  records: Record<string, unknown>[],
  columns: { key: string; label: string }[],
): unknown[][] {
  const header = columns.map((c) => c.label);
  const rows = records.map((rec) => columns.map((c) => rec[c.key] ?? ""));
  return [header, ...rows];
}

/** Прочитать книгу (xlsx/xls/csv) в массив-строк первого листа (header:1). */
export function readWorkbookAoa(data: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
}

/** Скачать массив-строк как xlsx-файл (браузер). */
export function downloadAoa(aoa: unknown[][], opts: { sheetName?: string; fileName: string }): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), opts.sheetName || "sheet");
  XLSX.writeFile(wb, opts.fileName);
}

export default { mapRowsByHeader, recordsToAoa, readWorkbookAoa, downloadAoa };
