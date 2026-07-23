/**
 * ObjectLink — чип-ссылка на любой объект системы (документ, справочник, отчёт,
 * заметка, задача, файл). По клику открывает объект в новой панели тем же
 * механизмом restorePane, что и ссылка из адресной строки (?open=…).
 *
 * Ссылка хранится как ObjectRef {code, label} — см. utils/objectRef.
 * Если код не разбирается (устаревший/битый формат) — показываем подпись без
 * действия, а не ломаем весь текст.
 */
import { FC, useCallback } from "react";
import { useAppContext } from "src/app/context";
import { restorePane } from "src/app/paneRestore";
import { decodeRestore } from "src/utils/paneLink";
import type { ObjectRef } from "src/utils/objectRef";
import styles from "./ObjectLink.module.scss";

interface ObjectLinkProps {
  objectRef: ObjectRef;
  /** Заголовок при наведении (по умолчанию — подпись). */
  title?: string;
}

const ObjectLink: FC<ObjectLinkProps> = ({ objectRef, title }) => {
  const { windows: { addPane } } = useAppContext();
  const restore = decodeRestore(objectRef.code);

  const handleOpen = useCallback(() => {
    if (!restore) return;
    void restorePane({ uniqId: "", label: objectRef.label, restore }, addPane);
  }, [restore, objectRef.label, addPane]);

  // Битая/устаревшая ссылка — показываем подпись, но не делаем её кликабельной.
  if (!restore) {
    return <span className={styles.ObjectLinkBroken} title="Ссылка недоступна">{objectRef.label}</span>;
  }

  return (
    <button
      type="button"
      className={styles.ObjectLink}
      onClick={handleOpen}
      title={title ?? `Открыть: ${objectRef.label}`}
    >
      {objectRef.label}
    </button>
  );
};
ObjectLink.displayName = "ObjectLink";

export default ObjectLink;
