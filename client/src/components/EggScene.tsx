import { EggIllustration } from "./PetIllustration";

export default function EggScene({ progress, stage }: { progress: number; stage: "egg" | "cracking" }) {
  const shakeLevel = stage === "egg" ? 0 : progress < 40 ? 1 : progress < 75 ? 2 : 3;
  const crackCount = stage === "egg" ? 0 : progress < 40 ? 1 : progress < 75 ? 2 : 3;

  return (
    <div className="scene egg-scene">
      <div className="clouds" />
      <div className={`egg-wrap shake-${shakeLevel}`}>
        <EggIllustration cracks={crackCount} />
      </div>
      <div className="ground" />
    </div>
  );
}
