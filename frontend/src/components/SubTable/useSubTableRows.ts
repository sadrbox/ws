/**
 * useSubTableRows — машина состояния строк SubTable (#5 — разгрузка SubTable).
 *
 * Инкапсулирует весь кэш строк и его синхронизацию с сервером:
 *   • cachedRowsRef + cacheVersion — локальный кэш отображаемых строк;
 *   • мерж pending-строк (initialPendingRows) при восстановлении из sessionStorage;
 *   • синхронизация кэша с серверной выборкой (useInfiniteModelList) с сохранением
 *     несохранённых (dirty) правок при invalidateQueries;
 *   • notifyParent — оповещение формы-родителя об изменениях (с нумерацией строк);
 *   • tempIdRef / pendingAppliedRef — служебные счётчики для temp-строк и однократного мержа.
 *
 * Поведение идентично прежнему inline-коду в SubTable; вынесено дословно, чтобы
 * сложную (race-prone) логику можно было читать и рассуждать о ней отдельно.
 * Обработчики (add/delete/inline-change) остаются в компоненте и работают через
 * возвращаемые cachedRowsRef / setCacheVersion / notifyParent.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TDataItem } from "src/components/Table/types";
import { mergeServerWithPending, type PendingRow } from "./rowModel";

interface UseSubTableRowsParams {
  deferRemoteChanges: boolean;
  initialPendingRows?: TDataItem[];
  parentUuid: string;
  /** Серверная выборка (useInfiniteModelList). */
  allItems: TDataItem[];
  isAnythingLoading: boolean;
  dataUpdatedAt: number;
  onItemsChange?: (items: TDataItem[]) => void;
  onAllItemsChange?: (rows: TDataItem[]) => void;
}

export interface UseSubTableRowsResult {
  /** Текущий кэш строк (мемоизирован по cacheVersion). */
  rows: PendingRow[];
  /** Версия кэша — bump для форс-перерисовки после мутации cachedRowsRef. */
  cacheVersion: number;
  setCacheVersion: React.Dispatch<React.SetStateAction<number>>;
  /** Мутабельный кэш строк — обработчики патчат `.current` напрямую. */
  cachedRowsRef: React.MutableRefObject<PendingRow[]>;
  /** Оповестить родителя об изменении (нумерует строки, отбрасывает _untouched). */
  notifyParent: (items: PendingRow[]) => void;
  /** Счётчик temp-id (отрицательные id для новых строк). */
  tempIdRef: React.MutableRefObject<number>;
  /** Флаг: мерж initialPendingRows уже применён (однократно). */
  pendingAppliedRef: React.MutableRefObject<boolean>;
}

export function useSubTableRows({
  deferRemoteChanges,
  initialPendingRows,
  parentUuid,
  allItems,
  isAnythingLoading,
  dataUpdatedAt,
  onItemsChange,
  onAllItemsChange,
}: UseSubTableRowsParams): UseSubTableRowsResult {
  // ── Стабильные ref для колбэков (избегаем бесконечного цикла) ────
  const onItemsChangeRef = useRef(onItemsChange);
  onItemsChangeRef.current = onItemsChange;
  const onAllItemsChangeRef = useRef(onAllItemsChange);
  onAllItemsChangeRef.current = onAllItemsChange;

  // ── Кэширование строк ─────────────────────────────────────────────────
  const cachedRowsRef = useRef<PendingRow[]>([]);
  const [cacheVersion, setCacheVersion] = useState(0);

  // temp id counter for local rows (negative ids)
  // Инициализируем СИНХРОННО: если есть initialPendingRows с отрицательными id —
  // ставим счётчик ниже минимума, чтобы новые строки не получали дублирующиеся ключи.
  const tempIdRef = useRef(
    deferRemoteChanges && initialPendingRows?.length
      ? Math.min(-1, Math.min(...initialPendingRows.map(r => (typeof r.id === "number" ? r.id : 0))) - 1)
      : -1,
  );
  // Флаг: были ли initialPendingRows уже применены (мерж выполняется один раз)
  const pendingAppliedRef = useRef(false);
  // Счётчик для принудительного запуска основного эффекта после применения stash
  const [mergeTrigger, setMergeTrigger] = useState(0);

  // ── Оповещение родителя об изменении данных ───────────────────────────
  // НЕ вызываем onItemsChange при каждом allItems — это вызывало бесконечный цикл,
  // т.к. onItemsChange → setFormData → re-render → onItemsChange пересоздаётся → эффект снова.
  // Вместо этого onItemsChange вызывается только при ЛОКАЛЬНЫХ изменениях (add/edit/delete/merge).

  /**
   * Оповестить родителя об изменении данных.
   * При передаче исключаем «нетронутые» строки (_untouched) —
   * новые пустые строки, которые пользователь ещё не редактировал,
   * не должны попадать в pending (sessionStorage) и не должны коммититься.
   */
  const notifyParent = useCallback((items: PendingRow[]) => {
    // Always notify onAllItemsChange with the full row set so consumers that track
    // unique-option usage (useUniqueOptionRows) stay in sync on every user action,
    // not just on server-data refetch.
    onAllItemsChangeRef.current?.(items);

    if (!onItemsChangeRef.current) return;
    // Нумеруем только видимые (не удалённые) строки — чтобы _lineNumber совпадал
    // с номером строки в displayRows (ctx.rows тоже фильтрует _pendingAction==="delete").
    // Присваиваем ДО фильтрации _untouched, чтобы пустые нетронутые строки не
    // сдвигали нумерацию заполненных.
    let visIdx = 0;
    const withNums = items.map(r => {
      if (r._pendingAction !== "delete") visIdx++;
      return { ...r, _lineNumber: r._pendingAction !== "delete" ? visIdx : 0 };
    });
    const filtered = withNums.filter(r => !r._untouched);
    onItemsChangeRef.current(filtered);
  }, []);

  // Сброс pendingAppliedRef когда pending очищается (после commit) —
  // это позволяет повторный мерж при следующем восстановлении из sessionStorage.
  const prevInitialPendingLenRef = useRef(initialPendingRows?.length ?? 0);
  useEffect(() => {
    const prevLen = prevInitialPendingLenRef.current;
    const curLen = initialPendingRows?.length ?? 0;
    prevInitialPendingLenRef.current = curLen;

    if (deferRemoteChanges && prevLen > 0 && curLen === 0) {
      // pending очищен после коммита — сбрасываем флаг мержа
      pendingAppliedRef.current = false;

      // Строки с delete-маркером удаляем из кэша — они уже удалены на сервере.
      // Строки с create/update-маркером оставляем без маркера, чтобы они
      // оставались видимы до прихода ответа refetch (без мерцания / без дублей).
      // Ветка B основного эффекта заменит их реальными данными сервера.
      cachedRowsRef.current = cachedRowsRef.current
        .filter(r => r._pendingAction !== "delete")
        .map(r => {
          if (r._pendingAction) {
            const { _pendingAction: _a, _untouched: _u, ...rest } = r;
            return rest as PendingRow;
          }
          return r;
        });
      setCacheVersion(v => v + 1);
      // Refetch is handled by the parent form's afterSave → invalidateSubTables.
    } else if (deferRemoteChanges && curLen > 0 && prevLen === 0) {
      // stash применён — сбрасываем флаг мержа и запускаем основной эффект заново
      pendingAppliedRef.current = false;
      setMergeTrigger(v => v + 1);
    }
  }, [deferRemoteChanges, initialPendingRows]);

  useEffect(() => {
    // ── Ветка A: мерж pending-строк из initialPendingRows (один раз при восстановлении) ──
    if (deferRemoteChanges && initialPendingRows?.length && !pendingAppliedRef.current) {
      // Для сохранённых документов ждём, пока придут серверные данные.
      // Если сработать на пустом allItems — delete-маркеры в initialPendingRows
      // не совпадут ни с одной серверной строкой и будут отброшены, после чего
      // Branch B смержит старые серверные строки с новыми pending-creates → дубликаты.
      //
      // Ждём, если идёт загрузка ЛИБО в pending есть delete-маркеры: им нужны
      // серверные строки (по uuid), без них они теряются. Это исправляет дубли
      // при «Перезаполнить по основанию» со сменой основания, когда на remount
      // серверная query ещё не вернула данные (allItems=[] и isAnythingLoading
      // кратковременно false).
      const hasDeleteMarkers = initialPendingRows.some(
        (r) => (r as PendingRow)._pendingAction === "delete",
      );
      if (parentUuid && allItems.length === 0 && (isAnythingLoading || hasDeleteMarkers)) return;

      pendingAppliedRef.current = true;
      const merged = mergeServerWithPending([...allItems], initialPendingRows);

      cachedRowsRef.current = merged;
      setCacheVersion(v => v + 1);
      onAllItemsChangeRef.current?.(merged);
      notifyParent(merged);
      return;
    }

    // ── Ветка B: синхронизация кэша с серверными данными ──
    // Убираем любые остаточные temp-строки (отрицательный id или uuid "tmp-...")
    const clean = allItems.filter(r =>
      !(typeof r.id === "number" && r.id < 0) && !(typeof r.uuid === "string" && r.uuid.startsWith("tmp-"))
    ) as PendingRow[];

    const prev = cachedRowsRef.current;
    // Собираем dirty-строки, исключая «нетронутые» (новые пустые строки — не были отредактированы)
    const dirtyRows: PendingRow[] = deferRemoteChanges
      ? prev.filter(r => r._pendingAction && !r._untouched)
      : [];

    // Если есть pending-строки при deferRemoteChanges — мержим с серверными данными,
    // чтобы не потерять локальные изменения при invalidateQueries (например после
    // сохранения формы открытой из SubTable в режиме "Редактирование в форме").
    // НЕ мержим если родитель уже очистил pending (initialPendingRows === []) —
    // это значит коммит прошёл успешно, серверные данные теперь авторитетны.
    if (dirtyRows.length > 0 && (initialPendingRows?.length ?? 0) > 0) {
      const merged = mergeServerWithPending(clean, dirtyRows);

      cachedRowsRef.current = merged;
      setCacheVersion(v => v + 1);
      onAllItemsChangeRef.current?.(merged);
      // Оповещаем родителя — данные могли обновиться на сервере
      notifyParent(merged);
      return;
    }

    // Нет pending-строк — чистая замена кэша.
    // Исключение: если кэш содержит tmp-строки (уже закоммиченные, но ещё
    // не подтверждённые refetch) и сервер вернул 0 строк — ждём refetch.
    // Это устраняет мерцание в момент когда parentUuid только что появился
    // (новый документ) и query ещё не успела вернуть свежие данные.
    const hasTmpRows = deferRemoteChanges && prev.some(r =>
      typeof r.uuid === "string" && r.uuid.startsWith("tmp-"),
    );
    if (hasTmpRows && clean.length === 0) return;

    const hadDirtyRows = prev.some(r => r._pendingAction);
    const countChanged = prev.length !== clean.length;
    // Сравниваем содержимое: проверяем id, uuid и все скалярные поля (deep compare).
    // Ранее сравнивались только id/uuid, что пропускало обновления содержимого строк.
    const contentChanged = countChanged || prev.some((r, i) => {
      const c = clean[i];
      if (!c || r.id !== c.id || r.uuid !== c.uuid) return true;
      // Быстрая deep-проверка через JSON
      return JSON.stringify(r) !== JSON.stringify(c);
    });

    cachedRowsRef.current = clean;
    setCacheVersion(v => v + 1);
    onAllItemsChangeRef.current?.(clean);

    // Оповещаем родителя:
    // - ВСЕГДА если были dirty-строки (чтобы родитель узнал что pending очищен)
    // - ВСЕГДА если данные реально изменились (новые/удалённые строки с сервера)
    if (deferRemoteChanges && (hadDirtyRows || contentChanged)) {
      notifyParent(clean);
    }
  }, [allItems, dataUpdatedAt, mergeTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    return cachedRowsRef.current;
  }, [cacheVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  return { rows, cacheVersion, setCacheVersion, cachedRowsRef, notifyParent, tempIdRef, pendingAppliedRef };
}
