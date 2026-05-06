import type { PhaseState, ServiceRow } from "@agent-ix/ix-ui-cli";

export interface PhaseRowService {
  name: string;
  displayName?: string;
}

export class PhaseRows<P extends string> {
  private rows: ServiceRow<P>[];

  constructor(
    services: PhaseRowService[],
    private readonly phases: readonly P[],
    private readonly emit: (services: ServiceRow<P>[]) => void,
  ) {
    this.rows = createPhaseRows(services, phases);
    this.emitSnapshot();
  }

  setPhase(
    name: string,
    phase: P,
    state: PhaseState,
    status: string | null = null,
  ): void {
    this.update(name, (row) => ({
      ...row,
      phases: { ...row.phases, [phase]: state },
      status,
    }));
  }

  setError(name: string, phase: P, error: string): void {
    this.update(name, (row) => ({
      ...row,
      phases: { ...row.phases, [phase]: "failed" },
      status: error,
      error,
    }));
  }

  finishPending(name: string, through: P): void {
    const throughIndex = this.phases.indexOf(through);
    if (throughIndex < 0) return;
    this.update(name, (row) => {
      const phases = { ...row.phases };
      for (const phase of this.phases.slice(0, throughIndex + 1)) {
        if (phases[phase] === "pending" || phases[phase] === "running") {
          phases[phase] = "done";
        }
      }
      return { ...row, phases };
    });
  }

  private update(
    name: string,
    fn: (row: ServiceRow<P>) => ServiceRow<P>,
  ): void {
    let changed = false;
    this.rows = this.rows.map((row) => {
      if (row.name !== name) return row;
      changed = true;
      return fn(row);
    });
    if (changed) this.emitSnapshot();
  }

  private emitSnapshot(): void {
    this.emit(snapshotPhaseRows(this.rows));
  }
}

export function createPhaseRows<P extends string>(
  services: PhaseRowService[],
  phases: readonly P[],
): ServiceRow<P>[] {
  return services.map(({ name, displayName }) => ({
    name,
    displayName,
    phases: Object.fromEntries(
      phases.map((phase) => [phase, "pending" as PhaseState]),
    ) as Record<P, PhaseState>,
    status: null,
    error: null,
  }));
}

export function snapshotPhaseRows<P extends string>(
  rows: ServiceRow<P>[],
): ServiceRow<P>[] {
  return rows.map((row) => ({
    ...row,
    phases: { ...row.phases },
  }));
}
