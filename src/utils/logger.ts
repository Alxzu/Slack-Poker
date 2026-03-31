import pino from "pino";

export const logger = pino({
	level: process.env.LOG_LEVEL ?? "info",
	transport:
		process.env.NODE_ENV === "development"
			? { target: "pino/file", options: { destination: 1 } }
			: undefined,
});

export function gameLogger(gameId: string) {
	return logger.child({ gameId });
}

export function actionLogger(gameId: string, handId: string, playerId: string) {
	return logger.child({ gameId, handId, playerId });
}
