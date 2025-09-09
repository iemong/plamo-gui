import React from "react";
import { invoke } from "@tauri-apps/api/core";
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
  const [recording, setRecording] = React.useState(false);
  const [, setRecorded] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Build spec string for plugin: Super/Control/Alt/Shift + Key
      const mods: string[] = [];
      // platform info is not used in spec; keep for future enhancements
      if (e.ctrlKey) mods.push("Control");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      if (e.metaKey) mods.push("Super");
      // Ignore pure modifier presses
      const k = e.key;
      if (["Shift", "Control", "Alt", "Meta"].includes(k)) return;
      // Normalize key
      let key = k.length === 1 ? k.toUpperCase() : k;
      // Special-case common names
      if (key === "Escape") key = "Esc";
      if (key.startsWith("Arrow")) key = key.replace("Arrow", "");
      const spec = [...mods, key].join("+");
      setRecorded(spec);
      setRecording(false);
      onChange({ ...settings, double_copy: { ...settings.double_copy, shortcut: spec } });
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as any);
  }, [recording]);
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

          <PlamoPathField settings={settings} onChange={onChange} />

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
            <div className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Keyboard Shortcut</span>
              <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
                <div className="text-xs text-muted-foreground">
                  {settings.double_copy.shortcut ?? "Not set"}
                </div>
                <button
                  type="button"
                  className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                  onClick={() => {
                    setRecorded(null);
                    setRecording(true);
                  }}
                >
                  {recording ? "Press keys..." : "Record Shortcut"}
                </button>
              </div>
              <div className="text-xs text-muted-foreground">例: Super+Shift+C（macOSの⌘はSuper） / Control+Shift+C</div>
            </div>
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

function PlamoPathField({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [checking, setChecking] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; bin?: string; resolved?: string; error?: string } | null>(null);
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted-foreground">plamo-translate path</span>
      <div className="flex items-center gap-2">
        <input
          className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
          placeholder="/opt/homebrew/bin/plamo-translate または ~/.local/bin/plamo-translate"
          value={settings.plamo.binPath ?? ""}
          onChange={(e) => onChange({ ...settings, plamo: { ...settings.plamo, binPath: e.target.value } })}
        />
        <button
          type="button"
          className="whitespace-nowrap rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            try {
              const r = (await invoke("check_plamo_cli")) as any;
              setResult(r);
              if (r && r.ok) {
                const newPath = (r.resolved as string | undefined) ?? (r.bin as string | undefined);
                if (newPath) {
                  onChange({ ...settings, plamo: { ...settings.plamo, binPath: newPath } });
                }
              }
            } catch (e) {
              setResult({ ok: false, error: String(e) });
            } finally {
              setChecking(false);
            }
          }}
        >
          {checking ? "Checking..." : "Check"}
        </button>
      </div>
      <div className="text-xs text-muted-foreground">空の場合は環境変数 PATH から探索します。環境変数 PLAMO_TRANSLATE_PATH も使用できます。</div>
      {result && (
        <div className={`text-xs ${result.ok ? "text-green-600" : "text-red-600"}`}>
          {result.ok
            ? `Found: ${result.resolved || result.bin || "plamo-translate"}（入力欄に反映済み）`
            : `Not found: ${result.error || "unknown error"}`}
        </div>
      )}
    </label>
  );
}
