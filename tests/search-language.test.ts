import { describe, expect, it } from 'vitest';
import { analyzeSearchText, ENGLISH_STOP_WORDS } from '../shared/search-language.js';

describe('published English search analysis', () => {
  const analyzer = { type: 'porter-en', stopWords: ENGLISH_STOP_WORDS };

  it('removes stop words and stems inflected terms', () => {
    expect(analyzeSearchText('is beginning', analyzer)).toBe('begin');
    expect(analyzeSearchText('begin began begun beginning', analyzer)).toBe('begin began begun begin');
  });

  it('retains the published tokenizer punctuation behavior', () => {
    expect(analyzeSearchText("Lord's song-of-songs", analyzer)).toBe("lord' song-of-song");
  });
});
