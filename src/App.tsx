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
import { Languages, ArrowLeftRight, Settings as SettingsIcon, Copy, FileText, FileDown, Loader2 } from "lucide-react";

// 型は src/types.ts に移動

function App() {
  const [tab, setTab] = useState<"translate" | "history">("translate");
  const [from, setFrom] = useState<string>("auto");
  const [to, setTo] = useState<string>("en");
  const [input, setInput] = useState<string>("");
  const [output, setOutput] = useState<string>("");
  const [status, setStatus] = useState<"ready" | "translating" | "done" | "error">("ready");
  const [progress, setProgress] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const currentJob = useRef<string | null>(null);
  const lastSig = useRef<string | null>(null);
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
    const un = listen<{ text?: string }>("double-copy", async (e) => {
      let text = (e.payload?.text ?? "").trim();
      if (!text) {
        try {
          const t = await navigator.clipboard.readText();
          if (t && t.trim()) text = t.trim();
        } catch {
          // ignore
        }
      }
      if (!text) text = input; // 最後のフォールバック
      if (text && settings?.double_copy.enabled !== false) {
        setInput(text);
        setMiniOpen(false);
        translate(text);
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
    // 直前に実行したシグネチャを記録（自動翻訳の重複実行防止に利用）
    lastSig.current = `${from}|${to}|${text.trim()}`;
    setOutput("");
    setStatus("translating");
    setProgress(null);
    const id = crypto.randomUUID();
    currentJob.current = id;
    // subscribe to events
    const u1 = await listen<string>(`translate:${id}:chunk`, (e) => {
      setOutput((prev) => prev + e.payload);
    });
    const u2 = await listen<number>(`translate:${id}:progress`, (e) => {
      setProgress(Number(e.payload));
    });
    const uFinal = await listen<string>(`translate:${id}:final`, (e) => {
      // 安全策: 一切チャンクが来なかった場合の最終出力
      if (!output) setOutput(e.payload);
    });
    const u3 = await listen<{ ok?: boolean; reason?: string }>(`translate:${id}:done`, async (e) => {
      const payload = e.payload || {};
      const failed = payload.ok === false;
      // 共通のクリーンアップ
      listeners.current.forEach((f) => f());
      listeners.current = [];
      currentJob.current = null;
      if (failed) {
        // 中断・タイムアウト等は履歴追加やコピーを行わず、待機状態へ
        setStatus("ready");
        setProgress(null);
        setMiniOpen(false);
        return;
      }
      setStatus("done");
      setProgress(1);
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
      setMiniOpen(false);
    });
    listeners.current = [u1, u2, uFinal, u3];
    // Map language codes to CLI-expected labels
    const mapLang = (v: string | null | undefined) => {
      if (!v || v === "auto") return null;
      switch (v) {
        case "ja":
          return "Japanese";
        case "en":
          return "English";
        case "zh":
          return "Chinese";
        default:
          return v;
      }
    };

    await invoke("translate_plamo", {
      opts: {
        id,
        input: text,
        from: mapLang(from),
        to: mapLang(to) ?? "Japanese",
        precision: settings?.plamo.precision ?? null,
        style: null,
        glossary: null,
      },
    }).catch(() => {
      // 後片付け
      try {
        listeners.current.forEach((f) => f());
      } catch {}
      listeners.current = [];
      currentJob.current = null;
      setProgress(null);
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

  // 入力・言語変更時のデバウンス自動翻訳（1秒）
  // 変換中は新規実行しない（中断・再実行もしない）。
  // 直近と同一のシグネチャ（from|to|input）は再実行しない。
  useEffect(() => {
    if (!input.trim()) return;
    const t = setTimeout(async () => {
      if (status === "translating") return; // 実行中はスキップ
      const sig = `${from}|${to}|${input.trim()}`;
      if (lastSig.current === sig) return; // 同一条件の連続実行を抑止
      translate(input);
    }, 1000);
    return () => clearTimeout(t);
  }, [input, from, to]);

  return (
    <main className="mx-auto min-h-screen max-w-[1200px] p-4 md:p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <HeaderTabs tab={tab} onChange={setTab} />
        <div className="flex items-center gap-2">
          <ShortcutHint label={(function () {
            const sc = settings?.double_copy?.shortcut ?? "Super+Shift+C";
            const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
            const mapLegacy = (k: string) => {
              switch (k) {
                case "cmd-shift-c":
                  return isMac ? "⌘⇧C" : "Ctrl+Shift+C";
                case "cmd-alt-c":
                  return isMac ? "⌘⌥C" : "Ctrl+Alt+C";
                case "cmd-k":
                  return isMac ? "⌘K" : "Ctrl+K";
                default:
                  return k;
              }
            };
            const pretty = (spec: string) => {
              if (!spec.includes("+")) return mapLegacy(spec) + (isMac ? " でクイック翻訳" : " to Quick Translate");
              const parts = spec.split("+");
              const mods = parts.slice(0, -1);
              const key = parts.slice(-1)[0];
              const sym = (m: string) => {
                if (!isMac) return m;
                return m === "Super" ? "⌘" : m === "Shift" ? "⇧" : m === "Alt" ? "⌥" : m === "Control" ? "⌃" : m;
              };
              const left = isMac ? mods.map(sym).join("") : mods.join("+");
              const k = key.length === 1 ? key.toUpperCase() : key;
              const txt = isMac ? `${left}${k}` : `${left}+${k}`;
              return isMac ? `${txt} でクイック翻訳` : `${txt} to Quick Translate`;
            };
            return pretty(sc);
          })()} />
          <button
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm hover:bg-accent"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            <SettingsIcon className="h-4 w-4" />
            <span className="sr-only">Settings</span>
          </button>
        </div>
      </div>

      {tab === "translate" ? (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
          {/* Row: From | Swap | To */}
          <div className="md:col-span-2 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <LangSelector id="from" detectable value={from} onChange={setFrom} />
            <button
              className="mx-auto inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm hover:bg-accent"
              onClick={() => {
                const t = from;
                setFrom(to);
                setTo(t);
              }}
              title="Swap languages"
              aria-label="Swap languages"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
            <LangSelector id="to" value={to} onChange={setTo} />
          </div>

          {/* Left: Input */}
          <div className="flex flex-col gap-2">
            <Textarea
              id="input"
              placeholder="Type or paste text to translate"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                disabled={!input || status === "translating"}
                onClick={() => translate(input)}
              >
                {status === "translating" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Translating…
                  </>
                ) : (
                  <>
                    <Languages className="h-4 w-4" /> Translate
                  </>
                )}
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
            <Textarea id="output" readOnly aria-live="polite" value={output} />
            <div className="flex items-center gap-2">
              <button
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1 text-sm hover:bg-accent"
                onClick={async () => output && (await navigator.clipboard.writeText(output))}
                disabled={!output}
              >
                <Copy className="h-4 w-4" /> Copy
              </button>
              <button
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1 text-sm hover:bg-accent"
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
                <FileText className="h-4 w-4" /> Save .txt
              </button>
              <button
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1 text-sm hover:bg-accent"
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
                <FileDown className="h-4 w-4" /> Save .md
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
            if (settings.double_copy?.shortcut) {
              await invoke("update_shortcut", { shortcut: settings.double_copy.shortcut }).catch(() => {});
            }
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
