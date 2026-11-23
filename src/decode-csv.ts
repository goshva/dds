// Декодер CSV из windows-1251 (ручная таблица) + нормализация
export {};

async function decodeCsv() {
  const bytes = await Bun.file("C:/Users/Василиса/Documents/2_5190795335328377737 (1).csv").bytes();
  const map: Record<number, string> = {};
  for (let i = 0; i < 32; i++) map[192 + i] = String.fromCharCode(1040 + i); // А..Я
  for (let i = 0; i < 32; i++) map[224 + i] = String.fromCharCode(1072 + i); // а..я
  const extra: Record<number, string> = {
    132: "„", 133: "…", 147: "\u201C", 148: "\u201D", 150: "\u2013", 151: "\u2014", 145: '\u2018', 146: '\u2019',
    160: " ", 168: "Ё", 184: "ё", 171: "«", 187: "»", 166: "¦", 167: "§", 176: "°", 177: "±",
    183: "·", 185: "№", 130: "‚", 134: "†", 135: "‡", 136: "€", 137: "‰", 139: "‹", 155: "›",
    156: "œ", 140: "Œ", 154: "š", 138: "Š", 159: "Ÿ", 152: "˜", 153: "™", 158: "ž", 142: "Ž",
    141: "Ћ", 157: "ћ", 143: "Џ", 128: "Ђ", 129: "ѓ", 149: "•", 161: "Ў", 162: "ў",
    163: "Ј", 164: "¤", 165: "Ґ", 169: "©", 170: "Є", 172: "¬", 173: "\u00AD", 174: "®", 175: "Ї",
    178: "І", 179: "і", 180: "ґ", 181: "µ", 182: "¶", 186: "є", 188: "ј", 189: "ї", 190: "љ", 191: "њ",
  };
  Object.assign(map, extra);
  let s = "";
  for (const b of bytes) s += b < 128 ? String.fromCharCode(b) : (map[b] ?? `?${b}?`);
  await Bun.write("output/op_plan_decoded.csv", s);
  console.log(s.slice(0, 800));
}
await decodeCsv();
