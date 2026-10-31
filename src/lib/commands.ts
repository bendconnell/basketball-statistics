import type { Player, StatisticKey, StatisticsConfiguration } from "../types";

type Side = "offense" | "defense";

interface Command {
  label: string;
  aliases: string[];
  side?: Side;
  player?: boolean;
  shot?: boolean;
}

const commands: Command[] = [
  { label: "Assist", aliases: ["assist", "assisted", "assists"], side: "offense", player: true },
  { label: "Steal", aliases: ["steal", "stole", "steals"], side: "defense", player: true },
  { label: "Defensive Rebound", aliases: ["defensive rebound", "defense rebound", "defence rebound", "def rebound", "d rebound", "d reb", "def reb"], side: "defense", player: true },
  { label: "Offensive Rebound", aliases: ["offensive rebound", "offense rebound", "offence rebound", "off rebound", "o rebound", "o reb", "off reb"], side: "offense", player: true },
  { label: "Opposition Rebound", aliases: ["opposition rebound", "opp rebound", "opp reb", "opponent rebound"], side: "defense" },
  { label: "Opposition Miss", aliases: ["opposition miss", "opp miss", "opponent miss", "opposition missed", "opp missed"], side: "defense", shot: true },
  { label: "Opposition Score", aliases: ["opposition score", "opposition scored", "opp score", "opp scored", "opponent score", "opponent scored"], side: "defense", shot: true },
  { label: "Block", aliases: ["block", "blocked", "blocks"], side: "defense", player: true },
  { label: "Foul", aliases: ["foul", "fouled", "fouls"], side: "defense", player: true },
  { label: "Turnover", aliases: ["turnover", "turn over", "turnovers"], side: "offense", player: true },
  { label: "Score", aliases: ["scored", "score", "made", "made basket", "basket"], side: "offense", player: true, shot: true },
  { label: "Miss", aliases: ["miss", "missed", "missed basket"], side: "offense", player: true, shot: true },
  { label: "Help", aliases: ["help", "commands"] }
];

function commandsForSide(side: Side): Command[] {
  if (side !== "defense") return commands;
  return commands
    .filter((command) => command.label !== "Score" && command.label !== "Miss")
    .map((command) => {
      if (command.label === "Opposition Score") {
        return { ...command, aliases: [...command.aliases, "score", "scored"] };
      }
      if (command.label === "Opposition Miss") {
        return { ...command, aliases: [...command.aliases, "miss", "missed"] };
      }
      return command;
    });
}

const spokenNumbers: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90
};

function normalize(input: string): string {
  return input.toLowerCase()
    .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[ -]+(one|two|three|four|five|six|seven|eight|nine)\b/g,
      (_, tens: string, units: string) => String(spokenNumbers[tens] + spokenNumbers[units]))
    .replace(/\b[a-z]+\b/g, (word) => word in spokenNumbers ? String(spokenNumbers[word]) : word)
    .replace(/\b(by|the|player|number|jersey|for|a|please|points?|shot|from)\b/g, " ")
    .replace(/#/g, "")
    .replace(/\s+/g, " ").trim();
}

function distance(left: string, right: string): number {
  let row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i += 1) {
    const next = [i + 1];
    for (let j = 0; j < right.length; j += 1) {
      next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (left[i] === right[j] ? 0 : 1)));
    }
    row = next;
  }
  return row[right.length];
}

function matchScore(phrase: string, command: Command, partial: boolean): number {
  return Math.min(...command.aliases.map((alias) => {
    if (phrase === alias) return 0;
    if (partial && phrase && alias.startsWith(phrase)) return 0.1;
    if (partial && phrase && alias.includes(phrase)) return 0.2;
    const edits = distance(phrase, alias);
    // Short abbreviations must match exactly; longer phrases tolerate small typos.
    const allowance = alias.length < 4 ? 0 : alias.length < 9 ? 1 : 2;
    return edits <= allowance ? 1 + edits / Math.max(alias.length, phrase.length) : Infinity;
  }));
}

export function parseCommand(input: string, side: Side = "offense"): { command: Command; numbers: number[]; canonical: string } | null {
  const text = normalize(input);
  // Never reinterpret signed, fractional, or malformed numbers as jersey numbers.
  if (/[^a-z0-9\s]/.test(text)) return null;
  const phrase = text.replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim();
  const ranked = commandsForSide(side).map((command) => ({ command, score: matchScore(phrase, command, false) }))
    .filter(({ score }) => Number.isFinite(score)).sort((a, b) => a.score - b.score);
  if (!ranked.length || (ranked[1] && Math.abs(ranked[0].score - ranked[1].score) < 0.05)) return null;
  const command = ranked[0].command;
  const numbers = (text.match(/\b\d+\b/g) ?? []).map(Number);
  const maxNumbers = Number(Boolean(command.player)) + Number(Boolean(command.shot));
  if (numbers.length > maxNumbers) return null;
  return { command, numbers, canonical: [command.label.toLowerCase(), ...numbers].join(" ") };
}

export function spaceAfterCompletedPoints(input: string, previousInput: string, side: Side): string {
  if (input.length <= previousInput.length || !input.startsWith(previousInput) || /\s$/.test(input)) return input;
  const parsed = parseCommand(input, side);
  if (parsed?.command.player && parsed.command.shot && parsed.numbers.length === 1
    && [1, 2, 3].includes(parsed.numbers[0])) {
    return `${input} `;
  }
  return input;
}

export interface CommandSuggestion {
  value: string;
  label: string;
  detail: string;
  submit: boolean;
}

export function statisticForCommand(label: string): StatisticKey | undefined {
  const keys: Record<string, StatisticKey> = {
    Assist: "assist", Steal: "steal", "Defensive Rebound": "defensive_rebound",
    "Offensive Rebound": "offensive_rebound", "Opposition Rebound": "opposition_rebound",
    "Opposition Miss": "opposition_miss", "Opposition Score": "opp_score",
    Block: "block", Foul: "foul", Turnover: "turnover", Score: "shot_made", Miss: "shot_miss"
  };
  return keys[label];
}

export function suggestCommands(input: string, players: Player[], side: Side, statistics?: StatisticsConfiguration): CommandSuggestion[] {
  const text = normalize(input);
  if (/[^a-z0-9\s]/.test(text)) return [];
  const phrase = text.replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim();
  const numbers = text.match(/\b\d+\b/g) ?? [];
  const ranked = commandsForSide(side).filter((command) => !command.side || command.side === side)
    .filter((command) => {
      const key = statisticForCommand(command.label);
      return !key || statistics?.[side][key] !== false;
    })
    .map((command) => ({ command, score: phrase ? matchScore(phrase, command, true) : 0 }))
    .filter(({ score }) => Number.isFinite(score)).sort((a, b) => a.score - b.score);
  const displayLabel = (command: Command) => side === "defense" && command.shot && !command.player
    ? command.label.replace("Opposition ", "") : command.label;
  const exact = ranked.find(({ command }) => command.aliases.includes(phrase));
  // A trailing space commits the previous token. Until then, suggest only the command name.
  const enteringArguments = numbers.length > 0 || /\s$/.test(input)
    || Boolean(exact?.command.player && !exact.command.shot);
  if (!exact || !enteringArguments) {
    if (numbers.length) return [];
    return ranked.map(({ command }) => {
      const label = displayLabel(command);
      const hasArguments = Boolean(command.player || command.shot);
      return {
        value: label + (hasArguments ? " " : ""),
        label,
        detail: command.shot
          ? (command.player ? "Next: points (1, 2, 3), then jersey number" : "(Opposition) · next: points (1, 2, 3)")
          : command.player ? "Next: jersey number" : "Submit command",
        submit: !hasArguments
      };
    });
  }

  const command = exact.command;
  const label = displayLabel(command);
  const trailingSpace = /\s$/.test(input);
  if (command.shot) {
    const pointsCommitted = numbers.length >= 2 || (numbers.length === 1
      && (trailingSpace || ["1", "2", "3"].includes(numbers[0] ?? "")));
    if (!pointsCommitted || !command.player) {
      if (numbers.length > 1) return [];
      return [1, 2, 3].filter((points) => !numbers[0] || String(points).startsWith(numbers[0])).map((points) => ({
        value: `${label} ${points}${command.player ? " " : ""}`,
        label: String(points),
        detail: command.player ? `${points} points · next: jersey number` : `${points} points (Opposition) · submit`,
        submit: !command.player
      }));
    }
    if (!["1", "2", "3"].includes(numbers[0] ?? "")) return [];
  }

  if (command.player) {
    const jerseyToken = numbers[command.shot ? 1 : 0];
    const maxNumbers = command.shot ? 2 : 1;
    if (numbers.length > maxNumbers) return [];
    return players.filter((player) => Number.isFinite(player.number)
      && (!jerseyToken || String(player.number).startsWith(jerseyToken)))
      .slice(0, 8).map((player) => ({
        value: `${label} ${command.shot ? `${numbers[0]} ` : ""}${player.number}`,
        label: `#${player.number}`,
        detail: `${player.name} · submit`,
        submit: true
      }));
  }
  return [];
}