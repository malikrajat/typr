# Typr

A minimal cross-platform dictation app built with Tauri v2, Rust, and vanilla
TypeScript. Capture audio with a global hotkey, transcribe locally with
whisper.cpp or through the Groq API, and paste the result automatically.

## Development

Every common command (dev, build, check, test, clean, doctor) is available from
one interactive menu:

```bash
npm run menu
```

You can also run tasks directly, for example `npm run app:dev` or
`npm run app:build`. See [COMMANDS.md](COMMANDS.md) for the full reference, VS
Code tasks, first-time setup, and how to add new commands.

For a fresh checkout, run `npm install` and `npm run setup:sidecar` before
starting the desktop app. The sidecar command builds the whisper.cpp binary that
Tauri requires.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
