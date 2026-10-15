// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

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
import { cn, makeIconClass } from "@/util/util";
import { FloatingPortal } from "@floating-ui/react";
import * as jotai from "jotai";
import * as React from "react";

const HideDelayMs = 500;
const FadeOutMs = 150;
// While the wheel spins the box is hidden; it comes back once scrolling has
// been quiet for this long.
const ScrollSettleMs = 150;
// While a program streams output, rescan the screen at most this often:
// a scan reads every cell (for colors), too costly to repeat every frame.
const WriteRescanMs = 100;
const CopiedFeedbackMs = 1500;
// Slack around the box within which the pointer keeps it alive, so the trip
// from the command text to the copy button survives a slightly diagonal move.
const StickyPadPx = 8;
// The copy chip sits to the right of the box, or above it when the box ends
// near the terminal's right edge; its zone must count as inside.
const ChipZonePx = 130;
const ChipAboveZonePx = 30;

// Beside the box when the row is free; above it when text follows the
// command (the chip would hide it) or the terminal edge is too close.
function chipFitsRight(box: HoverBox): boolean {
    return !box.textAfter && box.left + box.width + ChipZonePx <= box.screenRight;
}

function isInsideBox(box: HoverBox, x: number, y: number): boolean {
    const right = chipFitsRight(box);
    return (
        x >= box.left - StickyPadPx &&
        x <= box.left + box.width + StickyPadPx + (right ? ChipZonePx : 0) &&
        y >= box.top - (right ? StickyPadPx : ChipAboveZonePx) &&
        y <= box.top + box.height + StickyPadPx
    );
}

const CmdCopyChip = ({ command, lang }: { command: string; lang?: string }) => {
    const what = lang == null ? "command" : lang == "" ? "code" : lang;
    const [copied, setCopied] = React.useState(false);
    const timerRef = React.useRef<number | null>(null);

    React.useEffect(() => {
        return () => {
            if (timerRef.current != null) {
                window.clearTimeout(timerRef.current);
            }
        };
    }, []);

    const handleClick = () => {
        navigator.clipboard.writeText(command).catch((err) => {
            console.error("copy command failed", err);
        });
        setCopied(true);
        if (timerRef.current != null) {
            window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            setCopied(false);
        }, CopiedFeedbackMs);
    };

    return (
        <button
            type="button"
            title={`Copy ${what}`}
            aria-label={`Copy ${what}`}
            onClick={handleClick}
            className={cn(
                "flex h-full max-h-[22px] min-h-4 shrink-0 cursor-pointer items-center gap-1 rounded border px-1.5 text-[11px] leading-none whitespace-nowrap select-none",
                "bg-modalbg shadow-md transition-colors",
                copied
                    ? "border-accent/70 text-accent"
                    : "border-border text-secondary hover:border-accent/70 hover:bg-hoverbg hover:text-primary"
            )}
        >
            <i className={makeIconClass(copied ? "check" : "copy", true)} />
            <span>{copied ? "Copied" : lang == null ? "Copy" : `Copy ${what}`}</span>
        </button>
    );
};

interface TermCmdHoverProps {
    termWrap: TermWrap | null;
}

export const TermCmdHover = React.memo(function TermCmdHover({ termWrap }: TermCmdHoverProps) {
    const enabled = jotai.useAtomValue(getSettingsKeyAtom("term:cmdhover")) ?? true;
    const [box, setBoxState] = React.useState<HoverBox | null>(null);
    const [fading, setFading] = React.useState(false);
    const boxRef = React.useRef<HoverBox | null>(null);
    const hideTimerRef = React.useRef<number | null>(null);
    const fadeTimerRef = React.useRef<number | null>(null);

    const setBox = React.useCallback((next: HoverBox | null) => {
        boxRef.current = next;
        setBoxState(next);
        setFading(false);
    }, []);

    const cancelHide = React.useCallback(() => {
        if (hideTimerRef.current != null) {
            window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
        if (fadeTimerRef.current != null) {
            window.clearTimeout(fadeTimerRef.current);
            fadeTimerRef.current = null;
            setFading(false);
        }
    }, []);

    // hide in two steps: fade the box out, then unmount it
    const scheduleHide = React.useCallback(() => {
        cancelHide();
        hideTimerRef.current = window.setTimeout(() => {
            hideTimerRef.current = null;
            setFading(true);
            fadeTimerRef.current = window.setTimeout(() => {
                fadeTimerRef.current = null;
                setBox(null);
            }, FadeOutMs);
        }, HideDelayMs);
    }, [cancelHide, setBox]);

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
        let scrollingUntil = 0;
        let settleTimer: number = null;
        let writeTimer: number = null;

        const getScan = () => {
            if (cache == null) {
                const buffer = terminal.buffer.active;
                const text = readViewportText(buffer, buffer.viewportY, terminal.rows);
                cache = {
                    text,
                    occurrences: scanCommands(text.lines, { cols: terminal.cols, styledRuns: text.styledRuns }),
                };
            }
            return cache;
        };

        // The box is drawn at fixed screen coordinates, so whenever the text
        // under it moves (scroll, TUI redraw, resize) it must be re-anchored to
        // where its command is now, or dropped if the command is gone.
        // Otherwise it floats over unrelated lines.
        const relocateCurrent = (screenRect: DOMRect): HoverBox | null => {
            const current = boxRef.current;
            if (current == null) {
                return null;
            }
            const { text, occurrences } = getScan();
            let best: HoverBox = null;
            for (const occ of occurrences) {
                if (occ.command != current.command) {
                    continue;
                }
                const candidate = computeBox(terminal, screenRect, text, occ);
                if (
                    candidate != null &&
                    (best == null || Math.abs(candidate.top - current.top) < Math.abs(best.top - current.top))
                ) {
                    best = candidate;
                }
            }
            if (best == null) {
                cancelHide();
                setBox(null);
                return null;
            }
            if (best.top != current.top || best.left != current.left || best.height != current.height) {
                setBox(best);
            }
            return best;
        };

        const update = () => {
            rafId = null;
            if (mouseDown || Date.now() < scrollingUntil) {
                return;
            }
            const screenRect = getScreenRect(terminal);
            if (screenRect == null) {
                scheduleHide();
                return;
            }
            // re-anchor even when the pointer rests on the copy chip, which
            // sits outside the terminal element
            const current = relocateCurrent(screenRect);
            if (lastMouse == null) {
                return;
            }
            const stickToCurrent = current != null && isInsideBox(current, lastMouse.x, lastMouse.y);
            const col = Math.floor(((lastMouse.x - screenRect.left) / screenRect.width) * terminal.cols);
            const viewRow = Math.floor(((lastMouse.y - screenRect.top) / screenRect.height) * terminal.rows);
            if (col < 0 || col >= terminal.cols || viewRow < 0 || viewRow >= terminal.rows) {
                if (!stickToCurrent) {
                    scheduleHide();
                }
                return;
            }
            const { text, occurrences } = getScan();
            const row = terminal.buffer.active.viewportY + viewRow;
            const occ = findHoveredOccurrence(text, occurrences, row, col, terminal.cols);
            const nextBox = occ == null ? null : computeBox(terminal, screenRect, text, occ);
            if (nextBox == null) {
                if (stickToCurrent) {
                    cancelHide();
                    return;
                }
                scheduleHide();
                return;
            }
            // on the way to the copy chip the pointer may brush the command
            // just above or below: keep the current one until it really leaves
            if (stickToCurrent && nextBox.command != current.command) {
                cancelHide();
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

        // trailing throttle: the last write in a burst is always picked up
        const invalidateAfterWrite = () => {
            if (writeTimer != null) {
                return;
            }
            writeTimer = window.setTimeout(() => {
                writeTimer = null;
                invalidate();
            }, WriteRescanMs);
        };

        const handleWheel = () => {
            cache = null;
            cancelHide();
            setBox(null);
            scrollingUntil = Date.now() + ScrollSettleMs;
            if (settleTimer != null) {
                window.clearTimeout(settleTimer);
            }
            settleTimer = window.setTimeout(() => {
                settleTimer = null;
                requestUpdate();
            }, ScrollSettleMs);
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
        elem.addEventListener("wheel", handleWheel, { passive: true });
        window.addEventListener("mouseup", handleMouseUp);
        const disposables = [
            terminal.onWriteParsed(invalidateAfterWrite),
            terminal.onScroll(invalidate),
            terminal.onResize(invalidate),
            terminal.buffer.onBufferChange(invalidate),
        ];
        return () => {
            elem.removeEventListener("mousemove", handleMouseMove);
            elem.removeEventListener("mouseleave", handleMouseLeave);
            elem.removeEventListener("mousedown", handleMouseDown);
            elem.removeEventListener("wheel", handleWheel);
            if (settleTimer != null) {
                window.clearTimeout(settleTimer);
            }
            if (writeTimer != null) {
                window.clearTimeout(writeTimer);
            }
            window.removeEventListener("mouseup", handleMouseUp);
            disposables.forEach((d) => d.dispose());
            if (rafId != null) {
                window.cancelAnimationFrame(rafId);
            }
            cancelHide();
            setBox(null);
        };
    }, [termWrap, enabled, scheduleHide, cancelHide, setBox]);

    if (box == null) {
        return null;
    }

    return (
        <FloatingPortal>
            <div
                className={cn(
                    "pointer-events-none fixed z-50 rounded-md bg-hoverbg/40 ring-1 ring-secondary/35 ring-inset",
                    "animate-[cmdhover-in_120ms_ease-out] transition-opacity duration-150",
                    fading && "opacity-0"
                )}
                style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            >
                <div
                    className={cn(
                        "pointer-events-auto absolute flex items-center py-px",
                        chipFitsRight(box) ? "top-0 left-full ml-1.5" : "right-0 bottom-full mb-1"
                    )}
                    style={{ height: box.rowHeight }}
                    onMouseEnter={cancelHide}
                    onMouseMove={cancelHide}
                    onMouseLeave={scheduleHide}
                >
                    <CmdCopyChip key={box.command} command={box.command} lang={box.blockLang} />
                </div>
            </div>
        </FloatingPortal>
    );
});

TermCmdHover.displayName = "TermCmdHover";
