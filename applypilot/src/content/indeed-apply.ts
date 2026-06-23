/**
 * Content script: drive the Indeed "Easily apply" flow.
 *
 * Answers APPLY_JOB messages. The background has already navigated the tab to
 * the job page; this script:
 *   1. clicks the Apply button,
 *   2. steps through the multi-page Smart Apply modal,
 *   3. fills contact fields from the profile, re-attaches the resume,
 *   4. handles screening questions per the run's screeningMode,
 *   5. submits on the final review step and reports the outcome.
 *
 * Safety:
 *  - Every wait has a timeout; a maxSteps guard prevents infinite loops.
 *  - If a selector can't be found, the job is marked failed (never hangs).
 *  - If Indeed opens the flow in a cross-origin iframe (a known A/B variant),
 *    we cannot reliably drive it, so we route the job to Needs Attention with
 *    a clear reason instead of pretending to apply.
 *  - Kill switch / blocked states bubble up as outcomes the orchestrator acts on.
 */

import type {
  AnswerQuestionResult,
  ApplyJobMessage,
  ApplyJobResult,
  ApplyOutcome,
} from '../lib/messaging';
import type { ScreeningQuestion } from '../lib/types';
import { actionDelay, humanType, sleep } from '../lib/throttle';
import {
  SELECTORS,
  queryAll,
  queryFirst,
  waitForFirst,
} from './dom-selectors';
import { detectSession } from './session-detect';

const MAX_STEPS = 12;

function visible(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const he = el as HTMLElement;
  return !!(he.offsetWidth || he.offsetHeight || he.getClientRects().length);
}

function clickEl(el: Element): void {
  (el as HTMLElement).click();
}

async function askBackground(
  question: ScreeningQuestion,
): Promise<AnswerQuestionResult> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'ANSWER_QUESTION', question },
      (resp: AnswerQuestionResult) => {
        if (chrome.runtime.lastError || !resp) {
          resolve({ ok: false, error: chrome.runtime.lastError?.message });
        } else resolve(resp);
      },
    );
  });
}

// --- field fillers ------------------------------------------------------------

async function fillContactFields(
  root: ParentNode,
  profile: ContactProfile,
): Promise<void> {
  const setText = async (sels: readonly string[], value: string) => {
    if (!value) return;
    const el = queryFirst<HTMLInputElement>(root, sels);
    if (el && visible(el) && !el.value) {
      await humanType(el, value);
      await actionDelay();
    }
  };

  await setText(SELECTORS.APPLY.nameInput, profile.name);
  if (profile.name.includes(' ')) {
    const [first, ...rest] = profile.name.split(' ');
    await setText(SELECTORS.APPLY.firstNameInput, first);
    await setText(SELECTORS.APPLY.lastNameInput, rest.join(' '));
  }
  await setText(SELECTORS.APPLY.emailInput, profile.email);
  await setText(SELECTORS.APPLY.phoneInput, profile.phone);
  await setText(SELECTORS.APPLY.locationInput, profile.location);
}

interface ContactProfile {
  name: string;
  email: string;
  phone: string;
  location: string;
}

/** Re-attach the stored resume: prefer Indeed's saved resume, else upload. */
async function handleResumeStep(
  root: ParentNode,
  resume: { dataUrl?: string; fileName?: string; mimeType?: string },
): Promise<void> {
  const useSaved = queryFirst<HTMLElement>(root, SELECTORS.APPLY.useSavedResume);
  if (useSaved && visible(useSaved)) {
    clickEl(useSaved);
    await actionDelay();
    return;
  }
  const fileInput = queryFirst<HTMLInputElement>(
    root,
    SELECTORS.APPLY.resumeFileInput,
  );
  if (fileInput && resume.dataUrl) {
    try {
      const blob = await (await fetch(resume.dataUrl)).blob();
      const file = new File([blob], resume.fileName || 'resume.pdf', {
        type: resume.mimeType || blob.type || 'application/pdf',
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await actionDelay();
    } catch {
      // If we can't re-upload, Indeed often already has a resume on file.
    }
  }
}

// --- screening questions ------------------------------------------------------

interface QuestionEl {
  block: HTMLElement;
  question: ScreeningQuestion;
  kind: 'radio' | 'checkbox' | 'select' | 'text';
}

function collectQuestions(root: ParentNode): QuestionEl[] {
  const blocks = queryAll<HTMLElement>(root, SELECTORS.APPLY.questionBlock);
  const out: QuestionEl[] = [];
  for (const block of blocks) {
    if (!visible(block)) continue;
    const label =
      queryFirst<HTMLElement>(block, SELECTORS.APPLY.questionLabel)
        ?.textContent?.trim() || '';
    if (!label) continue;

    const radios = queryAll<HTMLInputElement>(block, SELECTORS.APPLY.radioOption);
    const checks = queryAll<HTMLInputElement>(
      block,
      SELECTORS.APPLY.checkboxOption,
    );
    const select = queryFirst<HTMLSelectElement>(
      block,
      SELECTORS.APPLY.selectInput,
    );

    if (radios.length) {
      out.push({
        block,
        kind: 'radio',
        question: { question: label, options: radioLabels(block, radios) },
      });
    } else if (select) {
      out.push({
        block,
        kind: 'select',
        question: {
          question: label,
          options: Array.from(select.options)
            .map((o) => o.textContent?.trim() || o.value)
            .filter((v) => v && !/^select/i.test(v)),
        },
      });
    } else if (checks.length) {
      out.push({
        block,
        kind: 'checkbox',
        question: { question: label, options: radioLabels(block, checks) },
      });
    } else {
      const textEl = queryFirst<HTMLElement>(block, SELECTORS.APPLY.textInput);
      if (textEl)
        out.push({ block, kind: 'text', question: { question: label, options: [] } });
    }
  }
  return out;
}

function radioLabels(block: HTMLElement, inputs: HTMLInputElement[]): string[] {
  return inputs.map((inp) => {
    // Prefer an associated <label>, else nearby text.
    const id = inp.id;
    const lbl = id ? block.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    return (
      lbl?.textContent?.trim() ||
      inp.closest('label')?.textContent?.trim() ||
      inp.value ||
      ''
    );
  });
}

async function applyAnswer(q: QuestionEl, answer: string): Promise<void> {
  if (!answer) return;
  const want = answer.trim().toLowerCase();

  if (q.kind === 'select') {
    const select = queryFirst<HTMLSelectElement>(
      q.block,
      SELECTORS.APPLY.selectInput,
    );
    if (select) {
      const opt = Array.from(select.options).find(
        (o) =>
          (o.textContent || '').trim().toLowerCase() === want ||
          o.value.toLowerCase() === want,
      );
      if (opt) {
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    return;
  }

  if (q.kind === 'radio' || q.kind === 'checkbox') {
    const inputs = queryAll<HTMLInputElement>(q.block, [
      `input[type="${q.kind}"]`,
    ]);
    const labels = radioLabels(q.block, inputs);
    let idx = labels.findIndex((l) => l.trim().toLowerCase() === want);
    if (idx === -1) idx = labels.findIndex((l) => l.toLowerCase().includes(want));
    if (idx >= 0 && !inputs[idx].checked) {
      clickEl(inputs[idx]);
    }
    return;
  }

  // text / number / textarea
  const el = queryFirst<HTMLInputElement | HTMLTextAreaElement>(
    q.block,
    SELECTORS.APPLY.textInput,
  );
  if (el) await humanType(el, answer);
}

/**
 * Resolve every question on the current step.
 * Returns 'ok' if all answered/filled, or a deferral with captured questions.
 */
async function resolveQuestions(
  root: ParentNode,
  msg: ApplyJobMessage,
): Promise<
  | { kind: 'ok' }
  | { kind: 'defer'; questions: ScreeningQuestion[]; reason: string }
> {
  const questions = collectQuestions(root);
  if (!questions.length) return { kind: 'ok' };

  if (msg.config.screeningMode === 'defer') {
    return {
      kind: 'defer',
      questions: questions.map((q) => q.question),
      reason: 'Screening questions present; deferred per settings.',
    };
  }

  // AI mode: ask Claude (via background) for each answer.
  const captured: ScreeningQuestion[] = [];
  for (const q of questions) {
    const resp = await askBackground(q.question);
    if (!resp.ok) {
      return {
        kind: 'defer',
        questions: questions.map((x) => x.question),
        reason: `Could not get an AI answer (${resp.error || 'unknown'}).`,
      };
    }
    const highStakes = !!resp.highStakes;
    if (highStakes && msg.config.deferHighStakes) {
      return {
        kind: 'defer',
        questions: questions.map((x) => ({
          ...x.question,
          highStakes: x === q ? true : x.question.highStakes,
        })),
        reason: 'High-stakes/ambiguous question deferred for manual review.',
      };
    }
    await applyAnswer(q, resp.answer || '');
    captured.push({
      ...q.question,
      answer: resp.answer,
      highStakes,
    });
    await actionDelay();
  }
  return { kind: 'ok' };
}

// --- main apply flow ----------------------------------------------------------

async function runApply(msg: ApplyJobMessage): Promise<ApplyOutcome> {
  // 0. Guard: session/bot-check.
  const session = detectSession();
  if (session.blocked) return { status: 'blocked', reason: session.reason };
  if (!session.loggedIn)
    return { status: 'blocked', reason: 'Not signed in to Indeed.' };

  // 1. Launch the apply flow.
  const applyBtn = await waitForFirst<HTMLElement>(
    document,
    SELECTORS.APPLY.applyButton,
    8000,
  );
  if (!applyBtn) {
    return {
      status: 'failed',
      reason: 'Apply button not found (selector may be stale, see dom-selectors).',
    };
  }
  clickEl(applyBtn);
  await sleep(1500);

  // 2. Detect iframe variant (cannot reliably drive cross-origin frame).
  const iframe = queryFirst(document, SELECTORS.APPLY.modalIframe);
  if (iframe && !queryFirst(document, SELECTORS.APPLY.modalRoot)) {
    return {
      status: 'needs_attention',
      reason:
        'Apply flow opened in a separate (iframe) widget that cannot be auto-driven. Complete manually.',
      questions: [],
    } as ApplyOutcome;
  }

  // 3. Step through the in-page modal.
  const profile: ContactProfile = {
    name: msg.profileName,
    email: msg.profileEmail,
    phone: msg.profilePhone,
    location: msg.profileLocation,
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    // Success?
    if (queryFirst(document, SELECTORS.APPLY.successMarker)) {
      return { status: 'applied', reason: 'Application submitted.' };
    }

    const root: ParentNode =
      queryFirst(document, SELECTORS.APPLY.modalRoot) || document;

    // Re-check for bot-check between steps.
    const s = detectSession();
    if (s.blocked) return { status: 'blocked', reason: s.reason };

    // Fill any contact + resume fields present on this step.
    await fillContactFields(root, profile);
    await handleResumeStep(root, {
      dataUrl: msg.resumeDataUrl,
      fileName: msg.resumeFileName,
      mimeType: msg.resumeMimeType,
    });

    // Handle screening questions.
    const q = await resolveQuestions(root, msg);
    if (q.kind === 'defer') {
      return {
        status: 'needs_attention',
        reason: q.reason,
        questions: q.questions,
      };
    }

    await actionDelay();

    // Advance: submit if present, else continue.
    const submit = queryFirst<HTMLElement>(root, SELECTORS.APPLY.submitButton);
    if (submit && visible(submit)) {
      clickEl(submit);
      const ok = await waitForFirst(
        document,
        SELECTORS.APPLY.successMarker,
        12000,
      );
      if (ok) return { status: 'applied', reason: 'Application submitted.' };
      // No confirmation appeared — be honest about uncertainty.
      return {
        status: 'failed',
        reason: 'Clicked Submit but no confirmation screen detected.',
      };
    }

    const cont = queryFirst<HTMLElement>(root, SELECTORS.APPLY.continueButton);
    if (cont && visible(cont)) {
      clickEl(cont);
      await sleep(1800);
      continue;
    }

    // Nothing actionable found on this step.
    return {
      status: 'failed',
      reason:
        'Apply flow stalled: no Continue/Submit button found (selectors may be stale).',
    };
  }

  return {
    status: 'failed',
    reason: `Apply flow exceeded ${MAX_STEPS} steps without completing.`,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'APPLY_JOB') return undefined;
  runApply(message as ApplyJobMessage)
    .then((outcome) => {
      const result: ApplyJobResult = { ok: true, outcome };
      sendResponse(result);
    })
    .catch((err) => {
      const result: ApplyJobResult = {
        ok: false,
        outcome: {
          status: 'failed',
          reason: `Apply error: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
      sendResponse(result);
    });
  return true; // async
});
