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
import styles from "./RefillFromBasisButton.module.scss";

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
    <span className={styles.Wrapper}>
      <IconButton
        icon="syncFromBasis"
        title={title}
        aria-label={title}
        disabled={disabled}
        loading={loading}
        onClick={onClick}
        className={mismatch ? styles.WarnIcon : undefined}
      />
      {mismatch && <span aria-hidden className={styles.WarnDot} />}
    </span>
  );
};

export default RefillFromBasisButton;
