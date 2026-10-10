# macOS distribution

Branchlight is distributed through GitHub as a universal DMG containing
`Branchlight.app` for Apple Silicon and Intel. Users drag it to Applications.
The app bundles its frontend; users do not need Bun, Node, Rust, or a local server.
They do need system Git and their existing Git identity, SSH, and credential setup.

## Pipelines

- **CI** (`.github/workflows/ci.yml`) runs on pull requests and pushes to `main`.
  It checks version consistency, frontend tests, Rust formatting/tests/clippy,
  and a production macOS application build. Dependency installation uses the
  committed Bun and Cargo lockfiles. The release workflow reuses these checks.
- **macOS distribution** (`.github/workflows/release.yml`) can be run manually
  from GitHub Actions to produce an ad-hoc signed universal DMG and SHA-256
  checksum as a workflow artifact, retained for 14 days. No Apple secrets are
  needed for a branch run. This proves packaging and artifact delivery; macOS
  may still require an explicit Privacy & Security override to launch it.
- Pushing a **`v<version>` tag** runs those checks, requires Apple credentials,
  signs and notarizes the universal DMG, verifies both architectures, the app's
  signature, stapled ticket, and Gatekeeper acceptance, then creates a **draft
  GitHub Release** with the DMG and checksum. A missing credential fails the
  release; it never silently falls back to ad-hoc signing. A manual run against
  a tag follows this same signed-release path.

The automatic `GITHUB_TOKEN` has release write access only in the packaging job;
no personal GitHub token is needed. Fork pull requests run CI without Apple secrets.
Published releases are not overwritten by reruns. Draft releases can be retried.

## First packaging proof (no Apple account needed)

1. Merge the workflows into the default branch with GitHub Actions enabled.
2. Open **Actions → macOS distribution → Run workflow**, selecting `main`.
3. Download the `Branchlight-macOS-universal-<commit>` artifact from that run.
   Workflow artifacts require GitHub sign-in and are temporary; they are not the
   public Releases download page.
4. Extract the archive and run `shasum -a 256 -c SHA256SUMS.txt` in its directory.
5. Follow the installation smoke test below. Record any Gatekeeper override
   needed for this ad-hoc build; it does not prove notarized installation.

## Apple setup for a public release

Use an Apple Developer Program membership and a **Developer ID Application**
certificate for distribution outside the App Store. Keep the bundle identifier
`com.shawnyang.branchlight` stable.

Export the certificate and its private key from Keychain Access as a
password-protected `.p12`, then encode it locally:

```sh
openssl base64 -A -in /path/to/certificate.p12 -out /tmp/branchlight-certificate-base64.txt
```

Add these **repository Actions secrets** under GitHub Settings → Secrets and
variables → Actions. Do not commit certificate exports or passwords.

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Contents of the base64 file containing the `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | Full `Developer ID Application: … (TEAMID)` identity |
| `APPLE_ID` | Apple account email used for notarization |
| `APPLE_PASSWORD` | Apple **app-specific password**, not the account password |
| `APPLE_TEAM_ID` | Developer Program team ID |

Use `security find-identity -v -p codesigning` to find the signing identity.
Remove temporary certificate export files once secrets are configured. Tauri
imports the certificate on the ephemeral runner and submits the app to Apple's
notarization service. First-time notarization can take longer than the workflow's
60-minute packaging timeout; inspect Apple's submission status before retrying
and increase the timeout if needed. Do not skip notarization verification to ship.

References: [Tauri macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
and [GitHub distribution](https://v2.tauri.app/distribute/pipelines/github/).

## Cut a release

1. Set the same version in `package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json`. Run `cargo check --manifest-path src-tauri/Cargo.toml`
   to update the root package version in `Cargo.lock` when changing versions.
   Commit all version changes. The current version is `0.1.0`.
2. Merge to `main`, let CI pass, and tag that exact commit:

   ```sh
   git switch main
   git pull --ff-only
   git tag -a v0.1.0 -m "Branchlight 0.1.0"
   git push origin v0.1.0
   ```

3. Wait for **macOS distribution**. Open the draft at
   [GitHub Releases](https://github.com/wctiger/branchlight/releases).
4. Download the draft's DMG in a browser and complete the smoke test. Replace
   the release-note reminder with actual changes and verification results.
5. Publish the draft. For test versions, select GitHub's **pre-release** option.
   Downloads are public only if the repository is public; otherwise access
   follows repository permissions.

## Installation smoke test

A passing build alone does not establish a working downloaded desktop app.
Run this from the downloaded DMG, preferably on a Mac/account without the
development toolchain, and on both architectures before claiming both tested.

- Verify the checksum; mount the DMG; drag Branchlight into Applications.
- Eject the DMG and launch Branchlight from Finder, without a terminal/dev server.
- For a signed release, confirm there is no unidentified-developer bypass needed.
- Open a disposable repository; inspect changes; stage and commit a file.
- Restart the app and reopen the repository.
- Check fetch/pull/push against a disposable remote using the intended SSH or
  credential-helper setup. Finder's environment can differ from an interactive
  shell, especially for Homebrew Git, SSH agents, and external credential helpers.
- Confirm the failure message is useful on a machine without usable Git.
- Install a newer build over the existing application and reopen the repository.

Record the commit/tag, macOS version, CPU architecture, install/launch outcome,
Git/credential setup, and remote-operation outcome in the release notes.

Automatic updates, an App Store submission, Homebrew distribution, and other
operating systems are outside this initial distribution proof. Users update by
downloading the next DMG and replacing the application.

## Local packaging

```sh
bun install --frozen-lockfile
rustup target add aarch64-apple-darwin x86_64-apple-darwin
CI=true APPLE_SIGNING_IDENTITY=- bun run tauri build --ci --target universal-apple-darwin --bundles app,dmg -- --locked
```

Find the installer under
`src-tauri/target/universal-apple-darwin/release/bundle/dmg/`.
Local ad-hoc packaging does not exercise GitHub delivery or Apple notarization.
`CI=true` skips Finder automation for the DMG layout, matching the hosted runner.

## Implementation verification (2026-09-29)

- Passed 3 frontend tests, 41 Rust tests, the production frontend build,
  rustfmt, clippy, workflow linting with actionlint, and version/tag validation.
- Built an ad-hoc signed Apple Silicon `.app` and `.dmg` locally. The installed
  macOS 27 SDK triggered a linker error; setting
  `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk` for that command
  allowed the build to complete. No global developer-tool settings were changed.
- GitHub execution, the universal/Intel build, Apple signing/notarization, and
  browser-download/Finder installation testing remain to be verified. The local
  packaging result is not evidence that these remaining checks have passed.
