import type React from "react";
import {
  Item,
  Listing,
  type FrameStatus,
  type TailVariant,
  render,
  renderStatic,
  useRenderResult,
  useState,
} from "@agent-ix/ix-ui-cli";

/**
 * Mounts a live <Listing status="running"> with header + spinner while
 * `controller` runs, then transitions the SAME mounted Listing to its
 * passed/failed final frame and exits. Ink keeps the final frame in stdout
 * scrollback, so we never call renderStatic in TTY mode — that would draw a
 * second header.
 *
 * In non-TTY environments (tests, piped output, log files), the spinner is
 * useless, so we skip the live render entirely and emit a single final
 * frame via renderStatic. Tests rely on this path: they mock render() to a
 * no-op and assert on the recorded renderStatic Listing.
 *
 * The controller runs in the outer async fn (not inside useEffect) so the
 * non-TTY path doesn't depend on React's effect scheduler — the existing
 * listing-helpers test mock captures the full flow without modification.
 */

export interface LiveListingRow {
  name: React.ReactNode;
  description?: React.ReactNode;
}

export interface LiveListingFinalFrame {
  status?: FrameStatus;
  tail?: React.ReactNode;
  tailVariant?: TailVariant;
  /** Final-frame children. If omitted, the running rows are kept. */
  children?: React.ReactNode;
}

export interface RunWithLiveListingOptions<R> {
  header: string;
  /** Rendered above the rows in both the running and final frames. */
  pre?: React.ReactNode;
  controller: (emit: (rows: LiveListingRow[]) => void) => Promise<R>;
  frameForSuccess: (result: R) => LiveListingFinalFrame;
  frameForError?: (err: Error) => LiveListingFinalFrame;
}

const defaultErrorFrame = (err: Error): LiveListingFinalFrame => ({
  status: "failed",
  tail: `Failed: ${err.message}`,
  tailVariant: "error",
});

interface ShellHandle {
  setRows?: (rows: LiveListingRow[]) => void;
  setFinal?: (frame: LiveListingFinalFrame) => void;
  exit?: () => void;
}

export async function runWithLiveListing<R>({
  header,
  pre,
  controller,
  frameForSuccess,
  frameForError = defaultErrorFrame,
}: RunWithLiveListingOptions<R>): Promise<R> {
  const isTTY = Boolean(process.stdout.isTTY);

  if (!isTTY) {
    // Non-TTY: no spinner value, single static frame.
    let result: R | undefined;
    let err: Error | undefined;
    try {
      result = await controller(() => {});
    } catch (e) {
      err = e instanceof Error ? e : new Error(String(e));
    }

    const frame = err ? frameForError(err) : frameForSuccess(result as R);
    await renderStatic(
      <Listing
        header={header}
        status={frame.status ?? (err ? "failed" : "passed")}
        variant="flow"
        pre={pre}
        tail={frame.tail}
        tailVariant={frame.tailVariant}
      >
        {frame.children}
      </Listing>,
    );

    if (err) throw err;
    return result as R;
  }

  // TTY: mount one live Listing, transition to final state, exit.
  const handle: ShellHandle = {};

  const Live: React.FC = () => {
    const [rows, setRows] = useState<LiveListingRow[]>([]);
    const [final, setFinal] = useState<LiveListingFinalFrame | null>(null);
    const { exit } = useRenderResult();
    handle.setRows = setRows;
    handle.setFinal = setFinal;
    handle.exit = exit;

    return (
      <Listing
        header={header}
        status={final?.status ?? (final ? "passed" : "running")}
        variant="flow"
        pre={pre}
        tail={final?.tail}
        tailVariant={final?.tailVariant}
      >
        {final?.children ??
          rows.map((r, i) => (
            <Item key={i} name={r.name} description={r.description} />
          ))}
      </Listing>
    );
  };

  const liveDone = render(<Live />);

  let result: R | undefined;
  let err: Error | undefined;
  try {
    result = await controller((next) => handle.setRows?.(next));
  } catch (e) {
    err = e instanceof Error ? e : new Error(String(e));
  }

  const frame = err ? frameForError(err) : frameForSuccess(result as R);
  handle.setFinal?.(frame);
  // Let React flush the final paint before unmount.
  await new Promise<void>((r) => setTimeout(r, 0));
  handle.exit?.();
  await liveDone;

  if (err) throw err;
  return result as R;
}
