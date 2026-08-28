// Стадии воронки CRM (E9). Ключи совпадают с backend (Deal.stage). Порядок =
// колонки канбана слева направо. won/lost — терминальные (ставят status).
export interface DealStage { key: string; labelKey: string; }

export const DEAL_STAGES: DealStage[] = [
  { key: "new", labelKey: "dealStageNew" },
  { key: "qualified", labelKey: "dealStageQualified" },
  { key: "proposal", labelKey: "dealStageProposal" },
  { key: "negotiation", labelKey: "dealStageNegotiation" },
  { key: "won", labelKey: "dealStageWon" },
  { key: "lost", labelKey: "dealStageLost" },
];

export const DEAL_STAGE_KEYS = DEAL_STAGES.map((s) => s.key);
