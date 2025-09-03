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

  // Load history on boot
  useEffect(() => {
    invoke<HistoryItem[]>("load_history").then(setHistory).catch(() => {});
  }, []);

  // Handle double-copy signal from backend
  useEffect(() => {
    const un = listen("double-copy", async () => {
      try {
        const clip = await navigator.clipboard.readText();
        if (clip && clip.trim().length > 0) {
          setInput(clip);
          translate(clip);
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
    });
    listeners.current = [u1, u2, u3];
    await invoke("translate_plamo", {
      opts: {
        id,
        input: text,
        from: from === "auto" ? null : from,
        to,
        precision: null,
        style: null,
        glossary: null,
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
        <div className="text-sm text-muted-foreground">⌘C×2 でクイック翻訳</div>
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
    </main>
  );
}

export default App;
