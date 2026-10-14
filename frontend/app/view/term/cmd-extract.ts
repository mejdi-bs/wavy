// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type DetectedCommand = {
    id: string;
    command: string;
    lineIndex: number;
    inFence: boolean;
    count: number;
};

const MaxCommands = 50;
const MaxContinuationLines = 15;
const MaxTokens = 30;
const MaxCommandLength = 500;

// Binaries that reliably indicate a shell command line when they appear as the
// first token (after wrappers/env assignments are stripped).
const KNOWN_COMMANDS = new Set([
    // containers / k8s
    "kubectl", "k3s", "oc", "helm", "helmfile", "kustomize", "minikube", "kind", "k9s", "stern",
    "istioctl", "argocd", "flux", "skaffold", "tilt", "kompose", "podman", "docker", "nerdctl",
    "buildah", "skopeo", "crane", "dive", "trivy",
    // cloud / hosting
    "aws", "gcloud", "az", "doctl", "flyctl", "heroku", "netlify", "vercel", "sam", "pulumi",
    // iac / env
    "terraform", "tofu", "ansible", "ansible-playbook", "ansible-vault", "vagrant", "packer",
    "nix", "nix-shell", "devenv", "direnv", "asdf", "mise",
    // languages / build
    "npm", "npx", "yarn", "pnpm", "bun", "bunx", "deno", "node", "python", "python3", "pip", "pip3",
    "uv", "poetry", "conda", "pipenv", "go", "gofmt", "cargo", "rustc", "rustup", "cmake", "ninja",
    "meson", "gradle", "mvn", "java", "javac", "kotlin", "dotnet", "php", "composer", "ruby", "gem",
    "bundler", "rake", "rails", "perl", "lua", "zig", "tsc", "vite", "webpack", "jest", "vitest",
    "eslint", "prettier", "pytest", "tox", "black", "ruff", "tsx", "nodemon", "pm2",
    // ai agents
    "claude", "codex", "opencode", "aider", "gemini", "ollama",
    // vcs
    "git", "gh", "git-lfs", "svn", "hg",
    // network / remote
    "ssh", "scp", "sftp", "rsync", "curl", "wget", "ping", "dig", "nslookup", "host", "traceroute",
    "tracepath", "mtr", "nc", "ncat", "socat", "netstat", "ss", "ip", "ifconfig", "openssl", "whois",
    "ssh-keygen", "ssh-copy-id",
    // db
    "psql", "mysql", "sqlite3", "mongo", "mongosh", "redis-cli", "prisma",
    // files / text
    "awk", "sed", "grep", "egrep", "fgrep", "rg", "fd", "xargs", "jq", "yq", "column", "paste",
    "comm", "cmp", "basename", "dirname", "realpath", "readlink", "sha256sum", "md5sum", "shasum",
    "mktemp", "tar", "gzip", "gunzip", "zcat", "zip", "unzip", "7z", "xz", "bzip2",
    // sys / process / package managers
    "pkill", "pgrep", "killall", "lsof", "groups", "printenv", "systemctl", "journalctl", "service",
    "crontab", "shutdown", "reboot", "lsblk", "lspci", "lsusb", "sysctl", "dmesg", "apt", "apt-get",
    "dpkg", "dnf", "yum", "rpm", "pacman", "apk", "zypper", "brew", "choco", "scoop", "winget",
    "snap", "flatpak", "wsl", "ufw", "iptables", "chgrp", "umask",
    // editors
    "vim", "nvim", "vi", "nano", "emacs", "code",
    // media
    "ffmpeg", "ffprobe", "magick", "convert", "yt-dlp",
    // shells / builtins
    "bash", "zsh", "fish", "dash", "ksh", "tcsh", "pwsh", "eval", "printf", "pushd", "popd",
    "sudo", "su",
    // common ambiguous ones kept out of AMBIGUOUS_COMMANDS because they are
    // almost never prose lead words
    "htop", "btop",
]);

// Known binaries that double as common English words ("make sure...",
// "cat photos...", "test the endpoint..."). They need stronger evidence than a
// bare known-binary hit: a code fence, a flag/path/quoted argument, or a
// single-token invocation.
const AMBIGUOUS_COMMANDS = new Set([
    "alias", "cat", "cd", "chown", "chmod", "clear", "cp", "cut", "date", "diff", "du", "df",
    "echo", "env", "exec", "exit", "export", "find", "free", "grep", "head", "help", "history",
    "id", "install", "kill", "less", "ln", "local", "ls", "make", "man", "mkdir", "more", "mount",
    "umount", "mv", "printf", "ps", "pwd", "read", "rm", "rmdir", "sleep", "sort", "source",
    "stat", "tail", "test", "time", "top", "touch", "tr", "true", "type", "uname", "uniq",
    "unset", "uptime", "wait", "watch", "wc", "which", "whoami", "yes",
]);

// Prefixes skipped when determining the first real token of a line.
const WRAPPERS = new Set([
    "sudo", "doas", "pkexec", "rlwrap", "env", "nice", "nohup", "stdbuf", "timeout", "watch",
    "command", "builtin", "exec", "time",
]);

const SHELL_FENCE_LANGS = new Set([
    "sh", "bash", "zsh", "shell", "shellsession", "shell-session", "console", "terminal", "fish",
    "ksh", "dash", "console-session",
]);

// Sentence lead words, used to reject prose that leaked into a code fence.
const PROSE_WORDS = new Set([
    "a", "an", "the", "this", "that", "these", "those", "it", "its", "you", "your", "we", "our",
    "they", "their", "to", "of", "in", "on", "for", "with", "from", "into", "about", "as", "at",
    "by", "is", "are", "was", "were", "be", "been", "and", "or", "but", "if", "then", "else",
    "when", "while", "until", "because", "so", "such", "not", "no", "also", "only", "just", "can",
    "could", "should", "would", "will", "shall", "may", "might", "must", "do", "does", "did",
    "there", "here", "what", "which", "who", "how", "why", "where", "all", "any", "some", "own",
    "same", "than", "too", "once", "note", "tip", "warning", "error", "info", "usage", "options",
    "example", "examples", "available", "required", "optional", "see", "use", "using", "used",
    "run", "runs", "running", "try", "first", "next", "after", "before", "above", "below",
    "please", "instead", "add", "adds", "create", "creates", "makes", "gets", "sets", "opens",
    "click", "select", "choose", "enter", "type", "copy", "paste", "download", "upload", "check",
    "verify", "ensure", "enable", "disable", "start", "stop", "restart", "build", "deploy",
    "configure",
]);

// Prose markers that separate "make build.target" from "make sure this works".
const ProsePatternRegex =
    /\b(?:the|this|that|these|those|your|our|their|with|from|into|onto|and|but|to|for|of|is|are|was|be|been|sure|need|needs|should|would|will|can|could|when|while|then|than|there|here)\b/;

// eslint-disable-next-line no-control-regex
const AnsiRegex = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;
// Box-drawing/border/bullet glyphs used to decorate terminal output (e.g. the
// Claude Code TUI draws fences inside `│ ` gutters).
const DecorChars = "│|┃║╎╏┆┊┋─━═┅┄┈┉┌┐└┘├┤┬┴┼╭╮╰╯►▶»⏺●○·•▪◦‣";
// ASCII `|` stays out of the trailing set: a trailing pipe usually continues
// the command on the next line, and markdown table rows are rejected by their
// prose headers anyway.
const TrailingDecorChars = "│┃║╎╏┆┊┋─━═┅┄┈┉┌┐└┘├┤┬┴┼╭╮╰╯◄◀·•▪◦‣";
const LeadingDecorRegex = new RegExp(`^[${DecorChars}]+[ ]?`);
const TrailingDecorRegex = new RegExp(`[ ]?[${TrailingDecorChars}]+$`);
// Matches shell prompt prefixes: bare `$`/`%`/`>` prompts, powerline arrows,
// and the tail of `user@host:~$`, `(venv) user@host:~$`, `root@box:~#`, or
// `C:\>` style prompts. `#` is only a prompt char when a user@host/path
// prefix precedes it; a bare `#` is far more often a comment.
const PromptRegex = /^(?:(?:\([^)]*\)|\[[^\]]*\])\s*)?(?:\S*[@:]\S*[$%#>❯➜→»]|[$%>❯➜→»])\s?/;
const BulletRegex = /^(?:[-*•‣▪◦]|\d+[.)])\s+/;
const FenceRegex = /^(`{3,}|~{3,})(.*)$/;
const BacktickSpanRegex = /`([^`]+)`/g;
// `;` is excluded: a line-ending semicolon terminates rather than continues,
// and is far more common in prose ("...as follows;").
const ContinuationRegex = /(?:\\|&&|\|\||\|)\s*$/;
const SentenceEndRegex = /[?.!]$/;
const UrlRegex = /^https?:\/\//i;
// Fallback (unknown binary) candidates must start lowercase or path-like.
const FallbackTokenRegex = /^[a-z_.~/][-a-z0-9_.:@~/]*$/;
const ShellMetaRegex = /&&|\|\||[|;]|\$\(|>>|>/;
const EnvAssignRegex = /^\w+=(?:"[^"]*"|'[^']*'|\S+)$/;

function stripAnsi(line: string): string {
    if (!line.includes("\x1b")) {
        return line;
    }
    return line.replace(AnsiRegex, "");
}

export function cleanCommandLine(rawLine: string): string {
    let line = stripAnsi(rawLine).trim();
    if (line == "") {
        return "";
    }
    line = line.replace(LeadingDecorRegex, "").replace(TrailingDecorRegex, "").trim();
    if (line == "" || line.startsWith("#")) {
        return "";
    }
    line = line.replace(PromptRegex, "");
    line = line.replace(BulletRegex, "");
    line = line.trim();
    // shell prompts that print the cwd (starship `➜  ~ git status`)
    if (/^~\s+\S/.test(line)) {
        line = line.slice(1).trim();
    }
    return line;
}

// Continuation lines keep their leading whitespace — it is part of the
// command's verbatim content — but still lose gutter decoration.
function cleanContinuationLine(rawLine: string): string {
    let line = stripAnsi(rawLine).replace(TrailingDecorRegex, "").trimEnd();
    if (!/^\s/.test(line)) {
        line = line.replace(LeadingDecorRegex, "");
    }
    return line.trimEnd();
}

type FenceMarker = { marker: string; info: string; closes: boolean };

function parseFenceMarker(cleanedLine: string, inFence: boolean): FenceMarker | null {
    const m = cleanedLine.match(FenceRegex);
    if (!m) {
        return null;
    }
    const info = m[2].trim();
    if (info.length > 20) {
        return null;
    }
    return { marker: m[1], info: info.split(/\s+/)[0].toLowerCase(), closes: inFence && info == "" };
}

function extractCandidates(cleanedLine: string): string[] {
    if (cleanedLine.includes("`")) {
        const spans = [...cleanedLine.matchAll(BacktickSpanRegex)]
            .map((m) => m[1].trim())
            .filter((s) => s != "");
        if (spans.length > 0) {
            return spans;
        }
    }
    return [cleanedLine];
}

function endsWithSentencePunctuation(command: string): boolean {
    if (!SentenceEndRegex.test(command)) {
        return false;
    }
    const lastToken = command.split(/\s+/).pop();
    return lastToken != "." && lastToken != ".." && !command.endsWith("/");
}

function hasTechnicalArg(tokens: string[]): boolean {
    return tokens
        .slice(1)
        .some((t) => (t.startsWith("-") && t.length > 1) || /[/\\.@:=~$#%"'`]/.test(t));
}

// Strips env assignments and wrapper commands to find the first real token.
function getEffectiveTokens(command: string): string[] {
    let tokens = command.trim().split(/\s+/);
    for (;;) {
        const first = tokens[0];
        if (first == null) {
            break;
        }
        if (EnvAssignRegex.test(first) && tokens.length > 1) {
            tokens = tokens.slice(1);
            continue;
        }
        if (WRAPPERS.has(first) && tokens.length > 1) {
            tokens = tokens.slice(1);
            if (first == "timeout" && /^\d+(\.\d+)?[smhd]?$/.test(tokens[0])) {
                tokens = tokens.slice(1);
            }
            continue;
        }
        break;
    }
    return tokens;
}

function acceptsAsCommand(candidate: string, inFence: boolean, fenceLang: string): boolean {
    if (candidate == "" || candidate.length > MaxCommandLength) {
        return false;
    }
    if (UrlRegex.test(candidate) || endsWithSentencePunctuation(candidate)) {
        return false;
    }
    const tokens = candidate.split(/\s+/);
    if (tokens.length > MaxTokens) {
        return false;
    }
    const effective = getEffectiveTokens(candidate);
    const firstToken = effective[0];
    if (firstToken == null) {
        return false;
    }
    const basename = firstToken.split("/").pop();
    if (basename == null || basename == "" || basename == "." || basename == "..") {
        return false;
    }
    if (KNOWN_COMMANDS.has(basename)) {
        return true;
    }
    if (AMBIGUOUS_COMMANDS.has(basename)) {
        if (inFence) {
            return true;
        }
        if (effective.length == 1) {
            return true;
        }
        // "cd src" is as valid as "cd /usr/local", so cd only needs the
        // absence of prose markers
        if (basename == "cd") {
            return !ProsePatternRegex.test(candidate);
        }
        if (!hasTechnicalArg(effective)) {
            return false;
        }
        return !ProsePatternRegex.test(candidate);
    }
    // fallback: unknown binary
    if (!FallbackTokenRegex.test(firstToken)) {
        return false;
    }
    if (PROSE_WORDS.has(firstToken)) {
        return false;
    }
    const shellish = inFence && (fenceLang == "" || SHELL_FENCE_LANGS.has(fenceLang));
    if (shellish && effective.length > 1) {
        return true;
    }
    if (inFence && ShellMetaRegex.test(candidate) && effective.length > 1) {
        return true;
    }
    return /^[.~/]/.test(firstToken);
}

export function extractCommands(lines: string[]): DetectedCommand[] {
    const results: DetectedCommand[] = [];
    const byCommand = new Map<string, DetectedCommand>();
    let inFence = false;
    let fenceMarker = "";
    let fenceLang = "";
    let i = 0;
    while (i < lines.length) {
        const cleaned = cleanCommandLine(lines[i]);
        if (cleaned != "") {
            const fence = parseFenceMarker(cleaned, inFence);
            if (fence != null) {
                if (!inFence) {
                    inFence = true;
                    fenceMarker = fence.marker[0];
                    fenceLang = fence.info;
                } else if (fence.closes && fence.marker[0] == fenceMarker) {
                    inFence = false;
                    fenceLang = "";
                }
                i++;
                continue;
            }
            if (results.length < MaxCommands) {
                const candidates = extractCandidates(cleaned);
                for (const candidate of candidates) {
                    if (!acceptsAsCommand(candidate, inFence, fenceLang)) {
                        continue;
                    }
                    let command = candidate;
                    let lastLine = i;
                    if (ContinuationRegex.test(candidate)) {
                        let j = i + 1;
                        let joined = candidate;
                        while (j < lines.length && j - i <= MaxContinuationLines) {
                            if (parseFenceMarker(stripAnsi(lines[j]).trim(), inFence) != null) {
                                break;
                            }
                            const next = cleanContinuationLine(lines[j]);
                            if (next == "") {
                                break;
                            }
                            joined += "\n" + next;
                            lastLine = j;
                            j++;
                            if (!ContinuationRegex.test(next)) {
                                break;
                            }
                        }
                        command = joined;
                    }
                    const existing = byCommand.get(command);
                    if (existing != null) {
                        existing.count++;
                    } else {
                        const detected: DetectedCommand = {
                            id: `cmd-${i}`,
                            command: command,
                            lineIndex: i,
                            inFence: inFence,
                            count: 1,
                        };
                        byCommand.set(command, detected);
                        results.push(detected);
                    }
                    i = lastLine;
                    break;
                }
            }
        }
        i++;
    }
    return results;
}

export function commandsToCopyText(commands: DetectedCommand[]): string {
    return commands.map((c) => c.command).join("\n");
}
