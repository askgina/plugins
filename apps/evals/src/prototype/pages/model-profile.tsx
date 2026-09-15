import { PageShell } from "../../components/eval-ui";

export function PrototypeModelProfilePage({ modelId, runId }: { modelId: string; runId?: string }) {
  return (
    <PageShell active="canary">
      <div className="eval-container eval-hero">
        <h1 className="eval-title">
          {modelId}
          <span className="eval-dot">.</span>
        </h1>
        <p className="eval-description">
          Prototype stub — implementation pending.{runId ? ` Run: ${runId}` : ""}
        </p>
      </div>
    </PageShell>
  );
}
