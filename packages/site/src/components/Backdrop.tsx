import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface BackdropProps {
  open: boolean;
}

// Stays in the DOM so the fade runs both ways; clicks pass through to the
// dialog's native (transparent) backdrop, which handles closing.
export const Backdrop = ({ open }: BackdropProps) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      aria-hidden="true"
      className={[
        "pointer-events-none fixed inset-0 z-50 bg-gray-500/30 backdrop-blur-[2px] transition-opacity duration-200 ease-out",
        open ? "opacity-100" : "opacity-0",
      ].join(" ")}
    />,
    document.body,
  );
};
