import { SectionHeader } from "@/components/ui/SectionHeader";
import NewRecipeForm from "./NewRecipeForm";

export default function NewRecipePage() {
  return (
    <div>
      <SectionHeader
        eyebrow="Eigenes Rezept"
        title="Was hast du gekocht?"
        intro="Trag dein Gericht mit Nährwerten und Zubereitung ein. Es taucht danach automatisch in deinem Essensplan auf, wenn es zu deinem Ziel passt."
      />
      <div className="mt-10">
        <NewRecipeForm />
      </div>
    </div>
  );
}
