"use server";
import { revalidatePath } from 'next/cache';
import { requireSuperAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { notifyRegistrationConfirmed } from '@/lib/email/notify';
import { auditDelivery, auditNotificationFailure } from '@/lib/email/audit';
import { verifySmtp } from '@/lib/email/mailer';

export type EmailActionState = { ok: boolean; message: string } | null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Explicit per-request claim prevents double-submit/replay; no automatic retry. */
export async function resendRegistrationConfirmation(_prev: EmailActionState, formData: FormData): Promise<EmailActionState> {
 const actor = await requireSuperAdmin();
 const registrationId = String(formData.get("registration_id") ?? '');
 const requestId = String(formData.get("request_id") ?? '');
 if (!UUID.test(registrationId) || !UUID.test(requestId)) {
  await auditNotificationFailure({kind:'registration_confirmed',source:'manual',actorId:actor.id});
  return {ok:false,message:'Invalid registration or request.'};
 }
 const supabase = await createClient();
 const {data: claimed,error} = await supabase.rpc('claim_registration_email_resend', {
  p_registration_id:registrationId,p_request_id:requestId,
 });
 if (error) {
  await auditNotificationFailure({kind:'registration_confirmed',source:'manual',actorId:actor.id,registrationId});
  return {ok:false,message:'Resend refused. Only confirmed registrations are eligible; wait one minute between requests.'};
 }
 if (!claimed) {
  await auditNotificationFailure({kind:'registration_confirmed',source:'manual',actorId:actor.id,registrationId});
  return {ok:false,message:'This request was already handled or is within the one-minute cooldown. Refresh before making a new deliberate request.'};
 }
 // Re-derive all recipients and private templates from the database, never form values.
 const outcomes = await notifyRegistrationConfirmed(registrationId,{actorId:actor.id});
 revalidatePath('/admin/email');
 const accepted = outcomes.filter(o=>o.status==='sent').length;
 const ok = outcomes.length > 0 && accepted===outcomes.length;
 return {ok,message:ok ? `${accepted} message(s) accepted by SMTP. Inbox receipt is not yet verified.` : `${accepted} message(s) accepted; at least one was not sent. Check Email health for the sanitized outcome. No automatic retry.`};
}

/** Verifies connection/authentication only; deliberately sends no message. */
export async function checkSmtp(_prev: EmailActionState): Promise<EmailActionState> {
 void _prev;
 const actor = await requireSuperAdmin();
 const outcome = await verifySmtp();
 await auditDelivery({kind:'smtp_check',source:'check',actorId:actor.id},outcome);
 revalidatePath('/admin/email');
 return {ok:outcome.status==='verified', message:outcome.status==='verified' ? 'SMTP connection verified. No email was sent; inbox delivery is not proven.' : outcome.status==='not_configured' ? 'SMTP is not configured in this deployment. Set the server variables and redeploy.' : `SMTP check failed (${outcome.errorClass} / ${outcome.errorCode}). Check provider settings; no email was sent.`};
}
