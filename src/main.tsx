import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import seed from '../data/sentences.json';
import './style.css';
import { exerciseGuidance } from './exerciseGuidance';
import {
  normalizeAnswer,
  normalizeReading,
  translationAnswers,
  validateDataset,
  hasJapaneseScript,
  chooseCard,
  sentenceParts,
  cardsForLesson,
  cardsForSentence,
  scheduleRetry,
  vocabularyEntries,
  vocabularyKey,
  suggestedWordSpans,
  graphemeClusters,
  segmentsFromAuthorWords,
  validateAuthorWords,
  reviseSentence,
} from './content';
import type { AuthorWord } from './content';
import type {
  CardProgress,
  DatasetV1,
  SentenceRecord,
  PendingChange,
  PersonalVariant,
  RetryEntry,
} from './types';
import {
  loadDataset,
  saveDataset,
  loadProgress,
  saveProgress,
  deleteProgress,
  listPending,
  savePending,
  deletePending,
  listVariants,
  saveVariant,
  deleteVariant,
  requestPersistence,
  saveLesson,
  loadLesson,
  clearLesson,
  exportBackup,
  importBackup,
} from './storage';
import { publish } from './sync';
const now = () => new Date().toISOString();
function useHash() {
  const [, s] = useState(location.hash);
  useEffect(() => {
    const f = () => s(location.hash);
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return location.hash || '#/';
}
function App() {
  let r = useHash(),
    [d, setD] = useState<DatasetV1>(validateDataset(seed)),
    [p, setP] = useState<Record<string, CardProgress>>({}),
    [v, setV] = useState<PersonalVariant[]>([]),
    [q, setQ] = useState<PendingChange[]>([]),
    [lesson, setLesson] = useState<Awaited<ReturnType<typeof loadLesson>>>();
  useEffect(() => {
    (async () => {
      let x;
      try {
        x = validateDataset(
          await (
            await fetch(
              `${import.meta.env.BASE_URL}data/sentences.json?x=${Date.now()}`,
              { cache: 'no-store' },
            )
          ).json(),
        );
        await saveDataset(x);
      } catch {
        x = (await loadDataset()) || validateDataset(seed);
      }
      setD(x);
      setP(
        Object.fromEntries((await loadProgress()).map((z) => [z.cardId, z])),
      );
      setV(await listVariants());
      setQ(await listPending());
      setLesson(await loadLesson());
      void requestPersistence();
    })();
  }, []);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let reloaded = false;
    const onController = () => {
      if (reloaded || sessionStorage.getItem('pwa-reloaded') === location.href)
        return;
      reloaded = true;
      sessionStorage.setItem('pwa-reloaded', location.href);
      location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onController);
    void navigator.serviceWorker.getRegistration().then((registration) => {
      if (registration?.waiting)
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    });
    return () =>
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onController,
      );
  }, []);
  let a = d.sentences.filter((x) => x.status === 'active'),
    put = (x: DatasetV1) => {
      setD(x);
      void saveDataset(x);
    },
    add = async (x: PendingChange) => {
      await savePending(x);
      setQ((y) => [...y, x]);
    },
    view =
      r === '#/lesson' ? (
        <Lesson s={a} p={p} setP={setP} v={v} setV={setV} add={add} />
      ) : r === '#/lesson/setup' ? (
        <Setup s={a} />
      ) : r === '#/sentences' ? (
        <Sentences d={d} put={put} add={add} />
      ) : r === '#/sentences/new' || r.startsWith('#/sentences/edit/') ? (
        <Author
          d={d}
          put={put}
          add={add}
          p={p}
          setP={setP}
          v={v}
          setV={setV}
          q={q}
          setQ={setQ}
          existing={d.sentences.find((x) => r === `#/sentences/edit/${x.id}`)}
        />
      ) : r === '#/sync' ? (
        <Sync q={q} setQ={setQ} />
      ) : r === '#/settings' ? (
        <Settings />
      ) : r === '#/progress' ? (
        <main>
          <h1>Progress</h1>
          <p>{Object.values(p).reduce((n, x) => n + x.attempts, 0)} attempts</p>
        </main>
      ) : (
        <main>
          <h1>おかえりなさい</h1>
          {lesson ? (
            <>
              <a className="primary" href="#/lesson">
                Resume lesson
              </a>
              <button
                onClick={() => {
                  void clearLesson();
                  setLesson(undefined);
                }}
              >
                Discard lesson
              </button>
            </>
          ) : (
            <a className="primary" href="#/lesson/setup">
              Start lesson
            </a>
          )}
          {a.map((x) => (
            <article key={x.id}>
              {x.japanese}
              <span>{x.english}</span>
            </article>
          ))}
        </main>
      );
  return (
    <>
      <header>
        <a className="brand" href="#/">
          日本語 practice
        </a>
        <span>
          {navigator.onLine ? 'Online' : 'Offline'}
          {q.length ? ` · ${q.length} pending` : ''}
        </span>
      </header>
      {view}
      <nav>
        <a href="#/">Home</a>
        <a href="#/lesson/setup">Practice</a>
        <a href="#/sentences">Sentences</a>
        <a href="#/progress">Progress</a>
        <a href="#/settings">Settings</a>
      </nav>
    </>
  );
}
function Lesson({
  s,
  p,
  setP,
  v,
  setV,
  add,
}: {
  s: SentenceRecord[];
  p: Record<string, CardProgress>;
  setP: React.Dispatch<React.SetStateAction<Record<string, CardProgress>>>;
  v: PersonalVariant[];
  setV: React.Dispatch<React.SetStateAction<PersonalVariant[]>>;
  add: (x: PendingChange) => Promise<void>;
}) {
  let cfg = JSON.parse(sessionStorage.getItem('lesson-config') || 'null'),
    cards = useMemo(() => cardsForLesson(s, cfg || undefined), [s, cfg]),
    [i, si] = useState(0),
    [recent, setRecent] = useState<string[]>([]),
    [retryQueue, setRetryQueue] = useState<RetryEntry[]>([]),
    [selectedIndex, setSelectedIndex] = useState(0),
    [hydrated, setHydrated] = useState(false),
    [ans, sa] = useState(''),
    [done, sd] = useState(false),
    [translationResolved, setTranslationResolved] = useState(false),
    cardIndex =
      retryQueue[0] && retryQueue[0].dueAt <= i
        ? retryQueue[0].cardIndex
        : selectedIndex,
    card = cardIndex >= 0 ? cards[cardIndex] : undefined;
  useEffect(() => {
    if (!cards.length) return;
    void loadLesson().then((saved) => {
      if (
        saved &&
        saved.cardIds.join('|') === cards.map((c) => c.id).join('|')
      ) {
        si(saved.index);
        setRetryQueue(
          saved.retryQueue.map((x, n) =>
            typeof x === 'number'
              ? { cardIndex: x, dueAt: saved.index + n }
              : x,
          ),
        );
        setSelectedIndex(saved.index);
      }
      setHydrated(true);
    });
  }, [cards.length]);
  useEffect(() => {
    if (hydrated && cards.length && card)
      void saveLesson({
        id: 'active',
        route: '#/lesson',
        cardIds: cards.map((c) => c.id),
        index: i,
        retryQueue,
        startedAt: now(),
        updatedAt: now(),
      });
  }, [i, cards.length, retryQueue, card?.id]);
  if (!card)
    return (
      <main>
        <h1>No cards</h1>
      </main>
    );
  const activeCard = card;
  let exp =
      activeCard.type === 'reading'
        ? activeCard.word!.reading
        : activeCard.type === 'kanji'
          ? activeCard.word!.surface
          : activeCard.sentence.japanese,
    ok =
      activeCard.type === 'reading'
        ? normalizeReading(ans) === normalizeReading(exp)
        : activeCard.type === 'kanji'
          ? normalizeAnswer(ans) === normalizeAnswer(exp)
          : translationAnswers(
              activeCard.sentence,
              v
                .filter((x) => x.sentenceId === activeCard.sentence.id)
                .map((x) => x.text),
            ).some((x) => normalizeAnswer(x) === normalizeAnswer(ans));
  async function rec(g: boolean, over = false) {
    let o = p[activeCard.id] || {
        cardId: activeCard.id,
        attempts: 0,
        correct: 0,
        incorrect: 0,
        correctStreak: 0,
        overrideCount: 0,
        lastSeenAt: null,
        updatedAt: '',
      },
      n = {
        ...o,
        attempts: o.attempts + 1,
        correct: o.correct + (g ? 1 : 0),
        incorrect: o.incorrect + (g ? 0 : 1),
        correctStreak: g ? o.correctStreak + 1 : 0,
        overrideCount: o.overrideCount + (over ? 1 : 0),
        lastSeenAt: now(),
        updatedAt: now(),
      };
    setP((x) => ({ ...x, [activeCard.id]: n }));
    await saveProgress(n);
    setRetryQueue((queue) => {
      const wasDue = queue[0]?.cardIndex === cardIndex && queue[0].dueAt <= i;
      const remaining = wasDue ? queue.slice(1) : queue;
      return g
        ? remaining
        : scheduleRetry(remaining, cardIndex, i, () => Math.random());
    });
    setRecent((x) => [activeCard.id, ...x].slice(0, 2));
    sd(true);
  }
  async function also() {
    if (!hasJapaneseScript(ans)) return;
    let z = {
      id: crypto.randomUUID(),
      sentenceId: activeCard.sentence.id,
      text: ans.trim(),
      createdAt: now(),
      updatedAt: now(),
    };
    await saveVariant(z);
    setV((x) => [...x, z]);
    await add({
      id: crypto.randomUUID(),
      type: 'variant-add',
      sentenceId: activeCard.sentence.id,
      createdAt: now(),
      patch: { text: z.text },
    });
    await rec(true, true);
    setTranslationResolved(true);
  }
  async function dontKnow() {
    await rec(false);
    setTranslationResolved(true);
  }
  function nextCard() {
    const nextPosition = i + 1;
    si(nextPosition);
    const nextRetry = retryQueue
      .filter((x) => x.cardIndex !== cardIndex)
      .find((x) => x.dueAt <= nextPosition);
    const next = nextRetry
      ? cards[nextRetry.cardIndex]
      : chooseCard(cards, p, [activeCard.id, ...recent]);
    if (next) setSelectedIndex(cards.findIndex((c) => c.id === next.id));
    sa('');
    sd(false);
    setTranslationResolved(false);
    if (nextPosition >= cards.length && retryQueue.length === 0)
      void clearLesson();
  }
  return (
    <main className="lesson">
      <p className="lesson-progress">
        Card {i + 1} of {cards.length}
      </p>
      <p className="lesson-type">{exerciseGuidance[card.type].label}</p>
      <p className="lesson-instruction">
        {exerciseGuidance[card.type].instruction}
      </p>
      <h1>
        {card.type === 'translation'
          ? card.sentence.english
          : sentenceParts(card.sentence, card.word?.id, card.type).map(
              (x, n) => (
                <span key={n} className={x.target ? 'target' : ''}>
                  {x.text}
                </span>
              ),
            )}
      </h1>
      <input
        lang="ja"
        autoCapitalize="none"
        autoCorrect="off"
        value={ans}
        onChange={(e) => sa(e.target.value)}
        onCompositionStart={(e) => {
          e.currentTarget.dataset.composing = 'true';
        }}
        onCompositionEnd={(e) => {
          e.currentTarget.dataset.composing = 'false';
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.currentTarget.dataset.composing !== 'true')
            void rec(ok);
        }}
      />
      <div className="lesson-actions">
        {!done && (
          <button
            className="primary"
            onClick={() => {
              if (card.type === 'translation' && !ok) sd(true);
              else void rec(ok);
            }}
          >
            Check
          </button>
        )}
        {done && (ok || card.type !== 'translation' || translationResolved) && (
          <button className="primary" onClick={nextCard}>
            Next
          </button>
        )}
        <button
          className="stop"
          onClick={() => {
            void clearLesson();
            location.hash = '#/';
          }}
        >
          Stop lesson
        </button>
      </div>
      {done && (
        <section>
          <h2>{ok ? 'Correct' : 'Not quite'}</h2>
          <p className={ok ? 'correct' : 'incorrect'}>
            {card.type !== 'translation' && (
              <span className="furigana">
                {sentenceParts(card.sentence).map((x, n) => (
                  <span key={n}>
                    {x.reading ? (
                      <ruby>
                        {x.text}
                        <rt>{x.reading}</rt>
                      </ruby>
                    ) : (
                      x.text
                    )}
                  </span>
                ))}
              </span>
            )}
            <br />
            Expected: <strong>{exp}</strong>
          </p>
          {card.type === 'translation' && !ok && (
            <>
              <button onClick={() => void also()}>
                My answer is also correct
              </button>
              <button onClick={() => void dontKnow()}>I don't know</button>
            </>
          )}
        </section>
      )}
    </main>
  );
}
function Setup({ s }: { s: SentenceRecord[] }) {
  let [q, sq] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [t, st] = useState({ reading: true, kanji: true, translation: true }),
    f = s.filter(
      (x) =>
        !q ||
        x.japanese.includes(q) ||
        x.english.toLowerCase().includes(q.toLowerCase()),
    ),
    entries = vocabularyEntries(f),
    n = cardsForLesson(f, {
      query: q,
      selectedWords: selected,
      types: t,
    }).length;
  return (
    <main>
      <h1>Lesson setup</h1>
      <input
        type="search"
        placeholder="Search"
        value={q}
        onChange={(e) => sq(e.target.value)}
      />
      <fieldset>
        {(['reading', 'kanji', 'translation'] as const).map((x) => (
          <label key={x}>
            <input
              type="checkbox"
              checked={t[x]}
              onChange={(e) => st((y) => ({ ...y, [x]: e.target.checked }))}
            />
            {x}
          </label>
        ))}
      </fieldset>
      <h2>Vocabulary</h2>
      <p>
        {selected.length ? `${selected.length} selected` : 'All vocabulary'}
      </p>
      <div className="vocabulary-list">
        {entries.map((word) => (
          <label key={word.key}>
            <input
              type="checkbox"
              checked={selected.includes(word.key)}
              onChange={(e) =>
                setSelected((old) =>
                  e.target.checked
                    ? [...old, word.key]
                    : old.filter((x) => x !== word.key),
                )
              }
            />
            {word.surface}（{word.reading}） · {word.sentenceIds.length}{' '}
            sentences
          </label>
        ))}
      </div>
      {n ? (
        <button
          className="primary"
          onClick={() => {
            sessionStorage.setItem(
              'lesson-config',
              JSON.stringify({ query: q, selectedWords: selected, types: t }),
            );
            location.hash = '#/lesson';
          }}
        >
          Start lesson ({n})
        </button>
      ) : (
        <p>No cards match these filters.</p>
      )}
    </main>
  );
}
function Sentences({
  d,
  put,
  add,
}: {
  d: DatasetV1;
  put: (x: DatasetV1) => void;
  add: (x: PendingChange) => Promise<void>;
}) {
  async function toggle(s: SentenceRecord) {
    let status = (s.status === 'active' ? 'archived' : 'active') as
        'active' | 'archived',
      u = { ...s, status, updatedAt: now() };
    put({ ...d, sentences: d.sentences.map((x) => (x.id === s.id ? u : x)) });
    await add({
      id: crypto.randomUUID(),
      type: status === 'active' ? 'restore' : 'archive',
      sentenceId: s.id,
      createdAt: now(),
      patch: { status },
    });
  }
  return (
    <main>
      <h1>Sentences</h1>
      <a className="primary" href="#/sentences/new">
        Add sentence
      </a>
      {d.sentences.map((s) => (
        <article key={s.id}>
          <strong>{s.japanese}</strong>
          <span>
            {s.english} · {s.status}
          </span>
          <button onClick={() => void toggle(s)}>
            {s.status === 'active' ? 'Archive' : 'Restore'}
          </button>
          <a href={`#/sentences/edit/${s.id}`}>Edit</a>
        </article>
      ))}
    </main>
  );
}
function Author({
  d,
  put,
  add,
  existing,
  p,
  setP,
  v,
  setV,
  q,
  setQ,
}: {
  d: DatasetV1;
  put: (x: DatasetV1) => void;
  add: (x: PendingChange) => Promise<void>;
  existing?: SentenceRecord;
  p: Record<string, CardProgress>;
  setP: React.Dispatch<React.SetStateAction<Record<string, CardProgress>>>;
  v: PersonalVariant[];
  setV: React.Dispatch<React.SetStateAction<PersonalVariant[]>>;
  q: PendingChange[];
  setQ: React.Dispatch<React.SetStateAction<PendingChange[]>>;
}) {
  const initialWords = (): AuthorWord[] => {
    const spans = suggestedWordSpans(existing?.japanese || '');
    if (!existing) return [];
    const clusters = graphemeClusters(existing.japanese),
      out: AuthorWord[] = [];
    let pos = 0;
    for (const part of existing.segments) {
      const n = graphemeClusters(
        part.kind === 'text' ? part.text : part.surface,
      ).length;
      if (part.kind === 'word')
        out.push({
          id: part.id,
          start: pos,
          end: pos + n,
          surface: part.surface,
          reading: part.reading,
          selected: true,
        });
      pos += n;
    }
    return out.length
      ? out
      : spans.map((x) => ({
          ...x,
          id: crypto.randomUUID(),
          reading: '',
          selected: true,
        }));
  };
  let [j, sj] = useState(existing?.japanese || ''),
    [e, se] = useState(existing?.english || ''),
    [step, setStep] = useState(0),
    [words, setWords] = useState<AuthorWord[]>(initialWords),
    [error, setError] = useState(''),
    [addWord, setAddWord] = useState(''),
    [pendingEdit, setPendingEdit] = useState<{
      index: number;
      surface: string;
      starts: number[];
    }>();
  const selected = words
    .filter((w) => w.selected)
    .sort((a, b) => a.start - b.start);
  function next() {
    setError('');
    if (step === 0 && !j.trim())
      return setError('Japanese sentence is required');
    if (step === 0) {
      const normalized = j.trim(),
        spans = suggestedWordSpans(normalized);
      if (normalized !== j) sj(normalized);
      if (normalized !== (existing?.japanese || ''))
        setWords(
          spans.map((x) => ({
            ...x,
            id: crypto.randomUUID(),
            reading: '',
            selected: true,
          })),
        );
    }
    if (step === 1) {
      const errors = validateAuthorWords(j, words, false);
      if (errors.length) return setError(errors[0]);
    }
    if (
      step >= 2 &&
      step < 2 + selected.length &&
      !normalizeReading(selected[step - 2].reading)
    )
      return setError('Enter a reading before continuing');
    if (step === 2 + selected.length && !e.trim())
      return setError('English translation is required');
    setStep((x) => Math.min(x + 1, 3 + selected.length));
  }
  function back() {
    setError('');
    setStep((x) => Math.max(0, x - 1));
  }
  function remapWord(index: number, surface: string, occurrence = 0) {
    const text = graphemeClusters(j.trim()).join(''),
      starts: number[] = [];
    if (!surface) return;
    let from = 0,
      at;
    while ((at = text.indexOf(surface, from)) >= 0) {
      starts.push(at);
      from = at + 1;
    }
    if (!starts.length) {
      setWords((xs) => xs.map((w, n) => (n === index ? { ...w, surface } : w)));
      setPendingEdit(undefined);
      return;
    }
    const charAt = starts[occurrence],
      start = graphemeClusters(text.slice(0, charAt)).length;
    setWords((xs) =>
      xs.map((w, n) =>
        n === index
          ? {
              ...w,
              surface,
              start,
              end: start + graphemeClusters(surface).length,
            }
          : w,
      ),
    );
    setPendingEdit(undefined);
  }
  async function save() {
    const japanese = j.trim(),
      english = e.trim(),
      seg = segmentsFromAuthorWords(japanese, words);
    if (!japanese || !english || validateAuthorWords(japanese, words).length)
      return;
    if (
      d.sentences.some(
        (s) =>
          s.id !== existing?.id &&
          s.status === 'active' &&
          normalizeAnswer(s.japanese) === normalizeAnswer(japanese),
      ) &&
      !window.confirm(
        'An active sentence has the same Japanese text. Save duplicate?',
      )
    )
      return;
    const t = now();
    let x: SentenceRecord = existing
      ? reviseSentence(existing, japanese, english, seg)
      : {
          id: crypto.randomUUID(),
          japanese,
          english,
          segments: seg,
          acceptedJapanese: [],
          translationRevision: 1,
          status: 'active',
          createdAt: t,
          updatedAt: t,
        };
    if (
      existing &&
      (existing.japanese !== japanese || existing.english !== english)
    ) {
      x = { ...x, acceptedJapanese: [] };
      const valid = new Set(cardsForSentence(x).map((card) => card.id));
      const removed = Object.keys(p).filter(
        (id) => id.startsWith(`${existing.id}:`) && !valid.has(id),
      );
      await Promise.all(removed.map(deleteProgress));
      if (removed.length)
        setP((old) => {
          const next = { ...old };
          removed.forEach((id) => delete next[id]);
          return next;
        });
      const variants = v.filter((item) => item.sentenceId === existing.id);
      await Promise.all(variants.map((item) => deleteVariant(item.id)));
      setV((old) => old.filter((item) => item.sentenceId !== existing.id));
      const stale = q.filter(
        (item) =>
          item.sentenceId === existing.id && item.type === 'variant-add',
      );
      await Promise.all(stale.map((item) => deletePending(item.id)));
      if (stale.length)
        setQ((old) =>
          old.filter((item) => !stale.some((s) => s.id === item.id)),
        );
    }
    put({
      ...d,
      sentences: existing
        ? d.sentences.map((s) => (s.id === existing.id ? x : s))
        : [...d.sentences, x],
    });
    await add({
      id: crypto.randomUUID(),
      type: existing ? 'edit' : 'add',
      sentenceId: x.id,
      createdAt: t,
      patch: existing
        ? {
            japanese: x.japanese,
            english: x.english,
            segments: x.segments,
            acceptedJapanese: x.acceptedJapanese,
            translationRevision: x.translationRevision,
            updatedAt: x.updatedAt,
          }
        : (x as any),
    });
    location.hash = '#/sentences';
  }
  const labels = [
    'Japanese',
    'Practice words',
    ...selected.map((w) => `Reading: ${w.surface}`),
    'English',
    'Review',
  ];
  const review = step === labels.length - 1;
  return (
    <main>
      <p className="eyebrow">
        Step {step + 1} of {labels.length}: {labels[step]}
      </p>
      <h1>{review ? 'Review sentence' : labels[step]}</h1>
      {step === 0 && (
        <label>
          Japanese
          <input
            lang="ja"
            value={j}
            onChange={(x) => {
              sj(x.target.value);
              if (x.target.value.trim() !== (existing?.japanese || ''))
                setWords([]);
            }}
          />
        </label>
      )}
      {step === 1 && (
        <>
          <p className="sentence-preview">{j}</p>
          {words.map((w, i) => (
            <label key={w.id}>
              <input
                type="checkbox"
                checked={w.selected}
                onChange={() =>
                  setWords((xs) =>
                    xs.map((x, n) =>
                      n === i ? { ...x, selected: !x.selected } : x,
                    ),
                  )
                }
              />{' '}
              <input
                lang="ja"
                aria-label={`Word ${i + 1}`}
                value={w.surface}
                onChange={(x) => {
                  const surface = x.target.value,
                    text = graphemeClusters(j.trim()).join(''),
                    starts: number[] = [];
                  let from = 0,
                    at;
                  while ((at = text.indexOf(surface, from)) >= 0) {
                    starts.push(at);
                    from = at + 1;
                  }
                  if (starts.length === 1) remapWord(i, surface);
                  else setPendingEdit({ index: i, surface, starts });
                }}
              />{' '}
              ({w.start + 1}–{w.end})
              {pendingEdit?.index === i && pendingEdit.starts.length > 1 && (
                <span>
                  Choose occurrence:{' '}
                  {pendingEdit.starts.map((_, n) => (
                    <button
                      type="button"
                      key={n}
                      onClick={() => remapWord(i, pendingEdit.surface, n)}
                    >
                      Occurrence {n + 1}
                    </button>
                  ))}
                </span>
              )}
            </label>
          ))}
          <label>
            Add word occurrence
            <input
              lang="ja"
              value={addWord}
              onChange={(x) => setAddWord(x.target.value)}
            />
          </label>
          {addWord &&
            graphemeClusters(j).join('').split(addWord).length > 1 && (
              <p>Choose an occurrence:</p>
            )}
          {addWord &&
            Array.from(
              {
                length: Math.max(
                  0,
                  graphemeClusters(j).join('').split(addWord).length - 1,
                ),
              },
              (_, occurrence) => (
                <button
                  key={occurrence}
                  onClick={() => {
                    const text = graphemeClusters(j).join(''),
                      starts: number[] = [];
                    let from = 0,
                      at;
                    while ((at = text.indexOf(addWord, from)) >= 0) {
                      starts.push(at);
                      from = at + 1;
                    }
                    const charAt = starts[occurrence],
                      start = graphemeClusters(text.slice(0, charAt)).length,
                      end = start + graphemeClusters(addWord).length;
                    if (words.some((w) => w.start === start && w.end === end))
                      return setError('That occurrence is already selected');
                    setWords((xs) => [
                      ...xs,
                      {
                        id: crypto.randomUUID(),
                        start,
                        end,
                        surface: addWord,
                        reading: '',
                        selected: true,
                      },
                    ]);
                    setAddWord('');
                  }}
                >
                  Occurrence {occurrence + 1}
                </button>
              ),
            )}
          {addWord && !graphemeClusters(j).join('').includes(addWord) && (
            <p role="alert">No exact occurrence found in this sentence.</p>
          )}
        </>
      )}
      {step >= 2 && step < 2 + selected.length && (
        <label lang="ja">
          {selected[step - 2].surface}
          <input
            value={selected[step - 2].reading}
            onChange={(x) =>
              setWords((xs) =>
                xs.map((w) =>
                  w.id === selected[step - 2].id
                    ? { ...w, reading: x.target.value }
                    : w,
                ),
              )
            }
          />
        </label>
      )}
      {step === 2 + selected.length && (
        <label>
          English
          <input value={e} onChange={(x) => se(x.target.value)} />
        </label>
      )}
      {review && (
        <>
          <p>
            <strong>Japanese:</strong> {j}{' '}
            <button onClick={() => setStep(0)}>Edit</button>
          </p>
          <p>
            <strong>Practice words:</strong>{' '}
            {selected.map((w) => w.surface).join(', ') || 'None'}{' '}
            <button onClick={() => setStep(1)}>Edit</button>
          </p>
          {selected.map((w, i) => (
            <p key={w.id}>
              <strong>{w.surface}</strong> — {normalizeReading(w.reading)}{' '}
              <button onClick={() => setStep(2 + i)}>Edit</button>
            </p>
          ))}
          <p>
            <strong>English:</strong> {e}{' '}
            <button onClick={() => setStep(2 + selected.length)}>Edit</button>
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="incorrect">
          {error}
        </p>
      )}
      <div className="lesson-actions">
        {step > 0 && <button onClick={back}>Back</button>}
        {review ? (
          <button className="primary" onClick={() => void save()}>
            Save locally
          </button>
        ) : (
          <button className="primary" onClick={next}>
            Next
          </button>
        )}
      </div>
    </main>
  );
}
function Sync({
  q,
  setQ,
}: {
  q: PendingChange[];
  setQ: React.Dispatch<React.SetStateAction<PendingChange[]>>;
}) {
  let [busy, sbusy] = useState(false),
    [msg, smsg] = useState('');
  async function sync() {
    const token = localStorage.getItem('github-token') || '';
    if (!token) {
      smsg('Configure a GitHub token in Settings first.');
      return;
    }
    sbusy(true);
    smsg('');
    try {
      const merged = await publish(q, token);
      await saveDataset(merged);
      await Promise.all(q.map((x) => deletePending(x.id)));
      setQ([]);
      smsg('Synced successfully.');
    } catch (e) {
      smsg(
        e instanceof Error ? e.message : 'Sync failed; changes remain queued.',
      );
    } finally {
      sbusy(false);
    }
  }
  return (
    <main>
      <h1>Sync review</h1>
      {q.map((x) => (
        <article key={x.id}>
          {x.type} · {x.sentenceId}
          <button
            onClick={async () => {
              await deletePending(x.id);
              setQ((y) => y.filter((z) => z.id !== x.id));
            }}
          >
            Remove
          </button>
        </article>
      ))}
      <button disabled={!q.length || busy} onClick={() => void sync()}>
        {busy ? 'Syncing…' : 'Sync all'}
      </button>
      {msg && <p role="status">{msg}</p>}
    </main>
  );
}
function Settings() {
  let [t, st] = useState(''),
    [hasToken, setHasToken] = useState(() => {
      try {
        return Boolean(localStorage.getItem('github-token'));
      } catch {
        return false;
      }
    }),
    [status, setStatus] = useState<{
      type: 'success' | 'error';
      text: string;
    }>();
  function saveToken() {
    try {
      if (!t) {
        localStorage.removeItem('github-token');
        setHasToken(false);
        st('');
        setStatus({ type: 'success', text: 'Token cleared.' });
        return;
      }
      localStorage.setItem('github-token', t);
      setHasToken(true);
      st('');
      setStatus({ type: 'success', text: 'Token saved.' });
    } catch {
      setStatus({
        type: 'error',
        text: 'Unable to save the token in this browser. Your token was not changed.',
      });
    }
  }
  function clearToken() {
    try {
      localStorage.removeItem('github-token');
      setHasToken(false);
      st('');
      setStatus({ type: 'success', text: 'Token cleared.' });
    } catch {
      setStatus({
        type: 'error',
        text: 'Unable to clear the token in this browser. Your token was not changed.',
      });
    }
  }
  return (
    <main>
      <h1>Settings</h1>
      <p className="warning">
        Shared-device warning: this browser can access your token and queued
        work.
      </p>
      <p>
        {hasToken ? 'GitHub token configured.' : 'No GitHub token configured.'}
      </p>
      <label>
        GitHub token
        <input
          type="password"
          value={t}
          autoComplete="new-password"
          onChange={(e) => {
            st(e.target.value);
            setStatus(undefined);
          }}
        />
      </label>
      <button disabled={!t} onClick={saveToken}>
        Save token
      </button>
      <button onClick={clearToken}>Clear token</button>
      {status && (
        <p
          role={status.type === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {status.text}
        </p>
      )}
      <p>Queued work is preserved.</p>
      <button
        onClick={async () => {
          const blob = new Blob(
            [JSON.stringify(await exportBackup(), null, 2)],
            { type: 'application/json' },
          );
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `japanese-practice-backup-${new Date().toISOString().slice(0, 10)}.json`;
          link.click();
          URL.revokeObjectURL(link.href);
        }}
      >
        Export backup
      </button>
      <label>
        Import backup
        <input
          type="file"
          accept="application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              await importBackup(JSON.parse(await file.text()), 'merge');
              alert('Backup imported. Reload to see restored work.');
            } catch (error) {
              alert(error instanceof Error ? error.message : 'Invalid backup');
            }
          }}
        />
      </label>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
