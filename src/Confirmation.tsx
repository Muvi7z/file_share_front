import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./components/ui/alert-dialog";

const ConfirmationContext = createContext<(message: string) => Promise<boolean>>(() => Promise.resolve(false));

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const pending = useRef<((confirmed: boolean) => void) | null>(null);
  const confirm = useCallback((text: string) => new Promise<boolean>(resolve => {
    pending.current?.(false);
    pending.current = resolve;
    setMessage(text);
  }), []);
  const finish = (confirmed: boolean) => {
    pending.current?.(confirmed);
    pending.current = null;
    setMessage("");
  };
  useEffect(() => () => pending.current?.(false), []);
  return <ConfirmationContext.Provider value={confirm}>{children}
    <AlertDialog open={Boolean(message)} onOpenChange={open => { if (!open) finish(false); }}>
      <AlertDialogContent className="vault-confirm dark">
        <AlertDialogHeader><AlertDialogTitle>Подтвердите действие</AlertDialogTitle><AlertDialogDescription>{message}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel onClick={() => finish(false)}>Отмена</AlertDialogCancel><AlertDialogAction onClick={() => finish(true)}>Подтвердить</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </ConfirmationContext.Provider>;
}

export const useConfirmation = () => useContext(ConfirmationContext);
