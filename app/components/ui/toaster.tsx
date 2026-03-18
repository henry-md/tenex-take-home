"use client";

import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      closeButton
      expand
      position="bottom-right"
      toastOptions={{
        classNames: {
          description: "text-slate-600",
          error: "border-rose-200",
          success: "border-emerald-200",
          toast:
            "border bg-white text-slate-900 shadow-[0_20px_50px_rgba(15,23,42,0.16)]",
        },
      }}
    />
  );
}
