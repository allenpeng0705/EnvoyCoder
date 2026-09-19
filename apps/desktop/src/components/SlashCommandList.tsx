/**
 * The composer's command list — the agent's own `/` commands, nothing we invented.
 */

import type { JSX } from "react";

import type { SlashCommand } from "../composer/slash-commands.js";

export function SlashCommandList(props: {
  commands: readonly SlashCommand[];
  active: number;
  label: string;
  onPick: (command: SlashCommand) => void;
}): JSX.Element {
  return (
    <ul className="composer__commands" role="listbox" aria-label={props.label}>
      {props.commands.map((command, index) => (
        <li key={command.name}>
          <button
            type="button"
            role="option"
            aria-selected={index === props.active}
            className={index === props.active ? "composer__command composer__command--active" : "composer__command"}
            onMouseDown={(event) => {
              // Keep the textarea focused; a click that blurs it also swallows the next keystroke.
              event.preventDefault();
              props.onPick(command);
            }}
          >
            <span className="composer__command-name">/{command.name}</span>
            {command.argumentHint !== undefined ? (
              <span className="composer__command-hint">{command.argumentHint}</span>
            ) : null}
            {command.description !== "" ? (
              <span className="composer__command-detail">{command.description}</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
