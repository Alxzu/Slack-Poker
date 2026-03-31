import type {
	BettingRoundState,
	Chips,
	PlayerState,
	PokerAction,
	SeatIndex,
} from "./types";
import { chips, seatIndex } from "./types";

export function createBettingRound(
	_smallBlind: Chips,
	bigBlind: Chips,
): BettingRoundState {
	return {
		currentBet: chips(0),
		minRaise: bigBlind,
		lastRaiserSeat: null,
		actedThisRound: new Set<SeatIndex>(),
	};
}

export function canCheck(
	player: PlayerState,
	round: BettingRoundState,
): boolean {
	if (player.folded || player.allIn) return false;
	return player.bet >= round.currentBet;
}

export function canCall(
	player: PlayerState,
	round: BettingRoundState,
): boolean {
	if (player.folded || player.allIn) return false;
	if (player.stack <= chips(0)) return false;
	return player.bet < round.currentBet;
}

export function canRaise(
	player: PlayerState,
	round: BettingRoundState,
	amount: Chips,
): boolean {
	if (player.folded || player.allIn) return false;
	if (player.stack <= chips(0)) return false;

	// The total bet after raising
	const totalBetAfterRaise = (player.bet as number) + (amount as number);

	// Must raise to at least currentBet + minRaise
	const minimumTotalBet =
		(round.currentBet as number) + (round.minRaise as number);

	if (totalBetAfterRaise < minimumTotalBet) return false;

	// Amount must be <= player's stack
	if ((amount as number) > (player.stack as number)) return false;

	return true;
}

export function callAmount(
	player: PlayerState,
	round: BettingRoundState,
): Chips {
	const diff = (round.currentBet as number) - (player.bet as number);
	return chips(Math.max(0, diff));
}

function updatePlayer(
	players: readonly PlayerState[],
	seatIdx: SeatIndex,
	update: Partial<PlayerState>,
): PlayerState[] {
	return players.map((p) =>
		p.seat === seatIdx ? { ...p, ...update } : { ...p },
	);
}

export function applyBetAction(
	players: readonly PlayerState[],
	round: BettingRoundState,
	seatIdx: SeatIndex,
	action: PokerAction,
): { players: PlayerState[]; round: BettingRoundState } {
	const player = players.find((p) => p.seat === seatIdx);
	if (!player) throw new Error(`No player at seat ${seatIdx}`);

	const newActed = new Set(round.actedThisRound);
	newActed.add(seatIdx);

	switch (action.type) {
		case "fold": {
			return {
				players: updatePlayer(players, seatIdx, { folded: true }),
				round: { ...round, actedThisRound: newActed },
			};
		}

		case "check": {
			if (!canCheck(player, round)) {
				throw new Error("Cannot check: there is a bet to match");
			}
			return {
				players: updatePlayer(players, seatIdx, {}),
				round: { ...round, actedThisRound: newActed },
			};
		}

		case "call": {
			const needed = callAmount(player, round);
			const actualCall = Math.min(needed as number, player.stack as number);
			const isAllIn = actualCall >= (player.stack as number);

			return {
				players: updatePlayer(players, seatIdx, {
					stack: chips((player.stack as number) - actualCall),
					bet: chips((player.bet as number) + actualCall),
					allIn: isAllIn,
				}),
				round: { ...round, actedThisRound: newActed },
			};
		}

		case "raise": {
			const raiseAmount = action.amount as number;
			const newBet = (player.bet as number) + raiseAmount;
			const raiseSize = newBet - (round.currentBet as number);

			return {
				players: updatePlayer(players, seatIdx, {
					stack: chips((player.stack as number) - raiseAmount),
					bet: chips(newBet),
				}),
				round: {
					currentBet: chips(newBet),
					minRaise: chips(Math.max(raiseSize, round.minRaise as number)),
					lastRaiserSeat: seatIdx,
					actedThisRound: newActed,
				},
			};
		}

		case "allIn": {
			const allInAmount = player.stack as number;
			const newBet = (player.bet as number) + allInAmount;

			let newCurrentBet = round.currentBet;
			let newMinRaise = round.minRaise;
			let newLastRaiser = round.lastRaiserSeat;

			// If the all-in is a raise (exceeds current bet)
			if (newBet > (round.currentBet as number)) {
				const raiseSize = newBet - (round.currentBet as number);
				newCurrentBet = chips(newBet);
				// Only update minRaise if it's a full raise
				if (raiseSize >= (round.minRaise as number)) {
					newMinRaise = chips(raiseSize);
				}
				newLastRaiser = seatIdx;
			}

			return {
				players: updatePlayer(players, seatIdx, {
					stack: chips(0),
					bet: chips(newBet),
					allIn: true,
				}),
				round: {
					currentBet: newCurrentBet,
					minRaise: newMinRaise,
					lastRaiserSeat: newLastRaiser,
					actedThisRound: newActed,
				},
			};
		}
	}
}

export function isBettingRoundComplete(
	players: readonly PlayerState[],
	round: BettingRoundState,
): boolean {
	const activePlayers = players.filter((p) => !p.folded && !p.allIn);

	// If no active players (everyone folded or all-in), round is complete
	if (activePlayers.length === 0) return true;

	// If only one non-folded player remains (others folded), round is complete
	const nonFolded = players.filter((p) => !p.folded);
	if (nonFolded.length <= 1) return true;

	// All active players must have acted and matched the current bet
	for (const p of activePlayers) {
		if (!round.actedThisRound.has(p.seat)) return false;
		if ((p.bet as number) < (round.currentBet as number)) return false;
	}

	return true;
}

export function getNextActiveSeat(
	players: readonly PlayerState[],
	currentSeat: SeatIndex,
	_dealerSeat: SeatIndex,
): SeatIndex | null {
	// Get all occupied seats sorted
	const occupiedSeats = players
		.map((p) => p.seat as number)
		.sort((a, b) => a - b);

	if (occupiedSeats.length === 0) return null;

	const maxSeat = 8; // seats 0-7

	// Start from the next seat after currentSeat, wrap around
	for (let i = 1; i <= maxSeat; i++) {
		const candidateSeatNum = ((currentSeat as number) + i) % maxSeat;
		const player = players.find((p) => (p.seat as number) === candidateSeatNum);
		if (player && !player.folded && !player.allIn) {
			return seatIndex(candidateSeatNum);
		}
	}

	return null;
}
