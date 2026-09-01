export type SentenceSegment =
  | { kind: 'text'; text: string }
  | {
      kind: 'word';
      id: string;
      revision: number;
      surface: string;
      reading: string;
    };
export interface AcceptedVariant {
  id: string;
  text: string;
  createdAt: string;
}
export interface SentenceRecord {
  id: string;
  japanese: string;
  english: string;
  segments: SentenceSegment[];
  acceptedJapanese: AcceptedVariant[];
  translationRevision: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  [key: string]: unknown;
}
export interface DatasetV1 {
  schemaVersion: 1;
  sentences: SentenceRecord[];
  [key: string]: unknown;
}
export interface CardProgress {
  cardId: string;
  attempts: number;
  correct: number;
  incorrect: number;
  correctStreak: number;
  overrideCount: number;
  lastSeenAt: string | null;
  updatedAt: string;
}
export type Card = {
  id: string;
  type: 'reading' | 'kanji' | 'translation';
  sentence: SentenceRecord;
  word?: Extract<SentenceSegment, { kind: 'word' }>;
};
export interface PersonalVariant {
  id: string;
  sentenceId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}
export interface PendingChange {
  id: string;
  type:
    'add' | 'edit' | 'variant-add' | 'variant-remove' | 'archive' | 'restore';
  sentenceId: string;
  createdAt: string;
  baseUpdatedAt?: string;
  patch?: Record<string, unknown>;
}
export interface ActiveLessonState {
  id?: string;
  route: string;
  cardIds: string[];
  index: number;
  retryQueue: RetryEntry[];
  startedAt: string;
  updatedAt: string;
}
export interface RetryEntry {
  cardIndex: number;
  dueAt: number;
}
export interface LessonConfig {
  selectionMode: 'vocabulary' | 'sentences';
  query: string;
  selectedWords: string[];
  selectedSentences: string[];
  count?: number;
  types: { reading: boolean; kanji: boolean; translation: boolean };
}
