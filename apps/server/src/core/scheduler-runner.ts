import type { SchedulerDeps } from "./scheduler.js";
import { runSchedulerTick } from "./scheduler.js";

/**
 * Owns the real-clock polling loop (spec 15.3: "poll due jobs at least once
 * per second"). `wake()` lets callers (checkout submission, clock advance)
 * trigger an immediate tick instead of waiting for the next poll.
 */
export class SchedulerRunner {
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    private readonly deps: SchedulerDeps,
    private readonly intervalMs = 1_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<{ executed: number }> {
    if (this.ticking) return { executed: 0 };
    this.ticking = true;
    try {
      return await runSchedulerTick(this.deps);
    } finally {
      this.ticking = false;
    }
  }

  /** Drains due work by ticking until a tick executes nothing or the deadline passes. */
  async drain(deadlineMs: number): Promise<{ idle: boolean }> {
    const start = Date.now();
    for (;;) {
      const { executed } = await this.tick();
      if (executed === 0) return { idle: true };
      if (Date.now() - start >= deadlineMs) return { idle: false };
    }
  }
}
