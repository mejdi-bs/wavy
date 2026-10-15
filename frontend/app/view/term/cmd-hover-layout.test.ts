import { describe, expect, it } from "vitest";

import { scanCommands } from "./cmd-extract";
import { findHoveredOccurrence, readViewportText } from "./cmd-hover-layout";

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
