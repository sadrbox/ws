import { FC, ReactNode } from "react";
import FormPanel from "src/components/FormPanel";
import FormError from "src/components/FormError";
import Tabs from "src/components/Tabs";
import styles from "src/styles/main.module.scss";
import { usePaneToolbar } from "src/hooks/usePaneToolbar";

/**
 * Универсальная обёртка формы модели.
 * Заменяет одинаковый JSX-шаблон во всех формах:
 * ```
 * <div className={styles.FormWrapper}>
 *   <FormPanel ... />
 *   <FormError ... />
 *   <div className={styles.FormBody}>
 *     <Tabs tabs={tabs} />
 *   </div>
 * </div>
 * ```
 */

interface ModelFormWrapperProps {
  /** Табы формы */
  tabs: { id: string; label: string; component: ReactNode }[];
  /** Обработчики действий */
  onSave: () => void;
  onSaveAndClose: () => void;
  onClose: () => void;
  onReload?: () => void;
  /** Состояние */
  isLoading: boolean;
  showReload: boolean;
  /** Ошибка */
  error: string | null;
  errorRevision?: number;
  onErrorDismiss: () => void;
  /** Только чтение (опционально) */
  readonly?: boolean;
  /** Есть ли несохранённые изменения? */
  isDirty?: boolean;
  /** uniqId панели для регистрации тулбара */
  paneId?: string;
}

const ModelFormWrapper: FC<ModelFormWrapperProps> = ({
  tabs,
  onSave,
  onSaveAndClose,
  onClose: _onClose, // закрытие теперь через ✕ в PaneHeaderControls
  onReload,
  isLoading,
  showReload,
  error,
  errorRevision,
  onErrorDismiss,
  readonly,
  isDirty: _isDirty, // индикатор теперь через usePaneDirty в PaneItem
  paneId,
}) => {
  // Рендерим кнопки формы в заголовок панели через портал
  const toolbarPortal = usePaneToolbar(
    paneId,
    <FormPanel
      readonly={readonly}
      onSaveAndClose={onSaveAndClose}
      onSave={onSave}
      onReload={onReload}
      isLoading={isLoading}
      showReload={showReload}
    />,
  );

  return (
    <div className={styles.FormWrapper}>
      {toolbarPortal}
      <FormError
        message={error}
        revision={errorRevision}
        onDismiss={onErrorDismiss}
      />
      <div className={styles.FormBody}>
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
};

ModelFormWrapper.displayName = "ModelFormWrapper";
export default ModelFormWrapper;
