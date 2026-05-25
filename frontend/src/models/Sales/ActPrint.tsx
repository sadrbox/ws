/**
 * Печатная форма «Акт выполненных работ (оказанных услуг)»
 *
 * Правовое основание:
 *   — ГК РК ст. 683 (договор возмездного оказания услуг);
 *   — ГК РК ст. 616 (сдача-приёмка результата работ);
 *   — НК РК ст. 412 — обязательные реквизиты первичного документа.
 *
 * Применяется исключительно для позиций типа «услуга / работа» (product.isService = true).
 * Для товарных позиций используется Накладная З-2 (SaleInvoicePrint).
 */
import type { CSSProperties, FC } from "react";
import { A4Page, A4DocTitle, A4Field, A4Row, A4Signature } from "src/components/PrintLayout/A4Page";
import { getFormatDateOnly } from "src/utils/main.module";
import type { SaleInvoicePrintData, SaleItemPrintRow } from "./SaleInvoicePrint";

const fmt = (v: number | undefined | null): string => {
  if (v === undefined || v === null || v === 0) return "—";
  return new Intl.NumberFormat("ru-KZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v));
};

const fmtQty = (v: number): string =>
  new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 4 }).format(v);

const fmtDate = (d?: string): string =>
  d ? (getFormatDateOnly(d) || d) : "";

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

const ActPrint: FC<{ data: SaleInvoicePrintData }> = ({ data }) => {
  const docNumber = data.documentId ?? "—";
  const docDate = fmtDate(data.documentDate);

  const items: SaleItemPrintRow[] = data.items;

  const cols = data.columns ?? {};
  const has = (getter: (r: SaleItemPrintRow) => number | undefined | null) =>
    items.some((r) => Number(getter(r) ?? 0) > 0);

  // ── Те же правила видимости, что в SaleInvoicePrint ──────────────────
  const hasVat =
    has((r) => r.vatRate) ||
    has((r) => r.vatAmount) ||
    Number(data.totalVatAmount ?? 0) > 0;

  const hasExcise =
    has((r) => r.exciseRate) ||
    has((r) => r.exciseAmount) ||
    Number(data.totalExciseAmount ?? 0) > 0;

  const hasIndirectTaxes = hasVat || hasExcise;

  // Скидка
  const showDiscPct =
    cols.discountPercent !== false &&
    (cols.discountPercent === true || has((r) => r.discountPercent) || has((r) => r.discountAmount));
  const showDiscAmt =
    cols.discountAmount !== false &&
    (cols.discountAmount === true || has((r) => r.discountAmount) || Number(data.totalDiscountAmount ?? 0) > 0);

  // Стоимость без косвенных налогов (гр. 13) — только при наличии акциза/НДС
  const showNetOfIndirectTaxes =
    hasIndirectTaxes && cols.amountNetOfIndirectTaxes !== false &&
    (cols.amountNetOfIndirectTaxes === true || has((r) => r.amountNetOfIndirectTaxes));

  // Облагаемый оборот (amountWithoutVat) — только при наличии НДС/акциза
  const showAmtNoVat = hasIndirectTaxes && cols.amountWithoutVat !== false;

  // Акциз
  const showExciseRate = hasExcise && cols.exciseRate !== false &&
    (cols.exciseRate === true || has((r) => r.exciseRate) || has((r) => r.exciseAmount));
  const showExciseAmt = hasExcise && cols.exciseAmount !== false &&
    (cols.exciseAmount === true || has((r) => r.exciseAmount) || Number(data.totalExciseAmount ?? 0) > 0);

  // НДС
  const showVatRate = hasVat && cols.vatRate !== false;
  const showVatAmt =
    hasVat && data.isVatPayer !== false &&
    cols.vatAmount !== false &&
    (cols.vatAmount === true || has((r) => r.vatAmount) || Number(data.totalVatAmount ?? 0) > 0);

  // Сводные итоги только по строкам акта
  const totalAmountWithoutVat = items.reduce((s, r) => s + Number(r.amountWithoutVat ?? 0), 0);
  const totalVatAmount = items.reduce((s, r) => s + Number(r.vatAmount ?? 0), 0);
  const totalExciseAmount = items.reduce((s, r) => s + Number(r.exciseAmount ?? 0), 0);
  const totalAmount = items.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const totalDiscountAmount = items.reduce((s, r) => s + Number(r.discountAmount ?? 0), 0);

  // Количество описательных колонок до первой суммовой: №, Наим., Ед.изм., Кол-во, Цена [, Скидка%]
  const itogoSpan = 5 + (showDiscPct ? 1 : 0);
  const totalCols = itogoSpan
    + (showDiscAmt ? 1 : 0)
    + (showNetOfIndirectTaxes ? 1 : 0)
    + (showAmtNoVat ? 1 : 0)
    + (showExciseRate ? 1 : 0)
    + (showExciseAmt ? 1 : 0)
    + (showVatRate ? 1 : 0)
    + (showVatAmt ? 1 : 0)
    + 1; // Сумма

  return (
    <A4Page>
      {/* Шапка — правовая ссылка */}
      <div style={{ display: "flex", justifyContent: "flex-end", fontSize: "8pt", marginBottom: "2mm" }}>
        <div style={{ border: "1px solid #000", padding: "1mm 2mm", textAlign: "center", maxWidth: "60mm" }}>
          Первичный документ<br />
          (НК РК ст. 412, ГК РК ст. 616, 683)
        </div>
      </div>

      <A4DocTitle subtitle={`№ ${docNumber} от ${docDate}`}>
        Акт выполненных работ (оказанных услуг)
      </A4DocTitle>

      {/* Реквизиты сторон */}
      <div style={{ display: "flex", flexDirection: "column", gap: "3mm", fontSize: "9pt" }}>
        <A4Row>
          <A4Field label="Исполнитель" width="50%">
            {data.organizationName ?? ""}
            {data.organizationBin ? `, БИН ${data.organizationBin}` : ""}
          </A4Field>
          <A4Field label="Адрес исполнителя" width="50%">{data.organizationAddress ?? ""}</A4Field>
        </A4Row>
        <A4Row>
          <A4Field label="Заказчик" width="50%">
            {data.counterpartyName ?? ""}
            {data.counterpartyBin ? `, БИН ${data.counterpartyBin}` : ""}
          </A4Field>
          <A4Field label="Адрес заказчика" width="50%">{data.counterpartyAddress ?? ""}</A4Field>
        </A4Row>
        <A4Row>
          <A4Field label="Договор / основание" width="100%">{data.contractName ?? ""}</A4Field>
        </A4Row>
      </div>

      {/* Таблица работ / услуг */}
      <table style={{ marginTop: "3mm", borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...headCellStyle, width: "8mm" }}>№</th>
            <th style={headCellStyle}>Наименование работ (услуг)</th>
            <th style={{ ...headCellStyle, width: "14mm" }}>Ед. изм.</th>
            <th style={{ ...headCellStyle, width: "16mm" }}>Кол-во</th>
            <th style={{ ...headCellStyle, width: "20mm" }}>
              {hasVat ? "Цена" : "Цена"}
            </th>
            {showDiscPct && (
              <th style={{ ...headCellStyle, width: "12mm" }}>Скидка, %</th>
            )}
            {showDiscAmt && (
              <th style={{ ...headCellStyle, width: "20mm" }}>Сумма скидки</th>
            )}
            {showNetOfIndirectTaxes && (
              <th style={{ ...headCellStyle, width: "22mm" }}>Стоимость</th>
            )}
            {showAmtNoVat && (
              <th style={{ ...headCellStyle, width: "22mm" }}>Облагаемый оборот</th>
            )}
            {showExciseRate && (
              <th style={{ ...headCellStyle, width: "14mm" }}>Ставка акциза</th>
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
            <th style={{ ...headCellStyle, width: "24mm" }}>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td
                style={{ ...cellStyle, textAlign: "center", color: "#888" }}
                colSpan={totalCols}
              >
                Нет позиций услуг/работ
              </td>
            </tr>
          )}
          {items.map((it) => (
            <tr key={it.number}>
              <td style={{ ...cellStyle, textAlign: "center" }}>{it.number}</td>
              <td style={cellStyle}>{it.name}</td>
              <td style={{ ...cellStyle, textAlign: "center" }}>{it.unit ?? ""}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{fmtQty(it.quantity)}</td>
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
                <td style={{ ...cellStyle, textAlign: "center" }}>
                  {it.exciseRate != null && it.exciseRate !== 0 ? `${it.exciseRate}%` : "—"}
                </td>
              )}
              {showExciseAmt && (
                <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.exciseAmount)}</td>
              )}
              {showVatRate && (
                <td style={{ ...cellStyle, textAlign: "center" }}>
                  {data.isVatPayer === false ? "Без НДС" : (it.vatRate != null ? `${it.vatRate}%` : "")}
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
            <td style={{ ...cellStyle, fontWeight: 700, textAlign: "right" }} colSpan={itogoSpan}>
              Итого:
            </td>
            {showDiscAmt && (
              <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(totalDiscountAmount)}</td>
            )}
            {showNetOfIndirectTaxes && <td style={cellStyle} />}
            {showAmtNoVat && (
              <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(totalAmountWithoutVat)}</td>
            )}
            {showExciseRate && <td style={cellStyle} />}
            {showExciseAmt && (
              <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(totalExciseAmount)}</td>
            )}
            {showVatRate && <td style={cellStyle} />}
            {showVatAmt && (
              <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(totalVatAmount)}</td>
            )}
            <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(totalAmount)}</td>
          </tr>
        </tbody>
      </table>

      {/* Сумма итогов */}
      <div style={{ marginTop: "4mm", fontSize: "9pt" }}>
        <div>
          Всего наименований: <b>{items.length}</b>, на сумму:&nbsp;
          <b>{fmt(totalAmount)} тенге</b>
          {showVatAmt && (
            <>, в т.ч. НДС: <b>{fmt(totalVatAmount)} тенге</b></>
          )}
        </div>
        {data.amountInWords && (
          <div style={{ marginTop: "2mm" }}>
            Сумма прописью:&nbsp;<i>{data.amountInWords}</i>
          </div>
        )}
      </div>

      {/* Заявление о приёмке */}
      <div style={{ marginTop: "5mm", fontSize: "9pt", lineHeight: 1.5 }}>
        Вышеперечисленные работы (услуги) выполнены в полном объёме, в установленные сроки
        и с надлежащим качеством. Стороны взаимных претензий не имеют.
      </div>

      {/* Подписи */}
      <div style={{ marginTop: "8mm", display: "flex", justifyContent: "space-between", gap: "12mm" }}>
        <A4Signature role="Исполнитель" name={data.managerName} />
        <A4Signature role="Заказчик" name={data.receiverName} />
      </div>

      <div style={{ marginTop: "6mm", fontSize: "8pt", color: "#555" }}>М.П.</div>
    </A4Page>
  );
};

export default ActPrint;
