import { describe, expect, it } from "vitest";
import type { ServiceRow } from "@agent-ix/ix-ui-cli";
import { AppInstallRows } from "../src/app-row-state.js";
import type { Phase } from "../src/phases.js";

function makeRows(): {
  rows: AppInstallRows;
  latest: () => ServiceRow<Phase>[];
  emitCount: () => number;
} {
  let snapshot: ServiceRow<Phase>[] = [];
  let count = 0;
  const rows = new AppInstallRows(
    [{ name: "identity" }, { name: "catalog-service" }],
    (rs) => {
      snapshot = rs;
      count += 1;
    },
  );
  return {
    rows,
    latest: () => snapshot,
    emitCount: () => count,
  };
}

function rowFor(
  snapshot: ServiceRow<Phase>[],
  name: string,
): ServiceRow<Phase> {
  const row = snapshot.find((r) => r.name === name);
  if (!row) throw new Error(`row not found: ${name}`);
  return row;
}

describe("AppInstallRows", () => {
  it("emits queued phase state for rows waiting on a pool slot", () => {
    const { rows, latest } = makeRows();

    rows.transition("identity", "pull", "queued", "pull", "waiting for pull");

    const row = rowFor(latest(), "identity");
    expect(row.phases.pull).toBe("queued");
    expect(row.status).toBe("waiting for pull");
  });

  it("does not restart running state on repeated Kubernetes readiness polls", () => {
    const { rows, latest, emitCount } = makeRows();
    rows.transition("identity", "install", "pending");

    rows.updateK8sInstallStatus("identity", "0/1·start");
    const beforeRepeat = emitCount();
    rows.updateK8sInstallStatus("identity", "0/1·start");
    expect(emitCount()).toBe(beforeRepeat);

    const row = rowFor(latest(), "identity");
    expect(row.phases.install).toBe("done");
    expect(row.phases.ready).toBe("running");
    expect(row.status).toBe("0/1·start");
  });

  it("marks plain full readiness done so spinner and timer can stop", () => {
    const { rows, latest } = makeRows();
    rows.transition("identity", "install", "pending");
    rows.updateK8sInstallStatus("identity", "0/1·start");
    rows.updateK8sInstallStatus("identity", "1/1");

    const row = rowFor(latest(), "identity");
    expect(row.phases.install).toBe("done");
    expect(row.phases.ready).toBe("done");
    expect(row.status).toBe("1/1");
  });

  it("keeps settling readiness active until the settling marker disappears", () => {
    const { rows, latest } = makeRows();
    rows.transition("identity", "install", "pending");

    rows.updateK8sInstallStatus("identity", "1/1·settle");
    let row = rowFor(latest(), "identity");
    expect(row.phases.ready).toBe("running");
    expect(row.status).toBe("1/1·settle");

    rows.updateK8sInstallStatus("identity", "1/1");
    row = rowFor(latest(), "identity");
    expect(row.phases.ready).toBe("done");
    expect(row.status).toBe("1/1");
  });

  it("lets an active hook own its row while preserving Kubernetes readiness", () => {
    const { rows, latest } = makeRows();
    rows.transition("catalog-service", "install", "pending");

    rows.updateHook("catalog-service", {
      jobName: "app-catalog-service-pgboot",
      phase: "running",
      message: "waiting for postgres",
    });
    let row = rowFor(latest(), "catalog-service");
    expect(row.phases.install).toBe("running");
    expect(row.status).toBe("waiting for postgres");

    rows.updateK8sInstallStatus("catalog-service", "1/1");
    row = rowFor(latest(), "catalog-service");
    // Hook still running, so install row owns it; status combines readiness + hook.
    expect(row.phases.install).toBe("running");
    expect(row.status).toBe("1/1 · waiting for postgres");

    rows.reconcileActiveInstallHooks(new Set());
    row = rowFor(latest(), "catalog-service");
    // Hook drained → k8s readiness already satisfied → row reaches ready/done.
    expect(row.phases.install).toBe("done");
    expect(row.phases.ready).toBe("done");
    expect(row.status).toBe("1/1");
  });

  it("hook failure overrides Kubernetes readiness and freezes the row failed", () => {
    const { rows, latest } = makeRows();
    rows.transition("catalog-service", "install", "pending");
    rows.updateK8sInstallStatus("catalog-service", "1/1");

    rows.updateHook("catalog-service", {
      jobName: "app-catalog-service-pgboot",
      phase: "failed",
      message: "DeadlineExceeded",
    });

    // Subsequent k8s polls must not unfreeze the row.
    rows.updateK8sInstallStatus("catalog-service", "1/1");

    const row = rowFor(latest(), "catalog-service");
    expect(row.phases.install).toBe("failed");
    expect(row.status).toBe("DeadlineExceeded");
    expect(row.error).toBe(
      "install: hook app-catalog-service-pgboot failed: DeadlineExceeded",
    );
  });

  it("ignores updates for unknown rows", () => {
    const { rows, latest, emitCount } = makeRows();
    const before = emitCount();
    rows.updateK8sInstallStatus("missing", "1/1");
    rows.updateHook("missing", {
      jobName: "missing-hook",
      phase: "running",
      message: "waiting",
    });
    expect(emitCount()).toBe(before);
    expect(latest().find((r) => r.name === "missing")).toBeUndefined();
  });
});
