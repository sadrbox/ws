/**
 * ObjectMarks — область МЕТОК записи. Метка = ссылка на любой объект системы
 * (справочник, документ, задача, отчёт…); меток у записи может быть несколько.
 *
 * Показывает метки чипами (клик открывает объект), позволяет добавить новую
 * (выбор типа объекта + запись через обычный LookupField) и снять.
 *
 * Хранение — таблица object_marks: пара (ownerType, ownerUuid) → (targetType,
 * targetUuid, targetLabel). Подпись цели сохраняется, поэтому метка читается,
 * даже если объект потом удалён или недоступен по правам.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "src/services/api/client";
import { translate } from "src/i18";
import { getAllEntries } from "src/registry/modelRegistry";
import { FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import ObjectLink from "src/components/ObjectLink";
import { refFromRestore } from "src/utils/objectRef";
import { showToast } from "src/components/UIToast";
import styles from "./ObjectMarks.module.scss";

interface MarkRow {
  uuid: string;
  targetType: string;
  targetUuid: string;
  targetLabel?: string | null;
}

interface ObjectMarksProps {
  /** Endpoint записи-владельца меток. */
  endpoint: string;
  /** UUID записи-владельца (метки доступны только у сохранённой записи). */
  uuid?: string;
  /** Организация записи — для орг-изоляции меток. */
  organizationUuid?: string;
  /** Только чтение (нет права на изменение записи). */
  readonly?: boolean;
}

const qk = (endpoint: string, uuid: string) => ["object-marks", endpoint, uuid];

const ObjectMarks: FC<ObjectMarksProps> = ({ endpoint, uuid, organizationUuid, readonly = false }) => {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [targetType, setTargetType] = useState("");

  // Типы объектов для выбора — весь реестр моделей, кроме самой записи-владельца.
  const typeOptions = useMemo(
    () => getAllEntries()
      .map((e) => ({ value: e.endpoint, label: translate(e.listName) || e.label || e.endpoint }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru")),
    [],
  );

  const { data: marks = [] } = useQuery({
    queryKey: qk(endpoint, uuid ?? ""),
    queryFn: async () => {
      const r = await apiClient.get<{ items?: MarkRow[] }>("object-marks", {
        params: { ownerType: endpoint, ownerUuid: uuid },
      });
      return r.data?.items ?? [];
    },
    enabled: !!uuid,
    staleTime: 30_000,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk(endpoint, uuid ?? "") });
  }, [queryClient, endpoint, uuid]);

  const addMark = useCallback(async (targetUuid: string, targetLabel: string) => {
    if (!uuid || !targetType || !targetUuid) return;
    try {
      await apiClient.post("object-marks", {
        ownerType: endpoint, ownerUuid: uuid,
        targetType, targetUuid, targetLabel,
        organizationUuid,
      });
      setAdding(false);
      setTargetType("");
      refresh();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      showToast(msg || translate("error"), "error");
    }
  }, [uuid, endpoint, targetType, organizationUuid, refresh]);

  const removeMark = useCallback(async (markUuid: string) => {
    try {
      await apiClient.delete(`object-marks/${markUuid}`);
      refresh();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      showToast(msg || translate("error"), "error");
    }
  }, [refresh]);

  // Метки — только у сохранённой записи (у новой нет uuid, к чему привязывать).
  if (!uuid) return null;

  return (
    <div className={styles.Marks}>
      <div className={styles.Head}>
        <span className={styles.Title}>{translate("marks")}</span>
        {!readonly && !adding && (
          <button type="button" className={styles.AddBtn} onClick={() => setAdding(true)}>
            + {translate("add")}
          </button>
        )}
      </div>

      <div className={styles.Chips}>
        {marks.length === 0 && !adding && (
          <span className={styles.Empty}>{translate("marksEmpty")}</span>
        )}
        {marks.map((m) => (
          <span key={m.uuid} className={styles.Chip}>
            <ObjectLink
              objectRef={refFromRestore(
                { kind: "form", endpoint: m.targetType, uuid: m.targetUuid },
                m.targetLabel || m.targetType,
              )}
            />
            {!readonly && (
              <button
                type="button"
                className={styles.RemoveBtn}
                title={translate("delete")}
                onClick={() => void removeMark(m.uuid)}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      {adding && (
        <div className={styles.Picker}>
          <FieldSelect
            label={translate("type")}
            name="mark-target-type"
            options={typeOptions}
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            style={{ minWidth: 220 }}
          />
          {/* Запись выбирается обычным лукапом — работает поиск, права и «Создать новый». */}
          {targetType && (
            <LookupField
              label={translate("object")}
              name="mark-target"
              endpoint={targetType}
              value=""
              displayValue=""
              onSelect={(selectedUuid, display) => void addMark(selectedUuid, display)}
              minWidth="260px"
            />
          )}
          <button type="button" className={styles.CancelBtn} onClick={() => { setAdding(false); setTargetType(""); }}>
            {translate("cancel")}
          </button>
        </div>
      )}
    </div>
  );
};
ObjectMarks.displayName = "ObjectMarks";

export default ObjectMarks;
