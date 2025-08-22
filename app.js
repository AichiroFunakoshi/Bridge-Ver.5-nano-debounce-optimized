// リアルタイム音声翻訳 - GPT‑5 対応版 v3（Responses API / text.verbosity / reasoning.effort / 出力テキストのみ）
document.addEventListener('DOMContentLoaded', function() {
    const DEFAULT_OPENAI_API_KEY = '';
    let OPENAI_API_KEY = '';

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

    let recognition = null;
    let isRecording = false;
    let currentTranslationController = null;
    let translationInProgress = false;
    let selectedLanguage = '';
    let processedResultIds = new Set();
    let lastTranslatedText = '';
    let translationDebounceTimer = null;

    const OPTIMAL_DEBOUNCE = { 'ja': 346, 'en': 154 };
    const getOptimalDebounce = (lang) => OPTIMAL_DEBOUNCE[lang] || 300;

    const japaneseFormatter = {
        addPeriod(text) { return (text && !/[。.?？！!]$/.test(text)) ? text + '。' : text; },
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
            let result = text; for (const p of patterns) result = result.replace(p.search, p.replace); return result;
        },
        format(text) { if (!text || !text.trim()) return text; return this.addPeriod(this.addCommas(text)); }
    };

    function loadApiKeys() {
        const storedOpenaiKey = localStorage.getItem('translatorOpenaiKey');
        OPENAI_API_KEY = storedOpenaiKey ? storedOpenaiKey.trim() : '';
        if (!OPENAI_API_KEY) { openaiKeyInput.value = DEFAULT_OPENAI_API_KEY; apiModal.style.display = 'flex'; } else { initializeApp(); }
    }

    saveApiKeysBtn?.addEventListener('click', () => {
        const openaiKey = openaiKeyInput.value.trim();
        if (!openaiKey) { alert('OpenAI APIキーを入力してください。'); return; }
        localStorage.setItem('translatorOpenaiKey', openaiKey);
        OPENAI_API_KEY = openaiKey;
        apiModal.style.display = 'none';
        initializeApp();
    });

    settingsButton?.addEventListener('click', () => { openaiKeyInput.value = OPENAI_API_KEY; apiModal.style.display = 'flex'; });
    resetKeysBtn?.addEventListener('click', () => { if (confirm('APIキーをリセットしますか？')) { localStorage.removeItem('translatorOpenaiKey'); location.reload(); } });
    apiModal?.addEventListener('click', (e) => { if (e.target === apiModal) apiModal.style.display = 'none'; });

    function changeFontSize(size) {
        originalText.classList.remove('size-small', 'size-medium', 'size-large', 'size-xlarge');
        translatedText.classList.remove('size-small', 'size-medium', 'size-large', 'size-xlarge');
        originalText.classList.add(`size-${size}`); translatedText.classList.add(`size-${size}`);
        localStorage.setItem('translatorFontSize', size);
    }

    function initializeApp() {
        errorMessage.textContent = '';
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            setupSpeechRecognition();
        } else {
            status.textContent = 'このブラウザは音声認識に対応していません。';
            status.classList.remove('idle'); status.classList.add('error');
            errorMessage.textContent = 'Chrome、Safari、またはEdgeをご利用ください。'; return;
        }
        startJapaneseBtn?.addEventListener('click', () => startRecording('ja'));
        startEnglishBtn?.addEventListener('click', () => startRecording('en'));
        stopBtn?.addEventListener('click', stopRecording);
        resetBtn?.addEventListener('click', resetContent);

        fontSizeSmallBtn?.addEventListener('click', () => changeFontSize('small'));
        fontSizeMediumBtn?.addEventListener('click', () => changeFontSize('medium'));
        fontSizeLargeBtn?.addEventListener('click', () => changeFontSize('large'));
        fontSizeXLargeBtn?.addEventListener('click', () => changeFontSize('xlarge'));
        changeFontSize(localStorage.getItem('translatorFontSize') || 'medium');

        window.SYSTEM_PROMPT = `あなたは日本語と英語の専門的な同時通訳者です。
- 日本語↔英語の双方向翻訳を行う
- フィラーや冗長表現を除去
- 固有名詞・専門用語は正確に保持
- 出力は翻訳文のみ（前置き・説明・思考・ラベル禁止）`;
    }

    function clearDebounceTimer() { if (translationDebounceTimer) { clearTimeout(translationDebounceTimer); translationDebounceTimer = null; } }

    function resetContent() {
        processedResultIds.clear(); lastTranslatedText = '';
        originalText.textContent = ''; translatedText.textContent = '';
        status.textContent = '待機中'; status.classList.remove('recording','processing','error'); status.classList.add('idle');
        errorMessage.textContent = ''; clearDebounceTimer();
        if (currentTranslationController) { currentTranslationController.abort(); currentTranslationController = null; }
    }

    function setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            status.textContent = 'このブラウザは音声認識に対応していません。';
            status.classList.remove('idle'); status.classList.add('error');
            errorMessage.textContent = 'Chrome、Safari、またはEdgeをご利用ください。'; return;
        }
        recognition = new SpeechRecognition();
        recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
        recognition.onstart = () => { listeningIndicator?.classList.add('visible'); };
        recognition.onend = () => { listeningIndicator?.classList.remove('visible'); if (isRecording) { try { recognition.start(); } catch (e) { console.error('音声認識の再開に失敗', e); } } };
        recognition.onresult = (event) => {
            let interimText = '', finalText = '', hasNewContent = false;
            for (let i=0; i<event.results.length; i++) {
                const result = event.results[i]; const transcript = result[0].transcript.trim(); const resultId = `${i}-${transcript}`;
                if (result.isFinal) { if (!processedResultIds.has(resultId)) { processedResultIds.add(resultId); hasNewContent = true; finalText += (selectedLanguage==='ja') ? japaneseFormatter.format(transcript)+' ' : transcript+' '; } else { finalText += transcript+' '; } }
                else { interimText += transcript+' '; hasNewContent = true; }
            }
            const displayText = (finalText + interimText).trim();
            originalText.textContent = displayText;
            if (selectedLanguage === 'ja') { sourceLanguage.textContent='日本語'; targetLanguage.textContent='英語'; } else { sourceLanguage.textContent='英語'; targetLanguage.textContent='日本語'; }
            if (hasNewContent && displayText !== lastTranslatedText) { clearDebounceTimer(); translationDebounceTimer = setTimeout(()=>{ lastTranslatedText = displayText; translateText(displayText); }, getOptimalDebounce(selectedLanguage)); }
        };
        recognition.onerror = (event) => {
            console.error('音声認識エラー', event.error);
            if (event.error === 'audio-capture') { status.textContent = 'マイクが検出されません'; status.classList.remove('idle','recording'); status.classList.add('error'); errorMessage.textContent = 'デバイス設定を確認してください。'; stopRecording(); }
            else if (event.error === 'not-allowed') { status.textContent = 'マイク権限が拒否されています'; status.classList.remove('idle','recording'); status.classList.add('error'); errorMessage.textContent = 'ブラウザ設定でマイク権限を許可してください。'; stopRecording(); }
        };
    }

    function updateButtonVisibility(isRecordingState) {
        if (isRecordingState) { startJapaneseBtn.style.display='none'; startEnglishBtn.style.display='none'; stopBtn.style.display='flex'; stopBtn.disabled=false; resetBtn.disabled=true; resetBtn.style.opacity='0.5'; }
        else { startJapaneseBtn.style.display='flex'; startEnglishBtn.style.display='flex'; startJapaneseBtn.disabled=false; startEnglishBtn.disabled=false; stopBtn.style.display='none'; stopBtn.disabled=true; resetBtn.disabled=false; resetBtn.style.opacity='1'; }
    }

    async function startRecording(language) {
        errorMessage.textContent = ''; selectedLanguage = language;
        processedResultIds.clear(); lastTranslatedText = ''; originalText.textContent=''; translatedText.textContent='';
        if (language === 'ja') { sourceLanguage.textContent='日本語'; targetLanguage.textContent='英語'; stopBtnText.textContent='停止'; }
        else { sourceLanguage.textContent='英語'; targetLanguage.textContent='日本語'; stopBtnText.textContent='Stop'; }
        isRecording = true; document.body.classList.add('recording'); status.textContent='録音中'; status.classList.remove('idle','error'); status.classList.add('recording'); updateButtonVisibility(true);
        try { recognition.lang = (language === 'ja') ? 'ja-JP' : 'en-US'; recognition.start(); }
        catch (e) { console.error('音声認識開始エラー', e); errorMessage.textContent = '音声認識の開始に失敗しました: ' + e.message; stopRecording(); }
    }

    function stopRecording() {
        isRecording = false; document.body.classList.remove('recording');
        status.textContent = '処理中'; status.classList.remove('recording'); status.classList.add('processing'); updateButtonVisibility(false);
        try { recognition.stop(); } catch (e) { console.error('音声認識停止エラー', e); }
        setTimeout(() => { status.textContent='待機中'; status.classList.remove('processing'); status.classList.add('idle'); }, 1000);
        clearDebounceTimer(); if (currentTranslationController) { currentTranslationController.abort(); currentTranslationController=null; }
    }

    function buildResponsesPayload(text) {
        const src = (selectedLanguage === 'ja') ? '日本語' : '英語';
        const dst = (selectedLanguage === 'ja') ? '英語' : '日本語';
        return {
            model: "gpt-5-nano",
            instructions: window.SYSTEM_PROMPT + `\n\n【タスク】次の${src}を${dst}に翻訳せよ。翻訳文のみを出力する。\n`,
            input: text,
            stream: true,
            text: { verbosity: "low" },
            reasoning: { effort: "minimal" },            
        };
    }

    async function translateText(text) {
        if (!text || !text.trim()) return;
        if (translationInProgress && currentTranslationController) { currentTranslationController.abort(); currentTranslationController = null; }
        translationInProgress = true; translatingIndicator?.classList.add('visible'); errorMessage.textContent='';
        try {
            const payload = buildResponsesPayload(text);
            currentTranslationController = new AbortController(); const signal = currentTranslationController.signal;
            const response = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_API_KEY.trim() },
                body: JSON.stringify(payload), signal
            });
            if (!response.ok) {
                let errorData = null; try { errorData = await response.json(); } catch(e) { errorData = { error: { message: `HTTPエラー: ${response.status}` } }; }
                throw new Error(errorData.error?.message || `OpenAI APIがステータスを返しました: ${response.status}`);
            }
            const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8');
            let buffer = '', translationResult = ''; translatedText.textContent = '';
            while (true) {
                const { done, value } = await reader.read(); if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let sepIndex;
                while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
                    const rawEvent = buffer.slice(0, sepIndex); buffer = buffer.slice(sepIndex + 2);
                    const lines = rawEvent.split('\n'); let eventType = null; let dataJson = null;
                    for (const line of lines) {
                        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
                        else if (line.startsWith('data: ')) { try { dataJson = JSON.parse(line.slice(6)); } catch(e){} }
                    }
                    if (!eventType) continue;
                    if (eventType === 'response.output_text.delta' && dataJson && typeof dataJson.delta === 'string') {
                        translationResult += dataJson.delta; translatedText.textContent = translationResult;
                    } else if (eventType === 'response.completed') { break; } else { /* ignore other events */ }
                }
            }
            if (!translatedText.textContent && translationResult) translatedText.textContent = translationResult;
        } catch (error) {
            if (error.name !== 'AbortError') { console.error('翻訳エラー:', error); errorMessage.textContent = error.message || '翻訳中にエラーが発生しました。'; if (!translatedText.textContent) translatedText.textContent = '(翻訳エラー - 再度お試しください)'; }
        } finally { translationInProgress = false; translatingIndicator?.classList.remove('visible'); currentTranslationController = null; }
    }

    loadApiKeys();
});
