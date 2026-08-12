/** Formatting commands — Obsidian's ⌘B / ⌘I / ⌘K editor hotkeys. */

import type { StateCommand } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";

/** Toggle a symmetric inline wrapper (e.g. ** for bold) around each selection. */
function toggleWrap(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      const before = state.sliceDoc(Math.max(0, range.from - marker.length), range.from);
      const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + marker.length));

      if (before === marker && after === marker) {
        // unwrap
        return {
          changes: [
            { from: range.from - marker.length, to: range.from },
            { from: range.to, to: range.to + marker.length },
          ],
          range: EditorSelection.range(range.from - marker.length, range.to - marker.length),
        };
      }
      // wrap
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + marker.length, range.to + marker.length),
      };
    });
    dispatch(state.update(changes, { userEvent: "input.format" }));
    return true;
  };
}

export const toggleBold = toggleWrap("**");
export const toggleItalic = toggleWrap("*");
export const toggleHighlightCmd = toggleWrap("==");

/** ⌘K — wrap the selection as a markdown link [text](url), cursor in the url. */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const insert = `[${text}]()`;
    return {
      changes: { from: range.from, to: range.to, insert },
      // place the cursor between the () — ready to paste a URL
      range: EditorSelection.cursor(range.from + insert.length - 1),
    };
  });
  dispatch(state.update(changes, { userEvent: "input.format" }));
  return true;
};
