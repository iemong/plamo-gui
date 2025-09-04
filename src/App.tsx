import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { HeaderTabs } from "@/components/HeaderTabs";
import { LangSelector } from "@/components/LangSelector";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { ShortcutHint } from "@/components/ShortcutHint";
import { Toast } from "@/components/ui/toast";
import { SettingsDialog } from "@/components/SettingsDialog";
import type { HistoryItem, Settings } from "@/types";

// 型は src/types.ts に移動

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

  // ESC でミニウィンドウを閉じる
  useEffect(() => {
    if (!miniOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setMiniOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [miniOpen]);

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
        <HeaderTabs tab={tab} onChange={setTab} />
        <div className="flex items-center gap-2">
          <ShortcutHint />
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
            <LangSelector id="from" detectable value={from} onChange={setFrom} />
            <Textarea
              id="input"
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
            <LangSelector id="to" value={to} onChange={setTo} />
            <Textarea id="output" readOnly aria-live="polite" value={output} />
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
            <Progress value={progress} />
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
        <SettingsDialog
          open={settingsOpen}
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
          onSave={async () => {
            if (!settings) return;
            await invoke("save_settings", { s: settings }).catch(() => {});
            setSettingsOpen(false);
          }}
        />
      )}

      <Toast
        open={status === "error"}
        title="Error"
        description="Translation failed. Check CLI or settings."
        variant="destructive"
        onOpenChange={(v) => v || setStatus("ready")}
      />
    </main>
  );
}

export default App;
