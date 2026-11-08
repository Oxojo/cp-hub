# CP Hub

競技プログラミングの予定・問題記録・復習・分析を管理する、個人向け Web アプリです。Sites で制作した既存版を GitHub で開発・配布できる構成へ移植しています。

## 起動

Node.js 22 以降を用意して実行します。外部パッケージのインストールは不要です。

```sh
git clone https://github.com/Oxojo/cp-hub.git
cd cp-hub
npm start
```

表示された `http://127.0.0.1:4173` をブラウザで開いてください。`PORT` と `HOST` 環境変数で待受先を変更できます。開発用サーバーの既定はローカル接続のみです。

```sh
npm run check
```

## 現在の機能

- Today / Week / Problems / Reviews / Contests / Analytics / Settings
- Quick Log、Learned の Observation 必須チェック、URL 正規化、問題検索
- 状態遷移、復習キュー、週間進捗、ローカル予定、コンテスト結果
- ブラウザ内保存と JSON エクスポート
- モバイル用レイアウト

## データと実装範囲

この版はフロントエンドのプロトタイプです。初回起動時はサンプルデータが入り、実際のコンテスト日程ではありません。入力データはブラウザの localStorage (`cp-training-hub:v1`) に保存されます。別ブラウザ・別ドメインとは共有されません。ブラウザデータ削除前に Settings から JSON をエクスポートしてください。JSON インポートは未実装です。

CLIST の本番同期、Discord Bot、認証、PostgreSQL、ジョブ実行基盤は未実装です。分析画面には固定表示のグラフや提案も含まれ、設計書全体の受け入れ条件を満たす本番版ではありません。現状の復習・集計ルールは、本番実装時に設計書に照らした追加検証が必要です。

## 構成

```text
dist/index.html    画面シェル
dist/styles.css    デザイン・レスポンシブ表示
dist/app.js        画面とブラウザ内データ処理
scripts/serve.mjs  依存パッケージ不要の開発サーバー
package.json      起動・チェックコマンド
```

静的ホスティングの公開ディレクトリには `dist/` を指定します。ビルドは不要です。画面遷移は URL hash を使用します。元の Sites 専用プロジェクト設定・Git 履歴・認証情報は含めていません。
