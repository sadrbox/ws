// ModuleSettings — включение/отключение функциональных модулей на организацию (E11).
// Суперадмин выбирает организацию и галочками включает/выключает модули. Выключенные
// модули пропадают из меню (NavList) и их документы нельзя создать (серверный гард
// moduleGuardMiddleware → 403 MODULE_DISABLED). Хранилище — AppSetting, без миграции.
//
// UX: по умолчанию открывается на АКТИВНОЙ организации пользователя — чтобы правки
// сразу были видны в его меню. Скрытие в меню завязано на активную орг (OrgSwitcher);
// для другой орг эффект увидят её пользователи, а не текущий (см. пояснение в форме).
import { FC, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupCol } from "src/components/UI";
import { Button } from "src/components/Button";
import { showToast } from "src/components/UIToast";
import { MODULES } from "src/config/modules";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import styles from "src/styles/main.module.scss";

interface Props { uniqId?: string;[key: string]: unknown }

const ModuleSettings: FC<Props> = () => {
  const qc = useQueryClient();
  const def = useDefaultOrganization();
  const [orgUuid, setOrgUuid] = useState(def.organizationUuid || "");
  const [orgName, setOrgName] = useState(def.organizationName || "");
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Подхватить активную орг, когда она подгрузится (первый рендер мог быть без неё).
  useEffect(() => {
    if (!orgUuid && def.organizationUuid) {
      setOrgUuid(def.organizationUuid);
      setOrgName(def.organizationName || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.organizationUuid]);

  const isOwnActiveOrg = orgUuid !== "" && orgUuid === def.organizationUuid;

  // Загрузка текущих настроек выбранной организации.
  useQuery({
    queryKey: ["module-settings-edit", orgUuid],
    queryFn: async () => {
      const resp = await api.get<{ disabled?: string[] }>("module-settings", { params: { organizationUuid: orgUuid } });
      setDisabled(new Set(resp?.disabled ?? []));
      return resp?.disabled ?? [];
    },
    enabled: !!orgUuid,
  });

  const toggle = (key: string) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    if (!orgUuid) { showToast(translate("moduleSelectOrgFirst"), "error"); return; }
    setSaving(true);
    try {
      await api.put("module-settings", { organizationUuid: orgUuid, disabled: [...disabled] });
      showToast(translate("saved"), "success");
      // Обновить меню (useDisabledModules) и все связанные запросы.
      await qc.invalidateQueries({ queryKey: ["module-settings"] });
    } catch {
      showToast(translate("serverError"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.FormWrapper}>
      <div className={styles.Form}>
        <GroupCol>
          {/* Что это и зачем */}
          <div className={styles.NavHint} style={{ maxWidth: 640, lineHeight: 1.5 }}>
            {translate("moduleSettingsIntro")}
          </div>

          <Group>
            <LookupField
              label={translate("organization")} name="module_org"
              value={orgUuid} displayValue={orgName}
              endpoint="organizations" displayField="name"
              onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }}
              onClear={() => { setOrgUuid(""); setOrgName(""); setDisabled(new Set()); }}
            />
          </Group>

          {orgUuid && (
            <GroupCol>
              {/* Граница действия: своё меню обновится сразу только для активной орг */}
              <div className={styles.NavHint} style={{ maxWidth: 640, lineHeight: 1.5, opacity: 0.85 }}>
                {isOwnActiveOrg ? translate("moduleScopeOwn") : translate("moduleScopeOther")}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 2, margin: "6px 0" }}>
                {MODULES.map((m) => {
                  const on = !disabled.has(m.key);
                  return (
                    <label key={m.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", cursor: "pointer", borderRadius: 4, background: on ? "transparent" : "var(--sv-attentionBg, #fde2e4)" }}>
                      <input type="checkbox" checked={on} onChange={() => toggle(m.key)} />
                      <span style={{ fontWeight: 500, minWidth: 160 }}>{translate(m.labelKey)}</span>
                      <span style={{ fontSize: "0.85em", opacity: 0.7 }}>
                        {on ? translate("moduleOn") : translate("moduleOff")}
                      </span>
                    </label>
                  );
                })}
              </div>

              <Group>
                <Button variant="primary" onClick={handleSave} disabled={saving}>{translate("save")}</Button>
              </Group>
            </GroupCol>
          )}
        </GroupCol>
      </div>
    </div>
  );
};

ModuleSettings.displayName = "ModuleSettings";
export { ModuleSettings };
export default ModuleSettings;
