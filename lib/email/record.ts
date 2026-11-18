import type { DeliveryOutcome, CheckOutcome } from './delivery.ts';
export type DeliveryContext = {
 kind: 'welcome' | 'registration_confirmed' | 'payment_status' | 'smtp_check';
 source: 'automatic' | 'manual' | 'check';
 registrationId?: string | null;
 actorId?: string | null;
};
export type DeliveryRow = {
 kind: DeliveryContext['kind']; source: DeliveryContext['source'];
 registration_id: string | null; actor_id: string | null;
 outcome: string; error_class: string | null; error_code: string | null;
 provider_message_id: string | null;
};
/** Always best effort: never replace a successful registration/payment with an SMTP/audit failure. */
export async function recordDelivery<T extends DeliveryOutcome | CheckOutcome>(
 context: DeliveryContext, outcome: T,
 deps: { insert: (row: DeliveryRow) => Promise<void>; log: (entry: object) => void },
): Promise<T> {
 const row: DeliveryRow = {
  kind: context.kind, source: context.source,
  registration_id: context.registrationId ?? null, actor_id: context.actorId ?? null,
  outcome: outcome.status,
  error_class: outcome.status === 'failed' ? outcome.errorClass : null,
  error_code: outcome.status === 'failed' ? outcome.errorCode : null,
  provider_message_id: outcome.status === 'sent' ? outcome.providerMessageId : null,
 };
 // No recipient, template, provider text, identifiers or configuration in runtime logs.
 deps.log({ kind: row.kind, source: row.source, outcome: row.outcome, error_class: row.error_class, error_code: row.error_code });
 try { await deps.insert(row); }
 catch { deps.log({ kind: row.kind, outcome: 'audit_failed' }); }
 return outcome;
}
export async function notificationJob<T>(run: () => Promise<T>, failed: () => Promise<void>): Promise<T | undefined> {
 try { return await run(); }
 catch { try { await failed(); } catch { /* Failure reporting must never fail the business action. */ } return undefined; }
}
