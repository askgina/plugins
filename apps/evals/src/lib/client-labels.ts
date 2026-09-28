export function clientDisplayName(target: string): string {
  return (
    {
      omp_harness: "Native client",
      muse_cli: "Muse",
      devin_cli: "Devin",
      claude_cli: "Claude Code",
    }[target] ?? target
  );
}

export function settingDisplayName(reasoning: string | null, target: string): string {
  return `${reasoning ?? "Unspecified"} reasoning${target === "omp_harness" ? "" : ` · ${clientDisplayName(target)}`}`;
}
