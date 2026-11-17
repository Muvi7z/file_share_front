import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ConfirmationProvider } from "./Confirmation";
import "./styles.css";
import "./night-library.css";
import "./liquid-glass.css";
import "./classic.css";
import "./admin-library.css";
import "./player.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfirmationProvider><App /></ConfirmationProvider>
  </StrictMode>
);
