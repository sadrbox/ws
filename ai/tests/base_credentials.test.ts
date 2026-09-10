/**
 * Учётные записи отдельных баз: шифрование пароля.
 *
 * Проверяется то, от чего зависит доступ к чужой базе: пароль восстанавливается тем же
 * секретом, не восстанавливается чужим (и при этом не роняет выдачу команд), а шифртекст
 * не содержит исходной строки — иначе выгрузка базы отдавала бы пароли как есть.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveKey, seal, unseal } from "../src/onec/credentials.ts";

describe("шифрование пароля базы", () => {
	const key = deriveKey("секрет-сервиса-достаточной-длины");

	it("расшифровывается тем же ключом", () => {
		const sealed = seal("Пар0ль от базы", key);
		assert.equal(unseal(sealed, key), "Пар0ль от базы");
	});

	it("в шифртексте нет исходной строки", () => {
		const sealed = seal("Пар0ль от базы", key);
		assert.ok(!sealed.includes("Пар0ль"));
		assert.ok(sealed.startsWith("v1:"));
	});

	it("каждое шифрование даёт новый шифртекст (случайный iv)", () => {
		assert.notEqual(seal("одинаково", key), seal("одинаково", key));
	});

	it("чужой ключ даёт null, а не исключение", () => {
		const sealed = seal("Пар0ль", key);
		assert.equal(unseal(sealed, deriveKey("другой-секрет-сервиса-длинный")), null);
	});

	it("испорченное значение даёт null", () => {
		assert.equal(unseal("мусор", key), null);
		assert.equal(unseal("v1:a:b:c", key), null);
	});

	it("пустой пароль шифруется и возвращается пустым", () => {
		assert.equal(unseal(seal("", key), key), "");
	});
});
