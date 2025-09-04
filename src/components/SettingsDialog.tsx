import { Settings } from "@/types";

type Props = {
  open: boolean;
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
  onSave: () => void;
};

export function SettingsDialog({ open, settings, onChange, onClose, onSave }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border bg-card p-4 shadow" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-lg font-medium">Settings</h3>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Style preset</span>
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={settings.style_preset}
              onChange={(e) => onChange({ ...settings, style_preset: e.target.value as Settings["style_preset"] })}
            >
              <option value="business">business</option>
              <option value="tech">tech</option>
              <option value="casual">casual</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Precision</span>
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={settings.plamo.precision}
                onChange={(e) => onChange({ ...settings, plamo: { ...settings.plamo, precision: e.target.value as any } })}
              >
                <option value="4bit">4bit</option>
                <option value="8bit">8bit</option>
                <option value="bf16">bf16</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Timeout (ms)</span>
              <input
                type="number"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={settings.timeout_ms}
                onChange={(e) => onChange({ ...settings, timeout_ms: Number(e.target.value) })}
              />
            </label>
          </div>

          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Glossary path</span>
            <input
              className="h-9 rounded-md border bg-background px-2 text-sm"
              placeholder="/path/to/glossary.json"
              value={settings.glossary_path ?? ""}
              onChange={(e) => onChange({ ...settings, glossary_path: e.target.value })}
            />
          </label>

          <div className="grid gap-2 rounded-lg border p-3">
            <div className="text-sm font-medium">Double Copy</div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.double_copy.enabled}
                onChange={(e) => onChange({ ...settings, double_copy: { ...settings.double_copy, enabled: e.target.checked } })}
              />
              <span>Enable</span>
            </label>
            <div className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="paste-mode"
                  checked={settings.double_copy.paste_mode === "popup"}
                  onChange={() => onChange({ ...settings, double_copy: { ...settings.double_copy, paste_mode: "popup" } })}
                />
                popup
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="paste-mode"
                  checked={settings.double_copy.paste_mode === "clipboard"}
                  onChange={() => onChange({ ...settings, double_copy: { ...settings.double_copy, paste_mode: "clipboard" } })}
                />
                clipboard
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.double_copy.auto_copy}
                onChange={(e) => onChange({ ...settings, double_copy: { ...settings.double_copy, auto_copy: e.target.checked } })}
              />
              <span>Auto copy result</span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button className="rounded-md border px-3 py-1 text-sm hover:bg-accent" onClick={onClose}>
              Cancel
            </button>
            <button className="rounded-md bg-primary px-4 py-1 text-sm text-primary-foreground hover:bg-primary/90" onClick={onSave}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

