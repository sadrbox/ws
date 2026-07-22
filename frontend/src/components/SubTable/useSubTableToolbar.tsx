/**
 * useSubTableToolbar — режим inline-редактирования и доп-кнопки тулбара табличной
 * части (вынесено из SubTable/index.tsx — T4).
 *
 * Содержит: состояние `inlineEditing` (редактирование в таблице ↔ через форму) +
 * переключатель, и мемоизированные `extraButtons` — кнопка переключения режима
 * (только когда форменный режим реально доступен: задан openFormFor) плюс
 * пользовательские extraButtons. Поведение inline-режима покрыто тестами
 * (subTableInlineEdit.test).
 */
import { useState, useCallback, useMemo, type ReactNode } from "react";
import Toolbar from "src/components/Toolbar";

interface UseSubTableToolbarOptions {
  readonly: boolean;
  disabled: boolean;
  showEditModeToggle: boolean;
  /** Доступен ли форменный режим (задан openFormFor) — без него переключатель бесполезен. */
  hasFormMode: boolean;
  defaultInlineEditing: boolean;
  /** Пользовательские кнопки тулбара (проп extraButtons компонента). */
  extraButtons?: ReactNode;
}

export function useSubTableToolbar({
  readonly, disabled, showEditModeToggle, hasFormMode, defaultInlineEditing, extraButtons: extraButtonsProp,
}: UseSubTableToolbarOptions) {
  const [inlineEditing, setInlineEditing] = useState(readonly ? false : defaultInlineEditing);
  const toggleInlineEditing = useCallback(() => setInlineEditing(prev => !prev), []);

  const extraButtons = useMemo(() => (
    <>
      {/* Переключатель «Редактирование через форму / в таблице» — только если
          форменный режим реально доступен (без openFormFor Enter не открывает форму). */}
      {!readonly && !disabled && showEditModeToggle && hasFormMode && (
        <>
          <Toolbar.Divider />
          <Toolbar.InlineEditButton
            onClick={toggleInlineEditing}
            active={inlineEditing}
            title={inlineEditing ? "Редактирование через форму" : "Редактирование в таблице"} />
        </>
      )}
      {extraButtonsProp && extraButtonsProp}
    </>
  ), [toggleInlineEditing, inlineEditing, extraButtonsProp, readonly, disabled, showEditModeToggle, hasFormMode]);

  return { inlineEditing, setInlineEditing, toggleInlineEditing, extraButtons };
}
