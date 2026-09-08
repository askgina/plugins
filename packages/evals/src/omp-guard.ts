import { SKILL_NAMES, type SkillName } from "@askgina/contracts";

import { isUnknownRecord } from "./type-guards";

export const OMP_HARNESS_PROFILE = "omp-18.1.14-acp-v1" as const;

const MAX_TOOL_NAMES = 128;
const MAX_TOOL_NAME_LENGTH = 64;
const MAX_READ_PATHS = 64;
const MAX_PATH_LENGTH = 4_096;
const MAX_BLOCKED_ACTIONS = 256;
const MAX_NATIVE_CALL_ID_LENGTH = 256;
const TOOL_NAME = /^[A-Za-z0-9_.-]+$/u;
const SKILL_URI = /^skill:\/\/([a-z0-9-]+)$/u;
const ASK_GINA_SKILL_NAMES: Readonly<Record<SkillName, true>> = {
  "review-gina-account": true,
  "research-spot-tokens": true,
  "research-hyperliquid": true,
  "research-prediction-markets": true,
};
const TOP_LEVEL_KEYS: Readonly<Record<string, true>> = {
  version: true,
  profile: true,
  phase: true,
  expectedTools: true,
  activeTools: true,
  inventoryExact: true,
  activatedSkills: true,
  blockedActions: true,
  nativeCalls: true,
  terminal: true,
};
const NATIVE_CALL_KEYS: Readonly<Record<string, true>> = {
  id: true,
  name: true,
};
const TERMINAL_KEYS: Readonly<Record<string, true>> = {
  stopReason: true,
  isError: true,
  usage: true,
};
const USAGE_KEYS: Readonly<Record<string, true>> = {
  inputTokens: true,
  outputTokens: true,
  totalTokens: true,
};

export type OmpGuardPhase = "loaded" | "ready" | "terminal";
export type OmpGuardStopReason = "stop" | "length" | "toolUse" | "aborted" | "error";

export interface OmpGuardUsageEvidence {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface OmpGuardTerminalEvidence {
  readonly stopReason: OmpGuardStopReason;
  readonly isError: boolean;
  readonly usage?: OmpGuardUsageEvidence;
}

export interface OmpGuardNativeCallEvidence {
  readonly id: string;
  readonly name: string;
}

export interface OmpGuardEvidence {
  readonly version: 1;
  readonly profile: typeof OMP_HARNESS_PROFILE;
  readonly phase: OmpGuardPhase;
  readonly expectedTools: readonly string[];
  readonly activeTools: readonly string[];
  readonly inventoryExact: boolean;
  readonly activatedSkills: readonly SkillName[];
  readonly blockedActions: number;
  readonly nativeCalls: readonly OmpGuardNativeCallEvidence[];
  readonly terminal?: OmpGuardTerminalEvidence;
}

export interface OmpGuardExtensionSourceOptions {
  readonly expectedTools: readonly string[];
  readonly allowedSkillUris: readonly string[];
  readonly evidencePath: string;
  readonly allowedReadPaths?: readonly string[];
}

const hasOnlyKeys = (
  value: Readonly<Record<string, unknown>>,
  allowed: Readonly<Record<string, true>>,
): boolean => Object.keys(value).every((key) => allowed[key] === true);

const decodeBoundedStrings = (
  value: unknown,
  maximumCount: number,
  maximumLength: number,
  allowEmpty: boolean,
): readonly string[] | undefined => {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maximumCount) {
    return undefined;
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.length > maximumLength ||
      entry.trim() !== entry ||
      seen.has(entry)
    ) {
      return undefined;
    }
    seen.add(entry);
    names.push(entry);
  }
  return names;
};

const decodeNativeCalls = (value: unknown): readonly OmpGuardNativeCallEvidence[] | undefined => {
  if (!Array.isArray(value) || value.length > MAX_BLOCKED_ACTIONS) return undefined;
  const calls: OmpGuardNativeCallEvidence[] = [];
  const seenIds = new Set<string>();
  for (const entry of value) {
    if (!isUnknownRecord(entry) || !hasOnlyKeys(entry, NATIVE_CALL_KEYS)) return undefined;
    const { id, name } = entry;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > MAX_NATIVE_CALL_ID_LENGTH ||
      seenIds.has(id) ||
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > MAX_TOOL_NAME_LENGTH
    ) {
      return undefined;
    }
    seenIds.add(id);
    calls.push({ id, name });
  }
  return calls;
};

const isExpectedToolInventory = (names: readonly string[]): boolean =>
  names.includes("read") && names.every((name) => TOOL_NAME.test(name));

const inventoriesMatch = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const rightNames = new Set(right);
  return left.every((name) => rightNames.has(name));
};

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const decodeUsage = (value: unknown): OmpGuardUsageEvidence | undefined => {
  if (!isUnknownRecord(value) || !hasOnlyKeys(value, USAGE_KEYS)) return undefined;
  const { inputTokens, outputTokens, totalTokens } = value;
  if (
    !isNonNegativeSafeInteger(inputTokens) ||
    !isNonNegativeSafeInteger(outputTokens) ||
    !isNonNegativeSafeInteger(totalTokens)
  ) {
    return undefined;
  }
  const conversationTokens = inputTokens + outputTokens;
  if (!Number.isSafeInteger(conversationTokens) || totalTokens < conversationTokens) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens };
};

const decodeTerminal = (value: unknown): OmpGuardTerminalEvidence | undefined => {
  if (!isUnknownRecord(value) || !hasOnlyKeys(value, TERMINAL_KEYS)) return undefined;
  const { stopReason, isError } = value;
  if (
    stopReason !== "stop" &&
    stopReason !== "length" &&
    stopReason !== "toolUse" &&
    stopReason !== "aborted" &&
    stopReason !== "error"
  ) {
    return undefined;
  }
  if (typeof isError !== "boolean") return undefined;
  if (isError !== (stopReason === "aborted" || stopReason === "error")) return undefined;
  if (Object.hasOwn(value, "usage")) {
    const usage = decodeUsage(value.usage);
    if (usage === undefined) return undefined;
    return { stopReason, isError, usage };
  }
  return { stopReason, isError };
};

export const decodeOmpGuardEvidence = (value: unknown): OmpGuardEvidence | undefined => {
  if (!isUnknownRecord(value) || !hasOnlyKeys(value, TOP_LEVEL_KEYS)) return undefined;
  if (value.version !== 1 || value.profile !== OMP_HARNESS_PROFILE) return undefined;
  if (value.phase !== "loaded" && value.phase !== "ready" && value.phase !== "terminal") {
    return undefined;
  }
  const expectedTools = decodeBoundedStrings(
    value.expectedTools,
    MAX_TOOL_NAMES,
    MAX_TOOL_NAME_LENGTH,
    false,
  );
  const activeTools = decodeBoundedStrings(
    value.activeTools,
    MAX_TOOL_NAMES,
    MAX_TOOL_NAME_LENGTH,
    true,
  );
  if (
    expectedTools === undefined ||
    activeTools === undefined ||
    !isExpectedToolInventory(expectedTools) ||
    typeof value.inventoryExact !== "boolean" ||
    value.inventoryExact !== inventoriesMatch(expectedTools, activeTools)
  ) {
    return undefined;
  }
  const activated = decodeBoundedStrings(value.activatedSkills, SKILL_NAMES.length, 128, true);
  const nativeCalls = decodeNativeCalls(value.nativeCalls);
  if (
    activated === undefined ||
    activated.some((name) => ASK_GINA_SKILL_NAMES[name as SkillName] !== true) ||
    !isNonNegativeSafeInteger(value.blockedActions) ||
    value.blockedActions > MAX_BLOCKED_ACTIONS ||
    nativeCalls === undefined
  ) {
    return undefined;
  }
  const activatedSkills = activated as readonly SkillName[];
  const hasTerminal = Object.hasOwn(value, "terminal");

  if (value.phase === "loaded") {
    if (
      hasTerminal ||
      value.inventoryExact ||
      activeTools.length !== 0 ||
      activatedSkills.length !== 0 ||
      value.blockedActions !== 0 ||
      nativeCalls.length !== 0
    ) {
      return undefined;
    }
    return {
      version: 1,
      profile: OMP_HARNESS_PROFILE,
      phase: "loaded",
      expectedTools,
      activeTools,
      inventoryExact: false,
      activatedSkills,
      blockedActions: 0,
      nativeCalls,
    };
  }

  if (value.phase === "ready") {
    if (hasTerminal || !value.inventoryExact || nativeCalls.length !== 0) return undefined;
    return {
      version: 1,
      profile: OMP_HARNESS_PROFILE,
      phase: "ready",
      expectedTools,
      activeTools,
      inventoryExact: true,
      activatedSkills,
      blockedActions: value.blockedActions,
      nativeCalls,
    };
  }

  if (!hasTerminal) return undefined;
  const terminal = decodeTerminal(value.terminal);
  if (terminal === undefined) return undefined;
  if (
    !value.inventoryExact &&
    (terminal.stopReason !== "error" || !terminal.isError || terminal.usage !== undefined)
  ) {
    return undefined;
  }
  return {
    version: 1,
    profile: OMP_HARNESS_PROFILE,
    phase: "terminal",
    expectedTools,
    activeTools,
    inventoryExact: value.inventoryExact,
    activatedSkills,
    blockedActions: value.blockedActions,
    nativeCalls,
    terminal,
  };
};

const requireBoundedStrings = (
  value: readonly string[],
  maximumCount: number,
  maximumLength: number,
  allowEmpty: boolean,
): readonly string[] => {
  const decoded = decodeBoundedStrings(value, maximumCount, maximumLength, allowEmpty);
  if (decoded === undefined) throw new Error("Invalid OMP guard configuration");
  return decoded;
};

export const makeOmpGuardedAcpLauncherSource = (expectedTools: readonly string[]): string => {
  const tools = requireBoundedStrings(expectedTools, MAX_TOOL_NAMES, MAX_TOOL_NAME_LENGTH, false);
  if (!isExpectedToolInventory(tools)) {
    throw new Error("Invalid OMP guard configuration");
  }

  return `#!/usr/local/bin/node
import { spawn } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";

const NATIVE_EXECUTABLE = "/opt/omp-eval/omp";
const EVIDENCE_PATH = "/eval/omp-eval-evidence.json";
const PROFILE = ${JSON.stringify(OMP_HARNESS_PROFILE)};
const EXPECTED_TOOLS = ${JSON.stringify(tools)};
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 65_536;
const FAILURE_EXIT_CODE = 86;
const SIGNAL_EXIT_CODES = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
let failed = false;
let settled = false;
let admitted = false;
let child;
let forceTimer;

function failClosed() {
  if (failed) return;
  failed = true;
  try { process.stderr.write("OMP evaluation launcher failed\\n"); } catch {}
  try { process.stdin.pause(); } catch {}
  if (child === undefined) {
    process.exit(FAILURE_EXIT_CODE);
    return;
  }
  try { child.stdin.end(); } catch {}
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill("SIGTERM"); } catch {}
    forceTimer = setTimeout(() => {
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      } catch {}
    }, 750);
  }
}

function exitFromChild(code, signal) {
  if (forceTimer !== undefined) clearTimeout(forceTimer);
  for (const name of FORWARDED_SIGNALS) process.removeAllListeners(name);
  if (failed) process.exit(FAILURE_EXIT_CODE);
  if (signal !== null) process.exit(SIGNAL_EXIT_CODES[signal] ?? FAILURE_EXIT_CODE);
  process.exit(code ?? FAILURE_EXIT_CODE);
}

function guardLoaded() {
  try {
    const bytes = readFileSync(EVIDENCE_PATH);
    if (bytes.length > MAX_EVIDENCE_BYTES) return false;
    const value = JSON.parse(bytes.toString("utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) &&
      value.version === 1 &&
      value.profile === PROFILE &&
      value.phase === "loaded" &&
      value.inventoryExact === false &&
      value.blockedActions === 0 &&
      Array.isArray(value.activeTools) && value.activeTools.length === 0 &&
      Array.isArray(value.activatedSkills) && value.activatedSkills.length === 0 &&
      Array.isArray(value.nativeCalls) && value.nativeCalls.length === 0 &&
      !Object.hasOwn(value, "terminal") &&
      Array.isArray(value.expectedTools) &&
      value.expectedTools.length === EXPECTED_TOOLS.length &&
      EXPECTED_TOOLS.every((name, index) => value.expectedTools[index] === name);
  } catch {
    return false;
  }
}

function parseFrame(frame) {
  let end = frame.length;
  if (end > 0 && frame[end - 1] === 0x0a) end -= 1;
  if (end > 0 && frame[end - 1] === 0x0d) end -= 1;
  const value = JSON.parse(frame.toString("utf8", 0, end));
  if (value === null || typeof value !== "object" || Array.isArray(value) || value.jsonrpc !== "2.0") {
    throw new Error("malformed");
  }
  const response = Object.hasOwn(value, "id") &&
    (Object.hasOwn(value, "result") !== Object.hasOwn(value, "error"));
  if (typeof value.method !== "string" && !response) throw new Error("malformed");
  return value;
}

function writeFrame(frame) {
  if (child.stdin.write(frame)) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers();
  const onDrain = () => {
    child.stdin.off("error", onError);
    resolve();
  };
  const onError = (error) => {
    child.stdin.off("drain", onDrain);
    reject(error);
  };
  child.stdin.once("drain", onDrain);
  child.stdin.once("error", onError);
  return promise;
}

async function admitFrame(frame) {
  const value = parseFrame(frame);
  if (value.method !== "session/prompt") return;
  if (!guardLoaded()) throw new Error("guard");
  admitted = true;
}

async function forwardInput() {
  let fragments = [];
  let fragmentBytes = 0;
  for await (const chunk of process.stdin) {
    if (admitted) {
      await writeFrame(chunk);
      continue;
    }
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(0x0a, start);
      if (newline === -1) break;
      const segment = chunk.subarray(start, newline + 1);
      const frameBytes = fragmentBytes + segment.length;
      if (frameBytes > MAX_LINE_BYTES) throw new Error("rejected");
      const frame = fragments.length === 0 ? segment : Buffer.concat([...fragments, segment], frameBytes);
      fragments = [];
      fragmentBytes = 0;
      await admitFrame(frame);
      await writeFrame(frame);
      start = newline + 1;
      if (admitted) {
        if (start < chunk.length) await writeFrame(chunk.subarray(start));
        break;
      }
    }
    if (!admitted && start < chunk.length) {
      const fragment = chunk.subarray(start);
      fragmentBytes += fragment.length;
      if (fragmentBytes > MAX_LINE_BYTES) throw new Error("rejected");
      fragments.push(fragment);
    }
  }
  if (fragmentBytes > 0) throw new Error("rejected");
  child.stdin.end();
}

try {
  unlinkSync(EVIDENCE_PATH);
} catch (error) {
  if (error === null || typeof error !== "object" || error.code !== "ENOENT") failClosed();
}

if (!failed) {
  child = spawn(NATIVE_EXECUTABLE, process.argv.slice(2), {
    detached: false,
    env: process.env,
    stdio: ["pipe", "inherit", "inherit"],
  });
  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, () => {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill(signal); } catch {}
        if (forceTimer === undefined) {
          forceTimer = setTimeout(() => {
            try {
              if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
            } catch {}
          }, 750);
        }
      }
    });
  }
  child.stdin.on("error", failClosed);
  child.on("error", failClosed);
  child.on("close", (code, signal) => {
    if (settled) return;
    settled = true;
    exitFromChild(code, signal);
  });
  process.stdin.on("error", failClosed);
  forwardInput().catch(failClosed);
}
`;
};

export const makeOmpGuardExtensionSource = (options: OmpGuardExtensionSourceOptions): string => {
  const expectedTools = requireBoundedStrings(
    options.expectedTools,
    MAX_TOOL_NAMES,
    MAX_TOOL_NAME_LENGTH,
    false,
  );
  const allowedSkillUris = requireBoundedStrings(
    options.allowedSkillUris,
    SKILL_NAMES.length,
    MAX_PATH_LENGTH,
    false,
  );
  const allowedReadPaths = requireBoundedStrings(
    options.allowedReadPaths ?? [],
    MAX_READ_PATHS,
    MAX_PATH_LENGTH,
    true,
  );
  if (
    !isExpectedToolInventory(expectedTools) ||
    typeof options.evidencePath !== "string" ||
    options.evidencePath.length === 0 ||
    options.evidencePath.length > MAX_PATH_LENGTH ||
    !options.evidencePath.startsWith("/") ||
    options.evidencePath.includes("\0") ||
    allowedSkillUris.length !== SKILL_NAMES.length ||
    allowedReadPaths.some(
      (path) => !path.startsWith("/") || path.includes("\0") || path === options.evidencePath,
    )
  ) {
    throw new Error("Invalid OMP guard configuration");
  }

  const uriSkills: Record<string, SkillName> = {};
  const remainingSkills: Record<string, true> = { ...ASK_GINA_SKILL_NAMES };
  for (const uri of allowedSkillUris) {
    const match = SKILL_URI.exec(uri);
    const skill = match?.[1];
    if (skill === undefined || remainingSkills[skill] !== true) {
      throw new Error("Invalid OMP guard configuration");
    }
    uriSkills[uri] = skill as SkillName;
    delete remainingSkills[skill];
  }
  if (Object.keys(remainingSkills).length !== 0) {
    throw new Error("Invalid OMP guard configuration");
  }

  const pathSkills: Record<string, SkillName> = {};
  for (const readPath of allowedReadPaths) {
    for (const skill of SKILL_NAMES) {
      if (readPath.endsWith(`/${skill}/SKILL.md`)) {
        pathSkills[readPath] = skill;
        break;
      }
    }
  }

  const configuration = JSON.stringify({
    expectedTools,
    allowedSkillUris,
    allowedReadPaths,
    uriSkills,
    pathSkills,
    evidencePath: options.evidencePath,
  });

  return `import { renameSync, unlinkSync, writeFileSync } from "node:fs";

const PROFILE = ${JSON.stringify(OMP_HARNESS_PROFILE)};
const CONFIG = ${configuration};
const MAX_ATTEMPTS = ${MAX_BLOCKED_ACTIONS};
const MAX_ID_LENGTH = ${MAX_NATIVE_CALL_ID_LENGTH};
const MAX_EVIDENCE_BYTES = 65_536;
const FAILURE_EXIT_CODE = 86;
const expectedSet = new Set(CONFIG.expectedTools);
const skillUris = new Map(Object.entries(CONFIG.uriSkills));
const readPaths = new Set(CONFIG.allowedReadPaths);
const pathSkills = new Map(Object.entries(CONFIG.pathSkills));
const attempts = new Map();
const state = {
  version: 1,
  profile: PROFILE,
  phase: "loaded",
  expectedTools: [...CONFIG.expectedTools],
  activeTools: [],
  inventoryExact: false,
  activatedSkills: [],
  blockedActions: 0,
  nativeCalls: [],
};
let admitted = false;
let stopping = false;
let assistantTurns = 0;
let usageAvailable = true;
let inputTokens = 0;
let outputTokens = 0;
let totalTokens = 0;

function rawPersist() {
  const temporaryPath = CONFIG.evidencePath + ".tmp";
  try {
    const encoded = JSON.stringify(state);
    if (Buffer.byteLength(encoded, "utf8") > MAX_EVIDENCE_BYTES) return false;
    writeFileSync(temporaryPath, encoded + "\\n", { encoding: "utf8", flag: "w", mode: 0o600 });
    renameSync(temporaryPath, CONFIG.evidencePath);
    return true;
  } catch {
    try { unlinkSync(temporaryPath); } catch {}
    return false;
  }
}

function stopNow() {
  if (!stopping) {
    stopping = true;
    admitted = false;
    state.phase = "terminal";
    state.terminal = { stopReason: "error", isError: true };
    state.nativeCalls = Array.from(attempts, ([id, attempt]) => ({ id, name: attempt.name }));
    rawPersist();
  }
  process.exit(FAILURE_EXIT_CODE);
  throw new Error("OMP evaluation guard stopped");
}

function persist() {
  if (!rawPersist()) stopNow();
}

function validNames(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > ${MAX_TOOL_NAMES}) return false;
  const seen = new Set();
  for (const name of value) {
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > ${MAX_TOOL_NAME_LENGTH} ||
      name.trim() !== name ||
      seen.has(name)
    ) return false;
    seen.add(name);
  }
  return true;
}

function sameInventory(left, right) {
  if (left.length !== right.length) return false;
  const names = new Set(right);
  return left.every((name) => names.has(name));
}

function checkInventory(pi) {
  admitted = false;
  const active = pi.getActiveTools();
  if (!validNames(active) || !active.includes("read")) stopNow();
  state.activeTools = [...active];
  state.inventoryExact = sameInventory(state.expectedTools, state.activeTools);
  if (!state.inventoryExact) stopNow();
  state.phase = "ready";
  delete state.terminal;
  persist();
  admitted = true;
}

function readPolicy(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { allowed: false, activation: null, key: "blocked" };
  }
  const target = input.path;
  if (typeof target !== "string") return { allowed: false, activation: null, key: "blocked" };
  const uriSkill = skillUris.get(target);
  if (uriSkill !== undefined) return { allowed: true, activation: uriSkill, key: "skill:" + target };
  if (!readPaths.has(target)) return { allowed: false, activation: null, key: "blocked" };
  const pathSkill = pathSkills.get(target) ?? null;
  return { allowed: true, activation: pathSkill, key: "path:" + target };
}

function policyFor(name, input) {
  if (!admitted || !state.inventoryExact || !expectedSet.has(name)) {
    return { allowed: false, activation: null, key: "blocked" };
  }
  return name === "read"
    ? readPolicy(input)
    : { allowed: true, activation: null, key: "tool:" + name };
}

function observeAttempt(id, name, input, source) {
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > MAX_ID_LENGTH ||
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > ${MAX_TOOL_NAME_LENGTH}
  ) stopNow();
  const policy = policyFor(name, input);
  const prior = attempts.get(id);
  if (prior !== undefined) {
    if (prior.name !== name || prior.key !== policy.key || prior[source]) stopNow();
    prior[source] = true;
    return prior;
  }
  if (attempts.size >= MAX_ATTEMPTS) stopNow();
  const observed = {
    name,
    allowed: policy.allowed,
    activation: policy.activation,
    key: policy.key,
    hook: source === "hook",
    message: source === "message",
    result: false,
  };
  attempts.set(id, observed);
  if (!observed.allowed) state.blockedActions += 1;
  return observed;
}

function consumeUsage(value) {
  assistantTurns += 1;
  if (assistantTurns > MAX_ATTEMPTS) stopNow();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    usageAvailable = false;
    return;
  }
  const input = value.input;
  const output = value.output;
  const total = value.totalTokens;
  if (
    !Number.isSafeInteger(input) || input < 0 ||
    !Number.isSafeInteger(output) || output < 0 ||
    !Number.isSafeInteger(total) || total < 0 ||
    !Number.isSafeInteger(input + output) || total < input + output
  ) {
    usageAvailable = false;
    return;
  }
  if (!usageAvailable) return;
  const nextInput = inputTokens + input;
  const nextOutput = outputTokens + output;
  const nextTotal = totalTokens + total;
  if (
    !Number.isSafeInteger(nextInput) ||
    !Number.isSafeInteger(nextOutput) ||
    !Number.isSafeInteger(nextTotal)
  ) {
    usageAvailable = false;
    return;
  }
  inputTokens = nextInput;
  outputTokens = nextOutput;
  totalTokens = nextTotal;
}

function scanAssistantMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) stopNow();
  consumeUsage(message.usage);
  if (!Array.isArray(message.content)) stopNow();
  for (const block of message.content) {
    if (!block || typeof block !== "object" || Array.isArray(block) || block.type !== "toolCall") continue;
    observeAttempt(block.id, block.name, block.arguments, "message");
  }
  persist();
}

export default function ompEvalGuard(pi) {
  try {
    pi.on("before_agent_start", async () => {
      try {
        // ACP starts MCP discovery with the first prompt.
        const readyBy = performance.now() + 5_000;
        while (true) {
          await pi.setActiveTools(CONFIG.expectedTools);
          const active = pi.getActiveTools();
          if (
            !validNames(active) || !active.includes("read") ||
            active.some((name) => !expectedSet.has(name))
          ) stopNow();
          if (active.length === CONFIG.expectedTools.length || performance.now() >= readyBy) break;
          const { promise, resolve } = Promise.withResolvers();
          setTimeout(resolve, 25);
          await promise;
        }
        checkInventory(pi);
      } catch { stopNow(); }
    });
    pi.on("before_provider_request", (event) => {
      try {
        if (!admitted) stopNow();
        checkInventory(pi);
        return event.payload;
      } catch { stopNow(); }
    });
    pi.on("tool_call", (event) => {
      try {
        const attempt = observeAttempt(event.toolCallId, event.toolName, event.input, "hook");
        persist();
        if (!attempt.allowed) return { block: true, reason: "Tool blocked by evaluation guard" };
      } catch { stopNow(); }
    });
    pi.on("message_end", (event) => {
      try {
        if (event.message && event.message.role === "assistant") scanAssistantMessage(event.message);
      } catch { stopNow(); }
    });
    pi.on("tool_result", (event) => {
      try {
        const attempt = attempts.has(event.toolCallId)
          ? attempts.get(event.toolCallId)
          : observeAttempt(event.toolCallId, event.toolName, event.input, "hook");
        if (
          attempt.name !== event.toolName ||
          attempt.result ||
          typeof event.isError !== "boolean"
        ) stopNow();
        attempt.result = true;
        if (
          !event.isError &&
          attempt.allowed &&
          attempt.activation !== null &&
          !state.activatedSkills.includes(attempt.activation)
        ) {
          state.activatedSkills.push(attempt.activation);
        }
        persist();
      } catch { stopNow(); }
    });
    pi.on("agent_end", (event) => {
      try {
        if (event.willContinue === true) {
          persist();
          return;
        }
        if (!Array.isArray(event.messages)) stopNow();
        let lastAssistant;
        for (let index = event.messages.length - 1; index >= 0; index -= 1) {
          const message = event.messages[index];
          if (message && typeof message === "object" && message.role === "assistant") {
            lastAssistant = message;
            break;
          }
        }
        const reason = lastAssistant && lastAssistant.stopReason;
        if (
          reason !== "stop" && reason !== "length" && reason !== "toolUse" &&
          reason !== "aborted" && reason !== "error"
        ) stopNow();
        const terminal = {
          stopReason: reason,
          isError: reason === "aborted" || reason === "error",
        };
        if (assistantTurns > 0 && usageAvailable) {
          terminal.usage = { inputTokens, outputTokens, totalTokens };
        }
        admitted = false;
        state.phase = "terminal";
        state.terminal = terminal;
        state.nativeCalls = Array.from(attempts, ([id, attempt]) => ({ id, name: attempt.name }));
        persist();
      } catch { stopNow(); }
    });
    persist();
  } catch {
    stopNow();
  }
}
`;
};
