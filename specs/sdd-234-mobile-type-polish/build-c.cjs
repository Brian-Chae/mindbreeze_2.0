// npm 빌드도 빈 envDir를 사용하여 저장소 .env를 읽지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../frontend');
const scratch = fs.mkdtempSync('/tmp/sdd234-c-build-');
const config = path.join(scratch, 'vite.config.mjs');
fs.writeFileSync(config, `import original from ${JSON.stringify(path.join(root, 'vite.config.ts'))};\nexport default {...original, envDir:${JSON.stringify(scratch)}, resolve:{...original.resolve, alias:{...original.resolve.alias,'../design-system':${JSON.stringify(path.resolve(root,'../design-system'))}}}};\n`);
const result = spawnSync('npm', ['run', 'build', '--', '--config', config], { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
