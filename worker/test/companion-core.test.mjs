import { test } from 'node:test';
import assert from 'node:assert/strict';
import C from '../../site/bureau/rsi1/companion/core.js';

test('companion core: VerseTime, salvage, mining, trade, cargo, combat maths', () => {
// VerseTime
const P=8928; const t=1.762e12;
const off=C.calibrateSunrise(t,P); assert(Math.abs(C.frac(t,P,off)-0.25)<1e-9,'sunrise calib');
assert.equal(C.phase(C.frac(t,P,off)),'DAWN');
assert.equal(C.frac(t,null),null);
assert(Math.abs(C.frac(t+P*1000,P,off)-0.25)<1e-6);
assert.equal(C.dur(8928),'2h 28m 48s');
// salvage
let s=C.salvage({rmcScu:100,rmcPrice:7000,cmRawScu:50,cmYield:60,cmPrice:2000,refineFee:5000,components:10000,contract:20000,expenses:3000,minutes:60,crew:2});
assert.equal(s.rmcValue,700000); assert.equal(s.cmRefined,30); assert.equal(s.cmValue,60000);
assert.equal(s.gross,790000); assert.equal(s.net,782000); assert.equal(s.perCrew,391000); assert.equal(s.perHour,782000); assert.equal(s.perCrewHour,391000);
s=C.salvage({}); assert.equal(s.net,0); assert.equal(s.perHour,null); assert.equal(s.crew,1);
// mining
const m=C.mining([{raw:10,yieldPct:50,price:100},{raw:4,yieldPct:100,price:10}],{fee:100,minutes:30,crew:1});
assert.equal(m.refined,9); assert.equal(m.gross,540); assert.equal(m.net,440); assert.equal(m.perHour,880);
// trade chain: capital limits leg1, profit carries to leg2; stock limits
const tr=C.tradeChain(1000,100,[{buy:10,sell:15,minutes:10},{buy:5,sell:6,stock:50,minutes:20}]);
assert.equal(tr.legs[0].qty,100); assert.equal(tr.legs[0].limit,'hold'); assert.equal(tr.legs[0].profit,500);
assert.equal(tr.legs[1].qty,50); assert.equal(tr.legs[1].limit,'stock'); assert.equal(tr.profit,550); assert.equal(tr.endCapital,1550);
assert.equal(tr.perHour,1100);
const tr2=C.tradeChain(95,100,[{buy:10,sell:20}]); assert.equal(tr2.legs[0].qty,9); assert.equal(tr2.legs[0].limit,'capital');
// cargo
let g=C.makeGrid(4,8,2); let un=C.autopack(g,{32:2,1:4}); 
assert.deepEqual(un,{1:4}, 'two 32s fill 4x8x2 fully'); assert.equal(C.usedScu(g),64);
g=C.makeGrid(4,8,2); un=C.autopack(g,{16:2,8:2,4:2,2:2,1:4}); assert.equal(C.usedScu(g),64); assert.deepEqual(un,{}); const g2=C.makeGrid(4,8,2); assert.deepEqual(C.autopack(g2,{32:1,16:2,8:1}),{8:1},'overflow reported');
// no floating boxes
for(const B of g.boxes) if(B.z>0) for(let y=B.y;y<B.y+B.l;y++)for(let x=B.x;x<B.x+B.w;x++) assert(g.occ[((B.z-1)*g.Y+y)*g.X+x],'supported');
// occupancy matches box volume
assert.equal([...g.occ].filter(Boolean).length,C.usedScu(g));
// manual place / unsupported / remove
g=C.makeGrid(4,8,2); assert.equal(C.place(g,1,0,0,1,false),null,'floating rejected');
const b=C.place(g,8,0,0,0,false); assert(b); assert.equal(C.place(g,1,1,1,0,false),null,'overlap rejected');
C.remove(g,b.id); assert.equal(C.usedScu(g),0); assert.equal([...g.occ].filter(Boolean).length,0);
const r=C.place(g,32,0,0,0,true); assert.equal(r,null,'rotated 32 (8 wide) does not fit 4 wide');
// sequence back to front
g=C.makeGrid(2,4,1); C.place(g,1,0,3,0); C.place(g,1,0,0,0); assert.equal(C.sequence(g)[0].y,0);
// TTK
let k=C.ttk({phys:10,energy:0,rpm:600,mag:30,reload:2,mode:'AUTO'},100,{phys:1,energy:1},1);
assert.equal(k.shots,10); assert(Math.abs(k.ttk-0.9)<1e-9); assert.equal(k.reloads,0);
k=C.ttk({phys:10,rpm:600,mag:4,reload:2},100,{phys:1,energy:1},1); assert.equal(k.reloads,2); assert(Math.abs(k.ttk-(0.9+4))<1e-9);
k=C.ttk({phys:10,rpm:600,mag:30,reload:2,mode:'BURST',burst:3,cooldown:0.5},100,{phys:0.5,energy:1},2); // dmg 10 -> 10 shots, 3 gaps
assert.equal(k.shots,10); assert(Math.abs(k.ttk-(0.9+3*0.4))<1e-9);
assert.equal(C.ttk({phys:0,rpm:600},100,{phys:1,energy:1},1),null);
k=C.ttk({phys:20,energy:0,rpm:600},100,{phys:1,energy:1},1); assert.equal(k.shots,5,'exact kill no extra shot');
// BDL
assert.equal(C.bdl([0],10,1,5000),5); assert.equal(C.bdl([0,5000],10,1,5000),15); assert.equal(C.bdl([0],10,1,60000),0);
assert.equal(C.fmt(1234.5,1),'1,234.5'); assert.equal(C.fmt(null),'—');
assert.deepEqual(C.boxesFor(100,32),{32:3,4:1}); assert.deepEqual(C.boxesFor(46,16),{16:2,8:1,4:1,2:1}); assert.deepEqual(C.boxesFor(0,32),{});
assert.deepEqual(C.boxesFor(7, null), { 4: 1, 2: 1, 1: 1 });
});
