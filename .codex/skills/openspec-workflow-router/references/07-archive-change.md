# 07 Archive Change

Use this prompt when a change is ready to archive and a commit message should be drafted.

```text
請啟動 OpenSpec change archive 流程：

{change_name}

前提：

- CCR 判定 READY_TO_ARCHIVE。
- Qwen review 沒有未處理 Blocker / Major。
- openspec validate {change_name} --strict 已通過。
- tasks.md 已如實勾選。

請執行 archive 所需步驟，但不要執行 git commit 或 git push。

不要重掃整個 repo。忽略 `.gitignore` 內文件、node_modules、dist、build、coverage。預設忽略 lockfile；若 archive diff 顯示 dependency 變更才讀取。

只讀取 archive 必要的 OpenSpec artifacts、驗證結果與 diff 摘要。

完成後輸出：

## Archive 結果
## 修改檔案
## 驗證結果
## 尚未處理事項
## 建議 Commit Message

Commit message 格式：

{commit_type}({scope}): {summary}

{body}

注意：git commit / push 由人手動完成。請使用繁體中文。
```
