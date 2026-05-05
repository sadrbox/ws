import { FC, ReactNode } from "react";
import FormPanel from "src/components/FormPanel";
import Tabs from "src/components/Tabs";
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

interface ModelFormProps {
  /** Табы формы */
  tabs: { id: string; label: string; component: ReactNode }[];
  /** Обработчики действий */
  onSave: () => void;
  onSaveAndClose: () => void;
  onClose: () => void;
  onReload?: () => void;
  /** Состояние */
  isLoading: boolean;
  // showReload: boolean;
  /** Только чтение (опционально) */
  readonly?: boolean;
  /** Есть ли несохранённые изменения? */
  isDirty?: boolean;
  /** uniqId панели для регистрации тулбара */
  paneId?: string;
}

const ModelForm: FC<ModelFormProps> = ({
  tabs,
  onSave,
  onSaveAndClose,
  onClose, // закрытие теперь через ✕ в PaneHeaderControls
  onReload,
  isLoading,
  // showReload,
  readonly,
  // isDirty — не используется, индикатор через usePaneDirty в PaneItem
  paneId,
}) => {
  // Рендерим кнопки формы в заголовок панели через портал
  const toolbarPortal = usePaneToolbar(
    paneId,
    <FormPanel
      onSaveAndClose={onSaveAndClose}
      onSave={onSave}
      onReload={onReload}
      onClose={onClose}
      readonly={readonly}
      isLoading={isLoading}
    // showReload={showReload}
    />,
  );

  return (
    <>
      <Tabs tabs={tabs} />
      {toolbarPortal}
    </>
  );
};

ModelForm.displayName = "ModelForm";
export default ModelForm;
