// Учёт товара по сериям и партиям — ОДИН источник для ячеек «Серии» и «Партия» строки
// документа (аудит 26.09, О4).
//
// Раньше каждая ячейка сама читала карточку товара `GET products/:uuid`, под своим ключом
// (`product-serial-flag` и `product-batch-flag`) и с датой документа в ключе, хотя на
// сервер дата не уходит: на 100 строк — до 200 одинаковых запросов, и ещё столько же после
// смены даты в шапке. Теперь:
//   • строка документа уже несёт карточку товара целиком (позиции приходят с
//     `include: { product }`), и признаки берутся из неё без запроса;
//   • только если в строке их нет (товар только что выбран в лукапе) — один запрос на
//     ТОВАР под общим ключом, который делят обе ячейки и все строки с этим товаром;
//   • сравнение с датой документа — вычисление на месте, а не часть ключа запроса.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import apiClient from "src/services/api/client";

export interface ProductTracking {
  trackSerialNumbers: boolean;
  serialTrackingSince: string | null;
  trackBatches: boolean;
  batchTrackingSince: string | null;
}

/** Поля карточки товара, которые могут лежать в строке документа (row.product). */
export type RowProductTracking = Partial<{
  trackSerialNumbers: boolean | null;
  serialTrackingSince: string | null;
  trackBatches: boolean | null;
  batchTrackingSince: string | null;
}>;

export type TrackingKind = "serial" | "batch";

/** Итог для ячейки: учёт действует на дату документа; since — для подсказки «учёт с …». */
export interface TrackingState { ok: boolean; since: string | null }

export const productTrackingKey = (productUuid: string) => ["product-tracking", productUuid] as const;

const FIELDS: Record<TrackingKind, { flag: "trackSerialNumbers" | "trackBatches"; since: "serialTrackingSince" | "batchTrackingSince" }> = {
  serial: { flag: "trackSerialNumbers", since: "serialTrackingSince" },
  batch: { flag: "trackBatches", since: "batchTrackingSince" },
};

/**
 * Признаки из строки, если их там достаточно для ответа: «не учитывается» известно по одному
 * флагу, «учитывается» — только вместе с моментом включения учёта (без него нельзя сказать,
 * действует ли учёт на дату документа). Иначе null — нужен запрос карточки.
 */
export function trackingFromRow(product: RowProductTracking | null | undefined, kind: TrackingKind): { tracked: boolean; since: string | null } | null {
  if (!product) return null;
  const f = FIELDS[kind];
  if (product[f.flag] === false) return { tracked: false, since: null };
  if (product[f.flag] === true && f.since in product) return { tracked: true, since: product[f.since] ?? null };
  return null;
}

/**
 * Действует ли учёт на дату документа. Учёт не применяется ЗАДНИМ ЧИСЛОМ: контроль идёт
 * только для документов с датой не раньше момента включения флага — тот же инвариант
 * держит бэкенд (services/serialNumbers.js, services/batches.js). Новый документ (даты ещё
 * нет) считается «сейчас». since отдаётся только для «документ старше включения учёта».
 */
export function trackingOnDate(tracked: boolean, sinceIso: string | null, documentDate: string | null | undefined): TrackingState {
  if (!tracked) return { ok: false, since: null };
  if (!sinceIso) return { ok: true, since: null };
  const docAt = documentDate ? new Date(documentDate) : new Date();
  return docAt >= new Date(sinceIso) ? { ok: true, since: null } : { ok: false, since: sinceIso };
}

/** Учёт товара по сериям/партиям на дату документа; undefined — пока неизвестно (загрузка). */
export function useProductTracking(
  productUuid: string,
  kind: TrackingKind,
  rowProduct: RowProductTracking | null | undefined,
  documentDate: string | null | undefined,
): TrackingState | undefined {
  const known = trackingFromRow(rowProduct, kind);
  const { data } = useQuery({
    queryKey: productTrackingKey(productUuid),
    queryFn: async (): Promise<ProductTracking> => {
      const r = await apiClient.get<{ item?: RowProductTracking }>(`products/${productUuid}`);
      const item = r.data?.item ?? {};
      return {
        trackSerialNumbers: item.trackSerialNumbers === true,
        serialTrackingSince: item.serialTrackingSince ?? null,
        trackBatches: item.trackBatches === true,
        batchTrackingSince: item.batchTrackingSince ?? null,
      };
    },
    enabled: !!productUuid && !known,
    staleTime: 5 * 60_000,
  });
  const f = FIELDS[kind];
  const tracked = known ? known.tracked : data ? data[f.flag] : undefined;
  const since = known ? known.since : data ? data[f.since] : null;
  return useMemo(
    () => (tracked === undefined ? undefined : trackingOnDate(tracked, since, documentDate)),
    [tracked, since, documentDate],
  );
}
