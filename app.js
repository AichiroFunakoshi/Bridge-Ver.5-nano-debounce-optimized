// リアルタイム音声翻訳 - GPT‑5 対応版 v2（Responses API / 推論イベント無視 / 出力テキストのみ取り込み）
document.addEventListener('DOMContentLoaded', function() {
    // ================================
    // 基本設定
    // ================================

    // デフォルトAPIキー
    const DEFAULT_OPENAI_API_KEY = '';

    // APIキー保存
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
    let selectedLanguage = ''; // 'ja' または 'en'
    let lastTranslationTime = 0;

    // 重複防止・デバウンス
    let processedResultIds = new Set();
    let lastTranslatedText = '';
    let translationDebounceTimer = null;

    // 言語別デバウンス（既存値を踏襲）
    const OPTIMAL_DEBOUNCE = {
        'ja': 346,
        'en': 154
    };
    const getOptimalDebounce = (lang) => OPTIMAL_DEBOUNCE[lang] || 300;

    // 日本語整形
    const japaneseFormatter = {
        addPeriod(text) {
            if (text && !/[。.?？！!]$/.test(text)) return text + '。';
            return text;
        },
        addCommas(text) {
            const patterns = [
                { search: /([^、。])そして/g, replace: "$1、そして" },
                { search: /([^、。])しかし/g, replace: "$1、しかし" },
                { search: /([^、。])ですが/g, replace: "$1、ですが" },
                { search: /([^、。])また/g, replace: "$1、また" },
                { search: /([^、。])けれども/g, replace: "$1、けれども" },
                { search: /([^、。])だから/g, replace: "$1、だから" },
                { search: /([^、。])ので/g, replace: "$1、ので" },
                { search: /(.{10,})から(.{10,})/g, replace: "$1から、$2" },
                { search: /(.{10,})ので(.{10,})/g, replace: "$1ので、$2" },
                { search: /(.{10,})けど(.{10,})/g, replace: "$1けど、$2" }
            ];
            let result = text;
            for (const p of patterns) result = result.replace(p.search, p.replace);
            return result;
        },
        format(text) {
            if (!text || !text.trim()) return text;
            let t = this.addCommas(text);
            return this.addPeriod(t);
        }
    };

    // ================================
    // 初期化・設定
    // ================================

    function loadApiKeys() {
        const storedOpenaiKey = localStorage.getItem('translatorOpenaiKey');
        OPENAI_API_KEY = storedOpenaiKey ? storedOpenaiKey.trim() : '';
        if (!OPENAI_API_KEY) {
            openaiKeyInput.value = DEFAULT_OPENAI_API_KEY;
            apiModal.style.display = 'flex';
        } else {
            initializeApp();
        }
    }

    saveApiKeysBtn?.addEventListener('click', () => {
        const openaiKey = openaiKeyInput.value.trim();
        if (!openaiKey) {
            alert('OpenAI APIキーを入力してください。');
            return;
        }
        localStorage.setItem('translatorOpenaiKey', openaiKey);
        OPENAI_API_KEY = openaiKey;
        apiModal.style.display = 'none';
        initializeApp();
    });

    settingsButton?.addEventListener('click', () => {
        openaiKeyInput.value = OPENAI_API_KEY;
        apiModal.style.display = 'flex';
    });

    resetKeysBtn?.addEventListener('click', () => {
        if (confirm('APIキーをリセットしますか？')) {
            localStorage.removeItem('translatorOpenaiKey');
            location.reload();
        }
    });

    apiModal?.addEventListener('click', (e) => {
        if (e.target === apiModal) apiModal.style.display = 'none';
    });

    function changeFontSize(size) {
        originalText.classList.remove('size-small', 'size-medium', 'size-large', 'size-xlarge');
        translatedText.classList.remove('size-small', 'size-medium', 'size-large', 'size-xlarge');
        originalText.classList.add(`size-${size}`);
        translatedText.classList.add(`size-${size}`);
        localStorage.setItem('translatorFontSize', size);
    }

    function initializeApp() {
        errorMessage.textContent = '';

        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            setupSpeechRecognition();
        } else {
            status.textContent = 'このブラウザは音声認識に対応していません。';
            status.classList.remove('idle');
            status.classList.add('error');
            errorMessage.textContent = 'Chrome、Safari、またはEdgeをご利用ください。';
            return;
        }

        startJapaneseBtn?.addEventListener('click', () => startRecording('ja'));
        startEnglishBtn?.addEventListener('click', () => startRecording('en'));
        stopBtn?.addEventListener('click', stopRecording);
        resetBtn?.addEventListener('click', resetContent);

        fontSizeSmallBtn?.addEventListener('click', () => changeFontSize('small'));
        fontSizeMediumBtn?.addEventListener('click', () => changeFontSize('medium'));
        fontSizeLargeBtn?.addEventListener('click', () => changeFontSize('large'));
        fontSizeXLargeBtn?.addEventListener('click', () => changeFontSize('xlarge'));
        const savedFontSize = localStorage.getItem('translatorFontSize') || 'medium';
        changeFontSize(savedFontSize);

        // 強制プロンプト（翻訳のみ）
        window.SYSTEM_PROMPT = `あなたは日本語と英語の専門的な同時通訳者です。
音声入力データを以下のルールで翻訳してください：
- 必ず原文と反対の言語に翻訳する（日本語→英語、英語→日本語）
- えー/うー等のフィラーや冗長表現を除去する
- 固有名詞・専門用語は正確に保持する
- 出力は翻訳文のみ。前置き・説明・思考・理由・ラベル・括弧・見出し等は一切出力しない`;
    }

    // ================================
    // リセット/録音
    // ================================

    function clearDebounceTimer() {
        if (translationDebounceTimer) {
            clearTimeout(translationDebounceTimer);
            translationDebounceTimer = null;
        }
    }

    function resetContent() {
        processedResultIds.clear();
        lastTranslatedText = '';
        originalText.textContent = '';
        translatedText.textContent = '';
        status.textContent = '待機中';
        status.classList.remove('recording', 'processing', 'error');
        status.classList.add('idle');
        errorMessage.textContent = '';
        clearDebounceTimer();
        if (currentTranslationController) {
            currentTranslationController.abort();
            currentTranslationController = null;
        }
        console.log('コンテンツリセット完了');
    }

    function setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            status.textContent = 'このブラウザは音声認識に対応していません。';
            status.classList.remove('idle');
            status.classList.add('error');
            errorMessage.textContent = 'Chrome、Safari、またはEdgeをご利用ください。';
            return;
        }

        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = function() {
            console.log('音声認識開始。言語:', recognition.lang);
            listeningIndicator?.classList.add('visible');
        };

        recognition.onend = function() {
            console.log('音声認識終了');
            listeningIndicator?.classList.remove('visible');
            if (isRecording) {
                try { recognition.start(); } catch (e) { console.error('音声認識の再開に失敗', e); }
            }
        };

        recognition.onresult = function(event) {
            let interimText = '';
            let finalText = '';
            let hasNewContent = false;

            for (let i = 0; i < event.results.length; i++) {
                const result = event.results[i];
                const transcript = result[0].transcript.trim();
                const resultId = `${i}-${transcript}`;

                if (result.isFinal) {
                    if (!processedResultIds.has(resultId)) {
                        processedResultIds.add(resultId);
                        hasNewContent = true;
                        if (selectedLanguage === 'ja') {
                            finalText += japaneseFormatter.format(transcript) + ' ';
                        } else {
                            finalText += transcript + ' ';
                        }
                    } else {
                        finalText += transcript + ' ';
                    }
                } else {
                    interimText += transcript + ' ';
                    hasNewContent = true;
                }
            }

            const displayText = (finalText + interimText).trim();
            originalText.textContent = displayText;

            if (selectedLanguage === 'ja') {
                sourceLanguage.textContent = '日本語';
                targetLanguage.textContent = '英語';
            } else {
                sourceLanguage.textContent = '英語';
                targetLanguage.textContent = '日本語';
            }

            if (hasNewContent && displayText !== lastTranslatedText) {
                clearDebounceTimer();
                const dynamicDebounce = getOptimalDebounce(selectedLanguage);
                translationDebounceTimer = setTimeout(() => {
                    lastTranslatedText = displayText;
                    translateText(displayText);
                }, dynamicDebounce);
            }
        };

        recognition.onerror = function(event) {
            console.error('音声認識エラー', event.error);
            if (event.error === 'audio-capture') {
                status.textContent = 'マイクが検出されません';
                status.classList.remove('idle', 'recording');
                status.classList.add('error');
                errorMessage.textContent = 'デバイス設定を確認してください。';
                stopRecording();
            } else if (event.error === 'not-allowed') {
                status.textContent = 'マイク権限が拒否されています';
                status.classList.remove('idle', 'recording');
                status.classList.add('error');
                errorMessage.textContent = 'ブラウザ設定でマイク権限を許可してください。';
                stopRecording();
            }
        };
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

    async function startRecording(language) {
        errorMessage.textContent = '';
        selectedLanguage = language;

        processedResultIds.clear();
        lastTranslatedText = '';
        originalText.textContent = '';
        translatedText.textContent = '';

        if (language === 'ja') {
            sourceLanguage.textContent = '日本語';
            targetLanguage.textContent = '英語';
            stopBtnText.textContent = '停止';
        } else {
            sourceLanguage.textContent = '英語';
            targetLanguage.textContent = '日本語';
            stopBtnText.textContent = 'Stop';
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
            console.error('音声認識開始エラー', e);
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

        try { recognition.stop(); } catch (e) { console.error('音声認識停止エラー', e); }

        setTimeout(() => {
            status.textContent = '待機中';
            status.classList.remove('processing');
            status.classList.add('idle');
        }, 1000);

        clearDebounceTimer();
        if (currentTranslationController) {
            currentTranslationController.abort();
            currentTranslationController = null;
        }
        console.log('録音停止');
    }

    // ================================
    // 翻訳（Responses API を使用）
    // ================================

    function buildResponsesPayload(text) {
        const src = selectedLanguage === 'ja' ? '日本語' : '英語';
        const dst = selectedLanguage === 'ja' ? '英語' : '日本語';

        // GPT‑5: reasoning.effort（入れ子）／verbosity（トップレベル）
        return {
            model: "gpt-5-nano",
            // instructions は system 相当
            instructions: window.SYSTEM_PROMPT + `\n\n【タスク】次の${src}を${dst}に翻訳せよ。翻訳文のみを出力する。\n`,
            input: text,
            stream: true,
            verbosity: "low",                  // 出力の冗長さを抑制
            reasoning: { effort: "minimal" },  // 旧 reasoning_effort → reasoning.effort（ドキュメント準拠）
            temperature: 0.0                   // 決定性を高める
        };
    }

    // SSE(typed events) をパースし、response.output_text.delta のみを取り込む
    async function translateText(text) {
        if (!text || !text.trim()) {
            console.log('翻訳スキップ: 空のテキスト');
            return;
        }

        // 既存リクエストを中断
        if (translationInProgress && currentTranslationController) {
            currentTranslationController.abort();
            currentTranslationController = null;
        }

        translationInProgress = true;
        lastTranslationTime = Date.now();
        translatingIndicator?.classList.add('visible');
        errorMessage.textContent = '';

        try {
            const payload = buildResponsesPayload(text);
            currentTranslationController = new AbortController();
            const signal = currentTranslationController.signal;

            console.log(`テキスト翻訳中 (${text.length} 文字): "${text.substring(0, 30)}..."`);

            const response = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + OPENAI_API_KEY.trim()
                },
                body: JSON.stringify(payload),
                signal
            });

            if (!response.ok) {
                let errorData = null;
                try { errorData = await response.json(); } 
                catch (e) { errorData = { error: { message: `HTTPエラー: ${response.status}` } }; }
                console.error('OpenAI APIエラー:', errorData);
                throw new Error(errorData.error?.message || `OpenAI APIがステータスを返しました: ${response.status}`);
            }

            // ストリーミング処理（typed SSE）
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let translationResult = '';

            translatedText.textContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                // SSEは「\n\n」で1イベントが区切られる
                let sepIndex;
                while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
                    const rawEvent = buffer.slice(0, sepIndex);
                    buffer = buffer.slice(1 + sepIndex + 1);

                    // 複数行（event: ... と data: ...）を処理
                    const lines = rawEvent.split('\n');
                    let eventType = null;
                    let dataJson = null;
                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            eventType = line.slice(7).trim();
                        } else if (line.startsWith('data: ')) {
                            try { dataJson = JSON.parse(line.slice(6)); } catch (e) { /* 無視 */ }
                        }
                    }

                    if (!eventType) continue;

                    // 出力テキストのデルタのみ取り込む（思考要約などは無視）
                    if (eventType === 'response.output_text.delta' && dataJson && typeof dataJson.delta === 'string') {
                        translationResult += dataJson.delta;
                        translatedText.textContent = translationResult;
                    } else if (eventType === 'response.completed') {
                        // 完了
                        break;
                    } else {
                        // それ以外（reasoning系・tool系など）は明示的に無視
                        // console.debug('ignored event:', eventType);
                    }
                }
            }

            // 最終確定
            if (!translatedText.textContent && translationResult) {
                translatedText.textContent = translationResult;
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('翻訳リクエストが中断されました');
            } else {
                console.error('翻訳エラー:', error);
                errorMessage.textContent = error.message || '翻訳中にエラーが発生しました。';
                if (!translatedText.textContent) {
                    translatedText.textContent = '(翻訳エラー - 再度お試しください)';
                }
            }
        } finally {
            translationInProgress = false;
            translatingIndicator?.classList.remove('visible');
            currentTranslationController = null;
        }
    }

    // ================================
    // アプリ初期化
    // ================================

    loadApiKeys();
});
