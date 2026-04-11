import { FC } from "react";
import ReactDOM from "react-dom";
import type { ConfirmState } from "src/hooks/useConfirm";
import { Button } from "src/components/Button";
import styles from "src/components/Modal/Modal.module.scss";

/**
 * Модальное окно подтверждения — замена window.confirm().
 * Используется в паре с хуком useConfirm.
 */
const ConfirmModal: FC<ConfirmState> = ({ isOpen, message, onConfirm, onCancel }) => {
  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return ReactDOM.createPortal(
    <div className={styles.ModalBackground} onClick={handleBackdropClick} onKeyDown={handleKeyDown}>
      <div className={styles.ModalWrapper} style={{ maxWidth: 420 }}>
        <div className={styles.ModalButtons}>
          <Button onClick={onConfirm} variant="primary">Да</Button>
          <Button onClick={onCancel} variant="secondary">Отмена</Button>
        </div>
        <div className={styles.ModalTitle}>Подтверждение</div>
        <div className={styles.ModalBody}>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{message}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ConfirmModal;
