// OpenAIProvider: перевод истории в сообщения Chat Completions и ответа обратно — без сети.

import { test } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { OpenAIProvider, toMessages, parseArguments, isReasoningModel } from "../src/llm/openai.ts";

function completion(message: Partial<OpenAI.Chat.ChatCompletionMessage>, finish: OpenAI.Chat.ChatCompletion.Choice["finish_reason"] = "stop"): OpenAI.Chat.ChatCompletion {
	return {
		id: "chatcmpl-1", object: "chat.completion", created: 0, model: "gpt-5",
		choices: [{ index: 0, finish_reason: finish, logprobs: null, message: { role: "assistant", content: null, refusal: null, ...message } }],
		usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 80 } },
	};
}

test("история → сообщения: system, user, tool-результаты по одному на вызов, raw ассистента как есть", () => {
	const msgs = toMessages("SYS", [
		{ role: "user", text: "найди Альфа" },
		{ role: "assistant", text: "", toolCalls: [{ id: "call_1", name: "search_counterparties", input: { q: "Альфа" } }], raw: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "search_counterparties", arguments: "{\"q\":\"Альфа\"}" } }] } },
		{ role: "user", toolResults: [{ toolCallId: "call_1", content: { items: [] } }] },
		// raw от Anthropic (массив блоков) — игнорируется, сообщение собирается из text/toolCalls
		{ role: "assistant", text: "Ничего не нашёл", toolCalls: [], raw: [{ type: "text", text: "Ничего не нашёл" }] },
	]);
	assert.equal(msgs[0].role, "system");
	assert.equal(msgs[1].role, "user");
	assert.equal(msgs[2].role, "assistant");
	assert.equal(((msgs[2] as OpenAI.Chat.ChatCompletionAssistantMessageParam).tool_calls?.[0] as OpenAI.Chat.ChatCompletionMessageFunctionToolCall).function.arguments, "{\"q\":\"Альфа\"}");
	assert.equal(msgs[3].role, "tool");
	assert.equal((msgs[3] as OpenAI.Chat.ChatCompletionToolMessageParam).tool_call_id, "call_1");
	assert.equal((msgs[3] as OpenAI.Chat.ChatCompletionToolMessageParam).content, "{\"items\":[]}");
	assert.deepEqual(msgs[4], { role: "assistant", content: "Ничего не нашёл" });
});

test("ответ с tool_calls → toolCalls, stopReason tool_use, raw для повтора, usage с кэшем", async () => {
	const captured: { p?: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming } = {};
	const client = { chat: { completions: { create: async (p: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming) => { captured.p = p; return completion({ tool_calls: [{ id: "call_9", type: "function", function: { name: "get_sale", arguments: "{\"documentId\":\"d1\"}" } }] }, "tool_calls"); } } } };
	const p = new OpenAIProvider({ apiKey: "x", model: "gpt-5", effort: "xhigh", client });
	const res = await p.chat({ system: "SYS", messages: [{ role: "user", text: "покажи" }], tools: [{ name: "get_sale", description: "d", inputSchema: { type: "object" } }], maxTokens: 500 });
	assert.deepEqual(res.toolCalls, [{ id: "call_9", name: "get_sale", input: { documentId: "d1" } }]);
	assert.equal(res.stopReason, "tool_use");
	assert.equal(res.usage?.cacheRead, 80);
	assert.equal((res.raw as { tool_calls?: unknown[] }).tool_calls?.length, 1);
	const sent = captured.p!;
	assert.equal(sent.max_completion_tokens, 500);
	assert.equal((sent as unknown as { reasoning_effort?: string }).reasoning_effort, "high");
	assert.equal(sent.tools?.[0].type, "function");
});

test("не-reasoning модель не получает reasoning_effort; обрезанные аргументы → пустой вход", async () => {
	const captured: { p?: Record<string, unknown> } = {};
	const client = { chat: { completions: { create: async (p: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming) => { captured.p = p as unknown as Record<string, unknown>; return completion({ content: "Готово" }); } } } };
	const res = await new OpenAIProvider({ apiKey: "x", model: "gpt-4.1", client }).chat({ system: "S", messages: [{ role: "user", text: "ок" }], tools: [] });
	assert.equal(res.text, "Готово");
	assert.equal(res.stopReason, "end_turn");
	assert.equal(captured.p!.reasoning_effort, undefined);
	assert.deepEqual(parseArguments("{\"a\":1,\"b\":"), {});
	assert.equal(isReasoningModel("o3-mini"), true);
	assert.equal(isReasoningModel("gpt-4.1"), false);
});
