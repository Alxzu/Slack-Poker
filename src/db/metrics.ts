import { lt } from "drizzle-orm";
import { logger } from "../utils/logger";
import type { Database } from "./connection";
import { actionMetrics } from "./schema";

const log = logger.child({ module: "metrics" });

export async function recordMetric(
	db: Database,
	metric: {
		workspaceId?: string;
		gameId?: string;
		action: string;
		detail?: string;
		durationMs: number;
		success: boolean;
		error?: string;
	},
): Promise<void> {
	// Fire-and-forget — don't await at call site, don't throw
	try {
		await db.insert(actionMetrics).values({
			workspaceId: metric.workspaceId ?? "system",
			gameId: metric.gameId,
			action: metric.action,
			detail: metric.detail,
			durationMs: metric.durationMs,
			success: metric.success,
			error: metric.error,
		});
	} catch (err) {
		log.warn({ err, metric }, "Failed to record metric");
	}
}

export async function purgeOldMetrics(
	db: Database,
	daysToKeep = 30,
): Promise<number> {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - daysToKeep);

	const result = await db
		.delete(actionMetrics)
		.where(lt(actionMetrics.createdAt, cutoff))
		.returning({ id: actionMetrics.id });

	return result.length;
}
