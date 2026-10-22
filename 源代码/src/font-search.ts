export type SearchableFont = { family: string; style: string };
const normalizeSearch = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/[·•]/g, ' ').replace(/\s+/g, ' ').trim();

/** Case-insensitive partial family/style search, retaining original order and objects. */
export function filterFonts<T extends SearchableFont>(fonts: readonly T[], query: string): T[] {
  const terms = normalizeSearch(query).split(' ').filter(Boolean);
  if (!terms.length) return [...fonts];
  return fonts.filter(font => {
    const label = normalizeSearch(`${font.family} ${font.style}`);
    return terms.every(term => label.includes(term));
  });
}
