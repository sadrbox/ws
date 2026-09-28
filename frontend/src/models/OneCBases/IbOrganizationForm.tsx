/**
 * «Организация базы 1С» — карточка одной организации из вкладки «Организации» карточки базы (28.09).
 *
 * ЧТО ЗДЕСЬ. Все реквизиты, прочитанные агентом у самой базы (`IB_LIST_ORGANIZATIONS`). Шапка — полями: наименования,
 * БИН, НДС, ОКЭД и связь с организацией ERP. Табличные части — вкладками «Банковские счета», «Договоры», «Контактные
 * лица», «Контакты»: SubTable над строками из кэша сервиса (`items`). Колонки — главные значения 1С одной строкой и
 * ссылка на объект ERP; поле-ссылка — в режиме «Редактирование в таблице», как у любой табличной части; двойной
 * щелчок или Enter — карточка строки со всеми реквизитами (IbOrgPartCard). Правит реквизиты 1С, поэтому они только
 * показываются.
 *
 * ПОЛЕ-ССЫЛКА ОТКРЫВАЕТСЯ ЗАПОЛНЕННЫМ: в нём уже найденный объект ERP (правила — ibOrganizationFormView); его можно
 * открыть, а если его нет — «Создать» заведёт объект ERP, заполненный из 1С, и вернёт его в поле.
 *
 * СВЯЗЬ НЕ ХРАНИТСЯ. Организацию с организацией ERP связывает сервис по БИН при каждом чтении кэша, остальное — эта
 * форма при открытии. Выбор в поле действует в открытой карточке: по выбранной организации ERP ищутся её счета,
 * договоры, контактные лица и контакты, и ей же достаются созданные здесь объекты. Кнопок записи у формы нет.
 *
 * ДАННЫЕ ПАНЕЛИ — СЕРИАЛИЗУЕМЫЕ: только ключ базы и ключ строки (памятка reference_lookup_write_back). Организация
 * берётся из того же кэша реестра, что и вкладка: карточка открывается мгновенно и не расходится с таблицей.
 */
import { FC, useCallback, useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { translate } from "src/i18";
import { useAppActions, useAppAuth } from "src/app/context";
import ModelForm from "src/components/ModelForm";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import FieldToggle from "src/components/Field/FieldToggle";
import LookupField, { type LookupExtraAction } from "src/components/Field/LookupField";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import Notice from "src/components/Notice";
import SubTable from "src/components/SubTable";
import { showToast } from "src/components/UIToast";
import type { TColumn } from "src/components/Table/types";
import main from "src/styles/main.module.scss";
import { api } from "src/services/api/client";
import { reportError } from "src/services/errors/route";
import { fetchBaseOrganizationsCached, type IbOrganization } from "src/services/onec/api";
import { createOrganizationFromOnec } from "src/services/onec/orgFromOnec";
import { QueryError } from "src/models/OneCAdmin/sharedUi";
import { asText } from "src/utils/asText";
import { getFormatDate, getFormatDateOnly } from "src/utils/datetime";
import type { TPane } from "src/app/types";
import { keyedOrganizations } from "./ibOrganizationsView";
import IbOrgPartCard, { OnecField } from "./IbOrgPartCard";
import {
	NO_REF, accountRows, bankAccountCreateDefaults, contactCreateDefaults, contactPersonCreateDefaults, contactRows,
	contractCreateDefaults, contractRows, erpOrganizationRef, matchBankAccount, matchContact, matchContactPerson,
	matchContract, matchCounterparty, matchCurrency, organizationCreateDefaults, personRows,
	type AccountRow, type ContactRow, type ContractRow, type ErpBankAccount, type ErpContact, type ErpContactPerson,
	type ErpContract, type ErpCounterparty, type ErpCurrency, type ErpRef, type OrgPartCardData, type OrgPartRow, type PersonRow,
} from "./ibOrganizationFormView";

type ListResponse<T> = { items?: T[] };

/**
 * Колонки табличной части: главные значения 1С и ссылка на объект ERP. Идентификатор — ключ перевода заголовка
 * (getTranslateColumn) и поле строки.
 */
const col = (identifier: string, width: string): TColumn =>
	({ identifier, type: "string", width, minWidth: "100px", alignment: "left", visible: true, inlist: true }) as unknown as TColumn;
const ACCOUNT_COLUMNS = [col("name", "280px"), col("iban", "240px"), col("onecOrgAccountErp", "300px")];
const CONTRACT_COLUMNS = [col("name", "280px"), col("contractNumber", "140px"), col("date", "110px"), col("counterparty", "240px"), col("onecOrgContractErp", "280px")];
const PERSON_COLUMNS = [col("fullName", "260px"), col("role", "180px"), col("onecOrgPosition", "200px"), col("onecOrgContactPersonErp", "280px")];
const CONTACT_COLUMNS = [col("contactType", "180px"), col("value", "320px"), col("onecOrgContactErp", "300px")];

/** Список ERP для сопоставления: отказ в правах или сети оставляет поля-ссылки пустыми, а не ломает карточку. */
const erpList = <T,>(url: string, params: Record<string, unknown>) => () => api.get<ListResponse<T>>(url, { params });

const IbOrganizationFormBody: FC<Partial<TPane>> = (paneProps) => {
	const data = (paneProps.data ?? {}) as { baseKey?: string; orgKey?: string };
	const baseKey = asText(data.baseKey);
	const orgKey = asText(data.orgKey);
	const uid = useId();
	const qc = useQueryClient();
	const { windows: { requestClose, addPane }, actions: { confirm } } = useAppActions();
	const isSuperAdmin = !!useAppAuth().user?.isSuperAdmin;
	const close = useCallback(() => { if (paneProps.uniqId) void requestClose(paneProps.uniqId); }, [requestClose, paneProps.uniqId]);

	// Тот же ключ, что у вкладки «Организации»: кэш общий, и «Обновить» там сразу видно здесь.
	const orgs = useQuery({
		queryKey: ["onec", "base-orgs", baseKey],
		queryFn: () => fetchBaseOrganizationsCached(baseKey),
		enabled: !!baseKey,
		staleTime: Infinity,
	});
	const org: IbOrganization | null = useMemo(
		() => keyedOrganizations(orgs.data?.items ?? []).find((x) => x.key === orgKey)?.org ?? null,
		[orgs.data, orgKey],
	);
	const d = org?.details ?? null;
	const accounts = useMemo(() => accountRows(d), [d]);
	const contracts = useMemo(() => contractRows(d), [d]);
	const persons = useMemo(() => personRows(d), [d]);
	const contacts = useMemo(() => contactRows(d), [d]);

	/*
	 * ВЫБРАННОЕ В ПОЛЯХ — поверх найденного. Пока человек поле не трогал, в нём найденный объект; выбрал другой или
	 * создал новый — стоит выбранный. Ключ — реквизит: «org», «acc:<IBAN>», «contract:<ключ>», «person:<роль>»…
	 */
	const [picked, setPicked] = useState<Record<string, ErpRef>>({});
	const pick = (key: string) => (uuid: string, name: string) => setPicked((p) => ({ ...p, [key]: { uuid, name } }));
	const refOf = (key: string, found: ErpRef): ErpRef => picked[key] ?? found;

	const erpOrg = refOf("org", org ? erpOrganizationRef(org) : NO_REF);
	const owner = { ownerType: "organization", ownerUuid: erpOrg.uuid, limit: 500 };
	const hasOrg = !!erpOrg.uuid;

	// Справочники ERP для сопоставления — только когда есть что сопоставлять.
	const currencies = useQuery({
		queryKey: ["onec", "org-form", "currencies"],
		queryFn: erpList<ErpCurrency>("/currencies", { limit: 500 }),
		enabled: accounts.some((a) => !!a.account.currency), staleTime: 60_000,
	});
	const erpAccounts = useQuery({
		queryKey: ["onec", "org-form", "bankaccounts", erpOrg.uuid],
		queryFn: erpList<ErpBankAccount>("/bankaccounts", owner),
		enabled: hasOrg && accounts.length > 0, staleTime: 30_000,
	});
	const erpContracts = useQuery({
		queryKey: ["onec", "org-form", "contracts", erpOrg.uuid],
		queryFn: erpList<ErpContract>("/contracts", { organizationUuid: erpOrg.uuid, limit: 500 }),
		enabled: hasOrg && contracts.length > 0, staleTime: 30_000,
	});
	// Контрагенты организации ERP — чтобы «Создать» договора подставил контрагента по БИН.
	const erpCounterparties = useQuery({
		queryKey: ["onec", "org-form", "counterparties", erpOrg.uuid],
		queryFn: erpList<ErpCounterparty>("/counterparties", { filter: { organizationUuid: { equals: erpOrg.uuid } }, limit: 500 }),
		enabled: hasOrg && contracts.length > 0, staleTime: 30_000,
	});
	const erpPersons = useQuery({
		queryKey: ["onec", "org-form", "contactpersons", erpOrg.uuid],
		queryFn: erpList<ErpContactPerson>("/contactpersons", owner),
		enabled: hasOrg && persons.length > 0, staleTime: 30_000,
	});
	const erpContacts = useQuery({
		queryKey: ["onec", "org-form", "contacts", erpOrg.uuid],
		queryFn: erpList<ErpContact>("/contacts", owner),
		enabled: hasOrg && contacts.length > 0, staleTime: 30_000,
	});
	const erpError = erpAccounts.error ?? erpContracts.error ?? erpPersons.error ?? erpContacts.error ?? currencies.error;

	/*
	 * «СОЗДАТЬ ИЗ РЕКВИЗИТОВ 1С» у поля организации — тот же путь, что кнопка вкладки и одобрение заявки (ERP,
	 * `POST /organizations/from-onec`): организация сразу с контактами, контактными лицами и счетами. Только
	 * администратору BuhProf — маршрут пишет четыре вида записей (см. backend organizations.js). Обычное «Создать»
	 * в поле остаётся всем, у кого есть право: откроет форму организации, заполненную из 1С.
	 */
	const bin = org?.bin?.trim() || "";
	const fromOnec = useMutation({
		mutationFn: () => createOrganizationFromOnec({ bin, name: org?.name || null, details: d }),
		onSuccess: (r) => {
			showToast(`${translate("onecReqOrgCreated")}: ${r.item.name ?? bin}`, "success");
			pick("org")(r.item.uuid, r.item.name ?? bin);
			void qc.invalidateQueries({ queryKey: ["onec", "base-orgs", baseKey] });
		},
		onError: (e) => {
			if (isAxiosError(e) && e.response?.status === 409) void qc.invalidateQueries({ queryKey: ["onec", "base-orgs", baseKey] });
			reportError(e, { source: translate("onecBaseOrgForm") });
		},
	});
	const startFromOnec = async () => {
		if (!org || !bin || fromOnec.isPending) return;
		const ok = await confirm(translate("onecOrgCreateConfirm").replace("{name}", org.name || bin).replace("{bin}", bin));
		if (ok) fromOnec.mutate();
	};
	const orgExtra: LookupExtraAction[] | undefined = isSuperAdmin ? [{
		id: "fromOnec", icon: "plus", label: translate("onecOrgCreateFromOnec"),
		onClick: () => void startFromOnec(),
		hidden: !!erpOrg.uuid, disabled: !bin, loading: fromOnec.isPending,
	}] : undefined;

	/*
	 * СВЯЗИ СТРОК ТАБЛИЧНЫХ ЧАСТЕЙ: для каждой — найденный объект ERP (поверх — выбранный в поле) и заполнение «Создать».
	 * Считаются здесь, а не в ячейке: двойной щелчок по строке открывает тот же объект, что показан в её поле.
	 */
	const accountLink = (r: AccountRow) => {
		const a = r.account;
		const cur = matchCurrency(currencies.data?.items ?? [], a.currency);
		const curItem = (currencies.data?.items ?? []).find((x) => x.uuid === cur.uuid);
		return {
			key: `acc:${r.uuid}`,
			ref: refOf(`acc:${r.uuid}`, matchBankAccount(erpAccounts.data?.items ?? [], a.iban)),
			create: bankAccountCreateDefaults(a, d?.kbe, { ...cur, title: curItem ? `${curItem.code} — ${curItem.name ?? ""}`.trim() : cur.name }, erpOrg),
		};
	};
	const contractLink = (r: ContractRow) => ({
		key: `contract:${r.uuid}`,
		ref: refOf(`contract:${r.uuid}`, matchContract(erpContracts.data?.items ?? [], r.contract)),
		create: contractCreateDefaults(r.contract, erpOrg, matchCounterparty(erpCounterparties.data?.items ?? [], r.contract.counterparty?.bin)),
	});
	const personLink = (r: PersonRow) => ({
		key: `person:${r.key}`,
		ref: refOf(`person:${r.key}`, matchContactPerson(erpPersons.data?.items ?? [], r.person.fullName)),
		create: contactPersonCreateDefaults(r.person, r.role, erpOrg),
	});
	const contactLink = (r: ContactRow) => ({
		key: `contact:${r.uuid}`,
		ref: refOf(`contact:${r.uuid}`, matchContact(erpContacts.data?.items ?? [], r.kind, r.value)),
		create: contactCreateDefaults(r.kind, r.value, erpOrg),
	});

	/*
	 * ТАБЛИЧНАЯ ЧАСТЬ — SubTable над строками 1С (`items`). В строку кладётся ссылка на объект ERP (найденный или
	 * выбранный): колонка ERP показывает её подпись, а в режиме «Редактирование в таблице» — LookupField. Выбор в поле
	 * меняет выбранное в карточке, новые строки приходят в SubTable — как ответ сервера после записи. Двойной щелчок и
	 * Enter (режим «через форму») — карточка строки со всеми реквизитами 1С и тем же полем-ссылкой.
	 */
	const part = <R extends OrgPartRow>(p: {
		component: string; rows: R[]; columns: TColumn[]; erpId: string; kind: string;
		endpoint: string; displayField: string; extraParams?: Record<string, string>;
		link: (r: R) => { key: string; ref: ErpRef; create: Record<string, string> };
		emptyText: string;
	}) => {
		const items = p.rows.map((r) => {
			const l = p.link(r);
			return { ...r, [p.erpId]: l.ref.name, __erpUuid: l.ref.uuid, __key: l.key, __create: l.create };
		});
		type Item = (typeof items)[number];
		const openCard = (row: Item) => {
			const data: OrgPartCardData = {
				kind: translate(p.kind), title: row.title, fields: row.card,
				erp: {
					label: translate(p.erpId), endpoint: p.endpoint, displayField: p.displayField,
					value: { uuid: row.__erpUuid, name: asText(row[p.erpId]) },
					...(p.extraParams ? { extraParams: p.extraParams } : {}), createDefaults: row.__create,
				},
			};
			addPane({ label: `${data.kind}: ${row.title}`, component: IbOrgPartCard as never, data: data as never });
		};
		return (
			<SubTable model="" parentKey="" parentUuid="" items={items} itemsLoading={orgs.isLoading}
				componentName={p.component} columnsJson={p.columns}
				// Порядок строк — как у 1С (основное — первым); сортирует человек щелчком по заголовку.
				defaultSort={{}}
				// Строки приходят из 1С: добавлять и удалять нечего. Правится только ссылка на ERP — в таблице или карточке.
				defaultInlineEditing={false} hideAddDelete disableAdd disableDelete hideReload selectable={false}
				emptyText={orgs.isLoading ? undefined : p.emptyText}
				openFormFor={(row) => { if (row) openCard(row as Item); }}
				renderCell={(row, column, ctx) => {
					if (column.identifier !== p.erpId || !ctx.inlineEditing) return undefined;
					const r = row as Item;
					return (
						<LookupField name={`${uid}_${r.__key}`} label="" endpoint={p.endpoint} displayField={p.displayField}
							value={r.__erpUuid} displayValue={asText(r[p.erpId])} width="100%" variant="table"
							extraParams={p.extraParams} createDefaults={r.__create}
							onSelect={pick(r.__key)} onClear={() => pick(r.__key)("", "")} />
					);
				}} />
		);
	};
	const ownerParams = hasOrg ? { ownerType: "organization", ownerUuid: erpOrg.uuid } : undefined;

	const noRows = !orgs.isLoading && !org;
	const count = (label: string, n: number) => `${translate(label)}${n ? ` (${n})` : ""}`;

	return (
		<ModelForm
			paneId={paneProps.uniqId}
			// Реквизиты правит 1С, связи с ERP не хранятся — записывать нечего.
			readonly
			isLoading={orgs.isLoading}
			onSave={() => { }} onSaveAndClose={() => { }} onClose={close}
			tabs={[
				{
					id: "main", label: translate("general"),
					component: (
						<div className={main.FormContainer}>
							<div className={main.FormWrapper}>
								<GroupCol className={main.Form}>
									<FormArea title={translate("onecOrgGroupOnec")}>
										<GroupCol>
											<GroupRow>
												<OnecField name={`${uid}_name`} label={translate("name")} value={org?.name} width={FIELD_WIDTH.lg} />
												<OnecField name={`${uid}_bin`} label={translate("binIin")} value={org?.bin} width={FIELD_WIDTH.md} />
											</GroupRow>
											<GroupRow>
												<OnecField name={`${uid}_legal`} label={translate("legalName")} value={d?.legalName} width={FIELD_WIDTH.lg} />
												<OnecField name={`${uid}_kind`} label={translate("kind")} width={FIELD_WIDTH.sm}
													value={d?.kind === "legal" ? translate("onecOrgKindLegal") : d?.kind === "individual" ? translate("onecOrgKindIndividual") : null} />
												<OnecField name={`${uid}_kbe`} label={translate("kbe")} value={d?.kbe} width={FIELD_WIDTH.sm} />
											</GroupRow>
											<GroupRow>
												<OnecField name={`${uid}_id`} label={translate("onecOrgRef1c")} value={org?.id} width={FIELD_WIDTH.lg} />
												<OnecField name={`${uid}_seen`} label={translate("seenAtLabel")} value={org?.seenAt ? getFormatDate(org.seenAt) : null} width={FIELD_WIDTH.md} />
												{/* Основная — только показ: её назначают в 1С (см. вкладку «Организации»). */}
												<FieldToggle name={`${uid}_main`} label={translate("onecOrgMain")} value={org?.main === true} disabled />
											</GroupRow>
										</GroupCol>
									</FormArea>

									<FormArea title={translate("onecOrgGroupErp")}>
										<GroupRow>
											<LookupField name={`${uid}_erp`} label={translate("onecReqErpOrg")} endpoint="organizations"
												value={erpOrg.uuid} displayValue={erpOrg.name} width={FIELD_WIDTH.xl}
												onSelect={pick("org")} onClear={() => pick("org")("", "")}
												createDefaults={org ? organizationCreateDefaults(org) : undefined}
												extraActions={orgExtra} />
										</GroupRow>
									</FormArea>

									<FormArea title={translate("onecReqOrgVat")}>
										<GroupRow>
											<OnecField name={`${uid}_vats`} label={translate("onecOrgVatSeries")} value={d?.vatSeries} width={FIELD_WIDTH.md} />
											<OnecField name={`${uid}_vatn`} label={translate("onecOrgVatNumber")} value={d?.vatNumber} width={FIELD_WIDTH.md} />
											<OnecField name={`${uid}_vatd`} label={translate("onecOrgVatDate")} width={FIELD_WIDTH.date}
												value={d?.vatDate ? getFormatDateOnly(d.vatDate) || d.vatDate : null} />
										</GroupRow>
									</FormArea>

									<FormArea title={translate("onecOrgOked")}>
										<GroupRow>
											<OnecField name={`${uid}_okedc`} label={translate("onecOrgOkedCode")} value={d?.okedCode} width={FIELD_WIDTH.sm} />
											<OnecField name={`${uid}_okedn`} label={translate("onecOrgOkedName")} value={d?.okedName} width={FIELD_WIDTH.xl} />
										</GroupRow>
									</FormArea>
								</GroupCol>

								<GroupCol className={main.FormNotice}>
									<QueryError error={orgs.error} noticeKey="base-org-form" source={translate("onecBaseOrgForm")} />
									<QueryError error={erpError} noticeKey="base-org-form-erp" source={translate("onecOrgGroupErp")} />
									{noRows && <Notice inline items={[{ type: "attention", text: translate("onecOrgFormNotFound") }]} />}
									<Notice inline items={[{ type: "info", text: translate("onecOrgFormErpHint") }]} />
								</GroupCol>
							</div>
						</div>
					),
				},
				{
					id: "accounts", label: count("BankAccountsList", accounts.length),
					component: part<AccountRow>({
						component: "OneCBases_orgAccounts", rows: accounts, columns: ACCOUNT_COLUMNS,
						erpId: "onecOrgAccountErp", kind: "onecOrgAccountCard",
						endpoint: "bankaccounts", displayField: "iban", extraParams: ownerParams,
						link: accountLink, emptyText: translate("onecOrgNoAccounts"),
					}),
				},
				{
					id: "contracts", label: count("ContractsList", contracts.length),
					component: part<ContractRow>({
						component: "OneCBases_orgContracts", rows: contracts, columns: CONTRACT_COLUMNS,
						erpId: "onecOrgContractErp", kind: "onecOrgContractCard",
						endpoint: "contracts", displayField: "name",
						extraParams: hasOrg ? { organizationUuid: erpOrg.uuid } : undefined,
						link: contractLink, emptyText: translate("onecOrgNoContracts"),
					}),
				},
				{
					id: "persons", label: count("ContactPersonsList", persons.length),
					component: part<PersonRow>({
						component: "OneCBases_orgPersons", rows: persons, columns: PERSON_COLUMNS,
						erpId: "onecOrgContactPersonErp", kind: "onecOrgPersonCard",
						endpoint: "contactpersons", displayField: "fullName", extraParams: ownerParams,
						link: personLink, emptyText: translate("onecOrgNoPersons"),
					}),
				},
				{
					id: "contacts", label: count("ContactsList", contacts.length),
					component: part<ContactRow>({
						component: "OneCBases_orgContacts", rows: contacts, columns: CONTACT_COLUMNS,
						erpId: "onecOrgContactErp", kind: "onecOrgContactCard",
						endpoint: "contacts", displayField: "value", extraParams: ownerParams,
						link: contactLink, emptyText: translate("onecOrgNoContacts"),
					}),
				},
			]}
		/>
	);
};

/** Пейн «Организация базы 1С»: данные — ключ базы и ключ строки вкладки «Организации». */
export const IbOrganizationForm: FC<Partial<TPane>> = (paneProps) => <IbOrganizationFormBody {...paneProps} />;
IbOrganizationForm.displayName = "IbOrganizationForm";

export default IbOrganizationForm;
