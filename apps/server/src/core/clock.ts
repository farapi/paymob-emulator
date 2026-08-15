// Clock abstraction (spec section 15.5). The scenario engine, scheduler, and
// all persisted timestamps read time through this interface so tests can
// swap in a ManualClock instead of sleeping in real time.

export interface Clock {
  now(): Date;
}

export class RealClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class ClockBackwardsError extends Error {}

/**
 * In-memory logical clock. Persistence (loading/saving `clock_state`) is the
 * caller's responsibility -- this class only enforces "logical time never
 * moves backward" (section 15.5).
 */
export class ManualClock implements Clock {
  private currentMs: number;

  constructor(startMs: number) {
    this.currentMs = startMs;
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  nowMs(): number {
    return this.currentMs;
  }

  advanceBy(ms: number): Date {
    if (!Number.isInteger(ms) || ms < 0) {
      throw new Error("advanceBy requires a non-negative integer millisecond duration");
    }
    this.currentMs += ms;
    return this.now();
  }

  setTo(ms: number): Date {
    if (ms < this.currentMs) {
      throw new ClockBackwardsError("manual clock time may never move backward");
    }
    this.currentMs = ms;
    return this.now();
  }
}
