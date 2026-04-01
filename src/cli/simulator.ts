#!/usr/bin/env bun

import type { HandStartResult, ShowdownResult } from "../engine/table";
import {
	applyAction,
	createGame,
	endHand,
	legalActions,
	resolveShowdown,
	startHand,
} from "../engine/table";
import type {
	Card,
	GamePhase,
	GameState,
	PlayerState,
	PokerAction,
} from "../engine/types";
import { chips } from "../engine/types";

// ── ANSI colors ────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";

// ── Card display ───────────────────────────────────────────────────

const SUIT_SYMBOLS: Record<string, string> = {
	spades: "\u2660",
	hearts: "\u2665",
	diamonds: "\u2666",
	clubs: "\u2663",
};

const SUIT_COLORS: Record<string, string> = {
	spades: WHITE,
	hearts: RED,
	diamonds: RED,
	clubs: WHITE,
};

function cardStr(card: Card): string {
	const sym = SUIT_SYMBOLS[card.suit] ?? "?";
	const color = SUIT_COLORS[card.suit] ?? WHITE;
	const rank = card.rank.padEnd(2);
	return `${color}${sym} ${rank}${RESET}`;
}

function cardsStr(cards: readonly Card[]): string {
	return cards.map(cardStr).join("  ");
}

function blankCards(count: number): string {
	return Array.from({ length: count }, () => `${DIM}__${RESET}`).join("  ");
}

// ── Role helpers ───────────────────────────────────────────────────

function getPlayerRole(
	player: PlayerState,
	state: GameState,
	sbSeat: number,
	bbSeat: number,
): string {
	if (player.seat === state.dealerSeat) return "D";
	if ((player.seat as number) === sbSeat) return "SB";
	if ((player.seat as number) === bbSeat) return "BB";
	return "  ";
}

// ── Display ────────────────────────────────────────────────────────

const SEPARATOR = `${DIM}${"=".repeat(55)}${RESET}`;

function phaseName(phase: GamePhase): string {
	switch (phase) {
		case "preflop":
			return "Pre-Flop";
		case "flop":
			return "Flop";
		case "turn":
			return "Turn";
		case "river":
			return "River";
		case "showdown":
			return "Showdown";
		default:
			return phase;
	}
}

function totalPot(state: GameState): number {
	let pot = 0;
	for (const p of state.pots) {
		pot += p.amount as number;
	}
	// Add current bets not yet collected into pots
	for (const p of state.players) {
		pot += p.bet as number;
	}
	return pot;
}

function displayState(
	state: GameState,
	playerNames: Map<string, string>,
	dealtCards: Map<string, readonly Card[]>,
	activeUserId: string | null,
	sbSeat: number,
	bbSeat: number,
): void {
	console.log();
	console.log(SEPARATOR);
	console.log(
		`  ${BOLD}Hand #${state.handNumber}${RESET} | ${CYAN}${phaseName(state.phase)}${RESET} | Pot: ${GREEN}${totalPot(state)}${RESET}`,
	);
	console.log(SEPARATOR);

	// Community cards
	const cc = state.communityCards;
	const shown = cc.length > 0 ? cardsStr(cc) : "";
	const remaining = 5 - cc.length;
	const blank = remaining > 0 ? `  ${blankCards(remaining)}` : "";
	console.log(`\n  Community: ${shown}${blank}`);

	// Players
	console.log(`\n  ${BOLD}Players:${RESET}`);

	// Sort players by seat for consistent display
	const sortedPlayers = [...state.players].sort(
		(a, b) => (a.seat as number) - (b.seat as number),
	);

	for (const p of sortedPlayers) {
		const name = (playerNames.get(p.userId) ?? p.userId).padEnd(10);
		const role = `[${getPlayerRole(p, state, sbSeat, bbSeat)}]`.padEnd(4);
		const stackStr = `${GREEN}${(p.stack as number).toString().padStart(4)} chips${RESET}`;
		const isActive =
			p.seat === state.activeSeat &&
			!p.folded &&
			!p.allIn &&
			state.phase !== "showdown" &&
			state.phase !== "complete";

		let status = "";
		if (p.folded) {
			status = `  ${RED}(Folded)${RESET}`;
		} else if (p.allIn) {
			status = `  ${MAGENTA}(All-In)${RESET}`;
		} else if ((p.bet as number) > 0) {
			status = `  ${DIM}(Bet ${p.bet as number})${RESET}`;
		}

		const arrow = isActive ? `  ${YELLOW}<-- ACTION${RESET}` : "";
		const cards = dealtCards.get(p.userId);
		const holeStr =
			cards && !p.folded ? `  ${DIM}[${cardsStr(cards)}${DIM}]${RESET}` : "";

		console.log(`  ${role} ${name} ${stackStr}${status}${holeStr}${arrow}`);
	}

	// Active player's cards highlighted
	if (activeUserId) {
		const activeCards = dealtCards.get(activeUserId);
		if (activeCards) {
			const activeName = playerNames.get(activeUserId) ?? activeUserId;
			console.log(
				`\n  ${BOLD}${activeName}'s cards:${RESET} ${cardsStr(activeCards)}`,
			);
		}
	}

	console.log();
}

function displayActions(actions: PokerAction[], state: GameState): void {
	const parts: string[] = [];

	for (const a of actions) {
		switch (a.type) {
			case "fold":
				parts.push(`${DIM}(f)old${RESET}`);
				break;
			case "check":
				parts.push(`${GREEN}(k)check${RESET}`);
				break;
			case "call": {
				const player = state.players.find((p) => p.userId === a.playerId);
				const callAmt =
					(state.betting.currentBet as number) - ((player?.bet as number) ?? 0);
				parts.push(`${CYAN}(c)all ${callAmt}${RESET}`);
				break;
			}
			case "raise":
				parts.push(`${YELLOW}(r)aise${RESET}`);
				break;
			case "allIn":
				parts.push(`${RED}(a)ll-in${RESET}`);
				break;
		}
	}

	console.log(
		`  Actions: ${parts.join("  ")}  ${DIM}(s)tatus (h)elp (q)uit${RESET}`,
	);
}

function displayShowdown(
	results: ShowdownResult[],
	playerNames: Map<string, string>,
	handNumber: number,
): void {
	console.log();
	console.log(SEPARATOR);
	console.log(`  ${BOLD}${YELLOW}SHOWDOWN - Hand #${handNumber}${RESET}`);
	console.log(SEPARATOR);

	// Sort by payout descending
	const sorted = [...results].sort(
		(a, b) => (b.payout as number) - (a.payout as number),
	);

	for (const r of sorted) {
		const name = (playerNames.get(r.userId) ?? r.userId).padEnd(10);
		const cards = cardsStr(r.cards);
		const handName = r.hand.name;
		const payout = r.payout as number;

		if (payout > 0) {
			console.log(
				`  ${name} ${cards}  -> ${BOLD}${handName}${RESET}  -> ${GREEN}Won ${payout} chips!${RESET}`,
			);
		} else {
			console.log(`  ${name} ${cards}  -> ${handName}  -> ${RED}Lost${RESET}`);
		}
	}
	console.log(SEPARATOR);
}

function displayFoldWin(winnerName: string, potAmount: number): void {
	console.log();
	console.log(SEPARATOR);
	console.log(
		`  ${BOLD}${GREEN}${winnerName} wins ${potAmount} chips!${RESET} ${DIM}(everyone else folded)${RESET}`,
	);
	console.log(SEPARATOR);
}

function displayGameOver(
	winnerName: string,
	winnerStack: number,
	handCount: number,
): void {
	console.log();
	console.log(SEPARATOR);
	console.log(
		`  ${BOLD}${YELLOW}GAME OVER${RESET} - ${GREEN}${winnerName}${RESET} wins with ${GREEN}${winnerStack} chips${RESET}!`,
	);
	console.log(`  Hands played: ${handCount}`);
	console.log(SEPARATOR);
	console.log();
}

function displayHelp(): void {
	console.log();
	console.log(`  ${BOLD}Commands:${RESET}`);
	console.log(`    ${CYAN}f${RESET} / fold     Fold your hand`);
	console.log(`    ${CYAN}c${RESET} / call     Call the current bet`);
	console.log(`    ${CYAN}k${RESET} / check    Check (if no bet to match)`);
	console.log(
		`    ${CYAN}r${RESET} / raise    Raise (you'll be asked for amount)`,
	);
	console.log(`    ${CYAN}a${RESET} / allin    Go all-in`);
	console.log(`    ${CYAN}s${RESET} / status   Re-display the game state`);
	console.log(`    ${CYAN}h${RESET} / help     Show this help`);
	console.log(`    ${CYAN}q${RESET} / quit     Quit the game`);
	console.log();
}

// ── Input helpers ──────────────────────────────────────────────────

function ask(question: string): string | null {
	return prompt(`  ${question}`);
}

function askNumber(question: string, defaultVal: number): number {
	const answer = ask(`${question} [${defaultVal}]`);
	if (!answer || answer.trim() === "") return defaultVal;
	const n = Number.parseInt(answer.trim(), 10);
	return Number.isNaN(n) ? defaultVal : n;
}

// ── Blind seat calculation ─────────────────────────────────────────

function findBlindSeats(state: GameState): { sbSeat: number; bbSeat: number } {
	const activePlrs = state.players.filter((p) => !p.sittingOut);
	const isHeadsUp = activePlrs.length === 2;

	const sortedSeats = [...activePlrs]
		.map((p) => p.seat as number)
		.sort((a, b) => a - b);

	function nextSeat(from: number): number {
		for (let i = 1; i <= 8; i++) {
			const candidate = (from + i) % 8;
			if (sortedSeats.includes(candidate)) return candidate;
		}
		return from;
	}

	if (isHeadsUp) {
		return {
			sbSeat: state.dealerSeat as number,
			bbSeat: nextSeat(state.dealerSeat as number),
		};
	}

	const sb = nextSeat(state.dealerSeat as number);
	return { sbSeat: sb, bbSeat: nextSeat(sb) };
}

// ── Main game loop ─────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log();
	console.log(SEPARATOR);
	console.log(`  ${BOLD}${CYAN}SLACK POKER - Terminal Simulator${RESET}`);
	console.log(SEPARATOR);
	console.log();

	const DEFAULT_NAMES = [
		"Alice",
		"Bob",
		"Charlie",
		"Diana",
		"Eve",
		"Frank",
		"Grace",
		"Hank",
	];

	// Setup
	const numPlayers = askNumber("How many players? (2-8)", 3);
	const clamped = Math.max(2, Math.min(8, numPlayers));

	const playerNames = new Map<string, string>();
	const playerIds: string[] = [];

	const useDefaults = ask("Use default names? (Y/n)");
	const wantCustom =
		useDefaults !== null && useDefaults.trim().toLowerCase() === "n";

	for (let i = 0; i < clamped; i++) {
		let name = DEFAULT_NAMES[i];
		if (wantCustom) {
			const custom = ask(`Player ${i + 1} name [${name}]`);
			if (custom?.trim()) name = custom.trim();
		}
		const id = `player_${i}`;
		playerIds.push(id);
		playerNames.set(id, name);
	}

	const buyIn = askNumber("Buy-in amount?", 500);
	const sbAmount = askNumber("Small blind?", 5);
	const bbAmount = askNumber("Big blind?", 10);

	console.log();
	console.log(
		`  ${BOLD}Starting game:${RESET} ${clamped} players, ${GREEN}${buyIn}${RESET} chips, blinds ${sbAmount}/${bbAmount}`,
	);

	let state = createGame(
		playerIds,
		{ small: chips(sbAmount), big: chips(bbAmount) },
		chips(buyIn),
	);
	let handsPlayed = 0;
	let quit = false;

	// ── Hand loop ────────────────────────────────────────────────
	while (!quit) {
		// Check if game is over
		const activePlayers = state.players.filter(
			(p) => (p.stack as number) > 0 && !p.sittingOut,
		);
		if (activePlayers.length < 2) {
			const winner = activePlayers[0] ?? state.players[0];
			displayGameOver(
				playerNames.get(winner.userId) ?? winner.userId,
				winner.stack as number,
				handsPlayed,
			);
			break;
		}

		// Start hand
		let handResult: HandStartResult;
		try {
			handResult = startHand(state);
		} catch (err) {
			console.log(`  ${RED}Error starting hand: ${err}${RESET}`);
			break;
		}

		state = handResult.state;
		const dealtCards = handResult.dealtCards;
		handsPlayed++;

		const { sbSeat, bbSeat } = findBlindSeats(state);

		// Record stacks before hand for chip-change display
		const preHandStacks = new Map<string, number>();
		for (const p of state.players) {
			// Add back current bets to get pre-hand stack
			preHandStacks.set(p.userId, (p.stack as number) + (p.bet as number));
		}

		// ── Betting loop ───────────────────────────────────────
		let handComplete = false;
		let foldWinner: string | null = null;
		let foldPot = 0;

		while (!handComplete && !quit) {
			// Check phase
			if (state.phase === "showdown") {
				// Resolve showdown
				const { state: showdownState, results } = resolveShowdown(
					state,
					dealtCards,
				);
				state = showdownState;

				displayState(state, playerNames, dealtCards, null, sbSeat, bbSeat);
				displayShowdown(results, playerNames, state.handNumber);
				handComplete = true;
				break;
			}

			if (state.phase === "complete" || state.phase === "waiting") {
				handComplete = true;
				break;
			}

			// Find active player
			const activePlayer = state.players.find(
				(p) => p.seat === state.activeSeat && !p.folded && !p.allIn,
			);

			if (!activePlayer) {
				// No active player - might be all-in runout
				// Try advancing by checking if showdown is needed
				handComplete = true;
				break;
			}

			const activeId = activePlayer.userId;
			const activeName = playerNames.get(activeId) ?? activeId;

			// Display
			displayState(state, playerNames, dealtCards, activeId, sbSeat, bbSeat);

			// Get legal actions
			const legal = legalActions(state, activeId);

			if (legal.length === 0) {
				// Shouldn't happen, but handle
				console.log(`  ${RED}No legal actions for ${activeName}!${RESET}`);
				handComplete = true;
				break;
			}

			displayActions(legal, state);

			// Get player input
			const legalTypes = new Set(legal.map((a) => a.type));
			let actionChosen = false;

			while (!actionChosen && !quit) {
				const input = ask(`${BOLD}${activeName}>${RESET} `);

				if (input === null) {
					quit = true;
					break;
				}

				const cmd = input.trim().toLowerCase();

				if (cmd === "q" || cmd === "quit") {
					quit = true;
					break;
				}

				if (cmd === "h" || cmd === "help") {
					displayHelp();
					continue;
				}

				if (cmd === "s" || cmd === "status") {
					displayState(
						state,
						playerNames,
						dealtCards,
						activeId,
						sbSeat,
						bbSeat,
					);
					displayActions(legal, state);
					continue;
				}

				let action: PokerAction | null = null;

				if (cmd === "f" || cmd === "fold") {
					if (legalTypes.has("fold")) {
						action = { type: "fold", playerId: activeId };
					} else {
						console.log(`  ${RED}Cannot fold right now.${RESET}`);
						continue;
					}
				} else if (cmd === "k" || cmd === "check") {
					if (legalTypes.has("check")) {
						action = { type: "check", playerId: activeId };
					} else {
						console.log(
							`  ${RED}Cannot check - there's a bet to match.${RESET}`,
						);
						continue;
					}
				} else if (cmd === "c" || cmd === "call") {
					if (legalTypes.has("call")) {
						action = { type: "call", playerId: activeId };
					} else if (legalTypes.has("check")) {
						// Be helpful - if they say "call" but should check
						console.log(
							`  ${YELLOW}No bet to call. Did you mean (k)check?${RESET}`,
						);
						continue;
					} else {
						console.log(`  ${RED}Cannot call right now.${RESET}`);
						continue;
					}
				} else if (cmd === "a" || cmd === "allin") {
					if (legalTypes.has("allIn")) {
						action = { type: "allIn", playerId: activeId };
					} else {
						console.log(`  ${RED}Cannot go all-in right now.${RESET}`);
						continue;
					}
				} else if (cmd === "r" || cmd === "raise") {
					if (!legalTypes.has("raise") && !legalTypes.has("allIn")) {
						console.log(`  ${RED}Cannot raise right now.${RESET}`);
						continue;
					}

					const minRaise =
						(state.betting.currentBet as number) +
						(state.betting.minRaise as number) -
						(activePlayer.bet as number);
					const maxRaise = activePlayer.stack as number;

					console.log(
						`  ${DIM}Min raise: ${minRaise}, Max (all-in): ${maxRaise}${RESET}`,
					);
					const raiseInput = ask("Raise amount");

					if (!raiseInput || raiseInput.trim() === "") {
						continue;
					}

					const raiseAmt = Number.parseInt(raiseInput.trim(), 10);

					if (Number.isNaN(raiseAmt) || raiseAmt <= 0) {
						console.log(`  ${RED}Invalid amount.${RESET}`);
						continue;
					}

					if (raiseAmt >= maxRaise) {
						// All-in
						action = { type: "allIn", playerId: activeId };
					} else if (raiseAmt < minRaise) {
						console.log(`  ${RED}Minimum raise is ${minRaise}.${RESET}`);
						continue;
					} else {
						action = {
							type: "raise",
							playerId: activeId,
							amount: chips(raiseAmt),
						};
					}
				} else if (cmd === "") {
					continue;
				} else {
					console.log(
						`  ${RED}Unknown command "${cmd}". Type (h)elp for commands.${RESET}`,
					);
					continue;
				}

				if (action) {
					try {
						const newState = applyAction(state, action);

						// Check for fold-to-win: phase becomes "showdown" with 1 non-folded player
						const nonFolded = newState.players.filter((p) => !p.folded);
						if (newState.phase === "showdown" && nonFolded.length === 1) {
							// Fold-to-win - pot already awarded by engine
							const winner = nonFolded[0];
							const winnerName =
								playerNames.get(winner.userId) ?? winner.userId;
							const potWon = totalPot(state); // pot before action
							foldWinner = winnerName;
							foldPot = potWon;
							state = newState;
							handComplete = true;
							actionChosen = true;
							break;
						}

						state = newState;
						actionChosen = true;
					} catch (err) {
						console.log(
							`  ${RED}Error: ${err instanceof Error ? err.message : err}${RESET}`,
						);
					}
				}
			}
		}

		if (quit) break;

		// Show fold-win if applicable
		if (foldWinner) {
			displayFoldWin(foldWinner, foldPot);
		}

		// Show chip changes
		console.log();
		console.log(`  ${BOLD}Chip changes:${RESET}`);
		for (const p of state.players) {
			const name = (playerNames.get(p.userId) ?? p.userId).padEnd(10);
			const pre = preHandStacks.get(p.userId) ?? 0;
			const post = p.stack as number;
			const diff = post - pre;
			const diffStr =
				diff > 0
					? `${GREEN}+${diff}${RESET}`
					: diff < 0
						? `${RED}${diff}${RESET}`
						: `${DIM}+0${RESET}`;
			console.log(`  ${name} ${GREEN}${post}${RESET} chips (${diffStr})`);
		}

		// End hand
		state = endHand(state);

		// Check game over
		if (state.phase === "complete" || state.players.length < 2) {
			const winner = state.players[0];
			if (winner) {
				displayGameOver(
					playerNames.get(winner.userId) ?? winner.userId,
					winner.stack as number,
					handsPlayed,
				);
			}
			break;
		}

		// Ask to continue
		const cont = ask("Press Enter for next hand (q to quit)");
		if (cont !== null && cont.trim().toLowerCase() === "q") {
			console.log(`\n  ${DIM}Thanks for playing!${RESET}\n`);
			break;
		}
	}

	if (quit) {
		console.log(`\n  ${DIM}Thanks for playing!${RESET}\n`);
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
