# plamo-translate の使い方

外部 CLI ツール「plamo-translate」（plamo-2-translate モデルを使用）の基本的な使い方をまとめます。詳細や最新情報は公式 README を参照してください。

- 公式リポジトリ: https://github.com/pfnet/plamo-translate-cli

## 前提

- Python 3.10+（macOS/Apple Silicon は MLX バックエンドに最適化）
- インストール例（pip）: `pip install plamo-translate`
  - Python 3.13 環境では `sentencepiece` の事情により追加手順が必要な場合があります。公式 README を参照してください。

## 基本

- 入出力言語は `--from` と `--to` を指定（未指定時は英⇄日の自動判定）。

```sh
plamo-translate --from ja --to en --input "こんにちは"
```

## 対話モード

```sh
plamo-translate
# Ctrl+D で終了
```

## パイプ入力

```sh
cat file.txt | plamo-translate
```

## サーバーモード

モデル読み込み時間を省略したい場合に有用です。

```sh
# サーバ起動
plamo-translate server

# クライアントとして 1 回翻訳
plamo-translate --input '家計は火の車だ'

# または対話モードで利用
plamo-translate
```

### MCP クライアントからの利用（Claude Desktop 例）

1. `plamo-translate server` を起動。
2. 別ターミナルで設定出力: `plamo-translate show-claude-config`
3. 出力 JSON を `~/Library/Application Support/Claude/claude_desktop_config.json` に追記。

## モデル精度

重み精度は `--precision` で指定できます。

```sh
plamo-translate server --precision 8bit
# 選択肢: 4bit / 8bit / bf16（デフォルト: 4bit）
```

## 主なオプション

- `--input` 文字列: 直接入力文を指定
- `--from` 文字列: 入力言語（例: `ja`/`en` など）
- `--to` 文字列: 出力言語
- `--precision` 文字列: `4bit|8bit|bf16`

## 環境変数（サーバ設定・生成制御）

- `PLAMO_TRANSLATE_CLI_SERVER_START_PORT`: サーバ開始ポート
- `PLAMO_TRANSLATE_CLI_SERVER_END_PORT`: サーバ終了ポート
- `PLAMO_TRANSLATE_CLI_TEMP`: 温度
- `PLAMO_TRANSLATE_CLI_TOP_P`: top-p
- `PLAMO_TRANSLATE_CLI_TOP_K`: top-k
- `PLAMO_TRANSLATE_CLI_REPETITION_PENALTY`: 反復ペナルティ
- `PLAMO_TRANSLATE_CLI_REPETITION_CONTEXT_SIZE`: 反復ペナルティ参照長

## 対応言語

- 日本語 / やさしい日本語 / 英語
- 実験的: 中国語・台湾華語・韓国語・アラビア語・イタリア語・インドネシア語・オランダ語・スペイン語・タイ語・ドイツ語・フランス語・ベトナム語・ロシア語

## バックエンド

- `mlx`（macOS/Apple Silicon 向け・既定）

## GUI アプリからの実行パス設定

- 本アプリは `plamo-translate` をサブプロセスとして起動します。開発実行（`bun run tauri dev`）ではターミナルの `PATH` が引き継がれますが、配布ビルドは `PATH` が限定され、CLI を見つけられない場合があります。
- その場合は以下のいずれかでパスを明示してください。
  - アプリの Settings で「plamo-translate path」を設定
  - 環境変数 `PLAMO_TRANSLATE_PATH` にフルパスを設定
    - 例: `/opt/homebrew/bin/plamo-translate`、`~/.local/bin/plamo-translate`
  - いずれも未設定の場合は `PATH` にある `plamo-translate` を探します。見つからない場合はアプリ上でエラー表示され、翻訳は実行されません（フォールバックなし）。
  - 設定画面に「Check」ボタンを追加しており、アプリ上で CLI の検出可否を確認できます。

## 選択範囲のクイック翻訳（DeepL風）

- グローバルショートカット押下時に、OS のコピー操作（Cmd+C / Ctrl+C）をシミュレートし、直前に選択していたテキストをクリップボードから取得して翻訳します。
- macOS の場合は「システム設定 → プライバシーとセキュリティ → アクセシビリティ」で本アプリへの許可が必要です（キーボード操作のシミュレーションに必要）。
- 取得したテキストは入力欄に自動反映され、即時翻訳されます。
