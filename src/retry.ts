/**
 * retry.ts
 * Exponential backoff retry utility for HTTP and AWS SDK calls.
 *
 * Usage:
 *   const data = await withRetry(() => axios.get(url, { headers }));
 */

// ---------------------------------------------------------------
// Config
// ---------------------------------------------------------------
export interface RetryOptions {
  maxAttempts?: number;  // Total attempts including first try (default: 4)
  baseDelayMs?: number;  // Initial delay in ms (default: 500)
  maxDelayMs?:  number;  // Cap on any single delay (default: 10_000)
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY   = 500;
const DEFAULT_MAX_DELAY    = 10_000;

// ---------------------------------------------------------------
// Core Retry Helper
// ---------------------------------------------------------------
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts  = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs  = opts.baseDelayMs ?? DEFAULT_BASE_DELAY;
  const maxDelayMs   = opts.maxDelayMs  ?? DEFAULT_MAX_DELAY;
  const shouldRetry  = opts.shouldRetry ?? isRetryable;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts || !shouldRetry(err, attempt)) {
        throw err;
      }

      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(delay);
    }
  }

  // Unreachable — satisfies TypeScript
  throw lastError;
}

// ---------------------------------------------------------------
// Default Retryability Classifier
// ---------------------------------------------------------------
function isRetryable(err: unknown): boolean {
  // Axios HTTP errors
  if (isAxiosError(err)) {
    const status = err.response?.status;
    if (status === undefined) return true;  // Network error / timeout
    // Retry on: 429 Too Many Requests, 500/502/503/504 Server Errors
    return status === 429 || status >= 500;
  }

  // AWS SDK errors
  if (isAwsError(err)) {
    const code = err.name ?? err.code ?? "";
    return (
      code === "ProvisionedThroughputExceededException" ||
      code === "RequestLimitExceeded" ||
      code === "ThrottlingException" ||
      code === "InternalServerError" ||
      code === "ServiceUnavailable"
    );
  }

  // Network / connection errors
  if (err instanceof Error) {
    return (
      err.message.includes("ECONNRESET") ||
      err.message.includes("ETIMEDOUT") ||
      err.message.includes("ENOTFOUND") ||
      err.message.includes("socket hang up")
    );
  }

  return false;
}

// ---------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------
interface AxiosError {
  isAxiosError: boolean;
  response?: { status: number };
  code?: string;
}

interface AwsError {
  name?: string;
  code?: string;
  $fault?: string;
}

function isAxiosError(err: unknown): err is AxiosError {
  return (
    typeof err === "object" &&
    err !== null &&
    "isAxiosError" in err &&
    (err as AxiosError).isAxiosError === true
  );
}

function isAwsError(err: unknown): err is AwsError {
  return (
    typeof err === "object" &&
    err !== null &&
    "$fault" in (err as AwsError)
  );
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
