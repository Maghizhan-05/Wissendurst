import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordDelivery, notificationJob } from './email/record.ts';
test('record persists outcome and logs only sanitized fields; audit failure does not break success',async()=>{
 const rows: unknown[]=[]; const logs: unknown[]=[];
 const result=await recordDelivery({kind:'welcome',source:'automatic'}, {status:'not_configured'}, {
  insert:async row=>{rows.push(row);throw new Error('secret@example.com password');},
  log:row=>logs.push(row),
 });
 assert.equal(result.status,'not_configured');
 assert.equal(rows.length,1);
 assert.equal(logs.length,2);
 assert.doesNotMatch(JSON.stringify(logs),/secret@example|password/);
});
test('notification lookup and template failure is logged without rejecting the business action',async()=>{
 const events: unknown[]=[];
 const r=await notificationJob(async()=>{throw new Error('private input');},async()=>{events.push('failed');});
 assert.equal(r,undefined);assert.deepEqual(events,['failed']);
});
