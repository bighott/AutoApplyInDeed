/**
 * Toolbar popup: live status + Run Now / Pause / Stop.
 *
 * Reads the runtime status from chrome.storage.session and sends commands to
 * the background. Live-updates via the storage change listener.
 */

import { STORAGE_KEYS } from '../../lib/config';
import type { CommandMessage } from '../../lib/messaging';
import type { RuntimeStatus } from '../../lib/types';
import { idleStatus } from '../../lib/types';

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const badge = $('state-badge');
const statusMessage = $('status-message');
const progressWrap = $('progress-wrap');
const progressFill = $('progress-fill');
const progressText = $('progress-text');
const runBtn = $<HTMLButtonElement>('run-btn');
const pauseBtn = $<HTMLButtonElement>('pause-btn');
const stopBtn = $<HTMLButtonElement>('stop-btn');
const openDashboard = $<HTMLAnchorElement>('open-dashboard');

function send(message: CommandMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

function render(status: RuntimeStatus): void {
  badge.textContent = status.state;
  badge.className = `badge ${status.state}`;
  statusMessage.textContent = status.message || status.state;

  const running = status.state === 'running';
  runBtn.disabled = running;
  pauseBtn.disabled = !running && status.state !== 'paused';

  if (running && status.progress.max > 0) {
    progressWrap.hidden = false;
    const pct = Math.min(
      100,
      Math.round((status.progress.current / status.progress.max) * 100),
    );
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${status.progress.current} / ${status.progress.max}`;
  } else {
    progressWrap.hidden = true;
  }
}

async function load(): Promise<void> {
  const status = (await send({ type: 'GET_STATUS' })) as RuntimeStatus | undefined;
  render(status || idleStatus());
}

runBtn.addEventListener('click', async () => {
  const resp = (await send({ type: 'RUN_NOW' })) as
    | { ok: boolean; error?: string }
    | undefined;
  if (resp && !resp.ok && resp.error) statusMessage.textContent = resp.error;
});
pauseBtn.addEventListener('click', () => {
  // Toggle pause/resume.
  if (badge.textContent === 'paused') void send({ type: 'RESUME' });
  else void send({ type: 'PAUSE' });
});
stopBtn.addEventListener('click', () => send({ type: 'STOP' }));

openDashboard.addEventListener('click', (e) => {
  e.preventDefault();
  // The dashboard is registered as the extension's options page.
  chrome.runtime.openOptionsPage();
});

// Live updates from background's status writes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[STORAGE_KEYS.runtimeStatus]) {
    render(changes[STORAGE_KEYS.runtimeStatus].newValue as RuntimeStatus);
  }
});

void load();
