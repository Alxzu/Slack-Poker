import type { ErrorHandler } from "hono";
import {
	InsufficientBalanceError,
	OptimisticLockError,
	RefillNotAllowedError,
	TransferLimitError,
} from "../db/ledger";
import { logger } from "../utils/logger";

const log = logger.child({ module: "error-boundary" });

export function errorBoundary(): ErrorHandler {
	return (err, c) => {
		log.error({ err }, "Unhandled error in Slack handler");

		let message = "Something went wrong. Please try again.";

		if (err instanceof InsufficientBalanceError) {
			message = err.message;
		} else if (err instanceof OptimisticLockError) {
			message =
				"Your request conflicted with another action. Please try again.";
		} else if (err instanceof RefillNotAllowedError) {
			message = err.message;
		} else if (err instanceof TransferLimitError) {
			message = err.message;
		}

		return c.json({
			response_type: "ephemeral",
			blocks: [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: `:x: ${message}`,
					},
				},
			],
		});
	};
}
