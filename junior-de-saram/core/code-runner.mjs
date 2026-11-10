import vm from 'node:vm';

export function runDataCode({ code, input = {} }) {
  if (process.env.CODE_RUNNER_ENABLED === 'false') throw Error('Data runner disabled');
  if (!code || code.length > 12000 || /\b(?:require|import|process|globalThis|fetch|WebSocket|child_process|fs|Function|eval|constructor)\b/i.test(code)) throw Error('Use only data calculations in this tool; document scripts use the built-in tools.');
  const context = vm.createContext({ input: JSON.parse(JSON.stringify(input)), result: undefined }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(`result = (() => { "use strict"; ${code}\n })()`).runInContext(context, { timeout: 1500 });
  const text = JSON.stringify(context.result);
  if (!text || text.length > 262144) throw Error('Return a bounded JSON result');
  return { result: JSON.parse(text) };
}
