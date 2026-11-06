async function migrate() {
  console.log('Legacy account cleanup is disabled; existing staff accounts and appointment history are preserved.');
}

migrate().catch((error) => {
  console.error('Legacy account migration failed:', error.message);
  process.exitCode = 1;
});
