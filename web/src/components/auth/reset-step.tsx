"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Eye, EyeOff } from "lucide-react";

import { ApiError } from "@/lib/api/client";
import { authApi } from "@/lib/api/endpoints";
import type { TokenPair } from "@/lib/api/types";

const RESEND_COOLDOWN_SECONDS = 60;

/** Forgotten-password screen: the mailed code and the new password together,
 *  so proving the mailbox and choosing the password are one step. */
export function ResetStep({
  email,
  ttlMinutes,
  onReset,
  onBack,
}: {
  email: string;
  ttlMinutes: number;
  onReset: (pair: TokenPair) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const codeRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      onReset(await authApi.resetPassword({ email, code, new_password: password }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setPending(false);
      setCode("");
      codeRef.current?.focus();
    }
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    try {
      await authApi.forgotPassword({ email });
      setNotice("A new code is on its way.");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send a new code.");
    }
  };

  return (
    <div className="mk-in">
      <h1 className="mk-display text-[2rem] tracking-[-0.03em]">Set a new password</h1>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--mk-muted)]">
        If <span className="text-[var(--mk-paper)]">{email}</span> has an account, a six-digit code
        is on its way. It expires in {ttlMinutes} minutes.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label className="mk-label" htmlFor="reset-code">
            Reset code
          </label>
          <input
            id="reset-code"
            ref={codeRef}
            className="mk-field mk-mono text-center text-[1.25rem] tracking-[0.55em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            aria-describedby={error ? errorId : undefined}
          />
        </div>

        <div>
          <label className="mk-label" htmlFor="reset-password">
            New password
          </label>
          <div className="relative">
            <input
              id="reset-password"
              className="mk-field pr-11"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="mk-field-button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide characters" : "Show characters"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <p className="mt-2 text-[0.75rem] text-[var(--mk-faint)]">
            At least 8 characters. Everywhere you are signed in will be signed out.
          </p>
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
          disabled={pending || code.length < 6 || password.length < 8}
        >
          {pending ? "Setting it…" : "Set password and sign in"}
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
          Back to log in
        </button>
      </div>
    </div>
  );
}
