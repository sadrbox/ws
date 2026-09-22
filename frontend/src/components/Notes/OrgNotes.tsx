/**
 * Заметки ОРГАНИЗАЦИИ — вид для области-спутника (см. TechMessages: переключатель в шапке).
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ NotesButton. Та показывает заметки открытой записи: «что важно помнить про
 * эту реализацию». Эта — заметки про организацию в целом: о чём договорились с клиентом, что
 * обещали, чего ждать. Их же пишет и читает чат внутри 1С (`/bpai/notes`), поэтому список здесь
 * и список в 1С — один и тот же.
 *
 * Привязка та же полиморфная, что у всех заметок: entityType = "organizations", entityUuid —
 * uuid активной организации. Отдельной таблицы у организации нет и не нужно.
 *
 * Правит и убирает автор (или суперадмин) — это правило бэкенда, здесь мы просто показываем
 * кнопку и даём ему отказать: гадать о правах на клиенте значит разойтись с сервером.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "src/services/api/client";
import { Button } from "src/components/Button";
import { FieldTextarea } from "src/components/Field";
import Notice, { type NoticeItem } from "src/components/Notice";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { getCurrentUser } from "src/services/auth";
import { translate } from "src/i18";
import { getFormatDate } from "src/utils/datetime";
import styles from "./OrgNotes.module.scss";

interface NoteRow {
  uuid: string;
  body: string;
  authorUuid?: string | null;
  authorName?: string | null;
  createdAt: string;
}

const ORG_ENTITY = "organizations";

export const OrgNotes: FC = () => {
  const { organizationUuid, organizationName } = useDefaultOrganization();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const me = getCurrentUser()?.uuid ?? "";

  // Ключ запроса — в useMemo: он же стоит в зависимостях обновления, и новый массив на каждый
  // рендер означал бы обновление списка по кругу.
  const queryKey = useMemo(() => ["notes", ORG_ENTITY, organizationUuid], [organizationUuid]);
  const { data: notes = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const r = await apiClient.get<{ items?: NoteRow[] }>("notes", {
        params: { entityType: ORG_ENTITY, entityUuid: organizationUuid },
      });
      return r.data?.items ?? [];
    },
    enabled: !!organizationUuid,
  });

  const refresh = useCallback(() => { void queryClient.invalidateQueries({ queryKey }); }, [queryClient, queryKey]);

  const add = useCallback(async () => {
    const body = text.trim();
    if (!body || !organizationUuid) return;
    setBusy(true); setError("");
    try {
      await apiClient.post("notes", { entityType: ORG_ENTITY, entityUuid: organizationUuid, body, organizationUuid });
      setText("");
      refresh();
    } catch (e: unknown) {
      // Ошибка данных формы — <Notice/> внутри вида, а не тост: она про то, что здесь набрано.
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || translate("error"));
    } finally {
      setBusy(false);
    }
  }, [text, organizationUuid, refresh]);

  const remove = useCallback(async (uuid: string) => {
    try {
      await apiClient.delete(`notes/${uuid}`);
      refresh();
    } catch (e: unknown) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || translate("error"));
    }
  }, [refresh]);

  if (!organizationUuid) return <div className={styles.Empty}>{translate("orgNotesNoOrganization")}</div>;

  const notices: NoticeItem[] = error ? [{ type: "error", text: error }] : [];

  return (
    <div className={styles.Root}>
      <div className={styles.Hint}>{translate("orgNotesHint")}{organizationName ? ` · ${organizationName}` : ""}</div>
      <Notice inline items={notices} />
      <div className={styles.AddRow}>
        <FieldTextarea
          label=""
          name="org-note-body"
          value={text}
          placeholder={translate("notePlaceholder")}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          width="100%"
          minHeight="48px"
        />
        <Button variant="primary" disabled={busy || !text.trim()} onClick={() => void add()}>{translate("add")}</Button>
      </div>

      <div className={styles.List}>
        {isLoading && <div className={styles.Empty}>{translate("loading")}</div>}
        {!isLoading && !notes.length && <div className={styles.Empty}>{translate("orgNotesNone")}</div>}
        {notes.map((n) => (
          <div key={n.uuid} className={styles.Item}>
            <div className={styles.Meta}>
              <span>{n.authorName || "—"}</span>
              <span>{getFormatDate(n.createdAt)}</span>
              {/* Кнопку показываем автору: чужую уберёт только суперадмин, и ему это доступно из карточки. */}
              {n.authorUuid === me && (
                <IconButton size="sm" title={translate("delete")} aria-label={translate("delete")} onClick={() => void remove(n.uuid)}>
                  <Icon name="clear" />
                </IconButton>
              )}
            </div>
            <div className={styles.Body}>{n.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default OrgNotes;
