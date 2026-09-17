import NewRecipeForm from "./NewRecipeForm";

export default function NewRecipePage() {
  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
        Eigenes Rezept
      </span>
      <h1 className="font-display mt-2 text-[40px] leading-[1.03] text-ink sm:text-[52px]">
        Was hast du gekocht?
      </h1>
      <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-ink-soft">
        Trag dein Gericht mit Nährwerten und Zubereitung ein. Es taucht danach automatisch in
        deinem Essensplan auf, wenn es zu deinem Ziel passt.
      </p>
      <div className="mt-10">
        <NewRecipeForm />
      </div>
    </div>
  );
}
