import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireScope } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PAYMENT_STATUS_LABELS,
  REGISTRATION_STATUS_LABELS,
  type PaymentStatus,
  type RegistrationStatus,
} from "@/lib/constants";
import { teamDisplay } from "@/lib/team-label";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExportRow {
  participant_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  college: string | null;
  course: string | null;
  year: string | null;
  payment_status: PaymentStatus;
  registration_status: RegistrationStatus;
  transaction_id: string | null;
  amount: number;
  registered_at: string;
  team: string;
  team_role: string;
}

/** Participant-entered text can't start a spreadsheet formula. */
function spreadsheetText(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** Downloads an .xlsx of participants registered for a single event. */
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

  const { data } = await supabase
    .from("registrations")
    .select(
      "payment_status, registration_status, transaction_id, amount, registered_at, is_team_head, " +
        "team:teams!team_id(name, member_count), " +
        "profile:profiles!profile_id(participant_id, full_name, email, phone, college, course, year)",
    )
    .eq("event_id", id)
    // Confirmed participants only: pending payment intents, rejected and
    // cancelled rows are not participants.
    .eq("registration_status", "confirmed")
    .order("registered_at", { ascending: true });

  const rows: ExportRow[] = (data ?? []).map((r) => {
    const rec = r as unknown as {
      payment_status: PaymentStatus;
      registration_status: RegistrationStatus;
      transaction_id: string | null;
      amount: number;
      registered_at: string;
      is_team_head: boolean;
      team: { name: string | null; member_count: number } | null;
      profile:
        | {
            participant_id: string | null;
            full_name: string | null;
            email: string | null;
            phone: string | null;
            college: string | null;
            course: string | null;
            year: string | null;
          }
        | Array<Record<string, string | null>>
        | null;
    };
    const p = Array.isArray(rec.profile) ? rec.profile[0] : rec.profile;
    return {
      participant_id: p?.participant_id ?? null,
      full_name: (p?.full_name as string) ?? null,
      email: (p?.email as string) ?? null,
      phone: (p?.phone as string) ?? null,
      college: (p?.college as string) ?? null,
      course: (p?.course as string) ?? null,
      year: (p?.year as string) ?? null,
      payment_status: rec.payment_status,
      registration_status: rec.registration_status,
      transaction_id: rec.transaction_id,
      amount: rec.amount,
      registered_at: rec.registered_at,
      team: teamDisplay(rec.team) ?? "",
      team_role: teamDisplay(rec.team) ? (rec.is_team_head ? "Head" : "Member") : "",
    };
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Wissendurst'27";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Participants");

  sheet.columns = [
    { header: "Participant ID", key: "participant_id", width: 16 },
    { header: "Name", key: "full_name", width: 26 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "College", key: "college", width: 28 },
    { header: "Team", key: "team", width: 28 },
    { header: "Team role", key: "team_role", width: 12 },
    { header: "Course", key: "course", width: 14 },
    { header: "Year", key: "year", width: 14 },
    { header: "Payment", key: "payment_status", width: 16 },
    { header: "Registration", key: "registration_status", width: 16 },
    { header: "Transaction ID", key: "transaction_id", width: 22 },
    { header: "Amount (INR)", key: "amount", width: 14 },
    { header: "Registered At", key: "registered_at", width: 22 },
  ];

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0B2528" },
  };
  sheet.getRow(1).font = { bold: true, color: { argb: "FF6CEFE2" } };

  for (const r of rows) {
    sheet.addRow({
      participant_id: r.participant_id ?? "",
      full_name: r.full_name ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      college: r.college ?? "",
      team: spreadsheetText(r.team),
      team_role: r.team_role,
      course: r.course ?? "",
      year: r.year ?? "",
      payment_status: PAYMENT_STATUS_LABELS[r.payment_status] ?? r.payment_status,
      registration_status:
        REGISTRATION_STATUS_LABELS[r.registration_status] ??
        r.registration_status,
      transaction_id: r.transaction_id ?? "",
      amount: r.amount / 100,
      registered_at: new Date(r.registered_at).toLocaleString("en-IN"),
    });
  }

  sheet.getColumn("amount").numFmt = "#,##0.00";
  sheet.autoFilter = { from: "A1", to: "N1" };

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
