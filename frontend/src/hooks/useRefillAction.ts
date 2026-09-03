/**
 * useRefillAction — обёртка «Перезаполнить по основанию» с подтверждением.
 *
 * Кнопка переехала из тулбара пейна в ряд действий поля «Основание»
 * (BasisDocumentField): действие относится ровно к этому полю, а в шапке оно
 * стояло десятым, между «Удалить документ» и «Печать».
 *
 * Плата за переезд — соседство с «Очистить»: кнопки в поле мелкие и стоят
 * вплотную, а перезаполнение ПЕРЕТИРАЕТ введённые данные. Поэтому спрашиваем
 * подтверждение — всегда, а не только при непустой таблице: цена ошибки
 * (потерянный ручной ввод) заметно выше цены одного лишнего клика.
 *
 * Владелец обязан отрисовать <ConfirmModal {...confirmState} />.
 */
import { useCallback, useRef } from "react";
import { useConfirm } from "src/hooks/useConfirm";

export interface UseRefillActionArgs {
  /** Собственно перезаполнение (handleRefillFromBasis формы). */
  run: () => Promise<void> | void;
  /**
   * Сколько строк табличной части будет заменено — для текста вопроса.
   * Функция, а не число: считаем в момент клика (актуальнее) и берём из
   * типизированного ref строк, а не из нетипизированной таблицы формы.
   * Не задана — документ без строк (кассовый ордер, банковская выписка).
   */
  getRowCount?: () => number;
}

export function useRefillAction({ run, getRowCount }: UseRefillActionArgs) {
  const { confirm, confirmState } = useConfirm();

  // Аргументы держим в ref, чтобы onRefill был СТАБИЛЬНЫМ: он попадает в deps
  // useMemo с вкладками формы, а getRowCount на месте вызова — стрелка, новая
  // на каждый рендер. Иначе вкладки пересобирались бы каждый рендер.
  const latest = useRef({ run, getRowCount });
  latest.current = { run, getRowCount };

  const onRefill = useCallback(() => {
    void (async () => {
      const rowCount = latest.current.getRowCount?.() ?? 0;
      const message = rowCount > 0
        ? `Строки документа (${rowCount}) будут заменены строками документа-основания, а поля шапки — перезаполнены. Продолжить?`
        : "Поля документа будут перезаполнены по документу-основанию. Введённые вручную значения будут заменены. Продолжить?";
      if (!(await confirm(message))) return;
      await latest.current.run();
    })();
  }, [confirm]);

  return { onRefill, confirmState };
}
