import { redirect } from "next/navigation";
import { requireScope } from "@/lib/auth";

/** Sign-up approvals are retired (0035); the account lives under Users. */
export default async function RetiredApprovalReviewPage({
  params,
}: PageProps<"/admin/approvals/[id]">) {
  await requireScope("signups");
  const { id } = await params;
  redirect(`/admin/users/${encodeURIComponent(id)}`);
}
