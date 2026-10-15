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

export type ScanOptions = {
    // terminal width, used to recognize lines soft-wrapped by a TUI
    cols?: number;
    // For a line index, [start, end) string offsets of text drawn in a
    // different color than the rest of the line. TUIs render markdown inline
    // code that way (colored, backticks dropped), so these runs stand in for
    // spans. A callback: reading cell colors is costly and only needed for
    // the few lines nothing else matched.
    styledRuns?: (lineIndex: number) => Array<[number, number]>;
};

export type CommandOccurrence = {
    command: string;
    lineIndex: number;
    endLineIndex: number;
    inFence: boolean;
    // a whole non-shell code block (python, yaml, ...) rather than a command
    block?: { lang: string };
};

const MaxCommands = 50;
const MaxContinuationLines = 15;
// A quoted script (`watch -n 2 '...'`) can legitimately span many lines.
const MaxQuotedLines = 80;
const MaxTokens = 30;
const MaxCommandLength = 500;

// Binaries that reliably indicate a shell command line when they appear as the
// first token (after wrappers/env assignments are stripped).
const KNOWN_COMMANDS = new Set([
    // containers / k8s
    "kubectl",
    "k3s",
    "oc",
    "helm",
    "helmfile",
    "kustomize",
    "minikube",
    "kind",
    "k9s",
    "stern",
    "istioctl",
    "argocd",
    "flux",
    "skaffold",
    "tilt",
    "kompose",
    "podman",
    "docker",
    "nerdctl",
    "buildah",
    "skopeo",
    "crane",
    "dive",
    "trivy",
    // cloud / hosting
    "aws",
    "gcloud",
    "az",
    "doctl",
    "flyctl",
    "heroku",
    "netlify",
    "vercel",
    "sam",
    "pulumi",
    // iac / env
    "terraform",
    "tofu",
    "ansible",
    "ansible-playbook",
    "ansible-vault",
    "vagrant",
    "packer",
    "nix",
    "nix-shell",
    "devenv",
    "direnv",
    "asdf",
    "mise",
    // languages / build
    "npm",
    "npx",
    "yarn",
    "pnpm",
    "bun",
    "bunx",
    "deno",
    "node",
    "python",
    "python3",
    "pip",
    "pip3",
    "uv",
    "poetry",
    "conda",
    "pipenv",
    "go",
    "gofmt",
    "cargo",
    "rustc",
    "rustup",
    "cmake",
    "ninja",
    "meson",
    "gradle",
    "mvn",
    "java",
    "javac",
    "kotlin",
    "dotnet",
    "php",
    "composer",
    "ruby",
    "gem",
    "bundler",
    "rake",
    "rails",
    "perl",
    "lua",
    "zig",
    "tsc",
    "vite",
    "webpack",
    "jest",
    "vitest",
    "eslint",
    "prettier",
    "pytest",
    "tox",
    "black",
    "ruff",
    "tsx",
    "nodemon",
    "pm2",
    // ai agents
    "claude",
    "codex",
    "opencode",
    "aider",
    "gemini",
    "ollama",
    // vcs
    "git",
    "gh",
    "git-lfs",
    "svn",
    "hg",
    // network / remote
    "ssh",
    "scp",
    "sftp",
    "rsync",
    "curl",
    "wget",
    "ping",
    "dig",
    "nslookup",
    "host",
    "traceroute",
    "tracepath",
    "mtr",
    "nc",
    "ncat",
    "socat",
    "netstat",
    "ss",
    "ip",
    "ifconfig",
    "openssl",
    "whois",
    "ssh-keygen",
    "ssh-copy-id",
    // db
    "psql",
    "mysql",
    "sqlite3",
    "mongo",
    "mongosh",
    "redis-cli",
    "prisma",
    // files / text
    "awk",
    "sed",
    "grep",
    "egrep",
    "fgrep",
    "rg",
    "fd",
    "xargs",
    "jq",
    "yq",
    "column",
    "paste",
    "comm",
    "cmp",
    "basename",
    "dirname",
    "realpath",
    "readlink",
    "sha256sum",
    "md5sum",
    "shasum",
    "mktemp",
    "tar",
    "gzip",
    "gunzip",
    "zcat",
    "zip",
    "unzip",
    "7z",
    "xz",
    "bzip2",
    // sys / process / package managers
    "pkill",
    "pgrep",
    "killall",
    "lsof",
    "groups",
    "printenv",
    "systemctl",
    "journalctl",
    "service",
    "crontab",
    "shutdown",
    "reboot",
    "lsblk",
    "lspci",
    "lsusb",
    "sysctl",
    "dmesg",
    "apt",
    "apt-get",
    "dpkg",
    "dnf",
    "yum",
    "rpm",
    "pacman",
    "apk",
    "zypper",
    "brew",
    "choco",
    "scoop",
    "winget",
    "snap",
    "flatpak",
    "wsl",
    "ufw",
    "iptables",
    "chgrp",
    "umask",
    // editors
    "vim",
    "nvim",
    "vi",
    "nano",
    "emacs",
    "code",
    // media
    "ffmpeg",
    "ffprobe",
    "magick",
    "convert",
    "yt-dlp",
    // shells / builtins
    "bash",
    "zsh",
    "fish",
    "dash",
    "ksh",
    "tcsh",
    "pwsh",
    "eval",
    "printf",
    "pushd",
    "popd",
    "sudo",
    "su",
    // common ambiguous ones kept out of AMBIGUOUS_COMMANDS because they are
    // almost never prose lead words
    "htop",
    "btop",
]);

// Known binaries that double as common English words ("make sure...",
// "cat photos...", "test the endpoint..."). They need stronger evidence than a
// bare known-binary hit: a code fence, a flag/path/quoted argument, or a
// single-token invocation.
const AMBIGUOUS_COMMANDS = new Set([
    "alias",
    "cat",
    "cd",
    "chown",
    "chmod",
    "clear",
    "cp",
    "cut",
    "date",
    "diff",
    "du",
    "df",
    "echo",
    "env",
    "exec",
    "exit",
    "export",
    "find",
    "free",
    "grep",
    "head",
    "help",
    "history",
    "id",
    "install",
    "kill",
    "less",
    "ln",
    "local",
    "ls",
    "make",
    "man",
    "mkdir",
    "more",
    "mount",
    "umount",
    "mv",
    "printf",
    "ps",
    "pwd",
    "read",
    "rm",
    "rmdir",
    "sleep",
    "sort",
    "source",
    "stat",
    "tail",
    "test",
    "time",
    "top",
    "touch",
    "tr",
    "true",
    "type",
    "uname",
    "uniq",
    "unset",
    "uptime",
    "wait",
    "watch",
    "wc",
    "which",
    "whoami",
    "yes",
]);

// Prefixes skipped when determining the first real token of a line.
const WRAPPERS = new Set([
    "sudo",
    "doas",
    "pkexec",
    "rlwrap",
    "env",
    "nice",
    "nohup",
    "stdbuf",
    "timeout",
    "watch",
    "command",
    "builtin",
    "exec",
    "time",
]);

// Package managers print log lines that start with their own name
// ("npm warn deprecated ...", "brew error ..."), which would otherwise pass as
// known-binary commands. "info" stays out: `npm info react` is a real command.
const LOGGING_TOOLS = new Set(["npm", "yarn", "pnpm", "pip", "pip3", "brew", "gem", "composer"]);
const LOG_LEVEL_WORDS = new Set([
    "warn",
    "warning",
    "error",
    "err!",
    "notice",
    "verb",
    "verbose",
    "sill",
    "silly",
    "timing",
    "fatal",
    "deprecated",
]);

// Shell keywords that open/close a compound command spanning several lines.
const BLOCK_OPEN_WORDS = new Set(["do", "if", "case", "{"]);
const BLOCK_CLOSE_WORDS = new Set(["done", "fi", "esac", "}"]);

const SHELL_FENCE_LANGS = new Set([
    "sh",
    "bash",
    "zsh",
    "shell",
    "shellsession",
    "shell-session",
    "console",
    "terminal",
    "fish",
    "ksh",
    "dash",
    "console-session",
]);

// Sentence lead words, used to reject prose that leaked into a code fence.
const PROSE_WORDS = new Set([
    "a",
    "an",
    "the",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "you",
    "your",
    "we",
    "our",
    "they",
    "their",
    "to",
    "of",
    "in",
    "on",
    "for",
    "with",
    "from",
    "into",
    "about",
    "as",
    "at",
    "by",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "and",
    "or",
    "but",
    "if",
    "then",
    "else",
    "when",
    "while",
    "until",
    "because",
    "so",
    "such",
    "not",
    "no",
    "also",
    "only",
    "just",
    "can",
    "could",
    "should",
    "would",
    "will",
    "shall",
    "may",
    "might",
    "must",
    "do",
    "does",
    "did",
    "there",
    "here",
    "what",
    "which",
    "who",
    "how",
    "why",
    "where",
    "all",
    "any",
    "some",
    "own",
    "same",
    "than",
    "too",
    "once",
    "note",
    "tip",
    "warning",
    "error",
    "info",
    "usage",
    "options",
    "example",
    "examples",
    "available",
    "required",
    "optional",
    "see",
    "use",
    "using",
    "used",
    "run",
    "runs",
    "running",
    "try",
    "first",
    "next",
    "after",
    "before",
    "above",
    "below",
    "please",
    "instead",
    "add",
    "adds",
    "create",
    "creates",
    "makes",
    "gets",
    "sets",
    "opens",
    "click",
    "select",
    "choose",
    "enter",
    "type",
    "copy",
    "paste",
    "download",
    "upload",
    "check",
    "verify",
    "ensure",
    "enable",
    "disable",
    "start",
    "stop",
    "restart",
    "build",
    "deploy",
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
// `if ...; then`, `for x in ...; do`, `case $x in`, `name() {`: shell syntax,
// not prose.
const CompoundStartRegex =
    /^(?:(?:if|for|while|until|case|select)\s.+(?:;\s*(?:then|do)|\sin)|(?:function\s+)?[\w-]+\s*\(\)\s*\{)$/;
const QuotedStringRegex = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
const BulletRegex = /^(?:[-*•‣▪◦]|\d+[.)])\s+/;
// Line-number gutters from `cat -n`, `bat`, `nl`: `  12 │ cmd`, `  3<tab>cmd`.
const GutterRegex = /^\d{1,5}(?:\t|\s*[│┃]\s?)/;
// PowerShell / cmd.exe prompts: `PS C:\Users\me> cmd`, `C:\> cmd`.
const WinPromptRegex = /^(?:PS\s+)?[A-Za-z]:\\[^\s>]*>\s?/;
// Secondary prompt the shell prints in front of continuation lines.
const Ps2Regex = /^(\s*)(?:>|…)\s/;
// Typographic characters that a renderer may have substituted; the shell
// needs their ASCII form.
// the zero-width joiner is listed as an alternation: eslint flags joiners
// inside a character class
const InvisibleCharsRegex = /[\u200b\u200c\ufeff]|\u200d/g;
const OddSpaceRegex = /[\u00a0\u2007\u202f]/g;
const SmartSingleQuoteRegex = /[\u2018\u2019]/g;
const SmartDoubleQuoteRegex = /[\u201c\u201d]/g;
const FenceRegex = /^(`{3,}|~{3,})(.*)$/;
const BacktickSpanRegex = /`([^`]+)`/g;
// `;` is excluded: a line-ending semicolon terminates rather than continues,
// and is far more common in prose ("...as follows;").
const ContinuationRegex = /(?:\\|&&|\|\||\|)\s*$/;
// A line starting with a flag is never a command of its own: it is the tail
// of the previous command, wrapped by the TUI that printed it.
const SoftWrapFlagRegex = /^-{1,2}[A-Za-z]/;
const SentenceEndRegex = /[?.!]$/;
const UrlRegex = /^https?:\/\//i;
// Fallback (unknown binary) candidates must start lowercase or path-like.
const FallbackTokenRegex = /^[a-z_.~/][-a-z0-9_.:@~/]*$/;
const ShellMetaRegex = /&&|\|\||[|;]|\$\(|>>|>/;
const EnvAssignRegex = /^\w+=(?:"[^"]*"|'[^']*'|\S+)$/;
// Option values that follow a wrapper's flag: `watch -n 2`, `timeout 5s`.
const WrapperOptValueRegex = /^\d+(?:\.\d+)?[smhd]?$/;
// Wrapper flags whose next token is a value, not the wrapped command:
// sudo -u/-g, watch/nice -n, timeout -s/-k, env -C/-S, stdbuf -o/-e.
const WrapperValueFlags = new Set(["-u", "-g", "-n", "-s", "-k", "-C", "-S", "-o", "-e"]);
const LeadingQuoteRegex = /^["'`]+/;
// `cat <<EOF`, `cat <<-'EOF'`, `tee x <<"END"` (but not the `<<<` here-string)
const HeredocRegex = /(?:^|[^<])<<-?\s*(["']?)([A-Za-z_][\w-]*)\1/;
// `kind: ConfigMap`, `name: app`: YAML/config lines, never a command
const KeyValueTokenRegex = /^[\w.-]+:$/;
// A fence that opens with a shebang or `set -e...` is a script meant to be
// run as a whole, not a list of independent commands.
const ScriptStartRegex = /^(?:#!|set\s+-[a-zA-Z]*e)/;

function stripAnsi(line: string): string {
    if (!line.includes("\x1b")) {
        return line;
    }
    return line.replace(AnsiRegex, "");
}

// Removes escape codes and normalizes characters that would break a pasted
// command: non-breaking spaces, zero-width marks and curly quotes.
function sanitizeLine(rawLine: string): string {
    return stripAnsi(rawLine)
        .replace(InvisibleCharsRegex, "")
        .replace(OddSpaceRegex, " ")
        .replace(SmartSingleQuoteRegex, "'")
        .replace(SmartDoubleQuoteRegex, '"');
}

// Per-line trailing whitespace would turn `cmd \` into a broken escape, and
// trailing blank lines are noise in the clipboard.
function finalizeCommand(command: string): string {
    const lines = command.split("\n").map((l) => l.trimEnd());
    while (lines.length > 1 && lines[lines.length - 1] == "") {
        lines.pop();
    }
    return lines.join("\n");
}

export function cleanCommandLine(rawLine: string): string {
    let line = sanitizeLine(rawLine).trim();
    if (line == "") {
        return "";
    }
    line = line.replace(LeadingDecorRegex, "").replace(TrailingDecorRegex, "").trim();
    line = line.replace(GutterRegex, "").replace(WinPromptRegex, "").trim();
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
    let line = sanitizeLine(rawLine).replace(TrailingDecorRegex, "").trimEnd();
    if (!/^\s/.test(line)) {
        line = line.replace(LeadingDecorRegex, "");
    }
    line = line.replace(Ps2Regex, "$1");
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
        const spans = [...cleanedLine.matchAll(BacktickSpanRegex)].map((m) => m[1].trim()).filter((s) => s != "");
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
    return tokens.slice(1).some((t) => (t.startsWith("-") && t.length > 1) || /[/\\.@:=~$#%"'`]/.test(t));
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
            // skip the wrapper's own options: `watch -n 2`, `sudo -u postgres`, `timeout 5s`
            while (tokens.length > 1 && (tokens[0].startsWith("-") || WrapperOptValueRegex.test(tokens[0]))) {
                const takesValue = WrapperValueFlags.has(tokens[0]);
                tokens = tokens.slice(1);
                if (takesValue && tokens.length > 1 && !tokens[0].startsWith("-")) {
                    tokens = tokens.slice(1);
                }
            }
            // `watch -n 2 '` opens a multi-line quoted script: the wrapper is
            // the command, the script follows on the next lines
            if (/^["']$/.test(tokens[0] ?? "")) {
                return [first];
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
    // `watch -n 2 'kubectl get pods'`: the real command sits inside the quote
    const firstToken = effective[0]?.replace(LeadingQuoteRegex, "");
    if (firstToken == null || firstToken == "") {
        return false;
    }
    if (KeyValueTokenRegex.test(firstToken)) {
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

// Heredoc bodies are literal text (blank lines and indentation included) up
// to the line holding only the delimiter. Without a terminator in range the
// first line is returned alone rather than swallowing what follows.
function readHeredoc(
    lines: string[],
    startLine: number,
    candidate: string,
    delimiter: string
): { command: string; lastLine: number } {
    const baseIndent = leadingIndent(lines[startLine]);
    let joined = candidate;
    for (let j = startLine + 1; j < lines.length && j - startLine <= MaxQuotedLines; j++) {
        const raw = sanitizeLine(lines[j]);
        if (raw.trim() == delimiter) {
            return { command: joined + "\n" + delimiter, lastLine: j };
        }
        joined += "\n" + cleanContinuationLine(lines[j], baseIndent);
    }
    return { command: candidate, lastLine: startLine };
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
    const heredoc = candidate.match(HeredocRegex);
    if (heredoc != null) {
        return readHeredoc(lines, startLine, candidate, heredoc[2]);
    }
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

// True when a single or double quote opened in `text` is still open at its end.
function hasUnclosedQuote(text: string): boolean {
    let quote: string = null;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch == "\\" && quote != "'") {
            i++;
            continue;
        }
        if (quote == null && (ch == "'" || ch == '"')) {
            quote = ch;
        } else if (ch == quote) {
            quote = null;
        }
    }
    return quote != null;
}

function displayedWidth(rawLine: string): number {
    return stripAnsi(rawLine).replace(TrailingDecorRegex, "").trimEnd().length;
}

// TUIs (Claude Code, opencode, ...) word-wrap long commands onto new lines in
// narrow blocks. Those lines are not xterm-wrapped, so they reach us as
// separate logical lines; rejoin them with a space.
function readSoftWrap(
    lines: string[],
    lastLine: number,
    command: string,
    inFence: boolean,
    cols: number | undefined
): { command: string; lastLine: number } {
    const firstIndent = leadingIndent(lines[lastLine]);
    const startLine = lastLine;
    const original = command;
    for (let j = lastLine + 1; j < lines.length; ) {
        const inQuote = hasUnclosedQuote(command);
        if (j - startLine > (inQuote ? MaxQuotedLines : MaxContinuationLines)) {
            break;
        }
        if (parseFenceMarker(stripAnsi(lines[j]).trim(), inFence) != null) {
            break;
        }
        if (inQuote) {
            // inside the quote everything is script text: keep blank lines and
            // relative indentation, except for TUI-wrapped tails (column 0)
            const wrappedTail = firstIndent > 0 && leadingIndent(lines[j]) < firstIndent;
            const text = wrappedTail
                ? cleanContinuationLine(lines[j], 0).trim()
                : cleanContinuationLine(lines[j], firstIndent);
            command += (wrappedTail && text != "" ? " " : "\n") + text;
            lastLine = j;
            j++;
            continue;
        }
        const next = cleanCommandLine(lines[j]);
        if (next == "") {
            break;
        }
        const firstToken = next.split(/\s+/)[0];
        const widthOverflow = cols != null && displayedWidth(lines[j - 1]) + 1 + firstToken.length > cols;
        // a TUI wraps onto column 0 while the command itself was indented
        // only outside fences: in code a lower indent is ordinary structure
        // (closing `}`, `done`), not a TUI-wrapped tail
        const indentDrop = !inFence && firstIndent > 0 && leadingIndent(lines[j]) < firstIndent;
        const isFlag = SoftWrapFlagRegex.test(next);
        if (!isFlag && !widthOverflow && !indentDrop) {
            break;
        }
        if (!isFlag) {
            const basename = firstToken.split("/").pop() ?? "";
            if (
                KNOWN_COMMANDS.has(basename) ||
                AMBIGUOUS_COMMANDS.has(basename) ||
                PROSE_WORDS.has(firstToken) ||
                endsWithSentencePunctuation(next)
            ) {
                break;
            }
        }
        command += " " + next;
        lastLine = j;
        j++;
    }
    // a quote that never closes (`echo don't`) is a stray apostrophe, not a
    // multi-line script: keep the first line alone
    if (hasUnclosedQuote(command)) {
        return { command: original, lastLine: startLine };
    }
    return { command, lastLine };
}

function isShellFence(lang: string): boolean {
    return lang == "" || SHELL_FENCE_LANGS.has(lang);
}

type FenceBody = { command: string; lineIndex: number; endLineIndex: number; closeLine: number };

// The whole body of a shell fence that starts like a script, comments and
// blank lines included, dedented to its first line. Null when the fence is
// not a script or is never closed in range.
function readFencedScript(lines: string[], fenceLine: number, marker: string, lang: string): FenceBody | null {
    if (!isShellFence(lang)) {
        return null;
    }
    let first = fenceLine + 1;
    while (first < lines.length && sanitizeLine(lines[first]).trim() == "") {
        first++;
    }
    if (first >= lines.length) {
        return null;
    }
    const firstText = sanitizeLine(lines[first]).replace(LeadingDecorRegex, "").trim();
    if (!ScriptStartRegex.test(firstText)) {
        return null;
    }
    return readFenceBody(lines, first, marker);
}

// Body of a code fence from `first` to the last non-blank line before the
// closing marker, dedented to its first line. Null when the fence is never
// closed in range: better nothing than a block that swallows the answer.
function readFenceBody(lines: string[], first: number, marker: string): FenceBody | null {
    const baseIndent = leadingIndent(lines[first]);
    const body: string[] = [];
    for (let j = first; j < lines.length && j - first <= MaxQuotedLines; j++) {
        const fence = parseFenceMarker(cleanCommandLine(lines[j]), true);
        if (fence != null && fence.closes && fence.marker[0] == marker) {
            let last = j - 1;
            while (last > first && sanitizeLine(lines[last]).trim() == "") {
                last--;
            }
            return {
                command: finalizeCommand(body.slice(0, last - first + 1).join("\n")),
                lineIndex: first,
                endLineIndex: last,
                closeLine: j,
            };
        }
        body.push(cleanContinuationLine(lines[j], baseIndent));
    }
    return null;
}

function readCodeBlock(lines: string[], fenceLine: number, marker: string): FenceBody | null {
    let first = fenceLine + 1;
    while (first < lines.length && sanitizeLine(lines[first]).trim() == "") {
        first++;
    }
    if (first >= lines.length || parseFenceMarker(cleanCommandLine(lines[first]), true) != null) {
        return null;
    }
    return readFenceBody(lines, first, marker);
}

// Every command occurrence in order, without dedup. Used directly by the hover
// overlay, which needs the exact line range of each occurrence.
export function scanCommands(lines: string[], opts?: ScanOptions): CommandOccurrence[] {
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
                // resume after the closing marker, not after the body: blank
                // lines may sit between them, and re-reading the closing
                // marker would open a phantom fence over the rest of the text
                const script = readFencedScript(lines, i, fence.marker[0], fence.info);
                if (script != null) {
                    const { closeLine, ...occ } = script;
                    results.push({ ...occ, inFence: true });
                    i = closeLine;
                    continue;
                }
                const block = isShellFence(fence.info) ? null : readCodeBlock(lines, i, fence.marker[0]);
                if (block != null) {
                    const { closeLine, ...occ } = block;
                    results.push({ ...occ, inFence: true, block: { lang: fence.info } });
                    i = closeLine;
                    continue;
                }
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
        const foundBefore = results.length;
        let lastLine = i;
        for (const candidate of candidates) {
            if (!fromSpans && CompoundStartRegex.test(candidate)) {
                const cont = readContinuation(lines, i, candidate, inFence);
                if (cont.lastLine > i) {
                    lastLine = cont.lastLine;
                    results.push({
                        command: finalizeCommand(cont.command),
                        lineIndex: i,
                        endLineIndex: lastLine,
                        inFence,
                    });
                }
                continue;
            }
            if (!acceptsAsCommand(candidate, inFence, fenceLang)) {
                continue;
            }
            if (fromSpans) {
                results.push({ command: finalizeCommand(candidate), lineIndex: i, endLineIndex: i, inFence });
                continue;
            }
            let cont = readContinuation(lines, i, candidate, inFence);
            if (cont.lastLine == i) {
                cont = readSoftWrap(lines, i, cont.command, inFence, opts?.cols);
            }
            lastLine = cont.lastLine;
            results.push({ command: finalizeCommand(cont.command), lineIndex: i, endLineIndex: lastLine, inFence });
        }
        // Fences are syntax-highlighted token by token, so color runs are only
        // meaningful in prose, and only when nothing else matched the line.
        if (results.length == foundBefore && !inFence && !cleaned.includes("`") && opts?.styledRuns != null) {
            for (const [start, end] of opts.styledRuns(i)) {
                const run = sanitizeLine(lines[i].slice(start, end)).trim();
                // TUIs also color file paths and names in prose; a lone word
                // only counts when it is a known program (`htop`)
                const single = !/\s/.test(run);
                if (single && !KNOWN_COMMANDS.has(run.split("/").pop() ?? "")) {
                    continue;
                }
                if (acceptsAsCommand(run, false, "")) {
                    results.push({ command: finalizeCommand(run), lineIndex: i, endLineIndex: i, inFence });
                }
            }
        }
        i = lastLine;
    }
    return results;
}

// Unique commands in chronological order (oldest first). Each entry points at
// its latest occurrence, and when the cap is hit the most recent commands are
// the ones kept: on a long scrollback the old ones matter least.
export function extractCommands(lines: string[], opts?: ScanOptions): DetectedCommand[] {
    const newestFirst: DetectedCommand[] = [];
    const byCommand = new Map<string, DetectedCommand>();
    // code blocks are offered on hover only; the panel lists commands
    const occurrences = scanCommands(lines, opts).filter((occ) => occ.block == null);
    for (let i = occurrences.length - 1; i >= 0; i--) {
        const occ = occurrences[i];
        const existing = byCommand.get(occ.command);
        if (existing != null) {
            existing.count++;
            continue;
        }
        if (newestFirst.length >= MaxCommands) {
            continue;
        }
        const detected: DetectedCommand = { id: `cmd-${occ.lineIndex}-${i}`, ...occ, count: 1 };
        byCommand.set(occ.command, detected);
        newestFirst.push(detected);
    }
    return newestFirst.reverse();
}

// Case-insensitive match where every whitespace-separated term must appear.
export function filterCommands(commands: DetectedCommand[], query: string): DetectedCommand[] {
    const terms = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t != "");
    if (terms.length == 0) {
        return commands;
    }
    return commands.filter((c) => {
        const text = c.command.toLowerCase();
        return terms.every((t) => text.includes(t));
    });
}

export function commandsToCopyText(commands: DetectedCommand[]): string {
    return commands.map((c) => c.command).join("\n");
}
