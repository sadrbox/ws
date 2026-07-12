import { describe, it, expect } from "vitest";
import { decideContract } from "src/hooks/useContractSync";

// Правило синхронизации договора при СМЕНЕ КОНТРАГЕНТА в формах документов:
//   • у нового контрагента есть ОСНОВНОЙ договор → подставить его;
//   • иначе очистить договор, если он принадлежит ДРУГОМУ контрагенту;
//   • «общий» договор (без контрагента) валиден для любого — не трогать.
describe("decideContract", () => {
	const CP_A = "cp-a";
	const CP_B = "cp-b";

	it("основной договор контрагента подставляется", () => {
		expect(
			decideContract({
				counterpartyUuid: CP_A,
				primaryUuid: "c1",
				primaryName: "Договор №1",
				currentContractUuid: "",
				currentContractOwner: null,
			}),
		).toEqual({ contractUuid: "c1", contractName: "Договор №1" });
	});

	it("основной договор ПЕРЕТИРАЕТ ранее выбранный чужой договор", () => {
		expect(
			decideContract({
				counterpartyUuid: CP_A,
				primaryUuid: "c1",
				primaryName: "Договор №1",
				currentContractUuid: "c-old",
				currentContractOwner: CP_B,
			}),
		).toEqual({ contractUuid: "c1", contractName: "Договор №1" });
	});

	it("основного нет, а договор чужой → поле очищается", () => {
		expect(
			decideContract({
				counterpartyUuid: CP_A,
				primaryUuid: null,
				currentContractUuid: "c-old",
				currentContractOwner: CP_B,
			}),
		).toEqual({ contractUuid: "", contractName: "" });
	});

	it("основного нет, договор уже принадлежит этому контрагенту → не трогаем", () => {
		expect(
			decideContract({
				counterpartyUuid: CP_A,
				primaryUuid: null,
				currentContractUuid: "c-a",
				currentContractOwner: CP_A,
			}),
		).toBeNull();
	});

	it("«общий» договор (без контрагента) валиден для любого → не трогаем", () => {
		expect(
			decideContract({
				counterpartyUuid: CP_A,
				primaryUuid: null,
				currentContractUuid: "c-common",
				currentContractOwner: null,
			}),
		).toBeNull();
	});

	it("контрагент ОЧИЩЕН → чужой договор снимается, общий остаётся", () => {
		expect(
			decideContract({
				counterpartyUuid: "",
				primaryUuid: null,
				currentContractUuid: "c-a",
				currentContractOwner: CP_A,
			}),
		).toEqual({ contractUuid: "", contractName: "" });

		expect(
			decideContract({
				counterpartyUuid: "",
				primaryUuid: null,
				currentContractUuid: "c-common",
				currentContractOwner: null,
			}),
		).toBeNull();
	});

	it("договора в форме нет и основного нет → ничего не делаем", () => {
		expect(
			decideContract({
				counterpartyUuid: CP_A,
				primaryUuid: null,
				currentContractUuid: "",
				currentContractOwner: null,
			}),
		).toBeNull();
	});
});
