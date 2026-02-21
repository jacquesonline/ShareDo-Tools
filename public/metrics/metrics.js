/**
 * Metrics page for ShareDo Tools.
 * Displays historical stream backlog and node status charts.
 */
(function () {
    "use strict";

    var esc = shared.esc;
    var _streamChart = null;
    var _nodeChart = null;
    var _eventsChart = null;
    var _connChart = null;
    var _environments = [];
    var _syncLineTimestamp = null;  // shared timestamp for vertical sync line
    var _backlogThreshold = 250;   // fetched from settings
    var _streamThresholdVisible = false;  // toggles backlog threshold annotation line

    // ─── File mode state ───
    var _fileMode = false;
    var _fileStreamEntries = null;  // parsed entries from streamstats JSONL file
    var _fileNodeEntries = null;    // parsed entries from nodestatus JSONL file

    // Tracks loaded filenames keyed by metric type for chip rendering
    var _fileNames = { streamstats: null, nodestatus: null };

    var _chartBackgrounds = false;  // fill canvas background for image export

    // Chart.js plugin: draws a vertical line at _syncLineTimestamp
    var syncLinePlugin = {
        id: "syncLine",
        afterDraw: function (chart) {
            if (!_syncLineTimestamp) return;
            var xScale = chart.scales.x;
            if (!xScale || xScale.type !== "time") return;

            var xPixel = xScale.getPixelForValue(new Date(_syncLineTimestamp));
            if (xPixel < xScale.left || xPixel > xScale.right) return;

            var ctx = chart.ctx;
            var yTop = chart.chartArea.top;
            var yBottom = chart.chartArea.bottom;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(xPixel, yTop);
            ctx.lineTo(xPixel, yBottom);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "rgba(74, 158, 255, 0.6)";
            ctx.setLineDash([4, 3]);
            ctx.stroke();
            ctx.restore();

            // Small timestamp label at top
            ctx.save();
            ctx.font = "9px Consolas, Courier New, monospace";
            ctx.fillStyle = "rgba(74, 158, 255, 0.8)";
            ctx.textAlign = "center";
            var d = new Date(_syncLineTimestamp);
            var label = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0");
            ctx.fillText(label, xPixel, yTop - 4);
            ctx.restore();
        }
    };

    function init() {
        shared.init({ activePage: "metrics" });

        // Verify Chart.js loaded
        if (typeof Chart === "undefined") {
            document.getElementById("metStreamEmpty").textContent = "Chart.js failed to load from CDN";
            document.getElementById("metNodeEmpty").textContent = "Chart.js failed to load from CDN";
            return;
        }

        // Chart.js plugin: fills canvas background when _chartBackgrounds is enabled
        var bgFillPlugin = {
            id: "bgFill",
            beforeDraw: function (chart) {
                if (!_chartBackgrounds) return;
                var ctx = chart.ctx;
                var isDark = !document.body.classList.contains("light-theme");
                ctx.save();
                ctx.fillStyle = isDark ? "#22262e" : "#ffffff";
                ctx.fillRect(0, 0, chart.width, chart.height);
                ctx.restore();
            }
        };

        Chart.register(syncLinePlugin, bgFillPlugin);

        document.getElementById("metLoadBtn").addEventListener("click", loadMetrics);
        document.getElementById("metEnvSelect").addEventListener("change", loadMetrics);

        // Quick range buttons
        var quickBtns = document.querySelectorAll(".met-quick-btn");
        for (var i = 0; i < quickBtns.length; i++) {
            quickBtns[i].addEventListener("click", function () {
                selectQuickRange(this.getAttribute("data-range"));
            });
        }

        // Date picker changes
        document.getElementById("metDateFrom").addEventListener("change", onDatePickerChange);
        document.getElementById("metDateTo").addEventListener("change", onDatePickerChange);

        // Nav arrows
        document.getElementById("metNavPrev").addEventListener("click", function () { navStep(-1); });
        document.getElementById("metNavNext").addEventListener("click", function () { navStep(1); });

        // Today range slider
        document.getElementById("metRangeFrom").addEventListener("input", onSliderInput);
        document.getElementById("metRangeTo").addEventListener("input", onSliderInput);
        var _sliderDebounce = null;
        document.getElementById("metRangeFrom").addEventListener("change", function () { debouncedLoad(); });
        document.getElementById("metRangeTo").addEventListener("change", function () { debouncedLoad(); });

        function debouncedLoad() {
            if (_sliderDebounce) clearTimeout(_sliderDebounce);
            _sliderDebounce = setTimeout(loadMetrics, 300);
        }

        // Show/hide all legend items
        document.getElementById("metStreamShowAll").addEventListener("click", function () { toggleAllDatasets(_streamChart, true); });
        document.getElementById("metStreamHideAll").addEventListener("click", function () { toggleAllDatasets(_streamChart, false); });
        document.getElementById("metNodeShowAll").addEventListener("click", function () { toggleAllDatasets(_nodeChart, true); });
        document.getElementById("metNodeHideAll").addEventListener("click", function () { toggleAllDatasets(_nodeChart, false); });
        document.getElementById("metConnShowAll").addEventListener("click", function () { toggleAllDatasets(_connChart, true); });
        document.getElementById("metConnHideAll").addEventListener("click", function () { toggleAllDatasets(_connChart, false); });

        // Threshold line toggle
        document.getElementById("metStreamThresholdBtn").addEventListener("click", function () {
            _streamThresholdVisible = !_streamThresholdVisible;
            this.classList.toggle("usd-btn--active", _streamThresholdVisible);
            if (_streamChart) {
                _streamChart.options.plugins.annotation.annotations.thresholdLine.display = _streamThresholdVisible;
                _streamChart.update();
            }
        });

        // Reset zoom buttons
        document.getElementById("metStreamResetZoom").addEventListener("click", function () { if (_streamChart) { _streamChart.resetZoom(); updateResetZoomBtn("Stream", false); } });
        document.getElementById("metNodeResetZoom").addEventListener("click", function () { if (_nodeChart) { _nodeChart.resetZoom(); updateResetZoomBtn("Node", false); } });
        document.getElementById("metConnResetZoom").addEventListener("click", function () { if (_connChart) { _connChart.resetZoom(); updateResetZoomBtn("Conn", false); } });

        // File load controls
        document.getElementById("metFileBtn").addEventListener("click", function () {
            document.getElementById("metFileInput").click();
        });
        document.getElementById("metFileInput").addEventListener("change", onFileInputChange);
        document.getElementById("metFileClearBtn").addEventListener("click", clearFileMode);

        // Load env list then auto-load metrics
        fetch("/api/env").then(function (r) { return r.json(); }).then(function (data) {
            _environments = data.environments || [];
            var sel = document.getElementById("metEnvSelect");
            sel.innerHTML = "";
            for (var i = 0; i < _environments.length; i++) {
                var o = document.createElement("option");
                o.value = _environments[i].name;
                o.textContent = _environments[i].label;
                if (_environments[i].name === data.current) o.selected = true;
                sel.appendChild(o);
            }
            loadMetrics();
        }).catch(function () {});

        // Initialise slider fill
        var fill = document.getElementById("metRangeFill");
        fill.style.left = "0%";
        fill.style.width = "100%";

        // Check storage status
        checkStorage();

        // Fetch backlog threshold
        fetch("/api/settings").then(function (r) { return r.json(); }).then(function (data) {
            if (data.backlogThreshold) _backlogThreshold = data.backlogThreshold;
            if (data.chartBackgrounds != null) _chartBackgrounds = !!data.chartBackgrounds;
        }).catch(function () {});

        shared.onEnvChange(function () { checkStorage(); });

        // Set initial date picker values from active range
        updateDatePickerFromRange();
    }

    // ─── Range state ───
    var _activeRange = "1";  // quick button value or "custom"
    var _rangeAfter = null;  // ISO string or null
    var _rangeBefore = null; // ISO string or null

    function selectQuickRange(val) {
        _activeRange = val;

        // Update active button
        var btns = document.querySelectorAll(".met-quick-btn");
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle("met-quick-btn--active", btns[i].getAttribute("data-range") === val);
        }

        // Show/hide today slider
        document.getElementById("metRangeBar").style.display = val === "today" ? "" : "none";

        // Update nav arrows (disabled for "All")
        document.getElementById("metNavPrev").disabled = (val === "0");
        document.getElementById("metNavNext").disabled = (val === "0");

        updateDatePickerFromRange();
        loadMetrics();
    }

    function onDatePickerChange() {
        var from = document.getElementById("metDateFrom").value;
        var to = document.getElementById("metDateTo").value;
        if (!from && !to) return;

        _activeRange = "custom";
        _rangeAfter = from ? new Date(from).toISOString() : null;
        _rangeBefore = to ? new Date(to).toISOString() : null;

        // Deselect quick buttons
        var btns = document.querySelectorAll(".met-quick-btn");
        for (var i = 0; i < btns.length; i++) btns[i].classList.remove("met-quick-btn--active");

        document.getElementById("metRangeBar").style.display = "none";
        document.getElementById("metNavPrev").disabled = !_rangeAfter;
        document.getElementById("metNavNext").disabled = !_rangeAfter;
        loadMetrics();
    }

    function updateDatePickerFromRange() {
        var range = getTimeRange();
        if (range.after) {
            document.getElementById("metDateFrom").value = toLocalDatetimeString(new Date(range.after));
        } else {
            document.getElementById("metDateFrom").value = "";
        }
        if (range.before) {
            document.getElementById("metDateTo").value = toLocalDatetimeString(new Date(range.before));
        } else {
            document.getElementById("metDateTo").value = "";
        }
    }

    function toLocalDatetimeString(d) {
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    }

    function navStep(direction) {
        var range = getTimeRange();
        if (!range.after) return; // can't navigate "All"

        var afterMs = new Date(range.after).getTime();
        var beforeMs = range.before ? new Date(range.before).getTime() : Date.now();
        var spanMs = beforeMs - afterMs;

        var newAfter = new Date(afterMs + (direction * spanMs));
        var newBefore = new Date(beforeMs + (direction * spanMs));

        // Don't go into the future
        if (newBefore.getTime() > Date.now()) {
            newBefore = new Date();
            newAfter = new Date(newBefore.getTime() - spanMs);
        }

        _activeRange = "custom";
        _rangeAfter = newAfter.toISOString();
        _rangeBefore = newBefore.toISOString();

        // Deselect quick buttons
        var btns = document.querySelectorAll(".met-quick-btn");
        for (var i = 0; i < btns.length; i++) btns[i].classList.remove("met-quick-btn--active");

        document.getElementById("metRangeBar").style.display = "none";
        document.getElementById("metNavPrev").disabled = false;
        document.getElementById("metNavNext").disabled = false;

        // Update date pickers
        document.getElementById("metDateFrom").value = toLocalDatetimeString(newAfter);
        document.getElementById("metDateTo").value = toLocalDatetimeString(newBefore);

        loadMetrics();
    }

    function getTimeRange() {
        if (_activeRange === "custom") {
            return { after: _rangeAfter, before: _rangeBefore };
        }
        if (_activeRange === "today") {
            var today = new Date();
            var startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            var fromHour = parseInt(document.getElementById("metRangeFrom").value, 10);
            var toHour = parseInt(document.getElementById("metRangeTo").value, 10);
            return {
                after: new Date(startOfDay.getTime() + fromHour * 3600000).toISOString(),
                before: new Date(startOfDay.getTime() + toHour * 3600000).toISOString()
            };
        }
        if (_activeRange === "0") {
            return { after: null, before: null };
        }
        var hours = parseInt(_activeRange, 10);
        return { after: new Date(Date.now() - hours * 3600000).toISOString(), before: null };
    }

    function updateResetZoomBtn(prefix, visible) {
        document.getElementById("met" + prefix + "ResetZoom").style.display = visible ? "" : "none";
    }

    function getZoomPluginConfig(prefix) {
        return {
            zoom: {
                wheel: { enabled: true, modifierKey: "ctrl" },
                drag: { enabled: true, modifierKey: "shift", backgroundColor: "rgba(74,158,255,0.1)", borderColor: "rgba(74,158,255,0.4)", borderWidth: 1 },
                mode: "x",
                onZoom: function () { updateResetZoomBtn(prefix, true); }
            },
            pan: { enabled: true, modifierKey: "alt", mode: "x" },
            limits: { x: { minRange: 60000 } }
        };
    }

    function checkStorage() {
        fetch("/api/metrics/status").then(function (r) { return r.json(); }).then(function (data) {
            var infoEl = document.getElementById("metStorageInfo");
            var warnEl = document.getElementById("metWarning");
            var warnText = document.getElementById("metWarningText");

            if (!data.enabled) {
                infoEl.innerHTML = '<span class="met-storage-off"><span class="fa fa-pause-circle"></span> Recording disabled</span>';
                return;
            }

            var maxPct = 0;
            var parts = [];
            var filteredFiles = data.files.filter(function (f) { return f.metric === "streamstats" || f.metric === "nodestatus"; });
            for (var i = 0; i < filteredFiles.length; i++) {
                var f = filteredFiles[i];
                if (f.capPct > maxPct) maxPct = f.capPct;
                parts.push(f.metric + "-" + f.env + ": " + f.sizeMB + "MB (" + f.capPct + "%)");
            }
            infoEl.innerHTML = '<span class="met-storage-info" title="' + esc(parts.join("\n")) + '">' + filteredFiles.length + ' files | ' + (maxPct > 0 ? 'largest at ' + maxPct + '% of ' + data.capMB + 'MB cap' : 'all under cap') + '</span>';

            if (maxPct >= 90) {
                warnEl.style.display = "";
                warnText.textContent = "A metrics file is at " + maxPct + "% of the " + data.capMB + "MB cap. Consider backing up cache/metrics/ before old data is pruned.";
            } else if (maxPct >= 75) {
                warnEl.style.display = "";
                warnText.textContent = "A metrics file is at " + maxPct + "% of the " + data.capMB + "MB cap.";
            } else {
                warnEl.style.display = "none";
            }
        }).catch(function () {});
    }

    // ─── File mode ───

    // Accepted filename patterns:
    //   New format: (streamstats|nodestatus)[-backup[-DD-MM-YYYY]].jsonl
    //   Old format: (streamstats|nodestatus)-{env}[-backup[-DD-MM-YYYY]].jsonl
    var FILE_NAME_RE = /^(streamstats|nodestatus)(-[a-z0-9_-]+)?(-backup(-\d{2}-\d{2}-\d{4})?)?[.]jsonl$/i;

    // Keys that indicate a prototype pollution attempt
    var DANGEROUS_KEYS = ["__proto__", "constructor", "prototype"];

    function showGlobalError(msg) {
        var el = document.getElementById("globalError");
        el.textContent = msg;
        el.style.display = "";
        setTimeout(function () { el.style.display = "none"; }, 6000);
    }

    function hasDangerousKey(obj) {
        if (!obj || typeof obj !== "object") return false;
        for (var ki = 0; ki < DANGEROUS_KEYS.length; ki++) {
            if (Object.prototype.hasOwnProperty.call(obj, DANGEROUS_KEYS[ki])) return true;
        }
        return false;
    }

    function detectMetricType(entry) {
        if (entry && typeof entry.streams === "object" && entry.streams !== null) return "streamstats";
        if (entry && typeof entry.nodes === "object" && entry.nodes !== null) return "nodestatus";
        return null;
    }

    function onFileInputChange(e) {
        var files = e.target.files;
        if (!files || !files.length) return;

        for (var i = 0; i < files.length; i++) {
            (function (file) {
                // 1. Filename validation
                if (!FILE_NAME_RE.test(file.name)) {
                    showGlobalError("File rejected: \"" + file.name + "\" does not match the expected naming pattern (e.g. streamstats.jsonl, nodestatus-prod.jsonl, streamstats-backup-19-02-2026.jsonl).");
                    return;
                }

                var reader = new FileReader();

                reader.onload = function (ev) {
                    var text = ev.target.result;
                    var lines = text.split("\n");

                    // 2. Content validation: scan first 50 non-empty lines
                    var validationLines = 0;
                    var detectedType = null;

                    for (var li = 0; li < lines.length && validationLines < 50; li++) {
                        var raw = lines[li].trim();
                        if (!raw) continue;

                        var parsed;
                        try {
                            parsed = JSON.parse(raw);
                        } catch (err) {
                            // Malformed line in validation window -- skip
                            validationLines++;
                            continue;
                        }

                        // Must be a plain object
                        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                            showGlobalError("File rejected: \"" + file.name + "\" contains unexpected data structure.");
                            return;
                        }

                        // Prototype pollution check on root object
                        if (hasDangerousKey(parsed)) {
                            showGlobalError("File rejected: \"" + file.name + "\" contains disallowed keys.");
                            return;
                        }

                        // Must have a parseable ts field
                        if (typeof parsed.ts !== "string" || isNaN(new Date(parsed.ts).getTime())) {
                            showGlobalError("File rejected: \"" + file.name + "\" contains entries without a valid timestamp.");
                            return;
                        }

                        // Detect metric type from first valid entry with a data key
                        if (!detectedType) {
                            detectedType = detectMetricType(parsed);
                        }

                        // Prototype pollution check on the data payload object
                        if (parsed.streams && hasDangerousKey(parsed.streams)) {
                            showGlobalError("File rejected: \"" + file.name + "\" contains disallowed keys in stream data.");
                            return;
                        }
                        if (parsed.nodes && hasDangerousKey(parsed.nodes)) {
                            showGlobalError("File rejected: \"" + file.name + "\" contains disallowed keys in node data.");
                            return;
                        }

                        validationLines++;
                    }

                    if (!detectedType) {
                        showGlobalError("File rejected: \"" + file.name + "\" could not be identified as a streamstats or nodestatus file.");
                        return;
                    }

                    // 3. Parse all lines
                    var entries = [];
                    for (var pi = 0; pi < lines.length; pi++) {
                        var rawLine = lines[pi].trim();
                        if (!rawLine) continue;
                        try {
                            var entry = JSON.parse(rawLine);
                            if (entry && typeof entry === "object" && !Array.isArray(entry) &&
                                typeof entry.ts === "string" && !isNaN(new Date(entry.ts).getTime())) {
                                entries.push(entry);
                            }
                        } catch (parseErr) {
                            // Skip malformed lines silently
                        }
                    }

                    if (!entries.length) {
                        showGlobalError("File rejected: \"" + file.name + "\" contained no valid entries.");
                        return;
                    }

                    // Sort entries ascending by timestamp to match server response ordering
                    entries.sort(function (a, b) { return new Date(a.ts).getTime() - new Date(b.ts).getTime(); });

                    // 4. Store and update UI
                    if (detectedType === "streamstats") {
                        _fileStreamEntries = entries;
                        _fileNames.streamstats = file.name;
                    } else {
                        _fileNodeEntries = entries;
                        _fileNames.nodestatus = file.name;
                    }

                    _fileMode = true;
                    updateFileChips();
                };

                reader.onerror = function () {
                    showGlobalError("Failed to read file: \"" + file.name + "\".");
                };

                reader.readAsText(file);
            })(files[i]);
        }

        // Reset the input so the same file can be re-selected if needed
        e.target.value = "";
    }

    function updateFileChips() {
        var chipsEl = document.getElementById("metFileChips");
        var clearBtn = document.getElementById("metFileClearBtn");
        var fileBtn = document.getElementById("metFileBtn");
        var envGroup = document.querySelector(".met-controls__left");

        chipsEl.innerHTML = "";

        var hasAny = _fileNames.streamstats || _fileNames.nodestatus;

        if (!hasAny) {
            chipsEl.style.display = "none";
            clearBtn.style.display = "none";
            fileBtn.classList.remove("met-file-btn--active");
            if (envGroup) envGroup.style.display = "";
            return;
        }

        if (envGroup) envGroup.style.display = "none";

        var types = ["streamstats", "nodestatus"];
        for (var ti = 0; ti < types.length; ti++) {
            var type = types[ti];
            if (!_fileNames[type]) continue;

            var chip = document.createElement("span");
            chip.className = "met-file-chip";

            var label = document.createElement("span");
            label.textContent = _fileNames[type];
            chip.appendChild(label);

            var removeBtn = document.createElement("span");
            removeBtn.className = "met-file-chip__remove";
            removeBtn.innerHTML = "&times;";
            removeBtn.title = "Remove this file";
            (function (t) {
                removeBtn.addEventListener("click", function () { removeFile(t); });
            })(type);

            chip.appendChild(removeBtn);
            chipsEl.appendChild(chip);
        }

        chipsEl.style.display = "";
        clearBtn.style.display = "";
        fileBtn.classList.add("met-file-btn--active");
    }

    function removeFile(type) {
        if (type === "streamstats") {
            _fileStreamEntries = null;
            _fileNames.streamstats = null;
        } else {
            _fileNodeEntries = null;
            _fileNames.nodestatus = null;
        }

        var hasAny = _fileStreamEntries || _fileNodeEntries;
        _fileMode = !!hasAny;

        updateFileChips();
        loadMetrics();
    }

    function clearFileMode() {
        _fileStreamEntries = null;
        _fileNodeEntries = null;
        _fileNames.streamstats = null;
        _fileNames.nodestatus = null;
        _fileMode = false;
        updateFileChips();
        loadMetrics();
    }

    function filterEntriesByRange(arr, after, before) {
        if (!arr) return [];
        if (!after && !before) return arr.slice();
        return arr.filter(function (e) {
            var t = new Date(e.ts).getTime();
            if (after && t < after) return false;
            if (before && t > before) return false;
            return true;
        });
    }

    function loadMetrics() {
        // ─── File mode: filter in-memory arrays and render directly ───
        if (_fileMode) {
            var range = getTimeRange();
            var afterMs = range.after ? new Date(range.after).getTime() : null;
            var beforeMs = range.before ? new Date(range.before).getTime() : null;

            var streamResult = {
                entries: filterEntriesByRange(_fileStreamEntries, afterMs, beforeMs),
                count: 0
            };
            streamResult.count = streamResult.entries.length;

            var nodeResult = {
                entries: filterEntriesByRange(_fileNodeEntries, afterMs, beforeMs),
                count: 0
            };
            nodeResult.count = nodeResult.entries.length;

            _syncLineTimestamp = null;
            renderStreamChart(streamResult);
            renderConnectionsChart(streamResult);
            renderNodeChart(nodeResult);
            renderEventsChart(nodeResult);
            renderSummary(streamResult, nodeResult);
            checkStorage();
            updateResetZoomBtn("Stream", false);
            updateResetZoomBtn("Conn", false);
            updateResetZoomBtn("Node", false);
            return;
        }

        // ─── Live mode: fetch from server ───
        var env = document.getElementById("metEnvSelect").value;
        var range = getTimeRange();

        var params = "";
        if (range.after) params += (params ? "&" : "?") + "after=" + encodeURIComponent(range.after);
        if (range.before) params += (params ? "&" : "?") + "before=" + encodeURIComponent(range.before);

        // Load both metrics in parallel
        Promise.all([
            fetch("/api/metrics/" + env + "/streamstats" + params).then(function (r) { return r.json(); }),
            fetch("/api/metrics/" + env + "/nodestatus" + params).then(function (r) { return r.json(); })
        ]).then(function (results) {
            _syncLineTimestamp = null;
            renderStreamChart(results[0]);
            renderConnectionsChart(results[0]);
            renderNodeChart(results[1]);
            renderEventsChart(results[1]);
            renderSummary(results[0], results[1]);
            checkStorage();
            updateResetZoomBtn("Stream", false);
            updateResetZoomBtn("Conn", false);
            updateResetZoomBtn("Node", false);
        }).catch(function () {});
    }

    function onSliderInput() {
        var fromVal = parseInt(document.getElementById("metRangeFrom").value, 10);
        var toVal = parseInt(document.getElementById("metRangeTo").value, 10);

        // Prevent crossing
        if (fromVal > toVal) {
            if (this.id === "metRangeFrom") {
                fromVal = toVal;
                document.getElementById("metRangeFrom").value = fromVal;
            } else {
                toVal = fromVal;
                document.getElementById("metRangeTo").value = toVal;
            }
        }

        // Update labels
        document.getElementById("metRangeFromLabel").textContent = formatHour(fromVal);
        document.getElementById("metRangeToLabel").textContent = formatHour(toVal);

        // Update fill bar
        var pctFrom = (fromVal / 24) * 100;
        var pctTo = (toVal / 24) * 100;
        var fill = document.getElementById("metRangeFill");
        fill.style.left = pctFrom + "%";
        fill.style.width = (pctTo - pctFrom) + "%";
    }

    function formatHour(h) {
        if (h === 0 || h === 24) return "12:00 AM";
        if (h === 12) return "12:00 PM";
        if (h < 12) return h + ":00 AM";
        return (h - 12) + ":00 PM";
    }

    // ─── Gap detection: insert null markers where intervals exceed threshold ───
    var GAP_THRESHOLD_FACTOR = 3;  // gap = interval > 3x median

    function insertGapMarkers(entries) {
        if (entries.length < 3) return entries;

        // Calculate median interval
        var intervals = [];
        for (var i = 1; i < entries.length; i++) {
            intervals.push(new Date(entries[i].ts) - new Date(entries[i - 1].ts));
        }
        intervals.sort(function (a, b) { return a - b; });
        var median = intervals[Math.floor(intervals.length / 2)];
        var threshold = median * GAP_THRESHOLD_FACTOR;

        // Insert gap markers
        var result = [entries[0]];
        for (var i = 1; i < entries.length; i++) {
            var delta = new Date(entries[i].ts) - new Date(entries[i - 1].ts);
            if (delta > threshold) {
                // Insert a null marker just after the gap start
                result.push({ ts: entries[i - 1].ts, _gap: true });
            }
            result.push(entries[i]);
        }
        return result;
    }

    // ─── Stream Backlog Chart ───

    function renderStreamChart(data) {
        var canvas = document.getElementById("metStreamChart");
        var emptyEl = document.getElementById("metStreamEmpty");
        var countEl = document.getElementById("metStreamCount");

        var entries = data.entries || [];
        countEl.textContent = entries.length + " data points";

        if (!entries.length) {
            canvas.style.display = "none";
            emptyEl.style.display = "";
            emptyEl.textContent = _fileMode
                ? "No stream data in loaded file for this time range"
                : "No stream data recorded for this environment and time range";
            document.getElementById("metStreamActions").style.display = "none";
            return;
        }

        emptyEl.style.display = "none";
        canvas.style.display = "block";
        canvas.style.width = "100%";
        canvas.style.height = "100%";

        // Insert gap markers for line breaks
        entries = insertGapMarkers(entries);

        // Collect all stream names across all entries
        var streamNames = {};
        for (var i = 0; i < entries.length; i++) {
            if (entries[i]._gap) continue;
            var streams = entries[i].streams || {};
            for (var name in streams) streamNames[name] = true;
        }

        var names = Object.keys(streamNames).sort();

        // Build datasets -- one per stream
        var colors = generateColors(names.length);
        var datasets = [];
        for (var si = 0; si < names.length; si++) {
            var sn = names[si];
            var points = [];
            for (var ei = 0; ei < entries.length; ei++) {
                if (entries[ei]._gap) {
                    points.push({ x: new Date(entries[ei].ts).getTime(), y: null });
                    continue;
                }
                var val = entries[ei].streams && entries[ei].streams[sn] ? entries[ei].streams[sn].backlog : null;
                points.push({ x: new Date(entries[ei].ts).getTime(), y: val });
            }
            datasets.push({
                label: sn,
                data: points,
                borderColor: colors[si],
                backgroundColor: colors[si] + "20",
                borderWidth: 2,
                pointRadius: points.length > 500 ? 0 : 3,
                pointHoverRadius: 6,
                tension: 0.2,
                spanGaps: false,
                fill: false,
                parsing: false
            });
        }

        // Capture current visibility before destroying
        var hiddenStreams = {};
        if (_streamChart) {
            for (var hi = 0; hi < _streamChart.data.datasets.length; hi++) {
                var meta = _streamChart.getDatasetMeta(hi);
                if (meta.hidden === true || (_streamChart.data.datasets[hi].hidden && meta.hidden !== false)) {
                    hiddenStreams[_streamChart.data.datasets[hi].label] = true;
                }
            }
            _streamChart.destroy();
        }

        // Reapply hidden state from previous chart
        for (var ri = 0; ri < datasets.length; ri++) {
            if (hiddenStreams[datasets[ri].label]) datasets[ri].hidden = true;
        }

        var isDark = !document.body.classList.contains("light-theme");
        _streamChart = new Chart(canvas, {
            type: "line",
            data: { datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "nearest", intersect: false },
                onClick: chartClickHandler,
                scales: {
                    x: {
                        type: "time",
                        time: { tooltipFormat: "dd MMM yyyy, HH:mm:ss" },
                        grid: { color: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
                        ticks: { color: isDark ? "#5c6370" : "#8b919e", font: { size: 10 }, maxTicksLimit: 12, autoSkip: true, maxRotation: 45 }
                    },
                    y: {
                        beginAtZero: true,
                        suggestedMin: 0,
                        suggestedMax: 10,
                        title: { display: true, text: "Backlog", color: isDark ? "#5c6370" : "#8b919e", font: { size: 10 } },
                        grid: { color: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
                        ticks: { color: isDark ? "#5c6370" : "#8b919e", font: { size: 10 } }
                    }
                },
                plugins: {
                    decimation: { enabled: true, algorithm: "lttb", samples: 500 },
                    zoom: getZoomPluginConfig("Stream"),
                    annotation: {
                        annotations: {
                            thresholdLine: {
                                type: "line",
                                scaleID: "y",
                                value: _backlogThreshold,
                                borderColor: isDark ? "#ef5350" : "#d32f2f",
                                borderWidth: 1.5,
                                borderDash: [4, 3],
                                display: _streamThresholdVisible,
                                label: {
                                    display: true,
                                    content: "Threshold: " + _backlogThreshold,
                                    position: "end",
                                    yAdjust: -10,
                                    backgroundColor: isDark ? "rgba(239,83,80,0.15)" : "rgba(211,47,47,0.12)",
                                    color: isDark ? "#ef5350" : "#d32f2f",
                                    font: { size: 9, family: "'Consolas', 'Courier New', monospace" },
                                    padding: { top: 2, bottom: 2, left: 4, right: 4 }
                                }
                            }
                        }
                    },
                    legend: {
                        position: "bottom",
                        labels: { color: isDark ? "#8b919e" : "#5c6370", font: { size: 10, family: "'Consolas', 'Courier New', monospace" }, boxWidth: 12, padding: 10 },
                        onClick: function (e, legendItem, legend) { legendClickHandler(e, legendItem, legend); }
                    },
                    tooltip: {
                        backgroundColor: isDark ? "#22262e" : "#ffffff",
                        titleColor: isDark ? "#e2e5ea" : "#1a1d23",
                        bodyColor: isDark ? "#abb2bf" : "#5c6370",
                        borderColor: isDark ? "#363c48" : "#d8dbe0",
                        borderWidth: 1,
                        titleFont: { size: 11 },
                        bodyFont: { size: 11, family: "'Consolas', 'Courier New', monospace" }
                    }
                }
            }
        });

        document.getElementById("metStreamActions").style.display = datasets.length ? "" : "none";
    }

    // ─── Stream Connections Chart ───

    function renderConnectionsChart(data) {
        var canvas = document.getElementById("metConnChart");
        var emptyEl = document.getElementById("metConnEmpty");
        var countEl = document.getElementById("metConnCount");

        var entries = data.entries || [];
        countEl.textContent = entries.length + " data points";

        if (!entries.length) {
            canvas.style.display = "none";
            emptyEl.style.display = "";
            emptyEl.textContent = _fileMode
                ? "No stream data in loaded file for this time range"
                : "No stream data recorded for this environment and time range";
            document.getElementById("metConnActions").style.display = "none";
            return;
        }

        emptyEl.style.display = "none";
        canvas.style.display = "block";
        canvas.style.width = "100%";
        canvas.style.height = "100%";

        // Insert gap markers for line breaks
        entries = insertGapMarkers(entries);

        // Collect all stream names across all entries
        var streamNames = {};
        for (var i = 0; i < entries.length; i++) {
            if (entries[i]._gap) continue;
            var streams = entries[i].streams || {};
            for (var name in streams) streamNames[name] = true;
        }

        var names = Object.keys(streamNames).sort();

        // Build datasets -- one per stream, plotting connection count
        var colors = generateColors(names.length);
        var datasets = [];
        for (var si = 0; si < names.length; si++) {
            var sn = names[si];
            var points = [];
            for (var ei = 0; ei < entries.length; ei++) {
                if (entries[ei]._gap) {
                    points.push({ x: new Date(entries[ei].ts).getTime(), y: null });
                    continue;
                }
                var streamData = entries[ei].streams && entries[ei].streams[sn];
                var val = streamData != null ? (streamData.connections != null ? streamData.connections : null) : null;
                points.push({ x: new Date(entries[ei].ts).getTime(), y: val });
            }
            datasets.push({
                label: sn,
                data: points,
                borderColor: colors[si],
                backgroundColor: colors[si] + "20",
                borderWidth: 2,
                pointRadius: points.length > 500 ? 0 : 3,
                pointHoverRadius: 6,
                tension: 0.2,
                spanGaps: false,
                fill: false,
                parsing: false
            });
        }

        // Capture current visibility before destroying
        var hiddenStreams = {};
        if (_connChart) {
            for (var hi = 0; hi < _connChart.data.datasets.length; hi++) {
                var meta = _connChart.getDatasetMeta(hi);
                if (meta.hidden === true || (_connChart.data.datasets[hi].hidden && meta.hidden !== false)) {
                    hiddenStreams[_connChart.data.datasets[hi].label] = true;
                }
            }
            _connChart.destroy();
        }

        // Reapply hidden state from previous chart
        for (var ri = 0; ri < datasets.length; ri++) {
            if (hiddenStreams[datasets[ri].label]) datasets[ri].hidden = true;
        }

        var isDark = !document.body.classList.contains("light-theme");
        _connChart = new Chart(canvas, {
            type: "line",
            data: { datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "nearest", intersect: false },
                onClick: chartClickHandler,
                scales: {
                    x: {
                        type: "time",
                        time: { tooltipFormat: "dd MMM yyyy, HH:mm:ss" },
                        grid: { color: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
                        ticks: { color: isDark ? "#5c6370" : "#8b919e", font: { size: 10 }, maxTicksLimit: 12, autoSkip: true, maxRotation: 45 }
                    },
                    y: {
                        beginAtZero: true,
                        suggestedMin: 0,
                        suggestedMax: 3,
                        title: { display: true, text: "Connections", color: isDark ? "#5c6370" : "#8b919e", font: { size: 10 } },
                        grid: { color: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
                        ticks: { color: isDark ? "#5c6370" : "#8b919e", font: { size: 10 }, stepSize: 1 }
                    }
                },
                plugins: {
                    decimation: { enabled: true, algorithm: "lttb", samples: 500 },
                    zoom: getZoomPluginConfig("Conn"),
                    legend: {
                        position: "bottom",
                        labels: { color: isDark ? "#8b919e" : "#5c6370", font: { size: 10, family: "'Consolas', 'Courier New', monospace" }, boxWidth: 12, padding: 10 },
                        onClick: function (e, legendItem, legend) { legendClickHandler(e, legendItem, legend); }
                    },
                    tooltip: {
                        backgroundColor: isDark ? "#22262e" : "#ffffff",
                        titleColor: isDark ? "#e2e5ea" : "#1a1d23",
                        bodyColor: isDark ? "#abb2bf" : "#5c6370",
                        borderColor: isDark ? "#363c48" : "#d8dbe0",
                        borderWidth: 1,
                        titleFont: { size: 11 },
                        bodyFont: { size: 11, family: "'Consolas', 'Courier New', monospace" }
                    }
                }
            }
        });

        document.getElementById("metConnActions").style.display = datasets.length ? "" : "none";
    }

    // ─── Node Status Chart ───

    function renderNodeChart(data) {
        var canvas = document.getElementById("metNodeChart");
        var emptyEl = document.getElementById("metNodeEmpty");
        var countEl = document.getElementById("metNodeCount");

        var entries = data.entries || [];
        countEl.textContent = entries.length + " data points";

        if (!entries.length) {
            canvas.style.display = "none";
            emptyEl.style.display = "";
            emptyEl.textContent = _fileMode
                ? "No node data in loaded file for this time range"
                : "No node data recorded for this environment and time range";
            document.getElementById("metNodeActions").style.display = "none";
            return;
        }

        emptyEl.style.display = "none";
        canvas.style.display = "block";
        canvas.style.width = "100%";
        canvas.style.height = "100%";

        // Insert gap markers for line breaks
        entries = insertGapMarkers(entries);

        // Collect all node names
        var nodeNames = {};
        for (var i = 0; i < entries.length; i++) {
            if (entries[i]._gap) continue;
            var nodes = entries[i].nodes || {};
            for (var name in nodes) nodeNames[name] = true;
        }

        var names = Object.keys(nodeNames).sort();
        var colors = generateColors(names.length);

        // For each node, plot "running" count over time
        var datasets = [];
        for (var ni = 0; ni < names.length; ni++) {
            var nn = names[ni];
            var points = [];
            for (var ei = 0; ei < entries.length; ei++) {
                if (entries[ei]._gap) {
                    points.push({ x: new Date(entries[ei].ts).getTime(), y: null });
                    continue;
                }
                var nd = entries[ei].nodes && entries[ei].nodes[nn];
                var val = nd ? nd.running : null;
                points.push({ x: new Date(entries[ei].ts).getTime(), y: val });
            }
            datasets.push({
                label: nn,
                data: points,
                borderColor: colors[ni],
                backgroundColor: colors[ni] + "20",
                borderWidth: 2,
                pointRadius: points.length > 500 ? 0 : 3,
                pointHoverRadius: 6,
                tension: 0.2,
                spanGaps: false,
                fill: false,
                parsing: false
            });
        }

        // Capture current visibility before destroying
        var hiddenNodes = {};
        if (_nodeChart) {
            for (var hi = 0; hi < _nodeChart.data.datasets.length; hi++) {
                var meta = _nodeChart.getDatasetMeta(hi);
                if (meta.hidden === true || (_nodeChart.data.datasets[hi].hidden && meta.hidden !== false)) {
                    hiddenNodes[_nodeChart.data.datasets[hi].label] = true;
                }
            }
            _nodeChart.destroy();
        }

        // Reapply hidden state from previous chart
        for (var ri = 0; ri < datasets.length; ri++) {
            if (hiddenNodes[datasets[ri].label]) datasets[ri].hidden = true;
        }

        var isDark = !document.body.classList.contains("light-theme");
        _nodeChart = new Chart(canvas, {
            type: "line",
            data: { datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "nearest", intersect: false },
                onClick: chartClickHandler,
                scales: {
                    x: {
                        type: "time",
                        time: { tooltipFormat: "dd MMM yyyy, HH:mm:ss" },
                        grid: { color: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
                        ticks: { color: isDark ? "#5c6370" : "#8b919e", font: { size: 10 }, maxTicksLimit: 12, autoSkip: true, maxRotation: 45 }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: "Running Processes", color: isDark ? "#5c6370" : "#8b919e", font: { size: 10 } },
                        grid: { color: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
                        ticks: { color: isDark ? "#5c6370" : "#8b919e", font: { size: 10 }, stepSize: 1 }
                    }
                },
                plugins: {
                    decimation: { enabled: true, algorithm: "lttb", samples: 500 },
                    zoom: getZoomPluginConfig("Node"),
                    legend: {
                        position: "bottom",
                        labels: { color: isDark ? "#8b919e" : "#5c6370", font: { size: 10, family: "'Consolas', 'Courier New', monospace" }, boxWidth: 12, padding: 10 },
                        onClick: function (e, legendItem, legend) { legendClickHandler(e, legendItem, legend); }
                    },
                    tooltip: {
                        backgroundColor: isDark ? "#22262e" : "#ffffff",
                        titleColor: isDark ? "#e2e5ea" : "#1a1d23",
                        bodyColor: isDark ? "#abb2bf" : "#5c6370",
                        borderColor: isDark ? "#363c48" : "#d8dbe0",
                        borderWidth: 1,
                        titleFont: { size: 11 },
                        bodyFont: { size: 11, family: "'Consolas', 'Courier New', monospace" },
                        callbacks: {
                            afterBody: function (items) {
                                if (!items.length) return "";
                                var idx = items[0].dataIndex;
                                var nn = items[0].dataset.label;
                                var entries2 = data.entries || [];
                                if (entries2[idx] && entries2[idx].nodes && entries2[idx].nodes[nn]) {
                                    var nd = entries2[idx].nodes[nn];
                                    return "Stopped: " + (nd.stopped || 0) + " | Restarting: " + (nd.restarting || 0);
                                }
                                return "";
                            }
                        }
                    }
                }
            }
        });

        document.getElementById("metNodeActions").style.display = datasets.length ? "" : "none";
    }

    // ─── Stop/Restart Events Bar Chart ───

    function renderEventsChart(data) {
        var canvas = document.getElementById("metEventsChart");
        var emptyEl = document.getElementById("metEventsEmpty");
        var countEl = document.getElementById("metEventsCount");

        var entries = data.entries || [];

        if (!entries.length) {
            canvas.style.display = "none";
            emptyEl.style.display = "";
            emptyEl.textContent = _fileMode
                ? "No node data in loaded file for this time range"
                : "No node data for this range";
            countEl.textContent = "";
            return;
        }

        // Aggregate stop and restart counts per node
        var nodeNames = {};
        var stopCounts = {};
        var restartCounts = {};

        for (var i = 0; i < entries.length; i++) {
            var nodes = entries[i].nodes || {};
            for (var name in nodes) {
                nodeNames[name] = true;
                if (!stopCounts[name]) stopCounts[name] = 0;
                if (!restartCounts[name]) restartCounts[name] = 0;
                stopCounts[name] += (nodes[name].stopped || 0);
                restartCounts[name] += (nodes[name].restarting || 0);
            }
        }

        var names = Object.keys(nodeNames).sort();
        var totalEvents = 0;
        var stopData = [];
        var restartData = [];
        for (var ni = 0; ni < names.length; ni++) {
            stopData.push(stopCounts[names[ni]] || 0);
            restartData.push(restartCounts[names[ni]] || 0);
            totalEvents += (stopCounts[names[ni]] || 0) + (restartCounts[names[ni]] || 0);
        }

        countEl.textContent = totalEvents + " total events";

        emptyEl.style.display = "none";
        canvas.style.display = "block";
        canvas.style.width = "100%";
        canvas.style.height = "100%";

        if (_eventsChart) _eventsChart.destroy();

        var isDark = !document.body.classList.contains("light-theme");
        _eventsChart = new Chart(canvas, {
            type: "bar",
            data: {
                labels: names,
                datasets: [
                    {
                        label: "Stopped",
                        data: stopData,
                        backgroundColor: isDark ? "#ef5350" : "#d32f2f",
                        borderRadius: 3,
                        barPercentage: 0.7,
                        categoryPercentage: 0.8
                    },
                    {
                        label: "Restarting",
                        data: restartData,
                        backgroundColor: isDark ? "#f0a840" : "#e6930e",
                        borderRadius: 3,
                        barPercentage: 0.7,
                        categoryPercentage: 0.8
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: isDark ? "#8b919e" : "#5c6370", font: { size: 9, family: "'Consolas', 'Courier New', monospace" }, maxRotation: 45 }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: "Event Count", color: isDark ? "#5c6370" : "#8b919e", font: { size: 10 } },
                        grid: { color: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
                        ticks: { color: isDark ? "#5c6370" : "#8b919e", font: { size: 10 }, stepSize: 1 }
                    }
                },
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: { color: isDark ? "#8b919e" : "#5c6370", font: { size: 10, family: "'Consolas', 'Courier New', monospace" }, boxWidth: 12, padding: 10 }
                    },
                    tooltip: {
                        backgroundColor: isDark ? "#22262e" : "#ffffff",
                        titleColor: isDark ? "#e2e5ea" : "#1a1d23",
                        bodyColor: isDark ? "#abb2bf" : "#5c6370",
                        borderColor: isDark ? "#363c48" : "#d8dbe0",
                        borderWidth: 1,
                        titleFont: { size: 11 },
                        bodyFont: { size: 11, family: "'Consolas', 'Courier New', monospace" }
                    }
                }
            }
        });
    }

    // ─── Summary Cards ───

    function renderSummary(streamData, nodeData) {
        var summaryEl = document.getElementById("metSummary");
        var streamEntries = (streamData && streamData.entries) || [];
        var nodeEntries = (nodeData && nodeData.entries) || [];

        if (!streamEntries.length && !nodeEntries.length) {
            summaryEl.style.display = "none";
            return;
        }
        summaryEl.style.display = "";

        // Determine if the data range spans multiple calendar days (affects fmtTime output)
        var allEntries = streamEntries.length ? streamEntries : nodeEntries;
        if (allEntries.length >= 2) {
            var firstDate = new Date(allEntries[0].ts);
            var lastDate = new Date(allEntries[allEntries.length - 1].ts);
            _rangeSpansMultipleDays = firstDate.getDate() !== lastDate.getDate() ||
                firstDate.getMonth() !== lastDate.getMonth() ||
                firstDate.getFullYear() !== lastDate.getFullYear();
        } else {
            _rangeSpansMultipleDays = false;
        }

        // ── Avg Velocity (mean of consecutive deltas, events/min) ──
        var velocityEl = document.getElementById("metSumVelocity");
        var velocitySubEl = document.getElementById("metSumVelocitySub");
        if (streamEntries.length >= 2) {
            var deltas = [];
            for (var i = 1; i < streamEntries.length; i++) {
                var prevStreams = streamEntries[i - 1].streams || {};
                var currStreams = streamEntries[i].streams || {};
                var prevTotal = 0, currTotal = 0;
                for (var s in prevStreams) prevTotal += prevStreams[s].backlog || 0;
                for (var s in currStreams) currTotal += currStreams[s].backlog || 0;
                var intervalMin = (new Date(streamEntries[i].ts) - new Date(streamEntries[i - 1].ts)) / 60000;
                if (intervalMin > 0) deltas.push((currTotal - prevTotal) / intervalMin);
            }
            if (deltas.length) {
                var sumDeltas = 0;
                for (var d = 0; d < deltas.length; d++) sumDeltas += deltas[d];
                var velocity = sumDeltas / deltas.length;
                var sign = velocity > 0 ? "+" : "";
                velocityEl.textContent = sign + velocity.toFixed(1) + "/min";
                velocityEl.className = "met-summary__value" + (velocity > 0.5 ? " met-summary__value--positive" : velocity < -0.5 ? " met-summary__value--negative" : " met-summary__value--zero");
                var timeSpanMin = (new Date(streamEntries[streamEntries.length - 1].ts) - new Date(streamEntries[0].ts)) / 60000;
                velocitySubEl.textContent = "Mean of " + deltas.length + " intervals over " + timeSpanMin.toFixed(0) + "min";
            } else {
                velocityEl.textContent = "--";
                velocityEl.className = "met-summary__value";
                velocitySubEl.textContent = "Insufficient intervals";
            }
        } else {
            velocityEl.textContent = "--";
            velocityEl.className = "met-summary__value";
            velocitySubEl.textContent = "Need 2+ data points";
        }

        // ── Peak Backlog ──
        var peakEl = document.getElementById("metSumPeak");
        var peakSubEl = document.getElementById("metSumPeakSub");
        if (streamEntries.length) {
            var peakVal = 0, peakStream = "", peakTime = "";
            for (var i = 0; i < streamEntries.length; i++) {
                var streams = streamEntries[i].streams || {};
                for (var sn in streams) {
                    var bl = streams[sn].backlog || 0;
                    if (bl > peakVal) {
                        peakVal = bl;
                        peakStream = sn;
                        peakTime = streamEntries[i].ts;
                    }
                }
            }
            peakEl.textContent = peakVal.toLocaleString();
            peakEl.className = "met-summary__value" + (peakVal > _backlogThreshold ? " met-summary__value--bad" : peakVal > 0 ? " met-summary__value--warn" : " met-summary__value--good");
            peakSubEl.textContent = peakVal > 0 ? peakStream + " at " + fmtTime(peakTime) : "All clear";
        } else {
            peakEl.textContent = "--";
            peakEl.className = "met-summary__value";
            peakSubEl.textContent = "";
        }

        // ── Streams Above Threshold ──
        var breachEl = document.getElementById("metSumBreach");
        var breachSubEl = document.getElementById("metSumBreachSub");
        if (streamEntries.length) {
            var breachedStreams = {};
            for (var i = 0; i < streamEntries.length; i++) {
                var streams = streamEntries[i].streams || {};
                for (var sn in streams) {
                    if ((streams[sn].backlog || 0) > _backlogThreshold) breachedStreams[sn] = true;
                }
            }
            var breachCount = Object.keys(breachedStreams).length;
            breachEl.textContent = breachCount;
            breachEl.className = "met-summary__value" + (breachCount > 0 ? " met-summary__value--bad" : " met-summary__value--good");
            if (breachCount === 0) {
                breachSubEl.textContent = "None exceeded " + _backlogThreshold;
            } else if (breachCount <= 3) {
                breachSubEl.textContent = Object.keys(breachedStreams).join(", ");
            } else {
                var first3 = Object.keys(breachedStreams).slice(0, 3).join(", ");
                breachSubEl.textContent = first3 + " + " + (breachCount - 3) + " more";
            }
        } else {
            breachEl.textContent = "--";
            breachEl.className = "met-summary__value";
            breachSubEl.textContent = "";
        }

        // ── Time Above Threshold ──
        var breachTimeEl = document.getElementById("metSumBreachTime");
        var breachTimeSubEl = document.getElementById("metSumBreachTimeSub");
        if (streamEntries.length >= 2) {
            var pointsInBreach = 0;
            for (var i = 0; i < streamEntries.length; i++) {
                var streams = streamEntries[i].streams || {};
                var anyBreach = false;
                for (var sn in streams) {
                    if ((streams[sn].backlog || 0) > _backlogThreshold) { anyBreach = true; break; }
                }
                if (anyBreach) pointsInBreach++;
            }
            var pct = Math.round((pointsInBreach / streamEntries.length) * 100);
            var totalSpanMin = (new Date(streamEntries[streamEntries.length - 1].ts) - new Date(streamEntries[0].ts)) / 60000;
            var breachMin = Math.round(totalSpanMin * (pointsInBreach / streamEntries.length));
            breachTimeEl.textContent = pct + "%";
            breachTimeEl.className = "met-summary__value" + (pct > 50 ? " met-summary__value--bad" : pct > 0 ? " met-summary__value--warn" : " met-summary__value--good");
            breachTimeSubEl.textContent = fmtDuration(breachMin) + " of " + fmtDuration(Math.round(totalSpanMin));
        } else {
            breachTimeEl.textContent = "--";
            breachTimeEl.className = "met-summary__value";
            breachTimeSubEl.textContent = streamEntries.length ? "Need 2+ data points" : "";
        }

        // ── Node Uptime % ──
        var uptimeEl = document.getElementById("metSumUptime");
        var uptimeSubEl = document.getElementById("metSumUptimeSub");
        if (nodeEntries.length >= 2) {
            var healthyPoints = 0;
            var totalStops = 0;
            for (var i = 0; i < nodeEntries.length; i++) {
                var nodes = nodeEntries[i].nodes || {};
                var allHealthy = true;
                for (var nn in nodes) {
                    totalStops += (nodes[nn].stopped || 0) + (nodes[nn].restarting || 0);
                    if ((nodes[nn].stopped || 0) > 0 || (nodes[nn].restarting || 0) > 0) allHealthy = false;
                }
                if (allHealthy) healthyPoints++;
            }
            var uptimePct = Math.round((healthyPoints / nodeEntries.length) * 100);
            var nodeSpanMin = (new Date(nodeEntries[nodeEntries.length - 1].ts) - new Date(nodeEntries[0].ts)) / 60000;
            var uptimeMin = Math.round(nodeSpanMin * (healthyPoints / nodeEntries.length));
            uptimeEl.textContent = uptimePct + "%";
            uptimeEl.className = "met-summary__value" + (uptimePct === 100 ? " met-summary__value--good" : uptimePct >= 90 ? " met-summary__value--warn" : " met-summary__value--bad");
            uptimeSubEl.textContent = fmtDuration(uptimeMin) + " of " + fmtDuration(Math.round(nodeSpanMin)) + (totalStops > 0 ? " | " + totalStops + " events" : "");
        } else {
            uptimeEl.textContent = "--";
            uptimeEl.className = "met-summary__value";
            uptimeSubEl.textContent = nodeEntries.length ? "Need 2+ data points" : "";
        }

        // ── Connection Drops (transitions to 0) ──
        var connDropEl = document.getElementById("metSumConnDrops");
        var connDropSubEl = document.getElementById("metSumConnDropsSub");
        if (streamEntries.length >= 2) {
            var dropCount = 0;
            var droppedStreams = {};

            for (var i = 1; i < streamEntries.length; i++) {
                var prevStreams = streamEntries[i - 1].streams || {};
                var currStreams = streamEntries[i].streams || {};

                // Check all streams present in either entry
                var allNames = {};
                for (var pn in prevStreams) allNames[pn] = true;
                for (var cn in currStreams) allNames[cn] = true;

                for (var sn in allNames) {
                    var prevConn = prevStreams[sn] ? (prevStreams[sn].connections != null ? prevStreams[sn].connections : null) : null;
                    var currConn = currStreams[sn] ? (currStreams[sn].connections != null ? currStreams[sn].connections : null) : null;

                    if (prevConn === null || currConn === null) continue;

                    // Count transitions from >0 to exactly 0
                    if (prevConn > 0 && currConn === 0) {
                        dropCount++;
                        droppedStreams[sn] = true;
                    }
                }
            }

            connDropEl.textContent = dropCount;
            connDropEl.className = "met-summary__value" + (dropCount > 0 ? " met-summary__value--bad" : " met-summary__value--good");
            if (dropCount === 0) {
                connDropSubEl.textContent = "No drops to zero detected";
            } else {
                var dropNames = Object.keys(droppedStreams);
                if (dropNames.length <= 3) {
                    connDropSubEl.textContent = dropNames.join(", ");
                } else {
                    connDropSubEl.textContent = dropNames.slice(0, 3).join(", ") + " + " + (dropNames.length - 3) + " more";
                }
            }
        } else {
            connDropEl.textContent = "--";
            connDropEl.className = "met-summary__value";
            connDropSubEl.textContent = streamEntries.length ? "Need 2+ data points" : "";
        }
    }

    var _rangeSpansMultipleDays = false;

    function fmtTime(ts) {
        if (!ts) return "";
        var d = new Date(ts);
        var time = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
        if (_rangeSpansMultipleDays) {
            var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            return d.getDate() + " " + months[d.getMonth()] + ", " + time;
        }
        return time;
    }

    function fmtDuration(mins) {
        if (mins < 60) return mins + "min";
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        return h + "h " + String(m).padStart(2, "0") + "m";
    }

    // ─── Toggle all datasets visible/hidden ───

    function toggleAllDatasets(chart, visible) {
        if (!chart) return;
        for (var i = 0; i < chart.data.datasets.length; i++) {
            chart.setDatasetVisibility(i, visible);
        }
        chart.update();
    }

    function chartClickHandler(e, elements, chart) {
        if (!elements.length) {
            // Click on empty area -- clear sync line
            _syncLineTimestamp = null;
            if (_streamChart) _streamChart.update();
            if (_connChart) _connChart.update();
            if (_nodeChart) _nodeChart.update();
            return;
        }
        // Get the timestamp from the clicked data point
        var dataIndex = elements[0].index;
        var datasetIndex = elements[0].datasetIndex;
        var point = chart.data.datasets[datasetIndex].data[dataIndex];
        if (point && point.x) {
            _syncLineTimestamp = point.x instanceof Date ? point.x.toISOString() : point.x;
            // Update all time-aligned charts to draw the sync line
            if (_streamChart) _streamChart.update();
            if (_connChart) _connChart.update();
            if (_nodeChart) _nodeChart.update();
        }
    }

    function legendClickHandler(e, legendItem, legend) {
        var chart = legend.chart;
        var idx = legendItem.datasetIndex;
        var nativeEvent = e.native || e;

        if (nativeEvent.ctrlKey || nativeEvent.shiftKey || nativeEvent.metaKey) {
            // Solo mode: hide all others, show only this one
            // If this is already the only visible one, show all instead (toggle back)
            var visibleCount = 0;
            var onlyThisVisible = true;
            for (var i = 0; i < chart.data.datasets.length; i++) {
                var isVisible = chart.isDatasetVisible(i);
                if (isVisible) visibleCount++;
                if (isVisible && i !== idx) onlyThisVisible = false;
            }

            if (visibleCount === 1 && onlyThisVisible) {
                // Already solo -- show all
                for (var i = 0; i < chart.data.datasets.length; i++) {
                    chart.setDatasetVisibility(i, true);
                }
            } else {
                // Solo this one
                for (var i = 0; i < chart.data.datasets.length; i++) {
                    chart.setDatasetVisibility(i, i === idx);
                }
            }
            chart.update();
        } else {
            // Default behaviour: toggle this dataset
            chart.setDatasetVisibility(idx, !chart.isDatasetVisible(idx));
            chart.update();
        }
    }

    // ─── Colour generation ───

    function generateColors(count) {
        var base = [
            "#4a9eff", "#3dd68c", "#ef5350", "#f0a840", "#a078ff",
            "#56d4c0", "#ff7eb3", "#8bc34a", "#ff9800", "#7986cb",
            "#26c6da", "#d4e157", "#ec407a", "#66bb6a", "#ffa726"
        ];
        var result = [];
        for (var i = 0; i < count; i++) {
            result.push(base[i % base.length]);
        }
        return result;
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();