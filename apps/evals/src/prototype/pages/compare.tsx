import { PageShell } from "../../components/eval-ui";

export function PrototypeComparePage({ left, right }: { left?: string; right?: string }) {
  return (
    <PageShell active="canary">
      <div className="eval-container eval-hero">
        <h1 className="eval-title">
          Compare<span className="eval-dot">.</span>
        </h1>
        <p className="eval-description">
          Prototype stub — implementation pending.
          {left ? ` Left: ${left}` : ""}
          {right ? ` Right: ${right}` : ""}
        </p>
      </div>
    </PageShell>
  );
}
