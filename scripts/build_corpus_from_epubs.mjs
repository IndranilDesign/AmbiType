#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { parse } from 'node-html-parser';

const INPUT_BOOKS_DIR = path.join(process.cwd(), 'public', 'Books');
const OUTPUT_BOOKS_DIR = path.join(process.cwd(), 'public', 'corpus', 'books');
const OUTPUT_INDEX_PATH = path.join(process.cwd(), 'public', 'corpus', 'index.json');
const MIN_PARAGRAPH_CHARS = 30;
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\u2060\uFEFF]/gu;
const UNICODE_SPACES_REGEX = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/gu;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  trimValues: true
});

function toArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleFromFilename(filePath) {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseXml(text, sourceLabel) {
  try {
    return xmlParser.parse(text);
  } catch (error) {
    throw new Error(`Failed parsing XML (${sourceLabel}): ${error.message}`);
  }
}

function normalizeParagraph(text) {
  return String(text || '')
    .replace(ZERO_WIDTH_REGEX, '')
    .replace(UNICODE_SPACES_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyBoilerplate(paragraph) {
  if (paragraph.length < MIN_PARAGRAPH_CHARS) {
    return true;
  }

  const lowered = paragraph.toLowerCase();

  if (/^(chapter|contents?|table of contents|book)\b/.test(lowered)) {
    return true;
  }

  if (/^(illustration|illustrations|footnotes?|endnotes?|notes?)\b/.test(lowered)) {
    return true;
  }

  return false;
}

function nodeMeta(node) {
  const className = String(node.getAttribute('class') || '').toLowerCase();
  const id = String(node.getAttribute('id') || '').toLowerCase();
  const role = String(node.getAttribute('role') || '').toLowerCase();
  const epubType = String(node.getAttribute('epub:type') || '').toLowerCase();

  return `${className} ${id} ${role} ${epubType}`;
}

function shouldSkipParagraphNode(paragraphNode) {
  let node = paragraphNode.parentNode;

  while (node) {
    const tagName = String(node.tagName || '').toLowerCase();
    if (
      tagName === 'nav' ||
      tagName === 'header' ||
      tagName === 'footer' ||
      tagName === 'aside' ||
      tagName === 'ol' ||
      tagName === 'ul' ||
      tagName === 'h1' ||
      tagName === 'h2' ||
      tagName === 'h3'
    ) {
      return true;
    }

    const meta = nodeMeta(node);
    if (
      /(toc|contents?|footnote|endnote|bibliography|glossary|index|appendix)/.test(meta)
    ) {
      return true;
    }

    node = node.parentNode;
  }

  return false;
}

function isFootnoteAnchor(anchorNode) {
  const href = String(anchorNode.getAttribute('href') || '').toLowerCase();
  const meta = nodeMeta(anchorNode);
  const anchorText = String(anchorNode.text || '').trim();

  if (
    /(footnote|endnote|noteref|doc-noteref|doc-footnote|doc-endnote)/.test(
      `${href} ${meta}`
    )
  ) {
    return true;
  }

  if (href.startsWith('#') && /^(\[?\(?\d{1,3}\)?\]?|[ivxlcdm]{1,8}|[*])$/i.test(anchorText)) {
    return true;
  }

  return false;
}

function extractParagraphsFromHtml(htmlText) {
  const root = parse(htmlText, {
    lowerCaseTagName: true,
    comment: false
  });

  const paragraphs = [];
  for (const paragraphNode of root.querySelectorAll('p')) {
    if (shouldSkipParagraphNode(paragraphNode)) {
      continue;
    }

    for (const sup of paragraphNode.querySelectorAll('sup')) {
      sup.remove();
    }

    for (const anchorNode of paragraphNode.querySelectorAll('a')) {
      if (isFootnoteAnchor(anchorNode)) {
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

async function listEpubFiles() {
  const entries = await fs.readdir(INPUT_BOOKS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.epub$/i.test(entry.name))
    .map((entry) => path.join(INPUT_BOOKS_DIR, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

async function readZipText(zip, targetPath) {
  const normalized = targetPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  const candidates = [normalized];

  try {
    candidates.push(decodeURI(normalized));
  } catch (error) {
    // Ignore malformed URI sequences.
  }

  try {
    candidates.push(encodeURI(normalized));
  } catch (error) {
    // Ignore malformed URI sequences.
  }

  for (const candidate of candidates) {
    const entry = zip.file(candidate);
    if (entry) {
      return entry.async('string');
    }
  }

  const fallback = Object.keys(zip.files).find(
    (name) => name.toLowerCase() === normalized.toLowerCase()
  );

  if (fallback) {
    return zip.file(fallback).async('string');
  }

  throw new Error(`Missing EPUB archive entry: ${targetPath}`);
}

function findOpfPath(containerXml) {
  const container = parseXml(containerXml, 'META-INF/container.xml');
  const rootFiles = toArray(container?.container?.rootfiles?.rootfile);

  for (const rootFile of rootFiles) {
    const fullPath = rootFile?.['full-path'] || rootFile?.fullPath;
    if (fullPath) {
      return path.posix.normalize(fullPath);
    }
  }

  throw new Error('Unable to locate OPF package path in container.xml');
}

function parseOpfSpine(opfXml, opfPath) {
  const opf = parseXml(opfXml, opfPath)?.package;
  if (!opf) {
    throw new Error(`Invalid OPF package: ${opfPath}`);
  }

  const manifestItems = toArray(opf?.manifest?.item);
  const spineRefs = toArray(opf?.spine?.itemref);
  const manifestById = new Map();

  for (const item of manifestItems) {
    const id = item?.id;
    const href = item?.href;
    if (!id || !href) {
      continue;
    }

    manifestById.set(id, {
      href,
      mediaType: String(item?.['media-type'] || item?.mediaType || '').toLowerCase()
    });
  }

  const opfDir = path.posix.dirname(opfPath);
  const spinePaths = [];

  for (const spineRef of spineRefs) {
    if (String(spineRef?.linear || 'yes').toLowerCase() === 'no') {
      continue;
    }

    const manifestItem = manifestById.get(spineRef?.idref);
    if (!manifestItem) {
      continue;
    }

    const isHtml =
      manifestItem.mediaType.includes('xhtml') ||
      manifestItem.mediaType.includes('html') ||
      /\.(xhtml?|html?)$/i.test(manifestItem.href);
    if (!isHtml) {
      continue;
    }

    spinePaths.push(
      path.posix.normalize(path.posix.join(opfDir, manifestItem.href))
    );
  }

  return spinePaths;
}

async function extractEpubParagraphs(epubPath) {
  const zipBuffer = await fs.readFile(epubPath);
  const zip = await JSZip.loadAsync(zipBuffer);

  const containerXml = await readZipText(zip, 'META-INF/container.xml');
  const opfPath = findOpfPath(containerXml);
  const opfXml = await readZipText(zip, opfPath);
  const spinePaths = parseOpfSpine(opfXml, opfPath);

  const paragraphs = [];
  for (const spinePath of spinePaths) {
    try {
      const htmlText = await readZipText(zip, spinePath);
      paragraphs.push(...extractParagraphsFromHtml(htmlText));
    } catch (error) {
      console.warn(
        `  [warn] ${path.basename(epubPath)}: skipped ${spinePath} (${error.message})`
      );
    }
  }

  return paragraphs;
}

async function buildCorpus() {
  await fs.mkdir(OUTPUT_BOOKS_DIR, { recursive: true });

  const epubFiles = await listEpubFiles();
  if (epubFiles.length === 0) {
    await fs.mkdir(path.dirname(OUTPUT_INDEX_PATH), { recursive: true });
    await fs.writeFile(OUTPUT_INDEX_PATH, '[]\n', 'utf8');
    console.log('No EPUB files found in public/Books. Wrote empty index.json');
    return;
  }

  const entries = [];
  const usedIds = new Set();
  let totalParagraphs = 0;

  for (const [index, epubPath] of epubFiles.entries()) {
    const sourceName = path.basename(epubPath);
    console.log(`[${index + 1}/${epubFiles.length}] Processing ${sourceName}`);

    try {
      const paragraphs = await extractEpubParagraphs(epubPath);
      totalParagraphs += paragraphs.length;

      const baseId = slugify(path.basename(epubPath, path.extname(epubPath)));
      const idRoot = baseId || `book-${index + 1}`;
      let id = idRoot;
      let dedupeSuffix = 2;
      while (usedIds.has(id)) {
        id = `${idRoot}-${dedupeSuffix}`;
        dedupeSuffix += 1;
      }
      usedIds.add(id);

      const outputPath = path.join(OUTPUT_BOOKS_DIR, `${id}.txt`);
      const outputText = paragraphs.join('\n\n');

      await fs.writeFile(outputPath, outputText ? `${outputText}\n` : '', 'utf8');
      const { size } = await fs.stat(outputPath);

      entries.push({
        id,
        title: titleFromFilename(epubPath),
        path: `/corpus/books/${id}.txt`,
        bytes: size
      });

      console.log(`  [ok] ${paragraphs.length} paragraphs -> public/corpus/books/${id}.txt`);
    } catch (error) {
      console.error(`  [error] ${sourceName}: ${error.message}`);
    }
  }

  await fs.mkdir(path.dirname(OUTPUT_INDEX_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_INDEX_PATH, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');

  console.log(`Done. Built ${entries.length}/${epubFiles.length} books.`);
  console.log(`Total paragraphs extracted: ${totalParagraphs}`);
}

buildCorpus().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  process.exitCode = 1;
});
