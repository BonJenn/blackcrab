// Command palette types and search matching.
//
// Commands are matched against the query by title, optional synonyms
// (`keywords`), and `hint`, so a command is findable by natural words — e.g.
// "trash" finds Delete, "cost" finds the usage dashboard. Kept pure and
// separate from App.tsx so the matching is unit-testable.

export type PaletteCommand = {
  id: string;
  title: string;
  hint?: string;
  /** Synonyms/aliases that should also match this command in search. */
  keywords?: string[];
  run: () => void | Promise<void>;
};

/** Does `command` match the (raw) search query? Empty query matches everything.
 *  Case-insensitive substring match across title, keywords, and hint. */
export function commandMatchesQuery(
  command: Pick<PaletteCommand, "title" | "hint" | "keywords">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (command.title.toLowerCase().includes(q)) return true;
  if (command.hint && command.hint.toLowerCase().includes(q)) return true;
  return (command.keywords ?? []).some((k) => k.toLowerCase().includes(q));
}
