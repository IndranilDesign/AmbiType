const CORPUS_INDEX_PATH = '/corpus/index.json';
const DEFAULT_INITIAL_BUFFER_CHARS = 24000;
const DEFAULT_APPEND_CHUNK_CHARS = 4000;
const MIN_TAIL_GUARD_CHARS = 12000;
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\u2060\uFEFF]/gu;
const UNICODE_SPACES_REGEX = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/gu;

let corpusIndexPromise = null;
const textCache = new Map();

function randomInt(maxExclusive) {
  if (maxExclusive <= 0) {
    return 0;
  }

  return Math.floor(Math.random() * maxExclusive);
}

function normalizeBookText(rawText) {
  return String(rawText || '')
    .replace(/\r\n/g, '\n')
    .replace(ZERO_WIDTH_REGEX, '')
    .replace(UNICODE_SPACES_REGEX, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

async function fetchText(path) {
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

        return index.filter(
          (entry) => entry && typeof entry.path === 'string' && entry.path.length > 0
        );
      });
  }

  return corpusIndexPromise;
}

export async function loadBookText(entry) {
  if (!entry?.path) {
    throw new Error('Invalid corpus entry: missing path.');
  }

  if (!textCache.has(entry.path)) {
    const textPromise = fetchText(entry.path).then((rawText) => {
      const normalized = normalizeBookText(rawText);

      if (normalized.length < 500) {
        throw new Error(`Corpus book is too short: ${entry.path}`);
      }

      return normalized;
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

        if (chunk && !chunk.endsWith('\n\n')) {
          chunk += '\n\n';
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

export async function createCorpusSession(options = {}) {
  const { initialChars = DEFAULT_INITIAL_BUFFER_CHARS } = options;
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
