/**
 * «Журнал» в карточке агента (R2, docs/TASKS_DEV_2026-09-14.md) — хвост журнала службы агента.
 *
 * Число строк, «только предупреждения и ошибки», отбор по тексту — параметрами команды
 * `AGENT_LOG_TAIL`: отбирает агент, у себя, и пароли с токенами он вырезает ДО отбора. Без
 * автообновления: журнал читают, разбирая случай, а не наблюдают. По кнопке — по той же причине, что
 * и состояние сервера: вкладки формы отрисованы все сразу.
 */
import { FC, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { Field, FieldSelect } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { GroupRow } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { fetchAgentLog } from "src/services/onec/api";
import { withOp } from "./progress";
import { QueryError } from "./shared";
import styles from "./OneCAdmin.module.scss";
import diag from "./AgentDiag.module.scss";

const LINE_OPTIONS = ["200", "500", "1000"];

export const AgentLogTab: FC<{ agentId: string; agentName: string }> = ({ agentId, agentName }) => {
	const [lines, setLines] = useState("200");
	const [problems, setProblems] = useState(false);
	const [contains, setContains] = useState("");

	const log = useQuery({
		queryKey: ["onec", "agent-log", agentId],
		queryFn: () => withOp({
			kind: "read", title: translate("onecAgentLog"), target: agentName,
			ref: { endpoint: "onec-agents", uuid: agentId, label: agentName },
		}, () => fetchAgentLog(agentId, {
			lines: Number(lines), level: problems ? "problems" : "all", contains: contains.trim(),
		})),
		enabled: false,
		retry: false,
		staleTime: Infinity,
	});
	const d = log.data;
	const shown = d?.lines ?? [];

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(shown.join("\n"));
			showToast(translate("onecAgentLogCopied"), "success");
		} catch (e) {
			reportError(e, { source: translate("onecAgentLog") });
		}
	};

	const summary = d ? [
		d.file ? `${translate("onecAgentLogFile")}: ${d.file}` : "",
		typeof d.matched === "number"
			? `${translate("onecAgentLogMatched")}: ${d.matched}${d.truncated ? ` (${translate("onecAgentLogTruncated")}: ${shown.length})` : ""}`
			: "",
		d.note ?? "",
	].filter(Boolean).join(" · ") : "";

	return (
		<div className={styles.Instances}>
			<div className={styles.Hint}>{translate("onecAgentLogHint")}</div>
			<GroupRow>
				<FieldSelect name="aglog_lines" label={translate("onecAgentLogLines")} value={lines}
					options={LINE_OPTIONS.map((v) => ({ value: v, label: v }))}
					onChange={(e) => setLines(e.target.value)} />
				<FieldToggle name="aglog_problems" label={translate("onecAgentLogProblems")} value={problems}
					onChange={setProblems} />
				<Field name="aglog_contains" label={translate("onecAgentLogContains")} value={contains} noAutofill
					width={FIELD_WIDTH.lg}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setContains(e.target.value.slice(0, 100))} />
			</GroupRow>
			<GroupRow>
				<Button variant="primary" disabled={!agentId || log.isFetching} onClick={() => void log.refetch()}>
					<Icon name="recalc" /> {d ? translate("onecAgentDiagRefresh") : translate("onecAgentLogGet")}
				</Button>
				<Button variant="secondary" disabled={!shown.length} onClick={() => void copy()}>
					{translate("onecAgentLogCopy")}
				</Button>
			</GroupRow>
			<QueryError error={log.error} noticeKey={`agent-log-${agentId}`} source={translate("onecAgentLog")} />
			{summary && <div className={styles.Hint}>{summary}</div>}
			{d && (shown.length
				? <pre className={diag.LogLines}>{shown.join("\n")}</pre>
				: <div className={styles.Hint}>{translate("onecAgentLogEmpty")}</div>)}
		</div>
	);
};

export default AgentLogTab;
