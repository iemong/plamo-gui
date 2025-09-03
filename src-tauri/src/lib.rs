use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, process::Stdio, sync::{Arc, Mutex}};
use tauri::{Emitter, Manager};
use tokio::{io::{AsyncBufReadExt, BufReader}, process::Command, sync::Mutex as AsyncMutex, time::{timeout, Duration}};

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
pub struct PlamoCfg { pub precision: String, pub server: bool }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoubleCopy { pub enabled: bool, pub paste_mode: String, pub auto_copy: bool }

impl Default for Settings {
    fn default() -> Self {
        Self {
            engine: "plamo".into(),
            plamo: PlamoCfg { precision: "4bit".into(), server: false },
            style_preset: "business".into(),
            glossary_path: None,
            timeout_ms: 60_000,
            double_copy: DoubleCopy { enabled: true, paste_mode: "popup".into(), auto_copy: false },
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
async fn translate_plamo(app: tauri::AppHandle, tasks: tauri::State<'_, TaskMap>, opts: TranslateOptions) -> Result<(), String> {
    let mut cmd = Command::new("plamo-translate");
    // ざっくりとした引数。実際のCLI仕様に合わせて調整する前提。
    if let Some(from) = &opts.from { cmd.arg("--from").arg(from); }
    cmd.arg("--to").arg(&opts.to);
    if let Some(p) = &opts.precision { cmd.arg("--precision").arg(p); }
    if let Some(s) = &opts.style { cmd.arg("--style").arg(s); }
    if let Some(g) = &opts.glossary { cmd.arg("--glossary").arg(g); }
    cmd.arg("--").arg(&opts.input);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            // Fallback: CLI が無い場合は擬似ストリーミング
            let id = opts.id.clone();
            let app2 = app.clone();
            tokio::spawn(async move {
                let words: Vec<&str> = opts.input.split_whitespace().collect();
                for (i, w) in words.iter().enumerate() {
                    let _ = app2.emit(&format!("translate://{}", id), format!("{} ", w));
                    tokio::time::sleep(Duration::from_millis(120)).await;
                    // simple progress event (optional): percentage
                    let _ = app2.emit(&format!("translate-progress://{}", id), ((i+1) as f32 / words.len().max(1) as f32));
                }
                let _ = app2.emit(&format!("translate-done://{}", id), serde_json::json!({"ok": true}));
            });
            return Ok(());
        }
    };

    let id = opts.id.clone();
    let stdout = child.stdout.as_ref().unwrap().try_clone().map_err(|e| e.to_string())?;
    {
        let mut map = tasks.lock().await;
        map.insert(id.clone(), child);
    }

    // 読み取りタスク
    let app2 = app.clone();
    let tasks2 = tasks.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app2.emit(&format!("translate://{}", id), line);
        }
        // 終了検知
        let _ = app2.emit(&format!("translate-done://{}", id), serde_json::json!({"ok": true}));
        let mut map = tasks2.lock().await;
        map.remove(&id);
    });
    Ok(())
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
    if !f.exists() { return Ok(Settings::default()); }
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
    std::fs::OpenOptions::new().create(true).append(true).open(f)
        .and_then(|mut fh| std::io::Write::write_all(&mut fh, line.as_bytes()))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_history(app: tauri::AppHandle) -> Result<Vec<HistoryItem>, String> {
    let p = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let f = p.join("history.jsonl");
    if !f.exists() { return Ok(vec![]); }
    let s = std::fs::read_to_string(f).map_err(|e| e.to_string())?;
    let mut out = vec![];
    for line in s.lines() {
        if line.trim().is_empty() { continue; }
        if let Ok(v) = serde_json::from_str::<HistoryItem>(line) { out.push(v); }
    }
    Ok(out)
}

use std::time::{Duration as StdDuration, Instant};
use std::sync::Mutex as StdMutex;
struct DoubleCopyState { last: Option<Instant> }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let tasks: TaskMap = Arc::new(AsyncMutex::new(HashMap::new()));
    let double_copy = Arc::new(StdMutex::new(DoubleCopyState { last: None }));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard::init())
        .manage(tasks)
        .invoke_handler(tauri::generate_handler![
            translate_plamo,
            abort_translation,
            load_settings,
            save_settings,
            append_history,
            load_history
        ])
        .setup(move |app| {
            // Register double-copy (CmdOrCtrl+C twice within 500ms)
            let app_handle = app.handle();
            let state = double_copy.clone();
            let gs = app_handle.plugin::<tauri_plugin_global_shortcut::GlobalShortcutManager>().unwrap();
            use tauri_plugin_global_shortcut::Shortcut;
            gs.register(Shortcut::new(None, "C").unwrap(), move || {
                let mut s = state.lock().unwrap();
                let now = Instant::now();
                let is_double = s.last.map(|t| now.duration_since(t) < StdDuration::from_millis(500)).unwrap_or(false);
                s.last = Some(now);
                if is_double {
                    let app2 = app_handle.clone();
                    // emit to frontend to handle double-copy event
                    let _ = app2.emit("double-copy", serde_json::json!({}));
                }
            }).map_err(|e| anyhow!(e.to_string()))?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
