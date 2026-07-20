'use strict';

const fs = require('fs');
const path = require('path');
const { PATHS } = require('./config');

/**
 * Read every resume file in resume/ (except README.md) and return a single
 * concatenated text blob. Supports .md, .txt, and .pdf.
 */
async function loadResumeText() {
  const dir = PATHS.resumeDir;
  if (!fs.existsSync(dir)) return '';

  const files = fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith('.') && f.toLowerCase() !== 'readme.md')
    .map((f) => path.join(dir, f))
    .filter((f) => fs.statSync(f).isFile());

  const parts = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    try {
      if (ext === '.md' || ext === '.txt') {
        parts.push(fs.readFileSync(file, 'utf8'));
      } else if (ext === '.pdf') {
        parts.push(await parsePdf(file));
      } else {
        // Unknown extension — try to read as text, ignore if binary garbage.
        parts.push(fs.readFileSync(file, 'utf8'));
      }
    } catch (err) {
      console.warn(`[resume] could not read ${path.basename(file)}: ${err.message}`);
    }
  }

  return parts.join('\n\n---\n\n').trim();
}

async function parsePdf(file) {
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch {
    throw new Error(
      'pdf-parse is not installed — run `npm install` or export your resume to .md/.txt'
    );
  }
  const data = await pdfParse(fs.readFileSync(file));
  return data.text || '';
}

function hasResume() {
  const dir = PATHS.resumeDir;
  if (!fs.existsSync(dir)) return false;
  return fs
    .readdirSync(dir)
    .some((f) => !f.startsWith('.') && f.toLowerCase() !== 'readme.md');
}

module.exports = { loadResumeText, hasResume };
