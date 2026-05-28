export const uniqBy = <T>(arr: T[], predicate: (keyof T) | ((o: T, i: number) => unknown)) => {
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
