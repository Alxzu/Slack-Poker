import type Redis from "ioredis";
import type { Card, GameState, SeatIndex } from "../engine/types";
import { logger } from "../utils/logger";

const log = logger.child({ module: "game-manager" });

// ---------------------------------------------------------------------------
// Serialization helpers for GameState
// ---------------------------------------------------------------------------

function serializeState(state: GameState): string {
	const plain = {
		...state,
		betting: {
			...state.betting,
			actedThisRound: [...state.betting.actedThisRound],
		},
	};
	return JSON.stringify(plain);
}

function deserializeState(raw: string): GameState {
	const parsed = JSON.parse(raw);
	return {
		...parsed,
		betting: {
			...parsed.betting,
			actedThisRound: new Set<SeatIndex>(parsed.betting.actedThisRound),
		},
	} as GameState;
}

// ---------------------------------------------------------------------------
// GameManager
// ---------------------------------------------------------------------------

export class GameManager {
	private redis: Redis;

	constructor(redis: Redis) {
		this.redis = redis;
	}

	// ── Game state ──────────────────────────────────────────────────

	async getGameState(gameId: string): Promise<GameState | null> {
		const raw = await this.redis.get(`game:${gameId}:state`);
		if (!raw) return null;
		try {
			return deserializeState(raw);
		} catch (err) {
			log.error({ err, gameId }, "Failed to deserialize game state");
			return null;
		}
	}

	async setGameState(gameId: string, state: GameState): Promise<void> {
		await this.redis.set(`game:${gameId}:state`, serializeState(state));
	}

	async deleteGameState(gameId: string): Promise<void> {
		await this.redis.del(`game:${gameId}:state`);
	}

	// ── Dealt cards ─────────────────────────────────────────────────

	async setDealtCards(
		gameId: string,
		handId: string,
		cards: Map<string, readonly Card[]>,
	): Promise<void> {
		const pipeline = this.redis.pipeline();
		for (const [userId, userCards] of cards) {
			pipeline.set(
				`game:${gameId}:hand:${handId}:cards:${userId}`,
				JSON.stringify(userCards),
			);
		}
		await pipeline.exec();
	}

	async getDealtCards(
		gameId: string,
		handId: string,
		userId: string,
	): Promise<Card[] | null> {
		const raw = await this.redis.get(
			`game:${gameId}:hand:${handId}:cards:${userId}`,
		);
		if (!raw) return null;
		return JSON.parse(raw) as Card[];
	}

	async getAllDealtCards(
		gameId: string,
		handId: string,
		playerIds: string[],
	): Promise<Map<string, readonly Card[]>> {
		const map = new Map<string, readonly Card[]>();
		if (playerIds.length === 0) return map;

		const pipeline = this.redis.pipeline();
		for (const userId of playerIds) {
			pipeline.get(`game:${gameId}:hand:${handId}:cards:${userId}`);
		}
		const results = await pipeline.exec();
		if (!results) return map;

		for (let i = 0; i < playerIds.length; i++) {
			const [err, raw] = results[i];
			if (!err && raw) {
				map.set(playerIds[i], JSON.parse(raw as string) as Card[]);
			}
		}
		return map;
	}

	// ── DM timestamps ───────────────────────────────────────────────

	async setDmTs(gameId: string, userId: string, ts: string): Promise<void> {
		await this.redis.set(`game:${gameId}:dm:${userId}`, ts);
	}

	async getDmTs(gameId: string, userId: string): Promise<string | null> {
		return this.redis.get(`game:${gameId}:dm:${userId}`);
	}

	// ── Channel ↔ game mapping ──────────────────────────────────────

	async setChannelGame(
		workspaceId: string,
		channelId: string,
		gameId: string,
	): Promise<void> {
		await this.redis.set(`channel:${workspaceId}:${channelId}:game`, gameId);
	}

	async getChannelGame(
		workspaceId: string,
		channelId: string,
	): Promise<string | null> {
		return this.redis.get(`channel:${workspaceId}:${channelId}:game`);
	}

	async clearChannelGame(
		workspaceId: string,
		channelId: string,
	): Promise<void> {
		await this.redis.del(`channel:${workspaceId}:${channelId}:game`);
	}

	// ── Player ↔ game mapping ───────────────────────────────────────

	async setPlayerGame(
		workspaceId: string,
		userId: string,
		gameId: string,
	): Promise<void> {
		await this.redis.set(`player:${workspaceId}:${userId}:game`, gameId);
	}

	async getPlayerGame(
		workspaceId: string,
		userId: string,
	): Promise<string | null> {
		return this.redis.get(`player:${workspaceId}:${userId}:game`);
	}

	async clearPlayerGame(workspaceId: string, userId: string): Promise<void> {
		await this.redis.del(`player:${workspaceId}:${userId}:game`);
	}

	// ── Channel message TS (the main game message in channel) ───────

	async setChannelMessageTs(gameId: string, ts: string): Promise<void> {
		await this.redis.set(`game:${gameId}:messageTs`, ts);
	}

	async getChannelMessageTs(gameId: string): Promise<string | null> {
		return this.redis.get(`game:${gameId}:messageTs`);
	}

	// ── Store game metadata (channelId, workspaceId, buyIn, creator) ─

	async setGameMeta(
		gameId: string,
		meta: {
			channelId: string;
			workspaceId: string;
			buyIn: number;
			creatorId: string;
			smallBlind: number;
			bigBlind: number;
		},
	): Promise<void> {
		await this.redis.set(`game:${gameId}:meta`, JSON.stringify(meta));
	}

	async getGameMeta(gameId: string): Promise<{
		channelId: string;
		workspaceId: string;
		buyIn: number;
		creatorId: string;
		smallBlind: number;
		bigBlind: number;
	} | null> {
		const raw = await this.redis.get(`game:${gameId}:meta`);
		if (!raw) return null;
		return JSON.parse(raw);
	}

	// ── Store waiting-room player list (before engine state exists) ──

	async addWaitingPlayer(gameId: string, userId: string): Promise<void> {
		await this.redis.sadd(`game:${gameId}:waitingPlayers`, userId);
	}

	async removeWaitingPlayer(gameId: string, userId: string): Promise<void> {
		await this.redis.srem(`game:${gameId}:waitingPlayers`, userId);
	}

	async getWaitingPlayers(gameId: string): Promise<string[]> {
		return this.redis.smembers(`game:${gameId}:waitingPlayers`);
	}

	// ── Cleanup ─────────────────────────────────────────────────────

	async cleanupGame(
		gameId: string,
		workspaceId: string,
		playerIds: string[],
		channelId: string,
	): Promise<void> {
		const pipeline = this.redis.pipeline();

		// Delete game state
		pipeline.del(`game:${gameId}:state`);
		pipeline.del(`game:${gameId}:messageTs`);
		pipeline.del(`game:${gameId}:meta`);
		pipeline.del(`game:${gameId}:waitingPlayers`);

		// Delete DM timestamps
		for (const userId of playerIds) {
			pipeline.del(`game:${gameId}:dm:${userId}`);
		}

		// Clear channel → game mapping
		pipeline.del(`channel:${workspaceId}:${channelId}:game`);

		// Clear player → game mappings
		for (const userId of playerIds) {
			pipeline.del(`player:${workspaceId}:${userId}:game`);
		}

		// Delete dealt cards — we use a scan to find keys matching the pattern
		// since we don't always know all handIds
		await pipeline.exec();

		// Scan and delete card keys
		let cursor = "0";
		do {
			const [nextCursor, keys] = await this.redis.scan(
				cursor,
				"MATCH",
				`game:${gameId}:hand:*:cards:*`,
				"COUNT",
				100,
			);
			cursor = nextCursor;
			if (keys.length > 0) {
				await this.redis.del(...keys);
			}
		} while (cursor !== "0");
	}
}
