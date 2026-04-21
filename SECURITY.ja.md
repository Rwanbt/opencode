<p align="center"><a href="SECURITY.md">English</a> | <a href="SECURITY.zh.md">简体中文</a> | <a href="SECURITY.zht.md">繁體中文</a> | <a href="SECURITY.ko.md">한국어</a> | <a href="SECURITY.de.md">Deutsch</a> | <a href="SECURITY.es.md">Español</a> | <a href="SECURITY.fr.md">Français</a> | <a href="SECURITY.it.md">Italiano</a> | <a href="SECURITY.da.md">Dansk</a> | <b>日本語</b> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

# セキュリティ

## 重要

AI が生成したセキュリティレポートは受け付けません。大量に届いていますが、すべてを審査するリソースはありません。提出した場合、自動的にプロジェクトから締め出されます。

## 脅威モデル

### 概要

OpenCode はローカルマシン上で動作する AI 駆動のコーディングアシスタントです。シェル実行、ファイル操作、Web アクセスなどの強力なツールへのアクセスを備えたエージェントシステムを提供します。

### サンドボックスなし

OpenCode はエージェントを**サンドボックス化しません**。権限システムはユーザーがエージェントの動作を把握しやすくするための UX 機能として存在します — コマンド実行やファイル書き込みなどの前に確認を求めます。しかし、セキュリティ分離を提供することを目的としていません。

真の分離が必要な場合は、OpenCode を Docker コンテナや VM 内で実行してください。

### サーバーモード

サーバーモードはオプトイン方式のみです。有効化時には `OPENCODE_SERVER_PASSWORD` を設定して HTTP Basic Auth を強制してください。これがないと、サーバーは認証なしで動作します（警告あり）。サーバーを保護するのはエンドユーザーの責任です — それが提供するいかなる機能も脆弱性ではありません。

### 対象外

| カテゴリ | 理由 |
| --- | --- |
| **オプトイン時のサーバーアクセス** | サーバーモードを有効にした場合、API アクセスは想定される動作です |
| **サンドボックスからの脱出** | 権限システムはサンドボックスではありません（上記参照） |
| **LLM プロバイダのデータ処理** | 設定した LLM プロバイダに送信されるデータはそのポリシーに従います |
| **MCP サーバの動作** | 設定した外部 MCP サーバは信頼境界の外にあります |
| **悪意ある設定ファイル** | ユーザーは自身の設定を制御します。それを変更することは攻撃ベクトルではありません |

---

# セキュリティ問題の報告

発見を責任を持って開示するご努力に感謝し、貢献を認めるためにあらゆる努力をします。

セキュリティ問題を報告するには、GitHub Security Advisory の ["Report a Vulnerability"](https://github.com/Rwanbt/opencode/security/advisories/new) タブを使用してください。

チームは次のステップを示す回答をお送りします。最初の回答後、セキュリティチームは修正と完全な発表に向けた進捗をお知らせし、追加情報を求めることがあります。

## エスカレーション

6 営業日以内に確認応答を受け取れない場合は、security@anoma.ly までメールでご連絡ください
