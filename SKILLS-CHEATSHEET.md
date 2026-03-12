# Skills Cheat Sheet (ShareDo Tools)

Use this page to pick the right skill quickly when working in this repo.

## What A Skill Is

A skill is a focused instruction pack (`SKILL.md`) for a specific domain or workflow.
It tells the agent:

1. When to use it.
2. When not to use it.
3. How to approach the task and what tools to prioritize.

For normal code changes in this Node/Express app, the default coding agent is usually enough.
Use skills when you need specialized workflows (Azure, GitHub issue triage, agent customization).

## Quick Rule For This Repo

1. Building/fixing app code in `server.js`, `server/*`, `public/*`: no special skill needed.
2. Azure hosting/deployment/troubleshooting work: use Azure skills.
3. Copilot instruction/agent setup work: use `agent-customization`.
4. Summarizing GitHub issues/PRs: use GitHub summary skill.

## Task -> Skill Map

1. Prepare this app for Azure (`azd`, infra files, hosting plan)
Skill: `azure-prepare`

2. Validate deploy readiness before shipping
Skill: `azure-validate`

3. Execute provisioning/deployment
Skill: `azure-deploy`

4. Troubleshoot Azure production problems (timeouts, failures, cold starts)
Skill: `azure-diagnostics`

5. Find Azure cost savings and waste
Skill: `azure-cost-optimization`

6. Run compliance/security posture review
Skill: `azure-compliance`

7. Inventory Azure resources across RGs/subscriptions
Skill: `azure-resource-lookup`

8. Create Azure architecture/resource relationship diagrams
Skill: `azure-resource-visualizer`

9. KQL and ADX query help
Skill: `azure-kusto`

10. Pick least-privilege Azure role assignments
Skill: `azure-rbac`

11. Update repo instructions, prompts, custom agents, applyTo patterns
Skill: `agent-customization`

12. Summarize GitHub issue/PR/notification
Skill: `summarize-github-issue-pr-notification`

## Best Prompt Template

Use this structure for reliable results:

```text
Goal: <what outcome you want>
Context: ShareDo Tools (Node/Express), files/features involved
Constraints: <deadline/risk/env restrictions>
Use skill: <exact skill name>
Output: <checklist, findings-first report, commands, or patch>
```

## Copy-Paste Prompts For Common Flows

### 1) Azure onboarding for this repo

```text
Goal: Prepare ShareDo Tools for Azure hosting.
Context: Node.js app with server.js, public dashboards, cache folder, Playwright dependency.
Constraints: Keep runtime config via env vars and preserve current local behavior.
Use skill: azure-prepare
Output: Proposed azure architecture, required files (azure.yaml + infra), and exact changes.
```

### 2) Pre-deploy safety check

```text
Goal: Validate this project is deployment-ready.
Context: ShareDo Tools repo after infra/app changes.
Constraints: Findings first, blockers clearly separated from warnings.
Use skill: azure-validate
Output: Pass/fail checklist with remediation steps.
```

### 3) Production issue triage (Azure)

```text
Goal: Diagnose production failures for the hosted ShareDo Tools app.
Context: Intermittent API/page errors and slow responses.
Constraints: Prioritize likely root cause and fastest safe mitigation.
Use skill: azure-diagnostics
Output: Root-cause candidates ranked by confidence, evidence, and fix actions.
```

### 4) Cost review

```text
Goal: Reduce monthly Azure cost for ShareDo Tools.
Context: Existing environment already deployed.
Constraints: No reliability regression.
Use skill: azure-cost-optimization
Output: Savings table with estimate, risk, and implementation effort.
```

### 5) Repo instruction cleanup

```text
Goal: Improve Copilot instructions for this repository.
Context: Need clearer coding conventions and safer edit rules.
Constraints: Keep instructions concise and enforceable.
Use skill: agent-customization
Output: Updated instruction files and explanation of applyTo patterns.
```

### 6) Fast PR summary

```text
Goal: Summarize PR #<id> for review handoff.
Context: Need risks, behavior changes, and test gaps.
Constraints: Keep it short and action-oriented.
Use skill: summarize-github-issue-pr-notification
Output: Summary, risks, and recommended next actions.
```

## Skill Chaining Patterns

1. New Azure rollout: `azure-prepare` -> `azure-validate` -> `azure-deploy`
2. Incident response: `azure-diagnostics` -> `azure-validate` (after fix)
3. Cost and governance pass: `azure-cost-optimization` + `azure-compliance`

## Common Mistakes To Avoid

1. Using an Azure skill for local JavaScript refactors.
2. Asking for deployment via `azure-prepare` (use `azure-deploy` for execution).
3. Skipping `azure-validate` before first production deploy.
4. Using broad prompts without constraints or desired output format.

## Reusable Chained Prompt Script

Copy, paste, and fill in the placeholders.

```text
You are orchestrating a chained workflow for this repository.

Project:
- Name: ShareDo Tools
- Stack: Node.js + Express + Playwright
- Key files: server.js, server/*, public/*

Global constraints:
- Preserve current local runtime behavior.
- Use environment variables for secrets/config.
- Provide findings first, then actions.

Phase 1
Use skill: azure-prepare
Goal: Prepare this app for Azure hosting and generate required project/deployment assets.
Output required:
1. Recommended Azure architecture
2. Required files and changes
3. Assumptions and risks

Phase 2
Use skill: azure-validate
Input: Output from Phase 1
Goal: Validate deployment readiness.
Output required:
1. Blockers
2. Warnings
3. Exact remediation steps

Gate:
- If blockers exist, stop and provide fix plan before deployment.
- If no blockers, continue.

Phase 3
Use skill: azure-deploy
Input: Validated outputs from Phase 2
Goal: Provision and deploy.
Output required:
1. Commands executed
2. Resources created/updated
3. Deployment endpoints/status

Phase 4 (only if issues appear)
Use skill: azure-diagnostics
Input: Deployment outputs and observed failures
Goal: Identify root cause and safe mitigation.
Output required:
1. Ranked root-cause hypotheses
2. Evidence per hypothesis
3. Immediate mitigation + permanent fix

Phase 5
Use skill: azure-cost-optimization
Goal: Identify safe post-deploy savings.
Output required:
1. Savings estimate per recommendation
2. Risk/impact level
3. Priority order

Final deliverable format:
1. Executive summary
2. Phase-by-phase results
3. Open risks
4. Next actions
```

### Minimal Version

```text
Phase 1: azure-prepare
Phase 2: azure-validate
Gate: stop on blockers
Phase 3: azure-deploy
Phase 4: azure-diagnostics (if needed)
Phase 5: azure-cost-optimization
Return findings first and actionable next steps.
```

## Real-World Example: Teams Alert Deduplication Fix

This is a worked example of the full Issue -> Fix workflow using GitHub Copilot skills.
Use it as a reference when raising and fixing bugs in this repo.

### The Problem

Multiple team members each running their own ShareDo Tools instance were firing
Teams webhook alerts independently, causing duplicated notifications for the same event.

### Step-by-Step: How This Was Fixed Using Copilot Skills

**Step 1 — Raise the issue with explicit skill name**

Describe the problem **and state which skill to use**:

```text
Goal: Fix duplicate Teams alerts from multiple instances.
Issue: The system needs to check if more than one person is sending Teams alerts,
       so there are no repeat/doubling up of alerts.
Use skill: suggest-fix-issue
```

Always include `Use skill: <name>` for reliability. Don't rely on Copilot to guess which skill.

**Step 2 — Let Copilot read the relevant code**

Copilot read the following files to understand the architecture:
- `server/health-monitor.js` — Teams alert dispatch logic
- `server/ux-monitor.js` — health check callers
- `server.js` — dependency injection / init wiring

You do not need to point Copilot at specific files — it searches the codebase itself.

**Step 3 — Root cause was identified**

`sendTeamsAlert()` in `health-monitor.js` had no deduplication. Every running instance
evaluates conditions independently and fires its own POST to the Teams webhook.

**Step 4 — Fix was applied across two files**

| File | Change |
|------|--------|
| `server/health-monitor.js` | Added file-based dedup: `_dedupDir`, `TEAMS_DEDUP_WINDOW_MS`, helpers `_sanitizeDedupTag` / `_isRecentlyTeamsSent` / `_markTeamsSent`, and a guard at the top of `sendTeamsAlert` |
| `server.js` | Passed `fs`, `path`, `baseDir: __dirname` into `healthMonitor.init()` |

**How dedup works:**

1. Before sending a Teams alert, a claim file is checked at `cache/teams-dedup/{tag}.json`.
2. If a claim file exists and is less than 5 minutes old, the alert is suppressed.
3. If no recent claim exists, the alert is sent and a new claim file is written.
4. The `cache/` directory is gitignored so claim files never appear in commits.

**Step 5 — Commit and push the fix**

```powershell
git pull
git add server/health-monitor.js server.js
git status                # verify only those two files are staged
git commit -m "fix: deduplicate Teams alerts to prevent multi-instance flooding"
git push
```

### Key Things To Know For Next Time

- You only need to describe the bug — Copilot finds the relevant files.
- The `suggest-fix-issue` skill is best for clear, scoped bugs (not vague feature requests).
- Always read the fix back before committing — ask Copilot to show you what changed.
- `cache/teams-dedup/` is auto-created at runtime; don't add it to source control.
- The dedup window is set by `TEAMS_DEDUP_WINDOW_MS` in `health-monitor.js` (default 5 min).

---

## Reusable Non-Azure Chain (Issue -> Fix -> Handoff)

Use this for day-to-day engineering work where you need to understand a GitHub issue quickly, propose a fix, and produce a clear handoff summary.

```text
You are orchestrating a non-Azure workflow for issue triage and fix proposal.

Context:
- Repository: ShareDo Tools
- Goal: Turn a GitHub issue into an actionable implementation plan.

Phase 1
Use skill: summarize-github-issue-pr-notification
Goal: Summarize the issue clearly.
Output required:
1. Problem statement
2. Impacted areas/files
3. Acceptance criteria inferred from issue

Phase 2
Use skill: suggest-fix-issue
Input: Summary from Phase 1
Goal: Propose a safe fix strategy.
Output required:
1. Root cause hypothesis
2. Minimal safe code changes
3. Test plan and regression risks

Phase 3
Use skill: summarize-github-issue-pr-notification
Input: Proposed fix details
Goal: Produce a reviewer-ready handoff summary.
Output required:
1. What will change
2. Why this approach
3. Validation evidence and open risks

Final deliverable format:
1. Findings first
2. Implementation plan
3. Tests to run
4. Reviewer checklist
```

### Minimal Non-Azure Version

```text
Phase 1: summarize-github-issue-pr-notification
Phase 2: suggest-fix-issue
Phase 3: summarize-github-issue-pr-notification (handoff-ready summary)
Return findings, fix plan, tests, and risks.
```

## Reusable Instruction-Tuning Chain (Team Copilot Standards)

Use this when you want consistent Copilot behavior across a repo or team.

```text
You are orchestrating an instruction-tuning workflow for this repository.

Context:
- Repository: ShareDo Tools
- Goal: Standardize Copilot behavior for coding, reviews, and safe edits.

Phase 1
Use skill: agent-customization
Goal: Audit existing instruction files and identify gaps/conflicts.
Output required:
1. Existing customization files discovered
2. Conflicts/overlaps (root vs scoped instructions)
3. Missing rules that matter for this repo

Phase 2
Use skill: agent-customization
Input: Audit from Phase 1
Goal: Design a clean instruction structure.
Output required:
1. Recommended file set (for example `copilot-instructions.md`, scoped `*.instructions.md`)
2. Clear `applyTo` patterns
3. Rule boundaries (coding style, testing, reviews, safety)

Phase 3
Use skill: agent-customization
Input: Structure from Phase 2
Goal: Implement or update instruction files.
Output required:
1. Exact files changed
2. Rule summary by file
3. Rationale for important rules

Phase 4
Use skill: agent-customization
Input: Updated files
Goal: Validate behavior with 2-3 representative prompts.
Output required:
1. Prompt examples used
2. Expected vs observed behavior
3. Final refinements

Final deliverable format:
1. Final instruction map
2. Copy-paste prompts for ongoing maintenance
3. Known limitations and future improvements
```

### Minimal Instruction-Tuning Version

```text
Phase 1: agent-customization (audit)
Phase 2: agent-customization (design structure + applyTo)
Phase 3: agent-customization (implement files)
Phase 4: agent-customization (validate with sample prompts)
Return final instruction map and maintenance prompts.
```
