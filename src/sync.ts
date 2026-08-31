import { validateDataset } from './content';
import type { DatasetV1, PendingChange, SentenceRecord } from './types';

/** Collapse queue entries without losing the field-level intent of edits. */
export function coalescePending(pending: PendingChange[]) {
  const out: PendingChange[] = [];
  const bySentence = new Map<string, PendingChange>();
  for (const op of pending) {
    if (op.type === 'variant-add' || op.type === 'variant-remove') {
      out.push(op);
      continue;
    }
    const previous = bySentence.get(op.sentenceId);
    if (!previous) {
      bySentence.set(op.sentenceId, {
        ...op,
        patch: op.patch ? { ...op.patch } : undefined,
      });
      continue;
    }
    if (op.type === 'add') {
      bySentence.set(op.sentenceId, op);
      continue;
    }
    if (previous.type === 'add') {
      bySentence.set(op.sentenceId, {
        ...previous,
        patch: { ...previous.patch, ...(op.patch || {}) },
      });
      continue;
    }
    bySentence.set(op.sentenceId, {
      ...op,
      id: previous.id,
      createdAt: previous.createdAt,
      baseUpdatedAt: previous.baseUpdatedAt,
      patch: { ...previous.patch, ...op.patch },
    });
  }
  return [...bySentence.values(), ...out].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export const githubConfig = {
  owner: import.meta.env.VITE_GITHUB_OWNER || 'Qoader',
  repo: import.meta.env.VITE_GITHUB_REPO || 'japanese-practice-01',
  branch: import.meta.env.VITE_GITHUB_BRANCH || 'main',
  path: import.meta.env.VITE_GITHUB_DATA_PATH || 'data/sentences.json',
};

export function mergePending(
  dataset: DatasetV1,
  pending: PendingChange[],
): DatasetV1 {
  const sentences = [...dataset.sentences];
  for (const op of coalescePending(pending)) {
    const at = sentences.findIndex((s) => s.id === op.sentenceId);
    if (op.type === 'add' && at < 0 && op.patch)
      sentences.push(op.patch as SentenceRecord);
    if (at < 0) continue;
    const s = sentences[at];
    if (op.type === 'edit' && op.patch)
      sentences[at] = {
        ...s,
        ...op.patch,
        updatedAt: new Date().toISOString(),
      } as SentenceRecord;
    if (
      op.type === 'variant-add' &&
      op.patch?.text &&
      !s.acceptedJapanese.some((v) => v.text === op.patch!.text)
    ) {
      sentences[at] = {
        ...s,
        acceptedJapanese: [
          ...s.acceptedJapanese,
          { id: op.id, text: String(op.patch.text), createdAt: op.createdAt },
        ],
      };
    }
    if (op.type === 'variant-remove' && op.patch?.variantId)
      sentences[at] = {
        ...s,
        acceptedJapanese: s.acceptedJapanese.filter(
          (v) => v.id !== op.patch!.variantId,
        ),
      };
    if (op.type === 'archive' || op.type === 'restore')
      sentences[at] = {
        ...s,
        status: op.type === 'archive' ? 'archived' : 'active',
        ...(op.type === 'archive'
          ? { archivedAt: op.createdAt }
          : { archivedAt: undefined }),
      };
  }
  return validateDataset({ ...dataset, sentences });
}

function b64(value: string) {
  return btoa(unescape(encodeURIComponent(value)));
}
function decode(value: string) {
  return decodeURIComponent(escape(atob(value.replace(/\n/g, ''))));
}
let channel: BroadcastChannel | undefined;
export async function withPublicationLock<T>(fn: () => Promise<T>): Promise<T> {
  const key = 'japanese-practice-sync-lock';
  const current = localStorage.getItem(key);
  const currentExpiry = current ? Number(current.split(':')[0]) : 0;
  if (
    current &&
    currentExpiry > Date.now() &&
    !current.endsWith(`:${String((globalThis as any).__syncLock)}`)
  )
    throw new Error('Another tab is syncing');
  const token = String(Date.now()) + Math.random();
  localStorage.setItem(key, `${Date.now() + 30000}:${token}`);
  (globalThis as any).__syncLock = token;
  channel ??=
    typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel('japanese-practice-sync')
      : undefined;
  channel?.postMessage({ type: 'lock', token });
  try {
    return await fn();
  } finally {
    if (localStorage.getItem(key)?.endsWith(`:${token}`))
      localStorage.removeItem(key);
    channel?.postMessage({ type: 'unlock', token });
  }
}

export async function publish(
  pending: PendingChange[],
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<DatasetV1> {
  if (!token) throw new Error('GitHub token is required');
  return withPublicationLock(async () => {
    pending = coalescePending(pending);
    const url = `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/contents/${githubConfig.path}`;
    let response = await fetcher(`${url}?ref=${githubConfig.branch}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!response.ok)
      throw new Error(`GitHub read failed (${response.status})`);
    const remote = (await response.json()) as { sha: string; content: string };
    let merged = mergePending(
      validateDataset(JSON.parse(decode(remote.content))),
      pending,
    );
    const body = JSON.stringify(merged, null, 2) + '\n';
    const put = async () =>
      fetcher(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Update Japanese practice content (${pending.length} changes)`,
          content: b64(body),
          sha: remote.sha,
          branch: githubConfig.branch,
        }),
      });
    let written = await put();
    if (written.status === 409) {
      response = await fetcher(`${url}?ref=${githubConfig.branch}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      });
      if (!response.ok)
        throw new Error(`GitHub conflict refresh failed (${response.status})`);
      const newer = (await response.json()) as { sha: string; content: string };
      const retry = mergePending(
        validateDataset(JSON.parse(decode(newer.content))),
        pending,
      );
      merged = retry;
      written = await fetcher(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Update Japanese practice content (${pending.length} changes)`,
          content: b64(JSON.stringify(retry, null, 2) + '\n'),
          sha: newer.sha,
          branch: githubConfig.branch,
        }),
      });
    }
    if (!written.ok) throw new Error(`GitHub write failed (${written.status})`);
    return merged;
  });
}
