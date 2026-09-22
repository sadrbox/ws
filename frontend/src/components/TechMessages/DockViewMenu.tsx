/**
 * Выбор вида области-спутника — заголовком, а не полем ввода.
 *
 * ПОЧЕМУ НЕ СПИСОК (FieldSelect). Сначала здесь стоял обычный `<select>`, и он честно работал,
 * но читался как поле формы: рамка, стрелка, высота поля ввода — будто в шапке что-то вводят.
 * А это ЗАГОЛОВОК области: он называет то, что под ним. Поэтому кнопка выглядит заголовком —
 * полужирным текстом без рамки — и лишь по наведению и при открытом меню показывает, что её
 * можно нажать.
 *
 * МЕНЮ — В ПОРТАЛЕ, как у переключателя организаций (OrgSwitcher). Область бывает шириной в
 * 280 пикселей и стоит у самого края экрана; меню, нарисованное внутри неё, обрезалось бы её
 * границами и прокруткой тела. Портал в body от этого свободен, а позицию пересчитываем при
 * прокрутке и изменении размера окна — иначе меню «отклеится» от кнопки.
 */
import { FC, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "src/components/IconButton/icons";
import { translate } from "src/i18";
import { setTechDockView, TECH_DOCK_TITLES, TECH_DOCK_VIEWS, useTechDockView, type TechDockView } from "./store";
import styles from "./DockViewMenu.module.scss";

export const DockViewMenu: FC = () => {
	const view = useTechDockView();
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
	const btnRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	/*
	 * Позиция меню — под кнопкой и по её левому краю: заголовок стоит слева, и меню
	 * разворачивается оттуда же, а не из противоположного угла.
	 *
	 * МЕНЮ ХОДИТ ЗА КНОПКОЙ. Оно лежит в портале и позиционируется координатами экрана, а
	 * кнопка успевает уехать: область тянут разделителем, переносят вниз, меняют ширину окна.
	 * Подписки на `scroll` и `resize` этого не ловят — при перетаскивании разделителя не
	 * происходит ни того, ни другого: меняется лишь раскладка внутри окна.
	 *
	 * Поэтому пока меню открыто, положение кнопки перечитывается каждый кадр. Это один
	 * `getBoundingClientRect` в кадре и только на время, пока меню на экране; состояние
	 * меняется, лишь когда координаты действительно поехали, — лишних отрисовок нет.
	 */
	useEffect(() => {
		if (!open) { setPos(null); return; }
		let frame = 0;
		let last = "";
		const follow = () => {
			const el = btnRef.current;
			if (el) {
				const r = el.getBoundingClientRect();
				const next = { top: r.bottom + 3, left: Math.max(6, r.left), minWidth: Math.max(r.width, 180) };
				const key = `${next.top}|${next.left}|${next.minWidth}`;
				if (key !== last) {
					last = key;
					setPos(next);
				}
			}
			frame = requestAnimationFrame(follow);
		};
		follow();
		return () => cancelAnimationFrame(frame);
	}, [open]);

	// Закрытие по щелчку вне кнопки и меню (меню в портале — проверяем оба узла).
	useEffect(() => {
		if (!open) return;
		const away = (e: MouseEvent) => {
			const t = e.target as Node;
			if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
		};
		// Escape закрывает, не трогая выбор: передумать — обычное дело.
		const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
		// Окно потеряло фокус (переключились в другое приложение, открылся диалог браузера) —
		// меню закрывается: висящий поверх список, о котором забыли, только мешает.
		const blur = () => setOpen(false);
		document.addEventListener("mousedown", away);
		document.addEventListener("keydown", esc);
		window.addEventListener("blur", blur);
		return () => {
			window.removeEventListener("blur", blur);
			document.removeEventListener("mousedown", away);
			document.removeEventListener("keydown", esc);
		};
	}, [open]);

	const choose = useCallback((v: TechDockView) => {
		setTechDockView(v);
		setOpen(false);
		// Возвращаем фокус на заголовок: после выбора он и есть «где я нахожусь».
		btnRef.current?.focus();
	}, []);

	const title = translate(TECH_DOCK_TITLES[view]);

	return (
		<>
			<button
				ref={btnRef}
				type="button"
				className={styles.Trigger}
				aria-haspopup="listbox"
				aria-expanded={open}
				title={translate("techDockViewHint")}
				onClick={() => setOpen((p) => !p)}
			>
				{/*
				  * Стрелка — та же, что у сворачивания области и у заголовков групп в журнале
				  * (caretDown): одна стрелка на всё приложение, разный только поворот. Открытое
				  * меню поворачивает её вверх — туда, куда список уедет при закрытии.
				  */}
				<span className={styles.Chevron} data-open={open || undefined}>
					<Icon name="caretDown" />
				</span>
				<span className={styles.Label}>{title}</span>

			</button>

			{open && pos && createPortal(
				<div
					ref={menuRef}
					className={styles.Menu}
					role="listbox"
					aria-label={translate("techDockViewHint")}
					style={{ position: "fixed", top: pos.top, left: pos.left, minWidth: pos.minWidth }}
				>
					{TECH_DOCK_VIEWS.map((v) => (
						<button
							key={v}
							type="button"
							role="option"
							aria-selected={v === view}
							className={v === view ? `${styles.Item} ${styles.Active}` : styles.Item}
							onClick={() => choose(v)}
						>
							<span className={styles.ItemName}>{translate(TECH_DOCK_TITLES[v])}</span>
							{v === view && <span className={styles.Check} aria-hidden="true">✓</span>}
						</button>
					))}
				</div>,
				document.body,
			)}
		</>
	);
};

DockViewMenu.displayName = "DockViewMenu";
export default DockViewMenu;
