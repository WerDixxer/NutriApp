import { requireSessionUserId } from "@/lib/session";
import { getCurrentHouseholdContextWithMembers } from "@/lib/household/context";
import { getHousehold } from "@/lib/household/householdService";
import { listPendingInvites } from "@/lib/household/inviteService";
import { SectionHeader } from "@/components/ui/SectionHeader";
import HouseholdClient, { type HouseholdView, type InviteView, type MemberView } from "./HouseholdClient";
import NoHouseholdClient from "./NoHouseholdClient";

export default async function HouseholdPage() {
  await requireSessionUserId();
  const ctx = await getCurrentHouseholdContextWithMembers();

  if (!ctx) {
    return (
      <div>
        <HouseholdHeader />
        <div className="mt-10">
          <NoHouseholdClient />
        </div>
      </div>
    );
  }

  const [household, pendingInvites] = await Promise.all([
    getHousehold(ctx.householdId),
    ctx.role === "OWNER" ? listPendingInvites(ctx.householdId) : Promise.resolve([]),
  ]);
  if (!household) {
    return (
      <div>
        <HouseholdHeader />
        <div className="mt-10">
          <NoHouseholdClient />
        </div>
      </div>
    );
  }

  const householdView: HouseholdView = { id: household.id, name: household.name, currency: household.currency };
  const memberViews: MemberView[] = ctx.members.map((m) => ({
    id: m.id,
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
    user: m.user,
  }));
  const inviteViews: InviteView[] = pendingInvites.map((i) => ({
    id: i.id,
    invitedEmail: i.invitedEmail,
    role: i.role,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  }));

  return (
    <div>
      <HouseholdHeader />
      <div className="mt-10">
        <HouseholdClient
          household={householdView}
          role={ctx.role}
          memberId={ctx.memberId}
          initialMembers={memberViews}
          initialInvites={inviteViews}
        />
      </div>
    </div>
  );
}

function HouseholdHeader() {
  return (
    <SectionHeader
      eyebrow="Mein Haushalt"
      title="Haushalt & Familie"
      intro="Gemeinsame Vorräte, Budgets und Ausgaben. Persönliche Ziele, Allergien und Präferenzen bleiben getrennt."
    />
  );
}
