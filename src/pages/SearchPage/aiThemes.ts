/** AI 寻书的阅读方向：id 为后端主题（prescriber inputType=theme） */
export interface AiTheme {
  id: string;
  /** 方向名 */
  word: string;
  /** 一句话描述 */
  riddle: string;
}

export const AI_THEMES: AiTheme[] = [
  { id: "relax", word: "松弛", riddle: "卸下肩上的重量" },
  { id: "direction", word: "迷途", riddle: "在雾里找一盏灯" },
  { id: "learn", word: "求知", riddle: "推开一扇新的门" },
  { id: "bedtime", word: "夜读", riddle: "给今夜一个好梦" },
  { id: "heal", word: "疗愈", riddle: "让心慢慢回温" },
  { id: "thinking", word: "破局", riddle: "看见更远的地方" },
];

/** 书单与历史里回显的「你说」 */
export function themeLabel(id: string): string {
  const t = AI_THEMES.find((x) => x.id === id);
  return t ? `「${t.word}」—— ${t.riddle}` : id;
}
