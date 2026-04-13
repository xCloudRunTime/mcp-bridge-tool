import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/retry";

// ── Helpers ───────────────────────────────────────────────────
// Use baseDelayMs: 0 so retries are instant — no fake timers needed.

function axiosError(status: number): Error & { isAxiosError: boolean; response: { status: number } } {
  const err = new Error(`HTTP ${status}`) as Error & { isAxiosError: boolean; response: { status: number } };
  err.isAxiosError = true;
  err.response = { status };
  return err;
}

function networkError(message: string): Error {
  return new Error(message);
}

const FAST: Parameters<typeof withRetry>[1] = { baseDelayMs: 0, maxAttempts: 4 };

// ── Tests ─────────────────────────────────────────────────────
describe("withRetry", () => {
  it("returns result immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, FAST);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 Too Many Requests and eventually succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(axiosError(429))
      .mockRejectedValueOnce(axiosError(429))
      .mockResolvedValue("success");
    const result = await withRetry(fn, FAST);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries on 500 Internal Server Error", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(axiosError(500))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, FAST);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 502 Bad Gateway", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(axiosError(502))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, FAST);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 Service Unavailable", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(axiosError(503))
      .mockResolvedValue("done");
    const result = await withRetry(fn, FAST);
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on 401 Unauthorized", async () => {
    const fn = vi.fn().mockRejectedValue(axiosError(401));
    await expect(withRetry(fn, FAST)).rejects.toMatchObject({ response: { status: 401 } });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 404 Not Found", async () => {
    const fn = vi.fn().mockRejectedValue(axiosError(404));
    await expect(withRetry(fn, FAST)).rejects.toMatchObject({ response: { status: 404 } });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 422 Unprocessable Entity", async () => {
    const fn = vi.fn().mockRejectedValue(axiosError(422));
    await expect(withRetry(fn, FAST)).rejects.toMatchObject({ response: { status: 422 } });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on ECONNRESET network error", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(networkError("ECONNRESET"))
      .mockResolvedValue("reconnected");
    const result = await withRetry(fn, FAST);
    expect(result).toBe("reconnected");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on ETIMEDOUT", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(networkError("ETIMEDOUT"))
      .mockResolvedValue("done");
    const result = await withRetry(fn, FAST);
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on socket hang up", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(networkError("socket hang up"))
      .mockResolvedValue("done");
    const result = await withRetry(fn, FAST);
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("exhausts maxAttempts and throws the last error", async () => {
    const fn = vi.fn().mockRejectedValue(axiosError(503));
    await expect(withRetry(fn, { baseDelayMs: 0, maxAttempts: 3 })).rejects.toMatchObject({
      response: { status: 503 },
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects custom shouldRetry predicate (never retry)", async () => {
    const fn = vi.fn().mockRejectedValue(axiosError(503));
    await expect(withRetry(fn, { baseDelayMs: 0, shouldRetry: () => false })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects custom maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(axiosError(500));
    await expect(withRetry(fn, { baseDelayMs: 0, maxAttempts: 2 })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-retryable plain Error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("some random error"));
    await expect(withRetry(fn, FAST)).rejects.toThrow("some random error");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
