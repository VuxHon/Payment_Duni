import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import type { InboxEventType } from './acb-contract.js';

export type SpoolEnvelope = {
  version: 1;
  id: string;
  bodySha256: string;
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  remoteIp: string | null;
  authenticated: boolean;
  eventType: InboxEventType;
  receivedAt: string;
};

const pendingDir = path.resolve(config.LOCAL_SPOOL_DIR, 'pending');
const deadLetterDir = path.resolve(config.LOCAL_SPOOL_DIR, 'dead-letter');

const exists = async (file: string) => {
  try { await access(file); return true; } catch { return false; }
};

export async function initSpool() {
  await mkdir(pendingDir, { recursive: true, mode: 0o700 });
  await mkdir(deadLetterDir, { recursive: true, mode: 0o700 });
}

export async function spoolWebhook(input: Omit<SpoolEnvelope, 'version' | 'id' | 'bodySha256' | 'receivedAt'>) {
  await initSpool();
  const serializedBody = JSON.stringify(input.body);
  const bodySha256 = createHash('sha256').update(serializedBody).digest('hex');
  const finalPath = path.join(pendingDir, `${bodySha256}.json`);
  if (await exists(finalPath)) return { duplicate: true, bodySha256 };

  const envelope: SpoolEnvelope = {
    version: 1,
    id: randomUUID(),
    bodySha256,
    receivedAt: new Date().toISOString(),
    ...input
  };
  const temporaryPath = path.join(pendingDir, `.${bodySha256}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(envelope), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, finalPath);
  return { duplicate: false, bodySha256 };
}

let draining = false;

export async function drainSpoolOnce(handler: (envelope: SpoolEnvelope) => Promise<void>) {
  if (draining) return 0;
  draining = true;
  try {
    await initSpool();
    const files = (await readdir(pendingDir))
      .filter(file => file.endsWith('.json'))
      .sort()
      .slice(0, config.SPOOL_BATCH_SIZE);
    let completed = 0;
    for (const file of files) {
      const source = path.join(pendingDir, file);
      try {
        const envelope = JSON.parse(await readFile(source, 'utf8')) as SpoolEnvelope;
        if (envelope.version !== 1 || !envelope.body || typeof envelope.body !== 'object') throw new Error('INVALID_SPOOL_ENVELOPE');
        await handler(envelope);
        await unlink(source);
        completed += 1;
      } catch (error) {
        if (error instanceof SyntaxError || (error instanceof Error && error.message === 'INVALID_SPOOL_ENVELOPE')) {
          await rename(source, path.join(deadLetterDir, `${Date.now()}-${file}`));
          console.error('Moved invalid local spool item to dead-letter', { file });
          continue;
        }
        console.error('Local spool delivery deferred', error instanceof Error ? error.message : String(error));
        break;
      }
    }
    return completed;
  } finally {
    draining = false;
  }
}

export async function spoolStatus() {
  await initSpool();
  const [pending, deadLetter] = await Promise.all([readdir(pendingDir), readdir(deadLetterDir)]);
  return {
    pending: pending.filter(file => file.endsWith('.json')).length,
    deadLetter: deadLetter.filter(file => file.endsWith('.json')).length,
    directory: path.resolve(config.LOCAL_SPOOL_DIR)
  };
}

let timer: NodeJS.Timeout | null = null;

export function startSpoolWorker(handler: (envelope: SpoolEnvelope) => Promise<void>) {
  if (timer) return;
  const tick = () => { void drainSpoolOnce(handler); };
  tick();
  timer = setInterval(tick, config.SPOOL_POLL_INTERVAL_MS);
  timer.unref();
}

export function stopSpoolWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
