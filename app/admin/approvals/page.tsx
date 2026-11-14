import { redirect } from "next/navigation";
import { requireScope } from "@/lib/auth";

/** Sign-up approvals are retired (0035: approval-free sign-up). */
export default async function RetiredApprovalsPage() {
  await requireScope("signups");
  redirect("/admin/users");
}
