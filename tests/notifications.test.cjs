const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const engine=fs.readFileSync(path.join(__dirname,'../engine.js'),'utf8');

// Silent restoration may not launch side-planning work or historical scene scans.
assert.doesNotMatch(engine,/const planCandidates=last>=0\?/,'unresolved side quests should not auto-retry on startup');
assert.match(engine,/mawsAllowsSilentSceneScan\(freshTurnPairs\.get\(currentScope\(c\)\),scenePairSig\(c\.chat,id\)\)/);
assert.match(engine,/if\(name==='GENERATION_STARTED'\)/);
assert.match(engine,/last>generatingAt\.last\|\|last===generatingAt\.last/);
assert.match(engine,/const completionAt=v\.completions/);
const pure={window:{__MAWS_UNIVERSAL_TEST_ONLY__:true},console};
vm.runInNewContext(engine,pure);
const A=pure.window.__MAWS_UNIVERSAL_API__;
assert.equal(A.mawsAllowsSilentSceneScan(undefined,'post-1'),false);
assert.equal(A.mawsAllowsSilentSceneScan('post-1','post-2'),false);
assert.equal(A.mawsAllowsSilentSceneScan('post-1','post-1'),true);
assert.equal(A.mawsShouldCelebrate(false,5,5),true);
assert.equal(A.mawsShouldCelebrate(false,4,5),false);
assert.equal(A.mawsShouldCelebrate(false,null,null),false);
assert.equal(A.mawsShouldCelebrate(true,null,null),true);

// Exercise the actual completion-notification watcher with a fake UI.
const start=engine.indexOf('function watchCompletions(c,v){');
const end=engine.indexOf('\nfunction delta(n,unit=',start);
assert(start>0&&end>start);
const hits=[];
const sandbox={
 currentScope:c=>c.scope,
 completionToken:(c,v,id)=>`${c.scope}|${id}|${v.quests[id]?.endedAt?.date||''}`,
 completionCelebration:id=>hits.push(id),
 freshCompletionTurns:new Map(),
 manualCompletionIds:new Set(),
 mawsShouldCelebrate:A.mawsShouldCelebrate,
};
const code='const celebrationSeen=new Set();let celebrationInitialized=false,celebrationScope="";\n'+engine.slice(start,end)+'\nthis.watch=watchCompletions;';
vm.runInNewContext(code,sandbox);
const view=(ids,at=0)=>({quests:Object.fromEntries(ids.map(x=>[x,{status:'completed',endedAt:{date:'2026-10-01'}}])),completions:ids.map(id=>({id,status:'completed',at}))});
const c={scope:'chat-A'};
sandbox.watch(c,view(['OLD_A','OLD_B'],2)); // baseline
assert.deepEqual(hits,[]);
sandbox.watch(c,view(['OLD_A','OLD_B','RECOVERED_LATE'],2)); // delayed old history restoration
assert.deepEqual(hits,[]);
sandbox.freshCompletionTurns.set('chat-A',10);
sandbox.watch(c,view(['OLD_A','OLD_B','RECOVERED_LATE','OLD_AT_9'],9));
assert.deepEqual(hits,[]); // historical completion, even while a new turn exists
const real=view(['OLD_A','OLD_B','RECOVERED_LATE','OLD_AT_9','NEW'],10);
sandbox.watch(c,real);
assert.deepEqual(hits,['NEW']);
sandbox.watch(c,real);
assert.deepEqual(hits,['NEW']); // no replays on repeated renders
const other={scope:'chat-B'};
sandbox.watch(other,view(['OTHER_OLD'],3));
assert.deepEqual(hits,['NEW']); // no reload celebrations
sandbox.manualCompletionIds.add('chat-B|MANUAL');
sandbox.watch(other,view(['OTHER_OLD','MANUAL'],3));
assert.deepEqual(hits,['NEW','MANUAL']);
console.log('PASS: fresh-turn scan gate, old side-plan isolation, completion watch baseline/late reconstruction/new generation/manual/switch');
