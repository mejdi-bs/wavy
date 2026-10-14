// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { IconButton } from "@/app/element/iconbutton";
import { globalStore } from "@/app/store/jotaiStore";
import type { DetectedCommand } from "@/app/view/term/cmd-extract";
import { commandsToCopyText } from "@/app/view/term/cmd-extract";
import type { TermViewModel } from "@/app/view/term/term-model";
import * as jotai from "jotai";
import * as React from "react";

type DetectedCommandsPanelProps = {
    model: TermViewModel;
};

const DetectedCommandRow = ({ detected }: { detected: DetectedCommand }) => {
    return (
        <div className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-zinc-700/60">
            <div className="w-7 shrink-0 pt-0.5 text-right font-mono text-[10px] text-muted-foreground">
                {detected.count > 1 ? `x${detected.count}` : ""}
            </div>
            <div
                className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs leading-relaxed line-clamp-4"
                title={detected.command}
            >
                {detected.command}
            </div>
            <div className="shrink-0">
                <CopyButton title="Copy" onClick={() => navigator.clipboard.writeText(detected.command)} />
            </div>
        </div>
    );
};

const DetectedCommandsPanel = ({ model }: DetectedCommandsPanelProps) => {
    const isOpen = jotai.useAtomValue(model.showCmdExtractAtom);
    const [refreshCounter, setRefreshCounter] = React.useState(0);
    const panelRef = React.useRef<HTMLDivElement>(null);

    const commands: DetectedCommand[] = React.useMemo(() => {
        if (!isOpen) {
            return [];
        }
        return model.getDetectedCommands();
    }, [isOpen, refreshCounter]);

    React.useEffect(() => {
        if (!isOpen) {
            return;
        }
        const handleMouseDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (panelRef.current?.contains(target)) {
                return;
            }
            // the header/context-menu opener handles its own toggle; swallowing
            // its mousedown here would let the click handler re-open the panel
            if (target.closest?.(".wave-iconbutton")) {
                return;
            }
            globalStore.set(model.showCmdExtractAtom, false);
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key == "Escape") {
                globalStore.set(model.showCmdExtractAtom, false);
            }
        };
        document.addEventListener("mousedown", handleMouseDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleMouseDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen]);

    if (!isOpen) {
        return null;
    }

    return (
        <div
            ref={panelRef}
            className="absolute top-1 right-1 z-30 flex max-h-[70%] w-[440px] max-w-[85%] flex-col rounded-md border border-border bg-zinc-800 text-foreground shadow-xl"
        >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <div className="flex-1 text-xs font-medium">
                    Detected Commands{commands.length > 0 ? ` (${commands.length})` : ""}
                </div>
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
                        click: () => globalStore.set(model.showCmdExtractAtom, false),
                    }}
                />
            </div>
            {commands.length == 0 ? (
                <div className="px-3 py-4 text-xs text-muted-foreground">No commands detected in terminal output</div>
            ) : (
                <div className="flex-1 overflow-y-auto p-1">
                    {commands.map((detected) => (
                        <DetectedCommandRow key={detected.id} detected={detected} />
                    ))}
                </div>
            )}
            {commands.length > 0 && (
                <div className="border-t border-border px-3 py-2">
                    <button
                        className="bg-accent/80 text-primary rounded px-2 py-1 text-xs hover:bg-accent transition-colors cursor-pointer"
                        onClick={() => navigator.clipboard.writeText(commandsToCopyText(commands))}
                    >
                        Copy All
                    </button>
                </div>
            )}
        </div>
    );
};

export { DetectedCommandsPanel };
