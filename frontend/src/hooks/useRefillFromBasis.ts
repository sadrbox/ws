/**
 * useRefillFromBasis — единый враппер кнопки «Перезаполнить по основанию» для
 * торговых документов (Реализация, Поступление, Возвраты): хранит флаг загрузки
 * и вызывает общий runBasisRefill (utils/createFromBasis), где и живёт вся логика
 * (включая страховку «первого клика» через WeakMap).
 *
 * Формы отличаются только itemsEndpoint/itemsParentField (и набором orgFields) —
 * всё это передаётся аргументами. Документы без товарной таблицы (напр. банковская
 * выписка) перезаполняют шапку по-своему и этот хук НЕ используют.
 */
import { useCallback, useState } from "react";
import { runBasisRefill, type OrgDependentField } from "src/utils/createFromBasis";
import type { UserDefaultsMap } from "src/hooks/useUserDefaults";

export interface UseRefillFromBasisArgs {
  /** Стор формы зависимого документа (useFormStore). */
  form: any;
  /** UUID текущего пользователя (для подстановки менеджера и т.п.). */
  currentUserUuid: string;
  /** Ref с дефолтами прав/организации пользователя. */
  permDefaultsRef: { current: UserDefaultsMap };
  /** Endpoint строк документа, напр. "saleitems". */
  itemsEndpoint: string;
  /** Поле-родитель строк, напр. "saleUuid". */
  itemsParentField: string;
  /** Поля шапки, зависящие от организации (склад/договор и т.п.). */
  orgFields: OrgDependentField[];
  /** Ref со всеми строками таблицы (для пересборки). */
  allItemsRef: { current: any[] };
  /** Сеттер строк, подставляемых из основания. */
  setBasisItems: (rows: any[]) => void;
  /** Инкремент ключа таблицы (форс-ремоунт после перезаполнения). */
  bumpItemsTableKey: () => void;
}

export function useRefillFromBasis(args: UseRefillFromBasisArgs): {
  isRefilling: boolean;
  handleRefillFromBasis: (skipFields?: boolean) => Promise<void>;
} {
  const {
    form, currentUserUuid, permDefaultsRef,
    itemsEndpoint, itemsParentField, orgFields,
    allItemsRef, setBasisItems, bumpItemsTableKey,
  } = args;

  const [isRefilling, setIsRefilling] = useState(false);

  const handleRefillFromBasis = useCallback(async (skipFields = false) => {
    setIsRefilling(true);
    try {
      await runBasisRefill({
        form, skipFields,
        currentUserUuid,
        permDefaults: permDefaultsRef.current,
        itemsEndpoint, itemsParentField,
        orgFields,
        allItemsRef, setBasisItems, bumpItemsTableKey,
      });
    } catch (e) {
      console.error("[refill] failed", e);
    } finally {
      setIsRefilling(false);
    }
    // Состав deps повторяет прежний враппер форм: остальные аргументы — стабильные
    // ref'ы/сеттеры либо константные конфиги, пересоздавать колбэк по ним не нужно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, currentUserUuid]);

  return { isRefilling, handleRefillFromBasis };
}
