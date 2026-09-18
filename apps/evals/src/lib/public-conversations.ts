import type { ConversationReference, ConversationResponse } from "./conversations";
import {
  PUBLIC_TRANSCRIPTS_COUNT,
  PUBLIC_TRANSCRIPTS_INDEX_SHA256,
} from "./public-transcript-manifest";
import {
  isPublicTranscript,
  isPublicTranscriptIndex,
  matchesConversationReference,
  publicTranscriptPath,
  type PublicTranscriptIndex,
} from "./public-transcript-schema";

const root = `${import.meta.env.BASE_URL}transcripts/`;
let indexRequest: Promise<PublicTranscriptIndex> | undefined;

export function verifyPublicTranscriptBytes(
  bytes: ArrayBuffer,
  expected: string,
): Promise<unknown> {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) => {
    const actual = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (actual !== expected) throw new Error("Transcript integrity mismatch");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  });
}

function fetchBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  return window.fetch(url, { signal, credentials: "same-origin" }).then((response) => {
    if (!response.ok) throw new Error("Transcript request failed");
    return response.arrayBuffer();
  });
}

function loadIndex(): Promise<PublicTranscriptIndex> {
  indexRequest ??= fetchBytes(`${root}index.json?v=${PUBLIC_TRANSCRIPTS_INDEX_SHA256}`)
    .then((bytes) => verifyPublicTranscriptBytes(bytes, PUBLIC_TRANSCRIPTS_INDEX_SHA256))
    .then((index) => {
      if (!isPublicTranscriptIndex(index) || index.conversationCount !== PUBLIC_TRANSCRIPTS_COUNT)
        throw new Error("Invalid public transcript index");
      return index;
    })
    .catch((error: unknown) => {
      indexRequest = undefined;
      throw error;
    });
  return indexRequest;
}

export function loadPublicConversation(
  reference: ConversationReference,
  signal: AbortSignal,
): Promise<ConversationResponse> {
  const path = publicTranscriptPath(reference);
  if (path === undefined) return Promise.resolve({ status: "unavailable", reason: "not_found" });
  return loadIndex().then((index) => {
    const entry = index.files.find((file) => file.path === path);
    if (entry === undefined) return { status: "unavailable", reason: "not_found" } as const;
    return fetchBytes(`${root}${path}?v=${entry.sha256}`, signal)
      .then((bytes) => {
        if (bytes.byteLength !== entry.bytes) throw new Error("Transcript length mismatch");
        return verifyPublicTranscriptBytes(bytes, entry.sha256);
      })
      .then((document): ConversationResponse => {
        if (
          !isPublicTranscript(document) ||
          !matchesConversationReference({ left: document.reference, right: reference })
        )
          return { status: "unavailable", reason: "mismatch" };
        return { status: "available", conversation: document.conversation, sha256: entry.sha256 };
      });
  });
}
