import type { PhaseState, PhaseTable } from "@agent-ix/ix-ui-cli";
import type { HookStatus } from "./rollout.js";
import type { Phase } from "./phases.js";

type RowSource = "none" | "pull" | "secrets" | "helm-hook" | "k8s-rollout";

type SourceState = "unknown" | "running" | "done" | "failed";

interface SourceActivity {
  state: SourceState;
  detail: string | null;
  error: string | null;
}

interface RenderedRowState {
  phase: Phase;
  state: PhaseState;
  source: RowSource;
  detail: string | null;
  error: string | null;
}

interface AppRowAggregate {
  serviceName: string;
  terminal: "failed" | null;
  pull: SourceActivity;
  secrets: SourceActivity;
  helmHook: SourceActivity;
  k8s: SourceActivity;
  rendered: RenderedRowState | null;
}

export interface AppInstallRowService {
  name: string;
}

function emptySource(): SourceActivity {
  return { state: "unknown", detail: null, error: null };
}

function isReadyStatus(status: string): boolean {
  const match = status.match(/^(\d+)\/(\d+)(?:·([^\s]+))?(?:\s|$)/);
  if (!match) return false;
  const ready = Number.parseInt(match[1], 10);
  const total = Number.parseInt(match[2], 10);
  return ready > 0 && ready === total && match[3] == null;
}

function renderEquals(
  left: RenderedRowState | null,
  right: RenderedRowState,
): boolean {
  return (
    left?.phase === right.phase &&
    left.state === right.state &&
    left.source === right.source &&
    left.detail === right.detail &&
    left.error === right.error
  );
}

function combineReadinessAndHook(
  readiness: string | null,
  hookDetail: string | null,
): string | null {
  if (readiness && hookDetail) return `${readiness} · ${hookDetail}`;
  return hookDetail ?? readiness;
}

export class AppInstallRows {
  private readonly rows = new Map<string, AppRowAggregate>();

  constructor(
    private readonly display: PhaseTable<Phase>,
    services: AppInstallRowService[],
  ) {
    for (const service of services) {
      this.rows.set(service.name, {
        serviceName: service.name,
        terminal: null,
        pull: emptySource(),
        secrets: emptySource(),
        helmHook: emptySource(),
        k8s: emptySource(),
        rendered: null,
      });
    }
  }

  transition(
    serviceName: string,
    phase: Phase,
    state: PhaseState,
    source: RowSource = "none",
    detail?: string,
  ): void {
    const row = this.rows.get(serviceName);
    if (!row || row.terminal) return;

    const activity = this.sourceForPhase(row, phase, source);
    activity.state =
      state === "running" || state === "queued"
        ? "running"
        : state === "failed"
          ? "failed"
          : state === "done"
            ? "done"
            : "unknown";
    activity.detail = detail ?? null;
    if (state === "failed") {
      row.terminal = "failed";
      activity.error = detail ?? null;
    }

    this.render(row, {
      phase,
      state,
      source,
      detail: detail ?? null,
      error: state === "failed" ? (detail ?? null) : null,
    });
  }

  setError(serviceName: string, error: string): void {
    const row = this.rows.get(serviceName);
    if (!row) return;
    const rendered = row.rendered;
    if (rendered) {
      row.rendered = { ...rendered, error };
    }
    this.display.setError(serviceName, error);
  }

  updateHook(serviceName: string, status: HookStatus): void {
    const row = this.rows.get(serviceName);
    if (!row || row.terminal) return;

    row.helmHook.state = status.phase;
    row.helmHook.detail = status.message;
    if (status.phase === "failed") {
      row.helmHook.error = `install: hook ${status.jobName} failed: ${status.message}`;
      row.terminal = "failed";
    }

    this.renderDerived(row);
    if (status.phase === "failed" && row.helmHook.error) {
      this.display.setError(serviceName, row.helmHook.error);
    }
  }

  updateK8sInstallStatus(serviceName: string, status: string): void {
    const row = this.rows.get(serviceName);
    if (!row || row.terminal) return;

    row.k8s.state = isReadyStatus(status) ? "done" : "running";
    row.k8s.detail = status;
    row.k8s.error = null;

    this.renderDerived(row);
  }

  reconcileActiveInstallHooks(activeHookRows: Set<string>): void {
    for (const row of this.rows.values()) {
      if (
        row.helmHook.state === "running" &&
        !activeHookRows.has(row.serviceName)
      ) {
        row.helmHook.state = "done";
        row.helmHook.detail = null;
        this.renderDerived(row);
      }
    }
  }

  completeInstall(serviceName: string): void {
    const row = this.rows.get(serviceName);
    if (!row || row.terminal) return;
    if (row.helmHook.state !== "failed") {
      row.helmHook.state = "done";
      row.helmHook.detail = null;
    }
    if (row.k8s.state === "unknown") {
      this.render(row, {
        phase: "install",
        state: "done",
        source: "none",
        detail: null,
        error: null,
      });
      return;
    }
    this.renderDerived(row);
  }

  failInstall(serviceName: string, status: string, error: string): void {
    const row = this.rows.get(serviceName);
    if (!row || row.terminal) return;

    row.helmHook.state = "failed";
    row.helmHook.detail = status;
    row.helmHook.error = error;
    row.terminal = "failed";

    this.render(row, {
      phase: "install",
      state: "failed",
      source: "helm-hook",
      detail: status,
      error,
    });
    this.display.setError(serviceName, error);
  }

  startReady(serviceName: string): void {
    const row = this.rows.get(serviceName);
    if (!row || row.terminal) return;
    if (row.k8s.state === "done") {
      this.renderDerived(row);
      return;
    }
    row.k8s.state = "running";
    row.k8s.detail = "checking rollout";
    this.renderDerived(row);
  }

  updateReadyStatus(serviceName: string, status: string): void {
    this.updateK8sInstallStatus(serviceName, status);
  }

  completeReady(serviceName: string): void {
    const row = this.rows.get(serviceName);
    if (!row || row.terminal) return;
    row.k8s.state = "done";
    row.k8s.detail = row.k8s.detail ?? "ready";
    row.k8s.error = null;
    this.renderDerived(row);
  }

  failReady(serviceName: string, status: string, error: string): void {
    const row = this.rows.get(serviceName);
    if (!row || row.terminal) return;

    row.k8s.state = "failed";
    row.k8s.detail = status;
    row.k8s.error = error;
    row.terminal = "failed";

    this.render(row, {
      phase: "ready",
      state: "failed",
      source: "k8s-rollout",
      detail: status,
      error,
    });
    this.display.setError(serviceName, error);
  }

  private sourceForPhase(
    row: AppRowAggregate,
    phase: Phase,
    source: RowSource,
  ): SourceActivity {
    if (source === "helm-hook") return row.helmHook;
    if (source === "k8s-rollout") return row.k8s;
    if (phase === "pull") return row.pull;
    if (phase === "secrets") return row.secrets;
    if (phase === "ready") return row.k8s;
    return row.helmHook;
  }

  private renderDerived(row: AppRowAggregate): void {
    if (row.terminal === "failed") {
      if (row.helmHook.state === "failed") {
        this.render(row, {
          phase: "install",
          state: "failed",
          source: "helm-hook",
          detail: row.helmHook.detail,
          error: row.helmHook.error,
        });
      } else {
        this.render(row, {
          phase: "ready",
          state: "failed",
          source: "k8s-rollout",
          detail: row.k8s.detail,
          error: row.k8s.error,
        });
      }
      return;
    }

    if (row.helmHook.state === "running") {
      this.render(row, {
        phase: "install",
        state: "running",
        source: "helm-hook",
        detail: combineReadinessAndHook(row.k8s.detail, row.helmHook.detail),
        error: null,
      });
      return;
    }

    if (row.k8s.state === "running") {
      this.render(row, {
        phase: "ready",
        state: "running",
        source: "k8s-rollout",
        detail: row.k8s.detail,
        error: null,
      });
      return;
    }

    if (row.k8s.state === "done") {
      this.render(row, {
        phase: "ready",
        state: "done",
        source: "k8s-rollout",
        detail: row.k8s.detail,
        error: null,
      });
      return;
    }

    this.render(row, {
      phase: "install",
      state: "pending",
      source: "none",
      detail: null,
      error: null,
    });
  }

  private render(row: AppRowAggregate, next: RenderedRowState): void {
    if (renderEquals(row.rendered, next)) return;

    const previous = row.rendered;
    row.rendered = next;

    const phaseChanged =
      previous?.phase !== next.phase || previous.state !== next.state;
    if (phaseChanged) {
      if (next.phase === "ready" && previous?.phase === "install") {
        this.display.transition(row.serviceName, "install", "done");
      }
      this.display.transition(row.serviceName, next.phase, next.state);
    }

    if (
      next.detail &&
      (next.state === "running" ||
        next.state === "queued" ||
        next.state === "done" ||
        next.state === "failed")
    ) {
      this.display.setPodStatus(row.serviceName, next.detail);
    }
  }
}
