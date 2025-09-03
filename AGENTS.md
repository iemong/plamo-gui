# Repository Guidelines

## プロジェクト構成
- `src/`: React + TypeScript。入口 `src/main.tsx`、主要コンポーネント `src/App.tsx`、静的資産は `src/assets/`。
- `public/`: そのまま配信する静的ファイル。
- `src-tauri/`: Tauri(Rust) 側。入口 `src-tauri/src/main.rs`、コマンドは `src-tauri/src/lib.rs`、設定 `tauri.conf.json`、権限定義は `capabilities/`、アイコンは `icons/`。
- ルート: `package.json`、`vite.config.ts`、`tsconfig*.json`、`index.html`、`bun.lockb`。

## ビルド・実行・開発
- 依存関係: `bun install`（または `npm ci`）。
- フロント開発: `bun run dev`（Vite 開発サーバ）。
- デスクトップ起動: `bun run tauri dev`（Tauri 開発モード）。
- フロントビルド: `bun run build`（`tsc && vite build`）。
- アプリビルド: `bun run tauri build`（配布用バイナリ作成）。
- プレビュー: `bun run preview`。
  例: npm 利用時は `npm run tauri dev` 等に読み替え。

## コーディング規約
- TS/React: 2スペースインデント、ダブルクォート、セミコロン必須。
- 命名: コンポーネントは PascalCase、関数/変数は camelCase、ファイルは `.tsx/.ts`。
- インポート順: 外部→内部。相対パスは短く保つ。
- フォーマット: 専用設定は未導入。エディタ整形を有効化（VS Code 推奨拡張: `tauri-apps.tauri-vscode`, `rust-lang.rust-analyzer`）。

## テスト方針
- 現状テストは未導入。追加する場合:
  - フロント: Vitest + React Testing Library（`*.test.tsx`）。
  - Rust: `cargo test`（`tests/` または `#[cfg(test)]`）。
- カバレッジ目標はモジュール単位で重要ロジックを優先。実行例: `vitest run --coverage`, `cd src-tauri && cargo test`。

## コミットとPR
- コミット: Conventional Commits 推奨（例: `feat: add greet button`、`fix: handle invoke error`）。
- PR 要件: 目的、変更点、動作確認手順、必要に応じスクリーンショット、関連 Issue へのリンク。
- 破壊的変更は本文に `BREAKING CHANGE:` を明記。マージ前に `bun run build` と `bun run tauri build` が通ること。

## セキュリティ/設定
- 機密情報をコミットしない。アプリ ID や権限は `src-tauri/tauri.conf.json` と `capabilities/*.json` を確認。
- 外部リンクやアプリ起動は `@tauri-apps/plugin-opener` の権限設定を更新してから利用。
