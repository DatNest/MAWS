const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'engine.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.version, '2.4.4');
assert.match(index, /engine\.js\?native=\$\{ENGINE_BUILD\}-\$\{token\}/);
assert.doesNotMatch(index, /engine\.js\?native=[^\n]*Date\.now\(/);

const start = index.indexOf('function reconcile()');
const end = index.indexOf('// SillyTavern invokes this interceptor', start);
assert(start >= 0 && end > start);
let enabled = true;
let starts = 0, stops = 0, synchronizes = 0, refreshes = 0;
const state = {available:true, running:false, pending:Promise.resolve(), error:''};
const lifecycle = {state, setLoading(){}, isEnabled:()=>enabled,
  clearPrompt:async()=>{}, startEngine:async()=>{starts++;state.running=true;},
  stopEngine:async()=>{stops++;state.running=false;},
  window:{__MAWS_NATIVE_BRIDGE__:{syncPrompt:async()=>{synchronizes++;},
    refresh:()=>{refreshes++;}}},console};
vm.runInNewContext(index.slice(start,end)+'\nthis.testReconcile=reconcile;', lifecycle);

const panelStart=engine.indexOf('function panelHtml(');
const panelEnd=engine.indexOf('function romanceOfferHtml(',panelStart);
assert(panelStart>=0&&panelEnd>panelStart);
const panelEnv={
 ui:{expandedPanels:new Set()}, ctx:()=>({id:'chatA'}),
 currentScope:()=> 'chatA',
 mwIcon:()=>'<i></i>',
 esc:value=>String(value??''),
 rpDateFormat:date=>date||'Дата неизвестна',
 MAWS_BUILD:'2.4.4', pill:()=>'', sceneTab:()=>'<section id="expanded-test"></section>',
 developerPanel:()=>'',unreadFor:()=>({}), console
};
vm.runInNewContext(engine.slice(panelStart,panelEnd)+'\nthis.makePanel=panelHtml;',panelEnv);
const view={scene:{dateISO:'2026-11-25',time:'12:00',place:'Метрополис'}};
const compact=panelEnv.makePanel(view,{tab:'scene'},false,3);
assert.match(compact,/mw-compact-toggle/);
assert.match(compact,/aria-expanded="false"/);
assert(!compact.includes('mw-expanded'),'Collapsed markup must not build the expensive hidden window');
assert(!compact.includes('expanded-test'),'Collapsed UI must not invoke the tab renderer');
panelEnv.ui.expandedPanels.add('chatA|3');
const expanded=panelEnv.makePanel(view,{tab:'scene'},false,3);
assert.match(expanded,/aria-expanded="true"/);
assert.match(expanded,/mw-expanded/);
assert.match(expanded,/expanded-test/);
panelEnv.ui.expandedPanels.clear();
assert.match(panelEnv.makePanel(view,{tab:'scene'},false,3),/aria-expanded="false"/);
assert.match(engine,/ui\.expandedPanels\.clear\(\);/, 'Chat switches must restore compact defaults');
assert.match(engine,/refresh:\(\)=>\{if\(!stopped\)schedule\(\);\}/);

(async()=>{
 await lifecycle.testReconcile();
 assert.equal(starts,1);assert.equal(stops,0);
 enabled=false;await lifecycle.testReconcile();
 assert.equal(stops,0,'Per-chat OFF should keep the engine loaded');
 enabled=true;await lifecycle.testReconcile();
 assert.equal(starts,1,'Returning to an enabled chat must not reload the engine');
 assert.equal(synchronizes,3,'Each transition must update the active prompt');
 assert.equal(refreshes,3,'Panels must repaint for every transition');
 state.available=false;await lifecycle.testReconcile();
 assert.equal(stops,1,'Disabling the extension package must unload the engine');
 state.available=true;await lifecycle.testReconcile();
 assert.equal(starts,2,'Re-enabling the package must start its engine again');
 console.log('PASS: compact default/expand/re-collapse, lazy markup, warm chats, prompt isolation, package disable cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
