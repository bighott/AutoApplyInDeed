'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Load .env from the project root (one level up from src/).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');

let _criteria = null;

/** Load and cache criteria.yaml. */
function loadCriteria() {
  if (_criteria) return _criteria;
  const file = path.join(ROOT, 'criteria.yaml');
  if (!fs.existsSync(file)) {
    throw new Error(`criteria.yaml not found at ${file}`);
  }
  _criteria = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  return _criteria;
}

function apifyToken() {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error('APIFY_TOKEN is not set. Copy .env.example to .env and fill it in.');
  return t;
}

/** Never log the token — expose only a masked form for diagnostics. */
function maskedApifyToken() {
  const t = process.env.APIFY_TOKEN || '';
  if (!t) return '(unset)';
  return `${t.slice(0, 6)}…${t.slice(-2)}`;
}

const PATHS = {
  root: ROOT,
  db: path.join(ROOT, 'jobs.db'),
  resumeDir: path.join(ROOT, 'resume'),
  digestDir: path.join(ROOT, 'digest'),
};

module.exports = { loadCriteria, apifyToken, maskedApifyToken, PATHS };
