import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

export default function AvatarGenerator({
  status,
  onGenerate,
}: {
  status: "none" | "pending" | "completed" | "failed";
  onGenerate: (description: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  // Once a regeneration completes, collapse back to the button instead of leaving the form open.
  useEffect(() => {
    if (status === "completed") setFormOpen(false);
  }, [status]);

  if (status === "pending") {
    return (
      <div className="avatar-gen pending">
        <Sparkles size={16} className="spin" />
        <span>ИИ придумывает питомца по твоему описанию…</span>
      </div>
    );
  }

  if (status === "completed" && !formOpen) {
    return (
      <button type="button" className="avatar-regen-btn" onClick={() => setFormOpen(true)}>
        <Sparkles size={16} /> Сгенерировать заново
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
