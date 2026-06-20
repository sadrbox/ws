import { FC } from "react";
import styles from "./UploadProgress.module.scss";

/** Форматирование размера файла: КБ если < 1 МБ, иначе МБ. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " КБ";
  return (bytes / (1024 * 1024)).toFixed(2) + " МБ";
}

interface UploadProgressProps {
  /** Имя загружаемого файла. */
  name: string;
  /** Размер файла в байтах. */
  size: number;
  /** Процент загрузки (0..100). */
  percent: number;
}

/**
 * UploadProgress — инлайн-баннер прогресса загрузки файла: имя, размер и
 * полоса прогресса с процентом. Размер не сжимается (всегда виден целиком).
 */
const UploadProgress: FC<UploadProgressProps> = ({ name, size, percent }) => (
  <div className={styles.UploadProgress}>
    <span className={styles.Name} title={name}>{name}</span>
    <span className={styles.Size}>{formatFileSize(size)}</span>
    <div className={styles.Track}>
      {/* Ширина — единственное динамическое значение, задаётся через CSS-переменную. */}
      <div className={styles.Fill} style={{ "--percent": `${percent}%` } as React.CSSProperties} />
    </div>
    <span className={styles.Percent}>{percent}%</span>
  </div>
);

export default UploadProgress;
export { UploadProgress };
