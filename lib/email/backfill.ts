/** Temporary D-031 runner. No timer/automatic scheduling: called only by the confirmed admin action. */
export type BackfillUnit = {registration_id:string;recipient_count:number;sent_count:number};
export type BackfillInventory = {units:BackfillUnit[];remaining_units:number;remaining_recipient_events:number};
export type BatchOutcome = {attempted_units:number;accepted_messages:number;failed_units:number;skipped_units:number;remaining_units:number;remaining_recipient_events:number};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function parseBackfillInventory(raw:unknown):BackfillInventory {
 if(!raw || typeof raw!=='object') throw Error('INVALID_INVENTORY');
 const x=raw as BackfillInventory;
 if(!Array.isArray(x.units)||!Number.isSafeInteger(x.remaining_units)||!Number.isSafeInteger(x.remaining_recipient_events)) throw Error('INVALID_INVENTORY');
 const seen=new Set<string>();let recipients=0;
 for(const unit of x.units){
  if(!unit||!UUID.test(unit.registration_id)||seen.has(unit.registration_id)||!Number.isSafeInteger(unit.recipient_count)||unit.recipient_count<1||!Number.isSafeInteger(unit.sent_count)||unit.sent_count<0||unit.sent_count>=unit.recipient_count) throw Error('INVALID_INVENTORY');
  seen.add(unit.registration_id);recipients+=unit.recipient_count;
 }
 if(x.remaining_units!==x.units.length||x.remaining_recipient_events!==recipients) throw Error('INVALID_INVENTORY');
 return x;
}
export async function runBackfillBatch(deps:{
 inventory:()=>Promise<BackfillInventory>;
 claim:(id:string)=>Promise<boolean>;
 notify:(id:string)=>Promise<{status:string}[]>;
 pause:(ms:number)=>Promise<void>;
}):Promise<BatchOutcome>{
 const initial=await deps.inventory();
 const result:BatchOutcome={attempted_units:0,accepted_messages:0,failed_units:0,skipped_units:0,remaining_units:initial.remaining_units,remaining_recipient_events:initial.remaining_recipient_events};
 // Fixed cap, never supplied by the form. Recheck each unit before and after claim.
 for(const unit of initial.units.slice(0,5)){
  if(!(await deps.inventory()).units.some(u=>u.registration_id===unit.registration_id)){result.skipped_units++;continue;}
  if(result.attempted_units>0) await deps.pause(400);
  if(!await deps.claim(unit.registration_id)){result.skipped_units++;continue;}
  if(!(await deps.inventory()).units.some(u=>u.registration_id===unit.registration_id)){result.skipped_units++;continue;}
  result.attempted_units++;
  const outcomes=await deps.notify(unit.registration_id);
  result.accepted_messages+=outcomes.filter(o=>o.status==='sent').length;
  if(outcomes.length===0||outcomes.some(o=>o.status!=='sent')) result.failed_units++;
 }
 const remaining=await deps.inventory();
 result.remaining_units=remaining.remaining_units;result.remaining_recipient_events=remaining.remaining_recipient_events;
 return result;
}
