import path from 'node:path';
import { migrateLegacyCache } from './core/precedents.mjs';

const legacyRoot = path.resolve(process.argv[2] || './junior-de-saram/private-wiki-cache');
const wikiRoot = path.resolve(process.argv[3] || process.env.JUNIOR_DE_SARAM_WIKI_HOST_PATH || './junior-de-saram/private-wiki');
process.env.JUNIOR_DE_SARAM_KB_CACHE_ROOT = path.join(wikiRoot, 'imported');
for (const record of await migrateLegacyCache(legacyRoot)) {
  process.stdout.write(`${record.old_id} -> ${record.new_id}\n`);
}
