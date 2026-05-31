/**
 * RefillFromBasisButton — кнопка «Перезаполнить по основанию» с индикацией
 * несоответствия документу-основанию.
 *
 * Когда `mismatch=true` (см. useBasisMismatch) кнопка визуально выделяется
 * (оранжевый цвет иконки + точка-маркер), а в тултипе перечисляются конкретные
 * расхождения шапки/строк — пользователю сразу понятно по кнопке, что документ
 * разошёлся с основанием и его стоит перезаполнить.
 */
import { type FC } from "react";
import IconButton from "src/components/IconButton/IconButton";
import { translate } from "src/i18";

const WARN_COLOR = "#d97706";
const BASE_TITLE = "Перезаполнить по основанию";

interface RefillFromBasisButtonProps {
  mismatch?: boolean;
  mismatchDetails?: string[];
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

const RefillFromBasisButton: FC<RefillFromBasisButtonProps> = ({
  mismatch,
  mismatchDetails,
  disabled,
  loading,
  onClick,
}) => {
  const title = mismatch
    ? `${translate("basisMismatch")}:\n• ${(mismatchDetails ?? []).join("\n• ")}\n\n${BASE_TITLE}`
    : BASE_TITLE;

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <IconButton
        icon="syncFromBasis"
        title={title}
        aria-label={title}
        disabled={disabled}
        loading={loading}
        onClick={onClick}
        style={mismatch ? { color: WARN_COLOR } : undefined}
      />
      {mismatch && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -1,
            right: -1,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: WARN_COLOR,
            border: "1.5px solid #fff",
            pointerEvents: "none",
          }}
        />
      )}
    </span>
  );
};

export default RefillFromBasisButton;
