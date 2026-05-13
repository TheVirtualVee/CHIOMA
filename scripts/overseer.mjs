/**
 * scripts/overseer.mjs
 *
 * CHIOMA OVERSEER ENGINE - Linter
 * Enforces production-readiness, deterministic integrity, and tenant isolation.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const filesToCheck = process.argv.slice(process.argv.indexOf('--files') + 1);
const allFiles = filesToCheck.length > 0 ? filesToCheck : getAllFiles('.');

let violations = 0;

console.log(`\n🔍 OVERSEER: Auditing ${allFiles.length} files...\n`);

allFiles.forEach(file => {
  if (extname(file) !== '.ts' && extname(file) !== '.js') return;
  if (file.includes('node_modules')) return;

  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    // 1. No Stubs
    if (/(TODO|FIXME|placeholder|TBD|mock)/i.test(line)) {
      report(file, index + 1, 'STUB_DETECTED', `Forbidden term found: ${line.trim()}`);
    }

    // 2. No Silent Failure
    if (/catch\s*\(.*\)\s*\{\s*\}/.test(line)) {
      report(file, index + 1, 'SILENT_FAILURE', 'Empty catch block detected.');
    }

    // 3. Production Complete
    if (file.includes('services/') && line.includes('console.log')) {
      report(file, index + 1, 'FORBIDDEN_LOG', 'console.log is forbidden in services.');
    }

    // 4. Tenant Isolation (Basic check for SQL queries)
    if (line.includes('sql`') && !line.includes('tenant_id') && !line.includes('INSERT')) {
        // This is a weak check, but better than nothing for a script.
        // We look for SELECT/UPDATE/DELETE without tenant_id.
        const nextLines = lines.slice(index, index + 5).join(' ');
        if (!nextLines.includes('tenant_id') && /(SELECT|UPDATE|DELETE)/i.test(nextLines)) {
            report(file, index + 1, 'TENANT_ISOLATION_RISK', 'SQL query might be missing tenant_id filter.');
        }
    }
  });
});

if (violations > 0) {
  console.log(`\n❌ OVERSEER: REJECTED (${violations} violations found).\n`);
  process.exit(1);
} else {
  console.log('\n✅ OVERSEER: PASSED. Codebase integrity verified.\n');
  process.exit(0);
}

function report(file, line, code, message) {
  violations++;
  console.log(`[${code}] ${file}:${line} - ${message}`);
}

function getAllFiles(dirPath, arrayOfFiles) {
  const files = readdirSync(dirPath);
  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    const fullPath = join(dirPath, file);
    if (statSync(fullPath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== '.cursor') {
        arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
      }
    } else {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}
