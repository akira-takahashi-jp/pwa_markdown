# Markdown Editor (PWA)

Mermaid・Marp・数式に対応した Markdown エディター兼ビューワー。PC の Chrome / Edge 向けの PWA で、オフラインでも動きます。

## 起動方法

### Docker（推奨）

```bash
docker compose up dev
```

http://localhost:5173 を開く。ソースはバインドマウントされているので、編集すると HMR で反映されます。
macOS などでファイル変更が反映されない場合は `VITE_USE_POLLING=true docker compose up dev`。

本番ビルドを nginx で配信（PWA・オフライン動作の確認用）:

```bash
docker compose --profile prod up --build prod
```

http://localhost:8080 を開く。ポートが使用中なら `PROD_PORT=18080` / `DEV_PORT=15173` のように変更できます。

> File System Access API と Service Worker は安全なコンテキストでのみ動作します。`localhost` 以外で配信する場合は HTTPS が必要です。

### ローカル（Node.js 24）

```bash
npm ci
npm run dev        # 開発サーバー
npm run build      # 型チェック + 本番ビルド（dist/）
npm run preview    # 本番ビルドの確認（http://localhost:4173）
```

## 公開（GitHub Pages）

https://akira-takahashi-jp.github.io/pwa_markdown/

`main` に push すると `.github/workflows/deploy.yml` がビルドして GitHub Pages に配信します。
プロジェクトサイトはサブパスで配信されるため、`BASE_PATH=/<リポジトリ名>/` でビルドしています（ローカル・Docker は `/` のまま）。

初回のみ、リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にしてください。

サブパスでの動作をローカルで確認する場合:

```bash
BASE_PATH=/pwa_markdown/ npm run build
BASE_PATH=/pwa_markdown/ npm run preview   # http://localhost:4173/pwa_markdown/
```

## 機能

| 分類 | 内容 |
| --- | --- |
| エディター | CodeMirror 6（行番号・折り返し・検索/置換・Markdown ハイライト）、タブで複数ファイルを同時に編集（タブごとに undo 履歴・カーソル・スクロール位置を保持）、2 ペイン（ドラッグでリサイズ）、表示モード切替、スクロール同期 |
| プレビュー | GFM（表・タスクリスト・取り消し線・自動リンク）、脚注、KaTeX、Shiki、アウトライン（サイドバー）、DOMPurify によるサニタイズ |
| Mermaid | ```` ```mermaid ```` を SVG に描画。構文エラーは図の位置にメッセージ表示。ライト/ダーク連動。コードのハッシュでキャッシュし、画面に近づいたときに遅延描画 |
| Marp | front-matter の `marp: true` でスライドモード。default / gaia / uncover テーマ、`<style>` のカスタム CSS、スライド内 mermaid、プレゼンテーション（F5、矢印キー、Esc） |
| ファイル | 開く（複数選択可）/上書き保存/名前を付けて保存、ドラッグ＆ドロップ（複数可）、全タブの IndexedDB への自動退避と次回起動時の復元、未保存時の ● 表示と離脱確認、非対応ブラウザ向けフォールバック |
| サイドバー | 上がエクスプローラ、下がアウトライン（見出し / スライド一覧）。それぞれ折りたため、境目のドラッグで高さを変えられる。エクスプローラには現在のプロジェクトと最近のプロジェクトを表示。プロジェクトはファイル・フォルダ・GitHub リポジトリのいずれかで、次回起動時も開き直す（フォルダは権限を再要求） |
| GitHub | 「ファイル → GitHub リポジトリを開く」で認証キー（Fine-grained token）を登録し、リポジトリ・ブランチを選ぶと .md のツリーをエクスプローラに表示。編集して保存（Ctrl+S）すると下書きとしてローカルに一時保存し、次回も続きから編集可能。下書きはまとめて 1 つのコミットにできる（新規ファイルにも対応） |
| エクスポート | 単一 HTML（スタイル・KaTeX フォント・mermaid SVG を埋め込み）、PDF（印刷、Marp は 1 スライド 1 ページ）、Marp スライド HTML |
| PWA | 全チャンク（mermaid / Marp / KaTeX フォント / Shiki 言語）のプリキャッシュ、インストール、`file_handlers`（OS から .md を開く）、「更新があります」トースト |

### GitHub 連携の使い方

1. GitHub の [Fine-grained token の発行画面](https://github.com/settings/personal-access-tokens/new) で、Repository access に対象のリポジトリを選び、Permissions の **Contents** を **Read and write** にして発行します。
2. メニューの「ファイル → GitHub リポジトリを開く」（Ctrl+Alt+G）でキーを貼り付けて接続します。キーはブラウザの IndexedDB にだけ保存され、GitHub の API 以外には送信しませんキーの確認・変更・削除はメニューの「設定 → GitHub の認証キー」からできます。
3. リポジトリ（`owner/repo`）とブランチを選んで開くと、エクスプローラに .md ファイルのツリーが表示されます。ブランチはツリーの上で切り替えられます。
4. 開いたファイルを編集して保存すると、下書き（未コミットの変更）として一時保存されます。ツリーでは ● が付き、閉じても次に開いたときは下書きの内容で開きます。下書きのあるリポジトリは、最近のプロジェクトにも件数が表示されます。
5. 「コミット」で下書きを選んで 1 つのコミットにまとめ、ブランチに積みます。編集を始めた後に同じファイルがリモートで変更されていた場合はコミットせずに知らせます（他のファイルの変更は問題ありません）。

ショートカット一覧はアプリ内の **?** ボタン（または F1）から確認できます。

## 動作確認用サンプル

`samples/` をウィンドウにドラッグ＆ドロップするか、Ctrl+O で開いてください。

| ファイル | 確認内容 |
| --- | --- |
| `basic.md` | 見出し・表・タスクリスト・数式・コード・脚注・HTML サニタイズ |
| `mermaid.md` | flowchart / sequenceDiagram / gantt / classDiagram / pie / 意図的な構文エラー |
| `marp.md` | gaia テーマ、カスタム CSS、`_class`、スライド内 mermaid、数式 |
| `marp-uncover.md` | uncover テーマ + invert |
| `large.md` | 約 5,000 行（`npm run gen:large` で再生成） |

## 構成

```
src/
  components/  Editor, Preview, SlidePreview, PresentationMode, Toolbar, Explorer, GitHub, TocSidebar, HelpDialog, Toast
  lib/
    markdown.ts   markdown-it の設定（ブロック単位で描画）
    blocks.ts     プレビューのブロック単位の差分更新
    highlight.ts  Shiki（言語を遅延読み込み）
    mermaid.ts    描画・キャッシュ・遅延描画
    marp.ts       marp-core の設定と mermaid 連携
    fs.ts         File System Access API、プロジェクト・最近のプロジェクト、IndexedDB
    github.ts     GitHub REST API（ツリー・blob・コミット）と下書きの保存
    export.ts     HTML / PDF 書き出し
    sanitize.ts   DOMPurify の設定
  styles/       app.css / preview.css / print.css
docker/         nginx.conf
samples/        動作確認用 Markdown
```

## 実装メモ

- **更新通知**: `registerType: 'prompt'` を使用。`autoUpdate` は新しい SW が有効になった時点でページを自動リロードするため、編集中の内容を守れるよう「更新があります」トーストの「再読み込み」で反映する方式にしています。
- **MathJax の除去**: marp-core は MathJax を同梱していますが、このアプリは KaTeX のみ使うため `vite.config.ts` のエイリアスで空モジュールに差し替えています（Marp チャンク 3.5MB → 1.8MB）。
- **Marp 内の mermaid**: marp-core の markdown-it に fence ルールを追加してプレースホルダを出力し、描画後に通常プレビューと同じキャッシュ付き描画関数で SVG に差し替えます。スライドは背景がテーマで決まるため、図は常にライト配色で描きます。
- **大きなファイル**: markdown-it のトークンをトップレベルのブロック単位で描画し、HTML のハッシュが同じブロックは DOM を使い回します（5,000 行で 1 回の更新 ~140ms → 50ms 未満）。
- **ショートカット**: `Ctrl+N` / `Ctrl+W` / `Ctrl+Tab` / `Ctrl+Shift+O` はブラウザが奪うため、新規は `Ctrl+Alt+N`、タブを閉じるは `Ctrl+Alt+W`、タブ切り替えは `Ctrl+Alt+→/←`、フォルダは `Ctrl+Alt+O` にしています。
- **タブ**: CodeMirror の EditorView は 1 つだけで、タブごとの `EditorState` を `setState` で切り替えています。同じファイルを再度開くと既存のタブに切り替わります（`isSameEntry` で判定）。
- **GitHub のコミット**: Git Data API で blob → tree（`base_tree` に差分だけ載せる）→ commit → ref の更新（`force: false`）の順に作ります。下書きには編集元の blob SHA を持たせ、最新のツリーと比べて競合を検出します。ref の更新が fast-forward にならなかったときは最新から作り直します。
