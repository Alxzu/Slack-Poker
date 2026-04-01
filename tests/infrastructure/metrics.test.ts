import { describe, expect, test } from "bun:test";
import { purgeOldMetrics, recordMetric } from "../../src/db/metrics";

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

function createMockDb(opts?: { insertThrows?: boolean }) {
	return {
		insert: () => ({
			values: async () => {
				if (opts?.insertThrows) throw new Error("DB write failed");
				return [];
			},
		}),
		delete: () => ({
			where: () => ({
				returning: async () => [{ id: "1" }, { id: "2" }, { id: "3" }],
			}),
		}),
	} as never;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("recordMetric", () => {
	test("does not throw on successful insert", async () => {
		const db = createMockDb();

		// Should complete without error
		await recordMetric(db, {
			action: "slash_command",
			durationMs: 42,
			success: true,
		});
	});

	test("does not throw on DB error (fire-and-forget)", async () => {
		const db = createMockDb({ insertThrows: true });

		// Should swallow the error and not throw
		await recordMetric(db, {
			action: "slash_command",
			durationMs: 42,
			success: false,
			error: "something broke",
		});
	});

	test("accepts all optional fields", async () => {
		const db = createMockDb();

		await recordMetric(db, {
			workspaceId: "T123",
			gameId: "game-abc",
			action: "player_action",
			detail: "fold",
			durationMs: 10,
			success: true,
		});
	});
});

describe("purgeOldMetrics", () => {
	test("returns count of deleted rows", async () => {
		const db = createMockDb();

		const count = await purgeOldMetrics(db, 30);
		expect(count).toBe(3);
	});

	test("uses default daysToKeep of 30", async () => {
		const db = createMockDb();

		const count = await purgeOldMetrics(db);
		expect(count).toBe(3);
	});
});
