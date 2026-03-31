import type { Card } from "../../engine/types";
import { cardsToString } from "./cards";

export function buildHoleCardsMessage(
	cards: readonly Card[],
	handHint?: string,
	turnInfo?: { pot: number; toCall: number },
): object[] {
	const blocks: object[] = [];

	blocks.push({
		type: "section",
		text: {
			type: "mrkdwn",
			text: `:eyes: *Your cards:*  ${cardsToString(cards)}`,
		},
	});

	if (handHint) {
		blocks.push({
			type: "context",
			elements: [{ type: "mrkdwn", text: `_${handHint}_` }],
		});
	}

	if (turnInfo) {
		blocks.push({
			type: "section",
			text: {
				type: "mrkdwn",
				text: `*Pot:* ${turnInfo.pot}  |  *To call:* ${turnInfo.toCall}`,
			},
		});
	}

	return blocks;
}
