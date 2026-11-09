const model = process.env.JUNIOR_DE_SARAM_MODEL_NAME || 'junior-de-saram-pi';

function chunk(id, choices, usage) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices,
    ...(usage ? { usage } : {}),
  };
}

function send(res, value) {
  if (!res.writableEnded) res.write(`data: ${JSON.stringify(value)}\n\n`);
}

export function startChatStream(res, id) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  send(res, chunk(id, [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]));
}

export function streamChatDelta(res, id, field, value) {
  if (!value) return;
  send(res, chunk(id, [{ index: 0, delta: { [field]: value }, finish_reason: null }]));
}

export function finishChatStream(res, id, answer, usage) {
  for (let offset = 0; offset < answer.length; offset += 1200) {
    streamChatDelta(res, id, 'content', answer.slice(offset, offset + 1200));
  }
  send(res, chunk(id, [{ index: 0, delta: {}, finish_reason: 'stop' }]));
  if (usage) send(res, chunk(id, [], usage));
  res.end('data: [DONE]\n\n');
}
