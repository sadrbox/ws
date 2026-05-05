/**
 * SyncDashboard — панель «Синхронизация и оффлайн-данные».
 *
 * Выполнена в стиле стандартных форм приложения (FormWrapper → Tabs).
 *
 * Вкладки:
 *  1. Основное    — «приборная панель» с понятным состоянием + переключатель режима
 *  2. Очередь     — неотправленные изменения
 *  3. Конфликты   — записи, требующие вашего решения
 *  4. Хранилище   — управление локальными данными
 */

import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useOfflineSync, type OfflineStats } from "src/hooks/useOfflineSync";
import { type SyncConflict } from "src/services/syncManager";
import { pullSingleTable, fullSync } from "src/services/syncManager";
import { resolveConflictLocal, resolveConflictServer } from "src/services/networkStatus";
import { clearOfflineDb, SYNCABLE_TABLES, type SyncableTable, type PendingChange } from "src/services/offlineDb";
import { usePersistenceMode, type PersistenceMode } from "src/services/persistenceMode";
import { Button } from "src/components/Button";
import { Divider } from "src/components/Field";
import { Group } from "src/components/UI";
import { usePaneToolbar } from "src/hooks/usePaneToolbar";
import Tabs from "src/components/Tabs";
import styles from "src/styles/main.module.scss";
import type { TPane } from "src/app/types";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return iso; }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "Никогда";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "Только что";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин. назад`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч. назад`;
  return formatDate(iso);
}

function pluralChanges(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "изменений";
  if (last > 1 && last < 5) return "изменения";
  if (last === 1) return "изменение";
  return "изменений";
}

const ACTION_LABELS: Record<string, string> = {
  create: "Создание", update: "Изменение", delete: "Удаление",
};

const TABLE_LABELS: Record<string, string> = {
  organizations: "Организации", counterparties: "Контрагенты",
  contracts: "Договора", contacts: "Контакты",
  contacttypes: "Типы контактов", contactpersons: "Контактные лица",
  bankaccounts: "Банковские счета", users: "Пользователи",
  todos: "Задачи", notifications: "Уведомления",
  warehouses: "Склады", sales: "Реализация",
  purchases: "Поступления", "outgoing-invoices": "СФ исходящие",
  "incoming-invoices": "СФ входящие", "payment-invoices": "Счета на оплату",
  "scheduled-tasks": "Регламентные задачи", "inventory-transfers": "Перемещение ТМЗ",
  "cash-receipt-orders": "ПКО", "cash-expense-orders": "РКО",
  brands: "Бренды", products: "Номенклатура",
  saleitems: "Позиции реализации", employees: "Сотрудники",
  positions: "Должности", "employee-histories": "Кадровая история",
  "access-rights": "Права доступа", currencies: "Валюты",
  "payroll-calculations": "Начисление ЗП", "payroll-payments": "Выплата ЗП",
};

function getTableLabel(t: string): string { return TABLE_LABELS[t] ?? t; }

// ═══════════════════════════════════════════════════════════════════════════
// StatusBanner — крупный визуальный индикатор «здоровья» данных
// ═══════════════════════════════════════════════════════════════════════════

const StatusBanner: FC<{
  isOnline: boolean; isSyncing: boolean; pendingCount: number; mode: PersistenceMode;
}> = ({ isOnline, isSyncing, pendingCount, mode }) => {
  let severity: "ok" | "warn" | "error" | "syncing" = "ok";
  let icon = "✅";
  let title = "Всё синхронизировано";
  let subtitle = "Данные актуальны. Все изменения сохранены на сервере.";

  if (isSyncing) {
    severity = "syncing"; icon = "🔄";
    title = "Идёт синхронизация…";
    subtitle = "Данные отправляются на сервер и загружаются обратно.";
  } else if (!isOnline && pendingCount > 0) {
    severity = "error"; icon = "📴";
    title = "Нет связи с сервером";
    subtitle = `${pendingCount} ${pluralChanges(pendingCount)} ожидают отправки. Будут отправлены автоматически.`;
  } else if (!isOnline) {
    severity = "warn"; icon = "📴";
    title = "Работа без подключения";
    subtitle = "Вы можете просматривать и редактировать данные. Изменения сохранятся локально.";
  } else if (pendingCount > 0) {
    severity = "warn"; icon = "⏳";
    title = "Есть неотправленные изменения";
    subtitle = `${pendingCount} ${pluralChanges(pendingCount)} готовы к отправке.`;
  }

  const modeText = mode === "offline-first"
    ? "⚡ Офлайн-доступ — данные хранятся на устройстве и синхронизируются"
    : "🔗 Только сервер — данные загружаются по запросу";

  return (
    <div className={[styles.SyncBanner, styles[`SyncBanner_${severity}`]].join(" ")}>
      <div className={styles.SyncBannerIcon}>{icon}</div>
      <div className={styles.SyncBannerBody}>
        <div className={styles.SyncBannerTitle}>{title}</div>
        <div className={styles.SyncBannerSub}>{subtitle}</div>
        <div className={styles.SyncBannerMode}>{modeText}</div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Tab: Основное
// ═══════════════════════════════════════════════════════════════════════════

const MainTab: FC<{
  isOnline: boolean; isSyncing: boolean;
  syncState: ReturnType<typeof useOfflineSync>["syncState"];
  pendingCount: number; offlineStats: OfflineStats | null;
  syncNow: () => Promise<void>; abortSync: () => void;
  mode: PersistenceMode; setMode: (m: PersistenceMode) => void;
}> = ({ isOnline, isSyncing, syncState, pendingCount, offlineStats, syncNow, abortSync, mode, setMode }) => (
  <div className={styles.FormBodyParts}>
    <StatusBanner isOnline={isOnline} isSyncing={isSyncing} pendingCount={pendingCount} mode={mode} />

    {/* Прогресс */}
    {isSyncing && syncState.progress != null && syncState.progress > 0 && (
      <div className={styles.SyncProgressWrap}>
        <div className={styles.SyncProgressTrack}>
          <div className={styles.SyncProgressFill} style={{ width: `${Math.min(100, syncState.progress)}%` }} />
        </div>
        <span className={styles.SyncProgressLabel}>{syncState.message || `${Math.round(syncState.progress)}%`}</span>
      </div>
    )}

    {/* Режим работы */}
    <Group align="col" label="Режим работы с данными" className={styles.Form}>
      <div className={styles.SyncModeRow}>
        <button
          type="button"
          className={[styles.SyncModeCard, mode === "offline-first" && styles.SyncModeCard_on].filter(Boolean).join(" ")}
          onClick={() => setMode("offline-first")}
        >
          <span className={styles.SyncModeCardIcon}>⚡</span>
          <span className={styles.SyncModeCardTitle}>Офлайн-доступ</span>
          <span className={styles.SyncModeCardDesc}>
            Данные хранятся на устройстве и синхронизируются с сервером. Можно работать без интернета.
          </span>
        </button>
        <button
          type="button"
          className={[styles.SyncModeCard, mode === "transactional" && styles.SyncModeCard_on].filter(Boolean).join(" ")}
          onClick={() => setMode("transactional")}
        >
          <span className={styles.SyncModeCardIcon}>🔗</span>
          <span className={styles.SyncModeCardTitle}>Только сервер</span>
          <span className={styles.SyncModeCardDesc}>
            Все данные загружаются с сервера при каждом обращении. Без интернета работа невозможна.
          </span>
        </button>
      </div>
    </Group>

    <Divider />

    {/* Метрики */}
    <Group align="row" gap="12px" className={styles.Form}>
      <div className={styles.SyncMetricGrid}>
        <MetricCell value={isOnline ? "🟢" : "🔴"} label={isOnline ? "Подключён" : "Нет связи"} />
        <MetricCell value={String(pendingCount)} label="Не отправлено" />
        <MetricCell value={String(offlineStats?.totalRecords ?? 0)} label="Записей на устройстве" />
        <MetricCell value={timeAgo(syncState.lastSyncAt)} label="Синхронизация" />
      </div>
    </Group>

    <Divider />

    {/* Действия */}
    <Group align="row" gap="8px" className={styles.Form}>
      {isSyncing ? (
        <Button onClick={abortSync}><span>⏹ Остановить</span></Button>
      ) : (
        <Button variant="primary" onClick={syncNow} disabled={!isOnline}>
          <span>🔄 Синхронизировать сейчас</span>
        </Button>
      )}
      {!isOnline && <span className={styles.SyncHint}>Запустится автоматически при появлении связи</span>}
    </Group>

    {/* Последний результат */}
    {syncState.lastResult && (
      <>
        <Divider />
        <Group align="col" label="Результат последней синхронизации" className={styles.Form}>
          <div className={styles.SyncResultGrid}>
            <span>Статус</span><span>{syncState.lastResult.success ? "✅ Успешно" : "❌ С ошибками"}</span>
            <span>Загружено</span><span>{syncState.lastResult.pulled} записей</span>
            <span>Отправлено</span><span>{syncState.lastResult.pushed} записей</span>
            {syncState.lastResult.conflicts.length > 0 && (
              <><span>Конфликтов</span><span style={{ color: "#e65100" }}>{syncState.lastResult.conflicts.length}</span></>
            )}
            {syncState.lastResult.errors.length > 0 && (
              <><span>Ошибок</span><span style={{ color: "#e53935" }}>{syncState.lastResult.errors.length}</span></>
            )}
            <span>Длительность</span><span>{(syncState.lastResult.durationMs / 1000).toFixed(1)} сек.</span>
          </div>
        </Group>
      </>
    )}
  </div>
);

const MetricCell: FC<{ value: string; label: string }> = ({ value, label }) => (
  <div className={styles.SyncMetric}>
    <div className={styles.SyncMetricValue}>{value}</div>
    <div className={styles.SyncMetricLabel}>{label}</div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// Tab: Очередь
// ═══════════════════════════════════════════════════════════════════════════

const QueueTab: FC<{
  pendingChanges: PendingChange[]; pendingCount: number;
  removePending: (id: number) => Promise<void>;
  clearAllPending: () => Promise<void>;
  syncNow: () => Promise<void>; isSyncing: boolean; isOnline: boolean;
}> = ({ pendingChanges, pendingCount, removePending, clearAllPending, syncNow, isSyncing, isOnline }) => {
  const [confirmClear, setConfirmClear] = useState(false);
  const handleClearAll = useCallback(async () => { await clearAllPending(); setConfirmClear(false); }, [clearAllPending]);

  if (pendingCount === 0) {
    return (
      <div className={styles.FormBodyParts}>
        <EmptyState icon="✅" title="Все данные отправлены" desc="Нет неотправленных изменений. Всё синхронизировано." />
      </div>
    );
  }

  return (
    <div className={styles.FormBodyParts}>
      <div className={styles.SyncInfoBox}>
        Изменения, сделанные вами, которые ещё не отправлены на сервер.
        {isOnline ? " Нажмите «Отправить все»." : " Будут отправлены при появлении связи."}
      </div>

      <Group align="row" gap="8px" className={styles.Form}>
        <Button variant="primary" onClick={syncNow} disabled={isSyncing || !isOnline}>
          <span>{isSyncing ? "⏳ Отправка…" : `🔄 Отправить все (${pendingCount})`}</span>
        </Button>
        {!confirmClear ? (
          <Button onClick={() => setConfirmClear(true)}><span>🗑 Очистить очередь</span></Button>
        ) : (
          <>
            <span style={{ color: "#e53935", fontSize: 13 }}>Удалить все? Данные будут потеряны.</span>
            <Button onClick={handleClearAll}><span>Да</span></Button>
            <Button onClick={() => setConfirmClear(false)}><span>Отмена</span></Button>
          </>
        )}
      </Group>

      <Divider />

      <div className={styles.SyncQueueList}>
        {pendingChanges.map((c) => (
          <div key={c.id} className={styles.SyncQueueItem}>
            <div className={styles.SyncQueueItemIcon}>
              {c.action === "create" ? "🆕" : c.action === "update" ? "✏️" : "🗑️"}
            </div>
            <div className={styles.SyncQueueItemBody}>
              <div className={styles.SyncQueueItemTitle}>
                {ACTION_LABELS[c.action] ?? c.action}: {getTableLabel(c.table)}
              </div>
              <div className={styles.SyncQueueItemMeta}>
                {timeAgo(c.createdAt)} · {c.uuid?.slice(0, 8)}…
              </div>
            </div>
            <button className={styles.SyncQueueItemDel} onClick={() => c.id != null && removePending(c.id)} title="Удалить">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Tab: Конфликты
// ═══════════════════════════════════════════════════════════════════════════

const ConflictsTab: FC<{ conflicts: SyncConflict[] }> = ({ conflicts }) => {
  const [processing, setProcessing] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});

  const handleKeepLocal = useCallback(async (c: SyncConflict) => {
    const k = `${c.table}-${c.uuid}`; setProcessing(k);
    const ok = await resolveConflictLocal(c); setProcessing(null);
    setResult(p => ({ ...p, [k]: ok ? "✅ Ваша версия отправлена" : "❌ Ошибка" }));
  }, []);

  const handleKeepServer = useCallback(async (c: SyncConflict) => {
    const k = `${c.table}-${c.uuid}`; setProcessing(k);
    await resolveConflictServer(c); setProcessing(null);
    setResult(p => ({ ...p, [k]: "✅ Принята серверная версия" }));
  }, []);

  if (conflicts.length === 0) {
    return (
      <div className={styles.FormBodyParts}>
        <EmptyState icon="✅" title="Конфликтов нет" desc="Все данные согласованы между устройством и сервером." />
      </div>
    );
  }

  return (
    <div className={styles.FormBodyParts}>
      <div className={styles.SyncInfoBox}>
        Конфликт — одна и та же запись изменена и на устройстве, и на сервере. Выберите, какую версию оставить.
      </div>
      {conflicts.map((c) => {
        const k = `${c.table}-${c.uuid}`;
        return (
          <div key={k} className={styles.SyncConflictCard}>
            <div className={styles.SyncConflictHeader}>⚠️ {getTableLabel(c.table)} — {c.uuid.slice(0, 12)}…</div>
            <div className={styles.SyncConflictCols}>
              <div className={styles.SyncConflictCol}>
                <div className={styles.SyncConflictColHead}>Ваша версия</div>
                <pre className={styles.SyncConflictPre}>{JSON.stringify(c.clientData, null, 2)}</pre>
              </div>
              <div className={styles.SyncConflictCol}>
                <div className={styles.SyncConflictColHead}>Серверная версия</div>
                <pre className={styles.SyncConflictPre}>{JSON.stringify(c.serverData, null, 2)}</pre>
              </div>
            </div>
            {result[k] && <div style={{ padding: "6px 0", fontSize: 13 }}>{result[k]}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Button variant="primary" onClick={() => handleKeepLocal(c)} disabled={processing === k}>
                <span>Оставить мою</span>
              </Button>
              <Button onClick={() => handleKeepServer(c)} disabled={processing === k}>
                <span>Принять серверную</span>
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Tab: Хранилище
// ═══════════════════════════════════════════════════════════════════════════

const StorageTab: FC<{
  offlineStats: OfflineStats | null;
  refreshStats: () => Promise<void>;
  isOnline: boolean;
}> = ({ offlineStats, refreshStats, isOnline }) => {
  const [confirmClear, setConfirmClear] = useState(false);
  const [dbSize, setDbSize] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [dlMsg, setDlMsg] = useState("");
  const [clearing, setClearing] = useState<string | null>(null);

  useEffect(() => {
    navigator.storage?.estimate?.().then(e => setDbSize(e.usage ?? null)).catch(() => { });
  }, [offlineStats]);

  const handleClearAll = useCallback(async () => {
    await clearOfflineDb(); setConfirmClear(false); await refreshStats();
  }, [refreshStats]);

  const allTables = useMemo(() => {
    const c = offlineStats?.tables ?? {};
    return [...SYNCABLE_TABLES].map(t => ({ table: t, label: getTableLabel(t), count: c[t] ?? 0 }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [offlineStats]);

  const withData = useMemo(() => allTables.filter(t => t.count > 0), [allTables]);

  const toggle = useCallback((t: string) => {
    setSelected(p => { const n = new Set(p); if (n.has(t)) { n.delete(t); } else { n.add(t); } return n; });
  }, []);

  const handleDlSelected = useCallback(async () => {
    if (!selected.size) return;
    setDownloading(true);
    const arr = [...selected] as SyncableTable[];
    let done = 0, tot = 0;
    for (const t of arr) {
      setDlMsg(`${getTableLabel(t)} (${++done}/${arr.length})…`);
      try { tot += await pullSingleTable(t); } catch { /* next */ }
    }
    setDlMsg(`Готово: ${tot} записей из ${arr.length} таблиц`);
    setDownloading(false); await refreshStats();
    setTimeout(() => setDlMsg(""), 5000);
  }, [selected, refreshStats]);

  const handleDlAll = useCallback(async () => {
    setDownloading(true); setDlMsg("Полная загрузка…");
    try { const r = await fullSync(); setDlMsg(`Готово: загружено ${r.pulled}, отправлено ${r.pushed}`); }
    catch { setDlMsg("Ошибка загрузки"); }
    setDownloading(false); await refreshStats();
    setTimeout(() => setDlMsg(""), 5000);
  }, [refreshStats]);

  const handleClearTable = useCallback(async (t: string) => {
    setClearing(t);
    try { const { offlineDb: db } = await import("src/services/offlineDb"); const tbl = db.getTable(t); if (tbl) await tbl.clear(); } catch { /* */ }
    setClearing(null); await refreshStats();
  }, [refreshStats]);

  return (
    <div className={styles.FormBodyParts}>
      {/* Обзор */}
      <Group align="row" gap="12px" className={styles.Form}>
        <div className={styles.SyncMetricGrid}>
          <MetricCell value={dbSize != null ? formatBytes(dbSize) : "—"} label="Размер" />
          <MetricCell value={String(offlineStats?.totalRecords ?? 0)} label="Записей" />
          <MetricCell value={String(withData.length)} label="Таблиц" />
          <MetricCell value={String(offlineStats?.pendingChanges ?? 0)} label="Ожидают" />
        </div>
      </Group>

      <Divider />

      {/* Действия */}
      <Group align="row" gap="8px" className={styles.Form}>
        <Button onClick={refreshStats}><span>🔄 Обновить</span></Button>
        <Button variant="primary" onClick={handleDlAll} disabled={downloading || !isOnline}>
          <span>{downloading ? "⏳ …" : "📥 Загрузить всё для офлайна"}</span>
        </Button>
        {!confirmClear ? (
          <Button onClick={() => setConfirmClear(true)}><span>🗑 Очистить хранилище</span></Button>
        ) : (
          <>
            <span style={{ color: "#e53935", fontSize: 13 }}>Удалить все локальные данные?</span>
            <Button onClick={handleClearAll}><span>Да</span></Button>
            <Button onClick={() => setConfirmClear(false)}><span>Отмена</span></Button>
          </>
        )}
      </Group>
      {dlMsg && <div className={styles.SyncInfoBox}>{dlMsg}</div>}

      <Divider />

      {/* Выборочная загрузка */}
      <Group align="col" label="Подготовить данные для работы без интернета" className={styles.Form}>
        <div className={styles.SyncInfoBox} style={{ marginBottom: 8 }}>
          Выберите справочники, которые нужны офлайн, и нажмите «Загрузить».
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <Button onClick={() => setSelected(new Set(SYNCABLE_TABLES))} disabled={downloading}><span>☑ Все</span></Button>
          <Button onClick={() => setSelected(new Set())} disabled={downloading || !selected.size}><span>☐ Сброс</span></Button>
          <Button variant="primary" onClick={handleDlSelected} disabled={downloading || !selected.size || !isOnline}>
            <span>{downloading ? "⏳" : `📥 Загрузить (${selected.size})`}</span>
          </Button>
        </div>
        <div className={styles.SyncStorageTable}>
          <div className={styles.SyncStorageHead}>
            <span style={{ width: 28 }} />
            <span style={{ flex: 1 }}>Справочник</span>
            <span style={{ width: 70, textAlign: "right" }}>Записей</span>
            <span style={{ width: 40 }} />
          </div>
          {allTables.map(({ table, label, count }) => (
            <div key={table} className={styles.SyncStorageRow} onClick={() => !downloading && toggle(table)}>
              <span style={{ width: 28, textAlign: "center" }}>
                <input type="checkbox" checked={selected.has(table)} onChange={() => toggle(table)} disabled={downloading} />
              </span>
              <span style={{ flex: 1 }}>{label}</span>
              <span style={{ width: 70, textAlign: "right", color: count ? "#333" : "#bbb" }}>{count || "—"}</span>
              <span style={{ width: 40, textAlign: "center" }}>
                {count > 0 && (
                  <button
                    className={styles.SyncInlineBtn}
                    title="Очистить"
                    disabled={clearing === table}
                    onClick={e => { e.stopPropagation(); void handleClearTable(table); }}
                  >🗑</button>
                )}
              </span>
            </div>
          ))}
        </div>
      </Group>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Shared: Empty state
// ═══════════════════════════════════════════════════════════════════════════

const EmptyState: FC<{ icon: string; title: string; desc: string }> = ({ icon, title, desc }) => (
  <div className={styles.SyncEmptyState}>
    <div className={styles.SyncEmptyIcon}>{icon}</div>
    <div className={styles.SyncEmptyTitle}>{title}</div>
    <div className={styles.SyncEmptyDesc}>{desc}</div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// Main — SyncDashboard (стиль формы: FormWrapper → Tabs)
// ═══════════════════════════════════════════════════════════════════════════

const SyncDashboard: FC<Partial<TPane>> = (paneProps) => {
  const {
    isOnline, isSyncing, pendingChanges, pendingCount,
    syncState, conflicts, syncNow, abortSync,
    removePending, clearAllPending, offlineStats, refreshStats,
  } = useOfflineSync();

  const [mode, setMode] = usePersistenceMode();

  const toolbarPortal = usePaneToolbar(
    paneProps.uniqId,
    <>
      {isSyncing
        ? <Button onClick={abortSync}><span>⏹ Остановить</span></Button>
        : <Button variant="primary" onClick={syncNow} disabled={!isOnline}><span>🔄 Синхронизировать</span></Button>}
    </>,
  );

  const tabs = useMemo(() => [
    {
      id: "main",
      label: `Основное${!isOnline ? " 🔴" : pendingCount > 0 ? ` ⏳${pendingCount}` : ""}`,
      component: (
        <MainTab
          isOnline={isOnline} isSyncing={isSyncing} syncState={syncState}
          pendingCount={pendingCount} offlineStats={offlineStats}
          syncNow={syncNow} abortSync={abortSync} mode={mode} setMode={setMode}
        />
      ),
    },
    {
      id: "queue",
      label: `Очередь${pendingCount > 0 ? ` (${pendingCount})` : ""}`,
      component: (
        <QueueTab
          pendingChanges={pendingChanges} pendingCount={pendingCount}
          removePending={removePending} clearAllPending={clearAllPending}
          syncNow={syncNow} isSyncing={isSyncing} isOnline={isOnline}
        />
      ),
    },
    {
      id: "conflicts",
      label: `Конфликты${conflicts.length > 0 ? ` (${conflicts.length})` : ""}`,
      component: <ConflictsTab conflicts={conflicts} />,
    },
    {
      id: "storage",
      label: "Хранилище",
      component: <StorageTab offlineStats={offlineStats} refreshStats={refreshStats} isOnline={isOnline} />,
    },
  ], [isOnline, isSyncing, syncState, pendingCount, pendingChanges, conflicts, offlineStats, syncNow, abortSync, removePending, clearAllPending, refreshStats, mode, setMode]);

  return (
    <div className={styles.FormWrapper}>
      {toolbarPortal}
      <div className={styles.FormBody}>
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
};

SyncDashboard.displayName = "SyncDashboard";
export { SyncDashboard, SyncDashboard as SyncDashboardList };
