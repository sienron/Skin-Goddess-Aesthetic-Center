const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runStep(scriptName) {
  const result = spawnSync(process.execPath, [path.join(__dirname, scriptName)], {
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

function main() {
  if (process.env.SKIP_AUTOMATIC_MIGRATIONS === 'true') {
    console.warn(
      '[startup] WARNING: Automatic migrations are disabled by '
      + 'SKIP_AUTOMATIC_MIGRATIONS=true. No migrations were run, adopted, or recorded. '
      + 'The production schema has not been validated; newsletter signup, Finance '
      + 'customer/product-sale paths, pending purchase review, and balance-payment '
      + 'idempotency may fail until schema recovery is completed.'
    );
  } else if (!runStep('run-migrations.js')) {
    return;
  }

  runStep('build-public.js');
}

main();
