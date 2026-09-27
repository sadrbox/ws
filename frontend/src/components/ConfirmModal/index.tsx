import { FC } from "react";
import type { ConfirmState } from "src/hooks/useConfirm";
// Button is provided by Modal's buttons area
import Modal from "src/components/Modal";
import { translate } from "src/i18";

/**
 * ConfirmModal now uses shared Modal component so it benefits from
 * focus-trap, centralized ESC handling and body scroll lock.
 *
 * Сообщение выводится ТЕКСТОМ (переносы — white-space: pre-wrap): в него
 * подставляются имена файлов, пользователей, записей — HTML из них не
 * исполняется (аудит 26.09, Б7). Экранировать на стороне вызова НЕ нужно.
 */
const ConfirmModal: FC<ConfirmState> = ({ isOpen, message, onConfirm, onCancel }) => {
  if (!isOpen) return null;

  return (
    <Modal
      title={translate("confirmation")}
      onClose={onCancel}
      style={{ maxWidth: 420 }}
      buttons={[
        { label: translate("yes"), onClick: onConfirm, variant: "secondary" },
        { label: translate("cancel"), onClick: onCancel, variant: "secondary" },
      ]}
    >
      <div>
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }} data-testid="confirm-message">{message}</p>
      </div>
    </Modal>
  );
};

export default ConfirmModal;
