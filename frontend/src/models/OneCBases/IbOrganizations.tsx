/**
 * «Организации» в карточке базы 1С (28.09): организации самой базы — с полным набором реквизитов, отметкой «Основная»
 * и связью со справочником «Организации» ERP.
 *
 * ОТКУДА. Организации читает агент кластера у самой базы по кнопке «Обновить» (`IB_LIST_ORGANIZATIONS`) — тем же
 * механизмом, что пользователей и расширения (useBaseContentCheck): операция видна в «Прогрессе запросов и команд»,
 * итог приходит сообщением. Карточка открывается кэшем реестра сервиса, возраст данных — в колонке «Прочитано».
 *
 * «ОСНОВНАЯ» — ТОЛЬКО ПОКАЗ. Источник правды — сама база, и меняют её в 1С; панель её не назначает. В Бухгалтерии для
 * Казахстана основная организация — настройка пользователя, поэтому агент выводит её по правилу и называет источник
 * (единственная, константа расширения BuhProf, общая у пользователей) — вкладка пишет его строкой под подсказкой.
 * Показана не колонкой, а как основная запись вложенных «Контактов» (28.09): строка полужирная, а звёздочка на панели
 * таблицы горит, когда курсор на основной; щелчок по ней переводит курсор к основной.
 *
 * СТРОКА ОТКРЫВАЕТСЯ КАРТОЧКОЙ «Организация базы 1С» (IbOrganizationForm): все реквизиты полями, ссылки на объекты
 * ERP — LookupField-ами, уже заполненными найденным; организация ERP открывается из её поля «Организация ERP».
 *
 * НЕПОЛНОЕ ЧТЕНИЕ. Блок реквизитов (контакты, ответственные лица, счета) агент читает одним запросом на базу; не
 * прочитался — сервис держит прежние значения этих реквизитов, а вкладка говорит, что показанное частично старое.
 *
 * СВЯЗЬ С ERP — ПО БИН. Сервис ищет организацию ERP с тем же БИН при каждом чтении кэша, поэтому заведённая в ERP позже
 * связывается сама. Нет такой — администратор BuhProf создаёт её здесь из реквизитов 1С: тот же путь, что «Создать
 * организацию» в одобрении заявки на подключение (ERP, `POST /organizations/from-onec`).
 */
import { FC, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { translate } from "src/i18";
import { useAppActions, useAppAuth } from "src/app/context";
import SubTable from "src/components/SubTable";
import { useSubTableContext } from "src/components/SubTable/context";
import { useTableContext, useTableVolatile } from "src/components/Table";
import { Button } from "src/components/Button";
import { showToast } from "src/components/UIToast";
import { useRunningCommand } from "src/components/TechMessages/operations";
import { reportError } from "src/services/errors/route";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { asText } from "src/utils/asText";
import Notice from "src/components/Notice";
import { fetchBaseOrganizationsCached, type IbOrganization, type IbOrganizationsList } from "src/services/onec/api";
import { createOrganizationFromOnec } from "src/services/onec/orgFromOnec";
import { useBaseContentCheck } from "src/models/OneCAdmin/shared";
import { Toolbar } from "src/components/Toolbar";
import IbOrganizationForm from "./IbOrganizationForm";
import { QueryError } from "src/models/OneCAdmin/sharedUi";
import admin from "src/models/OneCAdmin/OneCAdmin.module.scss";
import { ibOrganizationRows, keyedOrganizations, mainSourceText, organizationNotes, type IbOrgRow } from "./ibOrganizationsView";

const COMPONENT = "OneCBases_orgs";

/*
 * Идентификатор колонки — ключ перевода её заголовка (getTranslateColumn). Только то, по чему организацию узнают
 * (28.09); счета, ответственные лица, договоры и контакты — вкладками карточки «Организация базы 1С».
 */
const COLUMNS = ([
	{ identifier: "name", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "binIin", type: "string", width: "140px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecReqErpOrg", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "legalName", type: "string", width: "340px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	// Когда это читали у самой 1С: таблица наполняется кэшем, и её возраст — часть данных.
	{ identifier: "seenAtLabel", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/**
 * Строки таблицы и активная строка — из контекста вложенной таблицы, как у кнопки «Сделать основным» вложенных
 * «Контактов» (PrimaryToolbarButton): кнопки тулбара живут внутри таблицы и знают её курсор сами.
 */
function useTableRows(): { rows: IbOrgRow[]; active: IbOrgRow | null; setActive: (id: number) => void } {
	const table = useTableContext();
	const sub = useSubTableContext();
	const { activeRow } = useTableVolatile();
	const rows = (sub?.rows ?? table.rows) as IbOrgRow[];
	return {
		rows,
		active: activeRow != null ? rows.find((r) => r.id === activeRow) ?? null : null,
		setActive: table.states.setActiveRow,
	};
}

/**
 * ЗВЁЗДОЧКА — ИНДИКАТОР, А НЕ КОМАНДА. Горит, когда курсор на основной организации (как «Сделать основным» у
 * вложенных «Контактов» с курсором на основной записи). Назначить основную здесь нельзя — её меняют в 1С; щелчок
 * переводит курсор к основной.
 */
const MainOrgIndicator: FC = () => {
	const { rows, active, setActive } = useTableRows();
	const mainRow = rows.find((r) => r.isPrimary) ?? null;
	const title = !active
		? translate("onecOrgMainPick")
		: active.isPrimary
			? translate("onecOrgIsMainHint")
			: mainRow ? translate("onecOrgNotMainHint") : translate("onecOrgNoMainHint");
	return (
		<Toolbar.MakePrimaryButton active={!!active?.isPrimary} aria-pressed={!!active?.isPrimary}
			disabled={!active} title={title}
			onClick={() => { if (mainRow) setActive(mainRow.id); }} />
	);
};

/** «Создать организацию» — для строки под курсором, у которой в ERP организации с этим БИН нет. */
const CreateErpOrgButton: FC<{ pending: boolean; onCreate: (row: IbOrgRow) => void }> = ({ pending, onCreate }) => {
	const { active } = useTableRows();
	return (
		<Button disabled={!active?.__erpMissing || pending}
			title={active && !active.__bin ? translate("onecOrgNoBinHint") : undefined}
			onClick={() => { if (active) onCreate(active); }}>
			{translate("onecReqOrgCreate")}
		</Button>
	);
};

export const IbOrganizationsTab: FC<{ baseKey: string }> = ({ baseKey }) => {
	const qc = useQueryClient();
	const { windows: { addPane }, actions: { confirm } } = useAppActions();
	// Организацию ERP из реквизитов 1С создаёт только администратор BuhProf — так же, как в одобрении заявки.
	const isSuperAdmin = !!useAppAuth().user?.isSuperAdmin;
	const check = useBaseContentCheck("organizations");
	// Чтение могло начаться до перезагрузки страницы — иконка крутится до итога.
	const reading = useRunningCommand(["IB_LIST_ORGANIZATIONS"], baseKey);

	// Запрос в 1С не ходит: только кэш реестра, который наполняет «Обновить» (см. BaseContentKind).
	const orgs = useQuery({
		queryKey: ["onec", "base-orgs", baseKey],
		queryFn: (): Promise<IbOrganizationsList> => fetchBaseOrganizationsCached(baseKey),
		enabled: !!baseKey,
		staleTime: Infinity,
	});
	const items = useMemo(() => orgs.data?.items ?? [], [orgs.data]);
	const mainSource = mainSourceText(items, orgs.data?.mainSource);
	const notes = organizationNotes(orgs.data?.notes);
	const rows = useMemo(() => ibOrganizationRows(items), [items]);
	const keyed = useMemo(() => keyedOrganizations(items), [items]);

	/** Карточка «Организация базы 1С»: в данных панели — только ключи, сама организация берётся из того же кэша. */
	const openOrg = (row: TDataItem) => addPane({
		label: `${translate("onecBaseOrgForm")}: ${asText(row.name) || asText(row.uuid)}`,
		component: IbOrganizationForm as never,
		data: { baseKey, orgKey: asText(row.uuid) } as never,
	});

	const refresh = () => {
		void qc.invalidateQueries({ queryKey: ["onec", "base-orgs", baseKey] });
		void qc.invalidateQueries({ queryKey: ["onec", "erp-organizations"] });
	};
	const create = useMutation({
		mutationFn: (o: IbOrganization & { bin: string }) =>
			createOrganizationFromOnec({ bin: o.bin, name: o.name || null, details: o.details ?? null }),
		onSuccess: (d, o) => {
			showToast(`${translate("onecReqOrgCreated")}: ${d.item.name ?? o.bin}`, "success");
			refresh();
		},
		onError: (e) => {
			// Организацию успели завести (другой администратор, вторая вкладка) — связь появится после перечитывания.
			if (isAxiosError(e) && e.response?.status === 409) refresh();
			reportError(e, { source: translate("onecBaseOrgsSource") });
		},
	});
	const startCreate = async (row: IbOrgRow) => {
		const org = keyed.find((x) => x.key === row.uuid)?.org ?? null;
		const bin = row.__bin;
		if (!org || !bin || create.isPending) return;
		const ok = await confirm(translate("onecOrgCreateConfirm").replace("{name}", org.name || bin).replace("{bin}", bin));
		if (ok) create.mutate({ ...org, bin });
	};

	// Почему таблица пуста — в ней самой: «организаций нет» и «их ещё не читали» — разные ответы.
	const emptyText = !orgs.isLoading && !orgs.error && !rows.length ? translate("onecOrgsNeverRead") : undefined;

	return (
		<>
			<div className={admin.Hint}>{translate("onecOrgsHint")}</div>
			{mainSource && <div className={admin.Hint}>{mainSource}</div>}
			{/* Почему отметки нет — если агент не смог прочитать сам источник (константу расширения, настройки пользователей). */}
			{notes.main && <div className={admin.Hint}>{`${translate("onecOrgMainNotRead")}: ${notes.main}`}</div>}
			{notes.details && (
				<Notice inline items={[{ type: "attention", text: `${translate("onecOrgsPartialRead")}: ${notes.details}` }]} />
			)}
			<QueryError error={orgs.error} noticeKey="base-orgs" source={translate("onecBaseOrgsSource")} />
			{/*
			  * ВЛОЖЕННАЯ ТАБЛИЦА (SubTable, 28.09): организации — табличная часть карточки базы, а не журнал. Строки читает
			  * агент, а не ERP, — SubTable получает их готовыми (`items`). Основная организация — полужирной строкой, как
			  * основная запись вложенных «Контактов». Править в строке нечего — переключателя режима нет.
			  */}
			<SubTable model="" parentKey="" parentUuid="" items={rows} itemsLoading={orgs.isLoading}
				componentName={COMPONENT} columnsJson={COLUMNS}
				// Порядок — как у ibOrganizationRows (основная первой); сортирует человек щелчком по заголовку.
				defaultSort={{}}
				defaultInlineEditing={false} showEditModeToggle={false} hideAddDelete disableAdd disableDelete selectable={false}
				emptyText={emptyText}
				// «Обновить» = войти в базу и прочитать организации у самой 1С; таблица при этом не гаснет.
				onRefresh={() => void check.run([baseKey])}
				reloading={check.checking || reading}
				reloadTitle={translate("onecOrgsCheck")}
				/*
				 * ЗНАЧЕНИЕ ЯЧЕЙКИ — ТЕКСТОМ (28.09): ссылка-кнопка (ObjectLink) в ячейке не давала выделить и скопировать
				 * имя организации ERP. Открывают её из карточки «Организация базы 1С» — полем-ссылкой.
				 */
				renderCell={(r, column) => {
					if (column.identifier === "onecReqErpOrg") return r.__erpMissing ? <span className={admin.ReqWait}>{asText(r.onecReqErpOrg)}</span> : undefined;
					return column.identifier === "binIin" && r.__bin ? <span className={admin.Mono}>{asText(r.binIin)}</span> : undefined;
				}}
				// Двойной щелчок и Enter — карточка «Организация базы 1С».
				openFormFor={(row) => { if (row) openOrg(row); }}
				extraButtons={(
					<>
						<MainOrgIndicator />
						{isSuperAdmin && <CreateErpOrgButton pending={create.isPending} onCreate={(row) => void startCreate(row)} />}
					</>
				)} />
		</>
	);
};

export default IbOrganizationsTab;
