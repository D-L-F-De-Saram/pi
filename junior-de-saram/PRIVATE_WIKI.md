# Private De Saram drafting catalog

The ignored host directory `junior-de-saram/private-wiki/` is now a metadata
catalog, not a store of example documents. Its active file is `catalog.json`.
Compose mounts this directory at `/data/private-wiki`; a rebuild does not
erase it. Set `JUNIOR_DE_SARAM_WIKI_HOST_PATH` to an absolute path on another
host. The `node` container user needs write access. Git and the Docker build
ignore the directory. Older private Markdown examples may remain there, but
active drafting does not search or update them. Do not delete them merely to
switch to this catalog.

## Contents and refresh

For each logical indexed document, the catalog stores its title, type, status,
practice area, index record ID, source format, classification (`template`,
`sample`, `uncertain`), classification basis and original availability with
a verification time. It stores no original DOCX or full source Markdown.
Classification overrides can be set by editing an entry's
`classification_override` to one of those three values; the next sync
preserves it. A provisional sample classification is not proof that a source
is completed work.

At server start, refresh runs in the background. The first run reads the firm
index and creates `catalog.json`. Later starts query records at or after the
committed `indexed_timestamp_cursor`; a full reconciliation every seven
days catches deletions and legacy changes. The cursor advances only after a
complete scan. The server retries every ten minutes if a route is temporarily
unavailable. Availability is checked for new records and again before copying
a template; a previous result may become stale.

Initialize immediately after private source tunnels are connected:

```bash
docker exec junior-de-saram node junior-de-saram/catalog-sync.mjs
```

Force a read-only full reconciliation later:

```bash
docker exec junior-de-saram node junior-de-saram/catalog-sync.mjs --full
```

Inspect aggregate metadata on the host:

```bash
python3 - <<'PY'
import json
from collections import Counter
from pathlib import Path
catalog = json.loads(Path('junior-de-saram/private-wiki/catalog.json').read_text())
items = list(catalog['documents'].values())
print('documents:', len(items), 'updated:', catalog['updated_at'])
print('classifications:', dict(Counter(x['classification'] for x in items)))
print('original availability:', dict(Counter(x['original']['availability'] for x in items)))
print('available DOCX:', sum(x['original']['availability'] == 'available' and x['original'].get('extension') == '.docx' for x in items))
PY
```

## Original documents and trace

The upload-process source gateway resolves indexed record IDs inside its
approved repository/uploads mounts. It requires `DRAFTING_SOURCE_TOKEN`;
Junior De Saram uses the same value in `DESARAM_DRAFTING_SOURCE_TOKEN`.
It accepts no caller-supplied path and only reads the index and originals.
Local development uses a private SSH forward on port 18130. On the server,
set `DESARAM_DRAFTING_SOURCE_URL=http://docs-desaram-ai-upload-process:8130`
and include `docker-compose.source-network.yml` so the two containers share
the private documents network.

`de_saram_precedent_search` logs the catalog candidate and classification.
`de_saram_precedent_read` logs which indexed sample or template text was
referred to. `de_saram_template_copy` logs the source record ID, fresh
availability, destination copy path, size and SHA-256. The copy is kept in
the current conversation workspace; the firm original remains unchanged.
Developer traces can contain source excerpts and user instructions, so keep
the trace directory private. Existing trace redaction covers credentials.

Deploy the source gateway and set its token before testing template copying.
If it is unavailable, catalog metadata searches still work, but original
availability remains `unchecked` and copying is disabled.
