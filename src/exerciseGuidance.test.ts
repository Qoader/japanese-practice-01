import { describe, expect, it } from 'vitest';
import { exerciseGuidance } from './exerciseGuidance';

describe('exercise guidance', () => {
  it.each([
    ['reading', 'Reading practice', 'Type the reading of the underlined word.'],
    ['kanji', 'Kanji writing', 'Type the kanji for the underlined word.'],
    ['translation', 'Translation', 'Translate this sentence into Japanese.'],
  ] as const)(
    '%s has the expected label and instruction',
    (type, label, instruction) => {
      expect(exerciseGuidance[type]).toEqual({ label, instruction });
    },
  );
});
