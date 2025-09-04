import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minSize?: "sm" | "md";
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, minSize = "md", ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "rounded-2xl border bg-background p-4 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          minSize === "md" ? "min-h-[48vh] md:min-h-[64vh]" : "min-h-[24vh]",
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

