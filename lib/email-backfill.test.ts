import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseBackfillInventory,runBackfillBatch,type BackfillInventory} from './email/backfill.ts';
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const inventory=(n=8):BackfillInventory=>({units:Array.from({length:n},(_,i)=>({registration_id:id(i+1),recipient_count:2,sent_count:0})),remaining_units:n,remaining_recipient_events:2*n});
test('inventory parser fails closed and validates counts, canonical IDs and unique units',()=>{
 assert.deepEqual(parseBackfillInventory(inventory()),inventory());
 for(const bad of [null,{}, {...inventory(),remaining_units:1},{...inventory(),remaining_recipient_events:0}, {...inventory(),units:[...inventory().units,inventory().units[0]]}, {...inventory(1),units:[{registration_id:'arbitrary',recipient_count:2,sent_count:0}]}, {...inventory(1),units:[{registration_id:id(1),recipient_count:2,sent_count:2}]}]) assert.throws(()=>parseBackfillInventory(bad));
});
test('explicit batch caps at five DB-derived units and spaces sends by 400ms',async()=>{
 const sent:string[]=[];const pauses:number[]=[];const state=inventory();
 const r=await runBackfillBatch({inventory:async()=>state,claim:async()=>true,notify:async id=>{sent.push(id);return [{status:'sent'},{status:'sent'}];},pause:async ms=>{pauses.push(ms);}});
 assert.deepEqual(sent,state.units.slice(0,5).map(u=>u.registration_id));assert.equal(r.attempted_units,5);assert.equal(r.accepted_messages,10);assert.deepEqual(pauses,[400,400,400,400]);
});
test('rechecks after claim: an already completed unit must never send again',async()=>{
 let calls=0;let sends=0;
 const r=await runBackfillBatch({inventory:async()=>++calls<3?inventory(1):inventory(0),claim:async()=>true,notify:async()=>{sends++;return[{status:'sent'}];},pause:async()=>{}});
 assert.equal(sends,0);assert.equal(r.skipped_units,1);
});
test('partial failures are reported; partial units remain eligible on the next invocation',async()=>{
 const state=inventory(1);state.units[0].sent_count=1;
 let sends=0;const deps={inventory:async()=>state,claim:async()=>true,notify:async()=>{sends++;return [{status:'sent'},{status:'failed'}];},pause:async()=>{}};
 const r=await runBackfillBatch(deps);assert.equal(r.failed_units,1);assert.equal(r.accepted_messages,1);assert.equal(r.remaining_units,1);await runBackfillBatch(deps);assert.equal(sends,2);
});
test('claim cooldown / concurrent loser does not send',async()=>{
 let claims=0;let sends=0;const deps={inventory:async()=>inventory(1),claim:async()=>++claims===1,notify:async()=>{sends++;return[{status:'sent'},{status:'sent'}];},pause:async()=>{}};
 await Promise.all([runBackfillBatch(deps),runBackfillBatch(deps)]);assert.equal(sends,1);
});
test('inventory or transport failure never becomes success',async()=>{
 await assert.rejects(runBackfillBatch({inventory:async()=>{throw Error('DB unavailable');},claim:async()=>true,notify:async()=>[],pause:async()=>{}}));
 const r=await runBackfillBatch({inventory:async()=>inventory(1),claim:async()=>true,notify:async()=>[],pause:async()=>{}});assert.equal(r.failed_units,1);
});
const read=(f:string)=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('server action authorizes first, requires deliberate confirmation, supplies fresh request UUIDs and no form recipient/registration IDs',()=>{
 const s=read('lib/actions/email-backfill.ts');assert.ok(s.indexOf('await requireSuperAdmin()')<s.indexOf('runBackfillBatch('));assert.match(s,/formData.get\('confirm'\)/);assert.match(s,/p_request_id: randomUUID\(\)/);assert.doesNotMatch(s,/formData.get\(['"](?:email|to|registration_id|unit_id)['"]\)/);
 assert.match(s,/notifyRegistrationConfirmed/);assert.doesNotMatch(s,/\.from\(['"](?:registrations|teams|payments)['"]\)[\s\S]*?\.(?:update|insert|delete)\(/);
});
test('no hidden automatic execution; page loads inventory only, control submits explicitly',()=>{
 const c=read('components/admin/email-backfill.tsx');assert.doesNotMatch(c,/useEffect|setInterval|setTimeout/);assert.match(c,/type="submit"/);assert.match(c,/name="confirm"/);assert.match(c,/real email/i);
 const p=read('app/admin/email/page.tsx');assert.match(p,/EmailBackfill/);assert.doesNotMatch(p,/runBackfillBatch\(/);
});
