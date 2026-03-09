# Neon Bumper - 実装完了レポート

Webブラウザで動くマルチプレイヤー対戦ゲーム『Neon Bumper』の実装が完了しました。

## 実装した内容
- **バックエンド ([server.js](file:///c:/Users/canva/OneDrive/Desktop/test-code/web-game/server.js))**:
  - `express` による静的ファイルの配信
  - `socket.io` を用いたWebSocketリアルタイム通信
  - サーバー主導の物理演算（摩擦、移動、円同士の弾き合いの衝突判定、アリーナ境界判定）
- **フロントエンド (`public/*`)**:
  - [index.html](file:///c:/Users/canva/OneDrive/Desktop/test-code/web-game/public/index.html): Canvas要素とスタート画面のUI
  - [style.css](file:///c:/Users/canva/OneDrive/Desktop/test-code/web-game/public/style.css): ネオンカラー、ダークテーマのCSS装飾（軽量化のため画像不使用）
  - [game.js](file:///c:/Users/canva/OneDrive/Desktop/test-code/web-game/public/game.js): サーバーとの通信、マウスカーソルに追従する操作（クリックでダッシュ）、Canvas描画（プレイヤー、軌跡、アリーナ境界）

## 実行方法・手動検証プラン
Node.jsがインストールされている環境（VPSやローカルPC）で、以下の手順で起動できます。現在こちらの環境にはNode.jsがインストールされていなかったため、コードの生成まで完了しています。

1. コマンドプロンプト等で `web-game` ディレクトリへ移動します。
2. 依存関係をインストールします:
   ```bash
   npm install
   ```
3. サーバーを起動します:
   ```bash
   node server.js
   ```
4. ブラウザで `http://localhost:3000` にアクセスします。
5. 別のタブやスマートフォンなどの別端末からもアクセスし、名前を入力してゲームに参加することで、2〜3人（またはそれ以上）でのリアルタイムマルチプレイが可能です。

## 遊び方
* マウスカーソルの方向に自機が移動します。
* **クリック**するとカーソル方向へ「ダッシュ（体当たり）」します。（再使用に2秒のクールダウンあり）
* 他のプレイヤーにぶつかるとお互いに弾き飛びます。ダッシュを当てると大きく吹き飛ばすことができます。
* ピンク色の境界線の外側に押し出されると徐々にHPが減少します。HPが0になるとゲームオーバー（観戦モード）になります。
