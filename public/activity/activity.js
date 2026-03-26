(function () {
    "use strict";

    var esc = shared.esc;

    function init() {
        shared.init({ activePage: "activity" });
        document.getElementById("activityRefreshBtn").addEventListener("click", loadActivity);
        loadActivity();
    }

    function setError(message) {
        var el = document.getElementById("globalError");
        if (!message) {
            el.style.display = "none";
            el.textContent = "";
            return;
        }
        el.style.display = "block";
        el.textContent = message;
    }

    function fmtDate(ts) {
        if (!ts) return "--";
        try {
            var d = new Date(ts);
            if (isNaN(d.getTime())) return "--";
            return d.toLocaleString();
        } catch (e) {
            return "--";
        }
    }

    function loadActivity() {
        setError("");
        var body = document.getElementById("activityBody");
        var badge = document.getElementById("activityCountBadge");
        var limitInput = document.getElementById("activityLimit");
        var limit = parseInt(limitInput.value, 10);
        if (isNaN(limit) || limit < 1) limit = 200;
        if (limit > 1000) limit = 1000;
        limitInput.value = String(limit);

        body.innerHTML = '<tr><td colspan="6" class="usd-table__muted">Loading...</td></tr>';

        shared.apiFetch("/api/activity/log?limit=" + encodeURIComponent(String(limit)))
            .then(function (r) {
                if (!r.ok) throw new Error("Failed to load activity log");
                return r.json();
            })
            .then(function (data) {
                var items = data && data.items ? data.items : [];
                badge.textContent = String(items.length);
                if (!items.length) {
                body.innerHTML = '<tr><td colspan="6" class="usd-table__muted">No entries found</td></tr>';
                    return;
                }

                var html = "";
                for (var i = 0; i < items.length; i++) {
                    var it = items[i] || {};
                    var user = it.userEmail || it.userName || it.userId || "--";
                    var activityType = it.activityType || "--";
                    var page = it.page || "--";
                    var path = it.currentPath || it.requestedPath || "--";
                    html += "<tr>" +
                        "<td class=\"usd-table__mono\">" + esc(fmtDate(it.ts)) + "</td>" +
                        "<td>" + esc(it.action || "--") + "</td>" +
                        "<td>" + esc(user) + "</td>" +
                        "<td>" + esc(activityType) + "</td>" +
                        "<td>" + esc(page) + "</td>" +
                        "<td class=\"usd-table__mono\">" + esc(path) + "</td>" +
                        "</tr>";
                }
                body.innerHTML = html;
            })
            .catch(function (err) {
                body.innerHTML = '<tr><td colspan="6" class="usd-table__muted">Unable to load entries</td></tr>';
                badge.textContent = "0";
                setError(err && err.message ? err.message : "Unable to load activity log");
            });
    }

    window.addEventListener("DOMContentLoaded", init);
})();
