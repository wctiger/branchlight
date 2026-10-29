import navigationStyles from "@/workspace/RepositorySidebar.module.css";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  chooseRepositoryFolder,
  createRepository,
  normalizeGitError,
} from "@/lib/tauri";
import type { Repository } from "@/types/repository";

export function RepositoryCreation({
  gitReady,
  onCreated,
  onError,
}: {
  gitReady: boolean;
  onCreated: (repository: Repository) => void;
  onError: (message: string) => void;
}) {
  const [destination, setDestination] = useState("");
  const [source, setSource] = useState("");
  const [creation, setCreation] = useState<{
    destination: string;
    message: string;
    busy: boolean;
  } | null>(null);
  const creatingRef = useRef(false);
  async function create(clone: boolean) {
    if (creatingRef.current) return;
    creatingRef.current = true;
    const chosenDestination = destination;
    setCreation({
      destination: chosenDestination,
      message: clone
        ? "Cloning with system Git…"
        : "Initializing with system Git…",
      busy: true,
    });
    try {
      const repository = await createRepository(
        chosenDestination,
        clone ? source : null,
      );
      onCreated(repository);
      setCreation({
        destination: chosenDestination,
        message: "Repository ready.",
        busy: false,
      });
    } catch (error) {
      const failure = normalizeGitError(error);
      setCreation({
        destination: chosenDestination,
        message: `${failure.message} ${failure.output?.stderr.trim() ?? ""}`,
        busy: false,
      });
    } finally {
      creatingRef.current = false;
    }
  }
  return (
    <details className={navigationStyles["repository-create"]}>
      <summary>Initialize or clone a repository</summary>
      <p>
        Choose a new directory inside an existing parent. Existing destinations
        are never overwritten. Partial results are retained on failure.
      </p>
      <label>
        New destination directory{" "}
        <Input
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="Absolute path to a new directory"
        />
      </label>
      <Button
        variant="outline"
        disabled={!!creation?.busy}
        onClick={() => {
          void chooseRepositoryFolder()
            .then((parent) => {
              if (parent) setDestination(`${parent}/new-repository`);
            })
            .catch((error) => onError(normalizeGitError(error).message));
        }}
      >
        Choose parent folder
      </Button>
      <label>
        Clone source URL or local path{" "}
        <Input
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
      </label>
      <Button
        variant="outline"
        disabled={!!creation?.busy || !destination || !gitReady}
        onClick={() => void create(false)}
      >
        Initialize
      </Button>
      <Button
        variant="outline"
        disabled={!!creation?.busy || !destination || !source || !gitReady}
        onClick={() => void create(true)}
      >
        Clone
      </Button>
      {creation && (
        <p role="status" aria-busy={creation.busy}>
          <code>{creation.destination}</code>: {creation.message}
        </p>
      )}
    </details>
  );
}
