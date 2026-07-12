const STRINGS = {
  intro: "Count as fast as you can!",
  challenge: "See it. Count it. Lock it.",
  home: "Home",
  lobby: "Lobby",
  game: "Game",
  results: "Results",
  getReady: "Get ready",
  remember: "Remember!",
  question: "How many cubes?",
  plusOne: "+1",
  minusOne: "-1",
  lock: "LOCK IN!",
  locked: "Locked",
  endRound: "End round",
  theEnd: "Finished!",
  winner: "{name} wins!",
  draw: "It's a draw!",
  waiting: "Waiting for players…",
  waitingHint: "Share the code, then mark yourself ready.",
  ready: "Ready",
  notReady: "READY?",
  start: "Start game",
  host: "Host",
  you: "You",
  offline: "Offline",
  roomCode: "Room code",
  join: "Join",
  create: "Create room",
  practice: "Practice solo",
  rematch: "Rematch",
  exact: "Exact! +3",
  closest: "Closest +1",
  disconnected: "{name} disconnected",
  name: "Nickname",
  copyLink: "Copy link",
  copied: "Link copied",
  newRoom: "New room",
  reconnecting: "Reconnecting…",
  reconnected: "Back online",
  missedFlash: "Flash complete",
  sureZero: "Sure? You counted 0",
  soundOn: "Sound on",
  soundOff: "Sound off",
  howItWorks: "How it works",
  see: "See",
  count: "Count",
  commit: "Lock",
  yourCount: "Your count",
  opponents: "Other players",
  round: "Round",
  pressKey: "Space +1 · − key −1 · Enter lock",
  rank: "Rank",
  player: "Player",
  score: "Score",
  matchLedger: "Match ledger",
  level: "Level",
  level1: "Level 1 — Anime tiles",
  level2: "Level 2 — Cube stacks",
  levelLocked: "Level locked for this room",
} as const;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, vars?: Record<string, string>): string {
  let s: string = STRINGS[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, v);
    }
  }
  return s;
}
