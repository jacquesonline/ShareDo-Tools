/**
 * Theme Builder for ShareDo Tools.
 * Creates custom theme CSS files from colour picker inputs.
 */
(function () {
    "use strict";

    var esc = shared.esc;

    // ─── Base theme values (loaded from existing themes or defaults) ───
    var BASES = {
        dark: {
            "bg-body":"#1a1d23","bg-panel":"#22262e","bg-card":"#2a2f38","bg-input":"#1a1d23","bg-console":"#0d0f12",
            "border":"#363c48",
            "text-primary":"#e2e5ea","text-secondary":"#8b919e","text-muted":"#7d8590",
            "accent-blue":"#4a9eff","accent-green":"#3dd68c","accent-red":"#ef5350","accent-amber":"#f0a840",
            "accent-purple":"#a078ff","accent-cyan":"#56d4c0","accent-orange":"#ffb378",
            "nav-bg":"#22262e","nav-border":"#363c48","nav-text":"#7d8590","nav-text-active":"#4a9eff",
            "nav-active-bg":"#273447","nav-env-bg":"#4a9eff","nav-env-text":"#4a9eff","nav-env-border":"#4a9eff",
            "nav-primary-bg":"#4a9eff",
            "nav-admin-bg":"#313047","nav-admin-text":"#a078ff",
            "chart-blue":"#4a9eff","chart-green":"#3dd68c","chart-red":"#ef5350","chart-amber":"#f0a840","chart-purple":"#a078ff","chart-cyan":"#56d4c0",
            "guidance-bg":"#1a3352","guidance-text":"#8ec4f0","guidance-border":"#2a5a80",
            "scrollbar-thumb":"#363c48","scrollbar-hover":"#4a5264",
            "phase-start":"#43a047","phase-open":"#1976d2","phase-closed":"#d32f2f","phase-default":"#f57c00",
            "link-hover":"#7ab8ff"
        },
        light: {
            "bg-body":"#f5f6f8","bg-panel":"#ffffff","bg-card":"#f0f1f4","bg-input":"#ffffff","bg-console":"#f5f6f8",
            "border":"#d8dbe0",
            "text-primary":"#1a1d23","text-secondary":"#5c6370","text-muted":"#6b7280",
            "accent-blue":"#1a73e8","accent-green":"#167d48","accent-red":"#d32f2f","accent-amber":"#b45309",
            "accent-purple":"#7c4dff","accent-cyan":"#0b7d70","accent-orange":"#c2710a",
            "nav-bg":"#ffffff","nav-border":"#d8dbe0","nav-text":"#6b7280","nav-text-active":"#1a73e8",
            "nav-active-bg":"#edf4fd","nav-env-bg":"#1a73e8","nav-env-text":"#1a73e8","nav-env-border":"#1a73e8",
            "nav-primary-bg":"#1a73e8",
            "nav-admin-bg":"#f5f1ff","nav-admin-text":"#7c4dff",
            "chart-blue":"#1a73e8","chart-green":"#167d48","chart-red":"#d32f2f","chart-amber":"#b45309","chart-purple":"#7c4dff","chart-cyan":"#0b7d70",
            "guidance-bg":"#EFF8FF","guidance-text":"#1d6db5","guidance-border":"#93c5fd",
            "scrollbar-thumb":"#c4c8ce","scrollbar-hover":"#a0a5ad",
            "phase-start":"#2e7d32","phase-open":"#1565c0","phase-closed":"#c62828","phase-default":"#e65100",
            "link-hover":"#1557b0"
        },
        "mb-brand": {
            "bg-body":"#f8f5f0","bg-panel":"#ffffff","bg-card":"#f0ede8","bg-input":"#ffffff","bg-console":"#f8f5f0",
            "border":"#ddd5cc",
            "text-primary":"#461C2F","text-secondary":"#6b5060","text-muted":"#7d6a74",
            "accent-blue":"#1a6b9c","accent-green":"#2d7a3a","accent-red":"#DB333C","accent-amber":"#a05a00",
            "accent-purple":"#75264F","accent-cyan":"#0e7c6b","accent-orange":"#b84c00",
            "nav-bg":"#461C2F","nav-border":"#3a1527","nav-text":"#b3a99e","nav-text-active":"#ffffff",
            "nav-active-bg":"#CC2E57","nav-env-bg":"#CC2E57","nav-env-text":"#ffffff","nav-env-border":"#CC2E57",
            "nav-primary-bg":"#CC2E57",
            "nav-admin-bg":"#CC2E57","nav-admin-text":"#ffffff",
            "chart-blue":"#2196F3","chart-green":"#43A047","chart-red":"#E53935","chart-amber":"#F4A623","chart-purple":"#AB47BC","chart-cyan":"#26A69A",
            "guidance-bg":"#fdf0f4","guidance-text":"#A82660","guidance-border":"#e8b0c8",
            "scrollbar-thumb":"#c4b8be","scrollbar-hover":"#a0959a",
            "phase-start":"#2d7a3a","phase-open":"#1a6b9c","phase-closed":"#DB333C","phase-default":"#b84c00",
            "link-hover":"#A82660"
        },
        "mb-brand-dark": {
            "bg-body":"#1a1318","bg-panel":"#241c22","bg-card":"#2e242b","bg-input":"#1a1318","bg-console":"#110d10",
            "border":"#3e3039",
            "text-primary":"#ece5ea","text-secondary":"#9e8e97","text-muted":"#847680",
            "accent-blue":"#5aace8","accent-green":"#4ec98a","accent-red":"#e05a60","accent-amber":"#e8a843",
            "accent-purple":"#cc5a8e","accent-cyan":"#48c4b0","accent-orange":"#e89060",
            "nav-bg":"#2a1424","nav-border":"#3a1830","nav-text":"#847680","nav-text-active":"#ece5ea",
            "nav-active-bg":"#CC2E57","nav-env-bg":"#CC2E57","nav-env-text":"#e87898","nav-env-border":"#CC2E57",
            "nav-primary-bg":"#CC2E57",
            "nav-admin-bg":"#3a1830","nav-admin-text":"#cc5a8e",
            "chart-blue":"#58b4f0","chart-green":"#5ad8a0","chart-red":"#ef6b6e","chart-amber":"#f0b84a","chart-purple":"#d870a0","chart-cyan":"#50d8c0",
            "guidance-bg":"#2e1a28","guidance-text":"#d890b0","guidance-border":"#5a3048",
            "scrollbar-thumb":"#3e3039","scrollbar-hover":"#584850",
            "phase-start":"#4ec98a","phase-open":"#5aace8","phase-closed":"#e05a60","phase-default":"#e89060",
            "link-hover":"#e06090"
        },
        "hc-dark": {
            "bg-body":"#000000","bg-panel":"#0a0a0a","bg-card":"#141414","bg-input":"#000000","bg-console":"#000000",
            "border":"#3a3a3a",
            "text-primary":"#ffffff","text-secondary":"#c8c8c8","text-muted":"#a0a0a0",
            "accent-blue":"#5ab0ff","accent-green":"#50e898","accent-red":"#ff6b6b","accent-amber":"#ffb84d",
            "accent-purple":"#b490ff","accent-cyan":"#60e8d0","accent-orange":"#ffc080",
            "nav-bg":"#0a0a0a","nav-border":"#3a3a3a","nav-text":"#a0a0a0","nav-text-active":"#5ab0ff",
            "nav-active-bg":"#0a1a30","nav-env-bg":"#5ab0ff","nav-env-text":"#5ab0ff","nav-env-border":"#5ab0ff",
            "nav-primary-bg":"#5ab0ff",
            "nav-admin-bg":"#1a0d30","nav-admin-text":"#b490ff",
            "chart-blue":"#5ab0ff","chart-green":"#50e898","chart-red":"#ff6b6b","chart-amber":"#ffb84d","chart-purple":"#b490ff","chart-cyan":"#60e8d0",
            "guidance-bg":"#0a1a2a","guidance-text":"#80c4ff","guidance-border":"#2a4a6a",
            "scrollbar-thumb":"#3a3a3a","scrollbar-hover":"#555555",
            "phase-start":"#50e898","phase-open":"#5ab0ff","phase-closed":"#ff6b6b","phase-default":"#ffc080",
            "link-hover":"#80c4ff"
        },
        "hc-light": {
            "bg-body":"#ffffff","bg-panel":"#ffffff","bg-card":"#f0f0f0","bg-input":"#ffffff","bg-console":"#f5f5f5",
            "border":"#808080",
            "text-primary":"#0a0a0a","text-secondary":"#2a2a2a","text-muted":"#444444",
            "accent-blue":"#084a9e","accent-green":"#0a5828","accent-red":"#a01616","accent-amber":"#764000",
            "accent-purple":"#4a2488","accent-cyan":"#005848","accent-orange":"#8a4000",
            "nav-bg":"#ffffff","nav-border":"#808080","nav-text":"#444444","nav-text-active":"#084a9e",
            "nav-active-bg":"#e8f0ff","nav-env-bg":"#084a9e","nav-env-text":"#084a9e","nav-env-border":"#084a9e",
            "nav-primary-bg":"#084a9e",
            "nav-admin-bg":"#f0eaff","nav-admin-text":"#4a2488",
            "chart-blue":"#084a9e","chart-green":"#0a5828","chart-red":"#a01616","chart-amber":"#764000","chart-purple":"#4a2488","chart-cyan":"#005848",
            "guidance-bg":"#e8f0ff","guidance-text":"#084a9e","guidance-border":"#4a80c0",
            "scrollbar-thumb":"#999999","scrollbar-hover":"#666666",
            "phase-start":"#0a5828","phase-open":"#084a9e","phase-closed":"#a01616","phase-default":"#8a4000",
            "link-hover":"#063470"
        },
        "solarized-dark": {
            "bg-body":"#002b36","bg-panel":"#073642","bg-card":"#0a3f4e","bg-input":"#002b36","bg-console":"#00232d",
            "border":"#2a5460",
            "text-primary":"#93a1a1","text-secondary":"#839496","text-muted":"#657b83",
            "accent-blue":"#4aacf0","accent-green":"#98a817","accent-red":"#f27870","accent-amber":"#c99700",
            "accent-purple":"#9898e8","accent-cyan":"#38b4a8","accent-orange":"#e0893a",
            "nav-bg":"#073642","nav-border":"#2a5460","nav-text":"#657b83","nav-text-active":"#4aacf0",
            "nav-active-bg":"#0a3048","nav-env-bg":"#4aacf0","nav-env-text":"#4aacf0","nav-env-border":"#4aacf0",
            "nav-primary-bg":"#4aacf0",
            "nav-admin-bg":"#1a1a40","nav-admin-text":"#9898e8",
            "chart-blue":"#58b8f8","chart-green":"#a8b830","chart-red":"#f88880","chart-amber":"#d8a818","chart-purple":"#a8a8f0","chart-cyan":"#48c8b8",
            "guidance-bg":"#003845","guidance-text":"#4aacf0","guidance-border":"#2a5460",
            "scrollbar-thumb":"#2a5460","scrollbar-hover":"#3a6a78",
            "phase-start":"#98a817","phase-open":"#4aacf0","phase-closed":"#f27870","phase-default":"#e0893a",
            "link-hover":"#70c0f8"
        },
        "solarized-light": {
            "bg-body":"#fdf6e3","bg-panel":"#eee8d5","bg-card":"#e6dfcc","bg-input":"#fdf6e3","bg-console":"#fdf6e3",
            "border":"#d0c8b0",
            "text-primary":"#073642","text-secondary":"#586e75","text-muted":"#657b83",
            "accent-blue":"#1468a8","accent-green":"#546800","accent-red":"#b82525","accent-amber":"#7a5c00",
            "accent-purple":"#4a4e90","accent-cyan":"#147068","accent-orange":"#983510",
            "nav-bg":"#eee8d5","nav-border":"#d0c8b0","nav-text":"#657b83","nav-text-active":"#1468a8",
            "nav-active-bg":"#e0dac8","nav-env-bg":"#1468a8","nav-env-text":"#1468a8","nav-env-border":"#1468a8",
            "nav-primary-bg":"#1468a8",
            "nav-admin-bg":"#e8e4f0","nav-admin-text":"#4a4e90",
            "chart-blue":"#268bd2","chart-green":"#859900","chart-red":"#dc322f","chart-amber":"#b58900","chart-purple":"#6c71c4","chart-cyan":"#2aa198",
            "guidance-bg":"#f0eada","guidance-text":"#1468a8","guidance-border":"#c0b898",
            "scrollbar-thumb":"#c8c0aa","scrollbar-hover":"#a8a090",
            "phase-start":"#546800","phase-open":"#1468a8","phase-closed":"#b82525","phase-default":"#983510",
            "link-hover":"#0d4a78"
        },
        "slate": {
            "bg-body":"#1c1d21","bg-panel":"#252629","bg-card":"#2d2e33","bg-input":"#1c1d21","bg-console":"#101113",
            "border":"#3a3b40",
            "text-primary":"#e0e1e6","text-secondary":"#8c8e96","text-muted":"#787a82",
            "accent-blue":"#4a9eff","accent-green":"#3dd68c","accent-red":"#f25d5a","accent-amber":"#f0a840",
            "accent-purple":"#a078ff","accent-cyan":"#56d4c0","accent-orange":"#ffb378",
            "nav-bg":"#252629","nav-border":"#3a3b40","nav-text":"#787a82","nav-text-active":"#4a9eff",
            "nav-active-bg":"#273040","nav-env-bg":"#4a9eff","nav-env-text":"#4a9eff","nav-env-border":"#4a9eff",
            "nav-primary-bg":"#4a9eff",
            "nav-admin-bg":"#302a48","nav-admin-text":"#a078ff",
            "chart-blue":"#4a9eff","chart-green":"#3dd68c","chart-red":"#f25d5a","chart-amber":"#f0a840","chart-purple":"#a078ff","chart-cyan":"#56d4c0",
            "guidance-bg":"#1a2a3a","guidance-text":"#8ec4f0","guidance-border":"#2a4a60",
            "scrollbar-thumb":"#3a3b40","scrollbar-hover":"#505158",
            "phase-start":"#43a047","phase-open":"#1976d2","phase-closed":"#d32f2f","phase-default":"#f57c00",
            "link-hover":"#7ab8ff"
        },
        "nord": {
            "bg-body":"#2e3440","bg-panel":"#3b4252","bg-card":"#434c5e","bg-input":"#2e3440","bg-console":"#272d38",
            "border":"#4c566a",
            "text-primary":"#eceff4","text-secondary":"#d8dee9","text-muted":"#8a94aa",
            "accent-blue":"#90b8e0","accent-green":"#a3be8c","accent-red":"#ec98a0","accent-amber":"#ebcb8b",
            "accent-purple":"#caa8c8","accent-cyan":"#8fbcbb","accent-orange":"#e0a090",
            "nav-bg":"#3b4252","nav-border":"#4c566a","nav-text":"#8a94aa","nav-text-active":"#88c0d0",
            "nav-active-bg":"#3a4a58","nav-env-bg":"#88c0d0","nav-env-text":"#88c0d0","nav-env-border":"#88c0d0",
            "nav-primary-bg":"#5e81ac",
            "nav-admin-bg":"#3e3850","nav-admin-text":"#b48ead",
            "chart-blue":"#81a1c1","chart-green":"#a3be8c","chart-red":"#bf616a","chart-amber":"#ebcb8b","chart-purple":"#b48ead","chart-cyan":"#88c0d0",
            "guidance-bg":"#333d4e","guidance-text":"#90b8e0","guidance-border":"#4c566a",
            "scrollbar-thumb":"#4c566a","scrollbar-hover":"#5c6a80",
            "phase-start":"#a3be8c","phase-open":"#81a1c1","phase-closed":"#bf616a","phase-default":"#d08770",
            "link-hover":"#a8d0f0"
        }
    };

    // ─── Colour groups for editor panels ───
    var GROUPS = {
        surfaceRows: [
            ["bg-body","Body"],["bg-panel","Panel"],["bg-card","Card"],["bg-input","Input"],["bg-console","Console"]
        ],
        borderRows: [["border","Border"]],
        textRows: [["text-primary","Primary"],["text-secondary","Secondary"],["text-muted","Muted"]],
        accentRows: [
            ["accent-blue","Blue"],["accent-green","Green"],["accent-red","Red"],["accent-amber","Amber"],
            ["accent-purple","Purple"],["accent-cyan","Cyan"],["accent-orange","Orange"]
        ],
        chartRows: [
            ["chart-blue","Blue"],["chart-green","Green"],["chart-red","Red"],["chart-amber","Amber"],
            ["chart-purple","Purple"],["chart-cyan","Cyan"]
        ],
        navRows: [
            ["nav-bg","Background"],["nav-border","Border"],["nav-text","Text"],["nav-text-active","Active text"],
            ["nav-active-bg","Active bg"],["nav-env-text","Env text"],["nav-env-bg","Env bg"],["nav-env-border","Env border"],
            ["nav-admin-bg","Admin badge bg"],["nav-admin-text","Admin badge text"]
        ],
        guidanceRows: [["guidance-bg","Background"],["guidance-text","Text"],["guidance-border","Border"]],
        miscRows: [
            ["scrollbar-thumb","Scrollbar"],["scrollbar-hover","Scrollbar hover"],["link-hover","Link hover"],
            ["phase-start","Phase start"],["phase-open","Phase open"],["phase-closed","Phase closed"],["phase-default","Phase default"]
        ]
    };

    // ─── Contrast check pairings ───
    var CONTRAST_CHECKS = [
        ["text-primary","bg-body","Primary on body"],
        ["text-primary","bg-panel","Primary on panel"],
        ["text-secondary","bg-body","Secondary on body"],
        ["text-secondary","bg-panel","Secondary on panel"],
        ["text-muted","bg-body","Muted on body"],
        ["text-muted","bg-panel","Muted on panel"],
        ["accent-blue","bg-panel","Blue on panel"],
        ["accent-green","bg-panel","Green on panel"],
        ["accent-red","bg-panel","Red on panel"],
        ["accent-amber","bg-panel","Amber on panel"],
        ["accent-purple","bg-panel","Purple on panel"],
        ["accent-cyan","bg-panel","Cyan on panel"],
        ["accent-orange","bg-panel","Orange on panel"],
        ["chart-blue","bg-panel","Chart blue on panel"],
        ["chart-green","bg-panel","Chart green on panel"],
        ["chart-red","bg-panel","Chart red on panel"],
        ["chart-amber","bg-panel","Chart amber on panel"],
        ["chart-purple","bg-panel","Chart purple on panel"],
        ["chart-cyan","bg-panel","Chart cyan on panel"],
        ["nav-text","nav-bg","Nav text on nav bg"],
        ["nav-text-active","nav-active-bg","Nav active text on active bg"],
        ["nav-env-text","nav-bg","Env text on nav bg"],
        ["nav-admin-text","nav-admin-bg","Admin badge text on badge bg"],
        ["guidance-text","guidance-bg","Guidance text on guidance bg"]
    ];

    var _values = {};

    // ─── Init ───
    function init() {
        shared.init({ activePage: "" });
        loadBase("light");
        buildEditorRows();
        wireEvents();
        refresh();
    }

    function loadBase(name) {
        var base = BASES[name];
        if (!base) return;
        for (var k in base) _values[k] = base[k];
    }

    // ─── Build editor colour rows ───
    function buildEditorRows() {
        for (var containerId in GROUPS) {
            var container = document.getElementById(containerId);
            if (!container) continue;
            container.innerHTML = "";
            var items = GROUPS[containerId];
            for (var i = 0; i < items.length; i++) {
                var varName = items[i][0], label = items[i][1];
                var row = document.createElement("div");
                row.className = "tb-row";
                row.innerHTML =
                    '<span class="tb-row__label">' + esc(label) + '</span>' +
                    '<input type="color" class="tb-row__input" data-var="' + esc(varName) + '" value="' + esc(_values[varName] || "#000000") + '" />' +
                    '<input type="text" class="tb-row__hex" data-var="' + esc(varName) + '" value="' + esc(_values[varName] || "#000000") + '" />';
                container.appendChild(row);
            }
        }
    }

    function syncEditorFromValues() {
        var colourInputs = document.querySelectorAll(".tb-row__input");
        for (var i = 0; i < colourInputs.length; i++) {
            var v = colourInputs[i].getAttribute("data-var");
            if (_values[v]) {
                colourInputs[i].value = _values[v];
            }
        }
        var hexInputs = document.querySelectorAll(".tb-row__hex");
        for (var j = 0; j < hexInputs.length; j++) {
            var h = hexInputs[j].getAttribute("data-var");
            if (_values[h]) {
                hexInputs[j].value = _values[h];
            }
        }
    }

    // ─── Events ───
    function wireEvents() {
        // Colour picker and hex input changes
        document.addEventListener("input", function (e) {
            if (e.target.classList.contains("tb-row__input") || e.target.classList.contains("tb-row__hex")) {
                var varName = e.target.getAttribute("data-var");
                var val = e.target.value;
                if (val && val.charAt(0) !== "#") val = "#" + val;
                _values[varName] = val;
                // Sync sibling
                var row = e.target.parentNode;
                var inputs = row.querySelectorAll("[data-var]");
                for (var i = 0; i < inputs.length; i++) {
                    if (inputs[i] !== e.target) inputs[i].value = val;
                }
                refresh();
            }
        });

        document.getElementById("tbLoadBase").addEventListener("click", function () {
            var sel = document.getElementById("tbStartFrom");
            loadBase(sel.value);
            syncEditorFromValues();
            refresh();
        });

        document.getElementById("tbCopyCSS").addEventListener("click", function () {
            copyText(generateCSS());
        });

        document.getElementById("tbCopyManifest").addEventListener("click", function () {
            copyText(generateManifestEntry());
        });

        document.getElementById("tbDownloadCSS").addEventListener("click", function () {
            var id = document.getElementById("metaId").value.trim() || "my-theme";
            var blob = new Blob([generateCSS()], { type: "text/css" });
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = id + ".css";
            a.click();
            URL.revokeObjectURL(a.href);
        });

        // Populate start-from with manifest themes
        shared.themeManifest().then(function (manifest) {
            if (!manifest || !manifest.length) return;
            var sel = document.getElementById("tbStartFrom");
            sel.innerHTML = "";
            for (var i = 0; i < manifest.length; i++) {
                var o = document.createElement("option");
                o.value = manifest[i].id;
                o.textContent = manifest[i].label;
                sel.appendChild(o);
            }
        });
    }

    function refresh() {
        updateContrastReport();
        updatePreview();
        updateExport();
    }

    // ─── Contrast calculation ───
    function luminance(hex) {
        hex = hex.replace("#", "");
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        var r = parseInt(hex.substr(0,2),16)/255;
        var g = parseInt(hex.substr(2,2),16)/255;
        var b = parseInt(hex.substr(4,2),16)/255;
        function srgb(c) { return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
        return 0.2126*srgb(r) + 0.7152*srgb(g) + 0.0722*srgb(b);
    }

    function contrastRatio(a, b) {
        var l1 = luminance(a), l2 = luminance(b);
        var lighter = Math.max(l1,l2), darker = Math.min(l1,l2);
        return (lighter + 0.05) / (darker + 0.05);
    }

    function gradeContrast(ratio) {
        if (ratio >= 7) return { label: "AAA", cls: "aaa" };
        if (ratio >= 4.5) return { label: "AA", cls: "aa" };
        if (ratio >= 3) return { label: "AA-lg", cls: "lg" };
        return { label: "FAIL", cls: "fail" };
    }

    function updateContrastReport() {
        var container = document.getElementById("contrastReport");
        var html = "";
        for (var i = 0; i < CONTRAST_CHECKS.length; i++) {
            var fg = _values[CONTRAST_CHECKS[i][0]] || "#000000";
            var bg = _values[CONTRAST_CHECKS[i][1]] || "#ffffff";
            var label = CONTRAST_CHECKS[i][2];
            var ratio = contrastRatio(fg, bg);
            var grade = gradeContrast(ratio);
            html += '<div class="tb-contrast__row">' +
                '<span class="tb-contrast__pair">' + esc(label) + '</span>' +
                '<span class="tb-contrast__ratio">' + ratio.toFixed(2) + ':1</span>' +
                '<span class="tb-contrast__grade tb-contrast__grade--' + grade.cls + '">' + grade.label + '</span>' +
                '</div>';
        }
        container.innerHTML = html;
    }

    // ─── Live preview ───
    function updatePreview() {
        var v = _values;
        var frame = document.getElementById("previewFrame");
        var navBg = v["nav-bg"] || "#22262e";
        var navText = v["nav-text"] || "#999";
        var navActive = v["nav-text-active"] || "#fff";
        var navActiveBg = v["nav-active-bg"] || "#4a9eff";

        var html = '';
        // Nav bar
        html += '<div style="background:' + esc(navBg) + ';padding:8px 14px;display:flex;align-items:center;gap:8px">';
        html += '<span style="color:' + esc(navActive) + ';font-weight:600;font-size:12px">ShareDo Tools</span>';
        html += '<span style="padding:3px 8px;border-radius:4px;background:' + esc(navActiveBg) + ';color:' + esc(navActive) + ';font-size:10px;font-weight:600">Monitor</span>';
        html += '<span style="color:' + esc(navText) + ';font-size:10px">Issues</span>';
        html += '<span style="color:' + esc(navText) + ';font-size:10px">Metrics</span>';
        var envBg = v["nav-env-bg"] || "#333";
        var envText = v["nav-env-text"] || "#fff";
        var envBorder = v["nav-env-border"] || "#555";
        html += '<span style="margin-left:auto;padding:2px 8px;border-radius:4px;background:' + esc(hexToRgba(envBg, 0.25)) + ';color:' + esc(envText) + ';border:1px solid ' + esc(hexToRgba(envBorder, 0.4)) + ';font-size:10px;font-family:Consolas,monospace;font-weight:600">prod</span>';
        html += '</div>';

        // Body
        var bodyBg = v["bg-body"] || "#f5f6f8";
        var panelBg = v["bg-panel"] || "#fff";
        var cardBg = v["bg-card"] || "#f0f1f4";
        var border = v["border"] || "#d8dbe0";
        var txtP = v["text-primary"] || "#1a1d23";
        var txtS = v["text-secondary"] || "#5c6370";
        var txtM = v["text-muted"] || "#6b7280";

        html += '<div style="background:' + esc(bodyBg) + ';padding:12px;color:' + esc(txtP) + ';font-family:Segoe UI,system-ui,sans-serif;font-size:12px">';

        // Page header
        var iconBg = hexToRgba(v["accent-blue"] || "#1a73e8", 0.1);
        html += '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px">';
        html += '<div style="width:32px;height:32px;border-radius:5px;background:' + esc(iconBg) + ';color:' + esc(v["accent-blue"]) + ';display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0"><span class="fa fa-bolt"></span></div>';
        html += '<div><div style="font-size:14px;font-weight:600;margin-bottom:1px">Monitor</div>';
        html += '<div style="font-size:10px;color:' + esc(txtS) + ';line-height:1.4">System health overview. Summary pills show status.</div></div></div>';

        // Guidance
        var gBg = v["guidance-bg"] || "#EFF8FF";
        var gText = v["guidance-text"] || "#1d6db5";
        var gBorder = v["guidance-border"] || "#93c5fd";
        html += '<div style="padding:8px 12px;background:' + esc(gBg) + ';border:1px solid ' + esc(gBorder) + ';border-radius:5px;color:' + esc(gText) + ';font-size:10px;margin-bottom:10px;line-height:1.4">';
        html += '<span class="fa fa-lightbulb-o" style="margin-right:6px"></span>Guidance block example with <code style="font-family:Consolas,monospace;border:1px solid ' + esc(border) + ';border-radius:2px;padding:0 3px;background:' + esc(cardBg) + '">kbd</code> styling.</div>';

        // Panel with badges
        html += '<div style="background:' + esc(panelBg) + ';border:1px solid ' + esc(border) + ';border-radius:5px;margin-bottom:10px">';
        html += '<div style="padding:8px 12px;border-bottom:1px solid ' + esc(border) + ';display:flex;align-items:center;gap:6px">';
        html += '<span style="font-size:10px;font-weight:600">Section Header</span>';
        html += '<span style="margin-left:auto"></span>';
        html += badge(v["accent-green"], "OK") + ' ' + badge(v["accent-amber"], "Warning") + ' ' + badge(v["accent-red"], "Error");
        html += '</div>';

        // Table rows
        html += '<div style="padding:0">';
        html += tableRow(cardBg, border, txtP, txtS, txtM, v, "audit-trail-indexer", "Core", "OK", v["accent-green"], "2", "0");
        html += tableRow(panelBg, border, txtP, txtS, txtM, v, "workflow-trigger", "Core", "Warning", v["accent-amber"], "1", "847");
        html += '</div></div>';

        // Chips
        html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">';
        var chipColours = ["accent-blue","accent-green","accent-red","accent-amber","accent-purple","accent-cyan"];
        var chipLabels = ["Blue","Green","Red","Amber","Purple","Cyan"];
        for (var c = 0; c < chipColours.length; c++) {
            var cc = v[chipColours[c]] || "#999";
            html += '<span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-family:Consolas,monospace;background:' + esc(hexToRgba(cc, 0.1)) + ';color:' + esc(cc) + '">' + chipLabels[c] + '</span>';
        }
        html += '</div>';

        // Buttons
        html += '<div style="display:flex;gap:6px;align-items:center">';
        html += '<button style="padding:4px 12px;border:1px solid ' + esc(border) + ';border-radius:4px;background:' + esc(panelBg) + ';color:' + esc(txtP) + ';font-size:10px;cursor:pointer">Default</button>';
        html += '<button style="padding:4px 12px;border:1px solid ' + esc(navActiveBg) + ';border-radius:4px;background:' + esc(navActiveBg) + ';color:#fff;font-size:10px;cursor:pointer">Primary</button>';

        var aBl = v["accent-blue"] || "#4a9eff";
        html += '<button style="padding:3px 8px;border:1px solid ' + esc(aBl) + ';border-radius:4px;background:' + esc(aBl) + ';color:#fff;font-size:9px;cursor:pointer">1h</button>';
        html += '<button style="padding:3px 8px;border:1px solid ' + esc(border) + ';border-radius:4px;background:' + esc(panelBg) + ';color:' + esc(txtS) + ';font-size:9px;cursor:pointer">6h</button>';
        html += '</div>';

        // Mini chart palette preview
        var chartColours = [
            v["chart-blue"] || v["accent-blue"] || "#4a9eff",
            v["chart-green"] || v["accent-green"] || "#3dd68c",
            v["chart-red"] || v["accent-red"] || "#ef5350",
            v["chart-amber"] || v["accent-amber"] || "#f0a840",
            v["chart-purple"] || v["accent-purple"] || "#a078ff",
            v["chart-cyan"] || v["accent-cyan"] || "#56d4c0"
        ];
        var chartLabels = ["Blue","Green","Red","Amber","Purple","Cyan"];
        var lineYs = [8, 20, 32, 44, 56, 68];
        var linePts = [[10,0],[90,-4],[170,3]]; // x, y-offset from baseline

        html += '<div style="background:' + esc(panelBg) + ';border:1px solid ' + esc(border) + ';border-radius:5px;margin-top:10px;overflow:hidden">';
        html += '<div style="padding:6px 12px;border-bottom:1px solid ' + esc(border) + ';font-size:10px;font-weight:600;color:' + esc(txtP) + ';display:flex;align-items:center;gap:6px">';
        html += '<span class="fa fa-line-chart" style="font-size:9px;color:' + esc(txtM) + '"></span>Chart Palette</div>';
        html += '<div style="padding:6px 10px">';
        html += '<svg viewBox="0 0 220 76" style="width:360px;height:auto;display:block" xmlns="http://www.w3.org/2000/svg">';

        for (var si = 0; si < chartColours.length; si++) {
            var by = lineYs[si];
            var pts = [];
            for (var pi = 0; pi < linePts.length; pi++) pts.push(linePts[pi][0] + "," + (by + linePts[pi][1]));
            html += '<polyline points="' + pts.join(" ") + '" fill="none" stroke="' + esc(chartColours[si]) + '" stroke-width="1.8" stroke-linejoin="round"/>';
            for (var ni = 0; ni < linePts.length; ni++) {
                html += '<circle cx="' + linePts[ni][0] + '" cy="' + (by + linePts[ni][1]) + '" r="2.5" fill="' + esc(chartColours[si]) + '"/>';
            }
            html += '<text x="180" y="' + (by + 3) + '" font-size="8" font-family="Consolas,monospace" fill="' + esc(txtM) + '">' + chartLabels[si] + '</text>';
        }

        html += '</svg>';
        html += '</div></div>';

        html += '</div>'; // body
        frame.innerHTML = html;
    }

    function badge(colour, text) {
        return '<span style="font-size:9px;font-family:Consolas,monospace;padding:1px 6px;border-radius:8px;font-weight:600;background:' + esc(hexToRgba(colour, 0.1)) + ';color:' + esc(colour) + '">' + esc(text) + '</span>';
    }

    function tableRow(bg, border, txtP, txtS, txtM, v, stream, group, status, statusColour, conn, backlog) {
        var isWarn = parseInt(backlog, 10) > 100;
        var html = '<div style="display:flex;padding:5px 12px;font-size:10px;border-top:1px solid ' + esc(hexToRgba(border, 0.3)) + ';background:' + esc(bg) + '">';
        html += '<span style="flex:2;font-family:Consolas,monospace;color:' + esc(txtP) + '">' + esc(stream) + '</span>';
        html += '<span style="flex:1;color:' + esc(txtS) + '">' + esc(group) + '</span>';
        html += '<span style="flex:1">' + badge(statusColour, status) + '</span>';
        html += '<span style="width:40px;text-align:right;font-family:Consolas,monospace">' + esc(conn) + '</span>';
        html += '<span style="width:50px;text-align:right;font-family:Consolas,monospace;color:' + (isWarn ? esc(v["accent-amber"]) : esc(txtP)) + ';font-weight:' + (isWarn ? '600' : '400') + '">' + esc(backlog) + '</span>';
        html += '</div>';
        return html;
    }

    // ─── Export ───
    function generateCSS() {
        var id = document.getElementById("metaId").value.trim() || "my-theme";
        var v = _values;
        var bgOpacity = document.getElementById("metaLightBased").checked ? "0.08" : "0.12";
        var neutralBase = document.getElementById("metaLightBased").checked ? "0,0,0" : "92,99,112";

        var lines = [];
        lines.push('/* Theme: ' + id + ' */');
        lines.push('[data-theme="' + id + '"] {');
        lines.push('    /* Surfaces */');
        lines.push('    --bg-body: ' + v["bg-body"] + ';');
        lines.push('    --bg-panel: ' + v["bg-panel"] + ';');
        lines.push('    --bg-card: ' + v["bg-card"] + ';');
        lines.push('    --bg-input: ' + v["bg-input"] + ';');
        lines.push('    --bg-console: ' + v["bg-console"] + ';');
        lines.push('');
        lines.push('    /* Borders */');
        lines.push('    --border: ' + v["border"] + ';');
        lines.push('    --border-subtle: ' + hexToRgba(v["border"], 0.5) + ';');
        lines.push('');
        lines.push('    /* Text */');
        lines.push('    --text-primary: ' + v["text-primary"] + ';');
        lines.push('    --text-secondary: ' + v["text-secondary"] + ';');
        lines.push('    --text-muted: ' + v["text-muted"] + ';');
        lines.push('');
        lines.push('    /* Accents (foreground) */');
        var accentNames = ["blue","green","red","amber","purple","cyan","orange"];
        for (var a = 0; a < accentNames.length; a++) {
            lines.push('    --accent-' + accentNames[a] + ': ' + v["accent-" + accentNames[a]] + ';');
        }
        lines.push('');
        lines.push('    /* Accents (tinted backgrounds) */');
        for (var b = 0; b < accentNames.length; b++) {
            lines.push('    --accent-' + accentNames[b] + '-bg: ' + hexToRgba(v["accent-" + accentNames[b]], parseFloat(bgOpacity)) + ';');
        }
        lines.push('    --accent-neutral-bg: rgba(' + neutralBase + ',' + bgOpacity + ');');
        lines.push('');
        lines.push('    /* Chart palette (line/bar colours, falls back to accents if omitted) */');
        var chartNames = ["blue","green","red","amber","purple","cyan"];
        for (var ci = 0; ci < chartNames.length; ci++) {
            lines.push('    --chart-' + chartNames[ci] + ': ' + v["chart-" + chartNames[ci]] + ';');
        }
        lines.push('');
        lines.push('    /* Interaction */');
        var hoverBase = v["text-primary"];
        lines.push('    --hover-row: ' + hexToRgba(v["accent-blue"], 0.03) + ';');
        lines.push('    --hover-bg: ' + hexToRgba(hoverBase, 0.04) + ';');
        lines.push('    --link-hover: ' + v["link-hover"] + ';');
        lines.push('');
        lines.push('    /* Scrollbar */');
        lines.push('    --scrollbar-thumb: ' + v["scrollbar-thumb"] + ';');
        lines.push('    --scrollbar-hover: ' + v["scrollbar-hover"] + ';');
        lines.push('');
        lines.push('    /* Phase colours */');
        lines.push('    --phase-start: ' + v["phase-start"] + ';');
        lines.push('    --phase-open: ' + v["phase-open"] + ';');
        lines.push('    --phase-closed: ' + v["phase-closed"] + ';');
        lines.push('    --phase-default: ' + v["phase-default"] + ';');
        lines.push('');
        lines.push('    /* Guidance */');
        lines.push('    --guidance-bg: ' + v["guidance-bg"] + ';');
        lines.push('    --guidance-text: ' + v["guidance-text"] + ';');
        lines.push('    --guidance-border: ' + v["guidance-border"] + ';');
        lines.push('');
        lines.push('    /* Navigation */');
        lines.push('    --nav-bg: ' + v["nav-bg"] + ';');
        lines.push('    --nav-border: ' + v["nav-border"] + ';');
        lines.push('    --nav-text: ' + v["nav-text"] + ';');
        lines.push('    --nav-text-active: ' + v["nav-text-active"] + ';');
        lines.push('    --nav-active-bg: ' + v["nav-active-bg"] + ';');
        lines.push('    --nav-env-bg: ' + hexToRgba(v["nav-env-bg"], 0.25) + ';');
        lines.push('    --nav-env-text: ' + v["nav-env-text"] + ';');
        lines.push('    --nav-env-border: ' + hexToRgba(v["nav-env-border"], 0.4) + ';');
        lines.push('    --nav-primary-bg: ' + (v["nav-primary-bg"] || v["nav-active-bg"]) + ';');
        lines.push('    --nav-primary-text: #fff;');
        lines.push('    --nav-admin-bg: ' + v["nav-admin-bg"] + ';');
        lines.push('    --nav-admin-text: ' + v["nav-admin-text"] + ';');
        lines.push('}');

        return lines.join('\n');
    }

    function generateManifestEntry() {
        var id = document.getElementById("metaId").value.trim() || "my-theme";
        var label = document.getElementById("metaLabel").value.trim() || "My Theme";
        var icon = document.getElementById("metaIcon").value.trim() || "fa-paint-brush";
        var lb = document.getElementById("metaLightBased").checked;
        return '{ "id": "' + id + '", "label": "' + label + '", "icon": "' + icon + '", "lightBased": ' + lb + ' }';
    }

    function updateExport() {
        document.getElementById("exportOutput").textContent = generateCSS();
    }

    // ─── Helpers ───
    function hexToRgba(hex, alpha) {
        if (!hex) return "rgba(0,0,0," + alpha + ")";
        hex = hex.replace("#", "");
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        var r = parseInt(hex.substr(0,2),16);
        var g = parseInt(hex.substr(2,2),16);
        var b = parseInt(hex.substr(4,2),16);
        return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
    }

    function copyText(text) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
        } else {
            var ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
        }
    }

    // ─── Panel toggle ───
    window.tbToggle = function (id) {
        var el = document.getElementById(id);
        if (el) el.classList.toggle("tb-panel--collapsed");
    };

    // ─── Boot ───
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();