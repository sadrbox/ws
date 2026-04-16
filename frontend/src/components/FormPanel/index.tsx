import { FC } from "react";
import { Button } from "src/components/Button";
import styles from "src/styles/main.module.scss";

export interface FormPanelProps {
  onSaveAndClose?: () => void;
  onSave?: () => void;
  onReload?: () => void;
  isLoading: boolean;
  showReload?: boolean;
  /** Если true — скрыть кнопки сохранения (режим только чтение по правам доступа) */
  readonly?: boolean;
}

/**
 * Панель действий формы, рендерится в PaneHeaderToolbar через портал.
 *
 * Содержит только бизнес-действия:
 *   [Сохранить и закрыть] | [Сохранить] | [⟳ Обновить]
 *
 * Кнопка «Закрыть» (✕) и индикатор isDirty (●) управляются
 * на уровне PaneItem — они одинаковы для всех панелей.
 */
const FormPanel: FC<FormPanelProps> = ({
  onSaveAndClose,
  onSave,
  onReload,
  isLoading,
  showReload = true,
  readonly: isReadonly = false,
}) => {
  const effectiveSaveAndClose = isReadonly ? undefined : onSaveAndClose;
  const effectiveSave = isReadonly ? undefined : onSave;

  // Если нечего показывать (readonly без reload) — не рендерим ничего
  const hasActions = effectiveSaveAndClose || effectiveSave || (showReload && onReload);
  if (!hasActions) return null;

  return (
    <>
      {effectiveSaveAndClose && (
        <Button variant="primary" onClick={effectiveSaveAndClose} disabled={isLoading}>
          <span>Сохранить и закрыть</span>
        </Button>
      )}
      {effectiveSave && (
        <Button onClick={effectiveSave} disabled={isLoading}>
          <span>Сохранить</span>
        </Button>
      )}
      {showReload && onReload && (
        <button
          className={styles.PaneHeaderControl}
          onClick={onReload}
          disabled={isLoading}
          title="Обновить"
          type="button"
        >
          <svg
            width="14" height="14" viewBox="0 0 16 16" fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={isLoading ? styles.animationLoop : undefined}
          >
            <path
              d="M14 1v5h-5"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"
            />
            <path
              d="M13.3 10a6 6 0 1 1-1.06-5.3L14 6"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"
            />
          </svg>
        </button>
      )}
    </>
  );
};

FormPanel.displayName = "FormPanel";
export default FormPanel;
