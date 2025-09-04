type Props = { label: string };
export function ShortcutHint({ label }: Props) {
  return <div className="text-sm text-muted-foreground">{label}</div>;
}
