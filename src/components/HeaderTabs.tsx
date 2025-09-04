type Props = {
  tab: "translate" | "history";
  onChange: (t: "translate" | "history") => void;
};

export function HeaderTabs({ tab, onChange }: Props) {
  return (
    <div className="inline-flex rounded-lg border p-1">
      <button
        className={
          "px-3 py-1 text-sm " + (tab === "translate" ? "rounded-md bg-accent" : "text-muted-foreground")
        }
        onClick={() => onChange("translate")}
      >
        Translate text
      </button>
      <button
        className={
          "px-3 py-1 text-sm " + (tab === "history" ? "rounded-md bg-accent" : "text-muted-foreground")
        }
        onClick={() => onChange("history")}
      >
        History
      </button>
    </div>
  );
}

