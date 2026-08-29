import type { StudyWord } from './types';

// 缓存设备上的韩语 TTS 语音（voices 异步加载，首次可能为空，用 onvoiceschanged 兜底）
let koVoice: SpeechSynthesisVoice | null | undefined; // undefined = 还没加载过

function ensureKoVoice(): SpeechSynthesisVoice | null {
  if (koVoice !== undefined) return koVoice;
  koVoice = null;
  if ('speechSynthesis' in window) {
    const pick = () => {
      const vs = window.speechSynthesis.getVoices();
      koVoice = vs.find((v) => v.lang?.toLowerCase().startsWith('ko')) ?? null;
    };
    pick();
    if (!koVoice) window.speechSynthesis.onvoiceschanged = pick;
  }
  return koVoice;
}

/** 设备是否装了韩语 TTS 语音包（没有时自动退回站内剪辑音频） */
export function hasKoreanVoice(): boolean {
  return ensureKoVoice() !== null;
}

/**
 * TTS 朗读韩语。读完时回调 onend（用于"单词发音 → 视频/例句"链式播放）。
 * 设备无韩语语音包时不发声并返回 false。
 */
export function speakKorean(text: string, onend?: () => void): boolean {
  if (!('speechSynthesis' in window)) return false;
  const voice = ensureKoVoice();
  if (!voice) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  u.voice = voice;
  u.rate = 0.85;
  if (onend) u.onend = onend;
  window.speechSynthesis.speak(u);
  return true;
}

/** 停止一切 TTS 朗读（切词/手动操作时打断） */
export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

// 当前正在播放的站内音频（模块级唯一），换播/停止时自动暂停上一个
let currentClip: HTMLAudioElement | null = null;

/** 播放站内音频（单词原声/整句剪辑）；自动暂停上一个，返回 Audio 元素；onend 用于链式播放 */
export function playClip(url: string, onend?: () => void): HTMLAudioElement {
  currentClip?.pause();
  const a = new Audio(url);
  if (onend) a.onended = onend;
  a.play().catch(() => {});
  currentClip = a;
  return a;
}

/** 停止一切发声：TTS + 站内音频（翻题/切词/关弹窗时调用） */
export function stopAllAudio() {
  stopSpeaking();
  currentClip?.pause();
  currentClip = null;
}

/**
 * 播放单词本身的发音（优先级）：
 * ① 站内单词原声（Word.audioUrl，全词表生成，所有设备一致）
 * ② 设备 TTS 单读单词（设备装了韩语语音包时）
 * ③ 站内整句剪辑兜底（含目标词的视频/歌词原声）
 */
export function playWordAudio(word: StudyWord): void {
  if (word.audioUrl) {
    playClip(word.audioUrl);
    return;
  }
  if (speakKorean(word.hangul)) return;
  const m = word.mediaMappings?.find((x) => x.audioUrl);
  if (m?.audioUrl) playClip(m.audioUrl);
}
