import { openDB } from 'idb';
import type {
  ActiveLessonState,
  CardProgress,
  DatasetV1,
  PendingChange,
  PersonalVariant,
} from './types';
const db = openDB('japanese-practice', 2, {
  upgrade(d) {
    for (const n of ['dataset', 'drafts', 'overlays', 'backups'])
      if (!d.objectStoreNames.contains(n)) d.createObjectStore(n);
    if (!d.objectStoreNames.contains('progress'))
      d.createObjectStore('progress', { keyPath: 'cardId' });
    for (const n of ['variants', 'pending', 'lesson'])
      if (!d.objectStoreNames.contains(n))
        d.createObjectStore(n, { keyPath: 'id' });
  },
});
export async function saveDataset(v: DatasetV1) {
  return (await db).put('dataset', v, 'live');
}
export async function loadDataset() {
  return (await db).get('dataset', 'live') as Promise<DatasetV1 | undefined>;
}
export async function saveProgress(v: CardProgress) {
  return (await db).put('progress', v);
}
export async function loadProgress() {
  return (await db).getAll('progress') as Promise<CardProgress[]>;
}
export async function listPending() {
  return (await db).getAll('pending') as Promise<PendingChange[]>;
}
export async function savePending(v: PendingChange) {
  return (await db).put('pending', v);
}
export async function deletePending(id: string) {
  return (await db).delete('pending', id);
}
export async function listVariants() {
  return (await db).getAll('variants') as Promise<PersonalVariant[]>;
}
export async function saveVariant(v: PersonalVariant) {
  return (await db).put('variants', v);
}
export async function deleteVariant(id: string) {
  return (await db).delete('variants', id);
}
export async function deleteProgress(cardId: string) {
  return (await db).delete('progress', cardId);
}
export async function saveLesson(v: ActiveLessonState) {
  return (await db).put('lesson', { ...v, id: 'active' });
}
export async function loadLesson() {
  return (await db).get('lesson', 'active') as Promise<
    ActiveLessonState | undefined
  >;
}
export async function clearLesson() {
  return (await db).delete('lesson', 'active');
}
export async function requestPersistence() {
  return navigator.storage?.persist ? navigator.storage.persist() : false;
}

/** A complete learner backup intentionally excludes the shared dataset/token. */
export interface BackupV1 {
  schemaVersion: 1;
  exportedAt: string;
  progress: CardProgress[];
  variants: PersonalVariant[];
  pending: PendingChange[];
  drafts: unknown[];
  lesson?: ActiveLessonState;
}
export async function exportBackup(includeLesson = true): Promise<BackupV1> {
  const backup: BackupV1 = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    progress: await loadProgress(),
    variants: await listVariants(),
    pending: await listPending(),
    drafts: await (await db).getAll('drafts'),
  };
  if (includeLesson) backup.lesson = await loadLesson();
  return backup;
}
export function validateBackup(value: unknown): BackupV1 {
  if (!value || typeof value !== 'object' || (value as any).schemaVersion !== 1)
    throw new Error('Unsupported backup version');
  const x = value as any;
  if (
    !Array.isArray(x.progress) ||
    !Array.isArray(x.variants) ||
    !Array.isArray(x.pending)
  )
    throw new Error('Backup is missing required stores');
  return {
    schemaVersion: 1,
    exportedAt: String(x.exportedAt || ''),
    progress: x.progress,
    variants: x.variants,
    pending: x.pending,
    drafts: Array.isArray(x.drafts) ? x.drafts : [],
    lesson: x.lesson,
  };
}
export async function importBackup(
  value: unknown,
  mode: 'replace' | 'merge' = 'merge',
) {
  const backup = validateBackup(value);
  const database = await db;
  const tx = database.transaction(
    ['progress', 'variants', 'pending', 'lesson', 'drafts'],
    'readwrite',
  );
  if (mode === 'replace') {
    await Promise.all([
      tx.objectStore('progress').clear(),
      tx.objectStore('variants').clear(),
      tx.objectStore('pending').clear(),
      tx.objectStore('lesson').clear(),
      tx.objectStore('drafts').clear(),
    ]);
  }
  const progress = mode === 'replace' ? [] : await database.getAll('progress');
  const newest = new Map(progress.map((p: CardProgress) => [p.cardId, p]));
  for (const p of backup.progress)
    if (
      mode === 'replace' ||
      !newest.has(p.cardId) ||
      String(p.updatedAt) > String(newest.get(p.cardId)!.updatedAt)
    )
      await tx.objectStore('progress').put(p);
  const variants = mode === 'replace' ? [] : await database.getAll('variants');
  const seen = new Set(
    variants.map(
      (v: PersonalVariant) =>
        `${v.sentenceId}\0${v.text.normalize('NFKC').replace(/\s+/gu, '')}`,
    ),
  );
  for (const v of backup.variants)
    if (
      mode === 'replace' ||
      !seen.has(
        `${v.sentenceId}\0${v.text.normalize('NFKC').replace(/\s+/gu, '')}`,
      )
    )
      await tx.objectStore('variants').put(v);
  const pending = mode === 'replace' ? [] : await database.getAll('pending');
  const ids = new Set(pending.map((p: PendingChange) => p.id));
  for (const p of backup.pending)
    if (mode === 'replace' || !ids.has(p.id))
      await tx.objectStore('pending').put(p);
  if (backup.lesson)
    await tx.objectStore('lesson').put({ ...backup.lesson, id: 'active' });
  for (const draft of backup.drafts)
    await tx.objectStore('drafts').put(draft, crypto.randomUUID());
  await tx.done;
}
