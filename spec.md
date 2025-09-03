# プロジェクト概要（MVP版）
**名称**: Kotoba Forge（仮）  
**目的**: ローカルLLM（PLaMo）で高速・プライバシーファーストの翻訳体験を提供するデスクトップアプリ。DeepLアプリの代替を意識し、ショートカット操作による即時翻訳を実現。  
**形態**: Tauri製クロスプラットフォーム（優先: macOS/Apple Silicon）  
**キー価値**: ネット接続不要（ローカル推論前提）、ショートカット操作による即時翻訳、段落保持、シンプルUI。

---

# 技術スタック表
| レイヤ | 技術 | 用途/メモ |
|---|---|---|
| デスクトップ基盤 | **Tauri (Rust + WebView)** | バイナリ超軽量・低メモリ。Rust側でCLI実行・プロセス管理・ショートカットフック。 |
| バックエンド（アプリ内） | **Rust**（tauri::command, tokio, anyhow, serde, serde_json, tokio-process, tauri-plugin-global-shortcut） | `plamo-translate` CLI呼び出し、ショートカット入力処理（cmd+C×2）、タイムアウト、エラーハンドリング。 |
| 推論エンジン（ローカル） | **PLaMo Translate CLI**（MLX / Apple Silicon） | サーバーモード/CLI利用。精度: bf16/8bit/4bit切替。 |
| UIフレームワーク | **React** | SPA UI。状態管理は軽量（Zustand/Jotai）を想定。 |
| スタイリング | **Tailwind CSS v4** | ユーティリティ主体。 |
| UIコンポーネント | **shadcn/ui** | Button, Input, Textarea, Dialog, Toast。 |
| ビルド/ツール | **pnpm** | 速いパッケージ管理。 |
| 型/品質 | TypeScript, ESLint, Prettier, **Vitest** | ユニットテスト。 |
| ストレージ | AppDir(JSON) / Keychain | 設定や履歴。 |

---

# 要件定義書
## 1. MVP機能要件（ollama除外）
1. **テキスト翻訳（単発）**  
   - 入力: 任意言語テキスト  
   - 出力: 目的言語テキスト（訳のみ）  
   - オプション: 文体（ビジネス/技術/カジュアル）、用語集適用、改行保持。
2. **⌘C×2（DeepL代替体験）**  
   - システム全域で選択範囲をコピー→すぐにもう一度コピーで**トリガー**。  
   - アプリがフォアグラウンドにミニウィンドウ（フローティング）でポップアップし、即翻訳結果を表示。  
   - 結果を**自動でクリップボードへ上書き**（オプション）。
3. **ストリーミング表示**  
   - 逐次生成をUIに即時反映（SSE風）。キャンセル可。  
4. **履歴**  
   - ローカル保存、再実行。
5. **用語集/プリセット**  
   - JSONで用語固定。プリセットで文体を選択。
6. **オフライン動作**  
   - モデルDL後はネット不要。
7. **エクスポート**  
   - クリップボード、Markdown/Plaintext保存。

## 2. 非機能要件（MVP）
- **パフォーマンス**: 1,000字の和→英で5〜30秒（機材/精度依存）。UI初期反応<100ms。
- **信頼性**: CLI失敗時リトライ（1回）、タイムアウト（60s）、キャンセル。
- **セキュリティ/プライバシー**: 入力テキストは外部送信しない。ログに原文を残さない。
- **可搬性**: macOS/Apple Silicon優先。

## 3. スコープ/非スコープ（MVP）
- **スコープ**: PLaMo CLI連携、⌘C×2トリガー、単発翻訳、履歴、用語集/プリセット、ストリーミングUI。
- **非スコープ**: ollama連携、バッチ翻訳、複数ファイル処理、高度な評価/スコアリング。

## 4. UI/UX要件（MVP）
- **メイン画面**: 入力/出力、Translate、進捗、キャンセル。  
- **フローティングウィンドウ**: ⌘C×2発火時に画面右上へ表示（位置は設定可能）。  
- **設定**: PLaMo精度/温度、スタイルプリセット、用語集、⌘C×2の動作（貼付/表示/自動コピー）。

## 5. データモデル（概略/MVP）
```ts
// Settings
{
  engine: 'plamo',
  plamo: { precision: '4bit'|'8bit'|'bf16', server: boolean },
  stylePreset: 'business'|'tech'|'casual',
  glossaryPath?: string,
  concurrency: number,
  timeoutMs: number,
  doubleCopy: { enabled: true, pasteMode: 'popup'|'clipboard' }
}

// History
{
  id: string,
  input: string,
  output: string,
  from?: string,
  to: string,
  createdAt: number
}
```

## 6. アーキテクチャ & フロー（MVP）
- **Rustコマンド**（tauri::command）
  - `translate_plamo(input, from?, to, precision, style, glossary)`  
    - `plamo-translate` を `tokio::process::Command` でspawn
    - stdoutを逐次読み取り→IPCでUIへpush（チャンク）
- **⌘C×2検出**
  - `tauri-plugin-global-shortcut` で `CmdOrCtrl+C` 登録。
  - 直近のコピー時刻を記録し、**500ms以内の連続コピー**を二度押しと判定。
  - 二度押し時: クリップボード内容を取得→`translate_plamo`実行。
  - 結果ハンドリング: (a) ミニウィンドウ表示して出力、(b) クリップボードへ上書き、(c) 任意で自動貼り付け（設定でON/OFF）。
- **同時実行制御**: `tokio::sync::Semaphore` で並列数制限。
- **タイムアウト/キャンセル**: `tokio::time::timeout` とタスクキャンセル。

## 7. エラーハンドリング（抜粋）
- `ENOENT`: PLaMo未インストール → インストールガイド（初回起動時にチェック）。
- `Model not found`: モデル未DL → 自動DL案内ダイアログ。
- `GPU/メモリ不足`: 精度を下げる提案（bf16→8bit→4bit）。
- `Timeout`: 入力分割提案/温度や長さ制約の提示。
- `Clipboard denied`: クリップボード権限/サンドボックスの案内。

---

# 開発体制 & スケジュール（MVP）
**M0（〜1週）**: プロジェクト雛形（Tauri/React/Tailwind/shadcn）。PLaMo CLI同期呼び出し。翻訳結果を表示。  
**M1（〜2週）**: ストリーミング/キャンセル、履歴、用語集/プリセット。  
**M2（〜3週）**: **⌘C×2トリガー**実装（グローバルショートカット＋クリップボード読み/書き＋ミニウィンドウ）。  
**M3（〜4週）**: 最適化（並列/キャッシュ）、安定化、Beta配布。

---

# 実装ヒント（⌘C×2の疑似コード）
```rust
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri_plugin_global_shortcut::Shortcut;

struct DoubleCopyState { last: Option<Instant> }

#[tauri::command]
async fn on_double_copy(app: tauri::AppHandle) {
    // 1) クリップボードからテキスト取得
    // 2) translate_plamo(...) をspawn
    // 3) 結果をIPCでUIへ送る or クリップボードへ書き戻す
}

fn register_shortcut(app: &tauri::AppHandle, state: Arc<Mutex<DoubleCopyState>>) {
    let gs = app.plugin::<tauri_plugin_global_shortcut::GlobalShortcutManager>().unwrap();
    gs.register(Shortcut::new(None, "C").unwrap(), move || {
        let mut s = state.lock().unwrap();
        let now = Instant::now();
        let is_double = s.last.map(|t| now.duration_since(t) < Duration::from_millis(500)).unwrap_or(false);
        s.last = Some(now);
        if is_double {
            // on_double_copy を呼ぶ
        }
    }).unwrap();
}
```


---

# UIワイヤ（言語化・DeepL参照）

## 全体レイアウト（デスクトップ/メインウィンドウ）
- **ヘッダーバー**
  - タブ: `Translate text` | `Translate files` | `History`
  - 右側: `Settings(≡)` / `Account`（任意）
- **本文エリア: 横2分割（grid-cols-2）**
  - **左ペイン = 入力**
    - 上部: `Detect language ▼`（ソース言語セレクト。`Auto`を既定）
    - 中央: `Textarea#input`（placeholder: *Type or paste text to translate*）
    - 補助: *⌘C C to be faster*（ショートカットヒント）
    - 付随（後回し可）: ドラッグ&ドロップ領域（.docx/.pptx/.pdf/.xlsx/.txt/.html）
  - **右ペイン = 出力**
    - 上部: `Select#to`（ターゲット言語。例: `Japanese ▼`）
    - 中央: `Textarea#output`（readOnly, aria-live="polite"／トークン追記）
    - 下部: 状態表示（`Translating…`/`Done`/`Error`）と `<Progress/>`

## レイアウト寸法・余白（Tailwind v4基準）
- コンテナ: `max-w-[1200px] mx-auto p-4 md:p-6`
- テキストエリア: `min-h-[48vh] md:min-h-[64vh] rounded-2xl shadow-sm`
- 分割: `grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6`

## コンポーネント仕様（shadcn）
- `<HeaderTabs />` : Tabs（Translate text / History）
- `<LangSelector id="from" detectable />` : `Auto`含むセレクト
- `<LangSelector id="to" />`
- `<Textarea id="input" />`, `<Textarea id="output" readOnly aria-live="polite" />`
- `<Progress id="translationProgress" />`（ストリーミング時に indeterminate→determinate）
- `<ShortcutHint />`（⌘C×2 説明）
- `<Toast />`（エラー/完了通知）
- `<SettingsDialog />`（precision/style/glossary/timeout/doubleCopy/pasteMode）

## イベント & 状態（メイン）
- `onTranslateClick` → IPC `translate_plamo(opts)` → `chunk|done|error` を購読
- `onCancel` → IPC `abort(id)`（MVPは現在実行中のみ）
- `onSwapLanguages`（↔︎ アイコン）
- `onPaste`（⌘V時に入力へフォーカス）

## ミニウィンドウ（⌘C×2 / DeepLライク）
- **表示**: 画面右上、`w-[560px] max-h-[70vh] p-4 rounded-2xl shadow-2xl bg-card`、閉じるまでフローティング。
- **内容**: 上部に `Badge#engine(plamo)` と `Switch#autoCopy`、本文は入力/出力の縦2段（or 出力のみ）。
- **発火条件**: 連続コピー 500ms 以内。クリップボード文字列を入力として即翻訳。
- **動作選択**（設定）:
  - `pasteMode=popup` : ミニウィンドウを開いて出力を表示（既定）
  - `pasteMode=clipboard` : ウィンドウを開かず、訳文をクリップボードへ即上書き
- **ショートカット**: `ESC` で即閉じ、実行中ならキャンセル。`Enter` で再実行。

## アクセシビリティ
- 言語セレクトは `label` と `aria-expanded`。
- 出力テキストエリアは `aria-live="polite"` でチャンク追記を支援。
- キーボード操作: `Tab` 移動可能、`ESC`でダイアログ/ミニウィンドウを閉じる。

## 文言（コピー）
- プレースホルダ：`Type or paste text to translate`
- ステータス：`Translating…` / `Ready` / `Timeout. Try again or split input.`
- エラー：`PLaMo CLI not found` / `Model not downloaded` / `Clipboard access denied`

## 画面遷移
- `MainView`（既定） ↔︎ `HistoryView`（一覧/再実行） ↔︎ `SettingsDialog`（モーダル）
- いずれからでも `MiniWindow` は出現可能（常時フローティング）

## 図心（情報設計の要）
- **左＝入力 / 右＝出力** を不変ルール化（ミニウィンドウでは縦2段に最適化）。
- **言語セレクトは上、状態は下**。ユーザの眼の走査をDeepL準拠に合わせる。

