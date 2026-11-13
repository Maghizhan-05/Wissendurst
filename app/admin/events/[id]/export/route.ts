import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireScope } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PAYMENT_STATUS_LABELS,
  type PaymentStatus,
} from "@/lib/constants";
import { teamLabel } from "@/lib/team-label";
import { groupRegistrations } from "@/lib/registration-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Profile = {
  participant_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  college: string | null;
  course: string | null;
  year: string | null;
};

type Row = {
  id: string;
  team_id: string | null;
  is_team_head: boolean;
  payment_status: PaymentStatus;
  transaction_id: string | null;
  amount: number;
  registered_at: string;
  team: { name: string | null; member_count: number; code: string | null } | null;
  profile: Profile | null;
};

/** Participant-entered text can't start a spreadsheet formula. */
function spreadsheetText(v: string | null | undefined): string {
  const s = v ?? "";
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2528" } };
  row.font = { bold: true, color: { argb: "FF6CEFE2" } };
}

/**
 * Downloads an .xlsx of an event's CONFIRMED registrations: one row per team
 * registration (0032) and one row per single registration.
 */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/admin/events/[id]/export">,
) {
  await requireScope("events"); // redirects admins without the events scope
  const { id } = await ctx.params;

  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select("slug, title")
    .eq("id", id)
    .maybeSingle();
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("registrations")
    .select(
      "id, team_id, is_team_head, payment_status, transaction_id, amount, registered_at, " +
        "team:teams!team_id(name, member_count, code), " +
        "profile:profiles!profile_id(participant_id, full_name, email, phone, college, course, year)",
    )
    .eq("event_id", id)
    // Confirmed participants only: pending payment intents, rejected and
    // cancelled rows are not participants.
    .eq("registration_status", "confirmed")
    .order("registered_at", { ascending: true });
  if (error) {
    console.error("export query failed:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Row[];
  const { teams, singles } = groupRegistrations(rows);
  teams.reverse(); // oldest first in the sheet

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Wissendurst'27";
  workbook.created = new Date();

  const teamSheet = workbook.addWorksheet("Team registrations");
  teamSheet.columns = [
    { header: "Team code", key: "code", width: 14 },
    { header: "Team name", key: "name", width: 28 },
    { header: "Size", key: "size", width: 8 },
    { header: "Head ID", key: "head_id", width: 16 },
    { header: "Head name", key: "head_name", width: 24 },
    { header: "Head email", key: "head_email", width: 28 },
    { header: "Head phone", key: "head_phone", width: 16 },
    { header: "Members (ID — name)", key: "members", width: 60 },
    { header: "Payment", key: "payment", width: 14 },
    { header: "Transaction ID", key: "txn", width: 20 },
    { header: "Amount (INR)", key: "amount", width: 14 },
    { header: "Registered At", key: "at", width: 22 },
  ];
  styleHeader(teamSheet);
  for (const t of teams) {
    const h = t.head;
    teamSheet.addRow({
      code: t.code ?? "",
      name: spreadsheetText(teamLabel(t.name)),
      size: t.members.length,
      head_id: h.profile?.participant_id ?? "",
      head_name: spreadsheetText(h.profile?.full_name),
      head_email: h.profile?.email ?? "",
      head_phone: h.profile?.phone ?? "",
      members: spreadsheetText(
        t.members.map((m) => `${m.profile?.participant_id ?? ""} — ${m.profile?.full_name ?? ""}`).join("; "),
      ),
      payment: PAYMENT_STATUS_LABELS[h.payment_status] ?? h.payment_status,
      txn: h.transaction_id ?? "",
      amount: h.amount / 100,
      at: new Date(h.registered_at).toLocaleString("en-IN"),
    });
  }
  teamSheet.getColumn("amount").numFmt = "#,##0.00";

  const singleSheet = workbook.addWorksheet("Single registrations");
  singleSheet.columns = [
    { header: "Participant ID", key: "participant_id", width: 16 },
    { header: "Name", key: "full_name", width: 26 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "College", key: "college", width: 28 },
    { header: "Course", key: "course", width: 14 },
    { header: "Year", key: "year", width: 14 },
    { header: "Payment", key: "payment", width: 14 },
    { header: "Transaction ID", key: "txn", width: 20 },
    { header: "Amount (INR)", key: "amount", width: 14 },
    { header: "Registered At", key: "at", width: 22 },
  ];
  styleHeader(singleSheet);
  for (const r of singles) {
    const p = r.profile;
    singleSheet.addRow({
      participant_id: p?.participant_id ?? "",
      full_name: spreadsheetText(p?.full_name),
      email: p?.email ?? "",
      phone: p?.phone ?? "",
      college: spreadsheetText(p?.college),
      course: spreadsheetText(p?.course),
      year: spreadsheetText(p?.year),
      payment: PAYMENT_STATUS_LABELS[r.payment_status] ?? r.payment_status,
      txn: r.transaction_id ?? "",
      amount: r.amount / 100,
      at: new Date(r.registered_at).toLocaleString("en-IN"),
    });
  }
  singleSheet.getColumn("amount").numFmt = "#,##0.00";
  teamSheet.autoFilter = { from: "A1", to: "L1" };
  singleSheet.autoFilter = { from: "A1", to: "K1" };

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${event.slug}-participants.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
