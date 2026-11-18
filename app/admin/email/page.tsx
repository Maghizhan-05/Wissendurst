import type { Metadata } from 'next';
import { requireSuperAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { smtpConfigured } from '@/lib/email/mailer';
import { SmtpCheckForm } from '@/components/admin/email-controls';

export const metadata: Metadata = {title:'Admin · Email health'};
export const dynamic = 'force-dynamic';
type Summary = { kind:string;outcome:string;source:string;attempts:number;last_attempt_at:string };
export default async function EmailHealthPage() {
 await requireSuperAdmin();
 const configured = smtpConfigured();
 const {data,error} = await (await createClient()).rpc('email_delivery_summary');
 const rows = (data ?? []) as Summary[];
 return <div className="mx-auto max-w-4xl space-y-6">
  <header>
   <h1 className="font-display text-2xl font-semibold text-foreground">Email health</h1>
   <p className="mt-2 text-sm text-muted">Application notifications only. Supabase Auth password-recovery email uses a separate provider configuration.</p>
  </header>
  <section className="space-y-4 rounded-2xl border border-border bg-surface p-6">
   <h2 className="font-display text-lg font-semibold text-foreground">SMTP · {configured ? 'Configured' : 'Not configured'}</h2>
   <p className="text-sm text-muted">{configured ? 'Required credentials are present in this deployment. Presence does not prove authentication or inbox delivery.' : 'Application messages are skipped and recorded as not configured. Set the server variables and redeploy.'} No host, account or credentials are displayed.</p>
   <SmtpCheckForm/>
  </section>
  <section className="rounded-2xl border border-border bg-surface p-6">
   <h2 className="font-display text-lg font-semibold text-foreground">Attempts · last 7 days</h2>
   <p className="mt-2 text-sm text-muted">Sent means accepted by SMTP, not delivered to an inbox. Verified means connection/authentication only; no test message. Manual resends are available on confirmed registration detail pages. There is no automatic retry or historical backfill.</p>
   {error ? <p role="status" className="mt-4 text-sm text-alert">Delivery history could not be loaded. Check the migration and server configuration.</p> : rows.length===0 ? <p className="mt-4 text-sm text-muted">No attempts recorded yet.</p> : <ul className="mt-4 divide-y divide-border">
    {rows.map(row=><li key={`${row.kind}-${row.outcome}-${row.source}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
     <div><p className="font-medium text-foreground">{row.kind.replaceAll('_',' ')} · {row.outcome.replaceAll('_',' ')}</p><p className="text-muted">{row.source} · {new Date(row.last_attempt_at).toISOString().replace('T',' ').slice(0,19)} UTC</p></div>
     <span className="font-mono text-foreground">{row.attempts} attempt(s)</span>
    </li>)}
   </ul>}
  </section>
 </div>;
}
