// app.js - 完全改良版（デバウンス最適化・ストリーミング堅牢化・安全性向上）
// NOTE: This file was produced by the assistant. Verify OPENAI_API_KEY is set before usage.

document.addEventListener('DOMContentLoaded', function() {
    const MARKER = "IMPROVED_FULL_v1";
    // デフォルトAPIキー
    const DEFAULT_OPENAI_API_KEY = '';
    let OPENAI_API_KEY = '';

    // DOM要素
    const startJapaneseBtn = document.getElementById('startJapaneseBtn');
    const startEnglishBtn = document.getElementById('startEnglishBtn');
    const stopBtn = document.getElementById('stopBtn');
    const stopBtnText = document.getElementById('stopBtnText');
    const resetBtn = document.getElementById('resetBtn');
    const status = document.getElementById('status');
    const errorMessage = document.getElementById('errorMessage');
    const originalText = document.getElementById('originalText');
    const translatedText = document.getElementById('translatedText');
    const sourceLanguage = document.getElementById('sourceLanguage');
    const targetLanguage = document.getElementById('targetLanguage');
    const apiModal = document.getElementById('apiModal');
    const settingsButton = document.getElementById('settingsButton');
    const openaiKeyInput = document.getElementById('openaiKey');
    const saveApiKeysBtn = document.getElementById('saveApiKeys');
    const resetKeysBtn = document.getElementById('resetKeys');
    const listeningIndicator = document.getElementById('listeningIndicator');
    const translatingIndicator = document.getElementById('translatingIndicator');
    const fontSizeSmallBtn = document.getElementById('fontSizeSmall');
    const fontSizeMediumBtn = document.getElementById('fontSizeMedium');
    const fontSizeLargeBtn = document.getElementById('fontSizeLarge');
    const fontSizeXLargeBtn = document.getElementById('fontSizeXLarge');

    // 音声認識変数
    let recognition = null;
    let isRecording = false;
    let currentTranslationController = null;
    let translationInProgress = false;
    let selectedLanguage = '';
    let lastTranslationTime = 0;
    let currentTranslationTarget = '';

    // グローバルデバウンスと最後の翻訳テキスト
    let lastTranslatedText = '';
    let translationDebounceTimer = null;

    // processed map and interim metrics
    let processedResultMap = new Map();
    const PROCESSED_MAX_AGE_MS = 2 * 60 * 1000;
    let markProcessedCounter = 0;

    // interim timestamps for adaptive debounce
    let interimTimestamps = [];
    const INTERIM_WINDOW_MS = 3000;

    const OPTIMAL_DEBOUNCE = { 'ja': 346, 'en': 154 };

    // Simple Japanese formatter
    const japaneseFormatter = {
        addPeriod(text) {
            if (!text) return text;
            const t = text.trim();
            if (/[。．.!?！？]$/.test(t)) return text;
            return t + '。';
        },
        addCommas(text) {
            if (!text) return text;
            let r = text;
            r = r.replace(/([^、。])そして/g, '$1、そして');
            r = r.replace(/([^、。])しかし/g, '$1、しかし');
            r = r.replace(/([^、。])ですが/g, '$1、ですが');
            r = r.replace(/([^、。])また/g, '$1、また');
            return r;
        },
        format(text) {
            if (!text) return text;
            let t = text.trim();
            t = this.addCommas(t);
            t = this.addPeriod(t);
            return t;
        }
    };

    // Utilities
    function hashString(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h) + str.charCodeAt(i);
            h = h & 0xffffffff;
        }
        return (h >>> 0).toString(16);
    }
    function now() { return Date.now(); }

    function markProcessed(text, isFinal) {
        const key = hashString(text) + (isFinal ? ':F' : ':I');
        processedResultMap.set(key, now());
        markProcessedCounter++;
        if (markProcessedCounter % 50 === 0) {
            const cutoff = now() - PROCESSED_MAX_AGE_MS;
            for (const [k, t] of processedResultMap) {
                if (t < cutoff) processedResultMap.delete(k);
            }
        }
    }
    function isProcessed(text, isFinal) {
        const key = hashString(text) + (isFinal ? ':F' : ':I');
        return processedResultMap.has(key);
    }

    function recordInterim() {
        const t = now();
        interimTimestamps.push(t);
        while (interimTimestamps.length && (t - interimTimestamps[0]) > INTERIM_WINDOW_MS) interimTimestamps.shift();
    }
    function getInterimRatePerSec() {
        if (!interimTimestamps.length) return 0;
        const span = Math.max(1, interimTimestamps[interimTimestamps.length - 1] - interimTimestamps[0]);
        return interimTimestamps.length / (span / 1000);
    }

    function longestCommonPrefix(a, b) {
        if (!a || !b) return '';
        const n = Math.min(a.length, b.length);
        let i = 0;
        while (i < n && a[i] === b[i]) i++;
        return a.slice(0, i);
    }
    function computeOverlapRatio(a, b) {
        if (!a || !b) return 0;
        const lcp = longestCommonPrefix(a, b).length;
        const denom = Math.max(a.length, b.length);
        return denom === 0 ? 0 : lcp / denom;
    }

    function getAdaptiveDebounce(language) {
        const base = OPTIMAL_DEBOUNCE[language] || 300;
        const rate = getInterimRatePerSec();
        const factor = Math.min(3, 1 + rate);
        const adaptive = Math.round(base / factor);
        const bounded = Math.max(50, Math.min(1000, adaptive));
        const jitter = Math.round((Math.random() - 0.5) * 40);
        const wait = bounded + jitter;
        console.debug('[debounce] language=%s rate=%.2f wait=%d', language, rate, wait);
        return wait;
    }

    function loadApiKeys() {
        const stored = localStorage.getItem('translatorOpenaiKey');
        OPENAI_API_KEY = stored ? stored.trim() : '';
        if (!OPENAI_API_KEY) {
            openaiKeyInput.value = DEFAULT_OPENAI_API_KEY;
            apiModal.style.display = 'flex';
        } else {
            initializeApp();
        }
    }

    saveApiKeysBtn.addEventListener('click', () => {
        const k = openaiKeyInput.value.trim();
        if (!k) {
            alert('OpenAI APIキーを入力してください。');
            return;
        }
        localStorage.setItem('translatorOpenaiKey', k);
        OPENAI_API_KEY = k;
        apiModal.style.display = 'none';
        initializeApp();
    });

    settingsButton.addEventListener('click', () => {
        openaiKeyInput.value = OPENAI_API_KEY;
        apiModal.style.display = 'flex';
    });
    resetKeysBtn.addEventListener('click', () => {
        if (confirm('APIキーをリセットしますか？')) {
            localStorage.removeItem('translatorOpenaiKey');
            location.reload();
        }
    });
    apiModal.addEventListener('click', (e) => { if (e.target === apiModal) apiModal.style.display = 'none'; });

    function changeFontSize(size) {
        originalText.classList.remove('size-small', 'size-medium', 'size-large', 'size-xlarge');
        translatedText.classList.remove('size-small', 'size-medium', 'size-large', 'size-xlarge');
        originalText.classList.add(`size-${size}`);
        translatedText.classList.add(`size-${size}`);
        localStorage.setItem('translatorFontSize', size);
    }

    function initializeApp() {
        errorMessage.textContent = '';
        window.SYSTEM_PROMPT = `あなたは日本語と英語の専門的な同時通訳者です。
音声入力データを以下のルールに従って読みやすいテキストに変換して翻訳してください：
1. 元のテキストが日本語の場合は英語に翻訳する。
2. 元のテキストが英語の場合は日本語に翻訳する。
3. フィラー（えー、うー等）を削除。
4. 不足情報は文脈で補完するが過度の推測は避ける。
5. 専門用語・固有名詞は正確に保持する。
6. 出力は翻訳のみ、説明は含めない。`;

        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            setupSpeechRecognition();
        } else {
            status.textContent = 'このブラウザは音声認識に対応していません。';
            status.classList.remove('idle');
            status.classList.add('error');
            errorMessage.textContent = 'ブラウザが音声認識に対応していません。Chrome、Safari、またはEdgeをお使いください。';
            return;
        }

        startJapaneseBtn.addEventListener('click', () => startRecording('ja'));
        startEnglishBtn.addEventListener('click', () => startRecording('en'));
        stopBtn.addEventListener('click', stopRecording);
        resetBtn.addEventListener('click', resetContent);
        fontSizeSmallBtn.addEventListener('click', () => changeFontSize('small'));
        fontSizeMediumBtn.addEventListener('click', () => changeFontSize('medium'));
        fontSizeLargeBtn.addEventListener('click', () => changeFontSize('large'));
        fontSizeXLargeBtn.addEventListener('click', () => changeFontSize('xlarge'));

        const saved = localStorage.getItem('translatorFontSize') || 'medium';
        changeFontSize(saved);
    }

    function resetContent() {
        processedResultMap.clear();
        lastTranslationTime = 0;
        interimTimestamps = [];
        originalText.textContent = '';
        translatedText.textContent = '';
        status.textContent = '待機中';
        status.classList.remove('recording', 'processing', 'error');
        status.classList.add('idle');
        errorMessage.textContent = '';
        console.log('reset complete');
    }

    function updateButtonVisibility(isRecordingState) {
        if (isRecordingState) {
            startJapaneseBtn.style.display = 'none';
            startEnglishBtn.style.display = 'none';
            stopBtn.style.display = 'flex';
            stopBtn.disabled = false;
            resetBtn.disabled = true;
            resetBtn.style.opacity = '0.5';
        } else {
            startJapaneseBtn.style.display = 'flex';
            startEnglishBtn.style.display = 'flex';
            startJapaneseBtn.disabled = false;
            startEnglishBtn.disabled = false;
            stopBtn.style.display = 'none';
            stopBtn.disabled = true;
            resetBtn.disabled = false;
            resetBtn.style.opacity = '1';
        }
    }

    // Setup SpeechRecognition and attach improved onresult behavior
    function setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            status.textContent = 'このブラウザは音声認識に対応していません。';
            status.classList.remove('idle');
            status.classList.add('error');
            errorMessage.textContent = 'ブラウザが音声認識に対応していません。';
            return;
        }

        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => { listeningIndicator.classList.add('visible'); };
        recognition.onend = () => {
            listeningIndicator.classList.remove('visible');
            if (isRecording) {
                try { recognition.start(); } catch (e) { console.error('restart fail', e); }
            }
        };

        recognition.onerror = (event) => {
            console.error('speech error', event.error);
            if (event.error === 'audio-capture') {
                status.textContent = 'マイクが検出されません';
                status.classList.remove('idle', 'recording');
                status.classList.add('error');
                errorMessage.textContent = 'マイクが検出できません。デバイス設定を確認してください。';
                stopRecording();
            } else if (event.error === 'not-allowed') {
                status.textContent = 'マイク権限が拒否されています';
                status.classList.remove('idle', 'recording');
                status.classList.add('error');
                errorMessage.textContent = 'マイクアクセスが拒否されました。ブラウザ設定でマイク権限を許可してください。';
                stopRecording();
            }
        };

        recognition.onresult = function(event) {
            let interimText = '';
            let finalText = '';
            let hasNew = false;

            for (let i = 0; i < event.results.length; i++) {
                const r = event.results[i];
                const transcript = r[0].transcript.trim();
                const isFinal = r.isFinal || false;

                if (!transcript) continue;

                if (isFinal) {
                    if (!isProcessed(transcript, true)) {
                        markProcessed(transcript, true);
                        hasNew = true;
                        if (selectedLanguage === 'ja') finalText += japaneseFormatter.format(transcript) + ' ';
                        else finalText += transcript + ' ';
                    } else {
                        finalText += transcript + ' ';
                    }
                } else {
                    interimText += transcript + ' ';
                    hasNew = true;
                    recordInterim();
                }
            }

            const display = (finalText + interimText).trim();

            try {
                const prev = originalText.textContent || '';
                const lcp = longestCommonPrefix(prev, display);
                if (lcp.length !== display.length) {
                    originalText.textContent = display;
                    originalText.classList.add('updating');
                    clearTimeout(originalText._fadeTimer);
                    originalText._fadeTimer = setTimeout(() => originalText.classList.remove('updating'), 220);
                }
            } catch (e) {
                originalText.textContent = display;
            }

            if (selectedLanguage === 'ja') { sourceLanguage.textContent = '日本語'; targetLanguage.textContent = '英語'; }
            else { sourceLanguage.textContent = '英語'; targetLanguage.textContent = '日本語'; }

            if (hasNew && display !== lastTranslatedText) {
                clearTimeout(translationDebounceTimer);
                const wait = getAdaptiveDebounce(selectedLanguage);
                translationDebounceTimer = setTimeout(() => {
                    if (translationInProgress && currentTranslationController) {
                        const overlap = computeOverlapRatio(currentTranslationTarget || '', display);
                        if (overlap > 0.8) {
                            const suffix = display.slice(longestCommonPrefix(lastTranslatedText || '', display).length);
                            translateText(display, { incremental: true, suffix: suffix });
                            lastTranslatedText = display;
                            return;
                        } else {
                            try { currentTranslationController.abort(); } catch (e) {}
                        }
                    }

                    lastTranslatedText = display;
                    translateText(display, { incremental: false });
                }, wait);
            }
        };
    }

    // start / stop
    async function startRecording(language) {
        errorMessage.textContent = '';
        selectedLanguage = language;
        processedResultMap.clear();
        lastTranslationTime = 0;
        interimTimestamps = [];
        originalText.textContent = '';
        translatedText.textContent = '';

        if (language === 'ja') {
            sourceLanguage.textContent = '日本語'; targetLanguage.textContent = '英語';
            stopBtnText.textContent = '停止';
        } else {
            sourceLanguage.textContent = '英語'; targetLanguage.textContent = '日本語';
            stopBtnText.textContent = 'Stop';
        }

        if (!recognition) {
            errorMessage.textContent = '音声認識が初期化されていません。ページをリロードするか、ブラウザを確認してください。';
            console.error('recognition not initialized');
            return;
        }

        isRecording = true;
        document.body.classList.add('recording');
        status.textContent = '録音中';
        status.classList.remove('idle', 'error');
        status.classList.add('recording');
        updateButtonVisibility(true);

        try {
            recognition.lang = language === 'ja' ? 'ja-JP' : 'en-US';
            recognition.start();
        } catch (e) {
            console.error('start error', e);
            errorMessage.textContent = '音声認識の開始に失敗しました: ' + e.message;
            stopRecording();
        }
    }

    function stopRecording() {
        isRecording = false;
        document.body.classList.remove('recording');
        status.textContent = '処理中';
        status.classList.remove('recording');
        status.classList.add('processing');
        updateButtonVisibility(false);
        try { recognition.stop(); } catch (e) {}
        setTimeout(() => { status.textContent = '待機中'; status.classList.remove('processing'); status.classList.add('idle'); }, 1000);
    }

    // translateText with streaming and incremental option (robust parser)
    async function translateText(text, options = { incremental: false, suffix: '' }) {
        if (!text || !text.trim()) return;
        const src = selectedLanguage === 'ja' ? '日本語' : '英語';

        // Early check for API key
        if (!OPENAI_API_KEY || OPENAI_API_KEY.trim() === '') {
            errorMessage.textContent = 'OpenAI APIキーが設定されていません。設定を確認してください。';
            console.error('Missing OPENAI_API_KEY');
            return;
        }

        if (translationInProgress && currentTranslationController) {
            const overlap = computeOverlapRatio(currentTranslationTarget || '', text);
            if (!(options.incremental && overlap > 0.8)) {
                try { currentTranslationController.abort(); } catch (e) {}
            }
        }

        translationInProgress = true;
        currentTranslationTarget = text;
        translatingIndicator.classList.add('visible');
        errorMessage.textContent = '';

        currentTranslationController = new AbortController();
        const signal = currentTranslationController.signal;

        try {
            let userContent = `以下の${src}テキストを翻訳してください:\n\n${text}`;
            if (options.incremental && options.suffix) {
                userContent = `これは部分更新です。既に表示されている翻訳を踏まえて、次の追加部分を翻訳してください（元テキストの末尾を補完するように）:\n\n追加部分:${options.suffix}\n\n全文（参考）:${text}`;
            }

            const payload = {
                model: "gpt-5-nano",
                messages: [
                    { role: "system", content: window.SYSTEM_PROMPT },
                    { role: "user", content: userContent }
                ],
                stream: true,
                temperature: 0.3,
                verbosity: "low",
                reasoning_effort: "minimal"
            };

            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_API_KEY.trim() },
                body: JSON.stringify(payload),
                signal: signal
            });

            if (!res.ok) {
                let err = null;
                try { err = await res.json(); } catch (e) { err = { error: { message: `HTTP ${res.status}` } }; }
                throw new Error(err.error?.message || `OpenAI error ${res.status}`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let accum = '';
            let streamBuffer = '';

            if (!options.incremental) translatedText.textContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                streamBuffer += chunk;

                let newlineIndex;
                while ((newlineIndex = streamBuffer.indexOf('\n')) !== -1) {
                    const line = streamBuffer.slice(0, newlineIndex).trim();
                    streamBuffer = streamBuffer.slice(newlineIndex + 1);
                    if (!line) continue;

                    if (line.startsWith('data: ')) {
                        const payloadLine = line.substring(6);
                        if (payloadLine.trim() === '[DONE]') continue;
                        try {
                            const data = JSON.parse(payloadLine);
                            const delta = data.choices?.[0]?.delta?.content;
                            if (delta) {
                                accum += delta;
                                translatedText.textContent = accum;
                            }
                        } catch (e) {
                            accum += payloadLine;
                            translatedText.textContent = accum;
                        }
                    } else {
                        accum += line;
                        translatedText.textContent = accum;
                    }
                }
            }

            if (streamBuffer.trim()) {
                const rest = streamBuffer.trim();
                if (rest.startsWith('data: ')) {
                    const payloadLine = rest.substring(6);
                    if (payloadLine.trim() !== '[DONE]') {
                        try {
                            const data = JSON.parse(payloadLine);
                            const delta = data.choices?.[0]?.delta?.content;
                            if (delta) {
                                accum += delta;
                                translatedText.textContent = accum;
                            }
                        } catch (e) {
                            accum += rest;
                            translatedText.textContent = accum;
                        }
                    }
                } else {
                    accum += rest;
                    translatedText.textContent = accum;
                }
                streamBuffer = '';
            }

            currentTranslationController = null;
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('translation aborted');
            } else {
                console.error('translation error', err);
                errorMessage.textContent = err.message || String(err);
                if (!translatedText.textContent) translatedText.textContent = '(翻訳エラー)';
            }
        } finally {
            translationInProgress = false;
            translatingIndicator.classList.remove('visible');
            currentTranslationTarget = '';
        }
    }

    // initialize load
    loadApiKeys();
    // expose marker for quick check
    window.__APP_MARKER = MARKER;
});