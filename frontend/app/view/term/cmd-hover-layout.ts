// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CommandOccurrence } from "@/app/view/term/cmd-extract";
import type * as TermTypes from "@xterm/xterm";

// Rows scanned above/below the viewport so a command whose first line has
// scrolled just out of view is still recognized (normal buffer only; the
// alternate buffer has no scrollback).
const ContextRows = 40;
const BoxPadPx = 4;

export type ViewportText = {
    lines: string[];
    // first buffer row and row count of each logical (unwrapped) line
    startRows: number[];
    rowCounts: number[];
    // per logical line, [start, end) offsets of differently colored text;
    // computed on demand (it reads every cell of the line) and memoized
    styledRuns: (lineIndex: number) => Array<[number, number]>;
};

export type HoverBox = {
    command: string;
    left: number;
    top: number;
    width: number;
    height: number;
    rowHeight: number;
    screenRight: number;
    // more text follows the command on its row (an inline command in prose)
    textAfter: boolean;
    // set for a whole code block, e.g. "python"
    blockLang?: string;
};

// Runs of non-space text whose foreground differs from the row's dominant
// color, as string offsets matching translateToString. Wide glyphs occupy two
// cells but one string position, hence the width-0 skip.
function rowStyledRuns(line: TermTypes.IBufferLine, cell: TermTypes.IBufferCell): Array<[number, number]> {
    const glyphs: Array<{ start: number; end: number; key: string }> = [];
    const counts = new Map<string, number>();
    let offset = 0;
    for (let x = 0; x < line.length; x++) {
        if (line.getCell(x, cell) == null || cell.getWidth() == 0) {
            continue;
        }
        const chars = cell.getChars() || " ";
        if (chars.trim() != "") {
            const key = `${cell.getFgColorMode()}:${cell.getFgColor()}`;
            glyphs.push({ start: offset, end: offset + chars.length, key });
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        offset += chars.length;
    }
    if (counts.size < 2) {
        return [];
    }
    // prose is normally drawn in the default color (mode 0), even when the
    // highlighted code outnumbers it; only fall back to the most frequent
    // color when the TUI paints every glyph explicitly
    let baseKey = [...counts.keys()].find((k) => k.startsWith("0:")) ?? "";
    if (baseKey == "") {
        let baseCount = -1;
        for (const [key, count] of counts) {
            if (count > baseCount) {
                baseKey = key;
                baseCount = count;
            }
        }
    }
    const runs: Array<[number, number]> = [];
    let runKey: string = null;
    for (const g of glyphs) {
        if (g.key == baseKey) {
            runKey = null;
            continue;
        }
        if (runKey == g.key) {
            runs[runs.length - 1][1] = g.end;
            continue;
        }
        runKey = g.key;
        runs.push([g.start, g.end]);
    }
    return runs;
}

export function readBufferText(buffer: TermTypes.IBuffer, start: number, end: number): ViewportText {
    // each logical line remembers its rows and where each row starts in the
    // joined text, so color runs can be computed later for that line only
    const rowOffsets: Array<Array<[number, number]>> = [];
    const memo = new Map<number, Array<[number, number]>>();
    // test doubles may not implement cells; color runs are then empty
    const cell = typeof buffer.getNullCell == "function" ? buffer.getNullCell() : null;
    const styledRuns = (lineIndex: number): Array<[number, number]> => {
        if (cell == null || rowOffsets[lineIndex] == null) {
            return [];
        }
        let runs = memo.get(lineIndex);
        if (runs == null) {
            runs = [];
            for (const [row, shift] of rowOffsets[lineIndex]) {
                const line = buffer.getLine(row);
                if (line != null) {
                    runs.push(...rowStyledRuns(line, cell).map(([a, b]): [number, number] => [a + shift, b + shift]));
                }
            }
            memo.set(lineIndex, runs);
        }
        return runs;
    };
    const text: ViewportText = { lines: [], startRows: [], rowCounts: [], styledRuns };
    for (let row = Math.max(0, start); row < Math.min(buffer.length, end); row++) {
        const line = buffer.getLine(row);
        if (line == null) {
            continue;
        }
        // a row that wraps into the next one must keep its trailing spaces,
        // otherwise column offsets into the joined logical line drift
        const wrapsOn = buffer.getLine(row + 1)?.isWrapped ?? false;
        const lineText = line.translateToString(!wrapsOn);
        const last = text.lines.length - 1;
        if (line.isWrapped && last >= 0) {
            rowOffsets[last].push([row, text.lines[last].length]);
            text.lines[last] += lineText;
            text.rowCounts[last]++;
            continue;
        }
        rowOffsets.push([[row, 0]]);
        text.lines.push(lineText);
        text.startRows.push(row);
        text.rowCounts.push(1);
    }
    return text;
}

export function readViewportText(buffer: TermTypes.IBuffer, viewportY: number, rows: number): ViewportText {
    return readBufferText(buffer, viewportY - ContextRows, viewportY + rows + ContextRows);
}

function occurrenceRows(text: ViewportText, occ: CommandOccurrence): [number, number] {
    const first = text.startRows[occ.lineIndex];
    const last = text.startRows[occ.endLineIndex] + text.rowCounts[occ.endLineIndex] - 1;
    return [first, last];
}

// Columns are string offsets from translateToString, which matches cells for
// everything except wide (CJK/emoji) glyphs; close enough for a highlight box.
// TUIs pad their lines with real spaces up to the full width, which xterm
// does not trim, so trailing whitespace is dropped here.
function rowExtent(buffer: TermTypes.IBuffer, row: number): [number, number] | null {
    const rowText = (buffer.getLine(row)?.translateToString(true) ?? "").trimEnd();
    const startCol = rowText.length - rowText.trimStart().length;
    if (startCol >= rowText.length) {
        return null;
    }
    return [startCol, rowText.length];
}

export function findHoveredOccurrence(
    text: ViewportText,
    occurrences: CommandOccurrence[],
    row: number,
    col: number,
    cols: number
): CommandOccurrence | null {
    let fallback: CommandOccurrence = null;
    for (const occ of occurrences) {
        const [first, last] = occurrenceRows(text, occ);
        if (row < first || row > last) {
            continue;
        }
        if (occ.lineIndex != occ.endLineIndex) {
            return occ;
        }
        // several inline (backtick) commands can share a line: pick the one
        // under the mouse, falling back to the first one on the line
        const offset = (row - first) * cols + col;
        const idx = text.lines[occ.lineIndex].indexOf(occ.command);
        if (idx >= 0 && offset >= idx && offset < idx + occ.command.length) {
            return occ;
        }
        fallback ??= occ;
    }
    return fallback;
}

export function computeBox(
    terminal: TermTypes.Terminal,
    screenRect: DOMRect,
    text: ViewportText,
    occ: CommandOccurrence
): HoverBox | null {
    const buffer = terminal.buffer.active;
    const viewportY = buffer.viewportY;
    const cellW = screenRect.width / terminal.cols;
    const cellH = screenRect.height / terminal.rows;
    const [first, last] = occurrenceRows(text, occ);
    const visFirst = Math.max(first, viewportY);
    const visLast = Math.min(last, viewportY + terminal.rows - 1);
    if (visFirst > visLast) {
        return null;
    }
    let startCol = terminal.cols;
    let endCol = 0;
    const idx = first == last ? text.lines[occ.lineIndex].indexOf(occ.command) : -1;
    if (idx >= 0) {
        startCol = idx;
        endCol = idx + occ.command.length;
    } else {
        for (let row = visFirst; row <= visLast; row++) {
            const extent = rowExtent(buffer, row);
            if (extent == null) {
                continue;
            }
            startCol = Math.min(startCol, extent[0]);
            endCol = Math.max(endCol, extent[1]);
        }
    }
    if (endCol <= startCol) {
        return null;
    }
    const rowRest = idx >= 0 ? text.lines[occ.lineIndex].slice(endCol) : "";
    const left = Math.max(screenRect.left, screenRect.left + startCol * cellW - BoxPadPx);
    const right = Math.min(screenRect.right, screenRect.left + endCol * cellW + BoxPadPx);
    return {
        command: occ.command,
        left,
        top: screenRect.top + (visFirst - viewportY) * cellH,
        width: right - left,
        height: (visLast - visFirst + 1) * cellH,
        rowHeight: cellH,
        screenRight: screenRect.right,
        textAfter: rowRest.trim() != "",
        blockLang: occ.block?.lang,
    };
}

export function getScreenRect(terminal: TermTypes.Terminal): DOMRect | null {
    const screenEl = terminal.element?.querySelector(".xterm-screen");
    if (screenEl == null) {
        return null;
    }
    const rect = screenEl.getBoundingClientRect();
    if (rect.width == 0 || rect.height == 0) {
        return null;
    }
    return rect;
}
