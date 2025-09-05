

# Bridge (Ver.5-nano) — デバウンス最適化リアルタイム音声翻訳

[![GitHub](https://img.shields.io/badge/GitHub-Bridge--Ver.5--nano--debounce--optimized-blue?logo=github)](https://github.com/AichiroFunakoshi/Bridge-Ver.5-nano-debounce-optimized)

日本語⇄英語の **リアルタイム音声翻訳アプリ（PWA対応）** です。  
GPT-5-nano を翻訳エンジンに採用し、**デバウンス最適化 (Adaptive Debounce)** によるリアルタイム性向上と、洗練された白背景 UI を実現しました。

---

## ✨ 主な特徴
- **GPT-5-nano 対応**  
  OpenAI Responses API を利用し、`text.verbosity` や `reasoning.effort` を設定可能。
- **デバウンス最適化**  
  日本語 / 英語ごとに最適遅延を計測・適用（初期値: `ja=346ms`, `en=154ms`）。  
  モーダルから「デバウンス最適化」ボタンで即反映、「最適化リセット」で初期化。
- **リアルタイム音声認識**  
  Web Speech API によるブラウザ内音声入力（interim + final）。
- **UI/UX 改善（Ver.4.1 白背景準拠）**  
  - 原文／翻訳結果の2カラム表示  
  - 状態バッジ（🎙️聞き取り中 / ⚡翻訳中）  
  - 文字サイズ切替（A- / A / A+ / A++）  
- **PWA 対応**  
  スマホ / PC のホーム画面にインストール可能。`images/icons/*` は別途用意。

---

## 📂 プロジェクト構成
```
Bridge-Ver.5-nano-debounce-optimized/
├── app.js          # GPT-5-nano対応、Adaptive Debounce 実装
├── index.html      # UI構成（白背景、設定モーダル）
├── style.css       # UIスタイル（Ver.4.1基準）
├── manifest.json   # PWA設定
└── images/icons/   # アイコン類（※別途用意済み）
```

---

## 🚀 セットアップ
1. リポジトリをクローン
   ```bash
   git clone https://github.com/AichiroFunakoshi/Bridge-Ver.5-nano-debounce-optimized.git
   cd Bridge-Ver.5-nano-debounce-optimized
   ```

2. ローカルサーバで起動（例: Python）
   ```bash
   python -m http.server 8000
   ```
   → [http://localhost:8000](http://localhost:8000) を開く

3. 初回アクセス時に **OpenAI API Key** を入力  
   - ブラウザ `localStorage` に保存  
   - 「APIキーリセット」で削除可能  

---

## 📱 使い方
1. 日本語開始 / 英語開始 ボタンで録音開始  
2. 左に **原文**、右に **翻訳** が逐次表示  
3. フォントサイズ切替ボタンで文字を調整  
4. 設定 (⚙) → **デバウンス最適化**：学習値を即適用  
5. 設定 (⚙) → **最適化リセット**：初期値に戻す  

---

## 🛠 技術スタック
- **Frontend**: HTML5, CSS3, JavaScript  
- **音声入力**: Web Speech API  
- **翻訳モデル**: OpenAI GPT-5-nano (Responses API / Streaming)  
- **PWA**: manifest.json

---

## 🔮 今後の拡張予定
- 多言語対応（韓国語・中国語など）  
- 翻訳履歴保存・エクスポート  
- 利用状況に基づく自動最適化の高度化  

---

## 📄 ライセンス
MIT License  