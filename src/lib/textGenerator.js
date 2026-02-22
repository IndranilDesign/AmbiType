const WORD_BANK = [
  'lorem',
  'ipsum',
  'dolor',
  'sit',
  'amet',
  'consectetur',
  'adipiscing',
  'elit',
  'urna',
  'turpis',
  'tempus',
  'nulla',
  'libero',
  'imperdiet',
  'mauris',
  'iaculis',
  'faucibus',
  'pellentesque',
  'vestibulum',
  'magna',
  'justo',
  'suscipit',
  'augue',
  'neque',
  'dignissim',
  'viverra',
  'aliquam',
  'donec',
  'rutrum',
  'mattis',
  'quisque',
  'gravida',
  'curabitur',
  'phasellus',
  'blandit',
  'porta',
  'lectus',
  'sollicitudin',
  'fringilla',
  'efficitur',
  'placerat',
  'sapien',
  'fermentum',
  'volutpat',
  'elementum',
  'commodo',
  'tristique',
  'auctor',
  'pulvinar',
  'lacinia'
];

const SENTENCE_ENDINGS = ['.', '.', '.', '.', '.', '?'];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function capitalizeFirst(word) {
  if (!word) {
    return '';
  }

  return `${word[0].toUpperCase()}${word.slice(1)}`;
}

function randomWord() {
  return WORD_BANK[randomInt(0, WORD_BANK.length - 1)];
}

function createSentence() {
  const wordCount = randomInt(8, 16);
  const words = [];

  for (let index = 0; index < wordCount; index += 1) {
    words.push(randomWord());
  }

  words[0] = capitalizeFirst(words[0]);

  if (wordCount > 10 && Math.random() > 0.5) {
    const commaPosition = randomInt(3, wordCount - 3);
    words[commaPosition] = `${words[commaPosition]},`;
  }

  const ending = SENTENCE_ENDINGS[randomInt(0, SENTENCE_ENDINGS.length - 1)];
  words[wordCount - 1] = `${words[wordCount - 1]}${ending}`;

  return words.join(' ');
}

function createParagraph() {
  const sentenceCount = randomInt(3, 5);
  const sentences = [];

  for (let index = 0; index < sentenceCount; index += 1) {
    sentences.push(createSentence());
  }

  return `${sentences.join(' ')} `;
}

export function generateChunk(targetCharacters = 1200) {
  let chunk = '';

  while (chunk.length < targetCharacters) {
    chunk += createParagraph();
  }

  return chunk;
}

export function createTextBuffer(minLength = 3200) {
  return generateChunk(minLength);
}

export function extendTextBuffer(currentText, minLength) {
  if (currentText.length >= minLength) {
    return currentText;
  }

  let next = currentText;

  while (next.length < minLength) {
    next += generateChunk(1200);
  }

  return next;
}
