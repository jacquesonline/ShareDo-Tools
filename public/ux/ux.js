/**
 * UX Monitor page for ShareDo Tools.
 * Displays historical API probe and page load performance charts.
 * Structure mirrors metrics.js for consistency.
 */
(function () {
    "use strict";

    var esc = shared.esc;
    var _vitalsChart = null;
    var _probesChart = null;
    var _compareChart = null;
    var _compareMetric = "lcp";
    var _uxProbeEnv = "prod";
    var _pageTargets = [];
    var _chartBackgrounds = false;
    var _fileMode = false;
    var _filePageEntries = null;
    var _fileApiEntries = null;
    var _fileNames = { pages: null, api: null };
    var _currentPageEntries = [];
    var _allPageEntries = [];
    var _selectedUrlKey = null;

    function init() {
        shared.init({ activePage: "ux" });
        if (typeof Chart === "undefined") {
            document.getElementById("uxVitalsEmpty").textContent = "Chart.js failed to load from CDN";
            document.getElementById("uxProbesEmpty").textContent = "Chart.js failed to load from CDN";
            return;
        }
        var bgFillPlugin = {
            id: "bgFill",
            beforeDraw: function (chart) {
                if (!_chartBackgrounds) return;
                var ctx = chart.ctx; var isDark = !document.body.classList.contains("light-theme");
                ctx.save(); ctx.fillStyle = isDark ? "#22262e" : "#ffffff"; ctx.fillRect(0, 0, chart.width, chart.height); ctx.restore();
            }
        };
        Chart.register(bgFillPlugin);

        document.getElementById("uxLoadBtn").addEventListener("click", loadData);
        var quickBtns = document.querySelectorAll(".ux-quick-btn");
        for (var i = 0; i < quickBtns.length; i++) { quickBtns[i].addEventListener("click", function () { selectQuickRange(this.getAttribute("data-range")); }); }
        document.getElementById("uxDateFrom").addEventListener("change", onDatePickerChange);
        document.getElementById("uxDateTo").addEventListener("change", onDatePickerChange);
        document.getElementById("uxNavPrev").addEventListener("click", function () { navStep(-1); });
        document.getElementById("uxNavNext").addEventListener("click", function () { navStep(1); });
        document.getElementById("uxVitalsShowAll").addEventListener("click", function () { toggleAllDatasets(_vitalsChart, true); });
        document.getElementById("uxVitalsHideAll").addEventListener("click", function () { toggleAllDatasets(_vitalsChart, false); });
        document.getElementById("uxProbesShowAll").addEventListener("click", function () { toggleAllDatasets(_probesChart, true); });
        document.getElementById("uxProbesHideAll").addEventListener("click", function () { toggleAllDatasets(_probesChart, false); });
        document.getElementById("uxVitalsResetZoom").addEventListener("click", function () { if (_vitalsChart) { _vitalsChart.resetZoom(); updateResetZoomBtn("Vitals", false); } });
        document.getElementById("uxProbesResetZoom").addEventListener("click", function () { if (_probesChart) { _probesChart.resetZoom(); updateResetZoomBtn("Probes", false); } });
        document.getElementById("uxCompareMetric").addEventListener("change", function () { _compareMetric = this.value; renderCompareChart({ entries: _allPageEntries }); });
        document.getElementById("uxCompareResetZoom").addEventListener("click", function () { if (_compareChart) { _compareChart.resetZoom(); updateResetZoomBtn("Compare", false); } });
        document.getElementById("uxCompareShowAll").addEventListener("click", function () { toggleAllDatasets(_compareChart, true); });
        document.getElementById("uxCompareHideAll").addEventListener("click", function () { toggleAllDatasets(_compareChart, false); });
        document.getElementById("uxFileBtn").addEventListener("click", function () { document.getElementById("uxFileInput").click(); });
        document.getElementById("uxFileInput").addEventListener("change", onFileInputChange);
        document.getElementById("uxFileClearBtn").addEventListener("click", clearFileMode);
        document.getElementById("uxAjaxModalClose").addEventListener("click", closeAjaxModal);
        document.getElementById("uxAjaxModal").addEventListener("click", function (e) { if (e.target === this) closeAjaxModal(); });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAjaxModal(); });
        document.getElementById("uxRunProbesBtn").addEventListener("click", runProbes);
        document.getElementById("uxRunAllPagesBtn").addEventListener("click", runAllPageChecks);
        document.getElementById("uxRunPageBtn").addEventListener("click", runPageCheck);

        // Collapsible chart panels
        var collapsibles = document.querySelectorAll(".ux-chart-panel--collapsible > .ux-chart-panel__header");
        for (var ci = 0; ci < collapsibles.length; ci++) {
            collapsibles[ci].addEventListener("click", function (e) {
                if (e.target.closest(".ux-chart-panel__actions")) return;
                this.parentNode.classList.toggle("ux-chart-panel--collapsed");
            });
        }

        fetch("/api/ux/status").then(function (r) { return r.json(); }).then(function (data) {
            _uxProbeEnv = data.probeEnv || "prod";
            if (Array.isArray(data.pageTargets)) _pageTargets = data.pageTargets;
            // Look up full environment label
            fetch("/api/env").then(function (r) { return r.json(); }).then(function (envData) {
                var envLabel = _uxProbeEnv;
                if (envData.environments) {
                    for (var i = 0; i < envData.environments.length; i++) {
                        if (envData.environments[i].name === _uxProbeEnv) { envLabel = envData.environments[i].label; break; }
                    }
                }
                document.getElementById("uxEnvLabel").textContent = envLabel;
            }).catch(function () { document.getElementById("uxEnvLabel").textContent = _uxProbeEnv; });
        }).catch(function () {});
        fetch("/api/settings").then(function (r) { return r.json(); }).then(function (data) {
            if (data.chartBackgrounds != null) _chartBackgrounds = !!data.chartBackgrounds;
        }).catch(function () {});

        loadData();
        checkStorage();
        updateDatePickerFromRange();
    }

    // ─── Range state ───
    var _activeRange = "1";
    var _rangeAfter = null;
    var _rangeBefore = null;

    function selectQuickRange(val) {
        _activeRange = val;
        var btns = document.querySelectorAll(".ux-quick-btn");
        for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("ux-quick-btn--active", btns[i].getAttribute("data-range") === val);
        document.getElementById("uxNavPrev").disabled = (val === "0");
        document.getElementById("uxNavNext").disabled = (val === "0");
        updateDatePickerFromRange();
        loadData();
    }

    function onDatePickerChange() {
        var from = document.getElementById("uxDateFrom").value;
        var to = document.getElementById("uxDateTo").value;
        if (!from && !to) return;
        _activeRange = "custom";
        _rangeAfter = from ? new Date(from).toISOString() : null;
        _rangeBefore = to ? new Date(to).toISOString() : null;
        var btns = document.querySelectorAll(".ux-quick-btn");
        for (var i = 0; i < btns.length; i++) btns[i].classList.remove("ux-quick-btn--active");
        document.getElementById("uxNavPrev").disabled = !_rangeAfter;
        document.getElementById("uxNavNext").disabled = !_rangeAfter;
        loadData();
    }

    function updateDatePickerFromRange() {
        var range = getTimeRange();
        document.getElementById("uxDateFrom").value = range.after ? toLocalDatetimeString(new Date(range.after)) : "";
        document.getElementById("uxDateTo").value = range.before ? toLocalDatetimeString(new Date(range.before)) : "";
    }

    function toLocalDatetimeString(d) {
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    }

    function navStep(direction) {
        var range = getTimeRange();
        if (!range.after) return;
        var afterMs = new Date(range.after).getTime();
        var beforeMs = range.before ? new Date(range.before).getTime() : Date.now();
        var spanMs = beforeMs - afterMs;
        var newAfter = new Date(afterMs + (direction * spanMs));
        var newBefore = new Date(beforeMs + (direction * spanMs));
        if (newBefore.getTime() > Date.now()) { newBefore = new Date(); newAfter = new Date(newBefore.getTime() - spanMs); }
        _activeRange = "custom";
        _rangeAfter = newAfter.toISOString();
        _rangeBefore = newBefore.toISOString();
        var btns = document.querySelectorAll(".ux-quick-btn");
        for (var i = 0; i < btns.length; i++) btns[i].classList.remove("ux-quick-btn--active");
        document.getElementById("uxNavPrev").disabled = false;
        document.getElementById("uxNavNext").disabled = false;
        document.getElementById("uxDateFrom").value = toLocalDatetimeString(newAfter);
        document.getElementById("uxDateTo").value = toLocalDatetimeString(newBefore);
        loadData();
    }

    function getTimeRange() {
        if (_activeRange === "custom") return { after: _rangeAfter, before: _rangeBefore };
        if (_activeRange === "0") return { after: null, before: null };
        var hours = parseInt(_activeRange, 10);
        return { after: new Date(Date.now() - hours * 3600000).toISOString(), before: null };
    }

    function updateResetZoomBtn(prefix, visible) {
        var el = document.getElementById("ux" + prefix + "ResetZoom");
        if (el) el.style.display = visible ? "" : "none";
    }

    function getZoomPluginConfig(prefix) {
        return { zoom: { wheel: { enabled: true, modifierKey: "ctrl" }, drag: { enabled: true, modifierKey: "shift", backgroundColor: "rgba(74,158,255,0.1)", borderColor: "rgba(74,158,255,0.4)", borderWidth: 1 }, mode: "x", onZoom: function () { updateResetZoomBtn(prefix, true); } }, pan: { enabled: true, modifierKey: "alt", mode: "x" }, limits: { x: { minRange: 60000 } } };
    }

    // ─── Storage ───
    function checkStorage() {
        fetch("/api/metrics/status").then(function (r) { return r.json(); }).then(function (data) {
            var infoEl = document.getElementById("uxStorageInfo");
            var warnEl = document.getElementById("uxWarning");
            var warnText = document.getElementById("uxWarningText");
            if (!data.enabled) { infoEl.innerHTML = '<span class="ux-storage-off"><span class="fa fa-pause-circle"></span> Recording disabled</span>'; return; }
            var maxPct = 0; var parts = [];
            var uxFiles = (data.files || []).filter(function (f) { return f.metric.indexOf("ux-") === 0; });
            for (var i = 0; i < uxFiles.length; i++) { var f = uxFiles[i]; if (f.capPct > maxPct) maxPct = f.capPct; parts.push(f.env + "/" + f.metric + ": " + f.sizeMB + "MB (" + f.capPct + "%)"); }
            infoEl.innerHTML = '<span class="ux-storage-info" title="' + esc(parts.join("\n")) + '">' + uxFiles.length + ' files | ' + (maxPct > 0 ? 'largest at ' + maxPct + '% of ' + data.capMB + 'MB cap' : 'all under cap') + '</span>';
            if (maxPct >= 90) { warnEl.style.display = ""; warnText.textContent = "A UX metrics file is at " + maxPct + "% of the " + data.capMB + "MB cap."; }
            else if (maxPct >= 75) { warnEl.style.display = ""; warnText.textContent = "A UX metrics file is at " + maxPct + "% of the " + data.capMB + "MB cap."; }
            else { warnEl.style.display = "none"; }
        }).catch(function () {});
    }

    // ─── File mode ───
    var FILE_NAME_RE = /^(ux-pages|ux-api)(-[a-z0-9_-]+)?(-backup(-\d{2}-\d{2}-\d{4})?)?[.]jsonl$/i;
    var DANGEROUS_KEYS = ["__proto__", "constructor", "prototype"];

    function showGlobalError(msg) { var el = document.getElementById("globalError"); el.textContent = msg; el.style.display = ""; setTimeout(function () { el.style.display = "none"; }, 6000); }
    function hasDangerousKey(obj) { if (!obj || typeof obj !== "object") return false; for (var ki = 0; ki < DANGEROUS_KEYS.length; ki++) { if (Object.prototype.hasOwnProperty.call(obj, DANGEROUS_KEYS[ki])) return true; } return false; }
    function detectUxFileType(entry) { if (entry && Array.isArray(entry.probes)) return "api"; if (entry && (entry.fcp != null || entry.totalLoadMs != null || entry.lcp != null)) return "pages"; return null; }

    function onFileInputChange(e) {
        var files = e.target.files;
        if (!files || !files.length) return;
        for (var i = 0; i < files.length; i++) {
            (function (file) {
                if (!FILE_NAME_RE.test(file.name)) { showGlobalError("File rejected: \"" + file.name + "\" does not match expected naming (e.g. ux-pages.jsonl, ux-api-prod.jsonl)."); return; }
                var reader = new FileReader();
                reader.onload = function (ev) {
                    var lines = ev.target.result.split("\n");
                    var validationLines = 0; var detectedType = null;
                    for (var li = 0; li < lines.length && validationLines < 50; li++) {
                        var raw = lines[li].trim(); if (!raw) continue;
                        var parsed; try { parsed = JSON.parse(raw); } catch (err) { validationLines++; continue; }
                        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) { showGlobalError("File rejected: \"" + file.name + "\" contains unexpected data."); return; }
                        if (hasDangerousKey(parsed)) { showGlobalError("File rejected: \"" + file.name + "\" contains disallowed keys."); return; }
                        if (typeof parsed.ts !== "string" || isNaN(new Date(parsed.ts).getTime())) { showGlobalError("File rejected: \"" + file.name + "\" has entries without valid timestamps."); return; }
                        if (!detectedType) detectedType = detectUxFileType(parsed);
                        validationLines++;
                    }
                    if (!detectedType) { if (/^ux-pages/i.test(file.name)) detectedType = "pages"; else if (/^ux-api/i.test(file.name)) detectedType = "api"; }
                    if (!detectedType) { showGlobalError("File rejected: \"" + file.name + "\" could not be identified as ux-pages or ux-api data."); return; }
                    var entries = [];
                    for (var pi = 0; pi < lines.length; pi++) { var rawLine = lines[pi].trim(); if (!rawLine) continue; try { var entry = JSON.parse(rawLine); if (entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.ts === "string" && !isNaN(new Date(entry.ts).getTime())) entries.push(entry); } catch (parseErr) {} }
                    if (!entries.length) { showGlobalError("File rejected: \"" + file.name + "\" contained no valid entries."); return; }
                    entries.sort(function (a, b) { return new Date(a.ts).getTime() - new Date(b.ts).getTime(); });
                    if (detectedType === "pages") { _filePageEntries = entries; _fileNames.pages = file.name; } else { _fileApiEntries = entries; _fileNames.api = file.name; }
                    _fileMode = true; updateFileChips(); loadData();
                };
                reader.onerror = function () { showGlobalError("Failed to read file: \"" + file.name + "\"."); };
                reader.readAsText(file);
            })(files[i]);
        }
        e.target.value = "";
    }

    function updateFileChips() {
        var chipsEl = document.getElementById("uxFileChips"); var clearBtn = document.getElementById("uxFileClearBtn"); var fileBtn = document.getElementById("uxFileBtn"); var envGroup = document.querySelector(".ux-controls__left");
        chipsEl.innerHTML = "";
        var hasAny = _fileNames.pages || _fileNames.api;
        if (!hasAny) { chipsEl.style.display = "none"; clearBtn.style.display = "none"; fileBtn.classList.remove("ux-file-btn--active"); if (envGroup) envGroup.style.display = ""; return; }
        if (envGroup) envGroup.style.display = "none";
        var types = ["pages", "api"];
        for (var ti = 0; ti < types.length; ti++) {
            var type = types[ti]; if (!_fileNames[type]) continue;
            var chip = document.createElement("span"); chip.className = "ux-file-chip";
            var label = document.createElement("span"); label.textContent = _fileNames[type]; chip.appendChild(label);
            var removeBtn = document.createElement("span"); removeBtn.className = "ux-file-chip__remove"; removeBtn.innerHTML = "&times;"; removeBtn.title = "Remove this file";
            (function (t) { removeBtn.addEventListener("click", function () { removeFile(t); }); })(type);
            chip.appendChild(removeBtn); chipsEl.appendChild(chip);
        }
        chipsEl.style.display = ""; clearBtn.style.display = ""; fileBtn.classList.add("ux-file-btn--active");
    }

    function removeFile(type) {
        if (type === "pages") { _filePageEntries = null; _fileNames.pages = null; } else { _fileApiEntries = null; _fileNames.api = null; }
        _fileMode = !!(_filePageEntries || _fileApiEntries); updateFileChips(); loadData();
    }

    function clearFileMode() { _filePageEntries = null; _fileApiEntries = null; _fileNames.pages = null; _fileNames.api = null; _fileMode = false; updateFileChips(); loadData(); }

    function filterEntriesByRange(arr, after, before) {
        if (!arr) return []; if (!after && !before) return arr.slice();
        return arr.filter(function (e) { var t = new Date(e.ts).getTime(); if (after && t < after) return false; if (before && t > before) return false; return true; });
    }

    // ─── Load data ───
    function loadData() {
        if (_fileMode) {
            var range = getTimeRange();
            var afterMs = range.after ? new Date(range.after).getTime() : null;
            var beforeMs = range.before ? new Date(range.before).getTime() : null;
            renderAll({ entries: filterEntriesByRange(_filePageEntries, afterMs, beforeMs) }, { entries: filterEntriesByRange(_fileApiEntries, afterMs, beforeMs) });
            return;
        }
        var range = getTimeRange(); var params = "";
        if (range.after) params += (params ? "&" : "?") + "after=" + encodeURIComponent(range.after);
        if (range.before) params += (params ? "&" : "?") + "before=" + encodeURIComponent(range.before);
        Promise.all([
            fetch("/api/metrics/" + _uxProbeEnv + "/ux-pages" + params).then(function (r) { return r.json(); }),
            fetch("/api/metrics/" + _uxProbeEnv + "/ux-api" + params).then(function (r) { return r.json(); })
        ]).then(function (results) { renderAll(results[0], results[1]); checkStorage(); }).catch(function () {});
    }

    function renderAll(pageData, apiData) {
        _allPageEntries = pageData.entries || [];
        _currentPageEntries = getFilteredPageEntries();
        var filteredPageData = { entries: _currentPageEntries };
        renderSummary(pageData); renderCompareChart(pageData); renderDetailCharts(filteredPageData); renderProbesChart(apiData);
        updateResetZoomBtn("Vitals", false); updateResetZoomBtn("Probes", false); updateResetZoomBtn("Compare", false);
    }

    function getFilteredPageEntries() {
        if (!_selectedUrlKey) return _allPageEntries.slice();
        return _allPageEntries.filter(function (e) {
            var dataPath = extractPath(e.url);
            return matchTargetPattern(dataPath, _pageTargets) === _selectedUrlKey;
        });
    }

    function renderDetailCharts(filteredPageData) {
        renderVitalsChart(filteredPageData);
        renderDetailFilter();
    }

    function selectUrlFilter(key) {
        _selectedUrlKey = (_selectedUrlKey === key) ? null : key;
        _currentPageEntries = getFilteredPageEntries();
        var filteredPageData = { entries: _currentPageEntries };
        renderSummary({ entries: _allPageEntries });
        renderDetailCharts(filteredPageData);
        updateResetZoomBtn("Vitals", false);
    }

    function renderDetailFilter() {
        var el = document.getElementById("uxDetailFilter");
        if (!el) return;
        if (!_selectedUrlKey) {
            el.style.display = "none";
            return;
        }
        var label = pathLabel(_selectedUrlKey);
        el.style.display = "";
        el.innerHTML = '<span class="fa fa-filter"></span> Showing: <strong>' + esc(label) + '</strong> (' + esc(_selectedUrlKey) + ') <span class="ux-detail-filter__clear" id="uxDetailFilterClear">&times; Clear</span>';
        document.getElementById("uxDetailFilterClear").addEventListener("click", function () { selectUrlFilter(_selectedUrlKey); });
    }

    // ─── Chart helpers ───
    function generateColors(count) { var base = ["#4a9eff","#3dd68c","#ef5350","#f0a840","#a078ff","#56d4c0","#ff7eb3","#8bc34a","#ff9800","#7986cb","#26c6da","#d4e157","#ec407a","#66bb6a","#ffa726"]; var r = []; for (var i = 0; i < count; i++) r.push(base[i % base.length]); return r; }
    function toggleAllDatasets(chart, visible) { if (!chart) return; for (var i = 0; i < chart.data.datasets.length; i++) chart.setDatasetVisibility(i, visible); chart.update(); }

    function legendClickHandler(e, legendItem, legend) {
        var chart = legend.chart; var idx = legendItem.datasetIndex; var nativeEvent = e.native || e;
        if (nativeEvent.ctrlKey || nativeEvent.shiftKey || nativeEvent.metaKey) {
            var visibleCount = 0; var onlyThisVisible = true;
            for (var i = 0; i < chart.data.datasets.length; i++) { var v = chart.isDatasetVisible(i); if (v) visibleCount++; if (v && i !== idx) onlyThisVisible = false; }
            if (visibleCount === 1 && onlyThisVisible) { for (var i = 0; i < chart.data.datasets.length; i++) chart.setDatasetVisibility(i, true); }
            else { for (var i = 0; i < chart.data.datasets.length; i++) chart.setDatasetVisibility(i, i === idx); }
            chart.update();
        } else { chart.setDatasetVisibility(idx, !chart.isDatasetVisible(idx)); chart.update(); }
    }

    function getCommonChartConfig(prefix) {
        var isDark = !document.body.classList.contains("light-theme");
        return {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "nearest", intersect: false },
            scales: {
                x: { type: "time", time: { tooltipFormat: "dd MMM yyyy, HH:mm:ss" }, grid: { color: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }, ticks: { color: isDark ? "#5c6370" : "#8b919e", font: { size: 10 }, maxTicksLimit: 12, autoSkip: true, maxRotation: 45 } },
                y: { beginAtZero: true, title: { display: true, text: "ms", color: isDark ? "#5c6370" : "#8b919e", font: { size: 10 } }, grid: { color: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }, ticks: { color: isDark ? "#5c6370" : "#8b919e", font: { size: 10 } } }
            },
            plugins: {
                zoom: getZoomPluginConfig(prefix),
                legend: { position: "bottom", labels: { color: isDark ? "#8b919e" : "#5c6370", font: { size: 10, family: "'Consolas', 'Courier New', monospace" }, boxWidth: 12, padding: 10 }, onClick: function (e, li, lg) { legendClickHandler(e, li, lg); } },
                tooltip: { backgroundColor: isDark ? "#22262e" : "#ffffff", titleColor: isDark ? "#e2e5ea" : "#1a1d23", bodyColor: isDark ? "#abb2bf" : "#5c6370", borderColor: isDark ? "#363c48" : "#d8dbe0", borderWidth: 1 }
            }
        };
    }

    // Per-URL consistent colours (order matches first-seen in data)
    var URL_COLORS = ["#4a9eff", "#3dd68c", "#f0a840", "#ef5350", "#a078ff", "#56d4c0", "#ff7eb3", "#8bc34a"];

    var METRIC_LABELS = {
        lcp: "LCP (ms)", fcp: "FCP (ms)", tti: "TTI (ms)",
        totalLoadMs: "Total Load (ms)", ajaxSlowest: "Slowest AJAX (ms)"
    };

    var _compareEntryMap = [];  // [datasetIndex][pointIndex] -> entry

    // ─── Comparative Chart (Tier 2) ───
    function renderCompareChart(data) {
        var panel = document.getElementById("uxComparePanel");
        var canvas = document.getElementById("uxChartCompare");
        var emptyEl = document.getElementById("uxCompareEmpty");
        var countEl = document.getElementById("uxCompareCount");
        var entries = data.entries || [];

        panel.style.display = "";
        if (!entries.length) {
            canvas.style.display = "none";
            emptyEl.style.display = "";
            emptyEl.textContent = _fileMode ? "No page data in loaded file for this time range" : "No page data for this environment and time range";
            countEl.textContent = "";
            return;
        }
        emptyEl.style.display = "none";
        canvas.style.display = "block";
        canvas.style.width = "100%";
        canvas.style.height = "100%";

        var groups = groupEntriesByUrl(entries);
        countEl.textContent = groups.length + " pages, " + entries.length + " data points";

        if (_compareChart) _compareChart.destroy();

        var metric = _compareMetric;
        var datasets = [];
        _compareEntryMap = [];

        for (var gi = 0; gi < groups.length; gi++) {
            var g = groups[gi];
            var color = URL_COLORS[gi % URL_COLORS.length];
            var dsData = [];
            var dsEntries = [];
            for (var ei = 0; ei < g.entries.length; ei++) {
                var e = g.entries[ei];
                var val = e[metric];
                if (val != null) {
                    dsData.push({ x: new Date(e.ts), y: val });
                    dsEntries.push(e);
                }
            }
            datasets.push({
                label: g.label + " (" + g.path + ")",
                data: dsData,
                borderColor: color,
                backgroundColor: color,
                borderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6,
                tension: 0.2,
                fill: false
            });
            _compareEntryMap.push(dsEntries);
        }

        var config = getCommonChartConfig("Compare");
        config.scales.y.title.text = METRIC_LABELS[metric] || "ms";
        config.onClick = function (_evt, elements) {
            if (elements.length > 0) {
                var dsIdx = elements[0].datasetIndex;
                var ptIdx = elements[0].index;
                var entry = _compareEntryMap[dsIdx] && _compareEntryMap[dsIdx][ptIdx];
                if (entry) openCheckDetailModal(entry);
            }
        };

        _compareChart = new Chart(canvas, {
            type: "line",
            data: { datasets: datasets },
            options: config
        });
    }

    // ─── Web Vitals Chart ───
    function renderVitalsChart(data) {
        var canvas = document.getElementById("uxChartVitals"); var emptyEl = document.getElementById("uxVitalsEmpty"); var countEl = document.getElementById("uxVitalsCount");
        var entries = data.entries || []; countEl.textContent = entries.length + " data points";
        if (!entries.length) { canvas.style.display = "none"; emptyEl.style.display = ""; emptyEl.textContent = _selectedUrlKey ? "No page data for " + pathLabel(_selectedUrlKey) + " in this range" : _fileMode ? "No page data in loaded file for this time range" : "No page data for this environment and time range"; document.getElementById("uxVitalsActions").style.display = "none"; return; }
        emptyEl.style.display = "none"; canvas.style.display = "block"; canvas.style.width = "100%"; canvas.style.height = "100%"; document.getElementById("uxVitalsActions").style.display = "";
        if (_vitalsChart) _vitalsChart.destroy();
        var config = getCommonChartConfig("Vitals");
        config.onClick = function (_evt, elements) { if (elements.length > 0) { var entry = _currentPageEntries[elements[0].index]; if (entry) openCheckDetailModal(entry); } };
        _vitalsChart = new Chart(canvas, { type: "line", data: { datasets: [
            { label: "FCP", data: entries.map(function (e) { return { x: new Date(e.ts), y: e.fcp || null }; }), borderColor: "#4a9eff", borderWidth: 2, pointRadius: 3, tension: 0.2, fill: false },
            { label: "LCP", data: entries.map(function (e) { return { x: new Date(e.ts), y: e.lcp || null }; }), borderColor: "#ef5350", borderWidth: 2, pointRadius: 3, tension: 0.2, fill: false },
            { label: "TTI", data: entries.map(function (e) { return { x: new Date(e.ts), y: e.tti || null }; }), borderColor: "#3dd68c", borderWidth: 2, pointRadius: 3, tension: 0.2, fill: false }
        ] }, options: config });
    }

    // ─── API Probes Chart ───
    function renderProbesChart(data) {
        var canvas = document.getElementById("uxChartProbes"); var emptyEl = document.getElementById("uxProbesEmpty"); var countEl = document.getElementById("uxProbesCount");
        var entries = data.entries || []; countEl.textContent = entries.length + " data points";
        if (!entries.length) { canvas.style.display = "none"; emptyEl.style.display = ""; emptyEl.textContent = _fileMode ? "No probe data in loaded file for this time range" : "No probe data for this environment and time range"; document.getElementById("uxProbesActions").style.display = "none"; return; }
        emptyEl.style.display = "none"; canvas.style.display = "block"; canvas.style.width = "100%"; canvas.style.height = "100%"; document.getElementById("uxProbesActions").style.display = "";
        if (_probesChart) _probesChart.destroy();
        var labelSet = {};
        for (var pi = 0; pi < entries.length; pi++) { if (!entries[pi].probes) continue; for (var pj = 0; pj < entries[pi].probes.length; pj++) labelSet[entries[pi].probes[pj].label] = true; }
        var probeNames = Object.keys(labelSet); var colors = generateColors(probeNames.length);
        var datasets = [];
        for (var ni = 0; ni < probeNames.length; ni++) {
            var name = probeNames[ni]; var dsData = [];
            for (var di = 0; di < entries.length; di++) { var match = null; if (entries[di].probes) { for (var mi = 0; mi < entries[di].probes.length; mi++) { if (entries[di].probes[mi].label === name) { match = entries[di].probes[mi]; break; } } } dsData.push({ x: new Date(entries[di].ts), y: match ? match.ms : null }); }
            datasets.push({ label: name, data: dsData, borderColor: colors[ni], borderWidth: 2, pointRadius: 2, tension: 0.2, fill: false });
        }
        var fqServerData = []; var hasFqServer = false;
        for (var si = 0; si < entries.length; si++) { var fqMatch = null; if (entries[si].probes) { for (var sj = 0; sj < entries[si].probes.length; sj++) { if (entries[si].probes[sj].label === "FindByQuery" && entries[si].probes[sj].tookMs != null) { fqMatch = entries[si].probes[sj].tookMs; hasFqServer = true; } } } fqServerData.push({ x: new Date(entries[si].ts), y: fqMatch }); }
        if (hasFqServer) datasets.push({ label: "FindByQuery (server)", data: fqServerData, borderColor: "#4a9eff", borderWidth: 1.5, borderDash: [5, 3], pointRadius: 1, tension: 0.2, fill: false });
        _probesChart = new Chart(canvas, { type: "line", data: { datasets: datasets }, options: getCommonChartConfig("Probes") });
    }


    // ─── URL grouping utilities ───

    function extractPath(url) {
        if (!url) return "/";
        if (url.charAt(0) === "/") return url;
        try { return new URL(url).pathname; } catch (e) { return url; }
    }

    /**
     * Match a data path against configured page targets.
     * Targets with {guid} are converted to a regex pattern.
     * Returns the matched target string (grouping key) or the raw path if no match.
     */
    function matchTargetPattern(dataPath, targets) {
        for (var i = 0; i < targets.length; i++) {
            var t = targets[i];
            if (t.indexOf("{guid}") === -1) {
                // Static target: exact match
                if (dataPath === t) return t;
            } else {
                // Pattern target: {guid} -> UUID-like wildcard
                var escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                var pattern = escaped.replace(/\\{guid\\}/g, "[^/]+");
                var re = new RegExp("^" + pattern + "$");
                if (re.test(dataPath)) return t;
            }
        }
        return dataPath;
    }

    function pathLabel(targetPattern) {
        if (targetPattern === "/") return "Home";
        if (targetPattern === "/admin") return "Admin";
        if (targetPattern.indexOf("/sharedo/") === 0) return "Work Item";
        // Generic: use last meaningful path segment, capitalised
        var parts = targetPattern.split("/").filter(Boolean);
        var last = parts[parts.length - 1] || targetPattern;
        if (last.indexOf("{") !== -1) last = parts[parts.length - 2] || last;
        return last.charAt(0).toUpperCase() + last.slice(1);
    }

    function groupEntriesByUrl(entries) {
        var groups = {};  // targetPattern -> { entries[], label, path }
        var order = [];   // preserve first-seen order
        for (var i = 0; i < entries.length; i++) {
            var dataPath = extractPath(entries[i].url);
            var key = matchTargetPattern(dataPath, _pageTargets);
            if (!groups[key]) {
                groups[key] = { entries: [], label: pathLabel(key), path: key };
                order.push(key);
            }
            groups[key].entries.push(entries[i]);
        }
        var result = [];
        for (var j = 0; j < order.length; j++) result.push(groups[order[j]]);
        return result;
    }

    // ─── Summary cards (per-URL overview) ───

    var THRESHOLDS = {
        fcp:  { warn: 1800, crit: 3000 },
        lcp:  { warn: 2500, crit: 4000 },
        tti:  { warn: 3800, crit: 7300 }
    };

    function avg(arr) { if (!arr.length) return null; var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return Math.round(s / arr.length); }
    function peak(arr) { if (!arr.length) return null; var m = arr[0]; for (var i = 1; i < arr.length; i++) { if (arr[i] > m) m = arr[i]; } return Math.round(m); }

    function ratingClass(metric, value) {
        if (value == null) return "";
        var t = THRESHOLDS[metric];
        if (!t) return "";
        if (value < t.warn) return "good";
        if (value < t.crit) return "warn";
        return "bad";
    }

    function ratingLabel(metric, value) {
        var r = ratingClass(metric, value);
        if (r === "good") return "Good";
        if (r === "warn") return "Needs improvement";
        if (r === "bad") return "Poor";
        return "";
    }

    function fmtMs(ms) {
        if (ms == null) return "--";
        if (ms >= 10000) return (ms / 1000).toFixed(1) + "s";
        return ms + "ms";
    }

    function renderSummary(pageData) {
        var entries = pageData.entries || [];
        var summaryEl = document.getElementById("uxSummary");
        if (!entries.length) { summaryEl.style.display = "none"; summaryEl.innerHTML = ""; return; }

        var groups = groupEntriesByUrl(entries);
        var html = "";

        for (var gi = 0; gi < groups.length; gi++) {
            var g = groups[gi];
            var ge = g.entries;
            var fcps = [], lcps = [], ttis = [], loads = [], ajaxes = [];
            for (var ei = 0; ei < ge.length; ei++) {
                if (ge[ei].fcp != null && ge[ei].fcp > 0) fcps.push(ge[ei].fcp);
                if (ge[ei].lcp != null && ge[ei].lcp > 0) lcps.push(ge[ei].lcp);
                if (ge[ei].tti != null && ge[ei].tti > 0) ttis.push(ge[ei].tti);
                if (ge[ei].totalLoadMs != null) loads.push(ge[ei].totalLoadMs);
                if (ge[ei].ajaxSlowest != null) ajaxes.push(ge[ei].ajaxSlowest);
            }

            var avgLcp = avg(lcps);
            var peakLcp = peak(lcps);
            var avgFcp = avg(fcps);
            var avgTti = avg(ttis);
            var avgLoad = avg(loads);
            var avgSlowest = avg(ajaxes);
            var lcpRating = ratingClass("lcp", avgLcp);
            var lastEntry = ge[ge.length - 1];
            var lastTs = lastEntry ? shared.fmtDate(lastEntry.ts) : "--";

            html += '<div class="ux-url-card' + (_selectedUrlKey === g.path ? ' ux-url-card--selected' : '') + '" data-url-key="' + esc(g.path) + '">';

            // Header
            html += '<div class="ux-url-card__header">';
            html += '<span class="ux-url-card__dot' + (lcpRating ? ' ux-url-card__dot--' + lcpRating : '') + '"></span>';
            html += '<span class="ux-url-card__label">' + esc(g.label) + '</span>';
            html += '<span class="ux-url-card__path">' + esc(g.path) + '</span>';
            html += '<span class="ux-url-card__count">' + ge.length + (ge.length === 1 ? ' check' : ' checks') + '</span>';
            html += '</div>';

            // Hero metric (LCP)
            html += '<div class="ux-url-card__hero">';
            html += '<div class="ux-url-card__hero-value' + (lcpRating ? ' ux-url-card__hero-value--' + lcpRating : '') + '">' + fmtMs(avgLcp) + '</div>';
            html += '<div class="ux-url-card__hero-label">Avg LCP</div>';
            html += '<div class="ux-url-card__hero-sub">' + ratingLabel("lcp", avgLcp) + '</div>';
            html += '</div>';

            // Secondary metrics
            html += '<div class="ux-url-card__stats">';
            html += renderStat("Peak LCP", peakLcp, ratingClass("lcp", peakLcp));
            html += renderStat("Avg FCP", avgFcp, ratingClass("fcp", avgFcp));
            html += renderStat("Avg TTI", avgTti, ratingClass("tti", avgTti));
            html += renderStat("Avg Load", avgLoad, "");
            html += renderStat("Avg Slowest", avgSlowest, "");
            html += '</div>';

            // Footer
            html += '<div class="ux-url-card__footer">Last: ' + esc(lastTs) + '</div>';

            html += '</div>';
        }

        html += '<div class="ux-summary__guide">'
            + '<span class="fa fa-info-circle"></span> '
            + '<strong>LCP</strong> Largest Contentful Paint '
            + '<strong>FCP</strong> First Contentful Paint '
            + '<strong>TTI</strong> Time to Interactive '
            + '<strong>Load</strong> Total page load time '
            + '<strong>Slowest</strong> Slowest AJAX request '
            + '<strong>CLS</strong> Cumulative Layout Shift'
            + '</div>';

        summaryEl.innerHTML = html;
        summaryEl.style.display = "";

        // Wire card click handlers for URL filtering
        var cards = summaryEl.querySelectorAll(".ux-url-card");
        for (var ci = 0; ci < cards.length; ci++) {
            cards[ci].addEventListener("click", function () {
                selectUrlFilter(this.getAttribute("data-url-key"));
            });
        }
    }

    function renderStat(label, value, rating) {
        return '<div class="ux-url-card__stat">'
            + '<div class="ux-url-card__stat-value' + (rating ? ' ux-url-card__stat-value--' + rating : '') + '">' + fmtMs(value) + '</div>'
            + '<div class="ux-url-card__stat-label">' + label + '</div>'
            + '</div>';
    }

    // ─── Check detail modal ───
    function openCheckDetailModal(entry) {
        var modal = document.getElementById("uxAjaxModal");
        var context = document.getElementById("uxAjaxContext");
        var summary = document.getElementById("uxAjaxSummary");
        var body = document.getElementById("uxAjaxBody");

        if (!entry) { modal.style.display = "flex"; summary.innerHTML = ""; body.innerHTML = '<div class="ux-empty">No data.</div>'; return; }

        var ts = new Date(entry.ts).toLocaleString();
        var urlPath = extractPath(entry.url);
        var label = matchTargetPattern(urlPath, _pageTargets);
        context.textContent = ts + " -- " + pathLabel(label) + " (" + urlPath + ")";

        // ── Summary stats ──
        var totalMs = entry.totalLoadMs;
        var ajaxCount = entry.ajaxCount || (entry.ajaxTop ? entry.ajaxTop.length : 0);
        var slowest = entry.ajaxTop && entry.ajaxTop[0] ? entry.ajaxTop[0].ms : null;
        summary.innerHTML =
            '<div class="ux-modal__stat"><div class="ux-modal__stat-value">' + fmtMs(totalMs) + '</div><div class="ux-modal__stat-label">Total Load</div></div>' +
            '<div class="ux-modal__stat"><div class="ux-modal__stat-value">' + (entry.status || "--") + '</div><div class="ux-modal__stat-label">HTTP Status</div></div>' +
            '<div class="ux-modal__stat"><div class="ux-modal__stat-value">' + ajaxCount + '</div><div class="ux-modal__stat-label">AJAX Calls</div></div>' +
            '<div class="ux-modal__stat"><div class="ux-modal__stat-value">' + fmtMs(slowest) + '</div><div class="ux-modal__stat-label">Slowest AJAX</div></div>';

        var html = "";

        // ── Navigation timing ──
        var ttfb = entry.ttfb || 0;
        var domProc = entry.domInteractive ? Math.max(0, entry.domInteractive - ttfb) : 0;
        var render = entry.domComplete && entry.domInteractive ? Math.max(0, entry.domComplete - entry.domInteractive) : 0;
        var timingTotal = ttfb + domProc + render;

        if (timingTotal > 0) {
            html += '<div class="ux-modal__section-title">Navigation Timing</div>';
            html += '<div class="ux-modal__timing-bar">';
            html += '<div class="ux-modal__timing-seg ux-modal__timing-seg--ttfb" style="flex:' + ttfb + '"><span class="ux-modal__timing-val">' + ttfb + 'ms</span><span class="ux-modal__timing-name">TTFB</span></div>';
            html += '<div class="ux-modal__timing-seg ux-modal__timing-seg--dom" style="flex:' + domProc + '"><span class="ux-modal__timing-val">' + domProc + 'ms</span><span class="ux-modal__timing-name">DOM</span></div>';
            html += '<div class="ux-modal__timing-seg ux-modal__timing-seg--render" style="flex:' + render + '"><span class="ux-modal__timing-val">' + render + 'ms</span><span class="ux-modal__timing-name">Render</span></div>';
            html += '</div>';
        }

        // ── Web Vitals ──
        html += '<div class="ux-modal__section-title">Web Vitals</div>';
        html += '<div class="ux-modal__vitals">';
        html += modalVital("FCP", entry.fcp, "fcp");
        html += modalVital("LCP", entry.lcp, "lcp");
        html += modalVital("TTI", entry.tti, "tti");
        html += modalVitalRaw("CLS", entry.cls != null ? entry.cls.toFixed(3) : "--", "");
        html += '</div>';

        // ── AJAX table ──
        if (entry.ajaxTop && entry.ajaxTop.length > 0) {
            html += '<div class="ux-modal__section-title">Top AJAX Requests</div>';
            html += '<table class="ux-modal__table"><thead><tr><th class="ux-modal__td-rank">#</th><th>URL</th><th class="ux-modal__td-ms">Time</th></tr></thead><tbody>';
            for (var i = 0; i < entry.ajaxTop.length; i++) {
                var a = entry.ajaxTop[i];
                var cls = a.ms >= 3000 ? "ux-modal__row--crit" : a.ms >= 1000 ? "ux-modal__row--warn" : "";
                html += '<tr class="' + cls + '"><td class="ux-modal__td-rank">' + (i + 1) + '</td><td class="ux-modal__td-url">' + esc(a.url) + '</td><td class="ux-modal__td-ms">' + a.ms + 'ms</td></tr>';
            }
            html += '</tbody></table>';
        } else {
            html += '<div class="ux-modal__section-title">AJAX Requests</div>';
            html += '<div class="ux-empty" style="padding:12px 16px">No AJAX data for this check.</div>';
        }

        body.innerHTML = html;
        modal.style.display = "flex";
    }

    function modalVital(label, value, metric) {
        var r = ratingClass(metric, value);
        return '<div class="ux-modal__vital"><div class="ux-modal__vital-value' + (r ? ' ux-modal__vital-value--' + r : '') + '">' + fmtMs(value) + '</div><div class="ux-modal__vital-label">' + label + '</div></div>';
    }

    function modalVitalRaw(label, display, cls) {
        return '<div class="ux-modal__vital"><div class="ux-modal__vital-value' + (cls ? ' ' + cls : '') + '">' + display + '</div><div class="ux-modal__vital-label">' + label + '</div></div>';
    }

    function closeAjaxModal() { document.getElementById("uxAjaxModal").style.display = "none"; }

    // ─── Manual controls ───
    function runProbes() {
        var btn = document.getElementById("uxRunProbesBtn"); btn.disabled = true; btn.innerHTML = '<span class="fa fa-spinner fa-spin"></span> Running...';
        fetch("/api/ux/probe/run", { method: "POST" }).then(function (r) { return r.json(); }).then(function (data) {
            btn.innerHTML = data.error ? '<span class="fa fa-exclamation-triangle"></span> ' + esc(data.message) : '<span class="fa fa-check"></span> Done';
            setTimeout(function () { btn.innerHTML = '<span class="fa fa-play"></span> Run Probes'; btn.disabled = false; }, 2000);
        }).catch(function () { btn.innerHTML = '<span class="fa fa-play"></span> Run Probes'; btn.disabled = false; });
    }
    function runAllPageChecks() {
        var btn = document.getElementById("uxRunAllPagesBtn");
        btn.disabled = true; btn.innerHTML = '<span class="fa fa-spinner fa-spin"></span> Checking targets...';
        fetch("/api/ux/page/run-all", { method: "POST" }).then(function (r) { return r.json(); }).then(function (data) {
            if (data.error) {
                btn.innerHTML = '<span class="fa fa-exclamation-triangle"></span> ' + esc(data.message);
            } else {
                var count = data.results ? data.results.length : 0;
                var skipped = data.skipped || 0;
                btn.innerHTML = '<span class="fa fa-check"></span> ' + count + ' done' + (skipped ? ', ' + skipped + ' skipped' : '');
                setTimeout(function () { loadData(); }, 500);
            }
            setTimeout(function () { btn.innerHTML = '<span class="fa fa-files-o"></span> Run All Targets'; btn.disabled = false; }, 3000);
        }).catch(function () { btn.innerHTML = '<span class="fa fa-files-o"></span> Run All Targets'; btn.disabled = false; });
    }
    function runPageCheck() {
        var btn = document.getElementById("uxRunPageBtn"); var url = document.getElementById("uxPageUrl").value.trim() || "/";
        btn.disabled = true; btn.innerHTML = '<span class="fa fa-spinner fa-spin"></span> Loading page...';
        fetch("/api/ux/page/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url }) }).then(function (r) { return r.json(); }).then(function (data) {
            if (data.results && !data.results.error) { btn.innerHTML = '<span class="fa fa-check"></span> Done'; setTimeout(function () { loadData(); }, 500); }
            else { btn.innerHTML = '<span class="fa fa-exclamation-triangle"></span> ' + esc((data.results && data.results.error) || data.message || "Failed"); }
            setTimeout(function () { btn.innerHTML = '<span class="fa fa-globe"></span> Run Page Check'; btn.disabled = false; }, 3000);
        }).catch(function () { btn.innerHTML = '<span class="fa fa-globe"></span> Run Page Check'; btn.disabled = false; });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();