import { FC } from "react";
import { translate } from "src/i18";
import styles from "./GovDocErrors.module.scss";

/** Одна группа ошибок (ЭСФ / СНТ / ЭАВР), текст — свод из бэкенда (joinErrorText). */
export interface GovDocErrorGroup {
  label: string;
  text?: string | null;
}

export interface GovDocErrorsProps {
  groups: GovDocErrorGroup[];
}

/**
 * T7.8 — ПОСТОЯННАЯ панель ошибок гос-документа (в отличие от тоста, который
 * исчезает). Показывает свод `sntErrorText`/`awpErrorText`/`esfErrorText`, который
 * бэкенд сохраняет при отклонении: пользователь видит, ЧТО именно отклонено, и после
 * переоткрытия документа. Пустые группы не рендерятся; всё пусто → компонент null.
 */
const GovDocErrors: FC<GovDocErrorsProps> = ({ groups }) => {
  const shown = groups.filter((g) => g.text && g.text.trim());
  if (!shown.length) return null;
  return (
    <div className={styles.Root} role="alert">
      <div className={styles.Head}>{translate("govDocErrorsTitle")}</div>
      {shown.map((g) => (
        <div key={g.label} className={styles.Group}>
          <div className={styles.Label}>{g.label}</div>
          <ul className={styles.List}>
            {g.text!.split(/\r?\n/).filter((l) => l.trim()).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default GovDocErrors;
