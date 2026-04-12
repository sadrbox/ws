import { FC, ReactNode } from "react";
import FormPanel from "src/components/FormPanel";
import FormError from "src/components/FormError";
import Tabs from "src/components/Tabs";
import styles from "src/styles/main.module.scss";

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
}

const ModelFormWrapper: FC<ModelFormWrapperProps> = ({
  tabs,
  onSave,
  onSaveAndClose,
  onClose,
  onReload,
  isLoading,
  showReload,
  error,
  errorRevision,
  onErrorDismiss,
  readonly,
}) => {
  return (
    <div className={styles.FormWrapper}>
      <FormPanel
        readonly={readonly}
        onSaveAndClose={onSaveAndClose}
        onSave={onSave}
        onClose={onClose}
        onReload={onReload}
        isLoading={isLoading}
        showReload={showReload}
      />
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
