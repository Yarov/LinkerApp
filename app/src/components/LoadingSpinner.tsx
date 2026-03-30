interface LoadingSpinnerProps {
  message?: string;
}

export default function LoadingSpinner({
  message = "Cargando...",
}: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <svg
        className="h-10 w-10 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          className="opacity-20"
          cx="12"
          cy="12"
          r="10"
          stroke="#006fff"
          strokeWidth="3"
        />
        <path
          className="opacity-80"
          d="M12 2a10 10 0 0 1 10 10"
          stroke="#006fff"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <p className="mt-4 text-sm font-medium text-[#475569]">{message}</p>
    </div>
  );
}
