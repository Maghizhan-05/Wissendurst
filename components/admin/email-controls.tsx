"use client";
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { checkSmtp, resendRegistrationConfirmation } from '@/lib/actions/email';

export function SmtpCheckForm() {
 const [state,action,pending] = useActionState(checkSmtp,null);
 return <form action={action} className="space-y-3">
  <Button type="submit" variant="outline" loading={pending}>Check SMTP connection</Button>
  {state && <p role="status" className={state.ok ? 'text-sm text-success' : 'text-sm text-alert'}>{state.message}</p>}
 </form>;
}

export function RegistrationEmailResend({registrationId,requestId,team}:{registrationId:string;requestId:string;team:boolean}) {
 const [confirm,setConfirm] = useState(false);
 const [state,action,pending] = useActionState(resendRegistrationConfirmation,null);
 return <section aria-labelledby="confirmation-email" className="mt-6 rounded-2xl border border-border bg-surface p-5">
  <h2 id="confirmation-email" className="font-display text-lg font-semibold text-foreground">Registration confirmation email</h2>
  <p className="mt-2 text-sm text-muted">{team ? 'Resends to every currently confirmed member of this team.' : 'Resends to this confirmed participant.'} Recipients and event links come from the stored registration. This does not change the registration or payment.</p>
  <div className="mt-4">
   {confirm ? <form action={action} className="space-y-3">
    <input type="hidden" name="registration_id" value={registrationId}/>
    <input type="hidden" name="request_id" value={requestId}/>
    <p className="text-sm text-foreground">Send the confirmation now? This is a real email, not a connection check.</p>
    <div className="flex flex-wrap gap-3">
     <Button type="submit" loading={pending} disabled={state!==null}>Send confirmation</Button>
     <Button type="button" variant="ghost" disabled={pending} onClick={()=>setConfirm(false)}>Keep without sending</Button>
    </div>
   </form> : <Button type="button" variant="outline" disabled={state!==null} onClick={()=>setConfirm(true)}>Resend confirmation</Button>}
  </div>
  {state && <p role="status" className={`mt-3 text-sm ${state.ok ? 'text-success':'text-alert'}`}>{state.message} Refresh to create a new request.</p>}
 </section>;
}
