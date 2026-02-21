/**
 * WAILA - What Am I Looking At
 * Workflow search page for ShareDo Tools.
 * Searches visual workflow plans cached server-side.
 */
(function () {
    "use strict";

    var esc = shared.esc;
    var pollTimer = null;
    var advancedOpen = false;
    var lastResults = [];
    var lastSearchTerm = "";

    // ─── Init ───
    function init() {
        shared.init({ activePage: "waila" });
        shared.onEnvChange(function () { checkIndexStatus(); });
        shared.onCookieChange(function () { checkIndexStatus(); });

        document.getElementById("buildBtn").addEventListener("click", buildIndex);
        document.getElementById("searchBtn").addEventListener("click", runSearch);
        document.getElementById("advancedToggle").addEventListener("click", toggleAdvanced);
        document.getElementById("expandAllResults").addEventListener("click", function () { toggleAllCards(false); });
        document.getElementById("collapseAllResults").addEventListener("click", function () { toggleAllCards(true); });
        document.getElementById("exportBtn").addEventListener("click", exportCSV);

        var inputs = ["unifiedSearch", "filterSysName", "filterStepName", "filterBlockType", "filterBlockName", "filterConfig", "filterVariable"];
        for (var i = 0; i < inputs.length; i++) {
            document.getElementById(inputs[i]).addEventListener("keydown", function (e) { if (e.key === "Enter") runSearch(); });
        }

        // Exact Match toggle controls Case Sensitive visibility
        document.getElementById("filterExactMatch").addEventListener("change", function () {
            document.getElementById("caseSensitiveWrap").style.display = this.checked ? "" : "none";
            if (!this.checked) document.getElementById("filterCaseSensitive").checked = false;
        });

        // Script preview modal
        document.getElementById("scriptModalClose").addEventListener("click", closeScriptPreview);
        document.getElementById("scriptModalCopy").addEventListener("click", copyScriptToClipboard);
        document.getElementById("scriptModal").addEventListener("click", function (e) {
            if (e.target === this) closeScriptPreview();
        });
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && document.getElementById("scriptModal").style.display !== "none") {
                closeScriptPreview();
            }
        });

        // Diff
        document.getElementById("diffBtn").addEventListener("click", runDiff);
        loadDiffEnvDropdown();
        shared.onEnvChange(function () { loadDiffEnvDropdown(); });

        checkIndexStatus();
    }

    // ─── Index management ───
    function checkIndexStatus() {
        fetch("/api/waila/index/status").then(function (r) { return r.json(); }).then(function (data) {
            renderIndexStatus(data);
            if (data.status === "building") startPolling();
        }).catch(function () {});
    }

    function renderIndexStatus(data) {
        var statusEl = document.getElementById("indexStatus");
        var countEl = document.getElementById("indexCount");
        var timeEl = document.getElementById("indexTime");
        var progressEl = document.getElementById("indexProgress");
        var buildBtn = document.getElementById("buildBtn");
        var metaEl = document.getElementById("indexMeta");

        statusEl.className = "wla-panel__badge";

        if (data.status === "ready") {
            statusEl.textContent = "Ready";
            statusEl.classList.add("wla-panel__badge--ready");
            countEl.textContent = data.count + " workflow" + (data.count !== 1 ? "s" : "");
            timeEl.textContent = "Built " + shared.fmtDate(data.builtAt);
            metaEl.style.display = "";
            progressEl.style.display = "none";
            buildBtn.innerHTML = '<span class="fa fa-refresh"></span> Rebuild';
            buildBtn.classList.remove("usd-btn--loading");
        } else if (data.status === "building") {
            statusEl.textContent = "Building...";
            statusEl.classList.add("wla-panel__badge--building");
            countEl.textContent = "";
            timeEl.textContent = "";
            metaEl.style.display = "none";
            buildBtn.classList.add("usd-btn--loading");

            if (data.progress) {
                progressEl.style.display = "";
                var pct = data.progress.total > 0 ? Math.round((data.progress.fetched / data.progress.total) * 100) : 0;
                document.getElementById("progressFill").style.width = pct + "%";

                if (data.progress.phase === "listing") {
                    document.getElementById("progressCurrent").textContent = "Listing workflows...";
                    document.getElementById("progressText").textContent = "";
                } else {
                    document.getElementById("progressCurrent").textContent = data.progress.current || "";
                    document.getElementById("progressText").textContent = data.progress.fetched + " / " + data.progress.total;
                }
            }
        } else if (data.status === "error") {
            statusEl.textContent = "Error";
            statusEl.classList.add("wla-panel__badge--error");
            countEl.textContent = data.error || "";
            timeEl.textContent = "";
            metaEl.style.display = "";
            progressEl.style.display = "none";
            buildBtn.innerHTML = '<span class="fa fa-bolt"></span> Retry';
            buildBtn.classList.remove("usd-btn--loading");
        } else {
            statusEl.textContent = "Not built";
            countEl.textContent = "";
            timeEl.textContent = "";
            metaEl.style.display = "none";
            progressEl.style.display = "none";
            buildBtn.innerHTML = '<span class="fa fa-bolt"></span> Build Index';
            buildBtn.classList.remove("usd-btn--loading");
        }
    }

    function buildIndex() {
        document.getElementById("buildBtn").classList.add("usd-btn--loading");
        fetch("/api/waila/index/build", { method: "POST" })
            .then(function (r) { return r.json(); })
            .then(function () { startPolling(); })
            .catch(function () {});
    }

    function startPolling() {
        stopPolling();
        pollTimer = setInterval(function () {
            fetch("/api/waila/index/status").then(function (r) { return r.json(); }).then(function (data) {
                renderIndexStatus(data);
                if (data.status !== "building") stopPolling();
            }).catch(function () { stopPolling(); });
        }, 800);
    }

    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    // ─── Advanced toggle ───
    function toggleAdvanced() {
        advancedOpen = !advancedOpen;
        document.getElementById("advancedPanel").style.display = advancedOpen ? "" : "none";
        document.getElementById("advancedToggle").classList.toggle("usd-btn--active", advancedOpen);
    }

    // ─── Search ───
    function runSearch() {
        var unified = document.getElementById("unifiedSearch").value.trim();
        var body = {};

        // Match mode flags (from advanced panel, but apply to unified search too)
        var exactMatch = document.getElementById("filterExactMatch").checked;
        var caseSensitive = exactMatch && document.getElementById("filterCaseSensitive").checked;
        if (exactMatch) body.exactMatch = true;
        if (caseSensitive) body.caseSensitive = true;

        if (unified) {
            body.unified = unified;
        }

        if (advancedOpen && !unified) {
            var sn = document.getElementById("filterSysName").value.trim();
            var step = document.getElementById("filterStepName").value.trim();
            var bt = document.getElementById("filterBlockType").value.trim();
            var bn = document.getElementById("filterBlockName").value.trim();
            var cfg = document.getElementById("filterConfig").value.trim();
            var vr = document.getElementById("filterVariable").value.trim();
            if (sn) body.systemName = sn;
            if (step) body.stepName = step;
            if (bt) body.blockType = bt;
            if (bn) body.blockName = bn;
            if (cfg) body.configText = cfg;
            if (vr) body.variableText = vr;
        }

        var container = document.getElementById("resultsContainer");
        container.innerHTML = '<div class="wla-loading"><span class="fa fa-spinner fa-spin"></span> Searching...</div>';
        document.getElementById("resultsMeta").style.display = "none";

        fetch("/api/waila/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
            .then(function (r) { return r.json(); })
            .then(function (data) { renderResults(data, unified); })
            .catch(function (err) {
                container.innerHTML = '<div class="wla-no-results"><div class="wla-no-results__icon"><span class="fa fa-exclamation-triangle"></span></div><div class="wla-no-results__text">Search failed: ' + esc(err.message) + '</div></div>';
            });
    }

    // ─── Render results ───
    function renderResults(data, searchTerm) {
        var container = document.getElementById("resultsContainer");
        var metaEl = document.getElementById("resultsMeta");
        var exportPanel = document.getElementById("exportPanel");

        // Store for export
        lastSearchTerm = searchTerm || "";

        if (data.message && data.results && data.results.length === 0) {
            container.innerHTML = '<div class="wla-no-results"><div class="wla-no-results__icon"><span class="fa fa-database"></span></div><div class="wla-no-results__text">' + esc(data.message) + '</div></div>';
            metaEl.style.display = "none";
            lastResults = [];
            exportPanel.style.display = "none";
            return;
        }

        var results = data.results || [];
        lastResults = results;
        metaEl.style.display = "flex";
        document.getElementById("resultsCount").textContent = results.length + " result" + (results.length !== 1 ? "s" : "");
        document.getElementById("resultsTime").textContent = data.searchMs != null ? "(" + data.searchMs + "ms)" : "";

        // Show/hide export panel
        if (results.length > 0) {
            exportPanel.style.display = "";
            document.getElementById("exportCount").textContent = results.length + " row" + (results.length !== 1 ? "s" : "");
        } else {
            exportPanel.style.display = "none";
        }

        if (results.length === 0) {
            container.innerHTML = '<div class="wla-no-results"><div class="wla-no-results__icon"><span class="fa fa-search"></span></div><div class="wla-no-results__text">No workflows matched your search</div></div>';
            return;
        }

        var html = "";
        for (var i = 0; i < results.length; i++) {
            html += buildCard(results[i], searchTerm, i < 5);
        }
        container.innerHTML = html;
        wireCardEvents();
    }

    function buildCard(wf, searchTerm, expanded) {
        var matches = wf.matches || {};
        var hasMatches = (matches.steps && matches.steps.length) || (matches.actions && matches.actions.length) || (matches.configExcerpts && matches.configExcerpts.length) || (matches.variables && matches.variables.length);
        var collapsedCls = expanded && hasMatches ? "" : " wla-card--collapsed";

        var h = '<div class="wla-card' + collapsedCls + '" data-sn="' + esc(wf.systemName) + '">';
        h += '<div class="wla-card__header">';
        h += '<span class="fa fa-chevron-down wla-card__chevron"></span>';
        h += '<div class="wla-card__title-group">';
        h += '<div class="wla-card__name">' + highlightText(esc(wf.name), searchTerm) + '</div>';
        h += '<div class="wla-card__sysname">' + highlightText(esc(wf.systemName), searchTerm) + '</div>';
        h += '</div>';
        h += '<div class="wla-card__stats">';
        h += '<span class="wla-card__stat"><span class="fa fa-th-list"></span> ' + wf.stepCount + '</span>';
        h += '<span class="wla-card__stat"><span class="fa fa-cube"></span> ' + wf.actionCount + '</span>';
        h += '</div>';
        h += '<div class="wla-card__actions">';
        h += '<button class="usd-btn wla-card__script-btn" title="View compiled script" data-sn="' + esc(wf.systemName) + '" data-name="' + esc(wf.name) + '"><span class="fa fa-code"></span></button>';
        h += '<button class="usd-btn wla-card__copy-btn" title="Copy system name" data-copy="' + esc(wf.systemName) + '"><span class="fa fa-clipboard"></span></button>';
        h += '<button class="usd-btn wla-card__cmd-btn" title="Copy open command" data-sn="' + esc(wf.systemName) + '"><span class="fa fa-terminal"></span></button>';
        h += '</div>';
        h += '</div>';

        h += '<div class="wla-card__body">';

        if (wf.description) {
            h += '<div class="wla-card__description">' + esc(wf.description) + '</div>';
        }

        if (matches.steps && matches.steps.length) {
            h += '<div class="wla-card__match-section">';
            h += '<div class="wla-card__match-label"><span class="fa fa-th-list"></span> Matched Steps</div>';
            h += '<ul class="wla-card__match-list">';
            for (var s = 0; s < matches.steps.length; s++) {
                h += '<li class="wla-card__match-item">' + highlightText(esc(matches.steps[s]), searchTerm) + '</li>';
            }
            h += '</ul></div>';
        }

        if (matches.actions && matches.actions.length) {
            h += '<div class="wla-card__match-section">';
            h += '<div class="wla-card__match-label"><span class="fa fa-cube"></span> Matched Blocks</div>';
            h += '<ul class="wla-card__match-list">';
            for (var a = 0; a < matches.actions.length; a++) {
                h += '<li class="wla-card__match-item">' + highlightText(esc(matches.actions[a]), searchTerm) + '</li>';
            }
            h += '</ul></div>';
        }

        if (matches.configExcerpts && matches.configExcerpts.length) {
            h += '<div class="wla-card__match-section">';
            h += '<div class="wla-card__match-label"><span class="fa fa-code"></span> Config Matches</div>';
            for (var c = 0; c < matches.configExcerpts.length; c++) {
                h += '<div class="wla-card__config-excerpt">' + highlightText(esc(matches.configExcerpts[c]), searchTerm) + '</div>';
            }
            h += '</div>';
        }

        if (matches.variables && matches.variables.length) {
            h += '<div class="wla-card__match-section">';
            h += '<div class="wla-card__match-label"><span class="fa fa-tag"></span> Matched Variables</div>';
            h += '<ul class="wla-card__match-list">';
            for (var v = 0; v < matches.variables.length; v++) {
                h += '<li class="wla-card__match-item">' + highlightText(esc(matches.variables[v]), searchTerm) + '</li>';
            }
            h += '</ul></div>';
        }

        if (!hasMatches) {
            h += '<div class="wla-card__match-section"><div class="wla-card__match-label"><span class="fa fa-info-circle"></span> Matched on workflow name or system name</div></div>';
        }

        h += '</div></div>';
        return h;
    }

    function highlightText(text, term) {
        if (!term || !text) return text;
        var terms = term.trim().toLowerCase().split(/\s+/);
        var result = text;
        for (var i = 0; i < terms.length; i++) {
            if (!terms[i]) continue;
            var escaped = terms[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            var re = new RegExp("(" + escaped + ")", "gi");
            result = result.replace(re, '<span class="wla-match-hl">$1</span>');
        }
        return result;
    }

    // ─── Wire card events ───
    function wireCardEvents() {
        var cards = document.querySelectorAll(".wla-card");
        for (var i = 0; i < cards.length; i++) {
            var header = cards[i].querySelector(".wla-card__header");
            header.addEventListener("click", function (e) {
                if (e.target.closest(".wla-card__actions")) return;
                this.parentElement.classList.toggle("wla-card--collapsed");
            });
        }

        var copyBtns = document.querySelectorAll(".wla-card__copy-btn");
        for (var c = 0; c < copyBtns.length; c++) {
            copyBtns[c].addEventListener("click", function (e) {
                e.stopPropagation();
                copyToClipboard(this.dataset.copy);
            });
        }

        var cmdBtns = document.querySelectorAll(".wla-card__cmd-btn");
        for (var o = 0; o < cmdBtns.length; o++) {
            cmdBtns[o].addEventListener("click", function (e) {
                e.stopPropagation();
                var sn = this.dataset.sn;
                var cmd = '$ui.nav.openPanelCommand({"invokeType":"panel","invoke":"Sharedo.Core.Case.WorkflowEditor.WorkflowEditorBlade","config":{"planSystemName":"' + sn + '"},"meta":null})';
                copyToClipboard(cmd);
            });
        }

        var scriptBtns = document.querySelectorAll(".wla-card__script-btn");
        for (var s = 0; s < scriptBtns.length; s++) {
            scriptBtns[s].addEventListener("click", function (e) {
                e.stopPropagation();
                openScriptPreview(this.dataset.sn, this.dataset.name);
            });
        }
    }

    function toggleAllCards(collapse) {
        var cards = document.querySelectorAll(".wla-card");
        for (var i = 0; i < cards.length; i++) {
            if (collapse) cards[i].classList.add("wla-card--collapsed");
            else cards[i].classList.remove("wla-card--collapsed");
        }
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { showToast("Copied to clipboard"); });
        } else {
            var ta = document.createElement("textarea");
            ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
            document.body.appendChild(ta); ta.select();
            try { document.execCommand("copy"); showToast("Copied to clipboard"); } catch (e) {}
            document.body.removeChild(ta);
        }
    }

    function showToast(msg) {
        var existing = document.querySelector(".wla-toast");
        if (existing) existing.remove();
        var el = document.createElement("div");
        el.className = "wla-toast";
        el.textContent = msg;
        document.body.appendChild(el);
        requestAnimationFrame(function () { el.classList.add("wla-toast--visible"); });
        setTimeout(function () { el.classList.remove("wla-toast--visible"); setTimeout(function () { el.remove(); }, 200); }, 1500);
    }

    // ─── Environment Diff ───
    function loadDiffEnvDropdown() {
        fetch("/api/env").then(function (r) { return r.json(); }).then(function (data) {
            var currentName = data.current;
            var currentLabel = "";
            var select = document.getElementById("diffEnvTarget");
            select.innerHTML = "";
            for (var i = 0; i < data.environments.length; i++) {
                var env = data.environments[i];
                if (env.name === currentName) { currentLabel = env.label; continue; }
                var opt = document.createElement("option");
                opt.value = env.name;
                opt.textContent = env.label;
                select.appendChild(opt);
            }
            document.getElementById("diffEnvCurrentLabel").textContent = currentLabel || currentName;
        }).catch(function () {});
    }

    function runDiff() {
        var target = document.getElementById("diffEnvTarget").value;
        if (!target) { showToast("Select a target environment"); return; }

        var container = document.getElementById("resultsContainer");
        container.innerHTML = '<div class="wla-loading"><span class="fa fa-spinner fa-spin"></span> Comparing environments...</div>';
        document.getElementById("resultsMeta").style.display = "none";
        document.getElementById("exportPanel").style.display = "none";

        fetch("/api/waila/diff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetEnv: target })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                container.innerHTML = '<div class="wla-no-results"><div class="wla-no-results__icon"><span class="fa fa-exclamation-triangle"></span></div><div class="wla-no-results__text">' + esc(data.message) + '</div></div>';
                return;
            }
            renderDiff(data);
        })
        .catch(function (err) {
            container.innerHTML = '<div class="wla-no-results"><div class="wla-no-results__icon"><span class="fa fa-exclamation-triangle"></span></div><div class="wla-no-results__text">' + esc(err.message) + '</div></div>';
        });
    }

    function renderDiff(data) {
        var container = document.getElementById("resultsContainer");
        var h = "";

        // Header summary
        h += '<div class="wla-diff-header">';
        h += '<span class="wla-diff-header__env"><strong>' + esc(data.envA.label) + '</strong> (' + data.envA.count + ' workflows)</span>';
        h += '<span class="wla-diff-header__vs">vs</span>';
        h += '<span class="wla-diff-header__env"><strong>' + esc(data.envB.label) + '</strong> (' + data.envB.count + ' workflows)</span>';
        var totalDiffs = data.onlyA.length + data.onlyB.length + data.changed.length;
        if (totalDiffs === 0) {
            h += '<span class="wla-diff-header__stat wla-diff-header__stat--ok">Identical</span>';
        }
        h += '</div>';

        // Only in A
        if (data.onlyA.length) {
            h += '<div class="wla-diff-group">';
            h += '<div class="wla-diff-group__header wla-diff-group__header--removed"><span class="fa fa-chevron-down wla-diff-group__chevron"></span><span class="fa fa-minus-circle usd-clr--red"></span> Only in ' + esc(data.envA.label) + ' <span class="wla-diff-group__count wla-diff-group__count--removed">' + data.onlyA.length + '</span></div>';
            h += '<div class="wla-diff-group__body">';
            for (var a = 0; a < data.onlyA.length; a++) {
                var wa = data.onlyA[a];
                h += '<div class="wla-diff-item"><span class="wla-diff-item__name">' + esc(wa.name) + '</span> <span class="wla-diff-item__sysname">' + esc(wa.systemName) + '</span><span class="wla-diff-item__stats">' + wa.stepCount + ' steps, ' + wa.actionCount + ' blocks</span></div>';
            }
            h += '</div></div>';
        }

        // Only in B
        if (data.onlyB.length) {
            h += '<div class="wla-diff-group">';
            h += '<div class="wla-diff-group__header wla-diff-group__header--added"><span class="fa fa-chevron-down wla-diff-group__chevron"></span><span class="fa fa-plus-circle usd-clr--green"></span> Only in ' + esc(data.envB.label) + ' <span class="wla-diff-group__count wla-diff-group__count--added">' + data.onlyB.length + '</span></div>';
            h += '<div class="wla-diff-group__body">';
            for (var b = 0; b < data.onlyB.length; b++) {
                var wb = data.onlyB[b];
                h += '<div class="wla-diff-item"><span class="wla-diff-item__name">' + esc(wb.name) + '</span> <span class="wla-diff-item__sysname">' + esc(wb.systemName) + '</span><span class="wla-diff-item__stats">' + wb.stepCount + ' steps, ' + wb.actionCount + ' blocks</span></div>';
            }
            h += '</div></div>';
        }

        // Changed
        if (data.changed.length) {
            h += '<div class="wla-diff-group">';
            h += '<div class="wla-diff-group__header wla-diff-group__header--changed"><span class="fa fa-chevron-down wla-diff-group__chevron"></span><span class="fa fa-pencil usd-clr--amber"></span> Changed <span class="wla-diff-group__count wla-diff-group__count--changed">' + data.changed.length + '</span></div>';
            h += '<div class="wla-diff-group__body">';
            for (var c = 0; c < data.changed.length; c++) {
                var wc = data.changed[c];
                // Summary line
                var sumParts = [];
                for (var s = 0; s < wc.summary.length; s++) {
                    sumParts.push(wc.summary[s].field + ": " + wc.summary[s].valueA + " -> " + wc.summary[s].valueB);
                }
                h += '<div class="wla-diff-item" data-diff-idx="' + c + '"><span class="wla-diff-item__name">' + esc(wc.name) + '</span> <span class="wla-diff-item__sysname">' + esc(wc.systemName) + '</span>';
                if (sumParts.length) h += '<span class="wla-diff-item__stats">' + esc(sumParts.join(", ")) + '</span>';
                h += '</div>';

                // Detail (hidden by default, shown on click)
                h += '<div class="wla-diff-detail" data-diff-detail="' + c + '">';
                if (wc.steps.added.length) {
                    h += '<div class="wla-diff-detail__section"><div class="wla-diff-detail__label">Steps added in ' + esc(data.envB.label) + ':</div>';
                    for (var sa = 0; sa < wc.steps.added.length; sa++) h += '<div class="wla-diff-detail__line wla-diff-detail__added">+ ' + esc(wc.steps.added[sa]) + '</div>';
                    h += '</div>';
                }
                if (wc.steps.removed.length) {
                    h += '<div class="wla-diff-detail__section"><div class="wla-diff-detail__label">Steps removed (only in ' + esc(data.envA.label) + '):</div>';
                    for (var sr = 0; sr < wc.steps.removed.length; sr++) h += '<div class="wla-diff-detail__line wla-diff-detail__removed">- ' + esc(wc.steps.removed[sr]) + '</div>';
                    h += '</div>';
                }
                if (wc.steps.changed.length) {
                    h += '<div class="wla-diff-detail__section"><div class="wla-diff-detail__label">Steps changed:</div>';
                    for (var sc = 0; sc < wc.steps.changed.length; sc++) h += '<div class="wla-diff-detail__line wla-diff-detail__changed">~ ' + esc(wc.steps.changed[sc]) + '</div>';
                    h += '</div>';
                }
                if (wc.variables.added.length) {
                    h += '<div class="wla-diff-detail__section"><div class="wla-diff-detail__label">Variables added:</div>';
                    for (var va2 = 0; va2 < wc.variables.added.length; va2++) h += '<div class="wla-diff-detail__line wla-diff-detail__added">+ ' + esc(wc.variables.added[va2]) + '</div>';
                    h += '</div>';
                }
                if (wc.variables.removed.length) {
                    h += '<div class="wla-diff-detail__section"><div class="wla-diff-detail__label">Variables removed:</div>';
                    for (var vr2 = 0; vr2 < wc.variables.removed.length; vr2++) h += '<div class="wla-diff-detail__line wla-diff-detail__removed">- ' + esc(wc.variables.removed[vr2]) + '</div>';
                    h += '</div>';
                }
                h += '</div>';
            }
            h += '</div></div>';
        }

        // Identical count
        if (data.identicalCount > 0) {
            h += '<div class="usd-clr--muted" style="font-size:11px; padding:8px 0; font-family:Consolas,Courier New,monospace;">' + data.identicalCount + ' workflows identical across both environments</div>';
        }

        container.innerHTML = h;

        // Wire group headers to toggle collapse
        var diffHeaders = container.querySelectorAll(".wla-diff-group__header");
        for (var dh = 0; dh < diffHeaders.length; dh++) {
            diffHeaders[dh].addEventListener("click", function () {
                this.parentElement.classList.toggle("wla-diff-group--collapsed");
            });
        }

        // Wire changed items to toggle detail
        var diffItems = container.querySelectorAll(".wla-diff-item[data-diff-idx]");
        for (var di = 0; di < diffItems.length; di++) {
            diffItems[di].addEventListener("click", function () {
                this.classList.toggle("wla-diff-item--expanded");
            });
        }
    }

    // ─── CSV Export ───
    function exportCSV() {
        if (!lastResults.length) return;

        var headers = ["Name", "System Name"];
        var rows = [headers.join(",")];
        for (var i = 0; i < lastResults.length; i++) {
            var wf = lastResults[i];
            rows.push(csvEscape(wf.name) + "," + csvEscape(wf.systemName));
        }

        var now = new Date();
        var dd = String(now.getDate()).padStart(2, "0");
        var mm = String(now.getMonth() + 1).padStart(2, "0");
        var yy = String(now.getFullYear()).slice(-2);
        var termSlug = lastSearchTerm ? lastSearchTerm.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 60) : "all";
        var filename = "WAILA-export-" + dd + "-" + mm + "-" + yy + "-" + termSlug + ".csv";

        var blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);

        showToast("Exported " + lastResults.length + " rows");
    }

    function csvEscape(val) {
        if (val == null) return '""';
        var s = String(val);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        if (s.indexOf('"') !== -1 || s.indexOf(",") !== -1 || s.indexOf("\n") !== -1) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    // ─── Script Preview Modal ───
    var _currentScript = "";

    function openScriptPreview(systemName, displayName) {
        var modal = document.getElementById("scriptModal");
        var titleEl = document.getElementById("scriptModalTitle");
        var subtitleEl = document.getElementById("scriptModalSubtitle");
        var bodyEl = document.getElementById("scriptModalBody");
        var codeEl = document.getElementById("scriptModalCode");

        titleEl.textContent = displayName || systemName;
        subtitleEl.textContent = systemName;
        _currentScript = "";

        // Show modal with loading state
        bodyEl.innerHTML = '<div class="usd-modal__loading"><span class="fa fa-spinner fa-spin"></span> Generating script preview...</div>';
        modal.style.display = "flex";

        fetch("/api/waila/workflow/" + encodeURIComponent(systemName) + "/preview", {
            method: "POST"
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                bodyEl.innerHTML = '<div class="usd-modal__error"><span class="fa fa-exclamation-triangle"></span> ' + esc(data.message || "Failed to load script preview") + '</div>';
                return;
            }

            var script = data.script || "";
            _currentScript = script;

            if (!script) {
                bodyEl.innerHTML = '<div class="usd-modal__error">No script content returned</div>';
                return;
            }

            // Restore the pre/code structure
            bodyEl.innerHTML = '<pre class="wla-modal__pre line-numbers"><code class="language-javascript" id="scriptModalCode"></code></pre>';
            var newCodeEl = document.getElementById("scriptModalCode");
            newCodeEl.textContent = script;

            // Highlight with Prism
            if (typeof Prism !== "undefined") {
                Prism.highlightElement(newCodeEl);
            }
        })
        .catch(function (err) {
            bodyEl.innerHTML = '<div class="usd-modal__error"><span class="fa fa-exclamation-triangle"></span> ' + esc(err.message) + '</div>';
        });
    }

    function closeScriptPreview() {
        document.getElementById("scriptModal").style.display = "none";
        _currentScript = "";
    }

    function copyScriptToClipboard() {
        if (!_currentScript) { showToast("No script to copy"); return; }
        copyToClipboard(_currentScript);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();