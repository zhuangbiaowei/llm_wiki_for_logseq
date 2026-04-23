(function () {
  function setTree() {
    document.querySelectorAll(".content li").forEach(function (item) {
      var nested = item.querySelector(":scope > ul, :scope > ol");
      if (!nested || item.querySelector(":scope > .node-icon")) {
        return;
      }

      var icon = document.createElement("button");
      icon.className = "node-icon";
      icon.type = "button";
      icon.textContent = nested.style.display === "none" ? "+" : "-";
      icon.setAttribute("aria-label", "Toggle nested list");
      icon.addEventListener("click", function () {
        var collapsed = nested.style.display === "none";
        nested.style.display = collapsed ? "" : "none";
        icon.textContent = collapsed ? "-" : "+";
      });
      item.insertBefore(icon, item.firstChild);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setTree);
  } else {
    setTree();
  }
})();
