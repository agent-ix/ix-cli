/**
 * FR-022 — App Startup Display
 *
 * Phase-column table renderer for concurrent multi-service startup.
 * On TTY: redraws in place every 80 ms and on each phase transition.
 * On non-TTY / --plain: emits one structured line per transition.
 */

import pc from "picocolors";

// Muted terracotta red for failure indicators — softer than ANSI bright red.
const red = (s: string) => `\x1b[38;5;167m${s}\x1b[0m`;
// Use cyan to match URL colour (single source of "IX blue" in the theme).
const blue = pc.cyan;

// Colour pod status "R/T" — both numbers cyan when ready > 0; ready in red when zero.
function colorPods(status: string): string {
  const i = status.indexOf("/");
  if (i === -1) return status;
  const r = status.slice(0, i);
  const rest = status.slice(i); // "/T..." (may include trailing pad spaces)
  const ready = parseInt(r);
  if (ready > 0) return pc.cyan(r) + pc.cyan(rest);
  return red(r) + pc.dim(rest);
}

export type Phase = "secrets" | "pull" | "install" | "ready";
export type PhaseState = "pending" | "queued" | "running" | "done" | "failed";

const PHASES: readonly Phase[] = ["secrets", "pull", "install", "ready"];

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Header glyph: star ignites into axis spin.
const HEADER_SPIN = ["⊕", "⊘", "⊗", "⊖"];
// Advance header glyph every 4 ticks (4 × 80 ms = 320 ms).
const HEADER_TICK_DIV = 4;

// Human-readable label for each phase while it is active.
const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  secrets: "secrets",
  pull: "pulling",
  install: "installing",
  ready: "ready",
};

// Width to pad the stage label column ("install failed" is the longest at 14).
const LABEL_W = 14;

function glyph(state: PhaseState, spinnerIdx: number, isTTY: boolean): string {
  switch (state) {
    case "pending":
      return "·";
    case "queued":
      return isTTY ? pc.yellow(SPINNER[spinnerIdx % SPINNER.length]) : "queued";
    case "running":
      return isTTY ? pc.cyan(SPINNER[spinnerIdx % SPINNER.length]) : "running";
    case "done":
      return blue("●");
    case "failed":
      return red("○");
  }
}

/** Returns the most-advanced non-pending phase and its state. */
function rowCurrentState(phases: Record<Phase, PhaseState>): {
  phase: Phase;
  state: PhaseState;
} {
  for (const ph of [...PHASES].reverse()) {
    if (phases[ph] !== "pending") return { phase: ph, state: phases[ph] };
  }
  return { phase: "secrets", state: "pending" };
}

function rowLabel(phase: Phase, state: PhaseState): string {
  if (state === "pending") return "—";
  if (state === "failed") return `${phase} failed`;
  return PHASE_LABEL[phase];
}

interface ServiceRow {
  name: string;
  phases: Record<Phase, PhaseState>;
  startMs: number;
  endMs: number | null;
  podStatus: string | null;
  error: string | null;
}

export interface AppDisplayOptions {
  isTTY?: boolean;
  isPlain?: boolean;
  /** Optional header text rendered above the service rows with an animated glyph. */
  header?: string;
  /**
   * Lines already written to stdout before start() — AppDisplay erases them
   * on its first draw so there is no blank gap during pre-flight work.
   */
  initialLineCount?: number;
}

export class AppDisplay {
  private readonly rows: ServiceRow[];
  private readonly globalStartMs: number;
  private readonly isTTY: boolean;
  private readonly header: string | null;
  private spinnerFrame = 0;
  private lineCount = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private preflightLines: string[] = [];

  constructor(serviceNames: string[], opts: AppDisplayOptions = {}) {
    this.globalStartMs = Date.now();
    this.isTTY = (opts.isTTY ?? process.stdout.isTTY ?? false) && !opts.isPlain;
    this.header = opts.header ?? null;
    this.lineCount = opts.initialLineCount ?? 0;

    const now = this.globalStartMs;
    this.rows = serviceNames.map((name) => ({
      name,
      phases: {
        secrets: "pending",
        pull: "pending",
        install: "pending",
        ready: "pending",
      },
      startMs: now,
      endMs: null,
      podStatus: null,
      error: null,
    }));
  }

  /** Call once after credentials/manifest resolution to show pre-flight lines. */
  preflight(label: string): void {
    const line = `  🔑 ${label}`;
    if (this.isTTY) {
      this.preflightLines.push(line);
    } else {
      process.stdout.write(`🔑 ${label}\n`);
    }
  }

  /** Update the k8s pod ready status for a service (shown during ready phase). */
  setPodStatus(service: string, status: string): void {
    const row = this.rows.find((r) => r.name === service);
    if (!row) return;
    row.podStatus = status;
    // No immediate redraw — the ticker handles TTY redraws at 80 ms.
  }

  /** Store the error message for a failed service (shown in frozen summary). */
  setError(service: string, error: string): void {
    const row = this.rows.find((r) => r.name === service);
    if (!row) return;
    row.error = error;
  }

  /** Begin displaying the table. Call after all preflights are done. */
  start(): void {
    if (!this.isTTY && this.header) {
      process.stdout.write(`⊕  ${this.header}\n`);
    }
    if (this.isTTY) {
      this.drawTTY();
      this.ticker = setInterval(() => {
        this.spinnerFrame++;
        this.drawTTY();
      }, 80);
    }
  }

  /** Update a service phase to a new state (FR-022-AC-2). */
  transition(service: string, phase: Phase, state: PhaseState): void {
    const row = this.rows.find((r) => r.name === service);
    if (!row) return;
    row.phases[phase] = state;

    if (state === "running" && phase === "secrets") {
      row.startMs = Date.now();
    }
    if (state === "done" && phase === "ready") {
      row.endMs = Date.now();
    }
    if (state === "failed") {
      row.endMs = Date.now();
    }

    if (!this.isTTY) {
      const elapsedS = ((Date.now() - this.globalStartMs) / 1000).toFixed(1);
      process.stdout.write(`[T+${elapsedS}s] ${service}: ${phase} ${state}\n`);
    }
    // TTY redraws are driven by the ticker — no immediate drawTTY() here.
  }

  /**
   * Freeze the display with a final success or failure summary (FR-022-AC-5).
   * Stops the ticker and prints the static summary.
   */
  finish(entry: string | null, internalBaseDomain: string): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }

    const totalMs = Date.now() - this.globalStartMs;
    const failed = this.rows.filter((r) =>
      Object.values(r.phases).some((s) => s === "failed"),
    );

    if (this.isTTY) {
      const nameW = this.maxNameLen();
      const preflightBlock = this.preflightLines.join("\n");

      const frozenHeader = this.header
        ? (failed.length === 0
            ? `${blue("●")}  ${this.header}`
            : `${red("⊗")}  ${this.header}`) + "\n\n"
        : "";

      const frozenRows = this.rows.flatMap((row) => {
        const sMs = row.endMs != null ? row.endMs - row.startMs : totalMs;
        const sS = (sMs / 1000).toFixed(1) + "s";
        const anyFailed = Object.values(row.phases).some((s) => s === "failed");
        if (anyFailed) {
          const pods = row.podStatus
            ? `  ${colorPods(row.podStatus.padEnd(5))}`
            : "       ";
          const lines = [
            `  ${red("○")} ${row.name.padEnd(nameW)}${pods}  ${sS}`,
          ];
          if (row.error) lines.push(`      ${pc.dim(row.error)}`);
          return lines;
        }
        const url = `https://${row.name}.${internalBaseDomain}`;
        const pods = row.podStatus
          ? `  ${colorPods(row.podStatus.padEnd(5))}`
          : "       ";
        return [
          `  ${blue("●")} ${row.name.padEnd(nameW)}${pods}  ${sS.padEnd(7)}  →  ${pc.cyan(url)}`,
        ];
      });

      const lines = [...frozenRows];
      if (failed.length === 0 && entry) {
        lines.push("");
        lines.push(
          `  app:  ${pc.cyan(pc.underline(`https://${entry}.${internalBaseDomain}`))}`,
        );
      } else if (failed.length > 0) {
        lines.push("");
        lines.push(
          red(
            `  ⊗ ${failed.length} service${failed.length === 1 ? "" : "s"} failed`,
          ),
        );
      }

      const tableBlock = lines.join("\n") + "\n";
      const body = preflightBlock
        ? frozenHeader + preflightBlock + "\n\n" + tableBlock
        : frozenHeader + tableBlock;

      const newLines = body.split("\n");
      const newCount = newLines.length - 1;
      const moveUp = this.lineCount > 0 ? `\x1b[${this.lineCount}A\r` : "\r";
      let frame = "";
      for (let i = 0; i < newCount; i++) frame += newLines[i] + "\x1b[K\n";
      if (this.lineCount > newCount) {
        const extra = this.lineCount - newCount;
        for (let i = 0; i < extra; i++) frame += "\x1b[K\n";
        frame += `\x1b[${extra}A`;
      }
      process.stdout.write(
        `\x1b[?2026h\x1b[?25l${moveUp}${frame}\x1b[?25h\x1b[?2026l`,
      );
      this.lineCount = 0;
      return;
    }

    // Non-TTY: full structured summary (no live table to preserve).
    const totalS = (totalMs / 1000).toFixed(1);
    const lines: string[] = [];

    if (failed.length === 0) {
      lines.push(
        blue(
          `✓ ${this.rows.length} service${this.rows.length === 1 ? "" : "s"} ready in ${totalS}s`,
        ),
      );
      lines.push("");
      for (const row of this.rows) {
        const sMs = row.endMs != null ? row.endMs - row.startMs : totalMs;
        const sS = (sMs / 1000).toFixed(1);
        lines.push(
          `  ${blue("●")} ${row.name.padEnd(this.maxNameLen())}  ${sS}s`,
        );
      }
      if (entry) {
        lines.push("");
        lines.push(
          `  app:  ${pc.cyan(pc.underline(`https://${entry}.${internalBaseDomain}`))}`,
        );
      }
    } else {
      lines.push(red(`⊗ ${failed.length} failed in ${totalS}s`));
      lines.push("");
      for (const row of this.rows) {
        const anyFailed = Object.values(row.phases).some((s) => s === "failed");
        const sMs = row.endMs != null ? row.endMs - row.startMs : totalMs;
        const sS = (sMs / 1000).toFixed(1);
        if (anyFailed) {
          const pods = row.podStatus
            ? `  ${row.podStatus.padEnd(5)}`
            : "       ";
          lines.push(
            `  ${red("○")} ${row.name.padEnd(this.maxNameLen())}${pods}  ${sS}s`,
          );
          if (row.error) lines.push(`      ${pc.dim(row.error)}`);
        } else {
          lines.push(
            `  ${blue("●")} ${row.name.padEnd(this.maxNameLen())}  ${sS}s`,
          );
        }
      }
    }

    process.stdout.write(lines.join("\n") + "\n");
    this.lineCount = 0;
  }

  private maxNameLen(): number {
    return Math.max(...this.rows.map((r) => r.name.length), 0);
  }

  private drawTTY(): void {
    const now = Date.now();
    const totalElapsedS = ((now - this.globalStartMs) / 1000).toFixed(1);
    const readyCount = this.rows.filter(
      (r) => r.phases.ready === "done",
    ).length;
    const nameW = this.maxNameLen();
    const anyFailed = this.rows.some((r) =>
      Object.values(r.phases).some((s) => s === "failed"),
    );

    const headerLine = this.header
      ? (anyFailed
          ? red("⊗")
          : pc.cyan(
              HEADER_SPIN[
                Math.floor(this.spinnerFrame / HEADER_TICK_DIV) %
                  HEADER_SPIN.length
              ],
            )) +
        "  " +
        this.header +
        "\n\n"
      : "";

    const rows = this.rows.map((row) => {
      const { phase, state } = rowCurrentState(row.phases);
      let label = rowLabel(phase, state);
      // During ready phase, replace generic label with live k8s pod status.
      let podsDone = false;
      if (phase === "ready" && row.podStatus) {
        label = row.podStatus;
        const parts = row.podStatus.split("/");
        const r = parseInt(parts[0]);
        const t = parseInt(parts[1]);
        podsDone = r > 0 && r === t;
      }
      const g = podsDone ? blue("●") : glyph(state, this.spinnerFrame, true);
      const elapsedMs =
        row.endMs != null ? row.endMs - row.startMs : now - row.startMs;
      const elapsed = (elapsedMs / 1000).toFixed(1) + "s";
      const isPodStatus = phase === "ready" && !!row.podStatus;
      const labelPadded = isPodStatus
        ? colorPods(label.padEnd(LABEL_W))
        : label.padEnd(LABEL_W);
      return `  ${g} ${row.name.padEnd(nameW)}  ${labelPadded}  ${elapsed}`;
    });

    const footer = pc.dim(
      `  elapsed ${totalElapsedS}s · ${readyCount}/${this.rows.length} ready`,
    );

    const preflightBlock = this.preflightLines.join("\n");
    const tableBlock = [...rows, "", footer].join("\n");
    const body = preflightBlock
      ? headerLine + preflightBlock + "\n\n" + tableBlock + "\n"
      : headerLine + tableBlock + "\n";

    const newLines = body.split("\n");
    const newCount = newLines.length - 1;
    const moveUp = this.lineCount > 0 ? `\x1b[${this.lineCount}A\r` : "\r";

    let frame = "";
    for (let i = 0; i < newCount; i++) {
      frame += newLines[i] + "\x1b[K\n";
    }
    if (this.lineCount > newCount) {
      const extra = this.lineCount - newCount;
      for (let i = 0; i < extra; i++) frame += "\x1b[K\n";
      frame += `\x1b[${extra}A`;
    }

    process.stdout.write(
      `\x1b[?2026h\x1b[?25l${moveUp}${frame}\x1b[?25h\x1b[?2026l`,
    );
    this.lineCount = newCount;
  }
}
