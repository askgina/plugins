import { useRef, useState } from "react";
import type { PublicEvalIndex, PublicEvalPublication } from "@askgina/contracts";
import { PageShell, Panel } from "../components/eval-ui";
import { PublicIndexView, PublicPublicationView } from "../components/public-results";
import { Button } from "../components/ui/button";
import {
  assessPublicationAgainstIndex,
  MAX_PUBLIC_ARTIFACT_BYTES,
  parsePublicArtifact,
  publicArtifactSha256,
} from "../lib/public-results";
import "../styles/handoff.css";

type LoadState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "loaded";
      publication: PublicEvalPublication | null;
      index: PublicEvalIndex | null;
      publicationSha256: string | null;
    };

export function HandoffPage() {
  const [state, setState] = useState<LoadState>({ status: "empty" });
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  function clear() {
    generation.current += 1;
    setState({ status: "empty" });
    if (input.current) input.current.value = "";
  }

  function loadFiles(files: readonly File[]) {
    const current = ++generation.current;
    if (files.length === 0) {
      setState({ status: "empty" });
      return;
    }
    if (files.length > 2) {
      setState({ status: "error", message: "Select one publication, one index, or one of each." });
      return;
    }
    if (files.some((file) => file.size > MAX_PUBLIC_ARTIFACT_BYTES)) {
      setState({ status: "error", message: "Each public JSON file must be no larger than 5 MiB." });
      return;
    }
    setState({ status: "loading" });
    void Promise.all(files.map((file) => file.arrayBuffer()))
      .then((buffers) => {
        if (current !== generation.current) return;
        let publication: PublicEvalPublication | null = null;
        let publicationBytes: ArrayBuffer | null = null;
        let index: PublicEvalIndex | null = null;
        for (const bytes of buffers) {
          const artifact = parsePublicArtifact(bytes);
          if (artifact.kind === "empty" || artifact.kind === "unsupported") {
            setState({
              status: "error",
              message:
                artifact.kind === "empty"
                  ? "A selected file is empty. Choose a public JSON export."
                  : artifact.message,
            });
            return;
          }
          if (artifact.kind === "publication") {
            if (publication) {
              setState({
                status: "error",
                message: "Select only one publication at a time, optionally with its index.",
              });
              return;
            }
            publication = artifact.publication;
            publicationBytes = bytes;
          } else {
            if (index) {
              setState({
                status: "error",
                message: "Select only one index at a time, optionally with a publication.",
              });
              return;
            }
            index = artifact.index;
          }
        }
        if (index && publicationBytes) {
          return publicArtifactSha256(publicationBytes).then((publicationSha256) => {
            if (current !== generation.current) return;
            setState({ status: "loaded", publication, index, publicationSha256 });
          });
        }
        setState({ status: "loaded", publication, index, publicationSha256: null });
      })
      .catch(() => {
        if (current === generation.current) {
          setState({
            status: "error",
            message: "The selected file could not be read as a supported public JSON export.",
          });
        }
      });
  }

  const assessment =
    state.status === "loaded" && state.publication && state.index
      ? assessPublicationAgainstIndex(state.publication, state.index, state.publicationSha256)
      : null;

  return (
    <PageShell active="handoff">
      <div className="eval-container eval-handoff">
        <section className="eval-hero">
          <p className="eval-eyebrow">Public results handoff</p>
          <h1 className="eval-title">
            Read a public export<span className="eval-dot">.</span>
          </h1>
          <p className="eval-description">
            Inspect the exporter&apos;s conformance results and publication history. No private API,
            live evaluation, or score calculation runs here.
          </p>
        </section>
        <div className="eval-handoff-stack">
          <Panel
            title="Load local public JSON"
            description="Publication v1, index v1, or one of each. Files stay in this browser session."
          >
            <div className="eval-handoff-body">
              <p id="handoff-file-help">
                Choose only framework-exported public artifacts, not reports, captures, or private
                source data. Select a publication and its index together to check the
                snapshot&apos;s SHA-256 and apply the index&apos;s current revision and withdrawal
                status. Each selection replaces the previous one. Limit 5 MiB per file.
              </p>
              <div className="eval-handoff-controls">
                <label className="eval-handoff-file">
                  Public JSON files
                  <input
                    ref={input}
                    type="file"
                    accept=".json,application/json"
                    multiple
                    aria-describedby="handoff-file-help"
                    onChange={(event) => {
                      const files = Array.from(event.currentTarget.files ?? []);
                      event.currentTarget.value = "";
                      void loadFiles(files);
                    }}
                  />
                </label>
                <Button variant="outline" size="sm" onClick={clear}>
                  Clear selection
                </Button>
              </div>
              <p className="eval-muted">
                On macOS, open the file picker and press Cmd+Shift+G to enter an export directory
                such as /tmp. The browser checks snapshot hashes only against a companion index. It
                does not verify approval records or whether an index is the latest version.
              </p>
            </div>
          </Panel>
          <div aria-live="polite" aria-atomic="true">
            {state.status === "empty" && (
              <p className="eval-handoff-notice">No public artifact selected.</p>
            )}
            {state.status === "loading" && (
              <p className="eval-handoff-notice">Reading public JSON files…</p>
            )}
            {state.status === "error" && (
              <p className="eval-handoff-notice" role="alert">
                {state.message}
              </p>
            )}
          </div>
          {state.status === "loaded" && (
            <>
              {assessment?.status === "hidden" ? (
                <p className="eval-handoff-notice" role="status">
                  {state.publication?.dataOrigin === "synthetic" && (
                    <strong>Synthetic publication, not measured results. </strong>
                  )}
                  {assessment.message}
                </p>
              ) : state.publication ? (
                <>
                  {!state.index && (
                    <p className="eval-handoff-notice">
                      No companion index selected. This snapshot&apos;s SHA-256 is unchecked against
                      an index, and the snapshot alone cannot establish whether a newer correction
                      or withdrawal exists.
                    </p>
                  )}
                  {assessment?.status === "superseded" && (
                    <p className="eval-handoff-notice" role="status">
                      {assessment.message}
                    </p>
                  )}
                  <PublicPublicationView publication={state.publication} />
                </>
              ) : null}
              {state.index && (
                <>
                  {!state.publication && (
                    <p className="eval-handoff-notice">
                      No publication selected. This index shows metadata and history only; no
                      snapshot bytes have been checked.
                    </p>
                  )}
                  <PublicIndexView index={state.index} />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
