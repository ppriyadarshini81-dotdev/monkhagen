const SIZE_ORDER: Record<string, number> = {
  XXS: 0, XS: 1, S: 2, M: 3, L: 4, XL: 5,
  XXL: 6, '2XL': 6, XXXL: 7, '3XL': 7, '4XL': 8, '5XL': 9
};

export function sortSizes(sizes: readonly string[]): string[] {
  return [...sizes].sort((a, b) =>
    (SIZE_ORDER[a.trim().toUpperCase()] ?? 100) - (SIZE_ORDER[b.trim().toUpperCase()] ?? 100) ||
    a.localeCompare(b, undefined, { numeric: true })
  );
}
