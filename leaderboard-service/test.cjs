const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {mkdtemp}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const runtime=config=>new Miniflare(convertV4MiniflareOptions(config));

const origin='https://lubasz4gaming.github.io';
const options={modules:true,scriptPath:path.join(__dirname,'worker.mjs'),compatibilityDate:'2026-09-17',
  durableObjects:{SLOT_LEADERBOARD:{className:'SlotLeaderboard',useSQLite:true}},
  bindings:{ALLOWED_ORIGINS:origin+',null'},telemetry:{enabled:false}};
const entry=(initials,cents)=>({id:randomUUID(),initials,cents});
async function send(mf,score,extra={}){
  const response=await mf.dispatchFetch('https://leaderboard.test/v1/scores',{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...extra.headers},body:JSON.stringify(score)
  });
  return {status:response.status,data:await response.json()};
}
async function board(mf){return (await (await mf.dispatchFetch('https://leaderboard.test/v1/scores')).json()).scores;}

test('public API validates request boundaries and browser origins',async()=>{
  const mf=runtime(options);
  try{
    const preflight=await mf.dispatchFetch('https://leaderboard.test/v1/scores',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Content-Type'}});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
    assert.equal((await send(mf,entry('ABC',100),{headers:{Origin:'https://other.test'}})).status,403);
    assert.equal((await send(mf,entry('ABC',100),{headers:{Origin:''}})).status,403);
    assert.equal((await send(mf,entry('ABC',100),{headers:{'Content-Type':'text/plain'}})).status,415);
    for(const invalid of [null,{},entry('abC',100),entry('<X>',100),entry('ABCD',100),entry('ABC',0),entry('ABC',-5),entry('ABC',100.5),entry('ABC',101),entry('ABC',1801350005),{...entry('ABC',100),id:'bad'}]){
      assert.equal((await send(mf,invalid)).status,400,JSON.stringify(invalid));
    }
    assert.equal((await send(mf,{...entry('ABC',100),padding:'x'.repeat(600)})).status,413);
    const malformed=await mf.dispatchFetch('https://leaderboard.test/v1/scores',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{'});assert.equal(malformed.status,400);
    const offline=await send(mf,entry('OFF',100),{headers:{Origin:'null'}});assert.equal(offline.status,200);
    const get=await mf.dispatchFetch('https://leaderboard.test/v1/scores',{headers:{Origin:origin}});assert.equal(get.headers.get('Cache-Control'),'no-store');assert.equal(get.headers.get('Access-Control-Allow-Origin'),origin);
    assert.equal((await mf.dispatchFetch('https://leaderboard.test/missing')).status,404);
    assert.equal((await mf.dispatchFetch('https://leaderboard.test/v1/scores',{method:'DELETE'})).status,405);
  }finally{await mf.dispose();}
});

test('top three are atomic, sorted by cents, stable on ties and idempotent',async()=>{
  const mf=runtime(options);
  try{
    const a=entry('AAA',100),b=entry('BBB',200),c=entry('CCC',200);
    assert.equal((await send(mf,a)).data.rank,1);
    assert.equal((await send(mf,b)).data.rank,1);
    assert.equal((await send(mf,c)).data.rank,2);
    assert.deepEqual((await board(mf)).map(s=>s.initials),['BBB','CCC','AAA']);
    assert.equal((await send(mf,entry('LOW',100))).data.accepted,false);
    assert.equal((await send(mf,b)).data.rank,1);assert.equal((await board(mf)).length,3);
    assert.equal((await send(mf,{...b,initials:'XYZ'})).status,409);
    assert.equal((await send(mf,{...b,cents:205})).status,409);
    const newer=entry('NEW',300);await send(mf,newer);
    assert.equal((await send(mf,entry('TIE',200))).data.accepted,false);
    assert.deepEqual((await board(mf)).map(s=>s.initials),['NEW','BBB','CCC']);
    // A retry of an entry that has fallen out cannot re-enter or duplicate it.
    assert.equal((await send(mf,a)).data.accepted,false);
    const contenders=Array.from({length:20},(_,i)=>entry(String(i).padStart(3,'0'),1000+i*5));
    const results=await Promise.all(contenders.flatMap(s=>[send(mf,s),send(mf,s)]));
    assert.ok(results.every(r=>r.status===200));
    const final=await board(mf);assert.equal(final.length,3);assert.equal(new Set(final.map(s=>s.id)).size,3);
    assert.deepEqual(final.map(s=>s.cents),[1095,1090,1085]);
    // Qualification is rechecked against the current board at submission time.
    assert.equal((await send(mf,entry('OLD',1000))).data.rank,0);
  }finally{await mf.dispose();}
});

test('SQLite board survives a complete runtime restart',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'wolf-leaderboard-test-'));
  const config={...options,resourcePersistencePath:directory};
  let mf=runtime(config);
  const score=entry('WIN',12345);
  try{await send(mf,score);}finally{await mf.dispose();}
  mf=runtime(config);
  try{assert.deepEqual(await board(mf),[score]);assert.equal((await send(mf,score)).data.rank,1);}
  finally{await mf.dispose();}
});
