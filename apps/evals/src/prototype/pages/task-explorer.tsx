import { PageShell } from "../../components/eval-ui";

export function PrototypeTaskExplorerPage({ family }: { family?: string }) {
  return (
    <PageShell active="canary">
      <div className="eval-container eval-hero">
        <h1 className="eval-title">
          Tasks<span className="eval-dot">.</span>
        </h1>
        <p className="eval-description">
          Prototype stub — implementation pending.{family ? ` Family: ${family}` : ""}
        </p>
      </div>
    </PageShell>
  );
}
