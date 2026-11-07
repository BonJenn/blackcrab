import { useCallback, useEffect, useRef, useState } from "react";
import { codexQuery, type CodexPage, type CodexQuery } from "./codexClient";
type PageQuery = Extract<CodexQuery, { page: unknown }>;
type State<T> = { key: string; data: T[]; nextCursor: string | null; loading: boolean; error: string | null };
export function useCodexPage<T>(query: PageQuery | null, identity: (value: T) => string) {
  const key = JSON.stringify(query);
  const [state, setState] = useState<State<T>>({ key: "", data: [], nextCursor: null, loading: false, error: null });
  const generation = useRef(0);
  const request = useRef(false);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const load = useCallback(async (value: PageQuery, currentKey: string, epoch: number, cursor: string | null, append: boolean) => {
    request.current = true;
    setState(previous => ({ ...(append ? previous : { key: currentKey, data: [], nextCursor: null }), loading: true, error: null }));
    try {
      const page = await codexQuery({ ...value, page: { ...value.page, cursor } }) as CodexPage<T>;
      if (epoch !== generation.current) return;
      setState(previous => {
        const rows = new Map((append ? previous.data : []).map(row => [identityRef.current(row), row]));
        page.data.forEach(row => rows.set(identityRef.current(row), row));
        return { key: currentKey, data: [...rows.values()], nextCursor: page.nextCursor, loading: false, error: null };
      });
    } catch (error) {
      if (epoch === generation.current) setState(previous => ({ ...previous, loading: false, error: String(error) }));
    } finally { if (epoch === generation.current) request.current = false; }
  }, []);
  useEffect(() => {
    const epoch = ++generation.current;
    request.current = false;
    const value = JSON.parse(key) as PageQuery | null;
    if (value) void load(value, key, epoch, null, false);
    else setState({ key, data: [], nextCursor: null, loading: false, error: null });
    return () => { ++generation.current; request.current = false; };
  }, [key, load]);
  const current = state.key === key ? state : { key, data: [], nextCursor: null, loading: query !== null, error: null };
  return { ...current,
    more: () => { if (query && current.nextCursor && !request.current) void load(query, key, generation.current, current.nextCursor, true); },
    refresh: () => { if (query && !request.current) void load(query, key, ++generation.current, null, false); },
  };
}
