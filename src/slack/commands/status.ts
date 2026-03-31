export async function handleStatus(
	_workspaceId: string,
	_channelId: string,
): Promise<object[]> {
	// Stub — will query Redis game state once the game loop is implemented
	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: ":information_source: No active game in this channel. Use `/poker new` to start one!",
			},
		},
	];
}
