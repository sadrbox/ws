import { FC, useState, useCallback, useEffect, useMemo } from "react";
import { FieldSelect } from "src/components/Field";
import { GroupRow, GroupCol } from "src/components/UI";
import { Button } from "src/components/Button";
import { getFormatDate } from "src/utils/datetime";
import { translate } from "src/i18";
import Table from "src/components/Table";
import type { TColumn, TDataItem } from "src/components/Table/types";
import apiClient from "src/services/api/client";
import mainStyles from "src/styles/main.module.scss";
import type { TPane } from "src/app/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModelOption { value: string; label: string; }
interface RecordItem { uuid: string; id: number; deletedAt?: string | null; [key: string]: unknown; }
interface RefEntry { table: string; column: string; label: string; total: number; active: number; }
interface ProtocolEntry { table: string; column: string; label: string; affected: number; }
interface ExecuteSummary {
  modelLabel: string; sourceLabel: string; sourceIsDeleted: boolean;
  targetLabel: string; totalAffected: number; executedAt: string;
}

// ── Step card ─────────────────────────────────────────────────────────────────

const StepCard: FC<{ step: number; title: string; active: boolean; children: React.ReactNode }> = ({ step, title, active, children }) => (
  <div style={{
    border: `1px solid ${active ? "#bcd6ff" : "#e0e0e0"}`,
    borderRadius: 4,
    background: active ? "#f5f9ff" : "#fafafa",
    padding: "10px 14px",
    transition: "border-color 0.15s, background 0.15s",
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 20, height: 20, borderRadius: "50%", fontSize: 11, fontWeight: 600,
        background: active ? "var(--color-link)" : "#c8c8c8", color: "#fff", flexShrink: 0,
      }}>{step}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: active ? "var(--color-link)" : "var(--text-muted)" }}>{title}</span>
    </div>
    {children}
  </div>
);

// ── Refs table ────────────────────────────────────────────────────────────────

const REFS_COLUMNS_INIT: TColumn[] = [
  { position: 0, identifier: "label",    type: "string", visible: true, filter: false, inlist: true, sortable: false },
  { position: 1, identifier: "tableCol", type: "string", visible: true, filter: false, inlist: true, sortable: false, width: "160px", minWidth: "100px" },
  { position: 2, identifier: "total",    type: "number", visible: true, filter: false, inlist: true, sortable: false, width: "70px",  minWidth: "60px" },
  { position: 3, identifier: "active",   type: "number", visible: true, filter: false, inlist: true, sortable: false, width: "80px",  minWidth: "60px" },
];

const NOOP = () => {};

const RefsTable: FC<{ refs: RefEntry[] }> = ({ refs }) => {
  const totalCount = refs.reduce((s, r) => s + r.total, 0);
  const [columns, setColumns] = useState<TColumn[]>(REFS_COLUMNS_INIT);

  const rows = useMemo<TDataItem[]>(() =>
    refs.filter(r => r.total > 0).map((r, i) => ({
      id: i + 1,
      uuid: `${r.table}.${r.column}`,
      label: r.label,
      tableCol: `${r.table}.${r.column}`,
      total: r.total,
      active: r.active,
    })), [refs]);

  const actions = useMemo(() => ({ refetch: NOOP, setColumns }), []);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 3, overflow: "hidden", marginTop: 6 }}>
      <div style={{
        padding: "5px 10px", fontWeight: 500, fontSize: 11,
        background: totalCount > 0 ? "#fdf3e1" : "var(--success-bg)",
        borderBottom: rows.length > 0 ? "1px solid #e8e8e8" : undefined,
        color: totalCount > 0 ? "#7a4d12" : "var(--success-fg)",
      }}>
        {totalCount > 0 ? `Найдено ссылок: ${totalCount}` : "Ссылок не найдено — запись не используется"}
      </div>
      {rows.length > 0 && (
        <div style={{ height: 300 }}>
          <Table
            componentName="SearchReplaceRefs_part"
            rows={rows}
            columns={columns}
            total={rows.length}
            totalPages={1}
            isLoading={false}
            error={null}
            enableDateRange={false}
            pagination={{ page: 1, limit: 100, onPageChange: NOOP, onLimitChange: NOOP }}
            sorting={{ sort: {}, onSortChange: NOOP }}
            filtering={{ filters: undefined, onFilterChange: NOOP, onClearAll: NOOP }}
            search={{ value: "", onChange: NOOP }}
            actions={actions}
            readonly
          />
        </div>
      )}
    </div>
  );
};

// ── Protocol block ────────────────────────────────────────────────────────────

const ProtocolBlock: FC<{ summary: ExecuteSummary; entries: ProtocolEntry[] }> = ({ summary, entries }) => {
  function fmtDate(iso: string) {
    return getFormatDate(iso) || iso;
  }
  return (
    <div style={{ border: "1px solid #c8e6c9", borderRadius: 3, overflow: "hidden", fontSize: 12 }}>
      <div style={{ background: "var(--success-bg)", padding: "5px 10px", borderBottom: entries.length > 0 ? "1px solid #c8e6c9" : undefined, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{fmtDate(summary.executedAt)}</span>
        <strong>{summary.modelLabel}</strong>
        <span style={{ color: "var(--text-muted)" }}>—</span>
        <span style={{ color: summary.sourceIsDeleted ? "#b02a37" : "var(--text-secondary)", textDecoration: summary.sourceIsDeleted ? "line-through" : undefined }}>«{summary.sourceLabel}»</span>
        <span>→</span>
        <span style={{ color: "var(--color-link)", fontWeight: 500 }}>«{summary.targetLabel}»</span>
        <span style={{ marginLeft: "auto", color: summary.totalAffected > 0 ? "var(--success-fg)" : "var(--text-muted)", fontWeight: 500 }}>
          Обновлено: {summary.totalAffected}
        </span>
      </div>
      {entries.filter(e => e.affected > 0).length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {entries.filter(e => e.affected > 0).map((e, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "3px 10px", fontSize: 12 }}>{e.label}</td>
                <td style={{ padding: "3px 10px", color: "var(--text-faint)", fontFamily: "monospace", fontSize: 10 }}>{e.table}.{e.column}</td>
                <td style={{ padding: "3px 10px", textAlign: "right", fontWeight: 600, color: "var(--success)", fontSize: 12 }}>+{e.affected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────

const SearchReplaceRefsForm: FC<Partial<TPane>> = () => {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [displayField, setDisplayField] = useState("name");
  const [sourceUuid, setSourceUuid] = useState("");
  const [targetUuid, setTargetUuid] = useState("");
  const [refs, setRefs] = useState<RefEntry[] | null>(null);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [isLoadingRefs, setIsLoadingRefs] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [protocol, setProtocol] = useState<Array<{ summary: ExecuteSummary; entries: ProtocolEntry[] }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [sourceInfo, setSourceInfo] = useState<{ label: string; isDeleted: boolean } | null>(null);
  const [deleted, setDeleted] = useState<{ label: string; deletedAt: string } | null>(null);

  useEffect(() => {
    setModelsError(null);
    apiClient.get("/ref-replace/models")
      .then(r => setModels(r.data.models ?? []))
      .catch(err => setModelsError(err?.response?.data?.message ?? err?.message ?? "Ошибка загрузки"));
  }, []);

  useEffect(() => {
    if (!selectedModel) { setRecords([]); setSourceUuid(""); setTargetUuid(""); setRefs(null); setSourceInfo(null); setDeleted(null); return; }
    setIsLoadingRecords(true);
    setError(null);
    apiClient.get(`/ref-replace/records?model=${selectedModel}&includeDeleted=true`)
      .then(r => { setRecords(r.data.items ?? []); setDisplayField(r.data.displayField ?? "name"); setSourceUuid(""); setTargetUuid(""); setRefs(null); setSourceInfo(null); setDeleted(null); })
      .catch(err => setError(err?.response?.data?.message ?? "Ошибка загрузки записей"))
      .finally(() => setIsLoadingRecords(false));
  }, [selectedModel]);

  const sourceOptions = useMemo(() => [
    { value: "", label: "— выберите запись —" },
    ...records.map(r => ({
      value: r.uuid,
      label: r.deletedAt ? `✕ ${String(r[displayField] ?? r.uuid)} (удалена)` : String(r[displayField] ?? r.uuid),
    })),
  ], [records, displayField]);

  const targetOptions = useMemo(() => [
    { value: "", label: "— выберите замену —" },
    ...records.filter(r => !r.deletedAt && r.uuid !== sourceUuid).map(r => ({
      value: r.uuid, label: String(r[displayField] ?? r.uuid),
    })),
  ], [records, displayField, sourceUuid]);

  const handleFindRefs = useCallback(async () => {
    if (!selectedModel || !sourceUuid) return;
    setIsLoadingRefs(true); setError(null); setRefs(null); setSourceInfo(null); setDeleted(null);
    try {
      const r = await apiClient.post("/ref-replace/preview", { model: selectedModel, sourceUuid });
      setRefs(r.data.refs ?? []);
      if (r.data.source) {
        setSourceInfo({ label: r.data.source.label, isDeleted: !!r.data.source.isDeleted });
      }
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Ошибка поиска");
    } finally { setIsLoadingRefs(false); }
  }, [selectedModel, sourceUuid]);

  const handleExecute = useCallback(async () => {
    if (!selectedModel || !sourceUuid || !targetUuid) return;
    const srcLabel = sourceOptions.find(o => o.value === sourceUuid)?.label ?? sourceUuid;
    const tgtLabel = targetOptions.find(o => o.value === targetUuid)?.label ?? targetUuid;
    if (!window.confirm(`Заменить все ссылки?\n\n${srcLabel}\n→ ${tgtLabel}\n\nДействие необратимо.`)) return;
    setIsExecuting(true); setError(null);
    try {
      const r = await apiClient.post("/ref-replace/execute", { model: selectedModel, sourceUuid, targetUuid });
      setProtocol(prev => [{ summary: r.data.summary, entries: r.data.protocol ?? [] }, ...prev]);
      setRefs(null); setSourceUuid(""); setTargetUuid("");
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Ошибка выполнения");
    } finally { setIsExecuting(false); }
  }, [selectedModel, sourceUuid, targetUuid, sourceOptions, targetOptions]);

  const handleDelete = useCallback(async () => {
    if (!selectedModel || !sourceUuid || !sourceInfo) return;
    if (!window.confirm(`Удалить запись «${sourceInfo.label}»?\n\nЗапись будет помечена как удалённая. Отменить это действие нельзя.`)) return;
    setIsDeleting(true); setError(null);
    try {
      const r = await apiClient.post("/ref-replace/safe-delete", { model: selectedModel, uuid: sourceUuid });
      setDeleted({ label: r.data.label, deletedAt: r.data.deletedAt });
      setSourceUuid(""); setTargetUuid(""); setRefs(null); setSourceInfo(null);
      setIsLoadingRecords(true);
      apiClient.get(`/ref-replace/records?model=${selectedModel}&includeDeleted=true`)
        .then(res => { setRecords(res.data.items ?? []); setDisplayField(res.data.displayField ?? "name"); })
        .catch(() => {})
        .finally(() => setIsLoadingRecords(false));
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Ошибка удаления");
    } finally { setIsDeleting(false); }
  }, [selectedModel, sourceUuid, sourceInfo]);

  const totalRefs = refs ? refs.reduce((s, r) => s + r.total, 0) : 0;
  const canExecute = !isExecuting && !!selectedModel && !!sourceUuid && !!targetUuid && refs !== null && totalRefs > 0;
  const step2Active = !!selectedModel;
  const step3Active = refs !== null && totalRefs > 0;
  const step4Active = refs !== null && totalRefs === 0 && !!sourceInfo && !sourceInfo.isDeleted;

  const modelOptions = useMemo(() => [
    { value: "", label: models.length === 0 && !modelsError ? "Загрузка…" : "— выберите справочник —" },
    ...models,
  ], [models, modelsError]);

  return (
    <div className={mainStyles.FormWrapper}>
      <div className={mainStyles.Form} style={{ maxWidth: 680 }}>
        <GroupCol style={{ gap: 8 }}>

          {/* Step 1 — Справочник */}
          <StepCard step={1} title="Тип справочника" active={!selectedModel}>
            {modelsError ? (
              <GroupRow style={{ alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--danger)" }}>Ошибка: {modelsError}</span>
                <Button variant="secondary" onClick={() => {
                  setModelsError(null);
                  apiClient.get("/ref-replace/models").then(r => setModels(r.data.models ?? [])).catch(e => setModelsError(e?.message ?? "Ошибка"));
                }}>{translate("retry")}</Button>
              </GroupRow>
            ) : (
              <FieldSelect
                name="ref_model"
                options={modelOptions}
                value={selectedModel}
                onChange={e => { setSelectedModel(e.target.value); setRefs(null); setError(null); }}
                disabled={models.length === 0 && !modelsError}
                style={{ width: 280 }}
              />
            )}
          </StepCard>

          {/* Step 2 — Источник */}
          <StepCard step={2} title="Заменяемая запись" active={step2Active && !step3Active}>
            {step2Active ? (
              <GroupRow style={{ alignItems: "end", gap: 8 }}>
                <FieldSelect
                  name="ref_source"
                  options={isLoadingRecords ? [{ value: "", label: "Загрузка…" }] : sourceOptions}
                  value={sourceUuid}
                  onChange={e => { setSourceUuid(e.target.value); setTargetUuid(""); setRefs(null); setSourceInfo(null); setDeleted(null); setError(null); }}
                  disabled={isLoadingRecords}
                  style={{ flex: 1 }}
                />
                <div style={{ paddingBottom: 1 }}>
                  <Button
                    onClick={handleFindRefs}
                    disabled={!sourceUuid || isLoadingRefs || isLoadingRecords}
                    variant="secondary"
                  >
                    {isLoadingRefs ? "Поиск…" : "Найти ссылки"}
                  </Button>
                </div>
              </GroupRow>
            ) : (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{translate("selectRefFirst")}</span>
            )}
            {refs !== null && <RefsTable refs={refs} />}
          </StepCard>

          {/* Step 3 — Замена */}
          <StepCard step={3} title="Замена" active={step3Active}>
            {step3Active ? (
              <GroupRow style={{ alignItems: "end", gap: 8 }}>
                <FieldSelect
                  name="ref_target"
                  options={targetOptions}
                  value={targetUuid}
                  onChange={e => setTargetUuid(e.target.value)}
                  style={{ flex: 1 }}
                />
                <div style={{ paddingBottom: 1 }}>
                  <Button onClick={handleExecute} disabled={!canExecute} variant={canExecute ? "danger" : "secondary"}>
                    {isExecuting ? "Выполняется…" : "Выполнить замену"}
                  </Button>
                </div>
              </GroupRow>
            ) : (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Выполните поиск ссылок на шаге 2</span>
            )}
          </StepCard>

          {/* Step 4 — Удаление */}
          <StepCard step={4} title="Безопасное удаление" active={step4Active}>
            {step4Active ? (
              <GroupRow style={{ alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: "var(--success-fg)", flex: 1 }}>
                  Запись <strong>«{sourceInfo.label}»</strong> не используется — её можно безопасно удалить.
                </span>
                <Button onClick={handleDelete} disabled={isDeleting} variant="danger">
                  {isDeleting ? "Удаление…" : "Удалить запись"}
                </Button>
              </GroupRow>
            ) : (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {refs === null
                  ? "Выполните поиск ссылок на шаге 2 — если ссылок нет, здесь появится кнопка удаления"
                  : totalRefs > 0
                    ? `Сначала замените все ссылки (${totalRefs} шт.) на шаге 3`
                    : sourceInfo?.isDeleted
                      ? "Запись уже удалена"
                      : "Выполните поиск ссылок"
                }
              </span>
            )}
          </StepCard>

          {/* Результат удаления */}
          {deleted && (
            <div style={{
              border: "1px solid #c8e6c9", borderRadius: 4,
              background: "var(--success-bg)", padding: "8px 14px",
              fontSize: 13, color: "var(--success-fg)", fontWeight: 500,
            }}>
              Запись «{deleted.label}» успешно удалена.
            </div>
          )}

          {/* Ошибка */}
          {error && <div style={{ fontSize: 12, color: "var(--danger)", padding: "2px 4px" }}>{error}</div>}

          {/* Протокол */}
          {protocol.length > 0 && (
            <div style={{ borderTop: "1px solid #e8e8e8", paddingTop: 10, marginTop: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>{translate("replaceLog")}</div>
              <GroupCol style={{ gap: 6 }}>
                {protocol.map((p, i) => <ProtocolBlock key={i} summary={p.summary} entries={p.entries} />)}
              </GroupCol>
            </div>
          )}

        </GroupCol>
      </div>
    </div>
  );
};

SearchReplaceRefsForm.displayName = "SearchReplaceRefsForm";
export { SearchReplaceRefsForm };
