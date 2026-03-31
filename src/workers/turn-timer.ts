import type { Queue } from "groupmq";
import type { PokerAction } from "../engine/types";
import { logger } from "../utils/logger";

const log = logger.child({ module: "turn-timer" });

interface ActionJobData {
	gameId: string;
	action: PokerAction;
}

export class TurnTimer {
	private queue: Queue<ActionJobData>;
	private defaultDelayMs: number;

	constructor(queue: Queue<ActionJobData>, defaultDelayMs = 60_000) {
		this.queue = queue;
		this.defaultDelayMs = defaultDelayMs;
	}

	async startTimer(
		gameId: string,
		handId: string,
		userId: string,
		delayMs?: number,
	): Promise<void> {
		const jobId = `timer:${gameId}:${handId}:${userId}`;
		const delay = delayMs ?? this.defaultDelayMs;

		try {
			await this.queue.add({
				groupId: `game:${gameId}`,
				jobId,
				data: {
					gameId,
					action: { type: "fold", playerId: userId },
				},
				delay,
			});
			log.debug({ gameId, handId, userId, delay }, "Turn timer started");
		} catch (err) {
			log.error({ err, gameId, handId, userId }, "Failed to start turn timer");
		}
	}

	async cancelTimer(
		gameId: string,
		handId: string,
		userId: string,
	): Promise<void> {
		const jobId = `timer:${gameId}:${handId}:${userId}`;

		try {
			await this.queue.remove(jobId);
			log.debug({ gameId, handId, userId }, "Turn timer cancelled");
		} catch (err) {
			// Job might have already been processed or not exist
			log.debug(
				{ err, gameId, handId, userId },
				"Failed to cancel turn timer (may not exist)",
			);
		}
	}
}
