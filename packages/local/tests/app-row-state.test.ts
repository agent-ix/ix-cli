import { describe, expect, it } from "vitest";
import type { PhaseState, PhaseTable } from "@agent-ix/ix-ui-cli";
import { AppInstallRows } from "../src/app-row-state.js";
import type { Phase } from "../src/phases.js";

interface TransitionCall {
  service: string;
  phase: Phase;
  state: PhaseState;
}

class FakePhaseTable {
  transitions: TransitionCall[] = [];
  statuses: Array<{ service: string; status: string }> = [];
  errors: Array<{ service: string; error: string }> = [];

  transition(service: string, phase: Phase, state: PhaseState): void {
    this.transitions.push({ service, phase, state });
  }

  setPodStatus(service: string, status: string): void {
    this.statuses.push({ service, status });
  }

  setError(service: string, error: string): void {
    this.errors.push({ service, error });
  }
}

function makeRows(): {
  fake: FakePhaseTable;
  rows: AppInstallRows;
} {
  const fake = new FakePhaseTable();
  const rows = new AppInstallRows(fake as unknown as PhaseTable<Phase>, [
    { name: "identity" },
    { name: "catalog-service" },
  ]);
  return { fake, rows };
}

describe("AppInstallRows", () => {
  it("does not restart running state on repeated Kubernetes readiness polls", () => {
    const { fake, rows } = makeRows();
    rows.transition("identity", "install", "pending");

    rows.updateK8sInstallStatus("identity", "0/1·start");
    rows.updateK8sInstallStatus("identity", "0/1·start");

    expect(fake.transitions).toEqual([
      { service: "identity", phase: "install", state: "pending" },
      { service: "identity", phase: "install", state: "done" },
      { service: "identity", phase: "ready", state: "running" },
    ]);
    expect(fake.statuses).toEqual([
      { service: "identity", status: "0/1·start" },
    ]);
  });

  it("marks plain full readiness done so spinner and timer can stop", () => {
    const { fake, rows } = makeRows();
    rows.transition("identity", "install", "pending");
    rows.updateK8sInstallStatus("identity", "0/1·start");

    rows.updateK8sInstallStatus("identity", "1/1");
    rows.updateK8sInstallStatus("identity", "1/1");

    expect(fake.transitions).toEqual([
      { service: "identity", phase: "install", state: "pending" },
      { service: "identity", phase: "install", state: "done" },
      { service: "identity", phase: "ready", state: "running" },
      { service: "identity", phase: "ready", state: "done" },
    ]);
    expect(fake.statuses).toEqual([
      { service: "identity", status: "0/1·start" },
      { service: "identity", status: "1/1" },
    ]);
  });

  it("keeps settling readiness active until the settling marker disappears", () => {
    const { fake, rows } = makeRows();
    rows.transition("identity", "install", "pending");

    rows.updateK8sInstallStatus("identity", "1/1·settle");
    rows.updateK8sInstallStatus("identity", "1/1");

    expect(fake.transitions).toEqual([
      { service: "identity", phase: "install", state: "pending" },
      { service: "identity", phase: "install", state: "done" },
      { service: "identity", phase: "ready", state: "running" },
      { service: "identity", phase: "ready", state: "done" },
    ]);
    expect(fake.statuses).toEqual([
      { service: "identity", status: "1/1·settle" },
      { service: "identity", status: "1/1" },
    ]);
  });

  it("lets an active hook own its row while preserving Kubernetes readiness", () => {
    const { fake, rows } = makeRows();
    rows.transition("catalog-service", "install", "pending");

    rows.updateHook("catalog-service", {
      jobName: "app-catalog-service-pgboot",
      phase: "running",
      message: "waiting for postgres",
    });
    rows.updateK8sInstallStatus("catalog-service", "1/1");
    rows.reconcileActiveInstallHooks(new Set());

    expect(fake.transitions).toEqual([
      { service: "catalog-service", phase: "install", state: "pending" },
      { service: "catalog-service", phase: "install", state: "running" },
      { service: "catalog-service", phase: "install", state: "done" },
      { service: "catalog-service", phase: "ready", state: "done" },
    ]);
    expect(fake.statuses).toEqual([
      { service: "catalog-service", status: "waiting for postgres" },
      { service: "catalog-service", status: "1/1 · waiting for postgres" },
      { service: "catalog-service", status: "1/1" },
    ]);
  });

  it("hook failure overrides Kubernetes readiness and freezes the row failed", () => {
    const { fake, rows } = makeRows();
    rows.transition("catalog-service", "install", "pending");
    rows.updateK8sInstallStatus("catalog-service", "1/1");

    rows.updateHook("catalog-service", {
      jobName: "app-catalog-service-pgboot",
      phase: "failed",
      message: "DeadlineExceeded",
    });
    rows.updateK8sInstallStatus("catalog-service", "1/1");

    expect(fake.transitions).toEqual([
      { service: "catalog-service", phase: "install", state: "pending" },
      { service: "catalog-service", phase: "install", state: "done" },
      { service: "catalog-service", phase: "ready", state: "done" },
      { service: "catalog-service", phase: "install", state: "failed" },
    ]);
    expect(fake.statuses).toEqual([
      { service: "catalog-service", status: "1/1" },
      { service: "catalog-service", status: "DeadlineExceeded" },
    ]);
    expect(fake.errors).toEqual([
      {
        service: "catalog-service",
        error:
          "install: hook app-catalog-service-pgboot failed: DeadlineExceeded",
      },
    ]);
  });

  it("ignores updates for unknown rows", () => {
    const { fake, rows } = makeRows();
    rows.updateK8sInstallStatus("missing", "1/1");
    rows.updateHook("missing", {
      jobName: "missing-hook",
      phase: "running",
      message: "waiting",
    });

    expect(fake.transitions).toEqual([]);
    expect(fake.statuses).toEqual([]);
    expect(fake.errors).toEqual([]);
  });
});
