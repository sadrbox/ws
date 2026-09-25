/**
 * Организация-фирма учёта качества — та, где работают сотрудники (БухПроф), а не клиенты, в
 * которые они переключаются по работе.
 *
 * ВКЛЮЧАЕТ УЧЁТ. Первое назначение ставит дату начала действия стандарта (сегодня): правила
 * кандидатов не смотрят назад и до назначения молчат. Назначает только администратор.
 *
 * НАЗНАЧЕНИЕ В ОДИН ШАГ (25.09). Пока фирма не назначена явно, сервер берёт запасное правило
 * (организация вида «service» → активная организация пользователя), а правила стандарта молчат.
 * Чтобы администратор не искал фирму в списке всех организаций, экран предлагает кандидатов
 * (GET /quality/firm-candidates): сначала вида «service», затем где он администратор, затем по числу
 * сотрудников — у фирмы их больше всего. Назначение отмечает организацию видом «service».
 */
import { type FC, useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { useAppContext } from "src/app/context";
import LookupField from "src/components/Field/LookupField";
import { Field } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Button } from "src/components/Button";
import { FormArea, Group, GroupCol } from "src/components/UI";
import Notice, { type NoticeItem } from "src/components/Notice";
import { showToast } from "src/components/UIToast";
import { routeError } from "src/services/errors/route";
import { fetchFirmCandidates, saveQualitySettings, type FirmCandidate } from "src/services/quality/api";
import QualityChip from "src/models/_quality/QualityChip";
import { escapeHtml, fillTemplate } from "src/models/_quality/text";
import main from "src/styles/main.module.scss";
import styles from "./QualitySettings.module.scss";

interface Props {
	firmName: string | null;
	firmExplicit: boolean;
	isAdmin: boolean;
}

export const FirmSection: FC<Props> = ({ firmName, firmExplicit, isAdmin }) => {
	const queryClient = useQueryClient();
	const { confirm } = useAppContext().actions;
	const [pick, setPick] = useState<{ uuid: string; name: string }>({ uuid: "", name: "" });
	const [busy, setBusy] = useState(false);
	const [notices, setNotices] = useState<NoticeItem[]>([]);

	// Кандидаты — только пока фирма не назначена: потом подсказка не нужна.
	const candidates = useQuery({
		queryKey: ["quality", "firm-candidates"],
		queryFn: fetchFirmCandidates,
		enabled: isAdmin && !firmExplicit,
		staleTime: 60_000,
		retry: false,
	});
	const suggested: FirmCandidate[] = (candidates.data?.items ?? []).slice(0, 3);

	const assign = useCallback(async (target: { uuid: string; name: string }) => {
		if (!target.uuid) return;
		if (!(await confirm(escapeHtml(fillTemplate(translate("qualityFirmAssignAsk"), { name: target.name }))))) return;
		setBusy(true);
		setNotices([]);
		try {
			await saveQualitySettings({ firmOrganizationUuid: target.uuid });
			showToast(fillTemplate(translate("qualityFirmAssigned"), { name: target.name }), "success");
			setPick({ uuid: "", name: "" });
			// Фирма меняет всё: роль, группы, настройки, справочник пунктов.
			await queryClient.invalidateQueries({ queryKey: ["quality"] });
			void queryClient.invalidateQueries({ queryKey: ["standard-items"] });
			void queryClient.invalidateQueries({ queryKey: ["staff-groups"] });
		} catch (e) {
			setNotices(routeError(e, { source: translate("QualitySettingsView"), fallback: translate("qualityFirmAssignFailed") }));
		} finally {
			setBusy(false);
		}
	}, [confirm, queryClient]);

	const reasonText = (c: FirmCandidate) => [
		c.kind === "service" ? translate("qualityFirmReasonService") : null,
		c.isAdmin ? translate("qualityFirmReasonAdmin") : null,
		fillTemplate(translate("qualityFirmReasonMembers"), { count: c.members }),
	].filter(Boolean).join(" · ");

	const info: NoticeItem[] = firmExplicit ? [] : [{ type: "info", text: translate("qualityFirmNotExplicit") }];

	return (
		<FormArea title={translate("qualityFirmTitle")}>
			<GroupCol gap={6}>
				<Field label={translate("qualityFirmCurrent")} name="quality_firm_current" value={firmName || "—"} disabled minWidth={FIELD_WIDTH.lg} />
				{!firmExplicit && (
					<div><QualityChip tone="warn">{translate("qualityFirmNotAssigned")}</QualityChip></div>
				)}
				<span className={main.SettingHint}>{translate("qualityFirmHint")}</span>
				{isAdmin && !firmExplicit && suggested.length > 0 && (
					<div className={styles.Candidates} role="list" aria-label={translate("qualityFirmCandidates")}>
						<span className={styles.CandidatesTitle}>{translate("qualityFirmCandidates")}</span>
						{suggested.map((c) => (
							<div key={c.uuid} className={styles.Candidate} role="listitem">
								<span className={styles.CandidateName}>
									{c.name}{c.bin ? ` · ${translate("bin")} ${c.bin}` : ""}
									<span className={main.SettingHint}>{reasonText(c)}</span>
								</span>
								<Button disabled={busy} onClick={() => void assign({ uuid: c.uuid, name: c.name })}>{translate("qualityFirmAssign")}</Button>
							</div>
						))}
					</div>
				)}
				{isAdmin && (
					<Group>
						<LookupField name="quality_firm_pick" endpoint="organizations" label={translate("qualityFirmPick")}
							value={pick.uuid} displayValue={pick.name} allowCreate={false} minWidth={FIELD_WIDTH.lg} disabled={busy}
							onSelect={(uuid, display) => setPick({ uuid, name: display })} />
						<div className={styles.AlignEnd}>
							<Button onClick={() => void assign(pick)} disabled={!pick.uuid || busy}>{translate("qualityFirmAssign")}</Button>
						</div>
					</Group>
				)}
			</GroupCol>
			<Notice items={[...info, ...notices]} />
		</FormArea>
	);
};

export default FirmSection;
