import type { HandId } from "@/engine/types";
import { handId } from "@/engine/types";

export function generateId(): string {
	return crypto.randomUUID();
}

export function generateHandId(): HandId {
	return handId(crypto.randomUUID());
}

export function idempotencyKey(...parts: string[]): string {
	return parts.join(":");
}
