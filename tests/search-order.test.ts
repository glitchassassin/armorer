import { describe, expect, it } from 'vitest';
import { orderSearchResults } from '../src/lib/search-order';

describe('orderSearchResults', () => {
  it('orders matches by their canonical verse document id without mutating the input', () => {
    const results = [
      { id: 31_102, title: 'Revelation 22:21' },
      { id: 1, title: 'Genesis 1:2' },
      { id: 26_137, title: 'John 3:16' }
    ];

    expect(orderSearchResults(results).map((result) => result.title)).toEqual([
      'Genesis 1:2',
      'John 3:16',
      'Revelation 22:21'
    ]);
    expect(results[0].title).toBe('Revelation 22:21');
  });
});
