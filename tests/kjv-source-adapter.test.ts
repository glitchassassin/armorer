import { describe, expect, it } from 'vitest';
import {
  normalizeKjvSource,
  normalizeKjvText
} from '../scripts/source-adapters/kjv-node-module.mjs';

describe('KJV source adapter', () => {
  it('contains the KJV package markup and punctuation corrections', () => {
    expect(normalizeKjvText("# The LORD said [unto] their's and your's.")).toEqual({
      html: 'The <span class="small-caps">Lord</span> said <em>unto</em> theirs and yours.',
      text: 'The Lord said unto theirs and yours.'
    });
  });

  it('maps the KJV package reference keys into normalized verses', () => {
    const canon = {
      books: [{ id: 'song', title: 'Song of Solomon' }]
    };
    expect(normalizeKjvSource(
      { "Solomon's Song 1:2": 'Let him kiss me' },
      canon,
      { 'Song of Solomon': ["Solomon's Song"] }
    )).toEqual([{
      bookId: 'song',
      chapter: 1,
      number: 2,
      html: 'Let him kiss me',
      text: 'Let him kiss me'
    }]);
  });
});
