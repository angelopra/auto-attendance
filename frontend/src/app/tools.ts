export const uniqBy = <T>(arr: T[], predicate: (keyof T) | ((o: T, i: number) => unknown)): T[] => {
  const cb = typeof predicate === 'function' ? predicate : (o: T) => o[predicate];

  return [...arr.reduce((map, item, i) => {
    const key = (item === null || item === undefined) ?
      item : cb(item, i);

    map.has(key) || map.set(key, item);

    return map;
  }, new Map()).values()];
};

export const groupBy = <T>(arr: T[], predicate: (keyof T) | ((o: T, i: number) => string | number)) => {
  return arr.reduce((acc, item, i) => {
    const cb = typeof predicate === 'function' ? predicate : (o: T) => String(o[predicate]);
    const key = cb(item, i);

    if (!acc[key]) {
      acc[key] = [];
    }

    acc[key].push(item);
    return acc;
  }, {} as Record<string, T[] | undefined>);
};

/** Hand a downloaded file to the browser to save. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // The browser reads the blob after click() returns; revoking right away leaves an empty download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Converts a string into a normalized, searchable format.
 */
export function toSearchableText(str: string): string {
  return str
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/ +/, ' ')
    .trim();
}

/**
 * Performs a flexible, case-insensitive, normalized search of a term within a source string.
 *
 * Example:
 * - Source: "São Paulo - SP x Rio de Janeiro - RJ"
 * - Search: "sao paulo rj"
 * - Result: true (because all terms in the search string are found in the normalized source string)
 *
 * @param source The text to search within (e.g., a full sentence or phrase).
 * @param search The search term or phrase to look for in the source.
 * @returns `true` if all terms in the search string are found in the source, otherwise `false`.
 */
export function searchMatch(source: string, search: string): boolean {
  source = toSearchableText(source);
  search = toSearchableText(search);
  const searchTerms = search.split(' ').filter((x) => x);
  return searchTerms.every((term) => source.includes(term));
}

/** Read a value saved in localStorage, falling back when absent, invalid or blocked. */
export function readStored<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Save a value in localStorage; private mode or blocked storage just won't remember it. */
export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do: the choice just won't survive a reload.
  }
}
