// Bridge - Real-time Translator (GPT-5-nano, low-latency) — full, runnable
// - Responses API
// - Sliding window input (FAST) + sentence-final correction (FINAL)
// - SSE lightweight parser (response.output_text.delta)
// - AbortController per request
document.addEventListener('DOMContentLoaded', () => {
  const DEFAULT_OPENAI_API_KEY = '';
  let OPENAI_API_KEY = '';

  // DOM
  const startJapaneseBtn = document.getElementById('startJapaneseBtn');
  const startEnglishBtn = document.getElementById('startEnglishBtn');
  const stopBtn = document.getElementById('stopBtn');
  const stopBtnText = document.getElementById('stopBtnText');
  const resetBtn = document.getElementById('resetBtn');
  const statusEl = document.getElementById('status');
  const errEl = document.getElementById('errorMessage');
  const originalTextEl = document.getElementById('originalText');
  const translatedTextEl = document.getElementById('translatedText');
  const sourceLangEl = document.getElementById('sourceLanguage');
  const targetLangEl = document.getElementById('targetLanguage');
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

  // Speech
  let recognition = null;
  let isRecording = false;

  // Streaming
  let currentTranslationController = null;
  let translationInProgress = false;

  // State
  let selectedLanguage = ''; // 'ja' or 'en'
  let processedResultIds = new Set();
  let lastSubmittedFast = '';
  let translationDebounceTimer = null;

  const OPTIMAL_DEBOUNCE = { ja: 346, en: 154 };
  const WINDOW_CHARS = { ja: 120, en: 90 };
  const SENTENCE_END_RE = /[。．\.！？!?]\s*$/;

  const japaneseFormatter = {
    addPeriod(t) { return (t && !/[。.?？！!]$/.test(t)) ? t + '。' : t; },
    addCommas(t) {
      const rules = [
        { s: /([^、。])そして/g, r: '$1、そして' },
        { s: /([^、。])しかし/g, r: '$1、しかし' },
        { s: /([^、。])ですが/g, r: '$1、ですが' },
        { s: /([^、。])また/g, r: '$1、また' },
        { s: /([^、。])けれども/g, r: '$1、けれども' },
        { s: /([^、。])だから/g, r: '$1、だから' },
        { s: /([^、。])ので/g, r: '$1、ので' },
        { s: /(.{10,})から(.{10,})/g, r: '$1から、$2' },
        { s: /(.{10,})ので(.{10,})/g, r: '$1ので、$2' },
        { s: /(.{10,})けど(.{10,})/g, r: '$1けど、$2' },
      ];
      let out = t;
      for (const p of rules) out = out.replace(p.s, p.r);
      return out;
    },
    format(t) { if (!t || !t.trim()) return t; return this.addPeriod(this.addCommas(t)); }
  };

  function setStatus(text, clsAdd=[], clsRemove=[]) {
    statusEl.textContent = text;
    ['idle','recording','processing','error'].forEach(c => statusEl.classList.remove(c));
    clsAdd.forEach(c => statusEl.classList.add(c));
    clsRemove.forEach(c => statusEl.classList.remove(c));
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
  saveApiKeysBtn?.addEventListener('click', () => {
    const k = (openaiKeyInput.value || '').trim();
    if (!k) { alert('OpenAI APIキーを入力してください。'); return; }
    localStorage.setItem('translatorOpenaiKey', k);
    OPENAI_API_KEY = k;
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
  apiModal?.addEventListener('click', (e) => { if (e.target === apiModal) apiModal.style.display = 'none'; });

  function changeFontSize(size) {
    ['size-small','size-medium','size-large','size-xlarge'].forEach(c => {
      originalTextEl.classList.remove(c);
      translatedTextEl.classList.remove(c);
    });
    originalTextEl.classList.add(`size-${size}`);
    translatedTextEl.classList.add(`size-${size}`);
    localStorage.setItem('translatorFontSize', size);
  }

  function initializeApp() {
    errEl.textContent = '';
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      setStatus('このブラウザは音声認識に対応していません。', ['error']);
      errEl.textContent = 'Chrome、Safari、またはEdgeをご利用ください。';
      return;
    }
    setupSpeechRecognition();
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
- 固有名詞・専門用語を正確に保持
- 逐次的に自然な短文で返す
- 出力は翻訳文のみ（前置き・説明・ラベル禁止）`;

    setStatus('待機中', ['idle']);
  }

  function clearDebounce() {
    if (translationDebounceTimer) { clearTimeout(translationDebounceTimer); translationDebounceTimer = null; }
  }

  function resetContent() {
    processedResultIds.clear();
    lastSubmittedFast = '';
    originalTextEl.textContent = '';
    translatedTextEl.textContent = '';
    errEl.textContent = '';
    clearDebounce();
    if (currentTranslationController) { try { currentTranslationController.abort(); } catch{} currentTranslationController = null; }
    setStatus('待機中', ['idle']);
  }

  function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus('このブラウザは音声認識に対応していません。', ['error']);
      errEl.textContent = 'Chrome、Safari、またはEdgeをご利用ください。';
      return;
    }
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => { listeningIndicator?.classList.add('visible'); };
    recognition.onend = () => {
      listeningIndicator?.classList.remove('visible');
      if (isRecording) { try { recognition.start(); } catch (e) { console.error('音声認識の再開に失敗', e); } }
    };

    recognition.onresult = (event) => {
      let interimText = '', finalText = '';
      let hasNewContent = false, hasFinal = false;

      for (let i=0; i<event.results.length; i++) {
        const result = event.results[i];
        const transcript = (result[0]?.transcript || '').trim();
        const resultId = `${i}-${transcript}`;

        if (result.isFinal) {
          hasFinal = true;
          if (!processedResultIds.has(resultId)) {
            processedResultIds.add(resultId); hasNewContent = true;
            finalText += (selectedLanguage === 'ja') ? (japaneseFormatter.format(transcript) + ' ') : (transcript + ' ');
          } else {
            finalText += transcript + ' ';
          }
        } else {
          interimText += transcript + ' '; hasNewContent = true;
        }
      }

      const displayText = (finalText + interimText).trim();
      originalTextEl.textContent = displayText;

      if (selectedLanguage === 'ja') { sourceLangEl.textContent = '日本語'; targetLangEl.textContent = '英語'; }
      else { sourceLangEl.textContent = '英語'; targetLangEl.textContent = '日本語'; }

      if (!hasNewContent) return;

      clearDebounce();
      const delay = OPTIMAL_DEBOUNCE[selectedLanguage] || 300;
      translationDebounceTimer = setTimeout(() => {
        const sendFinal = hasFinal && SENTENCE_END_RE.test(displayText);
        const payloadText = sliceForLatency(displayText, sendFinal);
        if (!payloadText) return;
        translateText(payloadText, sendFinal ? 'final' : 'fast');
      }, delay);
    };

    recognition.onerror = (event) => {
      console.error('音声認識エラー', event?.error);
      if (event?.error === 'audio-capture') {
        setStatus('マイクが検出されません', ['error']);
        errEl.textContent = 'デバイス設定を確認してください。';
        stopRecording();
      } else if (event?.error === 'not-allowed') {
        setStatus('マイク権限が拒否されています', ['error']);
        errEl.textContent = 'ブラウザ設定でマイク権限を許可してください。';
        stopRecording();
      }
    };
  }

  function updateButtons(recording) {
    if (recording) {
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

  async function startRecording(lang) {
    errEl.textContent = '';
    selectedLanguage = lang;
    processedResultIds.clear();
    lastSubmittedFast = '';
    originalTextEl.textContent = '';
    translatedTextEl.textContent = '';

    if (lang === 'ja') { sourceLangEl.textContent = '日本語'; targetLangEl.textContent = '英語'; stopBtnText.textContent = '停止'; }
    else { sourceLangEl.textContent = '英語'; targetLangEl.textContent = '日本語'; stopBtnText.textContent = 'Stop'; }

    isRecording = true; document.body.classList.add('recording');
    setStatus('録音中', ['recording'], ['idle','error']);
    updateButtons(true);

    try {
      recognition.lang = (lang === 'ja') ? 'ja-JP' : 'en-US';
      recognition.start();
    } catch (e) {
      console.error('音声認識開始エラー', e);
      errEl.textContent = '音声認識の開始に失敗しました: ' + (e?.message || e);
      stopRecording();
    }
  }

  function stopRecording() {
    isRecording = false; document.body.classList.remove('recording');
    setStatus('処理中', ['processing'], ['recording']);
    updateButtons(false);
    try { recognition.stop(); } catch (e) { console.error('音声認識停止エラー', e); }
    setTimeout(() => { setStatus('待機中', ['idle'], ['processing']); }, 800);
    clearDebounce();
    if (currentTranslationController) { try { currentTranslationController.abort(); } catch{} currentTranslationController = null; }
  }

  function sliceForLatency(text, isFinal) {
    if (!text || !text.trim()) return '';
    if (isFinal) {
      const parts = text.split(/(?<=[。．\.！？!?])\s*/).filter(s => s.trim().length > 0);
      return parts.length ? parts[parts.length - 1].trim() : text.trim();
    } else {
      const n = WINDOW_CHARS[selectedLanguage] || 100;
      const t = text.length > n ? text.slice(-n) : text;
      if (t === lastSubmittedFast) return '';
      lastSubmittedFast = t;
      return t.trim();
    }
  }

  function buildResponsesPayload(inputText) {
    const src = (selectedLanguage === 'ja') ? '日本語' : '英語';
    const dst = (selectedLanguage === 'ja') ? '英語' : '日本語';
    return {
      model: 'gpt-5-nano',
      instructions: `${window.SYSTEM_PROMPT}\n\n【タスク】次の${src}を${dst}に翻訳せよ。翻訳文のみを即時・逐次出力する。`,
      input: inputText,
      stream: true,
      text: { verbosity: 'low' },
      reasoning: { effort: 'minimal' }
    };
  }

  async function translateText(inputText, mode /* 'fast' | 'final' */) {
    if (!inputText) return;

    // Cancel previous
    if (translationInProgress && currentTranslationController) {
      try { currentTranslationController.abort(); } catch {}
      currentTranslationController = null;
    }

    translationInProgress = true;
    translatingIndicator?.classList.add('visible');
    errEl.textContent = '';

    try {
      const payload = buildResponsesPayload(inputText);
      currentTranslationController = new AbortController();
      const signal = currentTranslationController.signal;

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
        let err;
        try { err = await response.json(); } catch { err = { error: { message: `HTTP ${response.status}` } }; }
        throw new Error(err?.error?.message || `OpenAI APIがステータスを返しました: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let carry = '', out = '';

      if (mode === 'final') translatedTextEl.textContent = '';

      const flushChunk = (delta) => {
        if (!delta) return;
        out += delta;
        translatedTextEl.textContent = out;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        carry += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = carry.indexOf('\n\n')) !== -1) {
          const block = carry.slice(0, idx);
          carry = carry.slice(idx + 2);

          let eventType = null, dataStr = null;
          const lines = block.split('\n');
          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6);
          }

          if (!eventType) continue;

          if (eventType === 'response.output_text.delta') {
            if (dataStr) {
              try {
                const obj = JSON.parse(dataStr);
                if (typeof obj?.delta === 'string') flushChunk(obj.delta);
              } catch {}
            }
          } else if (eventType === 'response.completed') {
            carry = '';
          }
        }
      }

      if (!translatedTextEl.textContent && out) translatedTextEl.textContent = out;

    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('翻訳エラー:', e);
        errEl.textContent = e?.message || '翻訳中にエラーが発生しました。';
        if (!translatedTextEl.textContent) translatedTextEl.textContent = '(翻訳エラー - 再度お試しください)';
      }
    } finally {
      translationInProgress = false;
      translatingIndicator?.classList.remove('visible');
      currentTranslationController = null;
    }
  }

  // init
  loadApiKeys();
});
