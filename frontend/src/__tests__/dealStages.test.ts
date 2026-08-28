import { describe, it, expect } from "vitest";
import { DEAL_STAGES, DEAL_STAGE_KEYS } from "src/models/Deals/stages";

// Ключи стадий должны совпадать с backend (Deal.stage / statusFromStage в
// api/router/deals.js). Тест фиксирует контракт, чтобы фронт и бэк не разошлись.
describe("CRM deal stages (E9)", () => {
  it("канонический набор и порядок стадий воронки", () => {
    expect(DEAL_STAGE_KEYS).toEqual([
      "new", "qualified", "proposal", "negotiation", "won", "lost",
    ]);
  });

  it("ключи уникальны", () => {
    expect(new Set(DEAL_STAGE_KEYS).size).toBe(DEAL_STAGE_KEYS.length);
  });

  it("у каждой стадии есть i18-ключ подписи", () => {
    for (const s of DEAL_STAGES) {
      expect(s.labelKey).toMatch(/^dealStage/);
      expect(s.key.length).toBeGreaterThan(0);
    }
  });

  it("won/lost — терминальные стадии (последние в воронке)", () => {
    expect(DEAL_STAGE_KEYS.slice(-2)).toEqual(["won", "lost"]);
  });
});
