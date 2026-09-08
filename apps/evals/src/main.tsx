import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/eb-garamond/latin-400.css";
import "@fontsource/eb-garamond/latin-600.css";
import "./styles/design-system.css";
import "./styles/evals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
