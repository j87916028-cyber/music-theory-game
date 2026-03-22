// 音樂小學堂 - 遊戲邏輯

// ========== DOM 元素緩存 (效能優化) ==========
// 緩存常用 DOM 元素，避免重複查詢
// 使用 MutationObserver 監聽 DOM 變化，只在需要時清除緩存
const domCache = {};

// 建立 MutationObserver 監聽 DOM 變化
// 當檢測到常見的 DOM 替換操作時，選擇性清除相關緩存
let domObserver = null;

function initDomObserver() {
    if (domObserver) return;
    
    // 觀察 document.body 的子節點變化
    domObserver = new MutationObserver((mutations) => {
        let shouldClearAll = false;
        
        for (const mutation of mutations) {
            // 檢測是否有節點被移除或替換
            for (const removedNode of mutation.removedNodes) {
                // 如果移除了整個遊戲區域，清除所有相關緩存
                if (removedNode.id === 'gameArea' || 
                    removedNode.id === 'mainContainer' ||
                    removedNode.classList?.contains('mode-card')) {
                    shouldClearAll = true;
                    break;
                }
                
                // 檢查被移除節點的子元素是否在緩存中
                if (removedNode.querySelectorAll) {
                    const cachedIds = Object.keys(domCache);
                    for (const id of cachedIds) {
                        if (domCache[id] && !domCache[id].isConnected) {
                            delete domCache[id];
                        }
                    }
                }
            }
            
            if (shouldClearAll) break;
        }
        
        // 批量清理已斷開的緩存
        if (!shouldClearAll) {
            const keysToDelete = [];
            for (const id in domCache) {
                if (domCache[id] && !domCache[id].isConnected) {
                    keysToDelete.push(id);
                }
            }
            keysToDelete.forEach(id => delete domCache[id]);
        }
    });
    
    // 開始觀察 body
    if (document.body) {
        domObserver.observe(document.body, { 
            childList: true, 
            subtree: true 
        });
    } else {
        // 如果 body 還沒準備好，等 DOMContentLoaded 後再觀察
        document.addEventListener('DOMContentLoaded', () => {
            domObserver.observe(document.body, { 
                childList: true, 
                subtree: true 
            });
        }, { once: true });
    }
}

// 初始化觀察器
initDomObserver();

// 清除 DOM 緩存的輔助函數
// 當 DOM 大範圍更新時（如切換遊戲模式），手動清除緩存以避免記憶體洩漏
function clearDomCache() {
    // 清除所有緩存
    for (const id in domCache) {
        delete domCache[id];
    }
}

function getDomElement(id) {
    // 參數驗證：確保傳入有效的 id
    if (!id || typeof id !== 'string') {
        return null;
    }
    
    // 直接從緩存返回（由 MutationObserver 負責維護緩存有效性）
    if (domCache[id]) {
        return domCache[id];
    }
    
    // 查詢 DOM 並緩存結果
    const element = document.getElementById(id);
    if (element) {
        domCache[id] = element;
    }
    return element;
}

// 音頻上下文 - 延遲初始化，確保在用戶互動後才創建
let audioCtx = null;
let audioSupported = null; // 快取音頻支援狀態

// XSS 防護：HTML 轉義函數（優化版本 - 使用字串替換避免重複創建 DOM 元素）
const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};
const HTML_ESCAPE_REGEX = /[&<>"']/g;

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(HTML_ESCAPE_REGEX, char => HTML_ESCAPE_MAP[char]);
}

function checkAudioSupport() {
    // 檢查音頻支援狀態（快取結果避免重複檢查）
    if (audioSupported !== null) {
        return audioSupported;
    }
    
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            audioSupported = false;
            console.warn('AudioContext not supported in this browser');
            return false;
        }
        // 嘗試創建一個測試音頻上下文
        const testCtx = new AudioContextClass();
        // 關閉測試上下文以釋放資源
        if (testCtx.state !== 'closed') {
            testCtx.close();
        }
        audioSupported = true;
        return true;
    } catch (e) {
        audioSupported = false;
        console.warn('AudioContext test failed:', e);
        return false;
    }
}

function getAudioContext() {
    // 先檢查音頻是否支援
    if (!checkAudioSupport()) {
        return null;
    }
    
    try {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContextClass();
        }
        // 每次取得 AudioContext 時都檢查並喚醒（解決切換分頁後變成 suspended 的問題）
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(e => {
                console.warn('Failed to resume AudioContext:', e);
            });
        }
        // 額外檢查：確保音頻上下文處於可用狀態
        // 有些瀏覽器在 suspend 後需要多個 resume 調用
        if (audioCtx.state !== 'running') {
            // 嘗試再次喚醒
            audioCtx.resume().catch(() => {});
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

// 音頻節點清理輔助函數 - 統一處理記憶體洩漏防護
// 改進：增加類型檢查，確保節點有 disconnect 方法後再調用
function cleanupAudioNodes(...nodes) {
    nodes.forEach(node => {
        if (node && typeof node.disconnect === 'function') {
            try {
                node.disconnect();
            } catch (e) {
                // 靜默處理斷開連接時的錯誤（某些節點可能已經斷開）
            }
        }
    });
}

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
                lastPlayed: data.lastPlayed || null,
                totalPlayTime: Math.max(parseInt(data.totalPlayTime) || 0, 0) // 遊戲時長（秒）
            };
        } catch (e) {
            console.error('載入進度失敗:', e);
        }
    }
    return null;
}

// 遊戲時長追蹤
let sessionStartTime = null; // 當前session開始時間
let totalPlayTime = 0; // 總遊戲時長（秒）

// 初始化遊戲時長（在 loadProgress 後調用）
function initPlayTime() {
    // 優化：直接從 localStorage 讀取 totalPlayTime，避免不必要的 JSON 解析和驗證
    try {
        const saved = localStorage.getItem('musicTheoryProgress');
        if (saved) {
            const data = JSON.parse(saved);
            if (data && typeof data.totalPlayTime === 'number' && data.totalPlayTime > 0) {
                totalPlayTime = data.totalPlayTime;
            }
        }
    } catch (e) {
        // 安靜處理錯誤，保持預設值 0
    }
    
    // 設置當前session開始時間
    sessionStartTime = Date.now();
}

// 更新遊戲時長（由定時器呼叫）
function updatePlayTime() {
    if (sessionStartTime) {
        const sessionSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
        totalPlayTime += sessionSeconds;
        sessionStartTime = Date.now(); // 重置session計時
        
        // 儲存到 localStorage
        savePlayTimeToStorage();
    }
}

// 檢查是否為 localStorage 配額超限錯誤
function isQuotaExceededError(error) {
    return (
        error instanceof DOMException &&
        // Firefox, Chrome, Safari
        (error.code === 22 ||
            // Firefox
            error.code === 1014 ||
            // Chrome, Opera
            error.name === 'QuotaExceededError' ||
            error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
    );
}

// 安全地儲存資料到 localStorage（處理配額超限）
function safeLocalStorageSet(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        if (isQuotaExceededError(e)) {
            console.warn('localStorage 儲存空間已滿，嘗試清理舊資料...');
            // 嘗試清理一些非必要的資料
            try {
                // 清理答題歷史（保留最近5筆）
                const history = localStorage.getItem('musicTheoryAnswerHistory');
                if (history) {
                    const parsed = JSON.parse(history);
                    if (parsed.length > 5) {
                        localStorage.setItem('musicTheoryAnswerHistory', JSON.stringify(parsed.slice(0, 5)));
                    }
                }
                // 再次嘗試儲存
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (cleanupError) {
                console.error('清理後仍然儲存失敗:', cleanupError);
                return false;
            }
        }
        console.warn('localStorage 儲存失敗:', e);
        return false;
    }
}

// 只儲存遊戲時長到 localStorage（不累加，由 saveProgress 呼叫）
function savePlayTimeToStorage() {
    try {
        const saved = localStorage.getItem('musicTheoryProgress');
        const data = saved ? JSON.parse(saved) : {};
        data.totalPlayTime = totalPlayTime;
        if (!safeLocalStorageSet('musicTheoryProgress', data)) {
            console.warn('遊戲時長儲存失敗');
        }
    } catch (e) {
        console.warn('儲存遊戲時長失敗:', e);
    }
}

// 格式化遊戲時長為可讀格式
function formatPlayTime(seconds) {
    if (!seconds || seconds < 0) seconds = 0;
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}小時${minutes}分`;
    } else if (minutes > 0) {
        return `${minutes}分${secs}秒`;
    } else {
        return `${secs}秒`;
    }
}

// 定期更新遊戲時長顯示（每10秒更新一次）
let playTimeUpdateInterval = null;

function startPlayTimeTracker() {
    if (playTimeUpdateInterval) return;
    
    playTimeUpdateInterval = setInterval(() => {
        const display = getDomElement('playTimeDisplay');
        if (display) {
            const currentSessionSeconds = sessionStartTime ? Math.floor((Date.now() - sessionStartTime) / 1000) : 0;
            display.textContent = formatPlayTime(totalPlayTime + currentSessionSeconds);
        }
    }, 10000); // 每10秒更新顯示
}

function stopPlayTimeTracker() {
    if (playTimeUpdateInterval) {
        clearInterval(playTimeUpdateInterval);
        playTimeUpdateInterval = null;
    }
    // 先更新最新的遊戲時長（因為定時器已經停止）
    if (sessionStartTime) {
        const sessionSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
        totalPlayTime += sessionSeconds;
        sessionStartTime = null;
    }
    // 儲存到 localStorage
    savePlayTimeToStorage();
}

// 顯示歡迎回來提示
function showWelcomeBack(lastPlayed) {
    if (!lastPlayed) return;
    
    const welcomeEl = getDomElement('welcomeBack');
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

// 顯示首次遊戲歡迎提示
function showFirstTimeWelcome() {
    const welcomeEl = getDomElement('welcomeBack');
    welcomeEl.innerHTML = `🎉 歡迎來到音樂小學堂！<br><small>點擊 🔊 播放音符，選擇正確答案開始學習～</small>`;
    welcomeEl.classList.add('show');
    
    // 6秒後自動隱藏（給新用戶多一點時間閱讀）
    setTimeout(() => {
        welcomeEl.classList.remove('show');
    }, 6000);
}

// 顯示音頻不支持的提示（僅顯示一次）
let audioNotSupportedHintShown = false;
function showAudioNotSupportedHint() {
    if (audioNotSupportedHintShown) return;
    audioNotSupportedHintShown = true;
    
    const feedbackEl = getDomElement('feedback');
    if (feedbackEl) {
        feedbackEl.textContent = '⚠️ 您的瀏覽器不支援音頻，遊戲將以靜音模式運行';
        feedbackEl.style.color = '#ff9800';
        feedbackEl.classList.add('show');
        
        setTimeout(() => {
            feedbackEl.classList.remove('show');
        }, 5000);
    }
}

// 每日簽到獎勵功能
function checkDailyLogin() {
    const today = new Date().toDateString(); // 取得今天的日期（不含時間）
    const lastLoginDate = localStorage.getItem('musicTheoryLastLogin');
    const loginRewardShown = localStorage.getItem('musicTheoryLoginReward');
    
    // 如果今天還沒領過簽到獎勵
    if (lastLoginDate !== today) {
        // 檢查是否是連續登入（前一天有登入過）
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toDateString();
        
        let bonusPoints = 5; // 基礎獎勵
        let rewardMessage = `🎁 每日簽到獎勵：+${bonusPoints} 分`;
        
        // 檢查是否是連續登入（增加獎勵）
        if (lastLoginDate === yesterdayStr) {
            // 計算連續登入天數
            let streakDays = parseInt(localStorage.getItem('musicTheoryLoginStreak') || '0') + 1;
            bonusPoints = 5 + Math.min(streakDays * 2, 15); // 最多額外 +15 分
            rewardMessage = `🔥 連續登入 ${streakDays} 天！獎勵：+${bonusPoints} 分`;
            safeLocalStorageSet('musicTheoryLoginStreak', streakDays);
        } else {
            // 重置連續登入計數
            safeLocalStorageSet('musicTheoryLoginStreak', 1);
        }
        
        // 發放獎勵
        score += bonusPoints;
        saveProgress();
        updateUI();
        
        // 顯示簽到獎勵提示
        setTimeout(() => {
            const welcomeEl = getDomElement('welcomeBack');
            welcomeEl.innerHTML = `${rewardMessage}<br><small>天天登入，獎勵翻倍！</small>`;
            welcomeEl.classList.add('show');
            welcomeEl.style.background = 'rgba(255, 215, 0, 0.9)'; // 金色背景
            
            setTimeout(() => {
                welcomeEl.classList.remove('show');
            }, 4000);
        }, 1000);
        
        // 記錄今天已領取
        safeLocalStorageSet('musicTheoryLastLogin', today);
    }
}

// Debounce 函數 - 避免頻繁寫入 localStorage
// 支援 leading 和 trailing 選項，預設兩者都啟用以確保資料不丟失
function debounce(func, wait, options = { leading: true, trailing: true }) {
    let timeout;
    let lastArgs = null;
    let lastThis = null;
    let result;
    let lastInvokeTime = 0;
    
    const leading = options.leading;
    const trailing = options.trailing;
    
    return function executedFunction(...args) {
        const now = Date.now();
        const isFirstCall = timeout === undefined;
        
        lastArgs = args;
        lastThis = this;
        
        // 清除之前的計時器
        if (timeout) clearTimeout(timeout);
        
        // Leading: 第一次呼叫時立即執行
        if (leading && isFirstCall) {
            lastInvokeTime = now;
            result = func.apply(this, args);
        }
        
        // Trailing: 設定計時器，在 wait 毫秒後執行
        if (trailing) {
            timeout = setTimeout(() => {
                timeout = undefined;
                // Trailing edge: 執行最近一次的呼叫
                if (lastArgs) {
                    lastInvokeTime = Date.now();
                    result = func.apply(lastThis, lastArgs);
                }
            }, wait);
        }
        
        // 更新最後呼叫時間（用於調試或進階用途）
        if (!isFirstCall) {
            lastInvokeTime = now;
        }
        
        return result;
    };
}

// 儲存進度到 localStorage（Debounced 版本，延遲 500ms）
// 使用 leading + trailing 確保：1) 快速答題時立即儲存第一筆 2) 短暫停頓後儲存最後一筆
const saveProgressDebounced = debounce(() => {
    const data = {
        score: Math.min(score, 999999), // 分數上限保護
        streak: Math.min(streak, 999),
        currentLevel: currentLevel,
        questionsAnswered: questionsAnswered,
        correctAnswers: correctAnswers,
        lastPlayed: new Date().toISOString(),
        totalPlayTime: totalPlayTime // 儲存遊戲時長
    };
    if (!safeLocalStorageSet('musicTheoryProgress', data)) {
        console.warn('儲存進度失敗');
    }
}, 500, { leading: true, trailing: true });

// 立即儲存進度（用於需要立即保存的場景）
function saveProgress() {
    // 只儲存遊戲時長，不重新計算（避免重複計時）
    savePlayTimeToStorage();
    
    const data = {
        score: Math.min(score, 999999), // 分數上限保護
        streak: Math.min(streak, 999),
        currentLevel: currentLevel,
        questionsAnswered: questionsAnswered,
        correctAnswers: correctAnswers,
        lastPlayed: new Date().toISOString(),
        totalPlayTime: totalPlayTime // 儲存遊戲時長
    };
    if (!safeLocalStorageSet('musicTheoryProgress', data)) {
        console.warn('儲存進度失敗');
    }
}

// 頁面關閉前自動儲存進度
window.addEventListener('beforeunload', () => {
    saveProgress();
    stopPlayTimeTracker(); // 儲存遊戲時長
});

// 處理可見性變更：切換分頁時自動暫停遊戲
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // 分頁隱藏時自動暫停遊戲（如果正在進行中）
        if (!isPaused && currentQuestion && currentLevel) {
            togglePause();
            // 標記為由系統自動暫停區分的標記
            isPausedByVisibility = true;
        }
        // 暫停遊戲時長追蹤
        stopPlayTimeTracker();
    } else {
        // 分頁恢復顯示時，如果是由可見性變更自動暫停的，則自動恢復遊戲
        if (isPausedByVisibility) {
            isPausedByVisibility = false;
            togglePause();
            // 恢復遊戲時長追蹤
            startPlayTimeTracker();
        }
    }
});

// 清除儲存的進度
function resetProgress() {
    // 清除所有相關的 localStorage 數據，確保完全重置
    localStorage.removeItem('musicTheoryProgress');
    localStorage.removeItem('musicTheoryAnswerHistory');
    localStorage.removeItem('musicTheoryLoginStreak');
    localStorage.removeItem('musicTheoryLastLogin');
    localStorage.removeItem('musicTheoryLoginReward');
    
    score = 0;
    streak = 0;
    currentLevel = 1;
    questionsAnswered = 0;
    correctAnswers = 0;
    answerHistory = []; // 清除記憶體中的答題歷史
    
    updateUI();
    setLevel(1);
}

// 更新 UI 顯示
function updateUI() {
    const scoreEl = getDomElement('score');
    const streakEl = getDomElement('streakCount');
    if (scoreEl) scoreEl.textContent = score;
    if (streakEl) streakEl.textContent = streak;
    updateAccuracy();
    updateProgress();
}

// 更新答對率顯示
function updateAccuracy() {
    const accuracyEl = getDomElement('accuracy');
    if (questionsAnswered > 0) {
        const accuracy = Math.round((correctAnswers / questionsAnswered) * 100);
        accuracyEl.textContent = accuracy + '%';
        
        // 根據答對率顯示不同顏色
        if (accuracy >= 80) {
            accuracyEl.style.color = '#4caf50'; // 綠色
        } else if (accuracy >= 50) {
            accuracyEl.style.color = '#ffd700'; // 黃色
        } else {
            accuracyEl.style.color = '#ff6b6b'; // 紅色
        }
    } else {
        accuracyEl.textContent = '0%';
        accuracyEl.style.color = '';
    }
}

// 初始化進度
let savedProgress = loadProgress();
let score = savedProgress ? savedProgress.score : 0;

// 確保 feedback 元素有正確的無障礙屬性
function initAccessibility() {
    const feedbackEl = getDomElement('feedback');
    if (feedbackEl && !feedbackEl.getAttribute('aria-live')) {
        feedbackEl.setAttribute('role', 'status');
        feedbackEl.setAttribute('aria-live', 'polite');
    }
}
// 頁面載入後初始化無障礙屬性
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAccessibility);
} else {
    initAccessibility();
}
let streak = savedProgress ? savedProgress.streak : 0;
let currentLevel = savedProgress ? savedProgress.currentLevel : 1;
let questionsAnswered = savedProgress ? savedProgress.questionsAnswered : 0;
let correctAnswers = savedProgress ? savedProgress.correctAnswers : 0;
let currentQuestion = null;
let currentOptions = []; // 儲存當前題目的選項
let soundEnabled = true; // 音效開關狀態
let isAnswering = false; // 防止重複答題
let isPaused = false; // 遊戲暫停狀態
let isPausedByVisibility = false; // 標記是否由可見性變更自動暫停

// ========== 答題計時功能 ==========
let questionTimerEnabled = false; // 答題計時開關（預設關閉）
let questionTimeLimit = 15; // 預設答題時間（秒）
let questionTimer = null; // 計時器 ID
let questionTimeRemaining = 0; // 剩餘時間
let cachedGameArea = null; // 快取遊戲區域元素（用於計時器顯示）

// ========== 答題歷史記錄功能 ==========
const MAX_HISTORY = 20; // 最多保存20條記錄
let answerHistory = []; // 答題歷史陣列

// 可訪問性：追蹤開啟 Modal 前聚焦的元素，用於關閉後恢復焦點
let lastFocusedElement = null;

// 儲存答題歷史到 localStorage
function saveAnswerHistory() {
    if (!safeLocalStorageSet('musicTheoryAnswerHistory', answerHistory)) {
        console.warn('儲存答題歷史失敗');
    }
}

// 載入答題歷史
function loadAnswerHistory() {
    const saved = localStorage.getItem('musicTheoryAnswerHistory');
    if (saved) {
        try {
            answerHistory = JSON.parse(saved);
        } catch (e) {
            console.error('載入答題歷史失敗:', e);
            answerHistory = [];
        }
    }
}

// 添加答題記錄
function addToHistory(question, userAnswer, correctAnswer, isCorrect, level) {
    const record = {
        question: question,
        userAnswer: userAnswer,
        correctAnswer: correctAnswer,
        isCorrect: isCorrect,
        level: level,
        timestamp: new Date().toISOString()
    };
    answerHistory.unshift(record); // 新記錄添加到開頭
    if (answerHistory.length > MAX_HISTORY) {
        answerHistory = answerHistory.slice(0, MAX_HISTORY); // 保持最多20條
    }
    saveAnswerHistory();
}

// 顯示答題歷史 Modal
function showAnswerHistory() {
    loadAnswerHistory(); // 確保載入最新歷史
    
    const historyBtn = getDomElement('historyBtn');
    if (!historyBtn) return;
    
    let html = '';
    
    if (answerHistory.length === 0) {
        html = '<p class="history-empty">還沒有答題記錄喔～</p>';
    } else {
        // 按關卡分組顯示
        const levelNames = { 1: '🌱 認識音符', 2: '📖 音名與唱名', 3: '🎼 節奏練習', 4: '🎹 和弦認識' };
        
        html = '<div class="history-list">';
        
        answerHistory.forEach((record, index) => {
            const levelName = levelNames[record.level] || `關卡${record.level}`;
            const icon = record.isCorrect ? '✅' : '❌';
            const time = new Date(record.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
            
            html += `
                <div class="history-item ${record.isCorrect ? 'correct' : 'wrong'}">
                    <div class="history-icon">${icon}</div>
                    <div class="history-content">
                        <div class="history-level">${levelName}</div>
                        <div class="history-question">題目：${escapeHtml(record.question)}</div>
                        <div class="history-answers">
                            你的答案：${escapeHtml(record.userAnswer)} 
                            ${!record.isCorrect ? `→ 正確答案：${escapeHtml(record.correctAnswer)}` : ''}
                        </div>
                        <div class="history-time">${time}</div>
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        
        // 添加清除歷史按鈕
        html += '<button class="history-clear-btn" onclick="clearAnswerHistory()">🗑️ 清除歷史記錄</button>';
    }
    
    // 創建或更新 Modal 內容
    let modal = getDomElement('historyModal');
    if (!modal) {
        // 創建 Modal（添加可訪問性屬性）
        modal = document.createElement('div');
        modal.id = 'historyModal';
        modal.className = 'modal-overlay';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'historyModalTitle');
        modal.innerHTML = `
            <div class="modal">
                <h2 id="historyModalTitle">📜 答題歷史</h2>
                <div class="history-container"></div>
                <button class="modal-close" onclick="closeAnswerHistory()">關閉</button>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    modal.querySelector('.history-container').innerHTML = html;
    modal.classList.add('show');
    
    // 可訪問性：儲存當前聚焦的元素，關閉時恢復
    lastFocusedElement = document.activeElement;
    
    // 可訪問性：啟用焦點陷阱，防止 Tab 離開 Modal
    trapFocus(modal);
    
    // 可訪問性：聚焦到關閉按鈕，方便鍵盤導航
    setTimeout(() => {
        const closeBtn = modal.querySelector('.modal-close');
        if (closeBtn) closeBtn.focus();
    }, 100);
}

// 關閉答題歷史 Modal
function closeAnswerHistory() {
    const modal = getDomElement('historyModal');
    if (modal) {
        modal.classList.remove('show');
    }
    // 可訪問性：解除焦點陷阱
    untrapFocus();
    // 可訪問性：關閉後恢復焦點到原本的元素
    if (lastFocusedElement && lastFocusedElement.focus) {
        setTimeout(() => lastFocusedElement.focus(), 50);
        lastFocusedElement = null;
    }
}

// 清除答題歷史
function clearAnswerHistory() {
    if (confirm('確定要清除所有答題歷史記錄嗎？')) {
        answerHistory = [];
        saveAnswerHistory();
        showAnswerHistory(); // 重新顯示
    }
}

// 初始化時載入歷史記錄
loadAnswerHistory();

// 初始化遊戲時長追蹤
initPlayTime();

// ========== Modal Focus Trap (無障礙Accessibility) ==========
// 用於追蹤當前活躍的 focus trap
let currentFocusTrap = null;

// 焦点陷阱處理函數
function handleFocusTrap(e, modal) {
    if (!modal || !modal.classList.contains('show')) return;
    
    const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableElements = modal.querySelectorAll(focusableSelectors);
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    // 如果按下 Shift + Tab 且當前在第一個元素，跳到最後一個
    if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
    }
    // 如果按下 Tab 且當前在最後一個元素，跳到第一個
    else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
    }
}

// 啟用焦點陷阱
function trapFocus(modal) {
    // 避免重複綁定
    if (currentFocusTrap && currentFocusTrap.modal === modal) return;
    
    // 先清除之前的陷阱
    untrapFocus();
    
    currentFocusTrap = {
        modal: modal,
        handler: (e) => handleFocusTrap(e, modal)
    };
    
    document.addEventListener('keydown', currentFocusTrap.handler);
}

// 解除焦點陷阱
function untrapFocus() {
    if (currentFocusTrap) {
        document.removeEventListener('keydown', currentFocusTrap.handler);
        currentFocusTrap = null;
    }
}

// 切換音效開關
function toggleSound() {
    soundEnabled = !soundEnabled;
    const btn = getDomElement('soundToggle');
    if (btn) {
        btn.textContent = soundEnabled ? '🔊' : '🔇';
        btn.classList.toggle('muted', !soundEnabled);
    }
    // 儲存音效設定
    safeLocalStorageSet('musicTheorySound', soundEnabled ? 'on' : 'off');
}

// 載入音效設定
function loadSoundSetting() {
    const saved = localStorage.getItem('musicTheorySound');
    if (saved === 'off') {
        soundEnabled = false;
        const btn = getDomElement('soundToggle');
        if (btn) {
            btn.textContent = '🔇';
            btn.classList.add('muted');
        }
    }
}
loadSoundSetting();

// 專注模式 - 隱藏分數和統計，專心學習
function toggleFocusMode() {
    document.body.classList.toggle('focus-mode');
    const isFocusMode = document.body.classList.contains('focus-mode');
    const btn = getDomElement('focusToggle');
    if (btn) {
        btn.textContent = isFocusMode ? '🎯' : '👁️';
        btn.classList.toggle('active', isFocusMode);
    }
    // 儲存專注模式設定
    safeLocalStorageSet('musicTheoryFocusMode', isFocusMode ? 'on' : 'off');
}

// 載入專注模式設定
function loadFocusModeSetting() {
    const saved = localStorage.getItem('musicTheoryFocusMode');
    if (saved === 'on') {
        document.body.classList.add('focus-mode');
        const btn = getDomElement('focusToggle');
        if (btn) {
            btn.textContent = '🎯';
            btn.classList.add('active');
        }
    }
}
loadFocusModeSetting();

// 切換遊戲暫停/繼續狀態
function togglePause() {
    isPaused = !isPaused;
    
    // 檢查是否已有 pause overlay，沒有的話創建一個
    let pauseOverlay = getDomElement('pauseOverlay');
    if (!pauseOverlay) {
        pauseOverlay = document.createElement('div');
        pauseOverlay.id = 'pauseOverlay';
        pauseOverlay.className = 'pause-overlay';
        pauseOverlay.innerHTML = `
            <div class="pause-content">
                <h2>⏸️ 遊戲暫停</h2>
                <p>按下 <kbd>P</kbd> 或 <kbd>Esc</kbd> 繼續遊戲</p>
            </div>
        `;
        document.body.appendChild(pauseOverlay);
    }
    
    if (isPaused) {
        pauseOverlay.classList.add('show');
        // 暫停時停止答題計時（保留剩餘時間）
        stopPlayTimeTracker();
        pauseQuestionTimer();
    } else {
        pauseOverlay.classList.remove('show');
        // 恢復時繼續答題計時（從剩餘時間繼續倒數）
        startPlayTimeTracker();
        resumeQuestionTimer();
    }
}

// 切換答題計時模式
function toggleQuestionTimer() {
    questionTimerEnabled = !questionTimerEnabled;
    
    // 更新 stats 區域的計時器狀態指示
    const timerStatusEl = getDomElement('timerStatus');
    const timerStatBox = getDomElement('timerStatBox');
    if (timerStatusEl) {
        timerStatusEl.textContent = questionTimerEnabled ? '⏱️' : '⏱️';
        timerStatusEl.style.color = questionTimerEnabled ? '#00bfff' : '#aaa';
    }
    if (timerStatBox) {
        timerStatBox.style.opacity = questionTimerEnabled ? '1' : '0.5';
    }
    
    // 顯示提示
    const feedbackEl = getDomElement('feedback');
    if (feedbackEl) {
        feedbackEl.textContent = questionTimerEnabled ? '⏱️ 答題計時已開啟' : '⏱️ 答題計時已關閉';
        feedbackEl.style.color = questionTimerEnabled ? '#00bfff' : '#aaa';
        feedbackEl.classList.add('show');
        setTimeout(() => feedbackEl.classList.remove('show'), 1500);
    }
    
    // 如果正在答題中，根據新狀態決定是否開始計時
    if (currentQuestion && !isPaused) {
        if (questionTimerEnabled) {
            startQuestionTimer();
        } else {
            stopQuestionTimer();
        }
    }
    
    // 更新計時器顯示
    updateQuestionTimerDisplay();
}

// 開始答題計時
function startQuestionTimer() {
    if (!questionTimerEnabled || isPaused || !currentQuestion || isAnswering) return;
    
    stopQuestionTimer(); // 先清除之前的計時器
    questionTimeRemaining = questionTimeLimit;
    
    updateQuestionTimerDisplay();
    
    questionTimer = setInterval(() => {
        questionTimeRemaining--;
        updateQuestionTimerDisplay();
        
        if (questionTimeRemaining <= 0) {
            stopQuestionTimer();
            // 時間到視為答錯
            handleTimeout();
        }
    }, 1000);
}

// 暫停答題計時（遊戲暫停時呼叫）
function pauseQuestionTimer() {
    if (questionTimer) {
        clearInterval(questionTimer);
        questionTimer = null;
        // 儲存剩餘時間，恢復時繼續倒數
        // questionTimeRemaining 保持不變
    }
}

// 恢復答題計時（遊戲恢復時呼叫）
function resumeQuestionTimer() {
    if (questionTimerEnabled && questionTimeRemaining > 0 && !isPaused && currentQuestion && !isAnswering) {
        questionTimer = setInterval(() => {
            questionTimeRemaining--;
            updateQuestionTimerDisplay();
            
            if (questionTimeRemaining <= 0) {
                stopQuestionTimer();
                // 時間到視為答錯
                handleTimeout();
            }
        }, 1000);
    }
}

// 停止答題計時
function stopQuestionTimer() {
    if (questionTimer) {
        clearInterval(questionTimer);
        questionTimer = null;
    }
    questionTimeRemaining = 0;
    updateQuestionTimerDisplay();
}

// 更新計時器顯示
function updateQuestionTimerDisplay() {
    let timerEl = getDomElement('questionTimer');
    if (!timerEl) {
        // 如果元素不存在，使用快取的遊戲區域或重新查詢
        let gameArea = cachedGameArea;
        if (!gameArea) {
            gameArea = document.querySelector('.game-area.active');
            cachedGameArea = gameArea; // 快取起來供後續使用
        }
        if (gameArea) {
            timerEl = document.createElement('div');
            timerEl.id = 'questionTimer';
            timerEl.className = 'question-timer';
            gameArea.insertBefore(timerEl, gameArea.firstChild);
            // 將新創建的元素加入緩存
            domCache['questionTimer'] = timerEl;
        }
    }
    
    if (timerEl) {
        if (questionTimerEnabled && questionTimeRemaining > 0) {
            timerEl.textContent = `⏱️ ${questionTimeRemaining}秒`;
            timerEl.style.display = 'block';
            
            // 根據剩餘時間調整顏色
            if (questionTimeRemaining <= 3) {
                timerEl.style.color = '#ff6b6b';
                timerEl.style.animation = 'pulse 0.5s infinite';
            } else if (questionTimeRemaining <= 5) {
                timerEl.style.color = '#ffd700';
                timerEl.style.animation = 'pulse 1s infinite';
            } else {
                timerEl.style.color = '#4caf50';
                timerEl.style.animation = 'none';
            }
        } else {
            timerEl.style.display = 'none';
        }
    }
}

// 顯示正確答案（超時或答錯時呼叫）
function showCorrectAnswer() {
    const buttons = document.querySelectorAll('.option-btn');
    buttons.forEach((btn, index) => {
        const btnValue = currentOptions[index];
        if (String(btnValue) === String(currentQuestion)) {
            btn.classList.add('correct');
        }
        btn.disabled = true;
    });
}

function handleTimeout() {
    if (!currentQuestion || isAnswering) return;
    
    isAnswering = true;
    
    // 顯示時間到提示
    const feedbackEl = getDomElement('feedback');
    if (feedbackEl) {
        feedbackEl.textContent = '⌛ 時間到！';
        feedbackEl.style.color = '#ff6b6b';
        feedbackEl.classList.add('show');
    }
    
    // 扣分（但不分數扣到負數）
    score = Math.max(0, score - 5);
    streak = 0; // 連續答對歸零
    
    // 顯示正確答案
    showCorrectAnswer();
    
    // 更新 UI
    updateUI();
    saveProgressDebounced();
    
    // 2秒後進入下一題
    setTimeout(() => {
        isAnswering = false;
        feedbackEl.classList.remove('show');
        nextQuestion();
    }, 2000);
}

// 鍵盤事件監聽
document.addEventListener('keydown', (e) => {
    // 防止重複觸發（按住不放）
    if (e.repeat) return;
    
    // P 鍵：暫停/繼續遊戲
    if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        togglePause();
        return;
    }
    
    // ESC 鍵：退出遊戲返回首頁（當有題目在進行中時）
    if (e.key === 'Escape') {
        e.preventDefault();
        // 有題目在進行中時，返回首頁（清除題目、停止計時、隱藏反饋）
        if (currentQuestion && !isPaused) {
            showHome();
            return;
        }
    }
    
    // F 鍵：切換專注模式
    if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFocusMode();
        return;
    }
    
    // T 鍵：切換答題計時模式
    if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        toggleQuestionTimer();
        return;
    }
    
    // 遊戲暫停時不處理其他鍵盤事件
    if (isPaused) return;
    
    // 箭頭鍵導航：選項按鈕的上下左右導航（提升鍵盤可訪問性）
    const optionButtons = document.querySelectorAll('.option-btn');
    const activeIndex = Array.from(optionButtons).findIndex(btn => btn.classList.contains('keyboard-focus'));
    const gridColumns = 2; // 假設選項為 2x2 或 2x3 配置
    
    if (optionButtons.length > 0) {
        // 右箭头：下一個選項
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            const nextIndex = activeIndex < 0 ? 0 : Math.min(activeIndex + 1, optionButtons.length - 1);
            optionButtons.forEach(btn => btn.classList.remove('keyboard-focus'));
            optionButtons[nextIndex].classList.add('keyboard-focus');
            return;
        }
        // 左箭头：上一個選項
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            const prevIndex = activeIndex < 0 ? 0 : Math.max(activeIndex - 1, 0);
            optionButtons.forEach(btn => btn.classList.remove('keyboard-focus'));
            optionButtons[prevIndex].classList.add('keyboard-focus');
            return;
        }
        // 下箭头：下一行選項
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextRowIndex = activeIndex < 0 ? gridColumns : Math.min(activeIndex + gridColumns, optionButtons.length - 1);
            optionButtons.forEach(btn => btn.classList.remove('keyboard-focus'));
            optionButtons[nextRowIndex].classList.add('keyboard-focus');
            return;
        }
        // 上箭头：上一行選項
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prevRowIndex = activeIndex < 0 ? optionButtons.length - gridColumns : Math.max(activeIndex - gridColumns, 0);
            optionButtons.forEach(btn => btn.classList.remove('keyboard-focus'));
            optionButtons[prevRowIndex].classList.add('keyboard-focus');
            return;
        }
        
        // 數字鍵 1-4：快速選擇答案（改善鍵盤使用者體驗）
        const num = parseInt(e.key);
        if (num >= 1 && num <= 4 && !isAnswering && currentQuestion) {
            const btnIndex = num - 1;
            if (btnIndex < optionButtons.length && !document.querySelector('.option-btn.correct')) {
                if (!currentOptions || !currentOptions.length) return;
                
                e.preventDefault();
                playKeyPressSound();
                const selectedAnswer = currentOptions[btnIndex];
                setTimeout(() => {
                    checkAnswer(selectedAnswer, currentQuestion);
                }, 100);
                return;
            }
        }
    }
    
    // Enter 鍵：當使用 Tab 鍵導航到選項時，按 Enter 確認答案
    // 防呆檢查：確保有題目在進行中
    if (e.key === 'Enter' && !isAnswering && currentQuestion) {
        const focusedBtn = document.activeElement;
        if (focusedBtn && focusedBtn.classList.contains('option-btn') && !document.querySelector('.option-btn.correct')) {
            // 安全檢查：確保 currentOptions 存在
            if (!currentOptions || !currentOptions.length) return;
            
            e.preventDefault();
            // 找到 focusedBtn 在所有 option-btn 中的索引
            const allBtns = Array.from(document.querySelectorAll('.option-btn'));
            const btnIndex = allBtns.indexOf(focusedBtn);
            if (btnIndex >= 0 && btnIndex < currentOptions.length) {
                const selectedAnswer = currentOptions[btnIndex];
                playKeyPressSound();
                setTimeout(() => {
                    checkAnswer(selectedAnswer, currentQuestion);
                }, 150);
            }
        }
    }
    
    // 數字鍵 1-4 選擇答案（Level 1 可用 1-7）
    // 防呆檢查：確保有題目在進行中且不在答題中，才處理答題快捷鍵
    // 注意：第一個數字鍵處理器（上面）已有 !isAnswering 檢查，這裡再次檢查以防第一個處理器因按鈕範圍外而略過時，此處理器仍會執行
    const maxOptions = currentLevel === 1 ? 7 : 4;
    if (!isAnswering && currentQuestion && e.key >= '1' && e.key <= String(maxOptions)) {
        // 安全檢查：確保 currentOptions 存在且有內容
        if (!currentOptions || !currentOptions.length) return;
        
        const index = parseInt(e.key) - 1;
        
        // 清除之前的鍵盤焦點樣式和動畫
        document.querySelectorAll('.option-btn.keyboard-focus').forEach(btn => {
            btn.classList.remove('keyboard-focus');
        });
        
        // 添加鍵盤聚焦樣式到目前選項
        const buttons = document.querySelectorAll('.option-btn');
        if (buttons[index]) {
            buttons[index].classList.add('keyboard-focus');
            // 添加按鍵動畫效果提供視覺反饋
            buttons[index].classList.add('keypress-anim');
            // 動畫結束後移除類別，以便下次可以再次觸发动畫
            setTimeout(() => {
                buttons[index].classList.remove('keypress-anim');
            }, 150);
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
            
            // 延遲一點時間再答題，讓用戶能看到選擇的選項（視覺反饋）
            // 同時播放按鍵音效提供聽覺反饋
            playKeyPressSound();
            setTimeout(() => {
                checkAnswer(option, correctAnswer);
            }, 150);
        }
    }
    // Q/W/E/R 選擇關卡（Level 4 除外，避免與鋼琴鍵盤快捷鍵衝突）
    // 數字鍵 1-4 也可用於關卡切換，但只有在小答題時才允許
    // 修復：只有當沒有顯示答題選項時才允許切換關卡，避免與答題快捷鍵衝突
    const hasActiveOptions = currentOptions && currentOptions.length > 0;
    if (!isAnswering && !hasActiveOptions) {
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
    // H 鍵顯示幫助說明
    if (e.key.toLowerCase() === 'h') {
        e.preventDefault();
        showHelp();
    }
    // Escape 鍵：暫停時恢復遊戲，否則關閉 Modal 或重新開始關卡
    if (e.key === 'Escape') {
        e.preventDefault();
        
        // 如果遊戲已暫停，先恢復遊戲
        if (isPaused) {
            togglePause();
            return;
        }
        
        const helpModal = getDomElement('helpModal');
        const historyModal = getDomElement('historyModal');
        
        // 檢查並關閉所有開啟的 Modal
        if (helpModal && helpModal.classList.contains('show')) {
            closeHelp();
        } else if (historyModal && historyModal.classList.contains('show')) {
            closeAnswerHistory();
        } else {
            // 沒有 Modal 開啟時，重新開始當前關卡
            questionsAnswered = 0;
            correctAnswers = 0;
            streak = 0;
            updateProgress();
            nextQuestion();
        }
    }
    // 鋼琴鍵盤快捷鍵 - 所有關卡可用，允許自由練習鋼琴
    // 不再限制只能在 Level 4 使用，方便用戶在所有關卡練習鋼琴
    if (!e.repeat) {
        const pianoKey = pianoKeys.find(k => k.key === e.key.toLowerCase());
        if (pianoKey) {
            e.preventDefault();
            playPianoKey(pianoKey.note);
            // 使用緩存添加視覺反饋（效能優化）
            let keyElement = pianoKeyElementsCache[pianoKey.note];
            if (!keyElement) {
                keyElement = document.querySelector(`.key[data-note="${pianoKey.note}"]`);
                if (keyElement) pianoKeyElementsCache[pianoKey.note] = keyElement;
            }
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
    // 鋼琴鍵盤快捷鍵 - 所有關卡可用
    const pianoKey = pianoKeys.find(k => k.key === e.key.toLowerCase());
    if (pianoKey) {
        // 使用緩存獲取元素（效能優化）
        let keyElement = pianoKeyElementsCache[pianoKey.note];
        if (!keyElement) {
            keyElement = document.querySelector(`.key[data-note="${pianoKey.note}"]`);
            if (keyElement) pianoKeyElementsCache[pianoKey.note] = keyElement;
        }
        if (keyElement) {
            keyElement.classList.remove('playing');
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

// 鋼琴音色模擬：使用多個泛音讓聲音更真實
// 泛音配置：頻率倍數 / 相對音量
const pianoHarmonics = [
    { ratio: 1, gain: 1.0 },    // 基頻
    { ratio: 2, gain: 0.5 },    // 第二泛音 (八度)
    { ratio: 3, gain: 0.25 },  // 第三泛音
    { ratio: 4, gain: 0.125 }, // 第四泛音
    { ratio: 5, gain: 0.0625 }  // 第五泛音
];

function playNote(note) {
    if (!soundEnabled) return;
    if (!note || typeof noteFreqs[note] === 'undefined') {
        console.warn('Invalid note:', note);
        return;
    }
    const ctx = getAudioContext();
    if (!ctx) {
        // 音頻不支持時提供視覺反饋
        showAudioNotSupportedHint();
        return;
    }
    
    const baseFreq = noteFreqs[note];
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    masterGain.gain.setValueAtTime(0.3, ctx.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
    
    // 使用多個振盪器模擬鋼琴泛音
    pianoHarmonics.forEach((harmonic, index) => {
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        
        osc.connect(oscGain);
        oscGain.connect(masterGain);
        
        osc.frequency.value = baseFreq * harmonic.ratio;
        osc.type = index === 0 ? 'triangle' : 'sine'; // 基頻用三角波更有穿透力
        oscGain.gain.setValueAtTime(harmonic.gain, ctx.currentTime);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.8);
        
        osc.onended = () => cleanupAudioNodes(osc, oscGain);
    });
    
    // 確保 masterGain 也會被清理
    setTimeout(() => cleanupAudioNodes(masterGain), 1000);
}

// 按鍵音效 - 數字鍵按下時的輕脆提示音
function playKeyPressSound() {
    // 觸發輕微震動回饋
    triggerHapticFeedback('light');
    if (!soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800; // 較高的頻率，聽起來像輕脆的點擊聲
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
    // 使用統一的清理函數，確保音頻節點完全斷開連接（防止記憶體洩漏）
    osc.onended = () => cleanupAudioNodes(osc, gain);
    // 額外保護：設定超時後強制清理（以防 onended 回調未觸發）
    setTimeout(() => cleanupAudioNodes(osc, gain), 100);
}

function setLevel(level, resetStats = true) {
    // 切換關卡時清除 DOM 緩存，避免返回已分離的元素
    clearDomCache();
    
    currentLevel = level;
    document.querySelectorAll('.level-btn').forEach((btn, i) => {
        const isActive = i + 1 === level;
        btn.classList.toggle('active', isActive);
        // 更新 aria-pressed 屬性以支援螢幕閱讀器
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    // 只有在明確要求重置統計時才重置（避免頁面載入時丢失進度）
    if (resetStats) {
        questionsAnswered = 0;
        correctAnswers = 0;
        updateProgress();
        saveProgress();
    }
    nextQuestion();
}

function updateProgress() {
    const progress = questionsAnswered > 0 ? (correctAnswers / questionsAnswered) * 100 : 0;
    const progressEl = getDomElement('progress');
    if (progressEl) progressEl.style.width = progress + '%';
}

function nextQuestion() {
    // 暫停時不生成新題目
    if (isPaused) return;
    
    const feedbackEl = getDomElement('feedback');
    if (feedbackEl) feedbackEl.textContent = '';
    // 清除所有選項按鈕的狀態樣式（鍵盤焦點、對錯標記）
    document.querySelectorAll('.option-btn').forEach(btn => {
        btn.classList.remove('keyboard-focus', 'correct', 'wrong');
    });
    
    // 使用 CSS class 觸发动畫（效能更好，不會移除事件監聽器）
    const questionArea = getDomElement('questionArea');
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
    
    // 開始答題計時
    if (questionTimerEnabled && !isPaused) {
        startQuestionTimer();
    }
}

// 鋼琴事件綁定狀態追蹤
let pianoEventsBound = false;

// 儲存事件處理器以便清理（防止記憶體洩漏）
const pianoEventHandlers = {
    touchstart: function() {},
    touchend: function() {},
    touchcancel: function() {},
    touchmove: function() {},
    mousedown: function() {},
    mouseup: function() {},
    mouseleave: function() {}
};

// 追蹤 active touch points（防止多指觸控時的按鍵卡住）
const activeTouches = new Map();

function bindPianoEvents() {
    // 使用 document 層級的事件委託，所以綁定一次就足夠
    // 這樣無論用戶如何切換關卡，鋼琴事件都會正常工作
    if (pianoEventsBound) return;
    pianoEventsBound = true;
    
    // 使用 document 層級的事件委託
    // 這樣每次更換題目時，雖然 .piano 元素被替換，但事件監聽仍然有效
    // 處理觸控和滑鼠事件
    
    // 儲存處理器以便清理（使用具名函數以便 removeEventListener）
    pianoEventHandlers.touchstart = function(e) {
        // 處理每個 touch point，支援多指同時觸控
        for (const touch of e.changedTouches) {
            const key = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.key');
            if (key && key.dataset.note && key.closest('.piano')) {
                e.preventDefault();
                key.classList.add('playing');
                // 追蹤這個 touch point 對應的音符
                activeTouches.set(touch.identifier, { key, note: key.dataset.note });
                playPianoKey(key.dataset.note);
            }
        }
    };
    
    pianoEventHandlers.touchmove = function(e) {
        // 防止在滑動時選取文字或觸發其他預設行為
        e.preventDefault();
        
        // 支援手指在琴鍵上滑動時即時切換音符
        for (const touch of e.changedTouches) {
            const tracked = activeTouches.get(touch.identifier);
            if (tracked) {
                const key = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.key');
                if (key && key.dataset.note && key.closest('.piano') && key !== tracked.key) {
                    // 離開舊按鍵
                    tracked.key.classList.remove('playing');
                    // 進入新按鍵
                    key.classList.add('playing');
                    activeTouches.set(touch.identifier, { key, note: key.dataset.note });
                    playPianoKey(key.dataset.note);
                }
            }
        }
    };
    
    pianoEventHandlers.touchend = function(e) {
        // 處理每個結束的 touch point
        for (const touch of e.changedTouches) {
            const tracked = activeTouches.get(touch.identifier);
            if (tracked && tracked.key) {
                tracked.key.classList.remove('playing');
                activeTouches.delete(touch.identifier);
            }
        }
    };
    
    // 處理觸控取消（防呆）- 清理所有正在進行的觸控
    pianoEventHandlers.touchcancel = function(e) {
        document.querySelectorAll('.piano .key.playing').forEach(key => {
            key.classList.remove('playing');
        });
        activeTouches.clear();
    };
    
    pianoEventHandlers.mousedown = function(e) {
        const key = e.target.closest('.key');
        if (key && key.dataset.note && key.closest('.piano')) {
            key.classList.add('playing');
            playPianoKey(key.dataset.note);
        }
    };
    
    pianoEventHandlers.mouseup = function(e) {
        const key = e.target.closest('.key');
        if (key && key.closest('.piano')) {
            key.classList.remove('playing');
        }
    };
    
    pianoEventHandlers.mouseleave = function(e) {
        const key = e.target.closest('.key');
        if (key && key.closest('.piano')) {
            key.classList.remove('playing');
        }
    };
    
    // 綁定事件監聽器
    document.addEventListener('touchstart', pianoEventHandlers.touchstart, { passive: false });
    document.addEventListener('touchend', pianoEventHandlers.touchend, { passive: false });
    document.addEventListener('touchcancel', pianoEventHandlers.touchcancel, { passive: false });
    document.addEventListener('touchmove', pianoEventHandlers.touchmove, { passive: false });
    document.addEventListener('mousedown', pianoEventHandlers.mousedown);
    document.addEventListener('mouseup', pianoEventHandlers.mouseup);
    document.addEventListener('mouseleave', pianoEventHandlers.mouseleave);
}

// 清理鋼琴事件監聽器（防止記憶體洩漏）
function cleanupPianoEvents() {
    if (!pianoEventsBound) return;
    
    // 正確移除事件監聽器 - 必須在修改 handler 之前移除
    document.removeEventListener('touchstart', pianoEventHandlers.touchstart);
    document.removeEventListener('touchend', pianoEventHandlers.touchend);
    document.removeEventListener('touchcancel', pianoEventHandlers.touchcancel);
    document.removeEventListener('touchmove', pianoEventHandlers.touchmove);
    document.removeEventListener('mousedown', pianoEventHandlers.mousedown);
    document.removeEventListener('mouseup', pianoEventHandlers.mouseup);
    document.removeEventListener('mouseleave', pianoEventHandlers.mouseleave);
    
    // 重置狀態標記，保留 handler 函數引用以便下次綁定時能正確移除
    // 不要用空函數替換 handler，否則會導致 removeEventListener 失效（函數引用不同）
    pianoEventsBound = false;
    activeTouches.clear();
}

// 頁面卸載時清理事件監聽器（防止記憶體洩漏）
window.addEventListener('beforeunload', cleanupPianoEvents);
window.addEventListener('unload', cleanupPianoEvents); // 相容性備用

// 🌱 Level 1: 認識音符 - 聽聲音選音符
function level1Question() {
    const correctNote = notes[Math.floor(Math.random() * notes.length)];
    currentQuestion = correctNote;
    
    // 洗牌選項，確保顯示順序與 currentOptions 一致
    const shuffledNotes = shuffleArray([...notes]);
    currentOptions = shuffledNotes; // 儲存洗牌後的選項順序
    
    const html = `
        <p class="hint">🎧 點擊播放鍵，聽聽是什麼音符？ (按 1-7 選答案 | 空白 播放聲音)</p>
        <div class="play-buttons">
            <button class="play-btn" data-play="${correctNote}" aria-label="播放音符">🔊</button>
            <button class="replay-btn" data-play="${correctNote}">🔄 再聽一次</button>
        </div>
        <div class="options">
            ${shuffledNotes.map((n, i) => `<button class="option-btn" onclick="checkAnswer('${n}','${correctNote}')" aria-label="選項 ${i+1}: ${n}"><span class="key-hint">${i+1}</span>${n}</button>`).join('')}
        </div>
    `;
    getDomElement('questionArea').innerHTML = html;
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
        <p class="hint">🎧 ${question} (按 1-4 選答案 | 空白 播放聲音)</p>
        <div class="note-display">${note}</div>
        <button class="replay-btn" data-play="${note}">🔊 再聽一次</button>
        <div class="options">
            ${options.map((n, i) => `<button class="option-btn" onclick="checkAnswer('${n}','${correctAnswer}')" aria-label="選項 ${i+1}: ${n}"><span class="key-hint">${i+1}</span>${n}</button>`).join('')}
        </div>
    `;
    getDomElement('questionArea').innerHTML = html;
}

// 🎼 Level 3: 節奏練習
const rhythms = [
    { name: '四分音符', beats: 1, symbol: '♩', duration: 0.5 },
    { name: '二分音符', beats: 2, symbol: '𝅗𝅥', duration: 1.0 },
    { name: '全音符', beats: 4, symbol: '𝅝', duration: 2.0 },
    { name: '八分音符', beats: 0.5, symbol: '♪', duration: 0.25 }
];

// 播放節奏音效 - 使用點擊音效模擬節拍器，增強節奏學習體驗
function playRhythm(rhythm) {
    if (!soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const totalDuration = rhythm.duration || 0.5; // 總節奏長度（秒）
    const beatCount = rhythm.beats || 1;           // 總拍數
    const clickInterval = totalDuration / beatCount; // 每拍之間的間隔（秒）

    // 使用 AudioContext 的當前時間作為基準
    const startTime = ctx.currentTime + 0.05; // 稍微延遲一點，讓聲音更自然

    for (let i = 0; i < beatCount; i++) {
        const clickTime = startTime + i * clickInterval;

        // 為每個點擊建立獨立的振盪器和增益節點
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        // 較高的頻率更像節拍器的「滴」聲
        osc.frequency.value = 880;
        osc.type = 'square'; // 方波有更清脆的打擊感

        // 短促的音量包絡：快速 attack，快速 decay
        // 這讓每個 click 都是獨立的脈衝，而不是連續的嗡嗡聲
        gain.gain.setValueAtTime(0, clickTime);
        gain.gain.linearRampToValueAtTime(0.25, clickTime + 0.005);  // 快速上升
        gain.gain.exponentialRampToValueAtTime(0.001, clickTime + 0.08); // 快速衰減

        osc.start(clickTime);
        osc.stop(clickTime + 0.1);

        // 清理音頻節點，防止記憶體洩漏
        osc.onended = () => cleanupAudioNodes(osc, gain);
        setTimeout(() => cleanupAudioNodes(osc, gain), (clickTime - ctx.currentTime + 0.15) * 1000 + 100);
    }
}

function level3Question() {
    const rhythm = rhythms[Math.floor(Math.random() * rhythms.length)];
    currentQuestion = rhythm.name;
    
    const options = [0.5, 1, 2, 4];
    // 建立 beats 到音符名稱的映射，確保鍵盤答題時能正確比對
    const beatsToName = { 0.5: '八分音符', 1: '四分音符', 2: '二分音符', 4: '全音符' };
    currentOptions = options.map(n => beatsToName[n]); // 儲存音符名稱以便正確比對
    
    // 音符名稱用於內部比對，但不在題目中顯示，避免用戶直接讀名稱猜答案
    const html = `
        <p class="hint">這個符號代表幾拍？（按 1-4 選答案 | 空白 播放節奏）</p>
        <div class="note-display rhythm-symbol">${rhythm.symbol}</div>
        <button class="play-btn" onclick="playRhythmByName('${rhythm.name}')" aria-label="播放節奏">🔊</button>
        <div class="options">
            ${options.map((n, i) => `<button class="option-btn" onclick="checkAnswer('${beatsToName[n]}','${rhythm.name}')" aria-label="選項 ${i+1}: ${beatsToName[n]}"><span class="key-hint">${i+1}</span>${beatsToName[n]}</button>`).join('')}
        </div>
    `;
    getDomElement('questionArea').innerHTML = html;
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
    { name: 'Dm和弦', notes: ['Re','Fa','La'], symbol: 'Dm' },
    { name: 'Am和弦', notes: ['La','Do','Mi'], symbol: 'Am' },
    { name: 'Em和弦', notes: ['Mi','Sol','Si'], symbol: 'Em' },
    { name: 'G7和弦', notes: ['Sol','Si','Re','Fa'], symbol: 'G7' }
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
    // 檢查音效開關狀態
    if (!soundEnabled) return;
    
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
    // 使用統一的清理函數
    osc.onended = () => cleanupAudioNodes(osc, gain);
}

// 鋼琴鍵盤布局：白鍵 + 黑鍵位置
// 黑鍵位置根據鋼琴八度內的相對位置計算
// 標準鋼琴配置：Do-Re-Mi-Fa-Sol-La-Si，白鍵之間的黑鍵是 Do♯、Re♯、Fa♯、Sol♯、La♯
// 注意：Mi-Fa 之間和 Si-Do 之間沒有黑鍵！
const pianoKeys = [
    { note: 'Do', isBlack: false, key: 'a' },
    { note: 'Do♯', isBlack: true, key: 'w' },
    { note: 'Re', isBlack: false, key: 's' },
    { note: 'Re♯', isBlack: true, key: 'e' },
    { note: 'Mi', isBlack: false, key: 'd' },
    { note: 'Fa', isBlack: false, key: 'f' },
    { note: 'Fa♯', isBlack: true, key: 't' },
    { note: 'Sol', isBlack: false, key: 'g' },
    { note: 'Sol♯', isBlack: true, key: 'y' },
    { note: 'La', isBlack: false, key: 'h' },
    { note: 'La♯', isBlack: true, key: 'u' },
    { note: 'Si', isBlack: false, key: 'j' }
];

// 鋼琴元素緩存 - 避免重複 DOM 查詢（效能優化）
// 使用音符名稱作為 key，快速查找鋼琴按鍵元素
const pianoKeyElementsCache = {};

// 初始化鋼琴元素緩存 - 在鋼琴 DOM 生成後調用
function cachePianoElements() {
    // 清空快取（pianoKeyElementsCache 是物件，不是陣列，所以不能用 length = 0）
    for (const key in pianoKeyElementsCache) {
        delete pianoKeyElementsCache[key];
    }
    const pianoKeys_ = document.querySelectorAll('.piano .key');
    pianoKeys_.forEach(key => {
        const note = key.dataset.note;
        if (note) {
            pianoKeyElementsCache[note] = key;
        }
    });
}

function level4Question() {
    const chord = chords[Math.floor(Math.random() * chords.length)];
    currentQuestion = chord.name;
    
    // 從所有和弦中隨機選擇 4 個作為選項（包含正確答案）
    // 先過濾掉正確答案，再隨機選 3 個，最後加入正確答案並洗牌
    const otherChords = chords.filter(c => c.name !== chord.name);
    const shuffledOthers = shuffleArray(otherChords).slice(0, 3);
    const optionChords = shuffleArray([chord, ...shuffledOthers]);
    currentOptions = optionChords.map(c => c.name);
    
    // 直接使用 chord.notes
    const activeKeys = chord.notes;
    
    // 使用 DocumentFragment 優化 DOM 渲染效能（減少 layout thrashing）
    const pianoContainer = document.createDocumentFragment();
    
    pianoKeys.forEach(k => {
        const keyEl = document.createElement('div');
        const isHighlight = activeKeys.includes(k.note);
        
        if (k.isBlack) {
            // 使用 CSS Grid 定位（黑鍵由 grid-column 控制）
            // 同步套用 highlight 樣式（為未來擴充做準備）
            keyEl.className = `key black${isHighlight ? ' highlight' : ''}`;
            keyEl.dataset.note = k.note;
            keyEl.title = `${k.note} (${k.key.toUpperCase()})${isHighlight ? ' - 和弦音符' : ''}`;
            keyEl.setAttribute('role', 'button');
            keyEl.setAttribute('aria-label', `${k.note} 的黑鍵，按鍵 ${k.key.toUpperCase()}${isHighlight ? '，和弦音符' : ''}`);
            keyEl.setAttribute('aria-pressed', isHighlight ? 'true' : 'false');
            keyEl.setAttribute('tabindex', '0');
            // 為黑鍵添加鍵盤快捷鍵標籤（使提示更明顯）
            keyEl.innerHTML = `<span class="piano-key-label">${k.key.toUpperCase()}</span>`;
        } else {
            keyEl.className = `key${isHighlight ? ' highlight' : ''}`;
            keyEl.dataset.note = k.note;
            keyEl.setAttribute('role', 'button');
            keyEl.setAttribute('aria-label', `${k.note} 白鍵，按鍵 ${k.key.toUpperCase()}${isHighlight ? '，和弦音符' : ''}`);
            keyEl.setAttribute('aria-pressed', isHighlight ? 'true' : 'false');
            keyEl.setAttribute('tabindex', '0');
            keyEl.innerHTML = `${k.note}<span class="piano-key-label">${k.key.toUpperCase()}</span>`;
        }
        
        pianoContainer.appendChild(keyEl);
    });
    
    // 建立選項按鈕片段
    const optionsContainer = document.createDocumentFragment();
    optionChords.forEach((c, i) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = `${i + 1}. ${c.name}`;
        btn.setAttribute('aria-label', `選項 ${i + 1}: ${c.name}`);
        btn.onclick = () => checkAnswer(c.name, chord.name);
        optionsContainer.appendChild(btn);
    });
    
    // 使用 DOM 元素构建问题区域（DocumentFragment 減少迼回流）
    const questionArea = getDomElement('questionArea');
    questionArea.innerHTML = '';
    
    // 添加提示文字
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '🎧 聽和弦，選擇正確的名稱 (按 1-4 選答案 | 空白 播放和弦 | A-J 彈鋼琴，黃色鍵為和弦組成音) - 無答題時也可自由練習鋼琴！';
    questionArea.appendChild(hint);
    
    // 添加播放按鈕
    const playBtn = document.createElement('button');
    playBtn.style.cssText = 'font-size:3rem;background:linear-gradient(135deg,#9b59b6,#8e44ad);border:none;border-radius:50%;width:100px;height:100px;cursor:pointer;';
    playBtn.textContent = '🔊';
    playBtn.setAttribute('aria-label', '播放和弦');
    playBtn.setAttribute('title', '播放和弦 (鍵盤空白鍵)');
    playBtn.onclick = () => playChord(chord.notes.join(','));
    questionArea.appendChild(playBtn);
    
    // 添加鋼琴容器
    const pianoDiv = document.createElement('div');
    pianoDiv.className = 'piano';
    pianoDiv.appendChild(pianoContainer);
    questionArea.appendChild(pianoDiv);
    
    // 初始化鋼琴元素緩存（效能優化）
    cachePianoElements();
    
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
    // 觸發輕微震動回饋
    triggerHapticFeedback('light');
    // 使用模組層面的 pianoNoteFreqs 物件（避免每次創建新物件）
    playPianoNote(pianoNoteFreqs[note] || 261.63);
    
    // 使用緩存獲取鋼琴按鍵元素（效能優化）
    // 如果緩存中沒有，fallback 到 querySelector
    let keyElement = pianoKeyElementsCache[note];
    if (!keyElement) {
        keyElement = document.querySelector(`.key[data-note="${note}"]`);
        // 更新緩存以便後續使用
        if (keyElement) {
            pianoKeyElementsCache[note] = keyElement;
        }
    }
    
    if (keyElement) {
        keyElement.setAttribute('aria-pressed', 'true');
        setTimeout(() => {
            keyElement.removeAttribute('aria-pressed');
        }, 300);
        
        // 顯示音符名稱彈出提示（視覺回饋）
        showNotePopup(keyElement, note);
    }
}

// 顯示音符名稱彈出提示
function showNotePopup(keyElement, noteName) {
    // 移除舊的彈出提示（避免重複）
    const existingPopup = keyElement.querySelector('.note-popup');
    if (existingPopup) {
        existingPopup.remove();
    }
    
    // 創建新的彈出提示
    const popup = document.createElement('div');
    popup.className = 'note-popup';
    popup.textContent = noteName;
    
    // 根據黑白鍵調整樣式
    const isBlackKey = keyElement.classList.contains('black');
    popup.style.setProperty('--popup-bg', isBlackKey ? 'rgba(255, 215, 0, 0.95)' : 'rgba(233, 69, 96, 0.95)');
    
    keyElement.appendChild(popup);
    
    // 動畫結束後移除元素
    popup.addEventListener('animationend', () => {
        popup.remove();
    });
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
    // 使用統一的清理函數，確保音頻節點完全斷開連接（防止記憶體洩漏）
    osc.onended = () => cleanupAudioNodes(osc, gain);
    // 額外保護：設定超時後強制清理（以防 onended 回調未觸發）
    setTimeout(() => cleanupAudioNodes(osc, gain), 600);
}

// 震動回饋函數 - 支援觸控裝置
function triggerHapticFeedback(type = 'light') {
    // 檢查是否支援震動 API
    if (!navigator.vibrate) return;
    
    try {
        switch(type) {
            case 'light':
                // 輕微震動 - 按鍵反饋
                navigator.vibrate(10);
                break;
            case 'medium':
                // 中等震動 - 答對反饋
                navigator.vibrate(30);
                break;
            case 'heavy':
                // 強烈震動 - 答錯/連擊反饋
                navigator.vibrate([50, 30, 50]);
                break;
            case 'success':
                // 成功震動 - 連擊觸發
                navigator.vibrate([20, 20, 20, 20, 40]);
                break;
            default:
                navigator.vibrate(10);
        }
    } catch (e) {
        // 靜默失敗，避免影響主要功能
    }
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
        // 使用統一的清理函數，確保音頻節點完全斷開連接（防止記憶體洩漏）
        osc.onended = () => cleanupAudioNodes(osc, gain);
        // 額外保護：設定超時後強制清理（以防 onended 回調未觸發）
        setTimeout(() => cleanupAudioNodes(osc, gain), 900);
    });
}

function checkAnswer(answer, correct) {
    // 防止暫停時答題
    if (isPaused) return;
    // 防止重複答題
    if (isAnswering) return;
    // 安全檢查：確保 currentOptions 存在且有內容（防止遊戲狀態錯誤）
    if (!currentOptions || !currentOptions.length) return;
    // 安全檢查：確保有題目在進行中
    if (!currentQuestion) return;
    
    isAnswering = true;
    
    // 停止答題計時
    stopQuestionTimer();
    
    const isCorrect = String(answer) === String(correct);
    questionsAnswered++;
    
    // 先計算得分（需要在使用前先計算）
    const pointsEarned = isCorrect ? 10 + streak * 2 : 0;
    
    // 記錄答題歷史
    addToHistory(currentQuestion, answer, correct, isCorrect, currentLevel);
    
    const feedback = getDomElement('feedback');
    feedback.className = 'feedback ' + (isCorrect ? 'correct' : 'wrong');
    
    // 為螢幕閱讀器提供更清晰的朗讀內容
    const screenReaderText = isCorrect 
        ? `答對了！加 ${pointsEarned} 分`
        : `錯了，正確答案是 ${correct}`;
    feedback.setAttribute('aria-label', screenReaderText);
    feedback.textContent = isCorrect ? `✅ 答對了！ +${pointsEarned} 分` : '❌ 錯了～';
    
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
            // 連擊時觸發成功震動回饋
            triggerHapticFeedback('success');
            setTimeout(() => popup.classList.remove('show'), 1000);
        } else if (streak === 2) {
            // 即將達成連擊！給予視覺提示
            const popup = getDomElement('streakPopup');
            popup.textContent = `💫 再答對一題就是連擊！`;
            popup.classList.add('show');
            popup.style.background = 'rgba(255, 215, 0, 0.3)';
            setTimeout(() => popup.classList.remove('show'), 1500);
        } else {
            // 答對時觸發中等震動回饋
            triggerHapticFeedback('medium');
        }
    } else {
        streak = 0;
        // 答錯時觸發強烈震動回饋
        triggerHapticFeedback('heavy');
    }
    
    const scoreEl = getDomElement('score');
    const streakEl = getDomElement('streakCount');
    if (scoreEl) scoreEl.textContent = score;
    if (streakEl) streakEl.textContent = streak;
    updateProgress();
    
    // 儲存進度到 localStorage（使用 Debounced 版本避免頻繁寫入）
    saveProgressDebounced();
    
    // 答錯顯示正確答案（同步顯示，讓用戶立即看到）
    if (!isCorrect) {
        feedback.textContent += ` 正確答案是：${correct}`;
        feedback.setAttribute('aria-label', `錯了，正確答案是 ${correct}`);
    }

    // 播放答題結果的音效反饋（立即播放，提供即時聽覺反饋）
    playAnswerFeedback(isCorrect);
    
    // 優化時序：縮短等待時間，讓用戶更快進入下一題
    // 同時保留足夠時間顯示動畫和反饋
    setTimeout(() => {
        isAnswering = false; // 重置答題鎖定
        nextQuestion();
    }, 1200);
}

// 初始化 - 恢復儲存的進度（不重置統計資料）
const initScoreEl = getDomElement('score');
const initStreakEl = getDomElement('streakCount');
if (initScoreEl) initScoreEl.textContent = score;
if (initStreakEl) initStreakEl.textContent = streak;
updateAccuracy();
updateProgress();
setLevel(currentLevel, false);

// 初始化遊戲時長顯示（使用 HTML 中已存在的元素）
const playTimeDisplay = getDomElement('playTimeDisplay');
if (playTimeDisplay) {
    playTimeDisplay.textContent = formatPlayTime(totalPlayTime);
}

// 啟動遊戲時長計時器
startPlayTimeTracker();

// 顯示歡迎回來提示（如果有之前的記錄）
if (savedProgress && savedProgress.lastPlayed) {
    showWelcomeBack(savedProgress.lastPlayed);
} else {
    // 首次遊戲，顯示歡迎提示
    showFirstTimeWelcome();
}

// 返回首頁：清除題目、停止計時、隱藏反饋，恢復初始狀態
function showHome() {
    // 清除當前題目狀態
    currentQuestion = null;
    currentOptions = [];

    // 停止答題計時
    stopQuestionTimer();

    // 重置答題鎖
    isAnswering = false;

    // 清除反饋訊息
    const feedbackEl = getDomElement('feedback');
    if (feedbackEl) {
        feedbackEl.textContent = '';
        feedbackEl.className = 'feedback';
    }

    // 隱藏暫停 overlay（如果有的話）
    const pauseOverlay = getDomElement('pauseOverlay');
    if (pauseOverlay) {
        pauseOverlay.classList.remove('show');
    }
    isPaused = false;
    isPausedByVisibility = false;

    // 清除 questionArea 內容，恢復初始提示
    const questionArea = getDomElement('questionArea');
    if (questionArea) {
        questionArea.innerHTML = '<p class="hint">選擇上方關卡開始學習音樂吧！</p>';
    }
}

// 檢查每日簽到獎勵
checkDailyLogin();

// 顯示幫助 Modal
function showHelp() {
    const modal = getDomElement('helpModal');
    modal.classList.add('show');
    // 可訪問性：啟用焦點陷阱，防止 Tab 離開 Modal
    trapFocus(modal);
}

// 關閉幫助 Modal
function closeHelp() {
    const modal = getDomElement('helpModal');
    if (modal) {
        // 可訪問性：解除焦點陷阱
        untrapFocus();
        // 支援兩種關閉方式：class='show' 或 直接移除元素
        if (modal.classList.contains('show')) {
            modal.classList.remove('show');
        } else if (modal.parentElement) {
            modal.remove();
        }
    }
}

// 點擊 Modal 背景關閉
const helpModal = getDomElement('helpModal');
if (helpModal) {
    helpModal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeHelp();
        }
    });
}

// 歷史記錄 Modal 點擊背景關閉
document.addEventListener('click', (e) => {
    const historyModal = getDomElement('historyModal');
    if (historyModal && e.target === historyModal) {
        closeAnswerHistory();
    }
});

// ESC 鍵關閉 Modal — 已合併到主 keydown 監聽器

// ========== 全域錯誤處理 (提升穩定性) ==========
// 捕獲未預期的 JavaScript 錯誤，防止遊戲崩潰
window.addEventListener('error', (event) => {
    console.error('遊戲發生未預期的錯誤:', event.error);
    
    // 顯示友善的錯誤提示給用戶
    const feedback = getDomElement('feedback');
    if (feedback) {
        feedback.className = 'feedback wrong';
        feedback.textContent = '⚠️ 發生了一些問題，請重新整理頁面';
        feedback.setAttribute('aria-label', '發生錯誤，請重新整理頁面');
    }
    
    // 嘗試保存玩家進度
    try {
        saveProgress();
    } catch (e) {
        console.warn('錯誤發生時儲存進度失敗:', e);
    }
    
    // 阻止預設錯誤處理（避免顯示惱人的瀏覽器錯誤訊息）
    event.preventDefault();
});

// 捕獲未處理的 Promise 拒絕 (async/await 錯誤)
window.addEventListener('unhandledrejection', (event) => {
    console.error('未處理的非同步錯誤:', event.reason);
    
    // 顯示提示但不中斷遊戲流程
    const feedback = getDomElement('feedback');
    if (feedback && !feedback.textContent) {
        feedback.className = 'feedback wrong';
        feedback.textContent = '⚠️ 載入中...';
        setTimeout(() => {
            feedback.textContent = '';
            feedback.className = '';
        }, 2000);
    }
    
    event.preventDefault();
});

// 全域點擊事件處理（修復選項按鈕無回應問題）
(function() {
    document.addEventListener('click', function(e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        
        if (btn.dataset.answer) {
            var parts = btn.dataset.answer.split(',');
            if (parts.length === 2) {
                checkAnswer(parts[0], parts[1]);
            }
        }
        
        if (btn.dataset.play) {
            playNote(btn.dataset.play);
        }
    }, true);
})();
