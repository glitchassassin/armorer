export interface CanonicalSearchResult {
  id: number | string;
}

export function orderSearchResults<T extends CanonicalSearchResult>(results: T[]): T[] {
  return [...results].sort((left, right) => Number(left.id) - Number(right.id));
}
