import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { syncNativeChrome } from "./components/chrome";
import { isNative } from "./lib/api";

if (isNative()) document.documentElement.classList.add("native");

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
syncNativeChrome();
