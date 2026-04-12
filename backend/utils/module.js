import os from "os";
import { z } from "zod";

function getLocalIP() {
	const interfaces = os.networkInterfaces();

	for (let interfaceName in interfaces) {
		for (let i = 0; i < interfaces[interfaceName].length; i++) {
			const address = interfaces[interfaceName][i];
			if (address.family === "IPv4" && !address.internal) {
				return address.address;
			}
		}
	}

	return null; // В случае, если локальный IP не найден
}

// ────────────────────────────────────────────────
// Схема валидации query-параметров
// ────────────────────────────────────────────────
const querySchema = z.object({
	page: z.coerce.number().int().positive().min(1).default(1),
	limit: z.coerce
		.number()
		.int()
		.positive()
		.max(500, { message: "Максимум 500 записей за раз" })
		.default(100),

	filter: z
		.string()
		.optional()
		.transform((val, ctx) => {
			if (!val?.trim()) return undefined;
			try {
				return JSON.parse(val);
			} catch {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Невалидный JSON в параметре filter",
				});
				return z.NEVER;
			}
		})
		.pipe(
			z
				.object({
					searchBy: z
						.object({
							columns: z
								.array(
									z.object({
										identifier: z.string().min(1),
										type: z.enum(["string", "number", "date"]),
									}),
								)
								.default([]),
							value: z.string().default(""),
						})
						.optional()
						.default({ columns: [], value: "" }),

					dateRange: z
						.object({
							startDate: z
								.string()
								.regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, {
									message: "Ожидается формат YYYY-MM-DD или полный ISO",
								})
								.transform((val) => {
									// Если только дата → берём начало дня в UTC
									if (val.length === 10) {
										return `${val}T00:00:00.000Z`;
									}
									return val;
								})
								.pipe(z.coerce.date())
								.optional()
								.nullable(),

							endDate: z
								.string()
								.regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, {
									message: "Ожидается формат YYYY-MM-DD или полный ISO",
								})
								.transform((val) => {
									// Если только дата → берём конец дня в UTC
									if (val.length === 10) {
										return `${val}T23:59:59.999Z`;
									}
									return val;
								})
								.pipe(z.coerce.date())
								.optional()
								.nullable(),
						})
						.optional()
						.default({ startDate: null, endDate: null }),
				})
				.optional(),
		)
		.optional(),
});

export { querySchema, getLocalIP };
