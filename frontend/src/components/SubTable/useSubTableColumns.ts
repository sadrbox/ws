/**
 * useSubTableColumns — состояние и синхронизация состава колонок табличной части
 * (вынесено из SubTable/index.tsx — T4).
 *
 * Состав колонок меняется НА ЛЕТУ: «Серии»/«Партии» появляются, когда в строках
 * оказывается товар с таким учётом. useState считает колонки один раз, а
 * перемонтировать таблицу нельзя (потерялись бы незаписанные строки), поэтому состав
 * синхронизируется вручную через mergeColumnDefs (перенос ширины/видимости с уже
 * настроенных колонок) — НЕ через getModelColumns, который при смене набора
 * идентификаторов счёл бы кэш устаревшим и стёр сохранённые ширины/видимость.
 */
import { useState, useMemo, useRef, useEffect, useCallback, type SetStateAction } from "react";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { mergeColumnDefs } from "./rowModel";

export function useSubTableColumns(colJson: TColumn[], componentName: string) {
  const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(colJson, componentName, "part"));

  const colSig = useMemo(() => colJson.map((c) => c.identifier).join(","), [colJson]);
  const prevColSigRef = useRef(colSig);
  useEffect(() => {
    if (prevColSigRef.current === colSig) return;
    prevColSigRef.current = colSig;
    setColumns((prev) => mergeColumnDefs(prev, colJson));
  }, [colSig, colJson]);

  // Обёртка setColumns: не даём служебной колонке `__rowActions` попасть в
  // сохраняемые настройки/state (Table при resize/настройке пишет columns целиком).
  const setColumnsForTable = useCallback((next: SetStateAction<TColumn[]>) => {
    setColumns((prev) => {
      const resolved = typeof next === "function" ? (next as (p: TColumn[]) => TColumn[])(prev) : next;
      return resolved.filter((c) => c.identifier !== "__rowActions");
    });
  }, []);

  return { columns, setColumns, setColumnsForTable };
}
