/**
 * Построитель рабочей книги Excel (.xlsx) для печатной формы
 * «Накладная на отпуск запасов на сторону» (типовая форма З-2,
 * утв. приказом Министра финансов РК № 562 от 20.12.2012).
 *
 * Структура соответствует SaleInvoicePrint.tsx — те же колонки/итоги/подписи.
 * Используется при нажатии «Печать» в SalesForm: книга рендерится в
 * GeneratedXlsxPreview, откуда её можно сохранить как .xlsx или .pdf.
 */
import * as XLSX from "xlsx";
import type {
	SaleInvoicePrintData,
	SaleItemPrintRow,
} from "./SaleInvoicePrint";
import { getFormatDateOnly } from "src/utils/datetime";

const fmtNum = (v: number | null | undefined): number | string => {
	if (v == null || v === 0) return "";
	return Number(v);
};

const fmtDate = (d?: string): string => {
	if (!d) return "";
	return getFormatDateOnly(d) || d;
};

export function buildSaleInvoiceWorkbook(
	data: SaleInvoicePrintData,
): XLSX.WorkBook {
	const cols = data.columns ?? {};
	const has = (g: (r: SaleItemPrintRow) => number | undefined | null) =>
		data.items.some((r) => Number(g(r) ?? 0) > 0);

	// ── Режим: есть ли НДС/акциз (по фактическим значениям в документе) ──
	const hasVat =
		has((r) => r.vatRate) ||
		has((r) => r.vatAmount) ||
		Number(data.totalVatAmount ?? 0) > 0;
	const hasExcise =
		has((r) => r.exciseRate) ||
		has((r) => r.exciseAmount) ||
		Number(data.totalExciseAmount ?? 0) > 0;
	const hasIndirectTaxes = hasVat || hasExcise;

	const showDiscPct =
		cols.discountPercent !== false &&
		(cols.discountPercent === true ||
			has((r) => r.discountPercent) ||
			has((r) => r.discountAmount));
	const showDiscAmt =
		cols.discountAmount !== false &&
		(cols.discountAmount === true ||
			has((r) => r.discountAmount) ||
			Number(data.totalDiscountAmount ?? 0) > 0);
	const showNetOfIndirectTaxes =
		hasIndirectTaxes &&
		cols.amountNetOfIndirectTaxes !== false &&
		(cols.amountNetOfIndirectTaxes === true ||
			has((r) => r.amountNetOfIndirectTaxes));
	// «Облагаемый оборот по НДС» — база для НДС (вкл. акциз, если он есть).
	const showAmtNoVat = hasIndirectTaxes && cols.amountWithoutVat !== false;
	const showExciseRate =
		hasExcise &&
		cols.exciseRate !== false &&
		(cols.exciseRate === true ||
			has((r) => r.exciseRate) ||
			has((r) => r.exciseAmount));
	const showExciseAmt =
		hasExcise &&
		cols.exciseAmount !== false &&
		(cols.exciseAmount === true ||
			has((r) => r.exciseAmount) ||
			Number(data.totalExciseAmount ?? 0) > 0);
	// По НК РК ст. 412 колонка «Ставка НДС, %» обязательна: всегда показывается.
	// Неплательщики НДС → ячейка содержит «Без НДС».
	const showVatRate = cols.vatRate !== false;
	const showVatAmt =
		data.isVatPayer !== false &&
		hasVat &&
		cols.vatAmount !== false &&
		(cols.vatAmount === true ||
			has((r) => r.vatAmount) ||
			Number(data.totalVatAmount ?? 0) > 0);

	const priceHeader = hasExcise
		? "Цена"
		: hasVat
			? "Цена"
			: "Цена"; /*Цена без НДС» при наличии НДС, иначе просто «Цена»*/
	const totalHeader = hasIndirectTaxes ? "Сумма" : "Сумма";

	// Заголовки таблицы
	const headers: string[] = [
		"№",
		"Наименование",
		"Ед. изм.",
		"Кол-во",
		priceHeader,
	];
	if (showDiscPct) headers.push("Процент скидки, %");
	if (showDiscAmt) headers.push("Сумма скидки");
	if (showNetOfIndirectTaxes) headers.push("Сумма без налогов");
	if (showAmtNoVat) headers.push("Облагаемый оборот по НДС");
	if (showExciseRate) headers.push("Ставка акциза, %");
	if (showExciseAmt) headers.push("Сумма акциза");
	if (showVatRate) headers.push("Ставка НДС, %");
	if (showVatAmt) headers.push("Сумма НДС");
	headers.push(totalHeader);

	const aoa: (string | number)[][] = [];

	// ── Шапка ──
	aoa.push(["Типовая форма З-2"]);
	aoa.push(["Утверждена приказом Министра финансов РК от 20.12.2012 г. № 562"]);
	aoa.push([]);
	aoa.push([
		`Накладная на отпуск запасов на сторону № ${data.documentId ?? "—"} от ${fmtDate(data.documentDate)}`,
	]);
	aoa.push([]);
	aoa.push([
		"Организация (отправитель):",
		`${data.organizationName ?? ""}${data.organizationBin ? `, БИН ${data.organizationBin}` : ""}`,
	]);
	aoa.push(["Адрес:", data.organizationAddress ?? ""]);
	aoa.push([
		"Получатель (контрагент):",
		`${data.counterpartyName ?? ""}${data.counterpartyBin ? `, БИН ${data.counterpartyBin}` : ""}`,
	]);
	aoa.push(["Адрес:", data.counterpartyAddress ?? ""]);
	if (data.contractName) aoa.push(["Договор / основание:", data.contractName]);
	if (data.warehouseName) aoa.push(["Склад отгрузки:", data.warehouseName]);
	aoa.push([]);

	const headerRowIndex = aoa.length;
	aoa.push(headers);

	// ── Строки ──
	for (const it of data.items) {
		const row: (string | number)[] = [
			it.number,
			it.name,
			it.unit ?? "",
			Number(it.quantity ?? 0),
			Number(it.price ?? 0),
		];
		if (showDiscPct)
			row.push(it.discountPercent != null ? Number(it.discountPercent) : "");
		if (showDiscAmt) row.push(fmtNum(it.discountAmount));
		if (showNetOfIndirectTaxes) row.push(fmtNum(it.amountNetOfIndirectTaxes));
		if (showAmtNoVat) row.push(fmtNum(it.amountWithoutVat));
		if (showExciseRate)
			row.push(
				it.exciseRate != null && it.exciseRate !== 0
					? Number(it.exciseRate)
					: "",
			);
		if (showExciseAmt) row.push(fmtNum(it.exciseAmount));
		if (showVatRate)
			row.push(
				data.isVatPayer === false
					? "Без НДС"
					: it.vatRate != null
						? Number(it.vatRate)
						: "",
			);
		if (showVatAmt) row.push(fmtNum(it.vatAmount));
		row.push(Number(it.amount ?? 0));
		aoa.push(row);
	}

	// ── Итого ──
	// «Итого:» занимает нечисловые колонки: №, Наим., Ед., Кол-во, Цена [, Процент скидки, %].
	const itogoColSpan = 5 + (showDiscPct ? 1 : 0);
	const totalRow: (string | number)[] = ["Итого:"];
	for (let i = 1; i < itogoColSpan; i++) totalRow.push("");
	if (showDiscAmt) totalRow.push(fmtNum(data.totalDiscountAmount));
	if (showNetOfIndirectTaxes) totalRow.push("");
	if (showAmtNoVat) totalRow.push(fmtNum(data.totalAmountWithoutVat));
	if (showExciseRate) totalRow.push("");
	if (showExciseAmt) totalRow.push(fmtNum(data.totalExciseAmount));
	if (showVatRate) totalRow.push("");
	if (showVatAmt) totalRow.push(fmtNum(data.totalVatAmount));
	totalRow.push(Number(data.totalAmount ?? 0));
	const itogoRowIndex = aoa.length;
	aoa.push(totalRow);

	aoa.push([]);
	aoa.push([
		`Всего отпущено наименований: ${data.items.length}, на сумму: ${Number(data.totalAmount ?? 0).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} тенге`,
	]);
	if (data.amountInWords) {
		aoa.push([`Сумма прописью: ${data.amountInWords}`]);
	}
	aoa.push([]);
	aoa.push([
		"Руководитель:",
		data.managerName ?? "",
		"",
		"Главный бухгалтер:",
		data.accountantName ?? "",
	]);
	aoa.push(["Отпустил:", "", "", "Получил:", data.receiverName ?? ""]);
	aoa.push(["Груз получил по доверенности №:", "", "от:", "", ""]);
	aoa.push([]);
	aoa.push(["М.П."]);

	const ws = XLSX.utils.aoa_to_sheet(aoa);

	// Ширина колонок
	ws["!cols"] = headers.map((h, idx) => {
		if (idx === 0) return { wch: 4 };
		if (idx === 1) return { wch: 36 };
		if (h.startsWith("Сто") || h.startsWith("Сум") || h.startsWith("Цена"))
			return { wch: 16 };
		if (h.startsWith("Кол")) return { wch: 10 };
		return { wch: 12 };
	});

	// Объединить «Итого:» по itogoColSpan колонкам
	ws["!merges"] = ws["!merges"] ?? [];
	if (itogoColSpan > 1) {
		ws["!merges"].push({
			s: { r: itogoRowIndex, c: 0 },
			e: { r: itogoRowIndex, c: itogoColSpan - 1 },
		});
	}

	void headerRowIndex; // зарезервировано на случай добавления стилей через writeXLSX styles

	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, ws, "Накладная");
	return wb;
}
