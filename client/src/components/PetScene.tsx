import { useEffect, useRef, useState } from "react";
import { Heart, Sparkles, Moon, Footprints } from "lucide-react";
import { PetIllustration } from "./PetIllustration";

interface Particle {
  id: number;
  x: number;
  y: number;
  kind: "great" | "ok" | "low";
}

let particleSeq = 0;

const PARTICLE_ICON = { great: Heart, ok: Sparkles, low: Moon };

export default function PetScene({
  species,
  mood,
  stepTick,
  avatarUrl,
}: {
  species: string;
  mood: "great" | "ok" | "low";
  stepTick: number;
  avatarUrl?: string | null;
}) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [bouncing, setBouncing] = useState(false);
  const [footprints, setFootprints] = useState<{ id: number; x: number }[]>([]);
  const isFirstRun = useRef(true);

  const spawnParticle = (x: number, y: number, kind: Particle["kind"]) => {
    const id = particleSeq++;
    setParticles((prev) => [...prev, { id, x, y, kind }]);
    setTimeout(() => setParticles((prev) => prev.filter((p) => p.id !== id)), 900);
  };

  const bounce = () => {
    setBouncing(true);
    setTimeout(() => setBouncing(false), 400);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    spawnParticle(e.clientX - rect.left, e.clientY - rect.top, mood);
    bounce();
  };

  // Every time new steps arrive from Google Fit/debug controls, make the pet
  // visibly react — this is what ties "walking" to "the pet is alive" for the player.
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    bounce();
    const id = Date.now();
    const x = 15 + Math.random() * 70;
    setFootprints((prev) => [...prev, { id, x }]);
    setTimeout(() => setFootprints((prev) => prev.filter((f) => f.id !== id)), 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepTick]);

  return (
    <div className="scene" onClick={handleClick}>
      <div className="clouds" />
      <div className={`pet-sprite ${bouncing ? "bounce" : ""}`}>
        {avatarUrl ? <img className="pet-avatar-img" src={avatarUrl} alt={species} /> : <PetIllustration species={species} size={170} />}
      </div>
      <div className="ground" />
      {particles.map((p) => {
        const Icon = PARTICLE_ICON[p.kind];
        return (
          <span key={p.id} className="particle" style={{ left: p.x, top: p.y }}>
            <Icon size={22} fill="currentColor" strokeWidth={1.5} />
          </span>
        );
      })}
      {footprints.map((f) => (
        <span key={f.id} className="footprint" style={{ left: `${f.x}%` }}>
          <Footprints size={18} />
        </span>
      ))}
      <span className="tap-hint">тапни питомца</span>
    </div>
  );
}
