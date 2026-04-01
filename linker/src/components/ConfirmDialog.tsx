import Modal from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  confirmColor?: "red" | "blue";
  loading?: boolean;
}

export default function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmText = "Confirmar", confirmColor = "blue", loading = false }: ConfirmDialogProps) {
  const colorClasses = confirmColor === "red"
    ? "bg-[#dc2626] hover:bg-[#b91c1c] shadow-[#dc2626]/20"
    : "bg-[#006fff] hover:bg-[#0057cc] shadow-[#006fff]/20";
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-md">
      <div className="space-y-5">
        <p className="text-sm text-[#475569] leading-relaxed">{message}</p>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={loading} className="rounded-xl border border-[#e2e8f0] bg-transparent px-5 py-2.5 text-sm text-[#475569] transition-colors hover:bg-[#f5f7fa] hover:text-[#0f172a] disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={onConfirm} disabled={loading} className={`rounded-xl px-5 py-2.5 text-sm font-medium text-white shadow-lg transition-all duration-200 disabled:opacity-50 ${colorClasses}`}>{loading ? "Procesando..." : confirmText}</button>
        </div>
      </div>
    </Modal>
  );
}
