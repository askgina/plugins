import { useRef, useState } from "react";
import type { PublicEvalIndex, PublicEvalPublication } from "@askgina/contracts";
import { PageShell, Panel } from "../components/eval-ui";
import { PublicIndexView, PublicPublicationView } from "../components/public-results";
import { Button } from "../components/ui/button";
import { MAX_PUBLIC_ARTIFACT_BYTES, parsePublicArtifact } from "../lib/public-results";
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

// An index can withhold an old snapshot, but this view cannot establish that a
// locally selected index is the latest one. It never fetches historical paths.
function publicationNotice(
  publication: PublicEvalPublication,
  index: PublicEvalIndex,
  publicationSha256: string | null,
): string | null {
  if (publication.dataOrigin !== index.dataOrigin) {
    return "The index and publication have different data origins. The publication is not displayed.";
  }
  const entry = index.publications.find((item) => item.publicationId === publication.publicationId);
  if (!entry || entry.runId !== publication.runId) {
    return "This publication is not identified by the selected index. The publication is not displayed.";
  }
  if (entry.status === "withdrawn" && publication.content.kind === "result") {
    return "The selected index marks this publication withdrawn. Result content is hidden. Select the current withdrawal notice to read its reason.";
  }
  const revision = entry.revisions.find((item) => item.revisionId === publication.revisionId);
  if (
    !revision ||
    revision.revision !== publication.revision ||
    revision.kind !== publication.content.kind ||
    revision.state === "removed"
  ) {
    return "This snapshot is absent, removed, or inconsistent with the selected index. The publication is not displayed.";
  }
  if (entry.currentRevisionId !== publication.revisionId || revision.state !== "current") {
    return "This snapshot is not the current revision in the selected index. The publication is hidden; select the current revision listed below.";
  }
  if (publicationSha256 === null || revision.sha256 === null || revision.sha256 !== publicationSha256) {
    return "The snapshot's SHA-256 is missing or does not match the selected index. The publication is not displayed.";
  }
  return null;
}

export function HandoffPage() {
  const [state, setState] = useState<LoadState>({ status: "empty" });
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  function clear() {
    generation.current += 1;
    setState({ status: "empty" });
    if (input.current) input.current.value = "";
  }

  async function loadFiles(files: readonly File[]) {
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
    try {
      const buffers = await Promise.all(files.map((file) => file.arrayBuffer()));
      if (current !== generation.current) return;
      let publication: PublicEvalPublication | null = null;
      let publicationBytes: ArrayBuffer | null = null;
      let index: PublicEvalIndex | null = null;
      for (const bytes of buffers) {
        const artifact = parsePublicArtifact(bytes);
        if (artifact.kind === "empty" || artifact.kind === "unsupported") {
          setState({
            status: "error",
            message: artifact.kind === "empty" ? "A selected file is empty. Choose a public JSON export." : artifact.message,
          });
          return;
        }
        if (artifact.kind === "publication") {
          if (publication) {
            setState({ status: "error", message: "Select only one publication at a time, optionally with its index." });
            return;
          }
          publication = artifact.publication;
          publicationBytes = bytes;
        } else {
          if (index) {
            setState({ status: "error", message: "Select only one index at a time, optionally with a publication." });
            return;
          }
          index = artifact.index;
        }
      }
      let publicationSha256: string | null = null;
      if (index && publicationBytes) {
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", publicationBytes));
        if (current !== generation.current) return;
        publicationSha256 = "";
        for (const byte of digest) publicationSha256 += byte.toString(16).padStart(2, "0");
      }
      setState({ status: "loaded", publication, index, publicationSha256 });
    } catch {
      if (current === generation.current) {
        setState({ status: "error", message: "The selected file could not be read as a supported public JSON export." });
      }
    }
  }

  const hiddenNotice = state.status === "loaded" && state.publication && state.index
    ? publicationNotice(state.publication, state.index, state.publicationSha256)
    : null;

  return (
    <PageShell active="handoff">
      <div className="eval-container eval-handoff">
        <section className="eval-hero">
          <p className="eval-eyebrow">Public results handoff</p>
          <h1 className="eval-title">Read a public export<span className="eval-dot">.</span></h1>
          <p className="eval-description">
            Inspect the exporter&apos;s conformance results and publication history. No private API,
            live evaluation, or score calculation runs here.
          </p>
        </section>
        <div className="eval-handoff-stack">
          <Panel title="Load local public JSON" description="Publication v1, index v1, or one of each. Files stay in this browser session.">
            <div className="eval-handoff-body">
              <p id="handoff-file-help">
                Choose only framework-exported public artifacts, not reports, captures, or private source data.
                Select a publication and its index together to check the snapshot&apos;s SHA-256 and apply the index&apos;s current revision and withdrawal status.
                Each selection replaces the previous one. Limit 5 MiB per file.
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
                <Button variant="outline" size="sm" onClick={clear}>Clear selection</Button>
              </div>
              <p className="eval-muted">
                On macOS, open the file picker and press Cmd+Shift+G to enter an export directory such as /tmp.
                The browser checks snapshot hashes only against a companion index. It does not verify approval records or whether an index is the latest version.
              </p>
            </div>
          </Panel>
          <div aria-live="polite" aria-atomic="true">
            {state.status === "empty" && <p className="eval-handoff-notice">No public artifact selected.</p>}
            {state.status === "loading" && <p className="eval-handoff-notice">Reading public JSON files…</p>}
            {state.status === "error" && <p className="eval-handoff-notice" role="alert">{state.message}</p>}
          </div>
          {state.status === "loaded" && (
            <>
              {hiddenNotice ? (
                <p className="eval-handoff-notice" role="status">
                  {state.publication?.dataOrigin === "synthetic" && (
                    <strong>Synthetic publication, not measured results. </strong>
                  )}
                  {hiddenNotice}
                </p>
              ) : state.publication ? (
                <>
                  {!state.index && (
                    <p className="eval-handoff-notice">
                      No companion index selected. This snapshot&apos;s SHA-256 is unchecked against an index, and the snapshot alone cannot establish whether a newer correction or withdrawal exists.
                    </p>
                  )}
                  <PublicPublicationView publication={state.publication} />
                </>
              ) : null}
              {state.index && <PublicIndexView index={state.index} />}
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
