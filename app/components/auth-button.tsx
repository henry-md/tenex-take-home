"use client";

import { signIn, signOut } from "next-auth/react";

type AuthButtonProps = {
  isAuthenticated: boolean;
};

export function AuthButton({ isAuthenticated }: AuthButtonProps) {
  if (isAuthenticated) {
    return (
      <button
        className="rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-slate-800 transition hover:border-black/20 hover:bg-black/5"
        onClick={() => signOut({ callbackUrl: "/" })}
        type="button"
      >
        Sign out
      </button>
    );
  }

  return (
    <button
      className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
      onClick={() => signIn("google", { callbackUrl: "/" })}
      type="button"
    >
      Continue with Google
    </button>
  );
}
