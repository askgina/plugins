import { Data } from "effect";

export class AskGinaAuthError extends Data.TaggedError("AskGinaAuthError")<{
  readonly message: string;
}> {}

export class AskGinaToolError extends Data.TaggedError("AskGinaToolError")<{
  readonly message: string;
  readonly tool?: string;
}> {}

export class AskGinaTransportError extends Data.TaggedError("AskGinaTransportError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AskGinaJsonArgsError extends Data.TaggedError("AskGinaJsonArgsError")<{
  readonly message: string;
}> {
  constructor(args: { readonly message: string }) {
    super(args);
    Object.defineProperty(this, "message", {
      configurable: true,
      enumerable: true,
      value: args.message,
      writable: true,
    });
  }
}

export type AskGinaError =
  | AskGinaAuthError
  | AskGinaToolError
  | AskGinaTransportError
  | AskGinaJsonArgsError;
