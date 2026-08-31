import type { Card } from './types';

export interface ExerciseGuidance {
  label: string;
  instruction: string;
}

export const exerciseGuidance: Record<Card['type'], ExerciseGuidance> = {
  reading: {
    label: 'Reading practice',
    instruction: 'Type the reading of the underlined word.',
  },
  kanji: {
    label: 'Kanji writing',
    instruction: 'Type the kanji for the underlined word.',
  },
  translation: {
    label: 'Translation',
    instruction: 'Translate this sentence into Japanese.',
  },
};
