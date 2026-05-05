import { describe, expect, it } from "vitest";
import type { ServiceRow } from "@agent-ix/ix-ui-cli";
import {
  createPhaseRows,
  PhaseRows,
  snapshotPhaseRows,
} from "../src/phase-rows.js";

type TestPhase = "first" | "second" | "third";
const PHASES: readonly TestPhase[] = ["first", "second", "third"];

function rowFor(rows: ServiceRow<TestPhase>[], name: string) {
  const row = rows.find((r) => r.name === name);
  if (!row) throw new Error(`missing row: ${name}`);
  return row;
}

describe("PhaseRows", () => {
  it("TC-285: creates pending rows for every service and phase", () => {
    const rows = createPhaseRows(
      [{ name: "identity", displayName: "identity source" }],
      PHASES,
    );

    expect(rows).toEqual([
      {
        name: "identity",
        displayName: "identity source",
        phases: {
          first: "pending",
          second: "pending",
          third: "pending",
        },
        status: null,
        error: null,
      },
    ]);
  });

  it("TC-286: emits immutable snapshots when phases change", () => {
    const snapshots: ServiceRow<TestPhase>[][] = [];
    const rows = new PhaseRows(
      [{ name: "identity" }, { name: "permission-service" }],
      PHASES,
      (services) => snapshots.push(services),
    );

    rows.setPhase("identity", "first", "running", "working");
    const firstSnapshot = snapshots.at(-1);
    if (!firstSnapshot) throw new Error("snapshot missing");

    rows.setPhase("identity", "first", "done");

    expect(rowFor(firstSnapshot, "identity").phases.first).toBe("running");
    expect(rowFor(snapshots.at(-1) ?? [], "identity").phases.first).toBe(
      "done",
    );
  });

  it("TC-287: marks an error and finishes prior pending or running phases", () => {
    const snapshots: ServiceRow<TestPhase>[][] = [];
    const rows = new PhaseRows([{ name: "identity" }], PHASES, (services) =>
      snapshots.push(services),
    );

    rows.setPhase("identity", "first", "running");
    rows.setError("identity", "second", "boom");
    rows.finishPending("identity", "second");

    const row = rowFor(snapshots.at(-1) ?? [], "identity");
    expect(row.phases).toEqual({
      first: "done",
      second: "failed",
      third: "pending",
    });
    expect(row.error).toBe("boom");
  });

  it("TC-288: snapshots cloned rows and phase maps", () => {
    const rows = createPhaseRows([{ name: "identity" }], PHASES);
    const snapshot = snapshotPhaseRows(rows);

    snapshot[0].phases.first = "done";

    expect(rows[0].phases.first).toBe("pending");
  });
});
