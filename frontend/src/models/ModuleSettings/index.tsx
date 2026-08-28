// ModuleSettings — включение/отключение функциональных модулей на организацию (E11).
// Суперадмин выбирает организацию и галочками включает/выключает модули. Выключенные
// модули пропадают из меню (NavList) и их документы нельзя создать (серверный гард
// moduleGuardMiddleware → 403 MODULE_DISABLED). Хранилище — AppSetting, без миграции.
import { FC, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupCol } from "src/components/UI";
import { Button } from "src/components/Button";
import { showToast } from "src/components/UIToast";
import { MODULES } from "src/config/modules";
import styles from "src/styles/main.module.scss";

interface Props { uniqId?: string;[key: string]: unknown }

const ModuleSettings: FC<Props> = () => {
  const qc = useQueryClient();
  const [orgUuid, setOrgUuid] = useState("");
  const [orgName, setOrgName] = useState("");
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

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
      // Обновить меню и хук доступности модулей.
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
              <div className={styles.NavHint}>{translate("moduleSettingsHint")}</div>
              {MODULES.map((m) => (
                <label key={m.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer" }}>
                  <input type="checkbox" checked={!disabled.has(m.key)} onChange={() => toggle(m.key)} />
                  <span>{translate(m.labelKey)}</span>
                </label>
              ))}
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
