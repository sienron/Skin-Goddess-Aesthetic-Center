function createHealthHandler(db, env=process.env) {
  return async (_req,res) => {
    res.setHeader('Cache-Control','no-store');
    try {
      await db.query('SELECT 1');
      res.json({status:'ok',commit:env.RENDER_GIT_COMMIT || null});
    } catch {
      res.status(503).json({status:'unavailable'});
    }
  };
}

module.exports={createHealthHandler};
