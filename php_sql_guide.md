# Neon Bumper - 外部サーバー (PHP + SQL) 実装ガイド

このドキュメントは、5人以上のキル（ラストヒット）を達成したプレイヤーが死亡した際に、スコア（キル数と名前）を外部のデータベースに保存するシステムの構築設計書です。

お手持ちのVPSやレンタルサーバー環境（PHPおよびMySQL/MariaDBが動作する環境）にて、以下のファイルを配置・実行してください。

## 1. データベース作成 (SQL)

以下のSQL文を実行し、ランキング用のテーブルを作成してください。

```sql
-- データベースがまだない場合は作成 (適宜変更してください)
CREATE DATABASE IF NOT EXISTS neon_bumper_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE neon_bumper_db;

-- スコア保存用テーブル
CREATE TABLE IF NOT EXISTS rankings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    player_name VARCHAR(50) NOT NULL,
    kills INT NOT NULL DEFAULT 0,
    score_date DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- キル数でソートするためのインデックス
CREATE INDEX idx_kills ON rankings (kills DESC);
```

## 2. スコア保存用API (`save_score.php`)

Node.jsサーバー(ゲームサーバー)からPOSTされるJSONデータを受け取り、データベースに保存するスクリプトです。公開ディレクトリに配置してください。

```php
<?php
// save_score.php
header('Content-Type: application/json; charset=UTF-8');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// データベース接続設定 (環境に合わせて変更してください)
$db_host = 'localhost';
$db_name = 'neon_bumper_db';
$db_user = 'root'; // 変更してください
$db_pass = 'password'; // 変更してください

try {
    $pdo = new PDO("mysql:host=$db_host;dbname=$db_name;charset=utf8mb4", $db_user, $db_pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["error" => "Database connection failed"]);
    exit;
}

// JSONリクエストの取得
$json = file_get_contents('php://input');
$data = json_decode($json, true);

if (!$data) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid JSON data"]);
    exit;
}

$name = isset($data['name']) ? trim($data['name']) : '';
$kills = isset($data['kills']) ? (int)$data['kills'] : 0;
$scoreDate = isset($data['score_date']) ? $data['score_date'] : date('Y-m-d H:i:s');

// バリデーション (5キル以上のみ保存)
if (empty($name) || $kills < 5) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid score criteria. Minimum 5 kills required."]);
    exit;
}

try {
    $stmt = $pdo->prepare("INSERT INTO rankings (player_name, kills, score_date) VALUES (:name, :kills, :score_date)");
    $stmt->bindValue(':name', $name, PDO::PARAM_STR);
    $stmt->bindValue(':kills', $kills, PDO::PARAM_INT);
    $stmt->bindValue(':score_date', date('Y-m-d H:i:s', strtotime($scoreDate)), PDO::PARAM_STR);
    $stmt->execute();

    echo json_encode(["success" => true, "message" => "Score saved successfully"]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(["error" => "Failed to save score"]);
}
?>
```

## 3. ランキング取得用API (`get_ranking.php`)

フロントエンドの画面左上にサーバー全体のトップランキングを表示するための取得APIです。

```php
<?php
// get_ranking.php
header('Content-Type: application/json; charset=UTF-8');
header("Access-Control-Allow-Origin: *");

// データベース接続設定 (save_score.phpと同じ)
$db_host = 'localhost';
$db_name = 'neon_bumper_db';
$db_user = 'root';
$db_pass = 'password';

try {
    $pdo = new PDO("mysql:host=$db_host;dbname=$db_name;charset=utf8mb4", $db_user, $db_pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["error" => "Database connection failed"]);
    exit;
}

try {
    // 上位10名を取得
    $stmt = $pdo->query("SELECT player_name, kills, score_date FROM rankings ORDER BY kills DESC LIMIT 10");
    $rankings = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode(["success" => true, "data" => $rankings]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(["error" => "Failed to fetch rankings"]);
}
?>
```

## 4. ゲーム側のURL設定
PHPサーバーを公開後、本ゲームプロジェクト([web-game/server.js](file:///c:/Users/canva/OneDrive/Desktop/test-code/web-game/server.js)) の26行目付近にある `SCORE_API_URL` の値を、あなたの `save_score.php` の実際のURLに変更してください。

```javascript
// 例:
const SCORE_API_URL = 'http://your-domain.com/neon_bumper/save_score.php';
```
