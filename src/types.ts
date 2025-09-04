export type HistoryItem = {
  id: string;
  input: string;
  output: string;
  from?: string;
  to: string;
  created_at: number;
};

export type Settings = {
  engine: string;
  plamo: { precision: "4bit" | "8bit" | "bf16"; server: boolean };
  style_preset: "business" | "tech" | "casual";
  glossary_path?: string;
  timeout_ms: number;
  double_copy: { enabled: boolean; paste_mode: "popup" | "clipboard"; auto_copy: boolean };
};

