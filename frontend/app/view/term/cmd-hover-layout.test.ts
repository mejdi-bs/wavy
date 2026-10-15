import { describe, expect, it } from "vitest";

import { scanCommands } from "./cmd-extract";
import { findHoveredOccurrence, readBufferText, readViewportText } from "./cmd-hover-layout";

type FakeRow = { text: string; wrapped?: boolean };

function fakeBuffer(rows: FakeRow[]): any {
    return {
        length: rows.length,
        getLine: (i: number) =>
            rows[i] == null
                ? undefined
                : {
                      isWrapped: rows[i].wrapped ?? false,
                      translateToString: (trimRight: boolean) => (trimRight ? rows[i].text.trimEnd() : rows[i].text),
                  },
    };
}

describe("term-cmdhover viewport mapping", () => {
    it("maps buffer rows to the command under the mouse", () => {
        const buffer = fakeBuffer([
            { text: "  # list pods" },
            { text: "  kubectl get pods -A" },
            { text: "" },
            { text: "  kubectl config get-contexts -o name | while read ctx; do" },
            { text: '    echo "$ctx"' },
            { text: "  done" },
        ]);
        const text = readViewportText(buffer, 0, 6);
        const occurrences = scanCommands(text.lines);
        expect(findHoveredOccurrence(text, occurrences, 0, 4, 80)).toBeNull();
        expect(findHoveredOccurrence(text, occurrences, 1, 4, 80)?.command).toBe("kubectl get pods -A");
        expect(findHoveredOccurrence(text, occurrences, 4, 4, 80)?.command).toContain("while read ctx; do");
        expect(findHoveredOccurrence(text, occurrences, 5, 2, 80)?.command).toContain("done");
    });

    it("treats wrapped rows as part of one logical line", () => {
        const buffer = fakeBuffer([{ text: "kubectl get pods --all-name" }, { text: "spaces -o wide", wrapped: true }]);
        const text = readViewportText(buffer, 0, 2);
        expect(text.lines).toEqual(["kubectl get pods --all-namespaces -o wide"]);
        expect(text.startRows).toEqual([0]);
        expect(text.rowCounts).toEqual([2]);
        const occurrences = scanCommands(text.lines);
        expect(findHoveredOccurrence(text, occurrences, 1, 3, 27)?.command).toBe(
            "kubectl get pods --all-namespaces -o wide"
        );
    });

    it("keeps the trailing space of a row that wraps so offsets stay aligned", () => {
        const buffer = fakeBuffer([{ text: "docker run " }, { text: "nginx", wrapped: true }]);
        const text = readViewportText(buffer, 0, 2);
        expect(text.lines).toEqual(["docker run nginx"]);
    });

    it("picks the inline command under the mouse when a line has several", () => {
        const buffer = fakeBuffer([{ text: "Run `kubectl get pods` then `helm list`" }]);
        const text = readViewportText(buffer, 0, 1);
        const occurrences = scanCommands(text.lines);
        expect(findHoveredOccurrence(text, occurrences, 0, 8, 80)?.command).toBe("kubectl get pods");
        expect(findHoveredOccurrence(text, occurrences, 0, 32, 80)?.command).toBe("helm list");
    });
});

type FakeCell = { ch: string; color: number };

function coloredBuffer(rows: FakeCell[][]): any {
    let current: FakeCell = null;
    const cell = {
        getWidth: () => 1,
        getChars: () => current.ch,
        getFgColorMode: () => (current.color == 0 ? 0 : 1),
        getFgColor: () => current.color,
    };
    return {
        length: rows.length,
        getNullCell: () => cell,
        getLine: (i: number) =>
            rows[i] == null
                ? undefined
                : {
                      isWrapped: false,
                      length: rows[i].length,
                      translateToString: () =>
                          rows[i]
                              .map((c) => c.ch)
                              .join("")
                              .trimEnd(),
                      getCell: (x: number) => {
                          current = rows[i][x];
                          return current == null ? undefined : cell;
                      },
                  },
    };
}

// builds a row from segments, each drawn in its own color (0 = default)
function row(...segments: Array<[string, number]>): FakeCell[] {
    return segments.flatMap(([text, color]) => [...text].map((ch) => ({ ch, color })));
}

describe("inline code rendered as colored text", () => {
    it("finds commands a TUI colored instead of wrapping in backticks", () => {
        const buffer = coloredBuffer([
            row(
                ["Lance ", 0],
                ["kubectl get pods -n prod", 6],
                [" puis ", 0],
                ["helm list -A", 6],
                [" pour vérifier.", 0]
            ),
        ]);
        const text = readBufferText(buffer, 0, 1);
        expect(text.styledRuns[0].map(([a, b]) => text.lines[0].slice(a, b))).toEqual([
            "kubectl get pods -n prod",
            "helm list -A",
        ]);
        const occurrences = scanCommands(text.lines, { styledRuns: text.styledRuns });
        expect(occurrences.map((o) => o.command)).toEqual(["kubectl get pods -n prod", "helm list -A"]);
        expect(findHoveredOccurrence(text, occurrences, 0, 38, 80)?.command).toBe("helm list -A");
    });

    it("ignores colored words and paths that are not commands", () => {
        const buffer = coloredBuffer([
            row(["Cela nécessite que ", 0], ["Metrics Server", 3], [" soit installé.", 0]),
            row(["J'ai modifié ", 0], ["~/projet/app.ts", 3], [" et ", 0], ["./install.sh", 3], [".", 0]),
            row(["Ouvre ", 0], ["htop", 3], [" pour voir.", 0]),
        ]);
        const text = readBufferText(buffer, 0, 3);
        expect(scanCommands(text.lines, { styledRuns: text.styledRuns }).map((o) => o.command)).toEqual(["htop"]);
    });

    it("does not split syntax-highlighted lines inside a fence", () => {
        const buffer = coloredBuffer([
            row(["```bash", 0]),
            row(["cat ", 0], ["<<EOF", 4], [" > config.yaml", 6]),
            row(["EOF", 4]),
            row(["```", 0]),
        ]);
        const text = readBufferText(buffer, 0, 4);
        const occurrences = scanCommands(text.lines, { styledRuns: text.styledRuns });
        expect(occurrences.map((o) => o.command)).toEqual(["cat <<EOF > config.yaml\nEOF"]);
    });
});
