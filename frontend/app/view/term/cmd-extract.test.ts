import { describe, expect, it } from "vitest";

import { cleanCommandLine, commandsToCopyText, extractCommands, scanCommands } from "./cmd-extract";

function commandsOf(lines: string[]): string[] {
    return extractCommands(lines).map((c) => c.command);
}

describe("cleanCommandLine", () => {
    it("strips prompts, bullets, and box-drawing decoration", () => {
        expect(cleanCommandLine("$ kubectl get pods")).toBe("kubectl get pods");
        expect(cleanCommandLine("% ssh user@host")).toBe("ssh user@host");
        expect(cleanCommandLine("> npm install")).toBe("npm install");
        expect(cleanCommandLine("❯ git status")).toBe("git status");
        expect(cleanCommandLine("➜ docker ps")).toBe("docker ps");
        expect(cleanCommandLine("user@host:~$ kubectl get pods")).toBe("kubectl get pods");
        expect(cleanCommandLine("root@box:~# systemctl restart nginx")).toBe("systemctl restart nginx");
        expect(cleanCommandLine("(base) user@host:~$ python script.py")).toBe("python script.py");
        expect(cleanCommandLine("- `npm install`: installs deps")).toBe("`npm install`: installs deps");
        expect(cleanCommandLine("│ $ kubectl get pods │")).toBe("kubectl get pods");
        expect(cleanCommandLine("│ ❯ ssh user@host │")).toBe("ssh user@host");
        expect(cleanCommandLine("• npm install")).toBe("npm install");
        expect(cleanCommandLine("1. docker compose up")).toBe("docker compose up");
    });

    it("drops prompt cwd decorations and comments", () => {
        expect(cleanCommandLine("➜  ~ git status")).toBe("git status");
        expect(cleanCommandLine("# install dependencies")).toBe("");
        expect(cleanCommandLine("┌──────────────┐")).toBe("");
        expect(cleanCommandLine("────────")).toBe("");
    });

    it("does not alter content inside the command", () => {
        expect(cleanCommandLine("kubectl exec -it pod-1 -- /bin/sh -c \"echo 'a  b'\"")).toBe(
            "kubectl exec -it pod-1 -- /bin/sh -c \"echo 'a  b'\""
        );
        expect(cleanCommandLine("npm  install   --save-exact")).toBe("npm  install   --save-exact");
    });
});

describe("extractCommands plain detection", () => {
    it("detects plain command lines", () => {
        expect(commandsOf(["kubectl get pods"])).toEqual(["kubectl get pods"]);
        expect(commandsOf(["ssh user@host"])).toEqual(["ssh user@host"]);
        expect(commandsOf(["sudo systemctl restart nginx"])).toEqual(["sudo systemctl restart nginx"]);
        expect(commandsOf(["FOO=bar npm install"])).toEqual(["FOO=bar npm install"]);
        expect(commandsOf(["env ANTHROPIC_API_KEY=x claude --print"])).toEqual([
            "env ANTHROPIC_API_KEY=x claude --print",
        ]);
        expect(commandsOf(["./install.sh --dry-run"])).toEqual(["./install.sh --dry-run"]);
        expect(commandsOf(["~/scripts/backup.sh --verbose"])).toEqual(["~/scripts/backup.sh --verbose"]);
    });

    it("detects commands with prompt and decoration artifacts", () => {
        expect(commandsOf(["$ kubectl get pods"])).toEqual(["kubectl get pods"]);
        expect(commandsOf(["│ $ kubectl get pods │"])).toEqual(["kubectl get pods"]);
        expect(commandsOf(["  ⏺ kubectl get pods"])).toEqual(["kubectl get pods"]);
        expect(commandsOf(["user@host:~/project$ git push origin main"])).toEqual(["git push origin main"]);
        expect(commandsOf(["➜  ~ git status"])).toEqual(["git status"]);
    });

    it("deduplicates repeated commands and counts occurrences", () => {
        const results = extractCommands(["$ kubectl get pods", "some output", "kubectl get pods"]);
        expect(results.length).toBe(1);
        expect(results[0].count).toBe(2);
    });

    it("strips ansi escapes before detecting", () => {
        expect(commandsOf(["\x1b[32m$\x1b[0m kubectl get pods"])).toEqual(["kubectl get pods"]);
    });
});

describe("extractCommands fenced code blocks", () => {
    it("detects commands inside shell fences and records fence context", () => {
        const lines = ["Check out this command:", "```bash", "kubectl get pods -n kube-system", "```", "done"];
        const results = extractCommands(lines);
        expect(results.length).toBe(1);
        expect(results[0].command).toBe("kubectl get pods -n kube-system");
        expect(results[0].inFence).toBe(true);
        expect(results[0].lineIndex).toBe(2);
    });

    it("accepts unknown binaries inside shell fences", () => {
        const lines = ["```bash", "mycustomtool sync --all", "```"];
        expect(commandsOf(lines)).toEqual(["mycustomtool sync --all"]);
    });

    it("rejects prose inside fences", () => {
        const lines = ["```bash", "First install the dependencies", "```"];
        expect(commandsOf(lines)).toEqual([]);
    });

    it("rejects non-shell code inside fences", () => {
        const lines = ["```python", "print('hello world')", "def main():", "    pass", "```"];
        expect(commandsOf(lines)).toEqual([]);
    });

    it("handles fences decorated with box-drawing gutters", () => {
        const lines = ["│ ```bash", "│ $ kubectl get pods", "│ ```"];
        expect(commandsOf(lines)).toEqual(["kubectl get pods"]);
    });

    it("does not leak fence state across separate blocks", () => {
        const lines = [
            "```bash",
            "kubectl get pods",
            "```",
            "plain prose about things",
            "```bash",
            "npm install",
            "```",
        ];
        expect(commandsOf(lines)).toEqual(["kubectl get pods", "npm install"]);
    });
});

describe("extractCommands backtick spans", () => {
    it("extracts commands wrapped in backticks", () => {
        expect(commandsOf(["`kubectl get pods`"])).toEqual(["kubectl get pods"]);
        expect(commandsOf(["Run `docker compose up -d` to start"])).toEqual(["docker compose up -d"]);
        expect(commandsOf(["- `npm install`: installs deps"])).toEqual(["npm install"]);
    });

    it("rejects backtick spans that are not commands", () => {
        expect(commandsOf(["set the `config` option"])).toEqual([]);
        expect(commandsOf(["see the `docs` for details"])).toEqual([]);
    });
});

describe("extractCommands continuations", () => {
    it("joins backslash continuations preserving verbatim content", () => {
        const lines = ["docker run \\", "  -e FOO=bar \\", "  nginx:latest"];
        expect(commandsOf(lines)).toEqual(["docker run \\\n  -e FOO=bar \\\n  nginx:latest"]);
    });

    it("joins && and pipe continuations", () => {
        expect(commandsOf(["npm install &&", "npm test"])).toEqual(["npm install &&\nnpm test"]);
        expect(commandsOf(["kubectl get pods |", "grep nginx"])).toEqual(["kubectl get pods |\ngrep nginx"]);
    });

    it("stops continuation at fence close and blank lines", () => {
        const lines = ["```bash", "kubectl get pods &&", "", "kubectl get svc", "```"];
        expect(commandsOf(lines)).toEqual(["kubectl get pods &&", "kubectl get svc"]);
    });
});

describe("extractCommands prose rejection", () => {
    it("rejects plain prose lines", () => {
        expect(commandsOf(["You can run kubectl get pods to list pods"])).toEqual([]);
        expect(commandsOf(["The kubectl command manages clusters"])).toEqual([]);
        expect(commandsOf(["This is a test"])).toEqual([]);
        expect(commandsOf(["To deploy the app, run the following steps"])).toEqual([]);
        expect(commandsOf(["It will download the files from the server"])).toEqual([]);
    });

    it("rejects commands ending with sentence punctuation", () => {
        expect(commandsOf(["kubectl get pods."])).toEqual([]);
        expect(commandsOf(["Run kubectl get pods?"])).toEqual([]);
    });

    it("keeps commands whose last token is a dot path", () => {
        expect(commandsOf(["cd .."])).toEqual(["cd .."]);
        expect(commandsOf(["source ."])).toEqual(["source ."]);
    });

    it("rejects kubectl table headers and output", () => {
        expect(commandsOf(["NAME READY STATUS RESTARTS AGE"])).toEqual([]);
        expect(commandsOf(["NAMESPACE NAME LATEST READY"])).toEqual([]);
        expect(commandsOf(["nginx-deployment-66b6c48dd5-abcde 1/1 Running 0 5m"])).toEqual([]);
    });

    it("rejects urls, comments, and markdown headers", () => {
        expect(commandsOf(["https://docs.example.com/kubectl"])).toEqual([]);
        expect(commandsOf(["# install dependencies"])).toEqual([]);
        expect(commandsOf(["## Installation"])).toEqual([]);
    });

    it("rejects ambiguous verbs used as prose", () => {
        expect(commandsOf(["Make sure you have Docker installed"])).toEqual([]);
        expect(commandsOf(["Test the endpoint when the server is up"])).toEqual([]);
        expect(commandsOf(["cat the file for me later"])).toEqual([]);
        expect(commandsOf(["cd into the directory"])).toEqual([]);
    });

    it("accepts ambiguous verbs when args look technical", () => {
        expect(commandsOf(["cat config.yaml"])).toEqual(["cat config.yaml"]);
        expect(commandsOf(["cd /usr/local/bin"])).toEqual(["cd /usr/local/bin"]);
        expect(commandsOf(["cd src"])).toEqual(["cd src"]);
        expect(commandsOf(["make -j4 build"])).toEqual(["make -j4 build"]);
        expect(commandsOf(["grep error app.log"])).toEqual(["grep error app.log"]);
    });
});

describe("extractCommands limits", () => {
    it("caps the number of detected commands", () => {
        const lines = Array.from({ length: 60 }, (_, i) => `kubectl get pod-${i}`);
        expect(extractCommands(lines).length).toBe(50);
    });

    it("rejects overly long or token-heavy lines", () => {
        expect(commandsOf([`curl ${"a".repeat(600)}`])).toEqual([]);
        expect(commandsOf(["kubectl " + Array.from({ length: 40 }, (_, i) => `arg${i}`).join(" ")])).toEqual([]);
    });
});

describe("extractCommands real-world prompts and output", () => {
    it("strips the macOS zsh and bash default prompts", () => {
        expect(cleanCommandLine("user@mac ~/wave % npm ci --ignore-scripts")).toBe("npm ci --ignore-scripts");
        expect(cleanCommandLine("user@mac ~ % git status")).toBe("git status");
        expect(cleanCommandLine("bash-3.2$ ls -la")).toBe("ls -la");
        expect(commandsOf(["user@mac ~/wave % git status"])).toEqual(["git status"]);
    });

    it("keeps ssh/scp targets that look like user@host", () => {
        expect(cleanCommandLine("ssh user@host ls -la")).toBe("ssh user@host ls -la");
        expect(cleanCommandLine("scp file.txt user@host:/tmp")).toBe("scp file.txt user@host:/tmp");
    });

    it("rejects package manager log lines and version output", () => {
        expect(commandsOf(["npm warn deprecated glob@7.2.3: Old versions of glob are not supported"])).toEqual([]);
        expect(commandsOf(["npm ERR! code ENOENT"])).toEqual([]);
        expect(commandsOf(["git version 2.45.0"])).toEqual([]);
        expect(commandsOf(["go version go1.26.8 darwin/arm64"])).toEqual([]);
        expect(commandsOf(["yarn error: Couldn't find package"])).toEqual([]);
        expect(commandsOf(["npm version patch"])).toEqual(["npm version patch"]);
        expect(commandsOf(["npm info react"])).toEqual(["npm info react"]);
        expect(commandsOf(["go version"])).toEqual(["go version"]);
        expect(commandsOf(["grep error app.log"])).toEqual(["grep error app.log"]);
    });

    it("keeps every backtick command on a line", () => {
        expect(commandsOf(["Run `kubectl get pods -n prod` then `helm list`"])).toEqual([
            "kubectl get pods -n prod",
            "helm list",
        ]);
    });
});

describe("extractCommands compound commands", () => {
    it("joins a while/do block and removes the response margin", () => {
        const lines = [
            "  kubectl config get-contexts -o name | while read ctx; do",
            '    echo "=== $ctx ==="',
            '    kubectl --context "$ctx" get pods -A',
            "  done",
            "",
            "  Astuce : kubectl get pods -A est le réflexe standard.",
        ];
        expect(commandsOf(lines)).toEqual([
            'kubectl config get-contexts -o name | while read ctx; do\n  echo "=== $ctx ==="\n  kubectl --context "$ctx" get pods -A\ndone',
        ]);
    });

    it("joins if/fi blocks", () => {
        const lines = ["if [ -f .env ]; then", "  source .env", "fi"];
        expect(commandsOf(lines)).toEqual(["if [ -f .env ]; then\n  source .env\nfi"]);
    });

    it("does not join an unclosed block", () => {
        const lines = ["kubectl get pods -o name | while read p; do", "this is prose", ""];
        expect(commandsOf(lines)).toEqual(["kubectl get pods -o name | while read p; do"]);
    });
});

describe("scanCommands", () => {
    it("reports every occurrence with its line range", () => {
        const lines = ["$ kubectl get pods", "output", "docker run \\", "  nginx", "kubectl get pods"];
        expect(scanCommands(lines)).toEqual([
            { command: "kubectl get pods", lineIndex: 0, endLineIndex: 0, inFence: false },
            { command: "docker run \\\n  nginx", lineIndex: 2, endLineIndex: 3, inFence: false },
            { command: "kubectl get pods", lineIndex: 4, endLineIndex: 4, inFence: false },
        ]);
    });
});

describe("commandsToCopyText", () => {
    it("joins commands with newlines", () => {
        const results = extractCommands(["$ kubectl get pods", "```bash", "ssh user@host", "```"]);
        expect(commandsToCopyText(results)).toBe("kubectl get pods\nssh user@host");
    });
});
