"use client";
import {useActionState} from 'react';
import {Button} from '@/components/ui/button';
import {sendHistoricalEmailBatch} from '@/lib/actions/email-backfill';

export function EmailBackfill({remainingUnits,recipientEvents}:{remainingUnits:number;recipientEvents:number}){
 const [state,action,pending]=useActionState(sendHistoricalEmailBatch,null);
 return <section aria-labelledby="email-backfill" className="space-y-4 rounded-2xl border border-alert/30 bg-surface p-6">
  <h2 id="email-backfill" className="font-display text-lg font-semibold text-foreground">Temporary historical confirmation backfill</h2>
  <p className="text-sm text-foreground"><strong>{remainingUnits}</strong> remaining registration units · <strong>{recipientEvents}</strong> recipient-event messages in a full retry pass.</p>
  <p className="text-sm text-alert">Warning: this sends real email. Each click attempts at most five eligible registrations/teams, using their normal confirmations and private event links. Partial teams retry the whole team, so a member who already received a confirmation may receive it again.</p>
  <p className="text-sm text-muted">Already-complete units are excluded. Failed/partial units remain eligible after the one-minute cooldown. The batch pauses 400 ms between units. No automatic execution, retry or scheduler. Refresh after each batch and verify inbox receipt; SMTP acceptance alone is not delivery proof.</p>
  <form action={action} className="space-y-4">
   <label className="flex min-h-11 items-center gap-3 text-sm text-foreground"><input type="checkbox" name="confirm" value="yes" required disabled={pending||remainingUnits===0}/> I authorize this batch of real confirmation emails.</label>
   <Button type="submit" loading={pending} disabled={remainingUnits===0}>Send next batch · max 5 units</Button>
  </form>
  {state&&<p role="status" className={`text-sm ${state.ok?'text-success':'text-alert'}`}>{state.message}</p>}
  {state?.batch&&<p className="text-sm text-muted">After batch: {state.batch.remaining_units} units / {state.batch.remaining_recipient_events} recipient-event messages remaining. Refresh before the next batch.</p>}
  {remainingUnits===0&&<p className="text-sm text-success">No evidence-gap units remain. Ask Ned to verify and arrange removal of this temporary control.</p>}
 </section>;
}
