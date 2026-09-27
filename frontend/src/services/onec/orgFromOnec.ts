// Организация ERP из реквизитов базы 1С (26.09): кнопка «Создать организацию» в одобрении заявки на подключение
// базы. Запрос идёт в ERP (backend `POST /organizations/from-onec`), а не в сервис AI: организации живут в ERP.
import { api } from "src/services/api/client";
import type { OnecOrgDetails } from "src/services/onec/api";

export type CreatedFromOnec = {
	success: boolean;
	item: { uuid: string; name: string | null; bin: string };
	created: { contacts: number; contactPersons: number; bankAccounts: number };
};

export const createOrganizationFromOnec = (body: { bin: string; name: string | null; details: OnecOrgDetails | null }) =>
	api.post<CreatedFromOnec>("/organizations/from-onec", body);
