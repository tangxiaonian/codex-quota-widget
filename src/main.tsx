import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DashboardApp } from "./components/DashboardApp";
import "./styles.css";
import "./styles/sources.css";
import "./styles/theme.css";
import "./styles/rail.css";
import "./styles/dashboard.css";
import { native } from "./bridge";

const isDashboard =
  new URLSearchParams(location.search).get("view") === "dashboard";
document.body.className = isDashboard
  ? "dashboard-body"
  : native
    ? "native-body"
    : "browser-demo";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isDashboard ? <DashboardApp /> : <App />}
  </React.StrictMode>,
);
