# 通常の Markdown サンプル

GFM 相当の記法・数式・コードハイライトの確認用です。[^1]

## 目次の確認用見出し

### 強調・取り消し線・自動リンク

**太字**、*斜体*、~~取り消し線~~、`インラインコード`。
自動リンク: https://example.com

> 引用ブロック
> 2 行目

## 表

| 機能 | 対応 | 備考 |
| :--- | :---: | ---: |
| 表 | ✅ | 左・中央・右寄せ |
| タスクリスト | ✅ | |
| 数式 | ✅ | KaTeX |

## タスクリスト

- [x] プロジェクト作成
- [x] プレビュー
- [ ] リリース
  - [ ] ネストしたタスク

## 数式

インライン数式: $E = mc^2$ と $\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$

ブロック数式:

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

$$
\begin{pmatrix} a & b \\ c & d \end{pmatrix}
\begin{pmatrix} x \\ y \end{pmatrix}
=
\begin{pmatrix} ax + by \\ cx + dy \end{pmatrix}
$$

## コード

```ts
interface User {
  id: number
  name: string
}

export function greet(user: User): string {
  return `Hello, ${user.name}!`
}
```

```python
def fib(n: int) -> int:
    return n if n < 2 else fib(n - 1) + fib(n - 2)

print([fib(i) for i in range(10)])
```

```bash
docker compose up dev
```

```
言語指定なしのコードブロック
```

## 脚注

[^1]: これは脚注です。

## HTML（サニタイズ確認）

<details><summary>折りたたみ</summary>

中身が表示されます。

</details>

<img src="x" onerror="alert('XSS')"> ← onerror は除去されます
<script>alert('XSS')</script>
