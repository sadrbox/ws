import { FC } from "react";
import type { ConfirmState } from "src/hooks/useConfirm";
// Button is provided by Modal's buttons area
import Modal from "src/components/Modal";

/**
 * ConfirmModal now uses shared Modal component so it benefits from
 * focus-trap, centralized ESC handling and body scroll lock.
 */
const ConfirmModal: FC<ConfirmState> = ({ isOpen, message, onConfirm, onCancel }) => {
  if (!isOpen) return null;

  return (
    <Modal
      title="Подтверждение"
      onClose={onCancel}
      style={{ maxWidth: 420 }}
      buttons={[
        { label: "Да", onClick: onConfirm, variant: "secondary" },
        { label: "Отмена", onClick: onCancel, variant: "secondary" },
      ]}
    >
      <div>
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }} dangerouslySetInnerHTML={{ __html: message }} />
      </div>
    </Modal>
  );
};

export default ConfirmModal;
