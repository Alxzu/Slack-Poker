/** Stub handlers for game commands that require the full game loop with Redis. */

function comingSoon(command: string): object[] {
	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `:construction: \`/poker ${command}\` — Coming soon.`,
			},
		},
	];
}

export function handleNew(_buyIn?: number): object[] {
	return comingSoon("new");
}

export function handleJoin(): object[] {
	return comingSoon("join");
}

export function handleStart(): object[] {
	return comingSoon("start");
}

export function handleLeave(): object[] {
	return comingSoon("leave");
}

export function handleCancel(): object[] {
	return comingSoon("cancel");
}

export function handleEnd(): object[] {
	return comingSoon("end");
}

export function handleCards(): object[] {
	return comingSoon("cards");
}
