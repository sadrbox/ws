/**
 * DocumentNumberSettings — настройка нумерации документов: префикс и количество
 * цифр в номере по каждому виду документа. Серверные настройки
 * (GET/PUT/DELETE /document-number-settings). organizationUuid → настройки
 * конкретной организации (иначе — значения по умолчанию для всех).
 */
import { FC, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { showToast } from "src/components/UIToast";
import { Field, FieldNumber } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import LookupField from "src/components/Field/LookupField";
import { Button } from "src/components/Button";
import styles from "./DocumentNumberSettings.module.scss";

interface Row {
  docType: string;
  label: string;
  defaultPrefix: string;
  prefix: string;
  padding: number;
  enabled: boolean;
  isOverridden: boolean;
}

interface Props {
  /** Настройки префиксов конкретной организации (иначе — общие по умолчанию). */
  organizationUuid?: string;
  /** Встроенный режим (внутри формы организации) — без крупного заголовка. */
  embedded?: boolean;
}

const QKEY = (org?: string) => ["document-number-settings", org ?? "__global__"];

const DocumentNumberSettings: FC<Props> = ({ organizationUuid, embedded }) => {
  const qc = useQueryClient();

  // В самостоятельном экране можно выбрать организацию (пусто = значения по
  // умолчанию для всех). Во встроенном режиме организация задана пропом.
  const [selOrgUuid, setSelOrgUuid] = useState("");
  const [selOrgName, setSelOrgName] = useState("");
  const orgKey = embedded ? organizationUuid : (selOrgUuid || undefined);

  const { data, isLoading, isError, refetch } = useQuery<Row[]>({
    queryKey: QKEY(orgKey),
    queryFn: async () =>
      (await api.get<any>("document-number-settings", {
        params: orgKey ? { organizationUuid: orgKey } : undefined,
      }))?.items ?? [],
    retry: 1,
  });
  const rows = data ?? [];

  type EditVal = { prefix: string; padding: number; enabled: boolean };
  const [edits, setEdits] = useState<Record<string, EditVal>>({});
  const [busy, setBusy] = useState(false);

  // enabled может отсутствовать у старого бэкенда → по умолчанию true
  // (иначе FieldToggle получает undefined → uncontrolled→controlled warning).
  const valOf = (r: Row): EditVal => edits[r.docType] ?? { prefix: r.prefix, padding: r.padding, enabled: r.enabled ?? true };
  const patch = (r: Row, p: Partial<EditVal>) =>
    setEdits((prev) => ({ ...prev, [r.docType]: { ...valOf(r), ...p } }));
  const dirty = Object.keys(edits).length > 0;

  const example = (v: EditVal) => {
    if (!v.enabled) return "—";
    // Префикс опционален: без него номер — только дополненный нулями счётчик.
    const seq = String(1).padStart(Math.min(9, Math.max(1, v.padding || 6)), "0");
    const pfx = v.prefix.trim();
    return pfx ? `${pfx}-${seq}` : seq;
  };

  const save = async () => {
    setBusy(true);
    try {
      for (const [docType, v] of Object.entries(edits)) {
        // Префикс необязателен — пустой допустим (номер без префикса).
        await api.put(`document-number-settings/${docType}`, { prefix: v.prefix.trim(), padding: v.padding, enabled: v.enabled, organizationUuid: orgKey });
      }
      showToast(translate("saved"), "success");
      setEdits({});
      qc.invalidateQueries({ queryKey: QKEY(orgKey) });
    } catch (e: any) {
      // Явная ошибка сохранения (в т.ч. если бэкенд не обновлён / без миграций).
      showToast(e?.response?.data?.message || translate("numberingSaveError"), "error", 7000);
    } finally {
      setBusy(false);
    }
  };

  const reset = async (docType: string) => {
    setBusy(true);
    try {
      await api.delete(`document-number-settings/${docType}`, {
        params: orgKey ? { organizationUuid: orgKey } : undefined,
      });
      setEdits((prev) => { const n = { ...prev }; delete n[docType]; return n; });
      qc.invalidateQueries({ queryKey: QKEY(orgKey) });
      showToast(translate("resetDone"), "success");
    } catch {
      /* noop */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>

      {!embedded && (
        <div className={styles.OrgPicker}>
          <LookupField label={translate("organization")} name="dns_org" value={selOrgUuid} displayValue={selOrgName}
            endpoint="organizations" displayField="name"
            placeholder={translate("numberingDefaultsForAll")}
            onSelect={(u, d) => { setSelOrgUuid(u); setSelOrgName(d); setEdits({}); }}
            onClear={() => { setSelOrgUuid(""); setSelOrgName(""); setEdits({}); }} />
        </div>
      )}

      <div className={styles.Intro}>
        {orgKey ? translate("numberingHintOrg") : translate("numberingHintGlobal")}
      </div>
      <div className={styles.Intro}>{translate("numberingUniqueNote")}</div>

      {isLoading ? (
        <div className={styles.Loading}>{translate("loading")}</div>
      ) : isError || rows.length === 0 ? (
        <div className={styles.ErrorBox}>
          <span>{translate("numberingLoadError")}</span>
          <Button variant="secondary" onClick={() => refetch()}>{translate("retry")}</Button>
        </div>
      ) : (
        <div className={styles.TableScroll}>
        <table className={styles.Table}>
          <thead>
            <tr>
              <th className={styles.cOn}>{translate("numberingEnabled")}</th>
              <th>{translate("documentType")}</th>
              <th className={styles.cPrefix}>{translate("prefix")}</th>
              <th className={styles.cPad}>{translate("digitsCount")}</th>
              <th className={styles.cExample}>{translate("exampleNumber")}</th>
              <th className={styles.cSource}>{translate("source")}</th>
              <th className={styles.cReset}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = valOf(r);
              const edited = !!edits[r.docType];
              const off = !v.enabled;
              return (
                <tr key={r.docType} className={[edited && styles.RowEdited, off && styles.RowOff].filter(Boolean).join(" ") || undefined}>
                  <td className={styles.cOn}>
                    <FieldToggle name={`on_${r.docType}`} value={v.enabled} onChange={(val) => patch(r, { enabled: val })} disabled={busy} />
                  </td>
                  <td className={styles.cLabel}>{r.label}</td>
                  <td className={styles.cPrefix}>
                    <Field name={`pfx_${r.docType}`} value={v.prefix} onChange={(e) => patch(r, { prefix: e.target.value })} width="110px" disabled={off} placeholder={r.defaultPrefix || translate("optional")} />
                  </td>
                  <td className={styles.cPad}>
                    <FieldNumber name={`pad_${r.docType}`} value={String(v.padding)} onChange={(e) => patch(r, { padding: Math.min(9, Math.max(1, Number(e.target.value) || 6)) })} width="60px" disabled={off} />
                  </td>
                  <td className={styles.cExample}><code>{example(v)}</code></td>
                  <td className={styles.cSource}>
                    {r.isOverridden
                      ? <span className={styles.BadgeOwn}>{orgKey ? translate("sourceOrg") : translate("sourceSet")}</span>
                      : <span className={styles.BadgeDefault}>{translate("sourceDefault")}</span>}
                  </td>
                  <td className={styles.cReset}>
                    {r.isOverridden && (
                      <button type="button" className={styles.ResetBtn} disabled={busy}
                        title={translate("resetToDefault")} onClick={() => reset(r.docType)}>↺</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      <div className={styles.Footer}>
        <Button variant="primary" onClick={save} disabled={!dirty || busy}>
          {busy ? translate("loading") : translate("saveNumbering")}
        </Button>
        {dirty && <span className={styles.UnsavedNote}>{translate("unsavedChanges")}</span>}
      </div>
    </div>
  );
};

DocumentNumberSettings.displayName = "DocumentNumberSettings";
export { DocumentNumberSettings };
export default DocumentNumberSettings;
