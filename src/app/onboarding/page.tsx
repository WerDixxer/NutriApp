import { SectionHeader } from "@/components/ui/SectionHeader";
import OnboardingForm from "./OnboardingForm";

export default function OnboardingPage() {
  return (
    <div>
      <SectionHeader
        eyebrow="2 Minuten Setup"
        title="Dein Profil"
        intro="Je genauer deine Angaben, desto präziser dein Plan, inklusive Timing rund ums Training."
      />
      <div className="mt-10">
        <OnboardingForm />
      </div>
    </div>
  );
}
