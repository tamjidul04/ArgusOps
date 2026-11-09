export type Desired = "RUN" | "PAUSE" | "KILL";

export interface SyncPolicy {
  loopScoreThreshold?: number;
  exactRepeatLimit?: number;
}

export interface SyncReply {
  desired?: Desired;
  reason?: string;
  hint?: string;
  policy?: SyncPolicy;
}

/**
 * What the agent is currently allowed to do. The local proxy reads it before forwarding each request;
 * the sync loop and the local loop detector write it.
 */
export class ControlState {
  desired: Desired = "RUN";
  reason = "";
  /** Bumped on every local pause, so a reply to a sync that was already in flight can be recognised as stale. */
  epoch = 0;
  private hint: string | null = null;
  private waiters: Array<() => void> = [];

  /**
   * Merge the cloud's answer. Returns true if the desired state changed.
   * `sentEpoch` is the epoch when the request was sent: if the agent was paused locally in the meantime,
   * the cloud answered without knowing about that pause, so its run/pause verdict is ignored.
   */
  apply(reply: SyncReply, sentEpoch?: number): boolean {
    const stale = sentEpoch !== undefined && sentEpoch !== this.epoch;
    const next = stale && reply.desired !== "KILL" ? this.desired : (reply.desired ?? this.desired);
    const changed = next !== this.desired;
    if (reply.reason !== undefined && !stale) this.reason = reply.reason;
    if (reply.hint) this.hint = reply.hint;
    this.desired = next;
    if (next !== "PAUSE") this.release();
    return changed;
  }

  /** True once the agent has been told to stop. (A method, because it can change while a request waits.) */
  isKilled(): boolean {
    return this.desired === "KILL";
  }

  /** The local loop detector pauses the agent before the cloud has heard about it. */
  pauseLocally(reason: string) {
    this.epoch++;
    this.desired = "PAUSE";
    this.reason = reason;
  }

  /** The hint the operator left for the next request, handed out once. */
  takeHint(): string | null {
    const h = this.hint;
    this.hint = null;
    return h;
  }

  /** Resolves when the agent may run again (or must stop). Rejects if the caller aborts. */
  waitUntilNotPaused(signal?: AbortSignal): Promise<void> {
    if (this.desired !== "PAUSE") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        this.waiters = this.waiters.filter((w) => w !== done);
        reject(new Error("aborted"));
      };
      if (signal?.aborted) return reject(new Error("aborted"));
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(done);
    });
  }

  private release() {
    const w = this.waiters;
    this.waiters = [];
    for (const fn of w) fn();
  }
}
