// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type DetectedCommand = {
    id: string;
    command: string;
    lineIndex: number;
    endLineIndex: number;
    inFence: boolean;
    count: number;
};

export type CommandOccurrence = {
    command: string;
    lineIndex: number;
    endLineIndex: number;
    inFence: boolean;
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

// Package managers print log lines that start with their own name
// ("npm warn deprecated ...", "brew error ..."), which would otherwise pass as
// known-binary commands. "info" stays out: `npm info react` is a real command.
const LOGGING_TOOLS = new Set(["npm", "yarn", "pnpm", "pip", "pip3", "brew", "gem", "composer"]);
const LOG_LEVEL_WORDS = new Set([
    "warn", "warning", "error", "err!", "notice", "verb", "verbose", "sill", "silly", "timing", "fatal",
    "deprecated",
]);

// Shell keywords that open/close a compound command spanning several lines.
const BLOCK_OPEN_WORDS = new Set(["do", "if", "case", "{"]);
const BLOCK_CLOSE_WORDS = new Set(["done", "fi", "esac", "}"]);

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
// prefix precedes it; a bare `#` is far more often a comment. Also covers the
// macOS zsh default `user@host ~/dir %` (cwd separated by a space) and the
// bash default `bash-3.2$`.
const PromptRegex =
    /^(?:(?:\([^)]*\)|\[[^\]]*\])\s*)?(?:\S*[@:]\S*[$%#>❯➜→»]|\S+@\S+\s+[~/.\w][^\s]*\s?[$%#>❯](?=\s|$)|[\w.]+-\d[\w.]*[$#]|[$%>❯➜→»])\s?/;
const VersionOutputRegex = /^\S+\s+version\s+\S*\d+\.\d+/i;
// `if ...; then`, `for x in ...; do`, `case $x in`: shell syntax, not prose.
const CompoundStartRegex = /^(?:if|for|while|until|case|select)\s.+(?:;\s*(?:then|do)|\sin)$/;
const QuotedStringRegex = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
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
// The first line's indent (e.g. the 2-space margin Claude Code puts in front
// of every response line) is removed so nested lines keep only their
// relative indentation.
function cleanContinuationLine(rawLine: string, baseIndent: number): string {
    let line = stripAnsi(rawLine).replace(TrailingDecorRegex, "").trimEnd();
    if (!/^\s/.test(line)) {
        line = line.replace(LeadingDecorRegex, "");
    }
    const indent = line.length - line.trimStart().length;
    return line.slice(Math.min(indent, baseIndent)).trimEnd();
}

function leadingIndent(rawLine: string): number {
    const line = stripAnsi(rawLine).replace(LeadingDecorRegex, "");
    return line.length - line.trimStart().length;
}

function blockDepthDelta(line: string): number {
    let delta = 0;
    for (const word of line.replace(QuotedStringRegex, "").split(/[\s;&|()]+/)) {
        if (BLOCK_OPEN_WORDS.has(word)) {
            delta++;
        } else if (BLOCK_CLOSE_WORDS.has(word)) {
            delta--;
        }
    }
    return delta;
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
    if (
        LOGGING_TOOLS.has(basename) &&
        effective.length > 1 &&
        LOG_LEVEL_WORDS.has(effective[1].toLowerCase().replace(/:$/, ""))
    ) {
        return false;
    }
    if (VersionOutputRegex.test(candidate)) {
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

// Joins the lines that belong to the command starting at `startLine`: `\`,
// `&&`, `|` continuations and multi-line compound commands (`while ...; do` up
// to `done`). An unclosed block is not joined, so a stray `do` cannot swallow
// the prose that follows it.
function readContinuation(
    lines: string[],
    startLine: number,
    candidate: string,
    inFence: boolean
): { command: string; lastLine: number } {
    let depth = blockDepthDelta(candidate);
    if (!ContinuationRegex.test(candidate) && depth <= 0) {
        return { command: candidate, lastLine: startLine };
    }
    const baseIndent = leadingIndent(lines[startLine]);
    let joined = candidate;
    let lastLine = startLine;
    for (let j = startLine + 1; j < lines.length && j - startLine <= MaxContinuationLines; j++) {
        if (parseFenceMarker(stripAnsi(lines[j]).trim(), inFence) != null) {
            break;
        }
        const next = cleanContinuationLine(lines[j], baseIndent);
        if (next.trim() == "") {
            break;
        }
        joined += "\n" + next;
        lastLine = j;
        depth += blockDepthDelta(next);
        if (depth <= 0 && !ContinuationRegex.test(next)) {
            break;
        }
    }
    if (depth > 0) {
        return { command: candidate, lastLine: startLine };
    }
    return { command: joined, lastLine };
}

// Every command occurrence in order, without dedup. Used directly by the hover
// overlay, which needs the exact line range of each occurrence.
export function scanCommands(lines: string[]): CommandOccurrence[] {
    const results: CommandOccurrence[] = [];
    let inFence = false;
    let fenceMarker = "";
    let fenceLang = "";
    for (let i = 0; i < lines.length; i++) {
        const cleaned = cleanCommandLine(lines[i]);
        if (cleaned == "") {
            continue;
        }
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
            continue;
        }
        const candidates = extractCandidates(cleaned);
        const fromSpans = candidates.length > 1 || candidates[0] != cleaned;
        let lastLine = i;
        for (const candidate of candidates) {
            if (!fromSpans && CompoundStartRegex.test(candidate)) {
                const cont = readContinuation(lines, i, candidate, inFence);
                if (cont.lastLine > i) {
                    lastLine = cont.lastLine;
                    results.push({ command: cont.command, lineIndex: i, endLineIndex: lastLine, inFence });
                }
                continue;
            }
            if (!acceptsAsCommand(candidate, inFence, fenceLang)) {
                continue;
            }
            if (fromSpans) {
                results.push({ command: candidate, lineIndex: i, endLineIndex: i, inFence });
                continue;
            }
            const cont = readContinuation(lines, i, candidate, inFence);
            lastLine = cont.lastLine;
            results.push({ command: cont.command, lineIndex: i, endLineIndex: lastLine, inFence });
        }
        i = lastLine;
    }
    return results;
}

export function extractCommands(lines: string[]): DetectedCommand[] {
    const results: DetectedCommand[] = [];
    const byCommand = new Map<string, DetectedCommand>();
    for (const occ of scanCommands(lines)) {
        const existing = byCommand.get(occ.command);
        if (existing != null) {
            existing.count++;
            continue;
        }
        if (results.length >= MaxCommands) {
            continue;
        }
        const detected: DetectedCommand = { id: `cmd-${occ.lineIndex}-${results.length}`, ...occ, count: 1 };
        byCommand.set(occ.command, detected);
        results.push(detected);
    }
    return results;
}

export function commandsToCopyText(commands: DetectedCommand[]): string {
    return commands.map((c) => c.command).join("\n");
}
