import {
	ReactNode,
	SetStateAction,
	Dispatch,
	ReactElement,
	ComponentType,
	JSX,
	ComponentClass,
	FunctionComponent,
	FC,
} from "react";
import { TDataItem } from "src/components/Table/types";
// import { OverlayProps } from ".";

export type TypeAppContextProps = {
	screenRef: React.RefObject<HTMLDivElement | null>;
	windows: {
		panes: TPane[];
		activePane: string | null;
		addPane: (pane: Partial<TPane>) => void;
		removePane: (uniqId: string) => void;
		/** Закрытие панели с проверкой beforeClose guard-ов. Если guard вернул false — закрытие отменяется. */
		requestClose: (uniqId: string) => Promise<void>;
		setActivePane: (uniqId: string) => void;
		updatePaneLabel: (uniqId: string, label: string) => void;
		/** Регистрирует guard-функцию, которая будет вызвана перед закрытием панели.
		 *  Возвращает unregister-функцию. Guard возвращает true = можно закрыть, false = отмена. */
		registerBeforeClose: (uniqId: string, guard: () => Promise<boolean> | boolean) => () => void;
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
				organization?: { uuid: string; shortName: string; bin?: string } | null;
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
	data?: TDataItem;
	onSave?: () => void;
	onClose?: () => void;
	/** Панель является формой выбора (selector) — приоритетная, требует результат */
	isSelector?: boolean;
	/** Callback при выборе элемента в selector-панели */
	onSelectResult?: (item: Record<string, any>) => void;
	/** ID selector-панели, из которой была открыта эта дочерняя панель */
	selectorPaneId?: string;
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
