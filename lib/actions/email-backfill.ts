"use server";
import {randomUUID} from 'node:crypto';
import {revalidatePath} from 'next/cache';
import {requireSuperAdmin} from '@/lib/auth';
import {createClient} from '@/lib/supabase/server';
import {getEmailBackfillInventory} from '@/lib/data/email-backfill';
import {notifyRegistrationConfirmed} from '@/lib/email/notify';
import {runBackfillBatch,type BatchOutcome} from '@/lib/email/backfill';

export type BackfillActionState={ok:boolean;message:string;batch?:BatchOutcome}|null;
/** Temporary, deliberately invoked only. Never accept recipient or registration IDs from a form. */
export async function sendHistoricalEmailBatch(_prev:BackfillActionState,formData:FormData):Promise<BackfillActionState>{
 const actor=await requireSuperAdmin();
 if(formData.get('confirm')!=='yes') return {ok:false,message:'Confirm that this batch sends real email before continuing.'};
 const supabase=await createClient();
 try {
  const batch=await runBackfillBatch({
   inventory:getEmailBackfillInventory,
   claim:async registrationId=>{
    const {data,error}=await supabase.rpc('claim_registration_email_resend',{
     p_registration_id:registrationId,p_request_id: randomUUID(),
    });
    if(error) throw Error('BACKFILL_CLAIM_REFUSED');
    return data===true;
   },
   notify:registrationId=>notifyRegistrationConfirmed(registrationId,{actorId:actor.id}),
   pause:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  });
  revalidatePath('/admin/email');
  return {ok:batch.failed_units===0,message:`Batch complete: ${batch.attempted_units} unit(s) attempted, ${batch.accepted_messages} message(s) accepted by SMTP, ${batch.failed_units} unit(s) with failures, ${batch.skipped_units} skipped (already complete or claimed/cooling down). Inbox receipt is not proven.`,batch};
 }catch{
  revalidatePath('/admin/email');
  return {ok:false,message:'Batch stopped because inventory or claim could not be verified. Some messages may already have been accepted. Refresh the inventory before making another deliberate request; no automatic retry was started.'};
 }
}
