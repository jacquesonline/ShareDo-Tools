/**
 * ShareDo Work Item Search
 * Server-side paginated search against /api/v1/public/workItem/findByQuery
 * proxied through the local Node server at /api/search.
 */
(function () {
    "use strict";

    var esc = shared.esc, fmtNum = shared.fmtNum, fmtDate = shared.fmtDate;

    // ─── State ───
    var allTypes = [];           // flat array: { systemName, name, depth, label }
    var selectedTypes = [];      // array of { systemName, name, mode: "derived"|"exact" }
    var currentTypeMode = "derived";  // current selection mode
    var workItemIds = [];
    var ancestorIds = [];
    var attributes = [];  // array of { key, value, mode: "search"|"exact" }
    var enrichPaths = ["id", "reference", "title", "parent.id", "parent.reference", "parent.title"];
    var currentPage = 1;
    var lastResultCount = 0;
    var lastEnrichHeaders = [];

    // ─── Default enrich paths ───
    var DEFAULT_ENRICH = ["id", "reference", "title", "parent.id", "parent.reference", "parent.title"];

    // ─── Init ───
    function init() {
        shared.init({ activePage: "search" });
        shared.onEnvChange(function () { loadTypeTree(); });

        // Wire controls
        document.getElementById("searchBtn").addEventListener("click", function () { currentPage = 1; runSearch(); });
        document.getElementById("clearBtn").addEventListener("click", clearAll);
        document.getElementById("csvBtn").addEventListener("click", exportCSV);
        document.getElementById("srchRowsPerPage").addEventListener("change", function () { currentPage = 1; runSearch(); });

        // Type filter
        document.getElementById("typeFilter").addEventListener("input", filterTypes);
        document.getElementById("typeFilter").addEventListener("focus", function () { showTypeDropdown(true); });
        document.addEventListener("click", function (e) {
            if (!e.target.closest("#typeFilter") && !e.target.closest("#typeDropdown") && !e.target.closest(".srch-type-mode")) showTypeDropdown(false);
        });

        // Type mode toggle
        document.getElementById("typeModeDerive").addEventListener("click", function () { setTypeMode("derived"); });
        document.getElementById("typeModeExact").addEventListener("click", function () { setTypeMode("exact"); });

        // Chip inputs (IDs, ancestors)
        wireChipInput("idInput", workItemIds, "idChips");
        wireChipInput("ancestorInput", ancestorIds, "ancestorChips");

        // Attributes
        document.getElementById("attrAddBtn").addEventListener("click", addAttribute);
        document.getElementById("attrKeyInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addAttribute(); } });
        document.getElementById("attrValueInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addAttribute(); } });

        // Enrich paths
        document.getElementById("enrichAddBtn").addEventListener("click", addEnrichPath);
        document.getElementById("enrichInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addEnrichPath(); } });

        // Enter key on search fields triggers search
        var searchInputs = ["searchTitle", "searchReference", "searchFreeText", "searchExternalRef"];
        for (var i = 0; i < searchInputs.length; i++) {
            document.getElementById(searchInputs[i]).addEventListener("keydown", function (e) { if (e.key === "Enter") { currentPage = 1; runSearch(); } });
        }

        renderEnrichChips();
        loadTypeTree();

        // Presets
        document.getElementById("presetSaveBtn").addEventListener("click", savePreset);
        document.getElementById("presetLoadBtn").addEventListener("click", loadPreset);
        document.getElementById("presetDeleteBtn").addEventListener("click", deletePreset);
        document.getElementById("presetSelect").addEventListener("change", function () {
            var hasSelection = !!this.value;
            document.getElementById("presetLoadBtn").disabled = !hasSelection;
            document.getElementById("presetDeleteBtn").disabled = !hasSelection;
        });
        document.getElementById("presetNameInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); savePreset(); } });
        fetchPresets(renderPresetDropdown);

        // Sidebar height: set maxHeight via JS to enable internal scroll
        sizeSidebar();
        window.addEventListener("resize", sizeSidebar);
    }

    function sizeSidebar() {
        var el = document.getElementById("srchSidebar");
        if (!el) return;
        var rect = el.getBoundingClientRect();
        var available = window.innerHeight - rect.top - 12; // 12px bottom margin
        el.style.maxHeight = Math.max(200, available) + "px";
    }

    // ─── Type Tree ───
    function loadTypeTree() {
        allTypes = [];
        document.getElementById("typeDropdown").innerHTML = '<div class="srch-type-item srch-type-item--loading">Loading types...</div>';
        shared.apiFetch("/api/types/tree").then(function (r) { return r.json(); }).then(function (data) {
            if (data.error) { document.getElementById("typeDropdown").innerHTML = '<div class="srch-type-item srch-type-item--error">Failed to load types</div>'; return; }
            flattenTree(data, 0);
            filterTypes(true);
        }).catch(function () {
            document.getElementById("typeDropdown").innerHTML = '<div class="srch-type-item srch-type-item--error">Failed to load types</div>';
        });
    }

    function flattenTree(nodes, depth) {
        if (!Array.isArray(nodes)) return;
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var sn = n.systemName || n.name || "";
            var label = n.name || n.title || sn;
            allTypes.push({ systemName: sn, name: label, depth: depth, label: "\u00A0\u00A0".repeat(depth) + label });
            if (n.children && n.children.length) flattenTree(n.children, depth + 1);
        }
    }

    function filterTypes(suppressShow) {
        var filter = document.getElementById("typeFilter").value.toLowerCase();
        var dd = document.getElementById("typeDropdown");
        var html = "";
        var count = 0;
        for (var i = 0; i < allTypes.length; i++) {
            var t = allTypes[i];
            if (filter && t.name.toLowerCase().indexOf(filter) === -1 && t.systemName.toLowerCase().indexOf(filter) === -1) continue;
            var isSelected = isTypeSelected(t.systemName);
            html += '<div class="srch-type-item' + (isSelected ? ' srch-type-item--selected' : '') + '" data-sn="' + esc(t.systemName) + '" data-name="' + esc(t.name) + '" style="padding-left:' + (8 + t.depth * 12) + 'px">';
            html += (isSelected ? '<span class="fa fa-check-square-o"></span> ' : '<span class="fa fa-square-o"></span> ');
            html += esc(t.name) + ' <span class="srch-type-sn">' + esc(t.systemName) + '</span></div>';
            count++;
            if (count > 200) { html += '<div class="srch-type-item srch-type-item--loading">Showing first 200 results...</div>'; break; }
        }
        if (count === 0) html = '<div class="srch-type-item srch-type-item--loading">No matching types</div>';
        dd.innerHTML = html;
        if (!suppressShow) showTypeDropdown(true);

        var items = dd.querySelectorAll(".srch-type-item[data-sn]");
        for (var j = 0; j < items.length; j++) {
            items[j].addEventListener("click", function () {
                var sn = this.dataset.sn;
                var name = this.dataset.name;
                var idx = findSelectedTypeIndex(sn);
                if (idx === -1) {
                    selectedTypes.push({ systemName: sn, name: name, mode: currentTypeMode });
                } else {
                    selectedTypes.splice(idx, 1);
                }
                renderTypeChips();
                filterTypes();
            });
        }
    }

    function isTypeSelected(sn) {
        return findSelectedTypeIndex(sn) !== -1;
    }

    function findSelectedTypeIndex(sn) {
        for (var i = 0; i < selectedTypes.length; i++) { if (selectedTypes[i].systemName === sn) return i; }
        return -1;
    }

    function showTypeDropdown(show) {
        document.getElementById("typeDropdown").style.display = show ? "block" : "none";
    }

    function setTypeMode(mode) {
        currentTypeMode = mode;
        document.getElementById("typeModeDerive").className = "usd-btn srch-type-mode__btn" + (mode === "derived" ? " usd-btn--active" : "");
        document.getElementById("typeModeExact").className = "usd-btn srch-type-mode__btn" + (mode === "exact" ? " usd-btn--active" : "");
    }

    function renderTypeChips() {
        var container = document.getElementById("selectedTypesChips");
        var html = "";
        for (var i = 0; i < selectedTypes.length; i++) {
            var t = selectedTypes[i];
            var chipCls = t.mode === "exact" ? "usd-chip usd-chip--blue" : "usd-chip usd-chip--green";
            var modeLabel = t.mode === "exact" ? "Exact" : "Derived";
            html += '<span class="' + chipCls + '"><span class="usd-chip__mode">' + modeLabel + '</span> ' + esc(t.name) + ' <span class="usd-chip__remove" data-idx="' + i + '">&times;</span></span>';
        }
        container.innerHTML = html;
        var btns = container.querySelectorAll(".usd-chip__remove");
        for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener("click", function () {
                selectedTypes.splice(parseInt(this.dataset.idx, 10), 1);
                renderTypeChips();
                filterTypes();
            });
        }
    }

    function findType(sn) {
        for (var i = 0; i < allTypes.length; i++) { if (allTypes[i].systemName === sn) return allTypes[i]; }
        return null;
    }

    // ─── Chip inputs ───
    function wireChipInput(inputId, list, chipsId) {
        var input = document.getElementById(inputId);
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                var val = input.value.trim();
                if (val && list.indexOf(val) === -1) { list.push(val); input.value = ""; renderChips(list, chipsId); }
            }
        });
    }

    function renderChips(list, containerId) {
        var container = document.getElementById(containerId);
        var html = "";
        for (var i = 0; i < list.length; i++) {
            html += '<span class="usd-chip usd-chip--blue">' + esc(list[i]) + ' <span class="usd-chip__remove" data-idx="' + i + '">&times;</span></span>';
        }
        container.innerHTML = html;
        wireChipRemoveButtons(container, list, function () { renderChips(list, containerId); });
    }

    function wireChipRemoveButtons(container, list, rerender) {
        var btns = container.querySelectorAll(".usd-chip__remove");
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener("click", function () {
                var idx = parseInt(this.dataset.idx, 10);
                list.splice(idx, 1);
                rerender();
            });
        }
    }

    // ─── Enrich paths ───
    function addEnrichPath() {
        var input = document.getElementById("enrichInput");
        var val = input.value.trim();
        if (val && enrichPaths.indexOf(val) === -1) { enrichPaths.push(val); input.value = ""; renderEnrichChips(); }
    }

    function renderEnrichChips() {
        var container = document.getElementById("enrichChips");
        var html = "";
        for (var i = 0; i < enrichPaths.length; i++) {
            html += '<span class="usd-chip usd-chip--cyan">' + esc(enrichPaths[i]) + ' <span class="usd-chip__remove" data-idx="' + i + '">&times;</span></span>';
        }
        container.innerHTML = html;
        wireChipRemoveButtons(container, enrichPaths, renderEnrichChips);
    }

    // ─── Attributes ───
    function addAttribute() {
        var keyInput = document.getElementById("attrKeyInput");
        var valInput = document.getElementById("attrValueInput");
        var modeSelect = document.getElementById("attrMode");
        var key = keyInput.value.trim();
        var val = valInput.value.trim();
        if (!key) return;
        attributes.push({ key: key, value: val, mode: modeSelect.value });
        keyInput.value = "";
        valInput.value = "";
        renderAttrChips();
    }

    function renderAttrChips() {
        var container = document.getElementById("attrChips");
        var html = "";
        for (var i = 0; i < attributes.length; i++) {
            var a = attributes[i];
            var modeLabel = a.mode === "exact" ? "Exact" : "Contains";
            var chipCls = a.mode === "exact" ? "usd-chip usd-chip--blue" : "usd-chip usd-chip--green";
            html += '<span class="' + chipCls + '"><span class="srch-attr-chip-mode">' + modeLabel + '</span> ' + esc(a.key);
            if (a.value) html += ': ' + esc(a.value);
            html += ' <span class="usd-chip__remove" data-idx="' + i + '">&times;</span></span>';
        }
        container.innerHTML = html;
        var btns = container.querySelectorAll(".usd-chip__remove");
        for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener("click", function () {
                attributes.splice(parseInt(this.dataset.idx, 10), 1);
                renderAttrChips();
            });
        }
    }

    // ─── Section toggle ───
    window.toggleSection = function (id) { document.getElementById(id).classList.toggle("srch-section--collapsed"); };

    // ─── Build query model ───
    function buildQuery(page, rowsPerPage) {
        var model = { search: {}, enrich: [] };

        // Pagination
        model.search.page = { page: page, rowsPerPage: rowsPerPage };

        // Sort
        model.search.sort = {
            direction: document.getElementById("sortDirection").value,
            orderBy: document.getElementById("sortField").value
        };

        // Types -- split by mode
        if (selectedTypes.length > 0) {
            var includeTypes = [];
            var includeTypesDerivedFrom = [];
            for (var ti = 0; ti < selectedTypes.length; ti++) {
                if (selectedTypes[ti].mode === "exact") {
                    includeTypes.push(selectedTypes[ti].systemName);
                } else {
                    includeTypesDerivedFrom.push(selectedTypes[ti].systemName);
                }
            }
            model.search.types = {};
            if (includeTypes.length > 0) model.search.types.includeTypes = includeTypes;
            if (includeTypesDerivedFrom.length > 0) model.search.types.includeTypesDerivedFrom = includeTypesDerivedFrom;
        }

        // Phase
        model.search.phase = {
            includeOpen: document.getElementById("phaseOpen").checked,
            includeClosed: document.getElementById("phaseClosed").checked,
            includeRemoved: document.getElementById("phaseRemoved").checked
        };

        // Title
        var title = document.getElementById("searchTitle").value.trim();
        if (title) model.search.title = title;

        // Reference
        var ref = document.getElementById("searchReference").value.trim();
        if (ref) model.search.reference = ref;

        // External reference
        var extRef = document.getElementById("searchExternalRef").value.trim();
        if (extRef) model.search.externalReference = extRef;

        // Free text
        var freeText = document.getElementById("searchFreeText").value.trim();
        if (freeText) {
            model.search.freeText = {
                input: freeText,
                wildcardStart: document.getElementById("freeTextWildStart").checked,
                wildCardEnd: document.getElementById("freeTextWildEnd").checked
            };
        }

        // Work item IDs
        if (workItemIds.length > 0) {
            model.search.workItemIds = workItemIds.slice();
        }

        // Dates
        var cFrom = document.getElementById("createdFrom").value;
        var cTo = document.getElementById("createdTo").value;
        if (cFrom || cTo) {
            model.search.dates = model.search.dates || {};
            model.search.dates.created = {};
            if (cFrom) model.search.dates.created.from = cFrom + " 00:00";
            if (cTo) model.search.dates.created.to = cTo + " 23:59";
        }

        var uFrom = document.getElementById("updatedFrom").value;
        var uTo = document.getElementById("updatedTo").value;
        if (uFrom || uTo) {
            model.search.dates = model.search.dates || {};
            model.search.dates.updated = {};
            if (uFrom) model.search.dates.updated.from = uFrom + " 00:00";
            if (uTo) model.search.dates.updated.to = uTo + " 23:59";
        }

        // Ancestor / graph
        if (ancestorIds.length > 0) {
            model.search.graph = { ancestorIds: ancestorIds.slice() };
            var maxDist = parseInt(document.getElementById("ancestorMaxDistance").value, 10);
            if (!isNaN(maxDist) && maxDist > 0) model.search.graph.maxAncestorDistance = maxDist;
            if (document.getElementById("ancestorIncludeRelated").checked) model.search.graph.includeRelated = true;
        }

        // Attributes
        if (attributes.length > 0) {
            model.search.attributes = [];
            for (var ai = 0; ai < attributes.length; ai++) {
                var attr = attributes[ai];
                var attrObj = { key: attr.key };
                if (attr.mode === "exact" && attr.value) {
                    attrObj.selectedValues = attr.value.split(",").map(function (v) { return v.trim(); }).filter(Boolean);
                } else if (attr.value) {
                    attrObj.search = attr.value;
                }
                model.search.attributes.push(attrObj);
            }
        }

        // Enrich
        for (var i = 0; i < enrichPaths.length; i++) {
            model.enrich.push({ path: enrichPaths[i] });
        }

        return model;
    }

    var _isPaging = false;

    // ─── Run search ───
    function runSearch() {
        var rpp = parseInt(document.getElementById("srchRowsPerPage").value, 10) || 20;
        var model = buildQuery(currentPage, rpp);

        document.getElementById("searchBtn").classList.add("usd-btn--loading");

        // Preserve table height during pagination to prevent layout shift
        var tableWrap = document.querySelector(".srch-results__table-wrap");
        if (_isPaging && tableWrap) {
            tableWrap.style.minHeight = tableWrap.offsetHeight + "px";
        }

        document.getElementById("resultsBody").innerHTML = '<tr><td colspan="99" class="usd-table__muted"><span class="fa fa-spinner fa-spin"></span> Searching...</td></tr>';

        shared.apiFetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(model) })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                renderResults(data, rpp);
                if (tableWrap) tableWrap.style.minHeight = "";
                if (_isPaging) {
                    var pagEl = document.getElementById("srchPagination");
                    if (pagEl) pagEl.scrollIntoView({ behavior: "smooth", block: "end" });
                }
                _isPaging = false;
            })
            .catch(function (err) {
                renderResults({ error: true, message: err.message }, rpp);
                if (tableWrap) tableWrap.style.minHeight = "";
                _isPaging = false;
            })
            .finally(function () { document.getElementById("searchBtn").classList.remove("usd-btn--loading"); });
    }

    // ─── Render results ───
    function renderResults(data, rpp) {
        var headEl = document.getElementById("resultsHead");
        var bodyEl = document.getElementById("resultsBody");
        var countEl = document.getElementById("resultCount");
        var pagEl = document.getElementById("srchPagination");
        var csvBtn = document.getElementById("csvBtn");

        if (!data || data.error) {
            bodyEl.innerHTML = '<tr><td class="usd-table__muted">Search failed' + (data && data.message ? ': ' + esc(data.message) : '') + '</td></tr>';
            headEl.innerHTML = "";
            countEl.textContent = "";
            pagEl.innerHTML = "";
            csvBtn.disabled = true;
            return;
        }

        var total = data.totalCount || 0;
        var results = data.results || [];
        lastResultCount = total;
        countEl.textContent = fmtNum(total) + " result" + (total !== 1 ? "s" : "");
        csvBtn.disabled = results.length === 0;

        // Build headers from enrich paths
        lastEnrichHeaders = enrichPaths.slice();
        var hHtml = "<tr>";
        for (var h = 0; h < lastEnrichHeaders.length; h++) {
            hHtml += "<th>" + esc(lastEnrichHeaders[h]) + "</th>";
        }
        hHtml += "</tr>";
        headEl.innerHTML = hHtml;

        // Enrich paths ending with a URL segment should render as hyperlinks
        // Matches: urls.view, urls.open, urls.edit, urls.portal
        // Also matches prefixed paths: parent.urls.view, ancestors!q?path=matter!1.urls.view, etc.
        var URL_SUFFIX_RE = /(?:^|\.)(urls\.(?:view|open|edit|portal))$/;

        function isUrlPath(path) { return URL_SUFFIX_RE.test(path); }

        // Build rows
        var bHtml = "";
        for (var i = 0; i < results.length; i++) {
            var row = results[i];
            var rowData = row.data || {};
            bHtml += "<tr>";
            for (var j = 0; j < lastEnrichHeaders.length; j++) {
                var colPath = lastEnrichHeaders[j];
                var val = resolveNestedValue(rowData, colPath);
                if (val != null && isUrlPath(colPath)) {
                    var href = String(val);
                    if (href && href.charAt(0) === "/") {
                        var host = document.getElementById("hostLabel").textContent;
                        if (host && host !== "--") href = "https://" + host + href;
                    }
                    bHtml += '<td class="usd-table__mono"><a href="' + esc(href) + '" target="_blank" class="srch-link usd-help" data-tooltip="' + esc(href) + '"><span class="fa fa-external-link"></span> Open</a></td>';
                } else {
                    bHtml += '<td class="usd-table__mono">' + esc(val != null ? String(val) : "") + "</td>";
                }
            }
            bHtml += "</tr>";
        }
        if (results.length === 0) {
            bHtml = '<tr><td colspan="' + lastEnrichHeaders.length + '" class="usd-table__muted">No results</td></tr>';
        }
        bodyEl.innerHTML = bHtml;

        // Pagination
        var totalPages = Math.ceil(total / rpp) || 1;
        var pH = "";
        if (totalPages > 1) {
            pH += '<button class="usd-btn usd-pag-btn" ' + (currentPage <= 1 ? "disabled" : "") + ' onclick="window._srchGoPage(' + (currentPage - 1) + ')"><span class="fa fa-chevron-left"></span></button>';
            pH += ' <span class="usd-pag-info">Page ' + currentPage + " of " + totalPages + "</span> ";
            pH += '<button class="usd-btn usd-pag-btn" ' + (currentPage >= totalPages ? "disabled" : "") + ' onclick="window._srchGoPage(' + (currentPage + 1) + ')"><span class="fa fa-chevron-right"></span></button>';
        }
        pagEl.innerHTML = pH;
    }

    window._srchGoPage = function (p) { _isPaging = true; currentPage = p; runSearch(); };

    // ─── Resolve nested value from enriched data ───
    // The findByQuery API stores enriched fields as flat keys using the dot-notation
    // path as a literal property name, e.g. row.data["parent.id"] rather than
    // row.data.parent.id. Check the flat key first, then fall back to nested walk.
    function resolveNestedValue(obj, path) {
        if (!obj || !path) return null;
        // 1. Direct flat key (how findByQuery actually returns enriched data)
        if (obj.hasOwnProperty(path)) return obj[path];
        // 2. Nested object walk (fallback)
        var parts = path.split(".");
        var current = obj;
        for (var i = 0; i < parts.length; i++) {
            if (current == null || typeof current !== "object") return null;
            current = current[parts[i]];
        }
        return current;
    }

    // ─── CSV Export (fetches all results up to 10k) ───
    function exportCSV() {
        if (lastResultCount === 0) return;

        var total = Math.min(lastResultCount, 10000);
        var rpp = 50;  // fetch in chunks of 50 for export
        var totalPages = Math.ceil(total / rpp);
        var csvBtn = document.getElementById("csvBtn");
        var countEl = document.getElementById("resultCount");
        csvBtn.classList.add("usd-btn--loading");
        countEl.textContent = "Exporting page 1 of " + totalPages + "...";

        var allResults = [];
        var currentExportPage = 1;

        function fetchNextPage() {
            var model = buildQuery(currentExportPage, rpp);
            shared.apiFetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(model) })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data && !data.error && data.results) {
                        allResults = allResults.concat(data.results);
                    }
                    if (currentExportPage < totalPages && allResults.length < total) {
                        currentExportPage++;
                        countEl.textContent = "Exporting page " + currentExportPage + " of " + totalPages + "...";
                        fetchNextPage();
                    } else {
                        // Build CSV
                        var headers = lastEnrichHeaders.slice();
                        var csvRows = [headers.map(csvEscape).join(",")];
                        for (var i = 0; i < allResults.length; i++) {
                            var row = allResults[i].data || {};
                            var cols = [];
                            for (var j = 0; j < headers.length; j++) {
                                var val = resolveNestedValue(row, headers[j]);
                                cols.push(csvEscape(val != null ? String(val) : ""));
                            }
                            csvRows.push(cols.join(","));
                        }
                        downloadCSV(csvRows.join("\n"), "sharedo-search-export.csv");
                        countEl.textContent = fmtNum(lastResultCount) + " result" + (lastResultCount !== 1 ? "s" : "") + " (" + allResults.length + " exported)";
                        csvBtn.classList.remove("usd-btn--loading");
                    }
                })
                .catch(function (err) {
                    alert("Export failed on page " + currentExportPage + ": " + err.message);
                    csvBtn.classList.remove("usd-btn--loading");
                    countEl.textContent = fmtNum(lastResultCount) + " result" + (lastResultCount !== 1 ? "s" : "");
                });
        }

        fetchNextPage();
    }

    function csvEscape(val) {
        if (val == null) return '""';
        var s = String(val);
        // CSV injection protection
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        if (s.indexOf('"') !== -1 || s.indexOf(",") !== -1 || s.indexOf("\n") !== -1) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    function downloadCSV(content, filename) {
        var blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    // ─── Clear all ───
    function clearAll() {
        selectedTypes = []; renderTypeChips();
        currentTypeMode = "derived"; setTypeMode("derived");
        workItemIds.length = 0; renderChips(workItemIds, "idChips");
        ancestorIds.length = 0; renderChips(ancestorIds, "ancestorChips");
        attributes.length = 0; renderAttrChips();
        enrichPaths.length = 0; Array.prototype.push.apply(enrichPaths, DEFAULT_ENRICH); renderEnrichChips();
        document.getElementById("typeFilter").value = "";
        document.getElementById("searchTitle").value = "";
        document.getElementById("searchReference").value = "";
        document.getElementById("searchFreeText").value = "";
        document.getElementById("searchExternalRef").value = "";
        document.getElementById("phaseOpen").checked = true;
        document.getElementById("phaseClosed").checked = true;
        document.getElementById("phaseRemoved").checked = false;
        document.getElementById("freeTextWildStart").checked = true;
        document.getElementById("freeTextWildEnd").checked = true;
        document.getElementById("createdFrom").value = "";
        document.getElementById("createdTo").value = "";
        document.getElementById("updatedFrom").value = "";
        document.getElementById("updatedTo").value = "";
        document.getElementById("ancestorMaxDistance").value = "";
        document.getElementById("ancestorIncludeRelated").checked = false;
        document.getElementById("sortField").value = "createdDate";
        document.getElementById("sortDirection").value = "descending";
        document.getElementById("resultsHead").innerHTML = "";
        document.getElementById("resultsBody").innerHTML = '<tr><td class="usd-table__muted">Run a search to see results</td></tr>';
        document.getElementById("resultCount").textContent = "";
        document.getElementById("srchPagination").innerHTML = "";
        document.getElementById("csvBtn").disabled = true;
        currentPage = 1;
        lastResultCount = 0;
    }

    // ─── Presets (server-backed shared file) ───
    var _presets = [];  // local cache, synced with server

    function fetchPresets(callback) {
        fetch("/api/search/presets").then(function (r) { return r.json(); }).then(function (data) {
            _presets = Array.isArray(data) ? data : [];
            if (callback) callback();
        }).catch(function () { _presets = []; if (callback) callback(); });
    }

    function pushPresets(callback) {
        fetch("/api/search/presets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(_presets)
        }).then(function () { if (callback) callback(); }).catch(function () { if (callback) callback(); });
    }

    function renderPresetDropdown() {
        var select = document.getElementById("presetSelect");
        select.innerHTML = '<option value="">-- Select a preset --</option>';
        for (var i = 0; i < _presets.length; i++) {
            var opt = document.createElement("option");
            opt.value = String(i);
            opt.textContent = _presets[i].name;
            select.appendChild(opt);
        }
        document.getElementById("presetLoadBtn").disabled = true;
        document.getElementById("presetDeleteBtn").disabled = true;
    }

    function captureCurrentState() {
        return {
            selectedTypes: selectedTypes.slice(),
            currentTypeMode: currentTypeMode,
            phaseOpen: document.getElementById("phaseOpen").checked,
            phaseClosed: document.getElementById("phaseClosed").checked,
            phaseRemoved: document.getElementById("phaseRemoved").checked,
            searchTitle: document.getElementById("searchTitle").value,
            searchReference: document.getElementById("searchReference").value,
            searchFreeText: document.getElementById("searchFreeText").value,
            freeTextWildStart: document.getElementById("freeTextWildStart").checked,
            freeTextWildEnd: document.getElementById("freeTextWildEnd").checked,
            searchExternalRef: document.getElementById("searchExternalRef").value,
            workItemIds: workItemIds.slice(),
            ancestorIds: ancestorIds.slice(),
            attributes: attributes.slice(),
            ancestorMaxDistance: document.getElementById("ancestorMaxDistance").value,
            ancestorIncludeRelated: document.getElementById("ancestorIncludeRelated").checked,
            createdFrom: document.getElementById("createdFrom").value,
            createdTo: document.getElementById("createdTo").value,
            updatedFrom: document.getElementById("updatedFrom").value,
            updatedTo: document.getElementById("updatedTo").value,
            sortField: document.getElementById("sortField").value,
            sortDirection: document.getElementById("sortDirection").value,
            enrichPaths: enrichPaths.slice()
        };
    }

    function applyState(state) {
        // Types
        selectedTypes = (state.selectedTypes || []).slice();
        currentTypeMode = state.currentTypeMode || "derived";
        setTypeMode(currentTypeMode);
        renderTypeChips();

        // Phase
        document.getElementById("phaseOpen").checked = state.phaseOpen !== false;
        document.getElementById("phaseClosed").checked = state.phaseClosed !== false;
        document.getElementById("phaseRemoved").checked = !!state.phaseRemoved;

        // Text search
        document.getElementById("searchTitle").value = state.searchTitle || "";
        document.getElementById("searchReference").value = state.searchReference || "";
        document.getElementById("searchFreeText").value = state.searchFreeText || "";
        document.getElementById("freeTextWildStart").checked = state.freeTextWildStart !== false;
        document.getElementById("freeTextWildEnd").checked = state.freeTextWildEnd !== false;

        // IDs
        document.getElementById("searchExternalRef").value = state.searchExternalRef || "";
        workItemIds.length = 0;
        Array.prototype.push.apply(workItemIds, state.workItemIds || []);
        renderChips(workItemIds, "idChips");

        // Ancestors
        ancestorIds.length = 0;
        Array.prototype.push.apply(ancestorIds, state.ancestorIds || []);
        renderChips(ancestorIds, "ancestorChips");
        document.getElementById("ancestorMaxDistance").value = state.ancestorMaxDistance || "";
        document.getElementById("ancestorIncludeRelated").checked = !!state.ancestorIncludeRelated;

        // Attributes
        attributes.length = 0;
        Array.prototype.push.apply(attributes, state.attributes || []);
        renderAttrChips();

        // Dates
        document.getElementById("createdFrom").value = state.createdFrom || "";
        document.getElementById("createdTo").value = state.createdTo || "";
        document.getElementById("updatedFrom").value = state.updatedFrom || "";
        document.getElementById("updatedTo").value = state.updatedTo || "";

        // Sort
        document.getElementById("sortField").value = state.sortField || "createdDate";
        document.getElementById("sortDirection").value = state.sortDirection || "descending";

        // Enrich paths
        enrichPaths.length = 0;
        var newPaths = (state.enrichPaths && state.enrichPaths.length) ? state.enrichPaths : DEFAULT_ENRICH;
        Array.prototype.push.apply(enrichPaths, newPaths);
        renderEnrichChips();
    }

    function savePreset() {
        var name = document.getElementById("presetNameInput").value.trim();
        if (!name) return;

        var existingIdx = -1;
        for (var i = 0; i < _presets.length; i++) {
            if (_presets[i].name.toLowerCase() === name.toLowerCase()) { existingIdx = i; break; }
        }

        var entry = { name: name, state: captureCurrentState(), savedAt: new Date().toISOString() };

        if (existingIdx !== -1) {
            _presets[existingIdx] = entry;
        } else {
            _presets.push(entry);
        }

        _presets.sort(function (a, b) { return a.name.localeCompare(b.name); });
        document.getElementById("presetNameInput").value = "";

        pushPresets(function () {
            renderPresetDropdown();
            // Select the just-saved preset
            for (var j = 0; j < _presets.length; j++) {
                if (_presets[j].name === name) {
                    document.getElementById("presetSelect").value = String(j);
                    document.getElementById("presetLoadBtn").disabled = false;
                    document.getElementById("presetDeleteBtn").disabled = false;
                    break;
                }
            }
        });
    }

    function loadPreset() {
        var idx = parseInt(document.getElementById("presetSelect").value, 10);
        if (isNaN(idx) || idx < 0 || idx >= _presets.length) return;
        applyState(_presets[idx].state);
    }

    function deletePreset() {
        var idx = parseInt(document.getElementById("presetSelect").value, 10);
        if (isNaN(idx) || idx < 0 || idx >= _presets.length) return;
        _presets.splice(idx, 1);
        pushPresets(function () { renderPresetDropdown(); });
    }

    // ─── Boot ───
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();