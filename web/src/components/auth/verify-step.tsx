"use client";

import { useEffect, useId, useRef, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { authApi } from "@/lib/api/endpoints";
import type { TokenPair } from "@/lib/api/types";

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * The code screen. Shown after signing up, and to anyone logging in to an
 * account whose address was never confirmed.
 */
export function VerifyStep({
  email,
  ttlMinutes,
  justSent,
  onVerified,
  onBack,
}: {
  email: string;
  ttlMinutes: number;
  /** False when the screen was reached by logging in to an unverified account:
   *  the last code may be hours old, so make "send a new one" available now
   *  instead of holding them behind a cooldown for a send they did not make. */
  justSent: boolean;
  onVerified: (pair: TokenPair) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(justSent ? RESEND_COOLDOWN_SECONDS : 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const submit = async (value: string) => {
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      onVerified(await authApi.verifyEmail({ email, code: value }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setPending(false);
      setCode("");
      inputRef.current?.focus();
    }
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    try {
      await authApi.resendVerification({ email });
      setNotice("A new code is on its way.");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send a new code.");
    }
  };

  return (
    <div className="mk-in">
      <h1 className="mk-display text-[2rem] tracking-[-0.03em]">Check your email</h1>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--mk-muted)]">
        We sent a six-digit code to <span className="text-[var(--mk-paper)]">{email}</span>. It
        expires in {ttlMinutes} minutes.
      </p>

      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(code);
        }}
      >
        <div>
          <label className="mk-label" htmlFor="code">
            Verification code
          </label>
          <input
            id="code"
            ref={inputRef}
            className="mk-field mk-mono text-center text-[1.25rem] tracking-[0.55em]"
            value={code}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(digits);
              // Six digits in means they are done typing — no reason to make
              // them reach for a button.
              if (digits.length === 6 && !pending) void submit(digits);
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            placeholder="000000"
            aria-describedby={error ? errorId : undefined}
          />
        </div>

        {error && (
          <p id={errorId} role="alert" className="text-[0.875rem] text-[#ff6b81]">
            {error}
          </p>
        )}
        {notice && <p className="text-[0.875rem] text-[var(--mk-violet)]">{notice}</p>}

        <button
          type="submit"
          className="mk-btn mk-btn--primary w-full"
          disabled={pending || code.length < 6}
        >
          {pending ? "Checking…" : "Verify email"}
        </button>
      </form>

      <div className="mt-8 flex items-center justify-between text-[0.875rem] text-[var(--mk-muted)]">
        <button
          type="button"
          onClick={resend}
          disabled={cooldown > 0}
          className="text-[var(--mk-violet)] underline-offset-4 hover:underline disabled:text-[var(--mk-faint)] disabled:no-underline"
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Send a new code"}
        </button>
        <button type="button" onClick={onBack} className="underline-offset-4 hover:underline">
          Use another address
        </button>
      </div>
    </div>
  );
}
