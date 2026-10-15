// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { scanCommands, type CommandOccurrence } from "@/app/view/term/cmd-extract";
import {
    computeBox,
    findHoveredOccurrence,
    getScreenRect,
    readViewportText,
    type HoverBox,
    type ViewportText,
} from "@/app/view/term/cmd-hover-layout";
import type { TermWrap } from "@/app/view/term/termwrap";
import { getSettingsKeyAtom } from "@/store/global";
import { FloatingPortal } from "@floating-ui/react";
import * as jotai from "jotai";
import * as React from "react";

const HideDelayMs = 300;

interface TermCmdHoverProps {
    termWrap: TermWrap | null;
}

export const TermCmdHover = React.memo(function TermCmdHover({ termWrap }: TermCmdHoverProps) {
    const enabled = jotai.useAtomValue(getSettingsKeyAtom("term:cmdhover")) ?? true;
    const [box, setBox] = React.useState<HoverBox | null>(null);
    const hideTimerRef = React.useRef<number | null>(null);

    const cancelHide = React.useCallback(() => {
        if (hideTimerRef.current == null) {
            return;
        }
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
    }, []);

    const scheduleHide = React.useCallback(() => {
        cancelHide();
        hideTimerRef.current = window.setTimeout(() => {
            hideTimerRef.current = null;
            setBox(null);
        }, HideDelayMs);
    }, [cancelHide]);

    React.useEffect(() => {
        const terminal = termWrap?.terminal;
        const elem = terminal?.element;
        if (!enabled || terminal == null || elem == null) {
            return;
        }
        let cache: { text: ViewportText; occurrences: CommandOccurrence[] } = null;
        let lastMouse: { x: number; y: number } = null;
        let mouseDown = false;
        let rafId: number = null;

        const getScan = () => {
            if (cache == null) {
                const buffer = terminal.buffer.active;
                const text = readViewportText(buffer, buffer.viewportY, terminal.rows);
                cache = { text, occurrences: scanCommands(text.lines) };
            }
            return cache;
        };

        const update = () => {
            rafId = null;
            if (lastMouse == null || mouseDown) {
                return;
            }
            const screenRect = getScreenRect(terminal);
            if (screenRect == null) {
                scheduleHide();
                return;
            }
            const col = Math.floor(((lastMouse.x - screenRect.left) / screenRect.width) * terminal.cols);
            const viewRow = Math.floor(((lastMouse.y - screenRect.top) / screenRect.height) * terminal.rows);
            if (col < 0 || col >= terminal.cols || viewRow < 0 || viewRow >= terminal.rows) {
                scheduleHide();
                return;
            }
            const { text, occurrences } = getScan();
            const row = terminal.buffer.active.viewportY + viewRow;
            const occ = findHoveredOccurrence(text, occurrences, row, col, terminal.cols);
            const nextBox = occ == null ? null : computeBox(terminal, screenRect, text, occ);
            if (nextBox == null) {
                scheduleHide();
                return;
            }
            cancelHide();
            setBox(nextBox);
        };

        const requestUpdate = () => {
            if (rafId == null) {
                rafId = window.requestAnimationFrame(update);
            }
        };

        const invalidate = () => {
            cache = null;
            requestUpdate();
        };

        const handleMouseMove = (e: MouseEvent) => {
            lastMouse = { x: e.clientX, y: e.clientY };
            requestUpdate();
        };
        const handleMouseLeave = () => {
            lastMouse = null;
            scheduleHide();
        };
        // hide while selecting so the box never fights a drag selection
        const handleMouseDown = () => {
            mouseDown = true;
            cancelHide();
            setBox(null);
        };
        const handleMouseUp = () => {
            mouseDown = false;
        };

        elem.addEventListener("mousemove", handleMouseMove);
        elem.addEventListener("mouseleave", handleMouseLeave);
        elem.addEventListener("mousedown", handleMouseDown);
        elem.addEventListener("wheel", invalidate, { passive: true });
        window.addEventListener("mouseup", handleMouseUp);
        const disposables = [
            terminal.onWriteParsed(invalidate),
            terminal.onScroll(invalidate),
            terminal.onResize(invalidate),
            terminal.buffer.onBufferChange(invalidate),
        ];
        return () => {
            elem.removeEventListener("mousemove", handleMouseMove);
            elem.removeEventListener("mouseleave", handleMouseLeave);
            elem.removeEventListener("mousedown", handleMouseDown);
            elem.removeEventListener("wheel", invalidate);
            window.removeEventListener("mouseup", handleMouseUp);
            disposables.forEach((d) => d.dispose());
            if (rafId != null) {
                window.cancelAnimationFrame(rafId);
            }
            cancelHide();
            setBox(null);
        };
    }, [termWrap, enabled, scheduleHide, cancelHide]);

    if (box == null) {
        return null;
    }

    return (
        <FloatingPortal>
            <div
                className="pointer-events-none fixed z-50 rounded border border-accent/60 bg-accent/10"
                style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            >
                <div
                    className="pointer-events-auto absolute top-0 right-0.5 flex h-full max-h-6 items-center"
                    onMouseEnter={cancelHide}
                    onMouseLeave={scheduleHide}
                >
                    <CopyButton
                        title="Copy command"
                        onClick={() => {
                            navigator.clipboard.writeText(box.command).catch((err) => {
                                console.error("copy command failed", err);
                            });
                        }}
                    />
                </div>
            </div>
        </FloatingPortal>
    );
});

TermCmdHover.displayName = "TermCmdHover";
