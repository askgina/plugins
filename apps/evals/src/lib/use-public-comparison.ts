import { useEffect, useState } from "react";
import { loadBundledPublicComparison } from "./bundled-public-comparison";
import type { PublicComparisonCatalog } from "./public-comparison";

export type PublicComparisonState =
  | { status: "loading"; catalog: null; message: null }
  | { status: "ready"; catalog: PublicComparisonCatalog; message: null }
  | { status: "error"; catalog: null; message: string };

export function usePublicComparisonCatalog(
  suppliedCatalog?: PublicComparisonCatalog,
): PublicComparisonState {
  const [state, setState] = useState<PublicComparisonState>(() =>
    suppliedCatalog === undefined
      ? { status: "loading", catalog: null, message: null }
      : { status: "ready", catalog: suppliedCatalog, message: null },
  );

  useEffect(() => {
    if (suppliedCatalog !== undefined) {
      setState({ status: "ready", catalog: suppliedCatalog, message: null });
      return;
    }
    let active = true;
    setState({ status: "loading", catalog: null, message: null });
    void loadBundledPublicComparison().then(
      (catalog) => {
        if (active) setState({ status: "ready", catalog, message: null });
      },
      (error: unknown) => {
        if (!active) return;
        setState({
          status: "error",
          catalog: null,
          message: error instanceof Error ? error.message : "Public results could not be loaded.",
        });
      },
    );
    return () => {
      active = false;
    };
  }, [suppliedCatalog]);

  return state;
}
