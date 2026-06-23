Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

$requiredQwenArtifacts = @(
  "QWEN.md",
  ".qwen/settings.json",
  ".qwen/agents/secondary-architecture-reviewer.md",
  ".qwen/skills/secondary-architecture-reviewer/SKILL.md",
  ".qwen/skills/secondary-architecture-reviewer/reference.md"
)

foreach ($relativePath in $requiredQwenArtifacts) {
  $path = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Refusing cleanup because required Qwen reviewer artifact is missing: $relativePath"
  }
}

$targets = @(
  "GEMINI.md",
  ".gemini",
  ".trae/rules/doubao-reviewer.md",
  ".traecli/skills/secondary-architecture-reviewer",
  "openspec/changes/replace-gemini-reviewer-with-doubao-reviewer"
)

foreach ($relativePath in $targets) {
  $path = Join-Path $repoRoot $relativePath
  if (Test-Path -LiteralPath $path) {
    $resolvedPath = Resolve-Path -LiteralPath $path
    if (-not $resolvedPath.Path.StartsWith($repoRoot.Path, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing cleanup outside repository: $($resolvedPath.Path)"
    }
    Remove-Item -LiteralPath $resolvedPath.Path -Recurse -Force
    Write-Host "Removed $relativePath"
  }
}

Write-Host "Gemini reviewer cleanup complete."
