// P3 аудита 27.09: загрузка в общий список «Файлы» без активной организации — организация из тела
// (только доступная) или единственная доступная, а не 400. HEADLESS: чистая функция роутера.
import { test } from "node:test";
import assert from "node:assert/strict";
import { globalUploadOrg } from "../api/router/files.js";

const user = (over = {}) => ({ user: { uuid: "u1", organizationUuid: null, allowedOrgUuids: ["org-A"], isSuperAdmin: false, ...over } });

test("P3: без активной организации — единственная доступная; названная в теле — если доступна", () => {
	assert.deepEqual(globalUploadOrg(user(), undefined), { org: "org-A" }, "раньше — 400 «Не выбрана организация»");
	const two = user({ allowedOrgUuids: ["org-A", "org-B"] });
	assert.deepEqual(globalUploadOrg(two, "org-B"), { org: "org-B" });
	assert.equal(globalUploadOrg(two, undefined).status, 400, "неоднозначно — просим выбрать");
	const foreign = globalUploadOrg(two, "org-X");
	assert.equal(foreign.status, 403);
	assert.equal(foreign.code, "ORG_NOT_ACCESSIBLE");
});

test("P3: активная организация — как прежде; оператор без организации — «всеобщий» файл", () => {
	assert.deepEqual(globalUploadOrg(user({ organizationUuid: "org-A" }), ""), { org: "org-A" });
	assert.deepEqual(globalUploadOrg({ user: { isSuperAdmin: true, operatorDataAccess: true, allowedOrgUuids: [] } }, undefined), { org: null });
	assert.equal(globalUploadOrg(user({ allowedOrgUuids: [] }), undefined).status, 400);
});
