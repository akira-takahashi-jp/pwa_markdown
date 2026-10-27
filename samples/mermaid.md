# Mermaid サンプル

## flowchart

```mermaid
flowchart TD
  A[開始] --> B{条件}
  B -- Yes --> C[処理 1]
  B -- No --> D[処理 2]
  C --> E[終了]
  D --> E
```

## sequenceDiagram

```mermaid
sequenceDiagram
  participant U as ユーザー
  participant A as アプリ
  participant FS as File System
  U->>A: Ctrl+S
  A->>FS: createWritable()
  FS-->>A: OK
  A-->>U: 保存しました
```

## gantt

```mermaid
gantt
  title 開発スケジュール
  dateFormat YYYY-MM-DD
  section 実装
  エディター      :done,    a1, 2026-10-01, 5d
  Mermaid / Marp  :active,  a2, after a1, 7d
  section 仕上げ
  PWA 化          :         a3, after a2, 3d
  テスト          :         a4, after a3, 4d
```

## classDiagram

```mermaid
classDiagram
  class Document {
    +string name
    +string content
    +save()
  }
  class Slide {
    +number index
    +render()
  }
  Document "1" --> "*" Slide : contains
```

## 意図的な構文エラー

下の図はエラーメッセージが表示され、アプリ全体は動き続けます。

```mermaid
flowchart TD
  A[開始] --> --> B
  this is not valid mermaid
```

## エラーの後も描画が続くことの確認

```mermaid
pie title 好きな記法
  "Markdown" : 60
  "Mermaid" : 25
  "Marp" : 15
```
