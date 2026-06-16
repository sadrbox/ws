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
import SubTable, { type SubTableContext } from "src/components/SubTable";
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

  const [busy, setBusy] = useState(false);

  // Редактирование идёт через ВНУТРЕННЕЕ состояние SubTable (ctx.updateLocalRow),
  // как в TradeDocumentItemsTable — иначе внешний state ломает фокус ввода.
  // onAllItemsChange отдаёт актуальные строки сюда (для dirty-проверки и сохранения).
  const [currentRows, setCurrentRows] = useState<TDataItem[]>([]);
  const origByType = useMemo(() => new Map(rows.map((r) => [r.docType, r] as const)), [rows]);
  const changedRows = useMemo(
    () => currentRows.filter((cr) => {
      const o = origByType.get((cr as unknown as Row).docType);
      if (!o) return false;
      const c = cr as unknown as Row;
      return String(c.prefix ?? "") !== String(o.prefix ?? "")
        || Number(c.padding) !== Number(o.padding)
        || (c.enabled !== false) !== (o.enabled !== false);
    }),
    [currentRows, origByType],
  );
  const dirty = changedRows.length > 0;

  // Пример номера по префиксу/разрядности (1 → дополненный нулями счётчик).
  const example = (prefix: string, padding: number) => {
    const seq = String(1).padStart(Math.min(9, Math.max(1, padding || 6)), "0");
    const pfx = (prefix ?? "").trim();
    return pfx ? `${pfx}-${seq}` : seq;
  };

  // Строки для SubTable (клиентский режим): плоский список видов документов.
  // Все помечены как client-create (_pendingAction:"create") — иначе SubTable их
  // не покажет (mergeServerWithPending). Серверной выборки нет (parentUuid="").
  const tableRows = useMemo<TDataItem[]>(
    () => rows.map((r, i) => ({ ...r, id: i + 1, _pendingAction: "create" } as unknown as TDataItem)),
    [rows],
  );

  // Поиск в тулбаре SubTable — по названию вида документа (label).
  const filterRows = (rws: TDataItem[], q: string): TDataItem[] => {
    const s = q.trim().toLowerCase();
    if (!s) return rws;
    return rws.filter((row) => String((row as unknown as Row).label ?? "").toLowerCase().includes(s));
  };
  // key пересевает SubTable при изменении серверных данных (после сохранения/сброса),
  // т.к. initialPendingRows мержатся однократно. Редактирование (edits) key не меняет.
  const tableKey = useMemo(
    () => `${orgKey ?? "global"}|${rows.map((r) => `${r.docType}:${r.prefix}:${r.padding}:${r.enabled !== false ? 1 : 0}:${r.isOverridden ? 1 : 0}`).join(",")}`,
    [rows, orgKey],
  );

  // Кастомный рендер ячеек: контролы редактируют ВНУТРЕННЮЮ строку SubTable
  // (ctx.updateLocalRow) — как в TradeDocumentItemsTable, без потери фокуса.
  // variant="table" + label="" — ячейка как единый элемент (без form-field обёрток).
  const renderCell = (row: TDataItem, col: TColumn, ctx: SubTableContext): ReactNode | undefined => {
    const r = row as unknown as Row;
    const on = r.enabled !== false; // нумерация включена для этого вида
    switch (col.identifier) {
      case "numberingEnabled":
        // Чекбокс вкл/выкл нумерации. Выкл → документ без поля «Номер» (по ID).
        return <input type="checkbox" className={styles.EnabledCheck} checked={on} title={translate("numberingEnabled")} onChange={(e) => ctx.updateLocalRow(row, { enabled: e.target.checked })} />;
      case "documentType":
        return <span className={styles.cLabel}>{r.label}</span>;
      case "prefix":
        return <Field label="" variant="table" actions={[]} disabled={!on} name={`pfx_${r.docType}`} value={r.prefix ?? ""} onChange={(e) => ctx.updateLocalRow(row, { prefix: e.target.value })} placeholder={r.defaultPrefix || translate("optional")} />;
      case "digitsCount":
        return <FieldNumber label="" variant="table" disabled={!on} name={`pad_${r.docType}`} value={String(r.padding ?? 6)} onChange={(e) => ctx.updateLocalRow(row, { padding: Math.min(9, Math.max(1, Number(e.target.value) || 6)) })} />;
      case "exampleNumber":
        return on ? <code>{example(r.prefix, r.padding)}</code> : <span className={styles.cDisabledHint}>{translate("numberingOffUsesId")}</span>;
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
      for (const cr of changedRows) {
        const c = cr as unknown as Row;
        // Префикс необязателен — пустой допустим (номер без префикса).
        await api.put(`document-number-settings/${c.docType}`, { prefix: String(c.prefix ?? "").trim(), padding: c.padding, enabled: c.enabled !== false, organizationUuid: orgKey });
      }
      showToast(translate("saved"), "success");
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
      qc.invalidateQueries({ queryKey: QKEY(orgKey) });
      showToast(translate("resetDone"), "success");
    } catch {
      /* noop */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? undefined : styles.Root}>

      {!embedded && (
        <div className={styles.OrgPicker}>
          <LookupField label={translate("organization")} name="dns_org" value={selOrgUuid} displayValue={selOrgName}
            endpoint="organizations" displayField="name"
            placeholder={translate("numberingDefaultsForAll")}
            onSelect={(u, d) => { setSelOrgUuid(u); setSelOrgName(d); }}
            onClear={() => { setSelOrgUuid(""); setSelOrgName(""); }} />
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
        <div className={styles.TableArea}>
          <SubTable
            key={tableKey}
            model="document-number-settings"
            componentName="DocumentNumberSettingsList"
            columnsJson={columnsJson as TColumn[]}
            parentKey="docType"
            parentUuid=""
            deferRemoteChanges
            clientSort
            defaultSort={{ id: "asc" }}
            initialPendingRows={tableRows}
            defaultInlineEditing
            showEditModeToggle={false}
            selectable={false}
            disableAdd
            disableDelete
            emptyMessage=""
            filterRows={filterRows}
            onAllItemsChange={setCurrentRows}
            onRefresh={() => { void refetch(); }}
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
export default DocumentNumberSettings;
