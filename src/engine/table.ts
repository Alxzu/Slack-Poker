import {
	applyBetAction,
	canCall,
	canCheck,
	createBettingRound,
	getNextActiveSeat,
	isBettingRoundComplete,
} from "./betting";
import { createDeck, deal, shuffle } from "./deck";
import { compareHands, evaluateHand } from "./hand-evaluator";
import { calculatePots, distributePots } from "./pot";
import type {
	BettingRoundState,
	Card,
	Chips,
	EvaluatedHand,
	GamePhase,
	GameState,
	PlayerState,
	PokerAction,
	Pot,
	SeatIndex,
} from "./types";
import { chips, handId, seatIndex } from "./types";

// ── Helper types ───────────────────────────────────────────────────

export interface ShowdownResult {
	userId: string;
	seat: SeatIndex;
	hand: EvaluatedHand;
	payout: Chips;
	cards: Card[];
}

export interface HandStartResult {
	state: GameState;
	dealtCards: Map<string, readonly Card[]>;
}

// ── Helpers ────────────────────────────────────────────────────────

function generateHandId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function randomSeatAssignment(count: number): SeatIndex[] {
	const available = [0, 1, 2, 3, 4, 5, 6, 7];
	const shuffled = [...available];
	// Fisher-Yates on available seats
	for (let i = shuffled.length - 1; i > 0; i--) {
		const rnd = new Uint32Array(1);
		crypto.getRandomValues(rnd);
		const j = rnd[0] % (i + 1);
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled.slice(0, count).map((s) => seatIndex(s));
}

function sortedSeats(players: readonly PlayerState[]): SeatIndex[] {
	return [...players]
		.map((p) => p.seat)
		.sort((a, b) => (a as number) - (b as number));
}

/** Get the next occupied seat after `from`, wrapping around. */
function nextSeatAfter(
	players: readonly PlayerState[],
	from: SeatIndex,
): SeatIndex {
	const seats = sortedSeats(players);
	for (let i = 1; i <= 8; i++) {
		const candidate = ((from as number) + i) % 8;
		if (seats.some((s) => (s as number) === candidate)) {
			return seatIndex(candidate);
		}
	}
	return from;
}

/** Get the next non-folded, non-sitting-out seat after `from`. */
function nextActiveSeatAfter(
	players: readonly PlayerState[],
	from: SeatIndex,
): SeatIndex | null {
	for (let i = 1; i <= 8; i++) {
		const candidate = ((from as number) + i) % 8;
		const player = players.find((p) => (p.seat as number) === candidate);
		if (player && !player.folded && !player.allIn && !player.sittingOut) {
			return seatIndex(candidate);
		}
	}
	return null;
}

function nonFoldedPlayers(players: readonly PlayerState[]): PlayerState[] {
	return players.filter((p) => !p.folded);
}

function activePlayers(players: readonly PlayerState[]): PlayerState[] {
	return players.filter((p) => !p.folded && !p.allIn && !p.sittingOut);
}

function resetBetsForNewRound(players: readonly PlayerState[]): PlayerState[] {
	return players.map((p) => ({ ...p, bet: chips(0) }));
}

// ── Core functions ─────────────────────────────────────────────────

export function createGame(
	playerUserIds: string[],
	blinds: { small: Chips; big: Chips },
	buyIn: Chips,
): GameState {
	if (playerUserIds.length < 2) {
		throw new Error("Need at least 2 players");
	}
	if (playerUserIds.length > 8) {
		throw new Error("Maximum 8 players");
	}

	const seats = randomSeatAssignment(playerUserIds.length);

	const players: PlayerState[] = playerUserIds.map((userId, i) => ({
		userId,
		seat: seats[i],
		stack: buyIn,
		bet: chips(0),
		folded: false,
		allIn: false,
		sittingOut: false,
		consecutiveTimeouts: 0,
	}));

	// Random dealer from the assigned seats
	const rnd = new Uint32Array(1);
	crypto.getRandomValues(rnd);
	const dealerIdx = rnd[0] % players.length;
	const dealerSeat = players[dealerIdx].seat;

	return {
		id: generateHandId(),
		phase: "waiting" as GamePhase,
		players,
		deck: [],
		communityCards: [],
		pots: [],
		dealerSeat,
		activeSeat: seatIndex(0),
		smallBlind: blinds.small,
		bigBlind: blinds.big,
		handId: handId(""),
		handNumber: 0,
		betting: createBettingRound(blinds.small, blinds.big),
	};
}

export function startHand(state: GameState): HandStartResult {
	const activePlrs = state.players.filter((p) => !p.sittingOut);
	if (activePlrs.length < 2) {
		throw new Error("Need at least 2 non-sitting-out players");
	}

	const newDeck = shuffle(createDeck());
	const newHandId = handId(generateHandId());
	const newHandNumber = state.handNumber + 1;

	const isHeadsUp = activePlrs.length === 2;

	// Find SB and BB seats
	let sbSeat: SeatIndex;
	let bbSeat: SeatIndex;

	if (isHeadsUp) {
		// Heads-up: dealer = SB
		sbSeat = state.dealerSeat;
		bbSeat = nextSeatAfter(activePlrs, state.dealerSeat);
	} else {
		sbSeat = nextSeatAfter(activePlrs, state.dealerSeat);
		bbSeat = nextSeatAfter(activePlrs, sbSeat);
	}

	// Post blinds
	let players = state.players.map((p) => ({
		...p,
		folded: false,
		allIn: false,
		bet: chips(0),
	}));

	// Post SB
	const sbPlayer = players.find((p) => p.seat === sbSeat);
	if (!sbPlayer) throw new Error(`No player at SB seat ${sbSeat}`);
	const sbAmount = Math.min(
		state.smallBlind as number,
		sbPlayer.stack as number,
	);
	players = players.map((p) =>
		p.seat === sbSeat
			? {
					...p,
					stack: chips((p.stack as number) - sbAmount),
					bet: chips(sbAmount),
					allIn: sbAmount >= (p.stack as number) && sbAmount > 0,
				}
			: p,
	);

	// Post BB
	const bbPlayer = players.find((p) => p.seat === bbSeat);
	if (!bbPlayer) throw new Error(`No player at BB seat ${bbSeat}`);
	const bbAmount = Math.min(state.bigBlind as number, bbPlayer.stack as number);
	players = players.map((p) =>
		p.seat === bbSeat
			? {
					...p,
					stack: chips((p.stack as number) - bbAmount),
					bet: chips(bbAmount),
					allIn: bbAmount >= (p.stack as number) && bbAmount > 0,
				}
			: p,
	);

	// Deal 2 hole cards to each non-sitting-out player
	let currentDeck = [...newDeck];
	const dealtCards = new Map<string, readonly Card[]>();

	// Deal in seat order starting from SB
	const dealOrder: PlayerState[] = [];
	let cursor = sbSeat;
	for (let i = 0; i < activePlrs.length; i++) {
		const p = players.find((pl) => pl.seat === cursor);
		if (p && !p.sittingOut) {
			dealOrder.push(p);
		}
		cursor = nextSeatAfter(
			players.filter((pl) => !pl.sittingOut),
			cursor,
		);
	}

	for (const p of dealOrder) {
		const { dealt, remaining } = deal(currentDeck, 2);
		currentDeck = remaining;
		dealtCards.set(p.userId, dealt);
	}

	// Determine UTG (first player after BB)
	const activeForBetting = players.filter((p) => !p.sittingOut);
	let utgSeat: SeatIndex;
	if (isHeadsUp) {
		// Heads-up preflop: dealer/SB acts first
		utgSeat = sbSeat;
	} else {
		utgSeat = nextSeatAfter(activeForBetting, bbSeat);
	}

	// Create betting round with currentBet = BB
	const betting: BettingRoundState = {
		currentBet: chips(bbAmount),
		minRaise: chips(bbAmount),
		lastRaiserSeat: null,
		actedThisRound: new Set<SeatIndex>(),
	};

	const newState: GameState = {
		...state,
		phase: "preflop",
		players,
		deck: currentDeck,
		communityCards: [],
		pots: [],
		dealerSeat: state.dealerSeat,
		activeSeat: utgSeat,
		handId: newHandId,
		handNumber: newHandNumber,
		betting,
	};

	return { state: newState, dealtCards };
}

export function applyAction(state: GameState, action: PokerAction): GameState {
	// Validate phase
	if (
		state.phase !== "preflop" &&
		state.phase !== "flop" &&
		state.phase !== "turn" &&
		state.phase !== "river"
	) {
		throw new Error(`Cannot apply action in phase ${state.phase}`);
	}

	// Validate it's this player's turn
	const player = state.players.find((p) => p.userId === action.playerId);
	if (!player) {
		throw new Error(`Player ${action.playerId} not found`);
	}
	if (player.seat !== state.activeSeat) {
		throw new Error(
			`Not ${action.playerId}'s turn (active seat: ${state.activeSeat}, player seat: ${player.seat})`,
		);
	}

	// Apply betting action
	const { players: newPlayers, round: newRound } = applyBetAction(
		state.players,
		state.betting,
		player.seat,
		action,
	);

	// Check if all-but-one folded
	const remaining = nonFoldedPlayers(newPlayers);
	if (remaining.length === 1) {
		// Immediate win
		const winner = remaining[0];
		const pots = calculatePots(newPlayers);
		let totalPot = 0;
		for (const pot of pots) {
			totalPot += pot.amount as number;
		}

		// Award pot to winner
		const finalPlayers = newPlayers.map((p) =>
			p.seat === winner.seat
				? { ...p, stack: chips((p.stack as number) + totalPot), bet: chips(0) }
				: { ...p, bet: chips(0) },
		);

		return {
			...state,
			phase: "showdown",
			players: finalPlayers,
			pots,
			betting: newRound,
		};
	}

	// Check if betting round is complete
	if (isBettingRoundComplete(newPlayers, newRound)) {
		return advancePhase({
			...state,
			players: newPlayers,
			betting: newRound,
		});
	}

	// Continue betting - find next active player
	const nextSeat = getNextActiveSeat(newPlayers, player.seat, state.dealerSeat);

	return {
		...state,
		players: newPlayers,
		betting: newRound,
		activeSeat: nextSeat ?? state.activeSeat,
	};
}

function advancePhase(state: GameState): GameState {
	const remaining = nonFoldedPlayers(state.players);
	const active = activePlayers(state.players);
	const allInOrDone = active.length <= 1 && remaining.length >= 2;

	// Reset bets and calculate pots for this round
	const pots = calculatePots(state.players);
	const playersWithResetBets = resetBetsForNewRound(state.players);

	// Merge pots: add new pots to existing
	const mergedPots = mergePots(state.pots, pots);

	const newBetting = createBettingRound(state.smallBlind, state.bigBlind);

	// Determine next phase
	let nextPhase: GamePhase;
	switch (state.phase) {
		case "preflop":
			nextPhase = "flop";
			break;
		case "flop":
			nextPhase = "turn";
			break;
		case "turn":
			nextPhase = "river";
			break;
		case "river":
			nextPhase = "showdown";
			break;
		default:
			throw new Error(`Unexpected phase for advance: ${state.phase}`);
	}

	// Deal community cards
	let deck = [...state.deck];
	let communityCards = [...state.communityCards];

	if (nextPhase === "flop") {
		const { dealt, remaining: rem } = deal(deck, 3);
		communityCards = [...communityCards, ...dealt];
		deck = rem;
	} else if (nextPhase === "turn" || nextPhase === "river") {
		const { dealt, remaining: rem } = deal(deck, 1);
		communityCards = [...communityCards, ...dealt];
		deck = rem;
	}

	// If all remaining players are all-in, auto-deal remaining streets
	if (allInOrDone && nextPhase !== "showdown") {
		const autoState: GameState = {
			...state,
			phase: nextPhase,
			players: playersWithResetBets,
			deck,
			communityCards,
			pots: mergedPots,
			betting: newBetting,
		};
		return autoDealRemaining(autoState);
	}

	if (nextPhase === "showdown") {
		return {
			...state,
			phase: "showdown",
			players: playersWithResetBets,
			deck,
			communityCards,
			pots: mergedPots,
			betting: newBetting,
		};
	}

	// Find first active player after dealer for post-flop betting
	let firstToAct = nextActiveSeatAfter(playersWithResetBets, state.dealerSeat);
	if (firstToAct === null) {
		// Everyone all-in — shouldn't get here but handle gracefully
		firstToAct = state.activeSeat;
	}

	return {
		...state,
		phase: nextPhase,
		players: playersWithResetBets,
		deck,
		communityCards,
		pots: mergedPots,
		betting: newBetting,
		activeSeat: firstToAct,
	};
}

function autoDealRemaining(state: GameState): GameState {
	let deck = [...state.deck];
	let communityCards = [...state.communityCards];

	// Deal until we have 5 community cards
	while (communityCards.length < 5) {
		if (communityCards.length === 0) {
			const { dealt, remaining } = deal(deck, 3);
			communityCards = [...communityCards, ...dealt];
			deck = remaining;
		} else {
			const { dealt, remaining } = deal(deck, 1);
			communityCards = [...communityCards, ...dealt];
			deck = remaining;
		}
	}

	return {
		...state,
		phase: "showdown",
		deck,
		communityCards,
	};
}

function mergePots(existing: readonly Pot[], newPots: readonly Pot[]): Pot[] {
	// Simple concatenation; pots accumulate across streets
	return [...existing, ...newPots];
}

export function resolveShowdown(
	state: GameState,
	dealtCards: Map<string, readonly Card[]>,
): { state: GameState; results: ShowdownResult[] } {
	if (state.phase !== "showdown") {
		throw new Error("Not in showdown phase");
	}

	const remaining = nonFoldedPlayers(state.players);

	// If only 1 player remains (everyone else folded), they win everything
	if (remaining.length === 1) {
		const winner = remaining[0];
		let totalPot = 0;
		for (const pot of state.pots) {
			totalPot += pot.amount as number;
		}

		const results: ShowdownResult[] = [
			{
				userId: winner.userId,
				seat: winner.seat,
				hand: evaluateHand(
					[...(dealtCards.get(winner.userId) ?? []), ...state.communityCards]
						.slice(0, 5)
						.concat(state.communityCards).length >= 5
						? [
								...(dealtCards.get(winner.userId) ?? []),
								...state.communityCards,
							]
						: [
								...(dealtCards.get(winner.userId) ?? []),
								...state.communityCards,
								...state.communityCards,
							].slice(0, 5),
				),
				payout: chips(totalPot),
				cards: [...(dealtCards.get(winner.userId) ?? [])],
			},
		];

		const finalPlayers = state.players.map((p) =>
			p.seat === winner.seat
				? { ...p, stack: chips((p.stack as number) + totalPot) }
				: p,
		);

		return {
			state: { ...state, players: finalPlayers },
			results,
		};
	}

	// Evaluate hands for all remaining players
	const evaluations: {
		player: PlayerState;
		hand: EvaluatedHand;
		holeCards: Card[];
	}[] = [];

	for (const p of remaining) {
		const holeCards = [...(dealtCards.get(p.userId) ?? [])];
		const allCards = [...holeCards, ...state.communityCards];
		const hand = evaluateHand(allCards);
		evaluations.push({ player: p, hand, holeCards });
	}

	// Build winners map for distributePots
	// Score: rank * 10000 + tiebreaker encoding
	// Use compareHands to rank them properly
	// Assign each player a score such that better hands get higher scores
	// Group players by equivalent hand strength
	const sorted = [...evaluations].sort((a, b) => compareHands(b.hand, a.hand));

	let currentScore = sorted.length;
	const winners = new Map<SeatIndex, number>();
	winners.set(sorted[0].player.seat, currentScore);

	for (let i = 1; i < sorted.length; i++) {
		const cmp = compareHands(sorted[i].hand, sorted[i - 1].hand);
		if (cmp < 0) {
			currentScore--;
		}
		winners.set(sorted[i].player.seat, currentScore);
	}

	// Calculate and distribute pots
	const pots =
		state.pots.length > 0 ? state.pots : calculatePots(state.players);

	const payouts = distributePots(pots, winners);

	// Build results
	const results: ShowdownResult[] = evaluations.map((e) => ({
		userId: e.player.userId,
		seat: e.player.seat,
		hand: e.hand,
		payout: payouts.get(e.player.seat) ?? chips(0),
		cards: e.holeCards,
	}));

	// Apply payouts to player stacks
	let finalPlayers = [...state.players];
	for (const [seat, payout] of payouts) {
		finalPlayers = finalPlayers.map((p) =>
			p.seat === seat
				? { ...p, stack: chips((p.stack as number) + (payout as number)) }
				: p,
		);
	}

	return {
		state: { ...state, players: finalPlayers, pots },
		results,
	};
}

export function endHand(state: GameState): GameState {
	// Remove busted players (0 chips)
	const remainingPlayers = state.players.filter((p) => (p.stack as number) > 0);

	if (remainingPlayers.length < 2) {
		return {
			...state,
			phase: "complete",
			players: remainingPlayers,
			communityCards: [],
			deck: [],
			pots: [],
		};
	}

	// Rotate dealer
	const newDealer = nextSeatAfter(remainingPlayers, state.dealerSeat);

	return {
		...state,
		phase: "waiting",
		players: remainingPlayers.map((p) => ({
			...p,
			bet: chips(0),
			folded: false,
			allIn: false,
		})),
		communityCards: [],
		deck: [],
		pots: [],
		dealerSeat: newDealer,
		betting: createBettingRound(state.smallBlind, state.bigBlind),
	};
}

export function removePlayer(state: GameState, userId: string): GameState {
	const player = state.players.find((p) => p.userId === userId);
	if (!player) {
		throw new Error(`Player ${userId} not found`);
	}

	// If in an active hand and not already folded, fold them
	let players = [...state.players];
	if (
		(state.phase === "preflop" ||
			state.phase === "flop" ||
			state.phase === "turn" ||
			state.phase === "river") &&
		!player.folded
	) {
		players = players.map((p) =>
			p.userId === userId ? { ...p, folded: true } : p,
		);
	}

	// Remove the player
	players = players.filter((p) => p.userId !== userId);

	if (players.length < 2) {
		return {
			...state,
			phase: "complete",
			players,
		};
	}

	// If active seat was the removed player, advance
	let activeSeat = state.activeSeat;
	if (player.seat === state.activeSeat) {
		const next = getNextActiveSeat(players, player.seat, state.dealerSeat);
		activeSeat = next ?? state.activeSeat;
	}

	return {
		...state,
		players,
		activeSeat,
	};
}

export function legalActions(state: GameState, userId: string): PokerAction[] {
	const player = state.players.find((p) => p.userId === userId);
	if (!player) return [];
	if (player.seat !== state.activeSeat) return [];
	if (player.folded || player.allIn || player.sittingOut) return [];
	if (
		state.phase !== "preflop" &&
		state.phase !== "flop" &&
		state.phase !== "turn" &&
		state.phase !== "river"
	) {
		return [];
	}

	const actions: PokerAction[] = [];

	// Fold is always available
	actions.push({ type: "fold", playerId: userId });

	// Check
	if (canCheck(player, state.betting)) {
		actions.push({ type: "check", playerId: userId });
	}

	// Call
	if (canCall(player, state.betting)) {
		actions.push({ type: "call", playerId: userId });
	}

	// All-in is always available if player has chips
	if ((player.stack as number) > 0) {
		actions.push({ type: "allIn", playerId: userId });
	}

	// Raise - check minimum raise
	const minRaiseAmount =
		(state.betting.currentBet as number) +
		(state.betting.minRaise as number) -
		(player.bet as number);
	if (minRaiseAmount > 0 && (player.stack as number) >= minRaiseAmount) {
		actions.push({
			type: "raise",
			playerId: userId,
			amount: chips(minRaiseAmount),
		});
	}

	return actions;
}
