// Доступ к статическим перечням ЭСФ (см. backend/services/esf/dictionaries.js).
// Данные стабильны — кэшируем надолго (react-query staleTime).
import { useQuery } from "@tanstack/react-query";
import { api } from "src/services/api/client";

export interface DictEntry { code: string; label: string; }
export interface EsfDictionaries {
	invoiceType: DictEntry[];
	ndsRateType: DictEntry[];
	paperReasonType: DictEntry[];
	sellerType: DictEntry[];
	customerType: DictEntry[];
	truOrigin: DictEntry[];
	signatureType: DictEntry[];
}

export const fetchEsfDictionaries = () =>
	api.get<{ success: boolean; dictionaries: EsfDictionaries }>("/esf/dictionaries");

/** Перечни ЭСФ для pick-list'ов форм (кэш на сессию). */
export function useEsfDictionaries() {
	const { data } = useQuery({
		queryKey: ["esf", "dictionaries"],
		queryFn: async () => (await fetchEsfDictionaries()).dictionaries,
		staleTime: 60 * 60 * 1000, // час — перечни статичны
	});
	return data;
}

/** Подпись по коду из перечня (для отображения). */
export function labelOf(entries: DictEntry[] | undefined, code: string | null | undefined): string {
	if (!code) return "";
	return entries?.find((e) => e.code === code)?.label || code;
}
