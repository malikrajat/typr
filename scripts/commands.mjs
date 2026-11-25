#!/usr/bin/env node
/**
 * Typr developer command center.
 *
 * Interactive menu:  npm run menu
 * Direct task:       npm run menu -- dev
 * Help / task list:  npm run menu -- --help
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

const colorEnabled = !process.env.NO_COLOR && stdout.isTTY;
const paint = (code) => (text) =>
  colorEnabled ? `\x1b[${code}m${text}\x1b[0m` : String(text);
const bold = paint("1");
const dim = paint("2");
const cyan = paint("36");
const green = paint("32");
const yellow = paint("33");
const red = paint("31");

const tasks = [
  {
    id: "dev",
    group: "Develop",
    title: "Start desktop app",
    hint: "Tauri app with hot reload",
    command: "npm run app:dev",
    needsSidecar: true,
  },
  {
    id: "web",
    group: "Develop",
    title: "Start web UI only",
    hint: "Vite on http://localhost:1420",
    command: "npm run dev",
  },
  {
    id: "build",
    group: "Build",
    title: "Build desktop app (release)",
    hint: "Optimized app + installers",
    command: "npm run app:build",
    needsSidecar: true,
  },
  {
    id: "build:debug",
    group: "Build",
    title: "Build desktop app (debug)",
    hint: "Faster, unoptimized build",
    command: "npm run app:build:debug",
    needsSidecar: true,
  },
  {
    id: "build:web",
    group: "Build",
    title: "Build web frontend only",
    hint: "Type-check + Vite bundle",
    command: "npm run build",
  },
  {
    id: "check",
    group: "Check & test",
    title: "Type-check frontend",
    hint: "TypeScript, no emit",
    command: "npm run check",
  },
  {
    id: "check:rust",
    group: "Check & test",
    title: "Check Rust backend",
    hint: "cargo check",
    command: "npm run rust:check",
    needsSidecar: true,
  },
  {
    id: "test",
    group: "Check & test",
    title: "Run Rust tests",
    hint: "cargo test",
    command: "npm run rust:test",
    needsSidecar: true,
  },
  {
    id: "fmt",
    group: "Check & test",
    title: "Format Rust code",
    hint: "cargo fmt",
    command: "npm run rust:fmt",
  },
  {
    id: "clean",
    group: "Maintenance",
    title: "Clean frontend output",
    hint: "Removes dist/",
    confirm: "Remove dist/?",
    action: cleanFrontend,
  },
  {
    id: "clean:rust",
    group: "Maintenance",
    title: "Clean Rust build cache",
    hint: "cargo clean, slow rebuild",
    confirm: "Remove src-tauri/target/? This makes the next build much slower.",
    action: cleanRust,
  },
  {
    id: "setup:sidecar",
    group: "Maintenance",
    title: "Build whisper sidecar",
    hint: "One-time, uses CMake",
    command: "npm run setup:sidecar",
  },
  {
    id: "doctor",
    group: "Maintenance",
    title: "Run project doctor",
    hint: "Check toolchain and sidecar",
    action: doctor,
  },
];

function printUsage() {
  const lines = [
    "",
    bold("  Typr developer commands"),
    "",
    "  Interactive menu:  " + cyan("npm run menu"),
    "  Run one task:      " + cyan("npm run menu -- <task>"),
    "",
    "  Tasks:",
  ];
  for (const task of tasks) {
    lines.push(
      `    ${task.id.padEnd(14)} ${task.title}${task.hint ? dim(`  (${task.hint})`) : ""}`,
    );
  }
  lines.push("");
  console.log(lines.join("\n"));
}

function printMenu() {
  console.log("");
  console.log(bold("  ============================================================"));
  console.log(bold("    TYPR  |  developer command center"));
  console.log(bold("  ============================================================"));

  let lastGroup = "";
  let index = 0;
  const sidecarMissing = findSidecars().length === 0;
  for (const task of tasks) {
    if (task.group !== lastGroup) {
      lastGroup = task.group;
      console.log("");
      console.log("  " + cyan(task.group.toUpperCase()));
    }
    index += 1;
    const warning =
      task.needsSidecar && sidecarMissing ? yellow("  [sidecar missing]") : "";
    console.log(
      `  ${String(index).padStart(2)}. ${task.title.padEnd(30)} ${dim(task.hint)}${warning}`,
    );
  }

  console.log("");
  console.log("   0. Exit");
  console.log("");
  console.log(dim("  Tip: you can also type a task id, e.g. \"dev\" or \"check:rust\"."));
}

function runCommand(command) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: root,
      stdio: "inherit",
      shell: true,
      env: process.env,
    });

    // While a child task runs, keep this process alive on Ctrl+C so the
    // menu can return after the child has stopped.
    const onSigint = () => {};
    process.on("SIGINT", onSigint);

    let settled = false;
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      process.removeListener("SIGINT", onSigint);
      resolve({ code: code ?? (signal ? 1 : 0), signal });
    };

    child.on("error", (error) => {
      console.error(red(`Failed to start command: ${error.message}`));
      finish(1, null);
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}

function findSidecars() {
  const binariesDir = path.join(root, "src-tauri", "binaries");
  return existsSync(binariesDir)
    ? readdirSync(binariesDir).filter((file) => file.startsWith("whisper-cpp"))
    : [];
}

function expectedSidecarName() {
  const result = spawnSync("rustc -vV", {
    cwd: root,
    shell: true,
    encoding: "utf8",
    timeout: 20_000,
  });
  const host = /^host:\s*(\S+)/m.exec(result.stdout || "")?.[1];
  const suffix = isWindows ? ".exe" : "";
  return host
    ? `whisper-cpp-${host}${suffix}`
    : `whisper-cpp-<target-triple>${suffix}`;
}

async function runTask(task) {
  console.log("");
  console.log(dim(`  $ ${task.command ?? task.id}`));

  if (task.needsSidecar && findSidecars().length === 0) {
    console.log(
      yellow(
        "  Warning: no whisper sidecar found in src-tauri/binaries/.",
      ),
    );
    console.log(
      dim(`  Expected: src-tauri/binaries/${expectedSidecarName()}`),
    );
    console.log(
      dim(
        "  Tauri will fail to compile. See COMMANDS.md > Local transcription sidecar.",
      ),
    );
  }

  const result = task.action
    ? { code: await task.action(), signal: null }
    : await runCommand(task.command);

  if (result.code === 0) {
    console.log(green("\n  OK: finished successfully."));
  } else if (result.signal) {
    console.log(yellow(`\n  Stopped (${result.signal}).`));
  } else {
    console.log(red(`\n  FAILED: exit code ${result.code}.`));
  }
  return result;
}

function removeDir(target, label) {
  if (!existsSync(target)) {
    console.log(dim(`${label} is already clean.`));
    return 0;
  }
  rmSync(target, { recursive: true, force: true });
  console.log(green(`Removed ${label}.`));
  return 0;
}

async function cleanFrontend() {
  return removeDir(path.join(root, "dist"), "dist/");
}

async function cleanRust() {
  const result = await runCommand("cargo clean --manifest-path src-tauri/Cargo.toml");
  return result.code;
}

function probe(command) {
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] || null;
}

function readInstalledVersion(packageName) {
  try {
    const packageJson = path.join(
      root,
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    );
    return JSON.parse(readFileSync(packageJson, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

async function doctor() {
  const checks = [];

  const node = probe("node --version");
  checks.push({ label: "Node.js", value: node, ok: Boolean(node), required: true });

  const npm = probe("npm --version");
  checks.push({ label: "npm", value: npm, ok: Boolean(npm), required: true });

  const rustc = probe("rustc --version");
  checks.push({ label: "Rust", value: rustc, ok: Boolean(rustc), required: true });

  const cargo = probe("cargo --version");
  checks.push({ label: "Cargo", value: cargo, ok: Boolean(cargo), required: true });

  const tauriVersion = readInstalledVersion("@tauri-apps/cli");
  checks.push({
    label: "Tauri CLI",
    value: tauriVersion ? `${tauriVersion} (local)` : "not installed",
    ok: Boolean(tauriVersion),
    required: true,
  });

  const deps = existsSync(path.join(root, "node_modules"));
  checks.push({
    label: "Frontend deps",
    value: deps ? "installed" : "missing, run npm install",
    ok: deps,
    required: true,
  });

  const sidecars = findSidecars();
  checks.push({
    label: "whisper sidecar",
    value:
      sidecars.length > 0
        ? sidecars.join(", ")
        : "missing, blocks Tauri dev/build",
    ok: sidecars.length > 0,
    required: false,
  });

  console.log("");
  console.log(bold("  Project doctor"));
  console.log("  " + "-".repeat(76));
  for (const check of checks) {
    const status = check.ok ? green("OK") : check.required ? red("MISSING") : yellow("WARN");
    console.log(
      `  ${check.label.padEnd(16)} ${String(check.value ?? "not found").padEnd(48)} ${status}`,
    );
  }
  if (sidecars.length === 0) {
    console.log("");
    console.log(
      dim(`  Expected sidecar: src-tauri/binaries/${expectedSidecarName()}`),
    );
  }
  console.log("");

  if (checks.some((check) => check.required && !check.ok)) {
    console.log(red("  One or more required tools are missing."));
    return 1;
  }
  console.log(green("  Everything required is installed."));
  return 0;
}

async function ask(rl, prompt) {
  if (rl.closed) return null;
  try {
    return await rl.question(prompt);
  } catch (error) {
    if (
      error?.code === "ERR_USE_AFTER_CLOSE" ||
      error?.code === "ERR_STREAM_DESTROYED"
    ) {
      return null;
    }
    throw error;
  }
}

async function runInteractive() {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      printMenu();
      const rawAnswer = await ask(rl, "  Select an option: ");
      if (rawAnswer === null) break;
      const answer = rawAnswer.trim();

      if (!answer || answer === "0" || answer.toLowerCase() === "q" || answer.toLowerCase() === "exit") {
        break;
      }

      const numeric = Number(answer);
      const task =
        (Number.isInteger(numeric) && numeric > 0 ? tasks[numeric - 1] : undefined) ??
        tasks.find((candidate) => candidate.id === answer.toLowerCase());

      if (!task) {
        console.log(red(`  Unknown option: ${answer}`));
        continue;
      }

      if (task.confirm) {
        const rawConfirmation = await ask(
          rl,
          "  " + yellow(task.confirm) + " [y/N] ",
        );
        if (rawConfirmation === null) break;
        const confirmation = rawConfirmation.trim().toLowerCase();
        if (confirmation !== "y" && confirmation !== "yes") {
          console.log(dim("  Skipped."));
          continue;
        }
      }

      await runTask(task);
      const pause = await ask(
        rl,
        dim("\n  Press Enter to return to the menu..."),
      );
      if (pause === null) break;
    }
  } finally {
    rl.close();
  }
  console.log("\n  Bye.\n");
}

const [taskId] = process.argv.slice(2);

if (taskId === "--help" || taskId === "-h" || taskId === "help" || taskId === "--list") {
  printUsage();
} else if (taskId) {
  const task = tasks.find((candidate) => candidate.id === taskId.toLowerCase());
  if (!task) {
    console.error(red(`\n  Unknown task: ${taskId}`));
    printUsage();
    process.exitCode = 1;
  } else {
    const result = await runTask(task);
    process.exitCode = result.code;
  }
} else {
  await runInteractive();
}
