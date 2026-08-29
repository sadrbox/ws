// Единый логгер. pino пишет JSON-строки — их удобно читать через `pm2 logs` и грузить в
// любой сборщик. Секреты в лог не попадают: объекты запросов сюда не передаются целиком,
// только выбранные поля.

import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(level: string): Logger {
	return pino({
		level,
		base: { service: "buhprof-ai" },
		timestamp: pino.stdTimeFunctions.isoTime,
		redact: {
			paths: ["token", "authorization", "password", "apiKey", "*.token", "*.password"],
			censor: "<скрыто>",
		},
	});
}
