// ProgressSpinner — кольцевой индикатор прогресса с процентами в центре.
// Аналог LoadingSpinner, но детерминированный: дуга кольца отражает value (0–100),
// в центре — «N%». Используется при загрузке файла (видно сразу после выбора).
// Без inline-стилей: stroke-dasharray/offset — это SVG-АТРИБУТЫ, не style.
import { FC } from "react";
import styles from "./ProgressSpinner.module.scss";

const SIZE = 56;
const STROKE = 5;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

const ProgressSpinner: FC<{ value: number }> = ({ value }) => {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const offset = C * (1 - pct / 100);
  return (
    <div className={styles.Wrap}>
      <svg className={styles.Svg} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle className={styles.Track} cx={SIZE / 2} cy={SIZE / 2} r={R} strokeWidth={STROKE} fill="none" />
        <circle
          className={styles.Arc}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
        />
      </svg>
      <span className={styles.Pct}>{pct}%</span>
    </div>
  );
};

ProgressSpinner.displayName = "ProgressSpinner";
export default ProgressSpinner;
