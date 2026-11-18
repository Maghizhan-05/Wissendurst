import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f: string) => readFileSync(new URL('../'+f, import.meta.url), 'utf8');
test('every notification send consumes and audits the delivery outcome', () => {
 const s=read('lib/email/notify.ts');
 assert.doesNotMatch(s, /await sendMail\(/);
 assert.match(s, /deliverLogged/);
 for (const name of ['notifyWelcome','notifyRegistrationConfirmed','notifyPaymentUnderReview','notifyPaymentRejected','notifyGeneralRegistrationSubmitted','notifyGeneralRegistrationVerified','notifyGeneralRegistrationRejected']) {
  assert.match(s,new RegExp('export (?:async )?function '+name+'\\('));
 }
 assert.doesNotMatch(s,/console\.error/);
});
test('SMTP and resend actions authorize before network and claim resends before sending',()=>{
 const s=read('lib/actions/email.ts');
 const check=s.slice(s.indexOf('export async function checkSmtp'));
 assert.ok(check.indexOf('await requireSuperAdmin()') < check.indexOf('verifySmtp()'));
 const resend=s.slice(s.indexOf('export async function resendRegistrationConfirmation'),s.indexOf('export async function checkSmtp'));
 assert.ok(resend.indexOf('await requireSuperAdmin()') < resend.indexOf('claim_registration_email_resend'));
 assert.ok(resend.indexOf('claim_registration_email_resend') < resend.indexOf('notifyRegistrationConfirmed('));
 assert.doesNotMatch(resend,/formData.get\("(?:to|email|subject|body)"/);
 assert.match(resend,/if \(!claimed\)/);
});
test('super-admin health page and confirmed-registration control have server boundaries',()=>{
 const p=read('app/admin/email/page.tsx');
 assert.ok(p.indexOf('await requireSuperAdmin()')<p.indexOf('email_delivery_summary'));
 assert.doesNotMatch(p,/process\.env|SMTP_HOST|SMTP_USER|SMTP_PASS/);
 assert.match(read('app/admin/registrations/[id]/page.tsx'),/access\.isSuper &&/);
});
