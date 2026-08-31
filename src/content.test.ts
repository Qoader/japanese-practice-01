import { describe, expect, it } from 'vitest';
import {
  chooseCard,
  normalizeReading,
  scheduleRetry,
  validateDataset,
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
