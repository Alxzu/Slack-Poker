import { WebClient } from "@slack/web-api";
import { logger } from "../utils/logger";

const log = logger.child({ module: "slack-client" });

export class SlackClient {
	private client: WebClient;
	private dmChannelCache: Map<string, string> = new Map();

	constructor(token: string) {
		this.client = new WebClient(token);
	}

	async postMessage(channel: string, blocks: object[]): Promise<string> {
		const res = await this.client.chat.postMessage({
			channel,
			blocks: blocks as never[],
			text: "Poker update",
		});
		return res.ts ?? "";
	}

	async updateMessage(
		channel: string,
		ts: string,
		blocks: object[],
	): Promise<void> {
		const maxAttempts = 3;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				await this.client.chat.update({
					channel,
					ts,
					blocks: blocks as never[],
					text: "Poker update",
				});
				return;
			} catch (err) {
				log.warn({ err, channel, ts, attempt }, "Failed to update message");
				if (attempt < maxAttempts) {
					const delay = 2 ** (attempt - 1) * 1000; // 1s, 2s, 4s
					await new Promise((r) => setTimeout(r, delay));
				} else {
					throw err;
				}
			}
		}
	}

	async openDM(userId: string): Promise<string> {
		const cached = this.dmChannelCache.get(userId);
		if (cached) return cached;

		const res = await this.client.conversations.open({ users: userId });
		const channelId = res.channel?.id ?? "";
		if (!channelId) throw new Error(`Failed to open DM with ${userId}`);
		this.dmChannelCache.set(userId, channelId);
		return channelId;
	}

	async postDM(userId: string, blocks: object[]): Promise<string> {
		const channel = await this.openDM(userId);
		return this.postMessage(channel, blocks);
	}

	async updateDM(userId: string, ts: string, blocks: object[]): Promise<void> {
		const channel = await this.openDM(userId);
		return this.updateMessage(channel, ts, blocks);
	}

	async postEphemeral(
		channel: string,
		userId: string,
		blocks: object[],
		text?: string,
	): Promise<void> {
		await this.client.chat.postEphemeral({
			channel,
			user: userId,
			blocks: blocks as never[],
			text: text ?? "Poker update",
		});
	}
}
