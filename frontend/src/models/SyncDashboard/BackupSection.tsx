// Резервное копирование БД (E1.3) — секция в SyncDashboard. Только суперадмин:
// кнопка «Создать резервную копию» (pg_dump на сервере) + список последних дампов.
import { FC } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Group } from "src/components/UI";
import { Button } from "src/components/Button";
import { Divider } from "src/components/Field";
import { reportError } from "src/services/errors/route";
import { notify, useNoticeScope } from "src/components/TechMessages/store";
import { useRunningWork, withOp } from "src/components/TechMessages/operations";

/** Ключ работы в реестре: pg_dump идёт минутами, и вторая копия поверх первой не нужна. */
const BACKUP_WORK = "db-backup";
import { getCurrentUser } from "src/services/auth";
import { getFormatDate } from "src/utils/datetime";
import { fetchBackups, createBackup, type BackupFile } from "src/services/backup/api";
import mainStyles from "src/styles/main.module.scss";

const mb = (n: number) => `${(n / 1048576).toFixed(1)} МБ`;

const BackupSection: FC = () => {
  const qc = useQueryClient();
  const isSuperAdmin = !!getCurrentUser()?.isSuperAdmin;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-backups"],
    queryFn: async () => (await fetchBackups()).items,
    enabled: isSuperAdmin,
  });

  /*
   * РЕЗЕРВНАЯ КОПИЯ — ДОЛГАЯ РАБОТА РЕЕСТРА (M15): ход виден в области сообщений с любого
   * экрана, а кнопка знает, что копия уже создаётся, даже если секцию открыли заново.
   */
  const pane = useNoticeScope();
  const running = useRunningWork(BACKUP_WORK);
  const create = useMutation({
    mutationFn: () => withOp(
      { kind: "create", title: translate("backupCreate"), target: "", workKey: BACKUP_WORK, pane, reportsOwnOutcome: true },
      () => createBackup(),
    ),
    onSuccess: (r) => {
      // Какой файл копии создан — событие (M12): его ищут, когда понадобилось восстановление.
      notify({
        severity: "success", source: translate("backupCreate"),
        text: `${translate("backupCreated")}: ${r.backup.file} (${mb(r.backup.size)})`,
      });
      void qc.invalidateQueries({ queryKey: ["admin-backups"] });
    },
    onError: (e: unknown) => {
      reportError(e, { source: translate("backupCreate"), fallback: translate("serverError") });
    },
  });

  if (!isSuperAdmin) return null;

  const items: BackupFile[] = data ?? [];

  return (
    <>
      <Divider />
      <Group className={mainStyles.Form}>
        <div style={{ color: "var(--sv-color5, #888)", fontSize: 12, marginBottom: 8, maxWidth: 520, lineHeight: 1.5 }}>
          {translate("backupHint")}
        </div>
        <div>
          <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending || running}>
            <span>💾 {create.isPending || running ? translate("backupRunning") : translate("backupCreate")}</span>
          </Button>
        </div>

        {isLoading ? (
          <div style={{ color: "var(--sv-color5, #888)", marginTop: 8 }}>…</div>
        ) : items.length === 0 ? (
          <div style={{ color: "var(--sv-color5, #888)", marginTop: 8 }}>{translate("backupNone")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8, maxWidth: 520 }}>
            {items.map((b) => (
              <div key={b.file} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0", fontSize: 13, borderBottom: "1px solid var(--sv-color33, #ddd)" }}>
                <span style={{ fontFamily: "monospace" }}>{b.file}</span>
                <span style={{ color: "var(--sv-color51, #666)", whiteSpace: "nowrap" }}>{mb(b.size)} · {getFormatDate(b.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Group>
    </>
  );
};

export default BackupSection;
