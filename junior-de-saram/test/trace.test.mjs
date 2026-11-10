import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTrace } from '../core/trace.mjs';

test('CLI/hosted trace records code and direct tools with new-key redaction and artifacts', async () => {
  const root = await mkdtemp(path.join(tmpdir(),'de-saram-trace-'));
  process.env.JUNIOR_DE_SARAM_LOG_ROOT = root;
  process.env.DESARAM_TYPESENSE_SEARCH_KEY = 'private-test-source-credential';
  try {
    const trace = createTrace({id:'trace-test',key:'conversation-test',query:'Create a legal document',model:'test',provider:'test'});
    trace.event({type:'tool_execution_start',toolCallId:'1',toolName:'bash',args:{command:'python make.py'}});
    trace.event({type:'tool_execution_end',toolCallId:'1',toolName:'bash',result:{content:[{type:'text',text:'private-test-source-credential'}]}});
    trace.event({type:'tool_execution_start',toolCallId:'2',toolName:'legal_source_retrieve_details',args:{source:'act',operation:'find'}});
    trace.event({type:'tool_execution_update',toolCallId:'2',partialResult:{status:'reading'}});
    trace.event({type:'tool_execution_end',toolCallId:'2',result:{records:[]}});
    await trace.finish({answer:'[Download](https://app.example/artifacts/test/report.pptx?token=private-token)\n:::artifact{\n<img alt="Document page 1" src="https://app.example/artifacts/a/preview.png?token=private-token"><img alt="Document page 2" src="https://app.example/artifacts/b/preview.png?token=private-token">',usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});
    const [date] = await readdir(path.join(root,'traces'));
    const text=await readFile(path.join(root,'traces',date,'trace-test','trace.json'),'utf8');
    assert.doesNotMatch(text,/private-test-source-credential|private-token/);
    assert.match(text,/Document page 1/); assert.match(text,/Document page 2/);
    const data=JSON.parse(text);
    assert.equal(data.tool_calls.length,2); assert.equal(data.tool_calls[1].updates.length,1);
    assert.equal(data.final.artifacts.length,1); assert.equal(data.final.previews.length,1);
    assert.equal(data.trace.source,'junior-de-saram');
  } finally { await rm(root,{recursive:true,force:true}); }
});
