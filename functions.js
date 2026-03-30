/**
 * functions.js - 音樂小學堂 純函數模組
 *
 * 包含所有可測試的純函數與遊戲資料結構。
 * 此模組不依賴 DOM 或 Web Audio，可用於 Node.js / Jest 環境。
 *
 * game.js 會引用這些函數，tests/game.test.js 也直接 import 此模組。
 * 兩者共享同一份實作，確保測試覆蓋的是真實遊戲邏輯。
 */

'use strict';

// ========== 音符資料 ==========
const notes = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
const noteNames = { Do: 'C', Re: 'D', Mi: 'E', Fa: 'F', Sol: 'G', La: 'A', Si: 'B' };

// 音符頻率（A4 = 440Hz，C4 = 261.63Hz，十二平均律）
const noteFreqs = {
    Do: 261.63, Re: 293.66, Mi: 329.63, Fa: 349.23, Sol: 392.00, La: 440.00, Si: 493.88,
    // 黑鍵（♯ = 前一個白鍵 × 2^(1/12)）
    'Do♯': 277.18, 'Re♯': 311.13, 'Fa♯': 369.99, 'Sol♯': 415.30, 'La♯': 466.16,
};

// ========== 和弦資料 ==========
const chords = [
    { name: 'C大和弦', notes: ['Do', 'Mi', 'Sol'], symbol: 'C' },
    { name: 'G大和弦', notes: ['Sol', 'Si', 'Re'], symbol: 'G' },
    { name: 'F大和弦', notes: ['Fa', 'La', 'Do'], symbol: 'F' },
    { name: 'Dm和弦', notes: ['Re', 'Fa', 'La'], symbol: 'Dm' },
    { name: 'Am和弦', notes: ['La', 'Do', 'Mi'], symbol: 'Am' },
    { name: 'Em和弦', notes: ['Mi', 'Sol', 'Si'], symbol: 'Em' },
    { name: 'G7和弦', notes: ['Sol', 'Si', 'Re', 'Fa'], symbol: 'G7' },
];

// ========== 節奏資料 ==========
const rhythms = [
    { name: '四分音符', beats: 1, symbol: '♩', duration: 0.5 },
    { name: '二分音符', beats: 2, symbol: '𝅗𝅥', duration: 1.0 },
    { name: '全音符', beats: 4, symbol: '𝅝', duration: 2.0 },
    { name: '八分音符', beats: 0.5, symbol: '♪', duration: 0.25 },
];

// ========== 純函數 ==========

/**
 * Fisher-Yates 洗牌算法（公平隨機）
 * @param {Array} array - 要洗牌的陣列
 * @returns {Array} 洗牌後的新陣列（不修改原陣列）
 */
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * HTML 轉義（XSS 防護）
 * @param {*} text - 要轉義的文字
 * @returns {string} 轉義後的安全字串
 */
const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const HTML_ESCAPE_REGEX = /[&<>"']/g;

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(HTML_ESCAPE_REGEX, char => HTML_ESCAPE_MAP[char]);
}

/**
 * 格式化遊戲時長為可讀格式
 * @param {number|null|undefined} seconds - 秒數
 * @returns {string} 格式化後的字串
 */
function formatPlayTime(seconds) {
    if (!seconds || seconds < 0) seconds = 0;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) return `${hours}小時${minutes}分`;
    if (minutes > 0) return `${minutes}分${secs}秒`;
    return `${secs}秒`;
}

/**
 * 檢查是否為 localStorage 配額超限錯誤
 * @param {*} error - 錯誤物件
 * @returns {boolean}
 */
function isQuotaExceededError(error) {
    return (
        error instanceof DOMException &&
        (error.code === 22 ||
            error.code === 1014 ||
            error.name === 'QuotaExceededError' ||
            error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
    );
}

/**
 * Debounce 函數
 * @param {Function} func - 要 debounce 的函數
 * @param {number} wait - 等待毫秒數
 * @param {{leading?:boolean, trailing?:boolean}} options
 * @returns {Function}
 */
function debounce(func, wait, options = { leading: true, trailing: true }) {
    let timeout;
    let lastArgs = null;
    let lastThis = null;
    let result;
    const leading = options.leading;
    const trailing = options.trailing;

    return function executedFunction(...args) {
        const isFirstCall = timeout === undefined;
        lastArgs = args;
        lastThis = this;

        if (timeout) clearTimeout(timeout);

        if (leading && isFirstCall) {
            result = func.apply(this, args);
        }

        if (trailing) {
            timeout = setTimeout(() => {
                timeout = undefined;
                if (lastArgs) result = func.apply(lastThis, lastArgs);
            }, wait);
        }

        return result;
    };
}

/**
 * 安全清理 AudioContext 節點（防記憶體洩漏）
 * @param {...AudioNode|null} nodes
 */
function cleanupAudioNodes(...nodes) {
    nodes.forEach(node => {
        if (node && typeof node.disconnect === 'function') {
            try { node.disconnect(); } catch (_) { /* 靜默 */ }
        }
    });
}

// ========== 驗證輔助函數（供測試使用） ==========

/** 驗證音符頻率資料完整性 */
function isValidNoteFrequencies() {
    return ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'].every(
        note => typeof noteFreqs[note] === 'number' && noteFreqs[note] > 0
    );
}

/** 驗證和弦資料完整性 */
function isValidChords() {
    return chords.every(chord => {
        const hasValidName = typeof chord.name === 'string' && chord.name.length > 0;
        const hasValidNotes = Array.isArray(chord.notes) && chord.notes.length >= 3;
        const allNotesValid = chord.notes.every(note => noteFreqs.hasOwnProperty(note));
        const hasSymbol = typeof chord.symbol === 'string';
        return hasValidName && hasValidNotes && allNotesValid && hasSymbol;
    });
}

/** 驗證節奏資料完整性 */
function isValidRhythms() {
    return rhythms.every(rhythm => {
        const hasValidName = typeof rhythm.name === 'string' && rhythm.name.length > 0;
        const hasValidBeats = typeof rhythm.beats === 'number' && rhythm.beats > 0;
        const hasValidSymbol = typeof rhythm.symbol === 'string' && rhythm.symbol.length > 0;
        return hasValidName && hasValidBeats && hasValidSymbol;
    });
}

// ========== CommonJS 匯出 ==========
module.exports = {
    notes, noteNames, noteFreqs, chords, rhythms,
    shuffleArray, escapeHtml, formatPlayTime,
    isQuotaExceededError, debounce, cleanupAudioNodes,
    isValidNoteFrequencies, isValidChords, isValidRhythms,
    HTML_ESCAPE_MAP, HTML_ESCAPE_REGEX,
};
