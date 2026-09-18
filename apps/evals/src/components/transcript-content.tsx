import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function publicLink(url: string | undefined): string | undefined {
  return url && /^https?:\/\//iu.test(url) ? url : undefined;
}

const components: Components = {
  a: ({ href, children }) => {
    const url = publicLink(href);
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
  // Retained images remain inspectable links, without loading third-party content.
  img: ({ src, alt }) => {
    const url = publicLink(typeof src === "string" ? src : undefined);
    const label = `Image: ${alt || "recorded image"}`;
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    ) : (
      <span>{label}</span>
    );
  },
  table: ({ children }) => (
    <div className="conversation-table" role="region" aria-label="Message table" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
};

/** Indent JSON without reserializing its values (large numeric IDs stay exact). */
export function formatTranscriptJson(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const tokens = trimmed.match(/"(?:\\.|[^"\\])*"|[^\s"{}[\],:]+|[{}[\],:]/gu) ?? [];
  let depth = 0;
  let formatted = "";
  const newline = () => `\n${"  ".repeat(depth)}`;
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    if (token === "{" || token === "[") {
      formatted += token;
      depth += 1;
      if (tokens[index + 1] !== "}" && tokens[index + 1] !== "]") formatted += newline();
    } else if (token === "}" || token === "]") {
      depth -= 1;
      if (previous !== "{" && previous !== "[") formatted += newline();
      formatted += token;
    } else if (token === ",") formatted += `,${newline()}`;
    else if (token === ":") formatted += ": ";
    else formatted += token;
  });
  return formatted;
}

function JsonText({ text }: { text: string }) {
  const pieces = text.split(
    /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/gu,
  );
  return (
    <pre className="conversation-text conversation-code">
      <code>
        {pieces.map((piece, index) => {
          const kind = piece.startsWith('"')
            ? pieces[index + 1]?.trimStart().startsWith(":")
              ? "key"
              : "string"
            : /^(?:true|false|null|-?\d)/u.test(piece)
              ? "value"
              : undefined;
          return kind ? (
            <span key={index} data-token={kind}>
              {piece}
            </span>
          ) : (
            piece
          );
        })}
      </code>
    </pre>
  );
}

export const TranscriptContent = memo(function TranscriptContent({
  text,
  source = false,
  data = false,
}: {
  text: string;
  source?: boolean;
  data?: boolean;
}) {
  if (source) return <pre className="conversation-text conversation-code">{text}</pre>;
  const json = data ? formatTranscriptJson(text) : undefined;
  if (json !== undefined) return <JsonText text={json} />;
  return (
    <div className="conversation-markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
});
