type Props = {
  value?: number | null;
};

export function Progress({ value }: Props) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full bg-primary transition-all"
        style={{ width: value != null ? `${Math.floor(value * 100)}%` : undefined }}
      />
    </div>
  );
}

