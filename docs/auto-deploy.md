# VPS で main を自動反映する

公開リポジトリ `Oxojo/cp-hub` を VPS が約1分ごとに取得します。GitHub Actions / SSH 秘密鍵 / webhook の追加設定は不要です。VPS の外向き HTTPS 接続と systemd / Docker Compose が必要です。

## 初回の設定（VPS で実行）

既存の配置先が `/home/ubuntu/apps/cp-hub`、ブランチが main、origin が `https://github.com/Oxojo/cp-hub.git` の場合:

```bash
cd ~/apps/cp-hub
git status --short
git pull --ff-only origin main
sudo bash scripts/install-auto-deploy.sh --check
sudo bash scripts/install-auto-deploy.sh
```

`--check` は必要コマンド・配置先・サービス実行ユーザーを表示し、systemd を変更しません。インストールでは checkout の所有ユーザーで動く systemd service と timer を登録します。サービスには Docker を操作できる docker 補助グループを付けます（Docker 操作権限はホストの管理者相当です）。ログインユーザーのグループや sudo 設定は変更しません。

初回は約15秒後にチェックします。最初の成功マーカーがないため、現在と同じコミットでも一度ビルド・テスト・再起動します。以後、更新がなければ再起動しません。公開 VPS 上での初回実行は利用者が確認してください。

`.env`、データ volume、`compose.override.yaml` は保持します。パスワードや Bot Token を GitHub に登録する必要はありません。

`git pull` がローカル変更のため失敗したら、変更を確認して調整してから進めてください。自動更新は tracked ファイルのローカル変更や履歴の分岐を上書きしません。`compose.override.yaml` と `backups/` は ignore 対象に追加済みです。

## 毎回の動作

1. 排他ロックを取得し、origin/main を fetch。
2. ローカル変更・履歴分岐がなければ main を fast-forward。
3. 新しい Web イメージをビルドし、構文チェックとテストをコンテナ内で実行。
4. 起動中の DB を `.deploy/backups/` へ pg_dump。
5. DB の起動・ヘルスを確認し、Web コンテナだけを再作成。
6. ローカル `/api/health` が PostgreSQL 接続で応答すれば SHA を保存。

更新は即時 push 通知ではなく、前回チェック終了から約60〜70秒後の確認で検出します。ビルド・テストの所要時間が別途かかります。同時デプロイはしません。Web 切替時には短い停止と再ログインが発生します。

ビルド・テスト・バックアップに失敗した場合、Web 切替前に止まります。Git の checkout は新しい SHA になっていても、成功マーカーは更新されないため次回再試行します。切替後にヘルスチェックが失敗した場合も次回再試行しますが、自動ロールバックはしません。DB に破壊的変更を伴う更新は、先に timer を停止して手動で計画してください。

DB が停止中なら dump は取得できないためスキップし、起動の復旧を試みます。バックアップは自動削除しないので空き容量を監視し、VPS 外にも保管してください。`.deploy/` は Git と Docker ビルドの対象外です。

## 状態確認

```bash
sudo systemctl list-timers cp-hub-deploy.timer
sudo journalctl -u cp-hub-deploy.service -n 100 --no-pager
cat .deploy/deployed-sha
git rev-parse origin/main
```

ログの `Deployment succeeded: ...` と2つの SHA が一致すれば最新 main を反映済みです。`Already deployed: ...` は正常な更新なしの確認です。

手動で今すぐ確認:

```bash
sudo systemctl start cp-hub-deploy.service
```

timer を停止（実行中のデプロイはそのまま完了させます）:

```bash
sudo systemctl disable --now cp-hub-deploy.timer
```

再開:

```bash
sudo systemctl enable --now cp-hub-deploy.timer
```

timer 停止後、Web を止めずに `.env` を編集することもできます。環境変数変更だけでは SHA が変わらないため、反映には次を実行してください。

```bash
sudo docker compose up -d --force-recreate web
```

本仕組みは現在公開されているリポジトリ向けです。非公開へ変更する場合は VPS 側に read-only の Git 認証を別途設定する必要があります。
