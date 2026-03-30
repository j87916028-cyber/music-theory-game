/**
 * game.test.js - 音樂小學堂 單元測試
 *
 * 重要改進：這些測試直接 require functions.js 的匯出，
 * 而非複製函數邏輯。這確保測試覆蓋的是真實、可共用的遊戲實作。
 *
 * game.js 也應逐步改用 functions.js 的函數，實現程式碼單一來源（SSOT）。
 */

const {
    notes, noteNames, noteFreqs, chords, rhythms,
    shuffleArray, escapeHtml, formatPlayTime,
    isQuotaExceededError, debounce, cleanupAudioNodes,
    isValidNoteFrequencies, isValidChords, isValidRhythms,
} = require('../functions.js');

describe('functions.js 模組完整性', () => {
    test('functions.js 已正確匯出所有核心函數', () => {
        const requiredExports = [
            'shuffleArray', 'escapeHtml', 'isQuotaExceededError',
            'formatPlayTime', 'debounce', 'cleanupAudioNodes',
            'chords', 'rhythms', 'notes', 'noteNames', 'noteFreqs',
            'isValidNoteFrequencies', 'isValidChords', 'isValidRhythms',
        ];
        requiredExports.forEach(name => {
            expect(typeof exports[name] !== 'undefined' || typeof eval(name) !== 'undefined').toBe(true);
        });
    });
});

describe('Fisher-Yates 洗牌算法', () => {
    test('洗牌後陣列長度不變', () => {
        const original = [1, 2, 3, 4, 5];
        const shuffled = shuffleArray(original);
        expect(shuffled.length).toBe(original.length);
    });

    test('洗牌後包含所有原始元素', () => {
        const original = [1, 2, 3, 4, 5];
        const shuffled = shuffleArray(original);
        expect(shuffled.sort()).toEqual(original.sort());
    });

    test('洗牌不修改原始陣列', () => {
        const original = [1, 2, 3, 4, 5];
        const originalCopy = [...original];
        shuffleArray(original);
        expect(original).toEqual(originalCopy);
    });

    test('單元素陣列保持不變', () => {
        expect(shuffleArray([1])).toEqual([1]);
    });

    test('空陣列返回空陣列', () => {
        expect(shuffleArray([])).toEqual([]);
    });

    test('50次洗牌應產生多個不同結果（隨機性驗證）', () => {
        const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const results = new Set();
        for (let i = 0; i < 50; i++) {
            results.add(shuffleArray(original).join(','));
        }
        expect(results.size).toBeGreaterThan(1);
    });
});

describe('HTML 轉義函數 (XSS 防護)', () => {
    test('轉義 & 符號', () => {
        expect(escapeHtml('A & B')).toBe('A &amp; B');
    });

    test('轉義 < 和 > 符號', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
        expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    test('轉義雙引號', () => {
        expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    test('轉義單引號', () => {
        expect(escapeHtml("it's")).toBe('it&#39;s');
    });

    test('處理完整 XSS 攻擊向量', () => {
        const xssInput = '<script>alert("XSS")</script>';
        const escaped = escapeHtml(xssInput);
        expect(escaped).not.toContain('<script>');
        expect(escaped).not.toContain('</script>');
        expect(escaped).not.toContain('"XSS"');
    });

    test('處理 null 和 undefined', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });

    test('數字和空字串正常處理', () => {
        expect(escapeHtml(123)).toBe('123');
        expect(escapeHtml(0)).toBe('0');
        expect(escapeHtml('')).toBe('');
    });

    test('安全字串保持不變', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
    });
});

describe('遊戲時長格式化', () => {
    test('格式化秒數（小於1分鐘）', () => {
        expect(formatPlayTime(30)).toBe('30秒');
        expect(formatPlayTime(59)).toBe('59秒');
    });

    test('格式化分鐘和秒數', () => {
        expect(formatPlayTime(60)).toBe('1分0秒');
        expect(formatPlayTime(90)).toBe('1分30秒');
        expect(formatPlayTime(125)).toBe('2分5秒');
    });

    test('格式化小時、分鐘和秒數', () => {
        expect(formatPlayTime(3600)).toBe('1小時0分');
        expect(formatPlayTime(3661)).toBe('1小時1分');
        expect(formatPlayTime(7200)).toBe('2小時0分');
    });

    test('處理邊界值', () => {
        expect(formatPlayTime(0)).toBe('0秒');
        expect(formatPlayTime(-1)).toBe('0秒');
        expect(formatPlayTime(null)).toBe('0秒');
        expect(formatPlayTime(undefined)).toBe('0秒');
    });
});

describe('localStorage 配額錯誤檢測', () => {
    test('檢測 QuotaExceededError（依錯誤碼 22）', () => {
        const error = new DOMException('Quota exceeded', 'QuotaExceededError');
        expect(isQuotaExceededError(error)).toBe(true);
    });

    test('檢測 NS_ERROR_DOM_QUOTA_REACHED（Firefox）', () => {
        const error = new DOMException('Quota reached', 'NS_ERROR_DOM_QUOTA_REACHED');
        expect(isQuotaExceededError(error)).toBe(true);
    });

    test('依錯誤名稱檢測（常見於真實瀏覽器）', () => {
        const error = new DOMException('Storage quota exceeded', 'QuotaExceededError');
        expect(isQuotaExceededError(error)).toBe(true);
    });

    test('非配額錯誤返回 false', () => {
        expect(isQuotaExceededError(new Error('Network error'))).toBe(false);
        expect(isQuotaExceededError(new Error('Timeout'))).toBe(false);
    });

    test('null 和 undefined 返回 false', () => {
        expect(isQuotaExceededError(null)).toBe(false);
        expect(isQuotaExceededError(undefined)).toBe(false);
    });
});

describe('音符頻率資料驗證', () => {
    test('isValidNoteFrequencies 驗證通過', () => {
        expect(isValidNoteFrequencies()).toBe(true);
    });

    test('noteFreqs 包含 12 個音符（7白鍵 + 5黑鍵）', () => {
        expect(Object.keys(noteFreqs).length).toBe(12);
    });

    test('所有頻率值為正數', () => {
        Object.values(noteFreqs).forEach(freq => {
            expect(freq).toBeGreaterThan(0);
        });
    });

    test('白鍵頻率嚴格遞增', () => {
        const whiteKeyFreqs = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'].map(n => noteFreqs[n]);
        for (let i = 1; i < whiteKeyFreqs.length; i++) {
            expect(whiteKeyFreqs[i]).toBeGreaterThan(whiteKeyFreqs[i - 1]);
        }
    });

    test('黑鍵頻率符合十二平均律（相鄰白鍵之間）', () => {
        const ratio = Math.pow(2, 1 / 12);
        expect(noteFreqs['Do♯']).toBeCloseTo(noteFreqs['Do'] * ratio, 1);
        expect(noteFreqs['Re♯']).toBeCloseTo(noteFreqs['Re'] * ratio, 1);
        expect(noteFreqs['Fa♯']).toBeCloseTo(noteFreqs['Fa'] * ratio, 1);
        expect(noteFreqs['Sol♯']).toBeCloseTo(noteFreqs['Sol'] * ratio, 1);
        expect(noteFreqs['La♯']).toBeCloseTo(noteFreqs['La'] * ratio, 1);
    });

    test('白鍵頻率符合國際標準（A4 = 440Hz，C4 = 261.63Hz）', () => {
        expect(noteFreqs['Do']).toBeCloseTo(261.63, 2);
        expect(noteFreqs['Re']).toBeCloseTo(293.66, 2);
        expect(noteFreqs['Mi']).toBeCloseTo(329.63, 2);
        expect(noteFreqs['Fa']).toBeCloseTo(349.23, 2);
        expect(noteFreqs['Sol']).toBeCloseTo(392.00, 2);
        expect(noteFreqs['La']).toBeCloseTo(440.00, 2);
        expect(noteFreqs['Si']).toBeCloseTo(493.88, 2);
    });
});

describe('和弦資料驗證', () => {
    test('isValidChords 驗證通過', () => {
        expect(isValidChords()).toBe(true);
    });

    test('至少有 5 個和弦', () => {
        expect(chords.length).toBeGreaterThanOrEqual(5);
    });

    test('每個和弦至少有 3 個音符', () => {
        chords.forEach(chord => {
            expect(chord.notes.length).toBeGreaterThanOrEqual(3);
        });
    });

    test('所有和弦音符都是有效音符', () => {
        chords.forEach(chord => {
            chord.notes.forEach(note => {
                expect(noteFreqs).toHaveProperty(note);
            });
        });
    });

    test('和弦名稱唯一', () => {
        const names = chords.map(c => c.name);
        const uniqueNames = new Set(names);
        expect(uniqueNames.size).toBe(names.length);
    });
});

describe('Debounce 函數', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    test('trailing 模式：只在超時後執行一次', () => {
        const func = jest.fn();
        const debouncedFn = debounce(func, 100, { leading: false, trailing: true });
        debouncedFn('a'); debouncedFn('b'); debouncedFn('c');
        expect(func).not.toHaveBeenCalled();
        jest.advanceTimersByTime(100);
        expect(func).toHaveBeenCalledTimes(1);
        expect(func).toHaveBeenCalledWith('c');
    });

    test('leading 模式：立即執行', () => {
        const func = jest.fn();
        const debouncedFn = debounce(func, 100, { leading: true, trailing: false });
        debouncedFn('a');
        expect(func).toHaveBeenCalledTimes(1);
        expect(func).toHaveBeenCalledWith('a');
    });

    test('leading + trailing 模式：先立即執行，延遲後執行最後一次', () => {
        const func = jest.fn();
        const debouncedFn = debounce(func, 100, { leading: true, trailing: true });
        debouncedFn('a'); debouncedFn('b');
        expect(func).toHaveBeenCalledTimes(1);
        expect(func).toHaveBeenCalledWith('a');
        jest.advanceTimersByTime(100);
        expect(func).toHaveBeenCalledTimes(2);
        expect(func).toHaveBeenCalledWith('b');
    });

    test('保持 this 上下文', () => {
        const obj = {
            value: 0,
            increment: debounce(function(delta) {
                this.value += delta;
                return this.value;
            }, 100, { leading: true, trailing: true }),
        };
        obj.increment(5);
        expect(obj.value).toBe(5);
        obj.increment(3);
        jest.advanceTimersByTime(100);
        expect(obj.value).toBe(8);
    });

    test('超時前再次呼叫會重置計時器', () => {
        const func = jest.fn();
        const debouncedFn = debounce(func, 100, { leading: false, trailing: true });
        debouncedFn('a');
        jest.advanceTimersByTime(50);
        debouncedFn('b'); // 重置
        jest.advanceTimersByTime(50);
        expect(func).not.toHaveBeenCalled();
        jest.advanceTimersByTime(50);
        expect(func).toHaveBeenCalledTimes(1);
        expect(func).toHaveBeenCalledWith('b');
    });
});

describe('節奏資料驗證', () => {
    test('isValidRhythms 驗證通過', () => {
        expect(isValidRhythms()).toBe(true);
    });

    test('至少有 3 種節奏', () => {
        expect(rhythms.length).toBeGreaterThanOrEqual(3);
    });

    test('節奏符號唯一', () => {
        const symbols = rhythms.map(r => r.symbol);
        const uniqueSymbols = new Set(symbols);
        expect(uniqueSymbols.size).toBe(symbols.length);
    });
});

describe('cleanupAudioNodes 函數', () => {
    test('能安全處理 null 和 undefined（不死機）', () => {
        expect(() => cleanupAudioNodes(null, undefined)).not.toThrow();
    });

    test('能處理缺少 disconnect 方法的物件', () => {
        expect(() => cleanupAudioNodes({ foo: 'bar' })).not.toThrow();
    });

    test('有 disconnect 方法的節點才會呼叫', () => {
        let called = false;
        const node = { disconnect: () => { called = true; } };
        cleanupAudioNodes(node);
        expect(called).toBe(true);
    });

    test('混合參數：有效節點被呼叫，null 被跳過', () => {
        let called = false;
        cleanupAudioNodes(null, undefined, { disconnect: () => { called = true; } });
        expect(called).toBe(true);
    });
});

describe('遊戲資料完整性', () => {
    test('notes 包含 7 個基本音符', () => {
        expect(notes).toEqual(['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si']);
    });

    test('noteNames 將唱名映射至音名', () => {
        expect(noteNames).toEqual({ Do: 'C', Re: 'D', Mi: 'E', Fa: 'F', Sol: 'G', La: 'A', Si: 'B' });
    });

    test('chords 和 rhythms 為非空陣列', () => {
        expect(Array.isArray(chords)).toBe(true);
        expect(Array.isArray(rhythms)).toBe(true);
        expect(chords.length).toBeGreaterThan(0);
        expect(rhythms.length).toBeGreaterThan(0);
    });
});

describe('G7 和弦正確性（迴歸測試）', () => {
    test('G7 和弦的第七音為 F♯（Fa♯），非 F natural（Fa）', () => {
        const g7 = chords.find(c => c.symbol === 'G7');
        expect(g7).toBeDefined();
        // G7 = G, B, D, F♯ → 對應 solfège: Sol, Si, Re, Fa♯
        expect(g7.notes).toContain('Fa♯');       // Fa♯ = F♯ = 369.99 Hz
        expect(g7.notes).not.toContain('Fa');    // Fa = F natural = 349.23 Hz (錯誤)
        expect(g7.notes).toEqual(['Sol', 'Si', 'Re', 'Fa♯']);
    });

    test('G7 和弦頻率為 G, B, D, F♯（非 G, B, D, F）', () => {
        const g7 = chords.find(c => c.symbol === 'G7');
        const freqs = g7.notes.map(n => noteFreqs[n]);
        // G=392, B=493.88, D=293.66, F♯=369.99
        expect(freqs).toEqual([392.00, 493.88, 293.66, 369.99]);
    });

    test('Dm 和弦包含 Re, Fa♯, La（Fa♯=F♯），非 Re, Fa, La（Fa=F natural）', () => {
        const dm = chords.find(c => c.symbol === 'Dm');
        expect(dm).toBeDefined();
        // Dm = D, F♯, A → solfège: Re, Fa♯, La
        expect(dm.notes).toContain('Fa♯');       // Fa♯ = F♯ = 369.99 Hz
        expect(dm.notes).not.toContain('Fa');     // Fa = F natural = 349.23 Hz (錯誤)
        expect(dm.notes).toEqual(['Re', 'Fa♯', 'La']);
    });

    test('Dm 和弦頻率為 D, F♯, A（非 D, F, A）', () => {
        const dm = chords.find(c => c.symbol === 'Dm');
        const freqs = dm.notes.map(n => noteFreqs[n]);
        // D=293.66, F♯=369.99, A=440
        expect(freqs).toEqual([293.66, 369.99, 440.00]);
    });
});
