import translations from "./translations.json" assert { type: "json" };
import { TColumn } from "src/components/Grid/types";

export function getTranslation(word: string): string {
	const translate: [string, string] | undefined = Object.entries(
		translations
	).find(([key, value]) =>
		key.toLowerCase().replace(/\s/g, "") ===
		word.toLowerCase().replace(/\s/g, "")
			? value
			: undefined
	);
	return translate !== undefined ? translate?.[1] : word;
}

export function getTranslateColumn(column: TColumn) {
	if (column.identifier) {
		return getTranslation(column.identifier.toString());
	}
	return column.column || column.identifier;
}
