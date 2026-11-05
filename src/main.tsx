import { createRoot } from "react-dom/client";
import App from "./App";
import { native } from "./bridge";
import "./styles.css";
document.body.classList.add(native ? "native-body" : "preview-body");
createRoot(document.getElementById("root")!).render(<App />);
