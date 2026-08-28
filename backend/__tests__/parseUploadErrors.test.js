// T7.8 — юнит-тест парсера построчных ошибок upload* (ЭСФ/СНТ/ЭАВР).
// Чистый парсер (без сети/БД): проверяем разбор <error>-блоков и фолбэк.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUploadErrors, joinErrorText } from "../services/esf/parseUploadErrors.js";

test("несколько <error> блоков → построчный список", () => {
	const xml = `<resp>
		<declinedSet>
			<error><errorCode>SNT_001</errorCode><text>Нет ТН ВЭД</text><property>products[0].tnvedCode</property></error>
			<error><errorCode>SNT_002</errorCode><description>Неверная сумма</description></error>
		</declinedSet>
	</resp>`;
	const errs = parseUploadErrors(xml);
	assert.equal(errs.length, 2);
	assert.deepEqual(errs[0], { errorCode: "SNT_001", text: "Нет ТН ВЭД", property: "products[0].tnvedCode" });
	assert.equal(errs[1].errorCode, "SNT_002");
	assert.equal(errs[1].text, "Неверная сумма");
	assert.equal(errs[1].property, null);
});

test("namespaced <ns:error> тоже разбирается", () => {
	const xml = `<v1:error xmlns:v1="x"><errorCode>E9</errorCode><errorText>Плохо</errorText></v1:error>`;
	const errs = parseUploadErrors(xml);
	assert.equal(errs.length, 1);
	assert.equal(errs[0].errorCode, "E9");
	assert.equal(errs[0].text, "Плохо");
});

test("без <error>, но с верхнеуровневым текстом → одиночная ошибка (фолбэк)", () => {
	const xml = `<fault><errorCode>AUTH_1</errorCode><text>Нет сессии</text></fault>`;
	const errs = parseUploadErrors(xml);
	assert.equal(errs.length, 1);
	assert.equal(errs[0].errorCode, "AUTH_1");
	assert.equal(errs[0].text, "Нет сессии");
});

test("успешный ответ без ошибок → пустой массив", () => {
	const xml = `<resp><id>123</id><registrationNumber>SNT-777</registrationNumber><status>CREATED</status></resp>`;
	assert.deepEqual(parseUploadErrors(xml), []);
});

test("пустой/невалидный вход → []", () => {
	assert.deepEqual(parseUploadErrors(""), []);
	assert.deepEqual(parseUploadErrors(null), []);
	assert.deepEqual(parseUploadErrors(undefined), []);
});

test("joinErrorText сводит в многострочный текст", () => {
	const text = joinErrorText([
		{ errorCode: "E1", text: "Ошибка раз", property: "a.b" },
		{ errorCode: null, text: "Ошибка два", property: null },
	]);
	assert.equal(text, "E1: Ошибка раз (a.b)\nОшибка два");
});

test("joinErrorText для пустого списка → null", () => {
	assert.equal(joinErrorText([]), null);
	assert.equal(joinErrorText(null), null);
});
