import workerUrl from "@pierre/diffs/worker/worker-portable.js?url";
import {
  WorkerPoolContextProvider,
  type WorkerPoolOptions,
  type WorkerInitializationRenderOptions,
} from "@pierre/diffs/react";
import type { ReactNode } from "react";

const poolOptions: WorkerPoolOptions = {
  poolSize: 2,
  workerFactory: () => new Worker(workerUrl, { type: "module" }),
};
const highlighterOptions: WorkerInitializationRenderOptions = {
  langs: [],
  theme: { light: "pierre-light", dark: "pierre-dark" },
};

/** Shares two bundled highlighting workers across all repository tabs. */
export function DiffWorkerProvider({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
