import os from 'node:os';
import path from 'node:path';

export function expandHome(filePath: string): string {
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

export function basenameSafe(filePath?: string): string {
  if (!filePath) return 'Unknown';
  return path.basename(filePath.replace(/[/\\]+$/, '')) || 'Unknown';
}