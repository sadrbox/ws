// Поле-автокомплит по классификатору РК/ЕАЭС (страны/ТН ВЭД/КАТО/ГС ВС).
// Хранит КОД (не uuid). Обёртка над LookupField — единый вид/поведение с остальными
// лукапами (стили FieldWrapper, портал-дропдаун в ячейках, «Быстрый выбор» + «Список»).
// Отображает «код — наименование» (имя резолвится по коду, если не передано явно).
import { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import LookupField from "./LookupField";
import { fetchClassifiers } from "src/services/classifiers/api";

interface Props {
	/** Тип классификатора: country | tnved | kato | gsvs | … */
	type: string;
	label?: string;
	name: string;
	/** Хранимый код. */
	value: string;
	/** Отображаемое наименование (если известно — иначе резолвится по коду). */
	displayName?: string;
	onChange: (code: string, name: string) => void;
	disabled?: boolean;
	width?: string;
	variant?: "default" | "table";
}

/** Автокомплит по классификатору. Показывает «код — наименование», хранит код. */
export const ClassifierLookup: FC<Props> = ({ type, label, name, value, displayName, onChange, disabled, width, variant }) => {
	// Резолв наименования по хранимому коду (когда имя не передано, напр. после перезагрузки).
	const { data: resolvedName } = useQuery({
		queryKey: ["classifier-name", type, value],
		queryFn: async () => (await fetchClassifiers(type, value, undefined, 10)).items.find((i) => i.code === value)?.name ?? "",
		enabled: !!value && !displayName,
		staleTime: 5 * 60_000,
	});
	const shownName = displayName || resolvedName || "";
	const displayValue = value ? (shownName ? `${value} — ${shownName}` : value) : "";
	return (
		<LookupField
			label={label ?? ""}
			name={name}
			value={value}
			displayValue={displayValue}
			endpoint="classifiers"
			displayField="name"
			extraParams={{ type }}
			getSuggestionLabel={(i) => `${i.code}${i.name ? ` — ${i.name}` : ""}`}
			visibleActions={["quickselect", "list"]}
			disabled={disabled}
			width={width}
			variant={variant ?? "default"}
			onSelect={(_uuid, _display, item) => onChange(String(item.code ?? ""), String(item.name ?? ""))}
		/>
	);
};

export default ClassifierLookup;
