// ─────────────────────────────────────────────────────────────────────────────
// Добор проверочного покрытия поверх seed-testdata.js.
//
// seed-testdata создаёт документы, склады, кассы, банк-счета и договоры, но три
// области остаются пустыми — их и закрывает этот модуль:
//   • Контакты — все типы ContactType, с «основным» в каждом типе;
//   • Права доступа — AccessRight (роль в организации) + AccessPermission
//     (уровень доступа к модели), включая все три уровня full/readonly/none;
//   • Контактные лица контрагентов.
//
// Серии и партии живут в отдельном seed-batch-serial-mock.js — он запускается
// после этого модуля и опирается на созданные здесь организации и склады.
//
// Идемпотентность: работает только с тестовыми организациями (BIN «9990…») и
// перед вставкой чистит свои же данные по ним. Реальные организации, события 1С
// и пришедшие из 1С справочники не затрагиваются.
//
// Запуск:  node prisma/seed-mock-coverage.js
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./prisma-client.js";

const ORG_BIN_PREFIX = "9990";

/** Все типы контактов из enum ContactType. */
const CONTACT_TYPES = [
	"legal_address", "actual_address", "telephone", "whatsapp", "telegram",
	"instagram", "facebook", "email", "website", "fax", "other",
];

/** Правдоподобное значение под каждый тип — чтобы в списках было видно формат. */
function contactValue(type, seed) {
	const n = String(seed).padStart(3, "0");
	switch (type) {
		case "legal_address":  return `г. Алматы, ул. Абая ${seed}, оф. ${n}`;
		case "actual_address": return `г. Астана, пр. Республики ${seed}`;
		case "telephone":      return `+7 701 ${n} ${n.slice(0, 2)}${seed % 10}`;
		case "whatsapp":       return `+7 702 ${n} 45 67`;
		case "telegram":       return `@user_${n}`;
		case "instagram":      return `@insta_${n}`;
		case "facebook":       return `fb.com/company${n}`;
		case "email":          return `info${n}@example.kz`;
		case "website":        return `https://example${n}.kz`;
		case "fax":            return `+7 727 ${n} 00 11`;
		default:               return `Прочий контакт ${n}`;
	}
}

/** Модели, на которые раздаём разрешения (охватывают справочники и документы). */
const PERMISSION_MODELS = [
	"Product", "Counterparty", "Sale", "Purchase", "CashOrder",
	"Warehouse", "Contract", "AccessPermission", "Organization",
];

async function main() {
	const orgs = await prisma.organization.findMany({
		where: { bin: { startsWith: ORG_BIN_PREFIX }, deletedAt: null },
		select: { uuid: true, name: true },
		orderBy: { id: "asc" },
	});
	if (!orgs.length) {
		console.error("Тестовых организаций (BIN 9990…) нет — сначала запустите seed-testdata.js");
		process.exit(1);
	}
	const users = await prisma.user.findMany({
		where: { deletedAt: null },
		select: { uuid: true, username: true },
		orderBy: { id: "asc" },
	});
	if (!users.length) {
		console.error("Нет пользователей — права раздавать некому.");
		process.exit(1);
	}
	const orgUuids = orgs.map((o) => o.uuid);

	// ── Идемпотентность: сносим только СВОИ прошлые данные по тестовым орг. ────
	await prisma.contact.deleteMany({ where: { organizationUuid: { in: orgUuids } } });
	await prisma.contactPerson.deleteMany({ where: { organizationUuid: { in: orgUuids } } });
	await prisma.accessPermission.deleteMany({ where: { organizationUuid: { in: orgUuids } } });
	await prisma.accessRight.deleteMany({ where: { organizationUuid: { in: orgUuids } } });

	// ── 1. Контакты организаций: ВСЕ типы, первый в типе — основной ───────────
	let contacts = 0;
	for (const [i, org] of orgs.entries()) {
		for (const [t, type] of CONTACT_TYPES.entries()) {
			// По два контакта на тип: проверяем, что «основной» ровно один.
			for (let k = 0; k < 2; k++) {
				await prisma.contact.create({
					data: {
						value: contactValue(type, (i + 1) * 10 + t + k),
						contactType: type,
						ownerType: "organization",
						ownerUuid: org.uuid,
						organizationUuid: org.uuid,
						isPrimary: k === 0,
					},
				});
				contacts++;
			}
		}
	}

	// ── 2. Контакты и контактные лица контрагентов ────────────────────────────
	const counterparties = await prisma.counterparty.findMany({
		where: { organizationUuid: { in: orgUuids }, deletedAt: null },
		select: { uuid: true, name: true, organizationUuid: true },
		take: 40,
	});
	let persons = 0;
	for (const [i, cp] of counterparties.entries()) {
		// Контрагенту — базовый набор: телефон, email, фактический адрес.
		for (const [k, type] of ["telephone", "email", "actual_address"].entries()) {
			await prisma.contact.create({
				data: {
					value: contactValue(type, 500 + i),
					contactType: type,
					ownerType: "counterparty",
					ownerUuid: cp.uuid,
					organizationUuid: cp.organizationUuid,
					isPrimary: k === 0,
				},
			});
			contacts++;
		}
		// Должности отдельного поля у ContactPerson нет — пишем в comment.
		const role = ["Директор", "Бухгалтер", "Менеджер", "Снабженец"][i % 4];
		await prisma.contactPerson.create({
			data: {
				firstName: ["Асхат", "Динара", "Ерлан", "Сауле"][i % 4],
				lastName: ["Нурланов", "Ахметова", "Сериков", "Жумабаева"][i % 4],
				fullName: `${["Нурланов", "Ахметова", "Сериков", "Жумабаева"][i % 4]} ${["Асхат", "Динара", "Ерлан", "Сауле"][i % 4]}`,
				comment: role,
				ownerType: "counterparty",
				ownerUuid: cp.uuid,
				organizationUuid: cp.organizationUuid,
			},
		});
		persons++;
	}

	// ── 3. Права доступа ──────────────────────────────────────────────────────
	// AccessRight — принадлежность пользователя организации и его роль.
	// Первому пользователю даём admin везде (иначе после чистки некому
	// администрировать), остальным — member в части организаций.
	let rights = 0;
	for (const [ui, user] of users.entries()) {
		const targets = ui === 0 ? orgs : orgs.slice(0, Math.max(1, orgs.length - ui));
		for (const org of targets) {
			await prisma.accessRight.create({
				data: {
					userUuid: user.uuid,
					organizationUuid: org.uuid,
					role: ui === 0 ? "admin" : "member",
				},
			});
			rights++;
		}
	}

	// AccessPermission — уровень доступа к модели. Раздаём так, чтобы в базе
	// присутствовали ВСЕ три уровня: full / readonly / none.
	const LEVELS = ["full", "readonly", "none"];
	let permissions = 0;
	for (const [ui, user] of users.entries()) {
		for (const [mi, modelName] of PERMISSION_MODELS.entries()) {
			// Админ — полный доступ ко всему; остальные получают чередующиеся уровни.
			const accessLevel = ui === 0 ? "full" : LEVELS[(ui + mi) % LEVELS.length];
			await prisma.accessPermission.create({
				data: {
					modelName,
					accessLevel,
					userUuid: user.uuid,
					organizationUuid: orgs[mi % orgs.length].uuid,
				},
			});
			permissions++;
		}
	}

	// ── Отчёт ─────────────────────────────────────────────────────────────────
	const byLevel = await prisma.accessPermission.groupBy({
		by: ["accessLevel"],
		where: { organizationUuid: { in: orgUuids } },
		_count: true,
	});
	const primaryPerType = await prisma.contact.count({
		where: { organizationUuid: { in: orgUuids }, isPrimary: true },
	});

	console.log("\n▸ Добор покрытия:");
	console.log(`    Организаций охвачено:      ${orgs.length}`);
	console.log(`    Контактов создано:         ${contacts} (из них «основных»: ${primaryPerType})`);
	console.log(`    Типов контактов покрыто:   ${CONTACT_TYPES.length} из ${CONTACT_TYPES.length}`);
	console.log(`    Контактных лиц:            ${persons}`);
	console.log(`    Настроек доступа (роли):   ${rights}`);
	console.log(`    Разрешений на модели:      ${permissions}`);
	for (const r of byLevel) console.log(`      уровень ${r.accessLevel.padEnd(9)} ${r._count}`);
}

main()
	.catch((e) => {
		console.error("Ошибка:", e.message);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
