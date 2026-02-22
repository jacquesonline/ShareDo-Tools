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
            "nav-active-bg":"#4a9eff","nav-env-bg":"#4a9eff","nav-env-text":"#4a9eff","nav-env-border":"#4a9eff",
            "nav-admin-bg":"#a078ff","nav-admin-text":"#a078ff",
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
            "nav-active-bg":"#1a73e8","nav-env-bg":"#1a73e8","nav-env-text":"#1a73e8","nav-env-border":"#1a73e8",
            "nav-admin-bg":"#7c4dff","nav-admin-text":"#7c4dff",
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
            "nav-admin-bg":"#CC2E57","nav-admin-text":"#ffffff",
            "guidance-bg":"#fdf0f4","guidance-text":"#A82660","guidance-border":"#e8b0c8",
            "scrollbar-thumb":"#c4b8be","scrollbar-hover":"#a0959a",
            "phase-start":"#2d7a3a","phase-open":"#1a6b9c","phase-closed":"#DB333C","phase-default":"#b84c00",
            "link-hover":"#A82660"
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
        ["nav-text","nav-bg","Nav text on nav bg"],
        ["nav-text-active","nav-active-bg","Nav active text on active bg"],
        ["nav-env-text","nav-env-bg","Env text on env bg"],
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
        lines.push('    --nav-primary-bg: ' + v["nav-active-bg"] + ';');
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