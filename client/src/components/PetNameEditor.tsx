import { useState } from "react";
import { Dices, Pencil, Loader2 } from "lucide-react";

export default function PetNameEditor({
  name,
  onGenerateAi,
  onSetCustom,
}: {
  name: string | null;
  onGenerateAi: () => Promise<void>;
  onSetCustom: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customName, setCustomName] = useState("");

  const runAi = async () => {
    setBusy(true);
    try {
      await onGenerateAi();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const submitCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) return;
    setBusy(true);
    try {
      await onSetCustom(customName.trim());
      setOpen(false);
      setCustomName("");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="name-editor-toggle" onClick={() => setOpen(true)}>
        <Pencil size={13} /> {name ? "Переименовать" : "Дать кличку"}
      </button>
    );
  }

  return (
    <form className="name-editor" onSubmit={submitCustom}>
      <button type="button" className="name-editor-ai-btn" onClick={runAi} disabled={busy}>
        {busy ? <Loader2 size={14} className="spin" /> : <Dices size={14} />} Придумать ИИ
      </button>
      <div className="name-editor-custom">
        <input
          value={customName}
          maxLength={24}
          placeholder="Своя кличка"
          onChange={(e) => setCustomName(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !customName.trim()}>
          Сохранить
        </button>
      </div>
      <button type="button" className="name-editor-cancel" onClick={() => setOpen(false)} disabled={busy}>
        Отмена
      </button>
    </form>
  );
}
