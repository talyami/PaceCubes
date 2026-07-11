export type Lang = "en" | "zh-CN";

const STRINGS = {
  intro: { en: "Count as fast as you can!", "zh-CN": "请用最快的速度来数。" },
  remember: { en: "Remember!", "zh-CN": "请记住" },
  question: { en: "How many cubes?", "zh-CN": "箱子的数量是？" },
  plusOne: { en: "+1", "zh-CN": "+1" },
  lock: { en: "LOCK IN!", "zh-CN": "结束!" },
  locked: { en: "Locked", "zh-CN": "已锁定" },
  theEnd: { en: "Finished!", "zh-CN": "结束" },
  winner: { en: "{name} wins!", "zh-CN": "{name} 获胜!" },
  draw: { en: "It's a draw!", "zh-CN": "平局!" },
  waiting: { en: "Waiting for players…", "zh-CN": "等待玩家…" },
  ready: { en: "Ready", "zh-CN": "准备" },
  start: { en: "Start game", "zh-CN": "开始游戏" },
  roomCode: { en: "Room code", "zh-CN": "房间号" },
  join: { en: "Join", "zh-CN": "加入" },
  create: { en: "Create room", "zh-CN": "创建房间" },
  practice: { en: "Practice solo", "zh-CN": "单人练习" },
  rematch: { en: "Rematch", "zh-CN": "再来一局" },
  exact: { en: "Exact! +3", "zh-CN": "完全正确! +3" },
  closest: { en: "Closest +1", "zh-CN": "最接近 +1" },
  disconnected: { en: "{name} disconnected", "zh-CN": "{name} 已断线" },
  name: { en: "Nickname", "zh-CN": "昵称" },
  copyLink: { en: "Copy link", "zh-CN": "复制链接" },
  newRoom: { en: "New room", "zh-CN": "新房间" },
  reconnecting: { en: "Reconnecting…", "zh-CN": "重新连接中…" },
  missedFlash: { en: "Missed it!", "zh-CN": "错过了!" },
  sureZero: { en: "Sure? You counted 0", "zh-CN": "确定是 0 吗？" },
  soundOn: { en: "Sound on", "zh-CN": "声音开" },
  soundOff: { en: "Sound off", "zh-CN": "声音关" },
} as const;

export type StringKey = keyof typeof STRINGS;

let lang: Lang = "en";

export function setLang(l: Lang): void {
  lang = l;
  try {
    localStorage.setItem("pacecubs.lang", l);
  } catch {
    /* ignore */
  }
}

export function getLang(): Lang {
  return lang;
}

export function loadLang(): Lang {
  try {
    const v = localStorage.getItem("pacecubs.lang");
    if (v === "zh-CN" || v === "en") lang = v;
  } catch {
    /* ignore */
  }
  return lang;
}

export function t(key: StringKey, vars?: Record<string, string>): string {
  let s: string = STRINGS[key][lang] ?? STRINGS[key].en;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, v);
    }
  }
  return s;
}
