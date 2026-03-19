"use client";

import { GripHorizontal } from "lucide-react";
import type { ComponentProps } from "react";
import {
  Group,
  Panel,
  Separator,
} from "react-resizable-panels";

import { cn } from "@/lib/utils";

type ResizablePanelGroupProps = Omit<ComponentProps<typeof Group>, "orientation"> & {
  direction?: "horizontal" | "vertical";
};

function ResizablePanelGroup({
  className,
  direction = "horizontal",
  ...props
}: ResizablePanelGroupProps) {
  return (
    <Group
      className={cn("flex h-full w-full", direction === "vertical" && "flex-col", className)}
      orientation={direction}
      {...props}
    />
  );
}

const ResizablePanel = Panel;

function ResizableHandle({
  className,
  withHandle,
  ...props
}: ComponentProps<typeof Separator> & {
  withHandle?: boolean;
}) {
  return (
    <Separator
      className={cn(
        "relative flex h-4 w-full cursor-row-resize items-center justify-center bg-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-0",
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <div className="flex h-6 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-[0_6px_18px_rgba(15,23,42,0.08)]">
          <GripHorizontal aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
        </div>
      ) : null}
    </Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
