import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, ArrowUpRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";

const meta = {
  title: "Design System/Ask Gina",
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Portable primitives and visual foundations derived from the Ask Gina product and public landing page.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const palette = [
  { name: "Warm paper", value: "#fbfaf8", token: "--background" },
  { name: "Warm panel", value: "#eee8e0", token: "--card" },
  { name: "Earth action", value: "#9e6847", token: "--primary" },
  { name: "Ink", value: "#09090b", token: "--foreground" },
  { name: "Success", value: "#10b981", token: "--success" },
  { name: "Warning", value: "#f59e0b", token: "--warning" },
  { name: "Danger", value: "#dc2626", token: "--destructive" },
] as const;

export const Foundations: Story = {
  render: () => (
    <div className="mx-auto grid w-full max-w-6xl gap-10">
      <header className="max-w-3xl">
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Operator ledger
        </p>
        <h1 className="font-heading text-5xl font-semibold leading-[1.02] tracking-[-0.025em] sm:text-6xl">
          Warm surfaces, precise state.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          Nebula Sans carries product UI, EB Garamond supports editorial moments, and Geist Mono
          keeps identifiers and measured values legible.
        </p>
      </header>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Core palette</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {palette.map((color) => (
            <div
              key={color.name}
              className="overflow-hidden rounded-card border bg-background shadow-card"
            >
              <div className="h-24" style={{ backgroundColor: color.value }} />
              <div className="p-4">
                <p className="text-sm font-semibold">{color.name}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {color.value} · {color.token}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-card border bg-background p-6 shadow-card lg:col-span-2">
          <p className="font-heading text-4xl font-semibold leading-none">Editorial display</p>
          <p className="mt-3 text-lg font-semibold">Product headline in Nebula Sans</p>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            State is explained in one direct sentence. Supporting detail moves into the record,
            receipt, or methodology.
          </p>
        </div>
        <div className="rounded-card border bg-muted/45 p-6">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Run identity
          </p>
          <p className="mt-3 font-mono text-sm">eval_2026_09_03_a4f8</p>
          <Separator className="my-5" />
          <p className="font-mono text-xs text-muted-foreground">1024 tasks · 3 repetitions</p>
        </div>
      </section>
    </div>
  ),
};

export const LandingLanguage: Story = {
  parameters: {
    backgrounds: { disable: true },
  },
  render: () => (
    <div className="landing-page -m-5 overflow-hidden sm:-m-8">
      <section className="relative min-h-[720px] overflow-hidden bg-white px-5 pt-16 text-center sm:px-8">
        <img
          src="/images/hero-watercolor-landscape.webp"
          alt=""
          className="pointer-events-none absolute bottom-0 left-1/2 h-[52%] w-full max-w-[90rem] -translate-x-1/2 object-cover object-top select-none 2xl:object-contain 2xl:object-bottom"
        />
        <div className="relative z-10 mx-auto max-w-[600px]">
          <h1 className="landing-heading landing-hero-heading">
            Open evaluations,
            <br />
            built in public<span className="text-[var(--landing-red)]">.</span>
          </h1>
          <p className="landing-subtext mx-auto mt-3 max-w-[460px] text-base leading-7">
            Inspect task definitions, compare model behavior, and trace every published result.
          </p>
          <button className="landing-cta mt-5" type="button">
            View the results <span className="landing-cta__icon">→</span>
          </button>
        </div>

        <div className="relative z-20 mx-auto mt-10 w-full max-w-[760px] [mask-image:linear-gradient(to_bottom,#000_0%,#000_62%,rgba(0,0,0,0.7)_72%,rgba(0,0,0,0.25)_80%,transparent_88%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,#000_0%,#000_62%,rgba(0,0,0,0.7)_72%,rgba(0,0,0,0.25)_80%,transparent_88%,transparent_100%)]">
          <div className="rounded-[34px] border border-zinc-300/70 bg-zinc-200/45 p-2 shadow-[0_18px_44px_rgba(15,23,42,0.14)] ring-1 ring-zinc-500/10 backdrop-blur-xl">
            <div className="grid min-h-[330px] overflow-hidden rounded-[28px] border border-black/[0.04] bg-white p-5 text-left text-[#111] sm:grid-cols-[0.36fr_1fr]">
              <aside className="hidden border-r border-black/[0.055] pr-5 sm:block">
                <p className="font-heading text-2xl font-semibold">Ask Gina</p>
                <div className="mt-6 space-y-2 text-xs text-black/55">
                  <p className="rounded-xl bg-black/[0.045] px-3 py-2 font-semibold text-black/80">
                    Leaderboard
                  </p>
                  <p className="px-3 py-2">Models</p>
                  <p className="px-3 py-2">Tasks</p>
                  <p className="px-3 py-2">Methodology</p>
                </div>
              </aside>
              <main className="sm:pl-6">
                <div className="flex items-end justify-between border-b border-black/[0.055] pb-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-black/42">
                      Overall pass rate
                    </p>
                    <p className="mt-1 text-4xl font-semibold tracking-tight">78%</p>
                  </div>
                  <Badge className="bg-emerald-50 text-emerald-700">Published</Badge>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    ["Portfolio", "82%"],
                    ["Spot", "80%"],
                    ["Perps", "77%"],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-[18px] border border-black/[0.055] bg-white/88 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.045)]"
                    >
                      <p className="text-xs text-black/48">{label}</p>
                      <p className="mt-2 text-xl font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
              </main>
            </div>
          </div>
        </div>
      </section>
    </div>
  ),
};

export const Components: Story = {
  render: () => (
    <div className="mx-auto grid w-full max-w-5xl gap-8">
      <section className="rounded-card border bg-background p-6 shadow-card">
        <h2 className="text-lg font-semibold">Buttons and status</h2>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button>Primary action</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Methodology</Button>
        </div>
        <Separator className="my-6" />
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Selected</Badge>
          <Badge variant="secondary">Read only</Badge>
          <Badge variant="outline">Unverified</Badge>
          <Badge variant="destructive">Failed</Badge>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-green-3 text-green-11">
              <ShieldCheck aria-hidden="true" className="size-5" />
            </div>
            <CardTitle>Result provenance</CardTitle>
            <CardDescription>
              Every score points back to a runner, fixture, and revision.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-xs text-muted-foreground">
              revision ff071569 · dataset v0.3
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="secondary" size="sm">
              Inspect receipt <ArrowUpRight aria-hidden="true" />
            </Button>
          </CardFooter>
        </Card>

        <div className="rounded-card border bg-background p-6 shadow-card">
          <Tabs defaultValue="summary">
            <TabsList className="w-full justify-start rounded-md">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="failures">Failures</TabsTrigger>
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
            </TabsList>
            <TabsContent value="summary" className="pt-5">
              <p className="text-sm leading-6 text-muted-foreground">
                78% of tasks passed. The strongest family was Portfolio at 82%.
              </p>
            </TabsContent>
            <TabsContent value="failures" className="pt-5">
              <p className="text-sm leading-6 text-muted-foreground">
                Failure clusters stay visible rather than being folded into one aggregate.
              </p>
            </TabsContent>
            <TabsContent value="evidence" className="pt-5">
              <p className="font-mono text-xs text-muted-foreground">
                suite/portfolio/read-balances.yaml
              </p>
            </TabsContent>
          </Tabs>
        </div>
      </section>
    </div>
  ),
};

export const FormAndDialog: Story = {
  render: () => (
    <div className="mx-auto grid w-full max-w-4xl gap-6 md:grid-cols-2">
      <Card className="bg-background">
        <CardHeader>
          <CardTitle className="text-xl">Filter evaluation runs</CardTitle>
          <CardDescription>Use explicit labels and compact, predictable controls.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="run-search">Model or run id</Label>
            <Input id="run-search" placeholder="Search published runs" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="family-select">Task family</Label>
            <Select defaultValue="portfolio">
              <SelectTrigger id="family-select">
                <SelectValue placeholder="Choose a family" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="portfolio">Portfolio</SelectItem>
                <SelectItem value="spot">Spot</SelectItem>
                <SelectItem value="perps">Perps</SelectItem>
                <SelectItem value="predictions">Predictions</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full">Apply filters</Button>
        </CardContent>
      </Card>

      <Card className="bg-background">
        <CardHeader>
          <CardTitle className="text-xl">Confirmation boundary</CardTitle>
          <CardDescription>Dialogs name the action and preserve the consequence.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border bg-muted/45 p-4">
            <div className="flex items-start gap-3">
              <Activity aria-hidden="true" className="mt-0.5 size-5 text-primary" />
              <div>
                <p className="text-sm font-semibold">Replay 1,024 fixtures</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  This local replay does not call model providers.
                </p>
              </div>
            </div>
          </div>
          <DialogRoot>
            <DialogTrigger asChild>
              <Button className="mt-5">Review replay</Button>
            </DialogTrigger>
            <DialogContent className="gap-6 p-6">
              <DialogHeader>
                <DialogTitle>Replay published fixtures?</DialogTitle>
                <DialogDescription>
                  The runner will use checked-in fixtures and write results to the configured output
                  directory.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-4 text-sm">
                <CheckCircle2 aria-hidden="true" className="size-5 text-success" />
                No provider credentials are required.
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button>Start replay</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </DialogRoot>
        </CardContent>
      </Card>
    </div>
  ),
};

export const DataTable: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-card border bg-background shadow-card">
      <div className="flex flex-wrap items-end justify-between gap-4 p-6">
        <div>
          <h2 className="text-xl font-semibold">Published model results</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Aggregate scores remain paired with uncertainty and task coverage.
          </p>
        </div>
        <Badge variant="secondary">Dataset v0.3</Badge>
      </div>
      <Separator />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead>Pass rate</TableHead>
            <TableHead>Accuracy</TableHead>
            <TableHead className="text-right">Median latency</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[
            ["Kimi K3", "78% ±3", "83%", "4.2s"],
            ["Claude 4", "72% ±4", "79%", "6.8s"],
            ["GPT-5", "68% ±4", "76%", "5.1s"],
            ["Gemini 2.5", "61% ±5", "69%", "4.8s"],
          ].map(([model, passRate, accuracy, latency]) => (
            <TableRow key={model}>
              <TableCell className="font-semibold">{model}</TableCell>
              <TableCell className="font-mono">{passRate}</TableCell>
              <TableCell className="font-mono">{accuracy}</TableCell>
              <TableCell className="text-right font-mono">{latency}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};

function ThemeSurface({ theme }: { readonly theme: "light" | "dark" }) {
  const isDark = theme === "dark";

  return (
    <section className={isDark ? "dark" : ""}>
      <div className="h-full rounded-card border bg-background p-6 text-foreground shadow-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {theme} theme
            </p>
            <h2 className="mt-2 text-xl font-semibold">Canonical result</h2>
          </div>
          <Badge variant="secondary">Ready</Badge>
        </div>
        <Separator className="my-6" />
        <p className="text-sm leading-6 text-muted-foreground">
          The same semantic tokens preserve hierarchy, state, and control contrast in both themes.
        </p>
        <div className="mt-6 flex gap-3">
          <Button size="sm">Open result</Button>
          <Button size="sm" variant="secondary">
            Details
          </Button>
        </div>
      </div>
    </section>
  );
}

export const LightAndDark: Story = {
  render: () => (
    <div className="mx-auto grid w-full max-w-5xl gap-6 md:grid-cols-2">
      <ThemeSurface theme="light" />
      <ThemeSurface theme="dark" />
    </div>
  ),
};
