import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initTheme } from "./pages/SettingsPage";
import { registerAppShellSW } from "./lib/registerSW";

initTheme();
registerAppShellSW();
createRoot(document.getElementById("root")!).render(<App />);
