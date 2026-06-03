/**
 * DocumentNumberSettings — экран «Настройки → Нумерация документов».
 * Редактирование префикса и разрядности номера по каждому виду документа.
 * Серверные настройки (GET/PUT /document-number-settings).
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

const DocumentNumberSettings: FC = () => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Row[]>({
    queryKey: ["document-number-settings"],
    queryFn: async () => (await api.get<any>("document-number-settings"))?.items ?? [],
  });
  const rows = data ?? [];

  const [edits, setEdits] = useState<Record<string, { prefix: string; padding: number }>>({});
  const [saving, setSaving] = useState(false);

  const valOf = (r: Row) => edits[r.docType] ?? { prefix: r.prefix, padding: r.padding };
  const patch = (r: Row, p: Partial<{ prefix: string; padding: number }>) =>
    setEdits((prev) => ({ ...prev, [r.docType]: { ...valOf(r), ...p } }));

  const dirty = Object.keys(edits).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      for (const [docType, v] of Object.entries(edits)) {
        if (!v.prefix.trim()) { showToast(translate("prefixRequired"), "error"); setSaving(false); return; }
        await api.put(`document-number-settings/${docType}`, { prefix: v.prefix.trim(), padding: v.padding });
      }
      showToast(translate("saved"), "success");
      setEdits({});
      qc.invalidateQueries({ queryKey: ["document-number-settings"] });
    } catch {
      /* тост ошибки — перехватчик api */
    } finally {
      setSaving(false);
    }
  };

  const example = (prefix: string, padding: number) => `${prefix}-${String(1).padStart(padding, "0")}`;

  return (
    <div className={styles.Wrap}>
      <div className={styles.Header}>
        <h2 className={styles.Title}>{translate("documentNumberingSettings")}</h2>
        <Button variant="primary" onClick={save} disabled={!dirty || saving}>
          {saving ? translate("loading") : translate("save")}
        </Button>
      </div>
      <p className={styles.Hint}>{translate("documentNumberingHint")}</p>

      {isLoading ? (
        <div className={styles.Loading}>{translate("loading")}</div>
      ) : (
        <table className={styles.Table}>
          <thead>
            <tr>
              <th>{translate("documentType")}</th>
              <th className={styles.cPrefix}>{translate("prefix")}</th>
              <th className={styles.cPad}>{translate("digits")}</th>
              <th className={styles.cExample}>{translate("example")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = valOf(r);
              return (
                <tr key={r.docType}>
                  <td className={styles.cLabel}>{r.label}</td>
                  <td className={styles.cPrefix}>
                    <Field name={`pfx_${r.docType}`} value={v.prefix} onChange={(e) => patch(r, { prefix: e.target.value })} width="120px" />
                  </td>
                  <td className={styles.cPad}>
                    <FieldNumber name={`pad_${r.docType}`} value={String(v.padding)} onChange={(e) => patch(r, { padding: Math.min(12, Math.max(1, Number(e.target.value) || 6)) })} width="64px" />
                  </td>
                  <td className={styles.cExample}><code>{example(v.prefix, v.padding)}</code></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

DocumentNumberSettings.displayName = "DocumentNumberSettings";
export { DocumentNumberSettings };
export default DocumentNumberSettings;
