import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const element = document.getElementById("root");
if (!element) {
  throw new Error("Root element not found");
}

// StrictMode double-mounts in dev and tears down the Socket.IO connection; that races with
// live `traffic:new` events. This dashboard is a dev/ops tool — single mount keeps WS stable.
createRoot(element).render(<App />);
