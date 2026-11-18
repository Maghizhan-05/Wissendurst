import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordDelivery, type DeliveryContext } from './record';
import { sendMail } from './mailer';
import type { DeliveryOutcome, CheckOutcome } from './delivery';

export async function auditDelivery<T extends DeliveryOutcome | CheckOutcome>(context: DeliveryContext, outcome: T): Promise<T> {
 return recordDelivery(context, outcome, {
  insert: async row => {
   const { error } = await createAdminClient().from('email_delivery_log').insert(row);
   if (error) throw new Error('AUDIT_FAILED');
  },
  log: entry => console.info('email_delivery', entry),
 });
}
export async function deliverLogged(context: DeliveryContext, mail: Parameters<typeof sendMail>[0]): Promise<DeliveryOutcome> {
 return auditDelivery(context, await sendMail(mail));
}
export async function auditNotificationFailure(context: DeliveryContext): Promise<void> {
 await auditDelivery(context, {status: 'failed', errorClass: 'unknown', errorCode: 'UNKNOWN'});
}
