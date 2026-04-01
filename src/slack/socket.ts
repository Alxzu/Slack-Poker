import { SocketModeClient } from "@slack/socket-mode";
import { logger } from "../utils/logger";

const log = logger.child({ module: "socket-mode" });

// biome-ignore lint/suspicious/noExplicitAny: Slack payloads are untyped
type SlackPayload = Record<string, any>;

export interface SocketModeDeps {
	appToken: string;
	botToken: string;
	handleCommand: (payload: SlackPayload) => Promise<SlackPayload>;
	handleAction: (payload: SlackPayload) => Promise<SlackPayload>;
}

export async function startSocketMode(
	deps: SocketModeDeps,
): Promise<SocketModeClient> {
	const { appToken, handleCommand, handleAction } = deps;

	const client = new SocketModeClient({ appToken });

	// Slash commands arrive as type "slash_commands"
	client.on("slash_commands", async ({ ack, body }) => {
		log.info(
			{
				command: body.command,
				userId: body.user_id,
				channelId: body.channel_id,
			},
			"Socket Mode: slash command received",
		);

		try {
			const response = await handleCommand(body);
			await ack(response);
		} catch (err) {
			log.error({ err }, "Socket Mode: error handling slash command");
			await ack({ text: "An error occurred processing your command." });
		}
	});

	// Interactive messages (block_actions, view_submission, etc.) arrive as type "interactive"
	client.on("interactive", async ({ ack, body }) => {
		const actionType = body?.type ?? "unknown";
		log.info(
			{ actionType, userId: body?.user?.id },
			"Socket Mode: interactive event received",
		);

		try {
			const response = await handleAction(body);
			// Acknowledge within 3 seconds; response may be empty
			await ack(response ?? undefined);
		} catch (err) {
			log.error({ err }, "Socket Mode: error handling interactive event");
			await ack();
		}
	});

	await client.start();
	log.info("Socket Mode client connected");

	return client;
}
