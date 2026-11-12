import { ModelRuntime } from '../../packages/coding-agent/dist/index.js';
import { getSupportedThinkingLevels } from '../../packages/ai/dist/index.js';

let runtimePromise;
let cached;
let pending;

async function loadModels() {
  runtimePromise ??= ModelRuntime.create();
  const runtime = await runtimePromise;
  const available = await runtime.getAvailable(undefined, { signal: AbortSignal.timeout(15000) });
  return available.map((model) => ({
    provider: model.provider,
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: model.reasoning,
    thinkingLevels: getSupportedThinkingLevels(model),
    images: model.input.includes('image'),
  })).sort((left, right) => left.provider.localeCompare(right.provider) || left.id.localeCompare(right.id));
}

export async function availablePiModels() {
  if (cached && Date.now() - cached.at < 30000) return cached.models;
  pending ??= loadModels().then((models) => {
    cached = { at: Date.now(), models };
    return models;
  }).finally(() => { pending = undefined; });
  return pending;
}

export async function resolvePiModel(reference) {
  if (typeof reference !== 'string' || reference.length > 256) return undefined;
  const models = await availablePiModels();
  return models.find((model) => `${model.provider}/${model.id}` === reference);
}
