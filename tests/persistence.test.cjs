const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(root,'engine.js'),'utf8');
const pure={window:{__MAWS_UNIVERSAL_TEST_ONLY__:true},console};
vm.runInNewContext(script,pure);
const A=pure.window.__MAWS_UNIVERSAL_API__;
const normalized=A.normalize({
 version:43,enabled:true,theme:{panel:'#4b3844'},
 promptOverrides:{'scene.premise':'PERSONAL CHAT PROMPT'},
 generated:{},ledger:[{kind:'manual'}],speakerStyles:[],
});
assert.equal(normalized.enabled,true);
assert.equal(normalized.theme.panel,'#4b3844');
assert.equal(normalized.promptOverrides['scene.premise'],'PERSONAL CHAT PROMPT');
assert.equal(normalized.ledger.length,1);
assert.equal(A.defaultState().enabled,false,'New chat must start OFF');

// 100 response checkpoints and many quest transitions are compacted into
// no more than 32 records. Manual actions and canonical definitions survive.
const state=A.defaultState();
state.enabled=true;
state.theme={panel:'#4b3844'};
state.promptOverrides={'scene.premise':'DO NOT LOSE THIS'};
state.packs={example:{id:'example',quests:[{id:'MAIN_KEEP',title:'My quest'}]}};
state.ledger=Array.from({length:40},(_,i)=>({kind:'rel',person:'A',delta:1,anchor:{id:i,sig:'0:stable'}}));
state.profileHistory=Array.from({length:25},(_,i)=>({at:String(i)}));
state.questProposalHistory=Array.from({length:25},(_,i)=>({id:i}));
const chat=[];
for(let i=0;i<100;i++){
 chat.push({is_user:false,is_system:false,mes:'ответ '+i,swipe_id:0,extra:{}});
 const qs={};
 for(let j=0;j<=Math.floor(i/5);j++){
  const start=j*5, status=i<start?'locked':i<start+2?'active':'completed';
  qs['Q'+j]={status,summary:'completed q'+j,endedAt:{date:'2026-10-01',time:'10:00'}};
 }
 state.timeline[i]={sig:'0:stable',questStartedAt:i%5===0?{['Q'+Math.floor(i/5)]:'2026-10-01T00:00:00Z'}:{},
  data:{scene:{dateISO:'2026-10-01',time:'10:00',present:[]},quests:qs}};
}
A.compactForStorage(state);
const kept=Object.keys(state.timeline);
assert(kept.length<=32,'Unbounded checkpoints');
assert.equal(state.ledger.length,40,'Manual ledger must be lossless');
assert.equal(state.packs.example.quests[0].title,'My quest');
assert.equal(state.theme.panel,'#4b3844');
assert.equal(state.promptOverrides['scene.premise'],'DO NOT LOSE THIS');
assert(state.profileHistory.length<=5);
assert(state.questProposalHistory.length<=20);
assert(state.questAnchors.Q0,'Lost original quest start');
assert(state.questArchive.Q0,'Lost archived quest outcome');
const fakeContext={chat};
assert(A.firstActiveQuestSnapshot(fakeContext,state,'Q0',80),'Cannot recover compacted quest start');
state.timeline={};
const archived=A.questArchiveReceipt('Q0',{status:'locked'},state,null,[],99,chat);
assert.equal(archived.status,'completed','Cannot recover compacted quest outcome');
console.log('PASS: chat ON/OFF state, default OFF, own palette/prompts, manual ledger, limited snapshots, quest starts and finished archive');
