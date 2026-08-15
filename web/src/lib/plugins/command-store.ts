"use client";

/** Commands published by the single running plugin host, so the settings tab
 *  can list them without booting a second host. */

import { create } from "zustand";

import type { PluginCommand } from "./types";

interface PluginCommandState {
  commands: PluginCommand[];
  setCommands: (commands: PluginCommand[]) => void;
}

export const usePluginCommandStore = create<PluginCommandState>((set) => ({
  commands: [],
  setCommands: (commands) => set({ commands }),
}));
