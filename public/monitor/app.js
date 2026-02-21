(function () {
    "use strict";

    var CRITICAL_GROUPS = ["executionengine-cc", "sharedo-events-cc-executionengine"];
    var HIGH_IMPORTANCE_FRAGMENTS = ["executionengine-cc", "sharedo-events-cc", "events", "docgen", "notifications-email", "notifications-sms", "indexer-bulk", "indexer-batches"];
    var STREAM_DESCRIPTIONS = { "executionengine-cc": "Core workflow execution -- backlog >250 is critical", "sharedo-events-cc": "Events raised, processed by EE", "data-table-upload-processor": "Backlogs for data uploads", "data-table-upload-trigger": "Backlogs for data uploads", "docgen-events": "Document generation", "notifications-email": "Emails sent via ShareDo", "notifications-sms": "Client SMS, appointment confirmations", "indexer-batches": "Batch index operations", "indexer-bulk-events": "Bulk cascade events", "indexer-fallback": "Fallback/retry for failed index ops", "long-running-events": "Participant changes on Sharedos", "modeller-assistant-events": "Modeller assistant events", "solution-import-export": "Import / Export page backlogs", "exchange-calendar-sync": "Exchange calendar synchronisation" };
    var SQL_STATUS_MAP = { 0: { label: "Failed", cls: "usd-job-status--failed" }, 1: { label: "Success", cls: "usd-job-status--success" }, 2: { label: "Running", cls: "usd-job-status--running" }, 3: { label: "Cancelled", cls: "usd-job-status--disabled" }, 4: { label: "In Progress", cls: "usd-job-status--running" }, 5: { label: "Pending", cls: "usd-job-status--disabled" } };
    var CHECK_STATUS_MAP = { 0: { label: "OK", cls: "usd-check--ok" }, 1: { label: "Warning", cls: "usd-check--warn" }, 2: { label: "Error", cls: "usd-check--error" } };
    var CRITICAL_SERVICES = ["imanage-work", "imanage-oauth", "docusign"];

    var autoRefreshEnabled = true, refreshTimer = null, autoRefreshMs = 30000;

    // ─── Utilities (from shared) ───
    var esc = shared.esc, fmtNum = shared.fmtNum, fmtDate = shared.fmtDate;

    function fmtDuration(ms) { var s = Math.floor(ms/1000); if (s < 60) return s + "s"; var m = Math.floor(s/60); s = s%60; if (m < 60) return m + "m " + String(s).padStart(2,"0") + "s"; var h = Math.floor(m/60); m = m%60; if (h < 24) return h + "h " + String(m).padStart(2,"0") + "m"; var d = Math.floor(h/24); h = h%24; return d + "d " + h + "h"; }
    function formatNow(d) { var mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return d.getDate() + " " + mo[d.getMonth()] + " " + d.getFullYear() + ", " + String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0") + ":" + String(d.getSeconds()).padStart(2,"0"); }
    function setBadge(e, t, c) { e.textContent = t; e.className = "usd-badge " + c; }
    function setDot(e, c) { e.className = "usd-summary__dot " + c; }
    function errMsg(d) { return d && d.message ? ": " + esc(d.message) : ""; }
    function connCls(c) { return c === 0 ? "usd-conn--zero" : "usd-conn--ok"; }
    function todayLocalISO() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
    function weekAgoLocalISO() { var d = new Date(); d.setDate(d.getDate()-7); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }

    // ─── Init ───
    function init() {
        shared.init({ activePage: "monitor" });
        shared.onEnvChange(function () { wireExtLinks(); refreshAll(); });
        shared.onCookieChange(function () { refreshAll(); });
        document.getElementById("refreshBtn").addEventListener("click", refreshAll);
        document.getElementById("autoRefreshToggle").addEventListener("click", toggleAutoRefresh);
        document.getElementById("expandAllBtn").addEventListener("click", function () { toggleAllSections(false); });
        document.getElementById("collapseAllBtn").addEventListener("click", function () { toggleAllSections(true); });
        wireExtLinks();

        // Load settings
        fetch("/api/settings").then(function (r) { return r.json(); }).then(function (data) {
            if (data.autoRefreshInterval && data.autoRefreshInterval >= 5000) autoRefreshMs = data.autoRefreshInterval;
        }).catch(function () {}).finally(function () {
            document.getElementById("autoRefreshLabel").textContent = "Auto " + Math.round(autoRefreshMs / 1000) + "s";
            refreshAll(); startAutoRefresh();
        });
    }

    // ─── Refresh ───
    function refreshAll() {
        document.getElementById("refreshBtn").classList.add("usd-btn--loading");
        fetch("/api/refresh").then(function (r) { return r.json(); }).then(function (data) {
            if (data.error) { showGlobalError(data.message); return; }
            clearGlobalError();
            if (data.hasCookie !== undefined) shared.updateCookieStatus(data.hasCookie);
            renderStreamStats(data.streamStats, data.backlogAlerts, data.backlogThreshold); renderNodes(data.nodeStatus, data.nodeConsoles);
            renderESCluster(data.esClusterStatus); renderSearchIndex(data.indexerStatus);
            renderDiagConfig(data.diagConfig); renderSQLJobs(data.sqlJobs); renderSQLChecks(data.sqlChecks);
            renderMaintenancePlans(data.maintenancePlans); renderLinkedServices(data.linkedServices);
            updateTimestamp(data.timestamp);
            wireExtLinks();
        }).catch(function (err) { showGlobalError("Failed: " + err.message); })
          .finally(function () { document.getElementById("refreshBtn").classList.remove("usd-btn--loading"); });
    }
    function startAutoRefresh() { stopAutoRefresh(); refreshTimer = setInterval(function () { if (autoRefreshEnabled) refreshAll(); }, autoRefreshMs); }
    function stopAutoRefresh() { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } }
    function toggleAutoRefresh() { autoRefreshEnabled = !autoRefreshEnabled; document.getElementById("toggleTrack").classList.toggle("usd-toggle-track--active", autoRefreshEnabled); }
    function showGlobalError(m) { var e = document.getElementById("globalError"); e.textContent = m; e.style.display = "block"; }
    function clearGlobalError() { document.getElementById("globalError").style.display = "none"; }
    function updateTimestamp(iso) { document.getElementById("lastRefresh").textContent = formatNow(iso ? new Date(iso) : new Date()); }

    function wireExtLinks() {
        var host = document.getElementById("hostLabel").textContent;
        if (!host || host === "--") return;
        var links = document.querySelectorAll(".mon-ext-link");
        for (var i = 0; i < links.length; i++) {
            var path = links[i].dataset.path;
            if (path) { links[i].href = "https://" + host + path; links[i].target = "_blank"; }
        }
    }
    window.toggleSection = function (id) { document.getElementById(id).classList.toggle("usd-section--collapsed"); };
    function toggleAllSections(collapse) {
        var sections = document.querySelectorAll(".usd-section");
        for (var i = 0; i < sections.length; i++) {
            if (collapse) sections[i].classList.add("usd-section--collapsed");
            else sections[i].classList.remove("usd-section--collapsed");
        }
    }

    // ─── Stream Stats ───
    function renderStreamStats(data, alerts, threshold) {
        var c = document.getElementById("streamTableBody"), b = document.getElementById("badgeEE"), sE = document.getElementById("summaryEEStreams"), sD = document.getElementById("summaryEEStreamsDot");
        alerts = alerts || {}; threshold = threshold || 250;
        if (!data || data.error) { c.innerHTML = '<tr><td colspan="7" class="usd-table__muted">Failed to load' + errMsg(data) + '</td></tr>'; setBadge(b, "Error", "usd-badge--error"); return; }
        var streams = (Array.isArray(data) ? data : []).map(function (r) { return normaliseStream(r, threshold); });
        streams.sort(function (a, b2) { var ac = a.isCritical ? 0 : a.isHigh ? 1 : 2, bc = b2.isCritical ? 0 : b2.isHigh ? 1 : 2; return ac !== bc ? ac - bc : a.groupName.localeCompare(b2.groupName); });
        var h = "", ok = 0, hasErr = false;
        for (var i = 0; i < streams.length; i++) {
            var s = streams[i]; if (s.backlog === 0) ok++; if (s.backlogCls === "usd-backlog--error") hasErr = true;
            var alert = alerts[s.groupName]; var durStr = alert && alert.durationMs > 0 ? fmtDuration(alert.durationMs) : "";
            h += '<tr><td class="usd-table__mono">' + (s.isCritical ? '<span class="usd-critical-marker"></span>' : '') + esc(s.streamName) + '</td>';
            h += '<td class="usd-table__mono usd-table__muted">' + esc(s.groupName) + '</td><td class="usd-table__muted">' + esc(s.description) + '</td>';
            h += '<td><span class="usd-status-indicator"><span class="usd-status-dot ' + s.statusCls + '"></span> ' + esc(s.status) + '</span></td>';
            h += '<td class="usd-table__right"><span class="usd-conn-value ' + connCls(s.connections) + '">' + s.connections + '</span></td>';
            h += '<td class="usd-table__right"><span class="usd-backlog-value ' + s.backlogCls + '">' + s.backlog + '</span></td>';
            h += '<td class="usd-table__right usd-table__mono">' + (durStr ? '<span class="usd-alert-duration ' + s.backlogCls + '">' + durStr + '</span>' : '') + '</td></tr>';
        }
        c.innerHTML = h; sE.textContent = ok + " / " + streams.length;
        if (hasErr) { setBadge(b, "Critical", "usd-badge--error"); setDot(sD, "usd-summary-dot--error"); }
        else if (ok < streams.length) { setBadge(b, "Backlog", "usd-badge--warn"); setDot(sD, "usd-summary-dot--warn"); }
        else { setBadge(b, "All Clear", "usd-badge--ok"); setDot(sD, "usd-summary-dot--ok"); }
    }
    function normaliseStream(r, threshold) {
        var sn = r.streamName || r.eventStreamId || "unknown", gn = r.groupName || sn, bl = r.backlog || 0, co = r.connectionCount || 0;
        var isCrit = CRITICAL_GROUPS.indexOf(gn) !== -1, isH = false;
        for (var h = 0; h < HIGH_IMPORTANCE_FRAGMENTS.length; h++) { if (gn.indexOf(HIGH_IMPORTANCE_FRAGMENTS[h]) !== -1 || sn.indexOf(HIGH_IMPORTANCE_FRAGMENTS[h]) !== -1) { isH = true; break; } }
        var desc = "", dk = Object.keys(STREAM_DESCRIPTIONS);
        for (var d = 0; d < dk.length; d++) { if (gn.indexOf(dk[d]) !== -1 || sn.indexOf(dk[d]) !== -1) { desc = STREAM_DESCRIPTIONS[dk[d]]; break; } }
        var blC = bl === 0 ? "usd-backlog--ok" : bl > threshold ? "usd-backlog--error" : "usd-backlog--warn";
        return { streamName: sn, groupName: gn, description: desc, isCritical: isCrit, isHigh: isH, status: co > 0 ? "Live" : "No connections", statusCls: co > 0 ? "usd-status-dot--live" : "usd-status-dot--warn", connections: co, backlog: bl, backlogCls: blC };
    }

    // ─── Nodes ───
    function renderNodes(data, consoles) {
        var c = document.getElementById("nodeGrid"), sE = document.getElementById("summaryEENodes"), sD = document.getElementById("summaryEENodesDot");
        if (!data || data.error) { c.innerHTML = '<div class="usd-table__muted" style="padding:12px">Failed to load</div>'; return; }
        var nodes = Array.isArray(data) ? data : (data.nodes && Array.isArray(data.nodes) ? data.nodes : []);
        if (!nodes.length) { c.innerHTML = '<div class="usd-table__muted" style="padding:12px">No nodes</div>'; return; }
        var h = "", ok = 0;
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i], nm = n.systemName || n.name || "Unknown", v = n.version || "--", st = n.lastStarted ? fmtDate(n.lastStarted) : "--";
            var run = n.running || 0, stop = n.stopped || 0, rst = n.restarting || 0, good = stop === 0 && rst === 0 && run > 0; if (good) ok++;
            var lines = (consoles && consoles[nm]) ? consoles[nm] : [];
            h += '<div class="usd-node-card"><div class="usd-node-card__header"><div>';
            h += '<div class="usd-node-card__name">' + esc(nm) + '</div><div class="usd-node-card__meta">' + esc(v) + ' | Started: ' + esc(st) + '</div>';
            h += '<div class="usd-node-card__meta">Roles: ' + run + ' running'; if (stop > 0) h += ', <span style="color:#ef5350">' + stop + ' stopped</span>'; if (rst > 0) h += ', <span style="color:#f0a840">' + rst + ' restarting</span>';
            h += '</div></div><span class="usd-node-card__status ' + (good ? "usd-node-card__status--ok" : "usd-node-card__status--error") + '"><span class="fa ' + (good ? "fa-check" : "fa-times") + '"></span></span></div>';
            h += '<div class="usd-node-console">'; for (var j = 0; j < lines.length; j++) h += '<div class="usd-node-console__line">' + esc(typeof lines[j] === "string" ? lines[j] : JSON.stringify(lines[j])) + '</div>';
            if (!lines.length) h += '<div class="usd-node-console__line">[No console output]</div>'; h += '</div></div>';
        }
        c.innerHTML = h; sE.textContent = ok + " / " + nodes.length; setDot(sD, ok === nodes.length ? "usd-summary-dot--ok" : "usd-summary-dot--error");
    }

    // ─── ES Cluster ───
    function renderESCluster(data) {
        var c = document.getElementById("clusterBar"), sE = document.getElementById("summaryESCluster"), sD = document.getElementById("summaryESClusterDot");
        if (!data || data.error) { c.innerHTML = '<div class="usd-table__muted" style="padding:4px 12px 8px">Failed to load' + errMsg(data) + '</div>'; sE.textContent = "ERR"; setDot(sD, "usd-summary-dot--error"); return; }
        var isH = (data.healthStatus || "").toLowerCase() === "green"; var lbl = isH ? "Healthy" : "Unhealthy";
        c.innerHTML = '<div class="usd-cluster-info"><span class="usd-status-indicator"><span class="usd-status-dot ' + (isH ? "usd-status-dot--live" : "usd-status-dot--warn") + '"></span> <span class="' + (isH ? "usd-cluster--healthy" : "usd-cluster--unhealthy") + '">' + esc(lbl) + '</span></span><span class="usd-cluster-detail">' + (data.numberOfNodes || 0) + ' nodes | ' + fmtNum(data.numberOfActiveShards) + ' active shards | ' + fmtNum(data.numberOfUnassignedShards) + ' unassigned</span></div>';
        sE.textContent = lbl; setDot(sD, isH ? "usd-summary-dot--ok" : "usd-summary-dot--error");
    }

    // ─── Search Index ───
    function renderSearchIndex(data) {
        var ig = document.getElementById("indexGrid"), eg = document.getElementById("eventStoreGrid");
        var b = document.getElementById("badgeSearch"), sE = document.getElementById("summarySearchIndexes"), sD = document.getElementById("summarySearchIndexesDot");
        if (!data || data.error) { ig.innerHTML = '<div class="usd-table__muted" style="padding:12px">Failed to load' + errMsg(data) + '</div>'; eg.innerHTML = ""; setBadge(b, "Error", "usd-badge--error"); setDot(sD, "usd-summary-dot--error"); sE.textContent = "ERR"; return; }
        var idxs = data.indexData || [], h = "", hI = 0;
        for (var i = 0; i < idxs.length; i++) { var x = idxs[i]; if (x.indexBacklog === 0 && x.elasticCountValid) hI++;
            h += '<div class="usd-index-card"><div class="usd-index-card__header"><span class="usd-index-card__type"><span class="fa ' + (x.icon || "fa-list-alt") + '"></span> ' + esc(x.type) + '</span>' + (x.elasticCountValid ? '<span class="usd-idx-valid"><span class="fa fa-check"></span></span>' : '<span class="usd-idx-invalid"><span class="fa fa-times"></span></span>') + '</div>';
            h += '<div class="usd-index-card__row"><span class="usd-index-card__label">DB Count</span><span class="usd-index-card__value">' + fmtNum(x.count) + '</span></div>';
            h += '<div class="usd-index-card__row"><span class="usd-index-card__label">ES Count</span><span class="usd-index-card__value">' + fmtNum(x.elasticCount) + '</span></div>';
            h += '<div class="usd-index-card__row"><span class="usd-index-card__label">Backlog</span><span class="usd-index-card__value ' + (x.indexBacklog === 0 ? "usd-idx-backlog--zero" : "usd-idx-backlog--nonzero") + '">' + fmtNum(x.indexBacklog) + '</span></div>';
            h += '<div class="usd-index-card__row"><span class="usd-index-card__label">Index</span><span class="usd-index-card__value usd-index-card__value--small">' + esc(x.elasticIndex || "") + '</span></div></div>'; }
        ig.innerHTML = h; sE.textContent = hI + " / " + idxs.length;
        if (hI === idxs.length) { setBadge(b, "Synced", "usd-badge--ok"); setDot(sD, "usd-summary-dot--ok"); } else { setBadge(b, hI + "/" + idxs.length + " Synced", "usd-badge--warn"); setDot(sD, "usd-summary-dot--warn"); }
        var eH = "", sDs = [{ key: "bulkStream", label: "Bulk Stream" }, { key: "batchStream", label: "Batch Stream" }, { key: "fallbackStream", label: "Fallback Stream" }];
        if (data.eventStore) { for (var j = 0; j < sDs.length; j++) { var s = data.eventStore[sDs[j].key]; if (!s) continue;
            eH += '<div class="usd-es-card"><div class="usd-es-card__title"><span class="usd-status-dot ' + (s.status === "Live" ? "usd-status-dot--live" : "usd-status-dot--warn") + '"></span> ' + esc(sDs[j].label) + '</div>';
            eH += '<div class="usd-es-card__row"><span class="usd-es-card__label">Status</span><span class="usd-es-card__value">' + esc(s.status) + '</span></div>';
            eH += '<div class="usd-es-card__row"><span class="usd-es-card__label">Backlog</span><span class="usd-es-card__value ' + (s.backlog === 0 ? "usd-idx-backlog--zero" : "usd-idx-backlog--nonzero") + '">' + s.backlog + '</span></div>';
            eH += '<div class="usd-es-card__row"><span class="usd-es-card__label">Connections</span><span class="usd-es-card__value ' + connCls(s.connectionCount) + '">' + s.connectionCount + '</span></div>';
            eH += '<div class="usd-es-card__row"><span class="usd-es-card__label">Total Processed</span><span class="usd-es-card__value">' + fmtNum(s.totalItemsProcessed) + '</span></div>';
            eH += '<div class="usd-es-card__row"><span class="usd-es-card__label">In-Flight</span><span class="usd-es-card__value">' + s.totalInFlightMessages + '</span></div></div>'; } }
        eg.innerHTML = eH;
    }

    // ─── Diagnostics Config ───
    function renderDiagConfig(data) {
        var container = document.getElementById("configGrid"), badge = document.getElementById("badgeConfig");
        var summaryEl = document.getElementById("summaryConfigCount"), summaryDot = document.getElementById("summaryConfigDot");
        if (!data || data.error) { container.innerHTML = '<div class="usd-table__muted" style="padding:12px">Failed to load' + errMsg(data) + '</div>'; setBadge(badge, "Error", "usd-badge--error"); setDot(summaryDot, "usd-summary-dot--error"); summaryEl.textContent = "ERR"; return; }
        var orgName = data.defaultOrganisationNames || "Unknown", orgAct = data.defaultOrganisationCount || 0, orgInact = data.defaultInactiveOrganisationCount || 0;
        var singleOrg = orgAct === 1; var orgDisp, orgCls;
        if (orgInact > 0) { orgDisp = orgName + " (Inactive)"; orgCls = "usd-cfg-val--fail"; } else if (orgAct > 0) { orgDisp = orgName + " (Active)"; orgCls = "usd-cfg-val--pass"; } else { orgDisp = orgName + " (Unknown)"; orgCls = "usd-cfg-val--fail"; }
        var teamName = data.defaultTeamNames || "Unknown", teamAct = data.defaultTeamCount || 0, teamInact = data.defaultInactiveTeamCount || 0;
        var singleTeam = teamAct === 1; var teamDisp, teamCls;
        if (teamInact > 0) { teamDisp = teamName + " (Inactive)"; teamCls = "usd-cfg-val--fail"; } else if (teamAct > 0) { teamDisp = teamName + " (Active)"; teamCls = "usd-cfg-val--pass"; } else { teamDisp = teamName + " (Unknown)"; teamCls = "usd-cfg-val--fail"; }
        var maxOS = data.maxOptionSetId || 0, nextOS = data.nextOptionSetId || 0, osConflict = nextOS <= maxOS;
        var osTooltip = osConflict ? "ALTER SEQUENCE dbo.option_set_value_ids RESTART WITH " + (maxOS+1) : "No conflict";
        var checks = [
            { label: "Snapshot Isolation Enabled", value: data.isSnapshotIsolationEnabled, expect: true, type: "bool", tooltip: "This should be enabled for correct transaction handling" },
            { label: "Read Committed Snapshot Mode Enabled", value: data.isReadCommittedSnapshotEnabled, expect: true, type: "bool", tooltip: "This should be enabled for correct transaction handling" },
            { label: "Single Default Organisation", display: singleOrg ? "true" : "false", cls: singleOrg ? "usd-cfg-val--pass" : "usd-cfg-val--fail", type: "custom", isIssue: !singleOrg, tooltip: orgName },
            { label: "Default Organisation Status", display: orgDisp, cls: orgCls, type: "custom", isIssue: orgCls === "usd-cfg-val--fail" },
            { label: "Single Default Team", display: singleTeam ? "true" : "false", cls: singleTeam ? "usd-cfg-val--pass" : "usd-cfg-val--fail", type: "custom", isIssue: !singleTeam, tooltip: teamName },
            { label: "Default Team Status", display: teamDisp, cls: teamCls, type: "custom", isIssue: teamCls === "usd-cfg-val--fail" },
            { label: "Disabled Foreign Keys", value: data.disabledForeignKeyCount, expect: 0, type: "zero", tooltip: "All foreign key constraints should be enabled" },
            { label: "Untrusted Foreign Keys", value: data.untrustedForeignKeyCount, expect: 0, type: "zero", tooltip: "All foreign key constraints should be enabled using 'WITH CHECK' syntax" },
        ];

        // Backplane -- only show if the property exists in the response
        if (data.backplaneConnected !== undefined) {
            checks.push({ label: "Backplane Connected", value: data.backplaneConnected, expect: true, type: "bool", tooltip: "Whether the application is connected to the backplane" });
        }

        checks.push({ label: "Option Set Value Conflict", display: osConflict ? "Conflict" : "None", cls: osConflict ? "usd-cfg-val--fail" : "usd-cfg-val--pass", type: "custom", isIssue: osConflict, tooltip: osTooltip },
            { label: "Max OptionSet ID", value: data.maxOptionSetId, type: "number" },
            { label: "Next OptionSet ID", value: data.nextOptionSetId, type: "number", tooltip: nextOS <= maxOS ? "Should be greater than Max" : null }
        );
        var html = "", failCount = 0;
        for (var i = 0; i < checks.length; i++) { var ck = checks[i], cls = "usd-cfg-val--neutral", display = ""; var tt = ck.tooltip ? ' title="' + esc(ck.tooltip) + '"' : '';
            if (ck.type === "custom") { cls = ck.cls; display = ck.display; if (ck.isIssue) failCount++; }
            else if (ck.type === "bool") { display = ck.value ? "true" : "false"; cls = ck.value === ck.expect ? "usd-cfg-val--pass" : "usd-cfg-val--fail"; if (ck.value !== ck.expect) failCount++; }
            else if (ck.type === "zero") { display = String(ck.value); cls = ck.value === 0 ? "usd-cfg-val--pass" : "usd-cfg-val--fail"; if (ck.value !== 0) failCount++; }
            else if (ck.type === "number") { display = fmtNum(ck.value); } else { display = String(ck.value); }
            html += '<div class="usd-config-item"' + tt + '><span class="usd-config-item__label">' + esc(ck.label); if (ck.tooltip) html += ' <span class="fa fa-info-circle usd-config-item__info"></span>';
            html += '</span><span class="usd-config-item__value ' + cls + '">' + esc(display) + '</span></div>'; }
        container.innerHTML = html;
        summaryEl.textContent = failCount === 0 ? "OK" : failCount + " issue" + (failCount > 1 ? "s" : "");
        if (failCount === 0) { setBadge(badge, "Healthy", "usd-badge--ok"); setDot(summaryDot, "usd-summary-dot--ok"); }
        else { setBadge(badge, failCount + " Issue" + (failCount > 1 ? "s" : ""), "usd-badge--error"); setDot(summaryDot, "usd-summary-dot--error"); }
    }

    // ─── SQL Jobs ───
    function renderSQLJobs(data) {
        var c = document.getElementById("jobTableBody"), b = document.getElementById("badgeSQL"), sE = document.getElementById("summarySQLAgent"), sD = document.getElementById("summarySQLAgentDot");
        if (!data || data.error) { c.innerHTML = '<tr><td colspan="6" class="usd-table__muted">Failed to load' + errMsg(data) + '</td></tr>'; setBadge(b, "Error", "usd-badge--error"); setDot(sD, "usd-summary-dot--error"); sE.textContent = "ERR"; return; }
        var jobs = Array.isArray(data) ? data : [], h = "", ok = 0, hasFail = false, hasRunning = false, inactive = 0;
        for (var i = 0; i < jobs.length; i++) { var j = jobs[i], st = SQL_STATUS_MAP[j.status] || { label: "Unknown", cls: "usd-job-status--disabled" };
            if (st.cls === "usd-job-status--success") ok++; if (st.cls === "usd-job-status--failed") hasFail = true; if (st.cls === "usd-job-status--running") hasRunning = true; if (st.cls === "usd-job-status--disabled") inactive++;
            h += '<tr><td class="usd-table__mono">' + esc(j.name) + '</td><td class="usd-table__muted">' + esc(j.description) + '</td><td><span class="usd-job-status ' + st.cls + '">' + esc(st.label) + '</span></td>';
            h += '<td class="usd-table__mono">' + fmtDate(j.executedAt) + '</td><td class="usd-table__right usd-table__mono">' + (j.executionMinutes != null ? j.executionMinutes : "--") + '</td><td class="usd-table__mono">' + fmtDate(j.nextRun) + '</td></tr>'; }
        c.innerHTML = h; sE.textContent = ok + " / " + jobs.length;
        if (hasFail) { setBadge(b, "Failed", "usd-badge--error"); setDot(sD, "usd-summary-dot--error"); }
        else if (hasRunning) { setBadge(b, "In Progress", "usd-badge--warn"); setDot(sD, "usd-summary-dot--warn"); }
        else if (inactive > 0 && ok > 0) { setBadge(b, ok + " OK", "usd-badge--ok"); setDot(sD, "usd-summary-dot--ok"); }
        else if (inactive > 0) { setBadge(b, "Inactive", "usd-badge--warn"); setDot(sD, "usd-summary-dot--warn"); }
        else { setBadge(b, "All OK", "usd-badge--ok"); setDot(sD, "usd-summary-dot--ok"); }
    }
    function renderSQLChecks(data) {
        var c = document.getElementById("checkTableBody"), w = document.getElementById("checksSection");
        if (!data || data.error || !Array.isArray(data) || !data.length) { w.style.display = "none"; return; }
        w.style.display = "block"; var h = "";
        for (var i = 0; i < data.length; i++) { var ck = data[i], st = CHECK_STATUS_MAP[ck.status] || { label: "Unknown", cls: "usd-check--warn" };
            h += '<tr><td class="usd-table__mono">' + esc(ck.systemName) + '</td><td class="usd-table__muted">' + esc(ck.description) + '</td><td><span class="usd-check-status ' + st.cls + '">' + esc(st.label) + '</span></td><td class="usd-table__mono">' + fmtDate(ck.lastRun) + '</td></tr>'; }
        c.innerHTML = h;
    }

    // ─── Maintenance Plans ───
    function renderMaintenancePlans(data) {
        var container = document.getElementById("maintGrid"), badge = document.getElementById("badgeMaint");
        var summaryEl = document.getElementById("summaryMaint"), summaryDot = document.getElementById("summaryMaintDot");
        if (!data || data.error) { container.innerHTML = '<div class="usd-table__muted" style="padding:12px">Failed to load' + errMsg(data) + '</div>'; setBadge(badge, "Error", "usd-badge--error"); setDot(summaryDot, "usd-summary-dot--error"); summaryEl.textContent = "ERR"; return; }
        var rows = data.rows || []; var issues = 0;
        var html = '<table class="usd-table"><thead><tr><th>Plan</th><th>Schedule</th><th>Last Run</th><th>Next Run</th><th>State</th></tr></thead><tbody>';
        for (var i = 0; i < rows.length; i++) {
            var d = rows[i].data || {}; var state = d.state || {};
            var stateIcon = state.icon || "fa-question"; var stateColour = state.colour || "#5c6370"; var stateTooltip = state.tooltip || "Unknown";
            var isError = stateTooltip.toLowerCase().indexOf("error") !== -1 || stateTooltip.toLowerCase().indexOf("disabled") !== -1;
            if (isError) issues++;
            var colour = stateColour === "red" ? "#ef5350" : stateColour === "green" ? "#3dd68c" : stateColour || "#5c6370";
            html += '<tr' + (isError ? ' style="background:rgba(239,83,80,0.04)"' : '') + '>';
            html += '<td>' + esc(d.task || "--") + '</td>';
            html += '<td class="usd-table__muted">' + esc(d.schedule || "--") + '</td>';
            html += '<td class="usd-table__mono">' + fmtDate(d.lastRun) + '</td>';
            html += '<td class="usd-table__mono">' + fmtDate(d.nextRun) + '</td>';
            html += '<td><span class="fa ' + esc(stateIcon) + '" style="color:' + esc(colour) + '" title="' + esc(stateTooltip) + '"></span> ' + esc(stateTooltip) + '</td>';
            html += '</tr>';
        }
        if (!rows.length) html += '<tr><td colspan="5" class="usd-table__muted">No maintenance plans found</td></tr>';
        html += '</tbody></table>';
        container.innerHTML = html;
        summaryEl.textContent = issues === 0 ? "OK" : issues + " issue" + (issues > 1 ? "s" : "");
        if (issues === 0) { setBadge(badge, "All OK", "usd-badge--ok"); setDot(summaryDot, "usd-summary-dot--ok"); }
        else { setBadge(badge, issues + " Issue" + (issues > 1 ? "s" : ""), "usd-badge--error"); setDot(summaryDot, "usd-summary-dot--error"); }
    }

    // ─── Linked Services ───
    function renderLinkedServices(data) {
        var container = document.getElementById("linkedGrid"), badge = document.getElementById("badgeLinked");
        var summaryEl = document.getElementById("summaryLinked"), summaryDot = document.getElementById("summaryLinkedDot");
        if (!data || data.error) { container.innerHTML = '<div class="usd-table__muted" style="padding:12px">Failed to load' + errMsg(data) + '</div>'; setBadge(badge, "Error", "usd-badge--error"); setDot(summaryDot, "usd-summary-dot--error"); summaryEl.textContent = "ERR"; return; }
        var allServices = []; if (Array.isArray(data)) { for (var g = 0; g < data.length; g++) { var grp = data[g]; if (grp.services) { for (var s = 0; s < grp.services.length; s++) { grp.services[s]._group = grp.title; allServices.push(grp.services[s]); } } } }

        // Filter: always show critical services; only show non-critical if they have issues (unlinked when linkable, or invalid provider/config)
        var visible = [];
        for (var f = 0; f < allServices.length; f++) {
            var svc = allServices[f];
            var isCritical = CRITICAL_SERVICES.indexOf(svc.systemName) !== -1;
            var hasIssue = (svc.canLink && !svc.isLinked) || !svc.providerIsValid || !svc.configurationIsValid;
            if (isCritical || hasIssue) visible.push(svc);
        }

        var html = "", issues = 0;
        for (var i = 0; i < visible.length; i++) {
            var sv = visible[i]; var isCrit = CRITICAL_SERVICES.indexOf(sv.systemName) !== -1;
            var isLinked = sv.isLinked; var provValid = sv.providerIsValid; var cfgValid = sv.configurationIsValid;
            var hasProb = isCrit && (!isLinked || !provValid || !cfgValid);
            var nonCritProb = !isCrit && ((sv.canLink && !isLinked) || !provValid || !cfgValid);
            if (hasProb || nonCritProb) issues++;
            var borderCls = isCrit ? (hasProb ? "usd-linked-card--critical-error" : "usd-linked-card--critical") : (nonCritProb ? "usd-linked-card--critical-error" : "");
            html += '<div class="usd-linked-card ' + borderCls + '">';
            html += '<div class="usd-linked-card__header"><span class="fa ' + esc(sv.icon || "fa-cog") + ' usd-linked-card__icon"></span><span class="usd-linked-card__name">' + esc(sv.name) + '</span>';
            if (isCrit) html += '<span class="usd-linked-card__critical">CRITICAL</span>';
            html += '</div>';
            html += '<div class="usd-linked-card__row"><span class="usd-linked-card__label">Group</span><span class="usd-linked-card__value">' + esc(sv._group || "--") + '</span></div>';
            html += '<div class="usd-linked-card__row"><span class="usd-linked-card__label">Provider</span><span class="usd-linked-card__value">' + esc(sv.providerName || "--") + '</span></div>';
            html += '<div class="usd-linked-card__row"><span class="usd-linked-card__label">Linked</span><span class="usd-linked-card__value ' + (isLinked ? "usd-cfg-val--pass" : (sv.canLink ? "usd-cfg-val--fail" : "usd-cfg-val--neutral")) + '">' + (isLinked ? "Yes" : "No") + '</span></div>';
            if (sv.linkedAccountName) html += '<div class="usd-linked-card__row"><span class="usd-linked-card__label">Account</span><span class="usd-linked-card__value usd-index-card__value--small">' + esc(sv.linkedAccountName) + '</span></div>';
            html += '<div class="usd-linked-card__row"><span class="usd-linked-card__label">Provider Valid</span><span class="usd-linked-card__value ' + (provValid ? "usd-cfg-val--pass" : "usd-cfg-val--fail") + '">' + (provValid ? "Yes" : "No") + '</span></div>';
            html += '<div class="usd-linked-card__row"><span class="usd-linked-card__label">Config Valid</span><span class="usd-linked-card__value ' + (cfgValid ? "usd-cfg-val--pass" : "usd-cfg-val--fail") + '">' + (cfgValid ? "Yes" : "No") + '</span></div>';
            html += '</div>';
        }
        container.innerHTML = html || '<div class="usd-table__muted" style="padding:12px">All non-critical services healthy</div>';
        summaryEl.textContent = issues === 0 ? "OK" : issues + " issue" + (issues > 1 ? "s" : "");
        if (issues === 0) { setBadge(badge, "All OK", "usd-badge--ok"); setDot(summaryDot, "usd-summary-dot--ok"); }
        else { setBadge(badge, issues + " Issue" + (issues > 1 ? "s" : ""), "usd-badge--error"); setDot(summaryDot, "usd-summary-dot--error"); }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();