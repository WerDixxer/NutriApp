import Link from "next/link";
import { Card } from "@/components/ui/Card";

export default function NoHouseholdNotice() {
  return (
    <Card className="p-6">
      <p className="text-body text-ink-soft">
        Ein Essensplan gehört immer zu einem Haushalt. Du bist aktuell in keinem.{" "}
        <Link href="/household" className="font-semibold text-ink underline underline-offset-2">
          Haushalt einrichten
        </Link>
        .
      </p>
    </Card>
  );
}
