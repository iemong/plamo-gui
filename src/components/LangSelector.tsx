type Props = {
  id: "from" | "to";
  value: string;
  onChange: (v: string) => void;
  detectable?: boolean;
};

export function LangSelector({ id, value, onChange, detectable }: Props) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm text-muted-foreground">
        {id === "from" ? "From" : "To"}
      </label>
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {detectable && <option value="auto">Auto</option>}
        <option value="en">English</option>
        <option value="ja">Japanese</option>
        <option value="zh">Chinese</option>
      </select>
    </div>
  );
}

