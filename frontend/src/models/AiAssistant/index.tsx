/**
 * AiAssistant — диалог с BuhProf AI: команды бухгалтеру на естественном языке, исполняемые
 * в 1С через bpapi-agent (см. ai/ в корне репозитория).
 *
 * Транспорт: AI Service живёт на отдельном хосте (ai.buhprof.kz / LAN :3100), поэтому запросы
 * идут fetch'ем с тем же Bearer-JWT, что и в ERP (сервис проверяет его тем же секретом), а не
 * через apiClient — у того baseURL зашит на бэкенд ERP. Организация диалога — активная у
 * пользователя; сервис сверяет доступ по access_rights.
 *
 * Подтверждения (§17 ТЗ): изменяющие операции сервис останавливает и показывает карточку —
 * кнопки «Подтвердить»/«Отменить» просто отправляют «да»/«нет» в тот же диалог.
 */
import { FC, useCallback, useEffect, useRef, useState } from "react";
import { getCurrentUser, getToken } from "src/services/auth";
import { translate } from "src/i18";
import styles from "./AiAssistant.module.scss";

const LOCAL_AI_URL = (import.meta.env.VITE_LOCAL_AI_URL as string | undefined) || "http://192.168.1.112:3100";
const REMOTE_AI_URL = (import.meta.env.VITE_AI_URL as string | undefined) || "https://ai.buhprof.kz";

function getAiUrl(): string {
	if (typeof window === "undefined") return REMOTE_AI_URL;
	if ("__TAURI_INTERNALS__" in window) return REMOTE_AI_URL;
	const { hostname } = window.location;
	const isLocal = hostname.includes("192.168.") || hostname === "localhost" || hostname === "127.0.0.1";
	return isLocal ? LOCAL_AI_URL : REMOTE_AI_URL;
}

type Attachment = { fileName: string; mimeType: string; content: string };
type ChatReply = {
	conversationId: string;
	state: string;
	text: string;
	confirmation?: { tool: string; card: string } | null;
	attachments?: Attachment[];
};
type Envelope<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

type Msg = { id: number; role: "user" | "assistant" | "system"; text: string; attachments?: Attachment[]; pending?: boolean };

const QUICK_PROMPTS = [
	"Найди контрагента Альфа",
	"Создай реализацию для ТОО Альфа: Дизи 450 штук по 550 тенге со склада Основной",
	"Покажи список складов",
];

function downloadAttachment(a: Attachment): void {
	const bytes = Uint8Array.from(atob(a.content), (c) => c.charCodeAt(0));
	const url = URL.createObjectURL(new Blob([bytes], { type: a.mimeType }));
	const link = document.createElement("a");
	link.href = url;
	link.download = a.fileName;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const AiAssistantList: FC = () => {
	const user = getCurrentUser();
	const [messages, setMessages] = useState<Msg[]>([]);
	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [conversationId, setConversationId] = useState<string | null>(null);
	const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
	const [agentStatus, setAgentStatus] = useState<string>("");
	const nextId = useRef(1);
	const bottomRef = useRef<HTMLDivElement>(null);

	const push = useCallback((m: Omit<Msg, "id">): number => {
		const id = nextId.current++;
		setMessages((prev) => [...prev, { ...m, id }]);
		return id;
	}, []);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	// Состояние агента организации — чтобы пользователь сразу видел, «есть ли связь с 1С».
	useEffect(() => {
		const token = getToken();
		if (!token) return;
		fetch(`${getAiUrl()}/v1/agents`, { headers: { authorization: `Bearer ${token}` } })
			.then((r) => r.json() as Promise<Envelope<{ items: { online: boolean; onec: { reachable: boolean; version: string | null } }[] }>>)
			.then((env) => {
				const a = env.data?.items?.[0];
				if (!env.success) setAgentStatus(env.error?.message ?? translate("aiAgentUnavailable"));
				else if (!a) setAgentStatus(translate("aiAgentNotConfigured"));
				else if (!a.online) setAgentStatus(translate("aiAgentOffline"));
				else if (!a.onec.reachable) setAgentStatus(translate("aiOnecUnavailable"));
				else setAgentStatus(`${translate("aiConnected")}${a.onec.version ? ` · 1С API ${a.onec.version}` : ""}`);
			})
			.catch(() => setAgentStatus(translate("aiAgentUnavailable")));
	}, []);

	const send = useCallback(async (text: string) => {
		const clean = text.trim();
		if (!clean || busy) return;
		const token = getToken();
		if (!token) {
			push({ role: "system", text: translate("aiNotAuthorized") });
			return;
		}
		setInput("");
		push({ role: "user", text: clean });
		const pendingId = push({ role: "assistant", text: "…", pending: true });
		setBusy(true);
		try {
			const r = await fetch(`${getAiUrl()}/v1/chat`, {
				method: "POST",
				headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
				body: JSON.stringify({ conversationId, text: clean, organizationUuid: user?.organizationUuid ?? undefined }),
			});
			const env = (await r.json()) as Envelope<ChatReply>;
			if (!env.success || !env.data) {
				setMessages((prev) => prev.map((m) => (m.id === pendingId ? { ...m, pending: false, role: "system", text: env.error?.message ?? `HTTP ${r.status}` } : m)));
				return;
			}
			const d = env.data;
			setConversationId(d.conversationId);
			setAwaitingConfirmation(d.state === "WAITING_CONFIRMATION");
			setMessages((prev) => prev.map((m) => (m.id === pendingId ? { ...m, pending: false, text: d.text, attachments: d.attachments } : m)));
		} catch {
			setMessages((prev) => prev.map((m) => (m.id === pendingId ? { ...m, pending: false, role: "system", text: translate("aiNetworkError") } : m)));
		} finally {
			setBusy(false);
		}
	}, [busy, conversationId, push, user?.organizationUuid]);

	const reset = () => {
		setConversationId(null);
		setMessages([]);
		setAwaitingConfirmation(false);
	};

	return (
		<div className={styles.Root}>
			<div className={styles.Header}>
				<div>
					<strong>{translate("AiAssistant")}</strong>
					<span className={styles.Status}>{agentStatus}</span>
				</div>
				<button type="button" className={styles.Ghost} onClick={reset} disabled={busy}>{translate("aiNewDialog")}</button>
			</div>

			<div className={styles.Log}>
				{messages.length === 0 && (
					<div className={styles.Empty}>
						<p>{translate("aiIntro")}</p>
						<div className={styles.Quick}>
							{QUICK_PROMPTS.map((q) => (
								<button key={q} type="button" onClick={() => void send(q)} disabled={busy}>{q}</button>
							))}
						</div>
					</div>
				)}
				{messages.map((m) => (
					<div key={m.id} className={`${styles.Msg} ${styles[m.role]}${m.pending ? ` ${styles.pending}` : ""}`}>
						<div className={styles.Bubble}>
							{m.text.split("\n").map((line, i) => <p key={i}>{line}</p>)}
							{m.attachments?.map((a) => (
								<button key={a.fileName} type="button" className={styles.File} onClick={() => downloadAttachment(a)}>
									📄 {a.fileName}
								</button>
							))}
						</div>
					</div>
				))}
				<div ref={bottomRef} />
			</div>

			{awaitingConfirmation && (
				<div className={styles.Confirm}>
					<button type="button" className={styles.Primary} onClick={() => void send("да")} disabled={busy}>{translate("aiConfirm")}</button>
					<button type="button" className={styles.Ghost} onClick={() => void send("нет")} disabled={busy}>{translate("aiCancel")}</button>
				</div>
			)}

			<form
				className={styles.Composer}
				onSubmit={(e) => {
					e.preventDefault();
					void send(input);
				}}
			>
				<textarea
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void send(input);
						}
					}}
					placeholder={translate("aiPlaceholder")}
					rows={2}
					disabled={busy}
				/>
				<button type="submit" className={styles.Primary} disabled={busy || !input.trim()}>{translate("aiSend")}</button>
			</form>
		</div>
	);
};

export default AiAssistantList;
