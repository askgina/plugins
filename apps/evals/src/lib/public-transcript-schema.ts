import type { Conversation, ConversationReference } from "./conversations";

export const PUBLIC_TRANSCRIPT_CAMPAIGN = "reasoning-sweep-2026-09-16";
export const PUBLIC_RECOVERY_CAMPAIGN = "recovery-2026-09-21";
const supportedCampaign = (value: unknown) =>
  value === PUBLIC_TRANSCRIPT_CAMPAIGN || value === PUBLIC_RECOVERY_CAMPAIGN;
const digest = /^[a-f0-9]{64}$/u;
const identifier = /^[a-z0-9][a-z0-9-]{0,150}$/u;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const fields = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const hash = (value: unknown): value is string => typeof value === "string" && digest.test(value);
const id = (value: unknown): value is string => typeof value === "string" && identifier.test(value);
const redactions = (value: unknown): boolean =>
  record(value) &&
  Object.entries(value).every(
    ([key, n]) =>
      [
        "credential",
        "known_credential",
        "address",
        "personal_identifier",
        "local_path",
        "private_host",
        "private_account",
        "encoded_content",
      ].includes(key) && count(n),
  );

export interface PublicTranscriptEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}
export interface PublicTranscriptIndex {
  readonly schemaVersion: "ask-gina-public-conversations.v1";
  readonly campaignId: string;
  readonly sourceManifestSha256: string;
  readonly exporterSha256: string;
  readonly conversationCount: number;
  readonly files: readonly PublicTranscriptEntry[];
}
export interface PublicTranscript {
  readonly schemaVersion: "ask-gina-public-conversation.v1";
  readonly reference: ConversationReference;
  readonly conversation: Conversation;
}

export function publicTranscriptPath(reference: ConversationReference): string | undefined {
  if (
    !supportedCampaign(reference.campaignId) ||
    ![reference.rowId, reference.family, reference.caseId].every(id) ||
    !count(reference.repetition) ||
    reference.repetition === 0
  )
    return undefined;
  return `${reference.rowId}/${reference.family}/${reference.repetition}-${reference.caseId}.json`;
}

export function isPublicTranscriptIndex(value: unknown): value is PublicTranscriptIndex {
  if (
    !record(value) ||
    !fields(value, [
      "schemaVersion",
      "campaignId",
      "sourceManifestSha256",
      "exporterSha256",
      "conversationCount",
      "redactions",
      "files",
    ]) ||
    value.schemaVersion !== "ask-gina-public-conversations.v1" ||
    (value.campaignId !== "eval-campaigns-2026-09-21" &&
      value.campaignId !== PUBLIC_TRANSCRIPT_CAMPAIGN) ||
    !hash(value.sourceManifestSha256) ||
    !hash(value.exporterSha256) ||
    !redactions(value.redactions) ||
    !count(value.conversationCount) ||
    !Array.isArray(value.files) ||
    value.files.length !== value.conversationCount
  )
    return false;
  const paths = new Set<string>();
  return value.files.every((file: unknown) => {
    if (
      !record(file) ||
      !fields(file, ["path", "sha256", "bytes"]) ||
      typeof file.path !== "string" ||
      !/^[a-z0-9][a-z0-9-]*\/(?:spot|perps|predictions)\/[1-9][0-9]*-[a-z0-9][a-z0-9-]*\.json$/u.test(
        file.path,
      ) ||
      !hash(file.sha256) ||
      !count(file.bytes) ||
      file.bytes === 0 ||
      paths.has(file.path)
    )
      return false;
    paths.add(file.path);
    return true;
  });
}

export function isPublicTranscript(value: unknown): value is PublicTranscript {
  if (
    !record(value) ||
    !fields(value, ["schemaVersion", "reference", "conversation"]) ||
    value.schemaVersion !== "ask-gina-public-conversation.v1" ||
    !record(value.reference) ||
    !record(value.conversation)
  )
    return false;
  const r = value.reference;
  if (
    !fields(r, [
      "campaignId",
      "rowId",
      "family",
      "caseId",
      "repetition",
      "sourceSummarySha256",
      "sourceCommit",
      "catalogSha",
      "target",
    ]) ||
    !supportedCampaign(r.campaignId) ||
    !id(r.rowId) ||
    !id(r.caseId) ||
    typeof r.family !== "string" ||
    !["spot", "perps", "predictions"].includes(r.family) ||
    !count(r.repetition) ||
    r.repetition === 0 ||
    !hash(r.sourceSummarySha256) ||
    !hash(r.catalogSha) ||
    typeof r.sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(r.sourceCommit) ||
    typeof r.target !== "string" ||
    !id(r.target.replaceAll("_", "-"))
  )
    return false;
  const c = value.conversation;
  if (
    !fields(c, [
      "rowId",
      "family",
      "caseId",
      "repetition",
      "visibleEvidenceSource",
      "frozenUserTurns",
      "visibleMessages",
      "completeness",
      "gaps",
      "publication",
    ]) ||
    !["rowId", "family", "caseId", "repetition"].every((key) => c[key] === r[key]) ||
    typeof c.visibleEvidenceSource !== "string" ||
    !Array.isArray(c.frozenUserTurns) ||
    !Array.isArray(c.visibleMessages) ||
    !record(c.completeness) ||
    !Array.isArray(c.gaps) ||
    !record(c.publication)
  )
    return false;
  const flags = [
    "transcriptCaptureComplete",
    "modelObservedTruncation",
    "auxiliarySourceComplete",
    "finalAnswerPresent",
    "nativeVisibleEvidenceAvailable",
  ];
  const complete = c.completeness;
  if (
    !fields(complete, flags) ||
    !flags.every((key) => typeof complete[key] === "boolean") ||
    !fields(c.publication, ["kind", "sourceConversationSha256", "redactions"]) ||
    c.publication.kind !== "public_redacted" ||
    !hash(c.publication.sourceConversationSha256) ||
    !redactions(c.publication.redactions)
  )
    return false;
  return (
    c.frozenUserTurns.every(
      (turn: unknown) =>
        record(turn) &&
        fields(turn, ["role", "content"]) &&
        turn.role === "user" &&
        typeof turn.content === "string",
    ) &&
    c.gaps.every(
      (gap: unknown) =>
        record(gap) &&
        fields(gap, ["code", "scope"]) &&
        typeof gap.code === "string" &&
        typeof gap.scope === "string",
    ) &&
    c.visibleMessages.every(
      (message: unknown) =>
        record(message) &&
        fields(message, ["role", "sequence", "content"]) &&
        ["user", "assistant", "tool"].includes(String(message.role)) &&
        count(message.sequence) &&
        Array.isArray(message.content) &&
        message.content.every((block: unknown) => {
          if (!record(block)) return false;
          if (block.type === "text")
            return fields(block, ["type", "text"]) && typeof block.text === "string";
          if (block.type === "toolCall")
            return (
              fields(block, ["type", "name", "arguments", "id", "call_id"]) &&
              typeof block.name === "string" &&
              Object.hasOwn(block, "arguments") &&
              ["id", "call_id"].every(
                (key) => block[key] === undefined || typeof block[key] === "string",
              )
            );
          return (
            block.type === "toolResult" &&
            fields(block, ["type", "text", "toolCallId", "toolName", "isError"]) &&
            typeof block.text === "string" &&
            ["toolCallId", "toolName"].every(
              (key) => block[key] === undefined || typeof block[key] === "string",
            ) &&
            (block.isError === undefined || typeof block.isError === "boolean")
          );
        }),
    )
  );
}

export const matchesConversationReference = ({
  left,
  right,
}: {
  left: ConversationReference;
  right: ConversationReference;
}): boolean =>
  [
    "campaignId",
    "rowId",
    "family",
    "caseId",
    "repetition",
    "sourceSummarySha256",
    "sourceCommit",
    "catalogSha",
    "target",
  ].every(
    (key) => left[key as keyof ConversationReference] === right[key as keyof ConversationReference],
  );
