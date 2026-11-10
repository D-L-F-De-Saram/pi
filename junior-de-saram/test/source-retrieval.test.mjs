import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveSource } from '../core/source-retrieval.mjs';
import { runDataCode } from '../core/code-runner.mjs';
import { toolSafetyReason } from '../core/tool-safety.mjs';
import { sourceCitationText } from '../core/source-citations.mjs';
import { restoreCitations } from '../core/citations.mjs';

test('direct retrieval validates filters, retains links and reports chunk pagination', async () => {
  process.env.DESARAM_TYPESENSE_URL = 'https://db.example';
  process.env.DESARAM_TYPESENSE_SEARCH_KEY = 'test-only-key';
  process.env.DESARAM_DOCUMENT_VIEWER_URL = 'https://docs.example/document.html';
  let search;
  const fetcher = async (url) => {
    if (url.pathname.endsWith('/acts')) return Response.json({ fields: [{name:'text',type:'string'},{name:'act_year',type:'int32',facet:true},{name:'markdown_path',type:'string'},{name:'title',type:'string'}] });
    search = url;
    return Response.json({ found: 15, hits: [{ document: { id:'a-1', title:'Act A', text:'Operative text', markdown_path:'acts/a.md' } }] });
  };
  const data = await retrieveSource({ source:'act', operation:'find', filters:[{field:'act_year',value:2026}], page_size:1 }, {fetcher});
  assert.equal(search.searchParams.get('filter_by'), 'act_year:=2026');
  assert.equal(data.found_chunks,15);
  assert.equal(data.next_page,2);
  assert.match(data.records[0].source_url,/docs.example/);
  await assert.rejects(retrieveSource({ source:'act',operation:'find',filters:[{field:'unknown',value:'x'}] },{fetcher}),/Unsupported filter/);
});

test('full document reads return bounded passages with continuation', async () => {
  process.env.DESARAM_TYPESENSE_URL = 'https://db.example'; process.env.DESARAM_TYPESENSE_SEARCH_KEY = 'test-only-key';
  process.env.DESARAM_FILE_SERVER_URL = 'https://files.example';
  const fetcher = async (url) => {
    const path = String(url);
    if(path.includes('/doc/')) return new Response('0123456789abcdef');
    if(path.endsWith('/acts')) return Response.json({fields:[{name:'text',type:'string'},{name:'markdown_path',type:'string'}]});
    return Response.json({hits:[{document:{id:'a',markdown_path:'acts/a.md'}}]});
  };
  const data = await retrieveSource({source:'act',operation:'read_document',record_id:'a',offset:4,max_field_characters:5},{fetcher});
  assert.equal(data.text,'45678'); assert.equal(data.next_offset,9); assert.equal(data.has_more,true);
});

test('data calculation works while protected credential access is blocked', () => {
  assert.deepEqual(runDataCode({code:'return input.days * input.rate',input:{days:24,rate:100}}),{result:2400});
  assert.throws(()=>runDataCode({code:'return process.env'}));
  assert.ok(toolSafetyReason('bash',{command:'cat /app/.env'}));
  assert.ok(toolSafetyReason('bash',{command:'printenv'}));
  assert.ok(toolSafetyReason('write',{path:'leak.py',content:'import os; print(os.environ)'}));
  assert.equal(toolSafetyReason('bash',{command:'python .agents/skills/pdf/scripts/check_fillable_fields.py /data/workspaces/a.pdf'}),null);
});

test('direct source citations can be restored by name without inventing authority', () => {
  const sources = sourceCitationText(JSON.stringify({records:[{source_title:'Companies Act',source_url:'https://docs.example/a'}]}));
  assert.match(restoreCitations('The Companies Act applies.',[sources]),/\[Companies Act\]\(https:\/\/docs.example\/a\)/);
});
