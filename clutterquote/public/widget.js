/*!
 * ClutterQuote embed loader.
 *
 *   <script src="https://YOUR-CLUTTERQUOTE-HOST/widget.js" data-tenant="your-slug" async></script>
 *
 * Optional: data-target="#css-selector" to mount somewhere other than right after the tag.
 * Emits window "clutterquote" CustomEvents ({ detail: { name } }) for analytics:
 * step:describe, step:estimate, step:book, checkout:start, booking:confirmed.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || !script.getAttribute("data-tenant")) {
    console.error("[ClutterQuote] widget.js needs a data-tenant attribute.");
    return;
  }
  var origin = new URL(script.src).origin;
  var slug = script.getAttribute("data-tenant");
  var targetSel = script.getAttribute("data-target");

  var iframe = document.createElement("iframe");
  iframe.src = origin + "/embed/" + encodeURIComponent(slug);
  iframe.title = "Instant junk removal quote";
  iframe.setAttribute("allow", "camera");
  iframe.style.cssText = "display:block;width:100%;max-width:640px;margin:0 auto;border:0;height:620px;background:transparent;";

  var mount = targetSel && document.querySelector(targetSel);
  if (mount) mount.appendChild(iframe);
  else script.parentNode.insertBefore(iframe, script.nextSibling);

  window.addEventListener("message", function (e) {
    if (e.origin !== origin || e.source !== iframe.contentWindow || !e.data) return;
    var data = e.data;
    if (data.type === "clutterquote:resize" && typeof data.height === "number") {
      iframe.style.height = Math.max(320, Math.min(4000, data.height)) + "px";
    } else if (data.type === "clutterquote:redirect" && typeof data.url === "string") {
      // Only ever navigate the host page to Stripe Checkout.
      if (data.url.indexOf("https://checkout.stripe.com/") !== 0) return;
      iframe.contentWindow.postMessage({ type: "clutterquote:redirect-ack" }, origin);
      window.location.href = data.url;
    } else if (data.type === "clutterquote:event" && typeof data.name === "string") {
      window.dispatchEvent(new CustomEvent("clutterquote", { detail: { name: data.name, tenant: slug } }));
    }
  });
})();
