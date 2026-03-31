import type { Chips, PlayerState, Pot, SeatIndex } from "./types";
import { chips } from "./types";

export function calculatePots(players: readonly PlayerState[]): Pot[] {
	// Build contributions: each player's total bet
	const contributions: { seat: SeatIndex; amount: number }[] = players
		.filter((p) => (p.bet as number) > 0)
		.map((p) => ({ seat: p.seat, amount: p.bet as number }));

	if (contributions.length === 0) return [];

	// Find all-in players sorted by contribution ascending
	const allInAmounts = players
		.filter((p) => p.allIn && (p.bet as number) > 0)
		.map((p) => p.bet as number)
		.sort((a, b) => a - b);

	// Deduplicate all-in amounts
	const uniqueAllInAmounts = [...new Set(allInAmounts)];

	const pots: Pot[] = [];
	let peeled = 0; // total amount already peeled off per player

	for (const allInAmount of uniqueAllInAmounts) {
		const layerSize = allInAmount - peeled;
		if (layerSize <= 0) continue;

		// Eligible players: those who contributed at least this much total
		const eligible = contributions.filter((c) => c.amount > peeled);

		let potAmount = 0;
		for (const c of eligible) {
			const contribution = Math.min(c.amount - peeled, layerSize);
			potAmount += contribution;
		}

		const eligibleSeats = eligible.map((c) => c.seat);
		// Only non-folded players are eligible for winning
		const nonFoldedEligible = eligibleSeats.filter((seat) => {
			const p = players.find((pl) => pl.seat === seat);
			return p && !p.folded;
		});

		pots.push({
			amount: chips(potAmount),
			eligiblePlayers: nonFoldedEligible,
		});

		peeled = allInAmount;
	}

	// Remaining contributions after all all-in layers
	const remaining = contributions.filter((c) => c.amount > peeled);
	if (remaining.length > 0) {
		let potAmount = 0;
		for (const c of remaining) {
			potAmount += c.amount - peeled;
		}

		const eligibleSeats = remaining.map((c) => c.seat);
		const nonFoldedEligible = eligibleSeats.filter((seat) => {
			const p = players.find((pl) => pl.seat === seat);
			return p && !p.folded;
		});

		if (potAmount > 0) {
			pots.push({
				amount: chips(potAmount),
				eligiblePlayers: nonFoldedEligible,
			});
		}
	}

	return pots;
}

export function distributePots(
	pots: readonly Pot[],
	winners: Map<SeatIndex, number>,
): Map<SeatIndex, Chips> {
	const payouts = new Map<SeatIndex, Chips>();

	for (const pot of pots) {
		// Find eligible winners (must be in winners map AND eligible for this pot)
		const eligibleWinners = pot.eligiblePlayers.filter((seat) =>
			winners.has(seat),
		);

		if (eligibleWinners.length === 0) continue;

		// Find best hand score among eligible
		let bestScore = -1;
		for (const seat of eligibleWinners) {
			const score = winners.get(seat) ?? -1;
			if (score > bestScore) bestScore = score;
		}

		// Find all players with the best score
		const potWinners = eligibleWinners.filter(
			(seat) => winners.get(seat) === bestScore,
		);

		// Split the pot
		const share = Math.floor((pot.amount as number) / potWinners.length);
		const remainder = (pot.amount as number) - share * potWinners.length;

		for (let i = 0; i < potWinners.length; i++) {
			const seat = potWinners[i];
			const extra = i === 0 ? remainder : 0; // first eligible gets odd chip
			const current = (payouts.get(seat) as number | undefined) ?? 0;
			payouts.set(seat, chips(current + share + extra));
		}
	}

	return payouts;
}
