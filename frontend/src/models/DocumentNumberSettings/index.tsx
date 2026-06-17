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
import FieldActionButton from "src/components/Field/FieldActionButton";
import { HelpBox } from "src/components/HelpBox";
import { Button } from "src/components/Button";
import { useAppContext } from "src/app/context";
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
  isOverridden: boolean;
}

const QKEY = (org?: string) => ["document-number-settings", org ?? "__global__"];

const DocumentNumberSettings: FC = () => {
  const qc = useQueryClient();

  // Организация выбирается в поле «Организация» (пусто = значения по умолчанию
  // для всех). Без выбора правятся общесистемные значения (только суперадмин).
  const [selOrgUuid, setSelOrgUuid] = useState("");
  const [selOrgName, setSelOrgName] = useState("");
  const orgKey = selOrgUuid || undefined;

  // Нумерацию «по умолчанию (для всех организаций)» (orgKey пуст) может править
  // только суперадмин — это общесистемная настройка. Настройки конкретной
  // организации (orgKey задан) доступны обычным пользователям с правами.
  const { auth, actions } = useAppContext();
  const isSuperAdmin = !!auth.user?.isSuperAdmin;
  const canEdit = isSuperAdmin || !!orgKey;

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
      return String(c.prefix ?? "") !== String(o.prefix ?? "") || Number(c.padding) !== Number(o.padding);
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
    () => `${orgKey ?? "global"}|${rows.map((r) => `${r.docType}:${r.prefix}:${r.padding}:${r.isOverridden ? 1 : 0}`).join(",")}`,
    [rows, orgKey],
  );

  // Кастомный рендер ячеек: контролы редактируют ВНУТРЕННЮЮ строку SubTable
  // (ctx.updateLocalRow) — как в TradeDocumentItemsTable, без потери фокуса.
  // variant="table" + label="" — ячейка как единый элемент (без form-field обёрток).
  const renderCell = (row: TDataItem, col: TColumn, ctx: SubTableContext): ReactNode | undefined => {
    const r = row as unknown as Row;
    switch (col.identifier) {
      case "documentType":
        return <span className={styles.cLabel}>{r.label}</span>;
      case "prefix":
        return <Field label="" variant="table" actions={[]} disabled={!canEdit} name={`pfx_${r.docType}`} value={r.prefix ?? ""} onChange={(e) => ctx.updateLocalRow(row, { prefix: e.target.value })} placeholder={r.defaultPrefix || translate("optional")} />;
      case "digitsCount":
        return <FieldNumber label="" variant="table" actions={[]} disabled={!canEdit} name={`pad_${r.docType}`} value={String(r.padding ?? 6)} onChange={(e) => ctx.updateLocalRow(row, { padding: Math.min(9, Math.max(1, Number(e.target.value) || 6)) })} />;
      case "exampleNumber":
        return <code>{example(r.prefix, r.padding)}</code>;
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
    return r.isOverridden && canEdit
      ? <FieldActionButton icon="restore" label={translate("resetToDefault")} disabled={busy} onClick={() => reset(r.docType)} />
      : null;
  };

  const save = async () => {
    setBusy(true);
    try {
      for (const cr of changedRows) {
        const c = cr as unknown as Row;
        // Префикс необязателен — пустой допустим (номер без префикса).
        await api.put(`document-number-settings/${c.docType}`, { prefix: String(c.prefix ?? "").trim(), padding: c.padding, enabled: true, organizationUuid: orgKey });
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

  // Сбросить к значению по умолчанию ВСЮ таблицу (все переопределённые виды) —
  // кнопка в тулбаре. Удаляет свои настройки всех видов для выбранной организации.
  const overriddenCount = rows.filter((r) => r.isOverridden).length;
  const resetAll = async () => {
    if (!overriddenCount) return;
    if (!(await actions.confirm(translate("resetAllConfirm")))) return;
    setBusy(true);
    try {
      for (const r of rows) {
        if (!r.isOverridden) continue;
        await api.delete(`document-number-settings/${r.docType}`, { params: orgKey ? { organizationUuid: orgKey } : undefined });
      }
      qc.invalidateQueries({ queryKey: QKEY(orgKey) });
      showToast(translate("resetDone"), "success");
    } catch (e: any) {
      showToast(e?.response?.data?.message || translate("numberingSaveError"), "error", 7000);
    } finally {
      setBusy(false);
    }
  };

  // Перенумеровать ЧЕРНОВИКИ (posted=false) под текущие СОХРАНЁННЫЕ настройки:
  // числовая часть номера сохраняется, меняется только формат (префикс/разрядность).
  // Проведённые/распечатанные документы не затрагиваются. Действие необратимо.
  const renumberDrafts = async () => {
    if (!(await actions.confirm(translate("renumberDraftsConfirm")))) return;
    setBusy(true);
    try {
      const res = await api.post<{ updated?: number }>("document-number-settings/renumber-drafts", { organizationUuid: orgKey });
      const n = res?.updated ?? 0;
      showToast(n > 0 ? `${translate("renumberDraftsDone")}: ${n}` : translate("renumberDraftsNone"), "success");
    } catch (e: any) {
      showToast(e?.response?.data?.message || translate("numberingSaveError"), "error", 7000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.Root}>

      <div className={styles.OrgPicker}>
        <LookupField label={translate("organization")} name="dns_org" value={selOrgUuid} displayValue={selOrgName}
          endpoint="organizations" displayField="name"
          placeholder={translate("numberingDefaultsForAll")}
          onSelect={(u, d) => { setSelOrgUuid(u); setSelOrgName(d); }}
          onClear={() => { setSelOrgUuid(""); setSelOrgName(""); }} />
      </div>

      <HelpBox footnote={translate("numberingUniqueNote")}>
        <p>{orgKey ? translate("numberingHintOrg") : translate("numberingHintGlobal")}</p>
      </HelpBox>
      {!canEdit && <div className={styles.WarnNote}>{translate("numberingDefaultsSuperadminOnly")}</div>}

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
            componentName="DocumentNumberSettings"
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
            hideAddDelete
            hideReload
            emptyMessage=""
            filterRows={filterRows}
            extraButtons={canEdit ? (
              <Button variant="secondary" onClick={resetAll} disabled={busy || overriddenCount === 0}
                title={translate("resetToDefault")}>
                {translate("resetToDefault")}
              </Button>
            ) : undefined}
            onAllItemsChange={setCurrentRows}
            onRefresh={() => { void refetch(); }}
            renderCell={renderCell}
            rowActions={rowActions}
          />
        </div>
      )}

      <div className={styles.Footer}>
        <Button variant="primary" onClick={save} disabled={!dirty || busy || !canEdit}>
          {busy ? translate("loading") : translate("saveNumbering")}
        </Button>
        <Button variant="secondary" onClick={renumberDrafts} disabled={busy || dirty || !canEdit}
          title={dirty ? translate("renumberDraftsSaveFirst") : translate("renumberDraftsHint")}>
          {translate("renumberDrafts")}
        </Button>
        {dirty && <span className={styles.UnsavedNote}>{translate("unsavedChanges")}</span>}
      </div>
    </div>
  );
};

DocumentNumberSettings.displayName = "DocumentNumberSettings";
export default DocumentNumberSettings;
