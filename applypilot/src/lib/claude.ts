/**
 * Claude API client.
 *
 * Three jobs:
 *   1. analyzeResume()  -> { score, feedback, skills }
 *   2. answerScreeningQuestion() -> best answer given profile + resume
 *
 * Design notes:
 *  - We call the Anthropic Messages API directly from the extension. Browser/
 *    extension callers must send `anthropic-dangerous-direct-browser-access`.
 *  - We use a STRICT JSON-output system prompt and parse defensively: Claude
 *    occasionally wraps JSON in prose or code fences, so we extract the first
 *    balanced JSON object before parsing.
 *  - Model name comes from the single CLAUDE_MODEL config constant.
 */

import {
  ANTHROPIC_VERSION,
  CLAUDE_API_URL,
  CLAUDE_MAX_TOKENS,
  CLAUDE_MODEL,
} from './config';
import type {
  ResumeAnalysis,
  ScreeningAnswer,
  ScreeningQuestion,
  UserProfile,
} from './types';

interface ClaudeTextBlock {
  type: string;
  text?: string;
}
interface ClaudeResponse {
  content?: ClaudeTextBlock[];
  error?: { message?: string };
}

/** Low-level call to the Messages API. Returns the concatenated text output. */
async function callClaude(
  apiKey: string,
  system: string,
  userContent: string,
): Promise<string> {
  if (!apiKey) throw new Error('No Anthropic API key configured (see Settings).');

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // Required for direct browser/extension access to the Anthropic API.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  const data = (await res.json()) as ClaudeResponse;
  if (!res.ok) {
    const msg = data?.error?.message || `Claude API error (HTTP ${res.status})`;
    throw new Error(msg);
  }
  const text = (data.content || [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
    .trim();
  if (!text) throw new Error('Claude returned an empty response.');
  return text;
}

/**
 * Extract the first balanced JSON object/array from a string and parse it.
 * Defensive against code fences and stray prose around the JSON.
 */
function parseJsonLoose<T>(raw: string): T {
  // Strip markdown code fences if present.
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // Find the first balanced { ... } (or [ ... ]) region.
  const start = s.search(/[{[]/);
  if (start === -1) throw new Error('No JSON found in Claude response.');
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error('Unbalanced JSON in Claude response.');
  return JSON.parse(s.slice(start, end + 1)) as T;
}

// --- 1. Resume scoring + skills ----------------------------------------------

const RESUME_SYSTEM = `You are an expert technical recruiter and resume coach.
You will be given the plain text of a candidate's resume.
Respond with ONLY a single JSON object, no prose, no markdown, with this exact shape:
{
  "score": <integer 1-10, overall resume strength>,
  "feedback": [<3-7 short, specific, actionable improvement strings>],
  "skills": [<up to 25 concrete skills/technologies found or strongly implied, deduplicated, each 1-4 words>]
}
Be specific in feedback (e.g. "Quantify the impact of the 2022 migration with metrics"), not generic.`;

export async function analyzeResume(
  apiKey: string,
  resumeText: string,
): Promise<ResumeAnalysis> {
  const trimmed = resumeText.slice(0, 24000); // keep request small
  const raw = await callClaude(
    apiKey,
    RESUME_SYSTEM,
    `Here is the resume text:\n\n${trimmed}`,
  );
  const parsed = parseJsonLoose<Partial<ResumeAnalysis>>(raw);

  const score = clampScore(parsed.score);
  const feedback = Array.isArray(parsed.feedback)
    ? parsed.feedback.map(String).filter(Boolean).slice(0, 10)
    : [];
  const skills = Array.isArray(parsed.skills)
    ? dedupe(parsed.skills.map((s) => String(s).trim()).filter(Boolean)).slice(
        0,
        40,
      )
    : [];
  return { score, feedback, skills };
}

function clampScore(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.round(n)));
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const key = s.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

// --- 2. Screening-question answering -----------------------------------------

const SCREENING_SYSTEM = `You are helping a job applicant answer an employer screening question on a job application.
You are given the applicant's profile, their accepted skills, their resume text, and one screening question (optionally with multiple-choice options).
Answer truthfully and concisely as the applicant, using only the information provided. Do not invent qualifications.
If multiple-choice options are provided, your "answer" MUST be exactly one of the provided option strings.
Flag the question as high-stakes (highStakes=true) if it concerns visa/sponsorship, salary expectations, or a specific number of years of experience the resume does not clearly support.
Respond with ONLY a single JSON object, no prose, no markdown:
{
  "answer": <string; for multiple choice, exactly one provided option>,
  "confidence": <number 0..1>,
  "highStakes": <boolean>
}`;

export async function answerScreeningQuestion(
  apiKey: string,
  profile: UserProfile,
  question: ScreeningQuestion,
): Promise<ScreeningAnswer> {
  const ctx = [
    `APPLICANT PROFILE:`,
    `Name: ${profile.name}`,
    `Email: ${profile.email}`,
    `Phone: ${profile.phone}`,
    `Location: ${profile.location}`,
    `Work authorization: ${profile.workAuth}`,
    `Accepted skills: ${profile.skills.join(', ')}`,
    ``,
    `RESUME TEXT (truncated):`,
    profile.resumeText.slice(0, 12000),
    ``,
    `SCREENING QUESTION: ${question.question}`,
    question.options.length
      ? `OPTIONS (choose exactly one): ${question.options
          .map((o) => `"${o}"`)
          .join(', ')}`
      : `This is a free-text question.`,
  ].join('\n');

  const raw = await callClaude(apiKey, SCREENING_SYSTEM, ctx);
  const parsed = parseJsonLoose<Partial<ScreeningAnswer>>(raw);

  let answer = String(parsed.answer ?? '').trim();
  // If multiple choice, snap to the closest valid option.
  if (question.options.length) {
    const exact = question.options.find(
      (o) => o.toLowerCase() === answer.toLowerCase(),
    );
    if (exact) answer = exact;
    else {
      const contains = question.options.find(
        (o) =>
          o.toLowerCase().includes(answer.toLowerCase()) ||
          answer.toLowerCase().includes(o.toLowerCase()),
      );
      if (contains) answer = contains;
    }
  }

  const confidence = Number.isFinite(Number(parsed.confidence))
    ? Math.max(0, Math.min(1, Number(parsed.confidence)))
    : 0.5;
  const highStakes = Boolean(parsed.highStakes);
  return { answer, confidence, highStakes };
}
