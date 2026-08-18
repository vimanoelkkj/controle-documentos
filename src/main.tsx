import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

const temaSalvo = localStorage.getItem("tema-v3");
document.body.classList.toggle("dark", temaSalvo === "dark");
document.documentElement.style.colorScheme = temaSalvo === "dark" ? "dark" : "light";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
