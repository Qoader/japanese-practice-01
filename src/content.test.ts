import { describe, expect, it } from 'vitest';
import {
  chooseCard,
  normalizeReading,
  scheduleRetry,
  validateDataset,
  segmentsFromAuthorWords,
  validateAuthorWords,
  reviseSentence,
} from './content';

describe('content rules', () => {
  it('normalizes katakana readings and whitespace', () =>
    expect(normalizeReading(' ベン キョウ ')).toBe('べんきょう'));
  it('chooses a card from weighted candidates', () => {
    const cards = [{ id: 'a' }, { id: 'b' }];
    expect(chooseCard(cards, {}, [], () => 0)?.id).toBe('a');
  });
  it('schedules retries 3 to 6 positions later with injectable randomness', () => {
    expect(scheduleRetry([], 4, 10, () => 0)).toEqual([
      { cardIndex: 4, dueAt: 13 },
    ]);
    expect(scheduleRetry([], 4, 10, () => 0.999999)).toEqual([
      { cardIndex: 4, dueAt: 16 },
    ]);
  });
  it('does not move an already scheduled card when it is missed again', () => {
    const scheduled = [{ cardIndex: 4, dueAt: 13 }];
    expect(scheduleRetry(scheduled, 4, 20, () => 0)).toBe(scheduled);
  });
  it('validates and reconstructs grapheme-indexed selected words', () => {
    const words = [{ id: 'w', start: 0, end: 2, surface: '勉強', reading: 'べんきょう', selected: true }];
    expect(validateAuthorWords('勉強します', words)).toEqual([]);
    expect(segmentsFromAuthorWords('勉強します', words).map((x) => x.kind === 'word' ? x.surface : x.text).join('')).toBe('勉強します');
    expect(validateAuthorWords('勉強します', [{ ...words[0], end: 3 }])).toContain('勉強 is not an exact sentence span');
    expect(validateAuthorWords('勉強します', [{ ...words[0], reading: '' }], false)).toEqual([]);
  });
  it('does not reuse an identity for repeated vocabulary occurrences', () => {
    const previous: any = { id: 's', japanese: '見る見る', english: 'see', segments: [
      { kind: 'word', id: 'a', revision: 1, surface: '見る', reading: 'みる' }, { kind: 'word', id: 'b', revision: 1, surface: '見る', reading: 'みる' }], acceptedJapanese: [], translationRevision: 1, status: 'active', createdAt: 'x', updatedAt: 'x' };
    const revised = reviseSentence(previous, previous.japanese, previous.english, previous.segments);
    expect(revised.segments.map((x: any) => x.id)).toEqual(['a', 'b']);
  });
  it('rejects records which do not reconstruct', () =>
    expect(() =>
      validateDataset({
        schemaVersion: 1,
        sentences: [
          {
            id: 'x',
            japanese: '違う',
            english: 'x',
            segments: [
              {
                kind: 'word',
                id: 'w',
                revision: 1,
                surface: '漢字',
                reading: 'かんじ',
              },
            ],
            acceptedJapanese: [],
            translationRevision: 1,
            status: 'active',
            createdAt: 'x',
            updatedAt: 'x',
          },
        ],
      }),
    ).toThrow());
});
