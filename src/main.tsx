import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import App from "./App";
// 内置打包 Inter 字体（替代运行时 Google Fonts @import，离线可用）
import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
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
