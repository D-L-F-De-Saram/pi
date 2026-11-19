// Choose trusted renderer output by file revision instead of by HTML content.
export function rememberPreview(previews, value, toolName) {
  const markup = value?.artifact_markup;
  if (typeof markup !== 'string' || !markup.startsWith(':::artifact{')) return;
  const key = value.preview_key ?? markup;
  const published = toolName.endsWith('workbench_publish_artifact');
  if (!previews.has(key) || (published && !previews.get(key).published)) {
    previews.set(key, { markup, published });
  }
}

export function stripPreviewMarkup(text) {
  return text.replace(/:::artifact\{[\s\S]*?\n:::/g, '').replace(/<!doctype\s+html[\s\S]*?<\/html>/gi, '');
}

export function deliverPreviews(text, previews) {
  return [stripPreviewMarkup(text).trim(), ...Array.from(previews.values(), ({ markup }) => markup)].filter(Boolean).join('\n\n');
}
