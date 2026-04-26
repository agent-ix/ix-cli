export type Phase = "secrets" | "pull" | "install" | "ready";

export const PHASES: readonly Phase[] = ["secrets", "pull", "install", "ready"];

export const PHASE_LABELS: Record<Phase, string> = {
  secrets: "secrets",
  pull: "pulling",
  install: "installing",
  ready: "ready",
};
