/**
 * OrgSwitcher — выпадающее меню для переключения активной организации без перелогина.
 *
 * Показывает:
 * - Текущую активную организацию (или «Без организации»)
 * - Список всех организаций пользователя
 * - Роль в каждой организации (admin / member)
 *
 * При выборе отправляет PATCH /auth/switch-org и обновляет контекст.
 */
import { FC, useCallback, useEffect, useRef, useState } from "react";
import { useAppContext } from "src/app/context";
import { switchOrganization, type OrgEntry } from "src/services/auth";
import styles from "./OrgSwitcher.module.scss";

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  member: "Сотрудник",
};

const OrgSwitcher: FC = () => {
  const { auth } = useAppContext();
  const user = auth.user;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const orgs: OrgEntry[] = user?.userOrganizations ?? [];

  // Закрытие по клику вне компонента
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setError(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSwitch = useCallback(
    async (orgUuid: string | null) => {
      if (orgUuid === user?.organizationUuid) {
        setOpen(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await switchOrganization(orgUuid);
        if (!result.success) {
          setError(result.message || "Ошибка переключения");
        } else {
          setOpen(false);
        }
      } finally {
        setLoading(false);
      }
    },
    [user?.organizationUuid],
  );

  // Нет организаций — не рендерим компонент (после всех хуков)
  if (!user || orgs.length === 0) return null;

  const activeOrg = orgs.find((o) => o.organizationUuid === user.organizationUuid);
  const activeLabel =
    activeOrg?.organization?.shortName ||
    activeOrg?.organization?.displayName ||
    (user.organizationUuid ? "Организация" : "Без организации");

  return (
    <div className={styles.OrgSwitcher} ref={dropdownRef}>
      <button
        className={styles.OrgButton}
        onClick={() => { setOpen((p) => !p); setError(null); }}
        disabled={loading}
        title="Переключить организацию"
        type="button"
      >
        <span className={styles.OrgIcon}>🏢</span>
        <span className={styles.OrgName}>{loading ? "…" : activeLabel}</span>
        <span className={styles.OrgChevron}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className={styles.OrgDropdown}>
          <div className={styles.OrgDropdownHeader}>Организация</div>

          {orgs.map((o) => {
            const isActive = o.organizationUuid === user.organizationUuid;
            const name =
              o.organization?.shortName ||
              o.organization?.displayName ||
              o.organizationUuid;
            return (
              <button
                key={o.organizationUuid}
                className={[
                  styles.OrgDropdownItem,
                  isActive ? styles.Active : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => handleSwitch(o.organizationUuid)}
                disabled={loading || isActive}
                type="button"
              >
                <span className={styles.OrgItemName}>{name}</span>
                <span className={styles.OrgItemRole}>
                  {ROLE_LABELS[o.role] ?? o.role}
                </span>
                {isActive && <span className={styles.OrgActiveCheck}>✓</span>}
              </button>
            );
          })}

          {error && <div className={styles.OrgError}>{error}</div>}
        </div>
      )}
    </div>
  );
};

OrgSwitcher.displayName = "OrgSwitcher";
export default OrgSwitcher;
