// A gamepad, polled the way the Gamepad API demands: by asking every frame
// what is pressed now. Browsers do not send events for sticks and triggers,
// so there is no listener to attach - only this loop.
//
// The mapping is the standard one: button 0 is the bottom face button (A on
// Xbox, cross on PlayStation), 1 is the right face (B/circle), 2 the left
// (X/square), 3 the top (Y/triangle), 9 is start. D-pad is buttons 12-15.
// Anything else is ignored.

export type GamepadDirection = 'up' | 'down' | 'left' | 'right';

export interface GamepadActions {
  move(direction: GamepadDirection): void;
  confirm(): void;
  cancel(): void;
  secondary(): void;
  pause(): void;
}

// How long a held D-pad direction waits before it starts repeating, and how
// fast it repeats after that. Without the repeat, holding a direction moves
// one pile; without the initial delay, a single press stutters.
const REPEAT_DELAY_MS = 350;
const REPEAT_RATE_MS = 150;
// A stick has to mean it before it counts as a direction.
const STICK_DEADZONE = 0.5;

export class GamepadController {
  private raf = 0;
  private running = false;
  // Per-direction repeat state: when the hold started, and when it last fired.
  private readonly held = new Map<GamepadDirection, { start: number; last: number }>();
  // Buttons we have already reported as pressed, so a hold is one press.
  private readonly pressed = new Set<number>();
  private lastStick: GamepadDirection | undefined;

  constructor(private readonly actions: GamepadActions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.poll();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.held.clear();
    this.pressed.clear();
    this.lastStick = undefined;
  }

  get active(): boolean {
    return this.running;
  }

  private poll(): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = Array.from(pads).find((p) => p && p.connected);
    if (!pad) {
      this.held.clear();
      this.pressed.clear();
      this.lastStick = undefined;
      return;
    }
    const now = performance.now();
    this.pollDirections(pad, now);
    this.pollButton(pad, 0, now, () => this.actions.confirm());
    this.pollButton(pad, 1, now, () => this.actions.cancel());
    this.pollButton(pad, 3, now, () => this.actions.secondary());
    this.pollButton(pad, 9, now, () => this.actions.pause());
  }

  private pollDirections(pad: Gamepad, now: number): void {
    // D-pad and left stick both drive movement; the stick reports the same
    // four directions once it clears the deadzone.
    const dpad: [number, GamepadDirection][] = [
      [12, 'up'],
      [13, 'down'],
      [14, 'left'],
      [15, 'right'],
    ];
    const active = new Set<GamepadDirection>();
    for (const [index, direction] of dpad) {
      if (pad.buttons[index]?.pressed) active.add(direction);
    }
    const [sx, sy] = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
    let stick: GamepadDirection | undefined;
    if (Math.abs(sx) > STICK_DEADZONE || Math.abs(sy) > STICK_DEADZONE) {
      stick = Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 'right' : 'left') : sy > 0 ? 'down' : 'up';
      active.add(stick);
    }
    // A stick that returns to center releases its direction.
    if (this.lastStick && this.lastStick !== stick && !active.has(this.lastStick)) {
      this.held.delete(this.lastStick);
    }
    this.lastStick = stick;

    for (const direction of active) {
      const state = this.held.get(direction);
      if (!state) {
        this.held.set(direction, { start: now, last: now });
        this.actions.move(direction);
      } else if (now - state.start > REPEAT_DELAY_MS && now - state.last > REPEAT_RATE_MS) {
        state.last = now;
        this.actions.move(direction);
      }
    }
    for (const direction of this.held.keys()) {
      if (!active.has(direction)) this.held.delete(direction);
    }
  }

  private pollButton(pad: Gamepad, index: number, _now: number, fire: () => void): void {
    if (pad.buttons[index]?.pressed) {
      if (!this.pressed.has(index)) {
        this.pressed.add(index);
        fire();
      }
    } else {
      this.pressed.delete(index);
    }
  }
}
