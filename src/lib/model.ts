import { anthropic } from '@ai-sdk/anthropic';

export const MODEL_ID = process.env.ORDERDESK_MODEL?.trim() || 'claude-sonnet-5-5';

export function getModel() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.example).');
  }
  return anthropic(MODEL_ID);
}
