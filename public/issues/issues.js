/**
 * Issues page for ShareDo Tools.
 * EE Processes, Failed Outbound Emails/SMS, SYSADMIN tasks.
 */
(function () {
    "use strict";

    var esc = shared.esc, fmtNum = shared.fmtNum, fmtDate = shared.fmtDate;

    // ─── State ───
    var procPage = 1, procDateMode = "none", procDateActive = false;
    var emailPage = 1, emailDateMode = "none", emailDateActive = false;
    var smsPage = 1, smsDateMode = "none", smsDateActive = false;
    var sysadminDateMode = "none", sysadminDateActive = false;
    var _currentEnvName = "";

    function todayLocalISO() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
    function weekAgoLocalISO() { var d = new Date(); d.setDate(d.getDate()-7); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }

    function init() {
        shared.init({ activePage: "issues" });
        shared.onEnvChange(function (d) { _currentEnvName = d.current || ""; updateSysadminVisibility(); wireExtLinks(); refreshAll(); });
        shared.onCookieChange(function () { refreshAll(); });

        document.getElementById("refreshAllBtn").addEventListener("click", refreshAll);
        document.getElementById("expandAllBtn").addEventListener("click", function () { toggleAllSections(false); });
        document.getElementById("collapseAllBtn").addEventListener("click", function () { toggleAllSections(true); });

        // Processes controls
        document.getElementById("procChkErrored").addEventListener("change", function () { procPage = 1; fetchProcesses(); });
        document.getElementById("procChkRunning").addEventListener("change", function () { procPage = 1; fetchProcesses(); });
        wireDateFilter("proc", function () { procPage = 1; fetchProcesses(); });
        document.getElementById("procRowsPerPage").addEventListener("change", function () { procPage = 1; fetchProcesses(); });
        document.getElementById("procRefreshBtn").addEventListener("click", function () { fetchProcesses(); });

        // Email controls
        wireDateFilter("email", function () { emailPage = 1; fetchEmails(); });
        document.getElementById("emailRowsPerPage").addEventListener("change", function () { emailPage = 1; fetchEmails(); });
        document.getElementById("emailRefreshBtn").addEventListener("click", function () { fetchEmails(); });

        // SMS controls
        wireDateFilter("sms", function () { smsPage = 1; fetchSms(); });
        document.getElementById("smsRowsPerPage").addEventListener("change", function () { smsPage = 1; fetchSms(); });
        document.getElementById("smsRefreshBtn").addEventListener("click", function () { fetchSms(); });

        // SYSADMIN controls
        wireDateFilter("sysadmin", function () { fetchSysadmin(); });
        document.getElementById("sysadminRefreshBtn").addEventListener("click", function () { fetchSysadmin(); });

        // Process detail modal
        document.getElementById("procModalClose").addEventListener("click", closeProcModal);
        document.getElementById("procModal").addEventListener("click", function (e) {
            if (e.target === this) closeProcModal();
        });
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && document.getElementById("procModal").style.display !== "none") closeProcModal();
        });

        // Load initial env, then refresh
        shared.apiFetch("/api/env").then(function (r) { return r.json(); }).then(function (d) {
            _currentEnvName = d.current || "";
            updateSysadminVisibility();
            wireExtLinks();
            refreshAll();
        }).catch(function () { refreshAll(); });
    }

    // ─── External links in section headers ───
    function wireExtLinks() {
        var host = getHost();
        var links = document.querySelectorAll(".iss-ext-link");
        for (var i = 0; i < links.length; i++) {
            var path = links[i].dataset.path;
            if (host && path) {
                links[i].href = "https://" + host + path;
                links[i].target = "_blank";
            }
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

    function refreshAll() {
        fetchProcesses();
        fetchEmails();
        fetchSms();
        fetchSysadmin();
    }

    function getHost() {
        var h = document.getElementById("hostLabel").textContent;
        return (h && h !== "--") ? h : null;
    }

    function phaseCls(text) {
        if (!text) return "iss-phase--default";
        var t = text.toLowerCase();
        if (t === "failed") return "iss-phase--failed";
        if (t === "errored") return "iss-phase--errored";
        if (t === "running") return "iss-phase--running";
        if (t === "new") return "iss-phase--new";
        return "iss-phase--default";
    }

    // ─── SYSADMIN visibility (prod only) ───
    function updateSysadminVisibility() {
        var section = document.getElementById("sectionSysadmin");
        if (_currentEnvName === "prod") {
            section.style.display = "";
        } else {
            section.style.display = "none";
        }
    }

    // ─── Date filter wiring (reusable across sections) ───
    function wireDateFilter(prefix, onChange) {
        var btnToday = document.getElementById(prefix + "BtnToday");
        var btnWeek = document.getElementById(prefix + "BtnWeek");
        var picker = document.getElementById(prefix + "DatePicker");
        var btnClear = document.getElementById(prefix + "BtnClearDate");

        if (!btnToday) return; // Section may not have date controls

        btnToday.addEventListener("click", function () { setDateMode(prefix, "today"); onChange(); });
        btnWeek.addEventListener("click", function () { setDateMode(prefix, "week"); onChange(); });
        picker.addEventListener("change", function () { setDateMode(prefix, "custom"); onChange(); });
        btnClear.addEventListener("click", function () { clearDateMode(prefix); onChange(); });
    }

    function setDateMode(prefix, mode) {
        var btnToday = document.getElementById(prefix + "BtnToday");
        var btnWeek = document.getElementById(prefix + "BtnWeek");
        var picker = document.getElementById(prefix + "DatePicker");

        btnToday.classList.toggle("usd-btn--active", mode === "today");
        btnWeek.classList.toggle("usd-btn--active", mode === "week");
        if (mode === "today") picker.value = todayLocalISO();
        else if (mode === "week") picker.value = weekAgoLocalISO();

        // Update state vars
        if (prefix === "proc") { procDateMode = mode; procDateActive = true; }
        else if (prefix === "email") { emailDateMode = mode; emailDateActive = true; }
        else if (prefix === "sms") { smsDateMode = mode; smsDateActive = true; }
        else if (prefix === "sysadmin") { sysadminDateMode = mode; sysadminDateActive = true; }
    }

    function clearDateMode(prefix) {
        var btnToday = document.getElementById(prefix + "BtnToday");
        var btnWeek = document.getElementById(prefix + "BtnWeek");
        var picker = document.getElementById(prefix + "DatePicker");

        btnToday.classList.remove("usd-btn--active");
        btnWeek.classList.remove("usd-btn--active");
        picker.value = "";

        if (prefix === "proc") { procDateMode = "none"; procDateActive = false; }
        else if (prefix === "email") { emailDateMode = "none"; emailDateActive = false; }
        else if (prefix === "sms") { smsDateMode = "none"; smsDateActive = false; }
        else if (prefix === "sysadmin") { sysadminDateMode = "none"; sysadminDateActive = false; }
    }

    function getFromDate(prefix) {
        var active, mode, pickerId;
        if (prefix === "proc") { active = procDateActive; mode = procDateMode; }
        else if (prefix === "email") { active = emailDateActive; mode = emailDateMode; }
        else if (prefix === "sms") { active = smsDateActive; mode = smsDateMode; }
        else if (prefix === "sysadmin") { active = sysadminDateActive; mode = sysadminDateMode; }
        else return null;

        if (!active) return null;
        if (mode === "today") { var n = new Date(); n.setHours(0,0,0,0); return n.toISOString(); }
        if (mode === "week") { var d = new Date(); d.setDate(d.getDate()-7); d.setHours(0,0,0,0); return d.toISOString(); }
        if (mode === "custom") {
            var v = document.getElementById(prefix + "DatePicker").value;
            if (v) return new Date(v + "T00:00:00").toISOString();
        }
        return null;
    }

    // ─── Pagination helper ───
    function renderPagination(containerId, currentPage, totalCount, rpp, goPageFn) {
        var el = document.getElementById(containerId);
        var totalPages = Math.ceil(totalCount / rpp) || 1;
        if (totalPages <= 1) { el.innerHTML = ""; return; }
        var h = "";
        if (currentPage > 1) h += '<button class="usd-btn usd-pag-btn" onclick="' + goPageFn + '(' + (currentPage - 1) + ')"><span class="fa fa-chevron-left"></span></button>';
        h += '<span class="usd-pag-info">Page ' + currentPage + ' of ' + totalPages + '</span>';
        if (currentPage < totalPages) h += '<button class="usd-btn usd-pag-btn" onclick="' + goPageFn + '(' + (currentPage + 1) + ')"><span class="fa fa-chevron-right"></span></button>';
        el.innerHTML = h;
    }

    // ═══════════════════════════════════════════
    // EE Processes
    // ═══════════════════════════════════════════

    function getSelectedStates() {
        var states = [];
        if (document.getElementById("procChkErrored").checked) states.push("ERRORED");
        if (document.getElementById("procChkRunning").checked) states.push("RUNNING");
        return states;
    }

    function fetchProcesses() {
        var body = document.getElementById("procBody");
        var badge = document.getElementById("badgeProcesses");
        var countEl = document.getElementById("procCount");

        var states = getSelectedStates();
        if (states.length === 0) {
            body.innerHTML = '<tr><td colspan="5" class="usd-table__muted">Select at least one state</td></tr>';
            badge.textContent = "--"; badge.className = "usd-badge usd-badge--neutral";
            countEl.textContent = "";
            document.getElementById("procPagination").innerHTML = "";
            return;
        }

        body.innerHTML = '<tr><td colspan="5" class="usd-table__muted"><span class="fa fa-spinner fa-spin"></span> Loading...</td></tr>';

        var rpp = parseInt(document.getElementById("procRowsPerPage").value, 10) || 10;
        var fromDate = getFromDate("proc");

        shared.apiFetch("/api/processes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ page: procPage, rowsPerPage: rpp, states: states, fromDate: fromDate })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data || data.error) {
                body.innerHTML = '<tr><td colspan="5" class="usd-table__muted">Failed: ' + esc(data && data.message ? data.message : "Unknown error") + '</td></tr>';
                badge.textContent = "Error"; badge.className = "usd-badge usd-badge--error";
                countEl.textContent = "";
                return;
            }
            var rows = data.rows || [];
            var total = data.resultCount || 0;
            countEl.textContent = fmtNum(total) + " total";

            if (total === 0) { badge.textContent = "None"; badge.className = "usd-badge usd-badge--ok"; }
            else { badge.textContent = fmtNum(total); badge.className = "usd-badge usd-badge--error"; }

            if (!rows.length) {
                body.innerHTML = '<tr><td colspan="5" class="usd-table__muted">No results</td></tr>';
                document.getElementById("procPagination").innerHTML = "";
                return;
            }

            var h = "";
            for (var i = 0; i < rows.length; i++) {
                var d = rows[i].data || {};
                var stateText = (d.state && d.state.tooltip) ? d.state.tooltip : (d.state && d.state.text) ? d.state.text : "--";
                var stateIcon = (d.state && d.state.icon) ? d.state.icon : "";
                var stateColour = (d.state && d.state.colour) ? d.state.colour : "";
                if (stateColour === "red") stateColour = "var(--accent-red)";
                else if (stateColour === "green") stateColour = "var(--accent-green)";
                else if (!stateColour) stateColour = "var(--text-secondary)";

                var sharedoRef = "--";
                if (d.sharedoReference) {
                    sharedoRef = (typeof d.sharedoReference === "object" && d.sharedoReference.text) ? d.sharedoReference.text : (typeof d.sharedoReference === "string" ? d.sharedoReference : "--");
                }

                h += '<tr class="iss-proc-row" data-pid="' + esc(rows[i].id || "") + '" data-ptitle="' + esc(d.title || "--") + '">';
                h += '<td class="usd-table__mono">' + fmtDate(d.started) + '</td>';
                h += '<td>' + esc(d.title || "--") + '</td>';
                h += '<td class="usd-table__muted"><span class="iss-desc">' + esc(d.description || "--") + '</span></td>';
                h += '<td class="usd-table__mono">' + esc(sharedoRef) + '</td>';
                h += '<td><span class="fa ' + esc(stateIcon) + '" style="color:' + stateColour + '"></span> ' + esc(stateText) + '</td>';
                h += '</tr>';
            }
            body.innerHTML = h;
            wireProcRowClicks();
            renderPagination("procPagination", procPage, total, rpp, "_issProcPage");
        })
        .catch(function (err) {
            body.innerHTML = '<tr><td colspan="5" class="usd-table__muted">Failed: ' + esc(err.message) + '</td></tr>';
        });
    }

    window._issProcPage = function (p) { procPage = p; fetchProcesses(); };

    // ═══════════════════════════════════════════
    // Failed Outbound Emails
    // ═══════════════════════════════════════════

    function fetchEmails() {
        var body = document.getElementById("emailBody");
        var badge = document.getElementById("badgeEmails");
        var countEl = document.getElementById("emailCount");
        body.innerHTML = '<tr><td colspan="4" class="usd-table__muted"><span class="fa fa-spinner fa-spin"></span> Loading...</td></tr>';

        var rpp = parseInt(document.getElementById("emailRowsPerPage").value, 10) || 10;

        shared.apiFetch("/api/issues/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ page: emailPage, rowsPerPage: rpp, fromDate: getFromDate("email") })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data || data.error) {
                body.innerHTML = '<tr><td colspan="4" class="usd-table__muted">Failed: ' + esc(data && data.message ? data.message : "Unknown error") + '</td></tr>';
                badge.textContent = "Error"; badge.className = "usd-badge usd-badge--error";
                countEl.textContent = "";
                return;
            }
            renderCommsTable(data, body, badge, countEl, "emailPagination", emailPage, rpp, "_issEmailPage");
        })
        .catch(function (err) {
            body.innerHTML = '<tr><td colspan="4" class="usd-table__muted">Failed: ' + esc(err.message) + '</td></tr>';
        });
    }

    window._issEmailPage = function (p) { emailPage = p; fetchEmails(); };

    // ═══════════════════════════════════════════
    // Failed Outbound SMS
    // ═══════════════════════════════════════════

    function fetchSms() {
        var body = document.getElementById("smsBody");
        var badge = document.getElementById("badgeSms");
        var countEl = document.getElementById("smsCount");
        body.innerHTML = '<tr><td colspan="4" class="usd-table__muted"><span class="fa fa-spinner fa-spin"></span> Loading...</td></tr>';

        var rpp = parseInt(document.getElementById("smsRowsPerPage").value, 10) || 10;

        shared.apiFetch("/api/issues/sms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ page: smsPage, rowsPerPage: rpp, fromDate: getFromDate("sms") })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data || data.error) {
                body.innerHTML = '<tr><td colspan="4" class="usd-table__muted">Failed: ' + esc(data && data.message ? data.message : "Unknown error") + '</td></tr>';
                badge.textContent = "Error"; badge.className = "usd-badge usd-badge--error";
                countEl.textContent = "";
                return;
            }
            renderCommsTable(data, body, badge, countEl, "smsPagination", smsPage, rpp, "_issSmsPage");
        })
        .catch(function (err) {
            body.innerHTML = '<tr><td colspan="4" class="usd-table__muted">Failed: ' + esc(err.message) + '</td></tr>';
        });
    }

    window._issSmsPage = function (p) { smsPage = p; fetchSms(); };

    // ─── Shared comms table renderer (emails + SMS) ───
    function renderCommsTable(data, body, badge, countEl, pagContainerId, currentPage, rpp, goPageFn) {
        var rows = data.rows || [];
        var total = data.resultCount || 0;
        countEl.textContent = fmtNum(total) + " total";

        if (total === 0) { badge.textContent = "None"; badge.className = "usd-badge usd-badge--ok"; }
        else { badge.textContent = fmtNum(total); badge.className = "usd-badge usd-badge--error"; }

        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="4" class="usd-table__muted">No results</td></tr>';
            document.getElementById(pagContainerId).innerHTML = "";
            return;
        }

        var h = "";
        var host = getHost();
        for (var i = 0; i < rows.length; i++) {
            var d = rows[i].data || {};
            var ancestor = d.ancestor || {};
            var ancestorTitle = (ancestor.title && ancestor.title.text) ? ancestor.title.text : "--";
            var ancestorUrl = (ancestor.title && ancestor.title.directUrl) ? ancestor.title.directUrl : null;
            if (ancestorUrl && ancestorUrl.charAt(0) === "/" && host) ancestorUrl = "https://" + host + ancestorUrl;

            h += '<tr>';
            h += '<td class="usd-table__mono">' + esc(d.reference || "--") + '</td>';
            h += '<td>' + esc(d.title || "--") + '</td>';
            h += '<td class="usd-table__mono">' + fmtDate(d.createdDate) + '</td>';
            if (ancestorUrl) {
                h += '<td><a href="' + esc(ancestorUrl) + '" target="_blank" class="iss-open-link">' + esc(ancestorTitle) + ' <span class="fa fa-external-link"></span></a></td>';
            } else {
                h += '<td class="usd-table__muted">' + esc(ancestorTitle) + '</td>';
            }
            h += '</tr>';
        }
        body.innerHTML = h;
        renderPagination(pagContainerId, currentPage, total, rpp, goPageFn);
    }

    // ═══════════════════════════════════════════
    // SYSADMIN Tasks (production only)
    // ═══════════════════════════════════════════

    function fetchSysadmin() {
        if (_currentEnvName !== "prod") return;

        var body = document.getElementById("sysadminBody");
        var badge = document.getElementById("badgeSysadmin");
        var countEl = document.getElementById("sysadminCount");
        body.innerHTML = '<tr><td colspan="6" class="usd-table__muted"><span class="fa fa-spinner fa-spin"></span> Loading...</td></tr>';

        shared.apiFetch("/api/issues/sysadmin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ page: 1, rowsPerPage: 100, fromDate: getFromDate("sysadmin") })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data || data.error) {
                body.innerHTML = '<tr><td colspan="6" class="usd-table__muted">Failed: ' + esc(data && data.message ? data.message : "Unknown error") + '</td></tr>';
                badge.textContent = "Error"; badge.className = "usd-badge usd-badge--error";
                countEl.textContent = "";
                return;
            }
            var rows = data.rows || [];
            var total = data.resultCount || 0;
            countEl.textContent = fmtNum(total) + " total";

            if (total === 0) { badge.textContent = "None"; badge.className = "usd-badge usd-badge--ok"; }
            else { badge.textContent = fmtNum(total); badge.className = "usd-badge usd-badge--warn"; }

            if (!rows.length) {
                body.innerHTML = '<tr><td colspan="6" class="usd-table__muted">No tasks</td></tr>';
                return;
            }

            var h = "";
            for (var i = 0; i < rows.length; i++) {
                var d = rows[i].data || {};
                var tags = d.tags || [];
                var owner = "";
                if (d.role && typeof d.role === "object") {
                    var roleKeys = Object.keys(d.role);
                    for (var r = 0; r < roleKeys.length; r++) {
                        if (d.role[roleKeys[r]]) { owner = d.role[roleKeys[r]]; break; }
                    }
                }

                h += '<tr>';
                h += '<td class="usd-table__mono">' + esc(d.reference || "--") + '</td>';
                h += '<td>' + esc(d.title || "--") + '</td>';
                h += '<td><span class="iss-desc">' + esc(d.description || "--") + '</span></td>';
                h += '<td class="usd-table__mono">' + fmtDate(d.createdDate) + '</td>';
                h += '<td>';
                for (var t = 0; t < tags.length; t++) h += '<span class="iss-tag">' + esc(tags[t]) + '</span>';
                if (!tags.length) h += '<span class="usd-table__muted">--</span>';
                h += '</td>';
                h += '<td class="usd-table__muted">' + esc(owner || "--") + '</td>';
                h += '</tr>';
            }
            body.innerHTML = h;
        })
        .catch(function (err) {
            body.innerHTML = '<tr><td colspan="6" class="usd-table__muted">Failed: ' + esc(err.message) + '</td></tr>';
        });
    }

    // ═══════════════════════════════════════════
    // Process Detail Modal
    // ═══════════════════════════════════════════

    function wireProcRowClicks() {
        var rows = document.querySelectorAll(".iss-proc-row");
        for (var i = 0; i < rows.length; i++) {
            rows[i].style.cursor = "pointer";
            rows[i].addEventListener("click", function () {
                var pid = this.dataset.pid;
                var ptitle = this.dataset.ptitle;
                if (pid) openProcessDetail(pid, ptitle);
            });
        }
    }

    function openProcessDetail(processId, title) {
        var modal = document.getElementById("procModal");
        var titleEl = document.getElementById("procModalTitle");
        var subtitleEl = document.getElementById("procModalSubtitle");
        var bodyEl = document.getElementById("procModalBody");
        var linkEl = document.getElementById("procModalLink");

        titleEl.textContent = title || "Process Detail";
        subtitleEl.textContent = processId;
        linkEl.style.display = "none";
        bodyEl.innerHTML = '<div class="iss-log-loading"><span class="fa fa-spinner fa-spin"></span> Loading process detail...</div>';
        modal.style.display = "flex";

        shared.apiFetch("/api/processes/" + encodeURIComponent(processId))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || data.error) {
                    bodyEl.innerHTML = '<div class="iss-log-loading usd-clr--red"><span class="fa fa-exclamation-triangle"></span> ' + esc(data && data.message ? data.message : "Failed to load") + '</div>';
                    return;
                }

                // Update header with plan info
                titleEl.textContent = data.planTitle || title || "Process Detail";
                subtitleEl.textContent = (data.planSystemName || "") + " | " + processId;

                // Work item link
                if (data.sharedoId && data.sharedoId !== "00000000-0000-0000-0000-000000000000") {
                    var host = getHost();
                    if (host) {
                        linkEl.href = "https://" + host + "/sharedo/" + data.sharedoId;
                        linkEl.style.display = "";
                    }
                }

                // Render steps
                var steps = data.subProcesses || [];
                if (!steps.length) {
                    bodyEl.innerHTML = '<div class="iss-log-loading">No steps found</div>';
                    return;
                }

                var h = "";
                for (var i = 0; i < steps.length; i++) {
                    var s = steps[i];
                    var state = (s.state || "NONE").toUpperCase();
                    var stateCls = "iss-step__state--" + state.toLowerCase();
                    var isNone = state === "NONE";
                    var hasStep = !!s.executionStepId;

                    h += '<div class="iss-step' + (isNone ? ' iss-step--none' : '') + '"'
                        + (hasStep ? ' data-proc-id="' + esc(processId) + '" data-step-id="' + esc(s.executionStepId) + '"' : '')
                        + '>';
                    h += '<div class="iss-step__header">';
                    h += '<span class="iss-step__state ' + stateCls + '">' + esc(state) + '</span>';
                    h += '<span class="iss-step__name">' + esc(s.name || s.systemName || "--") + '</span>';
                    h += '<span class="iss-step__sysname">' + esc(s.systemName || "") + '</span>';
                    if (hasStep) h += '<span class="fa fa-chevron-right iss-step__chevron"></span>';
                    h += '</div>';
                    if (hasStep) h += '<div class="iss-step__log" id="stepLog-' + esc(s.executionStepId) + '"></div>';
                    h += '</div>';
                }
                bodyEl.innerHTML = h;

                // Wire step clicks
                var stepEls = bodyEl.querySelectorAll(".iss-step:not(.iss-step--none)");
                for (var j = 0; j < stepEls.length; j++) {
                    stepEls[j].addEventListener("click", function () {
                        var procId = this.dataset.procId;
                        var stepId = this.dataset.stepId;
                        var isExpanded = this.classList.contains("iss-step--expanded");

                        if (isExpanded) {
                            this.classList.remove("iss-step--expanded");
                            return;
                        }

                        this.classList.add("iss-step--expanded");
                        var logEl = document.getElementById("stepLog-" + stepId);
                        if (logEl.dataset.loaded) return; // Already loaded

                        logEl.innerHTML = '<div class="iss-log-loading"><span class="fa fa-spinner fa-spin"></span> Loading log...</div>';
                        fetchStepLog(procId, stepId, logEl);
                    });
                }

                // Auto-expand errored steps
                var erroredSteps = bodyEl.querySelectorAll(".iss-step:not(.iss-step--none)");
                for (var k = 0; k < erroredSteps.length; k++) {
                    var stepState = erroredSteps[k].querySelector(".iss-step__state");
                    if (stepState && stepState.textContent === "ERRORED") {
                        erroredSteps[k].click();
                    }
                }
            })
            .catch(function (err) {
                bodyEl.innerHTML = '<div class="iss-log-loading usd-clr--red"><span class="fa fa-exclamation-triangle"></span> ' + esc(err.message) + '</div>';
            });
    }

    function fetchStepLog(processId, stepId, logEl) {
        shared.apiFetch("/api/processes/" + encodeURIComponent(processId) + "/steps/" + encodeURIComponent(stepId) + "/log")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || data.error) {
                    logEl.innerHTML = '<div class="iss-log-loading usd-clr--red">' + esc(data && data.message ? data.message : "Failed to load log") + '</div>';
                    return;
                }

                var entries = Array.isArray(data) ? data : [];
                if (!entries.length) {
                    logEl.innerHTML = '<div class="iss-log-loading">No log entries</div>';
                    logEl.dataset.loaded = "1";
                    return;
                }

                var h = "";
                for (var i = 0; i < entries.length; i++) {
                    var e = entries[i];
                    var level = (e.logLevel || "").toLowerCase();
                    var time = "";
                    if (e.logTime) {
                        try { var dt = new Date(e.logTime); time = String(dt.getHours()).padStart(2,"0") + ":" + String(dt.getMinutes()).padStart(2,"0") + ":" + String(dt.getSeconds()).padStart(2,"0"); } catch (ex) {}
                    }
                    h += '<div class="iss-log-entry">';
                    h += '<span class="iss-log-entry__time">' + esc(time) + '</span>';
                    h += '<span class="iss-log-entry__level iss-log-entry__level--' + level + '">' + esc(e.logLevel || "--") + '</span>';
                    h += '<span class="iss-log-entry__msg">' + esc(e.logMessage || "") + '</span>';
                    h += '</div>';
                }
                logEl.innerHTML = h;
                logEl.dataset.loaded = "1";
            })
            .catch(function (err) {
                logEl.innerHTML = '<div class="iss-log-loading usd-clr--red">' + esc(err.message) + '</div>';
            });
    }

    function closeProcModal() {
        document.getElementById("procModal").style.display = "none";
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();