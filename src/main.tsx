import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DashboardApp } from "./components/DashboardApp";
import { RailPopoverApp } from "./components/RailPopoverApp";
import "./styles.css";
import "./styles/sources.css";
import "./styles/theme.css";
import "./styles/rail.css";
import "./styles/dashboard.css";
import { native } from "./bridge";

const view = new URLSearchParams(location.search).get("view");
const isDashboard = view === "dashboard";
const isRailPopover = view === "rail-popover";
document.body.className = isDashboard
  ? "dashboard-body"
  : native
    ? "native-body"
    : "browser-demo";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isDashboard ? (
      <DashboardApp />
    ) : isRailPopover ? (
      <RailPopoverApp />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
