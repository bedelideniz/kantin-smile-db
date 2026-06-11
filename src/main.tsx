import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initOneSignal } from "@/lib/oneSignal";

// Initialize native push (no-op on web)
initOneSignal();

createRoot(document.getElementById("root")!).render(<App />);
