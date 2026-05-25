/**
 * Печатная форма «Накладная на отпуск запасов на сторону» (типовая форма З-2),
 * утв. приказом Министра финансов РК № 562 от 20.12.2012.
 *
 * Названия колонок и их порядок соответствуют ЭСФ РК (НК РК ст. 412):
 *   гр. 4 — Наименование товаров (работ, услуг)
 *   гр. 6 — Единица измерения
 *   гр. 7 — Количество (объём)
 *   гр. 8 — Цена за единицу без НДС (без налогов, если есть акциз)
 *   гр. 11 — Размер скидки от цены, %
 *   гр. 12 — Сумма скидки
 *   гр. 13 — Стоимость (показывается только при наличии акциза)
 *   гр. 14 — Сумма акциза (НК РК ст. 463)
 *   гр. 15 — Ставка НДС, %
 *   гр. 16 — Сумма НДС
 *   гр. 17 — Сумма
 *
 * Видимость опциональных колонок (Сумма скидки, акциз, НДС) задаётся пользователем
 * в модалке «Колонки таблицы» через чекбокс «В печать» (см. SaleItemsTable).
 */
import type { CSSProperties, FC } from "react";
import { A4Page, A4DocTitle, A4Field, A4Row, A4Signature } from "src/components/PrintLayout/A4Page";
import { getFormatDateOnly } from "src/utils/main.module";

export interface SaleItemPrintRow {
  number: number;
  name: string;
  unit?: string;
  quantity: number;
  price: number;
  /** true — услуга/работа; false/undefined — товар (запас). */
  isService?: boolean;
  /** Сумма скидки по строке. */
  discountPercent?: number;
  discountAmount?: number;
  /** Акциз (НК РК ст. 463). */
  exciseRate?: number;
  exciseAmount?: number;
  amountWithoutVat?: number;
  amountNetOfIndirectTaxes?: number;
  vatRate?: number;
  vatAmount?: number;
  amount: number;
}

/**
 * Карта видимости опциональных колонок печатной формы.
 * Ключи соответствуют идентификаторам колонок в saleItemsColumns.json.
 * Если ключ отсутствует — колонка считается видимой (по умолчанию true).
 */
export interface SaleInvoicePrintColumns {
  discountPercent?: boolean;
  discountAmount?: boolean;
  amountNetOfIndirectTaxes?: boolean;
  amountWithoutVat?: boolean;
  exciseRate?: boolean;
  exciseAmount?: boolean;
  vatRate?: boolean;
  vatAmount?: boolean;
}

export interface SaleInvoicePrintData {
  /** Идентификатор документа (используется поле id из БД). */
  documentId?: string | number;
  documentDate?: string;
  organizationName?: string;
  organizationBin?: string;
  organizationAddress?: string;
  counterpartyName?: string;
  counterpartyBin?: string;
  counterpartyAddress?: string;
  contractName?: string;
  warehouseName?: string;
  items: SaleItemPrintRow[];
  totalAmount: number;
  totalAmountWithoutVat?: number;
  totalVatAmount?: number;
  totalDiscountAmount?: number;
  totalExciseAmount?: number;
  amountInWords?: string;
  managerName?: string;
  accountantName?: string;
  receiverName?: string;
  /**
   * Является ли организация плательщиком НДС.
   * По НК РК ст. 412 колонка «Ставка НДС, %» обязательна в накладной:
   *   true  → печатается числовая ставка (12 %, 0 % и т.д.)
   *   false → печатается «Без НДС»; колонка суммы НДС скрывается.
   */
  isVatPayer?: boolean;
  /** Видимость опциональных колонок (управляется чекбоксами «В печать»). */
  columns?: SaleInvoicePrintColumns;
}

const fmt = (v: number | undefined | null): string => {
  if (v === undefined || v === null || v === 0) return "—";
  return new Intl.NumberFormat("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
};

const fmtDate = (d?: string): string => {
  if (!d) return "";
  return getFormatDateOnly(d) || d;
};

const cellStyle: CSSProperties = {
  border: "1px solid #000",
  padding: "2px 4px",
  fontSize: "9pt",
  verticalAlign: "top",
};

const headCellStyle: CSSProperties = {
  ...cellStyle,
  background: "#f3f3f3",
  fontWeight: 600,
  textAlign: "center",
  fontSize: "8pt",
};

const SaleInvoicePrint: FC<{ data: SaleInvoicePrintData }> = ({ data }) => {
  const docNumber = data.documentId ?? "—";
  const docDate = fmtDate(data.documentDate);

  // Видимость колонок: явный пользовательский выбор (через «В печать») имеет
  // приоритет; если значение не задано — колонка показывается по факту наличия
  // ненулевых значений в документе (поведение по умолчанию).
  const cols = data.columns ?? {};
  const has = (rowGetter: (r: SaleItemPrintRow) => number | undefined | null): boolean =>
    data.items.some((r) => Number(rowGetter(r) ?? 0) > 0);

  // ── Режим: есть ли в документе НДС / акциз ──────────────────────────
  // Если в документе ни одной позиции нет НДС/акциза (неплательщик НДС,
  // освобождённая операция, упрощёнка), терминология «без НДС / с НДС»
  // не имеет смысла — заголовки и колонки приводятся к простой форме
  // накладной З-2: «Цена», «Сумма».
  const hasVat =
    has((r) => r.vatRate) ||
    has((r) => r.vatAmount) ||
    Number(data.totalVatAmount ?? 0) > 0;
  const hasExcise =
    has((r) => r.exciseRate) ||
    has((r) => r.exciseAmount) ||
    Number(data.totalExciseAmount ?? 0) > 0;
  const hasIndirectTaxes = hasVat || hasExcise;

  // Заголовки колонок «цена» и «итог» зависят от состава налогов:
  //  • есть только НДС            → «Цена без НДС» / «Сумма»
  //  • есть акциз (с НДС или без) → «Цена» / «Сумма»
  //  • нет ни НДС, ни акциза      → «Цена» / «Сумма»
  const priceHeader = hasExcise
    ? "Цена"
    : hasVat
      ? "Цена"
      : "Цена";
  const totalHeader = hasIndirectTaxes ? "Сумма" : "Сумма";
  // «Облагаемый оборот по НДС» — база для НДС (включает акциз, если он есть).
  // Имеет смысл при любом наличии НДС или акциза — без них дублирует итог.
  const amountWithoutTaxesHeader = "Облагаемый оборот по НДС";

  const showDiscPct = cols.discountPercent !== false && (cols.discountPercent === true || has((r) => r.discountPercent) || has((r) => r.discountAmount));
  const showDiscAmt = cols.discountAmount !== false && (cols.discountAmount === true || has((r) => r.discountAmount) || Number(data.totalDiscountAmount ?? 0) > 0);
  const showNetOfIndirectTaxes = hasIndirectTaxes && cols.amountNetOfIndirectTaxes !== false && (cols.amountNetOfIndirectTaxes === true || has((r) => r.amountNetOfIndirectTaxes));
  // Колонка «Стоимость» имеет смысл только когда есть
  // косвенные налоги — иначе она совпадает с итоговой суммой и дублирует её.
  const showAmtNoVat = hasIndirectTaxes && cols.amountWithoutVat !== false;
  // Колонки акциза — только если в документе есть акциз.
  const showExciseRate = hasExcise && cols.exciseRate !== false && (cols.exciseRate === true || has((r) => r.exciseRate) || has((r) => r.exciseAmount));
  const showExciseAmt = hasExcise && cols.exciseAmount !== false && (cols.exciseAmount === true || has((r) => r.exciseAmount) || Number(data.totalExciseAmount ?? 0) > 0);

  // По НК РК ст. 412 колонка «Ставка НДС, %» обязательна в накладной:
  //   • плательщик НДС    → показываем числовую ставку (12 %, 0 % …)
  //   • неплательщик НДС  → показываем «Без НДС» (isVatPayer=false)
  // Колонка суммы НДС отображается только у плательщиков НДС с реальным налогом.
  const showVatRate = cols.vatRate !== false;
  const showVatAmt = data.isVatPayer !== false && hasVat && cols.vatAmount !== false && (cols.vatAmount === true || has((r) => r.vatAmount) || Number(data.totalVatAmount ?? 0) > 0);

  // «Итого:» занимает все нечисловые левые колонки до первой суммовой.
  // Порядок колонок: №, Наим., Ед.изм., Кол-во, Цена [, Процент скидки, %] [, Сумма скидки] [, Стоимость] …
  // itogoColSpan охватывает только: №, Наим., Ед.изм., Кол-во, Цена, Процент скидки, % (не суммовые).
  const itogoColSpan = 5 + (showDiscPct ? 1 : 0);
  const totalCols = itogoColSpan
    + (showDiscAmt ? 1 : 0)
    + (showNetOfIndirectTaxes ? 1 : 0)
    + (showAmtNoVat ? 1 : 0)
    + (showExciseRate ? 1 : 0)
    + (showExciseAmt ? 1 : 0)
    + (showVatRate ? 1 : 0)
    + (showVatAmt ? 1 : 0)
    + 1; /* Сумма */

  return (
    <A4Page>
      {/* Шапка с типовой формой */}
      <div style={{ display: "flex", justifyContent: "flex-end", fontSize: "8pt", marginBottom: "2mm" }}>
        <div style={{ border: "1px solid #000", padding: "1mm 2mm", textAlign: "center" }}>
          Типовая форма З-2
        </div>
      </div>

      <A4DocTitle subtitle={`№ ${docNumber} от ${docDate}`}>
        Накладная на отпуск запасов на сторону
      </A4DocTitle>

      {/* Реквизиты сторон */}
      <div style={{ display: "flex", flexDirection: "column", gap: "3mm", fontSize: "9pt" }}>
        <A4Row>
          <A4Field label="Организация (отправитель)" width="50%">
            {data.organizationName ?? ""}
            {data.organizationBin ? `, БИН ${data.organizationBin}` : ""}
          </A4Field>
          <A4Field label="Адрес" width="50%">{data.organizationAddress ?? ""}</A4Field>
        </A4Row>
        <A4Row>
          <A4Field label="Получатель (контрагент)" width="50%">
            {data.counterpartyName ?? ""}
            {data.counterpartyBin ? `, БИН ${data.counterpartyBin}` : ""}
          </A4Field>
          <A4Field label="Адрес" width="50%">{data.counterpartyAddress ?? ""}</A4Field>
        </A4Row>
        <A4Row>
          <A4Field label="Договор / основание" width="60%">{data.contractName ?? ""}</A4Field>
          <A4Field label="Склад отгрузки" width="40%">{data.warehouseName ?? ""}</A4Field>
        </A4Row>
      </div>

      {/* Таблица товаров */}
      <table style={{ marginTop: "3mm", borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...headCellStyle, width: "8mm" }}>№</th>
            <th style={headCellStyle}>Наименование товаров (работ, услуг)</th>
            <th style={{ ...headCellStyle, width: "14mm" }}>Ед. изм.</th>
            <th style={{ ...headCellStyle, width: "16mm" }}>Кол-во</th>
            <th style={{ ...headCellStyle, width: "20mm" }}>{priceHeader}</th>
            {showDiscPct && (
              <th style={{ ...headCellStyle, width: "12mm" }}>Процент скидки, %</th>
            )}
            {showDiscAmt && (
              <th style={{ ...headCellStyle, width: "20mm" }}>Сумма скидки</th>
            )}
            {showNetOfIndirectTaxes && (
              <th style={{ ...headCellStyle, width: "22mm" }}>Стоимость</th>
            )}
            {showAmtNoVat && (
              <th style={{ ...headCellStyle, width: "22mm" }}>{amountWithoutTaxesHeader}</th>
            )}
            {showExciseRate && (
              <th style={{ ...headCellStyle, width: "14mm" }}>Ставка акциза, %</th>
            )}
            {showExciseAmt && (
              <th style={{ ...headCellStyle, width: "20mm" }}>Сумма акциза</th>
            )}
            {showVatRate && (
              <th style={{ ...headCellStyle, width: "12mm" }}>Ставка НДС, %</th>
            )}
            {showVatAmt && (
              <th style={{ ...headCellStyle, width: "20mm" }}>Сумма НДС</th>
            )}
            <th style={{ ...headCellStyle, width: "24mm" }}>{totalHeader}</th>
          </tr>
        </thead>
        <tbody>
          {data.items.length === 0 && (
            <tr>
              <td style={{ ...cellStyle, textAlign: "center", color: "#888" }} colSpan={totalCols}>
                Нет товарных позиций
              </td>
            </tr>
          )}
          {data.items.map((it) => (
            <tr key={it.number}>
              <td style={{ ...cellStyle, textAlign: "center" }}>{it.number}</td>
              <td style={cellStyle}>{it.name}</td>
              <td style={{ ...cellStyle, textAlign: "center" }}>{it.unit ?? ""}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.quantity)}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.price)}</td>
              {showDiscPct && (
                <td style={{ ...cellStyle, textAlign: "right" }}>
                  {it.discountPercent != null && it.discountPercent !== 0 ? it.discountPercent : "—"}
                </td>
              )}
              {showDiscAmt && (
                <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.discountAmount)}</td>
              )}
              {showNetOfIndirectTaxes && (
                <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.amountNetOfIndirectTaxes)}</td>
              )}
              {showAmtNoVat && (
                <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.amountWithoutVat)}</td>
              )}
              {showExciseRate && (
                <td style={{ ...cellStyle, textAlign: "right" }}>
                  {it.exciseRate != null && it.exciseRate !== 0 ? it.exciseRate : "—"}
                </td>
              )}
              {showExciseAmt && (
                <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.exciseAmount)}</td>
              )}
              {showVatRate && (
                <td style={{ ...cellStyle, textAlign: "center" }}>
                  {data.isVatPayer === false ? "Без НДС" : (it.vatRate != null ? it.vatRate : "")}
                </td>
              )}
              {showVatAmt && (
                <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.vatAmount)}</td>
              )}
              <td style={{ ...cellStyle, textAlign: "right", fontWeight: 500 }}>{fmt(it.amount)}</td>
            </tr>
          ))}
          {/* Итоги */}
          <tr>
            <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }} colSpan={itogoColSpan}>Итого:</td>
            {showDiscAmt && (
              <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(data.totalDiscountAmount)}</td>
            )}
            {showNetOfIndirectTaxes && (
              <td style={cellStyle} />
            )}
            {showAmtNoVat && (
              <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(data.totalAmountWithoutVat)}</td>
            )}
            {showExciseRate && <td style={cellStyle} />}
            {showExciseAmt && (
              <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(data.totalExciseAmount)}</td>
            )}
            {showVatRate && <td style={cellStyle} />}
            {showVatAmt && (
              <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(data.totalVatAmount)}</td>
            )}
            <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(data.totalAmount)}</td>
          </tr>
        </tbody>
      </table>

      {/* Сумма прописью */}
      <div style={{ marginTop: "4mm", fontSize: "9pt" }}>
        <div>
          Всего отпущено наименований <b>{data.items.length}</b>, на сумму:&nbsp;
          <b>{fmt(data.totalAmount)} тенге</b>
        </div>
        {data.amountInWords && (
          <div style={{ marginTop: "2mm" }}>
            Сумма прописью:&nbsp;<i>{data.amountInWords}</i>
          </div>
        )}
      </div>

      {/* Подписи */}
      <div style={{ marginTop: "8mm", display: "flex", justifyContent: "space-between", gap: "8mm" }}>
        <A4Signature role="Руководитель" name={data.managerName} />
        <A4Signature role="Главный бухгалтер" name={data.accountantName} />
        <A4Signature role="Отпустил" />
        <A4Signature role="Получил" name={data.receiverName} />
      </div>

      <div style={{ marginTop: "6mm", fontSize: "8pt", color: "#555" }}>
        М.П.
      </div>
    </A4Page>
  );
};

export default SaleInvoicePrint;
