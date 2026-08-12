/**
 * Server/edge observability — Sentry, strictly env-gated. Without SENTRY_DSN
 * nothing is imported and the runtime carries zero SDK weight.
 */

export async function register(): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    environment: process.env.NODE_ENV,
  });
}

export async function onRequestError(...args: unknown[]): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  (Sentry.captureRequestError as (...a: unknown[]) => void)(...args);
}
