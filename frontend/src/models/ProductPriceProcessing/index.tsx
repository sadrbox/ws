import React, { FC, useState, useEffect } from "react";
import { translate } from "src/i18";
import { Field, FieldDate, FieldNumber } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import SubTable from "src/components/SubTable";
import { Button } from "src/components/Button";
import priceColumns from "../Products/priceColumns.json";
// Using simplified plain layout to ensure visibility in pane
import { GroupCol } from "src/components/UI";
import "src/styles/main.module.scss";
import styles from "./ProductPriceProcessing.module.scss";
import apiClient from "src/services/api/client";
import { fetchList } from "src/services/offlineDataService";
import { useAccessRight } from "src/hooks/useAccessRight";
import ModelList from "src/components/ModelList";
import type { TPane } from "src/app/types";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { isoToLocalInput, localInputToIso, getFormatDateOnly } from "src/utils/datetime";
import * as XLSX from "xlsx";

const ENDPOINT = "product-price-settings"; // оставляем endpoint в реестре
const LIST_NAME = "ProductPriceSettingsList";

interface ImportRow {
  id: number;
  sku?: string;
  barcode?: string;
  name?: string;
  price?: number | null;
  productUuid?: string | null;
  matched?: boolean;
}

export const ProductPriceProcessing: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("Product");
  console.log("ProductPriceProcessing render", { canWrite });
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [subRows, setSubRows] = useState<any[]>([]);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [priceTypeUuid, setPriceTypeUuid] = useState<string>("");
  const [priceDate, setPriceDate] = useState<string>(isoToLocalInput(new Date().toISOString()));
  const [isLoading, setIsLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    // noop
  }, []);

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    setIsLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { header: 1 });
      if (!raw || raw.length === 0) {
        setRows([]);
        setIsLoading(false);
        return;
      }
      const header = (raw[0] as any[]).map((h: any) => String(h ?? "").trim().toLowerCase());
      const mapCol = (names: string[]) => {
        for (const n of names) {
          const idx = header.findIndex((h) => h === n.toLowerCase());
          if (idx >= 0) return idx;
        }
        return -1;
      };
      const skuIdx = mapCol(["sku", "артикул", "article"]);
      const barcodeIdx = mapCol(["barcode", "штрих-код", "штрихкод"]);
      const nameIdx = mapCol(["name", "наименование", "title"]);
      const priceIdx = mapCol(["price", "цена", "стоимость"]);

      const dataRows = raw.slice(1).map((r, i) => {
        const sku = skuIdx >= 0 ? String(r[skuIdx] ?? "").trim() : "";
        const barcode = barcodeIdx >= 0 ? String(r[barcodeIdx] ?? "").trim() : "";
        const name = nameIdx >= 0 ? String(r[nameIdx] ?? "").trim() : "";
        const priceRaw = priceIdx >= 0 ? r[priceIdx] : null;
        const price = priceRaw == null || priceRaw === "" ? null : parseFloat(String(priceRaw).replace(',', '.'));
        return { id: i + 1, sku: sku || undefined, barcode: barcode || undefined, name: name || undefined, price } as ImportRow;
      });

      setRows(dataRows);
      // Подготовим preview-строки (пока не заливаем в SubTable)
      const preview = dataRows.map((r, i) => ({
        id: -(i + 1),
        productUuid: r.productUuid ?? null,
        price: r.price ?? null,
        date: localInputToIso(priceDate),
        priceTypeUuid: priceTypeUuid || null,
        _importRowId: r.id,
        sku: r.sku,
        barcode: r.barcode,
        name: r.name,
      }));
      setPreviewRows(preview);
      // Показываем предпросмотр по умолчанию
      setShowPreview(true);

      // Автоподбор товаров по sku -> barcode
      for (let i = 0; i < dataRows.length; i++) {
        const r = dataRows[i];
        let foundUuid: string | null = null;
        if (r.sku) {
          try {
            const res = await fetchList("products", undefined, { "filter[sku][equals]": r.sku, limit: 1 });
            if (res.items && res.items.length > 0) foundUuid = res.items[0].uuid ?? null;
          } catch (e) { /* ignore */ }
        }
        if (!foundUuid && r.barcode) {
          try {
            const res = await fetchList("products", undefined, { "filter[barcode][equals]": r.barcode, limit: 1 });
            if (res.items && res.items.length > 0) foundUuid = res.items[0].uuid ?? null;
          } catch (e) { /* ignore */ }
        }
        if (foundUuid) {
          dataRows[i].productUuid = foundUuid;
          dataRows[i].matched = true;
        }
        setRows([...dataRows]);
        setPreviewRows(prev => prev.map(p => (p._importRowId === dataRows[i].id ? { ...p, productUuid: foundUuid ?? p.productUuid } : p)));
      }
    } catch (err) {
      console.error(err);
    } finally { setIsLoading(false); }
  };

  // Автозаполнение полей date/priceType в pending-строках при изменении контролов
  useEffect(() => {
    if (!subRows || subRows.length === 0) return;
    setSubRows(prev => prev.map(r => ({ ...r, date: localInputToIso(priceDate), priceTypeUuid: priceTypeUuid || null })));
  }, [priceDate, priceTypeUuid]);

  // Синхронизируем SubTable → простые rows для отображения таблицы/статуса
  const handleSubAllItemsChange = (items: any[]) => {
    setSubRows(items as any[]);
    const mapped: ImportRow[] = (items || []).map((r: any, idx: number) => ({
      id: r._importRowId ?? (r.id ?? idx + 1),
      sku: r.sku ?? undefined,
      barcode: r.barcode ?? undefined,
      name: r.name ?? undefined,
      price: r.price != null ? Number(r.price) : null,
      productUuid: r.productUuid ?? null,
      matched: !!r.productUuid,
    }));
    setRows(mapped);
  };

  const handleFillFromPreview = () => {
    if (!previewRows || previewRows.length === 0) return alert("Нет данных для заполнения");
    // Копируем previewRows в основную SubTable (pending)
    const mapped = previewRows.map((r, i) => ({ ...r, id: -(i + 1), _pendingAction: 'create' }));
    setSubRows(mapped);
  };

  const handleFillExisting = async () => {
    if (!priceTypeUuid) return alert("Выберите тип цены");
    setIsLoading(true);
    try {
      const resp = await apiClient.get(`/product-prices`, { params: { priceTypeUuid, limit: 1000 } });
      const items = resp.data.items as any[];
      const dateIso = localInputToIso(priceDate) ?? new Date().toISOString();
      const filtered = (items || []).filter(e => ((e.date ?? "").slice(0, 10)) === (dateIso ?? "").slice(0, 10));
      if (!filtered || filtered.length === 0) {
        alert("Нет существующих цен для выбранной даты/типа цены");
        return;
      }
      const pending = filtered.map((e, i) => ({ id: -(i + 1), productUuid: e.productUuid, price: e.price ?? null, date: e.date ?? dateIso, priceTypeUuid: priceTypeUuid }));
      setSubRows(pending);
    } catch (err) {
      console.error(err);
      alert("Ошибка при загрузке существующих цен");
    } finally { setIsLoading(false); }
  };

  const handleUpload = async () => {
    if (!canWrite) return;
    if (!priceTypeUuid) return alert("Выберите тип цены");
    setIsLoading(true);
    try {
      const ops: any[] = [];
      for (const r of rows) {
        if (!r.productUuid || r.price == null) continue;
        // Проверим текущие цены для товара
        const resp = await apiClient.get(`/product-prices`, { params: { productUuid: r.productUuid } });
        const existing = resp.data.items as any[];
        const dateIso = localInputToIso(priceDate) ?? new Date().toISOString();
        const exists = existing.some((e) => {
          const sameType = (e.priceType?.uuid ?? e.priceTypeUuid) === priceTypeUuid;
          // Сравним только дату (по дате без времени) и цену
          const ed = (e.date ?? "").slice(0, 10);
          const dd = (dateIso ?? "").slice(0, 10);
          const sameDate = ed === dd;
          const samePrice = (e.price == null && r.price == null) || Number(e.price) === Number(r.price);
          return sameType && sameDate && samePrice;
        });
        if (!exists) {
          ops.push({ action: "create", data: { productUuid: r.productUuid, priceTypeUuid, date: localInputToIso(priceDate), price: r.price } });
        }
      }
      if (ops.length === 0) {
        alert("Нечего загружать — все цены уже установлены или нет сопоставлений");
        setIsLoading(false);
        return;
      }
      const resp = await apiClient.post(`/product-prices/batch`, { operations: ops });
      const summary = resp.data?.summary;
      if (summary) {
        alert(`Загрузка завершена. Создано: ${summary.created || 0}, Обновлено: ${summary.updated || 0}, Удалено: ${summary.deleted || 0}, Пропущено: ${summary.skipped || 0}`);
      } else {
        alert("Загрузка завершена");
      }
      setRows([]);
    } catch (err) {
      console.error(err);
      alert("Ошибка при загрузке");
    } finally { setIsLoading(false); }
  };

  const handleDownloadTemplate = () => {
    try {
      const header = [["sku", "barcode", "name", "price"]];
      const sample = [["ART-001", "0123456789012", "Пример товара", "123.45"]];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([...header, ...sample]);
      XLSX.utils.book_append_sheet(wb, ws, "template");
      XLSX.writeFile(wb, "product_prices_template.xlsx");
    } catch (err) {
      console.error("download template error", err);
      alert("Не удалось сформировать шаблон");
    }
  };

  return (
    <div className={styles.wrapper}>
      <h2 className={styles.header}></h2>
      <div className={styles.debug}>
        <strong>DEBUG:</strong> canWrite: {String(canWrite)}, isLoading: {String(isLoading)}, rows: {rows.length}, subRows: {subRows.length}
      </div>
      <div className={styles.notice}>
        Поддерживаемый шаблон: колонки «sku/артикул», «barcode/штрих-код», «name/наименование», «price/цена».
      </div>
      <div className={styles.controls}>
        <LookupField label={translate("priceType")} name="ppi_priceType" value={priceTypeUuid} displayValue={""} onSelect={(u) => setPriceTypeUuid(u)} onClear={() => setPriceTypeUuid("")} endpoint="price-types" displayField="name" disabled={isLoading} />
        <FieldDate label={translate("date")} name="ppi_date" value={priceDate} onChange={(e) => setPriceDate(e.target.value)} disabled={isLoading} />
        <input type="file" accept=".xls,.xlsx" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} disabled={isLoading || !canWrite} />
        <Button variant="primary" onClick={handleFillFromPreview} disabled={isLoading || !canWrite}>Заполнить</Button>
        <Button onClick={handleFillExisting} disabled={isLoading || !canWrite}>Заполнить из существующих</Button>
        <Button variant="primary" onClick={handleUpload} disabled={isLoading || !canWrite}>{translate("upload") || "Загрузить"}</Button>
        <Button onClick={handleDownloadTemplate} type="button">Скачать шаблон</Button>
        <Button onClick={() => setShowPreview(v => !v)} type="button">{showPreview ? "Скрыть предпросмотр" : "Показать предпросмотр"}</Button>
      </div>

      <div className={styles.tableWrap}>
        <SubTable
          model="product-prices"
          componentName="ProductPricesList_part"
          columnsJson={priceColumns}
          parentKey="productUuid"
          parentUuid={""}
          deferRemoteChanges
          initialPendingRows={subRows}
          defaultInlineEditing={true}
          emptyMessage={"Загрузите файл с ценами"}
          onAllItemsChange={handleSubAllItemsChange}
          renderCell={(row, col, ctx) => {
            const r: any = row;
            if (col.identifier === "product.name") {
              if (ctx.inlineEditing) return (
                <LookupField label="" name={`ppi_product_${r.id}`} value={r.productUuid ?? ""} displayValue={String(r.product?.name ?? r.productName ?? "")} endpoint="products" displayField="name"
                  onSelect={(u, display) => ctx.handleLookupChange(r, "productUuid", u, { product: { name: display } })}
                  onClear={() => ctx.handleLookupChange(r, "productUuid", null, { product: null })}
                  disabled={ctx.disabled}
                />
              );
              return <span>{String(r.product?.name ?? r.productName ?? "")}</span>;
            }
            if (col.identifier === "priceType.name") {
              if (ctx.inlineEditing) return (
                <LookupField label="" name={`ppi_priceType_${r.id}`} value={r.priceTypeUuid ?? ""} displayValue={String(r.priceType?.name ?? r.priceTypeName ?? "")} endpoint="price-types" displayField="name"
                  onSelect={(u, display) => ctx.handleLookupChange(r, "priceTypeUuid", u, { priceType: { name: display } })}
                  onClear={() => ctx.handleLookupChange(r, "priceTypeUuid", null, { priceType: null })}
                  disabled={ctx.disabled}
                />
              );
              return <span>{String(r.priceType?.name ?? r.priceTypeName ?? "")}</span>;
            }
            if (col.identifier === "price") {
              if (ctx.inlineEditing) return <FieldNumber label="" name={`ppi_price_${r.id}`} value={String(r.price ?? "")} onChange={(e) => ctx.handleInlineChange(r, "price", e.target.value)} disabled={ctx.disabled} width="140px" variant="table" />;
              return <span>{r.price != null ? String(r.price) : ""}</span>;
            }
            return undefined;
          }}
          extraButtons={<>
            <Button variant="primary" onClick={handleFillFromPreview} disabled={isLoading || !canWrite}>Заполнить</Button>
            <Button onClick={handleFillExisting} disabled={isLoading || !canWrite}>Заполнить из существующих</Button>
          </>}
        />
      </div>
      {showPreview && rows.length > 0 && (
        <div className={styles.preview}>
          <strong>Предпросмотр импортируемых строк ({previewRows.length})</strong>
          <div style={{ marginTop: 8 }}>
            <SubTable
              model="product-prices"
              componentName="ProductPricesImport_preview"
              columnsJson={priceColumns}
              parentKey="productUuid"
              parentUuid={""}
              deferRemoteChanges
              initialPendingRows={previewRows}
              defaultInlineEditing={true}
              onAllItemsChange={(items) => setPreviewRows(items)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
ProductPriceProcessing.displayName = "ProductPriceProcessing";

// Простая List-компонента, открывает форму загрузки
export const ProductPriceSettingsList: FC<{ variant?: any; onSelectItem?: any }> = () => (
  <div style={{ padding: 12 }}>
    <ProductPriceProcessing />
  </div>
);
ProductPriceSettingsList.displayName = "ProductPriceSettingsList";

export default ProductPriceSettingsList;
