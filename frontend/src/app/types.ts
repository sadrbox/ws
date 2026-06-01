import { SetStateAction, Dispatch, FC } from "react";
import { TDataItem } from "src/components/Table/types";
import type { OrgEntry } from "src/services/auth";
// import { OverlayProps } from ".";

export type TypeAppContextProps = {
	screenRef: React.RefObject<HTMLDivElement | null>;
	windows: {
		panes: TPane[];
		activePane: string | null;
		addPane: (pane: Partial<TPane>) => void;
		/** Закрытие панели.
		 *  По умолчанию (force=false) — проверяет beforeClose guards (используется из UI).
		 *  force=true — принудительно, без guards (используется после сохранения). */
		requestClose: (
			uniqId: string,
			options?: { force?: boolean },
		) => Promise<void>;
		reloadPane: (uniqId: string) => Promise<void>;
		setActivePane: (uniqId: string) => void;
		updatePaneLabel: (uniqId: string, label: string) => void;
		/** Регистрирует guard-функцию, которая будет вызвана перед закрытием панели.
		 *  Возвращает unregister-функцию. Guard возвращает true = можно закрыть, false = отмена. */
		registerBeforeClose: (
			uniqId: string,
			guard: () => Promise<boolean> | boolean,
		) => () => void;
	};
	actions: {
		confirm: (message: string) => Promise<boolean>;
	};
	navbar: {
		props: TypeNavbarProps[];
		setProps: Dispatch<SetStateAction<TypeNavbarProps[]>>;
	};
	auth: {
		user: {
			uuid: string;
			username: string;
			email?: string | null;
			organizationUuid?: string | null;
			isSuperAdmin?: boolean;
			allowedOrgUuids?: string[];
			userPermissions?: OrgEntry[];
			accessRights?: { modelName: string; accessLevel: string }[];
			employee?: {
				uuid: string;
				fullName: string | null;
				firstName?: string | null;
				lastName?: string | null;
				middleName?: string | null;
				iin?: string | null;
				avatarPath?: string | null;
				organizationUuid?: string | null;
				organization?: { uuid: string; name: string; bin?: string } | null;
				accessRights?: { modelName: string; accessLevel: string }[];
			} | null;
		} | null;
		logout: () => void;
	};
};

export type TypeNavbarProps = {
	id: string;
	isActive: boolean;
	title: string;
	component: React.ReactNode;
};

export type TPane = {
	component: TComponentNode;
	uniqId: string;
	label: string;
	/** Сид данных панели/формы. Может быть неполным (например только { uuid }
	 *  при открытии формы по ссылке), поэтому Partial, а не полный TDataItem. */
	data?: Partial<TDataItem>;
	onSave?: () => void | Promise<void>;
	onClose?: () => void | Promise<void>;
	/** Панель является формой выбора (selector) — приоритетная, требует результат */
	isSelector?: boolean;
	/** Callback при выборе элемента в selector-панели */
	onSelectResult?: (item: Record<string, any>) => void;
	/** ID selector-панели, из которой была открыта эта дочерняя панель */
	selectorPaneId?: string;
	/** ID панели-открывателя (была активна в момент открытия этой панели).
	 *  При закрытии этой панели активируется опидатель (если ещё открыт) —
	 *  напр. возврат к форме, из поля «Основание» которой открыли документ. */
	openerPaneId?: string;
};

export type TComponentNode =
	| FC<any>
	| null
	| undefined
	| React.ComponentType<any>;

// export type TPaneProps = {
// 	onSave?: () => void;
// 	onClose?: () => void;
// };
// export type TOpenPaneProps = {
// 	/** Заголовок панели */
// 	label: string;
// 	/** Компонент, который будет отрендерен внутри панели */
// 	component: TComponentNode;
// 	/** Пропсы для компонента */
// 	props?: Record<string, unknown | {}>;
// 	/** Ширина панели (px или %) */
// 	width?: number | string;
// 	/** С какой стороны открывать */
// 	position?: "left" | "right";
// 	/** Можно ли закрыть панель (крестик, Esc) */
// 	closable?: boolean;
// 	/** Колбэк при закрытии */
// 	onClose?: () => void;
// 	// component: TComponentNode;
// 	// label?: string;
// 	// data?: TDataItem;
// 	// props?: TPaneProps;
// };
export type TOpenModelFormProps = Partial<TPane>;

// export type TOpenFormProps = Partial<TPane>;
