import type React from "react";
import {
  PhaseTable,
  render,
  useEffect,
  type FrameStatus,
  type ServiceRow,
  type TailVariant,
  useRenderResult,
  useState,
} from "@agent-ix/ix-ui-cli";

export interface PhaseTableFinalFrame {
  status?: FrameStatus;
  tail?: React.ReactNode;
  tailVariant?: TailVariant;
  tailIngressUrls?: string[];
  tailEntry?: { name: string; baseDomain: string };
}

export interface RenderPhaseTableRunOptions<P extends string, R> {
  header: string;
  phases: readonly P[];
  phaseLabels?: Partial<Record<P, string>>;
  preflight?: React.ReactNode;
  initialServices: ServiceRow<P>[];
  controller: (emit: (services: ServiceRow<P>[]) => void) => Promise<R>;
  frameForSuccess: (result: R) => PhaseTableFinalFrame;
  frameForError?: (err: Error) => PhaseTableFinalFrame;
}

const defaultFailureFrame = (err: Error): PhaseTableFinalFrame => ({
  status: "failed",
  tail: err.message,
  tailVariant: "error",
});

export async function renderPhaseTableRun<P extends string, R>({
  header,
  phases,
  phaseLabels,
  preflight,
  initialServices,
  controller,
  frameForSuccess,
  frameForError = defaultFailureFrame,
}: RenderPhaseTableRunOptions<P, R>): Promise<R> {
  let captured: { result?: R; err?: Error } = {};

  const LivePhaseTable: React.FC = () => {
    const [services, setServices] = useState<ServiceRow<P>[]>(initialServices);
    const [finalFrame, setFinalFrame] = useState<PhaseTableFinalFrame | null>(
      null,
    );
    const { exit } = useRenderResult();

    useEffect(() => {
      let cancelled = false;

      controller((snapshot) => setServices(snapshot))
        .then((result) => {
          if (cancelled) return;
          captured = { result };
          setFinalFrame(frameForSuccess(result));
          setTimeout(exit, 0);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          captured = { err };
          setFinalFrame(frameForError(err));
          setTimeout(exit, 0);
        });

      return () => {
        cancelled = true;
      };
      // Controller identity is fixed by the caller for this one-shot render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <PhaseTable<P>
        header={header}
        phases={phases}
        phaseLabels={phaseLabels}
        preflight={preflight}
        services={services}
        status={finalFrame?.status}
        tail={finalFrame?.tail}
        tailVariant={finalFrame?.tailVariant}
        tailIngressUrls={finalFrame?.tailIngressUrls}
        tailEntry={finalFrame?.tailEntry}
      />
    );
  };

  await render(<LivePhaseTable />);

  if (captured.err) throw captured.err;
  if (!("result" in captured)) {
    throw new Error("PhaseTable run exited without a result");
  }
  return captured.result as R;
}
