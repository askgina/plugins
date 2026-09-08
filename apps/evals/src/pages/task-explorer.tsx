import { useId, useState } from "react";
import { BookOpen, Clock, ListTree, Search, Shield } from "lucide-react";
import { getModel, type FamilyFilter, type TaskFamily } from "../data";
import { FamilyTabs, Modal, ModelAvatar, PageShell } from "../components/eval-ui";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import {
  fixtureNotice,
  fixturesFor,
  resolveSampleIndex,
  sampleAt,
  type EvidenceSection,
  type TaskSample,
  type TraceFixture,
  type TraceId,
} from "./task-fixtures";
import "./task-explorer.css";

export function TaskExplorerPage({
  initialFamily = "Portfolio",
  initialSample,
  initialTrace,
}: {
  initialFamily?: TaskFamily;
  initialSample?: number;
  initialTrace?: TraceId;
}) {
  const sampleLabelId = useId();
  const [family, setFamily] = useState<TaskFamily>(initialFamily);
  const [sampleIndex, setSampleIndex] = useState(() =>
    resolveSampleIndex(initialFamily, initialSample),
  );
  const [openTrace, setOpenTrace] = useState<TraceId | null>(initialTrace ?? null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceSection, setEvidenceSection] = useState<EvidenceSection>("definition");

  const samples = fixturesFor(family);
  const task = samples[sampleIndex] ?? sampleAt(family, 1);
  const trace = openTrace ? task.traces[openTrace] : null;

  function changeFamily(next: FamilyFilter) {
    if (next === "All tasks") return;
    setFamily(next);
    setSampleIndex(0);
  }

  function openEvidence(section: EvidenceSection) {
    setEvidenceSection(section);
    setEvidenceOpen(true);
  }

  return (
    <PageShell active="tasks">
      <div className="task-explorer">
        <EditorialColumn />
        <section className="task-main" aria-labelledby="task-main-heading">
          <div className="task-toolbar">
            <FamilyTabs value={family} onChange={changeFamily} includeAll={false} />
            <div className="task-sample">
              <Label id={sampleLabelId} htmlFor="task-sample-trigger">
                Sample
              </Label>
              <Select
                value={String(task.sample)}
                onValueChange={(value: string) =>
                  setSampleIndex(resolveSampleIndex(family, Number(value)))
                }
              >
                <SelectTrigger
                  id="task-sample-trigger"
                  className="task-sample-trigger"
                  aria-labelledby={sampleLabelId}
                >
                  <SelectValue placeholder="Choose a fixture" />
                </SelectTrigger>
                <SelectContent>
                  {samples.map((item) => (
                    <SelectItem key={item.id} value={String(item.sample)}>
                      {item.sample}. {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="task-sample-count">
                {samples.length} sanitized fixtures in {family}
              </p>
            </div>
          </div>
          <p className="eval-eyebrow">
            {task.family} · Sample {task.sample} of {samples.length}
          </p>
          <h2 id="task-main-heading" className="task-prompt-title">
            {task.title}
          </h2>
          <p className="task-prompt">{task.prompt}</p>
          <div className="task-compare">
            <ComparisonCard
              task={task}
              trace={task.traces.kimi}
              onInspect={() => setOpenTrace("kimi")}
            />
            <ComparisonCard
              task={task}
              trace={task.traces.gpt}
              onInspect={() => setOpenTrace("gpt")}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => openEvidence("definition")}
          >
            <BookOpen aria-hidden="true" />
            Full task details
          </Button>
        </section>
        <EvidenceSidebar onOpen={openEvidence} />
      </div>
      <Modal
        title={trace ? `Inspect trace · ${trace.modelName}` : "Inspect trace"}
        open={openTrace !== null}
        onClose={() => setOpenTrace(null)}
      >
        {trace ? <TraceBody task={task} trace={trace} /> : null}
      </Modal>
      <Modal title="Task evidence" open={evidenceOpen} onClose={() => setEvidenceOpen(false)}>
        <EvidenceBody task={task} section={evidenceSection} />
      </Modal>
    </PageShell>
  );
}

function EditorialColumn() {
  return (
    <aside className="task-editorial">
      <h1 className="task-editorial-title">
        <span>Every score,</span>
        <span>
          backed by evidence
          <span className="task-red-dot" aria-hidden="true" />
        </span>
      </h1>
      <p className="eval-description task-editorial-copy">
        Explore the answers, tool calls, and rubric behind every task.
      </p>
      <figure className="task-watercolor" aria-hidden="true">
        <img
          className="task-watercolor-image"
          src="/images/hero-watercolor-landscape.webp"
          alt=""
        />
      </figure>
      <blockquote className="eval-quote task-editorial-quote">
        "A benchmark should show the work, not just crown a winner."
      </blockquote>
    </aside>
  );
}

function EvidenceSidebar({ onOpen }: { onOpen: (section: EvidenceSection) => void }) {
  return (
    <aside className="task-evidence" aria-labelledby="task-evidence-heading">
      <h2 id="task-evidence-heading">What this task measures</h2>
      <ul className="task-evidence-points">
        <li>
          <Search size={16} aria-hidden="true" />
          <div>
            <strong>Tools.</strong> The agent may call the listed read tools and nothing else.
          </div>
        </li>
        <li>
          <ListTree size={16} aria-hidden="true" />
          <div>
            <strong>Grounded.</strong> The answer has to cite fields that came back. Missing quotes
            stay missing.
          </div>
        </li>
        <li>
          <Shield size={16} aria-hidden="true" />
          <div>
            <strong>Strict read-only.</strong> No orders, swaps, transfers, or schedule writes. A
            blank price is a limitation, not a trade.
          </div>
        </li>
      </ul>
      <Separator className="task-evidence-rule" />
      <div className="task-evidence-links">
        <p className="task-evidence-lead">Evidence &amp; provenance</p>
        <nav className="task-provenance" aria-label="Fixture evidence">
          <Button type="button" variant="link" onClick={() => onOpen("definition")}>
            Task definition
          </Button>
          <Button type="button" variant="link" onClick={() => onOpen("tools")}>
            Expected tool set
          </Button>
          <Button type="button" variant="link" onClick={() => onOpen("rubric")}>
            Rubric
          </Button>
          <Button type="button" variant="link" onClick={() => onOpen("dataset")}>
            Sample dataset
          </Button>
        </nav>
      </div>
    </aside>
  );
}

function ComparisonCard({
  task,
  trace,
  onInspect,
}: {
  task: TaskSample;
  trace: TraceFixture;
  onInspect: () => void;
}) {
  const model = getModel(trace.modelId);
  return (
    <Card className="task-card eval-panel">
      <header className="task-card-head">
        {model ? <ModelAvatar model={model} /> : null}
        <div>
          <h3>
            {trace.modelName}
            <span className="task-harness">+ {trace.harness}</span>
          </h3>
          <Badge
            variant={trace.outcome === "Pass" ? "secondary" : "outline"}
            className={trace.outcome === "Pass" ? "task-badge-pass" : "task-badge-partial"}
          >
            {trace.outcome}
          </Badge>
        </div>
      </header>
      <p className="task-excerpt">{trace.excerpt}</p>
      <h4>Tool calls</h4>
      <ul className="task-calls">
        {trace.toolCalls.map((call) => (
          <li key={`${trace.id}-${call.name}`}>
            <span className="task-call-name">{call.name}</span>
            <span className="task-call-meta">
              <Clock size={12} aria-hidden="true" />
              {formatTime(call.timeMs)}
              <span className={call.status === "ok" ? "task-ok" : "task-limited"}>
                {call.status === "ok" ? "ok" : "limited"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <h4>Rubric</h4>
      <ul className="task-rubric">
        {trace.rubric.map((row) => (
          <li key={row.id} title={row.note}>
            <span>{row.label}</span>
            <span className={row.verdict === "pass" ? "task-ok" : "task-limited"}>
              {row.verdict}
            </span>
          </li>
        ))}
      </ul>
      <p className="task-tokens">
        <span>Total {trace.tokens.total}</span>
        <span>Input {trace.tokens.input}</span>
        <span>Output {trace.tokens.output}</span>
      </p>
      <p className="task-card-label">{task.id}</p>
      <Button type="button" variant="secondary" size="sm" onClick={onInspect}>
        Inspect trace
      </Button>
    </Card>
  );
}

function TraceBody({ task, trace }: { task: TaskSample; trace: TraceFixture }) {
  return (
    <div className="task-trace">
      <p className="task-fixture-banner">{trace.label}</p>
      <p>
        {task.family} sample {task.sample} · {trace.outcome}. Labels on this trace are illustrative.
      </p>
      {trace.toolCalls.map((call) => (
        <section key={`${trace.id}-payload-${call.name}`} className="task-payload">
          <h3>
            {call.name}
            <span className={call.status === "ok" ? "task-ok" : "task-limited"}>{call.status}</span>
          </h3>
          <p className="eval-muted">{formatTime(call.timeMs)}</p>
          <h4>Arguments</h4>
          <pre
            className="eval-code"
            role="region"
            aria-label={`${call.name} arguments`}
            tabIndex={0}
          >
            <code>{JSON.stringify(call.arguments, null, 2)}</code>
          </pre>
          <h4>Result</h4>
          <pre className="eval-code" role="region" aria-label={`${call.name} result`} tabIndex={0}>
            <code>{JSON.stringify(call.result, null, 2)}</code>
          </pre>
        </section>
      ))}
      <h3>Rubric results</h3>
      <ul className="task-rubric">
        {trace.rubric.map((row) => (
          <li key={row.id}>
            <span>
              {row.label}: {row.note}
            </span>
            <span className={row.verdict === "pass" ? "task-ok" : "task-limited"}>
              {row.verdict}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const evidenceLabels: Record<EvidenceSection, string> = {
  definition: "Task definition",
  tools: "Expected tool set",
  rubric: "Scoring rubric",
  dataset: "Sample dataset",
};

function EvidenceBody({ task, section }: { task: TaskSample; section: EvidenceSection }) {
  return (
    <div className="task-evidence-body">
      <p className="task-fixture-banner">{fixtureNotice}</p>
      <h3>{evidenceLabels[section]}</h3>
      <p className="eval-muted">
        {task.family} · Sample {task.sample} · {task.id}
      </p>
      {section === "definition" ? (
        <>
          <p>{task.definition}</p>
          <blockquote>{task.prompt}</blockquote>
        </>
      ) : null}
      {section === "tools" ? (
        <ul>
          {task.expectedTools.map((name) => (
            <li key={name}>
              <code>{name}</code>
            </li>
          ))}
        </ul>
      ) : null}
      {section === "rubric" ? (
        <ul>
          {task.rubricSpec.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      ) : null}
      {section === "dataset" ? (
        <pre className="eval-code" role="region" aria-label="Dataset" tabIndex={0}>
          <code>{JSON.stringify(task.dataset, null, 2)}</code>
        </pre>
      ) : null}
    </div>
  );
}

function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
