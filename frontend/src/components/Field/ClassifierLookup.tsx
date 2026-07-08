// Поле-автокомплит по классификатору РК/ЕАЭС (страны/ТН ВЭД/КАТО/ГС ВС).
// Хранит КОД (не uuid). Поиск по коду/наименованию через GET /classifiers.
// См. backend/services/classifiers, frontend/src/services/classifiers/api.ts.
import { FC, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Field } from "./index";
import { fetchClassifiers, type ClassifierItem } from "src/services/classifiers/api";
import styles from "./ClassifierLookup.module.scss";

interface Props {
	/** Тип классификатора: country | tnved | kato | gsvs | … */
	type: string;
	label?: string;
	name: string;
	/** Хранимый код. */
	value: string;
	/** Отображаемое наименование (если известно). */
	displayName?: string;
	onChange: (code: string, name: string) => void;
	disabled?: boolean;
	width?: string;
}

/** Автокомплит по классификатору. Показывает «код — наименование», хранит код. */
export const ClassifierLookup: FC<Props> = ({ type, label, name, value, displayName, onChange, disabled, width }) => {
	const [text, setText] = useState("");
	const [open, setOpen] = useState(false);
	const [debounced, setDebounced] = useState("");
	const boxRef = useRef<HTMLDivElement>(null);

	// Текст поля: при закрытом списке — «код — наименование», иначе — ввод пользователя.
	const displayValue = open ? text : (value ? `${value}${displayName ? ` — ${displayName}` : ""}` : "");

	useEffect(() => {
		const t = setTimeout(() => setDebounced(text.trim()), 250);
		return () => clearTimeout(t);
	}, [text]);

	const { data } = useQuery({
		queryKey: ["classifier-lookup", type, debounced],
		queryFn: async () => (await fetchClassifiers(type, debounced, undefined, 20)).items,
		enabled: open,
		staleTime: 60_000,
	});
	const items: ClassifierItem[] = data ?? [];

	// Клик вне — закрыть.
	useEffect(() => {
		if (!open) return;
		const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
		document.addEventListener("mousedown", onDoc);
		return () => document.removeEventListener("mousedown", onDoc);
	}, [open]);

	const pick = (it: ClassifierItem) => { onChange(it.code, it.name); setOpen(false); setText(""); };

	const openList = () => { if (!disabled && !open) { setText(""); setOpen(true); } };

	return (
		<div className={styles.Wrap} ref={boxRef} onClick={openList} style={width ? { width } : undefined}>
			<Field
				label={label}
				name={name}
				value={displayValue}
				disabled={disabled}
				onChange={(e) => { setText(e.target.value); if (!open) setOpen(true); }}
			/>
			{open && items.length > 0 && (
				<ul className={styles.List}>
					{items.map((it) => (
						<li key={it.code} className={styles.Item} onMouseDown={() => pick(it)}>
							<span className={styles.Code}>{it.code}</span> {it.name}
						</li>
					))}
				</ul>
			)}
		</div>
	);
};

export default ClassifierLookup;
