import { cn } from "@/lib/utils";

type ToastProps = {
  open: boolean;
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
  onOpenChange?: (v: boolean) => void;
};

export function Toast({ open, title, description, variant = "default", onOpenChange }: ToastProps) {
  if (!open) return null;
  return (
    <div className={cn(
      "fixed bottom-4 right-4 z-50 min-w-[280px] rounded-lg border bg-background p-3 shadow",
      variant === "destructive" && "border-destructive text-destructive-foreground"
    )}>
      <div className="text-sm font-medium">{title}</div>
      {description && <div className="text-xs text-muted-foreground">{description}</div>}
      <div className="mt-2 text-right">
        <button className="rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={() => onOpenChange?.(false)}>
          Close
        </button>
      </div>
    </div>
  );
}

