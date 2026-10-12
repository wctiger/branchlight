# Windows x64 build checks and executable artifacts

The **CI** workflow runs **Windows x64 checks** alongside macOS checks on pull
requests and pushes to `main`. It also supports manual runs. This is the build
and artifact groundwork for [issue #28](https://github.com/wctiger/branchlight/issues/28),
not a claim that downloaded-executable compatibility has been verified.

## Automated checks

The job uses `windows-2025`, its installed Microsoft C++ build tools and Git,
Bun 1.3.14, and stable Rust with the `x86_64-pc-windows-msvc` target. It runs version
consistency, frontend tests, Rust formatting/tests/clippy, then builds the
production frontend and application:

```sh
bun run tauri build --ci --target x86_64-pc-windows-msvc --no-bundle -- --locked
```

No signing credentials, MSI/NSIS installer, bundled Git, or WebView2 provisioning
are used. The job uploads only `branchlight.exe` and `SHA256SUMS.txt`, retained
for 14 days. A successful build proves compilation and artifact delivery;
additional DLL/resource requirements and clean-machine launch remain to be
verified. Existing Rust integration tests use disposable local repositories and
local remotes; they do not prove real SSH/credential-helper or GUI behavior.

References: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/),
[plain executable caveats](https://github.com/tauri-apps/tauri-action#tips-and-caveats),
and [Windows runner software](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md).

## Download and launch

1. Once merged, open **Actions → CI → Run workflow** and select `main`.
   PR runs also provide the artifact after Windows checks succeed.
2. Download `Branchlight-Windows-x64-<commit>` from the completed run and extract
   the ZIP to a user-writable directory. Workflow artifacts require GitHub
   sign-in; they are temporary downloads rather than published releases.
3. Verify the checksum in PowerShell from the extracted directory:

   ```powershell
   $expected = ((Get-Content ./SHA256SUMS.txt -Raw).Trim() -split '\s+')[0]
   $actual = (Get-FileHash ./branchlight.exe -Algorithm SHA256).Hash
   if ($actual -ine $expected) { throw 'Executable checksum mismatch' }
   ```

4. Install [Microsoft WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
   and [Git for Windows](https://gitforwindows.org/) if unavailable. Git must be
   accessible through `PATH`; restart the app/session after changing it. Reuse
   your Git identity, SSH configuration, and credential helpers. The application
   does not install these dependencies or require Bun, Rust, or a dev server.
5. Launch `branchlight.exe` from File Explorer. It is unsigned; Windows may
   show an unknown-publisher/SmartScreen warning, and organization policy may
   block launch. No installer or administrator privileges are intended.
6. For updates, close the app and replace the executable with another verified
   artifact. Deleting the executable does not necessarily remove per-user
   WebView2/application data; inventory the actual locations during verification.

## Remaining Windows verification

Record results in issue #28 before declaring standalone Windows support:

- Download and launch on a Windows machine/VM without development tools, from
  File Explorer and a user-writable folder without elevation. Check for missing
  adjacent DLLs/resources and record any required runtime files.
- Record Windows version/architecture, WebView2 version, Git version, identity,
  credential setup, and the tested artifact commit/checksum.
- Open a disposable repository; inspect status; stage/unstage/commit; restart and
  reopen it. Verify paths with spaces/non-ASCII characters and line endings.
- Verify fetch/pull/push against a disposable remote with the intended SSH or
  credential-helper setup.
- Verify missing-Git errors and missing-WebView2 launch behavior/recovery.
- Replace the executable with a newer build and verify launch/repository access;
  record per-user data left after deleting it.

Installer packaging, signing, release attachments, Windows ARM64, and automatic
updates remain follow-ups. This build check does not complete those tasks.
