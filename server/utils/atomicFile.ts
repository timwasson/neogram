import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

/**
 * Crash-safe write: data is written to a unique temp file in the same directory and then
 * atomically renamed over the destination, so readers never observe a half-written JSON file.
 */
export async function writeFileAtomic(filePath: string, data: string | Buffer): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Minimal in-process async mutex (single-process deployment; see docs for horizontal-scaling notes). */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => {}).then(task);
    this.tail = result;
    return result;
  }
}
