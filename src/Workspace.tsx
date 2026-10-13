import { useCallback, useEffect, useRef, useState } from "react";
import { RepositoryApp } from "./App";
import { chooseRepositoryFolder, createRepository, getGitVersion, normalizeGitError, openRepository } from "./lib/tauri";
import type { Repository } from "./types/repository";

type Tab = { repository: Repository; group: string; busy: boolean; error: boolean };
export default function Workspace() {
  const [gitReady, setGitReady] = useState(false);
  const [gitMessage, setGitMessage] = useState("Checking system Git…");
  const checkGit = useCallback(async () => {
    setGitReady(false);
    try { const output = await getGitVersion(); setGitReady(true); setGitMessage(output.stdout.trim()); }
    catch (error) { setGitMessage(`System Git is unavailable: ${normalizeGitError(error).message}. Install Git or check PATH, then try again.`); }
  }, []);
  useEffect(() => { void checkGit(); }, [checkGit]);
  const [destination, setDestination] = useState("");
  const [source, setSource] = useState("");
  const [creation, setCreation] = useState<{ destination: string; message: string; busy: boolean } | null>(null);
  const creatingRef = useRef(false);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [editingGroup, setEditingGroup] = useState<{ original: string; name: string } | null>(null);
  const [groupName, setGroupName] = useState("");
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const busyPaths = useRef(new Set<string>());
  const feedback = useCallback((path: string, busy: boolean, error: boolean) => {
    if (busy) busyPaths.current.add(path); else busyPaths.current.delete(path);
    setTabs((tabs) => {
      const current = tabs.find((tab) => tab.repository.path === path);
      if (!current || (current.busy === busy && current.error === error)) return tabs;
      return tabs.map((tab) => tab === current ? { ...tab, busy, error } : tab);
    });
  }, []);
  const open = useCallback(async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setError("");
    try {
      const path = await chooseRepositoryFolder();
      if (!path) return;
      const repository = await openRepository(path);
      setTabs((tabs) => tabs.some((tab) => tab.repository.path === repository.path) ? tabs :
        [...tabs, { repository, group: "", busy: false, error: false }]);
      setActive(repository.path);
    } catch (error) { setError(normalizeGitError(error).message); }
    finally { openingRef.current = false; setOpening(false); }
  }, []);
  async function create(clone: boolean) {
    if (creatingRef.current) return;
    creatingRef.current = true;
    const chosenDestination = destination;
    setCreation({ destination: chosenDestination, message: clone ? "Cloning with system Git…" : "Initializing with system Git…", busy: true });
    try {
      const repository = await createRepository(chosenDestination, clone ? source : null);
      setTabs((tabs) => tabs.some((tab) => tab.repository.path === repository.path) ? tabs :
        [...tabs, { repository, group: "", busy: false, error: false }]);
      setActive(repository.path);
      setCreation({ destination: chosenDestination, message: "Repository ready.", busy: false });
    } catch (error) { const failure = normalizeGitError(error); setCreation({ destination: chosenDestination, message: `${failure.message} ${failure.output?.stderr.trim() ?? ""}`, busy: false }); }
    finally { creatingRef.current = false; }
  }
  function close(tab: Tab) {
    if (busyPaths.current.has(tab.repository.path)) { setError("Wait for this repository's operation and refresh to finish before closing its tab."); return; }
    setTabs((tabs) => tabs.filter((item) => item !== tab));
    if (active === tab.repository.path) setActive(tabs.find((item) => item !== tab)?.repository.path ?? "");
  }
  function renameGroup(group: string, value: string) {
    const name = value.trim();
    if (!name || name === group) return;
    if (groups.includes(name)) { setError("A group with that name already exists."); return; }
    setEditingGroup(null);
    setGroups(groups.map((item) => item === group ? name : item));
    setTabs((tabs) => tabs.map((tab) => tab.group === group ? { ...tab, group: name } : tab));
  }
  return <>
    <nav className="workspace-tabs" aria-label="Repositories">
      <button onClick={() => void open()} disabled={opening || !gitReady}>{opening ? "Opening…" : "Open repository"}</button>
      <form onSubmit={(event) => { event.preventDefault(); const name = groupName.trim(); if (name && !groups.includes(name)) setGroups([...groups, name]); setGroupName(""); }}>
        <input aria-label="New group name" placeholder="New group" value={groupName} onChange={(event) => setGroupName(event.target.value)} />
        <button disabled={!groupName.trim()}>Create group</button>
      </form>
      {["", ...groups].map((group) => <section key={group} className="tab-group" aria-label={group || "Ungrouped"}>
        {group && <><strong>{group}</strong><button onClick={() => setEditingGroup({ original: group, name: group })}>Rename</button><button onClick={() => { setGroups(groups.filter((item) => item !== group)); setTabs((tabs) => tabs.map((tab) => tab.group === group ? { ...tab, group: "" } : tab)); }}>Remove group</button></>}
        {tabs.filter((tab) => tab.group === group).map((tab) => <div className="repository-tab" key={tab.repository.path}>
          <button aria-pressed={active === tab.repository.path} title={tab.repository.path} onClick={() => setActive(tab.repository.path)}>{tab.repository.name}{tab.busy ? " · Working…" : tab.error ? " · Error" : ""}</button>
          <select aria-label={`Group for ${tab.repository.name}`} value={tab.group} onChange={(event) => setTabs((tabs) => tabs.map((item) => item.repository.path === tab.repository.path ? { ...item, group: event.target.value } : item))}>
            <option value="">Ungrouped</option>{groups.map((group) => <option key={group}>{group}</option>)}
          </select>
          <button aria-label={`Close ${tab.repository.name}`} disabled={tab.busy} onClick={() => close(tab)}>×</button>
        </div>)}
      </section>)}
    </nav>
    <p className="system-git-status" role="status">{gitMessage} {!gitReady && <button onClick={() => void checkGit()}>Check again</button>}</p>
    {editingGroup && <form className="repository-create" onSubmit={(event) => { event.preventDefault(); renameGroup(editingGroup.original, editingGroup.name); }}>
      <label>Rename {editingGroup.original} <input autoFocus value={editingGroup.name} onChange={(event) => setEditingGroup({ ...editingGroup, name: event.target.value })} /></label>
      <button>Save group name</button><button type="button" onClick={() => setEditingGroup(null)}>Cancel</button>
    </form>}
    <details className="repository-create"><summary>Initialize or clone a repository</summary>
      <p>Choose a new directory inside an existing parent. Existing destinations are never overwritten. Partial results are retained on failure.</p>
      <label>New destination directory <input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Absolute path to a new directory" /></label>
      <button disabled={!!creation?.busy} onClick={() => { void chooseRepositoryFolder().then((parent) => { if (parent) setDestination(`${parent}/new-repository`); }).catch((error) => setError(normalizeGitError(error).message)); }}>Choose parent folder</button>
      <label>Clone source URL or local path <input value={source} onChange={(event) => setSource(event.target.value)} /></label>
      <button disabled={!!creation?.busy || !destination || !gitReady} onClick={() => void create(false)}>Initialize</button>
      <button disabled={!!creation?.busy || !destination || !source || !gitReady} onClick={() => void create(true)}>Clone</button>
      {creation && <p role="status" aria-busy={creation.busy}><code>{creation.destination}</code>: {creation.message}</p>}
    </details>
    {error && <p role="alert" className="workspace-error">{error}</p>}
    {!tabs.length && <main className="landing-screen"><section className="landing-card"><h1>Branchlight</h1><p>Open repositories in independent tabs. Each uses your installed Git and local configuration.</p><button onClick={() => void open()} disabled={opening || !gitReady}>Open repository</button></section></main>}
    {tabs.map((tab) => <div key={tab.repository.path} hidden={active !== tab.repository.path}>
      <RepositoryApp initialRepository={tab.repository} onOpen={() => void open()} onFeedback={feedback} />
    </div>)}
  </>;
}
