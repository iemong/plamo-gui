import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

type HistoryItem = {
  id: string;
  input: string;
  output: string;
  from?: string;
  to: string;
  created_at: number;
};

type Settings = {
  engine: string;
  plamo: { precision: "4bit" | "8bit" | "bf16"; server: boolean };
  style_preset: "business" | "tech" | "casual";
  glossary_path?: string;
  timeout_ms: number;
  double_copy: { enabled: boolean; paste_mode: "popup" | "clipboard"; auto_copy: boolean };
};

function App() {
  const [tab, setTab] = useState<"translate" | "history">("translate");
  const [from, setFrom] = useState<string>("auto");
  const [to, setTo] = useState<string>("ja");
  const [input, setInput] = useState<string>("");
  const [output, setOutput] = useState<string>("");
  const [status, setStatus] = useState<"ready" | "translating" | "done" | "error">("ready");
  const [progress, setProgress] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const currentJob = useRef<string | null>(null);
  const listeners = useRef<UnlistenFn[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [miniOpen, setMiniOpen] = useState(false);

  // Load history on boot
  useEffect(() => {
    invoke<HistoryItem[]>("load_history").then(setHistory).catch(() => {});
    invoke<Settings>("load_settings")
      .then((s) => setSettings(s))
      .catch(() =>
        setSettings({
          engine: "plamo",
          plamo: { precision: "4bit", server: false },
          style_preset: "business",
          glossary_path: undefined,
          timeout_ms: 60000,
          double_copy: { enabled: true, paste_mode: "popup", auto_copy: false },
        }),
      );
  }, []);

  // Handle double-copy signal from backend
  useEffect(() => {
    const un = listen("double-copy", async () => {
      try {
        const clip = await navigator.clipboard.readText();
        if (clip && clip.trim().length > 0) {
          setInput(clip);
          if (settings?.double_copy.enabled !== false) {
            if (settings?.double_copy.paste_mode === "popup") setMiniOpen(true);
            translate(clip);
          }
        }
      } catch {
        // ignore
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const translate = async (text: string) => {
    if (status === "translating") return;
    setOutput("");
    setStatus("translating");
    setProgress(null);
    const id = crypto.randomUUID();
    currentJob.current = id;
    // subscribe to events
    const u1 = await listen<string>(`translate://${id}`, (e) => {
      setOutput((prev) => prev + e.payload);
    });
    const u2 = await listen<number>(`translate-progress://${id}`, (e) => {
      setProgress(Number(e.payload));
    });
    const u3 = await listen(`translate-done://${id}`, async () => {
      setStatus("done");
      setProgress(1);
      listeners.current.forEach((f) => f());
      listeners.current = [];
      currentJob.current = null;
      const item: HistoryItem = {
        id: id,
        input: text,
        output,
        from: from === "auto" ? undefined : from,
        to,
        created_at: Date.now(),
      };
      setHistory((prev) => [item, ...prev].slice(0, 200));
      invoke("append_history", { item }).catch(() => {});
      // auto copy depending on settings / paste mode
      const shouldCopy = settings?.double_copy.auto_copy || settings?.double_copy.paste_mode === "clipboard";
      if (shouldCopy && output) {
        try {
          await navigator.clipboard.writeText(output);
        } catch {
          // ignore
        }
      }
      if (settings?.double_copy.paste_mode === "popup") {
        setMiniOpen(true);
      } else {
        setMiniOpen(false);
      }
    });
    listeners.current = [u1, u2, u3];
    await invoke("translate_plamo", {
      opts: {
        id,
        input: text,
        from: from === "auto" ? null : from,
        to,
        precision: settings?.plamo.precision ?? null,
        style: settings?.style_preset ?? null,
        glossary: settings?.glossary_path ?? null,
      },
    }).catch(() => {
      setStatus("error");
    });
  };

  const cancel = async () => {
    if (!currentJob.current) return;
    await invoke("abort_translation", { id: currentJob.current }).catch(() => {});
    listeners.current.forEach((f) => f());
    listeners.current = [];
    currentJob.current = null;
    setStatus("ready");
    setProgress(null);
  };

  return (
    <main className="mx-auto min-h-screen max-w-[1200px] p-4 md:p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="inline-flex rounded-lg border p-1">
          <button
            className={
              "px-3 py-1 text-sm " +
              (tab === "translate" ? "rounded-md bg-accent" : "text-muted-foreground")
            }
            onClick={() => setTab("translate")}
          >
            Translate text
          </button>
          <button
            className={
              "px-3 py-1 text-sm " +
              (tab === "history" ? "rounded-md bg-accent" : "text-muted-foreground")
            }
            onClick={() => setTab("history")}
          >
            History
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm text-muted-foreground">⌘C×2 でクイック翻訳</div>
          <button
            className="rounded-md border px-2 py-1 text-sm hover:bg-accent"
            onClick={() => setSettingsOpen(true)}
          >
            Settings
          </button>
        </div>
      </div>

      {tab === "translate" ? (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
          {/* Left: Input */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-sm text-muted-foreground">From</label>
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              >
                <option value="auto">Auto</option>
                <option value="en">English</option>
                <option value="ja">Japanese</option>
                <option value="zh">Chinese</option>
              </select>
            </div>
            <textarea
              id="input"
              className="min-h-[48vh] md:min-h-[64vh] rounded-2xl border bg-background p-4 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Type or paste text to translate"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <button
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                disabled={!input || status === "translating"}
                onClick={() => translate(input)}
              >
                {status === "translating" ? "Translating…" : "Translate"}
              </button>
              {status === "translating" && (
                <button
                  className="inline-flex h-10 items-center justify-center rounded-md border px-3 text-sm hover:bg-accent"
                  onClick={cancel}
                >
                  Cancel
                </button>
              )}
              <button
                className="inline-flex h-10 items-center justify-center rounded-md border px-3 text-sm hover:bg-accent"
                onClick={() => {
                  const t = from;
                  setFrom(to);
                  setTo(t);
                }}
                title="Swap languages"
              >
                ↔︎ Swap
              </button>
            </div>
          </div>

          {/* Right: Output */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-sm text-muted-foreground">To</label>
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              >
                <option value="ja">Japanese</option>
                <option value="en">English</option>
                <option value="zh">Chinese</option>
              </select>
            </div>
            <textarea
              id="output"
              readOnly
              aria-live="polite"
              className="min-h-[48vh] md:min-h-[64vh] rounded-2xl border bg-background p-4 shadow-sm"
              value={output}
            />
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
                onClick={async () => output && (await navigator.clipboard.writeText(output))}
                disabled={!output}
              >
                Copy
              </button>
              <button
                className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
                onClick={() => {
                  if (!output) return;
                  const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "translation.txt";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                disabled={!output}
              >
                Save .txt
              </button>
              <button
                className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
                onClick={() => {
                  if (!output) return;
                  const md = `# Translation\n\n${output}`;
                  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "translation.md";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                disabled={!output}
              >
                Save .md
              </button>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: progress ? `${Math.floor(progress * 100)}%` : undefined }}
              />
            </div>
            <div className="text-right text-xs text-muted-foreground">
              {status === "translating" ? "Translating…" : status === "done" ? "Done" : "Ready"}
            </div>
          </div>
        </section>
      ) : (
        <section>
          <h2 className="mb-3 text-lg font-medium">History</h2>
          <div className="flex flex-col gap-3">
            {history.length === 0 && (
              <div className="text-sm text-muted-foreground">No history yet.</div>
            )}
            {history.map((h) => (
              <button
                key={h.id}
                className="rounded-lg border bg-background p-3 text-left hover:bg-accent"
                onClick={() => {
                  setTab("translate");
                  setInput(h.input);
                  setOutput(h.output);
                }}
              >
                <div className="mb-1 text-xs text-muted-foreground">
                  {new Date(h.created_at).toLocaleString()} • {h.from ?? "auto"} → {h.to}
                </div>
                <div className="line-clamp-2 text-sm">{h.input}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Mini Window (popup mode) */}
      {miniOpen && (
        <div className="fixed right-4 top-4 z-50 w-[560px] max-h-[70vh] rounded-2xl border bg-card p-4 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">engine: {settings?.engine ?? "plamo"}</div>
            <button className="rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={() => setMiniOpen(false)}>
              Close
            </button>
          </div>
          <div className="mb-2 text-xs text-muted-foreground">{from} → {to}</div>
          <div className="grid gap-2">
            <textarea className="h-24 rounded-xl border bg-background p-2 text-sm" readOnly value={input} />
            <textarea className="h-36 rounded-xl border bg-background p-2 text-sm" readOnly value={output} />
          </div>
        </div>
      )}

      {/* Settings Dialog */}
      {settingsOpen && settings && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setSettingsOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border bg-card p-4 shadow" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-medium">Settings</h3>
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Style preset</span>
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={settings.style_preset}
                  onChange={(e) => setSettings({ ...settings, style_preset: e.target.value as Settings["style_preset"] })}
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
                    onChange={(e) => setSettings({ ...settings, plamo: { ...settings.plamo, precision: e.target.value as any } })}
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
                    onChange={(e) => setSettings({ ...settings, timeout_ms: Number(e.target.value) })}
                  />
                </label>
              </div>

              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Glossary path</span>
                <input
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  placeholder="/path/to/glossary.json"
                  value={settings.glossary_path ?? ""}
                  onChange={(e) => setSettings({ ...settings, glossary_path: e.target.value })}
                />
              </label>

              <div className="grid gap-2 rounded-lg border p-3">
                <div className="text-sm font-medium">Double Copy</div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.double_copy.enabled}
                    onChange={(e) => setSettings({ ...settings, double_copy: { ...settings.double_copy, enabled: e.target.checked } })}
                  />
                  <span>Enable</span>
                </label>
                <div className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="paste-mode"
                      checked={settings.double_copy.paste_mode === "popup"}
                      onChange={() => setSettings({ ...settings, double_copy: { ...settings.double_copy, paste_mode: "popup" } })}
                    />
                    popup
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="paste-mode"
                      checked={settings.double_copy.paste_mode === "clipboard"}
                      onChange={() => setSettings({ ...settings, double_copy: { ...settings.double_copy, paste_mode: "clipboard" } })}
                    />
                    clipboard
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.double_copy.auto_copy}
                    onChange={(e) => setSettings({ ...settings, double_copy: { ...settings.double_copy, auto_copy: e.target.checked } })}
                  />
                  <span>Auto copy result</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button className="rounded-md border px-3 py-1 text-sm hover:bg-accent" onClick={() => setSettingsOpen(false)}>
                  Cancel
                </button>
                <button
                  className="rounded-md bg-primary px-4 py-1 text-sm text-primary-foreground hover:bg-primary/90"
                  onClick={async () => {
                    if (!settings) return;
                    await invoke("save_settings", { s: settings }).catch(() => {});
                    setSettingsOpen(false);
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
