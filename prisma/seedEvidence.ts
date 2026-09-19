import { PrismaClient } from "@prisma/client";
import { evidenceClaimInputSchema, evidenceSourceInputSchema } from "../src/lib/validation/evidence";
import { kerksick2017Claims, kerksick2017Source } from "../src/lib/evidence/data/kerksick2017";

/**
 * Eigenständiges Seed-Skript für die Evidence Library (separat von
 * prisma/seed.ts, das ausschließlich Rezepte seedet und dabei bewusst NICHT
 * idempotent ist - `recipe.create` ohne Duplikatsprüfung). Evidence-Daten
 * sind kuratiert und mehrfach manuell auditiert, daher hier: Validierung vor
 * jedem Schreibvorgang + Upsert über den fachlichen Schlüssel (`doi` bzw.
 * `claimId`), damit ein erneuter Lauf weder Duplikate erzeugt noch bestehende
 * Zeilen unvalidiert überschreibt.
 */
const prisma = new PrismaClient();

async function main() {
  const source = evidenceSourceInputSchema.parse(kerksick2017Source);

  console.log(`Seede Evidence Source: ${source.doi}`);
  const sourceRow = await prisma.evidenceSource.upsert({
    where: { doi: source.doi },
    update: {
      citation: source.citation,
      pmid: source.pmid ?? null,
      pmcid: source.pmcid ?? null,
      accessedText: source.accessedText,
    },
    create: {
      citation: source.citation,
      doi: source.doi,
      pmid: source.pmid ?? null,
      pmcid: source.pmcid ?? null,
      accessedText: source.accessedText,
    },
  });

  console.log(`Seede ${kerksick2017Claims.length} Evidence Claims...`);
  for (const rawClaim of kerksick2017Claims) {
    const claim = evidenceClaimInputSchema.parse(rawClaim);
    const data = {
      sourceId: sourceRow.id,
      claimType: claim.claimType,
      topic: claim.topic,
      statement: claim.statement,
      population: claim.population ?? null,
      trainingContext: claim.trainingContext ?? null,
      trainingType: claim.trainingType ?? null,
      intensityOrDuration: claim.intensityOrDuration ?? null,
      nutritionContext: claim.nutritionContext ?? null,
      timingContext: claim.timingContext ?? null,
      direction: claim.direction,
      evidenceStrength: claim.evidenceStrength,
      limitations: JSON.stringify(claim.limitations),
      justification: claim.justification,
      status: claim.status,
    };
    await prisma.evidenceClaim.upsert({
      where: { claimId: claim.claimId },
      update: data,
      create: { ...data, claimId: claim.claimId },
    });
  }

  const totalClaimsForSource = await prisma.evidenceClaim.count({ where: { sourceId: sourceRow.id } });
  console.log(`Fertig. Evidence Source '${source.doi}' hat jetzt ${totalClaimsForSource} Claim(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
