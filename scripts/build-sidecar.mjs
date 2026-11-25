#!/usr/bin/env node
/**
 * Build a self-contained whisper.cpp CLI binary and install it where Tauri
 * expects its sidecar:
 *
 *   src-tauri/binaries/whisper-cpp-<target-triple>[.exe]
 *
 * Usage: npm run setup:sidecar
 *
 * Requires Git, CMake, and a C++ toolchain (Visual Studio Build Tools on
 * Windows, Xcode Command Line Tools on macOS, build-essential on Linux).
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const whisperTag = "v1.9.6";
const whisperDir = path.join(root, "whisper.cpp");
const buildDir = path.join(whisperDir, "build-sidecar");

function log(message) {
  console.log(`[sidecar] ${message}`);
}

function fail(message) {
  console.error(`[sidecar] ERROR: ${message}`);
  process.exit(1);
}

function run(command, args) {
  log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    fail(`Could not run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} exited with code ${result.status}`);
  }
}

function probe(command, args = ["--version"]) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] || null;
}

function programFilesPaths() {
  return [
    process.env["ProgramFiles(x86)"],
    process.env.ProgramFiles,
    "C:\\Program Files (x86)",
    "C:\\Program Files",
  ].filter((value, index, values) => value && values.indexOf(value) === index);
}

function findVsWhere() {
  if (!isWindows) return null;
  for (const base of programFilesPaths()) {
    const candidate = path.join(
      base,
      "Microsoft Visual Studio",
      "Installer",
      "vswhere.exe",
    );
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function visualStudioInfo() {
  if (!isWindows) return { path: null, version: null };
  const vswhere = findVsWhere();
  if (!vswhere) return { path: null, version: null };

  const query = (property) => {
    const result = spawnSync(
      vswhere,
      [
        "-latest",
        "-products",
        "*",
        "-requires",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-property",
        property,
      ],
      { encoding: "utf8" },
    );
    return result.status === 0 ? (result.stdout || "").trim() : "";
  };

  return { path: query("installationPath") || null, version: query("installationVersion") || null };
}

function findCmake(vsInfo) {
  if (probe("cmake")) return "cmake";
  if (!isWindows) return null;

  const candidates = [];
  if (vsInfo.path) {
    candidates.push(
      path.join(
        vsInfo.path,
        "Common7",
        "IDE",
        "CommonExtensions",
        "Microsoft",
        "CMake",
        "CMake",
        "bin",
        "cmake.exe",
      ),
    );
  }

  for (const base of programFilesPaths()) {
    const vsRoot = path.join(base, "Microsoft Visual Studio");
    if (!existsSync(vsRoot)) continue;
    for (const version of readdirSync(vsRoot)) {
      for (const edition of [
        "BuildTools",
        "Community",
        "Professional",
        "Enterprise",
      ]) {
        candidates.push(
          path.join(
            vsRoot,
            version,
            edition,
            "Common7",
            "IDE",
            "CommonExtensions",
            "Microsoft",
            "CMake",
            "CMake",
            "bin",
            "cmake.exe",
          ),
        );
      }
    }
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function targetTriple() {
  const result = spawnSync("rustc", ["-vV"], { cwd: root, encoding: "utf8" });
  if (result.error) {
    fail("Could not run rustc. Install the Rust toolchain and try again.");
  }
  const match = /^host:\s*(\S+)/m.exec(result.stdout || "");
  if (!match) {
    fail("Could not determine the Rust target triple from `rustc -vV`.");
  }
  return match[1];
}

function findFile(directory, fileName) {
  if (!existsSync(directory)) return null;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(fullPath, fileName);
      if (found) return found;
    } else if (entry.name === fileName) {
      return fullPath;
    }
  }
  return null;
}

function locateBuiltBinary() {
  const names = isWindows ? ["whisper-cli.exe"] : ["whisper-cli"];
  const directCandidates = [];
  for (const name of names) {
    directCandidates.push(
      path.join(buildDir, "bin", "Release", name),
      path.join(buildDir, "bin", name),
      path.join(buildDir, "bin", "Release", "main.exe"),
      path.join(buildDir, "bin", "main.exe"),
    );
  }

  const direct = directCandidates.find((candidate) => existsSync(candidate));
  if (direct) return direct;

  for (const name of names) {
    const found = findFile(buildDir, name);
    if (found) return found;
  }
  return null;
}

const triple = targetTriple();
const extension = isWindows ? ".exe" : "";
const destination = path.join(
  root,
  "src-tauri",
  "binaries",
  `whisper-cpp-${triple}${extension}`,
);

log(`Target: ${triple}`);
log(`Destination: ${path.relative(root, destination)}`);

if (!existsSync(path.join(whisperDir, "CMakeLists.txt"))) {
  if (existsSync(whisperDir)) {
    fail(
      `${path.relative(root, whisperDir)} exists but does not contain whisper.cpp. Move it away or delete it, then rerun.`,
    );
  }
  log(`Cloning whisper.cpp ${whisperTag}...`);
  run("git", [
    "clone",
    "--depth",
    "1",
    "--branch",
    whisperTag,
    "https://github.com/ggml-org/whisper.cpp.git",
    whisperDir,
  ]);
} else {
  log(`Using existing whisper.cpp checkout at ${path.relative(root, whisperDir)}`);
}

const vsInfo = visualStudioInfo();
const cmake = findCmake(vsInfo);
if (!cmake) {
  fail(
    "CMake was not found. Install CMake (or Visual Studio Build Tools with the C++ workload) and rerun.",
  );
}

const configureArgs = [
  "-S",
  whisperDir,
  "-B",
  buildDir,
  "-DBUILD_SHARED_LIBS=OFF",
  "-DGGML_STATIC=ON",
  "-DGGML_OPENMP=OFF",
  "-DGGML_BACKEND_DL=OFF",
  "-DGGML_CCACHE=OFF",
  "-DWHISPER_BUILD_EXAMPLES=ON",
  "-DWHISPER_BUILD_TESTS=OFF",
  "-DWHISPER_BUILD_SERVER=OFF",
  "-DWHISPER_SDL2=OFF",
  "-DWHISPER_CURL=OFF",
  "-DGGML_NATIVE=ON",
];

if (isWindows) {
  const vsMajor = Number.parseInt((vsInfo.version || "").split(".")[0], 10);
  const generators = {
    16: "Visual Studio 16 2019",
    17: "Visual Studio 17 2022",
    18: "Visual Studio 18 2026",
  };
  const generator = generators[vsMajor];
  if (generator) {
    configureArgs.push(
      "-G",
      generator,
      "-A",
      triple.startsWith("aarch64") ? "arm64" : "x64",
    );
  }
} else {
  configureArgs.push("-DCMAKE_BUILD_TYPE=Release");
}

run(cmake, configureArgs);

const buildArgs = [
  "--build",
  buildDir,
  "--config",
  "Release",
  "--target",
  "whisper-cli",
];
if (isWindows) {
  buildArgs.push("--", "/m");
} else {
  buildArgs.push("--parallel");
}

run(cmake, buildArgs);

const builtBinary = locateBuiltBinary();
if (!builtBinary) {
  fail("The build completed but whisper-cli could not be found.");
}

mkdirSync(path.dirname(destination), { recursive: true });
copyFileSync(builtBinary, destination);
if (!isWindows) chmodSync(destination, 0o755);

const sizeMb = (statSync(destination).size / 1024 / 1024).toFixed(1);
log(`Installed ${path.relative(root, destination)} (${sizeMb} MB)`);

const version = probe(destination, ["--version"]);
if (version) {
  log(version);
} else {
  log("Warning: the sidecar was installed but could not be executed.");
}
