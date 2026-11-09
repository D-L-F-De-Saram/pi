import test from 'node:test';
import assert from 'node:assert/strict';
import { startChatStream, streamChatDelta, finishChatStream } from '../core/chat-stream.mjs';

test('assistant role precedes reasoning and content in OpenAI-compatible SSE', () => {
  const written = [];
  const res = {
    writableEnded: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    write(text) { written.push(text); },
    end(text) { written.push(text); this.writableEnded = true; },
  };
  startChatStream(res, 'chatcmpl-test');
  streamChatDelta(res, 'chatcmpl-test', 'reasoning_content', 'Checking firm sources…\n');
  finishChatStream(res, 'chatcmpl-test', 'Answer.', { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 });

  const events = written.filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6)));
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-accel-buffering'], 'no');
  assert.equal(events[0].choices[0].delta.role, 'assistant');
  assert.equal(events[1].choices[0].delta.reasoning_content, 'Checking firm sources…\n');
  assert.equal(events[2].choices[0].delta.content, 'Answer.');
  assert.equal(events.at(-1).usage.total_tokens, 16);
  assert.ok(events.every((event) => event.model && event.created));
  assert.equal(written.at(-1), 'data: [DONE]\n\n');
});
