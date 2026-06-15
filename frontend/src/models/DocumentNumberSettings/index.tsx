/**
 * DocumentNumberSettings — настройка нумерации документов: префикс и количество
 * цифр в номере по каждому виду документа. Серверные настройки
 * (GET/PUT/DELETE /document-number-settings). organizationUuid → настройки
 * конкретной организации (иначе — значения по умолчанию для всех).
 */
import { FC, useState, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { showToast } from "src/components/UIToast";
import { Field, FieldNumber } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Button } from "src/components/Button";
import SubTable from "src/components/SubTable";
import type { TColumn, TDataItem } from "src/components/Table/types";
import columnsJson from "./columns.json";
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
    // Префикс опционален: без него номер — только дополненный нулями счётчик.
    const seq = String(1).padStart(Math.min(9, Math.max(1, v.padding || 6)), "0");
    const pfx = v.prefix.trim();
    return pfx ? `${pfx}-${seq}` : seq;
  };

  // Строки для SubTable (клиентский режим): добавляем числовой id для ключей/выделения.
  const tableRows = useMemo<TDataItem[]>(
    () => rows.map((r, i) => ({ ...r, id: i + 1 } as unknown as TDataItem)),
    [rows],
  );
  // key пересевает SubTable при изменении серверных данных (после сохранения/сброса),
  // т.к. initialPendingRows мержатся однократно. Редактирование (edits) key не меняет.
  const tableKey = useMemo(
    () => `${orgKey ?? "global"}|${rows.map((r) => `${r.docType}:${r.prefix}:${r.padding}:${r.isOverridden ? 1 : 0}`).join(",")}`,
    [rows, orgKey],
  );

  // Кастомный рендер ячеек: контролы редактирования (живые значения из edits).
  const renderCell = (row: TDataItem, col: TColumn): ReactNode | undefined => {
    const r = row as unknown as Row;
    const v = valOf(r);
    switch (col.identifier) {
      case "documentType":
        return <span className={styles.cLabel}>{r.label}</span>;
      case "prefix":
        return <Field name={`pfx_${r.docType}`} value={v.prefix} onChange={(e) => patch(r, { prefix: e.target.value })} width="120px" placeholder={r.defaultPrefix || translate("optional")} />;
      case "digitsCount":
        return <FieldNumber name={`pad_${r.docType}`} value={String(v.padding)} onChange={(e) => patch(r, { padding: Math.min(9, Math.max(1, Number(e.target.value) || 6)) })} width="70px" />;
      case "exampleNumber":
        return <code>{example(v)}</code>;
      case "source":
        return r.isOverridden
          ? <span className={styles.BadgeOwn}>{orgKey ? translate("sourceOrg") : translate("sourceSet")}</span>
          : <span className={styles.BadgeDefault}>{translate("sourceDefault")}</span>;
      default:
        return undefined;
    }
  };

  // Замыкающая колонка действий: сброс переопределения к значению по умолчанию.
  const rowActions = (row: TDataItem): ReactNode => {
    const r = row as unknown as Row;
    return r.isOverridden
      ? <button type="button" className={styles.ResetBtn} disabled={busy} title={translate("resetToDefault")} onClick={() => reset(r.docType)}>↺</button>
      : null;
  };

  const save = async () => {
    setBusy(true);
    try {
      for (const [docType, v] of Object.entries(edits)) {
        // Префикс необязателен — пустой допустим (номер без префикса).
        await api.put(`document-number-settings/${docType}`, { prefix: v.prefix.trim(), padding: v.padding, enabled: true, organizationUuid: orgKey });
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
          <SubTable
            key={tableKey}
            model="document-number-settings"
            componentName="DocumentNumberSettingsList"
            columnsJson={columnsJson as TColumn[]}
            parentKey="docType"
            parentUuid=""
            deferRemoteChanges
            clientSort
            initialPendingRows={tableRows}
            readonly
            emptyMessage=""
            renderCell={renderCell}
            rowActions={rowActions}
          />
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
