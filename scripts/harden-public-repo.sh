#!/usr/bin/env bash
# Three protections cannot live in a private template: GitHub only offers them to
# public repositories (and rulesets need Pro). So they are applied here, once, after
# a repo made from this template goes public.
#
#   ./scripts/harden-public-repo.sh owner/repo [required-check-name]
#
# The second argument is the CI job name that must pass before a merge; it defaults
# to the job in .github/workflows/ci.yml. Pass "" to skip the status-check rule
# (useful while a project still has no CI).
#
# Everything here is idempotent: run it again after changing a job name.
set -euo pipefail

REPO="${1:-}"
CHECK="${2-Check}"
[ -n "$REPO" ] || { echo "usage: $0 owner/repo [required-check-name]" >&2; exit 2; }

command -v gh >/dev/null || { echo "gh CLI not found" >&2; exit 127; }
gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated — run: gh auth login" >&2; exit 1; }

visibility=$(gh api "repos/$REPO" --jq .visibility)
if [ "$visibility" != "public" ]; then
  echo "$REPO is $visibility. These settings need a public repository; make it public first." >&2
  exit 1
fi

echo "== Dependabot alerts and automated security fixes"
gh api -X PUT "repos/$REPO/vulnerability-alerts"
gh api -X PUT "repos/$REPO/automated-security-fixes"

echo "== Secret scanning and push protection"
gh api -X PATCH "repos/$REPO" --input - >/dev/null <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON

echo "== Private vulnerability reporting"
gh api -X PUT "repos/$REPO/private-vulnerability-reporting"

# AI Scan for PRs is billed through GitHub Advanced Security from 2026-10-15; keep it off.
echo "== AI Scan for PRs: disabled"
gh api -X PATCH "repos/$REPO/code-scanning/ai-scan" -f pr_scan=disabled >/dev/null

echo "== Actions: GitHub-owned only, pinned to SHAs"
gh api -X PUT "repos/$REPO/actions/permissions" --input - >/dev/null <<'JSON'
{"enabled":true,"allowed_actions":"selected","sha_pinning_required":true}
JSON
gh api -X PUT "repos/$REPO/actions/permissions/selected-actions" --input - >/dev/null <<'JSON'
{"github_owned_allowed":true,"verified_allowed":false,"patterns":[]}
JSON
gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false >/dev/null

# A ruleset with the same name is replaced, so re-running never stacks duplicates.
delete_ruleset_named() {
  local name="$1" id
  id=$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$name\") | .id" | head -1)
  [ -n "$id" ] && gh api -X DELETE "repos/$REPO/rulesets/$id" >/dev/null || true
}

echo "== Branch ruleset on the default branch"
# bypass: the repository admin, so the owner is never locked out of their own repo.
rules='[{"type":"deletion"},{"type":"non_fast_forward"},
  {"type":"pull_request","parameters":{"required_approving_review_count":0,
    "dismiss_stale_reviews_on_push":false,"require_code_owner_review":false,
    "require_last_push_approval":false,"required_review_thread_resolution":false,
    "allowed_merge_methods":["squash"]}}]'
if [ -n "$CHECK" ]; then
  rules=$(printf '%s' "$rules" | sed 's/]$//')',
  {"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":false,
    "do_not_enforce_on_create":false,"required_status_checks":[
      {"context":"'"$CHECK"'","integration_id":15368}]}}]'
fi
delete_ruleset_named "default branch: CI green, no force-push, no deletion"
gh api -X POST "repos/$REPO/rulesets" --input - >/dev/null <<JSON
{"name":"default branch: CI green, no force-push, no deletion","target":"branch",
 "enforcement":"active",
 "bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}],
 "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
 "rules":$rules}
JSON

echo "== Tag ruleset: released v* tags are immutable"
delete_ruleset_named "release tags: immutable v*"
gh api -X POST "repos/$REPO/rulesets" --input - >/dev/null <<'JSON'
{"name":"release tags: immutable v*","target":"tag","enforcement":"active",
 "bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}],
 "conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},
 "rules":[{"type":"deletion"},{"type":"non_fast_forward"},{"type":"update"}]}
JSON

echo
echo "== Result for $REPO"
gh api "repos/$REPO" --jq '.security_and_analysis
  | "secret scanning: \(.secret_scanning.status), push protection: \(.secret_scanning_push_protection.status)"'
gh api "repos/$REPO/private-vulnerability-reporting" --jq '"private vulnerability reporting: \(if .enabled then "enabled" else "disabled" end)"'
gh api "repos/$REPO/code-scanning/ai-scan" --jq '"ai scan for PRs: \(.pr_scan)"'
gh api "repos/$REPO/actions/permissions" --jq '"actions: \(.allowed_actions), sha pinning: \(.sha_pinning_required)"'
gh api "repos/$REPO/rulesets" --jq '.[] | "ruleset: \(.name) [\(.target), \(.enforcement)]"'
