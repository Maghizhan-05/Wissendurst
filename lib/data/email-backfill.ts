import 'server-only';
import {requireSuperAdmin} from '@/lib/auth';
import {createClient} from '@/lib/supabase/server';
import {parseBackfillInventory} from '@/lib/email/backfill';

export async function getEmailBackfillInventory(){
 await requireSuperAdmin();
 const {data,error}=await (await createClient()).rpc('email_backfill_inventory');
 if(error) throw Error('BACKFILL_INVENTORY_UNAVAILABLE');
 return parseBackfillInventory(data);
}
