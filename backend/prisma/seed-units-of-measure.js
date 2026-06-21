/**
 * Seed справочника единиц измерения.
 *
 * Источник кодов — ОКЕИ (МК 002-97) / Классификатор единиц измерения ЕАЭС,
 * который используется в Казахстане для:
 *   - ЭСФ (электронные счета-фактуры, ИС ЭСФ)
 *   - СНТ (сопроводительные накладные на товары)
 *   - 1С:Бухгалтерия для Казахстана
 *   - таможенных деклараций (КГД МФ РК)
 *
 * Идемпотентность: запись добавляется только если ещё нет шт с таким code.
 * Запуск:
 *   node backend/prisma/seed-units-of-measure.js
 */

import { prisma } from "./prisma-client.js";

/** @type {Array<{ code: string, shortName: string }>} */
const ITEMS = [
	// ── Длина ──
	{ code: "006", shortName: "м" }, // метр
	{ code: "004", shortName: "см" }, // сантиметр
	{ code: "005", shortName: "мм" }, // миллиметр
	{ code: "008", shortName: "км" }, // километр
	{ code: "018", shortName: "пог. м" }, // погонный метр
	// ── Площадь ──
	{ code: "053", shortName: "см²" }, // сантиметр квадратный
	{ code: "055", shortName: "м²" }, // метр квадратный
	{ code: "058", shortName: "га" }, // гектар
	{ code: "109", shortName: "ар" }, // ар (сотка)
	// ── Объём ──
	{ code: "111", shortName: "см³" }, // сантиметр кубический
	{ code: "112", shortName: "л" }, // литр / дм³
	{ code: "113", shortName: "м³" }, // метр кубический
	{ code: "131", shortName: "мл" }, // миллилитр
	// ── Масса ──
	{ code: "161", shortName: "мг" }, // миллиграмм
	{ code: "163", shortName: "г" }, // грамм
	{ code: "166", shortName: "кг" }, // килограмм
	{ code: "168", shortName: "т" }, // тонна
	{ code: "165", shortName: "кар" }, // карат метрический
	// ── Время ──
	{ code: "354", shortName: "ч" }, // час
	{ code: "355", shortName: "мин" }, // минута
	{ code: "356", shortName: "с" }, // секунда
	{ code: "359", shortName: "сут" }, // сутки
	{ code: "362", shortName: "мес" }, // месяц
	{ code: "366", shortName: "год" }, // год
	// ── Количество / штучные ──
	{ code: "642", shortName: "ед" }, // единица
	{ code: "796", shortName: "шт" }, // штука
	{ code: "715", shortName: "пара" }, // пара
	{ code: "728", shortName: "тыс. шт" }, // тысяча штук
	{ code: "657", shortName: "изд" }, // изделие
	{ code: "625", shortName: "лист" }, // лист
	{ code: "626", shortName: "пачка" }, // пачка
	{ code: "778", shortName: "упак" }, // упаковка
	{ code: "839", shortName: "компл" }, // комплект
	{ code: "704", shortName: "набор" }, // набор
	{ code: "736", shortName: "рулон" }, // рулон (по КГД РК)
	{ code: "868", shortName: "бут" }, // бутылка
	// ── Энергия / прочее (часто встречается в коммунальных услугах) ──
	{ code: "245", shortName: "кВт-ч" }, // киловатт-час
	{ code: "214", shortName: "Гкал" }, // гигакалория
	{ code: "233", shortName: "м³/ч" }, // кубический метр в час
];

async function main() {
	console.log("🌱 Seeding units_of_measure (ОКЕИ / ЕАЭС / КГД РК)...");

	let inserted = 0;
	let skipped = 0;
	let restored = 0;

	for (const u of ITEMS) {
		const existing = await prisma.unitOfMeasure.findFirst({
			where: { code: u.code },
		});

		if (existing) {
			if (existing.deletedAt) {
				await prisma.unitOfMeasure.update({
					where: { uuid: existing.uuid },
					data: { deletedAt: null, shortName: u.shortName },
				});
				restored += 1;
				console.log(`   ↻ ${u.code} ${u.shortName} (восстановлен)`);
			} else {
				skipped += 1;
			}
			continue;
		}

		await prisma.unitOfMeasure.create({
			data: { shortName: u.shortName, code: u.code },
		});
		inserted += 1;
		console.log(`   + ${u.code} ${u.shortName}`);
	}

	console.log(
		`✅ Готово: добавлено ${inserted}, пропущено ${skipped}, восстановлено ${restored}.`,
	);
}

main()
	.catch((e) => {
		console.error("❌ Seed error:", e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
