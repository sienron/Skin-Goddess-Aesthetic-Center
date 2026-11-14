const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const fs=require('node:fs');
const path=require('node:path');
const {createHealthHandler}=require('../utils/health');

test('public health check reports deployed commit and returns a sanitized 503 when the database fails',async()=>{
  let fail=false;
  const app=express();
  app.get('/api/health',createHealthHandler({query:async(sql)=>{
    assert.equal(sql,'SELECT 1');
    if(fail)throw new Error('private database connection details');
    return {rows:[{'?column?':1}]};
  }},{RENDER_GIT_COMMIT:'deployment-test-commit'}));
  const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  try{
    const url=`http://127.0.0.1:${server.address().port}/api/health`;
    let response=await fetch(url);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(await response.json(),{status:'ok',commit:'deployment-test-commit'});
    fail=true;response=await fetch(url);
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{status:'unavailable'});
    const source=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');
    assert.ok(source.indexOf("app.get('/api/health'")<source.indexOf('app.use(session('));
  }finally{await new Promise(resolve=>server.close(resolve));}
});
