const CORPUS_INDEX_PATH = '/corpus/index.json';
const CORPUS_BOOK_PATH_REGEX = /^\/corpus\/books\/[a-z0-9-]+\.txt$/;
const DEFAULT_INITIAL_BUFFER_CHARS = 24000;
const DEFAULT_APPEND_CHUNK_CHARS = 4000;
const MIN_TAIL_GUARD_CHARS = 12000;

let corpusIndexPromise = null;
const textCache = new Map();
let preloadedSessionPromise = null;
let preloadedSessionChars = DEFAULT_INITIAL_BUFFER_CHARS;

function randomInt(maxExclusive) {
  if (maxExclusive <= 0) {
    return 0;
  }

  return Math.floor(Math.random() * maxExclusive);
}

function findSafeBoundary(text, startOffset) {
  if (!text) {
    return 0;
  }

  let offset = Math.max(0, Math.min(startOffset, text.length - 1));

  while (offset < text.length && !/\s/.test(text[offset])) {
    offset += 1;
  }

  while (offset < text.length && /\s/.test(text[offset])) {
    offset += 1;
  }

  return offset < text.length ? offset : 0;
}

function pickRandomStartOffset(text) {
  if (!text) {
    return 0;
  }

  const maxOffset = Math.max(0, text.length - MIN_TAIL_GUARD_CHARS);
  const roughOffset = randomInt(maxOffset + 1);
  return findSafeBoundary(text, roughOffset);
}

function pickRandomBookEntry(index) {
  return index[randomInt(index.length)];
}

function isValidCorpusBookPath(pathValue) {
  return typeof pathValue === 'string' && CORPUS_BOOK_PATH_REGEX.test(pathValue);
}

function sanitizeLoadedText(rawText) {
  return String(rawText || '').trim();
}

async function fetchText(path) {
  if (!isValidCorpusBookPath(path)) {
    throw new Error(`Rejected unexpected corpus path: ${path}`);
  }

  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${path} (${response.status})`);
  }

  return response.text();
}

export async function loadCorpusIndex() {
  if (!corpusIndexPromise) {
    corpusIndexPromise = fetch(CORPUS_INDEX_PATH)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch corpus index (${response.status})`);
        }

        return response.json();
      })
      .then((index) => {
        if (!Array.isArray(index) || index.length === 0) {
          throw new Error('Corpus index is empty or invalid.');
        }

        const validEntries = index.filter((entry) => entry && isValidCorpusBookPath(entry.path));
        if (!validEntries.length) {
          throw new Error('Corpus index contains no valid entries.');
        }

        return validEntries;
      });
  }

  return corpusIndexPromise;
}

export async function loadBookText(entry) {
  if (!entry?.path || !isValidCorpusBookPath(entry.path)) {
    throw new Error('Invalid corpus entry: missing path.');
  }

  if (!textCache.has(entry.path)) {
    const textPromise = fetchText(entry.path).then((rawText) => {
      const text = sanitizeLoadedText(rawText);

      if (text.length < 500) {
        throw new Error(`Corpus book is too short: ${entry.path}`);
      }

      return text;
    });

    textCache.set(entry.path, textPromise);
  }

  return textCache.get(entry.path);
}

class CorpusSessionStream {
  constructor(bookEntry, bookText) {
    this.bookEntry = bookEntry;
    this.bookText = bookText;
    this.cursor = pickRandomStartOffset(bookText);
  }

  nextChunk(targetChars = DEFAULT_APPEND_CHUNK_CHARS) {
    let chunk = '';

    while (chunk.length < targetChars) {
      if (this.cursor >= this.bookText.length) {
        // End reached: wrap to a fresh random offset in the same book for endless flow.
        this.cursor = pickRandomStartOffset(this.bookText);

        if (chunk && !/\s$/.test(chunk)) {
          chunk += ' ';
        }
      }

      const remaining = this.bookText.length - this.cursor;
      if (remaining <= 0) {
        break;
      }

      const needed = targetChars - chunk.length;
      const takeLength = Math.min(needed, remaining);
      chunk += this.bookText.slice(this.cursor, this.cursor + takeLength);
      this.cursor += takeLength;
    }

    return chunk;
  }

  ensureLength(currentText, minLength) {
    let next = currentText;

    while (next.length < minLength) {
      const charsNeeded = Math.max(DEFAULT_APPEND_CHUNK_CHARS, minLength - next.length);
      next += this.nextChunk(charsNeeded);
    }

    return next;
  }

  createInitialBuffer(minLength = DEFAULT_INITIAL_BUFFER_CHARS) {
    return this.ensureLength('', minLength);
  }
}

async function createSessionPayload(initialChars = DEFAULT_INITIAL_BUFFER_CHARS) {
  const index = await loadCorpusIndex();
  const entry = pickRandomBookEntry(index);
  const text = await loadBookText(entry);
  const stream = new CorpusSessionStream(entry, text);

  return {
    entry,
    stream,
    initialText: stream.createInitialBuffer(initialChars)
  };
}

export function preloadCorpusSession(options = {}) {
  const { initialChars = DEFAULT_INITIAL_BUFFER_CHARS } = options;

  if (!preloadedSessionPromise || preloadedSessionChars !== initialChars) {
    preloadedSessionChars = initialChars;
    preloadedSessionPromise = createSessionPayload(initialChars).catch((error) => {
      preloadedSessionPromise = null;
      throw error;
    });
  }

  return preloadedSessionPromise;
}

function primeNextCorpusSession(initialChars = DEFAULT_INITIAL_BUFFER_CHARS) {
  preloadedSessionChars = initialChars;
  preloadedSessionPromise = createSessionPayload(initialChars).catch(() => {
    preloadedSessionPromise = null;
    return null;
  });
}

export async function consumePreloadedCorpusSession(options = {}) {
  const { initialChars = DEFAULT_INITIAL_BUFFER_CHARS } = options;
  const usePreloaded = preloadedSessionPromise && preloadedSessionChars === initialChars;

  const sessionPromise = usePreloaded
    ? preloadedSessionPromise
    : createSessionPayload(initialChars);

  if (usePreloaded) {
    preloadedSessionPromise = null;
  }

  let session = await sessionPromise;

  if (!session?.stream || typeof session.initialText !== 'string') {
    session = await createSessionPayload(initialChars);
  }

  // Keep the next session warm to make repeated starts feel immediate.
  primeNextCorpusSession(initialChars);

  return session;
}

export async function createCorpusSession(options = {}) {
  const { initialChars = DEFAULT_INITIAL_BUFFER_CHARS } = options;
  return createSessionPayload(initialChars);
}
