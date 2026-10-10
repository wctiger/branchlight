// Keep the installer, Rust package, frontend package, and release tag aligned.
const frontend = await Bun.file('package.json').json();
const tauri = await Bun.file('src-tauri/tauri.conf.json').json();
const cargo = Bun.TOML.parse(await Bun.file('src-tauri/Cargo.toml').text()) as {
  package: { version: string };
};
const version = tauri.version;
if (frontend.version !== version || cargo.package.version !== version) {
  throw new Error('Versions in package.json, Cargo.toml, and tauri.conf.json must match.');
}
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${version}`) {
  throw new Error(`Release tag must be v${version}; received ${process.env.RELEASE_TAG}.`);
}
console.log(`Branchlight ${version}: version metadata matches.`);
