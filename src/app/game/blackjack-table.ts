import { CARD_HEIGHT, CARD_WIDTH } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, PrintMark, TableGame, TableMoveResult } from './table-game';
import { BlackjackState, CUT, act, actions, deal, hasWon, isDeadEnd, note, pileRefs, status } from './blackjack';

// Narrow, for bigger cards: there are only ever a handful on the table, and
// the board is fitted to the screen's width.
const WIDTH = 360;

// The dealer across the top, below the lettering; your hand below that.
const DEALER_Y = 230;
const HAND_Y = 450;
// Your stack sits behind your cards, on the side of them nearest you.
const BANK_Y = HAND_Y + CARD_HEIGHT / 2 + 36;
// A split hand sits under the first, which stays where it was - hands are
// spread across the table, so side by side they would run into each other -
// and below your stack.
const HAND_ROWS = [HAND_Y, BANK_Y + 30 + CARD_HEIGHT / 2];
// What a card shows of the one under it, spread across: its whole corner,
// rank and suit side by side, and a little clear felt-white past them.
const SPREAD = Math.round(CARD_WIDTH * 0.6);

// The shoe beside the dealer, where it is on a real table, and the discard
// tray on the other side - at the two ends of the dealer's row, clear of a
// hand of six spread between them.
const SHOE = { x: WIDTH - 45, y: DEALER_Y };
const TRAY = { x: 45, y: DEALER_Y };

// The printing, between the dealer and you, the way it runs round a real
// table: the house's rules lettered along the curve of the rim, between two
// gold rules, and the betting circle in front of your seat.
//
// Every line is part of one set of circles, centred far above the dealer, so
// they bow toward you together and read the right way up from the chair.
const RIM_CENTRE_Y = -260;
const BET_Y = 372;

/** A gold rule along the rim, its lowest point at `y`, `half` either side. */
function rule(y: number, half: number, stroke: number): PrintMark {
  const radius = y - RIM_CENTRE_Y;
  const sag = radius - Math.sqrt(radius * radius - half * half);
  return {
    path: `M 0 1 A ${radius} ${radius} 0 0 0 ${2 * half} 1`,
    viewBox: [0, 0, 2 * half, sag + 2],
    width: 2 * half,
    height: sag + 2,
    stroke,
    x: WIDTH / 2,
    // Placed by its middle; the arc's lowest point is the bottom of its box.
    y: y - sag / 2,
  };
}

/** Words along the rim, the middle of the line at `y`. */
const lettering = (text: string, y: number, size: number, spacing: number): PrintMark => ({
  text, size, spacing, arc: -(y - RIM_CENTRE_Y), x: WIDTH / 2, y,
});

const PRINTING: readonly PrintMark[] = [
  rule(290, 150, 1.2),
  lettering('BLACKJACK PAYS 3 TO 2', 309, 14, 0.12),
  lettering('DEALER STANDS ON ALL 17s', 328, 9.5, 0.16),
  rule(340, 140, 0.8),
  // The betting circle, a ring inside a ring.
  { shape: 'ellipse', width: 50, height: 50, stroke: 1.4, x: WIDTH / 2, y: BET_Y },
  { shape: 'ellipse', width: 42, height: 42, stroke: 0.7, x: WIDTH / 2, y: BET_Y, alpha: 0.6 },
];

// Blackjack, as the board sees it.
//
// No card on this table is ever picked up. Every move is a decision, made
// with the game's own buttons under the board - bet, hit, stand, double,
// split - and the cards come out of the shoe to show what it was.
export function blackjackTable(bankroll: () => number): TableGame<BlackjackState> {
  return {
    id: 'blackjack',
    label: 'Blackjack',
    width: WIDTH,
    columns: 5,
    drops: false,
    // A move is a button. How many of them a shoe took says nothing.
    showsMoves: false,
    forPoints: { unit: 'chips' },
    // On the felt, always: see TableGame.scoreIsChips.
    scoreIsChips: true,
    // Your stack behind your cards, nearest you; your bet tossed up into the
    // circle; and the house, the dealer's side of the table, which pays from
    // there and sweeps a losing bet back to it.
    chipSeat: {
      bank: { x: WIDTH / 2, y: BANK_Y },
      bet: { x: WIDTH / 2, y: BET_Y + 6 },
      house: { x: WIDTH / 2, y: DEALER_Y - CARD_HEIGHT / 2 - 14 },
    },
    printing: PRINTING,
    // Every hit turns a card nobody has seen. An undo would be a look at
    // the next one.
    undoable: false,
    actAnchor: pileRefs.hand(0),

    slots(_handedness: Handedness): PileSlot[] {
      return [
        { ref: pileRefs.stock, column: 0, row: 'top', ...SHOE, recycle: false },
        { ref: pileRefs.waste, column: 0, row: 'top', ...TRAY },
        { ref: pileRefs.dealer, column: 0, row: 'tableau', x: WIDTH / 2, y: DEALER_Y, printed: true, target: false },
        ...HAND_ROWS.map((y, i) => ({
          ref: pileRefs.hand(i),
          column: 0,
          row: 'tableau' as const,
          x: WIDTH / 2,
          y,
          // The second only exists once a pair has been split.
          printed: i === 0,
          target: false,
        })),
      ];
    },

    // Spread across, each card's index showing, the way a dealer lays a hand
    // out on the felt.
    fanStep(ref: PileRef, _cards: readonly Card[], index: number): number {
      return ref.kind === 'tableau' && index > 0 ? SPREAD : 0;
    },
    fansUp: () => false,
    fansAcross: (ref: PileRef) => ref.kind === 'tableau',

    deal: (random) => deal(bankroll(), random),
    dealsFaceDown: false,

    piles(state: BlackjackState): PileCards[] {
      return [
        { ref: pileRefs.stock, cards: state.stock },
        { ref: pileRefs.waste, cards: state.waste },
        { ref: pileRefs.dealer, cards: state.dealer },
        ...HAND_ROWS.map((_, i) => ({ ref: pileRefs.hand(i), cards: state.hands[i]?.cards ?? [] })),
      ];
    },

    moveCount: (state) => state.moves,
    // Nothing is picked up, nothing is put down, and the deck is not turned
    // by pressing it: every move goes through act.
    liftable: () => undefined,
    canDrop: () => false,
    apply: () => undefined,
    act: (state, action): TableMoveResult<BlackjackState> | undefined => act(state, action),
    autoTarget: () => undefined,
    autoFinishMove: () => undefined,
    canAutoFinish: () => false,
    hasWon,
    isDeadEnd,

    view(state: BlackjackState): GameView {
      return {
        score: state.bank,
        // On the table only while the hand is played: once it is settled
        // the bet has been paid out, or taken.
        bet: state.phase === 'play' ? state.hands.reduce((sum, hand) => sum + hand.bet, 0) : undefined,
        // Cards left before the cut card ends the shoe.
        deck: Math.max(0, state.stock.length - CUT),
        status: status(state),
        note: note(state),
        actions: actions(state),
      };
    },

    dealOrigin: () => SHOE,
  };
}
