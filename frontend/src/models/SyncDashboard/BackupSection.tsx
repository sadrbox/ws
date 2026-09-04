// Резервное копирование БД (E1.3) — секция в SyncDashboard. Только суперадмин:
// кнопка «Создать резервную копию» (pg_dump на сервере) + список последних дампов.
import { FC } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Group } from "src/components/UI";
import { Button } from "src/components/Button";
import { Divider } from "src/components/Field";
import { showToast } from "src/components/UIToast";
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

  const create = useMutation({
    mutationFn: createBackup,
    onSuccess: (r) => {
      showToast(`${translate("backupCreated")}: ${r.backup.file} (${mb(r.backup.size)})`, "success");
      void qc.invalidateQueries({ queryKey: ["admin-backups"] });
    },
    onError: (e: unknown) => {
      const a = e as { response?: { data?: { message?: string } }; message?: string };
      showToast(a?.response?.data?.message || a?.message || translate("serverError"), "error");
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
          <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
            <span>💾 {create.isPending ? translate("backupRunning") : translate("backupCreate")}</span>
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
