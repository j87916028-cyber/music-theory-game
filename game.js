// 音樂小學堂 - 遊戲邏輯

// ========== DOM 元素緩存 (效能優化) ==========
// 緩存常用 DOM 元素，避免重複查詢
const domCache = {};
function getDomElement(id) {
    if (!domCache[id]) {
        domCache[id] = document.getElementById(id);
    }
    return domCache[id];
}

// 音頻上下文 - 延遲初始化，確保在用戶互動後才創建
let audioCtx = null;

function getAudioContext() {
    try {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) {
                console.warn('AudioContext not supported in this browser');
                return null;
            }
            audioCtx = new AudioContextClass();
        }
        // 喚醒 AudioContext（解決瀏覽器自動播放政策限制）
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    } catch (e) {
        console.error('Failed to initialize AudioContext:', e);
        return null;
    }
}

const notes = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
const noteNames = { Do: 'C', Re: 'D', Mi: 'E', Fa: 'F', Sol: 'G', La: 'A', Si: 'B' };
const noteFreqs = { Do: 261.63, Re: 293.66, Mi: 329.63, Fa: 349.23, Sol: 392.00, La: 440.00, Si: 493.88 };

// 鋼琴完整音符頻率（包含黑白鍵）- 模組層面定義避免重複創建
const pianoNoteFreqs = {
    'Do': 261.63, 'Do♯': 277.18,
    'Re': 293.66, 'Re♯': 311.13,
    'Mi': 329.63,
    'Fa': 349.23, 'Fa♯': 369.99,
    'Sol': 392.00, 'Sol♯': 415.30,
    'La': 440.00, 'La♯': 466.16,
    'Si': 493.88
};

// 從 localStorage 載入儲存的進度
function loadProgress() {
    const saved = localStorage.getItem('musicTheoryProgress');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            return {
                score: Math.min(Math.max(parseInt(data.score) || 0, 0), 999999),
                streak: Math.min(Math.max(parseInt(data.streak) || 0, 0), 999),
                currentLevel: Math.min(Math.max(parseInt(data.currentLevel) || 1, 1), 4),
                questionsAnswered: Math.max(parseInt(data.questionsAnswered) || 0, 0),
                correctAnswers: Math.max(parseInt(data.correctAnswers) || 0, 0),
                lastPlayed: data.lastPlayed || null
            };
        } catch (e) {
            console.error('載入進度失敗:', e);
        }
    }
    return null;
}

// 顯示歡迎回來提示
function showWelcomeBack(lastPlayed) {
    if (!lastPlayed) return;
    
    const welcomeEl = document.getElementById('welcomeBack');
    const lastDate = new Date(lastPlayed);
    const now = new Date();
    const diffMs = now - lastDate;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    let timeAgo = '';
    if (diffMins < 1) {
        timeAgo = '剛剛';
    } else if (diffMins < 60) {
        timeAgo = `${diffMins} 分鐘前`;
    } else if (diffHours < 24) {
        timeAgo = `${diffHours} 小時前`;
    } else {
        timeAgo = `${diffDays} 天前`;
    }
    
    welcomeEl.innerHTML = `👋 歡迎回來！<br><small>上次遊玩：${timeAgo}</small>`;
    welcomeEl.classList.add('show');
    
    // 5秒後自動隱藏
    setTimeout(() => {
        welcomeEl.classList.remove('show');
    }, 5000);
}

// Debounce 函數 - 避免頻繁寫入 localStorage
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 儲存進度到 localStorage（Debounced 版本，延遲 500ms）
const saveProgressDebounced = debounce(() => {
    try {
        const data = {
            score: Math.min(score, 999999), // 分數上限保護
            streak: Math.min(streak, 999),
            currentLevel: currentLevel,
            questionsAnswered: questionsAnswered,
            correctAnswers: correctAnswers,
            lastPlayed: new Date().toISOString()
        };
        localStorage.setItem('musicTheoryProgress', JSON.stringify(data));
    } catch (e) {
        console.warn('儲存進度失敗:', e);
    }
}, 500);

// 立即儲存進度（用於需要立即保存的場景）
function saveProgress() {
    try {
        const data = {
            score: Math.min(score, 999999), // 分數上限保護
            streak: Math.min(streak, 999),
            currentLevel: currentLevel,
            questionsAnswered: questionsAnswered,
            correctAnswers: correctAnswers,
            lastPlayed: new Date().toISOString()
        };
        localStorage.setItem('musicTheoryProgress', JSON.stringify(data));
    } catch (e) {
        console.warn('儲存進度失敗:', e);
    }
}

// 頁面關閉前自動儲存進度
window.addEventListener('beforeunload', () => {
    saveProgress();
});

// 清除儲存的進度
function resetProgress() {
    localStorage.removeItem('musicTheoryProgress');
    score = 0;
    streak = 0;
    currentLevel = 1;
    questionsAnswered = 0;
    correctAnswers = 0;
    updateUI();
    setLevel(1);
}

// 更新 UI 顯示
function updateUI() {
    getDomElement('score').textContent = score;
    getDomElement('streakCount').textContent = streak;
    updateProgress();
}

// 初始化進度
let savedProgress = loadProgress();
let score = savedProgress ? savedProgress.score : 0;
let streak = savedProgress ? savedProgress.streak : 0;
let currentLevel = savedProgress ? savedProgress.currentLevel : 1;
let questionsAnswered = savedProgress ? savedProgress.questionsAnswered : 0;
let correctAnswers = savedProgress ? savedProgress.correctAnswers : 0;
let currentQuestion = null;
let currentOptions = []; // 儲存當前題目的選項
let soundEnabled = true; // 音效開關狀態
let isAnswering = false; // 防止重複答題

// 切換音效開關
function toggleSound() {
    soundEnabled = !soundEnabled;
    const btn = getDomElement('soundToggle');
    btn.textContent = soundEnabled ? '🔊' : '🔇';
    btn.classList.toggle('muted', !soundEnabled);
    // 儲存音效設定
    localStorage.setItem('musicTheorySound', soundEnabled ? 'on' : 'off');
}

// 載入音效設定
function loadSoundSetting() {
    const saved = localStorage.getItem('musicTheorySound');
    if (saved === 'off') {
        soundEnabled = false;
        const btn = getDomElement('soundToggle');
        btn.textContent = '🔇';
        btn.classList.add('muted');
    }
}
loadSoundSetting();

// 鍵盤事件監聽
document.addEventListener('keydown', (e) => {
    // 防止重複觸發（按住不放）
    if (e.repeat) return;
    
    // 數字鍵 1-4 選擇答案（Level 1 可用 1-7）
    const maxOptions = currentLevel === 1 ? 7 : 4;
    if (e.key >= '1' && e.key <= String(maxOptions)) {
        const index = parseInt(e.key) - 1;
        
        // 清除之前的鍵盤焦點樣式
        document.querySelectorAll('.option-btn.keyboard-focus').forEach(btn => {
            btn.classList.remove('keyboard-focus');
        });
        
        // 添加鍵盤焦點樣式到目前選項
        const buttons = document.querySelectorAll('.option-btn');
        if (buttons[index]) {
            buttons[index].classList.add('keyboard-focus');
        }
        
        // 確保選項存在且題目未結束
        if (currentOptions[index] && !document.querySelector('.option-btn.correct')) {
            let option = currentOptions[index];
            // 取得正確答案
            let correctAnswer = currentQuestion;
            if (currentLevel === 3) {
                // Level 3: 節奏題 - 選項已是音符名稱，直接使用
                // currentOptions 儲存的是音符名稱（如 "四分音符"），currentQuestion 也是名稱
                // 無需額外轉換，直接比對字串
            }
            checkAnswer(option, correctAnswer);
        }
    }
    // Q/W/E/R 選擇關卡（Level 4 除外，避免與鋼琴鍵盤快捷鍵衝突）
    // 另外提供 1-4 數字鍵可以在所有關卡使用，切換更直覺
    // 修復：只有在未答題時才能切換關卡，避免與答題快捷鍵衝突
    if (!isAnswering) {
        if (e.key === '1') setLevel(1);
        if (e.key === '2') setLevel(2);
        if (e.key === '3') setLevel(3);
        if (e.key === '4') setLevel(4);
        if (currentLevel !== 4) {
            if (e.key.toLowerCase() === 'q') setLevel(1);
            if (e.key.toLowerCase() === 'w') setLevel(2);
            if (e.key.toLowerCase() === 'e') setLevel(3);
            if (e.key.toLowerCase() === 'r') setLevel(4);
        }
    }
    // N 鍵跳過當前題目（只在未答題時有效）
    if (e.key.toLowerCase() === 'n' && !isAnswering) {
        nextQuestion();
    }
    // 空白鍵播放聲音
    if (e.key === ' ' && currentQuestion) {
        e.preventDefault();
        if (currentLevel === 4) {
            // 找到當前和弦並播放
            const chord = chords.find(c => c.name === currentQuestion);
            if (chord) playChord(chord.notes.join(','));
        } else if (currentLevel === 3) {
            // 找到當前節奏並播放
            const rhythm = rhythms.find(r => r.name === currentQuestion);
            if (rhythm) playRhythm(rhythm);
        } else {
            playNote(currentQuestion);
        }
    }
    // Escape 鍵：Modal 開啟時關閉 Modal，否則重新開始當前關卡
    if (e.key === 'Escape') {
        e.preventDefault();
        const modal = getDomElement('helpModal');
        if (modal.classList.contains('show')) {
            closeHelp();
        } else {
            questionsAnswered = 0;
            correctAnswers = 0;
            streak = 0;
            updateProgress();
            nextQuestion();
        }
    }
    // 鋼琴鍵盤快捷鍵 (Level 4)
    if (currentLevel === 4 && currentQuestion) {
        const pianoKey = pianoKeys.find(k => k.key === e.key.toLowerCase());
        if (pianoKey) {
            e.preventDefault();
            playPianoKey(pianoKey.note);
            // 添加視覺反饋
            const keyElement = document.querySelector(`.key[data-note="${pianoKey.note}"]`);
            if (keyElement) {
                keyElement.classList.add('playing');
            }
        }
    }
    // 鋼琴鍵盤的鍵盤彈奏事件（Enter/Space）- 支援 Tab 鍵導航後按 Enter/Space 彈奏
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        const focusedKey = document.activeElement;
        if (focusedKey && focusedKey.classList.contains('key') && focusedKey.dataset.note) {
            e.preventDefault();
            focusedKey.classList.add('playing');
            playPianoKey(focusedKey.dataset.note);
        }
    }
});

// 鍵盤放開事件 - 移除鋼琴按鍵的視覺效果
document.addEventListener('keyup', (e) => {
    if (currentLevel === 4 && currentQuestion) {
        const pianoKey = pianoKeys.find(k => k.key === e.key.toLowerCase());
        if (pianoKey) {
            const keyElement = document.querySelector(`.key[data-note="${pianoKey.note}"]`);
            if (keyElement) {
                keyElement.classList.remove('playing');
            }
        }
    }
    // 支援 Tab 鍵導航到鋼琴鍵後用 Enter/Space 彈奏
    if (e.key === 'Enter' || e.key === ' ') {
        const focusedKey = document.activeElement;
        if (focusedKey && focusedKey.classList.contains('key') && focusedKey.dataset.note) {
            e.preventDefault();
            focusedKey.classList.remove('playing');
        }
    }
});

// 鋼琴鍵盤的鍵盤彈奏事件（Enter/Space）— 已合併到主 keydown 監聽器

function playNote(note) {
    if (!soundEnabled) return;
    if (!note || typeof noteFreqs[note] === 'undefined') {
        console.warn('Invalid note:', note);
        return;
    }
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = noteFreqs[note];
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    // 修復記憶體洩漏：節點停止後斷開連接
    osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
    };
}

function setLevel(level) {
    currentLevel = level;
    document.querySelectorAll('.level-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i + 1 === level);
    });
    questionsAnswered = 0;
    correctAnswers = 0;
    updateProgress();
    saveProgress();
    nextQuestion();
}

function updateProgress() {
    const progress = questionsAnswered > 0 ? (correctAnswers / questionsAnswered) * 100 : 0;
    getDomElement('progress').style.width = progress + '%';
}

function nextQuestion() {
    getDomElement('feedback').textContent = '';
    // 清除鍵盤焦點樣式
    document.querySelectorAll('.option-btn.keyboard-focus').forEach(btn => {
        btn.classList.remove('keyboard-focus');
    });
    
    // 使用 CSS class 觸发动畫（效能更好，不會移除事件監聽器）
    const questionArea = document.getElementById('questionArea');
    questionArea.classList.remove('fade-in');
    // 強制重繪以重新觸發動畫
    void questionArea.offsetWidth;
    questionArea.classList.add('fade-in');
    
    switch(currentLevel) {
        case 1: level1Question(); break;
        case 2: level2Question(); break;
        case 3: level3Question(); break;
        case 4: level4Question(); break;
    }
    
    // 綁定鋼琴鍵盤事件（支援 click, touchstart, keydown）
    bindPianoEvents();
}

// 鋼琴事件綁定狀態追蹤
let pianoEventsBound = false;

function bindPianoEvents() {
    // 使用 document 層級的事件委託，所以綁定一次就足夠
    // 這樣無論用戶如何切換關卡，鋼琴事件都會正常工作
    if (pianoEventsBound) return;
    pianoEventsBound = true;
    
    // 使用 document 層級的事件委託
    // 這樣每次更換題目時，雖然 .piano 元素被替換，但事件監聽仍然有效
    // 處理觸控事件（優先處理，preventDefault 避免雙重觸發）
    document.addEventListener('touchstart', (e) => {
        const key = e.target.closest('.key');
        if (key && key.dataset.note && key.closest('.piano')) {
            e.preventDefault();
            key.classList.add('playing');
            playPianoKey(key.dataset.note);
        }
    }, { passive: false });
    
    document.addEventListener('touchend', (e) => {
        const key = e.target.closest('.key');
        if (key && key.closest('.piano')) {
            e.preventDefault();
            key.classList.remove('playing');
        }
    }, { passive: false });
    
    // 處理觸控取消（防呆）
    document.addEventListener('touchcancel', (e) => {
        document.querySelectorAll('.piano .key.playing').forEach(key => {
            key.classList.remove('playing');
        });
    });
    
    // 處理滑鼠事件
    document.addEventListener('mousedown', (e) => {
        const key = e.target.closest('.key');
        if (key && key.dataset.note && key.closest('.piano')) {
            key.classList.add('playing');
            playPianoKey(key.dataset.note);
        }
    });
    
    document.addEventListener('mouseup', (e) => {
        const key = e.target.closest('.key');
        if (key && key.closest('.piano')) {
            key.classList.remove('playing');
        }
    });
    
    document.addEventListener('mouseleave', (e) => {
        const key = e.target.closest('.key');
        if (key && key.closest('.piano')) {
            key.classList.remove('playing');
        }
    });
}

// 🌱 Level 1: 認識音符 - 聽聲音選音符
function level1Question() {
    const correctNote = notes[Math.floor(Math.random() * notes.length)];
    currentQuestion = correctNote;
    
    // 洗牌選項，確保顯示順序與 currentOptions 一致
    const shuffledNotes = shuffleArray([...notes]);
    currentOptions = shuffledNotes; // 儲存洗牌後的選項順序
    
    const html = `
        <p class="hint">🎧 點擊播放鍵，聽聽是什麼音符？ (按 1-7 選答案)</p>
        <button onclick="playNote('${correctNote}')" style="font-size:3rem;background:linear-gradient(135deg,#e94560,#ff6b6b);border:none;border-radius:50%;width:100px;height:100px;cursor:pointer;">🔊</button>
        <div class="options">
            ${shuffledNotes.map((n, i) => `<button class="option-btn" onclick="checkAnswer('${n}','${correctNote}')">${i+1}. ${n}</button>`).join('')}
        </div>
    `;
    document.getElementById('questionArea').innerHTML = html;
}

// 📖 Level 2: 音名與唱名
function level2Question() {
    const note = notes[Math.floor(Math.random() * notes.length)];
    const mode = Math.random() > 0.5;
    currentQuestion = note;
    
    const question = mode ? `這個音符的音名是？` : `這個音符的唱名是？`;
    const correctAnswer = mode ? noteNames[note] : note;
    
    // 播放聲音
    setTimeout(() => playNote(note), 100);
    
    let options = [correctAnswer];
    const allOptions = mode ? ['C','D','E','F','G','A','B'] : notes;
    
    while (options.length < 4) {
        const opt = allOptions[Math.floor(Math.random() * allOptions.length)];
        if (!options.includes(opt)) options.push(opt);
    }
    options = shuffleArray(options);
    currentOptions = options; // 儲存選項順序
    
    const html = `
        <p class="hint">🎧 ${question} (按 1-4 選答案)</p>
        <div class="note-display">${note}</div>
        <button onclick="playNote('${note}')" style="font-size:2rem;background:rgba(255,255,255,0.2);border:none;border-radius:10px;padding:10px 20px;cursor:pointer;">🔊 再聽一次</button>
        <div class="options">
            ${options.map((n, i) => `<button class="option-btn" onclick="checkAnswer('${n}','${correctAnswer}')">${i+1}. ${n}</button>`).join('')}
        </div>
    `;
    document.getElementById('questionArea').innerHTML = html;
}

// 🎼 Level 3: 節奏練習
const rhythms = [
    { name: '四分音符', beats: 1, symbol: '♩', duration: 0.5 },
    { name: '二分音符', beats: 2, symbol: '𝅗𝅥', duration: 1.0 },
    { name: '全音符', beats: 4, symbol: '𝅝', duration: 2.0 },
    { name: '八分音符', beats: 0.5, symbol: '♪', duration: 0.25 }
];

// 播放節奏音效
function playRhythm(rhythm) {
    if (!soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    
    const duration = rhythm.duration || 0.5; // 使用 duration 控制節奏長度
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 440; // 使用較高頻率的正弦波
    osc.type = 'sine';
    
    // 根據節奏長度調整音量包絡
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gain.gain.setValueAtTime(0.3, now + duration - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
    
    osc.start(now);
    osc.stop(now + duration);
    
    // 修復記憶體洩漏
    osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
    };
}

function level3Question() {
    const rhythm = rhythms[Math.floor(Math.random() * rhythms.length)];
    currentQuestion = rhythm.name;
    
    const options = [0.5, 1, 2, 4];
    // 建立 beats 到音符名稱的映射，確保鍵盤答題時能正確比對
    const beatsToName = { 0.5: '八分音符', 1: '四分音符', 2: '二分音符', 4: '全音符' };
    currentOptions = options.map(n => beatsToName[n]); // 儲存音符名稱以便正確比對
    
    const html = `
        <p class="hint">這個音符有幾拍？ (按 1-4 選答案)</p>
        <div class="note-display">${rhythm.symbol}</div>
        <p style="font-size:1.5rem;margin:20px 0;">${rhythm.name}</p>
        <button onclick="playRhythmByName('${rhythm.name}')" style="font-size:3rem;background:linear-gradient(135deg,#e94560,#ff6b6b);border:none;border-radius:50%;width:100px;height:100px;cursor:pointer;">🔊</button>
        <div class="options">
            ${options.map((n, i) => `<button class="option-btn" onclick="checkAnswer('${beatsToName[n]}','${rhythm.name}')">${i+1}. ${n} 拍</button>`).join('')}
        </div>
    `;
    document.getElementById('questionArea').innerHTML = html;
}

// 根據名稱播放節奏（用於 HTML onclick）
function playRhythmByName(name) {
    const rhythm = rhythms.find(r => r.name === name);
    if (rhythm) {
        playRhythm(rhythm);
    }
}

// 🎹 Level 4: 和弦認識
const chords = [
    { name: 'C大和弦', notes: ['Do','Mi','Sol'], symbol: 'C' },
    { name: 'G大和弦', notes: ['Sol','Si','Re'], symbol: 'G' },
    { name: 'F大和弦', notes: ['Fa','La','Do'], symbol: 'F' },
    { name: 'Dm和弦', notes: ['Re','Fa','La'], symbol: 'Dm' }
];

// Fisher-Yates 洗牌算法 (公平隨機)
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// 根據目前關卡播放答題結果的音效反饋
function playAnswerFeedback(isCorrect) {
    if (isCorrect) {
        if (currentLevel === 4) {
            // Level 4: 和弦 - 播放正確答案的和弦
            const chord = chords.find(c => c.name === currentQuestion);
            if (chord) {
                playChord(chord.notes.join(','));
            }
        } else if (currentLevel === 3) {
            // Level 3: 節奏題 - 播放正確答案的節奏
            const rhythm = rhythms.find(r => r.name === currentQuestion);
            if (rhythm) {
                playRhythm(rhythm);
            }
        } else {
            // Level 1-2: 播放正確音符
            let correctNote = currentQuestion;
            playNote(correctNote);
        }
    } else {
        // 答錯時播放低沉的失敗音效
        playWrongSound();
    }
}

// 顯示浮動分數動畫
function showFloatingScore(points) {
    const scoreEl = document.createElement('div');
    scoreEl.className = 'floating-score';
    scoreEl.textContent = `+${points}`;
    
    // 定位到分數顯示區域附近
    const scoreDisplay = document.querySelector('.score-display');
    if (scoreDisplay) {
        const rect = scoreDisplay.getBoundingClientRect();
        scoreEl.style.left = (rect.left + rect.width / 2) + 'px';
        scoreEl.style.top = (rect.bottom + 10) + 'px';
    } else {
        scoreEl.style.left = '50%';
        scoreEl.style.top = '40%';
    }
    
    document.body.appendChild(scoreEl);
    
    // 動畫結束後移除元素
    setTimeout(() => {
        scoreEl.remove();
    }, 1000);
}

// 播放答錯時的音效
function playWrongSound() {
    if (!soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 150; // 較低的頻率
    osc.type = 'sawtooth';
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    // 修復記憶體洩漏：節點停止後斷開連接
    osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
    };
}

// 鋼琴鍵盤布局：白鍵 + 黑鍵位置
// 黑鍵位置根據鋼琴八度內的相對位置計算
// 標準鋼琴配置：Do-Re-Mi-Fa-Sol-La-Si，白鍵之間的黑鍵是 Do♯、Re♯、Fa♯、Sol♯、La♯
// 注意：Mi-Fa 之間和 Si-Do 之間沒有黑鍵！
const pianoKeys = [
    { note: 'Do', isBlack: false, blackKeyIndex: null, key: 'a' },
    { note: 'Do♯', isBlack: true, blackKeyIndex: 1, key: 'w' },   // 在 Do(0) 和 Re(1) 之間 → 白鍵索引+1
    { note: 'Re', isBlack: false, blackKeyIndex: null, key: 's' },
    { note: 'Re♯', isBlack: true, blackKeyIndex: 2, key: 'e' },   // 在 Re(1) 和 Mi(2) 之間 → 白鍵索引+1
    { note: 'Mi', isBlack: false, blackKeyIndex: null, key: 'd' },
    { note: 'Fa', isBlack: false, blackKeyIndex: null, key: 'f' },
    { note: 'Fa♯', isBlack: true, blackKeyIndex: 4, key: 't' },   // 在 Fa(3) 和 Sol(4) 之間 → 白鍵索引+1 (跳過 Mi)
    { note: 'Sol', isBlack: false, blackKeyIndex: null, key: 'g' },
    { note: 'Sol♯', isBlack: true, blackKeyIndex: 5, key: 'y' },   // 在 Sol(4) 和 La(5) 之間 → 白鍵索引+1
    { note: 'La', isBlack: false, blackKeyIndex: null, key: 'h' },
    { note: 'La♯', isBlack: true, blackKeyIndex: 6, key: 'u' },   // 在 La(5) 和 Si(6) 之間 → 白鍵索引+1
    { note: 'Si', isBlack: false, blackKeyIndex: null, key: 'j' }
];

function level4Question() {
    const chord = chords[Math.floor(Math.random() * chords.length)];
    currentQuestion = chord.name;
    
    // 洗牌選項順序，確保 currentOptions 與按鈕渲染順序一致
    const shuffledChords = shuffleArray([...chords]);
    currentOptions = shuffledChords.map(c => c.name);
    
    // 直接使用 chord.notes
    const activeKeys = chord.notes;
    
    // 使用 DocumentFragment 優化 DOM 渲染效能（減少 layout thrashing）
    const pianoContainer = document.createDocumentFragment();
    
    pianoKeys.forEach(k => {
        const keyEl = document.createElement('div');
        
        if (k.isBlack) {
            // 使用 CSS Grid 定位（黑鍵由 grid-column 控制）
            keyEl.className = 'key black';
            keyEl.dataset.note = k.note;
            keyEl.title = `${k.note} (${k.key.toUpperCase()})`;
            keyEl.setAttribute('role', 'button');
            keyEl.setAttribute('aria-label', `${k.note} 的黑鍵，按鍵 ${k.key.toUpperCase()}`);
            keyEl.setAttribute('tabindex', '0');
        } else {
            const isHighlight = activeKeys.includes(k.note);
            keyEl.className = `key ${isHighlight ? 'highlight' : ''}`;
            keyEl.dataset.note = k.note;
            keyEl.setAttribute('role', 'button');
            keyEl.setAttribute('aria-label', `${k.note} 白鍵，按鍵 ${k.key.toUpperCase()}`);
            keyEl.setAttribute('tabindex', '0');
            keyEl.innerHTML = `${k.note}<span style="font-size:0.6rem;display:block;">${k.key.toUpperCase()}</span>`;
        }
        
        pianoContainer.appendChild(keyEl);
    });
    
    // 建立選項按鈕片段
    const optionsContainer = document.createDocumentFragment();
    shuffledChords.forEach((c, i) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = `${i + 1}. ${c.name}`;
        btn.onclick = () => checkAnswer(c.name, chord.name);
        optionsContainer.appendChild(btn);
    });
    
    // 使用 DOM 元素构建问题区域（DocumentFragment 減少迼回流）
    const questionArea = document.getElementById('questionArea');
    questionArea.innerHTML = '';
    
    // 添加提示文字
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '🎧 聽和弦，選擇正確的名稱 (按 1-4 選答案 | A-J 彈鋼琴)（黃色鍵為和弦組成音）';
    questionArea.appendChild(hint);
    
    // 添加播放按鈕
    const playBtn = document.createElement('button');
    playBtn.style.cssText = 'font-size:3rem;background:linear-gradient(135deg,#9b59b6,#8e44ad);border:none;border-radius:50%;width:100px;height:100px;cursor:pointer;';
    playBtn.textContent = '🔊';
    playBtn.onclick = () => playChord(chord.notes.join(','));
    questionArea.appendChild(playBtn);
    
    // 添加鋼琴容器
    const pianoDiv = document.createElement('div');
    pianoDiv.className = 'piano';
    pianoDiv.appendChild(pianoContainer);
    questionArea.appendChild(pianoDiv);
    
    // 添加選項容器
    const optionsDiv = document.createElement('div');
    optionsDiv.className = 'options';
    optionsDiv.appendChild(optionsContainer);
    questionArea.appendChild(optionsDiv);
}

function playPianoKey(note) {
    // 檢查音符是否存在
    if (!note || typeof pianoNoteFreqs[note] === 'undefined') {
        console.warn('Invalid piano note:', note);
        return;
    }
    // 使用模組層面的 pianoNoteFreqs 物件（避免每次創建新物件）
    playPianoNote(pianoNoteFreqs[note] || 261.63);
}

function playPianoNote(freq) {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    // 修復記憶體洩漏：節點停止後斷開連接
    osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
    };
}

// 真正同時播放和弦（而非依次彈奏）
function playChord(notesStr) {
    if (!soundEnabled) return;
    const notes = notesStr.split(',');
    const ctx = getAudioContext();
    if (!ctx) return;
    
    // 同時創建多個振盪器，每個音符一個
    notes.forEach((noteName, i) => {
        // 檢查音符是否存在
        if (!noteName || typeof noteFreqs[noteName] === 'undefined') {
            console.warn('Invalid chord note:', noteName);
            return;
        }
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = noteFreqs[noteName];
        osc.type = 'sine'; // 和弦使用正弦波更和諧
        
        // 稍微錯開開始時間避免相位問題，創造更豐滿的音色
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
        
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.8);
        // 修復記憶體洩漏：節點停止後斷開連接
        osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
        };
    });
}

function checkAnswer(answer, correct) {
    // 防止重複答題
    if (isAnswering) return;
    isAnswering = true;
    
    const isCorrect = String(answer) === String(correct);
    questionsAnswered++;
    
    const feedback = getDomElement('feedback');
    feedback.className = 'feedback ' + (isCorrect ? 'correct' : 'wrong');
    feedback.textContent = isCorrect ? '✅ 答對了！' : '❌ 錯了～';
    
    // 標記答案按鈕（答對顯示綠色，答錯顯示紅色+綠色標記正確答案）
    // 改用按鈕索引匹配 currentOptions，避免文字格式問題
    const buttons = document.querySelectorAll('.option-btn');
    buttons.forEach((btn, index) => {
        // 移除鍵盤焦點樣式
        btn.classList.remove('keyboard-focus');
        // 取得該按鈕對應的選項值（使用 currentOptions 陣列索引）
        const btnValue = currentOptions[index];
        if (isCorrect) {
            if (String(btnValue) === String(correct)) {
                btn.classList.add('correct');
            }
        } else {
            // 答錯時標記錯誤答案和正確答案
            if (String(btnValue) === String(answer)) {
                btn.classList.add('wrong');
            }
            if (String(btnValue) === String(correct)) {
                btn.classList.add('correct');
            }
        }
        btn.disabled = true; // 禁用所有按鈕防止重複答題
    });
    
    if (isCorrect) {
        const pointsEarned = 10 + streak * 2;
        score += pointsEarned;
        streak++;
        correctAnswers++;
        
        // 顯示浮動分數提示
        showFloatingScore(pointsEarned);
        
        // 顯示連擊
        if (streak >= 3) {
            const popup = getDomElement('streakPopup');
            popup.textContent = `🔥 ${streak}連擊！`;
            popup.classList.add('show');
            setTimeout(() => popup.classList.remove('show'), 1000);
        }
    } else {
        streak = 0;
    }
    
    getDomElement('score').textContent = score;
    getDomElement('streakCount').textContent = streak;
    updateProgress();
    
    // 儲存進度到 localStorage（使用 Debounced 版本避免頻繁寫入）
    saveProgressDebounced();
    
    // 答錯顯示正確答案
    if (!isCorrect) {
        setTimeout(() => {
            feedback.textContent += ` 正確答案是：${correct}`;
        }, 500);
    }

    // 播放答題結果的音效反饋
    setTimeout(() => playAnswerFeedback(isCorrect), 300);
    
    setTimeout(() => {
        isAnswering = false; // 重置答題鎖定
        nextQuestion();
    }, 1500);
}

// 初始化 - 恢復儲存的進度
getDomElement('score').textContent = score;
getDomElement('streakCount').textContent = streak;
updateProgress();
setLevel(currentLevel);

// 顯示歡迎回來提示（如果有之前的記錄）
if (savedProgress && savedProgress.lastPlayed) {
    showWelcomeBack(savedProgress.lastPlayed);
}

// 顯示幫助 Modal
function showHelp() {
    const modal = getDomElement('helpModal');
    modal.classList.add('show');
}

// 關閉幫助 Modal
function closeHelp() {
    const modal = getDomElement('helpModal');
    modal.classList.remove('show');
}

// 點擊 Modal 背景關閉
document.getElementById('helpModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeHelp();
    }
});

// ESC 鍵關閉 Modal — 已合併到主 keydown 監聽器
