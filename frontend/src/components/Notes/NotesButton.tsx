// Кнопка «Заметки» для шапки панели (PaneItemHeaderToolbar). Показывает заметки,
// привязанные к открытой записи (entityType = endpoint, entityUuid = uuid), даёт
// добавить/удалить. Показывает и прикреплённые к записи задачи (только чтение).
// Создание задач — из шапки объекта (CreateTaskButton), а не из заметки.
import { FC, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "src/services/api/client";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import Modal from "src/components/Modal";
import Notice, { type NoticeItem } from "src/components/Notice";
import { FieldTextarea } from "src/components/Field";
import { Button } from "src/components/Button";
import ObjectLink from "src/components/ObjectLink";
import { refFromRestore } from "src/utils/objectRef";
import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/datetime";
import styles from "./NotesButton.module.scss";

interface NoteRow {
  uuid: string;
  body: string;
  authorUuid?: string | null;
  authorName?: string | null;
  createdAt: string;
}

const qk = (endpoint: string, uuid: string) => ["notes", endpoint, uuid];

const NotesButton: FC<{ endpoint: string; uuid?: string }> = ({ endpoint, uuid }) => {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  // Бейдж-счётчик заметок (лёгкий, всегда активен при сохранённой записи).
  const { data: count = 0 } = useQuery({
    queryKey: [...qk(endpoint, uuid ?? ""), "count"],
    queryFn: async () => {
      const r = await apiClient.get<{ items?: NoteRow[] }>("notes", { params: { entityType: endpoint, entityUuid: uuid } });
      return (r.data?.items ?? []).length;
    },
    enabled: !!uuid,
    staleTime: 30_000,
  });

  if (!uuid) return null; // заметки — только у сохранённой записи

  return (
    <>
      <IconButton
        active={count > 0}
        title={translate("notes")}
        aria-label={translate("notes")}
        onClick={() => setOpen(true)}
      >
        <Icon name="note" />
        {count > 0 && <span className={styles.Badge}>{count}</span>}
      </IconButton>
      {open && (
        <NotesModal
          endpoint={endpoint}
          uuid={uuid}
          onClose={() => setOpen(false)}
          invalidate={() => {
            void queryClient.invalidateQueries({ queryKey: qk(endpoint, uuid) });
            void queryClient.invalidateQueries({ queryKey: [...qk(endpoint, uuid), "count"] });
          }}
        />
      )}
    </>
  );
};

const NotesModal: FC<{ endpoint: string; uuid: string; onClose: () => void; invalidate: () => void }> = ({ endpoint, uuid, onClose, invalidate }) => {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { data: notes = [], isLoading } = useQuery({
    queryKey: qk(endpoint, uuid),
    queryFn: async () => {
      const r = await apiClient.get<{ items?: NoteRow[] }>("notes", { params: { entityType: endpoint, entityUuid: uuid } });
      return (r.data?.items ?? []) as NoteRow[];
    },
    staleTime: 0,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk(endpoint, uuid) });
    invalidate();
  }, [queryClient, endpoint, uuid, invalidate]);

  const add = useCallback(async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true); setError("");
    try {
      await apiClient.post("notes", { entityType: endpoint, entityUuid: uuid, body });
      setText("");
      refresh();
    } catch (e: unknown) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || translate("error"));
    } finally {
      setBusy(false);
    }
  }, [text, endpoint, uuid, refresh]);

  const remove = useCallback(async (noteUuid: string) => {
    try {
      await apiClient.delete(`notes/${noteUuid}`);
      refresh();
    } catch { /* тихо — список обновится при следующем открытии */ }
  }, [refresh]);

  // Прикреплённые задачи: созданные по ЭТОЙ записи (задача ссылается на неё через
  // sourceType/sourceUuid). Только чтение — виден и открывается результат.
  const { data: tasks = [] } = useQuery({
    queryKey: [...qk(endpoint, uuid), "tasks"],
    queryFn: async () => {
      const r = await apiClient.get<{ items?: Array<{ uuid: string; id: number; description?: string | null }> }>(
        "todos",
        { params: { filter: { sourceType: { equals: endpoint }, sourceUuid: { equals: uuid } }, limit: 50 } },
      );
      return r.data?.items ?? [];
    },
    staleTime: 30_000,
  });

  const notices: NoticeItem[] = error ? [{ type: "error", text: error }] : [];

  return (
    <Modal title={translate("notes")} onClose={onClose} style={{ minWidth: 460, maxWidth: 620 }}>
      <div className={styles.Body}>
        <Notice items={notices} />
        {/* Ввод заметки — общими компонентами формы (FieldTextarea + Button),
            как во всех формах, а не сырыми textarea/button. */}
        <div className={styles.AddRow}>
          <FieldTextarea
            label=""
            name="note-body"
            value={text}
            placeholder={translate("notePlaceholder")}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            width="100%"
            minHeight="60px"
          />
          <Button variant="primary" disabled={busy || !text.trim()} onClick={() => void add()}>
            {translate("add")}
          </Button>
        </div>

        {/* ── Заметки к записи ── */}
        <div className={styles.List}>
          {isLoading && <div className={styles.Hint}>…</div>}
          {!isLoading && notes.length === 0 && <div className={styles.Hint}>{translate("noNotes")}</div>}
          {notes.map((n) => (
            <div key={n.uuid} className={styles.Item}>
              <div className={styles.ItemBody}>{n.body}</div>
              <div className={styles.ItemMeta}>
                <span>{n.authorName || "—"} · {getFormatDateOnly(n.createdAt) ?? ""}</span>
                <span className={styles.ItemActions}>
                  <button className={styles.LinkBtnDanger} onClick={() => void remove(n.uuid)}>{translate("delete")}</button>
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* ── Прикреплённые задачи (по этой записи) — отдельная область, только
            чтение; клик открывает задачу. Создаются задачи из шапки объекта. ── */}
        {tasks.length > 0 && (
          <div className={styles.Tasks}>
            <span className={styles.TasksTitle}>{translate("relatedTasks")}</span>
            <div className={styles.TasksChips}>
              {tasks.map((t) => (
                <ObjectLink
                  key={t.uuid}
                  objectRef={refFromRestore(
                    { kind: "form", endpoint: "todos", uuid: t.uuid },
                    (t.description || `#${t.id}`).slice(0, 60),
                  )}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default NotesButton;
