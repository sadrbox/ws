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
import { Button } from "src/components/Button";
import styles from "./DocumentNumberSettings.module.scss";

interface Row {
  docType: string;
  label: string;
  defaultPrefix: string;
  prefix: string;
  padding: number;
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
  const { data, isLoading, isError, refetch } = useQuery<Row[]>({
    queryKey: QKEY(organizationUuid),
    queryFn: async () =>
      (await api.get<any>("document-number-settings", {
        params: organizationUuid ? { organizationUuid } : undefined,
      }))?.items ?? [],
    retry: 1,
  });
  const rows = data ?? [];

  const [edits, setEdits] = useState<Record<string, { prefix: string; padding: number }>>({});
  const [busy, setBusy] = useState(false);

  const valOf = (r: Row) => edits[r.docType] ?? { prefix: r.prefix, padding: r.padding };
  const patch = (r: Row, p: Partial<{ prefix: string; padding: number }>) =>
    setEdits((prev) => ({ ...prev, [r.docType]: { ...valOf(r), ...p } }));
  const dirty = Object.keys(edits).length > 0;

  const example = (prefix: string, padding: number) =>
    `${prefix || "?"}-${String(1).padStart(Math.min(12, Math.max(1, padding || 6)), "0")}`;

  const save = async () => {
    setBusy(true);
    try {
      for (const [docType, v] of Object.entries(edits)) {
        if (!v.prefix.trim()) { showToast(translate("prefixRequired"), "error"); setBusy(false); return; }
        await api.put(`document-number-settings/${docType}`, { prefix: v.prefix.trim(), padding: v.padding, organizationUuid });
      }
      showToast(translate("saved"), "success");
      setEdits({});
      qc.invalidateQueries({ queryKey: QKEY(organizationUuid) });
    } catch {
      /* тост ошибки — перехватчик api */
    } finally {
      setBusy(false);
    }
  };

  const reset = async (docType: string) => {
    setBusy(true);
    try {
      await api.delete(`document-number-settings/${docType}`, {
        params: organizationUuid ? { organizationUuid } : undefined,
      });
      setEdits((prev) => { const n = { ...prev }; delete n[docType]; return n; });
      qc.invalidateQueries({ queryKey: QKEY(organizationUuid) });
      showToast(translate("resetDone"), "success");
    } catch {
      /* noop */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? styles.WrapEmbedded : styles.Wrap}>
      {!embedded && <h2 className={styles.Title}>{translate("documentNumberingSettings")}</h2>}

      <div className={styles.Intro}>
        {organizationUuid ? translate("numberingHintOrg") : translate("numberingHintGlobal")}
      </div>

      {isLoading ? (
        <div className={styles.Loading}>{translate("loading")}</div>
      ) : isError || rows.length === 0 ? (
        <div className={styles.ErrorBox}>
          <span>{translate("numberingLoadError")}</span>
          <Button variant="secondary" onClick={() => refetch()}>{translate("retry")}</Button>
        </div>
      ) : (
        <table className={styles.Table}>
          <thead>
            <tr>
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
              return (
                <tr key={r.docType} className={edited ? styles.RowEdited : undefined}>
                  <td className={styles.cLabel}>{r.label}</td>
                  <td className={styles.cPrefix}>
                    <Field name={`pfx_${r.docType}`} value={v.prefix} onChange={(e) => patch(r, { prefix: e.target.value })} width="110px" />
                  </td>
                  <td className={styles.cPad}>
                    <FieldNumber name={`pad_${r.docType}`} value={String(v.padding)} onChange={(e) => patch(r, { padding: Math.min(12, Math.max(1, Number(e.target.value) || 6)) })} width="60px" />
                  </td>
                  <td className={styles.cExample}><code>{example(v.prefix, v.padding)}</code></td>
                  <td className={styles.cSource}>
                    {r.isOverridden
                      ? <span className={styles.BadgeOwn}>{organizationUuid ? translate("sourceOrg") : translate("sourceSet")}</span>
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
