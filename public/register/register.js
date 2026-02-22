/**
 * Registration page for ShareDo Tools multi-user mode.
 * Standalone -- does not depend on shared.js.
 */
(function () {
    "use strict";

    var EMAIL_DOMAIN = "mauriceblackburn.com.au";

    function init() {
        applyTheme();

        document.getElementById("regSubmitBtn").addEventListener("click", onSubmit);

        // Enter key on any input triggers submit
        var inputs = document.querySelectorAll(".reg-input");
        for (var i = 0; i < inputs.length; i++) {
            inputs[i].addEventListener("keydown", function (e) {
                if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
            });
        }

        // Focus first name on load
        document.getElementById("regFirstName").focus();
    }

    function applyTheme() {
        var theme = "dark";
        try { theme = localStorage.getItem("sharedo-tools-theme") || "dark"; } catch (e) {}
        document.body.dataset.theme = theme;

        // Light-based detection: fetch manifest or use simple check
        fetch("/shared/themes/manifest.json")
            .then(function (r) { return r.json(); })
            .then(function (manifest) {
                for (var i = 0; i < manifest.length; i++) {
                    if (manifest[i].id === theme && manifest[i].lightBased) {
                        document.body.classList.add("light-theme");
                        break;
                    }
                }
            })
            .catch(function () {
                if (theme === "light" || theme === "mb-brand") document.body.classList.add("light-theme");
            });

        var hc = null;
        try { hc = localStorage.getItem("sharedo-tools-high-contrast"); } catch (e) {}
        if (hc === "true") document.body.classList.add("high-contrast");
    }

    function onSubmit() {
        var firstName = document.getElementById("regFirstName").value.trim();
        var lastName = document.getElementById("regLastName").value.trim();
        var emailId = document.getElementById("regEmail").value.trim().toLowerCase();

        // Client-side validation
        if (!firstName) { showError("First name is required"); document.getElementById("regFirstName").focus(); return; }
        if (!lastName) { showError("Last name is required"); document.getElementById("regLastName").focus(); return; }
        if (!emailId) { showError("Email is required"); document.getElementById("regEmail").focus(); return; }
        if (emailId.indexOf("@") !== -1) { showError("Enter only the part before @" + EMAIL_DOMAIN); document.getElementById("regEmail").focus(); return; }

        var email = emailId + "@" + EMAIL_DOMAIN;

        var btn = document.getElementById("regSubmitBtn");
        btn.disabled = true;
        btn.innerHTML = '<span class="fa fa-spinner fa-spin"></span> Registering...';
        hideError();

        fetch("/api/session/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ firstName: firstName, lastName: lastName, email: email })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showError(data.message || "Registration failed");
                btn.disabled = false;
                btn.innerHTML = '<span class="fa fa-sign-in"></span> Register';
                return;
            }

            btn.innerHTML = '<span class="fa fa-check"></span> Registered';

            // Redirect to the return URL or home
            var returnUrl = getReturnUrl();
            setTimeout(function () { window.location.href = returnUrl; }, 300);
        })
        .catch(function (err) {
            showError("Network error: " + err.message);
            btn.disabled = false;
            btn.innerHTML = '<span class="fa fa-sign-in"></span> Register';
        });
    }

    function getReturnUrl() {
        var params = new URLSearchParams(window.location.search);
        var ret = params.get("return");
        if (ret && ret.charAt(0) === "/") return ret;
        return "/";
    }

    function showError(msg) {
        var el = document.getElementById("regError");
        el.textContent = msg;
        el.style.display = "";
    }

    function hideError() {
        document.getElementById("regError").style.display = "none";
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();