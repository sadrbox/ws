// DealsKanban (E9 CRM) — доска воронки: колонки-стадии, карточки-сделки.
// Клик по карточке открывает форму сделки; выпадающий список на карточке двигает
// её по стадиям (PUT stage). Источник — GET /deals. Перетаскивания нет намеренно
// (select надёжнее на тач/клавиатуре и не требует DnD-зависимости).
import { FC, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { useAppContext } from "src/app/context";
import type { TDataItem } from "src/components/Table/types";
import { DEAL_STAGES } from "./stages";
import { DealsForm } from "./index";

interface DealRow {
  id: number; uuid: string; title: string; stage: string;
  amount: number | string; currency: string; probability: number;
  counterpartyName?: string; responsibleName?: string;
}

const money = (v: number | string, ccy: string) => {
  const n = Number(v) || 0;
  return `${n.toLocaleString("ru", { maximumFractionDigits: 2 })} ${ccy || ""}`.trim();
};

const DealsKanban: FC<Partial<{ uniqId: string }>> = () => {
  const { addPane } = useAppContext().windows;
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<DealRow[]>({
    queryKey: ["deals-kanban"],
    queryFn: async () => {
      const resp = await api.get<{ items?: DealRow[] }>("deals", { params: { limit: 1000 } });
      return resp?.items ?? [];
    },
  });

  const moveMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: number; stage: string }) =>
      api.put(`deals/${id}`, { stage }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["deals-kanban"] });
    },
  });

  const byStage = useMemo(() => {
    const map: Record<string, DealRow[]> = {};
    for (const s of DEAL_STAGES) map[s.key] = [];
    for (const d of data ?? []) (map[d.stage] ??= []).push(d);
    return map;
  }, [data]);

  const openDeal = (row?: DealRow, stage?: string) =>
    addPane({ component: DealsForm, data: (row ?? (stage ? { stage } : {})) as Partial<TDataItem>, label: row?.title || translate("deal") });

  if (isError) return <div style={{ padding: 16 }}>{translate("serverError")}</div>;
  if (isLoading) return <div style={{ padding: 16 }}>…</div>;

  return (
    <div style={{ display: "flex", gap: 10, padding: 12, overflowX: "auto", height: "100%", alignItems: "flex-start" }}>
      {DEAL_STAGES.map((s) => {
        const rows = byStage[s.key] ?? [];
        const sum = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
        return (
          <div key={s.key} style={{ minWidth: 240, maxWidth: 280, flex: "1 0 240px", background: "var(--sv-color30, #eee)", borderRadius: 6, display: "flex", flexDirection: "column", maxHeight: "100%" }}>
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--sv-color33, #ddd)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <b>{translate(s.labelKey)}</b>
              <span style={{ fontSize: "0.8em", color: "var(--sv-color5, #888)" }}>{rows.length} · {money(sum, rows[0]?.currency ?? "")}</span>
            </div>
            <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
              {rows.map((r) => (
                <div key={r.uuid} style={{ background: "var(--sv-color60, #fff)", border: "1px solid var(--sv-color33, #ddd)", borderRadius: 5, padding: 8, cursor: "pointer" }}>
                  <div onClick={() => openDeal(r)} style={{ fontWeight: 600, marginBottom: 4 }}>{r.title}</div>
                  {r.counterpartyName && <div style={{ fontSize: "0.85em", color: "var(--sv-color51, #666)" }}>{r.counterpartyName}</div>}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                    <span style={{ fontSize: "0.85em" }}>{money(r.amount, r.currency)}</span>
                    <select
                      value={r.stage}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => moveMutation.mutate({ id: r.id, stage: e.target.value })}
                      style={{ fontSize: "0.8em" }}
                      title={translate("dealMoveStage")}
                    >
                      {DEAL_STAGES.map((st) => <option key={st.key} value={st.key}>{translate(st.labelKey)}</option>)}
                    </select>
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => openDeal(undefined, s.key)}
                style={{ border: "1px dashed var(--sv-color34, #bbb)", background: "transparent", borderRadius: 5, padding: "6px 8px", cursor: "pointer", color: "var(--sv-color51, #666)" }}>
                + {translate("add")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
DealsKanban.displayName = "DealsKanban";

export { DealsKanban };
export default DealsKanban;
