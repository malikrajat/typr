# Developer Commands

All day-to-day commands live in one place. The easiest way to run them is the
interactive menu:

```bash
npm run menu
```

You can also run a single task directly:

```bash
npm run menu -- dev
npm run menu -- check:rust
npm run menu -- --help
```

The menu is defined in [`scripts/commands.mjs`](scripts/commands.mjs), so if you
add a new project command, add it there once and it is available from both the
menu and the command line.

## Tasks

| Menu option | Direct command | What it does |
| --- | --- | --- |
| Start desktop app | `npm run app:dev` | Runs the Tauri desktop app with frontend hot reload |
| Start web UI only | `npm run dev` | Runs the Vite dev server at `http://localhost:1420` |
| Build desktop app (release) | `npm run app:build` | Creates an optimized app and platform installers |
| Build desktop app (debug) | `npm run app:build:debug` | Creates a faster, unoptimized desktop build |
| Build web frontend only | `npm run build` | Type-checks and bundles the frontend into `dist/` |
| Type-check frontend | `npm run check` | Runs `tsc` without emitting files |
| Check Rust backend | `npm run rust:check` | Runs `cargo check` |
| Run Rust tests | `npm run rust:test` | Runs `cargo test` |
| Format Rust code | `npm run rust:fmt` | Runs `cargo fmt` |
| Clean frontend output | `npm run clean` | Removes `dist/` |
| Clean Rust build cache | `npm run clean:rust` | Runs `cargo clean` (next build will be slow) |
| Build whisper sidecar | `npm run setup:sidecar` | Builds whisper.cpp into `src-tauri/binaries/` |
| Run project doctor | `npm run doctor` | Checks Node, npm, Rust, Tauri CLI, deps, and sidecar |
| Exit | `0` or `q` | Leaves the menu |

## VS Code

Open the Command Palette and run **Tasks: Run Task**, then pick a `Typr:` task.
`Ctrl+Shift+B` runs the default build task, **Typr: Build desktop (release)**.

Useful tasks:

- **Typr: Dev (desktop)** — normal development loop
- **Typr: Check everything** — TypeScript + Rust checks in sequence
- **Typr: Doctor** — environment troubleshooting
- **Typr: Developer menu** — opens the same menu inside VS Code

## First-time setup

1. Install frontend dependencies:

   ```bash
   npm install
   ```

2. Install the Rust toolchain (stable) from <https://rustup.rs>.

3. Install the Tauri system prerequisites for your OS:
   - **Windows:** Microsoft C++ Build Tools and WebView2 (WebView2 ships with
     current Windows versions).
   - **macOS:** Xcode Command Line Tools.
   - **Linux:** the WebKitGTK development packages listed in the
     [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

4. Build the whisper sidecar (requires CMake and a C++ toolchain; the Windows
   Build Tools installation includes both):

   ```bash
   npm run setup:sidecar
   ```

5. Run the doctor and fix anything marked `MISSING`:

   ```bash
   npm run doctor
   ```

## Local transcription sidecar

Local transcription expects a whisper.cpp binary at:

```text
src-tauri/binaries/whisper-cpp-<target-triple>[.exe]
```

Tauri's build script resolves this path for `app:dev`, `app:build`,
`app:build:debug`, and even `npm run rust:check`, so those commands fail until
the file exists.

Build it with:

```bash
npm run setup:sidecar
```

The script clones the pinned whisper.cpp source into `whisper.cpp/` (ignored by
Git), builds a self-contained `whisper-cli` binary, and copies it to the correct
target-triple path. On Windows it automatically uses the CMake bundled with
Visual Studio when `cmake` is not on `PATH`. You can also copy a prebuilt
`whisper-cli` binary to that path yourself.

The doctor reports the sidecar as `WARN` rather than `MISSING` because the
frontend-only commands (`npm run dev`, `npm run build`, `npm run check`) still
work without it.

## Adding a command

Edit `scripts/commands.mjs` and add an entry to the `tasks` array:

```js
{
  id: "my-task",
  group: "Check & test",
  title: "My new task",
  hint: "What it does",
  command: "npm run my-script",
}
```

Then run `npm run menu` and it appears automatically. Direct invocation is
`npm run menu -- my-task`.
