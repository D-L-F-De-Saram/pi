export function runtimeArgs(selection = {}) {
  const skills = ['de-saram-legal-final-answer', 'de-saram-source-retrieval', 'de-saram-legal-drafting', 'pdf', 'pptx', 'xlsx', 'docx'];
  return ['--approve', '--provider', selection.provider || process.env.PI_PROVIDER || 'google', '--model', selection.model || process.env.PI_MODEL || 'gemini-3.7-flash', '--thinking', selection.thinking || process.env.PI_THINKING || 'low', '--no-context-files', '--no-skills', ...skills.flatMap((name) => ['--skill', `.agents/skills/${name}/SKILL.md`]), '--no-extensions', '--extension', 'builtin:mcp', '--extension', '.pi/extensions/junior-de-saram-context.ts', '--extension', '.pi/extensions/junior-de-saram-scope-guard.ts', '--extension', '.pi/extensions/de-saram-delivery.ts'];
}
