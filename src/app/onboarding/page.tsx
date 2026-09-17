import OnboardingForm from "./OnboardingForm";

export default function OnboardingPage() {
  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
        2 Minuten Setup
      </span>
      <h1 className="font-display mt-2 text-[40px] leading-[1.03] text-ink sm:text-[52px]">
        Dein Profil
      </h1>
      <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-ink-soft">
        Je genauer deine Angaben, desto präziser dein persönlicher Ernährungsplan, inklusive
        Timing rund ums Training.
      </p>
      <div className="mt-10">
        <OnboardingForm />
      </div>
    </div>
  );
}
