import { useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";

export default function AvatarGenerator({
  status,
  onGenerate,
}: {
  status: "none" | "pending" | "completed" | "failed";
  onGenerate: (description: string) => void;
}) {
  const [description, setDescription] = useState("");

  if (status === "pending") {
    return (
      <div className="avatar-gen pending">
        <Sparkles size={16} className="spin" />
        <span>ИИ придумывает питомца по твоему описанию…</span>
      </div>
    );
  }

  // No free-form re-description here on purpose — this only resyncs the art to whatever
  // gear the pet's current rarity/evolution stage should have (useful if the avatar predates
  // a gear-system change, or just looks stale), not "make up a brand new random costume".
  if (status === "completed") {
    return (
      <button type="button" className="avatar-sync-btn" onClick={() => onGenerate("")}>
        <RefreshCw size={14} /> Обновить экипировку
      </button>
    );
  }

  return (
    <form
      className="avatar-gen"
      onSubmit={(e) => {
        e.preventDefault();
        if (description.trim()) onGenerate(description.trim());
      }}
    >
      {status === "failed" && <p className="avatar-gen-error">Не получилось сгенерировать, попробуй ещё раз.</p>}
      <p className="avatar-gen-hint">Опиши своего питомца — ИИ нарисует его таким, одноразово:</p>
      <textarea
        value={description}
        maxLength={300}
        placeholder="Например: лиса, но космический исследователь в скафандре"
        onChange={(e) => setDescription(e.target.value)}
      />
      <button type="submit" disabled={!description.trim()}>
        <Sparkles size={16} /> Сгенерировать
      </button>
    </form>
  );
}
