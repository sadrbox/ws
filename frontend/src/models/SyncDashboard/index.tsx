/**
 * SyncDashboard — модель «Синхронизация и оффлайн-данные».
 *
 * Вкладки:
 *  1. Статус    — текущее состояние подключения, последняя синхронизация, прогресс
 *  2. Очередь   — pending changes, ожидающие push на сервер
 *  3. Конфликты — записи с конфликтами, требующие ручного разрешения
 *  4. Хранилище — статистика по таблицам, очистка
 */

import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useOfflineSync, type OfflineStats } from "src/hooks/useOfflineSync";
import { type SyncConflict } from "src/services/syncManager";
import { resolveConflictLocal, resolveConflictServer } from "src/services/networkStatus";
import { clearOfflineDb, type PendingChange } from "src/services/offlineDb";
import { Button } from "src/components/Button";
import styles from "src/styles/main.module.scss";

// ═══════════════════════════════════════════════════════════════════════════
// Tabs
// ═══════════════════════════════════════════════════════════════════════════

type Tab = "status" | "queue" | "conflicts" | "storage";

const TAB_LABELS: Record<Tab, string> = {
  status: "Статус",
  queue: "Очередь",
  conflicts: "Конфликты",
  storage: "Хранилище",
};

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", {
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

const ACTION_LABELS: Record<string, string> = {
  create: "Создание",
  update: "Изменение",
  delete: "Удаление",
};

const TABLE_LABELS: Record<string, string> = {
  organizations: "Организации",
  counterparties: "Контрагенты",
  contracts: "Договора",
  contacts: "Контакты",
  contacttypes: "Типы контактов",
  contactpersons: "Контактные лица",
  bankaccounts: "Банковские счета",
  users: "Пользователи",
  todos: "Задачи",
  notifications: "Уведомления",
  warehouses: "Склады",
  sales: "Реализация",
  purchases: "Поступления",
  "outgoing-invoices": "СФ исходящие",
  "incoming-invoices": "СФ входящие",
  "payment-invoices": "Счета на оплату",
  "scheduled-tasks": "Регламентные задачи",
  "inventory-transfers": "Перемещение ТМЗ",
  "cash-receipt-orders": "ПКО",
  "cash-expense-orders": "РКО",
  brands: "Бренды",
  products: "Номенклатура",
  saleitems: "Позиции реализации",
  employees: "Сотрудники",
  positions: "Должности",
  "employee-histories": "Кадровая история",
  "access-rights": "Права доступа",
  currencies: "Валюты",
  "payroll-calculations": "Начисление ЗП",
  "payroll-payments": "Выплата ЗП",
};

function getTableLabel(table: string): string {
  return TABLE_LABELS[table] ?? table;
}

// ═══════════════════════════════════════════════════════════════════════════
// Status Tab
// ═══════════════════════════════════════════════════════════════════════════

const StatusTab: FC<{
  isOnline: boolean;
  isSyncing: boolean;
  syncState: ReturnType<typeof useOfflineSync>["syncState"];
  pendingCount: number;
  syncNow: () => Promise<void>;
  abortSync: () => void;
}> = ({ isOnline, isSyncing, syncState, pendingCount, syncNow, abortSync }) => {
  return (
    <div className={styles.SyncDashSection}>
      {/* Статус подключения */}
      <div className={styles.SyncDashCard}>
        <div className={styles.SyncDashCardTitle}>Подключение</div>
        <div className={styles.SyncDashCardBody}>
          <div className={styles.SyncDashRow}>
            <span className={styles.SyncDashLabel}>Статус:</span>
            <span className={isOnline ? styles.SyncDashOnline : styles.SyncDashOffline}>
              {isOnline ? "🟢 Онлайн" : "🔴 Оффлайн"}
            </span>
          </div>
          <div className={styles.SyncDashRow}>
            <span className={styles.SyncDashLabel}>Синхронизация:</span>
            <span>{isSyncing ? "⏳ Выполняется…" : "Простой"}</span>
          </div>
          {syncState.status !== "idle" && syncState.status !== "done" && (
            <div className={styles.SyncDashRow}>
              <span className={styles.SyncDashLabel}>Этап:</span>
              <span>{syncState.message || syncState.status}</span>
            </div>
          )}
          {syncState.progress != null && syncState.progress > 0 && isSyncing && (
            <div className={styles.SyncDashProgress}>
              <div className={styles.SyncDashProgressBar} style={{ width: `${Math.min(100, syncState.progress)}%` }} />
              <span>{Math.round(syncState.progress)}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Последняя синхронизация */}
      <div className={styles.SyncDashCard}>
        <div className={styles.SyncDashCardTitle}>Последняя синхронизация</div>
        <div className={styles.SyncDashCardBody}>
          <div className={styles.SyncDashRow}>
            <span className={styles.SyncDashLabel}>Время:</span>
            <span>{formatDate(syncState.lastSyncAt)}</span>
          </div>
          {syncState.lastResult && (
            <>
              <div className={styles.SyncDashRow}>
                <span className={styles.SyncDashLabel}>Получено:</span>
                <span>{syncState.lastResult.pulled} записей</span>
              </div>
              <div className={styles.SyncDashRow}>
                <span className={styles.SyncDashLabel}>Отправлено:</span>
                <span>{syncState.lastResult.pushed} записей</span>
              </div>
              <div className={styles.SyncDashRow}>
                <span className={styles.SyncDashLabel}>Конфликтов:</span>
                <span>{syncState.lastResult.conflicts.length}</span>
              </div>
              <div className={styles.SyncDashRow}>
                <span className={styles.SyncDashLabel}>Ошибок:</span>
                <span>{syncState.lastResult.errors.length}</span>
              </div>
              <div className={styles.SyncDashRow}>
                <span className={styles.SyncDashLabel}>Длительность:</span>
                <span>{syncState.lastResult.durationMs}мс</span>
              </div>
              <div className={styles.SyncDashRow}>
                <span className={styles.SyncDashLabel}>Результат:</span>
                <span>{syncState.lastResult.success ? "✅ Успешно" : "❌ С ошибками"}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Действия */}
      <div className={styles.SyncDashCard}>
        <div className={styles.SyncDashCardTitle}>Действия</div>
        <div className={styles.SyncDashCardBody}>
          <div className={styles.SyncDashRow}>
            <span className={styles.SyncDashLabel}>В очереди:</span>
            <span>{pendingCount} изменений</span>
          </div>
          <div className={styles.SyncDashActions}>
            {isSyncing ? (
              <Button onClick={abortSync}>
                <span>⏹ Остановить</span>
              </Button>
            ) : (
              <Button variant="primary" onClick={syncNow} disabled={!isOnline}>
                <span>🔄 Синхронизировать сейчас</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Queue Tab
// ═══════════════════════════════════════════════════════════════════════════

const QueueTab: FC<{
  pendingChanges: PendingChange[];
  pendingCount: number;
  removePending: (id: number) => Promise<void>;
  clearAllPending: () => Promise<void>;
  syncNow: () => Promise<void>;
  isSyncing: boolean;
  isOnline: boolean;
}> = ({ pendingChanges, pendingCount, removePending, clearAllPending, syncNow, isSyncing, isOnline }) => {
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClearAll = useCallback(async () => {
    await clearAllPending();
    setConfirmClear(false);
  }, [clearAllPending]);

  return (
    <div className={styles.SyncDashSection}>
      <div className={styles.SyncDashCard}>
        <div className={styles.SyncDashCardTitle}>
          Очередь отложенных изменений ({pendingCount})
        </div>
        <div className={styles.SyncDashActions} style={{ marginBottom: 8 }}>
          <Button variant="primary" onClick={syncNow} disabled={isSyncing || !isOnline || pendingCount === 0}>
            <span>{isSyncing ? "⏳ Синхронизация…" : "🔄 Отправить все"}</span>
          </Button>
          {pendingCount > 0 && !confirmClear && (
            <Button onClick={() => setConfirmClear(true)}>
              <span>🗑 Очистить всё</span>
            </Button>
          )}
          {confirmClear && (
            <>
              <span style={{ color: "#e53935", fontSize: 13 }}>Удалить все неотправленные изменения?</span>
              <Button onClick={handleClearAll}>
                <span>Да, удалить</span>
              </Button>
              <Button onClick={() => setConfirmClear(false)}>
                <span>Отмена</span>
              </Button>
            </>
          )}
        </div>
        <div className={styles.SyncDashCardBody}>
          {pendingChanges.length === 0 ? (
            <div className={styles.SyncDashEmpty}>
              Очередь пуста — все данные синхронизированы ✅
            </div>
          ) : (
            <div className={styles.SyncDashQueue}>
              {pendingChanges.map((change) => (
                <div key={change.id} className={styles.SyncDashQueueItem}>
                  <div className={styles.SyncDashQueueIcon}>
                    {change.action === "create" ? "🆕" : change.action === "update" ? "✏️" : "🗑"}
                  </div>
                  <div className={styles.SyncDashQueueBody}>
                    <div className={styles.SyncDashQueueLabel}>
                      {ACTION_LABELS[change.action] || change.action}: {getTableLabel(change.table)}
                    </div>
                    <div className={styles.SyncDashQueueMeta}>
                      UUID: {change.uuid?.slice(0, 12)}… · {formatDate(change.createdAt)}
                    </div>
                  </div>
                  <div className={styles.SyncDashQueueActions}>
                    <Button onClick={() => change.id != null && removePending(change.id)}>
                      <span>✕</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Conflicts Tab
// ═══════════════════════════════════════════════════════════════════════════

const ConflictsTab: FC<{
  conflicts: SyncConflict[];
}> = ({ conflicts }) => {
  const [processing, setProcessing] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});

  const handleKeepLocal = useCallback(async (conflict: SyncConflict) => {
    const key = `${conflict.table}-${conflict.uuid}`;
    setProcessing(key);
    const ok = await resolveConflictLocal(conflict);
    setProcessing(null);
    setResult(prev => ({
      ...prev,
      [key]: ok ? "✅ Локальная версия отправлена" : "❌ Ошибка",
    }));
  }, []);

  const handleKeepServer = useCallback(async (conflict: SyncConflict) => {
    const key = `${conflict.table}-${conflict.uuid}`;
    setProcessing(key);
    await resolveConflictServer(conflict);
    setProcessing(null);
    setResult(prev => ({
      ...prev,
      [key]: "✅ Серверная версия принята",
    }));
  }, []);

  return (
    <div className={styles.SyncDashSection}>
      <div className={styles.SyncDashCard}>
        <div className={styles.SyncDashCardTitle}>
          Конфликты ({conflicts.length})
        </div>
        <div className={styles.SyncDashCardBody}>
          {conflicts.length === 0 ? (
            <div className={styles.SyncDashEmpty}>
              Конфликтов нет ✅
            </div>
          ) : (
            conflicts.map((conflict) => {
              const key = `${conflict.table}-${conflict.uuid}`;
              const isProc = processing === key;
              return (
                <div key={key} className={styles.SyncDashConflict}>
                  <div className={styles.SyncDashConflictHeader}>
                    ⚠️ {getTableLabel(conflict.table)} — {conflict.uuid.slice(0, 12)}…
                  </div>
                  <div className={styles.SyncDashConflictDiff}>
                    <div className={styles.SyncDashConflictCol}>
                      <div className={styles.SyncDashConflictColTitle}>Локальные данные</div>
                      <pre className={styles.SyncDashConflictPre}>
                        {JSON.stringify(conflict.clientData, null, 2)}
                      </pre>
                    </div>
                    <div className={styles.SyncDashConflictCol}>
                      <div className={styles.SyncDashConflictColTitle}>Серверные данные</div>
                      <pre className={styles.SyncDashConflictPre}>
                        {JSON.stringify(conflict.serverData, null, 2)}
                      </pre>
                    </div>
                  </div>
                  {result[key] && (
                    <div style={{ padding: "4px 0", fontSize: 13 }}>{result[key]}</div>
                  )}
                  <div className={styles.SyncDashActions}>
                    <Button variant="primary" onClick={() => handleKeepLocal(conflict)} disabled={isProc}>
                      <span>Принять локальную</span>
                    </Button>
                    <Button onClick={() => handleKeepServer(conflict)} disabled={isProc}>
                      <span>Принять серверную</span>
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Storage Tab
// ═══════════════════════════════════════════════════════════════════════════

const StorageTab: FC<{
  offlineStats: OfflineStats | null;
  refreshStats: () => Promise<void>;
}> = ({ offlineStats, refreshStats }) => {
  const [confirmClear, setConfirmClear] = useState(false);
  const [dbSize, setDbSize] = useState<number | null>(null);

  // Оценка размера IndexedDB
  useEffect(() => {
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then(est => {
        setDbSize(est.usage ?? null);
      }).catch(() => {});
    }
  }, [offlineStats]);

  const handleClearAll = useCallback(async () => {
    await clearOfflineDb();
    setConfirmClear(false);
    await refreshStats();
  }, [refreshStats]);

  const sortedTables = useMemo(() => {
    if (!offlineStats) return [];
    return Object.entries(offlineStats.tables)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a);
  }, [offlineStats]);

  return (
    <div className={styles.SyncDashSection}>
      <div className={styles.SyncDashCard}>
        <div className={styles.SyncDashCardTitle}>Локальное хранилище</div>
        <div className={styles.SyncDashCardBody}>
          <div className={styles.SyncDashRow}>
            <span className={styles.SyncDashLabel}>Общий размер:</span>
            <span>{dbSize != null ? formatBytes(dbSize) : "—"}</span>
          </div>
          <div className={styles.SyncDashRow}>
            <span className={styles.SyncDashLabel}>Всего записей:</span>
            <span>{offlineStats?.totalRecords ?? "—"}</span>
          </div>
          <div className={styles.SyncDashRow}>
            <span className={styles.SyncDashLabel}>Ожидают отправки:</span>
            <span>{offlineStats?.pendingChanges ?? "—"}</span>
          </div>
          <div className={styles.SyncDashActions}>
            <Button onClick={refreshStats}>
              <span>🔄 Обновить</span>
            </Button>
            {!confirmClear ? (
              <Button onClick={() => setConfirmClear(true)}>
                <span>🗑 Очистить всё хранилище</span>
              </Button>
            ) : (
              <>
                <span style={{ color: "#e53935", fontSize: 13 }}>
                  Все локальные данные будут удалены и загружены заново при следующей синхронизации.
                </span>
                <Button onClick={handleClearAll}>
                  <span>Да, очистить</span>
                </Button>
                <Button onClick={() => setConfirmClear(false)}>
                  <span>Отмена</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Таблицы */}
      <div className={styles.SyncDashCard}>
        <div className={styles.SyncDashCardTitle}>Записи по таблицам</div>
        <div className={styles.SyncDashCardBody}>
          {sortedTables.length === 0 ? (
            <div className={styles.SyncDashEmpty}>Локальное хранилище пустое</div>
          ) : (
            <div className={styles.SyncDashStorageTable}>
              <div className={styles.SyncDashStorageHeader}>
                <span>Таблица</span>
                <span>Записей</span>
              </div>
              {sortedTables.map(([table, count]) => (
                <div key={table} className={styles.SyncDashStorageRow}>
                  <span>{getTableLabel(table)}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

const SyncDashboard: FC = () => {
  const {
    isOnline,
    isSyncing,
    pendingChanges,
    pendingCount,
    syncState,
    conflicts,
    syncNow,
    abortSync,
    removePending,
    clearAllPending,
    offlineStats,
    refreshStats,
  } = useOfflineSync();

  const [activeTab, setActiveTab] = useState<Tab>("status");

  return (
    <div className={styles.SyncDashboard}>
      {/* Tabs */}
      <div className={styles.SyncDashTabs}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => {
          let badge = 0;
          if (tab === "queue") badge = pendingCount;
          if (tab === "conflicts") badge = conflicts.length;
          return (
            <button
              key={tab}
              className={[
                styles.SyncDashTab,
                activeTab === tab && styles.SyncDashTabActive,
              ].filter(Boolean).join(" ")}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
              {badge > 0 && (
                <span className={styles.SyncDashBadge}>{badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className={styles.SyncDashContent}>
        {activeTab === "status" && (
          <StatusTab
            isOnline={isOnline}
            isSyncing={isSyncing}
            syncState={syncState}
            pendingCount={pendingCount}
            syncNow={syncNow}
            abortSync={abortSync}
          />
        )}
        {activeTab === "queue" && (
          <QueueTab
            pendingChanges={pendingChanges}
            pendingCount={pendingCount}
            removePending={removePending}
            clearAllPending={clearAllPending}
            syncNow={syncNow}
            isSyncing={isSyncing}
            isOnline={isOnline}
          />
        )}
        {activeTab === "conflicts" && (
          <ConflictsTab conflicts={conflicts} />
        )}
        {activeTab === "storage" && (
          <StorageTab
            offlineStats={offlineStats}
            refreshStats={refreshStats}
          />
        )}
      </div>
    </div>
  );
};

SyncDashboard.displayName = "SyncDashboard";
export { SyncDashboard, SyncDashboard as SyncDashboardList };
