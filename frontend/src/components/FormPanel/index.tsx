import { FC } from "react";
import { Button, ButtonImage } from "src/components/Button";
import { Divider } from "src/components/Field";
import styles from "src/styles/main.module.scss";
import reload_16 from "src/assets/reload_16.png";

export interface FormPanelProps {
  onSaveAndClose?: () => void;
  onSave?: () => void;
  onClose: () => void;
  onReload?: () => void;
  isLoading: boolean;
  showReload?: boolean;
  /** Если true — скрыть кнопки сохранения (режим только чтение по правам доступа) */
  readonly?: boolean;
}

/**
 * Стандартная панель кнопок формы:
 * [Сохранить и закрыть] | [Сохранить] [Закрыть] | [⟳ Обновить]
 *
 * Если onSaveAndClose / onSave не переданы — кнопки сохранения скрываются
 * (readonly-формы, например ActivityHistories).
 *
 * Если readonly=true — кнопки сохранения принудительно скрываются
 * (права доступа = "readonly").
 */
const FormPanel: FC<FormPanelProps> = ({
  onSaveAndClose,
  onSave,
  onClose,
  onReload,
  isLoading,
  showReload = true,
  readonly: isReadonly = false,
}) => {
  const effectiveSaveAndClose = isReadonly ? undefined : onSaveAndClose;
  const effectiveSave = isReadonly ? undefined : onSave;

  return (
  <div className={styles.FormPanel}>
    <div className={styles.TablePanelLeft}>
      <div
        className={[styles.colGroup, styles.gap6].join(" ")}
        style={{ justifyContent: "flex-start" }}
      >
        {effectiveSaveAndClose && (
          <Button variant="primary" onClick={effectiveSaveAndClose} disabled={isLoading}>
            <span>Сохранить и закрыть</span>
          </Button>
        )}
        {(effectiveSaveAndClose || effectiveSave) && <Divider />}
        {effectiveSave && (
          <Button onClick={effectiveSave} disabled={isLoading}>
            <span>Сохранить</span>
          </Button>
        )}
        <Button onClick={onClose} disabled={isLoading}>
          <span>Закрыть</span>
        </Button>
        {showReload && onReload && (
          <>
            <Divider />
            <ButtonImage onClick={onReload} title="Обновить" disabled={isLoading}>
              <img
                src={reload_16}
                alt="Reload"
                height={16}
                width={16}
                className={isLoading ? styles.animationLoop : ""}
              />
            </ButtonImage>
          </>
        )}
      </div>
    </div>
    <div className={styles.TablePanelRight} />
  </div>
);
};

FormPanel.displayName = "FormPanel";
export default FormPanel;
