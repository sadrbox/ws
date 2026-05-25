/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FC } from "react";
import type { TPane } from "src/app/types";
import { api } from "src/services/api/client";
import { getFormatDateOnly } from "src/utils/main.module";

export interface BasisFromTarget {
  /** Название создаваемого документа, напр. "Счёт-фактуру исходящую" */
  docLabel: string;
  /** Компонент формы создаваемого документа */
  FormComponent: FC<Partial<TPane>>;
  /** Значение basisDocumentType, которое будет записано в новый документ */
  basisType: string;
  /** Эндпоинт позиций исходного документа */
  sourceItemsEndpoint: string;
  /** Имя FK-поля для фильтрации позиций исходника */
  sourceItemsParentField: string;
  /** Маппинг полей шапки исходного документа в поля нового */
  mapFields: (source: any) => Record<string, any>;
}

/** Конвертирует позиции исходного документа в pending-строки для нового. */
export function mapItemsForBasis(sourceItems: any[]): any[] {
  const ts = Date.now();
  return sourceItems.map((r: any, i: number) => ({
    id: -(i + 1),
    uuid: `tmp-basis-${ts}-${i}`,
    _pendingAction: "create",
    productUuid: r.productUuid ?? null,
    product: r.product ?? null,
    unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
    unitOfMeasure: r.unitOfMeasure ?? null,
    quantity: Number(r.quantity ?? 0),
    price: Number(r.price ?? 0),
    vatRate: Number(r.vatRate ?? 0),
    exciseRate: Number(r.exciseRate ?? 0),
    discountPercent: Number(r.discountPercent ?? 0),
  }));
}

/**
 * Загружает позиции исходного документа, формирует initialFields + initialItems
 * и открывает новую панель с целевой формой, предзаполненной данными основания.
 */
export async function openDocumentFromBasis(
  sourceFields: Record<string, any>,
  sourceTypeLabel: string,
  target: BasisFromTarget,
  addPane: (pane: any) => void,
): Promise<void> {
  let sourceItems: any[] = [];
  if (sourceFields.uuid) {
    try {
      const resp: any = await api.get(`/${target.sourceItemsEndpoint}`, {
        params: { [target.sourceItemsParentField]: sourceFields.uuid, limit: 1000 },
      });
      sourceItems = Array.isArray(resp)
        ? resp
        : (resp?.data ?? resp?.items ?? []);
    } catch (e) {
      console.error("[createFromBasis] не удалось загрузить позиции", e);
    }
  }

  const dateStr = sourceFields.date ? (getFormatDateOnly(sourceFields.date) ?? "") : "";
  const basisLabel = `${sourceTypeLabel} #${sourceFields.id ?? ""} · ${dateStr}`;

  const initialFields = {
    ...target.mapFields(sourceFields),
    date: new Date().toISOString().slice(0, 10),
    basisDocumentType: target.basisType,
    basisDocumentUuid: sourceFields.uuid ?? "",
    basisDocumentLabel: basisLabel,
  };

  addPane({
    component: target.FormComponent,
    label: `Новый: ${target.docLabel}`,
    data: { fromBasisFields: initialFields, fromBasisItems: mapItemsForBasis(sourceItems) },
  });
}

/** Стандартный маппинг полей шапки для большинства торговых документов. */
export function mapCommonTradeFields(src: any): Record<string, any> {
  return {
    organizationUuid: src.organizationUuid ?? "",
    organizationName: src.organization?.name ?? src.organizationName ?? "",
    counterpartyUuid: src.counterpartyUuid ?? "",
    counterpartyName: src.counterparty?.name ?? src.counterpartyName ?? "",
    contractUuid: src.contractUuid ?? "",
    contractName: src.contract?.name ?? src.contractName ?? "",
    warehouseUuid: src.warehouseUuid ?? "",
    warehouseName: src.warehouse?.name ?? src.warehouseName ?? "",
  };
}
