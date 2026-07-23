import { describe, it, expect, vi } from "vitest";
import {
	newLookupCreateToken,
	emitLookupCreated,
	subscribeLookupCreated,
	LOOKUP_CREATE_TOKEN_KEY,
} from "src/utils/lookupCreateBus";

describe("lookupCreateBus (write-back созданного объекта в поле-лукап)", () => {
	it("доставляет созданный объект подписчику с тем же токеном", () => {
		const token = newLookupCreateToken();
		const received = vi.fn();
		const unsubscribe = subscribeLookupCreated(token, received);

		emitLookupCreated({
			requestId: token,
			uuid: "u-1",
			endpoint: "counterparties",
			item: { uuid: "u-1", name: "ТОО Ромашка" },
		});

		expect(received).toHaveBeenCalledTimes(1);
		expect(received.mock.calls[0][0]).toMatchObject({
			uuid: "u-1",
			endpoint: "counterparties",
			item: { name: "ТОО Ромашка" },
		});
		unsubscribe();
	});

	it("НЕ доставляет объект подписчику с другим токеном (изоляция полей)", () => {
		const mine = newLookupCreateToken();
		const other = newLookupCreateToken();
		const received = vi.fn();
		const unsubscribe = subscribeLookupCreated(mine, received);

		emitLookupCreated({ requestId: other, uuid: "u-2", endpoint: "products" });

		expect(received).not.toHaveBeenCalled();
		unsubscribe();
	});

	it("после отписки события не приходят", () => {
		const token = newLookupCreateToken();
		const received = vi.fn();
		subscribeLookupCreated(token, received)();

		emitLookupCreated({ requestId: token, uuid: "u-3", endpoint: "products" });

		expect(received).not.toHaveBeenCalled();
	});

	it("токены уникальны, ключ токена стабилен", () => {
		const a = newLookupCreateToken();
		const b = newLookupCreateToken();
		expect(a).not.toBe(b);
		expect(LOOKUP_CREATE_TOKEN_KEY).toBe("__lookupCreateId");
	});
});
