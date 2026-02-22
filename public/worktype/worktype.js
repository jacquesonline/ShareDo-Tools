/**
 * Work Type Visualiser for ShareDo Tools.
 * Displays work type configuration: aspects, phase plan, participant roles, type relationships.
 */
(function () {
    "use strict";

    var esc = shared.esc;

    // ─── State ───
    var _tree = null;           // full tree data
    var _flatTypes = {};        // systemName -> node lookup
    var _selectedType = null;   // currently selected type system name
    var _activeTab = "aspects"; // current tab
    var _cache = {};            // per-type cache: { aspects, phases, roles, rels }

    // ─── Config Search State ───
    var _sidebarMode = "tree";      // "tree" or "search"
    var _idxPollTimer = null;       // polling timer during build
    var _hasSearchResults = false;  // whether search results panel is showing
    var _lastSearchTerm = "";       // for highlight

    // ─── Init ───
    function init() {
        shared.init({ activePage: "worktype" });

        // Tab switching
        var tabBtns = document.querySelectorAll(".wt-tabs__btn");
        for (var i = 0; i < tabBtns.length; i++) {
            tabBtns[i].addEventListener("click", onTabClick);
        }

        // Tree filter
        document.getElementById("treeFilter").addEventListener("input", onTreeFilter);

        // Mode toggle
        var modeBtns = document.querySelectorAll(".wt-mode-toggle__btn");
        for (var i = 0; i < modeBtns.length; i++) {
            modeBtns[i].addEventListener("click", onModeToggle);
        }

        // Config search: index
        document.getElementById("idxBuildBtn").addEventListener("click", onBuildIndex);

        // Config search: form
        document.getElementById("csearchBtn").addEventListener("click", onConfigSearch);
        document.getElementById("csearchAdvToggle").addEventListener("click", onAdvancedToggle);

        // Enter key on all search inputs
        var searchInputs = ["csearchInput", "cfAspect", "cfForm", "cfKeyDate", "cfRole"];
        for (var i = 0; i < searchInputs.length; i++) {
            document.getElementById(searchInputs[i]).addEventListener("keydown", function (e) { if (e.key === "Enter") onConfigSearch(); });
        }

        // Search results delegation
        document.getElementById("srList").addEventListener("click", onSearchResultClick);

        // Back to results
        document.getElementById("backToResults").addEventListener("click", onBackToResults);

        // Load tree
        loadTree();

        // Check index status
        checkIndexStatus();

        // Reload on env change
        shared.onEnvChange(function () {
            _tree = null;
            _flatTypes = {};
            _selectedType = null;
            _cache = {};
            _formCache = {};
            _aspectsData = null;
            _selectedAspect = null;
            _hasSearchResults = false;
            document.getElementById("detailPanel").style.display = "none";
            document.getElementById("searchResultsPanel").style.display = "none";
            document.getElementById("emptyState").style.display = "";
            document.getElementById("backToResults").style.display = "none";
            loadTree();
            // Reset search UI
            stopIdxPoll();
            document.getElementById("csearchInput").value = "";
            document.getElementById("csearchExclude").checked = false;
            document.getElementById("cfAspect").value = "";
            document.getElementById("cfForm").value = "";
            document.getElementById("cfKeyDate").value = "";
            document.getElementById("cfRole").value = "";
            document.getElementById("srList").innerHTML = "";
            checkIndexStatus();
        });

        // Sidebar height (same pattern as search page)
        adjustSidebarHeight();
        window.addEventListener("resize", adjustSidebarHeight);
    }

    function adjustSidebarHeight() {
        var sidebar = document.querySelector(".wt-sidebar");
        if (!sidebar || window.innerWidth <= 900) { sidebar.style.maxHeight = ""; return; }
        var rect = sidebar.getBoundingClientRect();
        sidebar.style.maxHeight = (window.innerHeight - rect.top - 16) + "px";
    }

    // ═══════════════════════════════════════════
    // Tree
    // ═══════════════════════════════════════════

    function loadTree() {
        var container = document.getElementById("treeContainer");
        container.innerHTML = '<div class="wt-tree__loading"><span class="fa fa-spinner fa-spin"></span> Loading tree...</div>';
        document.getElementById("treeCount").textContent = "--";

        shared.apiFetch("/api/worktype/tree").then(function (r) { return r.json(); }).then(function (data) {
            if (data && data.error) {
                container.innerHTML = '<div class="wt-tree__loading usd-clr--red">Failed to load tree: ' + esc(data.message || "Unknown error") + '</div>';
                return;
            }
            _tree = Array.isArray(data) ? data : (data.children || []);
            _flatTypes = {};
            flattenTree(_tree, null);
            var count = Object.keys(_flatTypes).length;
            document.getElementById("treeCount").textContent = count + " types";
            renderTree();
        }).catch(function (err) {
            container.innerHTML = '<div class="wt-tree__loading usd-clr--red">Error: ' + esc(err.message) + '</div>';
        });
    }

    function flattenTree(nodes, parentSystemName) {
        if (!nodes) return;
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var sn = n.systemName || n.name;
            _flatTypes[sn] = {
                systemName: sn,
                name: n.title || n.name || sn,
                icon: n.icon || n.iconClass || "fa-cube",
                isAbstract: !!n.isAbstract,
                isCoreType: !!n.isCoreType,
                hasPortals: !!n.hasPortals,
                tileColour: n.tileColour || null,
                parent: parentSystemName,
                children: n.children || n.derivedTypes || []
            };
            var kids = n.children || n.derivedTypes || [];
            flattenTree(kids, sn);
        }
    }

    function renderTree() {
        var container = document.getElementById("treeContainer");
        var html = buildTreeHtml(_tree, 0);
        container.innerHTML = html;

        // Wire click events via delegation
        container.addEventListener("click", onTreeClick);
    }

    function buildTreeHtml(nodes, depth) {
        if (!nodes || !nodes.length) return "";
        var html = "";
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var sn = n.systemName || n.name;
            var info = _flatTypes[sn] || {};
            var kids = n.children || n.derivedTypes || [];
            var hasKids = kids.length > 0;
            var icon = info.icon || "fa-cube";
            // Ensure icon has fa- prefix
            if (icon.indexOf("fa-") !== 0) icon = "fa-" + icon;

            html += '<div class="wt-tree-node" data-sn="' + esc(sn) + '">';
            html += '<div class="wt-tree-node__row" data-sn="' + esc(sn) + '" style="padding-left:' + (8 + depth * 16) + 'px">';
            html += '<span class="wt-tree-node__toggle ' + (hasKids ? '' : 'wt-tree-node__toggle--leaf') + '"><span class="fa fa-caret-right"></span></span>';
            html += '<span class="wt-tree-node__icon"><span class="fa ' + esc(icon) + '"></span></span>';
            html += '<span class="wt-tree-node__name" title="' + esc(sn) + '">' + esc(info.name || sn) + '</span>';
            if (info.isAbstract) html += '<span class="wt-tree-node__abstract">abstract</span>';
            html += '</div>';
            if (hasKids) {
                html += '<div class="wt-tree-node__children">';
                html += buildTreeHtml(kids, depth + 1);
                html += '</div>';
            }
            html += '</div>';
        }
        return html;
    }

    function onTreeClick(e) {
        var row = e.target.closest(".wt-tree-node__row");
        if (!row) return;
        var sn = row.dataset.sn;
        var node = row.closest(".wt-tree-node");
        var toggle = row.querySelector(".wt-tree-node__toggle");
        var children = node.querySelector(".wt-tree-node__children");

        // Toggle expand/collapse
        if (children) {
            var isOpen = children.classList.contains("wt-tree-node__children--open");
            children.classList.toggle("wt-tree-node__children--open");
            toggle.classList.toggle("wt-tree-node__toggle--expanded");
        }

        // Select type
        selectType(sn);
    }

    function selectType(systemName) {
        if (_selectedType === systemName) return;
        _selectedType = systemName;

        // Update tree selection
        var prev = document.querySelector(".wt-tree-node__row--selected");
        if (prev) prev.classList.remove("wt-tree-node__row--selected");
        var row = document.querySelector('.wt-tree-node__row[data-sn="' + systemName + '"]');
        if (row) row.classList.add("wt-tree-node__row--selected");

        // Show detail panel
        document.getElementById("emptyState").style.display = "none";
        document.getElementById("detailPanel").style.display = "";

        // Update info bar (placeholder until aspects load)
        var info = _flatTypes[systemName];
        updateInfoBar(info, null);

        // Load active tab data
        switchTab(_activeTab);
    }

    function onTreeFilter() {
        var filter = document.getElementById("treeFilter").value.trim().toLowerCase();
        var nodes = document.querySelectorAll(".wt-tree-node");

        if (!filter) {
            // Show all
            for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove("wt-tree-node--hidden");
            return;
        }

        // First pass: determine which nodes match
        var matchSet = {};
        for (var sn in _flatTypes) {
            var t = _flatTypes[sn];
            if ((t.name || "").toLowerCase().indexOf(filter) !== -1 || sn.toLowerCase().indexOf(filter) !== -1) {
                matchSet[sn] = true;
                // Also mark all ancestors as visible
                var p = t.parent;
                while (p) { matchSet[p] = true; p = _flatTypes[p] ? _flatTypes[p].parent : null; }
            }
        }

        // Second pass: show/hide and auto-expand matching
        for (var i = 0; i < nodes.length; i++) {
            var nodeSn = nodes[i].dataset.sn;
            if (matchSet[nodeSn]) {
                nodes[i].classList.remove("wt-tree-node--hidden");
                // Auto-expand if it has matched children
                var ch = nodes[i].querySelector(".wt-tree-node__children");
                var tog = nodes[i].querySelector(".wt-tree-node__toggle");
                if (ch) { ch.classList.add("wt-tree-node__children--open"); if (tog) tog.classList.add("wt-tree-node__toggle--expanded"); }
            } else {
                nodes[i].classList.add("wt-tree-node--hidden");
            }
        }
    }

    // ═══════════════════════════════════════════
    // Info bar
    // ═══════════════════════════════════════════

    function updateInfoBar(treeInfo, aspectData) {
        var name = (aspectData && aspectData.sharedoTypeName) || (treeInfo && treeInfo.name) || _selectedType;
        var icon = (aspectData && aspectData.sharedoTypeIcon) || (treeInfo && treeInfo.icon) || "fa-cube";
        var colour = (treeInfo && treeInfo.tileColour) || (aspectData && aspectData.sharedoTypeColour) || cssVar("--text-muted");
        if (icon.indexOf("fa-") !== 0) icon = "fa-" + icon;

        document.getElementById("infoName").textContent = name;
        document.getElementById("infoSysName").textContent = _selectedType;

        var iconEl = document.getElementById("infoIcon");
        iconEl.innerHTML = '<span class="fa ' + esc(icon) + '"></span>';
        iconEl.style.background = colour;

        // Badges -- sourced from tree data (isCoreType, isAbstract, hasPortals all on tree nodes)
        var badges = "";
        if (treeInfo) {
            if (treeInfo.isAbstract) badges += '<span class="wt-info__badge wt-info__badge--abstract">Abstract</span>';
            if (treeInfo.isCoreType) badges += '<span class="wt-info__badge wt-info__badge--core">Core</span>';
            if (treeInfo.hasPortals) badges += '<span class="wt-info__badge wt-info__badge--portals">Has Portals</span>';
        }
        // hasDerivedTypes from aspect response (only available after aspects load)
        if (aspectData && aspectData.hasDerivedTypes) badges += '<span class="wt-info__badge wt-info__badge--has-derived">Has derived types</span>';

        document.getElementById("infoBadges").innerHTML = badges;

        // Link to ShareDo modeller
        var link = document.getElementById("infoLink");
        var host = document.getElementById("hostLabel").textContent;
        if (host && host !== "--") {
            link.href = "https://" + host + "/modeller/work-types/" + encodeURIComponent(_selectedType);
            link.style.display = "";
        } else {
            link.style.display = "none";
        }
    }

    // ═══════════════════════════════════════════
    // Tabs
    // ═══════════════════════════════════════════

    function onTabClick(e) {
        var tab = e.currentTarget.dataset.tab;
        switchTab(tab);
    }

    function switchTab(tab) {
        _activeTab = tab;

        // Update tab buttons
        var btns = document.querySelectorAll(".wt-tabs__btn");
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle("wt-tabs__btn--active", btns[i].dataset.tab === tab);
        }

        // Show/hide tab panels
        var tabs = ["aspects", "phases", "roles", "keydates", "relationships", "compare"];
        var tabIds = { aspects: "tabAspects", phases: "tabPhases", roles: "tabRoles", keydates: "tabKeydates", relationships: "tabRelationships", compare: "tabCompare" };
        for (var i = 0; i < tabs.length; i++) {
            document.getElementById(tabIds[tabs[i]]).style.display = tabs[i] === tab ? "" : "none";
        }

        // Load data if needed
        if (!_selectedType) return;
        var c = getCache(_selectedType);

        if (tab === "aspects" && !c.aspects) loadAspects();
        else if (tab === "aspects" && c.aspects) renderAspects(c.aspects);

        if (tab === "phases" && !c.phases) loadPhases();
        else if (tab === "phases" && c.phases) renderPhases(c.phases);

        if (tab === "roles" && !c.roles) loadRoles();
        else if (tab === "roles" && c.roles) renderRoles(c.roles);

        if (tab === "keydates" && !c.keydates) loadKeyDates();
        else if (tab === "keydates" && c.keydates) renderKeyDates(c.keydates);

        if (tab === "relationships" && !c.rels) loadRelationships();
        else if (tab === "relationships" && c.rels) renderRelationships(c.rels);

        if (tab === "compare") initCompareTab();
    }

    function getCache(sn) {
        if (!_cache[sn]) _cache[sn] = {};
        return _cache[sn];
    }

    // ═══════════════════════════════════════════
    // Aspects
    // ═══════════════════════════════════════════

    var _aspectsData = null;    // current aspects response for selected type
    var _selectedAspect = null; // { zone, index } of selected aspect
    var _formCache = {};        // formId -> form response

    var FORM_FIELD_TYPES = {
        0: "Text", 1: "Integer", 2: "Date", 3: "DateTime", 4: "Option Set",
        5: "API Picker", 6: "Currency", 7: "Label", 9: "Boolean/Checkbox",
        10: "Participant Picker", 11: "Percentage", 12: "Memo", 13: "Toggle",
        14: "Header", 15: "Tree Selection", 16: "Decimal", 17: "Unit of Measure",
        18: "Icon Picker", 19: "ODS Entity Picker"
    };

    function loadAspects() {
        showLoading("aspects");
        _aspectsData = null;
        _selectedAspect = null;
        shared.apiFetch("/api/worktype/aspects/" + encodeURIComponent(_selectedType))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.error) { showError("aspects", data.message || "Failed to load aspects. Admin cookie may be required."); return; }
                getCache(_selectedType).aspects = data;
                _aspectsData = data;
                updateInfoBar(_flatTypes[_selectedType], data);
                renderAspects(data);
            })
            .catch(function (err) { showError("aspects", err.message); });
    }

    function renderAspects(data) {
        hideLoading("aspects");
        _aspectsData = data;
        _selectedAspect = null;
        var container = document.getElementById("aspectsContainer");
        container.style.display = "";

        // Normalise zone keys -- the API returns "preHeader" for some types and "pre-header" for others
        var rawAspects = data.aspects || {};
        var aspects = {};
        for (var key in rawAspects) {
            var normalised = key.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
            aspects[normalised] = rawAspects[key];
        }
        // Store normalised back so detail click lookups work
        data._normalisedAspects = aspects;

        var zones = ["preHeader", "header", "top", "main", "bottom", "footer"];
        var zoneLabels = { preHeader: "Pre-Header", header: "Header", top: "Top", main: "Main", bottom: "Bottom", footer: "Footer" };

        // Render list
        var listHtml = "";
        for (var z = 0; z < zones.length; z++) {
            var zoneName = zones[z];
            var items = aspects[zoneName] || [];
            items.sort(function (a, b) { return (b.displayPriority || 0) - (a.displayPriority || 0); });

            listHtml += '<div class="wt-aspect-zone" data-zone="' + zoneName + '">';
            listHtml += '<div class="wt-aspect-zone__header" data-zone-toggle="' + zoneName + '">';
            listHtml += '<span class="fa fa-caret-down wt-aspect-zone__chevron"></span>';
            listHtml += esc(zoneLabels[zoneName] || zoneName);
            listHtml += '<span class="wt-aspect-zone__count">' + items.length + '</span>';
            listHtml += '</div>';
            listHtml += '<div class="wt-aspect-zone__items">';

            for (var a = 0; a < items.length; a++) {
                var asp = items[a];
                var rowClasses = "wt-aspect-row";
                if (asp.inherited) rowClasses += " wt-aspect-row--inherited";
                if (asp.alwaysHide) rowClasses += " wt-aspect-row--hidden";

                var displayName = asp.displayName || asp.aspectDefinitionSystemName;
                var configTitle = extractConfigTitle(asp.config);
                if (configTitle && asp.aspectDefinitionSystemName === "FormBuilder") {
                    displayName = configTitle;
                }

                listHtml += '<div class="' + rowClasses + '" data-zone="' + zoneName + '" data-idx="' + a + '">';
                listHtml += '<span class="wt-aspect-row__name" title="' + esc(asp.aspectDefinitionSystemName) + '">' + esc(displayName) + '</span>';
                listHtml += '<span class="wt-aspect-row__dots">';
                if (asp.inherited) listHtml += '<span class="wt-aspect-row__dot wt-aspect-row__dot--inherited" title="Inherited"></span>';
                if (asp.alwaysHide) listHtml += '<span class="wt-aspect-row__dot wt-aspect-row__dot--hidden" title="Always hidden"></span>';
                if (asp.ruleSetSelection) listHtml += '<span class="wt-aspect-row__dot wt-aspect-row__dot--rules" title="Display rules"></span>';
                if (asp.aspectDefinitionSystemName === "FormBuilder") listHtml += '<span class="wt-aspect-row__dot wt-aspect-row__dot--form" title="Form Builder"></span>';
                listHtml += '</span>';
                listHtml += '</div>';
            }

            listHtml += '</div></div>';
        }

        var listEl = document.getElementById("aspectsList");
        listEl.innerHTML = listHtml;

        // Reset detail
        document.getElementById("aspectsDetail").innerHTML = '<div class="wt-aspects-detail__empty"><span class="fa fa-mouse-pointer"></span><span>Click an aspect to view details</span></div>';

        // Wire events via delegation
        listEl.removeEventListener("click", onAspectListClick);
        listEl.addEventListener("click", onAspectListClick);
    }

    function onAspectListClick(e) {
        // Zone collapse toggle
        var zoneHeader = e.target.closest("[data-zone-toggle]");
        if (zoneHeader) {
            var zone = zoneHeader.closest(".wt-aspect-zone");
            if (zone) zone.classList.toggle("wt-aspect-zone--collapsed");
            return;
        }

        // Aspect row click
        var row = e.target.closest(".wt-aspect-row");
        if (!row || !_aspectsData) return;

        var zoneName = row.dataset.zone;
        var idx = parseInt(row.dataset.idx, 10);
        _selectedAspect = { zone: zoneName, index: idx };

        // Update selection highlight
        var prev = document.querySelector(".wt-aspect-row--selected");
        if (prev) prev.classList.remove("wt-aspect-row--selected");
        row.classList.add("wt-aspect-row--selected");

        // Get the aspect data (use normalised keys)
        var aspects = _aspectsData._normalisedAspects || _aspectsData.aspects || {};
        var items = aspects[zoneName] || [];
        items.sort(function (a, b) { return (b.displayPriority || 0) - (a.displayPriority || 0); });
        var asp = items[idx];
        if (!asp) return;

        renderAspectDetail(asp);
    }

    function renderAspectDetail(asp) {
        var el = document.getElementById("aspectsDetail");

        var displayName = asp.displayName || asp.aspectDefinitionSystemName;
        var configTitle = extractConfigTitle(asp.config);
        if (configTitle && asp.aspectDefinitionSystemName === "FormBuilder") {
            displayName = configTitle;
        }

        var html = '<div class="wt-adet-header">';
        html += '<div class="wt-adet-title">' + esc(displayName) + '</div>';
        html += '<div class="wt-adet-subtitle">' + esc(asp.aspectDefinitionSystemName) + '</div>';
        if (asp.description) html += '<div class="wt-adet-desc">' + esc(asp.description) + '</div>';
        html += '</div>';

        // Tags
        html += '<div class="wt-adet-tags">';
        if (asp.inherited && asp.inheritedFrom) html += '<span class="wt-adet-tag wt-adet-tag--inherited">Inherited from ' + esc(asp.inheritedFrom) + '</span>';
        if (asp.alwaysHide) html += '<span class="wt-adet-tag wt-adet-tag--hidden">Always hidden</span>';
        if (asp.ruleSetSelection) html += '<span class="wt-adet-tag wt-adet-tag--rules">Display rules</span>';
        if (asp.aspectDefinitionSystemName === "FormBuilder") html += '<span class="wt-adet-tag wt-adet-tag--form">Form Builder</span>';
        if (asp.updatePermissionSystemName) html += '<span class="wt-adet-tag wt-adet-tag--perm">Edit: ' + esc(asp.updatePermissionSystemName) + '</span>';
        html += '</div>';

        // Properties table
        html += '<div class="wt-adet-section"><div class="wt-adet-section__title">Properties</div>';
        html += '<table class="wt-adet-props">';
        html += '<tr><td>Zone</td><td>' + esc(asp.zoneName) + '</td></tr>';
        html += '<tr><td>Display Priority</td><td>' + (asp.displayPriority != null ? asp.displayPriority : "--") + '</td></tr>';
        html += '<tr><td>Widget ID</td><td>' + esc(asp.widgetId || "--") + '</td></tr>';
        if (asp.widgetChrome) html += '<tr><td>Widget Chrome</td><td>Yes' + (asp.widgetTitle ? ' ("' + esc(asp.widgetTitle) + '")' : '') + '</td></tr>';
        if (asp.widgetStartsCollapsed) html += '<tr><td>Starts Collapsed</td><td>Yes</td></tr>';
        html += '<tr><td>Allow Multiple</td><td>' + (asp.allowMultiple ? "Yes" : "No") + '</td></tr>';
        html += '<tr><td>Read Only</td><td>' + (asp.readOnly ? "Yes" : "No") + '</td></tr>';
        html += '<tr><td>Aspect ID</td><td>' + esc(asp.id || "--") + '</td></tr>';
        html += '</table></div>';

        // Display rules section
        if (asp.ruleSetSelection) {
            html += '<div class="wt-adet-section"><div class="wt-adet-section__title">Display Rules</div>';
            html += '<div class="wt-adet-rules">';
            html += '<div class="wt-adet-rules__op">Operator: ' + esc(asp.ruleSetSelection.operator || "and") + '</div>';
            var ruleNames = asp.ruleSetSelection.ruleSetSystemNames || [];
            for (var r = 0; r < ruleNames.length; r++) {
                html += '<div class="wt-adet-rules__name">' + esc(ruleNames[r]) + '</div>';
            }
            if (!ruleNames.length) html += '<div class="usd-clr--muted" style="font-size:11px">No rule names specified</div>';
            html += '</div></div>';
        }

        // FormBuilder: show config + form fields (loaded on demand)
        if (asp.aspectDefinitionSystemName === "FormBuilder" && asp.config) {
            var formId = extractFormId(asp.config);
            if (formId) {
                html += '<div class="wt-adet-section"><div class="wt-adet-section__title">Form Fields</div>';
                html += '<div id="formFieldsContainer" data-form-id="' + esc(formId) + '">';
                html += '<div class="wt-form-loading"><span class="fa fa-spinner fa-spin"></span> Loading form...</div>';
                html += '</div></div>';
            }

            // Show raw config
            html += '<div class="wt-adet-section"><div class="wt-adet-section__title">Aspect Config</div>';
            var prettyConfig = "--";
            try { prettyConfig = JSON.stringify(JSON.parse(asp.config), null, 2); } catch (e) { prettyConfig = asp.config; }
            html += '<div class="wt-adet-config">' + esc(prettyConfig) + '</div>';
            html += '</div>';
        } else if (asp.config) {
            // Non-FormBuilder with config
            html += '<div class="wt-adet-section"><div class="wt-adet-section__title">Aspect Config</div>';
            var prettyConfig2 = "--";
            try { prettyConfig2 = JSON.stringify(JSON.parse(asp.config), null, 2); } catch (e) { prettyConfig2 = asp.config; }
            html += '<div class="wt-adet-config">' + esc(prettyConfig2) + '</div>';
            html += '</div>';
        }

        el.innerHTML = html;

        // If FormBuilder, fetch form fields
        if (asp.aspectDefinitionSystemName === "FormBuilder" && asp.config) {
            var fId = extractFormId(asp.config);
            if (fId) loadFormDetail(fId);
        }
    }

    // ─── Form detail loading ───

    function loadFormDetail(formId) {
        // Check cache first
        if (_formCache[formId]) {
            renderFormFields(formId, _formCache[formId]);
            return;
        }

        shared.apiFetch("/api/worktype/form/" + encodeURIComponent(formId))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.error) {
                    var container = document.getElementById("formFieldsContainer");
                    if (container && container.dataset.formId === formId) {
                        container.innerHTML = '<div class="usd-clr--red" style="font-size:11px">' + esc(data.message || "Failed to load form") + '</div>';
                    }
                    return;
                }
                _formCache[formId] = data;
                renderFormFields(formId, data);
            })
            .catch(function (err) {
                var container = document.getElementById("formFieldsContainer");
                if (container && container.dataset.formId === formId) {
                    container.innerHTML = '<div class="usd-clr--red" style="font-size:11px">' + esc(err.message) + '</div>';
                }
            });
    }

    function renderFormFields(formId, data) {
        var container = document.getElementById("formFieldsContainer");
        if (!container || container.dataset.formId !== formId) return; // stale

        var fields = data.fields || [];
        if (!fields.length) {
            container.innerHTML = '<div class="usd-clr--muted" style="font-size:11px">No fields in this form</div>';
            return;
        }

        var html = '<table class="wt-form-table">';
        html += '<thead><tr><th>Title</th><th>System Name</th><th>Type</th><th>Required</th><th>Attributes</th></tr></thead>';
        html += '<tbody>';

        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            var typeName = FORM_FIELD_TYPES[f.type] != null ? FORM_FIELD_TYPES[f.type] : "Unknown (" + f.type + ")";
            var uid = "form-attr-" + formId.substring(0, 8) + "-" + i;

            html += '<tr>';
            html += '<td>' + esc(f.title || "--") + '<span class="wt-form-field-sn">' + esc(f.id || "") + '</span></td>';
            html += '<td><span class="wt-form-field-sn">' + esc(f.name || "--") + '</span></td>';
            html += '<td><span class="wt-form-type">' + esc(typeName) + '</span></td>';
            html += '<td><span class="' + (f.required ? 'wt-form-required--yes' : 'wt-form-required--no') + '">' + (f.required ? "Yes" : "No") + '</span></td>';
            html += '<td>';
            if (f.attributes && Object.keys(f.attributes).length) {
                html += '<button class="wt-form-attrs-toggle" data-target="' + uid + '">Show</button>';
                html += '<div class="wt-form-attrs" id="' + uid + '">' + esc(JSON.stringify(f.attributes, null, 2)) + '</div>';
            } else {
                html += '<span class="usd-clr--muted">--</span>';
            }
            html += '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';
        container.innerHTML = html;

        // Wire attribute toggles
        container.addEventListener("click", function (e) {
            var toggle = e.target.closest(".wt-form-attrs-toggle");
            if (!toggle) return;
            var target = document.getElementById(toggle.dataset.target);
            if (target) {
                var isOpen = target.classList.toggle("wt-form-attrs--open");
                toggle.textContent = isOpen ? "Hide" : "Show";
            }
        });
    }

    function extractConfigTitle(configStr) {
        if (!configStr) return null;
        try { var c = JSON.parse(configStr); return c.title || null; } catch (e) { return null; }
    }

    function extractFormId(configStr) {
        if (!configStr) return null;
        try { var c = JSON.parse(configStr); return c.formId || null; } catch (e) { return null; }
    }

    // ═══════════════════════════════════════════
    // Phase Plan
    // ═══════════════════════════════════════════

    function loadPhases() {
        showLoading("phases");
        shared.apiFetch("/api/worktype/phaseplan/" + encodeURIComponent(_selectedType))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.error) { showError("phases", data.message || "Failed to load phase plan. Admin cookie may be required."); return; }
                getCache(_selectedType).phases = data;
                renderPhases(data);
            })
            .catch(function (err) { showError("phases", err.message); });
    }

    function renderPhases(data) {
        hideLoading("phases");
        var container = document.getElementById("phasesContainer");
        container.style.display = "";
        document.getElementById("phaseDetail").style.display = "none";

        var phases = data.phases || [];
        var transitions = data.transitions || [];

        if (!phases.length) {
            container.innerHTML = '<div class="wt-aspect-zone__empty">No phase plan configured</div>';
            return;
        }

        // Build adjacency and layers via BFS from start phase
        var phaseMap = {};
        for (var i = 0; i < phases.length; i++) phaseMap[phases[i].systemName] = phases[i];

        var adj = {};
        for (var i = 0; i < transitions.length; i++) {
            var t = transitions[i];
            if (!adj[t.fromPhaseSystemName]) adj[t.fromPhaseSystemName] = [];
            adj[t.fromPhaseSystemName].push(t);
        }

        // Find start phase
        var startSn = null;
        for (var i = 0; i < phases.length; i++) {
            if (phases[i].isStart) { startSn = phases[i].systemName; break; }
        }
        if (!startSn && phases.length) startSn = phases[0].systemName;

        // BFS to assign layers
        var layers = {};
        var visited = {};
        var queue = [{ sn: startSn, layer: 0 }];
        visited[startSn] = true;
        layers[startSn] = 0;
        var maxLayer = 0;

        while (queue.length) {
            var cur = queue.shift();
            var curAdj = adj[cur.sn] || [];
            for (var j = 0; j < curAdj.length; j++) {
                var toSn = curAdj[j].toPhaseSystemName;
                if (!visited[toSn]) {
                    visited[toSn] = true;
                    var nl = cur.layer + 1;
                    layers[toSn] = nl;
                    if (nl > maxLayer) maxLayer = nl;
                    queue.push({ sn: toSn, layer: nl });
                }
            }
        }

        // Place unvisited phases in last layer + 1
        for (var i = 0; i < phases.length; i++) {
            if (layers[phases[i].systemName] == null) {
                layers[phases[i].systemName] = maxLayer + 1;
            }
        }
        var totalLayers = maxLayer + 2;

        // Group phases by layer
        var layerGroups = {};
        for (var sn in layers) {
            var l = layers[sn];
            if (!layerGroups[l]) layerGroups[l] = [];
            layerGroups[l].push(sn);
        }

        // SVG layout constants
        var nodeW = 140, nodeH = 50, hGap = 60, vGap = 40;
        var padX = 40, padY = 40;
        var backwardArcExtra = 50; // extra space below for backward transition arcs

        // Calculate max nodes per layer for height
        var maxPerLayer = 0;
        for (var l in layerGroups) {
            if (layerGroups[l].length > maxPerLayer) maxPerLayer = layerGroups[l].length;
        }

        // Determine actual layer indices used
        var usedLayers = Object.keys(layerGroups).map(Number).sort(function (a, b) { return a - b; });

        // Check if any backward transitions exist
        var hasBackward = false;
        for (var i = 0; i < transitions.length; i++) {
            var fromPos = positions || {};
            // Simplified check: if toPhase layer <= fromPhase layer
            var fromLayer = layers[transitions[i].fromPhaseSystemName];
            var toLayer = layers[transitions[i].toPhaseSystemName];
            if (toLayer != null && fromLayer != null && toLayer <= fromLayer) { hasBackward = true; break; }
        }

        var svgW = padX * 2 + usedLayers.length * (nodeW + hGap) - hGap;
        var svgH = padY * 2 + maxPerLayer * (nodeH + vGap) - vGap + (hasBackward ? backwardArcExtra : 0);

        // Compute positions
        var positions = {};
        for (var li = 0; li < usedLayers.length; li++) {
            var layerIdx = usedLayers[li];
            var group = layerGroups[layerIdx];
            var totalH = group.length * nodeH + (group.length - 1) * vGap;
            var startY = padY + (svgH - padY * 2 - totalH) / 2;

            for (var gi = 0; gi < group.length; gi++) {
                positions[group[gi]] = {
                    x: padX + li * (nodeW + hGap),
                    y: startY + gi * (nodeH + vGap)
                };
            }
        }

        // Build SVG
        var svg = '<svg class="wt-phase-svg" width="' + svgW + '" height="' + svgH + '" viewBox="0 0 ' + svgW + ' ' + svgH + '" xmlns="http://www.w3.org/2000/svg">';

        // Defs for arrowheads
        svg += '<defs>';
        svg += '<marker id="arrow-opt" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="var(--accent-blue)"/></marker>';
        svg += '<marker id="arrow-std" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="var(--text-muted)"/></marker>';
        svg += '</defs>';

        // Draw transitions (edges)
        for (var i = 0; i < transitions.length; i++) {
            var tr = transitions[i];
            var from = positions[tr.fromPhaseSystemName];
            var to = positions[tr.toPhaseSystemName];
            if (!from || !to) continue;

            var x1 = from.x + nodeW;
            var y1 = from.y + nodeH / 2;
            var x2 = to.x;
            var y2 = to.y + nodeH / 2;

            // Handle backward transitions (left-pointing)
            var isBackward = to.x <= from.x;
            if (isBackward) {
                x1 = from.x + nodeW / 2;
                y1 = from.y + nodeH;
                x2 = to.x + nodeW / 2;
                y2 = to.y + nodeH;
            }

            var isOpt = tr.isOptimumPath;
            var strokeColor = isOpt ? "var(--accent-blue)" : "var(--text-muted)";
            var strokeW = isOpt ? "2.5" : "1.5";
            var dash = tr.isUserDriven ? "" : ' stroke-dasharray="5,3"';
            var marker = isOpt ? "url(#arrow-opt)" : "url(#arrow-std)";
            var opacity = isOpt ? "1" : "0.5";

            if (isBackward) {
                // Arc below
                var midY = Math.max(y1, y2) + 30;
                svg += '<path d="M' + x1 + ',' + y1 + ' C' + x1 + ',' + midY + ' ' + x2 + ',' + midY + ' ' + x2 + ',' + y2 + '"';
            } else {
                // Bezier curve
                var cpx = (x1 + x2) / 2;
                svg += '<path d="M' + x1 + ',' + y1 + ' C' + cpx + ',' + y1 + ' ' + cpx + ',' + y2 + ' ' + x2 + ',' + y2 + '"';
            }
            svg += ' fill="none" stroke="' + strokeColor + '" stroke-width="' + strokeW + '"' + dash + ' marker-end="' + marker + '" opacity="' + opacity + '"';
            svg += ' data-tr-idx="' + i + '" class="wt-phase-edge" style="cursor:pointer"/>';

            // Transition label
            var labelX = (x1 + x2) / 2;
            var labelY = isBackward ? Math.max(y1, y2) + 34 : (y1 + y2) / 2 - 6;
            svg += '<text x="' + labelX + '" y="' + labelY + '" text-anchor="middle" font-size="9" fill="' + strokeColor + '" opacity="' + opacity + '" style="pointer-events:none">' + esc(tr.name || "") + '</text>';
        }

        // Draw phases (nodes)
        for (var i = 0; i < phases.length; i++) {
            var ph = phases[i];
            var pos = positions[ph.systemName];
            if (!pos) continue;

            var fill = getPhaseColour(ph);
            var textFill = "#fff";
            var iconClass = ph.iconClass || "fa-circle";
            if (iconClass.indexOf("fa-") !== 0) iconClass = "fa-" + iconClass;

            svg += '<g data-phase-sn="' + esc(ph.systemName) + '" class="wt-phase-node" style="cursor:pointer">';
            svg += '<rect x="' + pos.x + '" y="' + pos.y + '" width="' + nodeW + '" height="' + nodeH + '" rx="6" fill="' + fill + '" stroke="' + fill + '" stroke-width="1"/>';
            // Phase name
            svg += '<text x="' + (pos.x + nodeW / 2) + '" y="' + (pos.y + nodeH / 2 - 2) + '" text-anchor="middle" font-size="11" font-weight="600" fill="' + textFill + '">' + esc(ph.name || ph.shortName || ph.systemName) + '</text>';
            // Phase short name / system name
            svg += '<text x="' + (pos.x + nodeW / 2) + '" y="' + (pos.y + nodeH / 2 + 12) + '" text-anchor="middle" font-size="8" fill="' + textFill + '" opacity="0.7">' + esc(ph.systemName) + '</text>';
            svg += '</g>';
        }

        svg += '</svg>';

        // Build phase summary table beneath the diagram
        var tableHtml = '<div class="wt-phase-summary">';
        tableHtml += '<div class="wt-phase-summary__title">' + esc(data.name || "Phase Plan") + ' <span class="wt-phase-summary__count">' + phases.length + ' phases, ' + transitions.length + ' transitions</span></div>';
        tableHtml += '<table class="wt-phase-summary__table">';
        tableHtml += '<thead><tr><th>Phase</th><th>Type</th><th>Transitions Out</th></tr></thead>';
        tableHtml += '<tbody>';

        for (var pi = 0; pi < phases.length; pi++) {
            var ph = phases[pi];
            var phType = getPhaseTypeLabel(ph);
            var phColour = getPhaseColour(ph);

            // Find outbound transitions for this phase
            var outbound = [];
            for (var ti = 0; ti < transitions.length; ti++) {
                if (transitions[ti].fromPhaseSystemName === ph.systemName) {
                    outbound.push(transitions[ti]);
                }
            }
            // Sort: optimum path first
            outbound.sort(function (a, b) { return (b.isOptimumPath ? 1 : 0) - (a.isOptimumPath ? 1 : 0); });

            tableHtml += '<tr>';
            // Phase name with colour indicator
            tableHtml += '<td><span class="wt-phase-summary__phase" style="border-left:3px solid ' + phColour + ';padding-left:8px">';
            tableHtml += '<strong>' + esc(ph.name) + '</strong>';
            if (ph.isStart) tableHtml += ' <span class="wt-phase-summary__start">(start)</span>';
            tableHtml += '<span class="wt-phase-summary__sn">' + esc(ph.systemName) + '</span>';
            tableHtml += '</span></td>';
            // Type
            tableHtml += '<td><span class="wt-phase-summary__type-pill" style="background:' + phColour + '">' + esc(phType) + '</span></td>';
            // Transitions out
            tableHtml += '<td>';
            if (outbound.length) {
                tableHtml += '<div class="wt-phase-summary__transitions">';
                for (var oi = 0; oi < outbound.length; oi++) {
                    var tr = outbound[oi];
                    var targetPhase = phaseMap[tr.toPhaseSystemName];
                    var targetColour = targetPhase ? getPhaseColour(targetPhase) : cssVar("--text-muted");
                    var targetName = targetPhase ? (targetPhase.name || tr.toPhaseSystemName) : tr.toPhaseSystemName;
                    var isOpt = tr.isOptimumPath;

                    tableHtml += '<span class="wt-phase-summary__tr-item">';
                    tableHtml += '<span class="wt-phase-summary__tr-name' + (isOpt ? ' wt-phase-summary__tr-name--opt' : '') + '">' + esc(tr.name) + '</span>';
                    tableHtml += '<span class="wt-phase-summary__tr-arrow' + (isOpt ? ' wt-phase-summary__tr-arrow--opt' : '') + '">-></span>';
                    tableHtml += '<span class="wt-phase-summary__tr-target" style="background:' + targetColour + '">' + esc(targetName) + '</span>';
                    tableHtml += '</span>';
                }
                tableHtml += '</div>';
            } else {
                tableHtml += '<span class="wt-phase-summary__none">No outbound transitions</span>';
            }
            tableHtml += '</td>';
            tableHtml += '</tr>';
        }

        tableHtml += '</tbody></table></div>';

        container.innerHTML = svg + tableHtml;

        // Wire click events on nodes
        var svgEl = container.querySelector("svg");
        svgEl.addEventListener("click", function (e) {
            var node = e.target.closest(".wt-phase-node");
            var edge = e.target.closest(".wt-phase-edge");
            if (node) {
                var sn = node.dataset.phaseSn;
                showPhaseDetail(phaseMap[sn], null);
            } else if (edge) {
                var idx = parseInt(edge.dataset.trIdx, 10);
                if (transitions[idx]) showPhaseDetail(null, transitions[idx]);
            }
        });
    }

    function getPhaseTypeLabel(ph) {
        if (ph.isStart) return "Start";
        if (ph.isSystemClosedPhase) return "System Closed";
        if (ph.isOpen) return "Open";
        return "Closed";
    }

    function getPhaseColour(ph) {
        if (ph.isStart) return cssVar("--phase-start");
        if (ph.isSystemClosedPhase) return cssVar("--phase-closed");
        if (ph.isOpen) return cssVar("--phase-open");
        return cssVar("--phase-default");
    }

    function cssVar(name) {
        return getComputedStyle(document.body).getPropertyValue(name).trim();
    }

    function showPhaseDetail(phase, transition) {
        var el = document.getElementById("phaseDetail");
        el.style.display = "";
        var html = "";

        if (phase) {
            html += '<div class="wt-phase-detail__title"><span class="fa ' + esc(phase.iconClass || "fa-circle") + '"></span> ' + esc(phase.name) + '</div>';
            html += row("System Name", phase.systemName);
            html += row("Description", phase.description || "--");
            html += row("Short Name", phase.shortName || "--");
            html += row("Is Start", phase.isStart ? "Yes" : "No");
            html += row("Is Open", phase.isOpen ? "Yes" : "No");
            html += row("Is Removed", phase.isRemoved ? "Yes" : "No");
            html += row("System Closed", phase.isSystemClosedPhase ? "Yes" : "No");
            html += row("Is Reportable", phase.isReportable ? "Yes" : "No");
            if (phase.expectedDurationSeconds) html += row("Expected Duration", formatDuration(phase.expectedDurationSeconds));
        } else if (transition) {
            html += '<div class="wt-phase-detail__title"><span class="fa fa-arrow-right"></span> Transition: ' + esc(transition.name) + '</div>';
            html += row("System Name", transition.systemName);
            html += row("From", transition.fromPhaseSystemName);
            html += row("To", transition.toPhaseSystemName);
            html += row("Optimum Path", transition.isOptimumPath ? "Yes" : "No");
            html += row("User Driven", transition.isUserDriven ? "Yes" : "No");
            html += row("Close UI", transition.closeUI ? "Yes" : "No");
            html += row("Reason Mandatory", transition.reasonIsMandatory ? "Yes" : "No");
            if (transition.reasonOptionSetName) html += row("Reason Option Set", transition.reasonOptionSetName);
        }

        el.innerHTML = html;
    }

    function row(label, value) {
        return '<div class="wt-phase-detail__row"><span class="wt-phase-detail__label">' + esc(label) + '</span><span class="wt-phase-detail__value">' + esc(value) + '</span></div>';
    }

    function formatDuration(seconds) {
        if (!seconds) return "--";
        var d = Math.floor(seconds / 86400);
        var h = Math.floor((seconds % 86400) / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var parts = [];
        if (d) parts.push(d + "d");
        if (h) parts.push(h + "h");
        if (m) parts.push(m + "m");
        return parts.length ? parts.join(" ") : seconds + "s";
    }

    // ═══════════════════════════════════════════
    // Roles
    // ═══════════════════════════════════════════

    function loadRoles() {
        showLoading("roles");
        shared.apiFetch("/api/worktype/roles/" + encodeURIComponent(_selectedType), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rowsPerPage: 100, page: 1 })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.error) { showError("roles", data.message || "Failed to load roles. Admin cookie may be required."); return; }
                getCache(_selectedType).roles = data;
                renderRoles(data);
            })
            .catch(function (err) { showError("roles", err.message); });
    }

    function renderRoles(data) {
        hideLoading("roles");
        var container = document.getElementById("rolesContainer");
        container.style.display = "";

        var rows = (data && data.rows) || [];
        if (!rows.length) {
            container.innerHTML = '<div class="wt-aspect-zone__empty">No participant roles configured</div>';
            return;
        }

        var html = '<div class="wt-roles-count">' + rows.length + ' roles</div>';
        html += '<table class="wt-roles-table">';
        html += '<thead><tr><th>System Name</th><th>Name</th><th>Source</th><th>Active</th><th>Permissions</th></tr></thead>';
        html += '<tbody>';

        for (var i = 0; i < rows.length; i++) {
            var d = rows[i].data || {};
            html += '<tr>';
            html += '<td><span class="wt-role-sysname">' + esc(d.systemName || "--") + '</span></td>';
            html += '<td>' + esc(d.name || "--") + '</td>';
            html += '<td><span class="wt-role-source">' + esc(d.roleSource || "--") + '</span></td>';
            html += '<td><span class="wt-role-active ' + (d.isActive ? 'wt-role-active--yes' : 'wt-role-active--no') + '">' + (d.isActive ? "Yes" : "No") + '</span></td>';
            html += '<td><div class="wt-perm-pills">';

            var perms = d.permissions || [];
            for (var p = 0; p < perms.length; p++) {
                var pillClass = "wt-perm-pill--granted";
                // labelCss from ShareDo: label-success = granted, label-warning = user only, label-default = by phase
                if (perms[p].labelCss && perms[p].labelCss.indexOf("warning") !== -1) pillClass = "wt-perm-pill--partial";
                else if (perms[p].labelCss && perms[p].labelCss.indexOf("default") !== -1) pillClass = "wt-perm-pill--byphase";
                html += '<span class="wt-perm-pill ' + pillClass + '">' + esc(perms[p].text || "") + '</span>';
            }
            if (!perms.length) html += '<span class="usd-clr--muted" style="font-size:10px">None</span>';

            html += '</div></td>';
            html += '</tr>';
        }

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ═══════════════════════════════════════════
    // Key Dates
    // ═══════════════════════════════════════════

    function loadKeyDates() {
        showLoading("keydates");
        shared.apiFetch("/api/worktype/keydates/" + encodeURIComponent(_selectedType))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.error) { showError("keydates", data.message || "Failed to load key dates. Admin cookie may be required."); return; }
                getCache(_selectedType).keydates = data;
                renderKeyDates(data);
            })
            .catch(function (err) { showError("keydates", err.message); });
    }

    function renderKeyDates(data) {
        hideLoading("keydates");
        var container = document.getElementById("keydatesContainer");
        container.style.display = "";

        var definitions = (data && data.definitions) || [];
        if (!definitions.length) {
            container.innerHTML = '<div class="usd-clr--muted" style="font-size:11px;font-style:italic;padding:8px 0">No key dates configured for this type</div>';
            return;
        }

        // Group by displayCategory, ordered by displayCategoryOrder
        var categoryMap = {};
        for (var i = 0; i < definitions.length; i++) {
            var d = definitions[i];
            var cat = d.displayCategory || "Uncategorised";
            if (!categoryMap[cat]) {
                categoryMap[cat] = { name: cat, order: d.displayCategoryOrder != null ? d.displayCategoryOrder : 999, items: [] };
            }
            categoryMap[cat].items.push(d);
        }

        // Sort categories by order
        var categories = [];
        for (var key in categoryMap) categories.push(categoryMap[key]);
        categories.sort(function (a, b) { return a.order - b.order; });

        // Sort items within each category by displayOrder
        for (var c = 0; c < categories.length; c++) {
            categories[c].items.sort(function (a, b) { return (a.displayOrder || 0) - (b.displayOrder || 0); });
        }

        var html = '<div class="wt-kd-count">' + definitions.length + ' key dates across ' + categories.length + ' categories</div>';

        for (var ci = 0; ci < categories.length; ci++) {
            var cat = categories[ci];
            html += '<div class="wt-kd-category" data-kd-cat="' + ci + '">';
            html += '<div class="wt-kd-category__header" data-kd-cat-toggle="' + ci + '">';
            html += '<span class="fa fa-caret-down wt-kd-category__chevron"></span>';
            html += esc(cat.name);
            html += '<span class="wt-kd-category__count">' + cat.items.length + '</span>';
            html += '</div>';
            html += '<div class="wt-kd-category__items">';

            html += '<table class="wt-kd-table">';
            html += '<thead><tr>';
            html += '<th>Name</th><th>Description</th><th>Always On Form</th><th>Mandatory</th><th>Allow Multiple</th><th>Allow Details</th><th>Date Only</th><th>Reminders</th>';
            html += '</tr></thead><tbody>';

            for (var ki = 0; ki < cat.items.length; ki++) {
                var kd = cat.items[ki];
                var reminders = kd.uiConfig && kd.uiConfig.remindersEnabled;

                html += '<tr>';
                html += '<td><strong>' + esc(kd.keyDateTypeTitle || "--") + '</strong>';
                html += '<span class="wt-kd-sysname">' + esc(kd.keyDateType || "") + '</span>';
                if (kd.owningType && kd.owningTypeName) {
                    html += '<span class="wt-kd-owner">from ' + esc(kd.owningTypeName) + '</span>';
                }
                html += '</td>';
                html += '<td><span class="wt-kd-desc">' + esc(kd.keyDateTypeDescription || "--") + '</span></td>';
                html += '<td>' + kdBool(kd.alwaysOnForm) + '</td>';
                html += '<td>' + kdBool(kd.isMandatory) + '</td>';
                html += '<td>' + kdBool(kd.allowMultiple) + '</td>';
                html += '<td>' + kdBool(kd.allowDetails) + '</td>';
                html += '<td>' + kdBool(kd.dateOnly) + '</td>';
                html += '<td>' + kdBool(reminders) + '</td>';
                html += '</tr>';
            }

            html += '</tbody></table>';
            html += '</div></div>';
        }

        container.innerHTML = html;

        // Wire category collapse toggles
        container.addEventListener("click", function (e) {
            var toggle = e.target.closest("[data-kd-cat-toggle]");
            if (!toggle) return;
            var cat = toggle.closest(".wt-kd-category");
            if (cat) cat.classList.toggle("wt-kd-category--collapsed");
        });
    }

    function kdBool(val) {
        if (val) return '<span class="wt-kd-bool wt-kd-bool--yes">Yes</span>';
        return '<span class="wt-kd-bool wt-kd-bool--no">No</span>';
    }

    // ═══════════════════════════════════════════
    // Relationships
    // ═══════════════════════════════════════════

    function loadRelationships() {
        showLoading("relationships");
        shared.apiFetch("/api/worktype/relationships/" + encodeURIComponent(_selectedType), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rowsPerPage: 100, page: 1 })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.error) { showError("relationships", data.message || "Failed to load relationships. Admin cookie may be required."); return; }
                getCache(_selectedType).rels = data;
                renderRelationships(data);
            })
            .catch(function (err) { showError("relationships", err.message); });
    }

    function renderRelationships(data) {
        hideLoading("relationships");
        var container = document.getElementById("relsContainer");
        container.style.display = "";

        var rows = (data && data.rows) || [];
        if (!rows.length) {
            container.innerHTML = '<div class="wt-aspect-zone__empty">No type relationships configured</div>';
            return;
        }

        // Group by relationship type
        var groups = {};
        for (var i = 0; i < rows.length; i++) {
            var d = rows[i].data || {};
            var type = d.relationshipType || "Unknown";
            if (!groups[type]) groups[type] = [];
            groups[type].push(d);
        }

        var html = '<div class="wt-rels-count">' + rows.length + ' relationships</div>';
        var groupNames = Object.keys(groups).sort();

        for (var g = 0; g < groupNames.length; g++) {
            var gName = groupNames[g];
            var items = groups[gName];

            html += '<div class="wt-rels-group">';
            html += '<div class="wt-rels-group__header">' + esc(gName) + ' <span class="wt-rels-group__count">(' + items.length + ')</span></div>';
            html += '<table class="wt-rels-table">';
            html += '<thead><tr><th>Parent</th><th>Child</th><th>Many Children</th><th>Many Parents</th></tr></thead>';
            html += '<tbody>';

            for (var r = 0; r < items.length; r++) {
                var rel = items[r];
                html += '<tr>';
                html += '<td>' + esc(rel.parentSharedoTypeName || "--") + '<span class="wt-rels-sysname">' + esc(rel.parentSharedoTypeSystemName || "") + '</span></td>';
                html += '<td>' + esc(rel.childSharedoTypeName || "--") + '<span class="wt-rels-sysname">' + esc(rel.childSharedoTypeSystemName || "") + '</span></td>';
                html += '<td><span class="wt-rels-flag ' + (rel.canHaveManyChildren ? 'wt-rels-flag--yes' : '') + '">' + (rel.canHaveManyChildren ? "Yes" : "No") + '</span></td>';
                html += '<td><span class="wt-rels-flag ' + (rel.canHaveManyParents ? 'wt-rels-flag--yes' : '') + '">' + (rel.canHaveManyParents ? "Yes" : "No") + '</span></td>';
                html += '</tr>';
            }

            html += '</tbody></table></div>';
        }

        container.innerHTML = html;
    }

    // ═══════════════════════════════════════════
    // Loading / Error helpers
    // ═══════════════════════════════════════════

    function showLoading(tab) {
        var ids = { aspects: "aspectsLoading", phases: "phasesLoading", roles: "rolesLoading", keydates: "keydatesLoading", relationships: "relsLoading", compare: "compareLoading" };
        var errIds = { aspects: "aspectsError", phases: "phasesError", roles: "rolesError", keydates: "keydatesError", relationships: "relsError", compare: "compareError" };
        var contIds = { aspects: "aspectsContainer", phases: "phasesContainer", roles: "rolesContainer", keydates: "keydatesContainer", relationships: "relsContainer", compare: "compareContainer" };
        document.getElementById(ids[tab]).style.display = "";
        document.getElementById(errIds[tab]).style.display = "none";
        document.getElementById(contIds[tab]).style.display = "none";
    }

    function hideLoading(tab) {
        var ids = { aspects: "aspectsLoading", phases: "phasesLoading", roles: "rolesLoading", keydates: "keydatesLoading", relationships: "relsLoading", compare: "compareLoading" };
        document.getElementById(ids[tab]).style.display = "none";
    }

    function showError(tab, msg) {
        hideLoading(tab);
        var errIds = { aspects: "aspectsError", phases: "phasesError", roles: "rolesError", keydates: "keydatesError", relationships: "relsError", compare: "compareError" };
        var el = document.getElementById(errIds[tab]);
        el.textContent = msg;
        el.style.display = "";
    }

    // ═══════════════════════════════════════════
    // Compare Tab
    // ═══════════════════════════════════════════

    var _compareEnvs = [];     // available environments
    var _compareInitDone = false;

    function initCompareTab() {
        var container = document.getElementById("compareContainer");
        document.getElementById("compareLoading").style.display = "none";
        document.getElementById("compareError").style.display = "none";

        if (!_compareInitDone) {
            // Fetch env list once
            fetch("/api/env").then(function (r) { return r.json(); }).then(function (data) {
                _compareEnvs = (data.environments || []).filter(function (e) { return e.name !== data.current; });
                renderCompareControls(container, data.current);
                _compareInitDone = true;
            }).catch(function () {
                container.innerHTML = '<div class="usd-clr--red" style="padding:16px">Failed to load environments</div>';
                container.style.display = "";
            });
        } else {
            // Re-render controls (env may have changed)
            fetch("/api/env").then(function (r) { return r.json(); }).then(function (data) {
                _compareEnvs = (data.environments || []).filter(function (e) { return e.name !== data.current; });
                renderCompareControls(container, data.current);
            }).catch(function () {});
        }
    }

    function renderCompareControls(container, currentEnvName) {
        var currentLabel = currentEnvName;
        // Try to find a nicer label
        for (var i = 0; i < _compareEnvs.length; i++) {
            // The current env isn't in the filtered list, get it from _flatTypes or just capitalise
        }
        // Build env options
        var envOptions = "";
        for (var i = 0; i < _compareEnvs.length; i++) {
            envOptions += '<option value="' + esc(_compareEnvs[i].name) + '">' + esc(_compareEnvs[i].label) + '</option>';
        }

        var html = '<div class="wt-cmp-layout">';

        // Controls column
        html += '<div class="wt-cmp-controls">';
        html += '<div class="wt-cmp-controls__section">';
        html += '<div class="wt-cmp-controls__label">Compare against</div>';
        html += '<select class="wt-cmp-controls__select" id="cmpEnvSelect">' + envOptions + '</select>';
        html += '</div>';
        html += '<div class="wt-cmp-controls__section">';
        html += '<div class="wt-cmp-controls__label">Show</div>';
        html += '<select class="wt-cmp-controls__select" id="cmpShowSelect">';
        html += '<option value="all">All</option>';
        html += '<option value="aspects">Aspects</option>';
        html += '<option value="keydates">Key Dates</option>';
        html += '<option value="roles">Roles</option>';
        html += '</select>';
        html += '</div>';
        html += '<button class="wt-cmp-controls__btn" id="cmpRunBtn"><span class="fa fa-exchange"></span> Compare</button>';
        html += '<div class="wt-cmp-controls__section">';
        html += '<div class="wt-cmp-controls__label">Legend</div>';
        html += '<div class="wt-cmp-legend">';
        html += '<div class="wt-cmp-legend__item"><span class="wt-cmp-legend__dot wt-cmp-legend__dot--same"></span> Identical</div>';
        html += '<div class="wt-cmp-legend__item"><span class="wt-cmp-legend__dot wt-cmp-legend__dot--changed"></span> Changed</div>';
        html += '<div class="wt-cmp-legend__item"><span class="wt-cmp-legend__dot wt-cmp-legend__dot--added"></span> Only in target</div>';
        html += '<div class="wt-cmp-legend__item"><span class="wt-cmp-legend__dot wt-cmp-legend__dot--removed"></span> Only in current</div>';
        html += '</div></div>';
        html += '</div>';

        // Results area (empty until compare is run)
        html += '<div class="wt-cmp-results" id="cmpResults">';
        html += '<div class="wt-cmp-empty"><span class="fa fa-exchange"></span> Select an environment and click Compare</div>';
        html += '</div>';

        html += '</div>';
        container.innerHTML = html;
        container.style.display = "";

        // Wire compare button
        document.getElementById("cmpRunBtn").addEventListener("click", runCompare);
    }

    function runCompare() {
        var targetEnv = document.getElementById("cmpEnvSelect").value;
        if (!targetEnv) return;

        var resultsEl = document.getElementById("cmpResults");
        resultsEl.innerHTML = '<div class="wt-cmp-loading"><span class="fa fa-spinner fa-spin"></span> Fetching configuration from target environment...</div>';

        // We need current env data too. Reuse cache if available, otherwise fetch.
        var c = getCache(_selectedType);
        var currentDataPromise;

        if (c.aspects && c.keydates && c.roles) {
            currentDataPromise = Promise.resolve({
                aspects: c.aspects,
                keyDates: c.keydates,
                roles: c.roles
            });
        } else {
            // Fetch all three for current env
            currentDataPromise = Promise.all([
                shared.apiFetch("/api/worktype/aspects/" + encodeURIComponent(_selectedType)).then(function (r) { return r.json(); }),
                shared.apiFetch("/api/worktype/keydates/" + encodeURIComponent(_selectedType)).then(function (r) { return r.json(); }),
                shared.apiFetch("/api/worktype/roles/" + encodeURIComponent(_selectedType), {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ rowsPerPage: 100, page: 1 })
                }).then(function (r) { return r.json(); })
            ]).then(function (results) {
                return { aspects: results[0], keyDates: results[1], roles: results[2] };
            });
        }

        // Fetch target env data
        var targetDataPromise = shared.apiFetch("/api/worktype/compare/" + encodeURIComponent(_selectedType), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetEnv: targetEnv })
        }).then(function (r) { return r.json(); });

        Promise.all([currentDataPromise, targetDataPromise]).then(function (results) {
            var currentData = results[0];
            var targetData = results[1];

            if (targetData.error && !targetData.aspects) {
                resultsEl.innerHTML = '<div class="wt-cmp-empty usd-clr--red">' + esc(targetData.message || "Failed to fetch target data") + '</div>';
                return;
            }

            var show = document.getElementById("cmpShowSelect").value;
            renderCompareResults(resultsEl, currentData, targetData, show);
        }).catch(function (err) {
            resultsEl.innerHTML = '<div class="wt-cmp-empty usd-clr--red">' + esc(err.message) + '</div>';
        });
    }

    function renderCompareResults(el, currentData, targetData, show) {
        var targetLabel = targetData.label || targetData.environment || "Target";

        // Get current env label
        var currentLabel = document.getElementById("hostLabel").textContent || "Current";
        // Try to use a shorter label from the env select
        var envSelect = document.getElementById("envSelect");
        if (envSelect && envSelect.selectedOptions && envSelect.selectedOptions.length) {
            currentLabel = envSelect.selectedOptions[0].textContent;
        }

        var html = '';

        if (show === "all" || show === "aspects") {
            html += buildAspectsDiff(currentData.aspects, targetData.aspects, currentLabel, targetLabel);
        }
        if (show === "all" || show === "keydates") {
            html += buildKeyDatesDiff(currentData.keyDates, targetData.keyDates, currentLabel, targetLabel);
        }
        if (show === "all" || show === "roles") {
            html += buildRolesDiff(currentData.roles, targetData.roles, currentLabel, targetLabel);
        }

        el.innerHTML = html;
    }

    // ─── Aspects diff (side-by-side) ───

    function normaliseAspects(data) {
        var result = [];
        var rawAspects = (data && data.aspects) || {};
        for (var key in rawAspects) {
            var normZone = key.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
            var items = rawAspects[key] || [];
            for (var i = 0; i < items.length; i++) {
                var a = items[i];
                var formId = null;
                var formTitle = null;
                if (a.aspectDefinitionSystemName === "FormBuilder" && a.config) {
                    try {
                        var cfg = JSON.parse(a.config);
                        formId = cfg.formId || null;
                        formTitle = cfg.title || null;
                    } catch (e) {}
                }

                // Display name: use form title for FormBuilder aspects, otherwise aspect displayName
                var displayName = a.displayName || a.aspectDefinitionSystemName;
                if (formTitle && a.aspectDefinitionSystemName === "FormBuilder") {
                    displayName = formTitle;
                }

                // Unique key: for FormBuilder, include formId to distinguish multiple forms in same zone
                var uniqueKey = normZone + "::" + a.aspectDefinitionSystemName;
                if (formId) uniqueKey += "::" + formId;

                result.push({
                    zone: normZone,
                    displayName: displayName,
                    sysName: a.aspectDefinitionSystemName,
                    inherited: !!a.inherited,
                    alwaysHide: !!a.alwaysHide,
                    hasRules: !!(a.ruleSetSelection),
                    formId: formId,
                    formTitle: formTitle,
                    displayPriority: a.displayPriority || 0,
                    _key: uniqueKey
                });
            }
        }
        return result;
    }

    function buildAspectsDiff(currentAspectData, targetAspectData, currentLabel, targetLabel) {
        var currAspects = normaliseAspects(currentAspectData);
        var targAspects = normaliseAspects(targetAspectData && !targetAspectData.error ? targetAspectData : null);

        var currMap = {};
        for (var i = 0; i < currAspects.length; i++) currMap[currAspects[i]._key] = currAspects[i];
        var targMap = {};
        for (var i = 0; i < targAspects.length; i++) targMap[targAspects[i]._key] = targAspects[i];

        // Stats
        var same = 0, changed = 0, added = 0, removed = 0;
        var zones = ["preHeader", "header", "top", "main", "bottom", "footer"];
        var zoneLabels = { preHeader: "Pre-Header", header: "Header", top: "Top", main: "Main", bottom: "Bottom", footer: "Footer" };

        // Pre-compute diff status for each aspect
        var diffStatus = {};
        var allKeys = {};
        for (var k in currMap) allKeys[k] = true;
        for (var k in targMap) allKeys[k] = true;

        for (var k in allKeys) {
            var c = currMap[k];
            var t = targMap[k];
            if (c && !t) { diffStatus[k] = "removed"; removed++; }
            else if (!c && t) { diffStatus[k] = "added"; added++; }
            else {
                var changes = [];
                if (c.alwaysHide !== t.alwaysHide) changes.push("hidden: " + c.alwaysHide + " -> " + t.alwaysHide);
                if (c.formId !== t.formId) changes.push("formId changed");
                if (c.hasRules !== t.hasRules) changes.push("rules: " + c.hasRules + " -> " + t.hasRules);
                if (c.zone !== t.zone) changes.push("zone: " + c.zone + " -> " + t.zone);
                if (changes.length) { diffStatus[k] = { status: "changed", changes: changes }; changed++; }
                else { diffStatus[k] = "same"; same++; }
            }
        }

        if (targetAspectData && targetAspectData.error) {
            return '<div class="wt-cmp-section"><div class="wt-cmp-section__header"><span class="fa fa-th-list"></span> Aspects <span class="wt-cmp-section__count usd-clr--red">Failed to load from target</span></div></div>';
        }

        var h = '<div class="wt-cmp-section">';
        h += '<div class="wt-cmp-section__header"><span class="fa fa-th-list"></span> Aspects';
        h += '<span class="wt-cmp-section__count">';
        h += '<span class="wt-cmp-stat--same">' + same + ' same</span>';
        if (changed) h += ' &middot; <span class="wt-cmp-stat--changed">' + changed + ' changed</span>';
        if (added) h += ' &middot; <span class="wt-cmp-stat--added">' + added + ' added</span>';
        if (removed) h += ' &middot; <span class="wt-cmp-stat--removed">' + removed + ' removed</span>';
        h += '</span></div>';

        h += '<div class="wt-cmp-env-row"><div class="wt-cmp-env-label">' + esc(currentLabel) + ' (current)</div><div class="wt-cmp-env-label">' + esc(targetLabel) + '</div></div>';
        h += '<div class="wt-cmp-aspects">';

        // Group by zone for each side
        function groupByZone(aspects) {
            var g = {};
            for (var i = 0; i < aspects.length; i++) {
                var z = aspects[i].zone;
                if (!g[z]) g[z] = [];
                g[z].push(aspects[i]);
            }
            for (var z in g) g[z].sort(function (a, b) { return (b.displayPriority || 0) - (a.displayPriority || 0); });
            return g;
        }

        var currByZone = groupByZone(currAspects);
        var targByZone = groupByZone(targAspects);

        function renderAspectCol(byZone, isTarget) {
            var col = '';
            for (var zi = 0; zi < zones.length; zi++) {
                var zn = zones[zi];
                var items = byZone[zn] || [];
                // Also include items from the other side that are only there (for removed/added)
                if (isTarget) {
                    // Add "removed" items (in current but not target) as ghost rows
                    var currItems = currByZone[zn] || [];
                    for (var ci = 0; ci < currItems.length; ci++) {
                        if (diffStatus[currItems[ci]._key] === "removed") {
                            items.push({ _key: currItems[ci]._key, displayName: currItems[ci].displayName, sysName: currItems[ci].sysName, inherited: currItems[ci].inherited, formId: currItems[ci].formId, formTitle: currItems[ci].formTitle, _ghost: true });
                        }
                    }
                }
                if (!items.length && !(byZone[zn] || []).length) continue;
                // Check if this zone has any items on either side
                var otherItems = isTarget ? (currByZone[zn] || []) : (targByZone[zn] || []);
                if (!items.length && !otherItems.length) continue;

                col += '<div class="wt-cmp-zone">';
                col += '<div class="wt-cmp-zone__header">' + (zoneLabels[zn] || zn) + '</div>';
                for (var ai = 0; ai < items.length; ai++) {
                    var asp = items[ai];
                    var ds = diffStatus[asp._key];
                    var rowClass = "wt-cmp-aspect-row";
                    if (asp._ghost) rowClass += " wt-cmp-aspect-row--removed";
                    else if (isTarget && ds === "added") rowClass += " wt-cmp-aspect-row--added";
                    else if (isTarget && ds && ds.status === "changed") rowClass += " wt-cmp-aspect-row--changed";
                    if (asp.inherited) rowClass += " wt-cmp-aspect-row--inherited";

                    col += '<div class="' + rowClass + '">';
                    col += '<span class="wt-cmp-aspect-row__name">' + esc(asp.displayName) + '</span>';
                    col += '<span class="wt-cmp-aspect-row__type">' + esc(asp.sysName) + '</span>';
                    if (asp.sysName === "FormBuilder" && (asp.formTitle || asp.formId)) {
                        var formLabel = asp.formTitle || asp.formId;
                        col += '<span class="wt-cmp-aspect-row__form"><span class="fa fa-wpforms"></span> ' + esc(formLabel) + '</span>';
                    }
                    col += '<span class="wt-cmp-aspect-row__dots">';
                    if (asp.inherited) col += '<span class="wt-cmp-aspect-row__dot usd-bg--blue" title="Inherited"></span>';
                    if (asp.sysName === "FormBuilder") col += '<span class="wt-cmp-aspect-row__dot usd-bg--cyan" title="FormBuilder"></span>';
                    col += '</span></div>';

                    // Show change detail on target side
                    if (isTarget && ds && ds.status === "changed") {
                        col += '<div class="wt-cmp-change-detail">' + esc(ds.changes.join(", ")) + '</div>';
                    }
                }
                col += '</div>';
            }
            return col;
        }

        h += '<div class="wt-cmp-aspects__col">' + renderAspectCol(currByZone, false) + '</div>';
        h += '<div class="wt-cmp-aspects__col">' + renderAspectCol(targByZone, true) + '</div>';
        h += '</div></div>';
        return h;
    }

    // ─── Key Dates diff (unified table) ───

    function buildKeyDatesDiff(currentKdData, targetKdData, currentLabel, targetLabel) {
        var currDefs = (currentKdData && currentKdData.definitions) || [];
        var targDefs = (targetKdData && !targetKdData.error && targetKdData.definitions) || [];

        var currMap = {};
        for (var i = 0; i < currDefs.length; i++) currMap[currDefs[i].keyDateType] = currDefs[i];
        var targMap = {};
        for (var i = 0; i < targDefs.length; i++) targMap[targDefs[i].keyDateType] = targDefs[i];

        var allKeys = {};
        for (var k in currMap) allKeys[k] = true;
        for (var k in targMap) allKeys[k] = true;

        var rows = [];
        var same = 0, changed = 0, added = 0, removed = 0;

        for (var k in allKeys) {
            var c = currMap[k];
            var t = targMap[k];
            if (c && !t) { rows.push({ status: "removed", kd: c, changes: [] }); removed++; }
            else if (!c && t) { rows.push({ status: "added", kd: t, changes: [] }); added++; }
            else {
                var changes = [];
                if (c.isMandatory !== t.isMandatory) changes.push("mandatory: " + (c.isMandatory ? "Yes" : "No") + " -> " + (t.isMandatory ? "Yes" : "No"));
                if (c.allowMultiple !== t.allowMultiple) changes.push("allowMultiple: " + (c.allowMultiple ? "Yes" : "No") + " -> " + (t.allowMultiple ? "Yes" : "No"));
                if (c.dateOnly !== t.dateOnly) changes.push("dateOnly: " + (c.dateOnly ? "Yes" : "No") + " -> " + (t.dateOnly ? "Yes" : "No"));
                if (c.alwaysOnForm !== t.alwaysOnForm) changes.push("alwaysOnForm: " + (c.alwaysOnForm ? "Yes" : "No") + " -> " + (t.alwaysOnForm ? "Yes" : "No"));
                if ((c.displayCategory || "") !== (t.displayCategory || "")) changes.push("category: " + (c.displayCategory || "--") + " -> " + (t.displayCategory || "--"));
                if (changes.length) { rows.push({ status: "changed", kd: c, changes: changes }); changed++; }
                else { rows.push({ status: "same", kd: c, changes: [] }); same++; }
            }
        }

        if (targetKdData && targetKdData.error) {
            return '<div class="wt-cmp-section"><div class="wt-cmp-section__header"><span class="fa fa-calendar"></span> Key Dates <span class="wt-cmp-section__count usd-clr--red">Failed to load from target</span></div></div>';
        }

        // Sort: changed/added/removed first, then same
        var order = { changed: 0, added: 1, removed: 2, same: 3 };
        rows.sort(function (a, b) { return (order[a.status] || 9) - (order[b.status] || 9); });

        var h = '<div class="wt-cmp-section">';
        h += '<div class="wt-cmp-section__header"><span class="fa fa-calendar"></span> Key Dates';
        h += '<span class="wt-cmp-section__count">';
        h += '<span class="wt-cmp-stat--same">' + same + ' same</span>';
        if (changed) h += ' &middot; <span class="wt-cmp-stat--changed">' + changed + ' changed</span>';
        if (added) h += ' &middot; <span class="wt-cmp-stat--added">' + added + ' added</span>';
        if (removed) h += ' &middot; <span class="wt-cmp-stat--removed">' + removed + ' removed</span>';
        h += '</span></div>';

        h += '<table class="wt-cmp-table"><thead><tr><th>Status</th><th>Name</th><th>Category</th><th>Mandatory</th><th>Changes</th></tr></thead><tbody>';
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var kd = r.kd;
            h += '<tr>';
            h += '<td><span class="wt-cmp-diff-badge wt-cmp-diff-badge--' + r.status + '">';
            if (r.status === "same") h += 'Same';
            else if (r.status === "changed") h += 'Changed';
            else if (r.status === "added") h += 'Only in ' + esc(targetLabel);
            else if (r.status === "removed") h += 'Only in current';
            h += '</span></td>';
            h += '<td>' + esc(kd.keyDateTypeTitle || kd.keyDateType) + '<span class="wt-cmp-sysname">' + esc(kd.keyDateType) + '</span></td>';
            h += '<td>' + esc(kd.displayCategory || "--") + '</td>';
            h += '<td>' + (kd.isMandatory ? "Yes" : "No") + '</td>';
            h += '<td>';
            if (r.changes.length) h += '<span class="wt-cmp-change-text">' + esc(r.changes.join("; ")) + '</span>';
            h += '</td>';
            h += '</tr>';
        }
        h += '</tbody></table></div>';
        return h;
    }

    // ─── Roles diff (unified table with permission pills) ───

    function buildRolesDiff(currentRolesData, targetRolesData, currentLabel, targetLabel) {
        var currRows = (currentRolesData && currentRolesData.rows) || [];
        var targRows = (targetRolesData && !targetRolesData.error && targetRolesData.rows) || [];

        var currMap = {};
        for (var i = 0; i < currRows.length; i++) {
            var d = currRows[i].data || {};
            if (d.systemName) currMap[d.systemName] = d;
        }
        var targMap = {};
        for (var i = 0; i < targRows.length; i++) {
            var d = targRows[i].data || {};
            if (d.systemName) targMap[d.systemName] = d;
        }

        var allKeys = {};
        for (var k in currMap) allKeys[k] = true;
        for (var k in targMap) allKeys[k] = true;

        var rows = [];
        var same = 0, changed = 0, added = 0, removed = 0;

        for (var k in allKeys) {
            var c = currMap[k];
            var t = targMap[k];
            if (c && !t) { rows.push({ status: "removed", role: c, addedPerms: [], removedPerms: [] }); removed++; }
            else if (!c && t) { rows.push({ status: "added", role: t, addedPerms: [], removedPerms: [] }); added++; }
            else {
                var cPerms = {};
                var tPerms = {};
                var cp = c.permissions || [];
                var tp = t.permissions || [];
                for (var pi = 0; pi < cp.length; pi++) cPerms[cp[pi].text || ""] = true;
                for (var pi = 0; pi < tp.length; pi++) tPerms[tp[pi].text || ""] = true;

                var addedP = [];
                var removedP = [];
                for (var pk in tPerms) { if (!cPerms[pk] && pk) addedP.push(pk); }
                for (var pk in cPerms) { if (!tPerms[pk] && pk) removedP.push(pk); }

                var activeChanged = (!!c.isActive) !== (!!t.isActive);

                if (addedP.length || removedP.length || activeChanged) {
                    rows.push({ status: "changed", role: c, addedPerms: addedP, removedPerms: removedP, activeChanged: activeChanged, targetActive: !!t.isActive });
                    changed++;
                } else {
                    rows.push({ status: "same", role: c, addedPerms: [], removedPerms: [] });
                    same++;
                }
            }
        }

        if (targetRolesData && targetRolesData.error) {
            return '<div class="wt-cmp-section"><div class="wt-cmp-section__header"><span class="fa fa-users"></span> Roles <span class="wt-cmp-section__count usd-clr--red">Failed to load from target</span></div></div>';
        }

        var order = { changed: 0, added: 1, removed: 2, same: 3 };
        rows.sort(function (a, b) { return (order[a.status] || 9) - (order[b.status] || 9); });

        var h = '<div class="wt-cmp-section">';
        h += '<div class="wt-cmp-section__header"><span class="fa fa-users"></span> Roles';
        h += '<span class="wt-cmp-section__count">';
        h += '<span class="wt-cmp-stat--same">' + same + ' same</span>';
        if (changed) h += ' &middot; <span class="wt-cmp-stat--changed">' + changed + ' changed</span>';
        if (added) h += ' &middot; <span class="wt-cmp-stat--added">' + added + ' added</span>';
        if (removed) h += ' &middot; <span class="wt-cmp-stat--removed">' + removed + ' removed</span>';
        h += '</span></div>';

        h += '<table class="wt-cmp-table"><thead><tr><th>Status</th><th>Role</th><th>Active</th><th>Permission Changes</th></tr></thead><tbody>';
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var role = r.role;
            h += '<tr>';
            h += '<td><span class="wt-cmp-diff-badge wt-cmp-diff-badge--' + r.status + '">';
            if (r.status === "same") h += 'Same';
            else if (r.status === "changed") h += 'Changed';
            else if (r.status === "added") h += 'Only in ' + esc(targetLabel);
            else if (r.status === "removed") h += 'Only in current';
            h += '</span></td>';
            h += '<td>' + esc(role.name || "--") + '<span class="wt-cmp-sysname">' + esc(role.systemName || "") + '</span></td>';
            h += '<td>';
            if (r.activeChanged) {
                h += '<span class="wt-cmp-change-text">' + (role.isActive ? "Yes" : "No") + ' -> ' + (r.targetActive ? "Yes" : "No") + '</span>';
            } else {
                h += (role.isActive ? "Yes" : "No");
            }
            h += '</td>';
            h += '<td>';
            for (var ap = 0; ap < r.addedPerms.length; ap++) {
                h += '<span class="wt-cmp-perm-pill wt-cmp-perm-pill--added">+ ' + esc(r.addedPerms[ap]) + '</span>';
            }
            for (var rp = 0; rp < r.removedPerms.length; rp++) {
                h += '<span class="wt-cmp-perm-pill wt-cmp-perm-pill--removed">- ' + esc(r.removedPerms[rp]) + '</span>';
            }
            h += '</td>';
            h += '</tr>';
        }
        h += '</tbody></table></div>';
        return h;
    }

    // ═══════════════════════════════════════════
    // Sidebar Mode Toggle
    // ═══════════════════════════════════════════

    function onModeToggle(e) {
        var mode = e.currentTarget.dataset.mode;
        if (mode === _sidebarMode) return;
        _sidebarMode = mode;

        var btns = document.querySelectorAll(".wt-mode-toggle__btn");
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle("wt-mode-toggle__btn--active", btns[i].dataset.mode === mode);
        }

        document.getElementById("modeTree").style.display = mode === "tree" ? "" : "none";
        document.getElementById("modeSearch").style.display = mode === "search" ? "" : "none";
    }

    // ═══════════════════════════════════════════
    // Config Index
    // ═══════════════════════════════════════════

    function checkIndexStatus() {
        shared.apiFetch("/api/worktype/index/status").then(function (r) { return r.json(); }).then(function (data) {
            renderIndexStatus(data);
            if (data.status === "building") startIdxPoll();
        }).catch(function () {});
    }

    function renderIndexStatus(data) {
        var statusEl = document.getElementById("idxStatus");
        var metaEl = document.getElementById("idxMeta");
        var progressEl = document.getElementById("idxProgress");
        var errorEl = document.getElementById("idxError");
        var buildBtn = document.getElementById("idxBuildBtn");

        var st = data.status || "empty";

        statusEl.className = "wt-idx-panel__status wt-idx-panel__status--" + st;
        if (st === "empty") statusEl.textContent = "Not built";
        else if (st === "building") statusEl.textContent = "Building...";
        else if (st === "ready") statusEl.textContent = "Ready";
        else if (st === "error") statusEl.textContent = "Error";

        if (st === "ready" && data.count) {
            metaEl.textContent = data.count + " types";
            if (data.builtAt) metaEl.textContent += " | " + shared.fmtDate(data.builtAt);
        } else {
            metaEl.textContent = "";
        }

        if (st === "building") {
            buildBtn.disabled = true;
            buildBtn.innerHTML = '<span class="fa fa-spinner fa-spin"></span>';
        } else {
            buildBtn.disabled = false;
            buildBtn.innerHTML = '<span class="fa fa-bolt"></span> ' + (st === "ready" ? "Rebuild" : "Build");
        }

        if (st === "building" && data.progress) {
            progressEl.style.display = "";
            var p = data.progress;
            document.getElementById("idxCurrent").textContent = p.current || "";
            var pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
            document.getElementById("idxFill").style.width = pct + "%";
            document.getElementById("idxCounter").textContent = p.done + " / " + p.total;
        } else {
            progressEl.style.display = "none";
        }

        if (st === "error" && data.error) {
            errorEl.style.display = "";
            errorEl.textContent = data.error;
        } else {
            errorEl.style.display = "none";
        }

        // Search form state
        var form = document.getElementById("csearchForm");
        if (st === "ready") {
            form.style.opacity = "";
            form.style.pointerEvents = "";
        } else {
            form.style.opacity = "0.4";
            form.style.pointerEvents = "none";
        }
    }

    function onBuildIndex() {
        var buildEnv = shared.getCurrentEnv();
        shared.apiFetch("/api/worktype/index/build", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ force: true })
        }).then(function (r) { return r.json(); }).then(function (data) {
            renderIndexStatus(data);
            startIdxPoll(buildEnv);
        }).catch(function () {});
    }

    function startIdxPoll(pinnedEnv) {
        stopIdxPoll();
        // Pin the environment so polling continues against the correct env
        // even if the user switches env mid-build.
        var env = pinnedEnv || shared.getCurrentEnv();
        _idxPollTimer = setInterval(function () {
            shared.apiFetch("/api/worktype/index/status", { headers: { "X-Sharedo-Env": env } }).then(function (r) { return r.json(); }).then(function (data) {
                renderIndexStatus(data);
                if (data.status !== "building") stopIdxPoll();
            }).catch(function () { stopIdxPoll(); });
        }, 800);
    }

    function stopIdxPoll() {
        if (_idxPollTimer) { clearInterval(_idxPollTimer); _idxPollTimer = null; }
    }

    // ═══════════════════════════════════════════
    // Config Search
    // ═══════════════════════════════════════════

    function onAdvancedToggle() {
        var panel = document.getElementById("csearchAdvPanel");
        var btn = document.getElementById("csearchAdvToggle");
        var isOpen = panel.style.display !== "none";
        panel.style.display = isOpen ? "none" : "";
        btn.classList.toggle("wt-csearch__filter-toggle--active", !isOpen);
    }

    function onConfigSearch() {
        var query = document.getElementById("csearchInput").value.trim();
        var excludeMode = document.getElementById("csearchExclude").checked;

        var filters = {};
        var fAspect = document.getElementById("cfAspect").value.trim();
        var fForm = document.getElementById("cfForm").value.trim();
        var fKeyDate = document.getElementById("cfKeyDate").value.trim();
        var fRole = document.getElementById("cfRole").value.trim();
        if (fAspect) filters.aspectName = fAspect;
        if (fForm) filters.formTitle = fForm;
        if (fKeyDate) filters.keyDateName = fKeyDate;
        if (fRole) filters.roleName = fRole;

        var body = {};
        if (query) body.query = query;
        if (Object.keys(filters).length) body.filters = filters;
        if (excludeMode) body.excludeMode = true;

        _lastSearchTerm = query;

        // Show results panel, hide detail and empty
        showSearchResults();
        document.getElementById("srList").innerHTML = '<div class="wt-sr__loading"><span class="fa fa-spinner fa-spin"></span> Searching...</div>';

        shared.apiFetch("/api/worktype/index/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        }).then(function (r) { return r.json(); }).then(function (data) {
            renderConfigSearchResults(data);
        }).catch(function (err) {
            document.getElementById("srList").innerHTML = '<div class="wt-sr__empty usd-clr--red">' + esc(err.message) + '</div>';
        });
    }

    function showSearchResults() {
        _hasSearchResults = true;
        document.getElementById("emptyState").style.display = "none";
        document.getElementById("detailPanel").style.display = "none";
        document.getElementById("searchResultsPanel").style.display = "";
        document.getElementById("backToResults").style.display = "none";
    }

    function renderConfigSearchResults(data) {
        var listEl = document.getElementById("srList");
        var countEl = document.getElementById("srCount");
        var timeEl = document.getElementById("srTime");

        if (data.message && (!data.results || !data.results.length)) {
            listEl.innerHTML = '<div class="wt-sr__empty">' + esc(data.message) + '</div>';
            countEl.textContent = "0 results";
            timeEl.textContent = "";
            return;
        }

        var results = data.results || [];
        countEl.textContent = data.resultCount + " of " + data.totalIndexed + " types";
        timeEl.textContent = data.searchTime ? "(" + esc(data.searchTime) + ")" : "";

        if (!results.length) {
            listEl.innerHTML = '<div class="wt-sr__empty">No matching types found</div>';
            return;
        }

        var html = "";
        var searchTerm = _lastSearchTerm;
        for (var i = 0; i < results.length; i++) {
            html += buildResultCard(results[i], searchTerm, i < 5);
        }
        listEl.innerHTML = html;
        wireResultCardEvents();
    }

    function buildResultCard(r, searchTerm, expanded) {
        var matches = r.matches || {};
        var hasMatches = (matches.aspects && matches.aspects.length) ||
                         (matches.forms && matches.forms.length) ||
                         (matches.keyDates && matches.keyDates.length) ||
                         (matches.roles && matches.roles.length);
        var collapsedCls = expanded && hasMatches ? "" : " wt-sr-card--collapsed";

        var icon = r.icon || "fa-cube";
        if (icon.indexOf("fa-") !== 0) icon = "fa-" + icon;
        var colour = r.tileColour || cssVar("--text-muted");

        var h = '<div class="wt-sr-card' + collapsedCls + '" data-sn="' + esc(r.systemName) + '">';

        // Header
        h += '<div class="wt-sr-card__header">';
        h += '<span class="fa fa-chevron-down wt-sr-card__chevron"></span>';
        h += '<div class="wt-sr-card__identity" data-sn="' + esc(r.systemName) + '" title="View type detail">';
        h += '<span class="wt-sr-card__icon" style="background:' + esc(colour) + '"><span class="fa ' + esc(icon) + '"></span></span>';
        h += '<div class="wt-sr-card__title">';
        h += '<div class="wt-sr-card__name">' + hlText(esc(r.name), searchTerm) + '</div>';
        h += '<div class="wt-sr-card__sysname">' + hlText(esc(r.systemName), searchTerm) + '</div>';
        h += '</div>';
        h += '<span class="fa fa-arrow-right wt-sr-card__go-arrow"></span>';
        h += '</div>';
        h += '<div class="wt-sr-card__badges">';
        if (r.isAbstract) h += '<span class="wt-sr-card__badge wt-sr-card__badge--abstract">Abstract</span>';
        if (r.isCoreType) h += '<span class="wt-sr-card__badge wt-sr-card__badge--core">Core</span>';
        h += '</div>';
        h += '</div>';

        // Body (match context)
        h += '<div class="wt-sr-card__body">';

        if (matches.aspects && matches.aspects.length) {
            h += '<div class="wt-sr-card__section">';
            h += '<div class="wt-sr-card__section-label"><span class="fa fa-th-list"></span> Aspects</div>';
            h += '<ul class="wt-sr-card__match-list">';
            for (var a = 0; a < matches.aspects.length; a++) {
                h += '<li class="wt-sr-card__match-item">' + hlText(esc(matches.aspects[a]), searchTerm) + '</li>';
            }
            h += '</ul></div>';
        }

        if (matches.forms && matches.forms.length) {
            h += '<div class="wt-sr-card__section">';
            h += '<div class="wt-sr-card__section-label"><span class="fa fa-wpforms"></span> Forms</div>';
            h += '<ul class="wt-sr-card__match-list">';
            for (var f = 0; f < matches.forms.length; f++) {
                h += '<li class="wt-sr-card__match-item">' + hlText(esc(matches.forms[f]), searchTerm) + '</li>';
            }
            h += '</ul></div>';
        }

        if (matches.keyDates && matches.keyDates.length) {
            h += '<div class="wt-sr-card__section">';
            h += '<div class="wt-sr-card__section-label"><span class="fa fa-calendar"></span> Key Dates</div>';
            h += '<ul class="wt-sr-card__match-list">';
            for (var k = 0; k < matches.keyDates.length; k++) {
                h += '<li class="wt-sr-card__match-item">' + hlText(esc(matches.keyDates[k]), searchTerm) + '</li>';
            }
            h += '</ul></div>';
        }

        if (matches.roles && matches.roles.length) {
            h += '<div class="wt-sr-card__section">';
            h += '<div class="wt-sr-card__section-label"><span class="fa fa-users"></span> Roles</div>';
            h += '<ul class="wt-sr-card__match-list">';
            for (var rl = 0; rl < matches.roles.length; rl++) {
                h += '<li class="wt-sr-card__match-item">' + hlText(esc(matches.roles[rl]), searchTerm) + '</li>';
            }
            h += '</ul></div>';
        }

        if (!hasMatches) {
            h += '<div class="wt-sr-card__section"><div class="wt-sr-card__section-label"><span class="fa fa-info-circle"></span> Matched on type name or system name</div></div>';
        }

        h += '</div></div>';
        return h;
    }

    function hlText(text, term) {
        if (!term || !text) return text;
        var terms = term.trim().toLowerCase().split(/\s+/);
        var result = text;
        for (var i = 0; i < terms.length; i++) {
            if (!terms[i]) continue;
            var escaped = terms[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            var re = new RegExp("(" + escaped + ")", "gi");
            result = result.replace(re, '<span class="wt-match-hl">$1</span>');
        }
        return result;
    }

    function wireResultCardEvents() {
        var cards = document.querySelectorAll(".wt-sr-card");
        for (var i = 0; i < cards.length; i++) {
            var header = cards[i].querySelector(".wt-sr-card__header");
            header.addEventListener("click", function (e) {
                // Clicking the identity block opens the type detail
                if (e.target.closest(".wt-sr-card__identity")) {
                    var sn = e.target.closest(".wt-sr-card__identity").dataset.sn;
                    if (sn) openTypeFromSearch(sn);
                    return;
                }
                // Clicking anywhere else in the header toggles expand/collapse
                this.parentElement.classList.toggle("wt-sr-card--collapsed");
            });
        }
    }

    function onSearchResultClick() {
        // No-op -- all handled by wireResultCardEvents delegation
    }

    function openTypeFromSearch(systemName) {
        // Hide search results, show detail with back button
        document.getElementById("searchResultsPanel").style.display = "none";
        document.getElementById("detailPanel").style.display = "";
        document.getElementById("backToResults").style.display = "";
        document.getElementById("emptyState").style.display = "none";

        // Force reload even if same type (reset _selectedType to allow)
        _selectedType = null;
        selectType(systemName);
    }

    function onBackToResults() {
        document.getElementById("detailPanel").style.display = "none";
        document.getElementById("backToResults").style.display = "none";
        document.getElementById("searchResultsPanel").style.display = "";
        _selectedType = null;
    }

    // ─── Init ───
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();