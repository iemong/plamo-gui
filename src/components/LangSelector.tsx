import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Props = {
  id: "from" | "to";
  value: string;
  onChange: (v: string) => void;
  detectable?: boolean;
};

export function LangSelector({ id, value, onChange, detectable }: Props) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-sm text-muted-foreground min-w-[3rem]">
        {id === "from" ? "From" : "To"}
      </label>
      <Select value={value} onValueChange={(v) => onChange(v)}>
        <SelectTrigger className="w-[220px]" aria-label={id === "from" ? "From language" : "To language"}>
          <SelectValue placeholder={id === "from" ? "Auto" : "Select language"} />
        </SelectTrigger>
        <SelectContent>
          {detectable && <SelectItem value="auto">Auto</SelectItem>}
          <SelectItem value="en">English</SelectItem>
          <SelectItem value="ja">Japanese</SelectItem>
          <SelectItem value="zh">Chinese</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
