# CP Hub

VPS で main を自動反映する設定は [自動デプロイ手順](docs/auto-deploy.md) を参照してください。

競技プログラミングの予定・問題記録・復習を Web と Discord から共有する単一 Owner 向けアプリです。Node.js API、PostgreSQL 保存、CLIST 同期、Discord HTTP Interactions Bot と通知 worker を追加しています。

## 起動

Node.js 22.9 以降（推奨24）が必要です。

```sh
git clone https://github.com/Oxojo/cp-hub.git
cd cp-hub
npm ci
cp .env.example .env
npm start
```

Windows PowerShell では `Copy-Item .env.example .env` を使います。`http://127.0.0.1:4173` を開いてください。初期データは空です。設定した外部連携だけ有効になります。旧静的版の localStorage は自動インポートしません。

`DATABASE_URL` が空なら `data/hub.json` に保存します。ファイルモードは開発用の単一プロセス限定です。

## PostgreSQL と公開

本番用は `DATABASE_URL`、長いランダム値の `OWNER_PASSWORD`、公開 URL の `APP_ORIGIN` を .env に設定します。起動時に `migrations/001_hub_state.sql` が適用されます。

Docker を使う場合は .env に `POSTGRES_PASSWORD`（URL に使える文字）と `OWNER_PASSWORD` を設定して実行します。

```sh
docker compose up --build -d
```

Compose はローカルの4173ポートだけ公開します。外部公開時は HTTPS リバースプロキシと `APP_ORIGIN=https://your-domain.example` を設定してください。パスワードなしの外部 bind は起動を拒否します。Owner cookie は HttpOnly / SameSite=Strict、HTTPS で Secure が付きます。有効期限24時間、再起動でログアウト、ログイン試行は1分10回までです。

現在のスキーマは単一 Owner 用の JSONB 集約です。PostgreSQL の行ロックで Web・Bot・worker の変更を直列化し、revision で Web 保存の競合を検出します。複数ユーザー用の正規化スキーマ、Drizzle、OAuth は未実装です。本番 DB の定期バックアップは別途設定してください。

## CLIST

.env に以下を設定し、再起動します。

```dotenv
CLIST_USERNAME=your_username
CLIST_API_KEY=your_api_key
CLIST_RESOURCES=atcoder.jp,codeforces.com
```

過去7日〜未来90日を6時間ごとに取得します。Contests の Sync now でも開始できます。最低6.5秒間隔、ページング、429 の Retry-After、5xx・接続失敗の再試行に対応しています。ID で upsert し、参加予定・結果・非表示設定は保持します。欠落は即削除せず、3回連続または24時間で stale にします。障害時も保存済み予定を表示します。

Repovive / QOJ / UCup は、CLIST で実在する resource host を確認して CLIST_RESOURCES に追記してください。認証情報はクライアントに返しません。状態・失敗内容は Today / GET /api/status から確認できます。

参照: [CLIST API v4](https://clist.by/api/v4/doc/)

## Discord

Gateway ではなく、署名付き HTTP Interactions を受けます。常時起動する HTTPS サーバーが必要です。

1. Developer Portal でアプリと Bot を作成します。
2. .env の DISCORD_APPLICATION_ID / DISCORD_PUBLIC_KEY / DISCORD_BOT_TOKEN / DISCORD_GUILD_ID / DISCORD_OWNER_ID を設定します。
3. Interactions Endpoint URL を `https://your-domain.example/api/discord/interactions` に設定します。
4. OAuth2 の bot / applications.commands scope で対象 Guild に導入し、View Channel / Send Messages 権限を付与します。
5. `npm run discord:register` で対象 Guild のコマンドを登録します。同アプリの Guild コマンド一覧は置換されます。
6. Owner 専用チャンネルで /setup を実行します。通知先は DISCORD_CHANNEL_ID でも設定できます。

| コマンド | 動作 |
| --- | --- |
| /setup | チャンネルを通知先に登録 |
| /today, /progress | Web と同じ日次進捗 |
| /contests | 保存済みコンテスト |
| /add url: | 未接触候補を追加（Touched に加算しない） |
| /problems | 問題 Feed と結果ボタン |
| /review | 期限到来の復習と回答ボタン |

Solved / Learned / Thinking / Unknown / Skip を利用できます。Learned は Observation modal が必須。保存後に次候補へ進みます。署名・タイムスタンプ、Owner / Guild、期限付き nonce、永続 idempotency key を検証します。個人ログの返答は ephemeral です。

朝09:00・夜23:30・日曜23:45の週次投稿、参加予定コンテストの60分前 / 10分前通知に対応します。時刻は JST。朝は夜までの起動で当日分を補完し、コンテスト通知は期限後5分以内だけ補完します。共有チャンネルに設定すると進捗も共有されます。

delivery key・lease・Discord nonce・最大5回の再試行を使用します。権限エラーは即失敗し GET /api/status に件数を表示します。Discord nonce の有効期間を超えるクラッシュ復旧では再送の可能性があります。既存 Morning 投稿の進捗編集、Thread 作成、複数アカウントの /link は未実装です。

参照: [Discord Interactions](https://docs.discord.com/developers/interactions/receiving-and-responding)

## API

Owner session が必要です。ローカルでパスワード未設定の場合だけ loopback を Owner と扱います。

| Endpoint | 用途 |
| --- | --- |
| POST /api/login | Owner ログイン |
| GET /api/state | 状態と revision |
| PUT /api/state | 予定・設定・参加状態。revision 必須 |
| GET /api/status | 外部連携と通知の状態 |
| GET /api/v1/today | 日次進捗 |
| POST /api/v1/attempts | url / result / observation / key |
| POST /api/v1/reviews | id / answer / key |
| POST /api/v1/reviews/postpone | id の期限を1日延期 |
| POST /api/v1/clist/sync | 同期開始 |

GET /api/health と署名検証する Discord endpoint はログイン対象外です。Quick Log / Review は Web と Bot で同じ domain service を使用します。Settings から JSON export ができます。

Learned の Observation 必須、Solved 非降格、Unknown の3日後復習、slow solved の7日後、Learned の1→7→21日、Forgot の1日後リセットを実装。Skip と Review は Touched に加算しません。同日の同一問題を重複計上せず、週間 New Touched は初回接触のユニーク問題です。

## Worker と検証

Web は30秒間隔でジョブを実行します。PostgreSQL モードは `npm run worker` も使えます。DB lease / delivery key で並行実行を制御します。ファイルモードの別 worker は禁止しています。

```sh
npm run check
npm test
```

テストは domain、JST 境界、ファイル保存の並行更新とロールバック、HTTP 認証・CSRF・revision 競合、CLIST mock、Discord の実 Ed25519 署名・権限・nonce、通知重複防止を検証します。CLIST / Discord の実 API、PostgreSQL / Docker 起動は接続情報・実行環境を用意した後の確認項目です。

dist/ 単独の静的ホスティングでは API が動きません。Node サーバーと同一 origin で配信してください。以前の Sites URL はこの変更では更新されません。分析画面の一部グラフ・重点提案、週間テンプレート自動生成、Thinking のセッション末再提示は後続実装です。
