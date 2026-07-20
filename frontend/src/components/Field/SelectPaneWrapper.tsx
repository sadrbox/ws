import { FC, useCallback, useEffect, useState } from "react";
import { useAppContext } from "src/app/context";
import { LoadingSpinner } from "src/components/UI";
import type { TPane } from "src/app/types";

/**
 * SelectPaneWrapper — обёртка для отображения List-компонента
 * внутри PaneItem как форму выбора.
 *
 * Получает:
 *  - data.endpoint — для динамической загрузки List-компонента
 *  - data.listComponent — готовый компонент списка (опционально)
 *  - onSelectResult — callback при выборе элемента (двойной клик)
 *  - uniqId — для закрытия панели после выбора
 *
 * Логика:
 *  1. Лениво загружает List-компонент по endpoint (как LookupSelectModal)
 *  2. Рендерит его с variant="default" + onSelectItem
 *  3. При onSelectItem → вызывает onSelectResult, закрывает pane
 *  4. Кнопки Добавить/Удалить в Table работают как обычно (openModelForm через addPane)
 *  5. После закрытия дочерней формы — система вернёт фокус на эту selector-панель
 */

// Реестр загрузчиков List-компонентов (из единого modelRegistry)
import { getByEndpoint } from "src/registry/modelRegistry";

const SelectPaneWrapper: FC<Partial<TPane>> = ({ data, onSelectResult, uniqId }) => {
  const { windows: { requestClose } } = useAppContext();

  const endpoint = (data as any)?.endpoint as string | undefined;
  const ListComponentProp = (data as any)?.listComponent as FC<any> | undefined;
  const extraParams = (data as any)?.extraParams as Record<string, string> | undefined;

  const [ResolvedList, setResolvedList] = useState<FC<any> | null>(ListComponentProp || null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (ListComponentProp) {
      setResolvedList(() => ListComponentProp);
      return;
    }
    if (!endpoint) {
      setLoadError("endpoint не указан");
      return;
    }
    const entry = getByEndpoint(endpoint);
    if (!entry) {
      setLoadError(`Неизвестный endpoint: ${endpoint}`);
      return;
    }
    let cancelled = false;
    entry.module().then((mod) => {
      if (cancelled) return;
      const ListComp = mod[entry.listName] || mod.default;
      if (ListComp) {
        setResolvedList(() => ListComp);
      } else {
        setLoadError(`Компонент ${entry.listName} не найден в модуле`);
      }
    }).catch((err) => {
      if (!cancelled) setLoadError(err?.message || "Ошибка загрузки модуля");
    });
    return () => { cancelled = true; };
  }, [endpoint, ListComponentProp]);

  const handleSelectItem = useCallback((item: Record<string, any>) => {
    onSelectResult?.(item);
    if (uniqId) void requestClose(uniqId, { force: true });
  }, [onSelectResult, uniqId, requestClose]);

  const handleCancel = useCallback(() => {
    if (uniqId) void requestClose(uniqId, { force: true });
  }, [uniqId, requestClose]);

  if (loadError) {
    return (
      <div style={{ padding: "24px" }}>
        <div style={{ color: "var(--danger)", padding: "16px", background: "var(--danger-bg)", borderRadius: 4 }}>{loadError}</div>
        <button onClick={handleCancel} style={{ marginTop: 12, padding: "6px 16px", cursor: "pointer" }}>Закрыть</button>
      </div>
    );
  }

  if (!ResolvedList) {
    // Пока лениво грузится компонент списка — только спиннер, без слова
    // «Загрузка...» (спиннер сам по себе сообщает о загрузке; после монтирования
    // список показывает собственный LoadingSpinner при загрузке данных).
    return <LoadingSpinner />;
  }

  // Передаём extraParams как extraQueryParams — ModelList / Table понимают именно это имя
  // (нужно для ownerType/ownerUuid при выборе "Выбрать из списка" в BasisDocumentField и др.)
  return (
    <ResolvedList
      variant="default"
      onSelectItem={handleSelectItem}
      extraParams={extraParams}
      extraQueryParams={extraParams}
    />
  );
};

SelectPaneWrapper.displayName = "SelectPaneWrapper";
export default SelectPaneWrapper;
