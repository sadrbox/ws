/**
 * OfflineIndicator — индикатор состояния сети + badge с количеством pending.
 *
 * Размещается в Navbar. При клике открывает журнал синхронизации.
 * Состояния:
 *  - 🟢 Online — всё ок (показывается только если есть pending)
 *  - 🔴 Offline — нет связи
 *  - 🟠 Syncing — идёт синхронизация
 */

import { FC, useCallback } from "react";
import { useNetworkStatus } from "src/hooks/useOfflineSync";
import { useAppContext } from "src/app/context";
import OfflineSyncJournal from "src/components/OfflineSyncJournal";
import styles from "./OfflineIndicator.module.scss";

const OfflineIndicator: FC = () => {
  const { isOnline, badgeCount, isSyncing } = useNetworkStatus();
  const { windows: { addPane } } = useAppContext();

  const openJournal = useCallback(() => {
    addPane({
      component: OfflineSyncJournal,
      label: "Журнал синхронизации",
    });
  }, [addPane]);

  // Определяем состояние
  const statusClass = isSyncing
    ? styles.SyncingStatus
    : isOnline
      ? styles.OnlineStatus
      : styles.OfflineStatus;

  const statusLabel = isSyncing
    ? "Синхронизация…"
    : isOnline
      ? (badgeCount > 0 ? "Ожидают отправки" : "")
      : "Нет связи";

  // Не показываем, если online и нет pending
  if (isOnline && !isSyncing && badgeCount === 0) {
    return null;
  }

  return (
    <div
      className={[styles.OfflineIndicator, statusClass].filter(Boolean).join(" ")}
      onClick={openJournal}
      title={`${statusLabel}${badgeCount > 0 ? ` (${badgeCount})` : ""} — нажмите для открытия журнала`}
      role="button"
      tabIndex={0}
    >
      <span className={[styles.OfflineDot, isSyncing && styles.OfflineDotPulse].filter(Boolean).join(" ")} />
      {!isOnline && <span>Offline</span>}
      {isSyncing && <span>Sync…</span>}
      {badgeCount > 0 && (
        <span className={styles.OfflineBadge}>{badgeCount}</span>
      )}
    </div>
  );
};

OfflineIndicator.displayName = "OfflineIndicator";
export default OfflineIndicator;
