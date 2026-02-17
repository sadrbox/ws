import { TColumn } from "src/components/Table/types";
import translations from "./translations.json" assert { type: "json" };

export function getTranslation(word: string | undefined | null): string {
	const normalizedWord = word?.toLowerCase()?.replace(/\s/g, "") || "";

	const translate: [string, string] | undefined = Object.entries(
		translations,
	).find(([value]) => {
		const normalizedKey = value.toLowerCase().replace(/\s/g, "");
		return normalizedKey === normalizedWord;
	});

	return translate !== undefined ? translate[1] : word || "";
}

export const translate = (word: string) => getTranslation(word);

export function getTranslateColumn(column: TColumn): string | undefined {
	if (column.identifier) {
		return getTranslation(column.identifier.toString());
	}
	return column.name || column.identifier;
}
