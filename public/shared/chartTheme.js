/**
 * Chart theme helper for ShareDo Tools.
 * Reads computed CSS variable values so Chart.js configs use
 * the active theme colours without hardcoded hex values.
 *
 * Usage:
 *   var ct = chartTheme;
 *   var tickClr = ct.textMuted();
 *   var tooltipCfg = ct.tooltip();
 *   var palette = ct.palette(10);
 */
var chartTheme = (function () {
    "use strict";

    // ─── Core reader ───

    function get(varName) {
        return getComputedStyle(document.body).getPropertyValue(varName).trim();
    }

    // ─── Semantic shortcuts ───

    function bgPanel()      { return get("--bg-panel"); }
    function bgCard()       { return get("--bg-card"); }
    function textPrimary()  { return get("--text-primary"); }
    function textSecondary(){ return get("--text-secondary"); }
    function textMuted()    { return get("--text-muted"); }
    function border()       { return get("--border"); }
    function borderSubtle() { return get("--border-subtle"); }
    function accentBlue()   { return get("--accent-blue"); }
    function accentGreen()  { return get("--accent-green"); }
    function accentRed()    { return get("--accent-red"); }
    function accentAmber()  { return get("--accent-amber"); }
    function accentPurple() { return get("--accent-purple"); }
    function accentCyan()   { return get("--accent-cyan"); }
    function accentRedBg()  { return get("--accent-red-bg"); }

    // ─── Fonts ───

    var fontMono = "'Consolas', 'Courier New', monospace";

    // ─── Grid colour ───
    // border-subtle is rgba, which works directly in Chart.js

    function gridColor() { return borderSubtle(); }

    // ─── Common config builders ───

    /**
     * Returns x-axis scale config for a time axis.
     */
    function timeAxis(overrides) {
        var cfg = {
            type: "time",
            time: { tooltipFormat: "dd MMM yyyy, HH:mm:ss" },
            grid: { color: gridColor() },
            ticks: { color: textMuted(), font: { size: 10 }, maxTicksLimit: 12, autoSkip: true, maxRotation: 45 }
        };
        if (overrides) { for (var k in overrides) cfg[k] = overrides[k]; }
        return cfg;
    }

    /**
     * Returns y-axis scale config.
     * @param {string} [title] - axis title text, omitted if falsy
     * @param {object} [overrides] - merged onto the config
     */
    function valueAxis(title, overrides) {
        var cfg = {
            beginAtZero: true,
            grid: { color: gridColor() },
            ticks: { color: textMuted(), font: { size: 10 } }
        };
        if (title) {
            cfg.title = { display: true, text: title, color: textMuted(), font: { size: 10 } };
        }
        if (overrides) { for (var k in overrides) cfg[k] = overrides[k]; }
        return cfg;
    }

    /**
     * Returns legend plugin config.
     * @param {function} [onClick] - custom click handler
     */
    function legend(onClick) {
        var cfg = {
            position: "bottom",
            labels: {
                color: textSecondary(),
                font: { size: 10, family: fontMono },
                boxWidth: 12,
                padding: 10
            }
        };
        if (onClick) cfg.onClick = onClick;
        return cfg;
    }

    /**
     * Returns tooltip plugin config.
     */
    function tooltip() {
        return {
            backgroundColor: bgPanel(),
            titleColor: textPrimary(),
            bodyColor: textSecondary(),
            borderColor: border(),
            borderWidth: 1,
            titleFont: { size: 11 },
            bodyFont: { size: 11, family: fontMono }
        };
    }

    /**
     * Returns threshold annotation config (horizontal dashed line).
     * @param {number} value - y-axis threshold value
     * @param {boolean} display - whether to show the line
     */
    function thresholdAnnotation(value, display) {
        return {
            type: "line",
            scaleID: "y",
            value: value,
            borderColor: accentRed(),
            borderWidth: 1.5,
            borderDash: [4, 3],
            display: display,
            label: {
                display: true,
                content: "Threshold: " + value,
                position: "end",
                yAdjust: -10,
                backgroundColor: accentRedBg(),
                color: accentRed(),
                font: { size: 9, family: fontMono },
                padding: { top: 2, bottom: 2, left: 4, right: 4 }
            }
        };
    }

    /**
     * Returns the canvas background fill colour (for right-click save).
     */
    function bgFill() { return bgPanel(); }

    // ─── Series palette ───
    // First 6 entries match the CSS accent variables.
    // Remaining entries are extended palette colours for charts with many series.

    var PALETTE_EXTENDED = [
        null, null, null, null, null, null,  // slots 0-5: filled dynamically from accents
        "#ff7eb3", "#8bc34a", "#ff9800", "#7986cb",
        "#26c6da", "#d4e157", "#ec407a", "#66bb6a", "#ffa726"
    ];

    /**
     * Returns an array of `count` colours, cycling through the palette.
     * The first 6 are always the live accent values from CSS.
     */
    function palette(count) {
        var base = [
            accentBlue(), accentGreen(), accentRed(), accentAmber(), accentPurple(), accentCyan()
        ];
        for (var i = 6; i < PALETTE_EXTENDED.length; i++) base.push(PALETTE_EXTENDED[i]);
        var result = [];
        for (var j = 0; j < count; j++) result.push(base[j % base.length]);
        return result;
    }

    // ─── Public API ───

    return {
        get: get,
        bgPanel: bgPanel,
        bgCard: bgCard,
        textPrimary: textPrimary,
        textSecondary: textSecondary,
        textMuted: textMuted,
        border: border,
        borderSubtle: borderSubtle,
        gridColor: gridColor,
        accentBlue: accentBlue,
        accentGreen: accentGreen,
        accentRed: accentRed,
        accentAmber: accentAmber,
        accentPurple: accentPurple,
        accentCyan: accentCyan,
        accentRedBg: accentRedBg,
        fontMono: fontMono,
        timeAxis: timeAxis,
        valueAxis: valueAxis,
        legend: legend,
        tooltip: tooltip,
        thresholdAnnotation: thresholdAnnotation,
        bgFill: bgFill,
        palette: palette
    };
})();