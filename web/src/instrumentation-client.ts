/**
 * Browser observability — Sentry, strictly env-gated. NEXT_PUBLIC_SENTRY_DSN
 * is inlined at build; without it the SDK chunk is never loaded.
 */

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn,
      tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
      environment: process.env.NODE_ENV,
    });
  });
}

export {};
