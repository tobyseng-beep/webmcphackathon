// A record of what changed on a board, and who changed it.
//
// Every store returns a full snapshot from every tool, which tells an agent how
// things *are* but never that anything moved, let alone who moved it. Without
// that, "the student just did something -- explain it" is unanswerable: the
// agent would have to have cached the previous snapshot and diff it by hand,
// and even then could not tell the student's edit from its own.
//
// So each store keeps one of these. A revision counter answers "has anything
// changed since I last looked" in one comparison, and the log answers "what,
// and by whom".
//
// Only real state changes are recorded. Where the pointer is hovering and what
// is selected are signals of attention rather than changes, and are left out.

/** Who caused a mutation. Anything not inside a tool call is the student. */
export type Actor = 'user' | 'agent';

export interface ChangeEntry {
  /** Board revision immediately after this change. */
  rev: number;
  actor: Actor;
  /** Past-tense verb phrase: "added", "moved", "set value". */
  action: string;
  /** Id of the thing that changed, when the change is about one thing. */
  target?: string;
  /** Value before the change, when there was a meaningful previous value. */
  from?: unknown;
  /** Value after the change. */
  to?: unknown;
  /** Short human-readable summary, so an agent can quote it directly. */
  summary: string;
}

export interface RecordOptions {
  target?: string;
  from?: unknown;
  to?: unknown;
  summary?: string;
  /**
   * Merge into the previous entry when it has the same actor, action and
   * target and arrived within the coalescing window. A slider drag fires
   * continuously; without this the log would be a thousand entries saying the
   * same thing, and "you dragged a from 1 to 2.4" would be unrecoverable.
   */
  coalesce?: boolean;
}

const DEFAULT_CAPACITY = 200;
const COALESCE_MS = 700;

export interface ChangeLog {
  /** Current revision. Changes whenever anything is recorded. */
  revision(): number;
  /** Record a change by the current actor. */
  record(action: string, options?: RecordOptions): void;
  /** Entries after the given revision, oldest first. Omit for everything held. */
  since(rev?: number): ChangeEntry[];
  /** Run `fn` attributed to `actor`; restores the previous actor afterwards. */
  as<T>(actor: Actor, fn: () => T): T;
  /** Who is currently being credited with mutations. */
  actor(): Actor;
  /** Forget the history, e.g. when the board is reset. Revision keeps climbing. */
  clear(): void;
}

export function createChangeLog(capacity = DEFAULT_CAPACITY): ChangeLog {
  let rev = 0;
  let current: Actor = 'user';
  let lastAt = 0;
  const entries: ChangeEntry[] = [];

  return {
    revision: () => rev,
    actor: () => current,

    record(action, options = {}) {
      rev++;
      const now = Date.now();
      const previous = entries[entries.length - 1];

      if (
        options.coalesce && previous
        && previous.actor === current
        && previous.action === action
        && previous.target === options.target
        && now - lastAt < COALESCE_MS
      ) {
        // Keep the original `from` -- the whole point is the span of the drag.
        previous.rev = rev;
        previous.to = options.to;
        if (options.summary) previous.summary = options.summary;
        lastAt = now;
        return;
      }

      entries.push({
        rev,
        actor: current,
        action,
        ...(options.target !== undefined ? { target: options.target } : {}),
        ...(options.from !== undefined ? { from: options.from } : {}),
        ...(options.to !== undefined ? { to: options.to } : {}),
        summary: options.summary ?? action,
      });
      if (entries.length > capacity) entries.shift();
      lastAt = now;
    },

    since(rev0) {
      if (rev0 === undefined) return entries.slice();
      return entries.filter((e) => e.rev > rev0);
    },

    as(actor, fn) {
      const previous = current;
      current = actor;
      // A burst from one actor must not coalesce into the other's entry.
      lastAt = 0;
      try { return fn(); }
      finally { current = previous; lastAt = 0; }
    },

    clear() {
      entries.length = 0;
      lastAt = 0;
    },
  };
}
