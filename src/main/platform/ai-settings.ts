import { app } from 'electron';
import path from 'node:path';
import { readFileSync } from 'node:fs';

export function aiFile() {
  return path.join(app.getPath('userData'), 'ai-settings.json');
}

export function readAISettings(): {
  model: string;
  encryptedKey: string;
} {
  try {
    return JSON.parse(readFileSync(aiFile(), 'utf8'));
  } catch {
    return {
      model: '',
      encryptedKey: '',
    };
  }
}
