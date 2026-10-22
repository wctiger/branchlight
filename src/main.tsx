import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/Workspace";
import "@/styles/theme.css";
import { TooltipProvider } from "@/components/ui/tooltip";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider delay={350}>
      <App />
    </TooltipProvider>
  </React.StrictMode>,
);
