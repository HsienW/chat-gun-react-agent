#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"

required_qwen_artifacts=(
  "QWEN.md"
  ".qwen/settings.json"
  ".qwen/agents/secondary-architecture-reviewer.md"
  ".qwen/skills/secondary-architecture-reviewer/SKILL.md"
  ".qwen/skills/secondary-architecture-reviewer/reference.md"
)

for relative_path in "${required_qwen_artifacts[@]}"; do
  if [[ ! -e "${repo_root}/${relative_path}" ]]; then
    echo "Refusing cleanup because required Qwen reviewer artifact is missing: ${relative_path}" >&2
    exit 1
  fi
done

targets=(
  "GEMINI.md"
  ".gemini"
  ".trae/rules/doubao-reviewer.md"
  ".traecli/skills/secondary-architecture-reviewer"
  "openspec/changes/replace-gemini-reviewer-with-doubao-reviewer"
)

for relative_path in "${targets[@]}"; do
  target="${repo_root}/${relative_path}"
  if [[ -e "${target}" ]]; then
    resolved_target="$(cd -- "$(dirname -- "${target}")" && pwd)/$(basename -- "${target}")"
    case "${resolved_target}" in
      "${repo_root}"/*)
        rm -rf -- "${resolved_target}"
        echo "Removed ${relative_path}"
        ;;
      *)
        echo "Refusing cleanup outside repository: ${resolved_target}" >&2
        exit 1
        ;;
    esac
  fi
done

echo "Gemini reviewer cleanup complete."
