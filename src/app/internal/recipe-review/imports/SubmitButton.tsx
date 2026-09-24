"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/Button";

/**
 * Deaktiviert sich, solange das Formular abgeschickt wird - verhindert Mehrfachklicks in der UI.
 * Die eigentliche Absicherung (Idempotenz, bedingte Updates) liegt serverseitig im Service.
 */
export function SubmitButton({ children, pendingLabel, disabled, ...props }: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  const inactive = pending || Boolean(disabled);
  return (
    <Button size="sm" {...props} type="submit" disabled={inactive} aria-disabled={inactive}>
      {pending ? (pendingLabel ?? "Wird ausgeführt …") : children}
    </Button>
  );
}
