export interface ActionPayload {
	actionId: string;
	userId: string;
	channelId: string;
	messageTs: string;
	triggerId?: string;
	responseUrl: string;
}

export function parseActionPayload(rawPayload: string): ActionPayload {
	const payload = JSON.parse(rawPayload);

	const action = payload.actions?.[0];

	return {
		actionId: action?.action_id ?? "",
		userId: payload.user?.id ?? "",
		channelId: payload.channel?.id ?? "",
		messageTs: payload.message?.ts ?? "",
		triggerId: payload.trigger_id,
		responseUrl: payload.response_url ?? "",
	};
}

const ACTION_MAP: Record<string, string> = {
	poker_fold: "fold",
	poker_check: "check",
	poker_call: "call",
	poker_raise: "raise",
	poker_join: "join",
	poker_start: "start",
	poker_leave: "leave",
};

export function routeAction(actionId: string): string {
	return ACTION_MAP[actionId] ?? "unknown";
}
