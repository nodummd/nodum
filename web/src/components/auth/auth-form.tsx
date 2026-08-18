"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";

import { ApiError } from "@/lib/api/client";
import { authApi } from "@/lib/api/endpoints";
import { isVerificationRequired } from "@/lib/api/types";
import { useAuthStore } from "@/lib/stores/auth-store";

import { ResetStep } from "./reset-step";
import { VerifyStep } from "./verify-step";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const applyTokens = useAuthStore((s) => s.applyTokens);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the server says this address still has to be confirmed — from a
  // fresh signup, or from logging in to an account that never finished one.
  const [awaitingCode, setAwaitingCode] = useState<{
    email: string;
    ttlMinutes: number;
    justSent: boolean;
  } | null>(null);
  // Set once a reset code has been requested for this address.
  const [resetting, setResetting] = useState<{ email: string; ttlMinutes: number } | null>(null);
  const { data: providers } = useQuery({
    queryKey: ["auth-providers"],
    queryFn: authApi.providers,
    staleTime: 5 * 60_000,
  });
  const [pending, setPending] = useState(false);
  const errorId = useId();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (mode === "signup") {
        const result = await authApi.signup({ email, password, name });
        if (isVerificationRequired(result)) {
          setAwaitingCode({ email: result.email, ttlMinutes: result.expires_in_minutes, justSent: true });
          setPending(false);
          return;
        }
        applyTokens(result);
      } else {
        applyTokens(await authApi.login({ email, password }));
      }
      router.replace("/vault");
    } catch (err) {
      // An unverified account trying to log in gets the code screen, not a
      // dead end: the address is known, so a new code is one click away.
      if (err instanceof ApiError && err.code === "email_not_verified") {
        setAwaitingCode({ email, ttlMinutes: 15, justSent: false });
        setPending(false);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setPending(false);
    }
  };

  /** "Forgot password?" — send the code, then show the reset screen. The
   *  server answers the same way for an address with no account, so this can
   *  proceed without confirming anything about it. */
  const startReset = async () => {
    // Checked here because the button is outside the form's own validation,
    // and the server's answer to a malformed address is a bare 422.
    if (!/.+@.+\..+/.test(email.trim())) {
      setError("Enter your email address first, then we can send you a reset code.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await authApi.forgotPassword({ email });
      setResetting({ email, ttlMinutes: 15 });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send a reset code.");
    } finally {
      setPending(false);
    }
  };

  if (resetting) {
    return (
      <ResetStep
        email={resetting.email}
        ttlMinutes={resetting.ttlMinutes}
        onReset={(pair) => {
          applyTokens(pair);
          router.replace("/vault");
        }}
        onBack={() => setResetting(null)}
      />
    );
  }

  if (awaitingCode) {
    return (
      <VerifyStep
        email={awaitingCode.email}
        ttlMinutes={awaitingCode.ttlMinutes}
        justSent={awaitingCode.justSent}
        onVerified={(pair) => {
          applyTokens(pair);
          router.replace("/vault");
        }}
        onBack={() => setAwaitingCode(null)}
      />
    );
  }

  return (
    <div className="mk-in">
      <h1 className="mk-display text-[2rem] tracking-[-0.03em]">
        {mode === "signup" ? "Create your vault" : "Welcome back"}
      </h1>
      <p className="mt-2 text-[0.9375rem] text-[var(--mk-muted)]">
        {mode === "signup"
          ? "Free and open source. Your notes stay plain markdown."
          : "Log in to open your vault."}
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        {mode === "signup" && (
          <div>
            <label className="mk-label" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              className="mk-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              autoComplete="name"
              placeholder="Ada Lovelace"
            />
          </div>
        )}

        <div>
          <label className="mk-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="mk-field"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="mk-label" htmlFor="password">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              className="mk-field pr-11"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "signup" ? 8 : 1}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              aria-describedby={error ? errorId : undefined}
            />
            <button
              type="button"
              className="mk-field-button"
              onClick={() => setShowPassword((v) => !v)}
              // Deliberately not "…password": `getByLabel("Password")` is how
              // the auth e2e reaches the field, and a second control carrying
              // that word makes the locator ambiguous.
              aria-label={showPassword ? "Hide characters" : "Show characters"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {mode === "signup" ? (
            <p className="mt-2 text-[0.75rem] text-[var(--mk-faint)]">At least 8 characters.</p>
          ) : (
            <button
              type="button"
              onClick={startReset}
              className="mt-2 text-[0.75rem] text-[var(--mk-faint)] underline-offset-4 hover:text-[var(--mk-violet)] hover:underline"
            >
              Forgot password?
            </button>
          )}
        </div>

        {error && (
          <p id={errorId} role="alert" className="text-[0.875rem] text-[#ff6b81]">
            {error}
          </p>
        )}

        <button type="submit" className="mk-btn mk-btn--primary w-full" disabled={pending}>
          {pending ? "One moment…" : mode === "signup" ? "Sign up" : "Log in"}
        </button>
      </form>

      {providers?.google && (
        <>
          <div className="mk-mono my-5 flex items-center gap-3 text-[0.7rem] text-[var(--mk-faint)]">
            <span className="h-px flex-1 bg-[var(--mk-line)]" /> or{" "}
            <span className="h-px flex-1 bg-[var(--mk-line)]" />
          </div>
          <a href="/api/v1/auth/google/start" className="mk-btn mk-btn--ghost w-full">
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A10.97 10.97 0 0 0 1 12c0 1.77.42 3.45 1.18 4.94l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.16-3.16C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            Continue with Google
          </a>
        </>
      )}

      <p className="mt-8 text-center text-[0.875rem] text-[var(--mk-muted)]">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link className="text-[var(--mk-violet)] underline-offset-4 hover:underline" href="/login">
              Log in
            </Link>
          </>
        ) : (
          <>
            New to Nodum?{" "}
            <Link className="text-[var(--mk-violet)] underline-offset-4 hover:underline" href="/signup">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
