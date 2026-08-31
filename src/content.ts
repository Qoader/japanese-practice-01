import { z } from 'zod';
import type { DatasetV1, SentenceRecord, SentenceSegment } from './types';
export const segmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1) }),
  z.object({
    kind: z.literal('word'),
    id: z.string().min(1),
    revision: z.number().int().positive(),
    surface: z.string().min(1),
    reading: z.string().min(1),
  }),
]);
export const sentenceSchema = z
  .object({
    id: z.string(),
    japanese: z.string(),
    english: z.string(),
    segments: z.array(segmentSchema),
    acceptedJapanese: z.array(
      z.object({ id: z.string(), text: z.string(), createdAt: z.string() }),
    ),
    translationRevision: z.number().int().positive(),
    status: z.enum(['active', 'archived']),
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().optional(),
  })
  .passthrough();
export const datasetSchema = z
  .object({ schemaVersion: z.literal(1), sentences: z.array(sentenceSchema) })
  .passthrough();
export function reconstruct(segments: SentenceSegment[]) {
  return segments
    .map((s: SentenceSegment) => (s.kind === 'text' ? s.text : s.surface))
    .join('');
}
export function normalizeReading(value: string) {
  return value
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .replace(/[ァ-ヶ]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
export function normalizeAnswer(value: string) {
  return value
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .replace(/[。．.!！?？]+$/u, '');
}
export function normalizeSegments(
  segments: SentenceSegment[],
): SentenceSegment[] {
  const out: SentenceSegment[] = [];
  for (const segment of segments) {
    if (segment.kind === 'text' && segment.text.length === 0) continue;
    const prev = out.at(-1);
    if (segment.kind === 'text' && prev?.kind === 'text')
      prev.text += segment.text;
    else out.push({ ...segment });
  }
  return out;
}
export function validateDataset(value: unknown): DatasetV1 {
  const d = datasetSchema.parse(value);
  for (const s of d.sentences) {
    s.segments = normalizeSegments(s.segments);
    if (reconstruct(s.segments) !== s.japanese)
      throw new Error(`Sentence ${s.id} does not reconstruct`);
    for (const w of s.segments.filter((x) => x.kind === 'word')) {
      if (!/\p{Script=Han}/u.test(w.surface))
        throw new Error(`Word ${w.id} lacks Han character`);
      if (normalizeReading(w.reading) !== w.reading)
        throw new Error(`Reading ${w.id} must be hiragana`);
    }
  }
  return d;
}

/** Rebuild an edited sentence while retaining mastery identity for unchanged words. */
export function reviseSentence(
  previous: SentenceRecord,
  japanese: string,
  english: string,
  segments: SentenceSegment[],
): SentenceRecord {
  const oldWords = previous.segments.filter(
    (s): s is Extract<SentenceSegment, { kind: 'word' }> => s.kind === 'word',
  );
  const used = new Set<string>();
  const next = normalizeSegments(segments).map((part) => {
    if (part.kind !== 'word') return part;
    const same = oldWords.find(
      (w) =>
        !used.has(w.id) &&
        w.surface === part.surface &&
        w.reading === normalizeReading(part.reading),
    );
    if (same) used.add(same.id);
    return same
      ? { ...part, id: same.id, revision: same.revision }
      : {
          ...part,
          id: crypto.randomUUID(),
          reading: normalizeReading(part.reading),
          revision: 1,
        };
  });
  const changedTranslation =
    previous.english !== english || previous.japanese !== japanese;
  return {
    ...previous,
    japanese,
    english,
    segments: next,
    translationRevision: changedTranslation
      ? previous.translationRevision + 1
      : previous.translationRevision,
    updatedAt: new Date().toISOString(),
  };
}

export function duplicateSentences(
  dataset: DatasetV1,
  japanese: string,
  extra: SentenceRecord[] = [],
) {
  const key = normalizeAnswer(japanese);
  return [...dataset.sentences, ...extra].filter(
    (s, i, all) =>
      normalizeAnswer(s.japanese) === key &&
      all.findIndex((x) => x.id === s.id) === i,
  );
}
export function cardsForSentence(
  sentence: SentenceRecord,
): import('./types').Card[] {
  if (sentence.status !== 'active') return [];
  const words = sentence.segments.filter(
    (s): s is Extract<SentenceSegment, { kind: 'word' }> => s.kind === 'word',
  );
  return [
    ...words.flatMap((word) => [
      {
        id: `${sentence.id}:reading:${word.id}:${word.revision}`,
        type: 'reading' as const,
        sentence,
        word,
      },
      {
        id: `${sentence.id}:kanji:${word.id}:${word.revision}`,
        type: 'kanji' as const,
        sentence,
        word,
      },
    ]),
    {
      id: `${sentence.id}:translation:${sentence.translationRevision}`,
      type: 'translation' as const,
      sentence,
    },
  ];
}
export function translationAnswers(
  sentence: SentenceRecord,
  personal: string[] = [],
) {
  return [
    sentence.japanese,
    ...sentence.acceptedJapanese.map((v) => v.text),
    ...personal,
  ];
}
export function sentenceParts(
  sentence: SentenceRecord,
  targetId?: string,
  mode: 'reading' | 'kanji' = 'reading',
) {
  return sentence.segments.map((s) => {
    if (s.kind === 'text')
      return { text: s.text, target: false, reading: undefined };
    return {
      text: s.id === targetId && mode === 'kanji' ? s.reading : s.surface,
      target: s.id === targetId,
      reading: s.reading,
    };
  });
}
export function hasJapaneseScript(value: string) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}
/** Stable identity used by focused lessons: surface and complete reading. */
export function vocabularyKey(surface: string, reading: string) {
  return `${normalizeAnswer(surface)}\u0000${normalizeReading(reading)}`;
}
export function vocabularyEntries(sentences: SentenceRecord[]) {
  const entries = new Map<
    string,
    { key: string; surface: string; reading: string; sentenceIds: string[] }
  >();
  for (const sentence of sentences)
    for (const part of sentence.segments) {
      if (part.kind !== 'word') continue;
      const key = vocabularyKey(part.surface, part.reading);
      const found = entries.get(key);
      if (found) {
        if (!found.sentenceIds.includes(sentence.id))
          found.sentenceIds.push(sentence.id);
      } else
        entries.set(key, {
          key,
          surface: part.surface,
          reading: normalizeReading(part.reading),
          sentenceIds: [sentence.id],
        });
    }
  return [...entries.values()];
}
export function graphemeClusters(value: string) {
  const Seg = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity?: string },
      ) => { segment(value: string): Iterable<{ segment: string }> };
    }
  ).Segmenter;
  if (!Seg) return Array.from(value);
  return [...new Seg('ja', { granularity: 'grapheme' }).segment(value)].map(
    (x) => x.segment,
  );
}
export function suggestedWordSpans(value: string) {
  const clusters = graphemeClusters(value),
    spans: Array<{ start: number; end: number; surface: string }> = [];
  let start = -1;
  clusters.forEach((cluster, index) => {
    const han = /\p{Script=Han}/u.test(cluster);
    if (han && start < 0) start = index;
    if (!han && start >= 0) {
      spans.push({
        start,
        end: index,
        surface: clusters.slice(start, index).join(''),
      });
      start = -1;
    }
  });
  if (start >= 0)
    spans.push({
      start,
      end: clusters.length,
      surface: clusters.slice(start).join(''),
    });
  return spans;
}

export type AuthorWord = {
  id: string;
  start: number;
  end: number;
  surface: string;
  reading: string;
  selected: boolean;
};

/** Build sentence segments from grapheme-indexed author selections. */
export function segmentsFromAuthorWords(
  japanese: string,
  words: AuthorWord[],
): SentenceSegment[] {
  const clusters = graphemeClusters(japanese),
    sorted = [...words]
      .filter((w) => w.selected)
      .sort((a, b) => a.start - b.start);
  const out: SentenceSegment[] = [];
  let pos = 0;
  for (const w of sorted) {
    if (
      w.start < pos ||
      w.start < 0 ||
      w.end > clusters.length ||
      w.end <= w.start
    )
      continue;
    if (w.start > pos)
      out.push({ kind: 'text', text: clusters.slice(pos, w.start).join('') });
    out.push({
      kind: 'word',
      id: w.id || crypto.randomUUID(),
      revision: 1,
      surface: clusters.slice(w.start, w.end).join(''),
      reading: normalizeReading(w.reading),
    });
    pos = w.end;
  }
  if (pos < clusters.length)
    out.push({ kind: 'text', text: clusters.slice(pos).join('') });
  return normalizeSegments(out);
}

export function validateAuthorWords(
  japanese: string,
  words: AuthorWord[],
  requireReadings = true,
) {
  const clusters = graphemeClusters(japanese),
    errors: string[] = [],
    ranges: Array<[number, number]> = [];
  for (const w of words.filter((x) => x.selected)) {
    const surface = clusters.slice(w.start, w.end).join('');
    if (!surface || surface !== w.surface)
      errors.push(`${w.surface || 'Word'} is not an exact sentence span`);
    if (!/\p{Script=Han}/u.test(surface))
      errors.push(`${surface || 'Word'} must contain kanji`);
    if (ranges.some(([a, b]) => w.start < b && w.end > a))
      errors.push(`${surface} overlaps another word`);
    ranges.push([w.start, w.end]);
    if (requireReadings && !normalizeReading(w.reading))
      errors.push(`${surface} needs a reading`);
  }
  return errors;
}
export function cardsForLesson(
  sentences: SentenceRecord[],
  config?: {
    query?: string;
    selectedWords?: string[];
    types?: { reading: boolean; kanji: boolean; translation: boolean };
  },
) {
  const all = sentences.flatMap(cardsForSentence);
  if (!config) return all;
  const query = (config.query || '').toLocaleLowerCase();
  const selected = new Set(config.selectedWords || []);
  return all.filter((card) => {
    const sentenceMatch =
      !query ||
      card.sentence.japanese.includes(config.query || '') ||
      card.sentence.english.toLocaleLowerCase().includes(query);
    const vocabMatch =
      !selected.size ||
      (card.word &&
        selected.has(vocabularyKey(card.word.surface, card.word.reading))) ||
      (card.type === 'translation' &&
        card.sentence.segments.some(
          (x) =>
            x.kind === 'word' &&
            selected.has(vocabularyKey(x.surface, x.reading)),
        ));
    return (
      sentenceMatch && vocabMatch && (!config.types || config.types[card.type])
    );
  });
}
/** Schedule a single miss after 3–6 intervening cards, preserving an earlier due slot. */
export function scheduleRetry(
  existing: { cardIndex: number; dueAt: number }[],
  cardIndex: number,
  currentPosition: number,
  random = Math.random,
) {
  const earlier = existing.find((x) => x.cardIndex === cardIndex);
  if (earlier) return existing;
  const dueAt =
    currentPosition +
    3 +
    Math.floor(Math.max(0, Math.min(0.999999, random())) * 4);
  return [...existing, { cardIndex, dueAt }].sort((a, b) => a.dueAt - b.dueAt);
}
export function selectionWeight(p: {
  attempts: number;
  correctStreak: number;
  incorrect: number;
}) {
  return Math.max(
    1,
    Math.min(
      8,
      p.attempts === 0
        ? 8
        : 6 - p.correctStreak + 2 * (p.incorrect / p.attempts),
    ),
  );
}
export function chooseCard<T extends { id: string }>(
  cards: T[],
  progress: Record<
    string,
    { attempts: number; correctStreak: number; incorrect: number }
  >,
  recent: string[] = [],
  random = Math.random,
) {
  if (!cards.length) return undefined;
  // Never immediately repeat when another card is available. The remaining
  // recent cards still participate with the prescribed 0.25 penalty.
  const immediate = recent[0];
  const eligible =
    cards.length > 1 ? cards.filter((c) => c.id !== immediate) : cards;
  const weighted = eligible.map((c) => ({
    c,
    w:
      selectionWeight(
        progress[c.id] || { attempts: 0, correctStreak: 0, incorrect: 0 },
      ) * (recent.includes(c.id) ? 0.25 : 1),
  }));
  const total = weighted.reduce((n, x) => n + x.w, 0);
  let r = Math.min(0.999999999, Math.max(0, random())) * total;
  for (const x of weighted) {
    r -= x.w;
    if (r <= 0) return x.c;
  }
  return weighted.at(-1)!.c;
}
