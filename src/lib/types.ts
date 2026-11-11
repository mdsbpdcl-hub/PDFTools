export type FileKind = "pdf" | "image" | "office" | "other";

export interface PickedFile {
  id: string;
  file: File;
  kind: FileKind;
  status: "checking" | "ready" | "error";
  pages?: number;
  /** Needs a password to open. */
  encrypted?: boolean;
  /** Opens without a password but has permission restrictions (owner password). */
  restricted?: boolean;
  error?: string;
}

export interface OutputFile {
  name: string;
  blob: Blob;
}

export interface ResultNote {
  tone: "ok" | "warn" | "info" | "error";
  text: string;
}

export interface RunResult {
  outputs: OutputFile[];
  summary?: { label: string; value: string }[];
  notes?: ResultNote[];
  /** Optional text shown in a read-only preview box on the result screen. */
  textPreview?: string;
}

export interface RunContext {
  progress: (fraction: number | null, message?: string) => void;
  signal: AbortSignal;
}

export interface ToolAction {
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  /** When set, the shell asks for explicit consent before files leave the device. */
  sendsToBackend?: { files: { name: string; size: number }[]; purpose: string };
  run: (ctx: RunContext) => Promise<RunResult>;
}

export interface ToolProps {
  files: PickedFile[];
  setAction: (action: ToolAction | null) => void;
}

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}
