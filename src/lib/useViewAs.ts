import { useEffect, useState } from "react";
import { getViewAsState, setViewAsState, subscribeViewAs, type ViewAsState } from "./viewAs";

export function useViewAs(): ViewAsState | null {
  const [state, setState] = useState<ViewAsState | null>(getViewAsState());
  useEffect(() => subscribeViewAs(setState), []);
  return state;
}

// Re-exported so components don't need to reach into ./viewAs directly —
// mutating state through here keeps the sessionStorage mirror + listeners
// in sync in one place.
export { setViewAsState };
