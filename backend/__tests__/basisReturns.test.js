// Основание документа (У9 аудита 26.09): своя организация, проведённость при проведении,
// возврат не больше проданного — на мок-клиенте, без БД.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	assertBasisExists,
	assertReturnWithinBasis,
	BasisOrganizationError,
	BasisNotPostedError,
	ReturnExceedsBasisError,
	respondBasisError,
} from "../services/basisValidation.js";

const saleDoc = (over = {}) => ({ uuid: "s1", posted: true, organizationUuid: "orgA", ...over });
const basisClient = (sale) => ({ sale: { findUnique: async () => sale } });

test("основание другой организации — отказ (при переданной организации документа)", async () => {
	await assert.rejects(
		() => assertBasisExists("sale", "s1", basisClient(saleDoc()), { organizationUuid: "orgB" }),
		(e) => e instanceof BasisOrganizationError,
	);
	await assert.doesNotReject(() => assertBasisExists("sale", "s1", basisClient(saleDoc()), { organizationUuid: "orgA" }));
	// Без организации — как раньше (обратная совместимость вызовов).
	await assert.doesNotReject(() => assertBasisExists("sale", "s1", basisClient(saleDoc())));
});

test("проведение на основании НЕпроведённой реализации — отказ; черновик — можно", async () => {
	const draft = basisClient(saleDoc({ posted: false }));
	await assert.rejects(() => assertBasisExists("sale", "s1", draft, { posting: true }), (e) => e instanceof BasisNotPostedError);
	await assert.doesNotReject(() => assertBasisExists("sale", "s1", draft, { posting: false }));
});

function returnClient({ ret, sold, otherReturns = [], returnedItems }) {
	return {
		saleReturn: {
			findUnique: async () => ret,
			findMany: async () => otherReturns,
		},
		saleItem: { findMany: async () => sold },
		saleReturnItem: { findMany: async ({ where }) => returnedItems.filter((r) => where.saleReturnUuid.in.includes(r.saleReturnUuid)) },
		product: { findMany: async () => [{ uuid: "p", name: "Ноутбук" }] },
	};
}

test("возврат больше проданного (с учётом других проведённых возвратов) — 422", async () => {
	const ret = { uuid: "r2", posted: true, basisDocumentType: "sale", basisDocumentUuid: "s1" };
	const client = returnClient({
		ret,
		sold: [{ productUuid: "p", quantity: 5 }],
		otherReturns: [{ uuid: "r1" }],
		returnedItems: [
			{ saleReturnUuid: "r1", productUuid: "p", quantity: 3 },
			{ saleReturnUuid: "r2", productUuid: "p", quantity: 3 },
		],
	});
	let caught = null;
	try { await assertReturnWithinBasis("sale_return", "r2", {}, client); } catch (e) { caught = e; }
	assert.ok(caught instanceof ReturnExceedsBasisError);
	assert.match(caught.message, /Ноутбук: возвращается 6, продано 5/);
	let status = null;
	respondBasisError(caught, { status(s) { status = s; return this; }, json() { return this; } });
	assert.equal(status, 422);
});

test("возврат в пределах проданного, черновик возврата и возврат без основания — проходят", async () => {
	const base = {
		sold: [{ productUuid: "p", quantity: 5 }],
		returnedItems: [{ saleReturnUuid: "r2", productUuid: "p", quantity: 5 }],
	};
	await assert.doesNotReject(() => assertReturnWithinBasis("sale_return", "r2", {}, returnClient({ ...base, ret: { uuid: "r2", posted: true, basisDocumentType: "sale", basisDocumentUuid: "s1" } })));
	const over = { ...base, returnedItems: [{ saleReturnUuid: "r2", productUuid: "p", quantity: 9 }] };
	await assert.doesNotReject(() => assertReturnWithinBasis("sale_return", "r2", {}, returnClient({ ...over, ret: { uuid: "r2", posted: false, basisDocumentType: "sale", basisDocumentUuid: "s1" } })));
	await assert.doesNotReject(() => assertReturnWithinBasis("sale_return", "r2", {}, returnClient({ ...over, ret: { uuid: "r2", posted: true, basisDocumentType: null, basisDocumentUuid: null } })));
	// Но при проведении черновика с превышением (prospective posted:true) — отказ.
	await assert.rejects(
		() => assertReturnWithinBasis("sale_return", "r2", { posted: true }, returnClient({ ...over, ret: { uuid: "r2", posted: false, basisDocumentType: "sale", basisDocumentUuid: "s1" } })),
		(e) => e instanceof ReturnExceedsBasisError,
	);
});
