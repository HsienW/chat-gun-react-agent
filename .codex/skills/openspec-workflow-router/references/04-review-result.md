# 04 Review Result

Use this prompt when Qwen should review Codex implementation output.

```text
請以 Qwen Code Reviewer / Secondary Architecture Reviewer 身分，審查 Codex 的執行結果。

Change：
{change_name}

Codex 摘要：
{change_summary}

修改檔案：
{target_files}

Diff 摘要：
{diff_summary}

驗證結果：
{verification_results}

請只 review，不修改檔案。優先審查貼出的 diff、修改檔案與直接相關 OpenSpec artifacts；不要重掃整個 repo。忽略 `.gitignore` 內文件、node_modules、dist、build、coverage。預設忽略 lockfile；若本 change 涉及 dependency 變更才讀取。

審查重點：

- 實作是否符合 proposal / design / specs / tasks。
- 是否有 scope creep。
- 是否破壞 API、event、state、schema、tool contract、error code。
- 若涉及解析、分類、tool、provider 或 planner，是否有 hard-coded mapping、keyword shortcut、特殊案例分支。
- Runtime validation、錯誤、timeout、cancel、unknown 狀態是否完整。
- 測試是否覆蓋本次 Requirement 與 regression。
- tasks.md 是否只勾選已完成且已驗證項目。

輸出格式：

### Findings

每項包含：

- 嚴重程度：Blocker / Major / Minor
- 檔案位置
- 問題
- 觸發情境
- 影響
- 建議修正
- 對應 Requirement / Task / Contract

### Open Questions

無則寫「無」。

### Verdict

- PASS：沒有 Blocker / Major
- PASS WITH MINOR：只有 Minor
- FAIL：存在 Blocker 或 Major，需交回 Codex

請使用繁體中文。
```
