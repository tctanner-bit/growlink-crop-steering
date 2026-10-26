import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { REVIEW_TOOL } from '@gl-steering/core';
import { env } from './env';

/**
 * Nova's model provider. Keys are read from the controller's environment (Fly secrets) only:
 * they are never written to the database, sent to the web app, logged, or included in errors.
 */
export type AiProvider = 'openai' | 'anthropic';

export interface AiStatus { configured: boolean; provider: AiProvider | null; model: string | null }

const openai = env.openaiApiKey ? new OpenAI({ apiKey: env.openaiApiKey, baseURL: env.openaiBaseUrl, maxRetries: 2, timeout: 120_000 }) : null;
const anthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 2, timeout: 120_000 }) : null;

/** Explicit AI_PROVIDER wins; otherwise OpenAI if its key is set, then Anthropic. */
function pick(): AiProvider | null {
  if (env.aiProvider === 'openai') return openai ? 'openai' : null;
  if (env.aiProvider === 'anthropic') return anthropic ? 'anthropic' : null;
  return openai ? 'openai' : anthropic ? 'anthropic' : null;
}

export const aiProvider = pick();
export const aiModel = aiProvider ? (env.aiModel || (aiProvider === 'openai' ? 'gpt-6.1-sol' : 'claude-sonnet-5-5')) : null;
export const aiStatus: AiStatus = { configured: aiProvider != null, provider: aiProvider, model: aiModel };
/** Label stored on each review, e.g. "openai/gpt-6.1-sol". */
export const aiLabel = aiProvider ? `${aiProvider}/${aiModel}` : null;

export const AI_NOT_CONFIGURED = 'No AI key configured on the controller (set OPENAI_API_KEY or ANTHROPIC_API_KEY as a Fly secret).';

/** Strip anything key-shaped from text before it is stored or shown. */
export function redact(text: string): string {
  let out = text;
  for (const k of [env.openaiApiKey, env.anthropicApiKey]) if (k) out = out.split(k).join('[redacted]');
  return out.replace(/\b(sk|sk-proj|sk-ant)-[A-Za-z0-9_\-]{8,}/g, '[redacted]');
}

/** Ask the model for a review; returns the raw `submit_review` arguments. */
export async function requestReview(system: string, user: string): Promise<unknown> {
  if (aiProvider === 'openai' && openai) {
    const res = await openai.responses.create({
      model: aiModel!,
      instructions: system,
      input: user,
      tools: [{ type: 'function', name: REVIEW_TOOL.name, description: REVIEW_TOOL.description, parameters: REVIEW_TOOL.input_schema as any, strict: false }],
      tool_choice: { type: 'function', name: REVIEW_TOOL.name },
      max_output_tokens: 4000,
      store: false,
    } as any);
    const call = (res as any).output?.find((o: any) => o.type === 'function_call' && o.name === REVIEW_TOOL.name);
    if (!call) throw new Error('Model did not call submit_review');
    try { return JSON.parse(call.arguments); } catch { throw new Error('Model returned malformed review arguments'); }
  }
  if (aiProvider === 'anthropic' && anthropic) {
    const msg = await anthropic.messages.create({
      model: aiModel!,
      max_tokens: 1500,
      system,
      tools: [REVIEW_TOOL as any],
      tool_choice: { type: 'tool', name: REVIEW_TOOL.name },
      messages: [{ role: 'user', content: user }],
    });
    const call = msg.content.find((b: any) => b.type === 'tool_use') as any;
    if (!call) throw new Error('Model did not call submit_review');
    return call.input;
  }
  throw new Error(AI_NOT_CONFIGURED);
}
