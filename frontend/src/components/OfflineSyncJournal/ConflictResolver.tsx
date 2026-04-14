/**
 * ConflictResolver — компонент для разрешения конфликтов синхронизации.
 *
 * Показывает diff-view: локальные данные (payload) vs серверные данные (serverData).
 * Действия:
 *  - «Принять локальную» — повторить запрос с force-overwrite
 *  - «Принять серверную» — отбросить локальные изменения
 *  - «Назад» — вернуться в журнал
 */

import { FC, useCallback, useMemo, useState } from "react";
import { Button } from "src/components/Button";
import type { QueueEntry } from "src/services/offlineQueue";
import {
  resolveConflictLocal,
  resolveConflictServer,
} from "src/services/networkStatus";
import styles from "src/styles/main.module.scss";

interface ConflictResolverProps {
  entry: QueueEntry;
  onClose: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// DIFF HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Собирает все уникальные ключи из двух объектов */
function allKeys(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined): string[] {
  const set = new Set<string>();
  if (a) Object.keys(a).forEach(k => set.add(k));
  if (b) Object.keys(b).forEach(k => set.add(k));
  // Фильтруем служебные поля
  const skip = new Set(["id", "uuid", "createdAt", "updatedAt", "deletedAt"]);
  return [...set].filter(k => !skip.has(k)).sort();
}

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

const ConflictResolver: FC<ConflictResolverProps> = ({ entry, onClose }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const localData = entry.payload;
  const serverData = entry.serverData;

  const keys = useMemo(() => allKeys(localData, serverData), [localData, serverData]);

  const handleAcceptLocal = useCallback(async () => {
    if (entry.id == null) return;
    setIsProcessing(true);
    setResult(null);
    const ok = await resolveConflictLocal(entry.id);
    setIsProcessing(false);
    if (ok) {
      setResult("✅ Локальные данные отправлены на сервер");
      setTimeout(onClose, 1000);
    } else {
      setResult("❌ Не удалось отправить. Попробуйте позже.");
    }
  }, [entry.id, onClose]);

  const handleAcceptServer = useCallback(async () => {
    if (entry.id == null) return;
    setIsProcessing(true);
    await resolveConflictServer(entry.id);
    setIsProcessing(false);
    setResult("✅ Серверная версия принята, локальные изменения отброшены");
    setTimeout(onClose, 800);
  }, [entry.id, onClose]);

  return (
    <div className={styles.ConflictResolver}>
      {/* Header */}
      <div className={styles.ConflictHeader}>
        ⚠️ Конфликт: {entry.label}
      </div>
      <div className={styles.ConflictDescription}>
        Данные были изменены на сервере, пока вы работали оффлайн.
        Выберите, какую версию сохранить.
        {entry.lastError && (
          <div style={{ color: "#e53935", marginTop: 4, fontSize: 12 }}>{entry.lastError}</div>
        )}
      </div>

      {/* Diff columns */}
      <div className={styles.ConflictColumns}>
        {/* Local */}
        <div className={styles.ConflictColumn}>
          <div className={styles.ConflictColumnTitle}>🖥️ Ваши изменения (локально)</div>
          {localData ? (
            keys.map(key => {
              const localVal = formatValue((localData as any)[key]);
              const serverVal = serverData ? formatValue((serverData as any)[key]) : "—";
              const isDiff = localVal !== serverVal;
              return (
                <div key={key} className={styles.ConflictRow}>
                  <span className={styles.ConflictKey}>{key}</span>
                  <span className={[styles.ConflictValue, isDiff && styles.ConflictDiff].filter(Boolean).join(" ")}>
                    {localVal}
                  </span>
                </div>
              );
            })
          ) : (
            <div style={{ fontSize: 12, color: "#999" }}>Нет данных</div>
          )}
        </div>

        {/* Server */}
        <div className={styles.ConflictColumn}>
          <div className={styles.ConflictColumnTitle}>☁️ Серверная версия</div>
          {serverData ? (
            keys.map(key => {
              const localVal = localData ? formatValue((localData as any)[key]) : "—";
              const serverVal = formatValue((serverData as any)[key]);
              const isDiff = localVal !== serverVal;
              return (
                <div key={key} className={styles.ConflictRow}>
                  <span className={styles.ConflictKey}>{key}</span>
                  <span className={[styles.ConflictValue, isDiff && styles.ConflictDiff].filter(Boolean).join(" ")}>
                    {serverVal}
                  </span>
                </div>
              );
            })
          ) : (
            <div style={{ fontSize: 12, color: "#999" }}>Не удалось загрузить серверную версию</div>
          )}
        </div>
      </div>

      {/* Result message */}
      {result && (
        <div style={{ fontSize: 13, padding: "8px 12px", borderRadius: 4, background: "#f5f5f5" }}>
          {result}
        </div>
      )}

      {/* Actions */}
      <div className={styles.ConflictActions}>
        <Button onClick={onClose} disabled={isProcessing}>
          <span>← Назад</span>
        </Button>
        <Button onClick={handleAcceptServer} disabled={isProcessing}>
          <span>Принять серверную</span>
        </Button>
        <Button variant="primary" onClick={handleAcceptLocal} disabled={isProcessing}>
          <span>Принять локальную</span>
        </Button>
      </div>
    </div>
  );
};

ConflictResolver.displayName = "ConflictResolver";
export default ConflictResolver;
