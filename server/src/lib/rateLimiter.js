/**
 * Token bucket: holds up to `capacity` tokens, refilled at `refillPerSecond`.
 * Each accepted event costs one token, so short bursts pass and sustained
 * floods do not.
 */
export class TokenBucket {
  constructor({ capacity, refillPerSecond }) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = capacity;
    this.updatedAt = Date.now();
  }

  /** @returns {boolean} false when the caller should be rejected. */
  take(now = Date.now()) {
    const elapsedSeconds = (now - this.updatedAt) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
