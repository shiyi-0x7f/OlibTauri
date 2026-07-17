import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import App from "./App";
import "./index.css";

// Disable default browser context menu globally for native app feel
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

// Block DevTools keyboard shortcuts in production mode
if (!import.meta.env.DEV) {
  document.addEventListener("keydown", (e) => {
    // F12
    if (e.key === "F12") {
      e.preventDefault();
      return;
    }
    // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C (DevTools)
    if (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(e.key.toUpperCase())) {
      e.preventDefault();
      return;
    }
    // Ctrl+U (View Source)
    if (e.ctrlKey && e.key.toUpperCase() === "U") {
      e.preventDefault();
      return;
    }
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster position="top-right" />
    </BrowserRouter>
  </React.StrictMode>,
);
