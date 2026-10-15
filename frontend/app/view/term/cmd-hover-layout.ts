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
};

export type HoverBox = {
    command: string;
    left: number;
    top: number;
    width: number;
    height: number;
    rowHeight: number;
    screenRight: number;
};

export function readViewportText(buffer: TermTypes.IBuffer, viewportY: number, rows: number): ViewportText {
    const start = Math.max(0, viewportY - ContextRows);
    const end = Math.min(buffer.length, viewportY + rows + ContextRows);
    const text: ViewportText = { lines: [], startRows: [], rowCounts: [] };
    for (let row = start; row < end; row++) {
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
            text.lines[last] += lineText;
            text.rowCounts[last]++;
            continue;
        }
        text.lines.push(lineText);
        text.startRows.push(row);
        text.rowCounts.push(1);
    }
    return text;
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
