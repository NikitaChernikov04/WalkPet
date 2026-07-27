import { completeAvatar, failAvatar, getOrCreatePet, setAvatarPending, setPetName, type Pet } from "./pet-logic.js";
import { avatarUrlFrom, getAvatarGeneration, startAvatarGeneration } from "./nanobanana.js";
import { processAvatarImage } from "./imageProcessing.js";
import { buildPetPrompt } from "./species.js";
import { effectiveEvolutionStage } from "./leveling.js";
import { generatePetName } from "./groq.js";

/** Actions the player takes on their own pet, kept out of the HTTP layer so api/pet.ts stays a
 *  thin router over them. They used to be three separate endpoints; Vercel counts every file
 *  under api/ as its own function, and the Hobby plan caps how many a deployment may have. */

export class PetActionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function requireHatched(pet: Pet): void {
  if (pet.stage !== "hatched") {
    throw new PetActionError(400, "pet must be hatched first");
  }
}

/** Starts a from-scratch avatar generation. An empty description means "redraw the canonical
 *  look for my current rarity and evolution stage" — buildPetPrompt falls back to the stage's
 *  default outfit when there's no custom flavor. */
export async function requestAvatarGeneration(userId: number, description: string): Promise<Pet> {
  const pet = await getOrCreatePet(userId);
  requireHatched(pet);

  // A redraw (no description, avatar already completed) rolls a fresh seed on purpose: the point
  // is to break away from whatever pre-existing look the old seed was tied to.
  const seed =
    !description && pet.avatar_status === "completed"
      ? Math.floor(Math.random() * 2 ** 31)
      : (pet.avatar_seed ?? Math.floor(Math.random() * 2 ** 31));
  // A from-scratch generation draws the full outfit for the pet's current stage, so that's the
  // stage the resulting artwork depicts — recorded so evolution edits know where to resume.
  const targetStage = effectiveEvolutionStage(pet.level, pet.evolution_bonus_tiers);
  const gen = await startAvatarGeneration(buildPetPrompt(pet.species, description, pet.rarity, targetStage), { seed });
  const url = avatarUrlFrom(gen);

  await setAvatarPending(userId, gen.id, description, seed, targetStage);

  if (gen.status === "completed" && url) {
    try {
      // The generated image's own URL is kept as the evolution reference — see completeAvatar.
      await completeAvatar(userId, await processAvatarImage(url), url);
    } catch (err) {
      console.error("avatar processing failed", err);
      await failAvatar(userId);
    }
  } else if (gen.status === "failed" || gen.status === "cancelled") {
    await failAvatar(userId);
  }
  // Otherwise it's still running and the client polls for the result.

  return getOrCreatePet(userId);
}

/** Checks an in-flight generation and stores the result if it has landed. Cheap status check,
 *  never starts a new generation. */
export async function pollAvatarGeneration(userId: number): Promise<Pet> {
  const pet = await getOrCreatePet(userId);
  if (pet.avatar_status !== "pending" || !pet.avatar_generation_id) return pet;

  try {
    const gen = await getAvatarGeneration(pet.avatar_generation_id);
    const url = avatarUrlFrom(gen);
    if (gen.status === "completed" && url) {
      await completeAvatar(userId, await processAvatarImage(url), url);
    } else if (gen.status === "failed" || gen.status === "cancelled") {
      await failAvatar(userId);
    } else {
      return pet; // still running
    }
  } catch (err) {
    // The image service has no record of this generation (e.g. a stale id) — surface it as a
    // failure rather than leaving the client polling forever.
    console.error("avatar poll failed", err);
    await failAvatar(userId);
  }
  return getOrCreatePet(userId);
}

export async function applyPetName(userId: number, name: string | null): Promise<Pet> {
  const pet = await getOrCreatePet(userId);
  requireHatched(pet);
  // A null name means "suggest one for me" — generatePetName never throws, falling back to a
  // local pool if the model is unavailable.
  await setPetName(userId, name ?? (await generatePetName(pet.species, pet.avatar_description)));
  return getOrCreatePet(userId);
}
