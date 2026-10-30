import React from "react";
import ReactDOM from "react-dom/client";
import Workspace from "@/Workspace";
import "@/styles/global.css";
import "@/styles/theme.css";
import { DiffWorkerProvider } from "@/features/inspection/DiffWorkerProvider";
import { TooltipProvider } from "@/components/ui/tooltip";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider delay={350}>
      <DiffWorkerProvider>
        <Workspace />
      </DiffWorkerProvider>
    </TooltipProvider>
  </React.StrictMode>,
);
