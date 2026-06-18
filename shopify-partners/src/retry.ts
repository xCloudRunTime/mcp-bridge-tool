export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 10_000;
  const shouldRetry = opts.shouldRetry ?? isRetryable;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !shouldRetry(err, attempt)) throw err;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

function isRetryable(err: unknown): boolean {
  if (isAxiosError(err)) {
    const status = (err as { response?: { status: number } }).response?.status;
    if (status === undefined) return true;
    return status === 429 || status >= 500;
  }
  if (err instanceof Error) {
    return (
      err.message.includes("ECONNRESET") ||
      err.message.includes("ETIMEDOUT") ||
      err.message.includes("socket hang up")
    );
  }
  return false;
}

function isAxiosError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "isAxiosError" in err &&
    (err as { isAxiosError: boolean }).isAxiosError === true
  );
}
