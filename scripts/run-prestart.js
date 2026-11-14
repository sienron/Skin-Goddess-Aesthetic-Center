const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runStep(scriptName, args = []) {
  const result = spawnSync(process.execPath, [path.join(__dirname, scriptName), ...args], {
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`Startup step "${scriptName}" could not be started: ${result.error.message}`);
    process.exitCode = 1;
    return false;
  }

  if (result.status !== 0) {
    if (result.signal) {
      console.error(`Startup step "${scriptName}" terminated by signal ${result.signal}.`);
    }
    process.exitCode = result.status === null ? 1 : result.status;
    return false;
  }

  return true;
}

function main(env = process.env, executeStep = runStep) {
  if (env.SKIP_AUTOMATIC_MIGRATIONS === 'true') {
    console.warn(
      '[startup] WARNING: Automatic migrations are disabled by '
      + 'SKIP_AUTOMATIC_MIGRATIONS=true. No migrations were run, adopted, or recorded. '
      + 'Validating the existing migration ledger and required schema postconditions.'
    );
    if (!executeStep('run-migrations.js', ['--verify'])) return false;
  } else if (!executeStep('run-migrations.js')) {
    return;
  }

  executeStep('build-public.js');
  return true;
}

if (require.main === module) main();

module.exports = { main, runStep };
