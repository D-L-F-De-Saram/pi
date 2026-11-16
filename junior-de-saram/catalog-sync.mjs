import { syncCatalog } from './core/drafting-catalog.mjs';

try {
  const result = await syncCatalog({ full: process.argv.includes('--full') });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('[de-saram-catalog]', error.message);
  process.exitCode = 1;
}
