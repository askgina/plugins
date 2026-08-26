import { Effect, Function, Stream } from "effect";

const UTF8_DECODER = new TextDecoder();

export interface BoundedUtf8Output {
  readonly text: string;
  readonly byteLength: number;
  readonly truncated: boolean;
}

interface BoundedOutputAccumulator {
  readonly chunks: Uint8Array[];
  byteLength: number;
  truncated: boolean;
}

export const collectBoundedUtf8Output = Function.dual<
  (
    maximumBytes: number,
  ) => <Error>(stream: Stream.Stream<Uint8Array, Error>) => Effect.Effect<BoundedUtf8Output, Error>,
  <Error>(
    stream: Stream.Stream<Uint8Array, Error>,
    maximumBytes: number,
  ) => Effect.Effect<BoundedUtf8Output, Error>
>(2, <Error>(stream: Stream.Stream<Uint8Array, Error>, maximumBytes: number) => {
  const limit = Math.max(0, Math.trunc(maximumBytes));
  return stream.pipe(
    Stream.runFold(
      (): BoundedOutputAccumulator => ({ chunks: [], byteLength: 0, truncated: false }),
      (output, chunk) => {
        const remaining = limit - output.byteLength;
        if (remaining <= 0) {
          if (chunk.byteLength > 0) output.truncated = true;
          return output;
        }
        if (chunk.byteLength <= remaining) {
          output.chunks.push(chunk);
          output.byteLength += chunk.byteLength;
          return output;
        }
        output.chunks.push(chunk.slice(0, remaining));
        output.byteLength += remaining;
        output.truncated = true;
        return output;
      },
    ),
    Effect.map((output) => {
      const bytes = new Uint8Array(output.byteLength);
      let offset = 0;
      for (const chunk of output.chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return {
        text: UTF8_DECODER.decode(bytes),
        byteLength: output.byteLength,
        truncated: output.truncated,
      } satisfies BoundedUtf8Output;
    }),
  );
});
