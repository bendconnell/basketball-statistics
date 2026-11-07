import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

const Root = import.meta.env.DEV && import.meta.env.MODE === "ui"
  ? React.lazy(() => import("./dev/UiPreview")) : App;

const application = <BrowserRouter>
  <React.Suspense fallback={<p role="status">Loading…</p>}><Root /></React.Suspense>
</BrowserRouter>;

// Match production effect lifetimes for the single-editor Web Lock in preview.
ReactDOM.createRoot(document.getElementById("root")!).render(
  import.meta.env.DEV && import.meta.env.MODE === "ui" ? application : <React.StrictMode>{application}</React.StrictMode>
);
