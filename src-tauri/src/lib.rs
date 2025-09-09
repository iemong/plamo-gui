use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, process::Stdio, sync::Arc};
use tauri::{Emitter, Manager};
// Clipboard read is handled via arboard for now; plugin provides JS-side APIs.
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::Mutex as AsyncMutex,
    time::Duration,
};

// ===== Settings/History datatypes (MVP minimal) =====
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub engine: String,
    pub plamo: PlamoCfg,
    pub style_preset: String,
    pub glossary_path: Option<String>,
    pub timeout_ms: u64,
    pub double_copy: DoubleCopy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlamoCfg {
    pub precision: String,
    pub server: bool,
    #[serde(rename = "binPath", skip_serializing_if = "Option::is_none")]
    pub bin_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoubleCopy {
    pub enabled: bool,
    pub paste_mode: String,
    pub auto_copy: bool,
    #[serde(default)]
    pub shortcut: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            engine: "plamo".into(),
            plamo: PlamoCfg {
                precision: "4bit".into(),
                server: false,
                bin_path: None,
            },
            style_preset: "business".into(),
            glossary_path: None,
            timeout_ms: 60_000,
            double_copy: DoubleCopy {
                enabled: true,
                paste_mode: "popup".into(),
                auto_copy: false,
                shortcut: Some("cmd-shift-c".into()),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub id: String,
    pub input: String,
    pub output: String,
    pub from: Option<String>,
    pub to: String,
    pub created_at: u64,
}

// ===== Translation management =====
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslateOptions {
    pub id: String,
    pub input: String,
    pub from: Option<String>,
    pub to: String,
    pub precision: Option<String>,
    pub style: Option<String>,
    pub glossary: Option<String>,
}

type TaskMap = Arc<AsyncMutex<HashMap<String, tokio::process::Child>>>;

#[tauri::command]
async fn translate_plamo(
    app: tauri::AppHandle,
    tasks: tauri::State<'_, TaskMap>,
    opts: TranslateOptions,
) -> Result<(), String> {
    // 実行バイナリの解決: 設定値 > 環境変数 > PATH
    let settings = read_settings_from_disk(&app);
    let bin = std::env::var("PLAMO_TRANSLATE_PATH")
        .ok()
        .or(settings.plamo.bin_path)
        .unwrap_or_else(|| "plamo-translate".into());
    let mut cmd = Command::new(bin);
    // ざっくりとした引数。実際のCLI仕様に合わせて調整する前提。
    if let Some(from) = &opts.from {
        cmd.arg("--from").arg(from);
    }
    cmd.arg("--to").arg(&opts.to);
    if let Some(p) = &opts.precision {
        cmd.arg("--precision").arg(p);
    }
    // NOTE: As of README, CLI supports --input/--from/--to/--precision. style/glossary are ignored.
    cmd.arg("--input").arg(&opts.input);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start plamo-translate: {}", e))?;

    let id = opts.id.clone();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to take stdout".to_string())?;
    {
        let mut map = tasks.lock().await;
        map.insert(id.clone(), child);
    }

    // 読み取りタスク
    let app2 = app.clone();
    let tasks2 = tasks.inner().clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut final_buf = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            final_buf.push_str(&line);
            final_buf.push('\n');
            let _ = app2.emit(&format!("translate:{}:chunk", id), line);
        }
        // 終了検知（最終文字列も送る）
        let _ = app2.emit(&format!("translate:{}:final", id), final_buf);
        let _ = app2.emit(
            &format!("translate:{}:done", id),
            serde_json::json!({"ok": true}),
        );
        let mut map = tasks2.lock().await;
        map.remove(&id);
    });

    // タイムアウト・ウォッチャ（60s）
    let app3 = app.clone();
    let tasks3 = tasks.inner().clone();
    let id2 = opts.id.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(60_000)).await;
        let mut map = tasks3.lock().await;
        if let Some(mut child) = map.remove(&id2) {
            let _ = child.kill().await;
            let _ = app3.emit(
                &format!("translate:{}:done", id2),
                serde_json::json!({"ok": false, "reason": "timeout"}),
            );
        }
    });
    Ok(())
}

#[tauri::command]
fn check_plamo_cli(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use std::process::Command as StdCommand;
    let settings = read_settings_from_disk(&app);
    let bin = std::env::var("PLAMO_TRANSLATE_PATH")
        .ok()
        .or(settings.plamo.bin_path)
        .unwrap_or_else(|| "plamo-translate".into());
    let resolved = resolve_bin_path(&bin);
    let status = StdCommand::new(&bin)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    match status {
        Ok(s) => Ok(serde_json::json!({
            "ok": s.success(),
            "bin": bin,
            "resolved": resolved,
        })),
        Err(e) => Ok(serde_json::json!({
            "ok": false,
            "bin": bin,
            "resolved": resolved,
            "error": e.to_string(),
        })),
    }
}

#[tauri::command]
async fn abort_translation(tasks: tauri::State<'_, TaskMap>, id: String) -> Result<(), String> {
    let mut map = tasks.lock().await;
    if let Some(mut child) = map.remove(&id) {
        let _ = child.kill().await;
    }
    Ok(())
}

// Settings persistence (App config dir JSON)
#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let p = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    let f = p.join("settings.json");
    if !f.exists() {
        return Ok(Settings::default());
    }
    let s = std::fs::read_to_string(f).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, s: Settings) -> Result<(), String> {
    let p = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    let f = p.join("settings.json");
    let data = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
    std::fs::write(f, data).map_err(|e| e.to_string())
}

// History (append-only MVP)
#[tauri::command]
fn append_history(app: tauri::AppHandle, item: HistoryItem) -> Result<(), String> {
    let p = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    let f = p.join("history.jsonl");
    let line = serde_json::to_string(&item).map_err(|e| e.to_string())? + "\n";
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(f)
        .and_then(|mut fh| std::io::Write::write_all(&mut fh, line.as_bytes()))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_history(app: tauri::AppHandle) -> Result<Vec<HistoryItem>, String> {
    let p = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let f = p.join("history.jsonl");
    if !f.exists() {
        return Ok(vec![]);
    }
    let s = std::fs::read_to_string(f).map_err(|e| e.to_string())?;
    let mut out = vec![];
    for line in s.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<HistoryItem>(line) {
            out.push(v);
        }
    }
    Ok(out)
}

use std::sync::Mutex as StdMutex;
use std::time::{Duration as StdDuration, Instant};
struct DoubleCopyState {
    last: Option<Instant>,
}

#[derive(Clone)]
struct DoubleCopyShared(Arc<StdMutex<DoubleCopyState>>);

fn read_settings_from_disk(app: &tauri::AppHandle) -> Settings {
    let p = match app.path().app_config_dir() {
        Ok(p) => p,
        Err(_) => return Settings::default(),
    };
    let f = p.join("settings.json");
    if let Ok(s) = std::fs::read_to_string(f) {
        if let Ok(mut cfg) = serde_json::from_str::<Settings>(&s) {
            if cfg.double_copy.shortcut.is_none() {
                cfg.double_copy.shortcut = Some("cmd-shift-c".into());
            }
            return cfg;
        }
    }
    Settings::default()
}

fn resolve_bin_path(bin: &str) -> Option<String> {
    use std::path::{Path, PathBuf};
    // If explicit path, canonicalize or return as-is
    if bin.contains('/') || bin.contains('\\') || Path::new(bin).is_absolute() {
        return std::fs::canonicalize(bin)
            .ok()
            .or_else(|| Some(PathBuf::from(bin)))
            .map(|p| p.to_string_lossy().into_owned());
    }
    // Search in PATH
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let mut cand = dir.join(bin);
        if cfg!(windows) {
            if !cand.exists() {
                cand = dir.join(format!("{}.exe", bin));
            }
        }
        if cand.exists() {
            return std::fs::canonicalize(&cand)
                .ok()
                .or_else(|| Some(cand))
                .map(|p| p.to_string_lossy().into_owned());
        }
    }
    None
}

fn register_quick_shortcut<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    state: Arc<StdMutex<DoubleCopyState>>,
    shortcut: &str,
) -> anyhow::Result<()> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    // clear existing
    let _ = gs.unregister_all();

    // If a raw spec like "Super+Shift+C" / "Control+Alt+K" is provided, use it directly
    if shortcut.contains('+') {
        let st = state.clone();
        gs.on_shortcut(shortcut, move |app, _sc, _ev| {
            let mut s = st.lock().unwrap();
            let now = Instant::now();
            let _is_double = s
                .last
                .map(|t| now.duration_since(t) < StdDuration::from_millis(500))
                .unwrap_or(false);
            s.last = Some(now);
            let text = arboard::Clipboard::new()
                .and_then(|mut cb| cb.get_text())
                .unwrap_or_default();
            let _ = app.emit("double-copy", serde_json::json!({ "text": text }));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        })?;
        return Ok(());
    }

    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    let (mods, code) = match shortcut {
        "cmd-shift-c" => {
            #[cfg(target_os = "macos")]
            {
                (Modifiers::SUPER | Modifiers::SHIFT, Code::KeyC)
            }
            #[cfg(not(target_os = "macos"))]
            {
                (Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyC)
            }
        }
        "cmd-alt-c" => {
            #[cfg(target_os = "macos")]
            {
                (Modifiers::SUPER | Modifiers::ALT, Code::KeyC)
            }
            #[cfg(not(target_os = "macos"))]
            {
                (Modifiers::CONTROL | Modifiers::ALT, Code::KeyC)
            }
        }
        "cmd-k" => {
            #[cfg(target_os = "macos")]
            {
                (Modifiers::SUPER, Code::KeyK)
            }
            #[cfg(not(target_os = "macos"))]
            {
                (Modifiers::CONTROL, Code::KeyK)
            }
        }
        _ => {
            #[cfg(target_os = "macos")]
            {
                (Modifiers::SUPER | Modifiers::SHIFT, Code::KeyC)
            }
            #[cfg(not(target_os = "macos"))]
            {
                (Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyC)
            }
        }
    };
    let st = state.clone();
    gs.on_shortcut(Shortcut::new(Some(mods), code), move |app, _sc, _ev| {
        let mut s = st.lock().unwrap();
        let now = Instant::now();
        let is_double = s
            .last
            .map(|t| now.duration_since(t) < StdDuration::from_millis(500))
            .unwrap_or(false);
        s.last = Some(now);
        // 今は単押しで即発火（ダブル検出ロジックは将来的に活用）
        if true || is_double {
            let text = arboard::Clipboard::new()
                .and_then(|mut cb| cb.get_text())
                .unwrap_or_default();
            let _ = app.emit("double-copy", serde_json::json!({ "text": text }));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }
    })?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let tasks: TaskMap = Arc::new(AsyncMutex::new(HashMap::new()));
    let double_copy = Arc::new(StdMutex::new(DoubleCopyState { last: None }));
    let shared = DoubleCopyShared(double_copy.clone());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard::init())
        .manage(tasks)
        .manage(shared.clone())
        .invoke_handler(tauri::generate_handler![
            translate_plamo,
            abort_translation,
            load_settings,
            save_settings,
            append_history,
            load_history,
            update_shortcut,
            check_plamo_cli
        ])
        .setup(move |app| {
            // Register quick shortcut from saved settings
            let app_handle = app.handle();
            let cfg = read_settings_from_disk(&app_handle);
            let key = cfg
                .double_copy
                .shortcut
                .unwrap_or_else(|| "cmd-shift-c".into());
            // グローバルショートカット登録失敗でアプリが落ちないようにする
            if let Err(e) = register_quick_shortcut(&app_handle, double_copy.clone(), &key) {
                #[cfg(debug_assertions)]
                eprintln!("[global-shortcut] register failed: {}", e);
                // フロントに通知（UIで案内を出す想定）
                let _ = app_handle.emit(
                    "global-shortcut:register-error",
                    serde_json::json!({
                        "message": e.to_string(),
                    }),
                );
                // ここで Err を返すと macOS の didFinishLaunching 経由で panic/abort するため握り潰して継続
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn update_shortcut(
    app: tauri::AppHandle,
    shared: tauri::State<'_, DoubleCopyShared>,
    shortcut: String,
) -> Result<(), String> {
    register_quick_shortcut(&app, shared.0.clone(), &shortcut).map_err(|e| e.to_string())
}

// Clipboard commands are omitted; frontend uses navigator.clipboard.
