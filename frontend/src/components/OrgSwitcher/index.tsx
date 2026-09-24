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
import { createPortal } from "react-dom";
import { useAppContext } from "src/app/context";
import { switchOrganization, type OrgEntry } from "src/services/auth";
import { getOrgScope, setOrgScope, type OrgScope } from "src/services/orgScope";
import { translate } from "src/i18";
import styles from "./OrgSwitcher.module.scss";

const ROLE_LABEL_KEYS: Record<string, string> = {
  admin: "roleAdmin",
  member: "roleMember",
};

const OrgSwitcher: FC = () => {
  const { auth } = useAppContext();
  const user = auth.user;
  const [open, setOpen] = useState(false);
  /*
   * СВОДНЫЙ ВИД ПО ГРУППЕ (Г2 плана PLAN_INSTALL_MODES_2026-09-24.md).
   *
   * Раньше «все мои организации» показывались лишь тогда, когда активной не было вовсе:
   * сводка получалась из отсутствия выбора, и объяснить это было нечем. Теперь её просят
   * явно — и видно, в каком режиме человек смотрит.
   *
   * Запись в сводном режиме сервер отклоняет (`SCOPE_READ_ONLY`): документ принадлежит
   * конкретному юрлицу, и «создать в группе» — ошибка, которую находят при сверке.
   */
  const [scope, setScope] = useState<OrgScope>(getOrgScope());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Координаты для портала (dropdown рендерится в body, чтобы не обрезался
  // навбаром с overflow: clip).
  const [pos, setPos] = useState<{ top: number; right: number; minWidth: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // accessRights — членства пользователя в организациях (бывш. userPermissions).
  // Фоллбэк на старое имя поля — на случай устаревшего кэша пользователя в
  // localStorage (до повторного входа / обновления /auth/me после переименования).
  const orgs: OrgEntry[] =
    user?.accessRights ?? (user as { userPermissions?: OrgEntry[] } | null)?.userPermissions ?? [];

  // Пересчёт позиции портала под кнопкой (правый край совмещён с кнопкой).
  useEffect(() => {
    if (!open) { setPos(null); return; }
    const update = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right), minWidth: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  // Закрытие по клику вне компонента (учитываем и портал dropdown)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapperRef.current?.contains(t) && !menuRef.current?.contains(t)) {
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
          setError(result.message || translate("switchOrganizationError"));
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

  // Сводка осмысленна только когда организаций больше одной.
  const canGroup = orgs.length > 1;
  const applyScope = (next: OrgScope) => {
    setOrgScope(next);
    setScope(next);
    setOpen(false);
    // Перечитывать всё открытое по одному — долго и ненадёжно: область данных меняется
    // целиком, и проще начать с чистого экрана.
    window.location.reload();
  };

  const activeOrg = orgs.find((o) => o.organizationUuid === user.organizationUuid);
  const activeLabel =
    activeOrg?.organization?.name ||
    activeOrg?.organization?.legalName ||
    (user.organizationUuid ? translate("organization") : translate("noOrganization"));

  return (
    <div className={styles.OrgSwitcher} ref={wrapperRef}>
      <button
        ref={btnRef}
        className={styles.OrgButton}
        onClick={() => { setOpen((p) => !p); setError(null); }}
        disabled={loading}
        title={translate("switchOrganization")}
        type="button"
      >
        <span className={styles.OrgIcon}>{scope === "group" ? "🏢🏢" : "🏢"}</span>
        <span className={styles.OrgName}>
          {loading ? "…" : scope === "group" ? translate("orgScopeGroup") : activeLabel}
        </span>
        <span className={styles.OrgChevron}>{open ? "▴" : "▾"}</span>
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          className={styles.OrgDropdown}
          style={{ position: "fixed", top: pos.top, right: pos.right, minWidth: pos.minWidth }}
        >
          <div className={styles.OrgDropdownHeader}>{translate("organization")}</div>

          {orgs.map((o) => {
            const isActive = o.organizationUuid === user.organizationUuid;
            const name =
              o.organization?.name ||
              o.organization?.legalName ||
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
                <span className={styles.OrgItemRole}>{translate(ROLE_LABEL_KEYS[o.role] ?? o.role)}</span>
                {isActive && <span className={styles.OrgActiveCheck}>✓</span>}
              </button>
            );
          })}

          {canGroup && (
            <>
              <div className={styles.OrgDropdownHeader}>{translate("orgScopeTitle")}</div>
              <button
                className={[styles.OrgDropdownItem, scope === "group" ? styles.Active : ""].filter(Boolean).join(" ")}
                onClick={() => applyScope(scope === "group" ? "organization" : "group")}
                disabled={loading}
                type="button"
                title={translate("orgScopeHint")}
              >
                <span className={styles.OrgItemName}>{translate("orgScopeGroup")}</span>
                {scope === "group" && <span className={styles.OrgActiveCheck}>✓</span>}
              </button>
            </>
          )}

          {error && <div className={styles.OrgError}>{error}</div>}
        </div>,
        document.body,
      )}
    </div>
  );
};

OrgSwitcher.displayName = "OrgSwitcher";
export default OrgSwitcher;
