import { useEffect, useRef } from 'react'
import { SHORTCUTS } from '../lib/shortcuts'

export function HelpDialog({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))]
  return (
    <dialog ref={ref} className="dialog help-dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <header>
        <h2>キーボードショートカット</h2>
        <button className="icon-btn" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
      </header>
      <div className="help-body">
        {groups.map((g) => (
          <section key={g}>
            <h3>{g}</h3>
            <table>
              <tbody>
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <tr key={s.keys + s.label}>
                    <td>
                      <kbd>{s.keys}</kbd>
                    </td>
                    <td>{s.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        <section>
          <h3>ヒント</h3>
          <ul>
            <li>front-matter に <code>marp: true</code> を書くとスライドモードになります。</li>
            <li>スライドをダブルクリックすると、そのスライドから発表を開始します。</li>
            <li>ファイルをウィンドウにドラッグ＆ドロップしても開けます（複数可）。</li>
            <li>開いているタブと編集内容はブラウザ内に自動で退避され、次回起動時やクラッシュ後に復元されます。</li>
            <li>「ファイル → GitHub リポジトリを開く」で認証キーを登録すると、リポジトリのファイルを編集できます。保存は下書き（ローカル）になり、「コミット」でまとめて反映します。</li>
            <li>ファイル・フォルダ・GitHub リポジトリは「プロジェクト」としてエクスプローラに表示され、最近のプロジェクトから開き直せます。</li>
          </ul>
        </section>
      </div>
    </dialog>
  )
}
