// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { IconButton } from "@/app/element/iconbutton";
import { globalStore } from "@/app/store/jotaiStore";
import type { DetectedCommand } from "@/app/view/term/cmd-extract";
import { commandsToCopyText, filterCommands } from "@/app/view/term/cmd-extract";
import type { TermViewModel } from "@/app/view/term/term-model";
import * as jotai from "jotai";
import * as React from "react";

type DetectedCommandsPanelProps = {
    model: TermViewModel;
};

// Label shown in the frame's top border: the program name, then the line
// count of a multi-line command and how many times it was seen.
function commandLabel(detected: DetectedCommand): string {
    const tokens = detected.command.trim().split(/\s+/);
    const program = tokens.find((t) => !/^\w+=/.test(t) && t != "sudo") ?? tokens[0] ?? "";
    const parts = [detected.command.startsWith("#!") ? "script" : program.split("/").pop()];
    const lineCount = detected.command.split("\n").length;
    if (lineCount > 1) {
        parts.push(`${lineCount} lines`);
    }
    if (detected.count > 1) {
        parts.push(`x${detected.count}`);
    }
    return parts.join(" · ");
}

const DetectedCommandRow = ({ detected }: { detected: DetectedCommand }) => {
    return (
        <div className="group relative mt-3 rounded-md border border-[#5c9ea0]/70 px-3 pt-3 pb-2 transition-colors hover:border-[#7cc4c6]">
            <span className="absolute -top-2 left-2.5 max-w-[70%] truncate bg-zinc-800 px-1.5 text-[11px] leading-4 font-semibold text-[#6fb3d9]">
                {commandLabel(detected)}
            </span>
            <div className="absolute -top-2.5 right-2 bg-zinc-800 px-0.5">
                <CopyButton
                    title="Copy"
                    onClick={() => {
                        navigator.clipboard.writeText(detected.command).catch((err) => {
                            console.error("copy command failed", err);
                        });
                    }}
                />
            </div>
            <div
                className="font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-primary line-clamp-6"
                title={detected.command}
            >
                {detected.command}
            </div>
        </div>
    );
};

const DetectedCommandsPanel = ({ model }: DetectedCommandsPanelProps) => {
    const isOpen = jotai.useAtomValue(model.showCmdExtractAtom);
    const [refreshCounter, setRefreshCounter] = React.useState(0);
    const [query, setQuery] = React.useState("");
    const panelRef = React.useRef<HTMLDivElement>(null);
    const searchRef = React.useRef<HTMLInputElement>(null);

    const commands: DetectedCommand[] = React.useMemo(() => {
        if (!isOpen) {
            return [];
        }
        return model.getDetectedCommands();
    }, [isOpen, refreshCounter]);
    // chronological order is kept for "Copy All" (it reads as a script); the
    // list itself shows the most recent command first
    const matching = React.useMemo(() => filterCommands(commands, query), [commands, query]);
    const newestFirst = React.useMemo(() => [...matching].reverse(), [matching]);

    // hand the keyboard back to the terminal, since the search box took it
    const close = React.useCallback(() => {
        globalStore.set(model.showCmdExtractAtom, false);
        model.giveFocus();
    }, [model]);

    React.useEffect(() => {
        if (!isOpen) {
            setQuery("");
            return;
        }
        searchRef.current?.focus();
        const handleMouseDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (panelRef.current?.contains(target)) {
                return;
            }
            // this block's header/context-menu opener handles its own toggle;
            // closing on its mousedown would let its click re-open the panel.
            // Buttons of other blocks must still close it.
            const ownBlock = target.closest?.(`[data-blockid="${model.blockId}"]`);
            if (ownBlock != null && target.closest?.(".wave-iconbutton")) {
                return;
            }
            close();
        };
        document.addEventListener("mousedown", handleMouseDown);
        return () => {
            document.removeEventListener("mousedown", handleMouseDown);
        };
    }, [isOpen, close]);

    // Escape is handled on the panel itself so it only closes this block's
    // panel; a first Escape clears the search
    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key == "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (query != "") {
                setQuery("");
                return;
            }
            close();
            return;
        }
        if (e.key == "Enter" && e.target == searchRef.current && newestFirst.length > 0) {
            e.preventDefault();
            navigator.clipboard.writeText(newestFirst[0].command).catch((err) => {
                console.error("copy command failed", err);
            });
            close();
        }
    };

    if (!isOpen) {
        return null;
    }

    const countLabel =
        commands.length == 0 ? "" : query != "" ? ` (${matching.length}/${commands.length})` : ` (${commands.length})`;

    return (
        <div
            ref={panelRef}
            onKeyDown={handleKeyDown}
            className="absolute top-1 right-1 z-30 flex max-h-[70%] w-[440px] max-w-[85%] flex-col rounded-md border border-border bg-zinc-800 text-foreground shadow-xl"
        >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <div className="flex-1 text-xs font-medium">Detected Commands{countLabel}</div>
                <IconButton
                    decl={{
                        elemtype: "iconbutton",
                        icon: "refresh",
                        title: "Refresh",
                        click: () => setRefreshCounter((c) => c + 1),
                    }}
                />
                <IconButton
                    decl={{
                        elemtype: "iconbutton",
                        icon: "xmark",
                        title: "Close",
                        click: close,
                    }}
                />
            </div>
            {commands.length > 0 && (
                <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
                    <i className="fa-sharp fa-solid fa-magnifying-glass text-[11px] text-muted-foreground" />
                    <input
                        ref={searchRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Filter commands… (Enter copies the first match)"
                        spellCheck={false}
                        className="min-w-0 flex-1 bg-transparent font-mono text-xs text-primary outline-none placeholder:text-muted-foreground"
                    />
                    {query != "" && (
                        <IconButton
                            decl={{
                                elemtype: "iconbutton",
                                icon: "xmark",
                                title: "Clear filter",
                                click: () => {
                                    setQuery("");
                                    searchRef.current?.focus();
                                },
                            }}
                        />
                    )}
                </div>
            )}
            {commands.length == 0 ? (
                <div className="px-3 py-4 text-xs text-muted-foreground">No commands detected in terminal output</div>
            ) : newestFirst.length == 0 ? (
                <div className="px-3 py-4 text-xs text-muted-foreground">No command matches “{query}”</div>
            ) : (
                <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2.5 pt-1 pb-2.5">
                    {newestFirst.map((detected) => (
                        <DetectedCommandRow key={detected.id} detected={detected} />
                    ))}
                </div>
            )}
            {matching.length > 0 && (
                <div className="border-t border-border px-3 py-2">
                    <button
                        className="bg-accent/80 text-primary rounded px-2 py-1 text-xs hover:bg-accent transition-colors cursor-pointer"
                        onClick={() => navigator.clipboard.writeText(commandsToCopyText(matching))}
                    >
                        {query != "" ? `Copy ${matching.length} matching` : "Copy All"}
                    </button>
                </div>
            )}
        </div>
    );
};

export { DetectedCommandsPanel };
