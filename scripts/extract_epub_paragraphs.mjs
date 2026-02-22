#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { parse } from 'node-html-parser';

const BOOKS_DIR = path.join(process.cwd(), 'public', 'Books');
const CORPUS_BOOKS_DIR = path.join(process.cwd(), 'public', 'corpus', 'books');
const INDEX_OUTPUT_PATH = path.join(process.cwd(), 'public', 'corpus', 'index.json');

const MIN_PARAGRAPH_LENGTH = 30;
const NORMALIZE_SMART_QUOTES = false;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  trimValues: true
});

function ensureArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function slugifyFilename(epubPath) {
  return path
    .basename(epubPath, path.extname(epubPath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function makeUniqueSlug(baseSlug, usedSlugs) {
  if (!usedSlugs.has(baseSlug)) {
    usedSlugs.add(baseSlug);
    return baseSlug;
  }

  let suffix = 2;
  let nextSlug = `${baseSlug}-${suffix}`;
  while (usedSlugs.has(nextSlug)) {
    suffix += 1;
    nextSlug = `${baseSlug}-${suffix}`;
  }

  usedSlugs.add(nextSlug);
  return nextSlug;
}

async function listEpubs() {
  const entries = await fs.readdir(BOOKS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.epub$/i.test(entry.name))
    .map((entry) => path.join(BOOKS_DIR, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function parseXml(xmlText, sourceLabel) {
  try {
    return xmlParser.parse(xmlText);
  } catch (error) {
    throw new Error(`Failed to parse XML (${sourceLabel}): ${error.message}`);
  }
}

function getOpfPathFromContainer(containerXml) {
  const parsed = parseXml(containerXml, 'META-INF/container.xml');
  const rootFiles = ensureArray(parsed?.container?.rootfiles?.rootfile);

  for (const rootFile of rootFiles) {
    const fullPath = rootFile?.['full-path'] || rootFile?.fullPath;
    if (fullPath) {
      return path.posix.normalize(fullPath);
    }
  }

  throw new Error('container.xml did not provide a valid OPF package path.');
}

function isHtmlLikeSpineItem(manifestItem) {
  const mediaType = String(manifestItem?.mediaType || '').toLowerCase();
  const href = String(manifestItem?.href || '');

  if (mediaType.includes('xhtml') || mediaType.includes('html')) {
    return true;
  }

  return /\.(xhtml?|html?)$/i.test(href);
}

function parseOpf(opfXml, opfPath) {
  const parsed = parseXml(opfXml, opfPath);
  const packageNode = parsed?.package;

  if (!packageNode) {
    throw new Error(`OPF package node is missing: ${opfPath}`);
  }

  const manifestItems = ensureArray(packageNode?.manifest?.item);
  const spineItems = ensureArray(packageNode?.spine?.itemref);
  const manifestById = new Map();

  for (const item of manifestItems) {
    const id = item?.id;
    const href = item?.href;
    if (!id || !href) {
      continue;
    }

    manifestById.set(id, {
      href,
      mediaType: item?.['media-type'] || item?.mediaType || ''
    });
  }

  const opfDir = path.posix.dirname(opfPath);
  const spinePaths = [];

  for (const itemRef of spineItems) {
    if (String(itemRef?.linear || 'yes').toLowerCase() === 'no') {
      continue;
    }

    const idRef = itemRef?.idref;
    const manifestItem = manifestById.get(idRef);

    if (!manifestItem || !isHtmlLikeSpineItem(manifestItem)) {
      continue;
    }

    const absoluteZipPath = path.posix.normalize(
      path.posix.join(opfDir, manifestItem.href)
    );

    spinePaths.push(absoluteZipPath);
  }

  return spinePaths;
}

function isLikelyFootnoteLink(anchorNode) {
  const href = String(anchorNode.getAttribute('href') || '').toLowerCase().trim();
  const className = String(anchorNode.getAttribute('class') || '').toLowerCase();
  const role = String(anchorNode.getAttribute('role') || '').toLowerCase();
  const epubType = String(anchorNode.getAttribute('epub:type') || '').toLowerCase();
  const id = String(anchorNode.getAttribute('id') || '').toLowerCase();
  const anchorText = String(anchorNode.text || '').trim();

  if (epubType.includes('noteref') || role.includes('doc-noteref')) {
    return true;
  }

  if (/(footnote|endnote|note-ref|noteref)/.test(className)) {
    return true;
  }

  if (/(footnote|endnote|note-ref|noteref)/.test(id)) {
    return true;
  }

  if (/(#fn\b|#footnote\b|#note\b|#en\b|footnote|endnote|noteref)/.test(href)) {
    return true;
  }

  if (
    href.startsWith('#') &&
    /^(\[?\(?\d{1,3}\)?\]?|[ivxlcdm]{1,8}|[*])$/i.test(anchorText)
  ) {
    return true;
  }

  return false;
}

function normalizeParagraph(inputText) {
  let normalized = String(inputText || '').replace(/\u00A0/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return '';
  }

  if (NORMALIZE_SMART_QUOTES) {
    normalized = normalized
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u2013\u2014]/g, '-');
  }

  return normalized;
}

function isLikelyBoilerplate(paragraphText) {
  if (paragraphText.length < MIN_PARAGRAPH_LENGTH) {
    return true;
  }

  const text = paragraphText.trim();
  const lower = text.toLowerCase();

  if (
    /^(chapter|book|section)\b/.test(lower) &&
    text.length < 110
  ) {
    return true;
  }

  if (
    /^(contents?|table of contents|illustration|illustrations|preface|introduction|appendix|endnotes?|footnotes?|notes?)\b/.test(lower)
  ) {
    return true;
  }

  if (/project gutenberg/.test(lower) || /\.{3,}/.test(text)) {
    return true;
  }

  const lettersOnly = text.replace(/[^a-z]/gi, '');
  if (lettersOnly.length > 0) {
    const uppercaseCount = lettersOnly.replace(/[^A-Z]/g, '').length;
    const uppercaseRatio = uppercaseCount / lettersOnly.length;
    if (text.length < 130 && uppercaseRatio > 0.85) {
      return true;
    }
  }

  return false;
}

function extractParagraphsFromXhtml(xhtmlContent) {
  const root = parse(xhtmlContent, {
    lowerCaseTagName: true,
    comment: false,
    blockTextElements: {
      script: false,
      style: false,
      pre: false
    }
  });

  const ignoredContainers = [
    'nav',
    'header',
    'footer',
    'aside',
    'ol',
    'ul',
    'h1',
    'h2',
    'h3',
    'figure',
    'figcaption',
    'script',
    'style'
  ];

  for (const selector of ignoredContainers) {
    for (const node of root.querySelectorAll(selector)) {
      node.remove();
    }
  }

  const paragraphs = [];

  for (const paragraphNode of root.querySelectorAll('p')) {
    for (const supNode of paragraphNode.querySelectorAll('sup')) {
      supNode.remove();
    }

    for (const anchorNode of paragraphNode.querySelectorAll('a')) {
      if (isLikelyFootnoteLink(anchorNode)) {
        anchorNode.remove();
      }
    }

    const paragraph = normalizeParagraph(paragraphNode.text);
    if (!paragraph || isLikelyBoilerplate(paragraph)) {
      continue;
    }

    paragraphs.push(paragraph);
  }

  return paragraphs;
}

async function readZipText(zip, zipPath) {
  const candidatePaths = new Set();
  candidatePaths.add(zipPath);
  candidatePaths.add(zipPath.replace(/\\/g, '/'));
  candidatePaths.add(zipPath.replace(/^\.\/+/, ''));

  try {
    candidatePaths.add(decodeURI(zipPath));
  } catch (error) {
    // Ignore malformed URI sequences.
  }

  try {
    candidatePaths.add(encodeURI(zipPath));
  } catch (error) {
    // Ignore malformed URI sequences.
  }

  for (const candidate of candidatePaths) {
    if (!candidate) {
      continue;
    }

    const zipEntry = zip.file(candidate);
    if (zipEntry) {
      return zipEntry.async('string');
    }
  }

  const fallback = Object.keys(zip.files).find(
    (fileName) => fileName.toLowerCase() === zipPath.toLowerCase()
  );

  if (fallback) {
    return zip.file(fallback).async('string');
  }

  throw new Error(`Missing entry in EPUB archive: ${zipPath}`);
}

function dedupeConsecutiveParagraphs(paragraphs) {
  const deduped = [];

  for (const paragraph of paragraphs) {
    if (deduped[deduped.length - 1] !== paragraph) {
      deduped.push(paragraph);
    }
  }

  return deduped;
}

async function extractEpub(epubPath) {
  const zipBuffer = await fs.readFile(epubPath);
  const zip = await JSZip.loadAsync(zipBuffer);

  const containerXml = await readZipText(zip, 'META-INF/container.xml');
  const opfPath = getOpfPathFromContainer(containerXml);
  const opfXml = await readZipText(zip, opfPath);
  const spinePaths = parseOpf(opfXml, opfPath);

  const paragraphs = [];
  const epubName = path.basename(epubPath);

  for (const spinePath of spinePaths) {
    try {
      const xhtmlContent = await readZipText(zip, spinePath);
      paragraphs.push(...extractParagraphsFromXhtml(xhtmlContent));
    } catch (error) {
      console.warn(`  [warn] ${epubName}: skipped ${spinePath} (${error.message})`);
    }
  }

  return dedupeConsecutiveParagraphs(paragraphs);
}

async function main() {
  await fs.mkdir(CORPUS_BOOKS_DIR, { recursive: true });

  const epubFiles = await listEpubs();

  if (epubFiles.length === 0) {
    await fs.mkdir(path.dirname(INDEX_OUTPUT_PATH), { recursive: true });
    await fs.writeFile(INDEX_OUTPUT_PATH, '[]\n', 'utf8');
    console.log('No EPUB files found in public/Books. Wrote empty public/corpus/index.json');
    return;
  }

  const corpusIndex = [];
  const usedSlugs = new Set();
  let totalParagraphs = 0;
  let failedCount = 0;

  for (const [fileIndex, epubPath] of epubFiles.entries()) {
    const epubName = path.basename(epubPath);
    console.log(`[${fileIndex + 1}/${epubFiles.length}] Extracting ${epubName}`);

    try {
      const extractedParagraphs = await extractEpub(epubPath);
      const baseSlug = slugifyFilename(epubPath);
      const slug = makeUniqueSlug(baseSlug, usedSlugs);
      const outputFilePath = path.join(CORPUS_BOOKS_DIR, `${slug}.txt`);
      const outputText = extractedParagraphs.join('\n\n');

      await fs.writeFile(
        outputFilePath,
        outputText ? `${outputText}\n` : '',
        'utf8'
      );

      corpusIndex.push({
        slug,
        sourceFile: `public/Books/${epubName}`,
        path: `/corpus/books/${slug}.txt`,
        paragraphCount: extractedParagraphs.length
      });

      totalParagraphs += extractedParagraphs.length;

      console.log(
        `  [ok] ${extractedParagraphs.length} paragraphs -> public/corpus/books/${slug}.txt`
      );
    } catch (error) {
      failedCount += 1;
      console.error(`  [error] Failed ${epubName}: ${error.message}`);
    }
  }

  await fs.mkdir(path.dirname(INDEX_OUTPUT_PATH), { recursive: true });
  await fs.writeFile(
    INDEX_OUTPUT_PATH,
    `${JSON.stringify(corpusIndex, null, 2)}\n`,
    'utf8'
  );

  console.log(
    `Done. Processed ${epubFiles.length - failedCount}/${epubFiles.length} EPUB files.`
  );
  console.log(`Total paragraphs extracted: ${totalParagraphs}`);
}

main().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  process.exitCode = 1;
});
