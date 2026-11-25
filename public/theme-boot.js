(function () {
  try {
    var choice = localStorage.getItem("intrisal-theme-choice");
    var theme = "dark";

    if (choice === "light" || choice === "dark") {
      theme = choice;
    } else if (choice === "auto") {
      var hour = new Date().getHours();
      theme = hour >= 7 && hour < 19 ? "light" : "dark";
    }

    document.documentElement.setAttribute("data-theme", theme);
  } catch (error) {
    // Keep the default dark theme if browser storage is unavailable.
  }
})();
